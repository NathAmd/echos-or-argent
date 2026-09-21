import type { GameDigitalAction } from '../../gameInput'
import { hgssUtilityMenuSoundEffects } from '../menu/utilityMenuInputHost'
import type { RomInventory } from '../../ndsTypes'
import type { GameAccessDecision, GameAccessFeature } from '../access/gameFeatureAccess'
import { cloneFieldScriptState, type FieldScriptState } from '../scripts/fieldScriptRunner'
import type { VersionedSaveExtensions } from '../save/versionedSaveExtensions'
import {
  hgssBrowserSaveSlotCount,
  readHgssBrowserSaveSlot,
  type HgssBrowserSaveKind,
  type HgssBrowserSaveSlot,
  type HgssBrowserSaveSlotDeletionToken,
  type HgssBrowserSaveConditionalDeletion,
  type HgssBrowserSaveSlotRecord,
} from '../save/hgssSaveStorage'
import {
  createHgssDataOnlyBrowserSaveSlotIfEmpty,
  writeHgssDataOnlyBrowserSaveSlot,
} from '../save/hgssDataOnlySaveStorage'
import type { HgssDataOnlySaveDocument } from '../save/hgssDataOnlySaveDocument'
import type { TitleMenuController, TitleMenuResult, TitleMenuState } from '../menu/titleMenuController'
import { createTitleMenuPresentationModel, type TitleMenuCorruptSavePreview, type TitleMenuSavePreview } from '../menu/titleMenuPresentationModel'
import { createTitleSaveManagementRuntime } from '../menu/titleSaveManagementRuntime'
import { createTitleSaveDeletionUi } from '../menu/titleSaveDeletionUi'
import { createBrowserTitleSaveBackupFilePort, type TitleSaveBackupFilePort } from '../menu/browserTitleSaveBackupFiles'
import { createTitleSaveBackupRuntime } from '../menu/titleSaveBackupRuntime'
import type { TitleSaveCatalog } from '../menu/titleSaveCatalog'
import { syncTitleMenuPresentation, type TitleMenuActionId } from '../ui/titleMenuPresentation'
import { createBuiltInNewGamePlusRegistry, type NewGamePlusProfileV1 } from './index'
import { isNewGamePlusSourceForGameCode } from './newGamePlusProfile'
import { createNewGamePlusCreationUi } from './newGamePlusCreationUi'
import { createNewGamePlusCreationModuleOption } from './newGamePlusCreationConfigChoices'
import { createNewGamePlusUnlockNotice, type NewGamePlusUnlockNotice } from './newGamePlusUnlockNotice'
import { hasUnlockedNewGamePlusFromKantoLeague } from './newGamePlusEligibility'
import { createNewGamePlusEntitlementRuntime } from './newGamePlusEntitlementRuntime'
import { runTitleCampaignResumeTransaction } from './titleCampaignResumeTransaction'

type CampaignStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & Partial<{
  noteSaved: (
    slot: HgssBrowserSaveSlot,
    document: HgssDataOnlySaveDocument,
    record: HgssBrowserSaveSlotRecord,
  ) => void
}>
export type TitleCampaignActivationKind = 'new' | 'resume' | 'normal'

type TitleCampaignCoordinatorOptions = {
  host: HTMLElement
  menuRoot: HTMLElement
  menu: TitleMenuController
  storage: CampaignStorage
  readInventory: () => RomInventory | undefined
  readSaves: () => ReadonlyMap<HgssBrowserSaveSlot, TitleMenuSavePreview>
  readCorruptSaves: () => ReadonlyMap<HgssBrowserSaveSlot, TitleMenuCorruptSavePreview>
  createPokemonIcon: Parameters<typeof createTitleMenuPresentationModel>[0]['createPokemonIcon']
  onResume: (slot: HgssBrowserSaveSlot, save: TitleMenuSavePreview) => void
  onBegin: (slot: HgssBrowserSaveSlot) => void
  onExit?: () => void
  /** Active les règles avant que l'introduction ou la reprise ne crée ses contrôleurs. */
  onActivateProfile?: (profile: NewGamePlusProfileV1 | undefined, extensions: VersionedSaveExtensions | undefined, kind: TitleCampaignActivationKind) => void
  deleteSave: (
    slot: HgssBrowserSaveSlot,
    deletionToken: HgssBrowserSaveSlotDeletionToken,
  ) => Promise<HgssBrowserSaveConditionalDeletion>
  onDelete: (slot: HgssBrowserSaveSlot) => void
  reportStatus: (message: string) => void
  playSoundEffect?: (sequenceId: number) => void
  backupFiles?: TitleSaveBackupFilePort
  /** Point d'injection du futur droit serveur. Absent aujourd'hui : accès inchangé. */
  checkFeatureAccess?: (feature: GameAccessFeature) => GameAccessDecision
  /** Autorisé seulement par le banc `?test=1`, jamais par le menu publié. */
  allowPreparedNewGamePlusStart?: boolean
}

