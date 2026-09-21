import {
  HgssFullSaveCloudCorruptObjectError,
  type HgssFullSaveCloudPresentSnapshot,
  type HgssFullSaveCloudRomIdentity,
  type HgssFullSaveCloudSnapshot,
  type HgssFullSaveCloudVaultClient,
} from '../save/hgssFullSaveCloudVault'
import {
  enumerateHgssBrowserSaveDeletionTransitionTokens,
  hgssBrowserSaveSlotCount,
  type HgssBrowserSaveSlot,
  type HgssBrowserSaveSlotDeletionToken,
} from '../save/hgssSaveStorage'
import type {
  TitleSaveCatalogDocument,
  TitleSaveCatalogExpectedSlot,
} from './titleSaveCatalog'
import {
  fingerprintTitleSaveStorageToken,
  type TitleSaveLocalTombstone,
} from './titleSaveStorageScope'
import {
  guardTitleSaveCloudCampaignVersion,
  resolveTitleSaveCloudVersion,
  sameTitleSaveCloudDocument,
} from './titleSaveCloudVersionPolicy'
import type {
  TitleSaveCloudCausalAnchor,
  TitleSaveCloudCausalLocalState,
} from './titleSaveCloudCausalStore'

type CloudStoredSnapshot = NonNullable<Awaited<ReturnType<HgssFullSaveCloudVaultClient['get']>>>
type CloudEtag = CloudStoredSnapshot['etag']
type CloudMutation = NonNullable<CloudStoredSnapshot['mutation']>

export type TitleSaveCloudReconciliation = Readonly<{
  uploaded: number
  downloaded: number
  deletedLocally: number
}>

export type TitleSaveCloudConflictResolution = Readonly<{
  choice: TitleSaveCloudConflictChoice
  remoteEtag: string
  localVersion: TitleSaveCloudLocalConflictVersion
}>

export type TitleSaveCloudConflictChoice = 'local' | 'remote'
export type TitleSaveCloudConflictKind = 'divergent' | 'local-corrupt' | 'remote-corrupt'

export type TitleSaveCloudLocalConflictVersion = Readonly<{
  storageToken: HgssBrowserSaveSlotDeletionToken | null
  tombstoneChangedAt: string | null
}>

export type TitleSaveCloudAuthorization = Readonly<{
  key: CryptoKey
  romIdentity: HgssFullSaveCloudRomIdentity
  localDocuments: ReadonlyMap<HgssBrowserSaveSlot, TitleSaveCatalogDocument>
  /** Suppressions durables qui n'ont peut-être pas encore atteint le serveur. */
  localTombstones?: ReadonlyMap<HgssBrowserSaveSlot, TitleSaveLocalTombstone>
  /** Tokens exacts des octets corrompus, nécessaires à une restauration cloud explicite. */
  corruptSlots: ReadonlyMap<HgssBrowserSaveSlot, HgssBrowserSaveSlotDeletionToken>
  /** Versions distantes que le joueur a explicitement choisies dans le sas. */
  remoteConflictResolutions?: ReadonlyMap<HgssBrowserSaveSlot, TitleSaveCloudConflictResolution>
  /** Preuve durable de la mutation serveur dont l'état local descend. */
  causalAnchors?: ReadonlyMap<HgssBrowserSaveSlot, TitleSaveCloudCausalAnchor>
  readLocalVersion?: (slot: HgssBrowserSaveSlot) => TitleSaveCloudLocalConflictVersion
  persistCausalAnchor?: (
    slot: HgssBrowserSaveSlot,
    anchor: TitleSaveCloudCausalAnchor,
  ) => void
  clearCausalAnchor?: (slot: HgssBrowserSaveSlot) => void
  applyPresent: (
    slot: HgssBrowserSaveSlot,
    expected: TitleSaveCatalogExpectedSlot,
    snapshot: HgssFullSaveCloudPresentSnapshot,
  ) => void
  applyDeleted: (
    slot: HgssBrowserSaveSlot,
    document: TitleSaveCatalogDocument,
  ) => void
  applyCorruptDeleted: (
    slot: HgssBrowserSaveSlot,
    storageToken: HgssBrowserSaveSlotDeletionToken,
  ) => void
  persistLocalTombstone?: (
    slot: HgssBrowserSaveSlot,
    changedAt: string,
    supersededStorageHashes?: readonly string[],
  ) => void
  clearLocalTombstone?: (slot: HgssBrowserSaveSlot) => void
  signal?: AbortSignal
}>

export type TitleSaveCloudCoordinator = Readonly<{
  authorize: (request: TitleSaveCloudAuthorization) => Promise<TitleSaveCloudReconciliation>
  deactivate: () => void
  enqueuePresent: (
    snapshot: HgssFullSaveCloudPresentSnapshot,
    localVersion?: TitleSaveCloudLocalConflictVersion,
  ) => void
  enqueueDeleted: (
    slot: HgssBrowserSaveSlot,
    romIdentity: HgssFullSaveCloudRomIdentity,
    changedAt?: string,
    localVersion?: TitleSaveCloudLocalConflictVersion,
  ) => void
  hasPending: () => boolean
  flush: () => Promise<void>
}>

