import {
  getRequiredDoubleBattleActors,
  type DoubleBattleAction,
  type DoubleBattlePosition,
  type DoubleBattleSession,
} from './doubleBattleSession'

export type DoubleBattlePendingReplacement = {
  readonly target: DoubleBattlePosition
  readonly reserveIndexes: readonly number[]
}

export type DoubleBattleCommandSelectionState = {
  readonly actions: readonly DoubleBattleAction[]
  readonly actorCursor: number
  readonly pendingMoveIndex?: number
  readonly pendingReplacement?: DoubleBattlePendingReplacement
}

export type DoubleBattleCommandCommitResult =
  | {
      readonly kind: 'awaiting-action'
      readonly state: DoubleBattleCommandSelectionState
      readonly actor: DoubleBattlePosition
    }
  | {
      readonly kind: 'turn-ready'
      readonly state: DoubleBattleCommandSelectionState
      readonly actions: readonly DoubleBattleAction[]
    }

function clonePosition(position: DoubleBattlePosition): DoubleBattlePosition {
  return { ...position }
}

function cloneAction(action: DoubleBattleAction): DoubleBattleAction {
  if (action.kind === 'switch' || action.kind === 'pass') return { ...action, actor: clonePosition(action.actor) }
  if (action.kind === 'item' || action.kind === 'trainerItem') {
    return { ...action, actor: clonePosition(action.actor) }
  }
  return { ...action, actor: clonePosition(action.actor), target: clonePosition(action.target) }
}

function samePosition(left: DoubleBattlePosition, right: DoubleBattlePosition): boolean {
  return left.side === right.side && left.slot === right.slot
}

export function createDoubleBattleCommandSelectionState(): DoubleBattleCommandSelectionState {
  return { actions: [], actorCursor: 0 }
}

export function getCurrentDoubleBattleCommandActor(
  session: DoubleBattleSession,
  state: DoubleBattleCommandSelectionState,
): DoubleBattlePosition | undefined {
  if (state.pendingReplacement) return undefined
  const actor = getRequiredDoubleBattleActors(session)[state.actorCursor]
  return actor && clonePosition(actor)
}

export function setPendingDoubleBattleMove(
  state: DoubleBattleCommandSelectionState,
  moveIndex: number,
): DoubleBattleCommandSelectionState {
  return { ...state, pendingMoveIndex: moveIndex }
}

export function clearPendingDoubleBattleMove(
  state: DoubleBattleCommandSelectionState,
): DoubleBattleCommandSelectionState {
  return {
    actions: state.actions,
    actorCursor: state.actorCursor,
    ...(state.pendingReplacement ? { pendingReplacement: state.pendingReplacement } : {}),
  }
}

export function setPendingDoubleBattleReplacement(
  state: DoubleBattleCommandSelectionState,
  replacement: DoubleBattlePendingReplacement,
): DoubleBattleCommandSelectionState {
  return {
    ...state,
    pendingMoveIndex: undefined,
    pendingReplacement: {
      target: clonePosition(replacement.target),
      reserveIndexes: [...replacement.reserveIndexes],
    },
  }
}

export function clearPendingDoubleBattleReplacement(
  state: DoubleBattleCommandSelectionState,
): DoubleBattleCommandSelectionState {
  return {
    actions: state.actions,
    actorCursor: state.actorCursor,
    ...(state.pendingMoveIndex === undefined ? {} : { pendingMoveIndex: state.pendingMoveIndex }),
  }
}

export function commitDoubleBattleCommandAction(
  session: DoubleBattleSession,
  state: DoubleBattleCommandSelectionState,
  action: DoubleBattleAction,
): DoubleBattleCommandCommitResult {
  if (state.pendingReplacement) {
    throw new Error('Le combat double attend encore un remplacement joueur.')
  }
  if (state.actions.length !== state.actorCursor) {
    throw new Error("L'état de sélection des commandes doubles est incohérent.")
  }
  const requiredActors = getRequiredDoubleBattleActors(session)
  const actor = requiredActors[state.actorCursor]
  if (!actor) throw new Error('Aucun combattant double ne demande cette commande.')
  if (!samePosition(actor, action.actor)) {
    throw new Error(`La commande attendue appartient au slot joueur ${actor.slot}.`)
  }

  const actions = [...state.actions.map(cloneAction), cloneAction(action)]
  const actorCursor = state.actorCursor + 1
  const nextState: DoubleBattleCommandSelectionState = {
    ...state,
    actions,
    actorCursor,
    pendingMoveIndex: undefined,
  }
  const nextActor = requiredActors[actorCursor]
  if (nextActor) {
    return { kind: 'awaiting-action', state: nextState, actor: clonePosition(nextActor) }
  }
  return {
    kind: 'turn-ready',
    actions,
    state: { ...nextState, actions: [], actorCursor: 0 },
  }
}
