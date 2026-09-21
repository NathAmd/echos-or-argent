import { describe, expect, it } from 'vitest'
import { createDoubleBattleSession, type DoubleBattleEvent } from '../battle/doubleBattleSession'
import { createSimpleBattleSession, type SimpleBattleEvent } from '../battle/simpleBattleSession'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { createRealtimeBattleDebugController, resolveRealtimeBattleAdvanceAction, resolveRealtimeTutorialStepAfterDebugEffect } from './realtimeBattleDebug'

const catalog = createPokemonTestCatalog()
function pokemon(speciesId: number) {
  return createCanonicalPokemon(catalog, {
    speciesId, level: 10, rng: createHgssLcrng(speciesId), personality: { kind: 'fixed', value: speciesId },
    individualValues: { kind: 'fixed', value: 0 }, originalTrainer: { id: 1, name: 'DEV', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 1, metLevel: 10, metTerrain: 0 }, ballId: 4, moveIds: [33],
  })
}

function simpleBattle() {
  const player = [pokemon(152), pokemon(155)]
  const opponent = [pokemon(158), pokemon(152)]
  return createSimpleBattleSession({ kind: 'trainer', player: player[0]!, opponent: opponent[0]!, playerParty: player, opponentParty: opponent, sharePartyState: true, catalog })
}

function doubleBattle() {
  return createDoubleBattleSession({ kind: 'double', catalog, player: [
    { ownerId: 'player-a', party: [pokemon(152)], activePartyIndex: 0, controlled: true },
    { ownerId: 'player-b', party: [pokemon(155)], activePartyIndex: 0, controlled: true },
  ], opponent: [
    { ownerId: 'opponent-a', party: [pokemon(158)], activePartyIndex: 0, controlled: false },
    { ownerId: 'opponent-b', party: [pokemon(152)], activePartyIndex: 0, controlled: false },
  ] })
}

function onePlayerDoubleBattle() {
  return createDoubleBattleSession({ kind: 'double', catalog, allowSinglePlayerParticipant: true, player: [
    { ownerId: 'player-a', party: [pokemon(152)], activePartyIndex: 0, controlled: true },
  ], opponent: [
    { ownerId: 'opponent-a', party: [pokemon(158)], activePartyIndex: 0, controlled: false },
    { ownerId: 'opponent-b', party: [pokemon(155)], activePartyIndex: 0, controlled: false },
  ] })
}

function multiBattle() {
  return createDoubleBattleSession({ kind: 'multi', catalog, player: [
    { ownerId: 'player', party: [pokemon(152)], activePartyIndex: 0, controlled: true },
    { ownerId: 'ally', party: [pokemon(155)], activePartyIndex: 0, controlled: false },
  ], opponent: [
    { ownerId: 'opponent-a', party: [pokemon(158)], activePartyIndex: 0, controlled: false },
    { ownerId: 'opponent-b', party: [pokemon(152)], activePartyIndex: 0, controlled: false },
  ] })
}

