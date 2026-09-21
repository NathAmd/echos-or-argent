import type { PokemonCatalog } from '../../../ndsTypes'
import { isPokemonInstanceId } from '../../pokemon/pokemonInstanceId'

export function requireStrictRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} doit être un objet JSON.`)
  }
  const prototype: unknown = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} doit être un objet JSON simple.`)
  }
  const reflectedKeys = Reflect.ownKeys(value)
  if (reflectedKeys.some((key) => typeof key !== 'string')) {
    throw new Error(`${label} contient une clé non sérialisable.`)
  }
  const actualKeys = (reflectedKeys as string[]).sort()
  const expectedKeys = [...keys].sort()
  if (actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error(`${label} contient des champs absents ou inconnus.`)
  }
  for (const key of actualKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      throw new Error(`${label} contient un champ non sérialisable.`)
    }
  }
  return value as Record<string, unknown>
}

export function requireStrictArray(value: unknown, length: number, label: string): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length !== length) {
    throw new Error(`${label} doit contenir exactement ${length} éléments JSON.`)
  }
  const keys = Reflect.ownKeys(value)
  if (keys.length !== length + 1 || keys[length] !== 'length') {
    throw new Error(`${label} doit être un tableau JSON dense sans champ supplémentaire.`)
  }
  for (let index = 0; index < length; index += 1) {
    if (keys[index] !== String(index)) {
      throw new Error(`${label} doit être un tableau JSON dense sans champ supplémentaire.`)
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      throw new Error(`${label} contient un élément non sérialisable.`)
    }
  }
  return value
}

export function requireHgssSpeciesId(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 493) {
    throw new Error(`${label} doit être une espèce HGSS comprise entre 1 et 493.`)
  }
  return value as number
}

export function requirePokemonForm(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 0xff) {
    throw new Error(`${label} doit être une forme comprise entre 0 et 255.`)
  }
  return value as number
}

export function requirePokemonTypeId(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 17) {
    throw new Error(`${label} doit être un type HGSS compris entre 0 et 17.`)
  }
  return value as number
}

export function requireCatalogSpecies(
  catalog: PokemonCatalog,
  speciesId: number,
  label: string,
): NonNullable<PokemonCatalog['personalData'][number]> {
  const personal = catalog.personalData[speciesId]
  if (!personal || personal.speciesId !== speciesId || !catalog.speciesNames[speciesId]) {
    throw new Error(`${label} ${speciesId} est absente du catalogue Pokémon HGSS.`)
  }
  return personal
}

export function catalogSpeciesHasType(
  catalog: PokemonCatalog,
  speciesId: number,
  typeId: number,
): boolean {
  const personal = catalog.personalData[speciesId]
  return personal?.speciesId === speciesId && personal.types.includes(typeId)
}

export function requirePersistentPokemonInstanceId(value: unknown, label: string): string {
  if (!isPokemonInstanceId(value)) throw new Error(`${label} est invalide.`)
  return value
}

export function freezeArray<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...values])
}
