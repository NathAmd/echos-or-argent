import { describe, expect, it } from 'vitest'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { decodeHgssItemData, hgssItemDataSize, hgssItemPocketLabels, type HgssItemCatalog, type HgssItemPocket } from '../../rom/items/itemData'
import { canGiveHeldItem, giveHeldItemToPokemon, hgssMailboxCapacity, returnHeldMailItemToBag, storeHeldMailInMailbox, takeHeldItemFromPokemon } from './heldItemTransfer'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'

function createItem(itemId: number, pocket: HgssItemPocket, holdEffect = 0) {
  const payload = new Uint8Array(hgssItemDataSize)
  new DataView(payload.buffer).setUint16(8, pocket << 7, true)
  payload[2] = holdEffect
  return decodeHgssItemData(payload, itemId, `OBJET ${itemId}`, 'Description')
}

function createCatalog(): HgssItemCatalog {
  const items = Array.from({ length: 537 }) as HgssItemCatalog['items']
  items[17] = createItem(17, 1)
  items[18] = createItem(18, 1)
  items[112] = createItem(112, 0)
  items[298] = createItem(298, 0, 126)
  items[92] = createItem(92, 5)
  items[137] = createItem(137, 5)
  items[328] = createItem(328, 3)
  items[450] = createItem(450, 7)
  return { items, pocketNames: hgssItemPocketLabels }
}

function createPokemon(heldItemId = 0): CanonicalPokemon {
  return { speciesId: 152, speciesName: 'GERMIGNON', heldItemId, isEgg: false } as CanonicalPokemon
}

