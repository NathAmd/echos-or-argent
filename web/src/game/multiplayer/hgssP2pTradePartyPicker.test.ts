import { describe, expect, it } from 'vitest'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { deriveLegacyPokemonInstanceId } from '../pokemon/pokemonInstanceId'
import { createHgssP2pTradePartyPickerEntries } from './hgssP2pTradePartyPicker'

function pokemon(index: number, overrides: Partial<CanonicalPokemon> = {}): CanonicalPokemon {
  return {
    instanceId: deriveLegacyPokemonInstanceId('trade-picker-test', String(index)),
    speciesId: 25,
    speciesName: 'Espèce locale',
    form: 0,
    personality: index,
    originalTrainer: { id: 1, name: 'Joueur', gender: 'male' },
    origin: { language: 2, gameVersion: 7, metLocation: 1, metLevel: 5, metTerrain: 1 },
    level: 12,
    experience: 1000,
    individualValues: { hp: 1, attack: 2, defense: 3, speed: 4, specialAttack: 5, specialDefense: 6 },
    effortValues: { hp: 0, attack: 0, defense: 0, speed: 0, specialAttack: 0, specialDefense: 0 },
    nature: 0,
    gender: 'male',
    abilityId: 1,
    shiny: false,
    friendship: 70,
    moves: [],
    stats: { hp: 40, attack: 30, defense: 20, speed: 35, specialAttack: 25, specialDefense: 22 },
    currentHp: 31,
    status: 0,
    heldItemId: 50,
    ballId: 4,
    isEgg: false,
    fatefulEncounter: false,
    shinyLeafMask: 0,
    ribbonIds: [],
    ...overrides,
  }
}

describe("sélection locale d'une offre d'échange P2P", () => {
  it('présente toutes les statistiques, le nom local et l’objet local sans fabriquer de payload réseau', () => {
    const first = pokemon(1, { nickname: 'Surnom joueur' })
    const [entry] = createHgssP2pTradePartyPickerEntries([first], first.instanceId, () => 'Objet local')
    expect(entry).toMatchObject({
      pokemonId: first.instanceId,
      primaryLabel: 'Surnom joueur',
      secondaryLabel: 'Espèce locale · Niv. 12',
      heldItemLabel: 'Objet local',
      current: true,
      reserved: false,
    })
    expect(entry?.statsLabel).toContain('PV 31/40')
    expect(entry?.statsLabel).toContain('Atq.Spé 25')
    expect(entry?.pokemon).toBe(first)
  })

  it('marque les identités réservées et conserve un fallback numérique strictement local', () => {
    const first = pokemon(1)
    const [entry] = createHgssP2pTradePartyPickerEntries([first], undefined, () => undefined, () => true)
    expect(entry).toMatchObject({ heldItemLabel: '#50', current: false, reserved: true })
  })
})
