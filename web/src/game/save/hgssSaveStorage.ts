const saveStoragePrefix = 'pokemaster.hgss.save.v1.'
const storageFormat = 'pokemaster-hgss-save'
const slotStorageFormat = 'pokemaster-hgss-save-slot'
const legacyMigrationClaimFormat = 'pokemaster-hgss-legacy-migration'

export const hgssBrowserSaveSlotCount = 3
export type HgssBrowserSaveSlot = 1 | 2 | 3
export type HgssBrowserSaveKind = 'manual' | 'auto'

export type HgssBrowserSaveSlotRecord = {
  slot: HgssBrowserSaveSlot
  savedAt: string
  kind: HgssBrowserSaveKind
  value: unknown
}

export type HgssBrowserSaveSlotDeletionToken = string & { readonly __hgssBrowserSaveSlotDeletionToken: unique symbol }

export type HgssBrowserSaveSlotInspection =
  | Readonly<{ kind: 'empty', slot: HgssBrowserSaveSlot }>
  | Readonly<{
      kind: 'readable'
      slot: HgssBrowserSaveSlot
      record: HgssBrowserSaveSlotRecord
      storageSource: 'slot' | 'legacy'
      storageMigrationRequired: boolean
      deletionToken: HgssBrowserSaveSlotDeletionToken
    }>
  | Readonly<{ kind: 'corrupt', slot: HgssBrowserSaveSlot, reason: string, deletionToken: HgssBrowserSaveSlotDeletionToken }>

export type HgssBrowserSaveSlotMigrationResult =
  | Readonly<{ kind: 'migrated', record: HgssBrowserSaveSlotRecord }>
  | Readonly<{ kind: 'changed' }>

type SaveStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

type StoredSaveEnvelope = {
  format: typeof storageFormat
  revision: 1
  checksum: string
  payload: string
}

type StoredSaveSlotPayload = {
  format: typeof slotStorageFormat
  revision: 1
  slot: HgssBrowserSaveSlot
  savedAt: string
  kind: HgssBrowserSaveKind
  value: unknown
  /** Identifiant interne permettant de terminer une migration après un crash. */
  legacyMigrationClaimId?: string
}

type LegacyMigrationClaim = Readonly<{
  format: typeof legacyMigrationClaimFormat
  revision: 1
  phase: 'prepared' | 'purging'
  sourceToken: HgssBrowserSaveSlotDeletionToken
  destinationClaimId: string
}>

export function getHgssSaveStorageKey(gameCode: string): string {
  return `${saveStoragePrefix}${gameCode}`
}

export function getHgssSaveSlotStorageKey(gameCode: string, slot: HgssBrowserSaveSlot): string {
  requireSaveSlot(slot)
  return `${getHgssSaveStorageKey(gameCode)}.slot.${slot}`
}

function getLegacyMigrationClaimKey(gameCode: string): string {
  return `${getHgssSaveStorageKey(gameCode)}.migration.slot.1`
}

function requireSaveSlot(slot: number): asserts slot is HgssBrowserSaveSlot {
  if (!Number.isInteger(slot) || slot < 1 || slot > hgssBrowserSaveSlotCount) {
    throw new Error(`L’emplacement de sauvegarde ${slot} est invalide.`)
  }
}

function requireHgssGameCode(gameCode: string): void {
  if (!/^[A-Z0-9]{4}$/.test(gameCode)) throw new Error(`Le code ROM HGSS ${String(gameCode)} est invalide.`)
}

function calculateCrc32(value: string): string {
  let crc = 0xffffffff
  for (const byte of new TextEncoder().encode(value)) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0')
}

function encodeSave(value: unknown): string {
  const payload = JSON.stringify(value)
  const envelope: StoredSaveEnvelope = {
    format: storageFormat,
    revision: 1,
    checksum: calculateCrc32(payload),
    payload,
  }
  return JSON.stringify(envelope)
}

function decodeSave(encoded: string): { value: unknown, legacy: boolean } {
  let parsed: unknown
  try {
    parsed = JSON.parse(encoded)
  } catch {
    throw new Error('La sauvegarde navigateur ne contient pas un JSON valide.')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !('format' in parsed)) return { value: parsed, legacy: true }
  const envelope = parsed as Partial<StoredSaveEnvelope>
  if (envelope.format !== storageFormat || envelope.revision !== 1 || typeof envelope.payload !== 'string' || typeof envelope.checksum !== 'string') {
    throw new Error('L’enveloppe de sauvegarde navigateur est invalide.')
  }
  if (calculateCrc32(envelope.payload) !== envelope.checksum) throw new Error('Le checksum de la sauvegarde navigateur est invalide.')
  try {
    return { value: JSON.parse(envelope.payload), legacy: false }
  } catch {
    throw new Error('Le contenu de la sauvegarde navigateur ne contient pas un JSON valide.')
  }
}