describe('held item transfers', () => {
  it('donne un objet en consommant exactement un exemplaire', () => {
    const catalog = createCatalog()
    const inventory = new Map([[17, 2]])
    const pokemon = createPokemon()

    expect(giveHeldItemToPokemon(inventory, catalog, catalog.items[17]!, pokemon)).toEqual({ kind: 'given', previousItemId: 0 })
    expect(inventory.get(17)).toBe(1)
    expect(pokemon.heldItemId).toBe(17)
  })

  it('échange atomiquement l’objet tenu avec celui du Sac', () => {
    const catalog = createCatalog()
    const inventory = new Map([[17, 1]])
    const pokemon = createPokemon(18)

    expect(giveHeldItemToPokemon(inventory, catalog, catalog.items[17]!, pokemon)).toEqual({ kind: 'given', previousItemId: 18 })
    expect([...inventory]).toEqual([[18, 1]])
    expect(pokemon.heldItemId).toBe(17)
  })

  it('refuse un échange si l’ancien objet ne rentre pas dans sa poche', () => {
    const catalog = createCatalog()
    const inventory = new Map([[17, 1], [18, 999]])
    const pokemon = createPokemon(18)

    expect(giveHeldItemToPokemon(inventory, catalog, catalog.items[17]!, pokemon)).toMatchObject({ kind: 'bag-full' })
    expect(inventory.get(17)).toBe(1)
    expect(pokemon.heldItemId).toBe(18)
  })

  it('reprend un objet tenu dans le Sac', () => {
    const catalog = createCatalog()
    const inventory = new Map<number, number>()
    const pokemon = createPokemon(17)

    expect(takeHeldItemFromPokemon(inventory, catalog, pokemon)).toEqual({ kind: 'taken', itemId: 17 })
    expect(inventory.get(17)).toBe(1)
    expect(pokemon.heldItemId).toBe(0)
  })

  it('écarte explicitement CT/CS, courrier et objets rares', () => {
    const catalog = createCatalog()
    expect(canGiveHeldItem(catalog.items[328]!)).toBe(false)
    expect(canGiveHeldItem(catalog.items[92]!)).toBe(false)
    expect(canGiveHeldItem(catalog.items[450]!)).toBe(false)
  })

  it('déplace atomiquement le courrier Kenya vers la première case libre du PC', () => {
    const catalog = createCatalog()
    const mailbox = Array.from<CanonicalPokemon['mailIdentity']>({ length: hgssMailboxCapacity })
    mailbox[0] = 'kenya'
    const pokemon = createPokemon(137)
    pokemon.mailIdentity = 'kenya'

    expect(storeHeldMailInMailbox(mailbox, 1, catalog, pokemon)).toEqual({
      kind: 'stored-mail',
      itemId: 137,
      mailboxSlot: 1,
      mailboxMessageCount: 2,
    })
    expect(mailbox.slice(0, 3)).toEqual(['kenya', 'kenya', undefined])
    expect(pokemon).toMatchObject({ heldItemId: 0, mailIdentity: undefined })
  })

  it('conserve le courrier sur le Pokémon lorsque les vingt cases sont pleines', () => {
    const catalog = createCatalog()
    const mailbox: Array<CanonicalPokemon['mailIdentity']> = Array.from(
      { length: hgssMailboxCapacity },
      () => 'kenya' as const,
    )
    const pokemon = createPokemon(137)
    pokemon.mailIdentity = 'kenya'

    expect(storeHeldMailInMailbox(mailbox, hgssMailboxCapacity, catalog, pokemon)).toMatchObject({ kind: 'mailbox-full' })
    expect(mailbox).toHaveLength(hgssMailboxCapacity)
    expect(pokemon).toMatchObject({ heldItemId: 137, mailIdentity: 'kenya' })
  })

  it('refuse sans perte une boîte legacy dont les positions de courriers sont inconnues', () => {
    const catalog = createCatalog()
    const mailbox = Array.from<CanonicalPokemon['mailIdentity']>({ length: hgssMailboxCapacity })
    const pokemon = createPokemon(137)
    pokemon.mailIdentity = 'kenya'

    expect(storeHeldMailInMailbox(mailbox, 1, catalog, pokemon)).toMatchObject({ kind: 'unsupported' })
    expect(mailbox.every((identity) => identity === undefined)).toBe(true)
    expect(pokemon).toMatchObject({ heldItemId: 137, mailIdentity: 'kenya' })
  })

  it('remet le papier dans le Sac uniquement via la branche qui efface son contenu', () => {
    const catalog = createCatalog()
    const inventory = new Map<number, number>()
    const pokemon = createPokemon(137)
    pokemon.mailIdentity = 'kenya'

    expect(returnHeldMailItemToBag(inventory, catalog, pokemon)).toEqual({ kind: 'taken', itemId: 137 })
    expect(inventory.get(137)).toBe(1)
    expect(pokemon).toMatchObject({ heldItemId: 0, mailIdentity: undefined })
  })

  it('refuse avant mutation les objets qui exigeraient un changement de forme', () => {
    const catalog = createCatalog()
    const giratina = createPokemon()
    giratina.speciesId = 487
    const arceus = createPokemon()
    arceus.speciesId = 493
    const inventory = new Map([[112, 1], [298, 1]])

    expect(giveHeldItemToPokemon(inventory, catalog, catalog.items[112]!, giratina)).toMatchObject({ kind: 'unsupported' })
    expect(giveHeldItemToPokemon(inventory, catalog, catalog.items[298]!, arceus)).toMatchObject({ kind: 'unsupported' })
    expect([...inventory]).toEqual([[112, 1], [298, 1]])
    expect(giratina.heldItemId).toBe(0)
    expect(arceus.heldItemId).toBe(0)
  })

  it('applique les données personnelles ROM de Giratina quand l’Orbe Platinée change', () => {
    const itemCatalog = createCatalog()
    const pokemonCatalog = createPokemonTestCatalog()
    const template = pokemonCatalog.personalData[152]!
    pokemonCatalog.personalData[487] = {
      ...template, speciesId: 487, baseStats: { hp: 150, attack: 100, defense: 120, speed: 90, specialAttack: 100, specialDefense: 120 }, abilities: [46, 0],
    }
    pokemonCatalog.personalData[501] = {
      ...template, speciesId: 501, baseStats: { hp: 150, attack: 120, defense: 100, speed: 90, specialAttack: 120, specialDefense: 100 }, abilities: [26, 0],
    }
    const giratina = createCanonicalPokemon(pokemonCatalog, {
      speciesId: 152, level: 50, rng: createHgssLcrng(1), personality: { kind: 'fixed', value: 1 }, individualValues: { kind: 'fixed', value: 0 },
      originalTrainer: { id: 1, name: 'JO', gender: 'male' }, origin: { language: 3, gameVersion: 7, metLocation: 1, metLevel: 50, metTerrain: 1 }, ballId: 4,
    })
    giratina.speciesId = 487
    const inventory = new Map([[112, 1]])

    expect(giveHeldItemToPokemon(inventory, itemCatalog, itemCatalog.items[112]!, giratina, pokemonCatalog)).toEqual({ kind: 'given', previousItemId: 0 })
    expect(giratina).toMatchObject({ form: 1, abilityId: 26, heldItemId: 112 })
    expect(takeHeldItemFromPokemon(inventory, itemCatalog, giratina, pokemonCatalog)).toEqual({ kind: 'taken', itemId: 112 })
    expect(giratina).toMatchObject({ form: 0, abilityId: 46, heldItemId: 0 })
  })
})
