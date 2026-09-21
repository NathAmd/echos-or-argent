import { describe, expect, it, vi } from 'vitest'
import { createCanonicalPokemon } from './canonicalPokemon'
import { createHgssSessionRng } from './hgssSessionRng'
import { createPokemonParty } from './pokemonParty'
import { createPokemonStorage, hgssStorageBoxCapacity, hgssStorageBoxCount } from './pokemonStorage'
import { createPokemonTestCatalog } from './pokemonTestCatalog'
import type { PokemonTeamPolicy } from './pokemonTeamPolicy'
import {
  acquirePokemonIntoPartyOrStorage,
  findPokemonAcquisitionDestination,
  hasPokemonAcquisitionCapacity,
  hasPokemonAcquisitionCapacityFor,
} from './pokemonAcquisition'

const catalog = createPokemonTestCatalog()

function createPokemon(personality: number) {
  const rng = createHgssSessionRng(personality + 1)
  return createCanonicalPokemon(catalog, {
    speciesId: 155,
    level: 5,
    rng: rng.lc,
    personality: { kind: 'fixed', value: personality },
    individualValues: { kind: 'fixed', value: personality % 32 },
    originalTrainer: { id: 1, name: 'JO', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 126, metLevel: 5, metTerrain: 12 },
    ballId: 4,
  })
}

function storedPokemonCount(storage: ReturnType<typeof createPokemonStorage>): number {
  return storage.boxes.reduce((count, box) => count + box.filter(Boolean).length, 0)
}

