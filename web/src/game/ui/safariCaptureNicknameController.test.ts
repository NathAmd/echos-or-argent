import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSafariCaptureNicknameController, type SafariCaptureNicknameElements } from './safariCaptureNicknameController'

class TestElement {
  hidden = true
  textContent = ''
  value = ''
  maxLength = 0
  readonly dataset: Record<string, string | undefined> = {}
  readonly attributes = new Map<string, string>()
  readonly descendants = new Map<string, TestElement>()

  querySelector<T extends Element>(selector: string): T | null {
    return (this.descendants.get(selector) ?? null) as unknown as T | null
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }
}

function createElements(): {
  elements: SafariCaptureNicknameElements
  battleScreen: TestElement
  root: TestElement
  label: TestElement
  input: TestElement
  count: TestElement
} {
  const battleScreen = new TestElement()
  battleScreen.hidden = false
  const root = new TestElement()
  const label = new TestElement()
  const input = new TestElement()
  const count = new TestElement()
  root.descendants.set('label', label)
  root.descendants.set('.field-nickname-count', count)
  root.descendants.set('button[type="submit"]', new TestElement())
  root.descendants.set('[data-nickname-cancel]', new TestElement())
  return {
    elements: {
      battleScreen: battleScreen as unknown as HTMLElement,
      root: root as unknown as HTMLElement,
      input: input as unknown as HTMLInputElement,
    },
    battleScreen,
    root,
    label,
    input,
    count,
  }
}

function createFixture() {
  const dom = createElements()
  let confirmation: ((confirmed: boolean) => void) | undefined
  const requestConfirmation = vi.fn((_prompt: string, resolve: (confirmed: boolean) => void) => {
    confirmation = resolve
  })
  const setNicknameCancellable = vi.fn()
  const prepareNicknameInput = vi.fn()
  const controller = createSafariCaptureNicknameController(dom.elements, {
    getAudio: () => undefined,
    getNicknamePromptTemplate: () => 'Donner un surnom à {101 0,0}?',
    requestConfirmation,
    setNicknameCancellable,
    prepareNicknameInput,
  })
  return {
    ...dom,
    controller,
    requestConfirmation,
    setNicknameCancellable,
    prepareNicknameInput,
    confirm: (confirmed: boolean) => {
      if (!confirmation) throw new Error('La confirmation Safari attendue est absente.')
      confirmation(confirmed)
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('surnom après capture Safari', () => {
  it('ouvre la confirmation sur Oui puis prépare la saisie non annulable', async () => {
    const fixture = createFixture()
    const completion = fixture.controller.request({ speciesName: 'RACAILLOU' }, 'Un surnom?')

    expect(fixture.battleScreen.hidden).toBe(true)
    expect(fixture.requestConfirmation).toHaveBeenCalledWith('Un surnom?', expect.any(Function), true)
    fixture.confirm(true)

    expect(fixture.root.hidden).toBe(false)
    expect(fixture.input).toMatchObject({ value: '', maxLength: 10 })
    expect(fixture.label.textContent).toBe('Donner un surnom à RACAILLOU?')
    expect(fixture.input.attributes.get('aria-label')).toBe('Donner un surnom à RACAILLOU?')
    expect(fixture.count.textContent).toBe('0/10')
    expect(fixture.setNicknameCancellable).toHaveBeenCalledWith(false)
    expect(fixture.prepareNicknameInput).toHaveBeenCalledOnce()

    let settled = false
    void completion.then(() => { settled = true })
    expect(fixture.controller.submit(undefined)).toBe(true)
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(fixture.controller.submit('ROC')).toBe(true)
    await expect(completion).resolves.toBe('ROC')
    expect(fixture.root.hidden).toBe(true)
    expect(fixture.setNicknameCancellable).toHaveBeenLastCalledWith(true)
    expect(fixture.controller.submit('IGNORÉ')).toBe(false)
  })

  it('résout sans saisie quand Non est choisi et aucun transfert PC n’est requis', async () => {
    const fixture = createFixture()
    const completion = fixture.controller.request({ speciesName: 'RACAILLOU' }, 'Un surnom?')

    fixture.confirm(false)

    await expect(completion).resolves.toBeUndefined()
    expect(fixture.root.hidden).toBe(true)
    expect(fixture.prepareNicknameInput).not.toHaveBeenCalled()
    expect(fixture.setNicknameCancellable).not.toHaveBeenCalled()
  })

  it('affiche quand même le message PC avec le nom d’espèce après un refus', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    })
    const fixture = createFixture()
    const completion = fixture.controller.request({ speciesName: 'RACAILLOU' }, 'Un surnom?', {
      template: '{101 0,0} est envoyé dans la {10b 1,0}.',
      previousBoxName: 'BOÎTE 1',
      destinationBoxName: 'BOÎTE 2',
      movedToDifferentBox: false,
    })
    let settled = false
    void completion.then(() => { settled = true })

    fixture.confirm(false)
    await Promise.resolve()

    expect(fixture.root.hidden).toBe(false)
    expect(fixture.root.dataset.phase).toBe('storage-message')
    expect(fixture.label.textContent).toBe('RACAILLOU est envoyé dans la BOÎTE 2.')
    expect(fixture.input.hidden).toBe(true)
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(1_000)
    await expect(completion).resolves.toBeUndefined()
    expect(fixture.root.hidden).toBe(true)
  })
})
