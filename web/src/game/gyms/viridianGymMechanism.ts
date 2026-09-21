const animationIndexByBehavior = new Map([[64, 2], [65, 0], [66, 3], [67, 1]])

export function getViridianGymTileAnimationIndex(metatileBehavior: number): number | undefined {
  return animationIndexByBehavior.get(metatileBehavior & 0xff)
}
