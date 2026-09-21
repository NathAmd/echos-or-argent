import { describe, expect, it, vi } from 'vitest'
import type {
  HgssFollowerReaction,
  HgssFollowerReactionCatalog,
  HgssFollowerReactionConditions,
  HgssFollowerReactionRule,
} from '../../rom/overworld/followerReactions'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import { setPokemonPartyPokeathlonModifiers } from '../pokemon/pokemonParty'
import type { HgssPokeathlonBasePerformance } from '../../rom/pokemon/pokeathlonPerformance'
import type { FollowerInteractionEnvironment } from '../world/worldSession'
import {
  createFieldScriptFollowerHost,
  type FieldScriptFollowerHostPorts,
  type FieldScriptFollowerInventory,
  type FieldScriptFollowerWorld,
} from './fieldScriptFollowerHost'
import type { FieldScriptRunner, FieldScriptState } from './fieldScriptRunner'

const runner = {} as FieldScriptRunner

const exactConditions: HgssFollowerReactionConditions = {
  hpClass: 3,
  moodRange: 6,
  friendshipRange: 5,
  natureClass: 1,
  genderClass: 1,
  statusClass: 2,
  heldItemClass: 1,
  typeClass: 2,
  pokeathlonStatClass: 0,
  terrainClass: 1,
  speciesReactionClass: 31,
  missingShinyLeaf: 2,
  weatherClass: 3,
  facingClass: 4,
  nearbyObjectCountClass: 5,
  timeOfDayClass: 3,
  mapIdPlusOne: 61,
  metatileBehavior: 2,
  levelClass: 4,
  reservedObjectCondition: 0,
  hiddenItemCountClass: 1,
}

function createRule(
  reactionId: number,
  overrides: Partial<HgssFollowerReactionConditions> = {},
): HgssFollowerReactionRule {
  return {
    raw: [],
    conditionBits: 0,
    conditions: { ...exactConditions, ...overrides },
    reactionId,
    probability: 100,
    requiredFlag: 107,
  }
}

function createReaction(reactionId: number): HgssFollowerReaction {
  return {
    reactionId,
    steps: [],
    terminated: true,
    effects: {
      rawPrefix: [],
      friendshipDelta: 0,
      moodDelta: 0,
      fashionItemId: 0,
      shinyLeafIndex: 0,
    },
  }
}

function createFixture() {
  const pokemon = {
    speciesId: 155,
    speciesName: 'Héricendre',
    nickname: 'Braise',
    form: 0,
    personality: 12345,
    heldItemId: 17,
    currentHp: 9,
    stats: { hp: 18 },
    status: 0x10,
    level: 5,
    friendship: 70,
    nature: 14,
    gender: 'male',
    shinyLeafMask: 0b00101,
  } as CanonicalPokemon
  const state = {
    party: { members: [pokemon] },
    weather: 1,
    followerMood: -30,
    flags: new Set([107]),
    pokemonRuntime: { now: () => new Date(2026, 7, 13, 18) },
  } as FieldScriptState
  const selectedReaction = createReaction(2)
  const fallbackReaction = createReaction(1)
  const catalog: HgssFollowerReactionCatalog = {
    // La première règle prouve que le host calcule la meilleure statistique Pokéathlon.
    globalRules: [createRule(2, { pokeathlonStatClass: 4 }), createRule(1)],
    sectionRules: [[]],
    reactions: [fallbackReaction, selectedReaction],
    movements: [],
    speciesReactionClasses: Array.from({ length: 155 }, (_, index) => index === 154 ? 31 : 0),
    interactionMessages: {},
    auxiliaryMessages: {},
  }
  const personalData = Array.from({ length: 156 })
  personalData[155] = { types: [10, 10] }
  const fixedStat = (value: number) => ({ base: value, minimum: value, maximum: value })
  const pokeathlonPerformance: HgssPokeathlonBasePerformance = {
    memberIndex: 0,
    stats: {
      power: fixedStat(1), skill: fixedStat(1), speed: fixedStat(1), jump: fixedStat(5), stamina: fixedStat(1),
    },
  }
  const items = Array.from({ length: 18 })
  items[17] = { holdEffect: 3 }
  const inventory = {
    pokemonCatalog: { personalData },
    pokeathlonPerformanceCatalog: {
      performances: [pokeathlonPerformance],
      memberIndexBySpecies: Array.from({ length: 156 }, (_, speciesId) => speciesId === 155 ? 0 : 1),
    },
    followerReactionCatalog: catalog,
    itemCatalog: { items },
  } as unknown as FieldScriptFollowerInventory
  const environment: FollowerInteractionEnvironment = {
    mapId: 60,
    mapSection: 0,
    // Le host doit utiliser state.weather, pas cette projection du monde.
    weather: 0,
    metatileBehavior: 2,
    nearbyObjectCount: 5,
    hiddenItemCount: 1,
    facingDirection: 'south',
  }
  const world = {
    getFollowerInteractionEnvironment: vi.fn((): FollowerInteractionEnvironment | undefined => environment),
  } satisfies FieldScriptFollowerWorld
  const values = [0, 0]
  const rng: HgssLcrng = {
    getSeed: () => 0,
    nextU16: vi.fn(() => values.shift() ?? 0),
  }
  const readState = vi.fn(() => state)
  const readInventory = vi.fn((): FieldScriptFollowerInventory | undefined => inventory)
  const readWorld = vi.fn((): FieldScriptFollowerWorld | undefined => world)
  const readRng = vi.fn((): HgssLcrng | undefined => rng)
  const report = vi.fn()
  const startReaction = vi.fn()
  const ports = {
    readState,
    readInventory,
    readWorld,
    readRng,
    report,
    startReaction,
  } satisfies FieldScriptFollowerHostPorts

  return {
    host: createFieldScriptFollowerHost(ports),
    pokemon,
    state,
    inventory,
    catalog,
    environment,
    world,
    rng,
    readState,
    readInventory,
    readWorld,
    readRng,
    report,
    startReaction,
    selectedReaction,
    fallbackReaction,
  }
}