export function writeHgssBrowserSave(storage: SaveStorage, gameCode: string, value: unknown): void {
  const key = getHgssSaveStorageKey(gameCode)
  const encoded = encodeSave(value)
  storage.setItem(`${key}.staging`, encoded)
  storage.setItem(key, encoded)
  storage.removeItem(`${key}.staging`)
}

export function readHgssBrowserSave(storage: SaveStorage, gameCode: string): unknown | undefined {
  const key = getHgssSaveStorageKey(gameCode)
  const committed = storage.getItem(key)
  const stagingKey = `${key}.staging`
  const staged = storage.getItem(stagingKey)
  if (staged !== null) {
    try {
      return decodeSave(staged).value
    } catch (stagedError) {
      if (committed === null) throw stagedError
      return decodeSave(committed).value
    }
  }
  if (committed !== null) {
    return decodeSave(committed).value
  }
  return undefined
}

export function deleteHgssBrowserSave(storage: SaveStorage, gameCode: string): void {
  const key = getHgssSaveStorageKey(gameCode)
  storage.removeItem(key)
  storage.removeItem(`${key}.staging`)
}

function isStoredSaveSlotPayload(value: unknown, expectedSlot: HgssBrowserSaveSlot): value is StoredSaveSlotPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const payload = value as Partial<StoredSaveSlotPayload>
  return payload.format === slotStorageFormat
    && payload.revision === 1
    && payload.slot === expectedSlot
    && typeof payload.savedAt === 'string'
    && !Number.isNaN(Date.parse(payload.savedAt))
    && new Date(payload.savedAt).toISOString() === payload.savedAt
    && (payload.kind === 'manual' || payload.kind === 'auto')
    && 'value' in payload
}

function writeEncodedAtKey(storage: SaveStorage, key: string, value: unknown): void {
  const encoded = encodeSave(value)
  storage.setItem(`${key}.staging`, encoded)
  storage.setItem(key, encoded)
  storage.removeItem(`${key}.staging`)
}

function readEncodedAtKey(storage: SaveStorage, key: string): unknown | undefined {
  const committed = storage.getItem(key)
  const stagingKey = `${key}.staging`
  const staged = storage.getItem(stagingKey)
  if (staged !== null) {
    try {
      return decodeSave(staged).value
    } catch (stagedError) {
      if (committed === null) throw stagedError
      return decodeSave(committed).value
    }
  }
  if (committed === null) return undefined
  return decodeSave(committed).value
}

export function writeHgssBrowserSaveSlot(
  storage: SaveStorage,
  gameCode: string,
  slot: HgssBrowserSaveSlot,
  value: unknown,
  kind: HgssBrowserSaveKind = 'manual',
  now: () => Date = () => new Date(),
): HgssBrowserSaveSlotRecord {
  requireSaveSlot(slot)
  const payload: StoredSaveSlotPayload = {
    format: slotStorageFormat,
    revision: 1,
    slot,
    savedAt: now().toISOString(),
    kind,
    value,
  }
  writeEncodedAtKey(storage, getHgssSaveSlotStorageKey(gameCode, slot), payload)
  return { slot, savedAt: payload.savedAt, kind, value }
}

/**
 * Creates a new campaign without ever replacing an existing slot.
 *
 * The read-only inspection keeps interrupted writes and the former single-save
 * key visibly occupied, so neither can be mistaken for an empty destination.
 */
export function createHgssBrowserSaveSlotIfEmpty(
  storage: SaveStorage,
  gameCode: string,
  slot: HgssBrowserSaveSlot,
  value: unknown,
  kind: HgssBrowserSaveKind = 'manual',
  now: () => Date = () => new Date(),
): HgssBrowserSaveSlotRecord {
  requireSaveSlot(slot)
  if (inspectHgssBrowserSaveSlot(storage, gameCode, slot, now).kind !== 'empty') {
    throw new Error(`L’emplacement de sauvegarde ${slot} est déjà occupé.`)
  }
  return writeHgssBrowserSaveSlot(storage, gameCode, slot, value, kind, now)
}

