import { cloneCanonicalPokemon, type CanonicalPokemon } from './canonicalPokemon'

/** Valeurs de constants/pokemon.h dans la decompilation HGSS. */
export const hgssStorageBoxCount = 18
export const hgssStorageBoxCapacity = 30

export type PokemonStorage = {
  currentBox: number
  boxes: (CanonicalPokemon | undefined)[][]
}

export type PokemonStoragePlacement = {
  previousBox: number
  box: number
  slot: number
}

function createEmptyBox(): (CanonicalPokemon | undefined)[] {
  return Array.from({ length: hgssStorageBoxCapacity }, () => undefined)
}

export function createPokemonStorage(
  boxes?: readonly (readonly (CanonicalPokemon | undefined)[])[],
  currentBox = 0,
): PokemonStorage {
  if (!Number.isInteger(currentBox) || currentBox < 0 || currentBox >= hgssStorageBoxCount) {
    throw new Error(`La Boite PC HGSS active ${currentBox} est invalide.`)
  }
  if (boxes && boxes.length > hgssStorageBoxCount) {
    throw new Error(`Le PC HGSS ne peut pas contenir plus de ${hgssStorageBoxCount} Boites.`)
  }
  const normalized = Array.from({ length: hgssStorageBoxCount }, (_, boxIndex) => {
    const source = boxes?.[boxIndex]
    if (!source) return createEmptyBox()
    if (source.length > hgssStorageBoxCapacity) {
      throw new Error(`La Boite PC HGSS ${boxIndex + 1} ne peut pas contenir plus de ${hgssStorageBoxCapacity} Pokemon.`)
    }
    return Array.from({ length: hgssStorageBoxCapacity }, (_, slot) => {
      const pokemon = source[slot]
      return pokemon ? cloneCanonicalPokemon(pokemon) : undefined
    })
  })
  return { currentBox, boxes: normalized }
}

export function clonePokemonStorage(storage: PokemonStorage): PokemonStorage {
  return createPokemonStorage(storage.boxes, storage.currentBox)
}

export function findFirstPokemonStorageSlot(storage: PokemonStorage): { box: number, slot: number } | undefined {
  for (let offset = 0; offset < hgssStorageBoxCount; offset += 1) {
    const box = (storage.currentBox + offset) % hgssStorageBoxCount
    const slot = storage.boxes[box]!.findIndex((pokemon) => pokemon === undefined)
    if (slot >= 0) return { box, slot }
  }
  return undefined
}

/** Reproduit le chemin de capture HGSS : selection de la premiere Boite libre, puis rangement. */
export function placePokemonInFirstStorageSlot(storage: PokemonStorage, pokemon: CanonicalPokemon): PokemonStoragePlacement | undefined {
  const destination = findFirstPokemonStorageSlot(storage)
  if (!destination) return undefined
  const previousBox = storage.currentBox
  const boxed = cloneCanonicalPokemon(pokemon)
  for (const move of boxed.moves) move.pp = move.maxPp
  storage.currentBox = destination.box
  storage.boxes[destination.box]![destination.slot] = boxed
  return { previousBox, ...destination }
}
