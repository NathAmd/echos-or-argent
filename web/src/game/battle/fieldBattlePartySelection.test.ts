import { describe, expect, it } from 'vitest'
import {
  getFirstUsableFieldBattlePartySlot,
  getUsableFieldBattlePartySlots,
} from './fieldBattlePartySelection'
import type { PokemonTeamPolicy } from '../pokemon/pokemonTeamPolicy'

describe('field battle party selection', () => {
  const party = [
    { instanceId: 'fainted', speciesId: 1, isEgg: false, currentHp: 0 },
    { instanceId: 'egg', speciesId: 2, isEgg: true, currentHp: 10 },
    { instanceId: 'first', speciesId: 3, isEgg: false, currentHp: 10 },
    { instanceId: 'second', speciesId: 4, isEgg: false, currentHp: 3 },
  ]

  it('keeps the indexes of living non-egg members in party order', () => {
    expect(getUsableFieldBattlePartySlots(party)).toEqual([2, 3])
  })

  it('preserves findIndex semantics when no member is usable', () => {
    expect(getFirstUsableFieldBattlePartySlot(party)).toBe(2)
    expect(getFirstUsableFieldBattlePartySlot(party.slice(0, 2))).toBe(-1)
  })

  it('applies an optional team policy without changing the native default', () => {
    const policy: PokemonTeamPolicy = {
      vetoBattleEligibility: ({ pokemon }) => pokemon.instanceId === 'first'
        ? { code: 'permadeath', reason: 'Ce Pokémon ne peut plus combattre.' }
        : undefined,
      vetoPartyMutation: () => undefined,
    }
    expect(getUsableFieldBattlePartySlots(party, { format: 'simple', phase: 'initial' }, policy)).toEqual([3])
    expect(getFirstUsableFieldBattlePartySlot(party, { format: 'simple', phase: 'initial' }, policy)).toBe(3)
    expect(getUsableFieldBattlePartySlots(party)).toEqual([2, 3])
  })
})
