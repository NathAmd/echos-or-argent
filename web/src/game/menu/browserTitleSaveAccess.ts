import type { RomInventory } from '../../ndsTypes'
import {
  hasOnlineAccountEntitlement,
  type OnlineAccount,
  type OnlineAccountAccessSnapshot,
  type OnlineAccountCredentials,
  type OnlineAccountSession,
} from '../../online/onlineAccountSession'
import type { OnlineClientConfig } from '../../online/onlineClientConfig'
import {
  createOnlineVaultKeyring,
  type OnlineVaultKeyring,
} from '../../online/onlineVaultKeyring'
import {
  createHgssFullSaveCloudVaultClient,
  type HgssFullSaveCloudPresentSnapshot,
  type HgssFullSaveCloudRomIdentity,
  type HgssFullSaveCloudVaultClient,
} from '../save/hgssFullSaveCloudVault'
import {
  deleteHgssBrowserSaveSlotIfStorageUnchanged,
  enumerateHgssBrowserSaveDeletionTransitionTokens,
  inspectHgssBrowserSaveSlot,
  hgssBrowserSaveSlotCount,
  type HgssBrowserSaveConditionalDeletion,
  type HgssBrowserSaveSlot,
  type HgssBrowserSaveSlotDeletionToken,
  type HgssBrowserSaveSlotRecord,
} from '../save/hgssSaveStorage'
import type {
  TitleSaveCatalogAccess,
  TitleSaveCatalogConflictResolutions,
  TitleSaveCatalogLocalImportDecision,
} from './titleAccountGateCoordinator'
import {
  applyHgssTitleCloudDeletedSlot,
  applyHgssTitleCloudSaveSlot,
  readHgssTitleSaveCatalog,
  type TitleSaveCatalog,
} from './titleSaveCatalog'
import {
  createTitleSaveCloudCoordinator,
  type TitleSaveCloudCoordinator,
  type TitleSaveCloudLocalConflictVersion,
  type TitleSaveCloudReconciliation,
} from './titleSaveCloudCoordinator'
import { createTitleSaveCloudCausalStore } from './titleSaveCloudCausalStore'
import {
  createSwitchableTitleSaveStorage,
  createTitleSaveTombstoneStore,
  fingerprintTitleSaveStorageToken,
  type SwitchableTitleSaveStorage,
  type TitleSaveTombstoneContext,
} from './titleSaveStorageScope'
import {
  createTitleSaveCampaignLeaseManager,
  TitleSaveCampaignBusyError,
  titleSaveCampaignLeaseKey,
  type TitleSaveCampaignLease,
  type TitleSaveCampaignLeaseManager,
  type TitleSaveCampaignLeaseScope,
} from './titleSaveCampaignLease'
import {
  applyTitleSaveLocalAccountImport,
  createTitleSaveLocalAccountImportProposal,
  titleSaveLocalAccountImportConsent,
  type TitleSaveLocalAccountImportProposal,
} from './titleSaveLocalAccountImport'

type SaveStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
type HgssDataOnlySaveDocument = HgssFullSaveCloudPresentSnapshot['document']
type AccountSession = Pick<
  OnlineAccountSession,
  'getAccount' | 'readAccessToken' | 'subscribeAccess'
>

export type BrowserTitleSaveAuthorizationResult = Readonly<{
  catalog: TitleSaveCatalog
  identity: string
  cloud?: TitleSaveCloudReconciliation
}>

type BrowserTitleSaveNoteSaved = (
  slot: HgssBrowserSaveSlot,
  document: HgssDataOnlySaveDocument,
  record: Pick<HgssBrowserSaveSlotRecord, 'savedAt' | 'kind'>,
) => void

export type BrowserTitleSaveCampaignStorage = SaveStorage & Readonly<{
  getScope: SwitchableTitleSaveStorage['getScope']
  noteSaved: BrowserTitleSaveNoteSaved
}>

export type BrowserTitleSaveCampaignInvalidationReason = 'session-ended' | 'account-changed'

/** Événement volontairement borné : aucune identité ni donnée de session ne le traverse. */
export type BrowserTitleSaveCampaignInvalidationEvent = Readonly<{
  reason: BrowserTitleSaveCampaignInvalidationReason
  checkpointSaved: boolean
}>

