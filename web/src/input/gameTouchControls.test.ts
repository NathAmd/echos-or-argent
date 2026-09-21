import { describe, expect, it, vi } from 'vitest'
import type { GameDigitalEvent } from '../gameInput'
import { createGameTouchControls } from './gameTouchControls'

type TestListener = (event: TestEvent) => void

class TestEvent {
  readonly pointerId: number
  readonly pointerType: string
  readonly preventDefault = vi.fn()
  readonly stopPropagation = vi.fn()

  constructor(pointerId = 0, pointerType = 'touch') {
    this.pointerId = pointerId
    this.pointerType = pointerType
  }
}

class TestMediaQuery {
  matches: boolean
  private readonly listeners = new Set<() => void>()

  constructor(matches: boolean) {
    this.matches = matches
  }

  addEventListener(_type: string, listener: () => void): void { this.listeners.add(listener) }
  removeEventListener(_type: string, listener: () => void): void { this.listeners.delete(listener) }
  change(matches: boolean): void {
    this.matches = matches
    for (const listener of this.listeners) listener()
  }
}

class TestDocument {
  defaultView = null

  createElement(tagName: string): TestElement {
    return new TestElement(this, tagName)
  }
}

class TestElement {
  readonly ownerDocument: TestDocument
  readonly tagName: string
  readonly children: TestElement[] = []
  readonly dataset: Record<string, string | undefined> = {}
  readonly attributes = new Map<string, string>()
  readonly listeners = new Map<string, Set<TestListener>>()
  parentElement?: TestElement
  className = ''
  textContent = ''
  type = ''
  hidden = false
  inert = false

  constructor(ownerDocument: TestDocument, tagName: string) {
    this.ownerDocument = ownerDocument
    this.tagName = tagName.toUpperCase()
  }

  append(...children: TestElement[]): void {
    for (const child of children) {
      child.parentElement = this
      this.children.push(child)
    }
  }

  remove(): void {
    if (!this.parentElement) return
    const index = this.parentElement.children.indexOf(this)
    if (index >= 0) this.parentElement.children.splice(index, 1)
    this.parentElement = undefined
  }

  setAttribute(name: string, value: string): void { this.attributes.set(name, value) }
  addEventListener(type: string, listener: TestListener): void {
    const listeners = this.listeners.get(type) ?? new Set<TestListener>()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }
  removeEventListener(type: string, listener: TestListener): void { this.listeners.get(type)?.delete(listener) }
  setPointerCapture(pointerId: number): void { void pointerId }
  emit(type: string, event = new TestEvent()): TestEvent {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
    return event
  }

  find(action: string): TestElement {
    if (this.dataset.gameTouchAction === action) return this
    for (const child of this.children) {
      try { return child.find(action) } catch { /* Continue dans la branche suivante. */ }
    }
    throw new Error(`Contrôle tactile ${action} absent.`)
  }
}

function fixture(options: { coarse?: boolean, touchPoints?: number } = {}) {
  const document = new TestDocument()
  const panel = new TestElement(document, 'section')
  const mediaQuery = new TestMediaQuery(options.coarse ?? true)
  const events: GameDigitalEvent[] = []
  let enabled = true
  let blocked = false
  const controls = createGameTouchControls({
    panel: panel as unknown as HTMLElement,
    dispatch: (action, pressed, source, inputId, deviceId) => {
      events.push({ action, pressed, source, inputId, ...(deviceId ? { deviceId } : {}) })
    },
    isEnabled: () => enabled,
    isBlocked: () => blocked,
    dependencies: {
      mediaQuery: mediaQuery as unknown as MediaQueryList,
      maximumTouchPoints: options.touchPoints ?? 0,
    },
  })
  const root = panel.children[0]!
  return {
    controls,
    panel,
    root,
    mediaQuery,
    events,
    setEnabled: (value: boolean) => { enabled = value },
    setBlocked: (value: boolean) => { blocked = value },
  }
}

describe('game touch controls', () => {
  it('route un appui directionnel maintenu par la voie numérique centrale', () => {
    const context = fixture()
    const up = context.root.find('up')
    const down = new TestEvent(7)
    const upEvent = new TestEvent(7)

    up.emit('pointerdown', down)
    expect(context.events).toEqual([{
      action: 'up', pressed: true, source: 'pointer', inputId: 'touch:up:7',
    }])
    expect(up.dataset.pressed).toBe('true')
    expect(down.preventDefault).toHaveBeenCalledOnce()
    expect(down.stopPropagation).toHaveBeenCalledOnce()

    up.emit('pointerup', upEvent)
    expect(context.events.at(-1)).toEqual({
      action: 'up', pressed: false, source: 'pointer', inputId: 'touch:up:7',
    })
    expect(up.dataset.pressed).toBeUndefined()
  })

  it('accepte le multitouch direction plus action sans dupliquer un même bouton', () => {
    const context = fixture()
    const left = context.root.find('left')
    const cancel = context.root.find('cancel')

    left.emit('pointerdown', new TestEvent(1))
    left.emit('pointerdown', new TestEvent(2))
    cancel.emit('pointerdown', new TestEvent(3))
    expect(context.events.map(({ action, pressed }) => [action, pressed])).toEqual([
      ['left', true],
      ['cancel', true],
    ])

    left.emit('pointerup', new TestEvent(1))
    expect(context.events).toHaveLength(2)
    left.emit('pointercancel', new TestEvent(2))
    cancel.emit('lostpointercapture', new TestEvent(3))
    expect(context.events.map(({ action, pressed }) => [action, pressed])).toEqual([
      ['left', true],
      ['cancel', true],
      ['left', false],
      ['cancel', false],
    ])
  })

  it('relâche et masque le pad dès qu’une modale ou le clavier central bloque le jeu', () => {
    const context = fixture()
    const right = context.root.find('right')
    right.emit('pointerdown', new TestEvent(12))

    context.setBlocked(true)
    context.controls.sync()
    expect(context.root.hidden).toBe(true)
    expect(context.root.inert).toBe(true)
    expect(context.root.attributes.get('aria-hidden')).toBe('true')
    expect(context.events.at(-1)).toMatchObject({ action: 'right', pressed: false })

    right.emit('pointerdown', new TestEvent(13))
    expect(context.events).toHaveLength(2)
    context.setBlocked(false)
    context.setEnabled(false)
    context.controls.sync()
    expect(context.root.hidden).toBe(true)
  })

  it('expose une raison stable hors appareil tactile et suit un changement coarse-pointer', () => {
    const context = fixture({ coarse: false })
    expect(context.controls.getState()).toEqual({
      available: false,
      visible: false,
      reason: 'Les commandes tactiles ne sont pas disponibles sur cet appareil.',
    })
    expect(context.root.hidden).toBe(true)

    context.mediaQuery.change(true)
    expect(context.controls.getState()).toEqual({ available: true, visible: true })
    expect(context.root.hidden).toBe(false)

    context.controls.dispose()
    expect(context.panel.children).toEqual([])
  })
})
