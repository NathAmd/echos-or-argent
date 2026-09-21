import { describe, expect, it } from 'vitest'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { shouldPresentBattleFaint } from './battleFaintPresentation'

const pokemon = (instanceId: string, hp: number, personality = 123, trainerId = 7) => ({
  instanceId: instanceId as CanonicalPokemon['instanceId'],
  personality,
  currentHp: hp,
  originalTrainer: { id: trainerId, name: 'JO', gender: 'male' as const },
})

describe('battle faint presentation', () => {
  it('presents the faint only while the defeated occupant is still present', () => {
    const defeated = pokemon('defeated', 0)
    expect(shouldPresentBattleFaint(defeated, pokemon('defeated', 0))).toBe(true)
    expect(shouldPresentBattleFaint(defeated, pokemon('defeated', 12))).toBe(false)
    expect(shouldPresentBattleFaint(defeated, pokemon('replacement', 0, 123, 7))).toBe(false)
    expect(shouldPresentBattleFaint(defeated, pokemon('replacement', 0, 456, 8))).toBe(false)
  })
})