export class TitleSaveCloudConflictError extends Error {
  readonly slot: HgssBrowserSaveSlot
  readonly remoteEtag: string
  readonly localVersion: TitleSaveCloudLocalConflictVersion
  readonly choices: readonly TitleSaveCloudConflictChoice[]
  readonly conflictKind: TitleSaveCloudConflictKind

  constructor(
    slot: HgssBrowserSaveSlot,
    reason: string,
    remoteEtag: string,
    localVersion: TitleSaveCloudLocalConflictVersion,
    choices: readonly TitleSaveCloudConflictChoice[],
    conflictKind: TitleSaveCloudConflictKind = 'divergent',
  ) {
    super(`Conflit cloud sur l’emplacement ${slot} : ${reason}`)
    this.name = 'TitleSaveCloudConflictError'
    this.slot = slot
    this.remoteEtag = remoteEtag
    this.localVersion = localVersion
    this.choices = Object.freeze([...choices])
    this.conflictKind = conflictKind
  }
}

/** La version lue a changé avant son application : le sas doit relire et redemander. */
export class TitleSaveCloudRemoteChangedError extends Error {
  constructor() {
    super('La sauvegarde cloud a changé pendant la synchronisation.')
    this.name = 'TitleSaveCloudRemoteChangedError'
  }
}

/** Au moins un slot reste durablement local : la sortie ne peut pas annoncer un cloud acquitté. */
export class TitleSaveCloudFlushPendingError extends Error {
  readonly slots: readonly HgssBrowserSaveSlot[]

  constructor(slots: readonly HgssBrowserSaveSlot[]) {
    const ordered = [...new Set(slots)].sort((left, right) => left - right)
    super(`La synchronisation cloud reste en attente pour ${ordered.map((slot) => `l’emplacement ${slot}`).join(', ')}.`)
    this.name = 'TitleSaveCloudFlushPendingError'
    this.slots = Object.freeze(ordered)
  }
}

type ActiveCloudSession = {
  generation: number
  key: CryptoKey
  romIdentity: HgssFullSaveCloudRomIdentity
  abort: AbortController
  remoteEtags: Map<HgssBrowserSaveSlot, CloudEtag | undefined>
  remoteMutations: Map<HgssBrowserSaveSlot, CloudMutation | undefined>
  readLocalVersion?: TitleSaveCloudAuthorization['readLocalVersion']
  persistCausalAnchor?: TitleSaveCloudAuthorization['persistCausalAnchor']
  /** Version distante ou déjà acceptée la plus récente pour chaque slot. */
  latestSnapshots: Map<HgssBrowserSaveSlot, HgssFullSaveCloudSnapshot>
}

type ReconciliationAction =
  | Readonly<{ kind: 'create-remote', snapshot: HgssFullSaveCloudSnapshot }>
  | Readonly<{ kind: 'replace-remote', snapshot: HgssFullSaveCloudSnapshot, etag: CloudEtag }>
  | Readonly<{
      kind: 'apply-local'
      snapshot: HgssFullSaveCloudPresentSnapshot
      expected: TitleSaveCatalogExpectedSlot
      clearLocalTombstone?: true
      remoteGuard: Readonly<{ snapshot: HgssFullSaveCloudSnapshot, etag: CloudEtag }>
    }>
  | Readonly<{
      kind: 'delete-local'
      slot: HgssBrowserSaveSlot
      document: TitleSaveCatalogDocument
      changedAt: string
      remoteGuard?: Readonly<{ snapshot: HgssFullSaveCloudSnapshot, etag: CloudEtag }>
    }>
  | Readonly<{
      kind: 'delete-corrupt-local'
      slot: HgssBrowserSaveSlot
      storageToken: HgssBrowserSaveSlotDeletionToken
      changedAt: string
      remoteGuard?: Readonly<{ snapshot: HgssFullSaveCloudSnapshot, etag: CloudEtag }>
    }>
  | Readonly<{
      kind: 'persist-local-tombstone'
      slot: HgssBrowserSaveSlot
      changedAt: string
      supersededStorageHashes?: readonly string[]
      remoteGuard?: Readonly<{ snapshot: HgssFullSaveCloudSnapshot, etag: CloudEtag }>
    }>
  | Readonly<{ kind: 'clear-local-tombstone', slot: HgssBrowserSaveSlot }>

function allSlots(): readonly HgssBrowserSaveSlot[] {
  return Array.from(
    { length: hgssBrowserSaveSlotCount },
    (_, index) => index + 1 as HgssBrowserSaveSlot,
  )
}

function sameRomIdentity(
  left: HgssFullSaveCloudRomIdentity,
  right: HgssFullSaveCloudRomIdentity,
): boolean {
  return left.gameVersion === right.gameVersion && left.language === right.language
}

function requireCanonicalTimestamp(value: string): string {
  const parsed = new Date(value)
  if (value.length > 32 || Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error('La réconciliation cloud a reçu un horodatage invalide.')
  }
  return value
}

