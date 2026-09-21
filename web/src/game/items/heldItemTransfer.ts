import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import type { HgssItemCatalog, HgssItemData } from '../../rom/items/itemData'
import type { PokemonCatalog } from '../../ndsTypes'
import { addBagItem, canAddBagItem, getHgssBagQuantityLimit, hasBagItem, takeBagItem } from './bagInventory'
import { calculatePokemonStats, getAbilityFromPersonality, resolvePokemonPersonalData } from '../pokemon/pokemonFormulas'

const griseousOrbItemId = 112
const giratinaSpeciesId = 487
const arceusSpeciesId = 493
const arceusPlateHoldEffects = { minimum: 126, maximum: 141 }

type HeldItemTransferFailure =
  | { kind: 'no-effect', reason: string }
  | { kind: 'unsupported', reason: string }
  | { kind: 'missing-item', reason: string }
  | { kind: 'bag-full', reason: string }
  | { kind: 'mailbox-full', reason: string }

export type GiveHeldItemResult = { kind: 'given', previousItemId: number } | HeldItemTransferFailure
export type TakeHeldItemResult = { kind: 'taken', itemId: number } | HeldItemTransferFailure
export type StoreHeldMailResult = {
  kind: 'stored-mail'
  itemId: number
  mailboxSlot: number
  mailboxMessageCount: number
} | HeldItemTransferFailure
export type HeldItemTransferResult = GiveHeldItemResult | TakeHeldItemResult

export const hgssMailboxCapacity = 20

export function getHgssItemQuantityLimit(item: HgssItemData): number {
  return getHgssBagQuantityLimit(item)
}

export function canGiveHeldItem(item: HgssItemData): boolean {
  return item.fieldPocket !== 3 && item.fieldPocket !== 5 && item.fieldPocket !== 7
}

function requiresFormChange(pokemon: CanonicalPokemon, oldItem: HgssItemData | undefined, newItem: HgssItemData | undefined): boolean {
  const getArceusTypeEffect = (item: HgssItemData | undefined) => item !== undefined
    && item.holdEffect >= arceusPlateHoldEffects.minimum
    && item.holdEffect <= arceusPlateHoldEffects.maximum
    ? item.holdEffect
    : 0
  if (pokemon.speciesId === arceusSpeciesId && getArceusTypeEffect(oldItem) !== getArceusTypeEffect(newItem)) {
    return true
  }
  if (pokemon.speciesId === giratinaSpeciesId
    && (oldItem?.itemId === griseousOrbItemId || newItem?.itemId === griseousOrbItemId)
    && oldItem?.itemId !== newItem?.itemId) {
    return true
  }
  return false
}

function updateHeldItemForm(pokemon: CanonicalPokemon, item: HgssItemData | undefined, catalog: PokemonCatalog): void {
  const oldMaximumHp = pokemon.stats.hp
  const oldCurrentHp = pokemon.currentHp
  if (pokemon.speciesId === giratinaSpeciesId) pokemon.form = item?.itemId === griseousOrbItemId ? 1 : 0
  else if (pokemon.speciesId === arceusSpeciesId && pokemon.abilityId === 121) {
    const arceusTypes = [10, 11, 13, 12, 15, 1, 3, 4, 2, 14, 6, 5, 7, 16, 17, 8] as const
    pokemon.form = item && item.holdEffect >= 126 && item.holdEffect <= 141
      ? arceusTypes[item.holdEffect - 126]!
      : 0
  }
  const personalData = resolvePokemonPersonalData(catalog, pokemon.speciesId, pokemon.form)
  pokemon.abilityId = getAbilityFromPersonality(personalData, pokemon.personality)
  pokemon.stats = calculatePokemonStats(personalData, pokemon.level, pokemon.individualValues, pokemon.effortValues, pokemon.nature)
  if (oldCurrentHp !== 0) {
    pokemon.currentHp = pokemon.stats.hp < oldMaximumHp
      ? Math.min(oldCurrentHp, pokemon.stats.hp)
      : Math.min(pokemon.stats.hp, oldCurrentHp + pokemon.stats.hp - oldMaximumHp)
  }
}

