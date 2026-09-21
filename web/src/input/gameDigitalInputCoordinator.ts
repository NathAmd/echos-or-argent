import type { GameDigitalAction, GameDigitalEvent } from '../gameInput'

export type GameDigitalInputState = Readonly<{
  unfinishedTrade: boolean
  flyActive: boolean
  titleUiOpen: boolean
  captureRegistrationOpen: boolean
  botRunning: boolean
  eggHatchPhase: 'cracking' | 'hatched' | 'nickname-choice' | 'naming' | undefined
  battleEvolutionActive: boolean
  confirmationOpen: boolean
  phoneChoiceOpen: boolean
  fieldNicknameVisible: boolean
  battleActive: boolean
  fieldProgressionActive: boolean
  safariBattleActive: boolean
  pcBoxOpen: boolean
  safariUiOpen: boolean
  photoAlbumOpen: boolean
  fishingActive: boolean
  blackoutFollowupPending: boolean
  fieldScriptActive: boolean
  fieldNumberVisible: boolean
  fieldDialogueVisible: boolean
  fieldScriptInputWait: boolean
  phoneActive: boolean
  sweetScentActive: boolean
  preparedWildEncounter: boolean
  flow: string
  mainMenuOpen: boolean
  playerMoving: boolean
}>

export type GameDigitalInputConsumer = (event: GameDigitalEvent) => boolean

export type GameDigitalInputCoordinatorPorts = Readonly<{
  state: Readonly<{
    read: () => GameDigitalInputState
  }>
  physical: Readonly<{
    observe: (event: GameDigitalEvent) => string | undefined
    remember: (key: string) => void
    processMovement: () => void
    releaseRun: () => void
  }>
  gamepad: Readonly<{
    useDevice: (deviceId: string) => void
    readFallbackDeviceId: () => string
  }>
  preemptiveConsumers: readonly GameDigitalInputConsumer[]
  trade: Readonly<{
    reportBlocked: () => void
  }>
  diagnostics: Readonly<{
    record: (event: GameDigitalEvent) => void
    stopRealtimeTest: () => void
    isRealtimeTestRunning: () => boolean
  }>
  title: Readonly<{
    handle: (action: GameDigitalAction) => void
  }>
  captureRegistration: Readonly<{
    handle: (action: GameDigitalAction) => void
  }>
  bot: Readonly<{
    stop: () => void
  }>
  transformation: Readonly<{
    handleEggHatch: (action: GameDigitalAction) => void
    handleEvolution: (action: GameDigitalAction) => void
  }>
  confirmation: Readonly<{
    handlePhoneChoice: (action: GameDigitalAction) => void
    handleYesNo: (action: GameDigitalAction) => void
  }>
  battle: Readonly<{
    handleSafari: (action: GameDigitalAction, pressed: boolean) => void
    handleRegular: (action: GameDigitalAction) => void
  }>
  applications: Readonly<{
    handlePcBox: (action: GameDigitalAction) => void
    handleSafari: (action: GameDigitalAction) => void
    handlePhotoAlbum: (action: GameDigitalAction) => void
  }>
  fishing: Readonly<{
    completeMessageText: () => boolean
    handle: (action: GameDigitalAction) => void
  }>
  blackout: Readonly<{
    confirm: () => void
  }>
  fieldConsumers: readonly GameDigitalInputConsumer[]
  nickname: Readonly<{
    handleStorageMessage: (action: GameDigitalAction) => void
  }>
  script: Readonly<{
    handleChoice: GameDigitalInputConsumer
    confirmMessage: () => void
    skipAcknowledgedMessage: () => boolean
    resolvePhoneInput: (
      phoneActive: boolean,
      pressed: boolean,
      action: GameDigitalAction,
      dialogueVisible: boolean,
    ) => 'advance' | 'block' | 'pass' | undefined
    resumeInputWait: (action: GameDigitalAction) => boolean
  }>
  menu: Readonly<{
    handleUtilityInput: GameDigitalInputConsumer
    toggleFromAction: (action: GameDigitalAction) => void
    close: () => void
  }>
  intro: Readonly<{
    handle: (action: GameDigitalAction) => void
  }>
  world: Readonly<{
    interact: () => void
  }>
}>

export type GameDigitalInputCoordinator = Readonly<{
  handle: (event: GameDigitalEvent) => void
}>

function isConfirmOrCancel(action: GameDigitalAction): boolean {
  return action === 'confirm' || action === 'cancel'
}

function battleAction(action: GameDigitalAction): GameDigitalAction {
  if (action === 'page-previous') return 'left'
  if (action === 'page-next') return 'right'
  return action
}

/**
 * Point d'entrée unique des événements numériques du jeu. L'ordre est une
 * partie du contrat : les saisies physiques sont libérées avant les modales,
 * puis chaque couche immersive obtient une occasion exclusive de consommer
 * l'événement avant le déplacement du monde.
 */
