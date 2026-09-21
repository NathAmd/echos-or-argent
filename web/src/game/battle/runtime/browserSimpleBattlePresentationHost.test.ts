import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RomInventory } from '../../../ndsTypes'
import type { CanonicalPokemon } from '../../pokemon/canonicalPokemon'
import type { PokemonTeamPolicy } from '../../pokemon/pokemonTeamPolicy'
import type { DoubleBattleSession } from '../doubleBattleSession'
import { createBattlePresentationSkipRegistry } from '../battlePresentationSkip'
import {
  createBrowserSimpleBattlePresentationHost,
  type BrowserBattleBagEntry,
  type BrowserBattleUiMode,
  type BrowserSimpleBattlePresentationContext,
} from './browserSimpleBattlePresentationHost'

class TestClassList {
  readonly values = new Set<string>()
  add(...names: string[]): void { names.forEach((name) => this.values.add(name)) }
  remove(...names: string[]): void { names.forEach((name) => this.values.delete(name)) }
  contains(name: string): boolean { return this.values.has(name) }
}

class TestStyle {
  readonly values = new Map<string, string>()
  setProperty(name: string, value: string): void { this.values.set(name, value) }
}

class TestElement {
  readonly children: TestElement[] = []
  readonly childNodes: TestElement[] = this.children
  readonly dataset: Record<string, string> = {}
  readonly attributes = new Map<string, string>()
  readonly classList = new TestClassList()
  readonly style = new TestStyle()
  className = ''
  disabled = false
  hidden = false
  textContent: string | null = null
  type = ''
  tabIndex = 0
  max = 1
  value = 0
  scrollTop = 0
  title = ''

  append(...children: TestElement[]): void { this.children.push(...children) }
  replaceChildren(...children: TestElement[]): void { this.children.splice(0, this.children.length, ...children) }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value) }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null }
  addEventListener(): void {}
  focus(): void {}
  closest(): TestElement | null { return null }
  contains(element: TestElement): boolean { return element === this || this.children.some((child) => child.contains(element)) }
  getBoundingClientRect(): DOMRect { return { left: 0, top: 0, width: 10, height: 10 } as DOMRect }
  querySelector(): TestElement | null { return null }
  querySelectorAll(selector: string): TestElement[] {
    if (!selector.startsWith('button')) return []
    return this.children.filter((child) => {
      if (selector.includes(':not(:disabled)') && child.disabled) return false
      if (selector.includes('[data-battle-item]') && child.dataset.battleItem === undefined) return false
      if (selector.includes('[data-battle-party-slot]') && child.dataset.battlePartySlot === undefined) return false
      return child.type === 'button'
    })
  }
}

function pokemon(instanceId: string, speciesName: string): CanonicalPokemon {
  return {
    instanceId,
    speciesId: 1,
    speciesName,
    nickname: speciesName,
    form: 0,
    gender: 'male',
    shiny: false,
    isEgg: false,
    level: 5,
    currentHp: 18,
    stats: { hp: 20 },
    moves: [],
  } as unknown as CanonicalPokemon
}

