import { describe, expect, it, vi } from 'vitest'
import type { RomInventory } from '../../../ndsTypes'
import type { CanonicalPokemon } from '../../pokemon/canonicalPokemon'
import type { DetailedBattleOutcomeEvent } from '../battleOutcomeObserver'
import { createBattleProgressionPresentationQueue } from '../battleProgressionPresentationQueue'
import type { BattleProgressionMessageEntry } from '../battleProgressionPresentation'
import type { DoubleBattleEvent, DoubleBattleSession } from '../doubleBattleSession'
import { createBrowserDoubleBattleEventPresenter } from './browserDoubleBattleEventPresenter'

function pokemon(instanceId: string): CanonicalPokemon {
  return { instanceId, speciesName: instanceId } as CanonicalPokemon
}

function battle(): DoubleBattleSession {
  return {
    kind: 'double',
    phase: 'command',
    teams: {
      player: [{ party: [pokemon('player-1')] }],
      opponent: [{ party: [pokemon('opponent-1')] }],
    },
  } as unknown as DoubleBattleSession
}

function text(entry: BattleProgressionMessageEntry): string {
  return typeof entry === 'string' ? entry : entry.text
}

describe('présentateur navigateur des événements de combat double', () => {
  it('ordonne messages, effets différés, argent et progression via ses ports', () => {
    const session = battle()
    const screen = { dataset: {} as Record<string, string> } as HTMLElement
    const deferred = createBattleProgressionPresentationQueue<BattleProgressionMessageEntry>()
    deferred.enqueueMoveLearning('PROGRESSION')
    const outcomeEvents: DetailedBattleOutcomeEvent[] = []
    const playCondition = vi.fn()
    const showReplacement = vi.fn()
    const settleMoney = vi.fn(() => 'ARGENT')
    const protectEvents = vi.fn((_battle, events: readonly DoubleBattleEvent[]) => events)
    let replaced: readonly BattleProgressionMessageEntry[] = []
    let appended: readonly BattleProgressionMessageEntry[] = []
    const showNext = vi.fn()
    const presenter = createBrowserDoubleBattleEventPresenter({
      readContext: () => ({
        battle: session,
        resources: {
          battleMessages: { 857: '{103 0,0} utilise {108 1,0}!' },
          trainerCatalog: [],
        } as unknown as RomInventory,
        player: { id: 1, name: 'JO', gender: 'male' },
        suppressProgression: false,
        opponentTrainerIds: [4],
        battleAnimations: true,
        presentationGeneration: 1,
        outcomeObserver: { observeBattleOutcome: (event) => { outcomeEvents.push(event) } },
      }),
      scene: {
        element: vi.fn(),
        renderPosition: vi.fn(),
        showReplacement,
      },
      elements: {
        screen,
      },
      presentation: {
        animateHp: vi.fn(async () => undefined),
        playCondition,
        beginAction: vi.fn(),
        finishAction: vi.fn(),
        setMessageInputLocked: vi.fn(),
        trackAnimation: vi.fn(),
        playSendOut: vi.fn(),
        showLevelUpCard: vi.fn(),
        createSpriteEffectPlayback: () => undefined,
        skip: { register: () => () => undefined, request: () => false, reset: () => undefined, clear: () => undefined },
      },
      progression: {
        apply: vi.fn(),
        messagePresenter: { createMoveLearningEntries: vi.fn(), enqueueMoveLearning: vi.fn() },
        deferred,
        createEvolutionEntry: vi.fn(),
        settleMoney,
      },
      messages: {
        replace: (entries) => { replaced = entries },
        append: (entries) => { appended = entries },
        showNext,
      },
      protectEvents,
      markSeen: vi.fn(),
      getPokemonName: ({ speciesName }) => speciesName,
    })
    const actor = { side: 'player', slot: 0 } as const
    const events = [
      { kind: 'item', actor, itemId: 1, itemName: 'POTION', applied: true, source: 'bag' },
      { kind: 'replacementRequest', target: actor, reserveIndexes: [1, 3] },
      { kind: 'weather', weather: 'rain' },
      { kind: 'result', result: 'won' },
    ] as const satisfies readonly DoubleBattleEvent[]

    presenter.queue(events)

    expect(protectEvents).toHaveBeenCalledWith(session, events)
    expect(replaced.map(text)).toEqual([
      'JO utilise POTION!',
      'Choisissez un Pokémon.',
      'La météo devient rain.',
      'Victoire!',
      'ARGENT',
      'PROGRESSION',
    ])
    expect(appended).toEqual([])
    expect(showNext).toHaveBeenCalledOnce()
    expect(outcomeEvents).toEqual([{ kind: 'battle-finished', outcome: 'win' }])
    expect(settleMoney).toHaveBeenCalledWith('won', true)

    const [itemEntry, replacementEntry, weatherEntry] = replaced as Array<Exclude<BattleProgressionMessageEntry, string>>
    itemEntry.onShow?.()
    replacementEntry.onShow?.()
    weatherEntry.onShow?.()
    expect(playCondition).toHaveBeenCalledWith(actor, 'bagItem')
    expect(showReplacement).toHaveBeenCalledWith(actor, [1, 3])
    expect(screen.dataset.weather).toBe('rain')
    expect(deferred.isEmpty()).toBe(true)
  })

  it('ajoute un lot non immédiat sans avancer la file existante', () => {
    const session = battle()
    const append = vi.fn()
    const replace = vi.fn()
    const showNext = vi.fn()
    const presenter = createBrowserDoubleBattleEventPresenter({
      readContext: () => ({
        battle: session,
        resources: {} as RomInventory,
        player: { id: 1, name: 'JO', gender: 'male' },
        suppressProgression: false,
        opponentTrainerIds: [],
        battleAnimations: false,
        presentationGeneration: 1,
        outcomeObserver: { observeBattleOutcome: () => undefined },
      }),
      scene: { element: vi.fn(), renderPosition: vi.fn(), showReplacement: vi.fn() },
      elements: { screen: {} as HTMLElement },
      presentation: {
        animateHp: vi.fn(async () => undefined),
        playCondition: vi.fn(),
        beginAction: vi.fn(),
        finishAction: vi.fn(),
        setMessageInputLocked: vi.fn(),
        trackAnimation: vi.fn(),
        playSendOut: vi.fn(),
        showLevelUpCard: vi.fn(),
        createSpriteEffectPlayback: () => undefined,
        skip: { register: () => () => undefined, request: () => false, reset: () => undefined, clear: () => undefined },
      },
      progression: {
        apply: vi.fn(),
        messagePresenter: { createMoveLearningEntries: vi.fn(), enqueueMoveLearning: vi.fn() },
        deferred: createBattleProgressionPresentationQueue(),
        createEvolutionEntry: vi.fn(),
        settleMoney: vi.fn(),
      },
      messages: { replace, append, showNext },
      markSeen: vi.fn(),
      getPokemonName: ({ speciesName }) => speciesName,
    })

    presenter.queue([
      { kind: 'miss', actor: { side: 'player', slot: 0 }, target: { side: 'opponent', slot: 0 }, pokemonName: 'JO' },
      { kind: 'multiHit', hits: 3 },
    ], false)

    expect(append).toHaveBeenCalledWith(['JO rate son attaque!', '3 fois!'])
    expect(replace).not.toHaveBeenCalled()
    expect(showNext).not.toHaveBeenCalled()
  })
})