describe('commandes de combat temps réel DEV', () => {
  it('avance uniquement les présentations et jamais un menu interactif', () => {
    expect(resolveRealtimeBattleAdvanceAction('message')).toBe('confirm')
    expect(resolveRealtimeBattleAdvanceAction('learnMove')).toBe('cancel')
    for (const mode of ['command', 'moves', 'doubleTarget', 'party', 'bag', 'bagTarget', 'bagMove'] as const) {
      expect(resolveRealtimeBattleAdvanceAction(mode)).toBeUndefined()
    }
  })

  it('court-circuite uniquement le tutoriel déjà terminé par une commande DEV terminale', () => {
    const debug = createRealtimeBattleDebugController()
    const terminal = debug.execute({ kind: 'instant-kill' }, { simple: simpleBattle() })
    const state = debug.execute({ kind: 'godmode', enabled: true }, { simple: simpleBattle() })

    expect(resolveRealtimeTutorialStepAfterDebugEffect(0, terminal)).toBe(2)
    expect(resolveRealtimeTutorialStepAfterDebugEffect(1, terminal)).toBe(2)
    expect(resolveRealtimeTutorialStepAfterDebugEffect(undefined, terminal)).toBeUndefined()
    expect(resolveRealtimeTutorialStepAfterDebugEffect(0, state)).toBe(0)
  })

  it('termine un combat simple par les événements natifs de K.O. et de victoire', () => {
    const battle = simpleBattle()
    const debug = createRealtimeBattleDebugController()
    const effect = debug.execute({ kind: 'instant-kill' }, { simple: battle })

    expect(effect.kind).toBe('simple-events')
    expect(effect.kind === 'simple-events' ? effect.events : []).toEqual([
      expect.objectContaining({ kind: 'faint', side: 'opponent', defeated: expect.objectContaining({ currentHp: 0 }) }),
      { kind: 'result', result: 'won' },
    ])
    expect(battle.phase).toBe('ended')
    expect(battle.result).toBe('won')
    expect(battle.parties.opponent.every(({ currentHp }) => currentHp === 0)).toBe(true)
  })

  it('désactive le godmode avant un suicide pour que la défaite reste autoritaire', () => {
    const battle = simpleBattle()
    const debug = createRealtimeBattleDebugController()
    debug.execute({ kind: 'godmode', enabled: true }, { simple: battle })
    const effect = debug.execute({ kind: 'suicide' }, { simple: battle })

    expect(debug.isGodModeEnabled({ simple: battle })).toBe(false)
    expect(effect.kind === 'simple-events' ? effect.events.at(-1) : undefined).toEqual({ kind: 'result', result: 'lost' })
    expect(battle.parties.player.every(({ currentHp }) => currentHp === 0)).toBe(true)
  })

  it('annule dégâts, K.O. et défaite joueur quand le godmode protège un combat simple', () => {
    const battle = simpleBattle()
    const debug = createRealtimeBattleDebugController()
    debug.execute({ kind: 'godmode', enabled: true }, { simple: battle })
    battle.player.pokemon.currentHp = 0
    battle.phase = 'ended'
    battle.result = 'lost'
    const events: SimpleBattleEvent[] = [
      { kind: 'damage', side: 'player', damage: 99, critical: false, typeMultiplier: 10 },
      { kind: 'faint', side: 'player', pokemonName: battle.player.pokemon.speciesName, defeated: battle.player.pokemon },
      { kind: 'result', result: 'lost' },
    ]

    expect(debug.protectSimpleEvents(battle, events)).toEqual([])
    expect(battle.player.pokemon.currentHp).toBe(battle.player.pokemon.stats.hp)
    expect(battle).toMatchObject({ phase: 'command', result: undefined })
  })

  it('convertit un double K.O. en victoire si tous les adversaires sont déjà à zéro', () => {
    const battle = doubleBattle()
    const debug = createRealtimeBattleDebugController()
    debug.execute({ kind: 'godmode', enabled: true }, { double: battle })
    battle.teams.player.forEach(({ party }) => { party[0]!.currentHp = 0 })
    battle.teams.opponent.forEach(({ party }) => { party[0]!.currentHp = 0 })
    battle.phase = 'ended'
    battle.result = 'lost'
    const events: DoubleBattleEvent[] = [
      { kind: 'faint', target: { side: 'player', slot: 0 }, pokemonName: 'A', defeated: battle.teams.player[0]!.party[0]! },
      { kind: 'faint', target: { side: 'opponent', slot: 0 }, pokemonName: 'B', defeated: battle.teams.opponent[0]!.party[0]! },
      { kind: 'result', result: 'lost' },
    ]

    expect(debug.protectDoubleEvents(battle, events)).toEqual([
      expect.objectContaining({ kind: 'faint', target: { side: 'opponent', slot: 0 } }),
      { kind: 'result', result: 'won' },
    ])
    expect(battle).toMatchObject({ phase: 'ended', result: 'won' })
    expect(battle.teams.player.every(({ party }) => party[0]!.currentHp === party[0]!.stats.hp)).toBe(true)
  })

  it('met K.O. tous les slots d’un combat double sans toucher aux données hors session', () => {
    const battle = doubleBattle()
    const debug = createRealtimeBattleDebugController()
    const effect = debug.execute({ kind: 'instant-kill' }, { double: battle })

    expect(effect.kind).toBe('double-events')
    expect(effect.kind === 'double-events' ? effect.events.filter(({ kind }) => kind === 'faint') : []).toHaveLength(2)
    expect(battle.teams.opponent.every(({ party }) => party.every(({ currentHp }) => currentHp === 0))).toBe(true)
    expect(battle.teams.player.every(({ party }) => party.every(({ currentHp }) => currentHp > 0))).toBe(true)
  })

  it('accepte victoire et suicide dans un combat Duo avec un seul Pokémon joueur', () => {
    const debug = createRealtimeBattleDebugController()
    const victory = onePlayerDoubleBattle()
    const victoryEffect = debug.execute({ kind: 'instant-kill' }, { double: victory })
    expect(victoryEffect.kind === 'double-events' ? victoryEffect.events.filter(({ kind }) => kind === 'faint') : []).toHaveLength(2)
    expect(victory).toMatchObject({ phase: 'ended', result: 'won' })

    const defeat = onePlayerDoubleBattle()
    const defeatEffect = debug.execute({ kind: 'suicide' }, { double: defeat })
    expect(defeatEffect.kind === 'double-events' ? defeatEffect.events.filter(({ kind }) => kind === 'faint') : []).toHaveLength(1)
    expect(defeat).toMatchObject({ phase: 'ended', result: 'lost' })
  })

  it('ne protège jamais l’allié IA d’un combat Multi et y refuse suicide', () => {
    const battle = multiBattle()
    const debug = createRealtimeBattleDebugController()
    debug.execute({ kind: 'godmode', enabled: true }, { double: battle })
    const ally = battle.teams.player[1]!.party[0]!
    ally.currentHp = 0
    const allyFaint: DoubleBattleEvent = { kind: 'faint', target: { side: 'player', slot: 1 }, pokemonName: ally.speciesName, defeated: ally }

    expect(debug.protectDoubleEvents(battle, [allyFaint])).toEqual([allyFaint])
    expect(ally.currentHp).toBe(0)
    expect(() => debug.execute({ kind: 'suicide' }, { double: battle })).toThrow('Multi')
  })

  it('refuse les commandes de PV sans combat, notamment en Safari', () => {
    const debug = createRealtimeBattleDebugController()
    expect(() => debug.execute({ kind: 'instant-kill' }, {})).toThrow('En Safari')
    expect(() => debug.execute({ kind: 'godmode', enabled: true }, {})).toThrow('En Safari')
  })

  it('ne propage pas le godmode à la bataille suivante', () => {
    const first = simpleBattle(); const second = simpleBattle()
    const debug = createRealtimeBattleDebugController()
    debug.execute({ kind: 'godmode', enabled: true }, { simple: first })
    expect(debug.isGodModeEnabled({ simple: first })).toBe(true)
    expect(debug.isGodModeEnabled({ simple: second })).toBe(false)
  })
})