export function giveHeldItemToPokemon(
  inventory: Map<number, number>,
  catalog: HgssItemCatalog,
  item: HgssItemData,
  pokemon: CanonicalPokemon,
  pokemonCatalog?: PokemonCatalog,
): GiveHeldItemResult {
  if (!hasBagItem(inventory, item.itemId, 1)) return { kind: 'missing-item', reason: `${item.name} n’est plus dans le Sac.` }
  if (!canGiveHeldItem(item)) return { kind: 'unsupported', reason: `${item.name} ne peut pas être donné depuis cette poche.` }
  if (pokemon.isEgg) return { kind: 'unsupported', reason: 'Un Œuf ne peut pas tenir cet objet.' }
  if (pokemon.heldItemId === item.itemId) return { kind: 'no-effect', reason: `${pokemon.nickname ?? pokemon.speciesName} tient déjà ${item.name}.` }
  const previousItemId = pokemon.heldItemId
  const previousItem = previousItemId === 0 ? undefined : catalog.items[previousItemId]
  if (previousItemId !== 0 && !previousItem) {
    return { kind: 'unsupported', reason: `L’objet tenu ${previousItemId} est absent du catalogue ROM.` }
  }
  if (previousItem?.fieldPocket === 5) {
    return { kind: 'unsupported', reason: 'Le courrier tenu doit être replacé avec son contenu ; cette action reste à implémenter.' }
  }
  const formChange = requiresFormChange(pokemon, previousItem, item)
  if (formChange && !pokemonCatalog) return { kind: 'unsupported', reason: 'Les formes personnelles ROM sont absentes de ce contexte.' }
  const candidate = new Map(inventory)
  if (!takeBagItem(candidate, item.itemId, 1)) throw new Error(`La transaction de ${item.name} a perdu sa source.`)
  if (previousItem && !addBagItem(candidate, catalog, previousItem.itemId, 1)) {
    return { kind: 'bag-full', reason: `La poche ${previousItem.fieldPocket} ne peut pas reprendre ${previousItem.name}.` }
  }
  inventory.clear()
  for (const entry of candidate) inventory.set(...entry)
  pokemon.heldItemId = item.itemId
  if (formChange) updateHeldItemForm(pokemon, item, pokemonCatalog!)
  return { kind: 'given', previousItemId }
}

export function takeHeldItemFromPokemon(
  inventory: Map<number, number>,
  catalog: HgssItemCatalog,
  pokemon: CanonicalPokemon,
  pokemonCatalog?: PokemonCatalog,
): TakeHeldItemResult {
  if (pokemon.heldItemId === 0) return { kind: 'no-effect', reason: `${pokemon.nickname ?? pokemon.speciesName} ne tient aucun objet.` }
  const item = catalog.items[pokemon.heldItemId]
  if (!item) return { kind: 'unsupported', reason: `L’objet tenu ${pokemon.heldItemId} est absent du catalogue ROM.` }
  if (item.fieldPocket === 5) return { kind: 'unsupported', reason: 'Le courrier tenu doit être replacé avec son contenu ; cette action reste à implémenter.' }
  const formChange = requiresFormChange(pokemon, item, undefined)
  if (formChange && !pokemonCatalog) return { kind: 'unsupported', reason: 'Les formes personnelles ROM sont absentes de ce contexte.' }
  if (!canAddBagItem(inventory, catalog, item.itemId, 1)) return { kind: 'bag-full', reason: `La poche ${item.fieldPocket} est pleine.` }
  if (!addBagItem(inventory, catalog, item.itemId, 1)) throw new Error(`La transaction de ${item.name} a perdu sa capacité réservée.`)
  pokemon.heldItemId = 0
  if (formChange) updateHeldItemForm(pokemon, undefined, pokemonCatalog!)
  return { kind: 'taken', itemId: item.itemId }
}

