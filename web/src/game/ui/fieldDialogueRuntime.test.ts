import { describe, expect, it, vi } from 'vitest'
import type { FieldScriptWaitKind } from './fieldDialogWait'
import {
  createFieldDialogueRuntime,
  type FieldDialogueExecutionPort,
} from './fieldDialogueRuntime'

class TestClassList {
  private readonly values = new Set<string>()

  add(...names: string[]): void {
    names.forEach((name) => { this.values.add(name) })
  }

  remove(...names: string[]): void {
    names.forEach((name) => { this.values.delete(name) })
  }

  toggle(name: string, force?: boolean): boolean {
    const enabled = force ?? !this.values.has(name)
    if (enabled) this.values.add(name)
    else this.values.delete(name)
    return enabled
  }

  contains(name: string): boolean {
    return this.values.has(name)
  }
}

class TestElement {
  readonly classList = new TestClassList()
  hidden = false
  textContent = ''
}

function createFixture(overrides: {
  consumeFinalConfirmation?: () => boolean
  onPhoneClosed?: () => void
} = {}) {
  const root = new TestElement()
  const speaker = new TestElement()
  const text = new TestElement()
  root.hidden = true
  speaker.hidden = true
  let wait: FieldScriptWaitKind | undefined
  let inputResumes = false
  const setRunner = vi.fn()
  const beginWait = vi.fn((nextWait: 'input') => { wait = nextWait })
  const clearWait = vi.fn(() => { wait = undefined })
  const resumeInput = vi.fn(() => {
    if (!inputResumes) return false
    wait = undefined
    return true
  })
  const execution: FieldDialogueExecutionPort = {
    setRunner,
    beginWait,
    clearWait,
    getWait: () => wait,
    resumeInput,
  }
  const advance = vi.fn()
  const clearMovement = vi.fn()
  const runtime = createFieldDialogueRuntime({
    root: root as unknown as HTMLElement,
    speaker: speaker as unknown as HTMLElement,
    text: text as unknown as HTMLElement,
  }, {
    execution,
    advance,
    clearMovement,
    getMaxColumns: () => 5,
    ...overrides,
  })
  return {
    runtime,
    root,
    speaker,
    text,
    advance,
    clearMovement,
    setRunner,
    beginWait,
    clearWait,
    resumeInput,
    setWait: (nextWait: FieldScriptWaitKind | undefined) => { wait = nextWait },
    allowInputResume: () => { inputResumes = true },
  }
}

describe('field dialogue runtime', () => {
  it('possède les pages et présente immédiatement le texte complet', () => {
    const fixture = createFixture()
    fixture.runtime.showMessages('un deux trois quatre cinq', { speaker: 'Orme' })

    expect(fixture.runtime.getSnapshot()).toEqual({
      visible: true,
      fullText: 'un\ndeux',
      pages: ['un\ndeux', 'trois\nquatre', 'cinq'],
      pageIndex: 0,
      complete: true,
      acknowledged: false,
      phoneActive: false,
    })
    expect(fixture.text.textContent).toBe('un\ndeux')
    expect(fixture.speaker.textContent).toBe('Orme')
    expect(fixture.root.classList.contains('has-speaker')).toBe(true)
    expect(fixture.runtime.completeText()).toBe(false)

    expect(fixture.runtime.confirm()).toBe(true)
    expect(fixture.runtime.getSnapshot()).toMatchObject({ fullText: 'trois\nquatre', pageIndex: 1 })
    expect(fixture.advance).not.toHaveBeenCalled()
  })

  it('acquitte la dernière page puis délègue les attentes reconnues', () => {
    const fixture = createFixture()
    fixture.runtime.showMessages('Message')
    fixture.runtime.confirm()

    expect(fixture.runtime.isAcknowledged()).toBe(true)
    expect(fixture.advance).toHaveBeenCalledOnce()
    fixture.setWait('timer')
    expect(fixture.runtime.skipAcknowledgedWait()).toBe(true)
    expect(fixture.clearWait).toHaveBeenLastCalledWith({ invalidateAsync: true, clearSoundEffect: true })
    expect(fixture.advance).toHaveBeenCalledTimes(2)

    fixture.runtime.setAcknowledged(true)
    fixture.setWait('movement')
    expect(fixture.runtime.skipAcknowledgedWait()).toBe(true)
    expect(fixture.runtime.getSnapshot().visible).toBe(false)
  })

  it('termine un appel une seule fois et choisit son callback avant la reprise du script', () => {
    const onComplete = vi.fn()
    const onPhoneClosed = vi.fn()
    const fixture = createFixture({ onPhoneClosed })
    fixture.runtime.openPhone('Maman', ['À bientôt.'], onComplete)

    expect(fixture.clearMovement).toHaveBeenCalledOnce()
    expect(fixture.beginWait).toHaveBeenCalledWith('input')
    expect(fixture.runtime.isPhoneActive()).toBe(true)
    expect(fixture.root.classList.contains('field-dialogue-phone')).toBe(true)

    expect(fixture.runtime.confirm()).toBe(true)
    expect(fixture.runtime.confirm()).toBe(false)
    expect(onComplete).toHaveBeenCalledOnce()
    expect(onPhoneClosed).toHaveBeenCalledOnce()
    expect(fixture.advance).not.toHaveBeenCalled()
    expect(fixture.runtime.isPhoneActive()).toBe(false)
    expect(fixture.root.hidden).toBe(true)
  })

  it('reprend une attente input seulement lorsque le port accepte l’action', () => {
    const fixture = createFixture()
    fixture.runtime.showMessages('Choix')

    expect(fixture.runtime.resumeInputWait('confirm')).toBe(false)
    fixture.allowInputResume()
    expect(fixture.runtime.resumeInputWait('confirm')).toBe(true)
    expect(fixture.advance).toHaveBeenCalledOnce()
    expect(fixture.runtime.isAcknowledged()).toBe(false)
  })

  it('laisse un propriétaire externe consommer la confirmation finale', () => {
    const consumeFinalConfirmation = vi.fn(() => true)
    const fixture = createFixture({ consumeFinalConfirmation })
    fixture.runtime.showMessages('Réaction')

    expect(fixture.runtime.confirm()).toBe(true)
    expect(consumeFinalConfirmation).toHaveBeenCalledOnce()
    expect(fixture.advance).not.toHaveBeenCalled()
    expect(fixture.runtime.isAcknowledged()).toBe(false)
  })

  it('réinitialise le rendu, le téléphone et la propriété du script', () => {
    const fixture = createFixture()
    fixture.runtime.openPhone('Orme', ['Test'])
    fixture.runtime.setAcknowledged(true)
    fixture.root.classList.add('has-waiting-icon')
    fixture.runtime.reset()

    expect(fixture.setRunner).toHaveBeenCalledWith(undefined)
    expect(fixture.clearWait).toHaveBeenLastCalledWith({
      invalidateAsync: true,
      clearAcceptedInputs: true,
      clearSoundEffect: true,
    })
    expect(fixture.runtime.getSnapshot()).toEqual({
      visible: false,
      fullText: '',
      pages: [],
      pageIndex: 0,
      complete: true,
      acknowledged: false,
      phoneActive: false,
    })
    expect(fixture.root.classList.contains('field-dialogue-phone')).toBe(false)
    expect(fixture.root.classList.contains('has-waiting-icon')).toBe(false)
  })
})
