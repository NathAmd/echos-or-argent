import { describe, expect, it } from 'vitest'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { deriveLegacyPokemonInstanceId } from '../pokemon/pokemonInstanceId'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import type { PokemonLevelPolicy } from '../pokemon/pokemonLevelPolicy'
import type { PokemonPartyHealingPolicy } from '../pokemon/pokemonPartyHealingPolicy'
import { basePokemonTeamPolicy } from '../pokemon/pokemonTeamPolicy'
import { createEeveeTeamRuntime, defaultEeveeTeamConfig } from '../newGamePlus/modules/eeveeTeamModule'
import { createMonotypeTeamRuntime } from '../newGamePlus/modules/monotypeModule'
import { decodeHgssItemData, hgssItemDataSize } from '../../rom/items/itemData'
import { useFieldItemOnParty, useFieldItemOnPokemon } from './useFieldItem'

function createPokemon(
  catalog = createPokemonTestCatalog(),
  speciesId = 152,
  level = 10,
  instancePath?: string,
) {
  return createCanonicalPokemon(catalog, {
    ...(instancePath ? { instanceId: deriveLegacyPokemonInstanceId('field-item-test', instancePath) } : {}),
    speciesId,
    level,
    rng: createHgssLcrng(1),
    personality: { kind: 'fixed', value: 1 },
    individualValues: { kind: 'fixed', value: 10 },
    originalTrainer: { id: 1, name: 'JO', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 1, metLevel: level, metTerrain: 1 },
    moveIds: [33, 45],
    ballId: 4,
  })
}

function createItem(itemId: number, configure: (payload: Uint8Array) => void) {
  const payload = new Uint8Array(hgssItemDataSize)
  payload[0x0c] = 1
  configure(payload)
  return decodeHgssItemData(payload, itemId, `OBJET ${itemId}`, 'Description')
}

function createEeveeTeamFixture() {
  const catalog = createPokemonTestCatalog(493)
  for (const { targetSpeciesId, typeId } of defaultEeveeTeamConfig.assignments) {
    catalog.personalData[targetSpeciesId] = { ...catalog.personalData[targetSpeciesId]!, types: [typeId, typeId] }
  }
  catalog.evolutions[133] = [
    { method: 7, parameter: 82, targetSpeciesId: 136 },
    { method: 7, parameter: 84, targetSpeciesId: 134 },
  ]
  const party = Array.from({ length: 6 }, (_, index) => createPokemon(catalog, 133, 10, `eevee-${index}`))
  const runtime = createEeveeTeamRuntime(catalog)
  runtime.bindInitialTeam(party)
  return { catalog, party, runtime }
}