function localSnapshot(
  slot: HgssBrowserSaveSlot,
  romIdentity: HgssFullSaveCloudRomIdentity,
  local: TitleSaveCatalogDocument,
): HgssFullSaveCloudPresentSnapshot {
  return Object.freeze({
    kind: 'present',
    slot,
    romIdentity,
    savedAt: local.savedAt,
    saveKind: local.kind,
    document: local.document,
  })
}

function localDeletedSnapshot(
  slot: HgssBrowserSaveSlot,
  romIdentity: HgssFullSaveCloudRomIdentity,
  local: TitleSaveLocalTombstone,
): HgssFullSaveCloudSnapshot {
  return Object.freeze({
    kind: 'deleted',
    slot,
    romIdentity,
    changedAt: requireCanonicalTimestamp(local.changedAt),
  })
}

function expectedLocal(local: TitleSaveCatalogDocument | undefined): TitleSaveCatalogExpectedSlot {
  return local
    ? Object.freeze({ kind: 'occupied', storageToken: local.storageToken })
    : Object.freeze({ kind: 'empty' })
}

function expectedCorrupt(storageToken: HgssBrowserSaveSlotDeletionToken): TitleSaveCatalogExpectedSlot {
  return Object.freeze({ kind: 'occupied', storageToken })
}

function localConflictVersion(
  document: TitleSaveCatalogDocument | undefined,
  tombstone: TitleSaveLocalTombstone | undefined,
  corruptToken: HgssBrowserSaveSlotDeletionToken | undefined,
): TitleSaveCloudLocalConflictVersion {
  return Object.freeze({
    storageToken: corruptToken
      ?? document?.storageToken
      ?? null,
    tombstoneChangedAt: tombstone?.changedAt ?? null,
  })
}

function sameLocalConflictVersion(
  left: TitleSaveCloudLocalConflictVersion,
  right: TitleSaveCloudLocalConflictVersion,
): boolean {
  return left.storageToken === right.storageToken
    && left.tombstoneChangedAt === right.tombstoneChangedAt
}

function sameCausalLocalState(
  left: TitleSaveCloudCausalLocalState,
  right: TitleSaveCloudCausalLocalState,
): boolean {
  return left.storageHash === right.storageHash
    && left.tombstoneChangedAt === right.tombstoneChangedAt
}

async function causalLocalState(
  version: TitleSaveCloudLocalConflictVersion,
  fingerprint: typeof fingerprintTitleSaveStorageToken,
): Promise<TitleSaveCloudCausalLocalState> {
  return Object.freeze({
    storageHash: version.storageToken === null
      ? null
      : await fingerprint(version.storageToken),
    tombstoneChangedAt: version.tombstoneChangedAt,
  })
}

function sameCloudState(
  left: HgssFullSaveCloudSnapshot,
  right: HgssFullSaveCloudSnapshot,
): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind === 'deleted') return true
  return right.kind === 'present'
    && sameTitleSaveCloudDocument(left.document, right.document)
}

/**
 * L'ETag prévient l'écrasement au moment du PUT ; l'ancrage détermine ici
 * quel côté descend de l'état précédemment observé. Une horloge locale
 * fausse ne peut donc jamais transformer une divergence en victoire automatique.
 */
function resolveCausalCloudVersion(
  candidate: HgssFullSaveCloudSnapshot,
  current: CloudStoredSnapshot,
  anchor: TitleSaveCloudCausalAnchor | undefined,
  observedLocalState: TitleSaveCloudCausalLocalState,
): ReturnType<typeof resolveTitleSaveCloudVersion> {
  if (!current.mutation) {
    // Compatibilité avec un ancien service : ce chemin disparaît dès que
    // l'en-tête causal est disponible.
    return resolveTitleSaveCloudVersion(candidate, current.snapshot)
  }
  if (!anchor) {
    const decision = sameCloudState(candidate, current.snapshot)
      ? 'equivalent'
      : 'simultaneous-conflict'
    return guardTitleSaveCloudCampaignVersion(candidate, current.snapshot, decision, true)
  }
  const localChanged = !sameCausalLocalState(anchor.localState, observedLocalState)
  const remoteChanged = anchor.remoteMutation !== current.mutation
    || anchor.remoteEtag !== current.etag
  let decision: ReturnType<typeof resolveTitleSaveCloudVersion>
  if (localChanged && !remoteChanged) decision = 'candidate-newer'
  else if (!localChanged && remoteChanged) decision = 'current-newer'
  else decision = sameCloudState(candidate, current.snapshot)
    ? 'equivalent'
    : 'simultaneous-conflict'
  return guardTitleSaveCloudCampaignVersion(candidate, current.snapshot, decision, true)
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || error instanceof DOMException && error.name === 'AbortError'
}

function isPreconditionConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { status?: unknown, code?: unknown }
  return candidate.status === 412 && candidate.code === 'PRECONDITION_FAILED'
}

