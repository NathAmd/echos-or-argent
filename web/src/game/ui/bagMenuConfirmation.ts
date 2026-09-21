import type { MainMenuCommand } from '../menu/mainMenuController'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import type { HgssItemCatalog } from '../../rom/items/itemData'
import type { PokemonCatalog } from '../../ndsTypes'
import { getHgssPokemonMachine } from '../items/usePokemonMachine'
import { formatHgssRomMessage } from './romMessageFormatting'

export type BagCommandConfirmationRomMessages = {
  bag: Record<number, string>
  party: Record<number, string>
}

export function getBagCommandConfirmation(
  command: MainMenuCommand,
  itemCatalog: HgssItemCatalog,
  pokemonCatalog: PokemonCatalog,
  party: readonly CanonicalPokemon[],
  romMessages?: BagCommandConfirmationRomMessages,
): string | undefined {
  const parts = command.split(':')
  const itemId = Number.parseInt(parts[1] ?? '', 10)
  const item = itemCatalog.items[itemId]
  if (!item) return undefined
  if (command.startsWith('bag-use-party:')) return `Utiliser ${item.name} sur toute l’Équipe ?`
  if (command.startsWith('bag-repel:')) return `Utiliser ${item.name} maintenant ?`
  if (command.startsWith('bag-use:') || command.startsWith('bag-use-move:')) {
    const pokemon = party[Number.parseInt(parts[2] ?? '', 10)]
    return pokemon ? `Utiliser ${item.name} sur ${pokemon.nickname ?? pokemon.speciesName} ?` : undefined
  }
  if (command.startsWith('bag-give:')) {
    const pokemon = party[Number.parseInt(parts[2] ?? '', 10)]
    return pokemon ? `Donner ${item.name} à ${pokemon.nickname ?? pokemon.speciesName} ?` : undefined
  }
  if (command.startsWith('bag-machine-target:')) {
    const pokemon = party[Number.parseInt(parts[2] ?? '', 10)]
    const machine = getHgssPokemonMachine(itemId)
    const moveName = machine && pokemonCatalog.moveNames[machine.moveId]
    if (!pokemon || !moveName || !romMessages) return undefined
    const template = pokemon.moves.length >= 4 ? romMessages.party[53] : romMessages.bag[61]
    return template
      ? formatHgssRomMessage(template, pokemon.moves.length >= 4 ? [pokemon.nickname ?? pokemon.speciesName, moveName] : [moveName])
      : undefined
  }
  if (command.startsWith('bag-machine-cancel:')) {
    const pokemon = party[Number.parseInt(parts[2] ?? '', 10)]
    const machine = getHgssPokemonMachine(itemId)
    const moveName = machine && pokemonCatalog.moveNames[machine.moveId]
    const template = romMessages?.party[56]
    return pokemon && moveName && template ? formatHgssRomMessage(template, [moveName]) : undefined
  }
  // The full-moves prompt above is the native, safe Yes/No gate. Once it was
  // accepted, selecting the explicitly named old move performs the replacement
  // exactly once; another invented confirmation caused stale names and a
  // double-submit path.
  if (command.startsWith('bag-machine-replace:')) return undefined
  return undefined
}
