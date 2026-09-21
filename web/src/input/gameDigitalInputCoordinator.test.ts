import { describe, expect, it, vi } from 'vitest'
import type { GameDigitalEvent } from '../gameInput'
import {
  createGameDigitalInputCoordinator,
  type GameDigitalInputState,
} from './gameDigitalInputCoordinator'

const pressed = (action: GameDigitalEvent['action'], source: GameDigitalEvent['source'] = 'keyboard'): GameDigitalEvent => ({
  action,
  pressed: true,
  source,
  inputId: action,
})

function createFixture() {
  const state: GameDigitalInputState = {
    unfinishedTrade: false,
    flyActive: false,
    titleUiOpen: false,
    captureRegistrationOpen: false,
    botRunning: false,
    eggHatchPhase: undefined,
    battleEvolutionActive: false,
    confirmationOpen: false,
    phoneChoiceOpen: false,
    fieldNicknameVisible: false,
    battleActive: false,
    fieldProgressionActive: false,
    safariBattleActive: false,
    pcBoxOpen: false,
    safariUiOpen: false,
    photoAlbumOpen: false,
    fishingActive: false,
    blackoutFollowupPending: false,
    fieldScriptActive: false,
    fieldNumberVisible: false,
    fieldDialogueVisible: false,
    fieldScriptInputWait: false,
    phoneActive: false,
    sweetScentActive: false,
    preparedWildEncounter: false,
    flow: 'bedroom',
    mainMenuOpen: false,
    playerMoving: false,
  }
  let snapshot = state
  const calls: string[] = []
  const action = (name: string) => vi.fn(() => { calls.push(name) })
  const consumer = (name: string, consumes = false) => vi.fn(() => {
    calls.push(name)
    return consumes
  })
  const observe = vi.fn(() => undefined as string | undefined)
  const preemptive = consumer('preemptive')
  const fieldConsumer = consumer('field-consumer')
  const handleChoice = consumer('choice')
  const handleUtilityInput = consumer('utility')
  const completeMessageText = vi.fn(() => false)
  const resolvePhoneInput = vi.fn(() => undefined as 'advance' | 'block' | 'pass' | undefined)
  const isRealtimeTestRunning = vi.fn(() => false)
  const ports = {
    state: { read: () => snapshot },
    physical: {
      observe,
      remember: action('remember'),
      processMovement: action('movement'),
      releaseRun: action('release-run'),
    },
    gamepad: { useDevice: action('gamepad'), readFallbackDeviceId: () => 'fallback-pad' },
    preemptiveConsumers: [preemptive],
    trade: { reportBlocked: action('trade') },
    diagnostics: { record: action('diagnostic'), stopRealtimeTest: action('stop-test'), isRealtimeTestRunning },
    title: { handle: action('title') },
    captureRegistration: { handle: action('capture-registration') },
    bot: { stop: action('bot') },
    transformation: { handleEggHatch: action('egg'), handleEvolution: action('evolution') },
    confirmation: { handlePhoneChoice: action('phone-choice'), handleYesNo: action('yes-no') },
    battle: { handleSafari: action('safari-battle'), handleRegular: action('battle') },
    applications: { handlePcBox: action('pc'), handleSafari: action('safari-ui'), handlePhotoAlbum: action('photo') },
    fishing: { completeMessageText, handle: action('fishing') },
    blackout: { confirm: action('blackout') },
    fieldConsumers: [fieldConsumer],
    nickname: { handleStorageMessage: action('nickname') },
    script: {
      handleChoice,
      confirmMessage: action('confirm-message'),
      skipAcknowledgedMessage: vi.fn(() => false),
      resolvePhoneInput,
      resumeInputWait: vi.fn(() => false),
    },
    menu: { handleUtilityInput, toggleFromAction: action('menu'), close: action('close-menu') },
    intro: { handle: action('intro') },
    world: { interact: action('interact') },
  }
  const host = createGameDigitalInputCoordinator(ports)
  return {
    host,
    ports,
    calls,
    observe,
    preemptive,
    fieldConsumer,
    handleChoice,
    handleUtilityInput,
    completeMessageText,
    resolvePhoneInput,
    isRealtimeTestRunning,
    updateState: (update: Partial<GameDigitalInputState>) => { snapshot = { ...snapshot, ...update } },
  }
}