export function createTitleSaveCloudCoordinator(options: {
  vault: HgssFullSaveCloudVaultClient
  reportStatus?: (message: string) => void
  fingerprintStorageToken?: typeof fingerprintTitleSaveStorageToken
  now?: () => Date
}): TitleSaveCloudCoordinator {
  const now = options.now ?? (() => new Date())
  const fingerprintStorageToken = options.fingerprintStorageToken ?? fingerprintTitleSaveStorageToken
  let generation = 0
  let active: ActiveCloudSession | undefined
  let authorizing: AbortController | undefined
  const pending = new Map<HgssBrowserSaveSlot, HgssFullSaveCloudSnapshot>()
  const pendingLocalVersions = new Map<HgssBrowserSaveSlot, TitleSaveCloudLocalConflictVersion>()
  const drains = new Map<HgssBrowserSaveSlot, Promise<void>>()
  const conflictedSlots = new Set<HgssBrowserSaveSlot>()
  let enqueueGeneration = 0

  const deactivate = (): void => {
    generation += 1
    authorizing?.abort()
    authorizing = undefined
    active?.abort.abort()
    active = undefined
    pending.clear()
    pendingLocalVersions.clear()
    drains.clear()
    conflictedSlots.clear()
  }

  const drainSlot = (slot: HgssBrowserSaveSlot): void => {
    const session = active
    if (!session || drains.has(slot)) return
    let blockedRetryGeneration: number | undefined
    const operation = (async (): Promise<void> => {
      while (active === session && generation === session.generation && !session.abort.signal.aborted) {
        const snapshot = pending.get(slot)
        if (!snapshot) return
        const localVersion = pendingLocalVersions.get(slot)
        pending.delete(slot)
        pendingLocalVersions.delete(slot)
        try {
          const etag = session.remoteEtags.get(slot)
          const written = etag
            ? await options.vault.replace(session.key, etag, snapshot, session.abort.signal)
            : await options.vault.create(session.key, snapshot, session.abort.signal)
          if (active !== session || generation !== session.generation) return
          session.remoteEtags.set(slot, written.etag)
          session.remoteMutations.set(slot, written.mutation)
          if (written.mutation && session.persistCausalAnchor && localVersion) {
              session.persistCausalAnchor(slot, Object.freeze({
                localState: await causalLocalState(localVersion, fingerprintStorageToken),
                remoteEtag: written.etag,
                remoteMutation: written.mutation,
              }))
          }
        } catch (error) {
          if (isAbort(error, session.abort.signal)) return
          if (isPreconditionConflict(error)) {
            conflictedSlots.add(slot)
            pending.delete(slot)
            pendingLocalVersions.delete(slot)
            options.reportStatus?.(`Conflit cloud sur l’emplacement ${slot} · reconnexion requise.`)
            return
          }
          if (!pending.has(slot)) {
            pending.set(slot, snapshot)
            if (localVersion) pendingLocalVersions.set(slot, localVersion)
            blockedRetryGeneration = enqueueGeneration
          }
          options.reportStatus?.(`Sauvegarde locale conservée · cloud en attente pour l’emplacement ${slot}.`)
          return
        }
      }
    })().finally(() => {
      if (drains.get(slot) !== operation) return
      drains.delete(slot)
      if (
        pending.has(slot)
        && (blockedRetryGeneration === undefined || blockedRetryGeneration !== enqueueGeneration)
      ) drainSlot(slot)
    })
    drains.set(slot, operation)
  }

  const enqueue = (
    snapshot: HgssFullSaveCloudSnapshot,
    localVersion?: TitleSaveCloudLocalConflictVersion,
  ): void => {
    const session = active
    if (
      !session
      || !sameRomIdentity(snapshot.romIdentity, session.romIdentity)
      || snapshot.slot < 1
      || snapshot.slot > hgssBrowserSaveSlotCount
      || conflictedSlots.has(snapshot.slot)
    ) return
    const latest = session.latestSnapshots.get(snapshot.slot)
    const currentLocalVersion = session.readLocalVersion?.(snapshot.slot)
    if (
      localVersion
      && currentLocalVersion
      && !sameLocalConflictVersion(localVersion, currentLocalVersion)
    ) return
    const attestedCurrentLocalWrite = Boolean(
      localVersion
      && currentLocalVersion
      && sameLocalConflictVersion(localVersion, currentLocalVersion),
    )
    if (latest) {
      const decision = session.remoteMutations.get(snapshot.slot) && attestedCurrentLocalWrite
        ? guardTitleSaveCloudCampaignVersion(snapshot, latest, 'candidate-newer', true)
        : resolveTitleSaveCloudVersion(snapshot, latest)
      if (decision === 'current-newer' || decision === 'equivalent') return
      if (decision === 'simultaneous-conflict') {
        conflictedSlots.add(snapshot.slot)
        pending.delete(snapshot.slot)
        pendingLocalVersions.delete(snapshot.slot)
        options.reportStatus?.(
          `Conflit cloud sur l’emplacement ${snapshot.slot} · reconnexion requise.`,
        )
        return
      }
    }
    session.latestSnapshots.set(snapshot.slot, snapshot)
    enqueueGeneration += 1
    pending.set(snapshot.slot, snapshot)
    if (localVersion) pendingLocalVersions.set(snapshot.slot, localVersion)
    drainSlot(snapshot.slot)
  }

  return Object.freeze({
    async authorize(request) {
      deactivate()
      const operationGeneration = generation
      const controller = new AbortController()
      authorizing = controller
      const assertCurrent = (): void => {
        if (controller.signal.aborted || generation !== operationGeneration) {
          throw new DOMException('Synchronisation cloud annulée.', 'AbortError')
        }
      }
      const abortFromCaller = (): void => { controller.abort(request.signal?.reason) }
      if (request.signal?.aborted) abortFromCaller()
      else request.signal?.addEventListener('abort', abortFromCaller, { once: true })
      try {
        const remoteEntries = await Promise.all(allSlots().map(async (slot) => {
          try {
            return Object.freeze({
              kind: 'readable' as const,
              slot,
              stored: await options.vault.get(request.key, request.romIdentity, slot, controller.signal),
            })
          } catch (error) {
            if (!(error instanceof HgssFullSaveCloudCorruptObjectError)) throw error
            return Object.freeze({
              kind: 'corrupt' as const,
              slot,
              etag: error.etag,
              mutation: error.mutation,
            })
          }
        }))
        assertCurrent()

        const actions: ReconciliationAction[] = []
        const remoteEtags = new Map<HgssBrowserSaveSlot, CloudEtag | undefined>()
        const remoteMutations = new Map<HgssBrowserSaveSlot, CloudMutation | undefined>()
        const latestSnapshots = new Map<HgssBrowserSaveSlot, HgssFullSaveCloudSnapshot>()
        for (const entry of remoteEntries) {
          const { slot } = entry
          const stored = entry.kind === 'readable' ? entry.stored : undefined
          remoteEtags.set(slot, entry.kind === 'corrupt' ? entry.etag : stored?.etag)
          remoteMutations.set(slot, entry.kind === 'corrupt' ? entry.mutation : stored?.mutation)
          if (stored) latestSnapshots.set(slot, stored.snapshot)
          const localDocument = request.localDocuments.get(slot)
          const localTombstone = request.localTombstones?.get(slot)
          const corruptToken = request.corruptSlots.get(slot)
          const observedLocalVersion = localConflictVersion(localDocument, localTombstone, corruptToken)
          const observedCausalLocalState = await causalLocalState(
            observedLocalVersion,
            fingerprintStorageToken,
          )
          assertCurrent()
          const causalAnchor = request.causalAnchors?.get(slot)
          const chosen = request.remoteConflictResolutions?.get(slot)
          const remoteChosen = Boolean(
            stored
            && chosen?.choice === 'remote'
            && chosen?.remoteEtag === stored.etag
            && sameLocalConflictVersion(chosen.localVersion, observedLocalVersion),
          )
          const localChosen = Boolean(
            chosen?.choice === 'local'
            && chosen.remoteEtag === (entry.kind === 'corrupt' ? entry.etag : stored?.etag)
            && sameLocalConflictVersion(chosen.localVersion, observedLocalVersion),
          )

          const currentStorageToken = corruptToken ?? localDocument?.storageToken
          const tombstoneMatchesStorage = Boolean(
            localTombstone?.supersededStorageHashes
            && currentStorageToken
            && localTombstone.supersededStorageHashes.includes(
              await fingerprintStorageToken(currentStorageToken),
            ),
          )
          assertCurrent()
          let localDeletionWins = false
          if (localTombstone) {
            if (!currentStorageToken || tombstoneMatchesStorage) {
              localDeletionWins = true
            } else if (localDocument) {
              if (localTombstone.supersededStorageHashes) {
                // Le document actuel n'est pas celui que la suppression a
                // remplacé : c'est donc une nouvelle écriture locale, même si
                // l'horloge de l'appareil a reculé.
                localDeletionWins = false
              } else {
                // Migration d'un ancien journal sans empreinte causale.
                const deletionDecision = resolveTitleSaveCloudVersion(
                  localDeletedSnapshot(slot, request.romIdentity, localTombstone),
                  localSnapshot(slot, request.romIdentity, localDocument),
                )
                localDeletionWins = deletionDecision !== 'current-newer'
              }
            } else if (!localTombstone.supersededStorageHashes && corruptToken) {
              localDeletionWins = true
            }
          }
          const effectiveDocument = localDeletionWins ? undefined : localDocument
          const effectiveTombstone = localDeletionWins ? localTombstone : undefined
          const effectiveCorruptToken = localDeletionWins ? undefined : corruptToken
          const clearStaleTombstone = (): void => {
            if (localTombstone && !effectiveTombstone) {
              actions.push({ kind: 'clear-local-tombstone', slot })
            }
          }
          const deleteStaleDocument = (
            changedAt: string,
            remoteGuard?: Readonly<{ snapshot: HgssFullSaveCloudSnapshot, etag: CloudEtag }>,
          ): void => {
            if (corruptToken && !effectiveCorruptToken) {
              actions.push({
                kind: 'delete-corrupt-local',
                slot,
                storageToken: corruptToken,
                changedAt,
                ...(remoteGuard ? { remoteGuard } : {}),
              })
            } else if (localDocument && !effectiveDocument) {
              actions.push({ kind: 'delete-local', slot, document: localDocument, changedAt, ...(remoteGuard ? { remoteGuard } : {}) })
            } else {
              actions.push({ kind: 'persist-local-tombstone', slot, changedAt, ...(remoteGuard ? { remoteGuard } : {}) })
            }
          }

          if (entry.kind === 'corrupt') {
            if (!localChosen) {
              throw new TitleSaveCloudConflictError(
                slot,
                'la version cloud est illisible et doit être réparée explicitement.',
                entry.etag,
                observedLocalVersion,
                ['local'],
                'remote-corrupt',
              )
            }
            if (effectiveDocument) {
              actions.push({
                kind: 'replace-remote',
                snapshot: localSnapshot(slot, request.romIdentity, effectiveDocument),
                etag: entry.etag,
              })
              clearStaleTombstone()
            } else if (effectiveTombstone) {
              actions.push({
                kind: 'replace-remote',
                snapshot: localDeletedSnapshot(slot, request.romIdentity, effectiveTombstone),
                etag: entry.etag,
              })
              if (localDocument || corruptToken) deleteStaleDocument(effectiveTombstone.changedAt)
            } else {
              const changedAt = requireCanonicalTimestamp(now().toISOString())
              const deleted = Object.freeze({ changedAt })
              actions.push({
                kind: 'replace-remote',
                snapshot: localDeletedSnapshot(slot, request.romIdentity, deleted),
                etag: entry.etag,
              })
              if (effectiveCorruptToken) {
                actions.push({
                  kind: 'delete-corrupt-local',
                  slot,
                  storageToken: effectiveCorruptToken,
                  changedAt,
                })
              } else {
                actions.push({
                  kind: 'persist-local-tombstone',
                  slot,
                  changedAt,
                  supersededStorageHashes: Object.freeze([]),
                })
              }
            }
            continue
          }
          if (effectiveCorruptToken) {
            if (!stored) continue
            if (!remoteChosen) {
              throw new TitleSaveCloudConflictError(
                slot,
                'les données locales sont corrompues.',
                stored.etag,
                observedLocalVersion,
                ['remote'],
                'local-corrupt',
              )
            }
            if (stored.snapshot.kind === 'present') {
              actions.push({
                kind: 'apply-local',
                snapshot: stored.snapshot,
                expected: expectedCorrupt(effectiveCorruptToken),
                ...(localTombstone ? { clearLocalTombstone: true as const } : {}),
                remoteGuard: { snapshot: stored.snapshot, etag: stored.etag },
              })
            } else {
              actions.push({
                kind: 'delete-corrupt-local',
                slot,
                storageToken: effectiveCorruptToken,
                changedAt: stored.snapshot.changedAt,
                remoteGuard: { snapshot: stored.snapshot, etag: stored.etag },
              })
            }
            continue
          }

          if (!stored) {
            if (effectiveDocument) {
              actions.push({
                kind: 'create-remote',
                snapshot: localSnapshot(slot, request.romIdentity, effectiveDocument),
              })
              clearStaleTombstone()
            } else if (effectiveTombstone) {
              actions.push({
                kind: 'create-remote',
                snapshot: localDeletedSnapshot(slot, request.romIdentity, effectiveTombstone),
              })
              if (localDocument || corruptToken) deleteStaleDocument(effectiveTombstone.changedAt)
            }
            continue
          }

          const remote = stored.snapshot
          if (remote.kind === 'deleted') {
            if (effectiveTombstone) {
              const decision = resolveCausalCloudVersion(
                localDeletedSnapshot(slot, request.romIdentity, effectiveTombstone),
                stored,
                causalAnchor,
                observedCausalLocalState,
              )
              const remoteGuard = { snapshot: remote, etag: stored.etag }
              if (decision === 'current-newer') {
                deleteStaleDocument(remote.changedAt, remoteGuard)
              } else if (decision === 'equivalent') {
                if (localDocument || corruptToken) deleteStaleDocument(remote.changedAt, remoteGuard)
              } else {
                actions.push({
                  kind: 'replace-remote',
                  snapshot: localDeletedSnapshot(slot, request.romIdentity, effectiveTombstone),
                  etag: stored.etag,
                })
                if (localDocument || corruptToken) deleteStaleDocument(effectiveTombstone.changedAt)
              }
              continue
            }
            if (!effectiveDocument) {
              actions.push({
                kind: 'persist-local-tombstone',
                slot,
                changedAt: remote.changedAt,
                // Cette suppression distante a été observée sur un slot vide.
                // `[]` est une preuve causale ; `undefined` reste réservé aux
                // anciens journaux qui ne savent pas quels octets ils visaient.
                supersededStorageHashes: Object.freeze([]),
                remoteGuard: { snapshot: remote, etag: stored.etag },
              })
              continue
            }
            const candidate = localSnapshot(slot, request.romIdentity, effectiveDocument)
            const documentDescendsFromRemoteDeletion = Boolean(
              !stored.mutation
              && localTombstone
              && localTombstone.changedAt === remote.changedAt
              && localTombstone.supersededStorageHashes !== undefined
              && !tombstoneMatchesStorage,
            )
            const decision = documentDescendsFromRemoteDeletion
              ? guardTitleSaveCloudCampaignVersion(
                  candidate,
                  remote,
                  'candidate-newer',
                  true,
                )
              : resolveCausalCloudVersion(
                  candidate,
                  stored,
                  causalAnchor,
                  observedCausalLocalState,
                )
            if (decision === 'current-newer') actions.push({
              kind: 'delete-local',
              slot,
              document: effectiveDocument,
              changedAt: remote.changedAt,
              remoteGuard: { snapshot: remote, etag: stored.etag },
            })
            else if (decision === 'candidate-newer') {
              actions.push({
                kind: 'replace-remote',
                snapshot: candidate,
                etag: stored.etag,
              })
              clearStaleTombstone()
            } else if (remoteChosen) actions.push({
              kind: 'delete-local', slot, document: effectiveDocument, changedAt: remote.changedAt,
              remoteGuard: { snapshot: remote, etag: stored.etag },
            })
            else if (localChosen) {
              actions.push({
                kind: 'replace-remote',
                snapshot: localSnapshot(slot, request.romIdentity, effectiveDocument),
                etag: stored.etag,
              })
              clearStaleTombstone()
            }
            else throw new TitleSaveCloudConflictError(
              slot,
              'suppression et sauvegarde sont simultanées.',
              stored.etag,
              observedLocalVersion,
              ['local', 'remote'],
            )
            continue
          }

          if (effectiveTombstone) {
            const decision = resolveCausalCloudVersion(
              localDeletedSnapshot(slot, request.romIdentity, effectiveTombstone),
              stored,
              causalAnchor,
              observedCausalLocalState,
            )
            if (decision === 'current-newer') {
              actions.push({
                kind: 'apply-local',
                snapshot: remote,
                expected: corruptToken ? expectedCorrupt(corruptToken) : expectedLocal(localDocument),
                clearLocalTombstone: true,
                remoteGuard: { snapshot: remote, etag: stored.etag },
              })
            } else if (decision === 'candidate-newer') {
              actions.push({
                kind: 'replace-remote',
                snapshot: localDeletedSnapshot(slot, request.romIdentity, effectiveTombstone),
                etag: stored.etag,
              })
              if (localDocument || corruptToken) deleteStaleDocument(effectiveTombstone.changedAt)
            } else if (remoteChosen) {
              actions.push({
                kind: 'apply-local',
                snapshot: remote,
                expected: corruptToken ? expectedCorrupt(corruptToken) : expectedLocal(localDocument),
                clearLocalTombstone: true,
                remoteGuard: { snapshot: remote, etag: stored.etag },
              })
            } else if (localChosen) {
              actions.push({
                kind: 'replace-remote',
                snapshot: localDeletedSnapshot(slot, request.romIdentity, effectiveTombstone),
                etag: stored.etag,
              })
              if (localDocument || corruptToken) deleteStaleDocument(effectiveTombstone.changedAt)
            } else throw new TitleSaveCloudConflictError(
              slot,
              'suppression et sauvegarde sont simultanées.',
              stored.etag,
              observedLocalVersion,
              ['local', 'remote'],
            )
            continue
          }

          if (!effectiveDocument) {
            actions.push({
              kind: 'apply-local', snapshot: remote, expected: expectedLocal(undefined),
              remoteGuard: { snapshot: remote, etag: stored.etag },
            })
            continue
          }
          const decision = resolveCausalCloudVersion(
            localSnapshot(slot, request.romIdentity, effectiveDocument),
            stored,
            causalAnchor,
            observedCausalLocalState,
          )
          if (decision === 'current-newer') actions.push({
            kind: 'apply-local', snapshot: remote, expected: expectedLocal(effectiveDocument),
            remoteGuard: { snapshot: remote, etag: stored.etag },
          })
          else if (decision === 'candidate-newer') actions.push({
            kind: 'replace-remote',
            snapshot: localSnapshot(slot, request.romIdentity, effectiveDocument),
            etag: stored.etag,
          })
          else if (decision === 'equivalent') {
            if (
              effectiveDocument.kind !== remote.saveKind
              || effectiveDocument.savedAt !== remote.savedAt
            ) actions.push({
              kind: 'apply-local', snapshot: remote, expected: expectedLocal(effectiveDocument),
              remoteGuard: { snapshot: remote, etag: stored.etag },
            })
          }
          else if (remoteChosen) actions.push({
            kind: 'apply-local',
            snapshot: remote,
            expected: expectedLocal(effectiveDocument),
            remoteGuard: { snapshot: remote, etag: stored.etag },
          })
          else if (localChosen) actions.push({
            kind: 'replace-remote',
            snapshot: localSnapshot(slot, request.romIdentity, effectiveDocument),
            etag: stored.etag,
          })
          else throw new TitleSaveCloudConflictError(
            slot,
            'deux versions ont divergé sur des appareils différents.',
            stored.etag,
            observedLocalVersion,
            ['local', 'remote'],
          )
          clearStaleTombstone()
        }

        let uploaded = 0
        let downloaded = 0
        let deletedLocally = 0
        for (const action of actions) {
          assertCurrent()
          const remoteGuard = 'remoteGuard' in action ? action.remoteGuard : undefined
          if (remoteGuard) {
            const verified = await options.vault.get(
              request.key,
              request.romIdentity,
              remoteGuard.snapshot.slot,
              controller.signal,
            )
            assertCurrent()
            if (!verified || verified.etag !== remoteGuard.etag) {
              throw new TitleSaveCloudRemoteChangedError()
            }
            // Une vérification de garde est une lecture conditionnelle logique,
            // jamais une réécriture identique : l'horloge causale distante ne
            // doit pas avancer quand cet appareil ne publie aucune nouveauté.
            remoteEtags.set(remoteGuard.snapshot.slot, verified.etag)
            remoteMutations.set(remoteGuard.snapshot.slot, verified.mutation)
            latestSnapshots.set(remoteGuard.snapshot.slot, verified.snapshot)
          }
          if (action.kind === 'apply-local') {
            assertCurrent()
            if (action.clearLocalTombstone) request.clearLocalTombstone?.(action.snapshot.slot)
            request.applyPresent(action.snapshot.slot, action.expected, action.snapshot)
            downloaded += 1
          } else if (action.kind === 'delete-local') {
            const supersededStorageHashes = await Promise.all(
              enumerateHgssBrowserSaveDeletionTransitionTokens(action.document.storageToken)
                .map((token) => fingerprintStorageToken(token)),
            )
            assertCurrent()
            request.persistLocalTombstone?.(
              action.slot,
              action.changedAt,
              supersededStorageHashes,
            )
            request.applyDeleted(action.slot, action.document)
            deletedLocally += 1
          } else if (action.kind === 'delete-corrupt-local') {
            const supersededStorageHashes = await Promise.all(
              enumerateHgssBrowserSaveDeletionTransitionTokens(action.storageToken)
                .map((token) => fingerprintStorageToken(token)),
            )
            assertCurrent()
            request.persistLocalTombstone?.(
              action.slot,
              action.changedAt,
              supersededStorageHashes,
            )
            request.applyCorruptDeleted(action.slot, action.storageToken)
            deletedLocally += 1
          } else if (action.kind === 'persist-local-tombstone') {
            assertCurrent()
            request.persistLocalTombstone?.(
              action.slot,
              action.changedAt,
              action.supersededStorageHashes,
            )
          } else if (action.kind === 'clear-local-tombstone') {
            assertCurrent()
            request.clearLocalTombstone?.(action.slot)
          } else {
            const written = action.kind === 'create-remote'
              ? await options.vault.create(request.key, action.snapshot, controller.signal)
              : await options.vault.replace(request.key, action.etag, action.snapshot, controller.signal)
            assertCurrent()
            remoteEtags.set(action.snapshot.slot, written.etag)
            remoteMutations.set(action.snapshot.slot, written.mutation)
            latestSnapshots.set(action.snapshot.slot, action.snapshot)
            uploaded += 1
          }
        }

        assertCurrent()
        for (const slot of allSlots()) {
          const etag = remoteEtags.get(slot)
          const mutation = remoteMutations.get(slot)
          if (!etag) {
            request.clearCausalAnchor?.(slot)
            continue
          }
          if (!mutation || !request.persistCausalAnchor || !request.readLocalVersion) continue
          const finalLocalVersion = request.readLocalVersion(slot)
          const localState = await causalLocalState(finalLocalVersion, fingerprintStorageToken)
          assertCurrent()
          request.persistCausalAnchor(slot, Object.freeze({
            localState,
            remoteEtag: etag,
            remoteMutation: mutation,
          }))
        }

        assertCurrent()
        active = {
          generation: operationGeneration,
          key: request.key,
          romIdentity: request.romIdentity,
          abort: controller,
          remoteEtags,
          remoteMutations,
          ...(request.readLocalVersion ? { readLocalVersion: request.readLocalVersion } : {}),
          ...(request.persistCausalAnchor ? { persistCausalAnchor: request.persistCausalAnchor } : {}),
          latestSnapshots,
        }
        return Object.freeze({ uploaded, downloaded, deletedLocally })
      } catch (error) {
        controller.abort()
        throw isPreconditionConflict(error) ? new TitleSaveCloudRemoteChangedError() : error
      } finally {
        if (authorizing === controller) authorizing = undefined
        request.signal?.removeEventListener('abort', abortFromCaller)
      }
    },
    deactivate,
    enqueuePresent: enqueue,
    enqueueDeleted(slot, romIdentity, changedAt = now().toISOString(), localVersion) {
      enqueue(Object.freeze({
        kind: 'deleted',
        slot,
        romIdentity,
        changedAt: requireCanonicalTimestamp(changedAt),
      }), localVersion)
    },
    hasPending: () => drains.size > 0 || pending.size > 0 || conflictedSlots.size > 0,
    async flush() {
      while (true) {
        const observedGeneration = enqueueGeneration
        await Promise.all([...drains.values()])
        for (const slot of [...pending.keys()]) drainSlot(slot)
        await Promise.all([...drains.values()])
        if (drains.size === 0 && observedGeneration === enqueueGeneration) break
      }
      const unresolved = [...pending.keys(), ...conflictedSlots]
      if (unresolved.length > 0) throw new TitleSaveCloudFlushPendingError(unresolved)
    },
  })
}
