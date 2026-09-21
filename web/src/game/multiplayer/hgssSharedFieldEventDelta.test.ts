import { describe, expect, it } from 'vitest'
import { cloneCanonicalPokemon, createCanonicalPokemon, type PokemonTrainerIdentity } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { createHgssMersenneTwister } from '../pokemon/hgssSessionRng'
import { createPokemonStorage } from '../pokemon/pokemonStorage'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import {
  cloneFieldScriptState,
  createFieldScriptState,
  type FieldPokemonRuntime,
  type FieldScriptState,
} from '../scripts/fieldScriptRunner'
import {
  attestHgssSharedFieldEventDelta,
  captureHgssSharedFieldEventBaseline,
  createHgssSharedFieldEventDelta,
  type HgssSharedFieldEventDeltaError,
} from './hgssSharedFieldEventDelta'

const trainer: PokemonTrainerIdentity = {
  id: 0x12345678,
  name: 'LYRA',
  gender: 'female',
  nameSource: 'user-text',
  isPlayer: true,
}

function populatedState(withRuntime = false): FieldScriptState {
  const catalog = createPokemonTestCatalog()
  const pokemon = createCanonicalPokemon(catalog, {
    speciesId: 152,
    level: 12,
    rng: createHgssLcrng(11),
    personality: { kind: 'fixed', value: 0x10203040 },
    individualValues: { kind: 'fixed', value: 12 },
    originalTrainer: trainer,
    origin: { language: 3, gameVersion: 7, metLocation: 126, metLevel: 5, metTerrain: 12 },
    ballId: 4,
  })
  const runtime: FieldPokemonRuntime | undefined = withRuntime ? {
    catalog,
    rng: createHgssLcrng(123),
    mt: createHgssMersenneTwister(456),
    trainer: { ...trainer },
    language: 3,
    gameVersion: 7,
    now: () => new Date('2026-08-27T12:00:00.000Z'),
  } : undefined
  const state = createFieldScriptState('female', 'LYRA', {
    party: [pokemon],
    pokemonStorage: createPokemonStorage([[pokemon]], 0),
    pokemonRuntime: runtime,
  })
  state.daycare.mons[0] = { pokemon: cloneCanonicalPokemon(pokemon), steps: 5 }
  state.palPark.migratedPokemon.push(cloneCanonicalPokemon(pokemon))
  state.bugContest = {
    weekday: 2,
    registeredContestants: [1, 2],
    elapsedMinutes: 3,
    caughtPokemon: cloneCanonicalPokemon(pokemon),
  }
  return state
}

function expectUnsupported(
  mutate: (after: FieldScriptState) => void,
  expectedPath: string,
  options: { runtime?: boolean } = {},
): void {
  const before = populatedState(options.runtime)
  const baseline = captureHgssSharedFieldEventBaseline(before)
  const after = cloneFieldScriptState(before)
  mutate(after)
  try {
    attestHgssSharedFieldEventDelta(baseline, after)
    throw new Error('La mutation sensible aurait dû être refusée.')
  } catch (error) {
    expect(error).toMatchObject({ code: 'unsupported-mutation' })
    expect((error as HgssSharedFieldEventDeltaError).path).toContain(expectedPath)
  }
}

