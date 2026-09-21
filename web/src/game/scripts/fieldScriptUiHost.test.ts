import { describe, expect, it, vi } from 'vitest'
import type { NitroGraphic, OpeningMapPreview, RomInventory } from '../../ndsTypes'
import type { FieldScriptState } from './fieldScriptRunner'
import type { FieldScriptRunner, FieldScriptStep } from './fieldScriptProtocol'
import {
  createFieldScriptUiHost,
  type FieldScriptUiHostContext,
  type FieldScriptUiHostOptions,
} from './fieldScriptUiHost'

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
  readonly dataset: Record<string, string | undefined> = {}
  readonly attributes = new Map<string, string>()
  readonly queries = new Map<string, TestElement>()
  hidden = true
  textContent = ''
  value = ''
  min = ''
  max = ''
  maxLength = 0
  replaced = false
  animated = false

  querySelector<T>(selector: string): T | null {
    return (this.queries.get(selector) ?? null) as T | null
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name)
  }

  replaceChildren(): void {
    this.replaced = true
  }

  animate(): Animation {
    this.animated = true
    return {} as Animation
  }
}

function runner(): FieldScriptRunner & { choose: ReturnType<typeof vi.fn<(value: number) => void>> } {
  const choose = vi.fn<(value: number) => void>()
  return {
    resume: () => ({ kind: 'ended' }),
    choose,
    enterNumber: vi.fn(),
    enterNickname: vi.fn(),
    submitBattleResult: vi.fn(),
    submitMultiplayerResult: vi.fn(),
    submitEasyChat: vi.fn(),
    closePcBox: vi.fn(),
    closePokeathlonApp: vi.fn(),
    closeFrontierRecordsApp: vi.fn(),
    closeGameClear: vi.fn(),
    finishAlphPuzzle: vi.fn(),
    closeAlphHiddenRoom: vi.fn(),
    finishEggHatch: vi.fn(),
  }
}