export function readHgssBrowserSaveSlot(
  storage: SaveStorage,
  gameCode: string,
  slot: HgssBrowserSaveSlot,
  now: () => Date = () => new Date(),
): HgssBrowserSaveSlotRecord | undefined {
  requireSaveSlot(slot)
  const key = getHgssSaveSlotStorageKey(gameCode, slot)
  const value = readEncodedAtKey(storage, key)
  if (value !== undefined) {
    if (!isStoredSaveSlotPayload(value, slot)) throw new Error(`L’emplacement de sauvegarde ${slot} est invalide.`)
    return { slot, savedAt: value.savedAt, kind: value.kind, value: value.value }
  }
  // The former single-save key belongs logically to slot 1, but reading it is
  // deliberately side-effect free. Its payload may still contain projections
  // legacy resolved from the ROM; only the data-only migration boundary may
  // create the physical slot and remove this source.
  if (slot !== 1) return undefined
  const legacy = readHgssBrowserSave(storage, gameCode)
  if (legacy === undefined) return undefined
  return { slot, savedAt: now().toISOString(), kind: 'manual', value: legacy }
}

type RawSaveSlotSnapshot = Readonly<{
  source: 'slot' | 'legacy'
  committed: string | null
  staged: string | null
}>

function readLegacyMigrationClaim(storage: SaveStorage, gameCode: string): LegacyMigrationClaim | undefined {
  const encoded = storage.getItem(getLegacyMigrationClaimKey(gameCode))
  if (encoded === null) return undefined
  let parsed: unknown
  try { parsed = JSON.parse(encoded) } catch { return undefined }
  if (
    !parsed
    || typeof parsed !== 'object'
    || Array.isArray(parsed)
    || (parsed as { format?: unknown }).format !== legacyMigrationClaimFormat
    || (parsed as { revision?: unknown }).revision !== 1
    || ((parsed as { phase?: unknown }).phase !== 'prepared' && (parsed as { phase?: unknown }).phase !== 'purging')
    || typeof (parsed as { sourceToken?: unknown }).sourceToken !== 'string'
    || typeof (parsed as { destinationClaimId?: unknown }).destinationClaimId !== 'string'
  ) return undefined
  return parsed as LegacyMigrationClaim
}

function encodedSlotHasMigrationClaim(encoded: string | null, claimId: string): boolean {
  if (encoded === null) return false
  try {
    const value = decodeSave(encoded).value
    return Boolean(
      value
      && typeof value === 'object'
      && !Array.isArray(value)
      && (value as Partial<StoredSaveSlotPayload>).format === slotStorageFormat
      && (value as Partial<StoredSaveSlotPayload>).slot === 1
      && (value as Partial<StoredSaveSlotPayload>).legacyMigrationClaimId === claimId,
    )
  } catch {
    return false
  }
}

/**
 * Termine le journal d'une migration legacy interrompue. Le marqueur n'autorise
 * la purge que si le slot publié et les octets source exacts sont toujours ceux
 * de l'opération initiale ; une écriture concurrente reste donc intacte.
 */