describe('game digital input coordinator', () => {
  it('libère toujours l’état physique avant une couche préemptive', () => {
    const fixture = createFixture()
    fixture.preemptive.mockReturnValue(true)

    fixture.host.handle({ ...pressed('left'), pressed: false })

    expect(fixture.observe).toHaveBeenCalledOnce()
    expect(fixture.preemptive).toHaveBeenCalledOnce()
    expect(fixture.ports.diagnostics.record).not.toHaveBeenCalled()
  })

  it('signale une transaction interrompue avant les diagnostics et le gameplay', () => {
    const fixture = createFixture()
    fixture.updateState({ unfinishedTrade: true })

    fixture.host.handle(pressed('confirm'))

    expect(fixture.calls).toEqual(['preemptive', 'trade'])
  })

  it('mémorise la manette, les diagnostics et arrête un test manuel avant la couche active', () => {
    const fixture = createFixture()
    fixture.isRealtimeTestRunning.mockReturnValue(true)
    fixture.updateState({ titleUiOpen: true })

    fixture.host.handle({ ...pressed('confirm', 'gamepad'), deviceId: 'Steam Deck' })

    expect(fixture.ports.gamepad.useDevice).toHaveBeenCalledWith('Steam Deck')
    expect(fixture.calls).toEqual(['gamepad', 'preemptive', 'diagnostic', 'stop-test', 'title'])
  })

  it('donne la priorité aux transformations puis à la confirmation', () => {
    const fixture = createFixture()
    fixture.updateState({ eggHatchPhase: 'hatched', battleEvolutionActive: true, confirmationOpen: true })
    fixture.host.handle(pressed('confirm'))
    expect(fixture.calls.at(-1)).toBe('egg')

    fixture.calls.length = 0
    fixture.updateState({ eggHatchPhase: undefined, battleEvolutionActive: false, phoneChoiceOpen: true })
    fixture.host.handle(pressed('cancel'))
    expect(fixture.calls.at(-1)).toBe('phone-choice')
  })

  it('convertit les gâchettes en directions et transmet les relâchements au Safari', () => {
    const fixture = createFixture()
    fixture.updateState({ safariBattleActive: true })

    fixture.host.handle({ ...pressed('page-next', 'gamepad'), pressed: false })

    expect(fixture.ports.battle.handleSafari).toHaveBeenCalledWith('right', false)
    expect(fixture.ports.battle.handleRegular).not.toHaveBeenCalled()
  })

  it('laisse un premier appui terminer le texte de pêche avant de commander la session', () => {
    const fixture = createFixture()
    fixture.updateState({ fishingActive: true })
    fixture.completeMessageText.mockReturnValueOnce(true)

    fixture.host.handle(pressed('confirm'))
    expect(fixture.ports.fishing.handle).not.toHaveBeenCalled()

    fixture.host.handle(pressed('confirm'))
    expect(fixture.ports.fishing.handle).toHaveBeenCalledWith('confirm')
  })

  it('préserve l’ordre dialogue script, téléphone et attente de script', () => {
    const fixture = createFixture()
    fixture.updateState({ fieldScriptActive: true, fieldDialogueVisible: true, fieldScriptInputWait: true })
    fixture.host.handle(pressed('confirm'))
    expect(fixture.calls.at(-1)).toBe('confirm-message')

    fixture.calls.length = 0
    fixture.updateState({ fieldScriptActive: false, fieldScriptInputWait: false, phoneActive: true })
    fixture.resolvePhoneInput.mockReturnValue('advance')
    fixture.host.handle(pressed('confirm'))
    expect(fixture.calls.at(-1)).toBe('confirm-message')
  })

  it('route le menu, le déplacement puis les interactions du monde en dernier recours', () => {
    const fixture = createFixture()
    fixture.host.handle(pressed('menu'))
    expect(fixture.calls.at(-1)).toBe('menu')

    fixture.calls.length = 0
    fixture.observe.mockReturnValue('ArrowUp')
    fixture.host.handle(pressed('up'))
    expect(fixture.calls.slice(-2)).toEqual(['remember', 'movement'])

    fixture.calls.length = 0
    fixture.observe.mockReturnValue(undefined)
    fixture.host.handle(pressed('confirm'))
    expect(fixture.calls.at(-1)).toBe('interact')

    fixture.calls.length = 0
    fixture.host.handle(pressed('cancel'))
    expect(fixture.calls.at(-1)).toBe('close-menu')
  })
})
