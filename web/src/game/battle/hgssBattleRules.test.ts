import { describe, expect, it } from 'vitest'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { applyHgssPrimaryStatus, applyHgssStatStage, applyHgssSteadfast, applySupportedHgssPrimaryStatus, applySupportedHgssStatusMoveEffect, calculateHgssEffectiveSpeed, calculateHgssMoveDamage, calculateHgssTypeMultiplier, compareHgssMoveOrder, doesHgssMoveHit, doesHgssSecondaryEffectOccur, isHgssPriorityItemActive, neutralBattleStatStages, resolveHgssHiddenPower, resolveHgssMovePower } from './hgssBattleRules'

const pokemon = (overrides: Partial<CanonicalPokemon> = {}): CanonicalPokemon => ({
  speciesId: 1, speciesName: 'TEST', form: 0, personality: 0,
  originalTrainer: { id: 0, name: 'J', gender: 'male' }, origin: { language: 3, gameVersion: 7, metLocation: 0, metLevel: 5, metTerrain: 0 },
  level: 5, experience: 0, individualValues: { hp: 0, attack: 0, defense: 0, speed: 0, specialAttack: 0, specialDefense: 0 },
  effortValues: { hp: 0, attack: 0, defense: 0, speed: 0, specialAttack: 0, specialDefense: 0 }, nature: 0, gender: 'male', abilityId: 0,
  shiny: false, friendship: 70, moves: [], stats: { hp: 20, attack: 11, defense: 10, speed: 10, specialAttack: 10, specialDefense: 10 },
  currentHp: 20, status: 0, heldItemId: 0, ballId: 4, isEgg: false, fatefulEncounter: false, shinyLeafMask: 0, ribbonIds: [],
  ...overrides,
  instanceId: overrides.instanceId ?? 'pkm:v1:r:00000000000000000000000000000001' as CanonicalPokemon['instanceId'],
})