function createFixture() {
  const dialogueElement = new TestElement()
  const portrait = new TestElement()
  const nickname = new TestElement()
  const nicknameInput = new TestElement()
  const nicknameLabel = new TestElement()
  const nicknameCount = new TestElement()
  nickname.queries.set('label', nicknameLabel)
  nickname.queries.set('.field-nickname-count', nicknameCount)
  const number = new TestElement()
  const numberInput = new TestElement()
  number.queries.set('input[type="number"]', numberInput)
  numberInput.setAttribute('aria-label', 'Nombre')
  const uiMessageBanks: Array<Record<number, string> | undefined> = []
  uiMessageBanks[249] = { 1: 'Donner un surnom ?', 3: 'Nom du rival ?', 5: 'Votre nom ?' }
  uiMessageBanks[191] = { 69: 'DÉPLACER', 67: 'RETIRER', 68: 'DÉPOSER', 70: 'OBJETS' }
  uiMessageBanks[271] = { 8: 'Mettre de l’argent de côté', 9: 'Ne pas mettre d’argent de côté' }
  const graphic = {} as NitroGraphic
  const battlePokemonSpriteResolver = vi.fn(() => ({ frames: [graphic] }))
  const phoneContactMessages: Array<Record<number, string> | undefined> = []
  phoneContactMessages[0] = { 22: 'Économiser ?', 25: 'Je vais économiser.', 26: 'Je n’économiserai pas.' }
  phoneContactMessages[1] = { 33: 'Bonjour depuis la ROM.' }
  const phoneContactNames: Array<string | undefined> = []
  phoneContactNames[0] = 'Maman'
  phoneContactNames[1] = 'Prof. Orme'
  const inventory = {
    uiMessageBanks,
    phoneContactMessages,
    phoneContactNames,
    battlePokemonSpriteResolver,
    trainerCatalog: [],
    trainerNames: [],
    trainerClassNames: [],
  } as unknown as RomInventory
  const state = {
    buffers: new Map<number, string>(),
    playerName: 'LUTH',
    rivalName: 'SILVER',
    pokedex: { caughtSpeciesIds: new Set<number>([1, 2]) },
    flags: new Set<number>(),
  } as FieldScriptState
  const map = {
    id: 1,
    events: {
      objects: [{ id: 7, spriteId: 99, type: 0, scriptId: 4 }],
    },
  } as OpeningMapPreview
  const world = { getState: () => ({ map }) }
  const setAcknowledged = vi.fn()
  const showMessages = vi.fn()
  const openPhone = vi.fn()
  const hideDialogue = vi.fn()
  const clearWait = vi.fn()
  const beginWait = vi.fn()
  let unwinding = false
  let unifiedChoice: number | undefined
  const resolveChoice = vi.fn(() => unifiedChoice)
  const safariPresent = vi.fn()
  const photoPresent = vi.fn()
  const choiceOpen = vi.fn()
  const setNicknameCancellable = vi.fn()
  const openNickname = vi.fn()
  const openNumber = vi.fn()
  const easyChatOpen = vi.fn()
  const openPuzzle = vi.fn()
  const openInscription = vi.fn()
  const pcBoxOpen = vi.fn()
  const recordAppsOpen = vi.fn()
  const phoneChoiceOpen = vi.fn()
  const formatFieldMessage = vi.fn((message: string) => `FORMAT:${message}`)
  const mountGraphic = vi.fn()
  const startEggHatch = vi.fn()
  const clearMovement = vi.fn()
  const refreshInputPrompts = vi.fn()
  const advanceScript = vi.fn()
  const options: FieldScriptUiHostOptions = {
    elements: {
      dialogue: dialogueElement as unknown as HTMLElement,
      pokemonPortrait: portrait as unknown as HTMLElement,
      nickname: nickname as unknown as HTMLElement,
      nicknameInput: nicknameInput as unknown as HTMLInputElement,
      number: number as unknown as HTMLFormElement,
      numberInput: numberInput as unknown as HTMLInputElement,
    },
    dialogue: { setAcknowledged, showMessages, openPhone, hide: hideDialogue },
    execution: { clearWait, beginWait },
    unifiedPc: {
      isUnwinding: () => unwinding,
      resolveChoice,
    },
    safari: { present: safariPresent },
    photoAlbum: { present: photoPresent },
    choice: { open: choiceOpen },
    textEntry: { setNicknameCancellable, openNickname, openNumber },
    easyChat: { open: easyChatOpen },
    alph: { openPuzzle, openInscription },
    pcBox: { open: pcBoxOpen },
    recordApps: { open: recordAppsOpen },
    phoneChoice: { open: phoneChoiceOpen },
    readContext: () => ({
      state,
      world: world as unknown as FieldScriptUiHostContext['world'],
      inventory,
      playerGender: 'male',
    }),
    formatFieldMessage,
    mountGraphic,
    startEggHatch,
    clearMovement,
    refreshInputPrompts,
    advanceScript,
  }
  return {
    handler: createFieldScriptUiHost(options),
    state,
    inventory,
    map,
    dialogueElement,
    portrait,
    nickname,
    nicknameInput,
    nicknameLabel,
    nicknameCount,
    number,
    numberInput,
    setAcknowledged,
    showMessages,
    openPhone,
    hideDialogue,
    clearWait,
    beginWait,
    resolveChoice,
    safariPresent,
    photoPresent,
    choiceOpen,
    setNicknameCancellable,
    openNickname,
    openNumber,
    easyChatOpen,
    openPuzzle,
    openInscription,
    pcBoxOpen,
    recordAppsOpen,
    phoneChoiceOpen,
    formatFieldMessage,
    mountGraphic,
    startEggHatch,
    clearMovement,
    refreshInputPrompts,
    advanceScript,
    setUnwinding: (value: boolean) => { unwinding = value },
    setUnifiedChoice: (value: number | undefined) => { unifiedChoice = value },
  }
}

