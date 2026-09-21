import { describe, expect, it } from 'vitest'
import type { CanonicalPokemon } from './canonicalPokemon'
import type { HgssLcrng } from './hgssPokemonRng'
import { addPokemonPartyMember, advancePokemonPartyPokerusDays, applyHgssPostBattlePokerus, assertHgssFieldPartyInvariant, clonePokemonParty, createPokemonParty, getFirstUsablePokemonPartySlot, getPokemonPartyMember, getPokemonPartyPokeathlonModifiers, givePokemonPartyPokerusAtRandom, hasPokemonPartyPokerus, healPokemonParty, removePokemonPartyMember, reorderPokemonPartyMembers, replacePokemonParty, setPokemonPartyPokeathlonModifiers, spreadPokemonPartyPokerus, swapPokemonPartyMembers } from './pokemonParty'
import type { PokemonTeamPolicy } from './pokemonTeamPolicy'

function createPokemon(speciesId: number): CanonicalPokemon {
  return {
    instanceId: `pkm:v1:r:${speciesId.toString(16).padStart(32, '0')}` as CanonicalPokemon['instanceId'],
    speciesId,
    speciesName: `ESPECE ${speciesId}`,
    form: 0,
    personality: speciesId,
    originalTrainer: { id: 1, name: 'JO', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 126, metLevel: 5, metTerrain: 12 },
    level: 5,
    experience: 125,
    individualValues: { hp: 0, attack: 0, defense: 0, speed: 0, specialAttack: 0, specialDefense: 0 },
    effortValues: { hp: 0, attack: 0, defense: 0, speed: 0, specialAttack: 0, specialDefense: 0 },
    nature: 0,
    gender: 'male',
    abilityId: 1,
    shiny: false,
    friendship: 70,
    moves: [],
    stats: { hp: 20, attack: 10, defense: 10, speed: 10, specialAttack: 10, specialDefense: 10 },
    currentHp: 20,
    status: 0,
    heldItemId: 0,
    ballId: 4,
    isEgg: false,
    fatefulEncounter: false,
    shinyLeafMask: 0,
    ribbonIds: [],
  }
}

function sequenceRng(values: readonly number[]): HgssLcrng & { calls: () => number } {
  let index = 0
  return {
    getSeed: () => index,
    nextU16: () => values[index++] ?? 1,
    calls: () => index,
  }
}

