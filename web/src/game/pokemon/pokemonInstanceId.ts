declare const pokemonInstanceIdBrand: unique symbol

/** Identifiant persistant, opaque et sérialisable d'une instance de Pokémon. */
export type PokemonInstanceId = string & {
  readonly [pokemonInstanceIdBrand]: 'PokemonInstanceId'
}

/** Source indépendante du RNG de gameplay. Elle doit produire exactement la longueur demandée. */
export type PokemonInstanceIdByteSource = (byteLength: number) => Uint8Array

export const pokemonInstanceIdVersion = 1
export const pokemonInstanceIdMaxLength = 522

const randomPrefix = `pkm:v${pokemonInstanceIdVersion}:r:`
const legacyPrefix = `pkm:v${pokemonInstanceIdVersion}:l:`
const randomByteLength = 16
const randomHexLength = randomByteLength * 2
const campaignNamespaceMaxByteLength = 64
const canonicalPathMaxByteLength = 192
const portableLegacyNamespacePattern = /^hgss-(?:7|8)-[0-9a-f]{8}(?::trainer-house)?$/
const portableLegacyFieldPathPattern = /^(?:party\/[0-5]|storage\/(?:[0-9]|1[0-7])\/(?:[0-9]|[12][0-9])|daycare\/[01]|pal-park\/[0-5]|bug-contest|roamer\/[0-3])$/
const portableLegacyTrainerHousePathPattern = /^entry\/[0-9]\/[0-5]$/
const shedinjaGenerationAttemptLimit = 16
const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder('utf-8', { fatal: true })

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true
    }
  }
  return false
}

function hasForbiddenCanonicalCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0)!
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029) return true
  }
  return false
}

function encodeCanonicalComponent(value: unknown, label: string, maxByteLength: number): Uint8Array {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} doit être une chaîne non vide.`)
  }
  if (value.trim() !== value) throw new Error(`${label} ne doit pas commencer ou finir par un espace.`)
  if (hasUnpairedSurrogate(value)) throw new Error(`${label} contient une séquence Unicode invalide.`)
  if (value.normalize('NFC') !== value) throw new Error(`${label} doit être normalisé en Unicode NFC.`)
  if (hasForbiddenCanonicalCharacter(value)) throw new Error(`${label} contient un caractère de contrôle.`)
  const bytes = utf8Encoder.encode(value)
  if (bytes.length > maxByteLength) {
    throw new Error(`${label} dépasse la limite de ${maxByteLength} octets UTF-8.`)
  }
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  let result = ''
  for (const byte of bytes) result += byte.toString(16).padStart(2, '0')
  return result
}

function hexToBytes(value: string): Uint8Array | undefined {
  if (value.length === 0 || value.length % 2 !== 0 || !/^[0-9a-f]+$/.test(value)) return undefined
  const bytes = new Uint8Array(value.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

function decodeCanonicalComponent(
  encoded: string,
  label: string,
  maxByteLength: number,
): string | undefined {
  const bytes = hexToBytes(encoded)
  if (!bytes || bytes.length > maxByteLength) return undefined
  try {
    const decoded = utf8Decoder.decode(bytes)
    const canonicalBytes = encodeCanonicalComponent(decoded, label, maxByteLength)
    return bytesToHex(canonicalBytes) === encoded ? decoded : undefined
  } catch {
    return undefined
  }
}

function cryptoByteSource(byteLength: number): Uint8Array {
  const cryptoApi = globalThis.crypto
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== 'function') {
    throw new Error("L'API cryptographique requise pour identifier le Pokémon est indisponible.")
  }
  const bytes = new Uint8Array(byteLength)
  cryptoApi.getRandomValues(bytes)
  return bytes
}

function readRandomBytes(source: PokemonInstanceIdByteSource): Uint8Array {
  const bytes = source(randomByteLength)
  if (!(bytes instanceof Uint8Array) || bytes.length !== randomByteLength) {
    throw new Error(`La source d'identifiant Pokémon doit produire exactement ${randomByteLength} octets.`)
  }
  return bytes
}

/** Génère un identifiant aléatoire 128 bits sans consommer le RNG HGSS. */
export function createPokemonInstanceId(source: PokemonInstanceIdByteSource = cryptoByteSource): PokemonInstanceId {
  return `${randomPrefix}${bytesToHex(readRandomBytes(source))}` as PokemonInstanceId
}