export type PreparedNewGamePlusDevelopmentStart = Readonly<{
  profile: unknown
  source: FieldScriptState
  targetSlot: HgssBrowserSaveSlot
}>

export type TitleCampaignCoordinator = {
  render: (state?: TitleMenuState) => void
  open: () => void
  applyMenuResult: (result: TitleMenuResult) => boolean
  handleMenuInput: (action: GameDigitalAction) => boolean
  focusMenuControl: (button: HTMLButtonElement) => void
  activateMenuControl: (button: HTMLButtonElement) => void
  resetForRom: () => void
  reconcileEntitlement: (inventory: RomInventory) => readonly string[]
  getActiveProfile: () => NewGamePlusProfileV1 | undefined
  beginPreparedNewGamePlusForDevelopment: (request: PreparedNewGamePlusDevelopmentStart) => NewGamePlusProfileV1
  startNormalCampaign: () => void
  applyPendingStart: (destination: FieldScriptState) => FieldScriptState
  writeSaveSlot: (gameCode: string, slot: HgssBrowserSaveSlot, value: HgssDataOnlySaveDocument, kind: HgssBrowserSaveKind) => HgssBrowserSaveSlotRecord
  noteGameClear: (firstClear: boolean) => void
  completeFieldScript: (saved: boolean, savedAt: string | undefined, sourceSlot: HgssBrowserSaveSlot) => void
  cancelPendingGameClear: () => void
  handleUi: (action: GameDigitalAction) => boolean
  isUiOpen: () => boolean
}

