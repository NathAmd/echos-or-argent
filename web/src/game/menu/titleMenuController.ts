import type { GameDigitalAction } from '../../gameInput'
import { hgssBrowserSaveSlotCount, type HgssBrowserSaveSlot } from '../save/hgssSaveStorage'

export type TitleMenuChoice = `slot-${HgssBrowserSaveSlot}` | 'new-game-plus'

export type TitleMenuItem =
  | { id: `slot-${HgssBrowserSaveSlot}`, kind: 'save-slot', slot: HgssBrowserSaveSlot }
  | { id: 'new-game-plus', kind: 'action' }

export type TitleMenuState = {
  open: boolean
  cursor: number
  items: readonly TitleMenuItem[]
}

export type TitleMenuResult =
  | { kind: 'ignored' }
  | { kind: 'state', state: TitleMenuState }
  | { kind: 'choice', choice: TitleMenuChoice, state: TitleMenuState }

export type TitleMenuController = {
  getState: () => TitleMenuState
  open: (options?: { newGamePlusUnlocked?: boolean }) => TitleMenuState
  close: () => TitleMenuState
  focus: (index: number) => TitleMenuState
  handle: (action: GameDigitalAction) => TitleMenuResult
}

export function createTitleMenuController(): TitleMenuController {
  let state: TitleMenuState = { open: false, cursor: 0, items: [] }

  const open = ({ newGamePlusUnlocked = false }: { newGamePlusUnlocked?: boolean } = {}): TitleMenuState => {
    const items: TitleMenuItem[] = Array.from({ length: hgssBrowserSaveSlotCount }, (_, index) => {
      const slot = (index + 1) as HgssBrowserSaveSlot
      return { id: `slot-${slot}` as const, kind: 'save-slot', slot }
    })
    if (newGamePlusUnlocked) items.push({ id: 'new-game-plus', kind: 'action' })
    state = { open: true, cursor: 0, items }
    return state
  }
  const close = (): TitleMenuState => {
    state = { open: false, cursor: 0, items: [] }
    return state
  }
  const focus = (index: number): TitleMenuState => {
    if (!state.open || !Number.isInteger(index) || index < 0 || index >= state.items.length) return state
    state = { ...state, cursor: index }
    return state
  }
  const handle = (action: GameDigitalAction): TitleMenuResult => {
    if (!state.open) return { kind: 'ignored' }
    if ((action === 'up' || action === 'down') && state.items.length > 0) {
      const direction = action === 'up' ? -1 : 1
      return {
        kind: 'state',
        state: focus((state.cursor + direction + state.items.length) % state.items.length),
      }
    }
    if (action === 'cancel' || action === 'menu') return { kind: 'state', state: close() }
    if (action === 'confirm') {
      const item = state.items[state.cursor]
      return item ? { kind: 'choice', choice: item.id, state } : { kind: 'ignored' }
    }
    return { kind: 'ignored' }
  }
  return { getState: () => state, open, close, focus, handle }
}
