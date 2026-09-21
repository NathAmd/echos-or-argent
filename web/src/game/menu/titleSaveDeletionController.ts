import type { GameDigitalAction } from '../../gameInput'
import type { HgssBrowserSaveSlot, HgssBrowserSaveSlotDeletionToken } from '../save/hgssSaveStorage'

type TitleSaveDeletionBaseDetails = {
  slot: HgssBrowserSaveSlot
  playerName: string
  summary: string
}

export type TitleSaveDeletionDetails = TitleSaveDeletionBaseDetails & (
  | { kind: 'readable', deletionToken: HgssBrowserSaveSlotDeletionToken }
  | { kind: 'corrupt', deletionToken: HgssBrowserSaveSlotDeletionToken }
)

export type TitleSaveDeletionState = {
  open: boolean
  cursor: 0 | 1
  details?: TitleSaveDeletionDetails
}

export type TitleSaveDeletionResult =
  | { kind: 'ignored' }
  | { kind: 'state', state: TitleSaveDeletionState }
  | { kind: 'cancelled', state: TitleSaveDeletionState }
  | { kind: 'confirmed', details: TitleSaveDeletionDetails, state: TitleSaveDeletionState }

export type TitleSaveDeletionController = {
  getState: () => TitleSaveDeletionState
  open: (details: TitleSaveDeletionDetails) => TitleSaveDeletionState
  close: () => TitleSaveDeletionState
  focus: (index: number) => TitleSaveDeletionState
  handle: (action: GameDigitalAction) => TitleSaveDeletionResult
}

const closedState = (): TitleSaveDeletionState => ({ open: false, cursor: 0 })

export function createTitleSaveDeletionController(): TitleSaveDeletionController {
  let state = closedState()

  const close = (): TitleSaveDeletionState => {
    state = closedState()
    return state
  }
  const focus = (index: number): TitleSaveDeletionState => {
    if (!state.open || (index !== 0 && index !== 1)) return state
    state = { ...state, cursor: index }
    return state
  }
  const handle = (action: GameDigitalAction): TitleSaveDeletionResult => {
    if (!state.open) return { kind: 'ignored' }
    if (action === 'left' || action === 'up') return { kind: 'state', state: focus(0) }
    if (action === 'right' || action === 'down') return { kind: 'state', state: focus(1) }
    if (action === 'cancel' || action === 'menu') return { kind: 'cancelled', state: close() }
    if (action !== 'confirm') return { kind: 'ignored' }
    const details = state.details
    if (!details) return { kind: 'cancelled', state: close() }
    if (state.cursor === 0) return { kind: 'cancelled', state: close() }
    return { kind: 'confirmed', details, state: close() }
  }

  return {
    getState: () => state,
    open: (details) => {
      state = { open: true, cursor: 0, details: { ...details } }
      return state
    },
    close,
    focus,
    handle,
  }
}
