import { describe, expect, it, vi } from 'vitest'
import { createGameInputRouter, createGamepadPoller, isKeyboardBackInput, isKeyboardTextDeletion, mapKeyboardAction, readBrowserGamepadAvailability, shouldDispatchFullscreenBack, shouldFocusGameSurfaceForGamepad, shouldPreventGameplayBrowserDefault, type GameDigitalEvent } from './gameInput'

function gamepad(pressedButtons: number[] = [], axes: number[] = [0, 0], id?: string) {
  return {
    id,
    axes,
    buttons: Array.from({ length: 16 }, (_, index) => ({ pressed: pressedButtons.includes(index) } as GamepadButton)),
  }
}

describe('game input router', () => {
  it('centralise Escape et Shift comme Retour, sans confondre Backspace avec l’édition', () => {
    for (const inputId of ['Escape', 'Shift']) {
      expect(mapKeyboardAction({ key: inputId } as KeyboardEvent)).toBe('cancel')
      expect(isKeyboardBackInput({ action: 'cancel', pressed: true, source: 'keyboard', inputId })).toBe(true)
    }
    expect(isKeyboardBackInput({ action: 'cancel', pressed: true, source: 'keyboard', inputId: 'Backspace' })).toBe(false)
    expect(isKeyboardTextDeletion({ action: 'cancel', pressed: true, source: 'keyboard', inputId: 'Backspace' })).toBe(true)
    expect(isKeyboardBackInput({ action: 'cancel', pressed: true, source: 'gamepad', inputId: '1' })).toBe(false)
  })

  it('récupère Retour lorsque Escape quitte le plein écran sans événement clavier', () => {
    expect(shouldDispatchFullscreenBack(true, false, false)).toBe(true)
    expect(shouldDispatchFullscreenBack(true, false, true)).toBe(false)
    expect(shouldDispatchFullscreenBack(false, false, false)).toBe(false)
  })

  it('routes keyboard, pointer and automation through the same digital event contract', () => {
    const events: GameDigitalEvent[] = []
    const router = createGameInputRouter((event) => events.push(event))

    expect(router.keyboard({ key: 'ArrowUp' } as KeyboardEvent, true)).toBe(true)
    expect(router.keyboard({ key: 'x' } as KeyboardEvent, true)).toBe(true)
    router.pointer('confirm')
    router.dispatch('right', true, 'automation', 'test-tape:smoke:4')
    router.dispatch('right', false, 'automation', 'test-tape:smoke:4')

    expect(events).toEqual([
      { action: 'up', pressed: true, source: 'keyboard', inputId: 'ArrowUp' },
      { action: 'secondary', pressed: true, source: 'keyboard', inputId: 'x' },
      { action: 'confirm', pressed: true, source: 'pointer', inputId: undefined },
      { action: 'confirm', pressed: false, source: 'pointer', inputId: undefined },
      { action: 'right', pressed: true, source: 'automation', inputId: 'test-tape:smoke:4' },
      { action: 'right', pressed: false, source: 'automation', inputId: 'test-tape:smoke:4' },
    ])
  })

  it('préserve l’identité du périphérique à travers le routeur central', () => {
    const events: GameDigitalEvent[] = []
    const router = createGameInputRouter((event) => events.push(event))

    router.dispatch('menu', true, 'gamepad', undefined, 'Steam Deck')

    expect(events).toEqual([{ action: 'menu', pressed: true, source: 'gamepad', inputId: undefined, deviceId: 'Steam Deck' }])
  })

  it('capture les commandes avant la page tout en préservant une vraie saisie', () => {
    const target = (tagName: string, isContentEditable = false) => ({ tagName, isContentEditable }) as unknown as EventTarget

    expect(shouldPreventGameplayBrowserDefault({ key: 'ArrowDown', target: target('BUTTON') })).toBe(true)
    expect(shouldPreventGameplayBrowserDefault({ key: ' ', target: target('BODY') })).toBe(true)
    expect(shouldPreventGameplayBrowserDefault({ key: 'Escape', target: target('INPUT') })).toBe(true)
    expect(shouldPreventGameplayBrowserDefault({ key: 'ArrowLeft', target: target('INPUT') })).toBe(false)
    expect(shouldPreventGameplayBrowserDefault({ key: 'Backspace', target: target('TEXTAREA') })).toBe(false)
    expect(shouldPreventGameplayBrowserDefault({ key: 'x', target: target('INPUT') })).toBe(false)
    expect(shouldPreventGameplayBrowserDefault({ key: 'a', target: target('DIV', true) })).toBe(false)
    expect(shouldPreventGameplayBrowserDefault({ key: 'Tab', target: target('BODY') })).toBe(false)
  })

  it('ne vole pas le focus roving d’un dialogue pendant la navigation manette', () => {
    expect(shouldFocusGameSurfaceForGamepad({ pressed: true, source: 'gamepad' }, false)).toBe(true)
    expect(shouldFocusGameSurfaceForGamepad({ pressed: true, source: 'gamepad' }, true)).toBe(false)
    expect(shouldFocusGameSurfaceForGamepad({ pressed: false, source: 'gamepad' }, false)).toBe(false)
    expect(shouldFocusGameSurfaceForGamepad({ pressed: true, source: 'keyboard' }, false)).toBe(false)
  })

  it("reste inerte et expose une raison présentable quand l'API Gamepad est absente", () => {
    expect(readBrowserGamepadAvailability({})).toEqual({
      available: false,
      reason: 'Les manettes ne sont pas disponibles dans ce navigateur; les commandes tactiles restent utilisables.',
    })
    const events: GameDigitalEvent[] = []
    vi.stubGlobal('navigator', {})
    try {
      const poller = createGamepadPoller((event) => events.push(event))
      expect(() => poller.poll()).not.toThrow()
      expect(events).toEqual([])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("ignore une lecture Gamepad refusée par l'appareil sans interrompre la boucle", () => {
    vi.stubGlobal('navigator', { getGamepads: () => { throw new Error('permission refusée') } })
    try {
      const poller = createGamepadPoller(vi.fn())
      expect(() => poller.poll()).not.toThrow()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('repeats held gamepad directions after a delay and uses axis hysteresis', () => {
    const events: GameDigitalEvent[] = []
    let timestamp = 0
    let current = gamepad([], [0, 0.6])
    const poller = createGamepadPoller((event) => events.push(event), {
      now: () => timestamp,
      readGamepads: () => [current],
      initialRepeatDelayMs: 300,
      repeatIntervalMs: 100,
    })

    poller.poll()
    timestamp = 299
    poller.poll()
    timestamp = 300
    poller.poll()
    timestamp = 400
    current = gamepad([], [0, 0.4])
    poller.poll()
    timestamp = 500
    current = gamepad([], [0, 0.2])
    poller.poll()

    expect(events.map(({ action, pressed, source }) => ({ action, pressed, source }))).toEqual([
      { action: 'down', pressed: true, source: 'gamepad' },
      { action: 'down', pressed: true, source: 'gamepad' },
      { action: 'down', pressed: true, source: 'gamepad' },
      { action: 'down', pressed: false, source: 'gamepad' },
    ])
  })

  it('gives an unambiguous D-pad direction priority over an opposing stick while preserving repeat and release', () => {
    const events: GameDigitalEvent[] = []
    let timestamp = 0
    let current = gamepad([14], [0.8, 0])
    const poller = createGamepadPoller((event) => events.push(event), {
      now: () => timestamp,
      readGamepads: () => [current],
      initialRepeatDelayMs: 300,
      repeatIntervalMs: 100,
    })

    poller.poll()
    timestamp = 300
    poller.poll()
    timestamp = 301
    current = gamepad([], [0.8, 0])
    poller.poll()
    timestamp = 601
    current = gamepad([], [0.4, 0])
    poller.poll()
    timestamp = 602
    current = gamepad([], [0.2, 0])
    poller.poll()

    expect(events.map(({ action, pressed }) => ({ action, pressed }))).toEqual([
      { action: 'left', pressed: true },
      { action: 'left', pressed: true },
      { action: 'left', pressed: false },
      { action: 'right', pressed: true },
      { action: 'right', pressed: true },
      { action: 'right', pressed: false },
    ])
  })

  it('arbitrates vertical D-pad and stick conflicts without emitting opposing presses', () => {
    const events: GameDigitalEvent[] = []
    let current = gamepad([12], [0, 0.8])
    const poller = createGamepadPoller((event) => events.push(event), {
      readGamepads: () => [current],
    })

    poller.poll()
    current = gamepad([13], [0, -0.8])
    poller.poll()

    expect(events).toEqual([
      { action: 'up', pressed: true, source: 'gamepad' },
      { action: 'up', pressed: false, source: 'gamepad' },
      { action: 'down', pressed: true, source: 'gamepad' },
    ])
  })

  it('neutralizes equally ranked opposing directions and retains a previous winner deterministically', () => {
    const events: GameDigitalEvent[] = []
    let currentGamepads = [gamepad([14])]
    const poller = createGamepadPoller((event) => events.push(event), {
      readGamepads: () => currentGamepads,
    })

    poller.poll()
    currentGamepads = [gamepad([14]), gamepad([15])]
    poller.poll()
    currentGamepads = [gamepad([14, 15])]
    poller.reset()
    poller.poll()

    expect(events).toEqual([
      { action: 'left', pressed: true, source: 'gamepad' },
      { action: 'left', pressed: false, source: 'gamepad' },
    ])
  })

  it('does not repeat confirm buttons', () => {
    const onEvent = vi.fn()
    let timestamp = 0
    const poller = createGamepadPoller(onEvent, {
      now: () => timestamp,
      readGamepads: () => [gamepad([0])],
      initialRepeatDelayMs: 10,
    })

    poller.poll()
    timestamp = 100
    poller.poll()

    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(onEvent).toHaveBeenCalledWith({ action: 'confirm', pressed: true, source: 'gamepad' })
  })

  it('mappe les boutons standards Deck, avec Y, Select et Start comme accès menu fiables', () => {
    const events: GameDigitalEvent[] = []
    const poller = createGamepadPoller((event) => events.push(event), {
      readGamepads: () => [gamepad([2, 3, 4, 5])],
    })

    poller.poll()

    expect(events.filter(({ pressed }) => pressed).map(({ action }) => action)).toEqual([
      'secondary', 'menu', 'page-previous', 'page-next',
    ])
  })

  it.each([3, 8, 9])('ouvre le menu avec le bouton standard %i', (button) => {
    const events: GameDigitalEvent[] = []
    createGamepadPoller((event) => events.push(event), {
      readGamepads: () => [gamepad([button])],
    }).poll()

    expect(events).toEqual([{ action: 'menu', pressed: true, source: 'gamepad' }])
  })

  it('identifies the controller that actually produced the action', () => {
    const events: GameDigitalEvent[] = []
    const poller = createGamepadPoller((event) => events.push(event), {
      readGamepads: () => [gamepad([], [0, 0], 'Xbox Wireless Controller'), gamepad([0], [0, 0], 'Nintendo Switch Pro Controller')],
    })

    poller.poll()

    expect(events).toEqual([{ action: 'confirm', pressed: true, source: 'gamepad', deviceId: 'Nintendo Switch Pro Controller' }])
  })

  it('releases held controls and starts cleanly after an OS focus interruption', () => {
    const events: GameDigitalEvent[] = []
    let current = gamepad([1, 12])
    const poller = createGamepadPoller((event) => events.push(event), {
      readGamepads: () => [current],
    })

    poller.poll()
    poller.reset()
    current = gamepad()
    poller.poll()

    expect(events).toEqual([
      { action: 'cancel', pressed: true, source: 'gamepad' },
      { action: 'up', pressed: true, source: 'gamepad' },
      { action: 'cancel', pressed: false, source: 'gamepad' },
      { action: 'up', pressed: false, source: 'gamepad' },
    ])
  })
})