export type BrowserTitleSaveAccess = Readonly<{
  /** Façade stable utilisée par la campagne après publication de l’autorisation. */
  campaignStorage: BrowserTitleSaveCampaignStorage
  prepareAuthentication: (
    account: OnlineAccount,
    credentials: OnlineAccountCredentials,
    signal: AbortSignal,
  ) => Promise<void>
  authorize: (
    access: TitleSaveCatalogAccess,
    inventory: RomInventory,
    romIdentity: HgssFullSaveCloudRomIdentity,
    signal: AbortSignal,
    conflictResolutions?: TitleSaveCatalogConflictResolutions,
    localImportDecision?: TitleSaveCatalogLocalImportDecision,
  ) => Promise<BrowserTitleSaveAuthorizationResult>
  noteSaved: BrowserTitleSaveNoteSaved
  deleteSlot: (
    slot: HgssBrowserSaveSlot,
    expectedToken: HgssBrowserSaveSlotDeletionToken,
  ) => Promise<HgssBrowserSaveConditionalDeletion>
  /** Ferme l'autorisation courante et libère son verrou de campagne. */
  deactivateCloud: () => void
  hasPendingCloud: () => boolean
  flushCloud: () => Promise<void>
  destroy: () => void
}>

function abortError(): DOMException {
  return new DOMException('Autorisation des sauvegardes annulée.', 'AbortError')
}

function requireRomIdentity(value: HgssFullSaveCloudRomIdentity): HgssFullSaveCloudRomIdentity {
  if (
    !Number.isSafeInteger(value.gameVersion)
    || value.gameVersion < 0
    || value.gameVersion > 0xff
    || !Number.isSafeInteger(value.language)
    || value.language < 0
    || value.language > 0xff
  ) throw new Error('L’identité ROM des sauvegardes cloud est invalide.')
  return Object.freeze({ gameVersion: value.gameVersion, language: value.language })
}

export class TitleSaveLocalAccountImportRequiredError extends Error {
  readonly proposalId: number
  readonly transferCount: number

  constructor(proposalId: number, transferCount: number) {
    super('Une sauvegarde locale peut rejoindre ce compte.')
    this.name = 'TitleSaveLocalAccountImportRequiredError'
    this.proposalId = proposalId
    this.transferCount = transferCount
  }
}

type PendingLocalAccountImport = Readonly<{
  proposalId: number
  serverUrl: string
  accountId: string
  gameCode: string
  gameVersion: number
  language: number
  proposal: TitleSaveLocalAccountImportProposal
}>

type AcceptedSeparateLocalAccountImport = Readonly<{
  proposalId: number
  serverUrl: string
  accountId: string
  gameCode: string
  gameVersion: number
  language: number
}>

