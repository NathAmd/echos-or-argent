import {
  parseHgssSaveStateV1,
  type HgssSaveStateV1,
} from './hgssSaveState'
import {
  isJsonSaveValue,
  type JsonSaveValue,
} from './versionedSaveExtensions'

// Marge réservée à l’enveloppe portable (format/version/entrée) placée autour
// de la save avant le coffre opaque. On n’importe pas online dans le domaine jeu.
const maxSerializedSaveBytes = 1024 * 1024 - 4 * 1024
const maxSaveNodes = 65_536 - 16
const maxSaveDepth = 60

declare const hgssDataOnlySaveDocumentBrand: unique symbol

/**
 * Copie canonique, JSON stricte et profondément gelée d’une sauvegarde HGSS.
 * La marque TypeScript seule ne vaut jamais preuve : `owns` vérifie aussi la
 * provenance d’exécution conservée hors du document.
 */
export type HgssDataOnlySaveDocument = HgssSaveStateV1 & {
  readonly [hgssDataOnlySaveDocumentBrand]: true
}

export type HgssRomBoundaryCanary =
  | Readonly<{ kind: 'text', label: string, value: string }>
  | Readonly<{ kind: 'number', label: string, value: number }>
  | Readonly<{ kind: 'object', label: string, value: object }>

export type HgssDataOnlySaveAttestationOptions = Readonly<{
  /**
   * Sentinelles injectées dans les objets résolus depuis la ROM par un test.
   * Elles renforcent la preuve de non-régression mais ne remplacent pas le
   * parseur exact ni une analyse juridique du format.
   */
  romCanaries?: readonly HgssRomBoundaryCanary[]
}>

export type HgssDataOnlySaveAuthority = Readonly<{
  /**
   * Projette puis canonise une sauvegarde locale déjà au format courant.
   * Une save legacy contenant romGameCode ou des textes résolus doit d’abord
   * être restaurée avec les catalogues ROM locaux, puis recréée via
   * createHgssSaveState. Cette autorité n’a volontairement aucun catalogue.
   */
  project: (
    value: HgssSaveStateV1,
    options?: HgssDataOnlySaveAttestationOptions,
  ) => HgssDataOnlySaveDocument
  /** Revalide et rebrand une copie relue depuis JSON, IndexedDB ou le cloud. */
  decode: (
    value: unknown,
    options?: HgssDataOnlySaveAttestationOptions,
  ) => HgssDataOnlySaveDocument
  /** N’accepte que les documents produits par cette instance d’autorité. */
  owns: (value: unknown) => value is HgssDataOnlySaveDocument
}>

type SourceInspection = {
  nodes: number
  approximateCharacters: number
  readonly ancestors: Set<object>
  readonly objectCanaries: ReadonlyMap<object, string>
}

function requireCanaries(options: HgssDataOnlySaveAttestationOptions): readonly HgssRomBoundaryCanary[] {
  const canaries = options.romCanaries ?? []
  const labels = new Set<string>()
  for (const canary of canaries) {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(canary.label) || labels.has(canary.label)) {
      throw new Error('Une sentinelle ROM possède un label invalide ou dupliqué.')
    }
    labels.add(canary.label)
    if (canary.kind === 'text' && canary.value.length === 0) {
      throw new Error(`La sentinelle ROM ${canary.label} ne peut pas être vide.`)
    }
    if (canary.kind === 'number' && !Number.isFinite(canary.value)) {
      throw new Error(`La sentinelle ROM ${canary.label} doit être un nombre fini.`)
    }
    if (canary.kind === 'object' && (!canary.value || typeof canary.value !== 'object')) {
      throw new Error(`La sentinelle ROM ${canary.label} doit être un objet.`)
    }
  }
  return canaries
}

