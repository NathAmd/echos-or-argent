import { describe, expect, it, vi } from 'vitest'
import type { CanonicalPokemon } from './canonicalPokemon'
import { createPokemonParty } from './pokemonParty'
import { createPokemonStorage } from './pokemonStorage'
import { releasePokemonStorage, transferPokemonHeldItem, transferPokemonStorage } from './pokemonStorageTransfer'
import type { PokemonTeamPolicy } from './pokemonTeamPolicy'

function pokemon(speciesId: number, currentHp = 20, isEgg = false): CanonicalPokemon {
  return {
    instanceId: `pkm:v1:r:${speciesId.toString(16).padStart(32, '0')}` as CanonicalPokemon['instanceId'],
    speciesId, speciesName: `ESPECE ${speciesId}`, form: 0, personality: speciesId,
    originalTrainer: { id: 1, name: 'JO', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 126, metLevel: 5, metTerrain: 12 },
    level: 5, experience: 125,
    individualValues: { hp: 0, attack: 0, defense: 0, speed: 0, specialAttack: 0, specialDefense: 0 },
    effortValues: { hp: 0, attack: 0, defense: 0, speed: 0, specialAttack: 0, specialDefense: 0 },
    nature: 0, gender: 'male', abilityId: 1, shiny: false, friendship: 70, moves: [],
    stats: { hp: 20, attack: 10, defense: 10, speed: 10, specialAttack: 10, specialDefense: 10 },
    currentHp, status: 0, heldItemId: 0, ballId: 4, isEgg, fatefulEncounter: false, shinyLeafMask: 0, ribbonIds: [],
  }
}

describe('transferts atomiques des Boîtes PC', () => {
  it('retire, dépose et échange sans muter les sources', () => {
    const party = createPokemonParty([pokemon(152), pokemon(155)])
    const storage = createPokemonStorage([[pokemon(158)]])
    const withdrawal = transferPokemonStorage(party, storage, { kind: 'box', box: 0, slot: 0 }, { kind: 'party', slot: 2 })
    expect(withdrawal.kind).toBe('transferred')
    if (withdrawal.kind !== 'transferred') return
    expect(withdrawal.party.members.map(({ speciesId }) => speciesId)).toEqual([152, 155, 158])
    expect(storage.boxes[0]![0]?.speciesId).toBe(158)

    const exchange = transferPokemonStorage(withdrawal.party, createPokemonStorage([[pokemon(25)]]), { kind: 'party', slot: 1 }, { kind: 'box', box: 0, slot: 0 })
    expect(exchange.kind === 'transferred' && exchange.party.members[1]?.speciesId).toBe(25)
    expect(exchange.kind === 'transferred' && exchange.storage.boxes[0]![0]?.speciesId).toBe(155)
  })

  it('refuse atomiquement de déposer le dernier Pokémon utilisable', () => {
    const party = createPokemonParty([pokemon(152), pokemon(155, 0), pokemon(175, 20, true)])
    const storage = createPokemonStorage()
    const vetoPartyMutation = vi.fn(() => ({ code: 'locked', reason: 'Équipe verrouillée.' }))
    const result = transferPokemonStorage(
      party,
      storage,
      { kind: 'party', slot: 0 },
      { kind: 'box', box: 0, slot: 0 },
      { vetoBattleEligibility: () => undefined, vetoPartyMutation },
    )
    expect(result).toMatchObject({ kind: 'blocked' })
    expect(vetoPartyMutation).not.toHaveBeenCalled()
    expect(party.members.map(({ speciesId }) => speciesId)).toEqual([152, 155, 175])
    expect(storage.boxes[0]![0]).toBeUndefined()
  })

  it('publie un veto PC explicite après validation de la transaction candidate', () => {
    const party = createPokemonParty([pokemon(152), pokemon(155)])
    const storage = createPokemonStorage()
    const before = JSON.stringify({ party, storage })
    const intents: Parameters<PokemonTeamPolicy['vetoPartyMutation']>[0][] = []
    const policy: PokemonTeamPolicy = {
      vetoBattleEligibility: () => undefined,
      vetoPartyMutation: (intent) => {
        intents.push(intent)
        return { code: 'pc-locked', reason: 'Le PC est verrouillé.' }
      },
    }

    expect(transferPokemonStorage(
      party,
      storage,
      { kind: 'party', slot: 0 },
      { kind: 'box', box: 0, slot: 0 },
      policy,
    )).toEqual({ kind: 'blocked', code: 'pc-locked', reason: 'Le PC est verrouillé.' })
    expect(intents).toHaveLength(1)
    expect(intents[0]).toMatchObject({ reason: 'pc' })
    expect(intents[0]?.before.map(({ speciesId }) => speciesId)).toEqual([152, 155])
    expect(intents[0]?.after.map(({ speciesId }) => speciesId)).toEqual([155])
    expect(JSON.stringify({ party, storage })).toBe(before)
  })

  it('distingue un réordonnancement interne de l’équipe des transferts PC', () => {
    const party = createPokemonParty([pokemon(152), pokemon(155)])
    const reasons: string[] = []
    const policy: PokemonTeamPolicy = {
      vetoBattleEligibility: () => undefined,
      vetoPartyMutation: (intent) => {
        reasons.push(intent.reason)
        return { code: 'order-locked', reason: 'Ordre verrouillé.' }
      },
    }

    expect(transferPokemonStorage(
      party,
      createPokemonStorage(),
      { kind: 'party', slot: 0 },
      { kind: 'party', slot: 1 },
      policy,
    )).toEqual({ kind: 'blocked', code: 'order-locked', reason: 'Ordre verrouillé.' })
    expect(reasons).toEqual(['reorder'])
    expect(party.members.map(({ speciesId }) => speciesId)).toEqual([152, 155])
  })

  it('échange uniquement les objets tenus dans le mode PC natif dédié', () => {
    const partyPokemon = pokemon(152)
    const boxedPokemon = pokemon(158)
    partyPokemon.heldItemId = 17
    boxedPokemon.heldItemId = 22
    const party = createPokemonParty([partyPokemon])
    const storage = createPokemonStorage([[boxedPokemon]])

    const result = transferPokemonHeldItem(party, storage, { kind: 'party', slot: 0 }, { kind: 'box', box: 0, slot: 0 })

    expect(result.kind).toBe('transferred')
    if (result.kind !== 'transferred') return
    expect(result.party.members[0]).toMatchObject({ speciesId: 152, heldItemId: 22 })
    expect(result.storage.boxes[0]?.[0]).toMatchObject({ speciesId: 158, heldItemId: 17 })
    expect(party.members[0]?.heldItemId).toBe(17)
    expect(storage.boxes[0]?.[0]?.heldItemId).toBe(22)
  })

  it('refuse de déplacer un objet vers une place vide', () => {
    const holder = pokemon(152)
    holder.heldItemId = 17
    expect(transferPokemonHeldItem(
      createPokemonParty([holder]),
      createPokemonStorage(),
      { kind: 'party', slot: 0 },
      { kind: 'box', box: 0, slot: 0 },
    )).toEqual({ kind: 'blocked', reason: 'Un objet doit être confié à un Pokémon.' })
  })
})