function recoverInterruptedLegacyMigration(storage: SaveStorage, gameCode: string): void {
  const claimKey = getLegacyMigrationClaimKey(gameCode)
  const claim = readLegacyMigrationClaim(storage, gameCode)
  if (!claim) {
    if (storage.getItem(claimKey) !== null) storage.removeItem(claimKey)
    return
  }
  const slotKey = getHgssSaveSlotStorageKey(gameCode, 1)
  const committedDestination = storage.getItem(slotKey)
  const stagedDestination = storage.getItem(`${slotKey}.staging`)
  const destinationPublished = encodedSlotHasMigrationClaim(
    committedDestination,
    claim.destinationClaimId,
  )
  if (!destinationPublished) {
    if (
      committedDestination === null
      && encodedSlotHasMigrationClaim(stagedDestination, claim.destinationClaimId)
    ) storage.removeItem(`${slotKey}.staging`)
    storage.removeItem(claimKey)
    return
  }

  const legacyKey = getHgssSaveStorageKey(gameCode)
  const currentSource: RawSaveSlotSnapshot = {
    source: 'legacy',
    committed: storage.getItem(legacyKey),
    staged: storage.getItem(`${legacyKey}.staging`),
  }
  const currentSourceToken = currentSource.committed === null && currentSource.staged === null
    ? undefined
    : createSaveSlotDeletionToken(currentSource)
  const sourceStillClaimed = currentSourceToken !== undefined
    && enumerateHgssBrowserSaveDeletionTransitionTokens(claim.sourceToken).includes(currentSourceToken)
  const rollbackClaimedDestination = (): void => {
    if (
      storage.getItem(`${slotKey}.staging`) === stagedDestination
      && encodedSlotHasMigrationClaim(stagedDestination, claim.destinationClaimId)
    ) storage.removeItem(`${slotKey}.staging`)
    if (
      storage.getItem(slotKey) === committedDestination
      && encodedSlotHasMigrationClaim(committedDestination, claim.destinationClaimId)
    ) storage.removeItem(slotKey)
    storage.removeItem(claimKey)
  }
  if (claim.phase === 'prepared' && currentSourceToken !== claim.sourceToken) {
    rollbackClaimedDestination()
    return
  }
  if (!sourceStillClaimed) {
    if (claim.phase === 'prepared') rollbackClaimedDestination()
    else if (currentSourceToken === undefined) storage.removeItem(claimKey)
    else rollbackClaimedDestination()
    return
  }
  if (claim.phase === 'prepared') {
    storage.setItem(claimKey, JSON.stringify({ ...claim, phase: 'purging' }))
    const verifiedSource: RawSaveSlotSnapshot = {
      source: 'legacy',
      committed: storage.getItem(legacyKey),
      staged: storage.getItem(`${legacyKey}.staging`),
    }
    if (createSaveSlotDeletionToken(verifiedSource) !== claim.sourceToken) {
      rollbackClaimedDestination()
      return
    }
  }
  if (currentSourceToken) {
    if (currentSource.staged !== null) storage.removeItem(`${legacyKey}.staging`)
    if (currentSource.committed !== null) storage.removeItem(legacyKey)
  }
  if (encodedSlotHasMigrationClaim(stagedDestination, claim.destinationClaimId)) {
    storage.removeItem(`${slotKey}.staging`)
  }
  storage.removeItem(claimKey)
}

function captureRawSaveSlotSnapshot(
  storage: SaveStorage,
  gameCode: string,
  slot: HgssBrowserSaveSlot,
): RawSaveSlotSnapshot | undefined {
  if (slot === 1) recoverInterruptedLegacyMigration(storage, gameCode)
  const slotKey = getHgssSaveSlotStorageKey(gameCode, slot)
  const committed = storage.getItem(slotKey)
  const staged = storage.getItem(`${slotKey}.staging`)
  if (committed !== null || staged !== null) return { source: 'slot', committed, staged }
  if (slot !== 1) return undefined
  const legacyKey = getHgssSaveStorageKey(gameCode)
  const legacyCommitted = storage.getItem(legacyKey)
  const legacyStaged = storage.getItem(`${legacyKey}.staging`)
  return legacyCommitted === null && legacyStaged === null
    ? undefined
    : { source: 'legacy', committed: legacyCommitted, staged: legacyStaged }
}

function createSaveSlotDeletionToken(snapshot: RawSaveSlotSnapshot): HgssBrowserSaveSlotDeletionToken {
  return JSON.stringify(snapshot) as HgssBrowserSaveSlotDeletionToken
}

/**
 * États non vides qui peuvent exister entre les deux suppressions de clés.
 * Le journal causal couvre ainsi aussi un arrêt brutal après retrait du staging.
 */
export function enumerateHgssBrowserSaveDeletionTransitionTokens(
  token: HgssBrowserSaveSlotDeletionToken,
): readonly HgssBrowserSaveSlotDeletionToken[] {
  let parsed: unknown
  try { parsed = JSON.parse(token) } catch { return Object.freeze([token]) }
  if (
    !parsed
    || typeof parsed !== 'object'
    || Array.isArray(parsed)
    || ((parsed as { source?: unknown }).source !== 'slot' && (parsed as { source?: unknown }).source !== 'legacy')
    || ((parsed as { committed?: unknown }).committed !== null && typeof (parsed as { committed?: unknown }).committed !== 'string')
    || ((parsed as { staged?: unknown }).staged !== null && typeof (parsed as { staged?: unknown }).staged !== 'string')
  ) return Object.freeze([token])
  const snapshot = parsed as RawSaveSlotSnapshot
  if (snapshot.staged === null || snapshot.committed === null) return Object.freeze([token])
  return Object.freeze([
    token,
    createSaveSlotDeletionToken({ ...snapshot, staged: null }),
  ])
}

