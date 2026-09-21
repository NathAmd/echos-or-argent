import { describe, expect, it } from 'vitest'
import {
  canHgssIntimidateTarget,
  isHgssGrounded,
  resetHgssBadPoisonCounter,
  resolveHgssBattleForm,
  doesHgssAnticipationTrigger,
  resolveHgssDownloadStat,
  resolveHgssEntryHazards,
  resolveHgssEntryWeather,
  resolveHgssForewarnMove,
  resolveHgssFriskItem,
  resolveHgssToxicSpikes,
} from './hgssBattleEntryRules'

describe('règles d’entrée en combat HGSS', () => {
  it('reproduit les formes natives de Morphéo, Ceriflor et Multitype', () => {
    expect(resolveHgssBattleForm({ speciesId: 351, abilityId: 59, weather: 'sun' })).toEqual({ form: 1, types: [10, 10] })
    expect(resolveHgssBattleForm({ speciesId: 351, abilityId: 59, weather: 'sandstorm' })).toEqual({ form: 0, types: [0, 0] })
    expect(resolveHgssBattleForm({ speciesId: 351, abilityId: 0, weather: 'rain' })).toBeUndefined()
    expect(resolveHgssBattleForm({ speciesId: 421, abilityId: 122, weather: 'sun' })).toEqual({ form: 1 })
    expect(resolveHgssBattleForm({ speciesId: 421, abilityId: 0, weather: 'rain' })).toEqual({ form: 0 })
    expect(resolveHgssBattleForm({ speciesId: 493, abilityId: 121, weather: 'clear', heldItemEffect: 126 })).toEqual({ form: 10, types: [10, 10] })
  })

  it('reproduit Anticipation, Prédiction et Fouille depuis les tables natives', () => {
    expect(doesHgssAnticipationTrigger(20, [{ level: 20, moves: [{ moveId: 33, effect: 0, power: 40, typeMultiplier: 20 }] }])).toBe(true)
    expect(doesHgssAnticipationTrigger(20, [{ level: 20, moves: [{ moveId: 69, effect: 41, power: 1, typeMultiplier: 20 }] }])).toBe(false)
    expect(doesHgssAnticipationTrigger(20, [{ level: 19, moves: [{ moveId: 12, effect: 38, power: 1, typeMultiplier: 10 }] }])).toBe(false)
    const rng = { getSeed: () => 0, nextU16: () => 1 }
    expect(resolveHgssForewarnMove([{ currentHp: 1, moves: [{ moveId: 12, effect: 38, power: 1 }, { moveId: 33, effect: 0, power: 40 }] }], rng)).toBe(12)
    expect(resolveHgssFriskItem([10, 20], rng)).toBe(20)
  })

  it('partage les quatre météos permanentes de talent', () => {
    expect([2, 45, 70, 117].map(resolveHgssEntryWeather)).toEqual(['rain', 'sandstorm', 'sun', 'hail'])
  })

  it('résout le sol, les pièges et le compteur Toxic sans état persistant parasite', () => {
    expect(isHgssGrounded([2, 0], 26, false)).toBe(false)
    expect(isHgssGrounded([2, 0], 26, true)).toBe(true)
    expect(resetHgssBadPoisonCounter(0x80 | 0xe00)).toBe(0x180)
    expect(resolveHgssEntryHazards({ maxHp: 120, types: [0, 0], abilityId: 0, grounded: true, spikesLayers: 3, stealthRock: true, rockTypeMultiplier: 20 }))
      .toEqual([{ kind: 'spikes', damage: 30 }, { kind: 'stealthRock', damage: 30 }])
    expect(resolveHgssEntryHazards({ maxHp: 120, types: [0, 0], abilityId: 98, grounded: true, spikesLayers: 3, stealthRock: true, rockTypeMultiplier: 20 })).toEqual([])
  })

  it('fait absorber les Pics Toxik et respecte Immunité, Garde Magik et Rune Protect', () => {
    const base = { types: [0, 0] as const, abilityId: 0, grounded: true, layers: 2, currentStatus: 0, safeguarded: false }
    expect(resolveHgssToxicSpikes(base)).toBe('badPoison')
    expect(resolveHgssToxicSpikes({ ...base, types: [3, 0] })).toBe('absorb')
    expect(resolveHgssToxicSpikes({ ...base, abilityId: 17 })).toBeUndefined()
    expect(resolveHgssToxicSpikes({ ...base, abilityId: 98 })).toBeUndefined()
    expect(resolveHgssToxicSpikes({ ...base, abilityId: 102, weather: 'sun' })).toBeUndefined()
    expect(resolveHgssToxicSpikes({ ...base, abilityId: 102, weather: 'clear' })).toBe('badPoison')
    expect(resolveHgssToxicSpikes({ ...base, safeguarded: true })).toBeUndefined()
  })

  it('applique Intimidation et Télécharge avec les règles doubles de la génération IV', () => {
    expect(canHgssIntimidateTarget({ abilityId: 0 })).toBe(true)
    expect(canHgssIntimidateTarget({ abilityId: 52 })).toBe(false)
    expect(canHgssIntimidateTarget({ abilityId: 0, substituteHp: 1 })).toBe(false)
    expect(resolveHgssDownloadStat([{ defense: 90, specialDefense: 80 }, { defense: 70, specialDefense: 60 }])).toBe('specialAttack')
    expect(resolveHgssDownloadStat([{ defense: 60, specialDefense: 90 }, { defense: 70, specialDefense: 100 }])).toBe('attack')
    expect(resolveHgssDownloadStat([{ defense: 200, specialDefense: 1, substituteHp: 1 }])).toBeUndefined()
  })
})
