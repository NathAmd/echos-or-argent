import { hgssBrowserSaveSlotCount, type HgssBrowserSaveSlot } from '../save/hgssSaveStorage'

const entitlementStoragePrefix = 'pokemaster.hgss.new-game-plus.entitlement.v1.'
const entitlementStorageFormat = 'pokemaster-hgss-new-game-plus-entitlement'

export type NewGamePlusEntitlement = {
  gameCode: string
  unlockedAt: string
  sourceSlot: HgssBrowserSaveSlot
  announcedAt?: string
}

export type NewGamePlusUnlockEvidence = Pick<NewGamePlusEntitlement, 'gameCode' | 'unlockedAt' | 'sourceSlot'>

type EntitlementStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

type StoredEntitlementEnvelope = {
  format: typeof entitlementStorageFormat
  revision: 1
  checksum: string
  payload: string
}

function requireGameCode(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Z0-9]{4}$/.test(value)) {
    throw new Error('Le code ROM du New Game+ est invalide.')
  }
  return value
}

function requireIsoTimestamp(value: unknown, field: 'unlockedAt' | 'announcedAt'): string {
  if (typeof value !== 'string') throw new Error(`La date ${field} du New Game+ est invalide.`)
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`La date ${field} du New Game+ est invalide.`)
  }
  return value
}

function requireSourceSlot(value: unknown): HgssBrowserSaveSlot {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > hgssBrowserSaveSlotCount) {
    throw new Error(`L’emplacement source ${String(value)} du New Game+ est invalide.`)
  }
  return value as HgssBrowserSaveSlot
}

export function validateNewGamePlusEntitlement(value: unknown): NewGamePlusEntitlement {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Le droit New Game+ enregistré est invalide.')
  }
  const candidate = value as Partial<NewGamePlusEntitlement>
  const gameCode = requireGameCode(candidate.gameCode)
  const unlockedAt = requireIsoTimestamp(candidate.unlockedAt, 'unlockedAt')
  const sourceSlot = requireSourceSlot(candidate.sourceSlot)
  const announcedAt = candidate.announcedAt === undefined
    ? undefined
    : requireIsoTimestamp(candidate.announcedAt, 'announcedAt')
  if (announcedAt && Date.parse(announcedAt) < Date.parse(unlockedAt)) {
    throw new Error('La date d’annonce du New Game+ ne peut pas précéder son déblocage.')
  }
  return { gameCode, unlockedAt, sourceSlot, ...(announcedAt ? { announcedAt } : {}) }
}

function calculateCrc32(value: string): string {
  let crc = 0xffffffff
  for (const byte of new TextEncoder().encode(value)) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0')
}

function encodeEntitlement(value: NewGamePlusEntitlement): string {
  const payload = JSON.stringify(value)
  const envelope: StoredEntitlementEnvelope = {
    format: entitlementStorageFormat,
    revision: 1,
    checksum: calculateCrc32(payload),
    payload,
  }
  return JSON.stringify(envelope)
}

function decodeEntitlement(encoded: string, expectedGameCode: string): NewGamePlusEntitlement {
  let value: unknown
  try {
    value = JSON.parse(encoded)
  } catch {
    throw new Error('Le droit New Game+ enregistré ne contient pas un JSON valide.')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('L’enveloppe du droit New Game+ est invalide.')
  }
  const envelope = value as Partial<StoredEntitlementEnvelope>
  if (envelope.format !== entitlementStorageFormat
    || envelope.revision !== 1
    || typeof envelope.checksum !== 'string'
    || typeof envelope.payload !== 'string') {
    throw new Error('L’enveloppe du droit New Game+ est invalide.')
  }
  if (calculateCrc32(envelope.payload) !== envelope.checksum) {
    throw new Error('Le checksum du droit New Game+ est invalide.')
  }
  let payload: unknown
  try {
    payload = JSON.parse(envelope.payload)
  } catch {
    throw new Error('Le contenu du droit New Game+ ne contient pas un JSON valide.')
  }
  const entitlement = validateNewGamePlusEntitlement(payload)
  if (entitlement.gameCode !== expectedGameCode) {
    throw new Error(`Le droit New Game+ ${entitlement.gameCode} ne correspond pas à la ROM ${expectedGameCode}.`)
  }
  return entitlement
}

export function getNewGamePlusEntitlementStorageKey(gameCode: string): string {
  return `${entitlementStoragePrefix}${requireGameCode(gameCode)}`
}

export function writeNewGamePlusEntitlement(
  storage: EntitlementStorage,
  entitlement: NewGamePlusEntitlement,
): NewGamePlusEntitlement {
  const validated = validateNewGamePlusEntitlement(entitlement)
  const key = getNewGamePlusEntitlementStorageKey(validated.gameCode)
  const encoded = encodeEntitlement(validated)
  storage.setItem(`${key}.staging`, encoded)
  storage.setItem(key, encoded)
  storage.removeItem(`${key}.staging`)
  return validated
}

export function readNewGamePlusEntitlement(
  storage: EntitlementStorage,
  gameCode: string,
): NewGamePlusEntitlement | undefined {
  const key = getNewGamePlusEntitlementStorageKey(gameCode)
  const committed = storage.getItem(key)
  const stagingKey = `${key}.staging`
  const staged = storage.getItem(stagingKey)
  if (staged !== null) {
    try {
      const entitlement = decodeEntitlement(staged, gameCode)
      storage.setItem(key, staged)
      storage.removeItem(stagingKey)
      return entitlement
    } catch (stagedError) {
      storage.removeItem(stagingKey)
      if (committed === null) throw stagedError
    }
  }
  return committed === null ? undefined : decodeEntitlement(committed, gameCode)
}

export function deleteNewGamePlusEntitlement(storage: EntitlementStorage, gameCode: string): void {
  const key = getNewGamePlusEntitlementStorageKey(gameCode)
  storage.removeItem(key)
  storage.removeItem(`${key}.staging`)
}

/**
 * Merges repeatable League-clear evidence without losing an earlier unlock or
 * an already displayed announcement. Equal timestamps use the lowest slot so
 * reconciliation remains deterministic regardless of scan order.
 */
export function reconcileNewGamePlusEntitlement(
  storage: EntitlementStorage,
  evidence: NewGamePlusUnlockEvidence,
): NewGamePlusEntitlement {
  const validatedEvidence = validateNewGamePlusEntitlement(evidence)
  const current = readNewGamePlusEntitlement(storage, validatedEvidence.gameCode)
  if (!current) return writeNewGamePlusEntitlement(storage, validatedEvidence)
  const evidenceTime = Date.parse(validatedEvidence.unlockedAt)
  const currentTime = Date.parse(current.unlockedAt)
  const replacesSource = evidenceTime < currentTime
    || (evidenceTime === currentTime && validatedEvidence.sourceSlot < current.sourceSlot)
  if (!replacesSource) return current
  return writeNewGamePlusEntitlement(storage, {
    ...current,
    unlockedAt: validatedEvidence.unlockedAt,
    sourceSlot: validatedEvidence.sourceSlot,
  })
}

export function markNewGamePlusEntitlementAnnounced(
  storage: EntitlementStorage,
  gameCode: string,
  now: () => Date = () => new Date(),
): NewGamePlusEntitlement {
  const current = readNewGamePlusEntitlement(storage, gameCode)
  if (!current) throw new Error(`Le New Game+ n’est pas débloqué pour la ROM ${gameCode}.`)
  if (current.announcedAt) return current
  return writeNewGamePlusEntitlement(storage, { ...current, announcedAt: now().toISOString() })
}