const routedSteps: ReadonlyArray<readonly [FieldScriptStep, 'continue' | 'suspend']> = [
  [{ kind: 'safariCustomizer' } as FieldScriptStep, 'suspend'],
  [{ kind: 'safariDecorator' } as FieldScriptStep, 'suspend'],
  [{ kind: 'photoCapture' } as FieldScriptStep, 'suspend'],
  [{ kind: 'photoAlbum' } as FieldScriptStep, 'suspend'],
  [{ kind: 'message', messageId: 1, text: 'Bonjour' }, 'suspend'],
  [{ kind: 'dialogue', action: 'open' }, 'continue'],
  [{ kind: 'pokemonPortrait', action: 'show', speciesId: 155, gender: 0 }, 'continue'],
  [{ kind: 'phoneCall', call: { callerId: 1, parameter1: 2, parameter2: 0 } }, 'suspend'],
  [{ kind: 'choice', options: [], cancellable: false }, 'suspend'],
  [{ kind: 'nickname', slot: 0, currentName: 'FLAMME', maxLength: 10, cancellable: true, promptMessageId: 1 }, 'suspend'],
  [{ kind: 'eggHatch' } as FieldScriptStep, 'suspend'],
  [{ kind: 'number', min: 1, max: 12 }, 'suspend'],
  [{ kind: 'easyChat' } as FieldScriptStep, 'suspend'],
  [{ kind: 'alphPuzzle' } as FieldScriptStep, 'suspend'],
  [{ kind: 'alphHiddenRoom' } as FieldScriptStep, 'suspend'],
  [{ kind: 'pcBox', mode: 2 }, 'suspend'],
  [{ kind: 'pokeathlonApp' } as FieldScriptStep, 'suspend'],
  [{ kind: 'frontierRecordsApp' } as FieldScriptStep, 'suspend'],
  [{ kind: 'gameClear' } as FieldScriptStep, 'suspend'],
]