/**
 * Reproduit `Mailbox_MoveMessageFromMon`: le courrier et son contenu quittent
 * ensemble le Pokémon pour la première case libre de la boîte aux lettres.
 * Seule l'identité Kenya est actuellement décodée par le modèle data-only.
 */
export function storeHeldMailInMailbox(
  mailbox: Array<CanonicalPokemon['mailIdentity']>,
  mailboxMessageCount: number,
  catalog: HgssItemCatalog,
  pokemon: CanonicalPokemon,
): StoreHeldMailResult {
  if (pokemon.heldItemId === 0) {
    return { kind: 'no-effect', reason: `${pokemon.nickname ?? pokemon.speciesName} ne tient aucun objet.` }
  }
  const item = catalog.items[pokemon.heldItemId]
  if (!item) return { kind: 'unsupported', reason: `L’objet tenu ${pokemon.heldItemId} est absent du catalogue ROM.` }
  if (item.fieldPocket !== 5) return { kind: 'unsupported', reason: `${item.name} n’est pas un courrier.` }
  if (pokemon.mailIdentity !== 'kenya') {
    return { kind: 'unsupported', reason: 'Le contenu de ce courrier n’est pas décodé et ne peut pas être déplacé sans perte.' }
  }
  if (mailbox.length !== hgssMailboxCapacity) {
    return { kind: 'unsupported', reason: `La boîte aux lettres doit contenir ${hgssMailboxCapacity} cases.` }
  }
  if (!Number.isInteger(mailboxMessageCount) || mailboxMessageCount < 0 || mailboxMessageCount > hgssMailboxCapacity) {
    return { kind: 'unsupported', reason: 'Le nombre de courriers de la boîte aux lettres est invalide.' }
  }
  const decodedMessageCount = mailbox.filter((identity) => identity !== undefined).length
  if (decodedMessageCount !== mailboxMessageCount) {
    return { kind: 'unsupported', reason: 'La boîte aux lettres contient un courrier dont la position n’est pas décodée.' }
  }
  if (mailboxMessageCount === hgssMailboxCapacity) {
    return { kind: 'mailbox-full', reason: 'La boîte aux lettres du PC est pleine.' }
  }
  const mailboxSlot = mailbox.findIndex((identity) => identity === undefined)
  if (mailboxSlot < 0) return { kind: 'mailbox-full', reason: 'La boîte aux lettres du PC est pleine.' }

  mailbox[mailboxSlot] = pokemon.mailIdentity
  const itemId = pokemon.heldItemId
  pokemon.heldItemId = 0
  pokemon.mailIdentity = undefined
  return { kind: 'stored-mail', itemId, mailboxSlot, mailboxMessageCount: mailboxMessageCount + 1 }
}

/** Branche native explicite qui remet le papier dans le Sac et efface le texte. */
export function returnHeldMailItemToBag(
  inventory: Map<number, number>,
  catalog: HgssItemCatalog,
  pokemon: CanonicalPokemon,
): TakeHeldItemResult {
  if (pokemon.heldItemId === 0) {
    return { kind: 'no-effect', reason: `${pokemon.nickname ?? pokemon.speciesName} ne tient aucun objet.` }
  }
  const item = catalog.items[pokemon.heldItemId]
  if (!item) return { kind: 'unsupported', reason: `L’objet tenu ${pokemon.heldItemId} est absent du catalogue ROM.` }
  if (item.fieldPocket !== 5) return { kind: 'unsupported', reason: `${item.name} n’est pas un courrier.` }
  if (!canAddBagItem(inventory, catalog, item.itemId, 1)) {
    return { kind: 'bag-full', reason: `La poche ${item.fieldPocket} est pleine.` }
  }
  if (!addBagItem(inventory, catalog, item.itemId, 1)) {
    throw new Error(`La transaction de ${item.name} a perdu sa capacité réservée.`)
  }
  pokemon.heldItemId = 0
  pokemon.mailIdentity = undefined
  return { kind: 'taken', itemId: item.itemId }
}