/**
 * Produit sans hash un identifiant injectif pour un emplacement d'une ancienne sauvegarde.
 * Le couple espace de campagne/chemin est encodé en UTF-8 hexadécimal canonique.
 */
export function deriveLegacyPokemonInstanceId(
  campaignNamespace: string,
  canonicalPath: string,
): PokemonInstanceId {
  const namespaceBytes = encodeCanonicalComponent(
    campaignNamespace,
    "L'espace de noms de campagne",
    campaignNamespaceMaxByteLength,
  )
  const pathBytes = encodeCanonicalComponent(canonicalPath, 'Le chemin canonique du Pokémon', canonicalPathMaxByteLength)
  return `${legacyPrefix}${bytesToHex(namespaceBytes)}:${bytesToHex(pathBytes)}` as PokemonInstanceId
}

/** Validation stricte des formats aléatoire et migration v1. */
export function isPokemonInstanceId(value: unknown): value is PokemonInstanceId {
  if (typeof value !== 'string' || value.length > pokemonInstanceIdMaxLength) return false
  if (value.startsWith(randomPrefix)) {
    const payload = value.slice(randomPrefix.length)
    return payload.length === randomHexLength && /^[0-9a-f]+$/.test(payload)
  }
  if (!value.startsWith(legacyPrefix)) return false
  const payload = value.slice(legacyPrefix.length)
  const separatorIndex = payload.indexOf(':')
  if (separatorIndex <= 0 || separatorIndex !== payload.lastIndexOf(':')) return false
  const encodedNamespace = payload.slice(0, separatorIndex)
  const encodedPath = payload.slice(separatorIndex + 1)
  return decodeCanonicalComponent(
    encodedNamespace,
    "L'espace de noms de campagne",
    campaignNamespaceMaxByteLength,
  ) !== undefined && decodeCanonicalComponent(
    encodedPath,
    'Le chemin canonique du Pokémon',
    canonicalPathMaxByteLength,
  ) !== undefined
}

/**
 * Frontière persistante portable. Les IDs aléatoires ne contiennent que
 * 128 bits opaques; l'ancien format n'est admis que pour les emplacements
 * machine que le codec HGSS sait lui-même reconstruire.
 */
export function isPortablePokemonInstanceId(value: unknown): value is PokemonInstanceId {
  if (typeof value !== 'string' || value.length > pokemonInstanceIdMaxLength) return false
  if (value.startsWith(randomPrefix)) return isPokemonInstanceId(value)
  if (!value.startsWith(legacyPrefix)) return false
  const payload = value.slice(legacyPrefix.length)
  const separatorIndex = payload.indexOf(':')
  if (separatorIndex <= 0 || separatorIndex !== payload.lastIndexOf(':')) return false
  const namespace = decodeCanonicalComponent(
    payload.slice(0, separatorIndex),
    "L'espace de noms de campagne",
    campaignNamespaceMaxByteLength,
  )
  const path = decodeCanonicalComponent(
    payload.slice(separatorIndex + 1),
    'Le chemin canonique du Pokémon',
    canonicalPathMaxByteLength,
  )
  if (!namespace || !path || !portableLegacyNamespacePattern.test(namespace)) return false
  return namespace.endsWith(':trainer-house')
    ? portableLegacyTrainerHousePathPattern.test(path)
    : portableLegacyFieldPathPattern.test(path)
}

export function parsePortablePokemonInstanceId(value: unknown): PokemonInstanceId {
  if (!isPortablePokemonInstanceId(value)) {
    throw new Error("L'identifiant persistant data-only du Pokémon est invalide.")
  }
  return value
}

export function parsePokemonInstanceId(value: unknown): PokemonInstanceId {
  if (!isPokemonInstanceId(value)) throw new Error("L'identifiant persistant du Pokémon est invalide.")
  return value
}

/** Munja est une nouvelle instance : il ne peut pas conserver l'identifiant de Ningale/Ninjask. */
export function createShedinjaPokemonInstanceId(
  sourceInstanceId: PokemonInstanceId,
  source: PokemonInstanceIdByteSource = cryptoByteSource,
): PokemonInstanceId {
  const validatedSourceId = parsePokemonInstanceId(sourceInstanceId)
  for (let attempt = 0; attempt < shedinjaGenerationAttemptLimit; attempt += 1) {
    const candidate = createPokemonInstanceId(source)
    if (candidate !== validatedSourceId) return candidate
  }
  throw new Error("La source cryptographique n'a pas produit de nouvel identifiant pour Munja.")
}
