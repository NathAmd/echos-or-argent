import { describe, expect, it, vi } from 'vitest'
import type { NitroGraphic } from '../../ndsTypes'
import type { BattlePokemonSprite } from '../../rom/pokemon/battlePokemonSprites'
import type { PokemonEvolutionRule } from '../../rom/pokemon/evolutionData'
import type { BattleProgressionMessageEntry } from '../battle/battleProgressionPresentation'
import { createCanonicalPokemon, type CanonicalPokemon } from './canonicalPokemon'
import type { PokemonPartySlotSource } from './canonicalPokemonPartyTarget'
import { createHgssLcrng } from './hgssPokemonRng'
import { createPokemonTestCatalog } from './pokemonTestCatalog'
import { basePokemonTeamPolicy, type PokemonTeamPolicy } from './pokemonTeamPolicy'
import {
  createBrowserPokemonTransformationSceneHost,
  type PokemonTransformationSceneAudioRuntime,
  type PokemonTransformationSceneResources,
} from './browserPokemonTransformationSceneHost'

class TestClassList {
  private readonly values = new Set<string>()

  add(...tokens: string[]): void { tokens.forEach((token) => this.values.add(token)) }
  remove(...tokens: string[]): void { tokens.forEach((token) => this.values.delete(token)) }
  contains(token: string): boolean { return this.values.has(token) }
  toggle(token: string, force?: boolean): boolean {
    const enabled = force ?? !this.values.has(token)
    if (enabled) this.values.add(token)
    else this.values.delete(token)
    return enabled
  }
}

class TestElement {
  hidden = true
  textContent = ''
  className = ''
  value = ''
  maxLength = 0
  readonly classList = new TestClassList()
  readonly dataset: Record<string, string | undefined> = {}
  readonly attributes = new Map<string, string>()
  readonly queries = new Map<string, TestElement>()
  children: unknown[] = []

  replaceChildren(...children: unknown[]): void { this.children = children }
  querySelector<T extends Element>(selector: string): T | null {
    return (this.queries.get(selector) ?? null) as unknown as T | null
  }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value) }
}

const graphic: NitroGraphic = {
  width: 1,
  height: 1,
  pixels: new Uint8ClampedArray(4),
  graphicsOffset: 0,
  paletteOffset: 0,
  colorDepth: 4,
}

const battleSprite: BattlePokemonSprite = {
  graphic,
  frames: [graphic],
  animationScript: [{ next: 0, duration: 1, xOffset: 0 }],
  height: 32,
  memberIndex: 0,
  paletteMemberIndex: 0,
  animationFrameCount: 1,
}

function pokemon(catalog: ReturnType<typeof createPokemonTestCatalog>, speciesId: number, level: number, seed: number): CanonicalPokemon {
  return createCanonicalPokemon(catalog, {
    speciesId,
    level,
    rng: createHgssLcrng(seed),
    personality: { kind: 'fixed', value: seed },
    individualValues: { kind: 'fixed', value: 0 },
    originalTrainer: { id: 1, name: 'JO', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 1, metLevel: level, metTerrain: 0 },
    ballId: 4,
  })
}

