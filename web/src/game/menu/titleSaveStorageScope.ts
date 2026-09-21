import { parseOnlineClientConfig } from '../../online/onlineClientConfig'
import {
  hgssBrowserSaveSlotCount,
  type HgssBrowserSaveSlot,
  type HgssBrowserSaveSlotDeletionToken,
} from '../save/hgssSaveStorage'

type TitleSaveStoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export type TitleSaveStorageScope =
  | Readonly<{ kind: 'local' }>
  | Readonly<{ kind: 'online', serverUrl: string, accountId: string }>

export type SwitchableTitleSaveStorage = TitleSaveStoragePort & Readonly<{
  selectLocal: () => void
  selectOnline: (serverUrl: string, accountId: string) => void
  getScope: () => TitleSaveStorageScope
}>

export type TitleSaveTombstoneRomIdentity = Readonly<{
  gameVersion: number
  language: number
}>

export type TitleSaveTombstoneContext = Readonly<{
  serverUrl: string
  accountId: string
  gameCode: string
  romIdentity: TitleSaveTombstoneRomIdentity
}>

export type TitleSaveLocalTombstone = Readonly<{
  changedAt: string
  /** Empreinte causale compacte des octets que cette suppression remplace. */
  supersededStorageHashes?: readonly string[]
}>

export type TitleSaveTombstoneStore = Readonly<{
  read: (
    context: TitleSaveTombstoneContext,
  ) => ReadonlyMap<HgssBrowserSaveSlot, TitleSaveLocalTombstone>
  write: (
    context: TitleSaveTombstoneContext,
    slot: HgssBrowserSaveSlot,
    changedAt?: string,
    supersededStorageHashes?: readonly string[],
  ) => TitleSaveLocalTombstone
  clear: (context: TitleSaveTombstoneContext, slot: HgssBrowserSaveSlot) => void
}>

const onlineCachePrefix = 'pokemaster:campaign-cache:v1:'
const tombstonePrefix = 'pokemaster:campaign-tombstone:v1'
const storageHashPattern = /^[A-Za-z0-9_-]{43}$/

function encodeBase64Url(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (value) => String.fromCharCode(value)).join('')
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

const sha256RoundConstants = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

function rotateRight(value: number, bits: number): number {
  return value >>> bits | value << 32 - bits
}

/** SHA-256 pur JS pour les WebView console sans WebCrypto. */
function sha256Fallback(message: Uint8Array): Uint8Array {
  const paddedLength = Math.ceil((message.length + 9) / 64) * 64
  const padded = new Uint8Array(paddedLength)
  padded.set(message)
  padded[message.length] = 0x80
  const view = new DataView(padded.buffer)
  const bitLength = message.length * 8
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false)
  view.setUint32(paddedLength - 4, bitLength >>> 0, false)
  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const words = new Uint32Array(64)
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4, false)
    for (let index = 16; index < 64; index += 1) {
      const previous = words[index - 15]!
      const earlier = words[index - 2]!
      const sigma0 = rotateRight(previous, 7) ^ rotateRight(previous, 18) ^ previous >>> 3
      const sigma1 = rotateRight(earlier, 17) ^ rotateRight(earlier, 19) ^ earlier >>> 10
      words[index] = (words[index - 16]! + sigma0 + words[index - 7]! + sigma1) >>> 0
    }
    let [a, b, c, d, e, f, g, h] = state
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e!, 6) ^ rotateRight(e!, 11) ^ rotateRight(e!, 25)
      const choice = e! & f! ^ ~e! & g!
      const temporary1 = (h! + sum1 + choice + sha256RoundConstants[index]! + words[index]!) >>> 0
      const sum0 = rotateRight(a!, 2) ^ rotateRight(a!, 13) ^ rotateRight(a!, 22)
      const majority = a! & b! ^ a! & c! ^ b! & c!
      const temporary2 = (sum0 + majority) >>> 0
      h = g
      g = f
      f = e
      e = (d! + temporary1) >>> 0
      d = c
      c = b
      b = a
      a = (temporary1 + temporary2) >>> 0
    }
    state[0] = (state[0]! + a!) >>> 0
    state[1] = (state[1]! + b!) >>> 0
    state[2] = (state[2]! + c!) >>> 0
    state[3] = (state[3]! + d!) >>> 0
    state[4] = (state[4]! + e!) >>> 0
    state[5] = (state[5]! + f!) >>> 0
    state[6] = (state[6]! + g!) >>> 0
    state[7] = (state[7]! + h!) >>> 0
  }
  const output = new Uint8Array(32)
  const outputView = new DataView(output.buffer)
  state.forEach((value, index) => { outputView.setUint32(index * 4, value, false) })
  padded.fill(0)
  words.fill(0)
  state.fill(0)
  return output
}