describe('libération atomique depuis les Boîtes PC', () => {
  it('libère un Pokémon de Boîte sans modifier les sources', () => {
    const party = createPokemonParty([pokemon(1)])
    const storage = createPokemonStorage([[pokemon(2)]])
    const result = releasePokemonStorage(party, storage, { kind: 'box', box: 0, slot: 0 })
    expect(result.kind).toBe('released')
    if (result.kind !== 'released') return
    expect(result.storage.boxes[0]?.[0]).toBeUndefined()
    expect(storage.boxes[0]?.[0]?.speciesId).toBe(2)
  })

  it('refuse de libérer le dernier Pokémon apte au combat', () => {
    const party = createPokemonParty([pokemon(1)])
    const result = releasePokemonStorage(party, createPokemonStorage(), { kind: 'party', slot: 0 })
    expect(result.kind).toBe('blocked')
  })

  it('peut refuser une libération d’équipe valide sans publier le clone candidat', () => {
    const party = createPokemonParty([pokemon(1), pokemon(2)])
    const storage = createPokemonStorage()
    const vetoPartyMutation = vi.fn(() => ({ code: 'release-locked', reason: 'Libération bloquée.' }))

    expect(releasePokemonStorage(
      party,
      storage,
      { kind: 'party', slot: 0 },
      { vetoBattleEligibility: () => undefined, vetoPartyMutation },
    )).toEqual({ kind: 'blocked', code: 'release-locked', reason: 'Libération bloquée.' })
    expect(vetoPartyMutation).toHaveBeenCalledWith(expect.objectContaining({ reason: 'pc' }))
    expect(party.members.map(({ speciesId }) => speciesId)).toEqual([1, 2])
    expect(storage.boxes[0]?.[0]).toBeUndefined()
  })
})
