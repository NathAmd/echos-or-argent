import { describe, expect, it, vi } from 'vitest'
import type { PokemonCatalog } from '../../../ndsTypes'
import type { HgssTrainerPokemon } from '../../../rom/battle/trainerData'
import { createCanonicalPokemon } from '../../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../../pokemon/hgssPokemonRng'
import { resolvePokemonInitialTeam } from '../../pokemon/pokemonInitialTeamResolver'
import { createPokemonTestCatalog } from '../../pokemon/pokemonTestCatalog'
import type { PreparedFieldWildEncounter } from '../../encounters/wildEncounterSelection'
import {
  createRandomizerRuntime,
  decodeRandomizerConfig,
  randomizerMappingVersion,
  randomizerModule,
} from './randomizerModule'

const rateRoll = Object.freeze({ triggered: true, modifiedRate: 20, firstRoll: 4 })

function preparedWild(
  speciesId: number,
  level: number,
  method: 'land' | 'safari' | 'roamer' = 'land',
): PreparedFieldWildEncounter {
  if (method === 'roamer') {
    return { rateRoll, encounter: { bankId: 1, slotIndex: 0, method, speciesId, level, roamerId: 0 } }
  }
  if (method === 'safari') {
    return {
      rateRoll,
      encounter: {
        areaId: 0,
        areaSlot: 0,
        method,
        safariMethod: 'land',
        time: 'day',
        slotIndex: 0,
        speciesId,
        level,
      },
    }
  }
  return {
    rateRoll,
    encounter: { bankId: 1, slotIndex: 0, method, time: 'day', speciesId, level },
  }
}

const trainerPokemon = (speciesId: number, level: number, form = 2): HgssTrainerPokemon => ({
  difficulty: 100,
  genderOverride: 0,
  abilityOverride: 0,
  level,
  speciesId,
  form,
  heldItemId: 4,
  moveIds: [10, 33, 43, 45],
  capsule: 7,
})

