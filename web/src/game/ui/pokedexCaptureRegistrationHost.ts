import type { GameDigitalAction } from '../../gameInput'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'

export type PokedexCaptureRegistrationHost = {
  open: (pokemon: CanonicalPokemon) => Promise<void>
  close: () => boolean
  handle: (action: GameDigitalAction) => boolean
  isOpen: () => boolean
}

type HostSnapshot = {
  className: string
  hidden: HTMLElement['hidden']
  children: ChildNode[]
  screen?: string
  presentation?: string
  role: string | null
  ariaModal: string | null
  tabIndex: number
  battleHidden: HTMLElement['hidden']
}

export function createPokedexCaptureRegistrationHost(options: {
  root: HTMLElement
  battleScreen: HTMLElement
  render: (pokemon: CanonicalPokemon) => HTMLElement
  onVisibilityChange?: () => void
}): PokedexCaptureRegistrationHost {
  let complete: (() => void) | undefined
  let snapshot: HostSnapshot | undefined

  const close = (): boolean => {
    if (!complete || !snapshot) return false
    const resolve = complete
    const previous = snapshot
    complete = undefined
    snapshot = undefined
    options.root.className = previous.className
    options.root.hidden = previous.hidden
    options.root.replaceChildren(...previous.children)
    if (previous.screen === undefined) delete options.root.dataset.screen
    else options.root.dataset.screen = previous.screen
    if (previous.presentation === undefined) delete options.root.dataset.presentation
    else options.root.dataset.presentation = previous.presentation
    if (previous.role === null) options.root.removeAttribute('role')
    else options.root.setAttribute('role', previous.role)
    if (previous.ariaModal === null) options.root.removeAttribute('aria-modal')
    else options.root.setAttribute('aria-modal', previous.ariaModal)
    options.root.tabIndex = previous.tabIndex
    options.battleScreen.hidden = previous.battleHidden
    options.onVisibilityChange?.()
    resolve()
    return true
  }

  return {
    open: (pokemon) => {
      if (complete) return Promise.reject(new Error("L'enregistrement Pokédex précédent est encore ouvert."))
      const presentation = options.render(pokemon)
      snapshot = {
        className: options.root.className,
        hidden: options.root.hidden,
        children: [...options.root.childNodes],
        screen: options.root.dataset.screen,
        presentation: options.root.dataset.presentation,
        role: options.root.getAttribute('role'),
        ariaModal: options.root.getAttribute('aria-modal'),
        tabIndex: options.root.tabIndex,
        battleHidden: options.battleScreen.hidden,
      }
      options.root.classList.add('ui-menu', 'ui-menu-detail', 'pokedex-capture-registration-host')
      options.root.classList.remove('ui-menu-root')
      options.root.dataset.screen = 'pokedex'
      options.root.dataset.presentation = 'detail'
      options.root.setAttribute('role', 'dialog')
      options.root.setAttribute('aria-modal', 'true')
      options.root.tabIndex = -1
      options.root.replaceChildren(presentation)
      options.battleScreen.hidden = true
      options.root.hidden = false
      options.root.focus({ preventScroll: true })
      options.onVisibilityChange?.()
      return new Promise<void>((resolve) => { complete = resolve })
    },
    close,
    handle: (action) => {
      if (!complete) return false
      if (action === 'confirm' || action === 'cancel' || action === 'menu') close()
      return true
    },
    isOpen: () => complete !== undefined,
  }
}