export function createBrowserTitleSaveAccess(options: {
  storage: SaveStorage
  keyStorage?: SaveStorage
  config?: OnlineClientConfig
  accountSession: AccountSession
  reportStatus?: (message: string) => void
  /** Dernier checkpoint synchrone, exécuté tant que la façade campagne est ouverte. */
  prepareCampaignInvalidation?: () => boolean
  /** Notification synchrone, exécutée seulement après fermeture complète de la façade. */
  onCampaignInvalidated?: (event: BrowserTitleSaveCampaignInvalidationEvent) => void
  keyring?: OnlineVaultKeyring
  vault?: HgssFullSaveCloudVaultClient
  cloudCoordinator?: TitleSaveCloudCoordinator
  campaignLeaseManager?: TitleSaveCampaignLeaseManager
  fingerprintStorageToken?: typeof fingerprintTitleSaveStorageToken
  now?: () => Date
}): BrowserTitleSaveAccess {
  let activeLease: TitleSaveCampaignLease | undefined
  let campaignStorageReady = false
  const scopedCampaignStorage = createSwitchableTitleSaveStorage(options.storage)
  const requireCampaignLease = (): void => {
    if (!activeLease || !campaignStorageReady) {
      throw new Error('Le sas de sauvegarde doit être rouvert avant la campagne.')
    }
  }
  const campaignStorage: BrowserTitleSaveCampaignStorage = Object.freeze({
    getItem(key) { requireCampaignLease(); return scopedCampaignStorage.getItem(key) },
    setItem(key, value) { requireCampaignLease(); scopedCampaignStorage.setItem(key, value) },
    removeItem(key) { requireCampaignLease(); scopedCampaignStorage.removeItem(key) },
    getScope: scopedCampaignStorage.getScope,
    noteSaved(slot, document, record) { noteCampaignSave(slot, document, record) },
  })
  const tombstones = createTitleSaveTombstoneStore(options.storage, { now: options.now })
  const causalAnchors = createTitleSaveCloudCausalStore(options.storage)
  const keyring = options.keyring ?? (options.config
      ? createOnlineVaultKeyring({
        serverUrl: options.config.identityBaseUrl,
        storage: options.keyStorage ?? options.storage,
      })
    : undefined)
  let cloudOwnerId: string | undefined
  let activeRomIdentity: HgssFullSaveCloudRomIdentity | undefined
  let activeTombstoneContext: TitleSaveTombstoneContext | undefined
  let activeGameCode: string | undefined
  let authorizationEpoch = 0
  let localImportProposalId = 0
  let pendingLocalImport: PendingLocalAccountImport | undefined
  let acceptedSeparateLocalImport: AcceptedSeparateLocalAccountImport | undefined
  const vault = options.vault ?? (options.config
    ? createHgssFullSaveCloudVaultClient({
        config: options.config,
        readAccessToken: options.accountSession.readAccessToken,
        readOwnerId: () => cloudOwnerId,
      })
    : undefined)
  const cloud = options.cloudCoordinator ?? (vault
    ? createTitleSaveCloudCoordinator({ vault, reportStatus: options.reportStatus })
    : undefined)
  const campaignLeases = options.campaignLeaseManager ?? createTitleSaveCampaignLeaseManager()
  const fingerprintStorageToken = options.fingerprintStorageToken ?? fingerprintTitleSaveStorageToken
  let observedAccountId = options.accountSession.getAccount()?.id
  let observedSessionAuthorized = observedAccountId !== undefined
  let accountIdentityEpoch = 0
  let campaignInvalidationInProgress = false

  const reportInvalidationHookFailure = (message: string): void => {
    try { options.reportStatus?.(message) }
    catch { /* Le diagnostic ne doit jamais rouvrir ni retenir la campagne. */ }
  }

  const deactivateCloudTransport = (): void => {
    cloud?.deactivate()
    cloudOwnerId = undefined
  }

  const clearLocalImportChoice = (): void => {
    pendingLocalImport = undefined
    acceptedSeparateLocalImport = undefined
  }

  const invalidateCampaignContext = (): void => {
    authorizationEpoch += 1
    campaignStorageReady = false
    deactivateCloudTransport()
    activeRomIdentity = undefined
    activeTombstoneContext = undefined
    activeGameCode = undefined
  }

  const releaseAuthorization = (): void => {
    invalidateCampaignContext()
    clearLocalImportChoice()
    activeLease?.release()
    activeLease = undefined
  }

  const acquireCampaignLease = async (
    scope: TitleSaveCampaignLeaseScope,
    signal: AbortSignal,
  ): Promise<void> => {
    const requestedKey = titleSaveCampaignLeaseKey(scope)
    if (activeLease?.key === requestedKey) {
      invalidateCampaignContext()
      return
    }
    releaseAuthorization()
    const acquired = await campaignLeases.acquire(scope, signal)
    if (!acquired) {
      throw new TitleSaveCampaignBusyError()
    }
    if (signal.aborted) {
      acquired.release()
      throw abortError()
    }
    activeLease = acquired
  }

  const unsubscribe = options.accountSession.subscribeAccess((snapshot: OnlineAccountAccessSnapshot) => {
    const nextAccountId = snapshot.account?.id
    const nextSessionAuthorized = snapshot.signedIn && nextAccountId !== undefined
    if (
      nextAccountId !== observedAccountId
      || nextSessionAuthorized !== observedSessionAuthorized
    ) {
      observedAccountId = nextAccountId
      observedSessionAuthorized = nextSessionAuthorized
      accountIdentityEpoch += 1
      // La notification d'identité est la barrière synchrone entre comptes :
      // aucune opération retardée d'Alice ne doit pouvoir republier sa façade,
      // son coffre ou son verrou après un logout ou une bascule vers Bob.
      if (campaignInvalidationInProgress) return
      const campaignWasAuthorized = campaignStorageReady && activeLease !== undefined
      if (campaignWasAuthorized) {
        campaignInvalidationInProgress = true
        let checkpointSaved = false
        try {
          try { checkpointSaved = options.prepareCampaignInvalidation?.() === true }
          catch {
            reportInvalidationHookFailure(
              'La progression n’a pas pu être confirmée avant la fermeture de la campagne.',
            )
          }
          releaseAuthorization()
          keyring?.clearMemory()
          const event: BrowserTitleSaveCampaignInvalidationEvent = Object.freeze({
            reason: nextSessionAuthorized ? 'account-changed' : 'session-ended',
            checkpointSaved,
          })
          try { options.onCampaignInvalidated?.(event) }
          catch {
            reportInvalidationHookFailure(
              'La campagne est fermée, mais son retour au sas n’a pas pu être présenté.',
            )
          }
        } finally {
          campaignInvalidationInProgress = false
        }
        return
      }
      releaseAuthorization()
      keyring?.clearMemory()
      return
    }
    if (
      cloudOwnerId
      && (snapshot.account?.id !== cloudOwnerId || !snapshot.cloudStorage)
    ) {
      deactivateCloudTransport()
      keyring?.clearMemory()
    }
  })

  function noteCampaignSave(
    slot: HgssBrowserSaveSlot,
    document: HgssDataOnlySaveDocument,
    record: Pick<HgssBrowserSaveSlotRecord, 'savedAt' | 'kind'>,
  ): void {
    const romIdentity = activeRomIdentity
    const tombstoneContext = activeTombstoneContext
    const gameCode = activeGameCode
    if (!romIdentity || !tombstoneContext || !gameCode) return
    tombstones.clear(tombstoneContext, slot)
    const snapshot: HgssFullSaveCloudPresentSnapshot = Object.freeze({
      kind: 'present',
      slot,
      romIdentity,
      savedAt: record.savedAt,
      saveKind: record.kind,
      document,
    })
    if (cloudOwnerId === tombstoneContext.accountId) {
      const inspection = inspectHgssBrowserSaveSlot(campaignStorage, gameCode, slot)
      cloud?.enqueuePresent(
        snapshot,
        inspection.kind === 'empty'
          ? undefined
          : Object.freeze({
              storageToken: inspection.deletionToken,
              tombstoneChangedAt: null,
            }),
      )
    }
  }

  return Object.freeze({
    campaignStorage,
    async prepareAuthentication(account, credentials, signal) {
      if (!hasOnlineAccountEntitlement(account, 'cloud-storage')) return
      if (!keyring) throw new Error('Le coffre cloud n’est pas configuré.')
      if (signal.aborted) throw abortError()
      const operationAccountEpoch = accountIdentityEpoch
      await keyring.unlock(account, credentials.password, signal)
      if (
        signal.aborted
        || operationAccountEpoch !== accountIdentityEpoch
        || !observedSessionAuthorized
        || options.accountSession.getAccount()?.id !== account.id
      ) {
        keyring.clearMemory()
        throw abortError()
      }
    },
    async authorize(
      access,
      inventory,
      romIdentityValue,
      signal,
      conflictResolutions = new Map(),
      localImportDecision,
    ) {
      const candidate = createSwitchableTitleSaveStorage(options.storage)
      let cloudResult: TitleSaveCloudReconciliation | undefined
      const romIdentity = requireRomIdentity(romIdentityValue)
      const accountScoped = access.kind !== 'local'
      const requiresCloud = access.kind === 'online'
        && hasOnlineAccountEntitlement(access.account, 'cloud-storage')
      if (
        accountScoped
        && (
          !observedSessionAuthorized
          || options.accountSession.getAccount()?.id !== access.account.id
        )
      ) throw abortError()
      if (!accountScoped) {
        candidate.selectLocal()
        deactivateCloudTransport()
        await acquireCampaignLease({
          kind: 'local',
          gameCode: inventory.metadata.gameCode,
        }, signal)
      } else {
        if (!options.config) throw new Error('Le serveur en ligne n’est pas configuré.')
        candidate.selectOnline(options.config.identityBaseUrl, access.account.id)
        await acquireCampaignLease({
          kind: 'online',
          serverUrl: options.config.identityBaseUrl,
          accountId: access.account.id,
          gameCode: inventory.metadata.gameCode,
        }, signal)
      }

      const operationEpoch = authorizationEpoch
      const operationLease = activeLease
      const operationAccountEpoch = accountIdentityEpoch
      const assertAuthorizationCurrent = (): void => {
        if (
          signal.aborted
          || operationEpoch !== authorizationEpoch
          || operationAccountEpoch !== accountIdentityEpoch
          || !operationLease
          || activeLease !== operationLease
        ) throw abortError()
        if (access.kind === 'online') {
          const currentAccount = options.accountSession.getAccount()
          if (
            !observedSessionAuthorized
            || currentAccount?.id !== access.account.id
            || requiresCloud && !hasOnlineAccountEntitlement(currentAccount, 'cloud-storage')
          ) throw abortError()
        } else if (access.kind === 'account-cache') {
          if (!observedSessionAuthorized || observedAccountId !== access.account.id) throw abortError()
        }
      }
      const deactivateCloudTransportIfOperationCurrent = (): void => {
        if (
          operationEpoch === authorizationEpoch
          && operationLease === activeLease
        ) deactivateCloudTransport()
      }
      assertAuthorizationCurrent()
      const tombstoneContext: TitleSaveTombstoneContext | undefined = accountScoped
        ? Object.freeze({
            serverUrl: options.config!.identityBaseUrl,
            accountId: access.account.id,
            gameCode: inventory.metadata.gameCode,
            romIdentity,
          })
        : undefined
      const localTombstones = tombstoneContext
        ? new Map(tombstones.read(tombstoneContext))
        : new Map<HgssBrowserSaveSlot, never>()
      if (tombstoneContext) {
        for (let value = 1; value <= hgssBrowserSaveSlotCount; value += 1) {
          const slot = value as HgssBrowserSaveSlot
          const tombstone = localTombstones.get(slot)
          if (!tombstone?.supersededStorageHashes) continue
          const inspection = inspectHgssBrowserSaveSlot(candidate, inventory.metadata.gameCode, slot)
          if (inspection.kind === 'empty') continue
          const currentHash = await fingerprintStorageToken(inspection.deletionToken)
          assertAuthorizationCurrent()
          if (tombstone.supersededStorageHashes.includes(currentHash)) {
            deleteHgssBrowserSaveSlotIfStorageUnchanged(
              candidate,
              inventory.metadata.gameCode,
              slot,
              inspection.deletionToken,
            )
          }
        }
      }

      let catalog = readHgssTitleSaveCatalog(candidate, inventory)
      assertAuthorizationCurrent()
      if (access.kind === 'online') {
        const localCandidate = createSwitchableTitleSaveStorage(options.storage)
        localCandidate.selectLocal()
        const localCatalog = readHgssTitleSaveCatalog(localCandidate, inventory)
        assertAuthorizationCurrent()
        const destination = candidate.getScope()
        if (destination.kind !== 'online') {
          throw new Error("Le cache cible de l'importation locale est indisponible.")
        }
        const proposal = createTitleSaveLocalAccountImportProposal({
          localCatalog,
          accountCatalog: catalog,
          accountTombstones: localTombstones,
          destination,
        })
        const matchesBinding = (value: {
          proposalId: number
          serverUrl: string
          accountId: string
          gameCode: string
          gameVersion: number
          language: number
        } | undefined): boolean => Boolean(
          value
          && value.proposalId === localImportDecision?.proposalId
          && value.serverUrl === destination.serverUrl
          && value.accountId === access.account.id
          && value.gameCode === inventory.metadata.gameCode
          && value.gameVersion === romIdentity.gameVersion
          && value.language === romIdentity.language,
        )
        if (proposal.transfers.length > 0) {
          if (matchesBinding(pendingLocalImport)) {
            const pending = pendingLocalImport!
            if (localImportDecision?.choice === 'import') {
              if (tombstoneContext) {
                // Invalide la parenté avant la première copie : même un crash
                // entre deux slots ne peut pas greffer l'import sur une ancienne
                // mutation distante ni laisser une ancienne suppression effacer
                // les octets que le joueur vient explicitement de réimporter.
                for (const transfer of pending.proposal.transfers) {
                  causalAnchors.clear(tombstoneContext, transfer.slot)
                  tombstones.clear(tombstoneContext, transfer.slot)
                  localTombstones.delete(transfer.slot)
                }
              }
              try {
                applyTitleSaveLocalAccountImport({
                  sourceStorage: localCandidate,
                  destinationStorage: candidate,
                  gameCode: inventory.metadata.gameCode,
                  proposal: pending.proposal,
                  consent: titleSaveLocalAccountImportConsent,
                })
              } catch (error) {
                pendingLocalImport = undefined
                throw error
              }
              catalog = readHgssTitleSaveCatalog(candidate, inventory)
            } else if (localImportDecision?.choice === 'keep-separate') {
              acceptedSeparateLocalImport = Object.freeze({
                proposalId: pending.proposalId,
                serverUrl: pending.serverUrl,
                accountId: pending.accountId,
                gameCode: pending.gameCode,
                gameVersion: pending.gameVersion,
                language: pending.language,
              })
            } else throw new Error("Le choix d'importation locale est invalide.")
            pendingLocalImport = undefined
          } else if (!matchesBinding(acceptedSeparateLocalImport)) {
            localImportProposalId = localImportProposalId >= Number.MAX_SAFE_INTEGER
              ? 1
              : localImportProposalId + 1
            pendingLocalImport = Object.freeze({
              proposalId: localImportProposalId,
              serverUrl: destination.serverUrl,
              accountId: access.account.id,
              gameCode: inventory.metadata.gameCode,
              gameVersion: romIdentity.gameVersion,
              language: romIdentity.language,
              proposal,
            })
            throw new TitleSaveLocalAccountImportRequiredError(
              localImportProposalId,
              proposal.transfers.length,
            )
          }
        } else if (pendingLocalImport?.accountId === access.account.id) {
          pendingLocalImport = undefined
        }
        assertAuthorizationCurrent()
      }
      if (requiresCloud) {
        if (!cloud || !keyring) throw new Error('Le coffre cloud n’est pas configuré.')
        const key = await keyring.restore(access.account)
        assertAuthorizationCurrent()
        if (!key) throw new Error('Reconnectez-vous pour déverrouiller le coffre cloud.')
        cloudOwnerId = access.account.id
        if (!tombstoneContext) throw new Error('Le journal de suppression du compte est indisponible.')
        const readLocalVersion = (slot: HgssBrowserSaveSlot): TitleSaveCloudLocalConflictVersion => {
          const inspection = inspectHgssBrowserSaveSlot(
            candidate,
            inventory.metadata.gameCode,
            slot,
          )
          const tombstone = tombstones.read(tombstoneContext).get(slot)
          return Object.freeze({
            storageToken: inspection.kind === 'empty' ? null : inspection.deletionToken,
            tombstoneChangedAt: tombstone?.changedAt ?? null,
          })
        }
        try {
          cloudResult = await cloud.authorize({
            key,
            romIdentity,
            localDocuments: catalog.documents,
            localTombstones,
            corruptSlots: new Map([...catalog.corruptSaves].map(([slot, save]) => [slot, save.deletionToken])),
            remoteConflictResolutions: conflictResolutions,
            causalAnchors: causalAnchors.read(tombstoneContext),
            readLocalVersion,
            persistCausalAnchor: (slot, anchor) => {
              causalAnchors.write(tombstoneContext, slot, anchor)
            },
            clearCausalAnchor: (slot) => {
              causalAnchors.clear(tombstoneContext, slot)
            },
            applyPresent: (slot, expected, snapshot) => {
              applyHgssTitleCloudSaveSlot(
                candidate,
                inventory.metadata.gameCode,
                slot,
                expected,
                snapshot.document,
                snapshot.saveKind,
                snapshot.savedAt,
              )
            },
            applyDeleted: (slot, document) => {
              applyHgssTitleCloudDeletedSlot(
                candidate,
                inventory.metadata.gameCode,
                slot,
                document.storageToken,
              )
            },
            applyCorruptDeleted: (slot, storageToken) => {
              applyHgssTitleCloudDeletedSlot(
                candidate,
                inventory.metadata.gameCode,
                slot,
                storageToken,
              )
            },
            persistLocalTombstone: (slot, changedAt, supersededStorageHashes) => {
              tombstones.write(tombstoneContext, slot, changedAt, supersededStorageHashes)
            },
            clearLocalTombstone: (slot) => {
              tombstones.clear(tombstoneContext, slot)
            },
            signal,
          })
        } catch (error) {
          deactivateCloudTransportIfOperationCurrent()
          throw error
        }
        catalog = readHgssTitleSaveCatalog(candidate, inventory)
      } else {
        deactivateCloudTransport()
      }

      try {
        assertAuthorizationCurrent()
      } catch (error) {
        deactivateCloudTransportIfOperationCurrent()
        throw error
      }
      if (!accountScoped) scopedCampaignStorage.selectLocal()
      else scopedCampaignStorage.selectOnline(options.config!.identityBaseUrl, access.account.id)
      activeRomIdentity = accountScoped ? romIdentity : undefined
      activeGameCode = inventory.metadata.gameCode
      activeTombstoneContext = accountScoped
        ? tombstoneContext
        : undefined
      campaignStorageReady = true
      clearLocalImportChoice()
      return Object.freeze({
        catalog,
        identity: accountScoped
          ? access.kind === 'account-cache' ? `${access.account.username} · hors ligne` : access.account.username
          : 'Local',
        ...(cloudResult ? { cloud: cloudResult } : {}),
      })
    },
    noteSaved: noteCampaignSave,
    async deleteSlot(slot, expectedToken) {
      const operationEpoch = authorizationEpoch
      const operationLease = activeLease
      const gameCode = activeGameCode
      const romIdentity = activeRomIdentity
      const tombstoneContext = activeTombstoneContext
      if (!gameCode || !operationLease || !campaignStorageReady) {
        throw new Error('Aucune campagne autorisée ne peut être supprimée.')
      }
      const supersededStorageHashes = tombstoneContext
        ? await Promise.all(
            enumerateHgssBrowserSaveDeletionTransitionTokens(expectedToken)
              .map((token) => fingerprintStorageToken(token)),
          )
        : undefined
      if (
        operationEpoch !== authorizationEpoch
        || gameCode !== activeGameCode
        || activeLease !== operationLease
      ) throw abortError()
      let durableTombstone: ReturnType<typeof tombstones.write> | undefined
      try {
        return deleteHgssBrowserSaveSlotIfStorageUnchanged(
          campaignStorage,
          gameCode,
          slot,
          expectedToken,
          tombstoneContext
            ? () => {
                durableTombstone = tombstones.write(
                  tombstoneContext,
                  slot,
                  undefined,
                  supersededStorageHashes,
                )
              }
            : undefined,
        )
      } finally {
        if (
          durableTombstone
          && romIdentity
          && tombstoneContext
          && cloudOwnerId === tombstoneContext.accountId
        ) {
          cloud?.enqueueDeleted(
            slot,
            romIdentity,
            durableTombstone.changedAt,
            Object.freeze({
              storageToken: null,
              tombstoneChangedAt: durableTombstone.changedAt,
            }),
          )
        }
      }
    },
    deactivateCloud: releaseAuthorization,
    hasPendingCloud: () => cloud?.hasPending() ?? false,
    flushCloud: () => cloud?.flush() ?? Promise.resolve(),
    destroy() {
      releaseAuthorization()
      keyring?.clearMemory()
      unsubscribe()
    },
  })
}
