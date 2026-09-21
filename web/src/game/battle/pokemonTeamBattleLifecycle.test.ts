import { describe, expect, it, vi } from 'vitest'
import { createCanonicalPokemon, type CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import {
  basePokemonTeamPolicy,
  PokemonBattleEligibilityVetoError,
  type PokemonTeamPolicy,
} from '../pokemon/pokemonTeamPolicy'
import { executeAdmittedDoubleBattleTurn, validateDoubleBattlePlayerActions } from './doubleBattleActionAdmission'
import { createDoubleBattleSession, executeDoubleBattleTurn } from './doubleBattleSession'
import { replaceFaintedDoubleBattleParticipants, submitDoubleBattleReplacement } from './doubleBattleSwitching'
import {
  createSimpleBattleSession,
  executeSimpleBattleOpponentTurn,
  executeSimpleBattlePlayerSwitchTurn,
} from './simpleBattleSession'

const catalog = createPokemonTestCatalog()

function mon(speciesId: number): CanonicalPokemon {
  return createCanonicalPokemon(catalog, {
    speciesId,
    level: 5,
    rng: createHgssLcrng(speciesId),
    personality: { kind: 'fixed', value: speciesId },
    individualValues: { kind: 'fixed', value: 0 },
    originalTrainer: { id: 1, name: 'J', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 0, metLevel: 5, metTerrain: 0 },
    ballId: 4,
    moveIds: [33],
  })
}

function policy(vetoBattleEligibility: PokemonTeamPolicy['vetoBattleEligibility']): PokemonTeamPolicy {
  return { vetoBattleEligibility, vetoPartyMutation: () => undefined }
}

function createSharedPlayerDoubleBattle(playerParty: CanonicalPokemon[], playerTeamPolicy?: PokemonTeamPolicy) {
  return createDoubleBattleSession({
    kind: 'double', catalog, playerTeamPolicy,
    player: [
      { ownerId: 'player', party: playerParty, activePartyIndex: 0, controlled: true },
      { ownerId: 'player', party: playerParty, activePartyIndex: 1, controlled: true },
    ],
    opponent: [
      { ownerId: 'opponent-a', party: [mon(158)], activePartyIndex: 0, controlled: false },
      { ownerId: 'opponent-b', party: [mon(152)], activePartyIndex: 0, controlled: false },
    ],
  })
}

describe('cycle de vie PokemonTeamPolicy dans les moteurs de combat', () => {
  it('bloque une sélection initiale joueur avec sa raison métier', () => {
    const player = mon(152), opponent = mon(155)
    const teamPolicy = policy((intent) => intent.phase === 'initial'
      ? { code: 'permadeath', reason: 'Ce Pokémon est retiré de cette campagne.' }
      : undefined)

    expect(() => createSimpleBattleSession({ kind: 'trainer', player, opponent, catalog, playerTeamPolicy: teamPolicy }))
      .toThrow('Ce Pokémon est retiré de cette campagne.')
  })

  it('refuse un changement simple volontaire avant toute mutation et tout tirage RNG', () => {
    const player = mon(152), reserve = mon(155), opponent = mon(158)
    const phases: string[] = []
    const teamPolicy = policy((intent) => {
      phases.push(intent.phase)
      return intent.phase === 'voluntary-switch' && intent.pokemon.instanceId === reserve.instanceId
        ? { code: 'locked', reason: 'Cette réserve est verrouillée.' }
        : undefined
    })
    const session = createSimpleBattleSession({ kind: 'trainer', player, opponent, playerParty: [player, reserve], catalog, playerTeamPolicy: teamPolicy })
    const nextU16 = vi.fn(() => 0)

    expect(() => executeSimpleBattlePlayerSwitchTurn(session, reserve, catalog, { getSeed: () => 0, nextU16 }, teamPolicy))
      .toThrowError(PokemonBattleEligibilityVetoError)
    expect(() => executeSimpleBattlePlayerSwitchTurn(session, reserve, catalog, { getSeed: () => 0, nextU16 }, teamPolicy))
      .toThrow('Cette réserve est verrouillée.')
    expect(session.turn).toBe(0)
    expect(session.player.pokemon.instanceId).toBe(player.instanceId)
    expect(nextU16).not.toHaveBeenCalled()
    expect(phases).toContain('initial')
    expect(phases).toContain('voluntary-switch')
  })

  it('termine en défaite si la dernière réserve vivante est veto au remplacement forcé', () => {
    const player = mon(152), reserve = mon(155), opponent = mon(158)
    player.currentHp = 1
    opponent.moves[0]!.data = { ...opponent.moves[0]!.data, power: 250, accuracy: 0 }
    const teamPolicy = policy((intent) => intent.phase === 'forced-replacement' && intent.pokemon.instanceId === reserve.instanceId
      ? { code: 'permadeath', reason: 'Cette réserve est définitivement K.O.' }
      : undefined)
    const session = createSimpleBattleSession({ kind: 'trainer', player, opponent, playerParty: [player, reserve], catalog, playerTeamPolicy: teamPolicy })

    const events = executeSimpleBattleOpponentTurn(session, catalog, createHgssLcrng(4), teamPolicy)

    expect(events).toContainEqual({ kind: 'result', result: 'lost' })
    expect(session.phase).toBe('ended')
    expect(session.result).toBe('lost')
    expect(session.player.pokemon.instanceId).toBe(player.instanceId)
  })

  it('filtre un remplacement forcé double et conserve la raison lors d’une soumission périmée', () => {
    const playerParty = [mon(152), mon(155), mon(158), mon(152)]
    const blocked = playerParty[2]!
    const teamPolicy = policy((intent) => intent.phase === 'forced-replacement' && intent.pokemon.instanceId === blocked.instanceId
      ? { code: 'permadeath', reason: 'Ce Pokémon ne peut plus être envoyé.' }
      : undefined)
    const session = createSharedPlayerDoubleBattle(playerParty, teamPolicy)
    session.teams.player[0].party[0]!.currentHp = 0
    const events: Parameters<typeof replaceFaintedDoubleBattleParticipants>[3] = []

    replaceFaintedDoubleBattleParticipants(session, catalog, createHgssLcrng(8), events, teamPolicy)

    expect(events).toContainEqual({ kind: 'replacementRequest', target: { side: 'player', slot: 0 }, reserveIndexes: [3] })
    expect(session.phase).toBe('replacement')
    expect(() => submitDoubleBattleReplacement(session, { side: 'player', slot: 0 }, 2, catalog, createHgssLcrng(9), teamPolicy))
      .toThrow('Ce Pokémon ne peut plus être envoyé.')
  })

  it('sort proprement du double remplacement si toutes les réserves sont veto', () => {
    const playerParty = [mon(152), mon(155), mon(158)]
    const reserve = playerParty[2]!
    const teamPolicy = policy((intent) => intent.phase === 'forced-replacement' && intent.pokemon.instanceId === reserve.instanceId
      ? { code: 'permadeath', reason: 'Dernière réserve indisponible.' }
      : undefined)
    const session = createSharedPlayerDoubleBattle(playerParty, teamPolicy)
    session.teams.player[0].party[0]!.currentHp = 0
    session.teams.player[1].party[1]!.currentHp = 0
    const events: Parameters<typeof replaceFaintedDoubleBattleParticipants>[3] = []

    replaceFaintedDoubleBattleParticipants(session, catalog, createHgssLcrng(10), events, teamPolicy)

    expect(session.pendingReplacements.size).toBe(0)
    expect(session.phase).toBe('ended')
    expect(session.result).toBe('lost')
    expect(events).toContainEqual({ kind: 'result', result: 'lost' })
  })

  it('admet le veto avant le moteur double et expose une raison sérialisable', () => {
    const playerParty = [mon(152), mon(155), mon(158)]
    const reserve = playerParty[2]!
    const teamPolicy = policy((intent) => intent.phase === 'voluntary-switch' && intent.pokemon.instanceId === reserve.instanceId
      ? { code: 'locked', reason: 'Changement interdit par la règle.' }
      : undefined)
    const session = createSharedPlayerDoubleBattle(playerParty, teamPolicy)
    const actions = [
      { kind: 'switch' as const, actor: { side: 'player' as const, slot: 0 as const }, partyIndex: 2 },
      { actor: { side: 'player' as const, slot: 1 as const }, moveIndex: 0, target: { side: 'opponent' as const, slot: 0 as const } },
    ]
    const admission = validateDoubleBattlePlayerActions(session, actions, teamPolicy)

    expect(admission).toEqual({ accepted: false, code: 'team-policy', reason: 'Changement interdit par la règle.' })
    expect(JSON.parse(JSON.stringify(admission))).toEqual(admission)
    expect(() => executeAdmittedDoubleBattleTurn(session, actions, catalog, createHgssLcrng(11), teamPolicy))
      .toThrow('Changement interdit par la règle.')
    expect(session.turn).toBe(0)
  })

  it('ne filtre ni l’allié natif ni les adversaires avec la policy du joueur', () => {
    const local = mon(152), allyActive = mon(155), allyReserve = mon(158)
    const inspected: string[] = []
    const teamPolicy = policy((intent) => {
      inspected.push(intent.pokemon.instanceId)
      return intent.pokemon.instanceId === allyActive.instanceId || intent.pokemon.instanceId === allyReserve.instanceId
        ? { code: 'foreign', reason: 'Cette règle locale ne doit pas viser un allié.' }
        : undefined
    })
    const session = createDoubleBattleSession({
      kind: 'multi', catalog, playerTeamPolicy: teamPolicy,
      player: [
        { ownerId: 'player', party: [local], activePartyIndex: 0, controlled: true },
        { ownerId: 'ally', party: [allyActive, allyReserve], activePartyIndex: 0, controlled: false },
      ],
      opponent: [
        { ownerId: 'opponent-a', party: [mon(152)], activePartyIndex: 0, controlled: false },
        { ownerId: 'opponent-b', party: [mon(155)], activePartyIndex: 0, controlled: false },
      ],
    })
    session.teams.player[1].party[0]!.currentHp = 0
    const events: Parameters<typeof replaceFaintedDoubleBattleParticipants>[3] = []

    replaceFaintedDoubleBattleParticipants(session, catalog, createHgssLcrng(12), events, teamPolicy)

    expect(session.teams.player[1].activePartyIndex).toBe(1)
    expect(events).toContainEqual(expect.objectContaining({ kind: 'sendOut', target: { side: 'player', slot: 1 }, partyIndex: 1 }))
    expect(inspected).toEqual([local.instanceId])
  })

  it('conserve événements, ordre et état RNG avec la policy de base explicite', () => {
    const player = mon(152), opponent = mon(155), reserve = mon(158)
    player.currentHp = 1
    opponent.moves[0]!.data = { ...opponent.moves[0]!.data, power: 250, accuracy: 0 }
    const create = (playerTeamPolicy?: PokemonTeamPolicy) => createSimpleBattleSession({
      kind: 'trainer', player, opponent, playerParty: [player, reserve], catalog, playerTeamPolicy,
    })
    const nativeSession = create(), explicitSession = create(basePokemonTeamPolicy)
    const nativeRng = createHgssLcrng(0x1234), explicitRng = createHgssLcrng(0x1234)

    const nativeEvents = executeSimpleBattleOpponentTurn(nativeSession, catalog, nativeRng)
    const explicitEvents = executeSimpleBattleOpponentTurn(explicitSession, catalog, explicitRng, basePokemonTeamPolicy)

    expect(explicitEvents).toEqual(nativeEvents)
    expect(explicitSession).toEqual(nativeSession)
    expect(explicitRng.getSeed()).toBe(nativeRng.getSeed())

    const doublePokemon = [mon(152), mon(155), mon(158), mon(152)]
    const createDouble = (playerTeamPolicy?: PokemonTeamPolicy) => createDoubleBattleSession({
      kind: 'multi', catalog, playerTeamPolicy,
      player: [
        { ownerId: 'player', party: [doublePokemon[0]!], activePartyIndex: 0, controlled: true },
        { ownerId: 'ally', party: [doublePokemon[1]!], activePartyIndex: 0, controlled: false },
      ],
      opponent: [
        { ownerId: 'opponent-a', party: [doublePokemon[2]!], activePartyIndex: 0, controlled: false },
        { ownerId: 'opponent-b', party: [doublePokemon[3]!], activePartyIndex: 0, controlled: false },
      ],
    })
    const nativeDouble = createDouble(), explicitDouble = createDouble(basePokemonTeamPolicy)
    const action = [{ actor: { side: 'player' as const, slot: 0 as const }, moveIndex: 0, target: { side: 'opponent' as const, slot: 0 as const } }]
    const nativeDoubleRng = createHgssLcrng(0x4321), explicitDoubleRng = createHgssLcrng(0x4321)
    const nativeDoubleEvents = executeDoubleBattleTurn(nativeDouble, action, catalog, nativeDoubleRng)
    const explicitDoubleEvents = executeDoubleBattleTurn(explicitDouble, action, catalog, explicitDoubleRng, basePokemonTeamPolicy)

    expect(explicitDoubleEvents).toEqual(nativeDoubleEvents)
    expect(explicitDouble.turnOrder).toEqual(nativeDouble.turnOrder)
    expect(explicitDoubleRng.getSeed()).toBe(nativeDoubleRng.getSeed())
  })
})
