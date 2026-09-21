import type {
  OnlineAccount,
  OnlineAccountCredentials,
  OnlineAccountSession,
} from '../../online/onlineAccountSession'
import type {
  HgssBrowserSaveSlot,
  HgssBrowserSaveSlotDeletionToken,
} from '../save/hgssSaveStorage'

export type TitleAccountMode = 'login' | 'register'

export type TitleSaveCatalogAccess =
  | Readonly<{ kind: 'online', account: OnlineAccount }>
  | Readonly<{ kind: 'account-cache', account: OnlineAccount }>
  | Readonly<{ kind: 'local' }>

export type TitleSaveCatalogConflictResolution = Readonly<{
  choice: TitleSaveCatalogConflictChoice
  remoteEtag: string
  localVersion: TitleSaveCatalogLocalConflictVersion
}>

export type TitleSaveCatalogConflictChoice = 'local' | 'remote'
export type TitleSaveCatalogConflictKind = 'divergent' | 'local-corrupt' | 'remote-corrupt'

export type TitleSaveCatalogLocalConflictVersion = Readonly<{
  storageToken: HgssBrowserSaveSlotDeletionToken | null
  tombstoneChangedAt: string | null
}>

export type TitleSaveCatalogConflictResolutions = ReadonlyMap<
  HgssBrowserSaveSlot,
  TitleSaveCatalogConflictResolution
>

export type TitleSaveCatalogLocalImportChoice = 'import' | 'keep-separate'

export type TitleSaveCatalogLocalImportDecision = Readonly<{
  choice: TitleSaveCatalogLocalImportChoice
  proposalId: number
}>

export type TitleAccountGateState =
  | Readonly<{ stage: 'closed' }>
  | Readonly<{ stage: 'restoring' }>
  | Readonly<{ stage: 'account-choice', account: OnlineAccount, notice?: string }>
  | Readonly<{ stage: 'signed-out', mode: TitleAccountMode, message?: string, notice?: string }>
  | Readonly<{ stage: 'authenticating', mode: TitleAccountMode }>
  | Readonly<{ stage: 'unavailable', message: string, canRetry: boolean, notice?: string }>
  | Readonly<{ stage: 'authorizing', access: TitleSaveCatalogAccess }>
  | Readonly<{ stage: 'catalog-error', access: TitleSaveCatalogAccess, message: string }>
  | Readonly<{ stage: 'catalog-busy', access: TitleSaveCatalogAccess, message: string }>
  | Readonly<{
      stage: 'local-import'
      access: Extract<TitleSaveCatalogAccess, { kind: 'online' }>
      transferCount: number
    }>
  | Readonly<{
      stage: 'catalog-conflict'
      access: Extract<TitleSaveCatalogAccess, { kind: 'online' }>
      slot: HgssBrowserSaveSlot
      message: string
      choices: readonly TitleSaveCatalogConflictChoice[]
      conflictKind: TitleSaveCatalogConflictKind
    }>
  | Readonly<{ stage: 'authorized', access: TitleSaveCatalogAccess }>

export type TitleAccountGateSession = Pick<
  OnlineAccountSession,
  'configured' | 'getAccount' | 'hasPersistedSession' | 'restore' | 'login' | 'register' | 'logout'
> & Readonly<{ clear?: () => void }>

export type TitleAccountGateCoordinatorOptions = Readonly<{
  session: TitleAccountGateSession
  restoreTimeoutMs?: number
  /** Délai commun aux identifiants et à l'ouverture du catalogue. */
  operationTimeoutMs?: number
  /** Permet de désactiver explicitement le catalogue local dans un hôte spécialisé. */
  allowLocalAccess?: boolean
  /**
   * Prépare les capacités privées qui dépendent des identifiants saisis (par
   * exemple la clé locale du coffre), sans jamais les publier dans l'état UI.
   */
  onAuthenticated?: (
    account: OnlineAccount,
    credentials: OnlineAccountCredentials,
    signal: AbortSignal,
  ) => void | Promise<void>
  /**
   * Seule frontière autorisant le chargement du catalogue. Le raccord appelant
   * lit, réconcilie puis ouvre les sauvegardes depuis ce callback uniquement.
   */
  onAuthorizeCatalogAccess: (
    access: TitleSaveCatalogAccess,
    signal: AbortSignal,
    conflictResolutions: TitleSaveCatalogConflictResolutions,
    localImportDecision?: TitleSaveCatalogLocalImportDecision,
  ) => void | Promise<void>
}>

