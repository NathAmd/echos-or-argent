import type { GameDigitalAction } from '../../gameInput'
import { resolveFieldProgressionMessageInput } from './battleProgressionPresentation'

export type BattleInputUiMode =
  | 'message'
  | 'command'
  | 'moves'
  | 'doubleTarget'
  | 'party'
  | 'bag'
  | 'bagTarget'
  | 'bagMove'
  | 'learnMove'

export type BattleInputBagAction = 'capture' | 'escape' | 'battle-stat' | 'party-target'

export type BattleInputTarget = Readonly<{
  side: 'player' | 'opponent'
  slot: 0 | 1
}>

export type BattleDigitalInputState = Readonly<{
  mode: BattleInputUiMode
  cursor: number
  simpleActive: boolean
  simpleSelectionReady: boolean
  doubleActive: boolean
  doubleWild: boolean
  doublePendingReplacement: boolean
  fieldProgressionActive: boolean
  messageInputLocked: boolean
  presentationAnimationLocks: number
  hpAnimationLocks: number
  trainerIntroductionActive: boolean
  introductionAwaitingAcknowledgement: boolean
  partySelectionForced: boolean
  pendingItemId?: number
  pendingItemTargetSlot?: number
}>

type BattleSelectionContainer = HTMLElement
type BattleDirection = Extract<GameDigitalAction, 'left' | 'right' | 'up' | 'down'>

export type BattleDigitalInputHostPorts = Readonly<{
  state: Readonly<{
    read: () => BattleDigitalInputState
    writeCursor: (cursor: number) => void
    clearPendingItemId: () => void
    clearPendingItems: () => void
  }>
  elements: Readonly<{
    commands: BattleSelectionContainer
    choices: BattleSelectionContainer
  }>
  navigation: Readonly<{
    move: (container: BattleSelectionContainer, direction: BattleDirection) => void
    render: (container: BattleSelectionContainer) => void
  }>
  evolution: Readonly<{
    handle: (action: GameDigitalAction) => boolean
  }>
  learning: Readonly<{
    cancel: () => void
    choose: (forgetIndex: number) => void
  }>
  messages: Readonly<{
    advance: () => void
    requestSkip: () => void
  }>
  introduction: Readonly<{
    releaseLockedAcknowledgement: () => void
    advance: () => void
  }>
  bag: Readonly<{
    show: () => void
    showTargets: (itemId: number) => void
    capture: (itemId: number) => void
  }>
  simple: Readonly<{
    showMoves: () => void
    showParty: () => void
    tryRun: () => void
    selectMove: (moveIndex: number) => void
    selectParty: (partySlot: number) => void
    resolveBagAction: (itemId: number) => BattleInputBagAction | undefined
    useEscapeItem: (itemId: number) => void
    useStatItem: (itemId: number) => void
    useItemOnPartySlot: (partySlot: number) => void
    useItemOnMove: (partySlot: number, moveIndex: number) => void
    showCommands: () => void
  }>
  double: Readonly<{
    showMoves: () => void
    showParty: () => void
    showCommands: () => void
    tryRun: () => void
    rejectRun: () => void
    selectMove: (moveIndex: number) => void
    selectTarget: (target: BattleInputTarget) => void
    commitReplacement: (partyIndex: number) => void
    switchParty: (partyIndex: number) => void
    resolveBagAction: (itemId: number) => BattleInputBagAction | undefined
    useEscapeItem: (itemId: number) => void
    selectStatItemTarget: (itemId: number) => void
    useItemOnPartySlot: (partySlot: number) => void
    useItemOnMove: (partySlot: number, moveIndex: number) => void
  }>
}>

export type BattleDigitalInputHost = Readonly<{
  handle: (action: GameDigitalAction) => void
}>

function buttons(
  container: BattleSelectionContainer,
  enabledOnly = true,
): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>(enabledOnly ? 'button:not(:disabled)' : 'button')]
}

function isDirection(action: GameDigitalAction): action is BattleDirection {
  return action === 'left' || action === 'right' || action === 'up' || action === 'down'
}