describe('field script UI host', () => {
  it.each(routedSteps)('route $kind avec la disposition attendue', (step, disposition) => {
    const fixture = createFixture()
    expect(fixture.handler.handle(step, runner())).toBe(disposition)
  })

  it('laisse explicitement les étapes hors UI aux autres hosts', () => {
    const fixture = createFixture()
    expect(fixture.handler.handle({ kind: 'ended' }, runner())).toBe('unhandled')
  })

  it('présente un message formaté avec le locuteur ROM et suspend sur input', () => {
    const fixture = createFixture()
    const disposition = fixture.handler.handle({
      kind: 'message',
      messageId: 2,
      text: 'Texte ROM',
      speakerObjectId: 7,
    }, runner())

    expect(disposition).toBe('suspend')
    expect(fixture.setAcknowledged).toHaveBeenCalledWith(false)
    expect(fixture.clearWait).toHaveBeenCalledWith({ clearAcceptedInputs: true })
    expect(fixture.clearMovement).toHaveBeenCalledOnce()
    expect(fixture.showMessages).toHaveBeenCalledWith('FORMAT:Texte ROM', { speaker: 'Prof. Orme' })
    expect(fixture.beginWait).toHaveBeenCalledWith('input')
  })

  it('continue sans présenter les messages pendant le déroulage du PC unifié', () => {
    const fixture = createFixture()
    fixture.setUnwinding(true)

    expect(fixture.handler.handle({ kind: 'message', messageId: 1, text: 'Ignoré' }, runner())).toBe('continue')
    expect(fixture.showMessages).not.toHaveBeenCalled()
    expect(fixture.clearMovement).not.toHaveBeenCalled()
    expect(fixture.setAcknowledged).not.toHaveBeenCalled()
  })

  it('résout le choix du PC unifié dans le runner et continue immédiatement', () => {
    const fixture = createFixture()
    const activeRunner = runner()
    fixture.setUnifiedChoice(7)
    const step: FieldScriptStep = {
      kind: 'choice',
      options: [{ value: 7, label: 'DÉPLACER' }],
      cancellable: true,
    }

    expect(fixture.handler.handle(step, activeRunner)).toBe('continue')
    expect(activeRunner.choose).toHaveBeenCalledWith(7)
    expect(fixture.choiceOpen).not.toHaveBeenCalled()
    expect(fixture.setAcknowledged).not.toHaveBeenCalled()
  })

  it('résout et ouvre un appel Pokématos depuis les banques ROM', () => {
    const fixture = createFixture()
    const disposition = fixture.handler.handle({
      kind: 'phoneCall',
      call: { callerId: 1, parameter1: 2, parameter2: 0 },
    }, runner())

    expect(disposition).toBe('suspend')
    expect(fixture.state.buffers.get(0)).toBe('LUTH')
    expect(fixture.formatFieldMessage).toHaveBeenCalledWith('Bonjour depuis la ROM.', fixture.state)
    expect(fixture.openPhone).toHaveBeenCalledWith('Prof. Orme', ['FORMAT:Bonjour depuis la ROM.'])
  })

  it('enchaîne le choix d’épargne de Maman et ne reprend le script qu’après sa réponse', () => {
    const fixture = createFixture()
    const disposition = fixture.handler.handle({
      kind: 'phoneCall',
      call: { callerId: 0, parameter1: 2, parameter2: 0 },
    }, runner())

    expect(disposition).toBe('suspend')
    expect(fixture.state.flags.has(0xa7)).toBe(true)
    expect(fixture.openPhone).toHaveBeenCalledWith(
      'Maman',
      ['FORMAT:Économiser ?'],
      expect.any(Function),
    )
    expect(fixture.phoneChoiceOpen).not.toHaveBeenCalled()

    const initialDialogueComplete = fixture.openPhone.mock.calls[0]?.[2]
    expect(initialDialogueComplete).toBeTypeOf('function')
    initialDialogueComplete?.()
    const request = fixture.phoneChoiceOpen.mock.calls[0]?.[0]
    expect(request).toMatchObject({
      title: 'Maman',
      message: 'FORMAT:Économiser ?',
      options: [
        { value: 'yes', label: 'FORMAT:Mettre de l’argent de côté' },
        { value: 'no', label: 'FORMAT:Ne pas mettre d’argent de côté' },
      ],
      initialIndex: 0,
      cancelIndex: 1,
    })

    request?.onSelect('yes')
    expect(fixture.state.flags.has(0x986)).toBe(true)
    expect(fixture.openPhone).toHaveBeenLastCalledWith(
      'Maman',
      ['FORMAT:Je vais économiser.'],
      fixture.advanceScript,
    )
    expect(fixture.advanceScript).not.toHaveBeenCalled()
    fixture.openPhone.mock.calls[1]?.[2]?.()
    expect(fixture.advanceScript).toHaveBeenCalledOnce()
  })

  it('traite l’annulation native du menu de Maman comme « ne pas économiser »', () => {
    const fixture = createFixture()
    fixture.state.flags.add(0x986)
    fixture.handler.handle({
      kind: 'phoneCall',
      call: { callerId: 0, parameter1: 2, parameter2: 0 },
    }, runner())

    fixture.openPhone.mock.calls[0]?.[2]?.()
    const request = fixture.phoneChoiceOpen.mock.calls[0]?.[0]
    const cancelValue = request?.options[request.cancelIndex]?.value
    expect(cancelValue).toBe('no')
    request?.onSelect(cancelValue)
    expect(fixture.state.flags.has(0x986)).toBe(false)
    expect(fixture.openPhone).toHaveBeenLastCalledWith(
      'Maman',
      ['FORMAT:Je n’économiserai pas.'],
      fixture.advanceScript,
    )
  })

  it('configure entièrement la saisie centralisée du surnom', () => {
    const fixture = createFixture()
    const disposition = fixture.handler.handle({
      kind: 'nickname',
      slot: 0,
      currentName: 'FLAMME',
      maxLength: 10,
      cancellable: false,
      promptMessageId: 1,
    }, runner())

    expect(disposition).toBe('suspend')
    expect(fixture.nicknameInput.maxLength).toBe(10)
    expect(fixture.nicknameInput.value).toBe('FLAMME')
    expect(fixture.nicknameLabel.textContent).toBe('Donner un surnom ?')
    expect(fixture.nicknameInput.getAttribute('aria-label')).toBe('Donner un surnom ?')
    expect(fixture.nicknameCount.textContent).toBe('6/10')
    expect(fixture.setNicknameCancellable).toHaveBeenCalledWith(false)
    expect(fixture.nickname.hidden).toBe(false)
    expect(fixture.openNickname).toHaveBeenCalledOnce()
  })

  it.each([
    ['waitingIconAdd', true],
    ['waitingIconRemove', false],
  ] as const)('applique directement dialogue/%s', (action, expected) => {
    const fixture = createFixture()
    expect(fixture.handler.handle({ kind: 'dialogue', action }, runner())).toBe('continue')
    expect(fixture.dialogueElement.classList.contains('has-waiting-icon')).toBe(expected)
  })

  it('ferme close/hold mais laisse open sans effet', () => {
    const fixture = createFixture()
    expect(fixture.handler.handle({ kind: 'dialogue', action: 'open' }, runner())).toBe('continue')
    expect(fixture.hideDialogue).not.toHaveBeenCalled()
    expect(fixture.handler.handle({ kind: 'dialogue', action: 'hold' }, runner())).toBe('continue')
    expect(fixture.hideDialogue).toHaveBeenCalledOnce()
  })
})
