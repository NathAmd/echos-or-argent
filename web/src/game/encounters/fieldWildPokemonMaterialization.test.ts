import { describe, expect, it, vi } from 'vitest'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng, type HgssLcrng } from '../pokemon/hgssPokemonRng'
import { HgssFieldPartyInvariantError, type PokemonParty } from '../pokemon/pokemonParty'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { resolveBaseFieldWildEncounterRoute, type FieldWildEncounterRouteResolver } from './fieldWildEncounterRouteResolver'
import { materializeFieldWildPokemon, type FieldWildPokemonMaterializationOptions } from './fieldWildPokemonMaterialization'
import { createHgssRoamerSaveState } from './hgssRoamers'
import type { PreparedFieldWildEncounter } from './wildEncounterSelection'
import { createCanonicalWildPokemon } from './wildPokemonGeneration'

const landEncounter = {
  encounter: { bankId: 1, slotIndex: 0, method: 'land', time: 'day', speciesId: 155, level: 8 },
  rateRoll: { triggered: true, modifiedRate: 30, firstRoll: 0 },
} as const satisfies PreparedFieldWildEncounter

const safariEncounter = {
  encounter: { areaId: 0, areaSlot: 0, method: 'safari', safariMethod: 'land', time: 'day', slotIndex: 0, speciesId: 19, level: 5 },
  rateRoll: { triggered: true, modifiedRate: 30, firstRoll: 0 },
} as const satisfies PreparedFieldWildEncounter

function createSequenceRng(values: readonly number[]): HgssLcrng {
  let cursor = 0
  return {
    getSeed: () => cursor,
    nextU16: () => {
      const value = values[cursor]
      if (value === undefined) throw new Error('Tirage RNG de matérialisation inattendu.')
      cursor += 1
      return value
    },
  }
}

function createLead(maximumSpeciesId = 493): CanonicalPokemon {
  const catalog = createPokemonTestCatalog(maximumSpeciesId)
  return createCanonicalWildPokemon({
    speciesId: 152,
    level: 10,
    catalog,
    rng: createHgssLcrng(1),
    originalTrainer: { id: 7, name: 'JO', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 1, metLevel: 10, metTerrain: 0 },
  })
}

function createOptions(overrides: Partial<FieldWildPokemonMaterializationOptions> = {}): FieldWildPokemonMaterializationOptions {
  const catalog = createPokemonTestCatalog(493)
  return {
    prepared: landEncounter,
    routeResolver: resolveBaseFieldWildEncounterRoute,
    pokemonRuntime: {
      catalog,
      rng: createHgssLcrng(2),
      trainer: { id: 7, name: 'JO', gender: 'male' },
      language: 3,
      gameVersion: 7,
    },
    metLocation: 404,
    resolveMetTerrain: () => 9,
    party: { members: [createLead()] },
    roamers: createHgssRoamerSaveState(),
    materializeSafariEncounter: () => { throw new Error('Route Safari inattendue.') },
    ...overrides,
  }
}