export async function fingerprintTitleSaveStorageToken(
  token: HgssBrowserSaveSlotDeletionToken,
  options: Readonly<{ crypto?: Crypto | null }> = {},
): Promise<string> {
  const cryptoApi = Object.hasOwn(options, 'crypto') ? options.crypto : globalThis.crypto
  const bytes = new TextEncoder().encode(token)
  try {
    const digest = cryptoApi?.subtle
      ? new Uint8Array(await cryptoApi.subtle.digest('SHA-256', bytes))
      : sha256Fallback(bytes)
    return encodeBase64Url(digest)
  } finally {
    bytes.fill(0)
  }
}

function requireAccountId(value: string): string {
  if (!/^[a-z0-9](?:[a-z0-9._-]{2,31})$/.test(value)) {
    throw new TypeError("L’identité du cache de sauvegarde est invalide.")
  }
  return value
}

function requireGameCode(value: string): string {
  if (!/^[A-Z0-9]{4}$/.test(value)) throw new TypeError('Le code ROM du cache de sauvegarde est invalide.')
  return value
}

function requireByte(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xff) {
    throw new TypeError(`${label} du journal de suppression est invalide.`)
  }
  return value
}

function requireSlot(value: HgssBrowserSaveSlot): HgssBrowserSaveSlot {
  if (!Number.isSafeInteger(value) || value < 1 || value > hgssBrowserSaveSlotCount) {
    throw new TypeError('Le slot du journal de suppression est invalide.')
  }
  return value
}

function requireTimestamp(value: string): string {
  const parsed = new Date(value)
  if (value.length > 32 || Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError("L’horodatage du journal de suppression est invalide.")
  }
  return value
}

function requireStorageHash(value: string): string {
  if (!storageHashPattern.test(value)) {
    throw new TypeError("L’empreinte causale du journal de suppression est invalide.")
  }
  return value
}

function requireStorageHashes(values: readonly string[]): readonly string[] {
  if (values.length > 2) {
    throw new TypeError("Les empreintes causales du journal de suppression sont invalides.")
  }
  const canonical = [...new Set(values.map(requireStorageHash))]
  if (canonical.length !== values.length) {
    throw new TypeError("Les empreintes causales du journal de suppression sont dupliquées.")
  }
  return Object.freeze(canonical)
}

function onlinePrefix(serverUrl: string, accountId: string): string {
  const config = parseOnlineClientConfig(serverUrl)
  if (!config) throw new TypeError("L’URL du cache de sauvegarde est requise.")
  return `${onlineCachePrefix}${encodeURIComponent(config.httpBaseUrl)}:${requireAccountId(accountId)}:`
}

function tombstoneKey(
  context: TitleSaveTombstoneContext,
  slot: HgssBrowserSaveSlot,
): string {
  const config = parseOnlineClientConfig(context.serverUrl)
  if (!config) throw new TypeError("L’URL du journal de suppression est requise.")
  const gameCode = requireGameCode(context.gameCode)
  const owner = requireAccountId(context.accountId)
  const version = requireByte(context.romIdentity.gameVersion, 'La version ROM')
  const language = requireByte(context.romIdentity.language, 'La langue ROM')
  return [
    tombstonePrefix,
    encodeURIComponent(config.httpBaseUrl),
    owner,
    gameCode,
    version,
    language,
    requireSlot(slot),
  ].join(':')
}