describe('fieldScriptFollowerHost', () => {
  it('laisse les étapes hors follower au host suivant sans lire le contexte', () => {
    const fixture = createFixture()

    expect(fixture.host.handle({ kind: 'save' }, runner)).toBe('unhandled')
    expect(fixture.readState).not.toHaveBeenCalled()
  })

  it('reconstruit le contexte ROM exact, sélectionne puis suspend la réaction', () => {
    const fixture = createFixture()

    expect(fixture.host.handle({ kind: 'followerInteraction', slot: 0, speciesId: 155 }, runner)).toBe('suspend')
    expect(fixture.rng.nextU16).toHaveBeenCalledTimes(1)
    expect(fixture.report).toHaveBeenCalledWith('Braise déclenche la réaction ROM 2.')
    expect(fixture.startReaction).toHaveBeenCalledWith(fixture.pokemon, fixture.selectedReaction)
  })

  it('refuse un slot vide ou une espèce remplacée avant de consulter la ROM', () => {
    const missing = createFixture()
    expect(() => missing.host.handle({ kind: 'followerInteraction', slot: 1, speciesId: 155 }, runner))
      .toThrow('Le Pokémon follower du slot 1 a changé pendant FollowMonInteract.')
    expect(missing.readInventory).not.toHaveBeenCalled()

    const replaced = createFixture()
    expect(() => replaced.host.handle({ kind: 'followerInteraction', slot: 0, speciesId: 25 }, runner))
      .toThrow('Le Pokémon follower du slot 0 a changé pendant FollowMonInteract.')
  })

  it.each(['inventory', 'world', 'rng'] as const)(
    'signale le contexte follower incomplet quand %s manque',
    (missing) => {
      const fixture = createFixture()
      if (missing === 'inventory') fixture.readInventory.mockReturnValue(undefined)
      if (missing === 'world') fixture.readWorld.mockReturnValue(undefined)
      if (missing === 'rng') fixture.readRng.mockReturnValue(undefined)

      expect(() => fixture.host.handle({ kind: 'followerInteraction', slot: 0, speciesId: 155 }, runner))
        .toThrow('Le contexte ROM du follower est absent pendant FollowMonInteract.')
    },
  )

  it('signale les données personnelles ou la classe de réaction absentes', () => {
    const missingPersonal = createFixture()
    ;(missingPersonal.inventory.pokemonCatalog.personalData as unknown[])[155] = undefined
    expect(() => missingPersonal.host.handle({ kind: 'followerInteraction', slot: 0, speciesId: 155 }, runner))
      .toThrow('Les conditions ROM du follower 155 sont absentes.')

    const missingClass = createFixture()
    ;(missingClass.catalog.speciesReactionClasses as number[])[154] = undefined as unknown as number
    expect(() => missingClass.host.handle({ kind: 'followerInteraction', slot: 0, speciesId: 155 }, runner))
      .toThrow('Les conditions ROM du follower 155 sont absentes.')
  })

  it('signale exactement un effet d’objet tenu absent', () => {
    const fixture = createFixture()
    ;(fixture.inventory.itemCatalog.items as unknown[])[17] = undefined

    expect(() => fixture.host.handle({ kind: 'followerInteraction', slot: 0, speciesId: 155 }, runner))
      .toThrow('L’effet de l’objet tenu 17 est absent de la ROM.')
    expect(fixture.startReaction).not.toHaveBeenCalled()
  })

  it('utilise l’effet sentinel zéro quand aucun objet n’est tenu', () => {
    const fixture = createFixture()
    fixture.pokemon.heldItemId = 0
    const noItemConditions = { ...exactConditions, heldItemClass: 8 }
    ;(fixture.catalog.globalRules as HgssFollowerReactionRule[]).splice(
      0,
      fixture.catalog.globalRules.length,
      { ...createRule(1), conditions: noItemConditions },
    )

    expect(fixture.host.handle({ kind: 'followerInteraction', slot: 0, speciesId: 155 }, runner)).toBe('suspend')
    expect(fixture.startReaction).toHaveBeenCalledWith(fixture.pokemon, fixture.fallbackReaction)
  })

  it('transmet les cinq modificateurs Aprijuice du slot au calcul Pokéathlon', () => {
    const fixture = createFixture()
    const flexibleSpeed = { base: 1, minimum: 1, maximum: 5 }
    const fixed = { base: 1, minimum: 1, maximum: 1 }
    ;(fixture.inventory.pokeathlonPerformanceCatalog.performances as HgssPokeathlonBasePerformance[])[0] = {
      memberIndex: 0,
      stats: { power: fixed, skill: fixed, speed: flexibleSpeed, jump: fixed, stamina: fixed },
    }
    ;(fixture.catalog.globalRules as HgssFollowerReactionRule[]).splice(
      0,
      fixture.catalog.globalRules.length,
      createRule(2, { pokeathlonStatClass: 5 }),
      createRule(1),
    )
    setPokemonPartyPokeathlonModifiers(fixture.state.party, 0, [0, 0, 127, 0, 0])

    expect(fixture.host.handle({ kind: 'followerInteraction', slot: 0, speciesId: 155 }, runner)).toBe('suspend')
    expect(fixture.startReaction).toHaveBeenCalledWith(fixture.pokemon, fixture.selectedReaction)
  })
})
