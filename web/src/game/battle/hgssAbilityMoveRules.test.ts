import { describe, expect, it } from 'vitest'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { canHgssConfuse, canHgssInfatuate, isHgssHeldItemRemovalBlocked, isHgssMoveBlockedBySoundproof, resolveHgssDrain, resolveHgssLeechSeedDrain, resolveHgssPassiveRecovery, resolveHgssPressurePpCost, resolveHgssSwitchBlock, resolveHgssSynchronizeStatusChain } from './hgssAbilityMoveRules'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'

describe('interactions talent/capacité natives HGSS', () => {
  it('centralise Tempo Perso, Benêt et leur contournement par Brise Moule', () => {
    expect(canHgssConfuse(20)).toBe(false)
    expect(canHgssConfuse(20, false, true)).toBe(true)
    expect(canHgssInfatuate(12)).toBe(false)
  })
  it('fait protéger les objets par Glue sauf face à Brise Moule', () => {
    expect(isHgssHeldItemRemovalBlocked(60, 0, true)).toBe(true)
    expect(isHgssHeldItemRemovalBlocked(60, 104, true)).toBe(false)
    expect(isHgssHeldItemRemovalBlocked(60, 0, false)).toBe(false)
  })
  it('utilise exactement la table sonore de l’overlay 12 et respecte Brise Moule', () => {
    expect([45, 46, 47, 48, 103, 173, 253, 304, 319, 320, 405, 448].every((moveId) => isHgssMoveBlockedBySoundproof(moveId, 0, 43))).toBe(true)
    expect(isHgssMoveBlockedBySoundproof(195, 0, 43)).toBe(false) // Requiem possède son propre sous-script.
    expect(isHgssMoveBlockedBySoundproof(304, 104, 43)).toBe(false)
  })

  it('compte Pression selon la portée et le cas natif de Possessif', () => {
    const base = { moveId: 33, range: 0, targetIsAttacker: false, targetAbilityId: 46, opposingAbilityIds: [46, 46], otherAbilityIds: [0, 46, 46] }
    expect(resolveHgssPressurePpCost(base)).toBe(2)
    expect(resolveHgssPressurePpCost({ ...base, range: 1 << 2 })).toBe(3)
    expect(resolveHgssPressurePpCost({ ...base, range: 1 << 3 })).toBe(3)
    expect(resolveHgssPressurePpCost({ ...base, range: 1 << 4 })).toBe(1)
    expect(resolveHgssPressurePpCost({ ...base, moveId: 286, range: 1 << 4 })).toBe(3)
  })

  it('centralise Marque Ombre, Piège, Magnépiège et Carapace Mue', () => {
    const base = { selfAbilityId: 0, selfTypes: [0, 0] as const, heldItemEffect: 0, magnetRise: false, gravity: false, bound: false, ingrained: false, opposingAbilityIds: [] as number[] }
    expect(resolveHgssSwitchBlock({ ...base, opposingAbilityIds: [23] })).toMatchObject({ blocked: true, abilityId: 23 })
    expect(resolveHgssSwitchBlock({ ...base, selfAbilityId: 23, opposingAbilityIds: [23] })).toEqual({ blocked: false })
    expect(resolveHgssSwitchBlock({ ...base, selfTypes: [8, 8], opposingAbilityIds: [42] })).toMatchObject({ blocked: true, abilityId: 42 })
    expect(resolveHgssSwitchBlock({ ...base, selfTypes: [2, 2], opposingAbilityIds: [71] })).toEqual({ blocked: false })
    expect(resolveHgssSwitchBlock({ ...base, selfTypes: [2, 2], gravity: true, opposingAbilityIds: [71] })).toMatchObject({ blocked: true, abilityId: 71 })
    expect(resolveHgssSwitchBlock({ ...base, heldItemEffect: 123, bound: true, opposingAbilityIds: [23, 71] })).toEqual({ blocked: false })
  })

  it('résout le drain, Grosse Racine et Suintement dans l’ordre natif', () => {
    const base = { dealtDamage: 20, attackerCurrentHp: 40, attackerMaximumHp: 100, attackerAbilityId: 0, defenderAbilityId: 0, healBlocked: false }
    expect(resolveHgssDrain(base)).toEqual({ kind: 'heal', amount: 10 })
    expect(resolveHgssDrain({ ...base, leechBoostPercent: 30 })).toEqual({ kind: 'heal', amount: 13 })
    expect(resolveHgssDrain({ ...base, defenderAbilityId: 64, healBlocked: true })).toEqual({ kind: 'damage', amount: 10 })
    expect(resolveHgssDrain({ ...base, attackerAbilityId: 98, defenderAbilityId: 64 })).toEqual({ kind: 'blocked', amount: 0 })
    expect(resolveHgssDrain({ ...base, healBlocked: true })).toEqual({ kind: 'blocked', amount: 0 })
  })

  it('centralise Vampigraine, Racines et Anneau Hydro avec Grosse Racine et Suintement', () => {
    expect(resolveHgssLeechSeedDrain({ dealtDamage: 12, receiverCurrentHp: 10, receiverMaximumHp: 100, receiverAbilityId: 0, seededAbilityId: 0, healBlocked: false, leechBoostPercent: 30 })).toEqual({ kind: 'heal', amount: 15 })
    expect(resolveHgssLeechSeedDrain({ dealtDamage: 12, receiverCurrentHp: 20, receiverMaximumHp: 100, receiverAbilityId: 0, seededAbilityId: 64, healBlocked: false, leechBoostPercent: 30 })).toEqual({ kind: 'damage', amount: 15 })
    expect(resolveHgssLeechSeedDrain({ dealtDamage: 12, receiverCurrentHp: 20, receiverMaximumHp: 100, receiverAbilityId: 98, seededAbilityId: 64, healBlocked: false })).toEqual({ kind: 'blocked', amount: 0 })
    expect(resolveHgssPassiveRecovery({ baseAmount: 6, currentHp: 50, maximumHp: 100, healBlocked: false, leechBoostPercent: 30 })).toBe(7)
  })

  it('renvoie les trois statuts de Synchro sans boucle et dégrade le poison grave', () => {
    const source = { status: 0, abilityId: 0 } as CanonicalPokemon
    expect(resolveHgssSynchronizeStatusChain({ status: 'badPoison', applied: true }, 28, source, [0, 0], 0, createHgssLcrng(0)))
      .toEqual([{ recipient: 'target', status: 'badPoison', applied: true }, { recipient: 'source', status: 'poison', applied: true }])
    expect(source.status).toBe(0x8)
    expect(resolveHgssSynchronizeStatusChain({ status: 'freeze', applied: true }, 28, source, [0, 0], 0, createHgssLcrng(0))).toHaveLength(1)
    expect(resolveHgssSynchronizeStatusChain({ status: 'burn', applied: false }, 28, source, [0, 0], 0, createHgssLcrng(0))).toHaveLength(1)
  })
})