function decodeTombstone(value: string): TitleSaveLocalTombstone {
  let decoded: unknown
  try {
    decoded = JSON.parse(value)
  } catch {
    throw new Error('Le journal local de suppression cloud est corrompu.')
  }
  if (
    !decoded
    || typeof decoded !== 'object'
    || Array.isArray(decoded)
    || Object.getPrototypeOf(decoded) !== Object.prototype
    || Object.keys(decoded).length < 1
    || Object.keys(decoded).length > 2
    || !Object.hasOwn(decoded, 'changedAt')
    || Object.keys(decoded).some((key) => key !== 'changedAt' && key !== 'supersededStorageHashes')
    || typeof (decoded as { changedAt?: unknown }).changedAt !== 'string'
    || Object.hasOwn(decoded, 'supersededStorageHashes')
      && !Array.isArray((decoded as { supersededStorageHashes?: unknown }).supersededStorageHashes)
  ) throw new Error('Le journal local de suppression cloud est corrompu.')
  const supersededStorageHashes = (decoded as { supersededStorageHashes?: string[] }).supersededStorageHashes
  return Object.freeze({
    changedAt: requireTimestamp((decoded as { changedAt: string }).changedAt),
    ...(supersededStorageHashes === undefined
      ? {}
      : { supersededStorageHashes: requireStorageHashes(supersededStorageHashes) }),
  })
}

/**
 * Journal indépendant du cache de campagne. Une suppression reste donc connue
 * après un rechargement ou un échec réseau, jusqu'à ce qu'une nouvelle
 * sauvegarde du même compte, de la même ROM et du même slot la remplace.
 */
export function createTitleSaveTombstoneStore(
  storage: TitleSaveStoragePort,
  options: Readonly<{ now?: () => Date }> = {},
): TitleSaveTombstoneStore {
  const now = options.now ?? (() => new Date())
  return Object.freeze({
    read(context) {
      const tombstones = new Map<HgssBrowserSaveSlot, TitleSaveLocalTombstone>()
      for (let value = 1; value <= hgssBrowserSaveSlotCount; value += 1) {
        const slot = value as HgssBrowserSaveSlot
        const serialized = storage.getItem(tombstoneKey(context, slot))
        if (serialized !== null) tombstones.set(slot, decodeTombstone(serialized))
      }
      return tombstones
    },
    write(context, slot, changedAt = now().toISOString(), supersededStorageHashes) {
      const tombstone = Object.freeze({
        changedAt: requireTimestamp(changedAt),
        ...(supersededStorageHashes === undefined
          ? {}
          : { supersededStorageHashes: requireStorageHashes(supersededStorageHashes) }),
      })
      storage.setItem(tombstoneKey(context, slot), JSON.stringify(tombstone))
      return tombstone
    },
    clear(context, slot) {
      storage.removeItem(tombstoneKey(context, slot))
    },
  })
}

/**
 * Façade synchrone stable injectée aux coordinateurs historiques. Changer de
 * compte ne change pas leur référence Storage : seules les clés physiques sont
 * redirigées vers le cache local privé du compte actif.
 */
export function createSwitchableTitleSaveStorage(
  storage: TitleSaveStoragePort,
): SwitchableTitleSaveStorage {
  let scope: TitleSaveStorageScope = Object.freeze({ kind: 'local' })
  let prefix = ''

  const physicalKey = (key: string): string => `${prefix}${key}`

  return Object.freeze({
    getItem: (key) => storage.getItem(physicalKey(key)),
    setItem: (key, value) => { storage.setItem(physicalKey(key), value) },
    removeItem: (key) => { storage.removeItem(physicalKey(key)) },
    selectLocal() {
      scope = Object.freeze({ kind: 'local' })
      prefix = ''
    },
    selectOnline(serverUrl, accountId) {
      const canonical = parseOnlineClientConfig(serverUrl)?.httpBaseUrl
      if (!canonical) throw new TypeError("L’URL du cache de sauvegarde est requise.")
      const owner = requireAccountId(accountId)
      prefix = onlinePrefix(canonical, owner)
      scope = Object.freeze({ kind: 'online', serverUrl: canonical, accountId: owner })
    },
    getScope: () => scope,
  })
}