function inspectProjectionSource(
  value: unknown,
  path: string,
  inspection: SourceInspection,
  allowUndefined: boolean,
  depth: number,
): void {
  inspection.nodes += 1
  if (inspection.nodes > maxSaveNodes) throw new Error('La sauvegarde HGSS dépasse la limite de complexité data-only.')
  if (depth > maxSaveDepth) throw new Error('La sauvegarde HGSS dépasse la profondeur data-only autorisée.')
  if (value === undefined) {
    if (allowUndefined) return
    throw new Error(`La sauvegarde HGSS contient undefined à ${path}.`)
  }
  if (value === null || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`La sauvegarde HGSS contient un nombre non fini à ${path}.`)
    return
  }
  if (typeof value === 'string') {
    inspection.approximateCharacters += value.length
    if (inspection.approximateCharacters > maxSerializedSaveBytes) {
      throw new Error('La sauvegarde HGSS dépasse la taille data-only autorisée.')
    }
    return
  }
  if (!value || typeof value !== 'object') {
    throw new Error(`La sauvegarde HGSS contient une valeur non JSON à ${path}.`)
  }

  const objectCanary = inspection.objectCanaries.get(value)
  if (objectCanary) throw new Error(`Objet ROM ${objectCanary} détecté à ${path}.`)
  if (inspection.ancestors.has(value)) throw new Error(`La sauvegarde HGSS contient un cycle à ${path}.`)
  inspection.ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || Object.keys(value).length !== value.length) {
        throw new Error(`La sauvegarde HGSS contient un tableau non canonique à ${path}.`)
      }
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) throw new Error(`La sauvegarde HGSS contient un tableau creux à ${path}.`)
        inspectProjectionSource(value[index], `${path}[${index}]`, inspection, false, depth + 1)
      }
      return
    }

    const prototype: unknown = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`La sauvegarde HGSS contient un objet non JSON à ${path}.`)
    }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') throw new Error(`La sauvegarde HGSS contient une clé symbolique à ${path}.`)
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        throw new Error(`La sauvegarde HGSS contient un champ non canonique à ${path}.${key}.`)
      }
      inspection.approximateCharacters += key.length
      inspectProjectionSource(descriptor.value, `${path}.${key}`, inspection, true, depth + 1)
    }
  } finally {
    inspection.ancestors.delete(value)
  }
}

function serializeProjectionSource(
  value: unknown,
  canaries: readonly HgssRomBoundaryCanary[],
): JsonSaveValue {
  const objectCanaries = new Map<object, string>()
  for (const canary of canaries) {
    if (canary.kind === 'object') objectCanaries.set(canary.value, canary.label)
  }
  inspectProjectionSource(value, '$', {
    nodes: 0,
    approximateCharacters: 0,
    ancestors: new Set<object>(),
    objectCanaries,
  }, false, 0)

  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch {
    throw new Error('La sauvegarde HGSS ne peut pas être sérialisée en JSON data-only.')
  }
  if (new TextEncoder().encode(serialized).byteLength > maxSerializedSaveBytes) {
    throw new Error('La sauvegarde HGSS sérialisée dépasse la taille data-only autorisée.')
  }
  const parsed: unknown = JSON.parse(serialized)
  if (!isJsonSaveValue(parsed)) throw new Error('La sauvegarde HGSS sérialisée n’est pas du JSON strict.')
  return parsed
}

function findPrimitiveCanary(
  value: JsonSaveValue,
  canaries: readonly HgssRomBoundaryCanary[],
  path = '$',
): Readonly<{ label: string, path: string }> | undefined {
  for (const canary of canaries) {
    if (canary.kind === 'text' && typeof value === 'string' && value.includes(canary.value)) {
      return { label: canary.label, path }
    }
    if (canary.kind === 'number' && typeof value === 'number' && Object.is(value, canary.value)) {
      return { label: canary.label, path }
    }
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findPrimitiveCanary(value[index]!, canaries, `${path}[${index}]`)
      if (found) return found
    }
    return undefined
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      const found = findPrimitiveCanary(entry, canaries, `${path}.${key}`)
      if (found) return found
    }
  }
  return undefined
}

