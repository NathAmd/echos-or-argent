import { describe, expect, it } from 'vitest'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import type { PokemonMoveData } from '../../rom/pokemon/moveData'
import { resolveHgssPostHitAbilityEffects } from './hgssPostHitAbilityRules'

const pokemon = (overrides: Partial<CanonicalPokemon> = {}): CanonicalPokemon => ({
  speciesId: 1, speciesName: 'TEST', form: 0, personality: 0, originalTrainer: { id: 0, name: 'J', gender: 'male' }, origin: { language: 3, gameVersion: 7, metLocation: 0, metLevel: 5, metTerrain: 0 }, level: 50, experience: 0,
  individualValues: { hp: 0, attack: 0, defense: 0, speed: 0, specialAttack: 0, specialDefense: 0 }, effortValues: { hp: 0, attack: 0, defense: 0, speed: 0, specialAttack: 0, specialDefense: 0 }, nature: 0, gender: 'male', abilityId: 0, shiny: false, friendship: 70, moves: [], stats: { hp: 100, attack: 50, defense: 50, speed: 50, specialAttack: 50, specialDefense: 50 }, currentHp: 100, status: 0, heldItemId: 0, ballId: 4, isEgg: false, fatefulEncounter: false, shinyLeafMask: 0, ribbonIds: [], ...overrides,
  instanceId: overrides.instanceId ?? 'pkm:v1:r:00000000000000000000000000000001' as CanonicalPokemon['instanceId'],
})
const move: PokemonMoveData = { moveId: 33, effect: 0, category: 0, power: 35, type: 0, accuracy: 100, pp: 35, effectChance: 0, range: 0, priority: 0, flags: 1, contestEffect: 0, contestType: 0, contestUnknown: 0 }
const input = (defenderAbilityId: number) => ({ attacker: pokemon(), defender: pokemon({ abilityId: defenderAbilityId }), attackerAbilityId: 0, defenderAbilityId, defenderTypes: [0, 0] as const, defenderAttackStage: 0, move, moveType: 0, dealtDamage: 10, substituteWasHit: false, critical: false, attackerInfatuated: false, dampActive: false, weather: 'clear' as const })

describe('réactions de talents HGSS après un coup', () => {
  it('résout globalement contact, statut, critique et changement de type', () => {
    expect(resolveHgssPostHitAbilityEffects(input(24), createHgssLcrng(1))).toEqual([{ kind: 'damageAttacker', abilityId: 24, divisor: 8 }])
    expect(resolveHgssPostHitAbilityEffects(input(9), { getSeed: () => 0, nextU16: () => 0 })).toEqual([{ kind: 'statusAttacker', abilityId: 9, status: 'paralysis' }])
    expect(resolveHgssPostHitAbilityEffects({ ...input(16), moveType: 10 }, createHgssLcrng(1))).toEqual([{ kind: 'changeDefenderType', abilityId: 16, type: 10 }])
    expect(resolveHgssPostHitAbilityEffects({ ...input(83), critical: true }, createHgssLcrng(1))).toEqual([{ kind: 'maximizeDefenderAttack', abilityId: 83 }])
  })

  it('respecte clone, Demi-Tour, Brise Moule, Garde Magik et Moiteur', () => {
    expect(resolveHgssPostHitAbilityEffects({ ...input(24), substituteWasHit: true }, createHgssLcrng(1))).toEqual([])
    expect(resolveHgssPostHitAbilityEffects({ ...input(24), attackerAbilityId: 104 }, createHgssLcrng(1))).toEqual([])
    expect(resolveHgssPostHitAbilityEffects({ ...input(24), attackerAbilityId: 98 }, createHgssLcrng(1))).toEqual([])
    expect(resolveHgssPostHitAbilityEffects({ ...input(106), defender: pokemon({ currentHp: 0 }), dampActive: true }, createHgssLcrng(1))).toEqual([])
    expect(resolveHgssPostHitAbilityEffects({ ...input(24), move: { ...move, effect: 228 } }, createHgssLcrng(1))).toEqual([])
  })
})
