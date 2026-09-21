import { describe, expect, it, vi } from 'vitest'
import { createBrowserInputBindings, type BrowserInputBindingsOptions } from './browserInputBindings'

type RegisteredListener = Readonly<{
  listener: EventListenerOrEventListenerObject
  capture: boolean
}>

class TestEventTarget {
  private readonly listeners = new Map<string, RegisteredListener[]>()

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    const registered = this.listeners.get(type) ?? []
    registered.push({ listener, capture: typeof options === 'boolean' ? options : Boolean(options?.capture) })
    this.listeners.set(type, registered)
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void {
    const capture = typeof options === 'boolean' ? options : Boolean(options?.capture)
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((registered) => (
      registered.listener !== listener || registered.capture !== capture
    )))
  }

  dispatch(type: string, event: Event): void {
    const registered = [...(this.listeners.get(type) ?? [])]
      .sort((left, right) => Number(right.capture) - Number(left.capture))
    for (const { listener } of registered) {
      if (typeof listener === 'function') listener.call(this, event)
      else listener.handleEvent(event)
    }
  }

  listenerCount(): number {
    return [...this.listeners.values()].reduce((count, registered) => count + registered.length, 0)
  }
}

class TestVisualViewport extends TestEventTarget {
  height = 640
}

function createKeyboardEvent(defaultPrevented = false): KeyboardEvent {
  return {
    defaultPrevented,
    preventDefault() {
      Object.defineProperty(this, 'defaultPrevented', { value: true, configurable: true })
    },
  } as KeyboardEvent
}

function createFixture(overrides: Partial<BrowserInputBindingsOptions> = {}) {
  const target = new TestEventTarget()
  const viewport = new TestVisualViewport()
  const ports = {
    shouldPreventKeyboardDefault: vi.fn(() => true),
    captureKeyboard: vi.fn(),
    onKeyboardActivity: vi.fn(),
    onKeyDown: vi.fn(),
    onKeyUp: vi.fn(),
    onPointerDown: vi.fn(),
    onPointerMove: vi.fn(),
    onGamepadConnected: vi.fn(),
    onGamepadDisconnected: vi.fn(),
    onBlur: vi.fn(),
    onResize: vi.fn(),
    onVisualViewportResize: vi.fn(),
  }
  const bindings = createBrowserInputBindings({
    target: target as unknown as Window,
    visualViewport: viewport as unknown as VisualViewport,
    ...ports,
    ...overrides,
  })
  return { target, viewport, ports, bindings }
}

describe('browser input bindings', () => {
  it('attaches browser-global input and viewport listeners through ports', () => {
    const fixture = createFixture()
    const keyDown = createKeyboardEvent()
    const keyUp = createKeyboardEvent()
    const pointerDown = {} as PointerEvent
    const pointerMove = {} as PointerEvent
    const connected = { gamepad: { id: 'pad-1' } } as GamepadEvent
    const disconnected = { gamepad: { id: 'pad-1' } } as GamepadEvent

    fixture.target.dispatch('keydown', keyDown)
    fixture.target.dispatch('keyup', keyUp)
    fixture.target.dispatch('pointerdown', pointerDown)
    fixture.target.dispatch('pointermove', pointerMove)
    fixture.target.dispatch('gamepadconnected', connected)
    fixture.target.dispatch('gamepaddisconnected', disconnected)
    fixture.target.dispatch('blur', {} as Event)
    fixture.target.dispatch('resize', {} as Event)
    fixture.viewport.dispatch('resize', {} as Event)

    expect(keyDown.defaultPrevented).toBe(true)
    expect(fixture.ports.captureKeyboard).toHaveBeenCalledOnce()
    expect(fixture.ports.onKeyboardActivity).toHaveBeenCalledOnce()
    expect(fixture.ports.onKeyDown).toHaveBeenCalledWith(keyDown)
    expect(fixture.ports.onKeyUp).toHaveBeenCalledWith(keyUp)
    expect(fixture.ports.onPointerDown).toHaveBeenCalledWith(pointerDown)
    expect(fixture.ports.onPointerMove).toHaveBeenCalledWith(pointerMove)
    expect(fixture.ports.onGamepadConnected).toHaveBeenCalledWith(connected)
    expect(fixture.ports.onGamepadDisconnected).toHaveBeenCalledWith(disconnected)
    expect(fixture.ports.onBlur).toHaveBeenCalledOnce()
    expect(fixture.ports.onResize).toHaveBeenCalledOnce()
    expect(fixture.ports.onVisualViewportResize).toHaveBeenCalledWith(640)
  })

  it('does not dispatch a keydown consumed outside the gameplay capture handler', () => {
    const fixture = createFixture({ shouldPreventKeyboardDefault: () => false })
    const externallyPrevented = createKeyboardEvent(true)

    fixture.target.dispatch('keydown', externallyPrevented)

    expect(fixture.ports.captureKeyboard).not.toHaveBeenCalled()
    expect(fixture.ports.onKeyboardActivity).toHaveBeenCalledOnce()
    expect(fixture.ports.onKeyDown).not.toHaveBeenCalled()
  })

  it('disposes every listener once and stops forwarding browser events', () => {
    const fixture = createFixture()
    expect(fixture.target.listenerCount()).toBe(9)
    expect(fixture.viewport.listenerCount()).toBe(1)

    fixture.bindings.dispose()
    fixture.bindings.dispose()

    expect(fixture.target.listenerCount()).toBe(0)
    expect(fixture.viewport.listenerCount()).toBe(0)
    fixture.target.dispatch('keydown', createKeyboardEvent())
    fixture.target.dispatch('blur', {} as Event)
    fixture.viewport.dispatch('resize', {} as Event)
    expect(fixture.ports.captureKeyboard).not.toHaveBeenCalled()
    expect(fixture.ports.onKeyboardActivity).not.toHaveBeenCalled()
    expect(fixture.ports.onBlur).not.toHaveBeenCalled()
    expect(fixture.ports.onVisualViewportResize).not.toHaveBeenCalled()
  })
})
