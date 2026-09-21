import { describe, expect, it, vi } from 'vitest'
import {
  createBattleDigitalInputHost,
  type BattleDigitalInputHostPorts,
  type BattleDigitalInputState,
  type BattleInputBagAction,
} from './battleDigitalInputHost'

type ButtonDataset = Partial<Record<
  | 'battleCommand'
  | 'battleMove'
  | 'battlePartySlot'
  | 'battleItem'
  | 'battleItemTarget'
  | 'battleItemMove'
  | 'battleForgetMove'
  | 'doubleTarget'
  | 'doubleTargetSide',
  string
>>

function button(dataset: ButtonDataset, disabled = false): HTMLButtonElement {
  return { dataset, disabled } as unknown as HTMLButtonElement
}

function mutableContainer(initial: readonly HTMLButtonElement[] = []) {
  let current = [...initial]
  const element = {
    querySelectorAll: (selector: string) => selector === 'button:not(:disabled)'
      ? current.filter(({ disabled }) => !disabled)
      : current,
  } as unknown as HTMLElement
  return {
    element,
    set: (next: readonly HTMLButtonElement[]) => { current = [...next] },
  }
}

const defaultState: BattleDigitalInputState = {
  mode: 'command',
  cursor: 0,
  simpleActive: true,
  simpleSelectionReady: true,
  doubleActive: false,
  doubleWild: false,
  doublePendingReplacement: false,
  fieldProgressionActive: false,
  messageInputLocked: false,
  presentationAnimationLocks: 0,
  hpAnimationLocks: 0,
  trainerIntroductionActive: false,
  introductionAwaitingAcknowledgement: false,
  partySelectionForced: false,
  pendingItemId: undefined,
  pendingItemTargetSlot: undefined,
}

function createFixture(
  initialState: Partial<BattleDigitalInputState> = {},
  commandButtons: readonly HTMLButtonElement[] = [button({ battleCommand: 'fight' })],
  choiceButtons: readonly HTMLButtonElement[] = [button({ battleMove: '0' })],
) {
  let state: BattleDigitalInputState = { ...defaultState, ...initialState }
  const commands = mutableContainer(commandButtons)
  const choices = mutableContainer(choiceButtons)
  const writeCursor = vi.fn((cursor: number) => { state = { ...state, cursor } })
  const clearPendingItemId = vi.fn(() => { state = { ...state, pendingItemId: undefined } })
  const clearPendingItems = vi.fn(() => {
    state = { ...state, pendingItemId: undefined, pendingItemTargetSlot: undefined }
  })
  const move = vi.fn()
  const render = vi.fn()
  const handleEvolution = vi.fn(() => false)
  const cancelLearning = vi.fn()
  const chooseLearning = vi.fn()
  const advanceMessage = vi.fn()
  const requestSkip = vi.fn()
  const releaseLockedAcknowledgement = vi.fn()
  const advanceIntroduction = vi.fn()
  const showBag = vi.fn()
  const showBagTargets = vi.fn()
  const capture = vi.fn()
  const simple = {
    showMoves: vi.fn(),
    showParty: vi.fn(),
    tryRun: vi.fn(),
    selectMove: vi.fn(),
    selectParty: vi.fn(),
    resolveBagAction: vi.fn((): BattleInputBagAction | undefined => undefined),
    useEscapeItem: vi.fn(),
    useStatItem: vi.fn(),
    useItemOnPartySlot: vi.fn(),
    useItemOnMove: vi.fn(),
    showCommands: vi.fn(),
  }
  const double = {
    showMoves: vi.fn(),
    showParty: vi.fn(),
    showCommands: vi.fn(),
    tryRun: vi.fn(),
    rejectRun: vi.fn(),
    selectMove: vi.fn(),
    selectTarget: vi.fn(),
    commitReplacement: vi.fn(),
    switchParty: vi.fn(),
    resolveBagAction: vi.fn((): BattleInputBagAction | undefined => undefined),
    useEscapeItem: vi.fn(),
    selectStatItemTarget: vi.fn(),
    useItemOnPartySlot: vi.fn(),
    useItemOnMove: vi.fn(),
  }
  const ports: BattleDigitalInputHostPorts = {
    state: {
      read: () => state,
      writeCursor,
      clearPendingItemId,
      clearPendingItems,
    },
    elements: { commands: commands.element, choices: choices.element },
    navigation: { move, render },
    evolution: { handle: handleEvolution },
    learning: { cancel: cancelLearning, choose: chooseLearning },
    messages: { advance: advanceMessage, requestSkip },
    introduction: { releaseLockedAcknowledgement, advance: advanceIntroduction },
    bag: { show: showBag, showTargets: showBagTargets, capture },
    simple,
    double,
  }
  return {
    host: createBattleDigitalInputHost(ports),
    commands,
    choices,
    writeCursor,
    clearPendingItemId,
    clearPendingItems,
    move,
    render,
    handleEvolution,
    cancelLearning,
    chooseLearning,
    advanceMessage,
    requestSkip,
    releaseLockedAcknowledgement,
    advanceIntroduction,
    showBag,
    showBagTargets,
    capture,
    simple,
    double,
    readState: () => state,
    setState: (update: Partial<BattleDigitalInputState>) => { state = { ...state, ...update } },
  }
}

