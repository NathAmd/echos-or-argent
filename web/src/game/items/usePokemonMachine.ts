import type { PokemonCatalog } from '../../ndsTypes'
import { getHgssTmHmMoveId } from '../../rom/items/itemData'
import type { CanonicalPokemon, CanonicalPokemonMove } from '../pokemon/canonicalPokemon'
import { resolvePokemonPersonalData } from '../pokemon/pokemonFormulas'
import { replacePokemonMoveAfterChoice } from '../pokemon/pokemonMoveLearning'
import { takeBagItem } from './bagInventory'

export const hgssFirstTmItemId = 328
export const hgssLastTmItemId = 419
export const hgssFirstHmItemId = 420
export const hgssLastHmItemId = 427

export type HgssPokemonMachine = {
  itemId: number
  moveId: number
  kind: 'CT' | 'CS'
  number: number
  consumed: boolean
}

export type PokemonMachineCompatibility =
  | { kind: 'compatible', machine: HgssPokemonMachine }
  | { kind: 'egg', machine: HgssPokemonMachine, reason: string }
  | { kind: 'already-known', machine: HgssPokemonMachine, reason: string }
  | { kind: 'incompatible', machine: HgssPokemonMachine, reason: string }
  | { kind: 'not-machine', reason: string }

export type UsePokemonMachineResult =
  | { kind: 'learned', machine: HgssPokemonMachine, learned: CanonicalPokemonMove, forgotten?: CanonicalPokemonMove }
  | { kind: 'replacement-required', machine: HgssPokemonMachine }
  | { kind: 'unavailable', reason: string }

export function getHgssPokemonMachine(itemId: number): HgssPokemonMachine | undefined {
  if (!Number.isInteger(itemId) || itemId < hgssFirstTmItemId || itemId > hgssLastHmItemId) return undefined
  const moveId = getHgssTmHmMoveId(itemId)
  if (moveId === 0) return undefined
  const isTm = itemId <= hgssLastTmItemId
  return {
    itemId,
    moveId,
    kind: isTm ? 'CT' : 'CS',
    number: isTm ? itemId - hgssFirstTmItemId + 1 : itemId - hgssFirstHmItemId + 1,
    consumed: isTm,
  }
}

export function inspectPokemonMachineCompatibility(
  pokemon: CanonicalPokemon,
  itemId: number,
  catalog: PokemonCatalog,
): PokemonMachineCompatibility {
  const machine = getHgssPokemonMachine(itemId)
  if (!machine) return { kind: 'not-machine', reason: "Cet objet n'est pas une CT ou une CS HGSS." }
  if (pokemon.isEgg) return { kind: 'egg', machine, reason: "Un Œuf ne peut pas apprendre de capacité." }
  if (pokemon.moves.some(({ moveId }) => moveId === machine.moveId)) {
    return { kind: 'already-known', machine, reason: 'Cette capacité est déjà connue.' }
  }
  const machineIndex = itemId - hgssFirstTmItemId
  const compatibility = resolvePokemonPersonalData(catalog, pokemon.speciesId, pokemon.form).tmHmCompatibility
  const word = compatibility[Math.floor(machineIndex / 32)] ?? 0
  if ((word & (1 << (machineIndex % 32))) === 0) {
    return { kind: 'incompatible', machine, reason: 'Ce Pokémon ne peut pas apprendre cette capacité.' }
  }
  return { kind: 'compatible', machine }
}

/**
 * Reproduit l'usage terrain HGSS : une CT est consommée uniquement après un
 * apprentissage réussi, une CS reste dans le Sac, et aucun emplacement n'est
 * écrasé sans choix explicite du joueur.
 */
export function usePokemonMachine(
  inventory: Map<number, number>,
  itemId: number,
  pokemon: CanonicalPokemon,
  catalog: PokemonCatalog,
  forgetIndex?: number,
): UsePokemonMachineResult {
  if ((inventory.get(itemId) ?? 0) <= 0) return { kind: 'unavailable', reason: "Cette CT ou CS n'est plus dans le Sac." }
  const compatibility = inspectPokemonMachineCompatibility(pokemon, itemId, catalog)
  if (compatibility.kind !== 'compatible') return { kind: 'unavailable', reason: compatibility.reason }
  const { machine } = compatibility
  const moveData = catalog.moves[machine.moveId]
  if (!moveData) throw new Error(`La capacité ROM ${machine.moveId} de ${machine.kind}${machine.number} est absente.`)

  let learned: CanonicalPokemonMove = { moveId: machine.moveId, pp: moveData.pp, maxPp: moveData.pp, ppUps: 0, data: moveData }
  let forgotten: CanonicalPokemonMove | undefined
  if (pokemon.moves.length >= 4) {
    if (forgetIndex === undefined) return { kind: 'replacement-required', machine }
    forgotten = pokemon.moves[forgetIndex]
    if (!Number.isInteger(forgetIndex) || forgetIndex < 0 || !forgotten) {
      return { kind: 'unavailable', reason: "Aucune capacité n'a été remplacée." }
    }
  }

  // Consume a CT only after every target and slot check, but before mutating
  // the Pokémon. A stale/repeated UI command can therefore never teach a move
  // while leaving the corresponding CT untouched (or consume one on failure).
  if (machine.consumed && !takeBagItem(inventory, itemId, 1)) {
    return { kind: 'unavailable', reason: "Cette CT ou CS n'est plus dans le Sac." }
  }
  if (forgotten) {
    const replacement = replacePokemonMoveAfterChoice(pokemon, machine.moveId, forgetIndex!, catalog)
    if (replacement.kind !== 'replaced') {
      if (machine.consumed) inventory.set(itemId, (inventory.get(itemId) ?? 0) + 1)
      return { kind: 'unavailable', reason: "Aucune capacité n'a été remplacée." }
    }
    learned = replacement.learned
  } else {
    pokemon.moves.push(learned)
  }
  return { kind: 'learned', machine, learned, forgotten }
}