describe('module NG+ Randomizer', () => {
  it('est désactivé par défaut et valide un seed public JSON strict', () => {
    expect(randomizerModule.enabledByDefault).toBe(false)
    expect(randomizerMappingVersion).toBe(1)
    expect(decodeRandomizerConfig({ seed: 'Johto-2026' })).toEqual({
      seed: 'Johto-2026', seedSource: 'config-text',
    })
    expect(decodeRandomizerConfig({
      seed: 'ROM_RESOLVED_TEXT_CANARY', seedSource: 'config-text',
    })).toEqual({ seed: 'ROM_RESOLVED_TEXT_CANARY', seedSource: 'config-text' })
    expect(Object.isFrozen(decodeRandomizerConfig({ seed: 'Johto-2026' }))).toBe(true)

    const accessor = Object.defineProperty({}, 'seed', { enumerable: true, get: vi.fn(() => 'secret') })
    for (const invalid of [
      null,
      {},
      { seed: '' },
      { seed: ' seed' },
      { seed: 'seed\n' },
      { seed: 123 },
      { seed: 'seed', seedSource: 'rom-text' },
      { seed: 'seed', secret: true },
      Object.create({ seed: 'prototype' }),
      accessor,
    ]) expect(() => decodeRandomizerConfig(invalid)).toThrow()
  })

  it('reproduit les mêmes mappings après reload et indépendamment de l’ordre des appels', () => {
    const catalog = createPokemonTestCatalog(200)
    const first = createRandomizerRuntime(catalog, { seed: 'reload-stable' })
    const second = createRandomizerRuntime(catalog, JSON.parse(JSON.stringify(first.config)))
    const contexts = [
      { mapId: 1, source: 'step' as const },
      { mapId: 42, source: 'fishing' as const },
      { mapId: 357, source: 'visible-world' as const },
    ]
    const encounters = contexts.map((context, index) => (
      first.fieldWildEncounterIdentityPort(preparedWild(16 + index, 4 + index), context).encounter.speciesId
    ))
    const reversed = [...contexts].reverse().map((context, reverseIndex) => {
      const index = contexts.length - reverseIndex - 1
      return second.fieldWildEncounterIdentityPort(preparedWild(16 + index, 4 + index), context).encounter.speciesId
    }).reverse()

    expect(encounters).toEqual(reversed)
    expect(encounters).toEqual([176, 151, 191])
    expect(encounters.every((speciesId) => speciesId >= 1 && speciesId <= 200)).toBe(true)
  })

  it('randomise starters et rencontres par leur identité sans modifier niveau, taux ou RNG gameplay', () => {
    const runtime = createRandomizerRuntime(createPokemonTestCatalog(200), { seed: 'contexts' })
    const randomSpy = vi.spyOn(Math, 'random')
    const starter = resolvePokemonInitialTeam({
      choice: 2,
      baseDefinition: { speciesId: 158, level: 5, form: 3 },
    }, runtime.initialTeamResolver)
    const source = preparedWild(16, 7)
    const step = runtime.fieldWildEncounterIdentityPort(source, { mapId: 7, source: 'step' })
    const fishing = runtime.fieldWildEncounterIdentityPort(source, { mapId: 7, source: 'fishing' })
    const otherMap = runtime.fieldWildEncounterIdentityPort(source, { mapId: 8, source: 'step' })

    expect(starter).toEqual([{ speciesId: 23, level: 5, form: 0 }])
    expect(step.encounter).toMatchObject({ speciesId: 73, level: 7 })
    expect(fishing.encounter).toMatchObject({ speciesId: 131, level: 7 })
    expect(otherMap.encounter).toMatchObject({ speciesId: 61, level: 7 })
    expect(step.rateRoll).toBe(rateRoll)
    expect(source.encounter).toMatchObject({ speciesId: 16, level: 7 })
    expect(randomSpy).not.toHaveBeenCalled()
    randomSpy.mockRestore()
  })

  it('couvre Safari mais préserve par référence les roamers et les sauvages scriptés', () => {
    const runtime = createRandomizerRuntime(createPokemonTestCatalog(200), { seed: 'safe-campaign' })
    const safari = preparedWild(118, 17, 'safari')
    const roamer = preparedWild(243, 40, 'roamer')
    const scripted = { speciesId: 249, level: 70, form: 1 as const, heldItemId: 4 }

    const randomizedSafari = runtime.fieldWildEncounterIdentityPort(safari, { mapId: 357, source: 'step' })
    expect(randomizedSafari.encounter.level).toBe(17)
    expect(randomizedSafari.encounter.speciesId).toBeGreaterThanOrEqual(1)
    expect(randomizedSafari.encounter.speciesId).toBeLessThanOrEqual(200)
    expect(runtime.fieldWildEncounterIdentityPort(roamer, { mapId: 42, source: 'step' })).toBe(roamer)
    expect(runtime.fieldBattleRosterPolicy.transformScriptedWildPokemon(scripted)).toBe(scripted)
  })

  it('préserve taille, niveaux et données de progression des rosters de Dresseurs', () => {
    const runtime = createRandomizerRuntime(createPokemonTestCatalog(200), { seed: 'trainers' })
    const party = [trainerPokemon(152, 12), trainerPokemon(155, 27)]
    const transformed = runtime.fieldBattleRosterPolicy.transformTrainerParty(party, {
      battleKind: 'trainer',
      role: 'opponent',
      trainerId: 77,
    })
    const sameIdentity = runtime.fieldBattleRosterPolicy.transformTrainerParty(party, {
      battleKind: 'multi-trainer',
      role: 'ally',
      trainerId: 77,
    })

    expect(transformed).toHaveLength(2)
    expect(transformed.map(({ speciesId }) => speciesId)).toEqual([189, 40])
    expect(sameIdentity.map(({ speciesId }) => speciesId)).toEqual([189, 40])
    expect(transformed.map(({ level }) => level)).toEqual([12, 27])
    expect(transformed.map(({ form }) => form)).toEqual([0, 0])
    expect(transformed[0]).toMatchObject({ difficulty: 100, heldItemId: 4, capsule: 7 })
    expect(party.map(({ speciesId, form }) => ({ speciesId, form }))).toEqual([
      { speciesId: 152, form: 2 },
      { speciesId: 155, form: 2 },
    ])
  })

  it('recalcule une équipe canonique de Maison des Dresseurs sans casser ses identités', () => {
    const catalog = createPokemonTestCatalog(200)
    const runtime = createRandomizerRuntime(catalog, { seed: 'trainer-house' })
    const pokemon = createCanonicalPokemon(catalog, {
      speciesId: 152,
      level: 50,
      form: 0,
      rng: createHgssLcrng(1),
      personality: { kind: 'fixed', value: 123 },
      individualValues: { kind: 'fixed', value: 20 },
      originalTrainer: { id: 1, name: 'JO', gender: 'male' },
      origin: { language: 3, gameVersion: 7, metLocation: 1, metLevel: 50, metTerrain: 0 },
      ballId: 4,
    })
    const transformed = runtime.fieldBattleRosterPolicy.transformTrainerHouseParty([pokemon], {
      battleKind: 'trainer-house',
      role: 'opponent',
      trainerId: 1234,
      trainerHouseSlot: 3,
    })

    expect(transformed).toHaveLength(1)
    expect(transformed[0]).toMatchObject({
      instanceId: pokemon.instanceId,
      speciesId: 93,
      speciesName: catalog.speciesNames[93],
      level: 50,
      form: 0,
    })
    expect(transformed[0]!.stats).not.toBe(pokemon.stats)
    expect(transformed[0]!.currentHp).toBe(transformed[0]!.stats.hp)
    expect(pokemon.speciesId).toBe(152)
  })

  it('ne sélectionne que les espèces complètes présentes et rejette un catalogue vide', () => {
    const sparse = createPokemonTestCatalog(8)
    sparse.personalData[3] = { ...sparse.personalData[3]!, speciesId: 999 }
    sparse.speciesNames[4] = ''
    sparse.levelUpLearnsets[5] = undefined as never
    const runtime = createRandomizerRuntime(sparse, { seed: 'sparse' })

    expect(runtime.availableSpeciesIds).toEqual([1, 2, 6, 7, 8])
    for (let choice = 0; choice < 3; choice += 1) {
      const [starter] = resolvePokemonInitialTeam({
        choice,
        baseDefinition: { speciesId: 1, level: 5, form: 0 },
      }, runtime.initialTeamResolver)
      expect(runtime.availableSpeciesIds).toContain(starter!.speciesId)
    }

    const emptyCatalog: PokemonCatalog = {
      ...createPokemonTestCatalog(1),
      speciesNames: ['INCONNU'],
      personalData: [],
      levelUpLearnsets: [],
    }
    expect(() => createRandomizerRuntime(emptyCatalog, { seed: 'empty' })).toThrow('aucune espèce')
  })

  it('laisse une équipe initiale explicitement remplacée par un autre mode', () => {
    const runtime = createRandomizerRuntime(createPokemonTestCatalog(200), { seed: 'composition' })
    const explicitTeam = Object.freeze([
      Object.freeze({ speciesId: 133, level: 5, form: 0 }),
      Object.freeze({ speciesId: 133, level: 5, form: 0 }),
    ])
    expect(runtime.initialTeamResolver({
      choice: 0,
      baseDefinition: { speciesId: 152, level: 5, form: 0 },
    }, explicitTeam)).toBe(explicitTeam)
  })
})