describe('acquisition Pokémon commune équipe/PC', () => {
  it('remplit l’équipe puis toutes les Boîtes dans l’ordre sans perdre une capture', () => {
    const party = createPokemonParty()
    const storage = createPokemonStorage()
    const totalCapacity = 6 + hgssStorageBoxCount * hgssStorageBoxCapacity

    for (let index = 0; index < totalCapacity; index += 1) {
      const result = acquirePokemonIntoPartyOrStorage(party, storage, createPokemon(index + 1))
      expect(result.kind).toBe(index < 6 ? 'party' : 'storage')
      expect(party.members.length + storedPokemonCount(storage)).toBe(index + 1)
    }

    expect(party.members).toHaveLength(6)
    expect(storage.boxes.every((box) => box.every(Boolean))).toBe(true)
    expect(storage.boxes[0]![0]?.personality).toBe(7)
    expect(storage.boxes.at(-1)?.at(-1)?.personality).toBe(totalCapacity)
    expect(storage.currentBox).toBe(hgssStorageBoxCount - 1)
  })

  it('part de la Boîte active, boucle sur les autres et annonce exactement la destination', () => {
    const fullBox = Array.from({ length: hgssStorageBoxCapacity }, (_, index) => createPokemon(index + 1))
    const party = createPokemonParty(Array.from({ length: 6 }, (_, index) => createPokemon(index + 100)))
    const storage = createPokemonStorage([fullBox], 0)

    expect(findPokemonAcquisitionDestination(party, storage)).toEqual({ kind: 'storage', box: 1, slot: 0 })
    expect(acquirePokemonIntoPartyOrStorage(party, storage, createPokemon(999))).toEqual({
      kind: 'storage',
      placement: { previousBox: 0, box: 1, slot: 0 },
    })
    expect(storage.boxes[1]![0]?.personality).toBe(999)
  })

  it('ne modifie rien lorsque l’équipe et le PC sont pleins', () => {
    const pokemon = createPokemon(1)
    const party = createPokemonParty(Array.from({ length: 6 }, () => pokemon))
    const storage = createPokemonStorage(Array.from(
      { length: hgssStorageBoxCount },
      () => Array.from({ length: hgssStorageBoxCapacity }, () => pokemon),
    ))
    const before = JSON.stringify({ party, storage })

    expect(hasPokemonAcquisitionCapacity(party, storage)).toBe(false)
    expect(acquirePokemonIntoPartyOrStorage(party, storage, createPokemon(2))).toEqual({ kind: 'full' })
    expect(JSON.stringify({ party, storage })).toBe(before)
  })

  it('redirige atomiquement vers le PC lorsqu’une arrivée dans l’équipe est refusée', () => {
    const existing = createPokemon(1)
    const acquired = createPokemon(2)
    const party = createPokemonParty([existing])
    const storage = createPokemonStorage()
    const before = JSON.stringify({ party, storage })
    const intents: Parameters<PokemonTeamPolicy['vetoPartyMutation']>[0][] = []
    const policy: PokemonTeamPolicy = {
      vetoBattleEligibility: () => undefined,
      vetoPartyMutation: (intent) => {
        intents.push(intent)
        return { code: 'gift-locked', reason: 'Les cadeaux sont momentanément bloqués.' }
      },
    }

    expect(acquirePokemonIntoPartyOrStorage(
      party,
      storage,
      acquired,
      { reason: 'gift' },
      policy,
    )).toEqual({
      kind: 'storage',
      placement: { previousBox: 0, box: 0, slot: 0 },
      redirectedByPolicy: { code: 'gift-locked', reason: 'Les cadeaux sont momentanément bloqués.' },
    })
    expect(intents).toHaveLength(1)
    expect(intents[0]).toMatchObject({ reason: 'gift' })
    expect(intents[0]?.before.map(({ instanceId }) => instanceId)).toEqual([existing.instanceId])
    expect(intents[0]?.after.map(({ instanceId }) => instanceId)).toEqual([existing.instanceId, acquired.instanceId])
    expect(party.members.map(({ instanceId }) => instanceId)).toEqual([existing.instanceId])
    expect(storage.boxes[0]?.[0]?.instanceId).toBe(acquired.instanceId)
    expect(JSON.stringify({ party, storage })).not.toBe(before)
  })

  it('publie le veto avant toute mutation lorsque le PC ne peut pas servir de repli', () => {
    const existing = createPokemon(1)
    const acquired = createPokemon(2)
    const party = createPokemonParty([existing])
    const fullStorage = createPokemonStorage(Array.from(
      { length: hgssStorageBoxCount },
      () => Array.from({ length: hgssStorageBoxCapacity }, () => existing),
    ))
    const before = JSON.stringify({ party, fullStorage })
    const policy: PokemonTeamPolicy = {
      vetoBattleEligibility: () => undefined,
      vetoPartyMutation: () => ({ code: 'capture-locked', reason: 'Capture bloquée.' }),
    }

    expect(hasPokemonAcquisitionCapacityFor(party, fullStorage, acquired, {}, policy)).toBe(false)
    expect(acquirePokemonIntoPartyOrStorage(party, fullStorage, acquired, {}, policy)).toEqual({
      kind: 'blocked', code: 'capture-locked', reason: 'Capture bloquée.',
    })
    expect(JSON.stringify({ party, fullStorage })).toBe(before)
  })

  it('laisse les limites HGSS prioritaires et ne consulte pas la politique sans mutation d’équipe', () => {
    const pokemon = createPokemon(1)
    const party = createPokemonParty(Array.from({ length: 6 }, () => pokemon))
    const fullStorage = createPokemonStorage(Array.from(
      { length: hgssStorageBoxCount },
      () => Array.from({ length: hgssStorageBoxCapacity }, () => pokemon),
    ))
    const vetoPartyMutation = vi.fn(() => ({ code: 'locked', reason: 'Équipe verrouillée.' }))
    const policy: PokemonTeamPolicy = { vetoBattleEligibility: () => undefined, vetoPartyMutation }

    expect(acquirePokemonIntoPartyOrStorage(party, fullStorage, createPokemon(2), {}, policy)).toEqual({ kind: 'full' })
    expect(vetoPartyMutation).not.toHaveBeenCalled()

    const storage = createPokemonStorage()
    expect(acquirePokemonIntoPartyOrStorage(party, storage, createPokemon(3), {}, policy).kind).toBe('storage')
    expect(vetoPartyMutation).not.toHaveBeenCalled()
  })
})