export type TitleAccountGateCoordinator = Readonly<{
  getState: () => TitleAccountGateState
  subscribe: (listener: (state: TitleAccountGateState) => void) => () => void
  open: () => Promise<void>
  close: () => void
  selectMode: (mode: TitleAccountMode) => void
  login: (credentials: OnlineAccountCredentials) => Promise<void>
  register: (credentials: OnlineAccountCredentials) => Promise<void>
  continueWithAccount: () => Promise<void>
  switchAccount: () => Promise<void>
  retry: () => Promise<void>
  useLocal: () => Promise<void>
  importLocalSaves: () => Promise<void>
  keepLocalSavesSeparate: () => Promise<void>
  useAccountCache: () => Promise<void>
  useLocalConflict: () => Promise<void>
  useCloudConflict: () => Promise<void>
  retryCatalog: () => Promise<void>
  reconnect: () => void
  showNotice: (message: string) => void
  destroy: () => void
}>

const defaultRestoreTimeoutMs = 8_000
const defaultOperationTimeoutMs = 8_000
const restoreTimeout = Symbol('title-account-restore-timeout')
const authenticationTimeout = Symbol('title-account-authentication-timeout')
const logoutTimeout = Symbol('title-account-logout-timeout')
const catalogTimeout = Symbol('title-save-catalog-timeout')
const operationCancelled = Symbol('title-account-operation-cancelled')
const localAccess: TitleSaveCatalogAccess = Object.freeze({ kind: 'local' })

type PendingCatalogConflict = Readonly<{
  slot: HgssBrowserSaveSlot
  remoteEtag: string
  localVersion: TitleSaveCatalogLocalConflictVersion
  choices: readonly TitleSaveCatalogConflictChoice[]
  conflictKind: TitleSaveCatalogConflictKind
}>

type PendingLocalImport = Readonly<{
  proposalId: number
  transferCount: number
}>

function resolveTimeout(value: number | undefined): number {
  return Number.isFinite(value) && (value ?? 0) > 0
    ? Math.floor(value as number)
    : defaultRestoreTimeoutMs
}

function onlineAccess(account: OnlineAccount): TitleSaveCatalogAccess {
  return Object.freeze({ kind: 'online', account })
}

function safeErrorMessage(error: unknown, fallback: string, secret?: string): string {
  const source = error instanceof Error && error.message.trim().length > 0
    ? error.message.trim()
    : fallback
  const redacted = secret && secret.length > 0 ? source.split(secret).join('••••') : source
  return redacted.slice(0, 240)
}

function safeNotice(message: string): string | undefined {
  const value = message.normalize('NFKC').trim().slice(0, 240)
  return value.length > 0 ? value : undefined
}