describe('HGSS Pokemon party', () => {
  it('owns at most six deeply cloned members and replaces them atomically', () => {
    const original = createPokemon(152)
    const party = createPokemonParty([original])
    const clone = clonePokemonParty(party)

    original.originalTrainer.name = 'CHANGE'
    clone.members[0]!.currentHp = 1
    expect(getPokemonPartyMember(party, 0)).toMatchObject({ speciesId: 152, currentHp: 20, originalTrainer: { name: 'JO' } })

    replacePokemonParty(party, [createPokemon(155)])
    expect(party.members.map((pokemon) => pokemon.speciesId)).toEqual([155])
    expect(() => createPokemonParty(Array.from({ length: 7 }, (_, index) => createPokemon(index + 1)))).toThrow('plus de 6')
  })

  it('adds, removes, heals, and resolves the first usable member', () => {
    const fainted = createPokemon(152)
    fainted.currentHp = 0
    fainted.status = 4
    fainted.moves = [{ moveId: 33, pp: 1, maxPp: 35, ppUps: 0, data: {} as CanonicalPokemon['moves'][number]['data'] }]
    const active = createPokemon(155)
    active.currentHp = 3
    const party = createPokemonParty([fainted])

    expect(addPokemonPartyMember(party, active)).toBe(true)
    expect(getFirstUsablePokemonPartySlot(party)).toBe(1)
    healPokemonParty(party)
    expect(party.members[0]).toMatchObject({ currentHp: 20, status: 0, moves: [{ pp: 35 }] })
    expect(getFirstUsablePokemonPartySlot(party)).toBe(0)
    expect(removePokemonPartyMember(party, 0)?.speciesId).toBe(152)
    expect(party.members.map((pokemon) => pokemon.speciesId)).toEqual([155])

    while (party.members.length < 6) expect(addPokemonPartyMember(party, createPokemon(party.members.length + 200))).toBe(true)
    expect(addPokemonPartyMember(party, createPokemon(300))).toBe(false)
  })

  it("reproduit le test natif de l'octet Pokérus pour toute l'équipe", () => {
    const healthy = createPokemon(152)
    const contagious = createPokemon(155)
    const cured = createPokemon(158)
    contagious.pokerus = 0x23
    cured.pokerus = 0x20

    expect(hasPokemonPartyPokerus(createPokemonParty())).toBe(false)
    expect(hasPokemonPartyPokerus(createPokemonParty([healthy]))).toBe(false)
    expect(hasPokemonPartyPokerus(createPokemonParty([healthy, contagious]))).toBe(true)
    expect(hasPokemonPartyPokerus(createPokemonParty([healthy, cured]))).toBe(true)
  })

  it.each([
    [0x00, 1, 0x00],
    [0x20, 5, 0x20],
    [0x23, 1, 0x22],
    [0x23, 3, 0x20],
    [0x74, 2, 0x72],
    [0x01, 1, 0x10],
  ])('expire l’octet Pokérus natif %# vers %# aprè %i jour(s)', (before, elapsedDays, expected) => {
    const subject = createPokemon(152)
    subject.pokerus = before
    const party = createPokemonParty([subject])

    advancePokemonPartyPokerusDays(party, elapsedDays)

    expect(party.members[0]?.pokerus).toBe(expected)
  })

  it('valide les bornes de la mise à jour quotidienne Pokérus', () => {
    const subject = createPokemon(152)
    subject.pokerus = 0x100
    expect(() => advancePokemonPartyPokerusDays(createPokemonParty([subject]), 1)).toThrow('octet Pokérus')
    expect(() => advancePokemonPartyPokerusDays(createPokemonParty(), -1)).toThrow('nombre de jours Pokérus')
  })

  it.each([0x4000, 0x8000, 0xc000])('reproduit le tirage natif rare %# et ses rejets de slot/souche', (trigger) => {
    const egg = createPokemon(175)
    egg.isEgg = true
    const party = createPokemonParty([egg, createPokemon(152)])
    const rng = sequenceRng([trigger, 0, 1, 0x08, 0xa5])

    expect(givePokemonPartyPokerusAtRandom(party, rng)).toEqual({ partySlot: 1, pokerus: 0x52 })
    expect(party.members.map((pokemon) => pokemon.pokerus ?? 0)).toEqual([0, 0x52])
    expect(rng.calls()).toBe(5)
  })

  it('consomme un seul tirage sans déclencheur et ne réinfecte pas un slot guéri', () => {
    const healthy = createPokemon(152)
    const miss = sequenceRng([0x3fff])
    expect(givePokemonPartyPokerusAtRandom(createPokemonParty([healthy]), miss)).toBeUndefined()
    expect(miss.calls()).toBe(1)

    const cured = createPokemon(155)
    cured.pokerus = 0x20
    const immune = sequenceRng([0x4000, 0])
    expect(givePokemonPartyPokerusAtRandom(createPokemonParty([cured]), immune)).toBeUndefined()
    expect(immune.calls()).toBe(2)
  })

  it('échoue explicitement plutôt que boucler sur une équipe composée uniquement d’Œufs', () => {
    const egg = createPokemon(175)
    egg.isEgg = true
    expect(() => givePokemonPartyPokerusAtRandom(createPokemonParty([egg]), sequenceRng([0x4000])))
      .toThrow('sans Pokémon non-Œuf')
  })

  it('propage une souche contagieuse aux voisins naïfs, Œufs compris, sans chaîne artificielle', () => {
    const left = createPokemon(152)
    const contagious = createPokemon(155)
    const egg = createPokemon(175)
    const protectedMember = createPokemon(158)
    contagious.pokerus = 0x23
    egg.isEgg = true
    protectedMember.pokerus = 0x40
    const party = createPokemonParty([left, contagious, egg, protectedMember])

    expect(spreadPokemonPartyPokerus(party, sequenceRng([0]))).toEqual([0, 2])
    expect(party.members.map((pokemon) => pokemon.pokerus ?? 0)).toEqual([0x23, 0x23, 0x23, 0x40])
  })

  it('préserve exactement l’ordre LCRNG acquisition puis propagation après combat', () => {
    const party = createPokemonParty([createPokemon(152), createPokemon(155)])
    const rng = sequenceRng([0x4000, 0, 3, 0])

    expect(applyHgssPostBattlePokerus(party, rng)).toEqual({
      acquisition: { partySlot: 0, pokerus: 0x34 },
      spreadSlots: [1],
    })
    expect(party.members.map((pokemon) => pokemon.pokerus)).toEqual([0x34, 0x34])
    expect(rng.calls()).toBe(4)
  })

  it('treats a party without a living non-egg member as an invalid HGSS field state', () => {
    const fainted = createPokemon(152)
    fainted.currentHp = 0
    const egg = createPokemon(155)
    egg.isEgg = true

    expect(() => assertHgssFieldPartyInvariant(createPokemonParty([]))).toThrow('Invariant HGSS viole')
    expect(() => assertHgssFieldPartyInvariant(createPokemonParty([fainted, egg]))).toThrow('Invariant HGSS viole')
    expect(() => assertHgssFieldPartyInvariant(createPokemonParty([createPokemon(158)]))).not.toThrow()
  })

  it('réorganise les emplacements sans cloner ni perdre un membre', () => {
    const first = createPokemon(152)
    const second = createPokemon(155)
    const third = createPokemon(158)
    const party = createPokemonParty([first, second, third])
    const storedFirst = party.members[0]

    expect(swapPokemonPartyMembers(party, 0, 1)).toBe(true)
    expect(party.members.map(({ speciesId }) => speciesId)).toEqual([155, 152, 158])
    expect(party.members[1]).toBe(storedFirst)
    expect(swapPokemonPartyMembers(party, 1, 1)).toBe(false)
    expect(swapPokemonPartyMembers(party, -1, 0)).toBe(false)
    expect(swapPokemonPartyMembers(party, 0, 3)).toBe(false)
  })

  it('expose un résultat détaillé et atomique lorsque la politique refuse le nouvel ordre', () => {
    const party = createPokemonParty([createPokemon(152), createPokemon(155)])
    const storedFirst = party.members[0]
    const intents: Parameters<PokemonTeamPolicy['vetoPartyMutation']>[0][] = []
    const policy: PokemonTeamPolicy = {
      vetoBattleEligibility: () => undefined,
      vetoPartyMutation: (intent) => {
        intents.push(intent)
        return { code: 'order-locked', reason: 'Ordre verrouillé.' }
      },
    }

    expect(reorderPokemonPartyMembers(party, 0, 1, policy)).toEqual({
      kind: 'blocked',
      code: 'order-locked',
      reason: 'Ordre verrouillé.',
    })
    expect(intents).toHaveLength(1)
    expect(intents[0]).toMatchObject({ reason: 'reorder' })
    expect(intents[0]?.before.map(({ speciesId }) => speciesId)).toEqual([152, 155])
    expect(intents[0]?.after.map(({ speciesId }) => speciesId)).toEqual([155, 152])
    expect(party.members.map(({ speciesId }) => speciesId)).toEqual([152, 155])
    expect(party.members[0]).toBe(storedFirst)
  })

  it('garde la validation native prioritaire sur la politique de réordonnancement', () => {
    let policyCalls = 0
    const party = createPokemonParty([createPokemon(152), createPokemon(155)])
    const policy: PokemonTeamPolicy = {
      vetoBattleEligibility: () => undefined,
      vetoPartyMutation: () => { policyCalls += 1; return undefined },
    }

    expect(reorderPokemonPartyMembers(party, -1, 1, policy)).toEqual({
      kind: 'blocked',
      reason: 'Ce réordonnancement d’équipe est invalide.',
    })
    expect(policyCalls).toBe(0)
  })

  it('conserve PartyExtra par slot lors des copies, permutations et retraits', () => {
    const first = createPokemon(152)
    const second = createPokemon(155)
    const party = createPokemonParty([first, second])
    setPokemonPartyPokeathlonModifiers(party, 0, [1, -2, 3, -4, 5])
    setPokemonPartyPokeathlonModifiers(party, 1, [-5, 4, -3, 2, -1])

    const clone = clonePokemonParty(party)
    expect(getPokemonPartyPokeathlonModifiers(clone, 0)).toEqual([1, -2, 3, -4, 5])
    expect(swapPokemonPartyMembers(clone, 0, 1)).toBe(true)
    expect(getPokemonPartyPokeathlonModifiers(clone, 0)).toEqual([-5, 4, -3, 2, -1])
    removePokemonPartyMember(clone, 0)
    expect(getPokemonPartyPokeathlonModifiers(clone, 0)).toEqual([1, -2, 3, -4, 5])
    expect(addPokemonPartyMember(clone, createPokemon(158))).toBe(true)
    expect(getPokemonPartyPokeathlonModifiers(clone, 1)).toEqual([0, 0, 0, 0, 0])

    replacePokemonParty(party, [party.members[1]!, createPokemon(158)])
    expect(getPokemonPartyPokeathlonModifiers(party, 0)).toEqual([-5, 4, -3, 2, -1])
    expect(getPokemonPartyPokeathlonModifiers(party, 1)).toEqual([0, 0, 0, 0, 0])
  })
})