describe('règles de combat HGSS confirmées', () => {
  it('applique la table de niveaux de statistiques Gen IV', () => {
    expect(applyHgssStatStage(100, 1)).toBe(150)
    expect(applyHgssStatStage(100, -1)).toBe(66)
    expect(applyHgssStatStage(100, -6)).toBe(25)
  })

  it('applique les deux types sans doubler un type identique', () => {
    expect(calculateHgssTypeMultiplier(10, [12, 8])).toBe(40)
    expect(calculateHgssTypeMultiplier(10, [12, 12])).toBe(20)
    expect(calculateHgssTypeMultiplier(13, [4, 4])).toBe(0)
  })

  it('reproduit l’ordre entier de CalcMoveDamage puis ApplyDamageRange', () => {
    const attacker = pokemon()
    const defender = pokemon()
    const rng = createHgssLcrng(0)
    const result = calculateHgssMoveDamage({
      attacker, defender, attackerTypes: [0, 0], defenderTypes: [0, 0],
      attackerStages: { ...neutralBattleStatStages }, defenderStages: { ...neutralBattleStatStages }, rng,
      move: { moveId: 33, effect: 0, category: 0, power: 35, type: 0, accuracy: 95, pp: 35, effectChance: 0, range: 0, priority: 0, flags: 0, contestEffect: 0, contestType: 0, contestUnknown: 0 },
    })
    expect(result.typeMultiplier).toBe(10)
    expect(result.damage).toBeGreaterThanOrEqual(6)
    expect(result.damage).toBeLessThanOrEqual(7)
  })

  it('ignore en critique les malus offensifs et bonus défensifs comme overlay 12', () => {
    const rngA = createHgssLcrng(8)
    const rngB = createHgssLcrng(8)
    const move = { moveId: 33, effect: 0, category: 0, power: 35, type: 0, accuracy: 95, pp: 35, effectChance: 0, range: 0, priority: 0, flags: 0, contestEffect: 0, contestType: 0, contestUnknown: 0 }
    const base = { attacker: pokemon(), defender: pokemon(), attackerTypes: [0, 0] as const, defenderTypes: [0, 0] as const, move, criticalMultiplier: 2 as const }
    const neutral = calculateHgssMoveDamage({ ...base, attackerStages: { ...neutralBattleStatStages }, defenderStages: { ...neutralBattleStatStages }, rng: rngA })
    const staged = calculateHgssMoveDamage({ ...base, attackerStages: { ...neutralBattleStatStages, attack: -3 }, defenderStages: { ...neutralBattleStatStages, defense: 4 }, rng: rngB })
    expect(staged.damage).toBe(neutral.damage)
  })

  it('applique les immunités de type et de talent aux statuts primaires', () => {
    const poisonMove = { moveId: 77, effect: 66, category: 2, power: 0, type: 3, accuracy: 75, pp: 35, effectChance: 0, range: 0, priority: 0, flags: 0, contestEffect: 0, contestType: 0, contestUnknown: 0 }
    const steel = pokemon()
    expect(applySupportedHgssPrimaryStatus(poisonMove, steel, [8, 8], createHgssLcrng(0))).toMatchObject({ applied: false })
    expect(steel.status).toBe(0)
    const immune = pokemon({ abilityId: 17 })
    expect(applySupportedHgssPrimaryStatus(poisonMove, immune, [0, 0], createHgssLcrng(0))).toMatchObject({ applied: false })
  })

  it('applique Feuille Garde uniquement sous le soleil actif et laisse Brise Moule l’ignorer', () => {
    const guarded = pokemon({ abilityId: 102 })
    expect(applyHgssPrimaryStatus('burn', guarded, [0, 0], createHgssLcrng(0), 102, { weather: 'sun' })).toMatchObject({ applied: false })
    expect(applyHgssPrimaryStatus('burn', guarded, [0, 0], createHgssLcrng(0), 102, { weather: 'clear' })).toMatchObject({ applied: true })
    guarded.status = 0
    const burnMove = { moveId: 261, effect: 167, category: 2, power: 0, type: 10, accuracy: 85, pp: 15, effectChance: 0, range: 0, priority: 0, flags: 0, contestEffect: 0, contestType: 0, contestUnknown: 0 }
    expect(applySupportedHgssPrimaryStatus(burnMove, guarded, [0, 0], createHgssLcrng(0), 102, 104, { weather: 'sun' })).toMatchObject({ applied: true })
  })

  it('centralise Sérénité et Écran Poudre pour tous les effets secondaires', () => {
    const rng = (value: number) => ({ getSeed: () => 0, nextU16: () => value })
    expect(doesHgssSecondaryEffectOccur(10, rng(15), 0, 0)).toBe(false)
    expect(doesHgssSecondaryEffectOccur(10, rng(15), 32, 0)).toBe(true)
    expect(doesHgssSecondaryEffectOccur(100, rng(0), 32, 19)).toBe(false)
  })

  it('centralise les modificateurs natifs de précision et esquive des talents', () => {
    const move = { moveId: 33, effect: 0, category: 0, power: 35, type: 0, accuracy: 80, pp: 35, effectChance: 0, range: 0, priority: 0, flags: 0, contestEffect: 0, contestType: 0, contestUnknown: 0 }
    const rng = (value: number) => ({ getSeed: () => 0, nextU16: () => value })
    expect(doesHgssMoveHit(move, neutralBattleStatStages, neutralBattleStatStages, rng(90))).toBe(false)
    expect(doesHgssMoveHit(move, neutralBattleStatStages, neutralBattleStatStages, rng(90), { attackerAbilityId: 14 })).toBe(true)
    expect(doesHgssMoveHit(move, neutralBattleStatStages, neutralBattleStatStages, rng(70), { attackerAbilityId: 55 })).toBe(false)
    expect(doesHgssMoveHit(move, neutralBattleStatStages, neutralBattleStatStages, rng(70), { targetAbilityId: 8, weather: 'sandstorm' })).toBe(false)
    expect(doesHgssMoveHit(move, neutralBattleStatStages, neutralBattleStatStages, rng(50), { targetAbilityId: 77, targetConfused: true })).toBe(false)
  })

  it('centralise l’ordre et la vitesse natifs avec météo, talents et objets', () => {
    const move = { moveId: 33, effect: 0, category: 0, power: 35, type: 0, accuracy: 100, pp: 35, effectChance: 0, range: 0, priority: 0, flags: 0, contestEffect: 0, contestType: 0, contestUnknown: 0 }
    const state = { pokemon: pokemon({ level: 50, stats: { ...pokemon().stats, speed: 100 } }), stages: { ...neutralBattleStatStages, speed: 1 }, move }
    expect(calculateHgssEffectiveSpeed({ ...state, abilityId: 86 })).toBe(200) // Simple double le cran +1.
    expect(calculateHgssEffectiveSpeed({ ...state, stages: neutralBattleStatStages, abilityId: 33, weather: 'rain' })).toBe(200)
    expect(calculateHgssEffectiveSpeed({ ...state, stages: neutralBattleStatStages, abilityId: 33, weather: 'rain', weatherSuppressed: true })).toBe(100)
    expect(calculateHgssEffectiveSpeed({ ...state, stages: neutralBattleStatStages, abilityId: 112, turnsActive: 4 })).toBe(50)
    expect(calculateHgssEffectiveSpeed({ ...state, pokemon: pokemon({ heldItemId: 0, stats: { ...pokemon().stats, speed: 100 } }), stages: neutralBattleStatStages, abilityId: 84, canUnburden: true })).toBe(200)
    const slow = { ...state, pokemon: pokemon({ stats: { ...pokemon().stats, speed: 50 } }) }
    expect(compareHgssMoveOrder({ ...state, abilityId: 100 }, slow, createHgssLcrng(1))).toBe(1)
    expect(compareHgssMoveOrder({ ...state, heldItemEffect: 107 }, slow, createHgssLcrng(1))).toBe(1)
    expect(compareHgssMoveOrder(state, slow, createHgssLcrng(1), true)).toBe(1)
  })

  it('donne la priorité native à Vive Griffe et Baie Chérim avant Distorsion', () => {
    const move = { moveId: 33, effect: 0, category: 0, power: 35, type: 0, accuracy: 100, pp: 35, effectChance: 0, range: 0, priority: 0, flags: 0, contestEffect: 0, contestType: 0, contestUnknown: 0 }
    const slow = { pokemon: pokemon({ stats: { ...pokemon().stats, speed: 10 } }), stages: neutralBattleStatStages, move, heldItemEffect: 52, heldItemParameter: 20, priorityItemRoll: 5 }
    const fast = { pokemon: pokemon({ stats: { ...pokemon().stats, speed: 100 } }), stages: neutralBattleStatStages, move }
    expect(isHgssPriorityItemActive(slow)).toBe(true)
    expect(compareHgssMoveOrder(slow, fast, createHgssLcrng(0), true)).toBe(-1)
    const custap = { ...slow, pokemon: pokemon({ currentHp: 5 }), heldItemEffect: 45, heldItemParameter: 4, priorityItemRoll: 1 }
    expect(isHgssPriorityItemActive(custap)).toBe(true)
    expect(isHgssPriorityItemActive({ ...custap, pokemon: pokemon({ currentHp: 8, abilityId: 82 }), abilityId: 82 })).toBe(true)
  })

  it('applique Impassible uniquement quand sa Vitesse peut encore monter', () => {
    const stages = { ...neutralBattleStatStages, speed: 5 }
    expect(applyHgssSteadfast(stages, 80)).toBe(true)
    expect(stages.speed).toBe(6)
    expect(applyHgssSteadfast(stages, 80)).toBe(false)
    expect(applyHgssSteadfast({ ...neutralBattleStatStages }, 0)).toBe(false)
  })

  it('conserve la brûlure réduite par Cran dans le calcul physique HGSS', () => {
    const move = { moveId: 33, effect: 0, category: 0, power: 35, type: 0, accuracy: 95, pp: 35, effectChance: 0, range: 0, priority: 0, flags: 0, contestEffect: 0, contestType: 0, contestUnknown: 0 }
    const base = { defender: pokemon(), attackerTypes: [0, 0] as const, defenderTypes: [0, 0] as const, attackerStages: { ...neutralBattleStatStages }, defenderStages: { ...neutralBattleStatStages }, move }
    const burned = calculateHgssMoveDamage({ ...base, attacker: pokemon({ status: 0x10 }), rng: createHgssLcrng(8) })
    const guts = calculateHgssMoveDamage({ ...base, attacker: pokemon({ status: 0x10, abilityId: 62 }), rng: createHgssLcrng(8) })
    expect(guts.damage).toBeGreaterThan(burned.damage)
  })

  it('réduit Attaque et Vitesse pendant les cinq tours natifs de Début Calme', () => {
    const move = { moveId: 33, effect: 0, category: 0, power: 35, type: 0, accuracy: 95, pp: 35, effectChance: 0, range: 0, priority: 0, flags: 0, contestEffect: 0, contestType: 0, contestUnknown: 0 }
    const attacker = pokemon({ abilityId: 112, stats: { ...pokemon().stats, attack: 120, speed: 120 } })
    const base = { attacker, defender: pokemon(), attackerTypes: [0, 0] as const, defenderTypes: [0, 0] as const, attackerStages: { ...neutralBattleStatStages }, defenderStages: { ...neutralBattleStatStages }, move }
    const slow = calculateHgssMoveDamage({ ...base, attackerTurnsActive: 0, rng: createHgssLcrng(8) }).damage
    const awake = calculateHgssMoveDamage({ ...base, attackerTurnsActive: 5, rng: createHgssLcrng(8) }).damage
    expect(slow).toBeLessThan(awake)
    expect(calculateHgssEffectiveSpeed({ pokemon: attacker, stages: neutralBattleStatStages, move, turnsActive: 0 })).toBe(60)
  })

  it('bloque les baisses de stats avec Corps Sain, Écran Fumée, Hyper Cutter et Regard Vif', () => {
    const stages = { ...neutralBattleStatStages }
    const attackDrop = { moveId: 1, effect: 18, category: 2, power: 0, type: 0, accuracy: 100, pp: 10, effectChance: 0, range: 0, priority: 0, flags: 0, contestEffect: 0, contestType: 0, contestUnknown: 0 }
    const accuracyDrop = { ...attackDrop, effect: 23 }
    expect(applySupportedHgssStatusMoveEffect(attackDrop, { ...stages }, { ...stages }, undefined, 0, 29)?.applied).toBe(false)
    expect(applySupportedHgssStatusMoveEffect(attackDrop, { ...stages }, { ...stages }, undefined, 0, 52)?.applied).toBe(false)
    expect(applySupportedHgssStatusMoveEffect(accuracyDrop, { ...stages }, { ...stages }, undefined, 0, 51)?.applied).toBe(false)
  })

  it('active Brasier à un tiers des PV et Adaptabilité sur le STAB', () => {
    const move = { moveId: 52, effect: 4, category: 1, power: 40, type: 10, accuracy: 100, pp: 25, effectChance: 10, range: 0, priority: 0, flags: 0, contestEffect: 0, contestType: 0, contestUnknown: 0 }
    const input = { defender: pokemon(), attackerTypes: [10, 10] as const, defenderTypes: [0, 0] as const, attackerStages: { ...neutralBattleStatStages }, defenderStages: { ...neutralBattleStatStages }, move }
    const normal = calculateHgssMoveDamage({ ...input, attacker: pokemon({ currentHp: 20 }), rng: createHgssLcrng(8) })
    const blaze = calculateHgssMoveDamage({ ...input, attacker: pokemon({ currentHp: 6, abilityId: 66 }), rng: createHgssLcrng(8) })
    const adaptability = calculateHgssMoveDamage({ ...input, attacker: pokemon({ abilityId: 91 }), rng: createHgssLcrng(8) })
    expect(blaze.damage).toBeGreaterThan(normal.damage)
    expect(adaptability.damage).toBeGreaterThan(normal.damage)
  })

  it('partage les modificateurs natifs de talents entre combats simple et double', () => {
    const move = { moveId: 8, effect: 5, category: 0, power: 75, type: 15, accuracy: 100, pp: 15, effectChance: 10, range: 0, priority: 0, flags: 0, contestEffect: 0, contestType: 0, contestUnknown: 0 }
    const base = { defender: pokemon({ gender: 'male' as const }), attackerTypes: [15, 15] as const, defenderTypes: [11, 11] as const, attackerStages: { ...neutralBattleStatStages, attack: 2 }, defenderStages: { ...neutralBattleStatStages, defense: 2 }, move }
    const attacker = (abilityId = 0) => pokemon({ gender: 'male', abilityId, level: 50, stats: { ...pokemon().stats, attack: 120 } })
    const damage = (subject: CanonicalPokemon, defender = base.defender) => calculateHgssMoveDamage({ ...base, attacker: subject, defender, rng: createHgssLcrng(12) }).damage
    const neutral = damage(attacker())
    expect(damage(attacker(79))).toBeGreaterThan(neutral)
    expect(damage(attacker(89))).toBeGreaterThan(neutral)
    expect(damage(attacker(86))).toBeGreaterThan(neutral)
    expect(damage(attacker(109))).toBeGreaterThan(neutral)
    expect(damage(attacker(110))).toBeGreaterThan(neutral)
    expect(calculateHgssMoveDamage({ ...base, attacker: attacker(120), move: { ...move, effect: 198 }, rng: createHgssLcrng(12) }).damage).toBeGreaterThan(neutral)
  })

  it('applique Normalise et Querelleur avant la table des types', () => {
    const move = { moveId: 33, effect: 0, category: 0, power: 35, type: 13, accuracy: 100, pp: 35, effectChance: 0, range: 0, priority: 0, flags: 0, contestEffect: 0, contestType: 0, contestUnknown: 0 }
    const base = { defender: pokemon(), attackerTypes: [13, 13] as const, defenderTypes: [7, 7] as const, attackerStages: { ...neutralBattleStatStages }, defenderStages: { ...neutralBattleStatStages }, move }
    expect(calculateHgssMoveDamage({ ...base, attacker: pokemon({ abilityId: 96 }), rng: createHgssLcrng(4) }).typeMultiplier).toBe(0)
    expect(calculateHgssMoveDamage({ ...base, attacker: pokemon({ abilityId: 113 }), move: { ...move, type: 0 }, rng: createHgssLcrng(4) }).typeMultiplier).toBe(10)
  })

  it('applique les modificateurs météo et partenaires lus dans CalcMoveDamage', () => {
    const special = { moveId: 52, effect: 4, category: 1, power: 80, type: 10, accuracy: 100, pp: 15, effectChance: 10, range: 0, priority: 0, flags: 0, contestEffect: 0, contestType: 0, contestUnknown: 0 }
    const physical = { ...special, category: 0 }
    const base = { defender: pokemon(), attackerTypes: [0, 0] as const, defenderTypes: [0, 0] as const, attackerStages: { ...neutralBattleStatStages }, defenderStages: { ...neutralBattleStatStages } }
    const damage = (move: typeof special, extra: Partial<Parameters<typeof calculateHgssMoveDamage>[0]> = {}) => calculateHgssMoveDamage({ ...base, attacker: pokemon(), move, rng: createHgssLcrng(8), ...extra }).damage
    const neutralSpecial = damage(special)
    expect(damage(special, { attacker: pokemon({ abilityId: 94 }), weather: 'sun' })).toBeGreaterThan(neutralSpecial)
    expect(damage(special, { attacker: pokemon({ abilityId: 57 }), attackerPlusMinusPartner: true })).toBeGreaterThan(neutralSpecial)
    expect(damage(special, { defenderTypes: [5, 5], weather: 'sandstorm' })).toBeLessThan(damage(special, { defenderTypes: [5, 5] }))
    expect(damage(physical, { weather: 'sun', attackerFlowerGiftActive: true })).toBeGreaterThan(damage(physical))
    expect(damage(special, { weather: 'sun', defenderFlowerGiftActive: true })).toBeLessThan(neutralSpecial)
  })

  it('lit le poids ROM en dixièmes de kilo pour Balayage et Nœud Herbe', () => {
    const move = { moveId: 67, effect: 196, category: 0, power: 1, type: 1, accuracy: 100, pp: 20, effectChance: 0, range: 0, priority: 0, flags: 0, contestEffect: 0, contestType: 0, contestUnknown: 0 }
    const input = { attacker: pokemon(), defender: pokemon(), attackerTypes: [0, 0] as const, defenderTypes: [0, 0] as const, attackerStages: { ...neutralBattleStatStages }, defenderStages: { ...neutralBattleStatStages }, move, rng: createHgssLcrng(1) }
    expect(resolveHgssMovePower({ ...input, defenderWeightTenthsKg: 99 })).toBe(20)
    expect(resolveHgssMovePower({ ...input, defenderWeightTenthsKg: 100 })).toBe(40)
    expect(resolveHgssMovePower({ ...input, defenderWeightTenthsKg: 2000 })).toBe(120)
  })

  it('dérive le type et la puissance de Puissance Cachée depuis les six IV Gen IV', () => {
    expect(resolveHgssHiddenPower({ hp: 0, attack: 0, defense: 0, speed: 0, specialAttack: 0, specialDefense: 0 })).toEqual({ type: 1, power: 30 })
    expect(resolveHgssHiddenPower({ hp: 31, attack: 31, defense: 31, speed: 31, specialAttack: 31, specialDefense: 31 })).toEqual({ type: 16, power: 70 })
  })
})
