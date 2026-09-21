import type { HgssLcrng } from '../pokemon/hgssPokemonRng'

/** Random accessory pool used by the Goldenrod Tunnel bargain seller. */
export const hgssBargainAccessoryIds = [
  47, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70,
  71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86,
  87, 88, 89, 90, 91, 95, 96,
] as const

export const hgssBargainBackgroundIds = Array.from({ length: 14 }, (_, index) => index)

export function getHgssFashionAccessoryCapacity(accessoryId: number): 1 | 9 {
  if (!Number.isInteger(accessoryId) || accessoryId < 0 || accessoryId >= 100) {
    throw new Error(`Accessoire HGSS ${accessoryId} invalide.`)
  }
  return accessoryId < 61 ? 9 : 1
}

export function canGiveHgssFashionAccessory(inventory: ReadonlyMap<number, number>, accessoryId: number, quantity: number): boolean {
  if (!Number.isInteger(quantity) || quantity < 0) throw new Error(`Quantité d’accessoire HGSS ${quantity} invalide.`)
  return (inventory.get(accessoryId) ?? 0) + quantity <= getHgssFashionAccessoryCapacity(accessoryId)
}

export function giveHgssFashionAccessory(inventory: Map<number, number>, accessoryId: number, quantity: number): void {
  const capacity = getHgssFashionAccessoryCapacity(accessoryId)
  inventory.set(accessoryId, Math.min(capacity, (inventory.get(accessoryId) ?? 0) + quantity))
}

export function hasRoomForHgssBargainAccessory(inventory: ReadonlyMap<number, number>): boolean {
  return hgssBargainAccessoryIds.some((id) => canGiveHgssFashionAccessory(inventory, id, 1))
}

export function chooseHgssBargainAccessory(rng: HgssLcrng): number {
  return hgssBargainAccessoryIds[rng.nextU16() % hgssBargainAccessoryIds.length]!
}

export function hasAllHgssBargainBackgrounds(backgrounds: ReadonlySet<number>): boolean {
  return hgssBargainBackgroundIds.every((id) => backgrounds.has(id))
}

export function chooseMissingHgssBargainBackground(backgrounds: ReadonlySet<number>, rng: HgssLcrng): number {
  const missing = hgssBargainBackgroundIds.filter((id) => !backgrounds.has(id))
  if (missing.length === 0) throw new Error('Tous les décors HGSS du marchand sont déjà obtenus.')
  return missing[rng.nextU16() % missing.length]!
}
