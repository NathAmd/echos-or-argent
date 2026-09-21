import {
  parseHgssCampaignSharedProgression,
  type HgssCampaignPendingEvent,
  type HgssCampaignSharedProgression,
} from '../multiplayer/hgssCampaignProtocol'
import {
  hgssSharedCampaignEventPrefix,
  readHgssSharedCampaignProgressionIdentity,
} from '../multiplayer/hgssSharedCampaignProgression'
import type {
  JsonSaveValue,
  VersionedSaveExtensions,
} from './versionedSaveExtensions'

export const hgssSharedCampaignSaveExtensionKey = 'multiplayer.shared-campaign'
export const hgssSharedCampaignSaveExtensionVersion = 1 as const

const extensionFormat = 'pokemaster-hgss-shared-campaign-state'
const branchIdPattern = /^[0-9a-f]{32}$/
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/

export type HgssSharedCampaignPendingAckV1 = Readonly<{
  authoritySessionId: string
  eventId: string
  eventRevision: number
}>

export type HgssSharedCampaignSaveExtensionV1 = Readonly<{
  format: typeof extensionFormat
  campaignBranchId: string
  appliedProgressionRevision: number
  appliedProgression: HgssCampaignSharedProgression
  pendingAcks: readonly HgssSharedCampaignPendingAckV1[]
}>

export type HgssSharedCampaignSaveProgressionOrder =
  | 'different-branch'
  | 'left-ahead'
  | 'right-ahead'
  | 'equivalent'
  | 'divergent'

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== 'string') return false
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor?.enumerable === true && 'value' in descriptor
  })
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isPlainRecord(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key))
}

function isDenseArray(value: unknown, maximum: number): value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > maximum || Object.keys(value).length !== value.length) return false
  const keys = Reflect.ownKeys(value)
  if (keys.length !== value.length + 1 || keys.some((key) => typeof key === 'symbol')) return false
  return value.every((_entry, index) => Object.hasOwn(value, index))
    && keys.every((key) => key === 'length' || /^(0|[1-9]\d*)$/.test(key as string))
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function canonicalProgression(value: unknown): HgssCampaignSharedProgression {
  const parsed = parseHgssCampaignSharedProgression(value)
  if (!parsed) throw new Error('La progression de campagne sauvegardée est invalide.')
  const canonical = Object.freeze({
    milestoneIds: Object.freeze([...parsed.milestoneIds].sort(compareText)),
    counters: Object.freeze([...parsed.counters]
      .sort((left, right) => compareText(left.id, right.id))
      .map((entry) => Object.freeze({ ...entry }))),
  })
  // Cette lecture atteste aussi le schéma, la branche et la révision durable.
  readHgssSharedCampaignProgressionIdentity(canonical)
  return canonical
}

function parsePendingAck(value: unknown): HgssSharedCampaignPendingAckV1 {
  if (!hasExactKeys(value, ['authoritySessionId', 'eventId', 'eventRevision'])
    || typeof value.authoritySessionId !== 'string'
    || value.authoritySessionId.length > 128
    || !identifierPattern.test(value.authoritySessionId)
    || typeof value.eventId !== 'string'
    || value.eventId.length > 128
    || !identifierPattern.test(value.eventId)
    || !value.eventId.startsWith(hgssSharedCampaignEventPrefix)
    || !Number.isSafeInteger(value.eventRevision)
    || (value.eventRevision as number) < 1) {
    throw new Error("Un acquittement de campagne sauvegardé est invalide.")
  }
  return Object.freeze({
    authoritySessionId: value.authoritySessionId,
    eventId: value.eventId,
    eventRevision: value.eventRevision as number,
  })
}

function comparePendingAcks(
  left: HgssSharedCampaignPendingAckV1,
  right: HgssSharedCampaignPendingAckV1,
): number {
  return compareText(left.authoritySessionId, right.authoritySessionId)
    || left.eventRevision - right.eventRevision
    || compareText(left.eventId, right.eventId)
}

export function parseHgssSharedCampaignSaveExtensionV1(
  value: unknown,
): HgssSharedCampaignSaveExtensionV1 {
  if (!hasExactKeys(value, [
    'format',
    'campaignBranchId',
    'appliedProgressionRevision',
    'appliedProgression',
    'pendingAcks',
  ])
    || value.format !== extensionFormat
    || typeof value.campaignBranchId !== 'string'
    || !branchIdPattern.test(value.campaignBranchId)
    || !Number.isSafeInteger(value.appliedProgressionRevision)
    || (value.appliedProgressionRevision as number) < 0
    || !isDenseArray(value.pendingAcks, 128)) {
    throw new Error("L'extension de sauvegarde de campagne partagée est invalide.")
  }

  const appliedProgression = canonicalProgression(value.appliedProgression)
  const identity = readHgssSharedCampaignProgressionIdentity(appliedProgression)
  if (identity.campaignBranchId !== value.campaignBranchId
    || identity.progressionRevision !== value.appliedProgressionRevision) {
    throw new Error("L'identité de la progression sauvegardée est incohérente.")
  }

  const pendingAcks = (value.pendingAcks as unknown[])
    .map(parsePendingAck)
    .sort(comparePendingAcks)
  const receiptIds = new Set(appliedProgression.milestoneIds)
  const seen = new Set<string>()
  for (const receipt of pendingAcks) {
    const key = `${receipt.authoritySessionId}\u0000${receipt.eventId}`
    if (seen.has(key) || !receiptIds.has(receipt.eventId)) {
      throw new Error("Les acquittements sauvegardés sont dupliqués ou sans reçu appliqué.")
    }
    seen.add(key)
  }

  return Object.freeze({
    format: extensionFormat,
    campaignBranchId: value.campaignBranchId,
    appliedProgressionRevision: value.appliedProgressionRevision as number,
    appliedProgression,
    pendingAcks: Object.freeze(pendingAcks),
  })
}

