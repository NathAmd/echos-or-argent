import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import type { HgssItemCatalog, HgssItemPocket } from '../../rom/items/itemData'
import type { PokemonCatalog } from '../../ndsTypes'
import { canTargetFieldItemAtPokemon, canUseFieldItemOnParty } from '../items/useFieldItem'
import { canGiveHeldItem } from '../items/heldItemTransfer'
import { getHgssPokemonMachine, inspectPokemonMachineCompatibility } from '../items/usePokemonMachine'
import type { MainMenuItem } from './mainMenuController'
import { getHgssRepelStepCount } from '../encounters/hgssRepel'
import { getPokemonMachineDisplayName } from '../items/pokemonMachineDisplayName'
import { HGSS_HONEY_ITEM_ID } from '../encounters/hgssSweetScentEncounter'

export type BagMenuSelection = {
  pocket?: HgssItemPocket
  itemId?: number
  machinePartySlot?: number
  action?: 'use' | 'give'
}

export type BagMenuModel = {
  items: readonly MainMenuItem[]
  selectedPocket?: HgssItemPocket
  selectedItemId?: number
}

export function createBagMenuModel(
  inventory: ReadonlyMap<number, number>,
  catalog: HgssItemCatalog,
  party: readonly CanonicalPokemon[],
  pokemonCatalog: PokemonCatalog,
  selection: BagMenuSelection,
): BagMenuModel {
  const entries = [...inventory]
    .filter(([, quantity]) => quantity > 0)
    .sort(([left], [right]) => left - right)
    .map(([itemId, quantity]) => {
      const item = catalog.items[itemId]
      if (!item) throw new Error(`L'objet ROM HGSS ${itemId} est absent du catalogue du Sac.`)
      return { item, quantity }
    })
  if (entries.length === 0) return { items: [] }

  const pockets = [...new Set(entries.map(({ item }) => item.fieldPocket))].sort((left, right) => left - right)
  const selectedEntry = selection.itemId === undefined
    ? undefined
    : entries.find(({ item }) => item.itemId === selection.itemId)
  const selectedPocket = selection.pocket !== undefined && pockets.includes(selection.pocket)
    ? selection.pocket
    : selectedEntry?.item.fieldPocket ?? pockets[0]!
  const pocketEntries = entries.filter(({ item }) => item.fieldPocket === selectedPocket)
  const selectedItem = pocketEntries.find(({ item }) => item.itemId === selection.itemId)?.item ?? pocketEntries[0]!.item

  const pocketButtons: MainMenuItem[] = pockets.map((pocket) => ({
    id: `bag-pocket:${pocket}`,
    label: `${catalog.pocketNames[pocket]} (${entries.filter(({ item }) => item.fieldPocket === pocket).length})`,
    kind: 'command',
  }))
  const itemButtons: MainMenuItem[] = pocketEntries.map(({ item, quantity }) => ({
    id: `bag-item:${item.itemId}`,
    label: `${getPokemonMachineDisplayName(item, pokemonCatalog.moveNames)} × ${quantity}`,
    kind: 'command',
  }))
  const requiresMove = selectedItem.partyParameters.ppRestore
    || selectedItem.partyParameters.ppUp
    || selectedItem.partyParameters.ppMax
  const targetButtons: MainMenuItem[] = []
  const machine = getHgssPokemonMachine(selectedItem.itemId)
  const moveNames = pokemonCatalog.moveNames
  if (machine && selection.machinePartySlot !== undefined) {
    const machinePartySlot = selection.machinePartySlot
    const pokemon = party[machinePartySlot]
    if (pokemon) {
      pokemon.moves.forEach((move, moveIndex) => {
        const moveName = moveNames[move.moveId]
        if (!moveName) throw new Error(`Le nom ROM de la capacité ${move.moveId} à oublier est absent.`)
        targetButtons.push({
          id: `bag-machine-replace:${machine.itemId}:${machinePartySlot}:${moveIndex}`,
          label: moveName,
          kind: 'command',
        })
      })
      targetButtons.push({
        id: `bag-machine-cancel:${machine.itemId}:${machinePartySlot}`,
        label: '',
        kind: 'command',
      })
    }
  } else if (selection.action === undefined) {
    const usable = Boolean(machine || selectedItem.itemId === HGSS_HONEY_ITEM_ID || selectedItem.itemId === 450 || getHgssRepelStepCount(selectedItem.itemId) !== undefined
      || selectedItem.itemId >= 445 && selectedItem.itemId <= 447 || canUseFieldItemOnParty(selectedItem)
      || canTargetFieldItemAtPokemon(selectedItem))
    if (usable) targetButtons.push({ id: `bag-action-use:${selectedItem.itemId}`, label: 'Utiliser', kind: 'command' })
    if (canGiveHeldItem(selectedItem) && party.some((pokemon) => !pokemon.isEgg)) {
      targetButtons.push({ id: `bag-action-give:${selectedItem.itemId}`, label: 'Donner', kind: 'command' })
    }
  } else if (selection.action === 'use') {
    if (selectedItem.itemId === HGSS_HONEY_ITEM_ID) targetButtons.push({ id: `bag-sweet-scent:${selectedItem.itemId}`, label: 'Utiliser', kind: 'command' })
    else if (selectedItem.itemId === 450) targetButtons.push({ id: `bag-bike:${selectedItem.itemId}`, label: 'Utiliser', kind: 'command' })
    else if (getHgssRepelStepCount(selectedItem.itemId) !== undefined) targetButtons.push({ id: `bag-repel:${selectedItem.itemId}`, label: 'Utiliser', kind: 'command' })
    else if (selectedItem.itemId >= 445 && selectedItem.itemId <= 447) targetButtons.push({ id: `bag-fish:${selectedItem.itemId}`, label: 'Pêcher', kind: 'command' })
    else if (!machine && canUseFieldItemOnParty(selectedItem)) targetButtons.push({ id: `bag-use-party:${selectedItem.itemId}`, label: 'Utiliser sur toute l’Équipe', kind: 'command' })
    party.forEach((pokemon, slot) => {
      const pokemonName = pokemon.nickname ?? pokemon.speciesName
      if (machine) {
        if (inspectPokemonMachineCompatibility(pokemon, machine.itemId, pokemonCatalog).kind !== 'compatible') return
        targetButtons.push({
          id: `bag-machine-target:${machine.itemId}:${slot}`,
          label: pokemonName,
          kind: 'command',
        })
      } else if (canTargetFieldItemAtPokemon(selectedItem) && requiresMove) pokemon.moves.forEach((move, moveIndex) => {
        targetButtons.push({
          id: `bag-use-move:${selectedItem.itemId}:${slot}:${moveIndex}`,
          label: `Utiliser sur ${pokemonName} · ${moveNames[move.moveId] ?? '—'}`,
          kind: 'command',
        })
      })
      else if (canTargetFieldItemAtPokemon(selectedItem)) targetButtons.push({
        id: `bag-use:${selectedItem.itemId}:${slot}`,
        label: `Utiliser sur ${pokemonName}`,
        kind: 'command',
      })
    })
  } else {
    party.forEach((pokemon, slot) => {
      if (!pokemon.isEgg) targetButtons.push({
        id: `bag-give:${selectedItem.itemId}:${slot}`,
        label: `Donner à ${pokemon.nickname ?? pokemon.speciesName}`,
        kind: 'command',
      })
    })
  }
  if (targetButtons.length > 0 && !targetButtons.some(({ id }) => id.startsWith('bag-machine-cancel:'))) {
    targetButtons.push({ id: `bag-action-cancel:${selectedItem.itemId}`, label: 'Annuler', kind: 'command' })
  }
  return {
    items: [...pocketButtons, ...itemButtons, ...targetButtons],
    selectedPocket,
    selectedItemId: selectedItem.itemId,
  }
}
