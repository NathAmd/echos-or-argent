import type { HgssMartMode, HgssMartPhase } from '../items/hgssMartSession'

export type ShopNavigationSnapshot = Readonly<{ value?: number, scrollTop: number }>

export type ShopNavigationMemory = {
  rememberSelection: (mode: HgssMartMode, phase: HgssMartPhase | undefined, value: number, scrollTop: number) => void
  rememberScroll: (mode: HgssMartMode, phase: HgssMartPhase | undefined, scrollTop: number) => void
  read: (mode: HgssMartMode) => ShopNavigationSnapshot
  clear: () => void
}

/**
 * L'état de navigation appartient exclusivement à la liste d'objets. Les
 * boutons Oui/Non de la phase de confirmation ne peuvent donc ni remplacer le
 * dernier objet, ni ramener sa liste en haut.
 */
export function createShopNavigationMemory(): ShopNavigationMemory {
  const state = new Map<HgssMartMode, { value?: number, scrollTop: number }>()
  const entry = (mode: HgssMartMode) => state.get(mode) ?? { scrollTop: 0 }
  return {
    rememberSelection(mode, phase, value, scrollTop) { if (phase === 'browse') state.set(mode, { value, scrollTop }) },
    rememberScroll(mode, phase, scrollTop) { if (phase === 'browse') state.set(mode, { ...entry(mode), scrollTop }) },
    read(mode) { return { ...entry(mode) } },
    clear() { state.clear() },
  }
}
