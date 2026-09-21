export type ControlActivation<T> = {
  pointerDown: (value: T) => void
  click: (value: T) => void
}

/** Pointerdown only synchronizes focus; click is the sole semantic activation. */
export function createControlActivation<T>(
  focus: (value: T) => void,
  activate: (value: T) => void,
): ControlActivation<T> {
  return {
    pointerDown: focus,
    click: (value) => {
      focus(value)
      activate(value)
    },
  }
}

/** Resolves an enabled delegated button without accepting controls from another layer. */
export function resolveEnabledButton(target: EventTarget | null, root: HTMLElement): HTMLButtonElement | undefined {
  const candidate = target as { closest?: (selector: string) => HTMLButtonElement | null } | null
  if (typeof candidate?.closest !== 'function') return undefined
  const button = candidate.closest('button:not(:disabled):not([hidden]):not([aria-disabled="true"])')
  return button && root.contains(button) ? button : undefined
}

export function createDelegatedButtonActivation(
  root: HTMLElement,
  focus: (button: HTMLButtonElement) => void,
  activate: (button: HTMLButtonElement) => void,
): { pointerDown: (event: Event) => void, click: (event: Event) => void } {
  const control = createControlActivation(focus, activate)
  const handle = (event: Event, action: (button: HTMLButtonElement) => void): void => {
    const button = resolveEnabledButton(event.target, root)
    if (button) action(button)
  }
  return {
    pointerDown: (event) => handle(event, control.pointerDown),
    click: (event) => handle(event, control.click),
  }
}