export function createHgssSharedCampaignSaveExtension(
  progression: HgssCampaignSharedProgression,
  authoritySessionId: string,
  pendingEvents: readonly HgssCampaignPendingEvent[],
  localParticipantId: string,
): HgssSharedCampaignSaveExtensionV1 {
  const appliedProgression = canonicalProgression(progression)
  const identity = readHgssSharedCampaignProgressionIdentity(appliedProgression)
  return parseHgssSharedCampaignSaveExtensionV1({
    format: extensionFormat,
    campaignBranchId: identity.campaignBranchId,
    appliedProgressionRevision: identity.progressionRevision,
    appliedProgression,
    pendingAcks: pendingEvents
      .filter(({ pendingPlayerIds }) => pendingPlayerIds.includes(localParticipantId))
      .map(({ eventId, eventRevision }) => ({ authoritySessionId, eventId, eventRevision })),
  })
}

export function readHgssSharedCampaignSaveExtension(
  extensions: VersionedSaveExtensions | undefined,
): HgssSharedCampaignSaveExtensionV1 | undefined {
  const entry = extensions?.[hgssSharedCampaignSaveExtensionKey]
  if (!entry) return undefined
  if (entry.version !== hgssSharedCampaignSaveExtensionVersion) {
    throw new Error("La version de l'extension de campagne partagée est inconnue.")
  }
  return parseHgssSharedCampaignSaveExtensionV1(entry.value)
}

export function replaceHgssSharedCampaignSaveExtension(
  extensions: VersionedSaveExtensions | undefined,
  campaign: HgssSharedCampaignSaveExtensionV1 | undefined,
): VersionedSaveExtensions | undefined {
  const entries = Object.entries(extensions ?? {})
    .filter(([key]) => key !== hgssSharedCampaignSaveExtensionKey)
  if (campaign) entries.push([hgssSharedCampaignSaveExtensionKey, Object.freeze({
    version: hgssSharedCampaignSaveExtensionVersion,
    value: parseHgssSharedCampaignSaveExtensionV1(campaign) as unknown as JsonSaveValue,
  })])
  if (entries.length === 0) return undefined
  return Object.freeze(Object.fromEntries(entries.sort(([left], [right]) => compareText(left, right))))
}

function progressionEquals(
  left: HgssCampaignSharedProgression,
  right: HgssCampaignSharedProgression,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function progressionDominates(
  candidate: HgssCampaignSharedProgression,
  ancestor: HgssCampaignSharedProgression,
): boolean {
  const milestones = new Set(candidate.milestoneIds)
  const counters = new Set(candidate.counters.map(({ id }) => id))
  return ancestor.milestoneIds.every((id) => milestones.has(id))
    && ancestor.counters.every(({ id }) => counters.has(id))
}

export function compareHgssSharedCampaignSaveProgression(
  left: HgssSharedCampaignSaveExtensionV1,
  right: HgssSharedCampaignSaveExtensionV1,
): HgssSharedCampaignSaveProgressionOrder {
  const canonicalLeft = parseHgssSharedCampaignSaveExtensionV1(left)
  const canonicalRight = parseHgssSharedCampaignSaveExtensionV1(right)
  if (canonicalLeft.campaignBranchId !== canonicalRight.campaignBranchId) return 'different-branch'
  if (canonicalLeft.appliedProgressionRevision === canonicalRight.appliedProgressionRevision) {
    return progressionEquals(canonicalLeft.appliedProgression, canonicalRight.appliedProgression)
      ? 'equivalent'
      : 'divergent'
  }
  if (canonicalLeft.appliedProgressionRevision > canonicalRight.appliedProgressionRevision) {
    return progressionDominates(canonicalLeft.appliedProgression, canonicalRight.appliedProgression)
      ? 'left-ahead'
      : 'divergent'
  }
  return progressionDominates(canonicalRight.appliedProgression, canonicalLeft.appliedProgression)
    ? 'right-ahead'
    : 'divergent'
}

export function createHgssSharedCampaignBranchId(): string {
  const randomUUID = globalThis.crypto?.randomUUID?.()
  if (!randomUUID) throw new Error("Le générateur sécurisé d'identité de campagne est indisponible.")
  const branchId = randomUUID.replaceAll('-', '').toLowerCase()
  if (!branchIdPattern.test(branchId)) throw new Error("L'identité de campagne générée est invalide.")
  return branchId
}
