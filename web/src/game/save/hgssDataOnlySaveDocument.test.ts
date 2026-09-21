import { describe, expect, it } from 'vitest'
import { createCanonicalPokemon, type CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssSessionRng } from '../pokemon/hgssSessionRng'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { createFieldScriptState } from '../scripts/fieldScriptRunner'
import {
  createHgssDataOnlySaveAuthority,
  hgssDataOnlySaveAuthority,
  type HgssRomBoundaryCanary,
} from './hgssDataOnlySaveDocument'
import { createHgssSaveState, type HgssSaveStateV1 } from './hgssSaveState'

const romTextCanary = 'ROM_RESOLVED_TEXT_CANARY_7F31A9'
const romNumberCanary = 2_130_706_519

function persistentPokemonId(index: number): CanonicalPokemon['instanceId'] {
  return `pkm:v1:r:${index.toString(16).padStart(32, '0')}` as CanonicalPokemon['instanceId']
}

function objectAtPath(value: unknown, path: readonly (string | number)[]): Record<string, unknown> {
  let current = value
  for (const segment of path) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current)) throw new Error(`Tableau de test absent à ${path.join('.')}.`)
      current = current[segment]
    } else {
      if (!current || typeof current !== 'object' || Array.isArray(current)) {
        throw new Error(`Objet de test absent à ${path.join('.')}.`)
      }
      current = (current as Record<string, unknown>)[segment]
    }
  }
  if (!current || typeof current !== 'object' || Array.isArray(current)) {
    throw new Error(`Cible de test absente à ${path.join('.')}.`)
  }
  return current as Record<string, unknown>
}