function readCatalogConflict(error: unknown): PendingCatalogConflict | undefined {
  if (!(error instanceof Error) || error.name !== 'TitleSaveCloudConflictError') return undefined
  const candidate = error as Error & {
    slot?: unknown
    remoteEtag?: unknown
    localVersion?: unknown
    choices?: unknown
    conflictKind?: unknown
  }
  const localVersion = candidate.localVersion as {
    storageToken?: unknown
    tombstoneChangedAt?: unknown
  } | undefined
  const choices = Array.isArray(candidate.choices)
    ? [...new Set(candidate.choices)]
    : []
  if (
    !Number.isSafeInteger(candidate.slot)
    || (candidate.slot as number) < 1
    || (candidate.slot as number) > 3
    || typeof candidate.remoteEtag !== 'string'
    || candidate.remoteEtag.length < 1
    || candidate.remoteEtag.length > 160
    || !localVersion
    || typeof localVersion !== 'object'
    || localVersion.storageToken !== null && typeof localVersion.storageToken !== 'string'
    || localVersion.tombstoneChangedAt !== null && typeof localVersion.tombstoneChangedAt !== 'string'
    || choices.length < 1
    || choices.some((choice) => choice !== 'local' && choice !== 'remote')
    || candidate.conflictKind !== 'divergent'
      && candidate.conflictKind !== 'local-corrupt'
      && candidate.conflictKind !== 'remote-corrupt'
  ) return undefined
  if (typeof localVersion.tombstoneChangedAt === 'string') {
    const timestamp = new Date(localVersion.tombstoneChangedAt)
    if (
      localVersion.tombstoneChangedAt.length > 32
      || Number.isNaN(timestamp.getTime())
      || timestamp.toISOString() !== localVersion.tombstoneChangedAt
    ) return undefined
  }
  return Object.freeze({
    slot: candidate.slot as HgssBrowserSaveSlot,
    remoteEtag: candidate.remoteEtag,
    localVersion: Object.freeze({
      storageToken: localVersion.storageToken as HgssBrowserSaveSlotDeletionToken | null,
      tombstoneChangedAt: localVersion.tombstoneChangedAt as string | null,
    }),
    choices: Object.freeze(choices as TitleSaveCatalogConflictChoice[]),
    conflictKind: candidate.conflictKind,
  })
}

function readLocalImport(error: unknown): PendingLocalImport | undefined {
  if (!(error instanceof Error) || error.name !== 'TitleSaveLocalAccountImportRequiredError') {
    return undefined
  }
  const candidate = error as Error & { proposalId?: unknown, transferCount?: unknown }
  if (
    !Number.isSafeInteger(candidate.proposalId)
    || (candidate.proposalId as number) < 1
    || !Number.isSafeInteger(candidate.transferCount)
    || (candidate.transferCount as number) < 1
    || (candidate.transferCount as number) > 3
  ) return undefined
  return Object.freeze({
    proposalId: candidate.proposalId as number,
    transferCount: candidate.transferCount as number,
  })
}

function isRemoteCloudChange(error: unknown): boolean {
  return error instanceof Error && error.name === 'TitleSaveCloudRemoteChangedError'
}

function isCampaignBusy(error: unknown): boolean {
  return error instanceof Error && error.name === 'TitleSaveCampaignBusyError'
}

async function awaitWithTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  timeoutReason: symbol,
  controller: AbortController,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let rejectCancellation: (() => void) | undefined
  try {
    return await new Promise<T>((resolve, reject) => {
      rejectCancellation = () => { reject(operationCancelled) }
      controller.signal.addEventListener('abort', rejectCancellation, { once: true })
      timeoutId = setTimeout(() => {
        reject(timeoutReason)
        controller.abort(timeoutReason)
      }, timeoutMs)
      operation.then(resolve, reject)
      if (controller.signal.aborted) rejectCancellation()
    })
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
    if (rejectCancellation) {
      controller.signal.removeEventListener('abort', rejectCancellation)
    }
  }
}