/**
 * Inspects both readable and malformed bytes without confusing corruption with
 * an empty destination. Invalid bytes are never removed or rewritten here.
 */
export function inspectHgssBrowserSaveSlot(
  storage: SaveStorage,
  gameCode: string,
  slot: HgssBrowserSaveSlot,
  now: () => Date = () => new Date(),
): HgssBrowserSaveSlotInspection {
  requireHgssGameCode(gameCode)
  requireSaveSlot(slot)
  const snapshot = captureRawSaveSlotSnapshot(storage, gameCode, slot)
  if (!snapshot) return { kind: 'empty', slot }
  try {
    const record = readHgssBrowserSaveSlot(storage, gameCode, slot, now)
    if (!record) return { kind: 'empty', slot }
    return {
      kind: 'readable',
      slot,
      record,
      storageSource: snapshot.source,
      storageMigrationRequired: snapshot.source === 'legacy' || snapshot.staged !== null,
      deletionToken: createSaveSlotDeletionToken(snapshot),
    }
  } catch (error) {
    return {
      kind: 'corrupt',
      slot,
      reason: error instanceof Error ? error.message : `L’emplacement de sauvegarde ${slot} est illisible.`,
      deletionToken: createSaveSlotDeletionToken(snapshot),
    }
  }
}

function restoreRawStoragePair(storage: SaveStorage, key: string, snapshot: RawSaveSlotSnapshot): void {
  if (snapshot.committed === null) storage.removeItem(key)
  else storage.setItem(key, snapshot.committed)
  if (snapshot.staged === null) storage.removeItem(`${key}.staging`)
  else storage.setItem(`${key}.staging`, snapshot.staged)
}

/**
 * Remplace exactement les octets inspectés par un payload déjà validé par la
 * façade data-only. Cette primitive reste volontairement non attestante : les
 * frontières de source interdisent son import ailleurs que dans cette façade.
 */
export function migrateHgssBrowserSaveSlotIfStorageUnchanged(
  storage: SaveStorage,
  gameCode: string,
  slot: HgssBrowserSaveSlot,
  expectedToken: HgssBrowserSaveSlotDeletionToken,
  value: unknown,
  kind: HgssBrowserSaveKind,
  savedAt: string,
): HgssBrowserSaveSlotMigrationResult {
  requireHgssGameCode(gameCode)
  requireSaveSlot(slot)
  if (Number.isNaN(Date.parse(savedAt)) || new Date(savedAt).toISOString() !== savedAt) {
    throw new Error('La date de migration de sauvegarde est invalide.')
  }
  const source = captureRawSaveSlotSnapshot(storage, gameCode, slot)
  if (!source || createSaveSlotDeletionToken(source) !== expectedToken) return { kind: 'changed' }

  const slotKey = getHgssSaveSlotStorageKey(gameCode, slot)
  const legacyKey = getHgssSaveStorageKey(gameCode)
  const sourceKey = source.source === 'slot' ? slotKey : legacyKey
  const destinationBefore: RawSaveSlotSnapshot = source.source === 'slot'
    ? source
    : { source: 'slot', committed: storage.getItem(slotKey), staged: storage.getItem(`${slotKey}.staging`) }
  if (source.source === 'legacy' && (destinationBefore.committed !== null || destinationBefore.staged !== null)) {
    return { kind: 'changed' }
  }

  const destinationClaimId = source.source === 'legacy'
    ? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    : undefined
  const payload: StoredSaveSlotPayload = {
    format: slotStorageFormat,
    revision: 1,
    slot,
    savedAt,
    kind,
    value,
    ...(destinationClaimId ? { legacyMigrationClaimId: destinationClaimId } : {}),
  }
  const encoded = encodeSave(payload)
  let destinationTouched = false
  let sourceDeletionStarted = false
  let claimWritten = false
  try {
    if (source.source === 'legacy' && destinationClaimId) {
      const claim: LegacyMigrationClaim = {
        format: legacyMigrationClaimFormat,
        revision: 1,
        phase: 'prepared',
        sourceToken: expectedToken,
        destinationClaimId,
      }
      storage.setItem(getLegacyMigrationClaimKey(gameCode), JSON.stringify(claim))
      claimWritten = true
    }
    destinationTouched = true
    storage.setItem(`${slotKey}.staging`, encoded)
    storage.setItem(slotKey, encoded)
    storage.removeItem(`${slotKey}.staging`)

    if (source.source === 'legacy') {
      const currentSource: RawSaveSlotSnapshot = {
        source: 'legacy',
        committed: storage.getItem(legacyKey),
        staged: storage.getItem(`${legacyKey}.staging`),
      }
      if (createSaveSlotDeletionToken(currentSource) !== expectedToken) {
        restoreRawStoragePair(storage, slotKey, destinationBefore)
        if (claimWritten) storage.removeItem(getLegacyMigrationClaimKey(gameCode))
        claimWritten = false
        return { kind: 'changed' }
      }
      if (!destinationClaimId) throw new Error('Le journal de migration legacy est incomplet.')
      storage.setItem(getLegacyMigrationClaimKey(gameCode), JSON.stringify({
        format: legacyMigrationClaimFormat,
        revision: 1,
        phase: 'purging',
        sourceToken: expectedToken,
        destinationClaimId,
      } satisfies LegacyMigrationClaim))
      const sourceAfterClaim: RawSaveSlotSnapshot = {
        source: 'legacy',
        committed: storage.getItem(legacyKey),
        staged: storage.getItem(`${legacyKey}.staging`),
      }
      if (createSaveSlotDeletionToken(sourceAfterClaim) !== expectedToken) {
        restoreRawStoragePair(storage, slotKey, destinationBefore)
        storage.removeItem(getLegacyMigrationClaimKey(gameCode))
        claimWritten = false
        return { kind: 'changed' }
      }
      sourceDeletionStarted = true
      storage.removeItem(`${legacyKey}.staging`)
      storage.removeItem(legacyKey)
      storage.removeItem(getLegacyMigrationClaimKey(gameCode))
      claimWritten = false
    }
  } catch (error) {
    try {
      if (sourceDeletionStarted) restoreRawStoragePair(storage, sourceKey, source)
      if (destinationTouched) restoreRawStoragePair(storage, slotKey, destinationBefore)
      if (claimWritten) storage.removeItem(getLegacyMigrationClaimKey(gameCode))
    } catch {
      // L'erreur d'écriture initiale reste la cause présentée. Les Storage
      // navigateur usuels appliquent ces opérations synchrones atomiquement.
    }
    throw error
  }
  return {
    kind: 'migrated',
    record: { slot, savedAt, kind, value },
  }
}

