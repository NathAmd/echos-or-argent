import { describe, expect, it } from 'vitest'
import type { HgssTrainer, HgssTrainerPokemon } from '../../../rom/battle/trainerData'
import { createTrainerParty } from '../../battle/createTrainerParty'
import { createCanonicalPokemon } from '../../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../../pokemon/hgssPokemonRng'
import { createPokemonTestCatalog } from '../../pokemon/pokemonTestCatalog'
import {
  baseFieldBattleRosterPolicy,
  type ScriptedWildPokemonDefinition,
} from '../../battle/fieldBattleRosterPolicy'
import { resolveBaseFieldBattleFormat } from '../../battle/fieldBattleFormatResolver'
import { basePokemonInitialTeamResolver } from '../../pokemon/pokemonInitialTeamResolver'
import { createAllBattlesInDuoRuntime } from './allBattlesInDuoRule'

const trainerPokemon = (speciesId: number): HgssTrainerPokemon => ({
  difficulty: 0,
  genderOverride: 0,
  abilityOverride: 0,
  level: 40,
  speciesId,
  form: 0,
  capsule: 0,
})

describe('règle Tous les combats en duo', () => {
  it('garantit deux instances à matérialiser dès le starter', () => {
    const runtime = createAllBattlesInDuoRuntime(true)
    const starter = Object.freeze({ speciesId: 152, level: 5, form: 0 })
    expect(runtime.pokemonInitialTeamResolver({ choice: 0, baseDefinition: starter }, [])).toEqual([starter, starter])
    const existing = Object.freeze([starter, Object.freeze({ speciesId: 155, level: 5, form: 0 })])
    expect(runtime.pokemonInitialTeamResolver({ choice: 0, baseDefinition: starter }, existing)).toBe(existing)
  })

  it.each([
    [{ kind: 'trainer', trainer: { doubleBattle: false } }, { engine: 'double', sessionKind: 'double' }],
    [{ kind: 'trainer', trainer: { doubleBattle: true } }, { engine: 'double', sessionKind: 'double' }],
    [{ kind: 'wild' }, { engine: 'double', sessionKind: 'double' }],
    [{ kind: 'tagTrainer' }, { engine: 'double', sessionKind: 'double' }],
    [{ kind: 'multiTrainer' }, { engine: 'double', sessionKind: 'multi' }],
    [{ kind: 'tutorial' }, { engine: 'tutorial' }],
    [{ kind: 'trainerHouse' }, { engine: 'simple', sessionKind: 'trainer' }],
  ] as const)('résout le format compatible %#', (source, expected) => {
    const runtime = createAllBattlesInDuoRuntime(true)
    expect(runtime.fieldBattleFormatResolver(source)).toEqual(expected)
  })

  it('traite de la même façon un sauvage ambiant, scripté ou légendaire seul', () => {
    const runtime = createAllBattlesInDuoRuntime(true)
    const ambientWild = { kind: 'wild' } as const
    const scriptedWild = {
      kind: 'wild',
      script: { kind: 'wild', speciesId: 143, level: 50, battleParameter: 0 },
    } as const
    const legendaryWild = {
      kind: 'wild',
      script: { kind: 'wild', speciesId: 249, level: 70, battleParameter: 0 },
      legendary: true,
    } as const

    expect(runtime.fieldBattleFormatResolver(ambientWild)).toEqual({ engine: 'double', sessionKind: 'double' })
    expect(runtime.fieldBattleFormatResolver(scriptedWild)).toEqual({ engine: 'double', sessionKind: 'double' })
    expect(runtime.fieldBattleFormatResolver(legendaryWild)).toEqual({ engine: 'double', sessionKind: 'double' })
  })

  it('complète uniquement le Dresseur simple à un membre avec une seconde instance matérialisée', () => {
    const runtime = createAllBattlesInDuoRuntime(true)
    const single = [trainerPokemon(152)] as const
    const nativeDouble = [trainerPokemon(155), trainerPokemon(158)] as const
    const context = { battleKind: 'trainer', role: 'opponent', trainerId: 7 } as const
    const adjusted = runtime.fieldBattleRosterPolicy.transformTrainerParty(single, context)
    const trainer: HgssTrainer = { trainerId: 7, trainerType: 0, trainerClass: 1, partySize: adjusted.length,
      items: [0, 0, 0, 0], aiFlags: 0, doubleBattle: false, party: [...adjusted] }
    const materialized = createTrainerParty(trainer, createPokemonTestCatalog(), { language: 3, gameVersion: 7 })

    expect(adjusted).toEqual([single[0], single[0]])
    expect(adjusted[1]).not.toBe(adjusted[0])
    expect(new Set(materialized.map(({ pokemon }) => pokemon.instanceId)).size).toBe(2)
    expect(runtime.fieldBattleRosterPolicy.transformTrainerParty(nativeDouble, context)).toBe(nativeDouble)
    expect(runtime.fieldBattleRosterPolicy.transformTrainerParty(single, { ...context, battleKind: 'tag-trainer' })).toBe(single)
    expect(runtime.fieldBattleRosterPolicy.transformTrainerParty(single, { ...context, battleKind: 'multi-trainer' })).toBe(single)
  })

  it('ne clone jamais le seul légendaire d un Dresseur, y compris après Randomizer', () => {
    const runtime = createAllBattlesInDuoRuntime(true)
    const legendary = [trainerPokemon(249)] as const
    const context = { battleKind: 'trainer', role: 'opponent', trainerId: 7 } as const

    expect(runtime.fieldBattleRosterPolicy.transformTrainerParty(legendary, context)).toBe(legendary)
  })

  it('conserve l’unique définition sauvage scriptée, notamment légendaire', () => {
    const runtime = createAllBattlesInDuoRuntime(true)
    const legendary: ScriptedWildPokemonDefinition = Object.freeze({
      speciesId: 249,
      level: 70,
      form: 0,
      heldItemId: 0,
      moveIds: [177, 219, 105, 56] as const,
    })

    expect(runtime.fieldBattleRosterPolicy.transformScriptedWildPokemon(legendary)).toBe(legendary)
  })

  it('préserve aussi le roster spécialisé de la Maison des Dresseurs', () => {
    const runtime = createAllBattlesInDuoRuntime(true)
    const pokemon = createCanonicalPokemon(createPokemonTestCatalog(), {
      speciesId: 152,
      level: 50,
      rng: createHgssLcrng(1),
      personality: { kind: 'fixed', value: 1 },
      individualValues: { kind: 'fixed', value: 20 },
      originalTrainer: { id: 1, name: 'JO', gender: 'male' },
      origin: { language: 3, gameVersion: 7, metLocation: 1, metLevel: 50, metTerrain: 0 },
      ballId: 4,
    })
    const party = [pokemon]

    expect(runtime.fieldBattleRosterPolicy.transformTrainerHouseParty(party, {
      battleKind: 'trainer-house', role: 'opponent', trainerId: 12, trainerHouseSlot: 3,
    })).toBe(party)
  })

  it('rend exactement les ports de base lorsque la règle est désactivée', () => {
    const runtime = createAllBattlesInDuoRuntime(false)

    expect(runtime.enabled).toBe(false)
    expect(runtime.fieldBattleFormatResolver).toBe(resolveBaseFieldBattleFormat)
    expect(runtime.fieldBattleRosterPolicy).toBe(baseFieldBattleRosterPolicy)
    expect(runtime.pokemonInitialTeamResolver).toBe(basePokemonInitialTeamResolver)
    expect(runtime.fieldBattleFormatResolver({ kind: 'wild' })).toEqual({
      engine: 'simple', sessionKind: 'wild',
    })
  })
})