export function createTitleAccountGateCoordinator(
  options: TitleAccountGateCoordinatorOptions,
): TitleAccountGateCoordinator {
  const timeoutMs = resolveTimeout(options.restoreTimeoutMs)
  const operationTimeoutMs = resolveTimeout(options.operationTimeoutMs ?? defaultOperationTimeoutMs)
  // Le serveur configuré enrichit le titre, mais ne rend jamais la campagne
  // locale dépendante du réseau. Seul un hôte spécialisé peut retirer ce choix.
  const localAccessAllowed = options.allowLocalAccess !== false
  const listeners = new Set<(state: TitleAccountGateState) => void>()
  let state: TitleAccountGateState = Object.freeze({ stage: 'closed' })
  let revision = 0
  let destroyed = false
  let activeAuthorization: AbortController | undefined
  let pendingConflict: PendingCatalogConflict | undefined
  let pendingLocalImport: PendingLocalImport | undefined
  let localImportDecision: TitleSaveCatalogLocalImportDecision | undefined
  const remoteConflictResolutions = new Map<
    HgssBrowserSaveSlot,
    TitleSaveCatalogConflictResolution
  >()

  const resetConflicts = (): void => {
    pendingConflict = undefined
    remoteConflictResolutions.clear()
  }


  const resetLocalImport = (): void => {
    pendingLocalImport = undefined
    localImportDecision = undefined
  }

  const beginOperation = (): number => {
    activeAuthorization?.abort()
    activeAuthorization = undefined
    revision += 1
    return revision
  }

  const publish = (next: TitleAccountGateState): void => {
    if (destroyed) return
    state = Object.freeze(next)
    for (const listener of listeners) {
      try { listener(state) } catch { /* Une vue ne pilote jamais l'autorisation. */ }
    }
  }

  const isCurrent = (operationRevision: number): boolean => (
    !destroyed && revision === operationRevision
  )

  const authorize = async (
    access: TitleSaveCatalogAccess,
    operationRevision: number,
    remoteRefreshesRemaining = 1,
  ): Promise<void> => {
    if (!isCurrent(operationRevision)) return
    activeAuthorization?.abort()
    const authorization = new AbortController()
    activeAuthorization = authorization
    publish({ stage: 'authorizing', access })
    try {
      await awaitWithTimeout(
        Promise.resolve(localImportDecision
          ? options.onAuthorizeCatalogAccess(
              access,
              authorization.signal,
              new Map(remoteConflictResolutions),
              localImportDecision,
            )
          : options.onAuthorizeCatalogAccess(
              access,
              authorization.signal,
              new Map(remoteConflictResolutions),
            )),
        operationTimeoutMs,
        catalogTimeout,
        authorization,
      )
      if (isCurrent(operationRevision)) {
        pendingConflict = undefined
        resetLocalImport()
        publish({ stage: 'authorized', access })
      }
    } catch (error) {
      if (!isCurrent(operationRevision)) return
      if (isRemoteCloudChange(error) && remoteRefreshesRemaining > 0) {
        resetConflicts()
        await authorize(access, operationRevision, remoteRefreshesRemaining - 1)
        return
      }
      if (error === catalogTimeout) {
        pendingConflict = undefined
        publish({ stage: 'catalog-error', access, message: 'Ouverture des sauvegardes trop lente.' })
        return
      }
      if (authorization.signal.aborted) return
      if (isCampaignBusy(error)) {
        pendingConflict = undefined
        publish({ stage: 'catalog-busy', access, message: safeErrorMessage(error, 'Campagne déjà ouverte.') })
        return
      }
      const localImport = readLocalImport(error)
      if (localImport && access.kind === 'online') {
        pendingConflict = undefined
        pendingLocalImport = localImport
        localImportDecision = undefined
        publish({
          stage: 'local-import',
          access,
          transferCount: localImport.transferCount,
        })
        return
      }
      const conflict = readCatalogConflict(error)
      if (conflict && access.kind === 'online') {
        pendingConflict = conflict
        publish({
          stage: 'catalog-conflict',
          access,
          slot: conflict.slot,
          message: safeErrorMessage(error, 'Deux sauvegardes demandent votre choix.'),
          choices: conflict.choices,
          conflictKind: conflict.conflictKind,
        })
      } else {
        pendingConflict = undefined
        publish({
          stage: 'catalog-error',
          access,
          message: safeErrorMessage(error, 'Sauvegardes indisponibles.'),
        })
      }
    } finally {
      if (activeAuthorization === authorization) activeAuthorization = undefined
    }
  }

  const restorePersistedSession = async (operationRevision: number): Promise<void> => {
    const restoration = new AbortController()
    activeAuthorization = restoration
    publish({ stage: 'restoring' })
    try {
      const account = await awaitWithTimeout(
        options.session.restore(restoration.signal),
        timeoutMs,
        restoreTimeout,
        restoration,
      )
      if (!isCurrent(operationRevision)) return
      if (!account) {
        publish({ stage: 'signed-out', mode: 'login' })
        return
      }
      publish({ stage: 'account-choice', account })
    } catch (error) {
      if (!isCurrent(operationRevision)) return
      publish({
        stage: 'unavailable',
        message: error === restoreTimeout ? 'Serveur trop lent.' : 'Serveur indisponible.',
        canRetry: true,
      })
    } finally {
      if (activeAuthorization === restoration) activeAuthorization = undefined
    }
  }

  const open = async (): Promise<void> => {
    if (destroyed) return
    resetConflicts()
    resetLocalImport()
    const operationRevision = beginOperation()
    try {
      const account = options.session.getAccount()
      if (account) {
        publish({ stage: 'account-choice', account })
        return
      }
      if (!options.session.configured) {
        publish({ stage: 'unavailable', message: 'Service en ligne indisponible.', canRetry: false })
        return
      }
      if (!options.session.hasPersistedSession()) {
        publish({ stage: 'signed-out', mode: 'login' })
        return
      }
      await restorePersistedSession(operationRevision)
    } catch {
      if (isCurrent(operationRevision)) {
        publish({ stage: 'unavailable', message: 'Service en ligne indisponible.', canRetry: true })
      }
    }
  }

  const authenticate = async (
    mode: TitleAccountMode,
    credentials: OnlineAccountCredentials,
  ): Promise<void> => {
    if (destroyed || state.stage !== 'signed-out') return
    resetConflicts()
    resetLocalImport()
    const operationRevision = beginOperation()
    const preparation = new AbortController()
    activeAuthorization = preparation
    publish({ stage: 'authenticating', mode })
    try {
      const authentication = await awaitWithTimeout(
        (async () => {
          const authenticated = mode === 'login'
            ? await options.session.login(credentials, preparation.signal)
            : await options.session.register(credentials, preparation.signal)
          await options.onAuthenticated?.(authenticated.account, credentials, preparation.signal)
          return authenticated
        })(),
        operationTimeoutMs,
        authenticationTimeout,
        preparation,
      )
      if (!isCurrent(operationRevision)) return
      if (!isCurrent(operationRevision) || preparation.signal.aborted) return
      if (activeAuthorization === preparation) activeAuthorization = undefined
      await authorize(onlineAccess(authentication.account), operationRevision)
    } catch (error) {
      if (!isCurrent(operationRevision)) return
      options.session.clear?.()
      if (error === authenticationTimeout) {
        publish({
          stage: 'signed-out',
          mode,
          message: mode === 'login' ? 'Connexion trop lente.' : 'Création trop lente.',
        })
        return
      }
      if (preparation.signal.aborted) return
      publish({
        stage: 'signed-out',
        mode,
        message: safeErrorMessage(
          error,
          mode === 'login' ? 'Connexion impossible.' : 'Création impossible.',
          credentials.password,
        ),
      })
    } finally {
      if (activeAuthorization === preparation) activeAuthorization = undefined
    }
  }

  return Object.freeze({
    getState: () => state,
    subscribe(listener) {
      if (destroyed) return () => undefined
      listeners.add(listener)
      listener(state)
      return () => { listeners.delete(listener) }
    },
    open,
    close() {
      if (destroyed) return
      const authenticationWasPending = state.stage === 'authenticating'
      resetConflicts()
      resetLocalImport()
      beginOperation()
      if (authenticationWasPending) options.session.clear?.()
      publish({ stage: 'closed' })
    },
    selectMode(mode) {
      if (state.stage !== 'signed-out' || state.mode === mode) return
      publish({ stage: 'signed-out', mode })
    },
    login: (credentials) => authenticate('login', credentials),
    register: (credentials) => authenticate('register', credentials),
    async continueWithAccount() {
      if (destroyed || state.stage !== 'account-choice') return
      const account = state.account
      resetConflicts()
      resetLocalImport()
      const operationRevision = beginOperation()
      await authorize(onlineAccess(account), operationRevision)
    },
    async switchAccount() {
      if (destroyed || state.stage !== 'account-choice') return
      const operationRevision = beginOperation()
      const logout = new AbortController()
      activeAuthorization = logout
      publish({ stage: 'restoring' })
      try {
        await awaitWithTimeout(
          options.session.logout(),
          operationTimeoutMs,
          logoutTimeout,
          logout,
        )
        if (!isCurrent(operationRevision)) return
        options.session.clear?.()
        publish({ stage: 'signed-out', mode: 'login' })
      } catch {
        if (!isCurrent(operationRevision)) return
        publish({
          stage: 'unavailable',
          message: 'Déconnexion impossible.',
          canRetry: true,
        })
      } finally {
        if (activeAuthorization === logout) activeAuthorization = undefined
      }
    },
    retry() {
      return state.stage === 'unavailable' && state.canRetry ? open() : Promise.resolve()
    },
    async useLocal() {
      if (
        destroyed
        || !localAccessAllowed
        || state.stage === 'closed'
        || state.stage === 'authenticating'
        || state.stage === 'authorizing'
        || state.stage === 'authorized'
      ) return
      resetConflicts()
      resetLocalImport()
      const operationRevision = beginOperation()
      await authorize(localAccess, operationRevision)
    },
    async importLocalSaves() {
      if (state.stage !== 'local-import' || !pendingLocalImport) return
      const access = state.access
      localImportDecision = Object.freeze({
        choice: 'import',
        proposalId: pendingLocalImport.proposalId,
      })
      pendingLocalImport = undefined
      const operationRevision = beginOperation()
      await authorize(access, operationRevision)
    },
    async keepLocalSavesSeparate() {
      if (state.stage !== 'local-import' || !pendingLocalImport) return
      const access = state.access
      localImportDecision = Object.freeze({
        choice: 'keep-separate',
        proposalId: pendingLocalImport.proposalId,
      })
      pendingLocalImport = undefined
      const operationRevision = beginOperation()
      await authorize(access, operationRevision)
    },
    async useAccountCache() {
      if (state.stage !== 'catalog-error' && state.stage !== 'catalog-conflict') return
      if (state.access.kind !== 'online') return
      const account = state.access.account
      resetConflicts()
      const operationRevision = beginOperation()
      await authorize(Object.freeze({ kind: 'account-cache', account }), operationRevision)
    },
    async useLocalConflict() {
      if (state.stage !== 'catalog-conflict' || !pendingConflict) return
      if (!pendingConflict.choices.includes('local')) return
      const access = state.access
      remoteConflictResolutions.set(pendingConflict.slot, Object.freeze({
        choice: 'local',
        remoteEtag: pendingConflict.remoteEtag,
        localVersion: pendingConflict.localVersion,
      }))
      pendingConflict = undefined
      const operationRevision = beginOperation()
      await authorize(access, operationRevision)
    },
    async useCloudConflict() {
      if (state.stage !== 'catalog-conflict' || !pendingConflict) return
      if (!pendingConflict.choices.includes('remote')) return
      const access = state.access
      remoteConflictResolutions.set(pendingConflict.slot, Object.freeze({
        choice: 'remote',
        remoteEtag: pendingConflict.remoteEtag,
        localVersion: pendingConflict.localVersion,
      }))
      pendingConflict = undefined
      const operationRevision = beginOperation()
      await authorize(access, operationRevision)
    },
    async retryCatalog() {
      if (state.stage !== 'catalog-error' && state.stage !== 'catalog-busy') return
      const access = state.access
      const operationRevision = beginOperation()
      await authorize(access, operationRevision)
    },
    reconnect() {
      if (state.stage !== 'catalog-error' || state.access.kind !== 'online') return
      resetConflicts()
      resetLocalImport()
      beginOperation()
      publish({ stage: 'signed-out', mode: 'login' })
    },
    showNotice(message) {
      const notice = safeNotice(message)
      if (!notice) return
      if (state.stage === 'account-choice') publish({ ...state, notice })
      else if (state.stage === 'signed-out') publish({ ...state, notice })
      else if (state.stage === 'unavailable') publish({ ...state, notice })
    },
    destroy() {
      if (destroyed) return
      const authenticationWasPending = state.stage === 'authenticating'
      resetConflicts()
      resetLocalImport()
      beginOperation()
      if (authenticationWasPending) options.session.clear?.()
      state = Object.freeze({ stage: 'closed' })
      destroyed = true
      listeners.clear()
    },
  })
}