function createCompleteCanaryFixture() {
  const romObjectCanary = Object.freeze({ source: 'rom-object-canary', label: romTextCanary })
  const catalog = createPokemonTestCatalog()
  const rng = createHgssSessionRng(0x71c0ffee)
  const pokemon = {
    ...createCanonicalPokemon(catalog, {
      speciesId: 155,
      level: 5,
      rng: rng.lc,
      personality: { kind: 'fixed', value: 0x12345678 },
      individualValues: { kind: 'fixed', value: 12 },
      originalTrainer: { id: 0x10203040, name: 'JO', gender: 'male' },
      origin: { language: 3, gameVersion: 7, metLocation: 126, metLevel: 5, metTerrain: 12 },
      ballId: 4,
    }),
    instanceId: persistentPokemonId(1),
  }
  pokemon.speciesName = romTextCanary
  pokemon.moves[0]!.data = {
    ...pokemon.moves[0]!.data,
    effect: romNumberCanary,
  }
  Object.assign(pokemon, { resolvedRomObject: romObjectCanary })
  Object.assign(pokemon.originalTrainer, { resolvedRomObject: romObjectCanary })
  Object.assign(pokemon.origin, { resolvedRomObject: romObjectCanary })

  const field = createFieldScriptState('male', 'JO', { party: [pokemon] })
  field.buffers.set(0, romTextCanary)
  field.player = Object.assign({ x: 4, z: 7, direction: 'north' as const }, {
    resolvedRomObject: romObjectCanary,
  })
  field.objects.set(7, Object.assign({ x: 8, z: 9, direction: 'west' as const }, {
    resolvedRomObject: romObjectCanary,
  }))
  field.mapProps = [Object.assign({ modelId: 0x8d, x: 131, y: 0, z: 65 }, {
    resolvedRomText: romTextCanary,
    resolvedRomObject: romObjectCanary,
  })]
  Object.assign(field.roamers, { resolvedRomObject: romObjectCanary })
  field.roamers.roamers[0] = Object.assign({
    instanceId: persistentPokemonId(600),
    metLocation: 39,
    locationIndex: 6,
    individualValues: Object.assign({
      hp: 1, attack: 2, defense: 3, speed: 4, specialAttack: 5, specialDefense: 6,
    }, { resolvedRomObject: romObjectCanary }),
    personality: 0x10203040,
    speciesId: 243,
    currentHp: 91,
    level: 40,
    status: 0,
    active: true,
  }, { resolvedRomObject: romObjectCanary })
  Object.assign(field.favoritePokemon, { resolvedRomObject: romObjectCanary })
  field.bugContest = Object.assign({
    weekday: 2,
    registeredContestants: [1, 2, 3],
    elapsedMinutes: 5,
  }, { resolvedRomObject: romObjectCanary })
  field.togepiEggIdentity = Object.assign({
    personality: 0x24681357,
    gender: 'female' as const,
  }, { resolvedRomObject: romObjectCanary })
  field.dynamicWarp = Object.assign({
    mapId: 374,
    warpId: 0,
    x: 8,
    z: 12,
    direction: 1,
  }, { resolvedRomObject: romObjectCanary })

  let sequence = 2
  for (const box of field.pokemonStorage.boxes) {
    for (let slot = 0; slot < box.length; slot += 1) {
      box[slot] = {
        ...pokemon,
        instanceId: persistentPokemonId(sequence),
        originalTrainer: { ...pokemon.originalTrainer },
        origin: { ...pokemon.origin },
        individualValues: { ...pokemon.individualValues },
        effortValues: { ...pokemon.effortValues },
        moves: pokemon.moves.map((move) => ({ ...move })),
        stats: { ...pokemon.stats },
        contestValues: [...(pokemon.contestValues ?? [0, 0, 0, 0, 0, 0])] as CanonicalPokemon['contestValues'],
        ribbonIds: [...pokemon.ribbonIds],
      }
      sequence += 1
    }
  }

  const profile = Object.assign({
    gender: 'male' as const,
    name: 'JO',
    trainerId: 0x10203040,
    language: 3,
    gameVersion: 7,
  }, { resolvedRomObject: romObjectCanary })
  const world = Object.assign({
    mapId: 61,
    tileX: 4,
    tileZ: 7,
    direction: 'north' as const,
    follower: Object.assign({ tileX: 5, tileZ: 7, direction: 'north' as const }, {
      resolvedRomObject: romObjectCanary,
    }),
  }, { resolvedRomObject: romObjectCanary })
  const options = Object.assign({
    textSpeed: 'fast' as const,
    battleAnimations: true,
    localWeather: false,
  }, { resolvedRomObject: romObjectCanary })
  const save = createHgssSaveState(
    'IPKF',
    profile,
    rng,
    world,
    field,
    options,
    { hours: 42, minutes: 17, seconds: 9 },
    {
      schemaVersion: 1,
      lastObservedTimestampSeconds: 1_787_391_000,
      lastObservedDayOrdinal: 20_691,
      ownerRtcOffset: -120,
      penaltyMinutes: 0,
    },
  )
  const canaries: readonly HgssRomBoundaryCanary[] = [
    { kind: 'text', label: 'resolved-text', value: romTextCanary },
    { kind: 'number', label: 'resolved-number', value: romNumberCanary },
    { kind: 'object', label: 'resolved-object', value: romObjectCanary },
  ]
  return { save, canaries, romObjectCanary }
}

