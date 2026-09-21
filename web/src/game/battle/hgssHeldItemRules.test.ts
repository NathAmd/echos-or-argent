import { describe, expect, it } from 'vitest'
import { applyHgssHeldAccuracy, applyHgssHeldAttackStats, applyHgssHeldBattleStats, applyHgssHeldDamageBoost, doesHgssHeldItemFlinch, isHgssHeldSurvivalActive, resolveHgssHeldAutoUse, resolveHgssHeldCriticalStage, resolveHgssHeldEndTurn, resolveHgssHeldItemEffect, resolveHgssHeldOnHit, resolveHgssHeldPostDamage, resolveHgssMetronomeState } from './hgssHeldItemRules'
import { neutralBattleStatStages } from './hgssBattleRules'

describe('objets tenus HGSS partagés', () => {
  it('supprime tous les effets sous Maladresse et Embargo', () => {
    expect(resolveHgssHeldItemEffect({ holdEffect: 98, holdEffectParameter: 30, abilityId: 103, embargoTurns: 0 })).toEqual({ effect: 0, parameter: 0 })
    expect(resolveHgssHeldItemEffect({ holdEffect: 98, holdEffectParameter: 30, abilityId: 0, embargoTurns: 1 })).toEqual({ effect: 0, parameter: 0 })
  })

  it('partage les boosts, la survie, le soin et le contrecoup', () => {
    const stats = { hp: 100, attack: 100, defense: 100, speed: 100, specialAttack: 100, specialDefense: 100 }
    expect(applyHgssHeldAttackStats(stats, { effect: 55, parameter: 0 }, 0).attack).toBe(150)
    expect(applyHgssHeldDamageBoost(100, { effect: 98, parameter: 30 }, 0, 0, 10)).toBe(130)
    expect(isHgssHeldSurvivalActive({ effect: 103, parameter: 0 }, 100, 100, 99)).toBe(true)
    expect(resolveHgssHeldPostDamage({ held: { effect: 98, parameter: 30 }, dealtDamage: 50, currentHp: 90, maximumHp: 100, healBlocked: false })).toEqual({ kind: 'damage', amount: 10 })
    expect(resolveHgssHeldPostDamage({ held: { effect: 98, parameter: 30 }, dealtDamage: 50, currentHp: 90, maximumHp: 100, healBlocked: false, magicGuard: true })).toBeUndefined()
    expect(resolveHgssHeldEndTurn({ held: { effect: 69, parameter: 0 }, currentHp: 50, maximumHp: 100, poisonType: false, magicGuard: false, healBlocked: false })).toEqual({ kind: 'heal', amount: 6 })
  })

  it('centralise précision et effet de peur des objets tenus', () => {
    expect(applyHgssHeldAccuracy(80, { effect: 93, parameter: 10 }, { effect: 48, parameter: 10 })).toBe(79)
    expect(applyHgssHeldAccuracy(80, { effect: 104, parameter: 20 }, { effect: 0, parameter: 0 }, true)).toBe(96)
    expect(applyHgssHeldAccuracy(0, { effect: 93, parameter: 10 }, { effect: 48, parameter: 10 })).toBe(0)
    expect(doesHgssHeldItemFlinch({ effect: 56, parameter: 10 }, 1 << 5, 20, 0, 5)).toBe(true)
    expect(doesHgssHeldItemFlinch({ effect: 56, parameter: 10 }, 1 << 5, 20, 39, 5)).toBe(false)
  })

  it('reproduit les objets propres aux espèces depuis les branches natives', () => {
    const stats = { hp: 100, attack: 100, defense: 100, speed: 100, specialAttack: 100, specialDefense: 100 }
    expect(applyHgssHeldBattleStats(stats, { effect: 91, parameter: 0 }, 104, 'attacker').attack).toBe(200)
    expect(applyHgssHeldBattleStats(stats, { effect: 62, parameter: 0 }, 366, 'defender').specialDefense).toBe(200)
    expect(applyHgssHeldBattleStats(stats, { effect: 60, parameter: 0 }, 381, 'attacker', true).specialAttack).toBe(100)
    expect(applyHgssHeldDamageBoost(100, { effect: 71, parameter: 0 }, 13, 1, 10, { speciesId: 25 })).toBe(200)
    expect(applyHgssHeldDamageBoost(100, { effect: 2, parameter: 20 }, 14, 1, 10, { speciesId: 487 })).toBe(120)
    expect(resolveHgssHeldCriticalStage({ effect: 89, parameter: 0 }, 113)).toBe(2)
  })

  it('déclenche les baies à moitié PV ou au seuil Gloutonnerie sans table parallèle', () => {
    const base = { held: { effect: 13, parameter: 25 }, abilityId: 0, currentHp: 50, maximumHp: 100, status: 0, confusion: false, infatuated: false, stages: neutralBattleStatStages, hasEmptyPp: false }
    expect(resolveHgssHeldAutoUse(base)).toEqual({ consumedEffect: 10, parameter: 25 })
    expect(resolveHgssHeldAutoUse({ ...base, held: { effect: 36, parameter: 4 }, currentHp: 40, abilityId: 82 })).toEqual({ consumedEffect: 16, parameter: 4 })
    expect(resolveHgssHeldAutoUse({ ...base, held: { effect: 5, parameter: 0 }, status: 0x40 })).toEqual({ consumedEffect: 1, parameter: 0 })
  })

  it('centralise les réactions de l’objet du Pokémon touché', () => {
    const base = { damageCategory: 0, moveFlags: 1, moveEffect: 0, dealtDamage: 30, typeMultiplier: 20, substituteWasHit: false, attackerCurrentHp: 80, attackerMaximumHp: 80, attackerAbilityId: 0, attackerHasItem: false, targetCurrentHp: 40, targetMaximumHp: 100, targetHealBlocked: false }
    expect(resolveHgssHeldOnHit({ ...base, targetHeld: { effect: 43, parameter: 4 } })).toEqual({ kind: 'healTarget', amount: 25, consume: true })
    expect(resolveHgssHeldOnHit({ ...base, targetHeld: { effect: 46, parameter: 8 } })).toEqual({ kind: 'damageAttacker', amount: 10, consume: true })
    expect(resolveHgssHeldOnHit({ ...base, targetHeld: { effect: 116, parameter: 8 } })).toEqual({ kind: 'transferToAttacker', amount: 0, consume: false })
    expect(resolveHgssHeldOnHit({ ...base, targetHeld: { effect: 46, parameter: 8 }, attackerAbilityId: 98 })).toBeUndefined()
  })

  it('conserve le compteur volatile natif de Métronome sans gonfler les séquences verrouillées', () => {
    const held = { effect: 105, parameter: 10 }
    expect(resolveHgssMetronomeState(held, 33, 0, 0, false)).toEqual({ moveId: 33, turns: 0 })
    expect(resolveHgssMetronomeState(held, 33, 33, 0, false)).toEqual({ moveId: 33, turns: 1 })
    expect(resolveHgssMetronomeState(held, 33, 33, 4, true)).toEqual({ moveId: 33, turns: 4 })
    expect(applyHgssHeldDamageBoost(100, held, 0, 0, 10, { metronomeTurns: 4 })).toBe(140)
  })
})