export function createTitleCampaignCoordinator(options: TitleCampaignCoordinatorOptions): TitleCampaignCoordinator {
  const registry = createBuiltInNewGamePlusRegistry()
  let activeProfile: NewGamePlusProfileV1 | undefined
  let activeExtensions: VersionedSaveExtensions | undefined
  let activeActivationKind: TitleCampaignActivationKind = 'normal'
  let pendingStart: { profile: NewGamePlusProfileV1, source: FieldScriptState } | undefined
  let requireEmptySlot = false
  let refreshedCatalog: TitleSaveCatalog | undefined
  const readSaves = () => refreshedCatalog?.saves ?? options.readSaves()
  const readCorruptSaves = () => refreshedCatalog?.corruptSaves ?? options.readCorruptSaves()
  const playCursorSound = (): void => options.playSoundEffect?.(hgssUtilityMenuSoundEffects.cursor)
  const playSelectSound = (): void => options.playSoundEffect?.(hgssUtilityMenuSoundEffects.select)
  const notice: NewGamePlusUnlockNotice = createNewGamePlusUnlockNotice(options.host, () => entitlementRuntime.acknowledge())
  const entitlementRuntime = createNewGamePlusEntitlementRuntime(options.storage, {
    onUnlocked: () => notice.show(),
    reportStatus: options.reportStatus,
  })
  const setMenuInert = (inert: boolean): void => { options.menuRoot.inert = inert }
  const canUseNewGamePlus = (): boolean => {
    const decision = options.checkFeatureAccess?.('new-game-plus') ?? { allowed: true }
    if (decision.allowed) return true
    options.reportStatus(decision.reason === 'sign-in-required'
      ? 'Connectez-vous pour accéder au New Game+.'
      : 'Un abonnement actif est nécessaire pour accéder au New Game+.')
    return false
  }

  const deletion = createTitleSaveDeletionUi(options.host, {
    onConfirm: (details) => {
      const { slot } = details
      void (async () => {
        try {
          const result = await options.deleteSave(slot, details.deletionToken)
          if (result === 'changed') {
            throw new Error(`L’emplacement ${slot} a été modifié depuis la confirmation : suppression annulée.`)
          }
          refreshedCatalog?.saves.delete(slot)
          refreshedCatalog?.documents.delete(slot)
          refreshedCatalog?.corruptSaves.delete(slot)
          options.onDelete(slot)
          options.reportStatus(result === 'deleted'
            ? `Emplacement ${slot} supprimé. Les autres sauvegardes sont intactes.`
            : `L’emplacement ${slot} était déjà vide.`)
        } catch (error) {
          options.reportStatus(error instanceof Error ? error.message : `L’emplacement ${slot} ne peut pas être supprimé.`)
        } finally {
          setMenuInert(false)
          render(options.menu.getState())
        }
      })()
    },
    onCancel: () => { setMenuInert(false) },
  })

  const render = (state: TitleMenuState = options.menu.getState()): void => {
    options.menuRoot.classList.add('game-menu-title')
    options.menuRoot.classList.remove('game-menu-detail', 'ui-menu', 'ui-menu-root', 'ui-menu-detail')
    options.menuRoot.hidden = !state.open
    const inventory = options.readInventory()
    if (!state.open || !inventory) return
    syncTitleMenuPresentation(options.menuRoot, createTitleMenuPresentationModel({
      state,
      saves: readSaves(),
      corruptSaves: readCorruptSaves(),
      inventory,
      createPokemonIcon: options.createPokemonIcon,
    }))
  }

  const backup = createTitleSaveBackupRuntime({
    storage: options.storage,
    readInventory: options.readInventory,
    files: options.backupFiles ?? createBrowserTitleSaveBackupFilePort(),
    reportStatus: options.reportStatus,
    noteSaved: options.storage.noteSaved,
    onCatalogRefreshed: (catalog) => { refreshedCatalog = catalog },
    onBusyChange: (busy) => {
      setMenuInert(busy)
      if (!busy) render()
    },
  })

  const beginPreparedNewGamePlus = (request: PreparedNewGamePlusDevelopmentStart): NewGamePlusProfileV1 => {
    const inventory = options.readInventory()
    if (!inventory) throw new Error('La Nouvelle Partie+ exige une ROM chargée.')
    const profile = registry.restoreProfile(request.profile)
    if (!isNewGamePlusSourceForGameCode(profile.source, inventory.metadata.gameCode)) throw new Error('Le profil New Game+ ne correspond pas à la ROM chargée.')
    if (!hasUnlockedNewGamePlusFromKantoLeague(request.source.flags)) throw new Error('La source New Game+ ne prouve pas la victoire à la Ligue de Kanto.')
    if (profile.source.slot === request.targetSlot) throw new Error('Les emplacements source et cible New Game+ doivent être distincts.')
    if (readSaves().has(request.targetSlot) || readCorruptSaves().has(request.targetSlot)
      || readHgssBrowserSaveSlot(options.storage, inventory.metadata.gameCode, request.targetSlot)) {
      throw new Error(`L’emplacement ${request.targetSlot} est déjà occupé : aucune sauvegarde n’a été remplacée.`)
    }
    const previousCampaign = { activeProfile, activeExtensions, activeActivationKind, pendingStart, requireEmptySlot }
    try {
      options.onActivateProfile?.(profile, undefined, 'new')
      activeProfile = profile
      activeExtensions = undefined
      activeActivationKind = 'new'
      pendingStart = { profile, source: cloneFieldScriptState(request.source) }
      requireEmptySlot = true
      options.onBegin(request.targetSlot)
      return profile
    } catch (error) {
      activeProfile = previousCampaign.activeProfile
      activeExtensions = previousCampaign.activeExtensions
      activeActivationKind = previousCampaign.activeActivationKind
      pendingStart = previousCampaign.pendingStart
      requireEmptySlot = previousCampaign.requireEmptySlot
      try {
        options.onActivateProfile?.(activeProfile, activeExtensions, activeActivationKind)
      } catch {
        // L'erreur d'activation initiale reste la cause présentée au joueur.
      }
      throw error
    }
  }

  const creation = createNewGamePlusCreationUi(options.host, {
    onCancel: () => { setMenuInert(false); render() },
    onCreate: (selection) => {
      const inventory = options.readInventory()
      const source = readSaves().get(selection.sourceSlot)
      if (!inventory || !source || !hasUnlockedNewGamePlusFromKantoLeague(source.restored.field.flags)) {
        options.reportStatus('La sauvegarde source ne prouve plus la victoire à la Ligue de Kanto.')
        return false
      }
      try {
        const profile = registry.createProfile({ source: { gameCode: inventory.metadata.gameCode, slot: selection.sourceSlot,
          playerName: source.restored.profile.name, leagueCompletedAt: source.savedAt }, modules: selection.modules })
        beginPreparedNewGamePlus({ profile, source: source.restored.field, targetSlot: selection.targetSlot })
        setMenuInert(false)
        return true
      } catch (error) {
        options.reportStatus(error instanceof Error ? error.message : 'La Nouvelle Partie+ ne peut pas être créée.')
        setMenuInert(true)
        return false
      }
    },
  })

  function openCreation(preferred: { sourceSlot?: HgssBrowserSaveSlot, targetSlot?: HgssBrowserSaveSlot } = {}): void {
    const inventory = options.readInventory()
    if (!inventory || !entitlementRuntime.isUnlocked()) return
    if (!canUseNewGamePlus()) return
    const sources = [...readSaves()].flatMap(([slot, save]) => (
      hasUnlockedNewGamePlusFromKantoLeague(save.restored.field.flags)
        ? [{
            slot,
            playerName: save.restored.profile.name,
            summary: `${save.restored.field.badges.size} badges · ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(save.savedAt))}`,
          }]
        : []
    ))
    const targets = Array.from({ length: hgssBrowserSaveSlotCount }, (_, index) => (index + 1) as HgssBrowserSaveSlot)
      .filter((slot) => !readSaves().has(slot) && !readCorruptSaves().has(slot))
    setMenuInert(true)
    creation.open({
      sources,
      targets,
      modules: registry.listModules().map((module) => createNewGamePlusCreationModuleOption(module, inventory)),
      preferredSourceSlot: preferred.sourceSlot,
      preferredTargetSlot: preferred.targetSlot,
    })
  }

  const applyMenuResultWithSound = (result: TitleMenuResult, sound: 'cursor' | 'select' = 'select'): boolean => {
    if (result.kind === 'ignored') return false
    if (sound === 'cursor') playCursorSound()
    else playSelectSound()
    if (result.kind === 'state') {
      render(result.state)
      if (!result.state.open) options.onExit?.()
      return true
    }
    if (result.choice === 'new-game-plus') {
      openCreation()
      return true
    }
    const slot = Number.parseInt(result.choice.slice('slot-'.length), 10) as HgssBrowserSaveSlot
    const save = readSaves().get(slot)
    if (save) {
      if (save.restored.newGamePlus && !canUseNewGamePlus()) {
        render()
        return true
      }
      const previousCampaign = { activeProfile, activeExtensions, activeActivationKind, pendingStart, requireEmptySlot }
      const resumed = runTitleCampaignResumeTransaction({
        attempt: () => {
          activeProfile = save.restored.newGamePlus && registry.restoreProfile(save.restored.newGamePlus)
          activeExtensions = save.restored.extensions; activeActivationKind = save.restored.newGamePlus ? 'resume' : 'normal'; pendingStart = undefined; requireEmptySlot = false
          options.onActivateProfile?.(activeProfile, activeExtensions, activeActivationKind); options.onResume(slot, save)
        },
        rollback: () => {
          activeProfile = previousCampaign.activeProfile; activeExtensions = previousCampaign.activeExtensions; activeActivationKind = previousCampaign.activeActivationKind
          pendingStart = previousCampaign.pendingStart; requireEmptySlot = previousCampaign.requireEmptySlot
          options.onActivateProfile?.(activeProfile, activeExtensions, activeActivationKind)
        },
      })
      if (resumed.kind === 'completed') render(options.menu.close())
      else {
        options.reportStatus(resumed.error instanceof Error ? `Reprise impossible : ${resumed.error.message}` : 'Reprise de sauvegarde impossible.')
        render()
      }
      return true
    }
    if (readCorruptSaves().has(slot)) {
      options.reportStatus(`L’emplacement ${slot} est corrompu : supprimez-le explicitement pour le libérer.`)
      render()
      return true
    }
    activeProfile = undefined
    activeExtensions = undefined
    activeActivationKind = 'normal'
    pendingStart = undefined
    requireEmptySlot = true
    options.onActivateProfile?.(undefined, undefined, 'normal')
    options.onBegin(slot)
    return true
  }
  const applyMenuResult = (result: TitleMenuResult): boolean => applyMenuResultWithSound(result)

  const readControlSlot = (button: HTMLButtonElement): HgssBrowserSaveSlot | undefined => {
    const slot = Number.parseInt(button.dataset.titleMenuSlot ?? '', 10)
    return Number.isInteger(slot) && slot >= 1 && slot <= hgssBrowserSaveSlotCount
      ? slot as HgssBrowserSaveSlot
      : undefined
  }
  const activateSlot = (slot: HgssBrowserSaveSlot): void => {
    applyMenuResult({ kind: 'choice', choice: `slot-${slot}`, state: options.menu.getState() })
  }
  const management = createTitleSaveManagementRuntime({
    readSaves,
    readCorruptSaves,
    activateSlot,
    requestDelete: (slot, save) => {
      setMenuInert(true)
      deletion.open({
        kind: 'readable',
        slot,
        playerName: save.restored.profile.name,
        summary: new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(save.savedAt)),
        deletionToken: save.deletionToken,
      })
    },
    requestDeleteCorrupt: (slot, save) => {
      setMenuInert(true)
      deletion.open({
        kind: 'corrupt',
        slot,
        playerName: 'SAUVEGARDE CORROMPUE',
        summary: 'Données illisibles conservées',
        deletionToken: save.deletionToken,
      })
    },
    exportSave: (slot) => { void backup.exportSlot(slot) },
    importSave: (slot) => { void backup.importIntoSlot(slot) },
    openNewGamePlus: openCreation,
    reportStatus: options.reportStatus,
    refresh: render,
  })

  const focusActionControl = (button: HTMLButtonElement): void => {
    for (const action of options.menuRoot.querySelectorAll<HTMLButtonElement>('.title-save-action')) {
      action.tabIndex = action === button ? 0 : -1
      action.setAttribute('aria-current', String(action === button))
    }
    if (document.activeElement !== button) button.focus({ preventScroll: true })
  }

  const focusMenuControl = (button: HTMLButtonElement): void => {
    const index = Number.parseInt(button.dataset.titleMenuIndex ?? '', 10)
    if (Number.isInteger(index)) {
      if (index !== options.menu.getState().cursor) {
        render(options.menu.focus(index))
        playCursorSound()
      }
      else if (document.activeElement !== button) button.focus({ preventScroll: true })
      return
    }
    if (button.dataset.titleMenuAction) focusActionControl(button)
  }

  const activateMenuControl = (button: HTMLButtonElement): void => {
    const action = button.dataset.titleMenuAction as TitleMenuActionId | undefined
    if (action) {
      playSelectSound()
      management.activate(action, readControlSlot(button))
    }
  }

  const handleMenuInput = (action: GameDigitalAction): boolean => {
    if (backup.isBusy()) return true
    const focusedAction = options.menuRoot.querySelector<HTMLButtonElement>('.title-save-action:focus')
    if (focusedAction) {
      const actions = [...options.menuRoot.querySelectorAll<HTMLButtonElement>('.title-save-action')]
      const index = Math.max(0, actions.indexOf(focusedAction))
      if (action === 'confirm') activateMenuControl(focusedAction)
      else if (action === 'left' || action === 'cancel' || action === 'menu') {
        options.menuRoot.querySelector<HTMLButtonElement>(`[data-title-menu-index="${options.menu.getState().cursor}"]`)?.focus({ preventScroll: true })
        playSelectSound()
      } else if (action === 'up' || action === 'page-previous') {
        const previous = actions[(index - 1 + actions.length) % actions.length]
        if (previous) {
          focusActionControl(previous)
          playCursorSound()
        }
      } else if (action === 'down' || action === 'right' || action === 'page-next') {
        const next = actions[(index + 1) % actions.length]
        if (next) {
          focusActionControl(next)
          playCursorSound()
        }
      }
      return true
    }
    if (action === 'right') {
      const firstAction = options.menuRoot.querySelector<HTMLButtonElement>('.title-save-action')
      if (firstAction) {
        focusActionControl(firstAction)
        playCursorSound()
        return true
      }
    }
    return applyMenuResultWithSound(options.menu.handle(action), action === 'up' || action === 'down' ? 'cursor' : 'select')
  }

  return {
    render,
    open: () => {
      refreshedCatalog = undefined
      const opened = options.menu.open({ newGamePlusUnlocked: entitlementRuntime.isUnlocked() })
      const firstOccupied = opened.items.findIndex((item) => item.kind === 'save-slot'
        && (readSaves().has(item.slot) || readCorruptSaves().has(item.slot)))
      render(firstOccupied > 0 ? options.menu.focus(firstOccupied) : opened)
    },
    applyMenuResult,
    handleMenuInput,
    focusMenuControl,
    activateMenuControl,
    resetForRom: () => {
      backup.cancel()
      refreshedCatalog = undefined
      creation.close()
      deletion.close()
      setMenuInert(false)
      if (notice.isOpen()) notice.close()
      entitlementRuntime.reset()
      activeProfile = undefined
      activeExtensions = undefined
      activeActivationKind = 'normal'
      pendingStart = undefined
      requireEmptySlot = false
      options.onActivateProfile?.(undefined, undefined, 'normal')
    },
    reconcileEntitlement: (inventory) => {
      const completedSaves = [...readSaves()].filter(([, save]) => (
        hasUnlockedNewGamePlusFromKantoLeague(save.restored.field.flags)
      ))
      return entitlementRuntime.reconcile(
        inventory.metadata.gameCode,
        completedSaves.map(([sourceSlot, save]) => ({ sourceSlot, savedAt: save.savedAt })),
      )
    },
    getActiveProfile: () => activeProfile,
    beginPreparedNewGamePlusForDevelopment: (request) => {
      if (!import.meta.env.DEV || !options.allowPreparedNewGamePlusStart) throw new Error('Le démarrage NG+ préparé est réservé au banc de développement jetable.')
      return beginPreparedNewGamePlus(request)
    },
    startNormalCampaign: () => {
      activeProfile = undefined
      activeExtensions = undefined
      activeActivationKind = 'normal'
      pendingStart = undefined
      requireEmptySlot = false
      options.onActivateProfile?.(undefined, undefined, 'normal')
    },
    applyPendingStart: (destination) => {
      if (!pendingStart) return destination
      const initialized = registry.applyProfile(pendingStart.profile, pendingStart.source, destination)
      pendingStart = undefined
      return initialized
    },
    writeSaveSlot: (gameCode, slot, value, kind) => {
      const record = (requireEmptySlot ? createHgssDataOnlyBrowserSaveSlotIfEmpty : writeHgssDataOnlyBrowserSaveSlot)(
        options.storage,
        gameCode,
        slot,
        value,
        kind,
      )
      requireEmptySlot = false
      return record
    },
    noteGameClear: entitlementRuntime.noteGameClear,
    completeFieldScript: entitlementRuntime.completeFieldScript,
    cancelPendingGameClear: entitlementRuntime.cancelPendingGameClear,
    handleUi: (action) => notice.isOpen() ? notice.handle(action) : deletion.isOpen() ? deletion.handle(action) : creation.handle(action),
    isUiOpen: () => notice.isOpen() || deletion.isOpen() || creation.isOpen(),
  }
}