describe('autorité de sauvegarde HGSS data-only', () => {
  it('atteste une sauvegarde complète de 541 Pokémon sans canari ROM résolu', () => {
    const { save, canaries } = createCompleteCanaryFixture()
    const document = hgssDataOnlySaveAuthority.project(save, { romCanaries: canaries })
    const serialized = JSON.stringify(document)

    expect(hgssDataOnlySaveAuthority.owns(document)).toBe(true)
    expect(serialized.length).toBeLessThan(1024 * 1024 - 4 * 1024)
    expect(serialized).not.toContain(romTextCanary)
    expect(serialized).not.toContain(String(romNumberCanary))
    expect(document.field.objects).toEqual([])
    expect(document.field.mapProps).toEqual([])
    expect(Object.isFrozen(document)).toBe(true)
    expect(Object.isFrozen(document.field)).toBe(true)
    expect(Object.isFrozen(document.field.pokemonStorage?.boxes[0]?.[0])).toBe(true)
  })

  it('lie la preuve à une autorité et revalide une copie JSON avant de la rebrander', () => {
    const { save, canaries } = createCompleteCanaryFixture()
    const firstAuthority = createHgssDataOnlySaveAuthority()
    const otherAuthority = createHgssDataOnlySaveAuthority()
    const document = firstAuthority.project(save, { romCanaries: canaries })
    const copied = JSON.parse(JSON.stringify(document)) as unknown

    expect(firstAuthority.owns(copied)).toBe(false)
    expect(otherAuthority.owns(document)).toBe(false)

    const decoded = firstAuthority.decode(copied, { romCanaries: canaries })
    expect(firstAuthority.owns(decoded)).toBe(true)
    expect(otherAuthority.owns(decoded)).toBe(false)
    expect(decoded).toEqual(document)
    expect(decoded).not.toBe(document)
  })

  it('refuse les champs inconnus à la lecture tout en canonisant la projection locale', () => {
    const { save, canaries } = createCompleteCanaryFixture()
    const localProjection = { ...save, transientUndefined: undefined } as HgssSaveStateV1
    const document = hgssDataOnlySaveAuthority.project(localProjection, { romCanaries: canaries })
    const unknownWire = JSON.parse(JSON.stringify(document)) as Record<string, unknown>
    unknownWire.unregisteredPayload = 7

    expect(document).not.toHaveProperty('transientUndefined')
    expect(() => hgssDataOnlySaveAuthority.decode(unknownWire, { romCanaries: canaries }))
      .toThrow(/inconnu|invalide|interdit/)
  })

  it.each([
    ['world.follower', ['world', 'follower']],
    ['field.party Pokémon', ['field', 'party', 0]],
    ['field.party move', ['field', 'party', 0, 'moves', 0]],
    ['field.storage Pokémon', ['field', 'pokemonStorage', 'boxes', 0, 0]],
    ['field.daycare', ['field', 'daycare']],
    ['field.roamers', ['field', 'roamers']],
    ['field.roamer', ['field', 'roamers', 'roamers', 0]],
    ['field.favoritePokemon', ['field', 'favoritePokemon']],
    ['field.pokedex', ['field', 'pokedex']],
    ['field.pokegear', ['field', 'pokegear']],
    ['field.friendGroups', ['field', 'friendGroups', 0]],
    ['field.palPark', ['field', 'palPark']],
    ['field.bugContest', ['field', 'bugContest']],
    ['field.togepiEggIdentity', ['field', 'togepiEggIdentity']],
    ['field.dynamicWarp', ['field', 'dynamicWarp']],
    ['field.gymmick', ['field', 'gymmick']],
    ['field.safariZone', ['field', 'safariZone']],
    ['field.safariProgression', ['field', 'safariProgression']],
    ['field.photoAlbum', ['field', 'photoAlbum']],
    ['options', ['options']],
    ['igt', ['igt']],
    ['rtcPenalty', ['rtcPenalty']],
    ['rng', ['rng']],
  ] as const)('refuse un champ distant empoisonné dans %s', (_label, path) => {
    const { save, canaries } = createCompleteCanaryFixture()
    const document = hgssDataOnlySaveAuthority.project(save, { romCanaries: canaries })
    const poisoned = JSON.parse(JSON.stringify(document))
    objectAtPath(poisoned, path).unexpectedNestedField = true

    expect(() => hgssDataOnlySaveAuthority.decode(poisoned, { romCanaries: canaries }))
      .toThrow(/inconnu|invalide|canonique|interdit/)
  })

  it('refuse les projections transitoires même si leurs champs sont numériques', () => {
    const { save, canaries } = createCompleteCanaryFixture()
    const document = hgssDataOnlySaveAuthority.project(save, { romCanaries: canaries })
    const poisoned: unknown = JSON.parse(JSON.stringify(document))
    const field = objectAtPath(poisoned, ['field'])
    field.objects = [[7, { x: 8, z: 9, direction: 'west' }]]
    field.mapProps = [{ modelId: 0x8d, x: 131, y: 0, z: 65 }]

    expect(() => hgssDataOnlySaveAuthority.decode(poisoned, { romCanaries: canaries }))
      .toThrow(/objets transitoires|projection locale|legacy/)
  })

  it('refuse les canaris primitifs et les identités d’objets ROM', () => {
    const { save, canaries, romObjectCanary } = createCompleteCanaryFixture()
    const document = hgssDataOnlySaveAuthority.project(save, { romCanaries: canaries })
    const textLeak = JSON.parse(JSON.stringify(document)) as { profile: { name: string } }
    textLeak.profile.name = romTextCanary
    const numberLeak = JSON.parse(JSON.stringify(document)) as { field: { money: number } }
    numberLeak.field.money = romNumberCanary
    const objectLeak = {
      ...save,
      extensions: {
        'test.rom-object': { version: 1, value: romObjectCanary },
      },
    } as HgssSaveStateV1

    expect(() => hgssDataOnlySaveAuthority.decode(textLeak, { romCanaries: canaries }))
      .toThrow('Sentinelle ROM resolved-text')
    expect(() => hgssDataOnlySaveAuthority.decode(numberLeak, { romCanaries: canaries }))
      .toThrow('Sentinelle ROM resolved-number')
    expect(() => hgssDataOnlySaveAuthority.project(objectLeak, { romCanaries: canaries }))
      .toThrow('Objet ROM resolved-object')
  })

  it('produit une canonisation stable', () => {
    const { save, canaries } = createCompleteCanaryFixture()
    const once = hgssDataOnlySaveAuthority.project(save, { romCanaries: canaries })
    const twice = hgssDataOnlySaveAuthority.project(once, { romCanaries: canaries })

    expect(JSON.stringify(twice)).toBe(JSON.stringify(once))
    expect(twice).not.toBe(once)
  })

  it('canonise la provenance des trois seeds NG+ et refuse son retrait sur le wire', () => {
    const rng = createHgssSessionRng(0x5eed)
    const save = createHgssSaveState(
      'IPKF',
      { gender: 'male', name: 'JO', trainerId: 7, language: 3, gameVersion: 7 },
      rng,
      { mapId: 60, tileX: 1, tileZ: 1, direction: 'south' },
      createFieldScriptState('male', 'JO'),
      undefined,
      undefined,
      undefined,
      {
        format: 'pokemaster-hgss-new-game-plus',
        version: 1,
        source: {
          gameVersion: 7,
          language: 3,
          slot: 1,
          playerName: 'JO',
          leagueCompletedAt: '2026-08-26T12:00:00.000Z',
        },
        modules: [
          { id: 'randomizer', revision: 1, config: { seed: 'seed-randomizer' } },
          { id: 'all-pokemon-accessible', revision: 1, config: { seed: 'seed-all-pokemon' } },
          { id: 'visible-wild-pokemon', revision: 1, config: {
            seed: 'seed-visible', actorsPerMap: 3, includeSafari: true, movement: 'wander',
          } },
        ],
      },
    )
    const document = hgssDataOnlySaveAuthority.project(save)
    const wire = JSON.parse(JSON.stringify(document)) as {
      newGamePlus: { modules: Array<{ config: Record<string, unknown> }> }
    }

    expect(wire.newGamePlus.modules.map(({ config }) => config)).toEqual([
      { seed: 'seed-randomizer', seedSource: 'config-text' },
      { seed: 'seed-all-pokemon', seedSource: 'config-text' },
      {
        seed: 'seed-visible', seedSource: 'config-text',
        actorsPerMap: 3, includeSafari: true, movement: 'wander',
      },
    ])
    expect(hgssDataOnlySaveAuthority.decode(wire)).toEqual(document)

    const legacyWire = structuredClone(wire)
    legacyWire.newGamePlus.modules.forEach(({ config }) => delete config.seedSource)
    expect(() => hgssDataOnlySaveAuthority.decode(legacyWire)).toThrow('canonique')
  })
})
