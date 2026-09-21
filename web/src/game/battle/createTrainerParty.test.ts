import { describe, expect, it } from 'vitest'
import type { HgssTrainer } from '../../rom/battle/trainerData'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { createTrainerParty } from './createTrainerParty'
import { getTrainerClassGender } from './trainerClassGender'

const rival: HgssTrainer = {
  trainerId: 495,
  trainerType: 0,
  trainerClass: 23,
  partySize: 1,
  items: [0, 0, 0, 0],
  aiFlags: 0,
  doubleBattle: false,
  party: [{ difficulty: 200, genderOverride: 0, abilityOverride: 0, level: 5, speciesId: 152, form: 0, capsule: 9 }],
}

describe('native HGSS trainer party creation', () => {
  it('reproduces deterministic rival personality, IVs and non-shiny OT generation', () => {
    const [{ pokemon, capsule }] = createTrainerParty(rival, createPokemonTestCatalog(), { language: 3, gameVersion: 7 })

    expect(pokemon).toMatchObject({
      speciesId: 152,
      level: 5,
      personality: 0x00d02488,
      originalTrainer: { id: 0xc1dc1bbf, name: '' },
      individualValues: { hp: 24, attack: 24, defense: 24, speed: 24, specialAttack: 24, specialDefense: 24 },
      nature: 15,
      friendship: 255,
      ballId: 4,
      shiny: false,
    })
    expect(capsule).toBe(9)
  })

  it('uses the native global trainer-class gender table', () => {
    expect(getTrainerClassGender(23)).toBe('male')
    expect(getTrainerClassGender(25)).toBe('female')
    expect(getTrainerClassGender(89)).toBe('double')
    expect(() => getTrainerClassGender(128)).toThrow('classe de dresseur')
  })
})