describe('useFieldItemOnPokemon', () => {
  it('soigne les PV et ne consomme exactement qu’un exemplaire après effet', () => {
    const pokemon = createPokemon()
    pokemon.currentHp = 1
    const item = createItem(17, (payload) => {
      payload[0x13] = 0x04
      payload[0x1b] = 20
    })
    const inventory = new Map([[17, 2]])

    expect(useFieldItemOnPokemon(inventory, item, pokemon)).toMatchObject({
      kind: 'used', effect: { hpRestored: 20 }, remaining: 1,
    })
    expect(pokemon.currentHp).toBe(21)
    expect(inventory.get(17)).toBe(1)
  })

  it('refuse sans mutation un soin inutile', () => {
    const pokemon = createPokemon()
    const item = createItem(17, (payload) => {
      payload[0x13] = 0x04
      payload[0x1b] = 20
    })
    const inventory = new Map([[17, 1]])

    expect(useFieldItemOnPokemon(inventory, item, pokemon)).toMatchObject({ kind: 'no-effect' })
    expect(inventory.get(17)).toBe(1)
  })

  it('réanime à la moitié des PV et retire la dernière unité du Sac', () => {
    const pokemon = createPokemon()
    pokemon.currentHp = 0
    const item = createItem(28, (payload) => {
      payload[0x0f] = 0x01
      payload[0x13] = 0x04
      payload[0x1b] = 0xfe
    })
    const inventory = new Map([[28, 1]])

    expect(useFieldItemOnPokemon(inventory, item, pokemon)).toMatchObject({
      kind: 'used', effect: { revived: true, hpRestored: Math.floor(pokemon.stats.hp / 2) }, remaining: 0,
    })
    expect(inventory.has(28)).toBe(false)
  })

  it('laisse un Pokémon K.O. et ne consomme rien quand la politique refuse la réanimation', () => {
    const pokemon = createPokemon()
    pokemon.currentHp = 0
    const before = structuredClone(pokemon)
    const item = createItem(28, (payload) => {
      payload[0x0f] = 0x01
      payload[0x13] = 0x04
      payload[0x1b] = 0xfe
    })
    const inventory = new Map([[28, 1]])
    const contexts: unknown[] = []
    const healingPolicy: PokemonPartyHealingPolicy = {
      vetoFullHealRestoration: (context) => {
        contexts.push(context)
        return context.restoration === 'hp'
          ? { code: 'challenge.permanent-knockout', reason: 'Réanimation interdite.' }
          : undefined
      },
    }

    expect(useFieldItemOnPokemon(inventory, item, pokemon, undefined, {
      healingPolicy,
      partyIndex: 3,
    })).toEqual({ kind: 'no-effect', reason: 'Réanimation interdite.' })
    expect(pokemon).toEqual(before)
    expect(inventory.get(28)).toBe(1)
    expect(contexts).toEqual([expect.objectContaining({
      pokemon: expect.objectContaining({ instanceId: pokemon.instanceId }),
      partyIndex: 3,
      restoration: 'hp',
      source: 'field-item',
    })])
  })

  it('applique le niveau du Super Bonbon sans réanimer le Pokémon K.O. si les PV sont refusés', () => {
    const catalog = createPokemonTestCatalog()
    const pokemon = createPokemon()
    pokemon.currentHp = 0
    const item = createItem(50, (payload) => { payload[0x0f] = 0x04 })
    const inventory = new Map([[50, 1]])
    const healingPolicy: PokemonPartyHealingPolicy = {
      vetoFullHealRestoration: ({ restoration }) => restoration === 'hp'
        ? { code: 'challenge.permanent-knockout', reason: 'Réanimation interdite.' }
        : undefined,
    }

    expect(useFieldItemOnPokemon(inventory, item, pokemon, undefined, {
      pokemonCatalog: catalog,
      healingPolicy,
    })).toMatchObject({ kind: 'used', effect: { levelsGained: 1, revived: false }, remaining: 0 })
    expect(pokemon).toMatchObject({ level: 11, currentHp: 0 })
    expect(inventory.has(50)).toBe(false)
  })

  it('réanime transactionnellement tous les Pokémon K.O. avec l’objet d’Équipe ROM', () => {
    const first = createPokemon()
    const second = createPokemon()
    const healthy = createPokemon()
    first.currentHp = 0
    second.currentHp = 0
    const item = createItem(44, (payload) => {
      payload[0x0f] = 0x02
      payload[0x1b] = 0xff
    })
    const inventory = new Map([[44, 1]])

    expect(useFieldItemOnParty(inventory, item, [first, second, healthy])).toMatchObject({
      kind: 'used', effects: [{ partySlot: 0 }, { partySlot: 1 }], remaining: 0,
    })
    expect(first.currentHp).toBe(first.stats.hp)
    expect(second.currentHp).toBe(second.stats.hp)
    expect(healthy.currentHp).toBe(healthy.stats.hp)
    expect(inventory.has(44)).toBe(false)
  })

  it('ne consomme pas l’objet d’Équipe quand personne n’est K.O.', () => {
    const item = createItem(44, (payload) => {
      payload[0x0f] = 0x02
      payload[0x1b] = 0xff
    })
    const inventory = new Map([[44, 1]])

    expect(useFieldItemOnParty(inventory, item, [createPokemon()])).toMatchObject({ kind: 'no-effect' })
    expect(inventory.get(44)).toBe(1)
  })

  it('ne réanime ni ne consomme l’objet d’Équipe lorsque tous les K.O. sont refusés', () => {
    const first = createPokemon()
    const second = createPokemon()
    first.currentHp = 0
    second.currentHp = 0
    const before = [structuredClone(first), structuredClone(second)]
    const item = createItem(44, (payload) => {
      payload[0x0f] = 0x02
      payload[0x1b] = 0xff
    })
    const inventory = new Map([[44, 1]])
    const healingPolicy: PokemonPartyHealingPolicy = {
      vetoFullHealRestoration: ({ restoration }) => restoration === 'hp'
        ? { code: 'challenge.permanent-knockout', reason: 'Aucune réanimation.' }
        : undefined,
    }

    expect(useFieldItemOnParty(inventory, item, [first, second], { healingPolicy }))
      .toEqual({ kind: 'no-effect', reason: 'Aucune réanimation.' })
    expect([first, second]).toEqual(before)
    expect(inventory.get(44)).toBe(1)
  })

  it('retire les statuts HGSS concernés, y compris le compteur de poison grave', () => {
    const pokemon = createPokemon()
    pokemon.status = 0xf88
    const item = createItem(23, (payload) => { payload[0x0e] = 0x02 })
    const inventory = new Map([[23, 1]])

    expect(useFieldItemOnPokemon(inventory, item, pokemon)).toMatchObject({ kind: 'used', effect: { statusHealed: true } })
    expect(pokemon.status).toBe(0)
  })

  it('refuse transactionnellement une guérison de statut', () => {
    const pokemon = createPokemon()
    pokemon.status = 0xf88
    const item = createItem(23, (payload) => { payload[0x0e] = 0x02 })
    const inventory = new Map([[23, 1]])
    const healingPolicy: PokemonPartyHealingPolicy = {
      vetoFullHealRestoration: ({ restoration }) => restoration === 'status'
        ? { code: 'challenge.status-lock', reason: 'Statut verrouillé.' }
        : undefined,
    }

    expect(useFieldItemOnPokemon(inventory, item, pokemon, undefined, { healingPolicy }))
      .toEqual({ kind: 'no-effect', reason: 'Statut verrouillé.' })
    expect(pokemon.status).toBe(0xf88)
    expect(inventory.get(23)).toBe(1)
  })

  it('demande une capacité pour un Ether sans consommer ni appliquer un autre effet partiel', () => {
    const pokemon = createPokemon()
    pokemon.currentHp = 1
    pokemon.moves[0]!.pp = 0
    const item = createItem(40, (payload) => {
      payload[0x13] = 0x05
      payload[0x1b] = 20
      payload[0x1c] = 10
    })
    const inventory = new Map([[40, 1]])

    expect(useFieldItemOnPokemon(inventory, item, pokemon)).toMatchObject({ kind: 'move-required' })
    expect(pokemon.currentHp).toBe(1)
    expect(inventory.get(40)).toBe(1)
  })

  it('restaure tous les PP sans sélection de capacité', () => {
    const pokemon = createPokemon()
    pokemon.moves[0]!.pp = 0
    pokemon.moves[1]!.pp = 1
    const item = createItem(41, (payload) => {
      payload[0x13] = 0x02
      payload[0x1c] = 0x7f
    })
    const inventory = new Map([[41, 1]])

    expect(useFieldItemOnPokemon(inventory, item, pokemon)).toMatchObject({ kind: 'used' })
    expect(pokemon.moves.map(({ pp, maxPp }) => pp === maxPp)).toEqual([true, true])
  })

  it('refuse transactionnellement une restauration de PP', () => {
    const pokemon = createPokemon()
    pokemon.moves[0]!.pp = 0
    const before = structuredClone(pokemon.moves)
    const item = createItem(41, (payload) => {
      payload[0x13] = 0x02
      payload[0x1c] = 0x7f
    })
    const inventory = new Map([[41, 1]])
    const healingPolicy: PokemonPartyHealingPolicy = {
      vetoFullHealRestoration: ({ restoration }) => restoration === 'move-pp'
        ? { code: 'challenge.pp-lock', reason: 'PP verrouillés.' }
        : undefined,
    }

    expect(useFieldItemOnPokemon(inventory, item, pokemon, undefined, { healingPolicy }))
      .toEqual({ kind: 'no-effect', reason: 'PP verrouillés.' })
    expect(pokemon.moves).toEqual(before)
    expect(inventory.get(41)).toBe(1)
  })

  it('signale les effets complexes sans consommation', () => {
    const pokemon = createPokemon()
    const item = createItem(50, (payload) => { payload[0x0f] = 0x04 })
    const inventory = new Map([[50, 1]])

    expect(useFieldItemOnPokemon(inventory, item, pokemon)).toMatchObject({ kind: 'unsupported' })
    expect(inventory.get(50)).toBe(1)
  })

  it('consomme une pierre seulement si une évolution ROM correspond', () => {
    const catalog = createPokemonTestCatalog()
    catalog.evolutions[152] = [{ method: 7, parameter: 80, targetSpeciesId: 153 }]
    catalog.speciesNames[153] = 'MACRONIUM'
    const pokemon = createPokemon()
    const item = createItem(80, (payload) => { payload[0x0f] = 0x08 })
    const inventory = new Map([[80, 2]])

    expect(useFieldItemOnPokemon(inventory, item, pokemon, undefined, { pokemonCatalog: catalog })).toMatchObject({
      kind: 'used', effect: { evolvedFromSpeciesId: 152, evolvedToSpeciesId: 153 }, remaining: 1,
    })
    expect(pokemon.speciesId).toBe(153)
    expect(pokemon.speciesName).toBe('MACRONIUM')
    expect(inventory.get(80)).toBe(1)
  })

  it('peut differer la mutation jusqu au flash final de l ecran d evolution', () => {
    const catalog = createPokemonTestCatalog()
    catalog.evolutions[152] = [{ method: 7, parameter: 80, targetSpeciesId: 153 }]
    const pokemon = createPokemon()
    const item = createItem(80, (payload) => { payload[0x0f] = 0x08 })
    const inventory = new Map([[80, 1]])

    expect(useFieldItemOnPokemon(inventory, item, pokemon, undefined, {
      pokemonCatalog: catalog,
      deferEvolution: true,
    })).toMatchObject({ kind: 'used', effect: { evolvedToSpeciesId: 153 }, remaining: 0 })
    expect(pokemon.speciesId).toBe(152)
    expect(inventory.has(80)).toBe(false)
  })

  it('refuse la Pierre Feu sur l Évoli affecté à Aquali avant mutation ou consommation', () => {
    const { catalog, party, runtime } = createEeveeTeamFixture()
    const before = structuredClone(party)
    const fireStone = createItem(82, (payload) => { payload[0x0f] = 0x08 })
    const inventory = new Map([[82, 1]])

    expect(useFieldItemOnPokemon(inventory, fireStone, party[0]!, undefined, {
      pokemonCatalog: catalog, party, partyIndex: 0, teamPolicy: runtime.teamPolicy, deferEvolution: true,
    })).toEqual({
      kind: 'blocked',
      code: 'eevee-team-evolution-locked',
      reason: 'Cet Évoli ne peut évoluer que vers l’évolution et le type qui lui sont affectés.',
    })
    expect(party).toEqual(before)
    expect(inventory.get(82)).toBe(1)
  })

  it('autorise et applique la Pierre Eau sur l Évoli affecté à Aquali', () => {
    const { catalog, party, runtime } = createEeveeTeamFixture()
    const waterStone = createItem(84, (payload) => { payload[0x0f] = 0x08 })
    const inventory = new Map([[84, 1]])

    expect(useFieldItemOnPokemon(inventory, waterStone, party[0]!, undefined, {
      pokemonCatalog: catalog, party, partyIndex: 0, teamPolicy: runtime.teamPolicy,
    })).toMatchObject({ kind: 'used', effect: { evolvedToSpeciesId: 134 }, remaining: 0 })
    expect(party[0]!.speciesId).toBe(134)
    expect(inventory.has(84)).toBe(false)
  })

  it('refuse un Super Bonbon si l évolution ferait perdre le type Monotype', () => {
    const catalog = createPokemonTestCatalog(200)
    catalog.personalData[152] = { ...catalog.personalData[152]!, types: [12, 12] }
    catalog.personalData[153] = { ...catalog.personalData[153]!, types: [10, 10] }
    catalog.evolutions[152] = [{ method: 4, parameter: 11, targetSpeciesId: 153 }]
    const pokemon = createPokemon(catalog, 152, 10, 'monotype-candy')
    const party = [pokemon]
    const before = structuredClone(pokemon)
    const rareCandy = createItem(50, (payload) => { payload[0x0f] = 0x04 })
    const inventory = new Map([[50, 1]])
    const runtime = createMonotypeTeamRuntime(catalog, { typeId: 12 })

    expect(useFieldItemOnPokemon(inventory, rareCandy, pokemon, undefined, {
      pokemonCatalog: catalog, party, partyIndex: 0, teamPolicy: runtime.teamPolicy, deferEvolution: true,
    })).toEqual({
      kind: 'blocked', code: 'monotype-species-type',
      reason: 'L’espèce 153 ne possède pas le type Monotype 12.',
    })
    expect(pokemon).toEqual(before)
    expect(inventory.get(50)).toBe(1)
  })

  it('conserve le comportement natif avec la politique neutre', () => {
    const { catalog } = createEeveeTeamFixture()
    const pokemon = createPokemon(catalog, 133, 10, 'neutral-eevee')
    const fireStone = createItem(82, (payload) => { payload[0x0f] = 0x08 })
    const inventory = new Map([[82, 1]])

    expect(useFieldItemOnPokemon(inventory, fireStone, pokemon, undefined, {
      pokemonCatalog: catalog, party: [pokemon], partyIndex: 0, teamPolicy: basePokemonTeamPolicy,
    })).toMatchObject({ kind: 'used', effect: { evolvedToSpeciesId: 136 }, remaining: 0 })
    expect(pokemon.speciesId).toBe(136)
    expect(inventory.has(82)).toBe(false)
  })

  it('declenche aussi la verification de niveau apres un Super Bonbon', () => {
    const catalog = createPokemonTestCatalog()
    catalog.evolutions[152] = [{ method: 4, parameter: 11, targetSpeciesId: 153 }]
    const pokemon = createPokemon()
    const item = createItem(50, (payload) => { payload[0x0f] = 0x04 })
    const inventory = new Map([[50, 1]])

    expect(useFieldItemOnPokemon(inventory, item, pokemon, undefined, {
      pokemonCatalog: catalog,
      timeOfDay: 1,
      party: [pokemon],
      deferEvolution: true,
    })).toMatchObject({
      kind: 'used',
      effect: { levelsGained: 1, evolvedToSpeciesId: 153, evolutionContext: 'level-up' },
    })
    expect(pokemon.level).toBe(11)
    expect(pokemon.speciesId).toBe(152)
  })

  it('applique le Super Bonbon avec la courbe d’expérience ROM et le gain de PV natif', () => {
    const catalog = createPokemonTestCatalog()
    const pokemon = createPokemon()
    const oldMaximumHp = pokemon.stats.hp
    const item = createItem(50, (payload) => { payload[0x0f] = 0x04 })
    const inventory = new Map([[50, 1]])

    expect(useFieldItemOnPokemon(inventory, item, pokemon, undefined, { pokemonCatalog: catalog })).toMatchObject({
      kind: 'used', effect: { levelsGained: 1 }, remaining: 0,
    })
    expect(pokemon.level).toBe(11)
    expect(pokemon.experience).toBe(11 ** 3)
    expect(pokemon.currentHp).toBe(oldMaximumHp + pokemon.stats.hp - oldMaximumHp)
  })

  it('consomme un Super Bonbon jusqu’au plafond exact puis refuse le suivant sans mutation', () => {
    const catalog = createPokemonTestCatalog()
    const pokemon = createPokemon()
    const item = createItem(50, (payload) => { payload[0x0f] = 0x04 })
    const inventory = new Map([[50, 2]])
    const levelPolicy: PokemonLevelPolicy = { resolveLevelCap: () => 11 }

    expect(useFieldItemOnPokemon(inventory, item, pokemon, undefined, {
      pokemonCatalog: catalog,
      levelPolicy,
    })).toMatchObject({ kind: 'used', effect: { levelsGained: 1 }, remaining: 1 })
    expect(pokemon).toMatchObject({ level: 11, experience: 11 ** 3 })

    const atCap = structuredClone(pokemon)
    expect(useFieldItemOnPokemon(inventory, item, pokemon, undefined, {
      pokemonCatalog: catalog,
      levelPolicy,
    })).toMatchObject({ kind: 'no-effect' })
    expect(pokemon).toEqual(atCap)
    expect(inventory.get(50)).toBe(1)
  })

  it('applique une seule fois le gain d’amitié encodé par le Super Bonbon avant l’évolution', () => {
    const catalog = createPokemonTestCatalog()
    const pokemon = createPokemon()
    pokemon.friendship = 219
    catalog.evolutions[152] = [{ method: 1, parameter: 220, targetSpeciesId: 153 }]
    const item = createItem(50, (payload) => {
      payload[0x0f] = 0x04
      payload[0x14] = 0x0e
      payload[0x1d] = 5
      payload[0x1e] = 3
      payload[0x1f] = 2
    })
    const inventory = new Map([[50, 1]])

    expect(useFieldItemOnPokemon(inventory, item, pokemon, undefined, {
      pokemonCatalog: catalog,
      currentLocationId: 2,
    })).toMatchObject({
      kind: 'used', effect: { friendshipChange: 2, evolvedToSpeciesId: 153 }, remaining: 0,
    })
    expect(pokemon.friendship).toBe(221)
    expect(pokemon.speciesId).toBe(153)
  })

  it('apprend la capacité du nouveau niveau avant de vérifier une évolution qui la requiert', () => {
    const catalog = createPokemonTestCatalog()
    catalog.levelUpLearnsets[152] = [{ level: 11, moveId: 44 }]
    catalog.evolutions[152] = [{ method: 20, parameter: 44, targetSpeciesId: 153 }]
    const pokemon = createPokemon()
    const item = createItem(50, (payload) => { payload[0x0f] = 0x04 })
    const inventory = new Map([[50, 1]])

    const result = useFieldItemOnPokemon(inventory, item, pokemon, undefined, {
      pokemonCatalog: catalog,
      timeOfDay: 1,
      party: [pokemon],
    })

    expect(result).toMatchObject({
      kind: 'used',
      effect: {
        learnedMoveIds: [44],
        skippedMoveIds: [],
        evolvedToSpeciesId: 153,
        evolutionMethod: 20,
      },
    })
    expect(pokemon.moves.some((move) => move.moveId === 44)).toBe(true)
    expect(pokemon.speciesId).toBe(153)
  })

  it('retourne le choix de capacité différé du Super Bonbon sans supprimer un move existant', () => {
    const catalog = createPokemonTestCatalog()
    catalog.levelUpLearnsets[152] = [{ level: 11, moveId: 44 }]
    catalog.evolutions[152] = [{ method: 20, parameter: 44, targetSpeciesId: 153 }]
    const pokemon = createPokemon()
    pokemon.moves = [10, 33, 43, 45].map((moveId) => {
      const data = catalog.moves[moveId]!
      return { moveId, pp: data.pp, maxPp: data.pp, ppUps: 0, data }
    })
    const item = createItem(50, (payload) => { payload[0x0f] = 0x04 })
    const inventory = new Map([[50, 1]])

    const result = useFieldItemOnPokemon(inventory, item, pokemon, undefined, {
      pokemonCatalog: catalog,
      timeOfDay: 1,
      party: [pokemon],
    })

    expect(result).toMatchObject({
      kind: 'used',
      effect: { learnedMoveIds: [], skippedMoveIds: [44] },
    })
    if (result.kind === 'used') expect(result.effect.evolvedToSpeciesId).toBeUndefined()
    expect(pokemon.moves.map((move) => move.moveId)).toEqual([10, 33, 43, 45])
    expect(pokemon.speciesId).toBe(152)
  })

  it('reproduit la limite vitamine et le bonus d’amitié de lieu des baies', () => {
    const catalog = createPokemonTestCatalog()
    const pokemon = createPokemon()
    pokemon.effortValues.hp = 10
    pokemon.friendship = 70
    const item = createItem(149, (payload) => {
      payload[0x13] = 0x08
      payload[0x14] = 0x02
      payload[0x15] = 0xf6
      payload[0x1d] = 10
    })
    const inventory = new Map([[149, 1]])

    expect(useFieldItemOnPokemon(inventory, item, pokemon, undefined, {
      pokemonCatalog: catalog,
      currentLocationId: 1,
    })).toMatchObject({
      kind: 'used', effect: { effortValueChange: -10, friendshipChange: 11 }, remaining: 0,
    })
    expect(pokemon.effortValues.hp).toBe(0)
    expect(pokemon.friendship).toBe(81)
  })
})
