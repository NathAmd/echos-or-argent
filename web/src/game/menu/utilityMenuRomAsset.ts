import type { NitroGraphic, RomInventory } from '../../ndsTypes'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import type { HgssPokedexState } from '../pokedex/hgssPokedex'
import { createHgssPokedexEntry, createHgssPokedexList } from '../pokedex/pokedexMenuModel'
import type { MainMenuItem } from './mainMenuController'

export type UtilityMenuPokemonCanvasFactory = (
  speciesId: number,
  form?: number,
  isEgg?: boolean,
  shiny?: boolean,
  gender?: CanonicalPokemon['gender'],
) => HTMLCanvasElement | undefined

export type UtilityMenuRomAssetContext = Readonly<{
  inventory?: RomInventory
  party: readonly CanonicalPokemon[]
  bagInventory: ReadonlyMap<number, number>
  pokedex: HgssPokedexState
  selectedPokedexSpeciesId?: number
  selectedBagItemId?: number
  createPokemonCanvas: UtilityMenuPokemonCanvasFactory
  createGraphicCanvas: (graphic: NitroGraphic) => HTMLCanvasElement
}>

function markPokemonState(
  canvas: HTMLCanvasElement | undefined,
  state: 'caught' | 'seen' | 'fainted' | undefined,
): HTMLCanvasElement | undefined {
  if (canvas && state) canvas.dataset.romAssetState = state
  return canvas
}

function createPartyAsset(
  pokemon: CanonicalPokemon | undefined,
  createCanvas: UtilityMenuPokemonCanvasFactory,
): HTMLCanvasElement | undefined {
  if (!pokemon) return undefined
  return markPokemonState(
    createCanvas(pokemon.speciesId, pokemon.form, pokemon.isEgg, pokemon.shiny, pokemon.gender),
    pokemon.currentHp === 0 ? 'fainted' : undefined,
  )
}

function readCommandId(id: string): number | undefined {
  const value = Number.parseInt(id.slice(id.lastIndexOf(':') + 1), 10)
  return Number.isInteger(value) ? value : undefined
}

/** Resolves the ROM-backed icon for one utility-menu entry. */
export function resolveUtilityMenuRomAsset(
  item: MainMenuItem,
  context: UtilityMenuRomAssetContext,
): HTMLCanvasElement | undefined {
  const inventory = context.inventory
  if (!inventory) return undefined

  if (item.id === 'team') {
    return createPartyAsset(context.party[0], context.createPokemonCanvas)
  }
  if (item.id === 'pokedex') {
    const entries = createHgssPokedexList(context.pokedex, inventory.pokemonCatalog, inventory.pokedexCatalog)
    const speciesId = entries.some(({ speciesId }) => speciesId === context.selectedPokedexSpeciesId)
      ? context.selectedPokedexSpeciesId
      : entries.find((entry) => entry.seen)?.speciesId
    if (speciesId === undefined) return undefined
    const entry = createHgssPokedexEntry(context.pokedex, inventory.pokemonCatalog, inventory.pokedexCatalog, speciesId)
    if (!entry?.seen) return undefined
    return markPokemonState(
      context.createPokemonCanvas(speciesId, entry.forms[0] ?? 0, false, entry.shinyCaught === true, entry.genders[0]),
      entry.caught ? 'caught' : 'seen',
    )
  }
  if (item.id === 'bag') {
    const selectedItemId = context.selectedBagItemId
    const itemId = selectedItemId !== undefined && (context.bagInventory.get(selectedItemId) ?? 0) > 0
      ? selectedItemId
      : [...context.bagInventory].find(([candidateId, quantity]) => (
        quantity > 0 && inventory.itemCatalog.items[candidateId]
      ))?.[0]
    return itemId === undefined
      ? undefined
      : context.createGraphicCanvas(inventory.itemIconResolver(itemId))
  }
  if (item.id.startsWith('pokedex-species:')) {
    const speciesId = readCommandId(item.id)
    if (speciesId === undefined) return undefined
    const entry = createHgssPokedexEntry(context.pokedex, inventory.pokemonCatalog, inventory.pokedexCatalog, speciesId)
    if (!entry?.seen) return undefined
    return markPokemonState(
      context.createPokemonCanvas(speciesId, entry.forms[0] ?? 0, false, entry.shinyCaught === true, entry.genders[0]),
      entry.caught ? 'caught' : 'seen',
    )
  }
  if (item.id.startsWith('team-member:')) {
    const slot = readCommandId(item.id)
    return slot === undefined ? undefined : createPartyAsset(context.party[slot], context.createPokemonCanvas)
  }
  if (item.id.startsWith('bag-pocket:')) {
    const pocket = readCommandId(item.id)
    if (pocket === undefined) return undefined
    const itemId = [...context.bagInventory].find(([candidateId, quantity]) => (
      quantity > 0 && inventory.itemCatalog.items[candidateId]?.fieldPocket === pocket
    ))?.[0]
    return itemId === undefined
      ? undefined
      : context.createGraphicCanvas(inventory.itemIconResolver(itemId))
  }
  if (item.id.startsWith('bag-item:')) {
    const itemId = readCommandId(item.id)
    return itemId === undefined
      ? undefined
      : context.createGraphicCanvas(inventory.itemIconResolver(itemId))
  }
  if (item.id.startsWith('bag-action-') && !item.id.startsWith('bag-action-cancel:')) {
    const itemId = readCommandId(item.id)
    return itemId === undefined
      ? undefined
      : context.createGraphicCanvas(inventory.itemIconResolver(itemId))
  }
  if (item.id.startsWith('bag-use:')
    || item.id.startsWith('bag-use-move:')
    || item.id.startsWith('bag-give:')
    || item.id.startsWith('bag-machine-target:')
    || item.id.startsWith('bag-machine-replace:')) {
    const partySlot = Number.parseInt(item.id.split(':')[2] ?? '', 10)
    return Number.isInteger(partySlot)
      ? createPartyAsset(context.party[partySlot], context.createPokemonCanvas)
      : undefined
  }
  if (item.id.startsWith('bag-use-party:')
    || item.id.startsWith('bag-bike:')
    || item.id.startsWith('bag-repel:')
    || item.id.startsWith('bag-fish:')
    || item.id.startsWith('bag-sweet-scent:')) {
    const itemId = readCommandId(item.id)
    return itemId === undefined
      ? undefined
      : context.createGraphicCanvas(inventory.itemIconResolver(itemId))
  }
  return undefined
}