function createFixture(options: Readonly<{
  doubleBattle?: DoubleBattleSession
  doubleActor?: { side: 'player' | 'opponent', slot: 0 | 1 }
}> = {}) {
  vi.stubGlobal('Element', TestElement)
  vi.stubGlobal('document', {
    activeElement: null,
    createElement: () => new TestElement(),
  })
  const screen = new TestElement()
  const commands = new TestElement()
  const choices = new TestElement()
  const message = new TestElement()
  const player = pokemon('player', 'JOUEUR')
  const teammate = pokemon('teammate', 'ÉQUIPE')
  const doublePokemon = pokemon('double', 'DUO')
  let mode: BrowserBattleUiMode = 'message'
  let cursor = 0
  let pendingItemId: number | undefined
  const bagEntries = [{
    item: {
      itemId: 17,
      name: 'Potion',
      description: 'Rend des PV.',
      battlePocket: 1,
      battleUseFunction: 0,
      partyParameters: {},
    },
    quantity: 2,
  }] as unknown as readonly BrowserBattleBagEntry[]
  const resources = {
    battleMessages: { 925: 'SAC' },
    uiMessageBanks: { 6: { 7: 'CIBLE', 28: 'PV' } },
  } as unknown as RomInventory
  const context: BrowserSimpleBattlePresentationContext = {
    resources,
    doubleBattle: options.doubleBattle,
    doubleActor: options.doubleActor,
    playerParty: [player, teammate],
    opponentParty: [],
    playerSlot: 0,
    opponentSlot: 0,
    teamPolicy: {} as PokemonTeamPolicy,
    battleAnimations: true,
    presentationGeneration: 0,
    vblank: 0,
  }
  const createPokemonIcon = vi.fn(() => new TestElement() as unknown as HTMLElement)
  const createItemIcon = vi.fn(() => new TestElement() as unknown as HTMLElement)
  const host = createBrowserSimpleBattlePresentationHost({
    elements: {
      screen: screen as unknown as HTMLElement,
      effects: new TestElement() as unknown as HTMLCanvasElement,
      playerSprite: new TestElement() as unknown as HTMLElement,
      opponentSprite: new TestElement() as unknown as HTMLElement,
      playerParty: new TestElement() as unknown as HTMLElement,
      opponentParty: new TestElement() as unknown as HTMLElement,
      playerName: new TestElement() as unknown as HTMLElement,
      opponentName: new TestElement() as unknown as HTMLElement,
      playerLevel: new TestElement() as unknown as HTMLElement,
      opponentLevel: new TestElement() as unknown as HTMLElement,
      playerHp: new TestElement() as unknown as HTMLProgressElement,
      opponentHp: new TestElement() as unknown as HTMLProgressElement,
      playerExperience: new TestElement() as unknown as HTMLProgressElement,
      message: message as unknown as HTMLElement,
      commands: commands as unknown as HTMLElement,
      choices: choices as unknown as HTMLElement,
    },
    readContext: () => context,
    state: {
      readMode: () => mode,
      setMode: (next) => { mode = next },
      readCursor: () => cursor,
      setCursor: (next) => { cursor = next },
      setPartySelectionForced: vi.fn(),
      setPendingItemId: (itemId) => { pendingItemId = itemId },
      setMessageInputLocked: vi.fn(),
    },
    presentation: {
      setPhase: vi.fn(),
      reducedMotion: () => false,
      trackAnimation: vi.fn(),
      restartAnimation: () => ({ finished: Promise.resolve(), cancel: vi.fn() }),
      lockAnimation: () => vi.fn(),
      skip: createBattlePresentationSkipRegistry(),
      reportAnimationDiagnostic: vi.fn(),
    },
    assets: {
      canvas: { createGraphicCanvas: vi.fn(), mountGraphicCanvas: vi.fn() },
      pokemonAnimator: { registerSimple: vi.fn() },
      gaugeAnimationVersions: new WeakMap(),
      createPokemonIcon,
      createItemIcon,
    },
    inventory: {
      listBattleBagEntries: () => bagEntries,
      isBattleBagItemBlocked: () => false,
    },
    progression: { resolvePartySource: () => undefined },
    messages: { prepend: vi.fn(), showNext: vi.fn() },
    syncActiveParties: vi.fn(),
    getPokemonName: ({ nickname, speciesName }) => nickname ?? speciesName,
  })
  return {
    host,
    commands,
    choices,
    message,
    player,
    teammate,
    doublePokemon,
    createPokemonIcon,
    createItemIcon,
    readMode: () => mode,
    readCursor: () => cursor,
    setCursor: (next: number) => { cursor = next },
    readPendingItemId: () => pendingItemId,
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('host navigateur de présentation du combat simple', () => {
  it('projette le sac ROM et rend son premier objet sélectionnable', () => {
    const fixture = createFixture()

    fixture.host.showBag()

    expect(fixture.readMode()).toBe('bag')
    expect(fixture.readCursor()).toBe(0)
    expect(fixture.commands.hidden).toBe(true)
    expect(fixture.message.textContent).toBe('SAC')
    expect(fixture.choices.children).toHaveLength(1)
    expect(fixture.choices.children[0]?.dataset.battleItem).toBe('17')
    expect(fixture.choices.children[0]?.getAttribute('aria-current')).toBe('true')
    expect(fixture.createItemIcon).toHaveBeenCalledWith(17)
  })

  it('construit les cibles depuis le participant double courant sans décider l’action', () => {
    const duo = pokemon('double', 'DUO')
    const doubleBattle = {
      teams: {
        player: [{ party: [duo] }],
        opponent: [],
      },
    } as unknown as DoubleBattleSession
    const fixture = createFixture({ doubleBattle, doubleActor: { side: 'player', slot: 0 } })

    fixture.host.showItemTargets(17)

    expect(fixture.readMode()).toBe('bagTarget')
    expect(fixture.readPendingItemId()).toBe(17)
    expect(fixture.message.textContent).toBe('CIBLE')
    expect(fixture.choices.children).toHaveLength(1)
    expect(fixture.choices.children[0]?.dataset.battleItemTarget).toBe('0')
    expect(fixture.createPokemonIcon).toHaveBeenCalledWith(duo)
  })

  it('normalise le curseur sur les seuls boutons actifs', () => {
    const fixture = createFixture()
    const first = new TestElement(); first.type = 'button'
    const disabled = new TestElement(); disabled.type = 'button'; disabled.disabled = true
    const last = new TestElement(); last.type = 'button'
    fixture.choices.replaceChildren(first, disabled, last)
    fixture.setCursor(-1)

    fixture.host.renderCursor(fixture.choices as unknown as HTMLElement)

    expect(fixture.readCursor()).toBe(1)
    expect(first.getAttribute('aria-current')).toBe('false')
    expect(last.getAttribute('aria-current')).toBe('true')
    expect(disabled.getAttribute('aria-current')).toBeNull()
  })

  it('classe les zones de PV aux seuils HGSS', () => {
    const fixture = createFixture()
    const gauge = new TestElement()
    gauge.max = 100
    gauge.value = 51
    fixture.host.syncHpZone(gauge as unknown as HTMLProgressElement)
    expect(gauge.dataset.hpZone).toBe('high')
    gauge.value = 50
    fixture.host.syncHpZone(gauge as unknown as HTMLProgressElement)
    expect(gauge.dataset.hpZone).toBe('medium')
    gauge.value = 20
    fixture.host.syncHpZone(gauge as unknown as HTMLProgressElement)
    expect(gauge.dataset.hpZone).toBe('low')
  })
})