export function createGameDigitalInputCoordinator(
  ports: GameDigitalInputCoordinatorPorts,
): GameDigitalInputCoordinator {
  const handle = (event: GameDigitalEvent): void => {
    const movementKey = ports.physical.observe(event)

    if (event.pressed && event.source === 'gamepad') {
      ports.gamepad.useDevice(event.deviceId ?? ports.gamepad.readFallbackDeviceId())
    }

    if (ports.preemptiveConsumers.some((consumer) => consumer(event))) return

    let state = ports.state.read()
    if (state.unfinishedTrade) {
      ports.trade.reportBlocked()
      return
    }

    ports.diagnostics.record(event)
    if (event.pressed && event.source !== 'automation' && ports.diagnostics.isRealtimeTestRunning()) {
      ports.diagnostics.stopRealtimeTest()
    }

    state = ports.state.read()
    if (state.flyActive) {
      ports.physical.releaseRun()
      return
    }
    if (state.titleUiOpen) {
      if (event.pressed) ports.title.handle(event.action)
      return
    }
    if (state.captureRegistrationOpen) {
      if (event.pressed) ports.captureRegistration.handle(event.action)
      return
    }
    if (state.botRunning && event.pressed) ports.bot.stop()

    if (event.pressed && (state.eggHatchPhase === 'cracking' || state.eggHatchPhase === 'hatched')) {
      ports.transformation.handleEggHatch(event.action)
      return
    }
    if (state.battleEvolutionActive && event.pressed) {
      ports.transformation.handleEvolution(event.action)
      return
    }
    if (state.confirmationOpen && event.pressed) {
      if (state.phoneChoiceOpen) ports.confirmation.handlePhoneChoice(event.action)
      else ports.confirmation.handleYesNo(event.action)
      return
    }
    if (!state.fieldNicknameVisible
      && (state.safariBattleActive || state.battleActive || state.fieldProgressionActive)
      && (event.pressed || state.safariBattleActive)) {
      const action = battleAction(event.action)
      if (state.safariBattleActive) ports.battle.handleSafari(action, event.pressed)
      else ports.battle.handleRegular(action)
      return
    }
    if (state.pcBoxOpen) {
      if (event.pressed) ports.applications.handlePcBox(event.action)
      return
    }
    if (state.safariUiOpen) {
      if (event.pressed) ports.applications.handleSafari(event.action)
      return
    }
    if (state.photoAlbumOpen) {
      if (event.pressed) ports.applications.handlePhotoAlbum(event.action)
      return
    }
    if (state.fishingActive) {
      if (event.pressed
        && (!isConfirmOrCancel(event.action) || !ports.fishing.completeMessageText())) {
        ports.fishing.handle(event.action)
      }
      return
    }
    if (state.blackoutFollowupPending && event.pressed && isConfirmOrCancel(event.action)) {
      ports.blackout.confirm()
      return
    }
    if (ports.fieldConsumers.some((consumer) => consumer(event))) return
    if (state.fieldNicknameVisible && event.pressed) {
      ports.nickname.handleStorageMessage(event.action)
      return
    }
    if (state.fieldScriptActive && state.fieldNumberVisible && event.pressed) return
    if (ports.script.handleChoice(event)) return
    if (state.fieldScriptActive && event.pressed && isConfirmOrCancel(event.action) && state.fieldDialogueVisible) {
      if (state.fieldScriptInputWait) {
        ports.script.confirmMessage()
        return
      }
      if (ports.script.skipAcknowledgedMessage()) return
    }

    const phoneInput = ports.script.resolvePhoneInput(
      state.phoneActive,
      event.pressed,
      event.action,
      state.fieldDialogueVisible,
    )
    if (phoneInput === 'advance') {
      ports.script.confirmMessage()
      return
    }
    if (phoneInput === 'block') return
    if (state.fieldScriptActive && event.pressed && ports.script.resumeInputWait(event.action)) return
    if (state.fieldScriptActive || state.sweetScentActive || state.preparedWildEncounter) return
    if (state.flow === 'bedroom' && ports.menu.handleUtilityInput(event)) return
    if (state.flow === 'bedroom' && event.action === 'menu' && event.pressed) {
      ports.menu.toggleFromAction(event.action)
      return
    }
    if (state.flow !== 'bedroom') {
      if (event.pressed) ports.intro.handle(event.action)
      return
    }
    if (movementKey) {
      if (state.mainMenuOpen) return
      if (event.pressed) {
        ports.physical.remember(movementKey)
        ports.physical.processMovement()
      }
      return
    }
    if (!event.pressed) return
    if (event.action === 'confirm' && !state.playerMoving) ports.world.interact()
    if (event.action === 'cancel') ports.menu.close()
  }

  return Object.freeze({ handle })
}