function createFixture() {
  const catalog = createPokemonTestCatalog(292)
  const spriteRequests: unknown[] = []
  const resources = {
    pokemonCatalog: catalog,
    itemCatalog: { items: [], pocketNames: [] },
    battleMessages: {
      915: 'Quoi? {101 0,0} évolue!',
      917: '{101 0,0} évolue!',
      918: 'Félicitations! {101 0,0} devient {101 1,0}!',
      919: 'Hein? {101 0,0} n’évolue plus!',
    },
    uiMessageBanks: {
      40: {
        62: 'Oh?',
        63: '{101 0,0} est sorti de l’Œuf!',
        64: 'Donner un surnom à {101 0,0}?',
      },
      191: { 141: 'ÉCLOSION' },
      249: { 1: 'Surnom de {101 0,0}' },
      825: { 133: 'ÉVOLUTION' },
    },
    pokemonIconResolver: () => ({ memberIndex: 0, paletteIndex: 0, frames: [graphic] }),
    battlePokemonSpriteResolver: (request: unknown) => {
      spriteRequests.push(request)
      return battleSprite
    },
  } as unknown as PokemonTransformationSceneResources

  const screen = new TestElement()
  const scene = new TestElement()
  const kicker = new TestElement()
  const from = new TestElement()
  const to = new TestElement()
  const title = new TestElement()
  const text = new TestElement()
  const message = new TestElement()
  const commands = new TestElement()
  const moves = new TestElement()
  const nickname = new TestElement()
  const nicknameInput = new TestElement()
  const nicknameLabel = new TestElement()
  const nicknameCount = new TestElement()
  nickname.queries.set('label', nicknameLabel)
  nickname.queries.set('.field-nickname-count', nicknameCount)

  let currentResources: PokemonTransformationSceneResources | undefined = resources
  let bagInventory = new Map<number, number>()
  let teamPolicy: PokemonTeamPolicy = basePokemonTeamPolicy
  let timeOfDay = 1 as const
  let vblank = 100
  let battleAnimations = true
  let prefersReducedMotion = false
  let battleActive = false
  let currentAudio: PokemonTransformationSceneAudioRuntime | undefined
  let runnerAvailable = true
  const fieldParty: CanonicalPokemon[] = []
  const singleParty: CanonicalPokemon[] = []
  const doubleParty: CanonicalPokemon[] = []
  const resolveParty = (source: PokemonPartySlotSource): CanonicalPokemon[] | undefined => {
    if (source.kind === 'field') return fieldParty
    if (source.kind === 'single') return singleParty
    return source.ownerId === 'player' ? doubleParty : undefined
  }

  const playCry = vi.fn(async () => undefined)
  const playCryAndWait = vi.fn(async () => undefined)
  const playFanfare = vi.fn(async () => undefined)
  const playMusicByName = vi.fn(async () => 1)
  const playSoundEffect = vi.fn(async () => undefined)
  const stopMusic = vi.fn()
  currentAudio = { playCry, playCryAndWait, playFanfare, playMusicByName, playSoundEffect, stopMusic }
  const resumeFieldMusic = vi.fn()

  const mountedCanvases: TestElement[] = []
  const mountGraphicCanvas = vi.fn(() => {
    const canvas = new TestElement()
    mountedCanvases.push(canvas)
    return canvas as unknown as HTMLCanvasElement
  })
  const registerEvolution = vi.fn()
  const restartEvolution = vi.fn()
  const clearEvolution = vi.fn()
  const synchronizeEvolution = vi.fn()
  const markCaught = vi.fn()

  let messageQueue: BattleProgressionMessageEntry[] = []
  let moveLearningEntries: BattleProgressionMessageEntry[] = []
  const createMoveLearningEntries = vi.fn(() => [...moveLearningEntries])
  const replaceMessages = vi.fn((entries: readonly BattleProgressionMessageEntry[]) => {
    messageQueue = [...entries]
  })
  const prependMessages = vi.fn((entries: readonly BattleProgressionMessageEntry[]) => {
    messageQueue.unshift(...entries)
  })
  const clearMessages = vi.fn(() => { messageQueue = [] })
  const showNextMessage = vi.fn()
  const clearMoveLearning = vi.fn()
  const resetPresentationAsyncState = vi.fn()
  const setMessageInputLocked = vi.fn()

  const finishEggHatch = vi.fn()
  const renderMenu = vi.fn()
  const closeAndRefreshMenu = vi.fn()
  const persistAuto = vi.fn()
  const syncFollower = vi.fn()
  const advanceScript = vi.fn()
  const confirmations: Array<(confirmed: boolean) => void> = []
  const confirmationMessages: string[] = []
  const setNicknameCancellable = vi.fn()
  const openNickname = vi.fn()
  const recordEvolutionCompletionError = vi.fn()

  let nextTimer = 1
  const timers = new Map<number, { callback: () => void, delayMs: number }>()
  const timerHistory = new Map<number, { callback: () => void, delayMs: number }>()
  const host = createBrowserPokemonTransformationSceneHost({
    elements: {
      screen: screen as unknown as HTMLElement,
      scene: scene as unknown as HTMLElement,
      kicker: kicker as unknown as HTMLElement,
      from: from as unknown as HTMLElement,
      to: to as unknown as HTMLElement,
      title: title as unknown as HTMLElement,
      text: text as unknown as HTMLElement,
      message: message as unknown as HTMLElement,
      commands: commands as unknown as HTMLElement,
      moves: moves as unknown as HTMLElement,
      nickname: nickname as unknown as HTMLElement,
      nicknameInput: nicknameInput as unknown as HTMLInputElement,
    },
    readContext: () => ({
      resources: currentResources,
      bagInventory,
      teamPolicy,
      timeOfDay,
      vblank,
      battleAnimations,
      prefersReducedMotion,
      battleActive,
    }),
    getPokemonName: ({ nickname: pokemonNickname, speciesName }) => pokemonNickname ?? speciesName,
    sprites: { mountGraphicCanvas, registerEvolution, restartEvolution, clearEvolution },
    audio: { read: () => currentAudio, resumeFieldMusic },
    party: {
      resolve: resolveParty,
      readFieldParty: () => fieldParty,
      synchronizeEvolution,
      markCaught,
    },
    progression: {
      moveLearning: { createMoveLearningEntries },
      replaceMessages,
      prependMessages,
      clearMessages,
      hasPendingMessages: () => messageQueue.length > 0,
      showNextMessage,
      clearMoveLearning,
      resetPresentationAsyncState,
      setMessageInputLocked,
    },
    field: {
      readEggHatchRunner: () => runnerAvailable ? { finishEggHatch } : undefined,
      renderMenu,
      closeAndRefreshMenu,
      persistAuto,
      syncFollower,
      advanceScript,
    },
    input: {
      requestYesNo: (prompt, resolve) => {
        confirmationMessages.push(prompt)
        confirmations.push(resolve)
      },
      setNicknameCancellable,
      openNickname,
    },
    diagnostics: { recordEvolutionCompletionError },
    scheduler: {
      setTimeout: (callback, delayMs) => {
        const timer = nextTimer
        nextTimer += 1
        const task = { callback, delayMs }
        timers.set(timer, task)
        timerHistory.set(timer, task)
        return timer
      },
      clearTimeout: (timer) => { timers.delete(timer) },
    },
  })

  const runTimer = (timer: number): void => {
    const task = timers.get(timer)
    if (!task) throw new Error(`Le timer ${timer} est absent.`)
    timers.delete(timer)
    task.callback()
  }
  const runTimerWithDelay = (delayMs: number): number => {
    const entry = [...timers].find(([, task]) => task.delayMs === delayMs)
    if (!entry) throw new Error(`Aucun timer de ${delayMs} ms.`)
    runTimer(entry[0])
    return entry[0]
  }

  return {
    host,
    catalog,
    resources,
    screen,
    scene,
    kicker,
    from,
    to,
    title,
    text,
    message,
    commands,
    moves,
    nickname,
    nicknameInput,
    nicknameLabel,
    nicknameCount,
    fieldParty,
    singleParty,
    doubleParty,
    spriteRequests,
    mountedCanvases,
    registerEvolution,
    restartEvolution,
    clearEvolution,
    synchronizeEvolution,
    markCaught,
    playCry,
    playCryAndWait,
    playFanfare,
    playMusicByName,
    playSoundEffect,
    stopMusic,
    resumeFieldMusic,
    createMoveLearningEntries,
    replaceMessages,
    prependMessages,
    clearMessages,
    showNextMessage,
    clearMoveLearning,
    resetPresentationAsyncState,
    setMessageInputLocked,
    finishEggHatch,
    renderMenu,
    closeAndRefreshMenu,
    persistAuto,
    syncFollower,
    advanceScript,
    confirmations,
    confirmationMessages,
    setNicknameCancellable,
    openNickname,
    recordEvolutionCompletionError,
    timers,
    timerHistory,
    runTimer,
    runTimerWithDelay,
    readMessages: () => messageQueue,
    setMoveLearningEntries: (entries: readonly BattleProgressionMessageEntry[]) => {
      moveLearningEntries = [...entries]
    },
    setResources: (next: PokemonTransformationSceneResources | undefined) => { currentResources = next },
    setBagInventory: (next: Map<number, number>) => { bagInventory = next },
    setTeamPolicy: (next: PokemonTeamPolicy) => { teamPolicy = next },
    setBattleActive: (active: boolean) => { battleActive = active },
    setReducedMotion: (reduced: boolean) => { prefersReducedMotion = reduced },
    setBattleAnimations: (enabled: boolean) => { battleAnimations = enabled },
    setVblank: (next: number) => { vblank = next },
    setRunnerAvailable: (available: boolean) => { runnerAvailable = available },
    setAudio: (audio: PokemonTransformationSceneAudioRuntime | undefined) => { currentAudio = audio },
    setTimeOfDay: (next: 0 | 1 | 2 | 3 | 4) => { timeOfDay = next as 1 },
  }
}