describe('field wild Pokemon materialization', () => {
  it('delegates Safari materialization before requiring a map, terrain, or valid field party', () => {
    const sentinel = createLead()
    const materializeSafariEncounter = vi.fn(() => sentinel)
    const resolveMetTerrain = vi.fn(() => { throw new Error('Terrain relu sur la route Safari.') })

    const pokemon = materializeFieldWildPokemon(createOptions({
      prepared: safariEncounter,
      metLocation: undefined,
      resolveMetTerrain,
      party: { members: [] },
      materializeSafariEncounter,
    }))

    expect(pokemon).toBe(sentinel)
    expect(materializeSafariEncounter).toHaveBeenCalledWith(safariEncounter.encounter)
    expect(resolveMetTerrain).not.toHaveBeenCalled()
  })

  it('keeps a roaming Pokemon persistent identity, IVs, HP, and status after route identity overrides', () => {
    const roamers = createHgssRoamerSaveState()
    const individualValues = { hp: 31, attack: 30, defense: 29, speed: 28, specialAttack: 27, specialDefense: 26 }
    const instanceId = 'pkm:v1:r:00000000000000000000000000000243' as CanonicalPokemon['instanceId']
    roamers.roamers[0] = {
      instanceId,
      metLocation: 77,
      locationIndex: 0,
      individualValues,
      personality: 12345,
      speciesId: 243,
      currentHp: 3,
      level: 40,
      status: 4,
      active: true,
    }
    const prepared = {
      encounter: { bankId: 1, slotIndex: 0, method: 'roamer', speciesId: 243, level: 40, roamerId: 0 },
      rateRoll: { triggered: true, modifiedRate: 30, firstRoll: 0 },
    } as const satisfies PreparedFieldWildEncounter
    const routeResolver: FieldWildEncounterRouteResolver = (encounter) => encounter.method === 'safari'
      ? { engine: 'safari', encounter }
      : {
          engine: 'simple',
          sessionKind: 'wild',
          encounter: encounter.method === 'roamer' ? { ...encounter, speciesId: 244, level: 41 } : encounter,
        }
    const resolveMetTerrain = vi.fn(() => 9)

    const pokemon = materializeFieldWildPokemon(createOptions({ prepared, routeResolver, roamers, resolveMetTerrain }))

    expect(pokemon).toMatchObject({
      instanceId,
      speciesId: 244,
      level: 41,
      individualValues,
      currentHp: 3,
      status: 4,
      origin: { metLocation: 77, metLevel: 41, metTerrain: 0 },
    })
    expect(resolveMetTerrain).not.toHaveBeenCalled()
  })

  it('creates an ordinary wild Pokemon with the routed identity, lead influence, and field origin', () => {
    const catalog = createPokemonTestCatalog(493)
    catalog.personalData[155] = { ...catalog.personalData[155]!, heldItems: [10, 20] }
    const lead = createLead()
    lead.abilityId = 14
    const rng = createSequenceRng([7, 1, 0, 7, 0, 0xffff, 0, 85])
    const routeResolver: FieldWildEncounterRouteResolver = () => ({
      engine: 'simple',
      sessionKind: 'wild',
      encounter: { ...landEncounter.encounter, speciesId: 155, level: 12 },
    })

    const pokemon = materializeFieldWildPokemon(createOptions({
      routeResolver,
      pokemonRuntime: { catalog, rng, trainer: { id: 99, name: 'KOTONE', gender: 'female' }, language: 4, gameVersion: 8 },
      metLocation: 405,
      resolveMetTerrain: () => 11,
      party: { members: [lead] },
    }))

    expect(pokemon).toMatchObject({
      speciesId: 155,
      level: 12,
      heldItemId: 20,
      originalTrainer: { id: 99, name: 'KOTONE', gender: 'female' },
      origin: { language: 4, gameVersion: 8, metLocation: 405, metLevel: 12, metTerrain: 11 },
    })
    expect(rng.getSeed()).toBe(8)
  })

  it('returns no Pokemon when the field Pokemon runtime is unavailable without resolving a route', () => {
    const routeResolver = vi.fn(resolveBaseFieldWildEncounterRoute)
    expect(materializeFieldWildPokemon(createOptions({ pokemonRuntime: undefined, routeResolver }))).toBeUndefined()
    expect(routeResolver).not.toHaveBeenCalled()
  })

  it('rejects a standard encounter without a current ROM map', () => {
    expect(() => materializeFieldWildPokemon(createOptions({ metLocation: undefined })))
      .toThrow('La carte ROM de la rencontre sauvage est absente.')
  })

  it('preserves the HGSS field-party invariant for standard and roaming encounters', () => {
    const party: PokemonParty = { members: [] }
    expect(() => materializeFieldWildPokemon(createOptions({ party })))
      .toThrow(HgssFieldPartyInvariantError)
  })
})