function requireNoKnownResolvedRomFields(value: JsonSaveValue, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => requireNoKnownResolvedRomFields(entry, `${path}[${index}]`))
    return
  }
  if (!value || typeof value !== 'object') return

  for (const [key, entry] of Object.entries(value)) {
    const resolvedRomField = /^(?:resolved.*(?:rom|presentation|text|object|asset|bytes|data)|rom.*(?:presentation|text|object|asset|bytes|data))$/i.test(key)
    if (key === 'speciesName' || key === 'romGameCode' || resolvedRomField) {
      throw new Error(`Champ ROM résolu interdit à ${path}.${key}.`)
    }
    if (key === 'moves' && Array.isArray(entry)) {
      entry.forEach((move, index) => {
        if (move && typeof move === 'object' && !Array.isArray(move) && Object.hasOwn(move, 'data')) {
          throw new Error(`Données de capacité ROM interdites à ${path}.moves[${index}].data.`)
        }
      })
    }
    if (path === '$.field' && key === 'buffers' && (!Array.isArray(entry) || entry.length !== 0)) {
      throw new Error('Les buffers de texte ROM transitoires sont interdits dans la sauvegarde data-only.')
    }
    if (path === '$.field' && (key === 'objects' || key === 'mapProps') && (!Array.isArray(entry) || entry.length !== 0)) {
      throw new Error(`Les objets transitoires field.${key} sont interdits dans la sauvegarde data-only.`)
    }
    requireNoKnownResolvedRomFields(entry, `${path}.${key}`)
  }
}

function deepFreezeJson(value: JsonSaveValue): JsonSaveValue {
  if (Array.isArray(value)) {
    value.forEach(deepFreezeJson)
    return Object.freeze(value)
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreezeJson)
    return Object.freeze(value)
  }
  return value
}

function jsonValuesEqual(left: JsonSaveValue, right: JsonSaveValue): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((entry, index) => jsonValuesEqual(entry, right[index]!))
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  const leftRecord = left as Readonly<Record<string, JsonSaveValue>>
  const rightRecord = right as Readonly<Record<string, JsonSaveValue>>
  const leftKeys = Object.keys(leftRecord).sort()
  const rightKeys = Object.keys(rightRecord).sort()
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => (
      key === rightKeys[index]
      && jsonValuesEqual(leftRecord[key]!, rightRecord[key]!)
    ))
}

function canonicalizeDataOnlySave(
  value: unknown,
  options: HgssDataOnlySaveAttestationOptions,
  requireCanonicalInput: boolean,
): HgssSaveStateV1 {
  const canaries = requireCanaries(options)
  const projectedSource = serializeProjectionSource(value, canaries)
  const sourceCanary = findPrimitiveCanary(projectedSource, canaries)
  if (sourceCanary) {
    throw new Error(`Sentinelle ROM ${sourceCanary.label} détectée à ${sourceCanary.path}.`)
  }
  const canonical = parseHgssSaveStateV1(projectedSource)
  const canonicalJson = serializeProjectionSource(canonical, canaries)
  const reparsed = parseHgssSaveStateV1(canonicalJson)
  const stableJson = serializeProjectionSource(reparsed, canaries)
  if (JSON.stringify(stableJson) !== JSON.stringify(canonicalJson)) {
    throw new Error('Le parseur HGSS data-only ne produit pas une projection canonique stable.')
  }
  if (requireCanonicalInput && !jsonValuesEqual(projectedSource, stableJson)) {
    throw new Error('La sauvegarde HGSS relue contient des champs inconnus ou une représentation non canonique.')
  }

  requireNoKnownResolvedRomFields(stableJson)
  const leakedCanary = findPrimitiveCanary(stableJson, canaries)
  if (leakedCanary) {
    throw new Error(`Sentinelle ROM ${leakedCanary.label} détectée à ${leakedCanary.path}.`)
  }
  return deepFreezeJson(stableJson) as HgssSaveStateV1
}

export function createHgssDataOnlySaveAuthority(): HgssDataOnlySaveAuthority {
  const proofs = new WeakSet<object>()
  const attest = (
    value: unknown,
    options: HgssDataOnlySaveAttestationOptions = {},
    requireCanonicalInput = false,
  ): HgssDataOnlySaveDocument => {
    const document = canonicalizeDataOnlySave(value, options, requireCanonicalInput) as HgssDataOnlySaveDocument
    proofs.add(document)
    return document
  }

  return Object.freeze({
    project: (value, options) => attest(value, options, false),
    decode: (value, options) => attest(value, options, true),
    owns: (value: unknown): value is HgssDataOnlySaveDocument => (
      !!value && typeof value === 'object' && proofs.has(value)
    ),
  })
}

export const hgssDataOnlySaveAuthority = createHgssDataOnlySaveAuthority()