/** Owns battle input priority, submenu navigation and DOM selection decoding. */
export function createBattleDigitalInputHost(
  ports: BattleDigitalInputHostPorts,
): BattleDigitalInputHost {
  const hasPresentationLock = (state: BattleDigitalInputState): boolean => (
    state.messageInputLocked
    || state.presentationAnimationLocks > 0
    || state.hpAnimationLocks > 0
  )

  const activateSimpleSelection = (): void => {
    const state = ports.state.read()
    if (!state.simpleSelectionReady) return
    if (state.mode === 'command') {
      const command = buttons(ports.elements.commands)[state.cursor]?.dataset.battleCommand
      if (command === 'fight') ports.simple.showMoves()
      else if (command === 'bag') ports.bag.show()
      else if (command === 'party') ports.simple.showParty()
      else if (command === 'run') ports.simple.tryRun()
      return
    }
    if (state.mode === 'moves') {
      const moveIndex = Number.parseInt(buttons(ports.elements.choices)[state.cursor]?.dataset.battleMove ?? '', 10)
      if (Number.isInteger(moveIndex)) ports.simple.selectMove(moveIndex)
      return
    }
    if (state.mode === 'party') {
      const partySlot = Number.parseInt(buttons(ports.elements.choices)[state.cursor]?.dataset.battlePartySlot ?? '', 10)
      if (Number.isInteger(partySlot)) ports.simple.selectParty(partySlot)
      return
    }
    if (state.mode === 'bag') {
      const itemId = Number.parseInt(buttons(ports.elements.choices)[state.cursor]?.dataset.battleItem ?? '', 10)
      if (!Number.isInteger(itemId)) return
      const action = ports.simple.resolveBagAction(itemId)
      if (action === 'capture') ports.bag.capture(itemId)
      else if (action === 'escape') ports.simple.useEscapeItem(itemId)
      else if (action === 'battle-stat') ports.simple.useStatItem(itemId)
      else if (action === 'party-target') ports.bag.showTargets(itemId)
      return
    }
    if (state.mode === 'bagTarget') {
      const partySlot = Number.parseInt(buttons(ports.elements.choices)[state.cursor]?.dataset.battleItemTarget ?? '', 10)
      if (Number.isInteger(partySlot)) ports.simple.useItemOnPartySlot(partySlot)
      return
    }
    if (state.mode === 'bagMove') {
      const moveIndex = Number.parseInt(buttons(ports.elements.choices)[state.cursor]?.dataset.battleItemMove ?? '', 10)
      if (Number.isInteger(moveIndex) && state.pendingItemTargetSlot !== undefined) {
        ports.simple.useItemOnMove(state.pendingItemTargetSlot, moveIndex)
      }
    }
  }

  const activateDoubleSelection = (): void => {
    const state = ports.state.read()
    if (!state.doubleActive) return
    if (state.mode === 'command') {
      const command = buttons(ports.elements.commands)[state.cursor]?.dataset.battleCommand
      if (command === 'party') ports.double.showParty()
      else if (command === 'bag') ports.bag.show()
      else if (command === 'run' && state.doubleWild) ports.double.tryRun()
      else if (command === 'run') ports.double.rejectRun()
      else ports.double.showMoves()
      return
    }
    if (state.mode === 'moves') {
      const moveIndex = Number.parseInt(buttons(ports.elements.choices)[state.cursor]?.dataset.battleMove ?? '', 10)
      if (Number.isInteger(moveIndex)) ports.double.selectMove(moveIndex)
      return
    }
    if (state.mode === 'doubleTarget') {
      const button = buttons(ports.elements.choices)[state.cursor]
      const slot = Number.parseInt(button?.dataset.doubleTarget ?? '', 10)
      const side = button?.dataset.doubleTargetSide
      if ((slot === 0 || slot === 1) && (side === 'player' || side === 'opponent')) {
        ports.double.selectTarget({ side, slot })
      }
      return
    }
    if (state.mode === 'party') {
      const partyIndex = Number.parseInt(buttons(ports.elements.choices)[state.cursor]?.dataset.battlePartySlot ?? '', 10)
      if (state.doublePendingReplacement && Number.isInteger(partyIndex)) {
        ports.double.commitReplacement(partyIndex)
        return
      }
      if (Number.isInteger(partyIndex)) ports.double.switchParty(partyIndex)
      return
    }
    if (state.mode === 'bag') {
      const itemId = Number.parseInt(buttons(ports.elements.choices)[state.cursor]?.dataset.battleItem ?? '', 10)
      if (!Number.isInteger(itemId)) return
      const action = ports.double.resolveBagAction(itemId)
      if (action === 'capture') ports.bag.capture(itemId)
      else if (action === 'escape') ports.double.useEscapeItem(itemId)
      else if (action === 'battle-stat') ports.double.selectStatItemTarget(itemId)
      else if (action === 'party-target') ports.bag.showTargets(itemId)
      return
    }
    if (state.mode === 'bagTarget') {
      const partySlot = Number.parseInt(buttons(ports.elements.choices)[state.cursor]?.dataset.battleItemTarget ?? '', 10)
      if (Number.isInteger(partySlot)) ports.double.useItemOnPartySlot(partySlot)
      return
    }
    if (state.mode === 'bagMove') {
      const moveIndex = Number.parseInt(buttons(ports.elements.choices)[state.cursor]?.dataset.battleItemMove ?? '', 10)
      if (Number.isInteger(moveIndex) && state.pendingItemTargetSlot !== undefined) {
        ports.double.useItemOnMove(state.pendingItemTargetSlot, moveIndex)
      }
    }
  }

  const handleMoveLearning = (action: GameDigitalAction): void => {
    const choices = buttons(ports.elements.choices, false)
    if (isDirection(action)) {
      ports.navigation.move(ports.elements.choices, action)
    } else if (action === 'confirm' || action === 'cancel') {
      const forgetIndex = Number(choices[ports.state.read().cursor]?.dataset.battleForgetMove)
      if (action === 'cancel' || forgetIndex < 0) ports.learning.cancel()
      else ports.learning.choose(forgetIndex)
      return
    }
    if (choices.length > 0) {
      const cursor = ports.state.read().cursor
      ports.state.writeCursor((cursor + choices.length) % choices.length)
      ports.navigation.render(ports.elements.choices)
    }
  }

  const handleDouble = (action: GameDigitalAction): void => {
    const state = ports.state.read()
    if (!state.doubleActive) return
    if (state.mode === 'message') {
      if (action === 'confirm' || action === 'cancel') {
        if (hasPresentationLock(state)) ports.messages.requestSkip()
        else ports.messages.advance()
      }
      return
    }
    if (action === 'cancel') {
      if (state.doublePendingReplacement) return
      if (state.mode === 'doubleTarget') { ports.double.showMoves(); return }
      if (state.mode === 'bagMove' && state.pendingItemId !== undefined) {
        ports.bag.showTargets(state.pendingItemId)
        return
      }
      if (state.mode === 'bagTarget') { ports.bag.show(); return }
      if (state.mode === 'bag') {
        ports.state.clearPendingItemId()
        ports.double.showCommands()
        return
      }
      if (state.mode === 'moves' || state.mode === 'party') {
        ports.double.showCommands()
        return
      }
    }
    const container = state.mode === 'command' ? ports.elements.commands : ports.elements.choices
    if (buttons(container).length === 0) return
    if (isDirection(action)) ports.navigation.move(container, action)
    else if (action === 'confirm') { activateDoubleSelection(); return }
    ports.navigation.render(container)
  }

  return Object.freeze({
    handle(action): void {
      if (ports.evolution.handle(action)) return
      let state = ports.state.read()
      if (state.mode === 'learnMove') {
        handleMoveLearning(action)
        return
      }
      if (state.fieldProgressionActive && state.mode === 'message') {
        const resolution = resolveFieldProgressionMessageInput(action, hasPresentationLock(state))
        if (resolution === 'skip') ports.messages.requestSkip()
        else if (resolution === 'advance') ports.messages.advance()
        return
      }
      if (state.doubleActive) {
        handleDouble(action)
        return
      }
      if (!state.simpleActive) return
      if (state.trainerIntroductionActive) {
        if ((action === 'confirm' || action === 'cancel') && state.presentationAnimationLocks > 0) {
          ports.messages.requestSkip()
          return
        }
        if (state.introductionAwaitingAcknowledgement && (action === 'confirm' || action === 'cancel')) {
          if (state.messageInputLocked) {
            ports.introduction.releaseLockedAcknowledgement()
            return
          }
          ports.introduction.advance()
        }
        return
      }
      if (state.mode === 'message') {
        if (action === 'confirm' || action === 'cancel') {
          if (hasPresentationLock(state)) ports.messages.requestSkip()
          else ports.messages.advance()
        }
        return
      }
      if (action === 'cancel') {
        if (state.mode === 'bagMove') {
          if (state.pendingItemId !== undefined && state.pendingItemTargetSlot !== undefined) {
            ports.bag.showTargets(state.pendingItemId)
          }
          return
        }
        if (state.mode === 'bagTarget') {
          ports.state.clearPendingItems()
          ports.bag.show()
          return
        }
        if (state.mode === 'moves' || state.mode === 'bag'
          || (state.mode === 'party' && !state.partySelectionForced)) {
          ports.simple.showCommands()
          return
        }
      }
      state = ports.state.read()
      const container = state.mode === 'command' ? ports.elements.commands : ports.elements.choices
      if (buttons(container).length === 0) return
      if (isDirection(action)) ports.navigation.move(container, action)
      else if (action === 'confirm') { activateSimpleSelection(); return }
      ports.navigation.render(container)
    },
  })
}
