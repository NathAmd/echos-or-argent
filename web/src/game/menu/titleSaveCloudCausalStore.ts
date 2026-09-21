import { parseOnlineClientConfig } from '../../online/onlineClientConfig'
import {
  hgssBrowserSaveSlotCount,
  type HgssBrowserSaveSlot,
} from '../save/hgssSaveStorage'
import type { HgssFullSaveCloudStoredSnapshot } from '../save/hgssFullSaveCloudVault'
import type { TitleSaveTombstoneContext } from './titleSaveStorageScope'

type CausalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const causalAnchorPrefix = 'pokemaster:opaque-cloud-anchor:v1'
const storageHashPattern = /^[A-Za-z0-9_-]{43}$/
const etagPattern = /^"r-[a-f0-9]{32}"$/
const mutationPattern = /^m-[a-f0-9]{32}$/

type CloudEtag = HgssFullSaveCloudStoredSnapshot['etag']
type CloudMutation = NonNullable<HgssFullSaveCloudStoredSnapshot['mutation']>

export type TitleSaveCloudCausalLocalState = Readonly<{
  storageHash: string | null
  tombstoneChangedAt: string | null
}>

export type TitleSaveCloudCausalAnchor = Readonly<{
  localState: TitleSaveCloudCausalLocalState
  remoteEtag: CloudEtag
  remoteMutation: CloudMutation
}>

export type TitleSaveCloudCausalStore = Readonly<{
  read: (context: TitleSaveTombstoneContext) => ReadonlyMap<HgssBrowserSaveSlot, TitleSaveCloudCausalAnchor>
  write: (
    context: TitleSaveTombstoneContext,
    slot: HgssBrowserSaveSlot,
    anchor: TitleSaveCloudCausalAnchor,
  ) => void
  clear: (context: TitleSaveTombstoneContext, slot: HgssBrowserSaveSlot) => void
}>

function requireCanonicalTimestamp(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || value.length > 32) {
    throw new Error('Le journal causal cloud est corrompu.')
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error('Le journal causal cloud est corrompu.')
  }
  return value
}

function requireLocalState(value: unknown): TitleSaveCloudCausalLocalState {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).length !== 2
    || !Object.hasOwn(value, 'storageHash')
    || !Object.hasOwn(value, 'tombstoneChangedAt')
  ) throw new Error('Le journal causal cloud est corrompu.')
  const storageHash = (value as { storageHash: unknown }).storageHash
  if (storageHash !== null && (typeof storageHash !== 'string' || !storageHashPattern.test(storageHash))) {
    throw new Error('Le journal causal cloud est corrompu.')
  }
  return Object.freeze({
    storageHash,
    tombstoneChangedAt: requireCanonicalTimestamp(
      (value as { tombstoneChangedAt: unknown }).tombstoneChangedAt,
    ),
  }) as TitleSaveCloudCausalLocalState
}

function decodeAnchor(serialized: string): TitleSaveCloudCausalAnchor {
  let value: unknown
  try {
    value = JSON.parse(serialized) as unknown
  } catch {
    throw new Error('Le journal causal cloud est corrompu.')
  }
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).length !== 4
    || (value as { revision?: unknown }).revision !== 1
  ) throw new Error('Le journal causal cloud est corrompu.')
  const record = value as {
    localState?: unknown
    remoteEtag?: unknown
    remoteMutation?: unknown
  }
  const remoteEtag = typeof record.remoteEtag === 'string' && etagPattern.test(record.remoteEtag)
    ? record.remoteEtag as CloudEtag
    : undefined
  const remoteMutation = typeof record.remoteMutation === 'string' && mutationPattern.test(record.remoteMutation)
    ? record.remoteMutation as CloudMutation
    : undefined
  if (!remoteEtag || !remoteMutation) throw new Error('Le journal causal cloud est corrompu.')
  return Object.freeze({
    localState: requireLocalState(record.localState),
    remoteEtag,
    remoteMutation,
  })
}

function requireSlot(slot: HgssBrowserSaveSlot): HgssBrowserSaveSlot {
  if (!Number.isSafeInteger(slot) || slot < 1 || slot > hgssBrowserSaveSlotCount) {
    throw new TypeError('Le slot du journal causal cloud est invalide.')
  }
  return slot
}

function anchorKey(context: TitleSaveTombstoneContext, slot: HgssBrowserSaveSlot): string {
  const serverUrl = parseOnlineClientConfig(context.serverUrl)?.httpBaseUrl
  if (!serverUrl) throw new TypeError("L'URL du journal causal cloud est invalide.")
  if (!/^[a-z0-9](?:[a-z0-9._-]{2,31})$/.test(context.accountId)) {
    throw new TypeError("L'identité du journal causal cloud est invalide.")
  }
  if (!/^[A-Z0-9]{4}$/.test(context.gameCode)) {
    throw new TypeError('Le code ROM du journal causal cloud est invalide.')
  }
  const { gameVersion, language } = context.romIdentity
  if (
    !Number.isSafeInteger(gameVersion) || gameVersion < 0 || gameVersion > 0xff
    || !Number.isSafeInteger(language) || language < 0 || language > 0xff
  ) throw new TypeError("L'identité ROM du journal causal cloud est invalide.")
  return [
    causalAnchorPrefix,
    encodeURIComponent(serverUrl),
    context.accountId,
    context.gameCode,
    gameVersion,
    language,
    requireSlot(slot),
  ].join(':')
}

/**
 * Mémorise la version serveur dont les octets locaux descendent. `savedAt`
 * n'intervient jamais dans cette preuve : il reste une date de présentation.
 */
export function createTitleSaveCloudCausalStore(storage: CausalStorage): TitleSaveCloudCausalStore {
  return Object.freeze({
    read(context) {
      const anchors = new Map<HgssBrowserSaveSlot, TitleSaveCloudCausalAnchor>()
      for (let value = 1; value <= hgssBrowserSaveSlotCount; value += 1) {
        const slot = value as HgssBrowserSaveSlot
        const serialized = storage.getItem(anchorKey(context, slot))
        if (serialized !== null) anchors.set(slot, decodeAnchor(serialized))
      }
      return anchors
    },
    write(context, slot, anchor) {
      const normalized: TitleSaveCloudCausalAnchor = Object.freeze({
        localState: requireLocalState(anchor.localState),
        remoteEtag: typeof anchor.remoteEtag === 'string' && etagPattern.test(anchor.remoteEtag)
          ? anchor.remoteEtag
          : (() => { throw new TypeError('La révision du journal causal cloud est invalide.') })(),
        remoteMutation: typeof anchor.remoteMutation === 'string' && mutationPattern.test(anchor.remoteMutation)
          ? anchor.remoteMutation
          : (() => { throw new TypeError("L'horloge du journal causal cloud est invalide.") })(),
      })
      storage.setItem(anchorKey(context, slot), JSON.stringify({ revision: 1, ...normalized }))
    },
    clear(context, slot) {
      storage.removeItem(anchorKey(context, slot))
    },
  })
}