/**
 * Explicitly removes one browser slot and its interrupted-write staging key.
 * It deliberately does not inspect or migrate the former single-save key.
 * The boolean result lets callers distinguish a deletion from an already
 * empty destination without weakening idempotence.
 */
export function deleteHgssBrowserSaveSlot(storage: SaveStorage, gameCode: string, slot: HgssBrowserSaveSlot): boolean {
  requireHgssGameCode(gameCode)
  requireSaveSlot(slot)
  const key = getHgssSaveSlotStorageKey(gameCode, slot)
  const existed = storage.getItem(key) !== null || storage.getItem(`${key}.staging`) !== null
  storage.removeItem(key)
  storage.removeItem(`${key}.staging`)
  return existed
}

export type HgssBrowserSaveConditionalDeletion = 'deleted' | 'missing' | 'changed'

/** Deletes malformed data only when its exact committed/staged bytes still match the confirmation. */
export function deleteHgssBrowserSaveSlotIfStorageUnchanged(
  storage: SaveStorage,
  gameCode: string,
  slot: HgssBrowserSaveSlot,
  expectedToken: HgssBrowserSaveSlotDeletionToken,
  beforeDelete?: () => void,
): HgssBrowserSaveConditionalDeletion {
  requireHgssGameCode(gameCode)
  requireSaveSlot(slot)
  const current = captureRawSaveSlotSnapshot(storage, gameCode, slot)
  if (!current) return 'missing'
  if (createSaveSlotDeletionToken(current) !== expectedToken) return 'changed'
  const key = current.source === 'slot'
    ? getHgssSaveSlotStorageKey(gameCode, slot)
    : getHgssSaveStorageKey(gameCode)
  beforeDelete?.()
  try {
    if (current.staged !== null) storage.removeItem(`${key}.staging`)
    if (current.committed !== null) storage.removeItem(key)
  } catch (error) {
    try { restoreRawStoragePair(storage, key, current) } catch { /* L'intention durable reste prioritaire. */ }
    throw error
  }
  return 'deleted'
}