describe('battle digital input host', () => {
  it('donne la priorité absolue à une évolution en attente', () => {
    const fixture = createFixture({ mode: 'learnMove', fieldProgressionActive: true, doubleActive: true })
    fixture.handleEvolution.mockReturnValue(true)

    fixture.host.handle('confirm')

    expect(fixture.handleEvolution).toHaveBeenCalledWith('confirm')
    expect(fixture.chooseLearning).not.toHaveBeenCalled()
    expect(fixture.requestSkip).not.toHaveBeenCalled()
    expect(fixture.double.showMoves).not.toHaveBeenCalled()
  })

  it('navigue et valide l’apprentissage avant tout autre combat', () => {
    const fixture = createFixture(
      { mode: 'learnMove', cursor: -1, doubleActive: true },
      [],
      [button({ battleForgetMove: '2' }), button({ battleForgetMove: '-1' })],
    )

    fixture.host.handle('right')
    expect(fixture.move).toHaveBeenCalledWith(fixture.choices.element, 'right')
    expect(fixture.writeCursor).toHaveBeenCalledWith(1)
    expect(fixture.render).toHaveBeenCalledWith(fixture.choices.element)

    fixture.setState({ cursor: 0 })
    fixture.host.handle('confirm')
    expect(fixture.chooseLearning).toHaveBeenCalledWith(2)

    fixture.setState({ cursor: 1 })
    fixture.host.handle('confirm')
    fixture.host.handle('cancel')
    expect(fixture.cancelLearning).toHaveBeenCalledTimes(2)
  })

  it('résout la progression terrain avant le combat double et respecte les locks', () => {
    const fixture = createFixture({
      mode: 'message',
      fieldProgressionActive: true,
      doubleActive: true,
      presentationAnimationLocks: 1,
    })

    fixture.host.handle('confirm')
    expect(fixture.requestSkip).toHaveBeenCalledOnce()
    expect(fixture.advanceMessage).not.toHaveBeenCalled()

    fixture.setState({ presentationAnimationLocks: 0 })
    fixture.host.handle('cancel')
    expect(fixture.advanceMessage).toHaveBeenCalledOnce()
    expect(fixture.double.showCommands).not.toHaveBeenCalled()
  })

  it('demande le skip d’un message double verrouillé sinon l’avance', () => {
    const fixture = createFixture({
      mode: 'message',
      simpleActive: false,
      doubleActive: true,
      hpAnimationLocks: 1,
    })

    fixture.host.handle('confirm')
    expect(fixture.requestSkip).toHaveBeenCalledOnce()

    fixture.setState({ hpAnimationLocks: 0 })
    fixture.host.handle('confirm')
    expect(fixture.advanceMessage).toHaveBeenCalledOnce()
  })

  it('préserve les trois niveaux de verrouillage de l’introduction Dresseur', () => {
    const fixture = createFixture({
      trainerIntroductionActive: true,
      introductionAwaitingAcknowledgement: true,
      messageInputLocked: true,
      presentationAnimationLocks: 1,
    })

    fixture.host.handle('confirm')
    expect(fixture.requestSkip).toHaveBeenCalledOnce()
    expect(fixture.releaseLockedAcknowledgement).not.toHaveBeenCalled()

    fixture.setState({ presentationAnimationLocks: 0 })
    fixture.host.handle('confirm')
    expect(fixture.releaseLockedAcknowledgement).toHaveBeenCalledOnce()

    fixture.setState({ messageInputLocked: false })
    fixture.host.handle('cancel')
    expect(fixture.advanceIntroduction).toHaveBeenCalledOnce()
  })

  it('bloque Retour pendant un remplacement double et remonte les sous-menus dans l’ordre', () => {
    const fixture = createFixture({
      simpleActive: false,
      doubleActive: true,
      mode: 'party',
      doublePendingReplacement: true,
    })

    fixture.host.handle('cancel')
    expect(fixture.double.showCommands).not.toHaveBeenCalled()
    expect(fixture.render).not.toHaveBeenCalled()

    fixture.setState({ doublePendingReplacement: false, mode: 'doubleTarget' })
    fixture.host.handle('cancel')
    expect(fixture.double.showMoves).toHaveBeenCalledOnce()

    fixture.setState({ mode: 'bagMove', pendingItemId: 42 })
    fixture.host.handle('cancel')
    expect(fixture.showBagTargets).toHaveBeenCalledWith(42)

    fixture.setState({ mode: 'bag' })
    fixture.host.handle('cancel')
    expect(fixture.clearPendingItemId).toHaveBeenCalledOnce()
    expect(fixture.double.showCommands).toHaveBeenCalledOnce()
  })

  it('restaure les sous-menus simples et interdit Retour sur une équipe forcée', () => {
    const fixture = createFixture({ mode: 'bagTarget', pendingItemId: 10, pendingItemTargetSlot: 2 })

    fixture.host.handle('cancel')
    expect(fixture.clearPendingItems).toHaveBeenCalledOnce()
    expect(fixture.showBag).toHaveBeenCalledOnce()

    fixture.setState({ mode: 'party', partySelectionForced: false })
    fixture.host.handle('cancel')
    expect(fixture.simple.showCommands).toHaveBeenCalledOnce()

    fixture.setState({ mode: 'party', partySelectionForced: true })
    fixture.host.handle('cancel')
    expect(fixture.simple.showCommands).toHaveBeenCalledOnce()
    expect(fixture.render).toHaveBeenLastCalledWith(fixture.choices.element)
  })

  it('décode les commandes, capacités et objets du combat simple', () => {
    const fixture = createFixture({}, [button({ battleCommand: 'fight' })])

    fixture.host.handle('confirm')
    expect(fixture.simple.showMoves).toHaveBeenCalledOnce()

    fixture.setState({ mode: 'moves' })
    fixture.choices.set([button({ battleMove: '3' })])
    fixture.host.handle('confirm')
    expect(fixture.simple.selectMove).toHaveBeenCalledWith(3)

    fixture.setState({ mode: 'bag' })
    fixture.choices.set([button({ battleItem: '17' })])
    fixture.simple.resolveBagAction.mockReturnValue('capture')
    fixture.host.handle('confirm')
    expect(fixture.capture).toHaveBeenCalledWith(17)

    fixture.simple.resolveBagAction.mockReturnValue('party-target')
    fixture.host.handle('confirm')
    expect(fixture.showBagTargets).toHaveBeenCalledWith(17)

    fixture.setState({ mode: 'bagMove', pendingItemTargetSlot: 2 })
    fixture.choices.set([button({ battleItemMove: '1' })])
    fixture.host.handle('confirm')
    expect(fixture.simple.useItemOnMove).toHaveBeenCalledWith(2, 1)
  })

  it('décode la fuite, les cibles et le remplacement du combat double', () => {
    const fixture = createFixture(
      { simpleActive: false, doubleActive: true, doubleWild: true },
      [button({ battleCommand: 'run' })],
    )

    fixture.host.handle('confirm')
    expect(fixture.double.tryRun).toHaveBeenCalledOnce()

    fixture.setState({ doubleWild: false })
    fixture.host.handle('confirm')
    expect(fixture.double.rejectRun).toHaveBeenCalledOnce()

    fixture.setState({ mode: 'doubleTarget' })
    fixture.choices.set([button({ doubleTarget: '1', doubleTargetSide: 'opponent' })])
    fixture.host.handle('confirm')
    expect(fixture.double.selectTarget).toHaveBeenCalledWith({ side: 'opponent', slot: 1 })

    fixture.setState({ mode: 'party', doublePendingReplacement: true })
    fixture.choices.set([button({ battlePartySlot: '4' })])
    fixture.host.handle('confirm')
    expect(fixture.double.commitReplacement).toHaveBeenCalledWith(4)
    expect(fixture.double.switchParty).not.toHaveBeenCalled()

    fixture.setState({ mode: 'bag' })
    fixture.choices.set([button({ battleItem: '22' })])
    fixture.double.resolveBagAction.mockReturnValue('battle-stat')
    fixture.host.handle('confirm')
    expect(fixture.double.selectStatItemTarget).toHaveBeenCalledWith(22)
  })

  it('déplace puis rend le curseur dans le conteneur du mode actif', () => {
    const simple = createFixture({ mode: 'command' })
    simple.host.handle('down')
    expect(simple.move).toHaveBeenCalledWith(simple.commands.element, 'down')
    expect(simple.render).toHaveBeenCalledWith(simple.commands.element)

    const double = createFixture({ simpleActive: false, doubleActive: true, mode: 'moves' })
    double.host.handle('left')
    expect(double.move).toHaveBeenCalledWith(double.choices.element, 'left')
    expect(double.render).toHaveBeenCalledWith(double.choices.element)
  })
})