function levelEvolutionRule(targetSpeciesId = 153): PokemonEvolutionRule {
  return { method: 4, parameter: 16, targetSpeciesId }
}

describe('host navigateur unifié des transformations Pokémon', () => {
  it('possède le cycle de progression terrain et refuse de masquer un combat actif', () => {
    const fixture = createFixture()
    fixture.setBattleActive(true)
    expect(() => fixture.host.startFieldProgression(['Niveau supérieur!'])).toThrow('combat actif')

    fixture.setBattleActive(false)
    fixture.host.startFieldProgression(['Niveau supérieur!'])

    expect(fixture.resetPresentationAsyncState).toHaveBeenCalledOnce()
    expect(fixture.replaceMessages).toHaveBeenCalledWith(['Niveau supérieur!'])
    expect(fixture.screen.hidden).toBe(false)
    expect(fixture.screen.classList.contains('is-evolution-only')).toBe(true)
    expect(fixture.message.hidden).toBe(true)
    expect(fixture.commands.hidden).toBe(true)
    expect(fixture.moves.hidden).toBe(true)
    expect(fixture.setMessageInputLocked).toHaveBeenLastCalledWith(false)
    expect(fixture.renderMenu).toHaveBeenCalledOnce()
    expect(fixture.showNextMessage).toHaveBeenCalledOnce()
    expect(fixture.host.getSnapshot()).toMatchObject({
      fieldProgressionActive: true,
      fieldProgressionEvolutionMusicActive: false,
    })

    fixture.host.finishFieldProgression()
    expect(fixture.clearMessages).toHaveBeenCalledOnce()
    expect(fixture.clearMoveLearning).toHaveBeenCalledOnce()
    expect(fixture.screen.hidden).toBe(true)
    expect(fixture.persistAuto).toHaveBeenCalledOnce()
    expect(fixture.renderMenu).toHaveBeenCalledTimes(2)
    expect(fixture.resumeFieldMusic).not.toHaveBeenCalled()
    expect(fixture.host.getSnapshot().fieldProgressionActive).toBe(false)
  })

  it('anime puis applique une évolution canonique et resynchronise son slot', async () => {
    const fixture = createFixture()
    const rule = levelEvolutionRule()
    fixture.catalog.evolutions[152] = [rule]
    fixture.catalog.speciesNames[153] = 'MACRONIUM'
    const source = pokemon(fixture.catalog, 152, 16, 10)
    fixture.singleParty.push(source)
    fixture.setMoveLearningEntries(['MACRONIUM apprend une capacité!'])

    const decision = fixture.host.startEvolution({
      pokemon: source,
      targetSpeciesId: 153,
      source: { kind: 'single', partySlot: 0 },
      rule,
    })

    expect(decision).toEqual({ kind: 'allowed' })
    expect(fixture.host.getSnapshot().evolutionPhase).toBe('intro')
    expect(fixture.scene.hidden).toBe(false)
    expect(fixture.scene.classList.contains('is-intro')).toBe(true)
    expect(fixture.registerEvolution).toHaveBeenCalledOnce()
    expect(fixture.playCry).toHaveBeenCalledWith(152, 0, undefined, undefined)
    expect([...fixture.timers.values()].map(({ delayMs }) => delayMs)).toEqual([900])

    fixture.runTimerWithDelay(900)
    expect(fixture.host.getSnapshot().evolutionPhase).toBe('transforming')
    expect(fixture.playMusicByName).toHaveBeenCalledWith(['SEQ_GS_SHINKA'])
    expect(fixture.playSoundEffect).toHaveBeenCalledWith(0x5f8)
    expect([...fixture.timers.values()].map(({ delayMs }) => delayMs).sort((a, b) => a - b)).toEqual([
      720,
      1840,
      2920,
      3600,
    ])

    fixture.setVblank(200)
    fixture.runTimerWithDelay(3600)
    expect(fixture.singleParty[0]).not.toBe(source)
    expect(fixture.singleParty[0]?.speciesId).toBe(153)
    expect(fixture.markCaught).toHaveBeenCalledWith(fixture.singleParty[0])
    expect(fixture.synchronizeEvolution).toHaveBeenCalledWith(
      { kind: 'single', partySlot: 0 },
      fixture.singleParty[0],
      0,
    )
    expect(fixture.prependMessages).toHaveBeenCalledWith(['MACRONIUM apprend une capacité!'])
    expect(fixture.title.textContent).toBe('MACRONIUM')
    expect(fixture.text.textContent).toBe('Félicitations! GERMIGNON devient MACRONIUM!')
    expect(fixture.restartEvolution).toHaveBeenLastCalledWith(200)
    expect(fixture.host.getSnapshot().evolutionPhase).toBe('complete')
    expect(fixture.timers.size).toBe(0)

    await Promise.resolve()
    expect(fixture.playCryAndWait).toHaveBeenCalledWith(153, 0, undefined, undefined)
    fixture.host.handleInput('confirm')
    expect(fixture.host.getSnapshot().evolutionPhase).toBeUndefined()
    expect(fixture.showNextMessage).toHaveBeenCalledOnce()
    expect(fixture.stopMusic).toHaveBeenCalled()
  })

  it('respecte le veto, l’interdiction d’annulation terrain et le retour musical', () => {
    const blocked = createFixture()
    const rule = levelEvolutionRule()
    blocked.catalog.evolutions[152] = [rule]
    blocked.catalog.speciesNames[153] = 'MACRONIUM'
    const blockedPokemon = pokemon(blocked.catalog, 152, 16, 11)
    blocked.fieldParty.push(blockedPokemon)
    blocked.setTeamPolicy({
      vetoBattleEligibility: () => undefined,
      vetoPartyMutation: ({ reason }) => reason === 'evolution'
        ? { code: 'blocked', reason: 'Évolution verrouillée.' }
        : undefined,
    })

    expect(blocked.host.startEvolution({
      pokemon: blockedPokemon,
      targetSpeciesId: 153,
      source: { kind: 'field', partySlot: 0, cancellable: false },
      rule,
    })).toEqual({ kind: 'blocked', code: 'blocked', reason: 'Évolution verrouillée.' })
    expect(blocked.host.getSnapshot().evolutionPhase).toBeUndefined()
    expect(blocked.timers.size).toBe(0)

    const fixture = createFixture()
    fixture.catalog.evolutions[152] = [rule]
    fixture.catalog.speciesNames[153] = 'MACRONIUM'
    const source = pokemon(fixture.catalog, 152, 16, 12)
    fixture.fieldParty.push(source)
    fixture.host.startEvolution({
      pokemon: source,
      targetSpeciesId: 153,
      source: { kind: 'field', partySlot: 0, cancellable: false },
      rule,
    })
    fixture.host.handleInput('cancel')
    expect(fixture.host.getSnapshot().evolutionPhase).toBe('intro')

    fixture.host.reset()
    fixture.host.startEvolution({
      pokemon: source,
      targetSpeciesId: 153,
      source: { kind: 'field', partySlot: 0, cancellable: true },
      rule,
    })
    fixture.host.handleInput('cancel')
    expect(fixture.host.getSnapshot()).toMatchObject({
      evolutionPhase: 'cancelled',
      fieldProgressionActive: true,
      fieldProgressionEvolutionMusicActive: true,
    })
    expect(fixture.text.textContent).toBe('Hein? GERMIGNON n’évolue plus!')

    fixture.host.handleInput('confirm')
    expect(fixture.host.getSnapshot()).toMatchObject({
      evolutionPhase: undefined,
      fieldProgressionActive: false,
      fieldProgressionEvolutionMusicActive: false,
    })
    expect(fixture.resumeFieldMusic).toHaveBeenCalledOnce()
    expect(fixture.persistAuto).toHaveBeenCalledOnce()
  })

  it('re-résout l’identité différée après un réordonnancement de l’équipe', () => {
    const fixture = createFixture()
    const rule = levelEvolutionRule()
    fixture.catalog.evolutions[152] = [rule]
    fixture.catalog.speciesNames[153] = 'MACRONIUM'
    const source = pokemon(fixture.catalog, 152, 16, 13)
    const partner = pokemon(fixture.catalog, 155, 16, 14)
    fixture.singleParty.push(source, partner)
    const entry = fixture.host.createEvolutionEntry(
      source,
      { kind: 'single', partySlot: 0 },
      { targetSpeciesId: 153, rule },
    )
    fixture.singleParty.splice(0, 2, partner, source)

    expect(typeof entry).toBe('object')
    if (typeof entry === 'object') entry.onShow?.()
    fixture.runTimerWithDelay(900)
    fixture.runTimerWithDelay(3600)

    expect(fixture.singleParty.map(({ speciesId }) => speciesId)).toEqual([155, 153])
    expect(fixture.synchronizeEvolution).toHaveBeenCalledWith(
      { kind: 'single', partySlot: 1 },
      fixture.singleParty[1],
      1,
    )
  })

  it('conserve la transaction secondaire Munja, sa Poké Ball et son message', () => {
    const fixture = createFixture()
    const primaryRule: PokemonEvolutionRule = { method: 13, parameter: 20, targetSpeciesId: 291 }
    const shedinjaRule: PokemonEvolutionRule = { method: 14, parameter: 20, targetSpeciesId: 292 }
    fixture.catalog.speciesNames[290] = 'NINGALE'
    fixture.catalog.speciesNames[291] = 'NINJASK'
    fixture.catalog.speciesNames[292] = 'MUNJA'
    fixture.catalog.evolutions[290] = [primaryRule, shedinjaRule]
    const nincada = pokemon(fixture.catalog, 290, 20, 15)
    fixture.fieldParty.push(nincada)
    const bag = new Map([[4, 1]])
    fixture.setBagInventory(bag)
    fixture.setReducedMotion(true)

    fixture.host.startEvolution({
      pokemon: nincada,
      targetSpeciesId: 291,
      source: { kind: 'field', partySlot: 0, cancellable: false },
      rule: primaryRule,
    })
    fixture.runTimerWithDelay(120)
    fixture.runTimerWithDelay(520)

    expect(fixture.fieldParty.map(({ speciesId }) => speciesId)).toEqual([291, 292])
    expect(fixture.fieldParty[1]).toMatchObject({
      speciesName: 'MUNJA',
      heldItemId: 0,
      ballId: 4,
      nickname: undefined,
      currentHp: 1,
    })
    expect(bag.get(4)).toBeUndefined()
    expect(fixture.markCaught).toHaveBeenCalledTimes(2)
    expect(fixture.synchronizeEvolution).toHaveBeenCalledWith(
      { kind: 'field', partySlot: 0, cancellable: false },
      fixture.fieldParty[0],
      0,
    )
    expect(fixture.readMessages()).toContain('MUNJA apparaît dans l’Équipe!')
    expect(fixture.host.getSnapshot().evolutionPhase).toBe('complete')
  })

  it('centralise l’éclosion, le choix Oui/Non et la saisie du surnom', () => {
    const fixture = createFixture()
    fixture.catalog.speciesNames[175] = 'TOGEPI'
    const egg = pokemon(fixture.catalog, 175, 1, 16)
    egg.isEgg = true

    fixture.host.startEggHatch({ kind: 'eggHatch', partySlot: 2, pokemon: egg })
    expect(fixture.host.getSnapshot().eggHatchPhase).toBe('cracking')
    expect(fixture.kicker.textContent).toBe('ÉCLOSION')
    expect(fixture.scene.classList.contains('is-hatching')).toBe(true)
    expect(fixture.screen.classList.contains('is-egg-hatch')).toBe(true)
    expect(fixture.mountedCanvases[0]?.className).toBe('egg-hatch-icon')
    expect(fixture.closeAndRefreshMenu).toHaveBeenCalledOnce()
    expect(fixture.playSoundEffect).toHaveBeenCalledWith(1812)
    expect(fixture.host.handleInput('confirm')).toBe(true)
    expect(fixture.confirmations).toHaveLength(0)

    fixture.runTimerWithDelay(3200)
    expect(fixture.host.getSnapshot().eggHatchPhase).toBe('hatched')
    expect(fixture.title.textContent).toBe('TOGEPI')
    expect(fixture.text.textContent).toBe('TOGEPI est sorti de l’Œuf!')

    fixture.host.handleInput('confirm')
    expect(fixture.host.getSnapshot().eggHatchPhase).toBe('nickname-choice')
    expect(fixture.scene.hidden).toBe(true)
    expect(fixture.screen.hidden).toBe(true)
    expect(fixture.confirmationMessages).toEqual(['Donner un surnom à TOGEPI?'])

    fixture.confirmations[0]?.(true)
    expect(fixture.host.getSnapshot().eggHatchPhase).toBe('naming')
    expect(fixture.nickname.hidden).toBe(false)
    expect(fixture.nicknameInput.maxLength).toBe(10)
    expect(fixture.nicknameInput.attributes.get('aria-label')).toBe('Surnom de TOGEPI')
    expect(fixture.nicknameLabel.textContent).toBe('Surnom de TOGEPI')
    expect(fixture.nicknameCount.textContent).toBe('0/10')
    expect(fixture.setNicknameCancellable).toHaveBeenCalledWith(true)
    expect(fixture.openNickname).toHaveBeenCalledOnce()

    expect(fixture.host.submitNickname('TOOPY')).toBe(true)
    expect(fixture.finishEggHatch).toHaveBeenCalledWith('TOOPY')
    expect(fixture.host.getSnapshot().eggHatchPhase).toBeUndefined()
    expect(fixture.nickname.hidden).toBe(true)
    expect(fixture.resumeFieldMusic).toHaveBeenCalledOnce()
    expect(fixture.syncFollower).toHaveBeenCalledWith(true)
    expect(fixture.advanceScript).toHaveBeenCalledOnce()
    expect(fixture.host.submitNickname('STALE')).toBe(false)
  })

  it('ignore les confirmations et timers obsolètes après remplacement ou fermeture', () => {
    const fixture = createFixture()
    fixture.catalog.speciesNames[175] = 'TOGEPI'
    const firstEgg = pokemon(fixture.catalog, 175, 1, 17)
    const secondEgg = pokemon(fixture.catalog, 175, 1, 18)
    firstEgg.isEgg = true
    secondEgg.isEgg = true

    fixture.host.startEggHatch({ kind: 'eggHatch', partySlot: 0, pokemon: firstEgg })
    const staleCrack = fixture.timerHistory.values().next().value?.callback
    fixture.host.startEggHatch({ kind: 'eggHatch', partySlot: 1, pokemon: secondEgg })
    staleCrack?.()
    expect(fixture.host.getSnapshot().eggHatchPhase).toBe('cracking')

    fixture.runTimerWithDelay(3200)
    fixture.host.handleInput('cancel')
    const staleConfirmation = fixture.confirmations[0]
    expect(fixture.host.closeEggHatch()).toBe(true)
    staleConfirmation?.(true)

    expect(fixture.host.getSnapshot().eggHatchPhase).toBeUndefined()
    expect(fixture.openNickname).not.toHaveBeenCalled()
    expect(fixture.finishEggHatch).not.toHaveBeenCalled()
    expect(fixture.host.closeEggHatch()).toBe(false)
  })

  it('invalide une ancienne évolution et transforme une erreur de completion en message', () => {
    const fixture = createFixture()
    const rule = levelEvolutionRule()
    fixture.catalog.evolutions[152] = [rule]
    fixture.catalog.speciesNames[153] = 'MACRONIUM'
    const first = pokemon(fixture.catalog, 152, 16, 19)
    const second = pokemon(fixture.catalog, 152, 16, 20)
    fixture.singleParty.push(first, second)
    fixture.host.startEvolution({
      pokemon: first,
      targetSpeciesId: 153,
      source: { kind: 'single', partySlot: 0 },
      rule,
    })
    const staleStart = fixture.timerHistory.values().next().value?.callback
    fixture.host.startEvolution({
      pokemon: second,
      targetSpeciesId: 153,
      source: { kind: 'single', partySlot: 1 },
      rule,
    })
    staleStart?.()
    expect(fixture.host.getSnapshot().evolutionPhase).toBe('intro')

    fixture.runTimerWithDelay(900)
    fixture.singleParty.length = 0
    fixture.runTimerWithDelay(3600)

    expect(fixture.recordEvolutionCompletionError).toHaveBeenCalledOnce()
    expect(fixture.readMessages()[0]).toContain("n'est plus")
    expect(fixture.host.getSnapshot().evolutionPhase).toBeUndefined()
    expect(fixture.showNextMessage).toHaveBeenCalledOnce()
  })
})
