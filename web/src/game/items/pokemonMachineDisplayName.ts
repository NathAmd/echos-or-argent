import { getHgssPokemonMachine } from './usePokemonMachine'

export type PokemonMachineDisplayItem = {
  itemId: number
  name: string
}

/**
 * Complète le nom d'objet issu de la ROM par le nom ROM de la capacité.
 * Les objets ordinaires et les machines dont le nom de capacité est absent
 * restent inchangés : cette couche de présentation n'invente aucun libellé.
 */
export function getPokemonMachineDisplayName(
  item: PokemonMachineDisplayItem,
  moveNames: readonly string[],
): string {
  const machine = getHgssPokemonMachine(item.itemId)
  const moveName = machine ? moveNames[machine.moveId]?.trim() : undefined
  return moveName ? `${item.name} · ${moveName}` : item.name
}
