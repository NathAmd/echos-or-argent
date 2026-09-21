import { describe, expect, it } from 'vitest'
import { cloneCanonicalPokemon, createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { basePokemonLevelPolicy, type PokemonLevelPolicy } from '../pokemon/pokemonLevelPolicy'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { applyDefeatedPokemonProgression } from './battleProgression'
import {
  applyDefeatedPokemonProgressionWithPolicy,
  baseBattleProgressionPolicy,
  composeBattleProgressionPolicies,
  type BattleProgressionPolicy,
  type DefeatedPokemonProgressionRequest,
} from './battleProgressionPolicy'

function pokemon(speciesId: number, level: number) {
  const catalog = createPokemonTestCatalog()
  return createCanonicalPokemon(catalog, {
    speciesId,
    level,
    rng: createHgssLcrng(speciesId),
    personality: { kind: 'fixed', value: speciesId },
    individualValues: { kind: 'fixed', value: 0 },
    originalTrainer: { id: 1, name: 'JO', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 0, metLevel: level, metTerrain: 0 },
    ballId: 4,
  })
}

describe('battle progression policy', () => {
  it('conserve exactement la progression HGSS avec la politique de base', () => {
    const catalog = createPokemonTestCatalog()
    const directPokemon = pokemon(152, 5)
    const policyPokemon = cloneCanonicalPokemon(directPokemon)
    const defeated = pokemon(155, 20)
    catalog.personalData[155]!.experienceYield = 98
    catalog.personalData[155]!.evYield.speed = 2

    const direct = applyDefeatedPokemonProgression(directPokemon, defeated, catalog, true, 2, {
      participated: true,
      participantCount: 2,
      currentLocationId: 7,
    })
    const throughPolicy = applyDefeatedPokemonProgressionWithPolicy({
      pokemon: policyPokemon,
      defeated,
      trainerBattle: true,
      experienceDivisor: 2,
      modifiers: { participated: true, participantCount: 2, currentLocationId: 7 },
    }, catalog, baseBattleProgressionPolicy, basePokemonLevelPolicy)

    expect(throughPolicy).toEqual(direct)
    expect(policyPokemon).toEqual(directPokemon)
  })

  it('compose les transformations dans leur ordre déclaré', () => {
    const calls: string[] = []
    const recipient = pokemon(152, 5)
    const defeated = pokemon(155, 5)
    const request: DefeatedPokemonProgressionRequest = {
      pokemon: recipient,
      defeated,
      trainerBattle: false,
    }
    const policies: BattleProgressionPolicy[] = [
      {
        transformDefeatedPokemonRequest(current) {
          calls.push('trainer')
          return { ...current, trainerBattle: true, experienceDivisor: 2 }
        },
      },
      {
        transformDefeatedPokemonRequest(current) {
          calls.push(`divisor:${current.experienceDivisor}`)
          return {
            ...current,
            experienceDivisor: (current.experienceDivisor ?? 1) + 1,
            modifiers: { ...current.modifiers, participantCount: current.experienceDivisor },
          }
        },
      },
    ]
    const composite = composeBattleProgressionPolicies(policies)
    policies.reverse()

    expect(composite.transformDefeatedPokemonRequest(request)).toMatchObject({
      trainerBattle: true,
      experienceDivisor: 3,
      modifiers: { participantCount: 2 },
    })
    expect(calls).toEqual(['trainer', 'divisor:2'])
  })

  it("permet à une politique d'écarter un bénéficiaire sans posséder le calcul d'EXP", () => {
    const catalog = createPokemonTestCatalog()
    const recipient = pokemon(152, 5)
    const defeated = pokemon(155, 20)
    const policy: BattleProgressionPolicy = {
      transformDefeatedPokemonRequest: (request) => ({
        ...request,
        modifiers: { ...request.modifiers, participated: false, hasExpShare: false },
      }),
    }

    const result = applyDefeatedPokemonProgressionWithPolicy({
      pokemon: recipient,
      defeated,
      trainerBattle: false,
    }, catalog, policy)

    expect(result).toEqual({ experienceGained: 0, levels: [] })
  })

  it("arrete exactement l'EXP et les niveaux au plafond de la source combat", () => {
    const catalog = createPokemonTestCatalog()
    const recipient = pokemon(152, 5)
    const defeated = pokemon(155, 100)
    const growth = catalog.growthTables[catalog.personalData[152]!.growthRate]!
    catalog.personalData[155]!.experienceYield = 1_000
    const levelPolicy: PokemonLevelPolicy = { resolveLevelCap: () => 6 }

    const result = applyDefeatedPokemonProgressionWithPolicy({
      pokemon: recipient,
      defeated,
      trainerBattle: true,
    }, catalog, baseBattleProgressionPolicy, levelPolicy)

    expect(result.experienceGained).toBe(growth.experienceByLevel[6]! - 5 ** 3)
    expect(result.levels.map(({ level }) => level)).toEqual([6])
    expect(recipient.level).toBe(6)
    expect(recipient.experience).toBe(growth.experienceByLevel[6])

    const atCap = applyDefeatedPokemonProgressionWithPolicy({
      pokemon: recipient,
      defeated,
      trainerBattle: true,
    }, catalog, baseBattleProgressionPolicy, levelPolicy)
    expect(atCap).toEqual({ experienceGained: 0, levels: [] })
    expect(recipient.experience).toBe(growth.experienceByLevel[6])
  })
})
