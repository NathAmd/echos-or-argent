export type ModalPresentation = Readonly<{
  begin: () => void
  restore: (restoreFocus?: boolean) => void
  isActive: () => boolean
}>

type ModalSnapshot = Readonly<{
  hidden: HTMLElement['hidden']
  contents: ReadonlyArray<Readonly<{ element: HTMLElement, nodes: Node[] }>>
  returnFocus?: HTMLElement
  inertSiblings: ReadonlyArray<Readonly<{ element: HTMLElement, inert: boolean }>>
}>

export function createModalPresentation(root: HTMLElement, contents: readonly HTMLElement[]): ModalPresentation {
  let snapshot: ModalSnapshot | undefined

  const begin = (): void => {
    if (snapshot) throw new Error('La présentation modale est déjà active.')
    const activeElement = root.ownerDocument.activeElement
    const returnFocus = activeElement
      && activeElement !== root
      && !root.contains(activeElement)
      && typeof (activeElement as HTMLElement).focus === 'function'
      ? activeElement as HTMLElement
      : undefined
    const inertSiblings: Array<{ element: HTMLElement, inert: boolean }> = []
    for (const sibling of root.parentElement?.children ?? []) {
      if (sibling === root || !('inert' in sibling)) continue
      const element = sibling as HTMLElement
      inertSiblings.push({ element, inert: element.inert })
      element.inert = true
    }
    snapshot = {
      hidden: root.hidden,
      contents: contents.map((element) => ({ element, nodes: [...element.childNodes] })),
      returnFocus,
      inertSiblings,
    }
  }

  const restore = (restoreFocus = true): void => {
    if (!snapshot) return
    const current = snapshot
    snapshot = undefined
    root.hidden = current.hidden
    current.contents.forEach(({ element, nodes }) => { element.replaceChildren(...nodes) })
    current.inertSiblings.forEach(({ element, inert }) => { element.inert = inert })
    if (restoreFocus && current.returnFocus?.isConnected) current.returnFocus.focus({ preventScroll: true })
  }

  return Object.freeze({ begin, restore, isActive: () => snapshot !== undefined })
}