describe('attestation des événements terrain partagés HGSS', () => {
  it('retourne un delta canonique gelé pour les seuls flags et variables persistantes', () => {
    const before = populatedState()
    before.flags = new Set([0x30, 0x10])
    before.variables = new Map([
      [0x4012, 8],
      [0x4010, 2],
      [0x4001, 77],
      [0x8002, 88],
    ])
    const baseline = captureHgssSharedFieldEventBaseline(before)
    const after = cloneFieldScriptState(before)
    after.flags.delete(0x30)
    after.flags.add(0x25)
    after.flags.add(0x20)
    after.variables.set(0x4010, 9)
    after.variables.delete(0x4012)
    after.variables.set(0x4011, 4)

    const delta = attestHgssSharedFieldEventDelta(baseline, after)

    expect(delta).toEqual({
      addedFlagIds: [0x20, 0x25],
      removedFlagIds: [0x30],
      variables: [
        { variableId: 0x4010, expectedValue: 2, value: 9 },
        { variableId: 0x4011, expectedValue: 0, value: 4 },
        { variableId: 0x4012, expectedValue: 8, value: 0 },
      ],
    })
    expect(Object.isFrozen(delta)).toBe(true)
    expect(Object.isFrozen(delta.addedFlagIds)).toBe(true)
    expect(Object.isFrozen(delta.variables)).toBe(true)
    expect(delta.variables.every(Object.isFrozen)).toBe(true)
  })

  it('considère deux clones sémantiquement identiques comme un no-op', () => {
    const before = populatedState()
    expect(createHgssSharedFieldEventDelta(before, cloneFieldScriptState(before))).toEqual({
      addedFlagIds: [], removedFlagIds: [], variables: [],
    })
  })

  it('accepte aussi un clone intact portant les catalogues et RNG du runtime', () => {
    const before = populatedState(true)
    const baseline = captureHgssSharedFieldEventBaseline(before)
    expect(attestHgssSharedFieldEventDelta(baseline, cloneFieldScriptState(before))).toEqual({
      addedFlagIds: [], removedFlagIds: [], variables: [],
    })
  })

  it('capture dynamiquement chaque propriété réellement présente hors tranche autorisée', () => {
    const state = populatedState()
    const baseline = captureHgssSharedFieldEventBaseline(state)
    const expected = Reflect.ownKeys(state)
      .filter((key) => key !== 'flags' && key !== 'variables' && Reflect.get(state, key) !== undefined)
      .sort((left, right) => String(left).localeCompare(String(right)))
    expect(baseline.forbiddenState.map(({ key }) => key)).toEqual(expected)
  })

  it.each([
    ['argent', 'money', (state: FieldScriptState) => { state.money += 1 }],
    ['inventaire', 'inventory', (state: FieldScriptState) => { state.inventory.set(1, 1) }],
    ['Pokémon imbriqué dans l’équipe', 'party', (state: FieldScriptState) => { state.party.members[0]!.currentHp -= 1 }],
    ['Pokémon imbriqué dans le stockage', 'pokemonStorage', (state: FieldScriptState) => { state.pokemonStorage.boxes[0]![0]!.heldItemId = 1 }],
    ['Pokédex', 'pokedex', (state: FieldScriptState) => { state.pokedex.caughtSpeciesIds.add(152) }],
    ['badges', 'badges', (state: FieldScriptState) => { state.badges.add(1) }],
    ['victoires de Dresseurs', 'trainerFlags', (state: FieldScriptState) => { state.trainerFlags.add(7) }],
    ['combat courant', 'lastBattleWon', (state: FieldScriptState) => { state.lastBattleWon = true }],
    ['Frontier et points de combat', 'battlePoints', (state: FieldScriptState) => { state.battlePoints += 1 }],
    ['records et statistiques de combat', 'gameStats', (state: FieldScriptState) => { state.gameStats.set(2, 1) }],
    ['pension', 'daycare', (state: FieldScriptState) => { state.daycare.mons[0]!.steps += 1 }],
    ['Pokémon fuyards et rencontres', 'roamers', (state: FieldScriptState) => { state.roamers.repelSteps += 1 }],
    ['Parc Safari imbriqué', 'safariZone', (state: FieldScriptState) => {
      state.safariZone.areaSets[0].areas[0].placements.push({ objectId: 0, x: 1, y: 0, z: 1 })
    }],
    ['progression Safari', 'safariProgression', (state: FieldScriptState) => { state.safariProgression.baobaIgtReferenceMinutes += 1 }],
    ['album photo', 'photoAlbum', (state: FieldScriptState) => { state.photoAlbum.slots.push(undefined) }],
    ['Pension/Parc des Amis Pokémon', 'palPark', (state: FieldScriptState) => { state.palPark.catchingPoints += 1 }],
    ['concours de capture', 'bugContest', (state: FieldScriptState) => { state.bugContest!.elapsedMinutes += 1 }],
    ['Pokématos imbriqué', 'pokegear', (state: FieldScriptState) => { state.pokegear.skin = 1 }],
    ['contacts Pokématos', 'phoneContacts', (state: FieldScriptState) => { state.phoneContacts.add(3) }],
    ['mode et accessoires', 'fashionAccessories', (state: FieldScriptState) => { state.fashionAccessories.set(2, 1) }],
    ['Noigrumes', 'apricornBox', (state: FieldScriptState) => { state.apricornBox[0] += 1 }],
    ['options de déplacement', 'runningShoes', (state: FieldScriptState) => { state.runningShoes = true }],
    ['position', 'player', (state: FieldScriptState) => { state.player.x += 1 }],
    ['warp', 'dynamicWarp', (state: FieldScriptState) => {
      state.dynamicWarp = { mapId: 1, warpId: 2, x: 3, z: 4, direction: 1 }
    }],
    ['locomotion', 'playerState', (state: FieldScriptState) => { state.playerState = 1 }],
    ['objets de carte', 'objects', (state: FieldScriptState) => {
      state.objects.set(4, { x: 1, z: 2, direction: 'north' })
    }],
    ['props de carte', 'mapProps', (state: FieldScriptState) => { state.mapProps.push({ modelId: 1, x: 1, y: 0, z: 2 }) }],
    ['buffers de script', 'buffers', (state: FieldScriptState) => { state.buffers.set(0, 'X') }],
    ['état transitoire du système terrain', 'fieldSystemMode', (state: FieldScriptState) => { state.fieldSystemMode = 1 }],
    ['multijoueur de session', 'unionActivity', (state: FieldScriptState) => { state.unionActivity = 1 }],
    ['profil et texte joueur', 'playerName', (state: FieldScriptState) => { state.playerName = 'KRIS' }],
    ['options de campagne', 'mysteryGiftActive', (state: FieldScriptState) => { state.mysteryGiftActive = true }],
    ['mécanisme d’arène binaire', 'gymmick', (state: FieldScriptState) => { state.gymmick.data[0] = 1 }],
    ['Pokeathlon', 'pokeathlonRecords', (state: FieldScriptState) => { state.pokeathlonRecords[0] = 1 }],
  ])('refuse toute mutation du domaine sensible %s', (_domain, path, mutate) => {
    expectUnsupported(mutate, path)
  })

  it.each([0x4000, 0x400f, 0x8000, 0x800f])(
    'refuse la mutation du registre temporaire 0x%s',
    (variableId) => {
      const before = populatedState()
      before.variables.set(variableId, 7)
      const baseline = captureHgssSharedFieldEventBaseline(before)
      const after = cloneFieldScriptState(before)
      after.variables.set(variableId, 8)
      expect(() => attestHgssSharedFieldEventDelta(baseline, after)).toThrowError(
        expect.objectContaining({ code: 'unsupported-mutation' }),
      )
    },
  )

  it('refuse aussi ajout et suppression de registres temporaires', () => {
    const before = populatedState()
    before.variables.set(0x8001, 2)
    const baseline = captureHgssSharedFieldEventBaseline(before)
    const added = cloneFieldScriptState(before)
    added.variables.set(0x4001, 1)
    const removed = cloneFieldScriptState(before)
    removed.variables.delete(0x8001)
    expect(() => attestHgssSharedFieldEventDelta(baseline, added)).toThrowError(
      expect.objectContaining({ code: 'unsupported-mutation' }),
    )
    expect(() => attestHgssSharedFieldEventDelta(baseline, removed)).toThrowError(
      expect.objectContaining({ code: 'unsupported-mutation' }),
    )
  })

  it('détecte une mutation imbriquée malgré une référence runtime partagée par cloneFieldScriptState', () => {
    const before = populatedState(true)
    const baseline = captureHgssSharedFieldEventBaseline(before)
    const after = cloneFieldScriptState(before)
    const speciesNames = after.pokemonRuntime!.catalog.speciesNames as string[]
    speciesNames[152] = 'MUTATION'

    expect(() => attestHgssSharedFieldEventDelta(baseline, after)).toThrowError(
      expect.objectContaining({ code: 'unsupported-mutation' }),
    )
  })

  it('détecte séparément la consommation des RNG LCRNG et MT, même partagés par référence', () => {
    const lcrngBefore = populatedState(true)
    const lcrngBaseline = captureHgssSharedFieldEventBaseline(lcrngBefore)
    const lcrngAfter = cloneFieldScriptState(lcrngBefore)
    lcrngAfter.pokemonRuntime!.rng.nextU16()
    expect(() => attestHgssSharedFieldEventDelta(lcrngBaseline, lcrngAfter)).toThrowError(
      expect.objectContaining({ code: 'unsupported-mutation', path: 'pokemonRuntime.rng' }),
    )

    const mtBefore = populatedState(true)
    const mtBaseline = captureHgssSharedFieldEventBaseline(mtBefore)
    const mtAfter = cloneFieldScriptState(mtBefore)
    mtAfter.pokemonRuntime!.mt!.nextU32()
    expect(() => attestHgssSharedFieldEventDelta(mtBaseline, mtAfter)).toThrowError(
      expect.objectContaining({ code: 'unsupported-mutation', path: 'pokemonRuntime.mt' }),
    )
  })

  it('refuse le remplacement d’une capacité runtime et les domaines opaques', () => {
    expectUnsupported((state) => {
      state.pokemonRuntime = { ...state.pokemonRuntime!, now: () => new Date(0) }
    }, 'pokemonRuntime', { runtime: true })

    const opaque = populatedState() as FieldScriptState & { opaque: WeakMap<object, object> }
    opaque.opaque = new WeakMap()
    expect(() => captureHgssSharedFieldEventBaseline(opaque)).toThrowError(
      expect.objectContaining({ code: 'unattestable-domain' }),
    )
  })

  it('refuse les identifiants et valeurs hors contrat partageable', () => {
    const invalidFlag = populatedState()
    invalidFlag.flags.add(0x1_0000)
    expect(() => captureHgssSharedFieldEventBaseline(invalidFlag)).toThrowError(
      expect.objectContaining({ code: 'invalid-state' }),
    )

    const before = populatedState()
    const baseline = captureHgssSharedFieldEventBaseline(before)
    const invalidValue = cloneFieldScriptState(before)
    invalidValue.variables.set(0x4010, 1_000_000_001)
    expect(() => attestHgssSharedFieldEventDelta(baseline, invalidValue)).toThrowError(
      expect.objectContaining({ code: 'invalid-state' }),
    )
  })
})
