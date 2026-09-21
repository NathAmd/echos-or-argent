const standardMartItems: readonly { itemId: number, minimumTier: number }[] = [
  { itemId: 4, minimumTier: 1 }, { itemId: 3, minimumTier: 3 }, { itemId: 2, minimumTier: 4 },
  { itemId: 17, minimumTier: 1 }, { itemId: 26, minimumTier: 2 }, { itemId: 25, minimumTier: 4 },
  { itemId: 24, minimumTier: 5 }, { itemId: 23, minimumTier: 6 }, { itemId: 28, minimumTier: 3 },
  { itemId: 18, minimumTier: 1 }, { itemId: 22, minimumTier: 1 }, { itemId: 21, minimumTier: 2 },
  { itemId: 19, minimumTier: 2 }, { itemId: 20, minimumTier: 2 }, { itemId: 27, minimumTier: 4 },
  { itemId: 78, minimumTier: 2 }, { itemId: 79, minimumTier: 2 }, { itemId: 76, minimumTier: 3 },
  { itemId: 77, minimumTier: 4 },
]

// Table _0210FA3C de scrcmd_mart.c, dans l'ordre exact de la ROM HGSS.
const specialMartItems: readonly (readonly number[])[] = [
  [146, 14], [141, 14, 6], [140, 14, 6], [17, 26, 25, 24, 28, 18, 22, 19, 20, 21, 27],
  [4, 3, 2, 78, 63, 79, 76, 77, 137, 138, 139, 145], [59, 57, 58, 55, 56, 60, 61, 62],
  [46, 47, 49, 52, 48, 45], [397, 344, 381, 410, 343, 360, 349, 379, 365, 352, 341, 342],
  [36, 34, 35, 37], [146, 14, 6], [143, 14, 6], [17, 26, 25, 27, 28], [146, 6, 13],
  [2, 77, 25, 24, 23, 28, 27], [146, 8, 13, 15], [146, 13, 15], [144, 13, 15], [146, 15],
  [17, 26, 25, 24, 28, 18, 22, 19, 20, 21, 27], [4, 3, 2, 78, 63, 79, 76, 77, 137, 138, 139, 145],
  [348, 354, 414, 405, 339, 368, 347, 355, 403, 382, 399, 406], [146, 141, 140],
  [59, 57, 58, 55, 56, 60, 61, 62], [46, 47, 49, 52, 48, 45], [142, 13, 15],
  [142, 8, 15], [142, 6, 14], [63, 30, 31, 32, 79, 143], [86, 4, 17], [3, 26, 25, 18, 22, 76, 28, 146],
]

function getMartTier(badgeCount: number): number {
  if (badgeCount <= 0) return 1
  if (badgeCount <= 2) return 2
  if (badgeCount <= 4) return 3
  if (badgeCount <= 6) return 4
  if (badgeCount === 7) return 5
  return 6
}

export function getHgssStandardMartItemIds(badgeCount: number): number[] {
  const tier = getMartTier(badgeCount)
  return standardMartItems.filter((entry) => entry.minimumTier <= tier).map((entry) => entry.itemId)
}

export function getHgssSpecialMartItemIds(index: number): number[] {
  const items = specialMartItems[index]
  if (!items) throw new Error(`La boutique spéciale HGSS ${index} est absente de la table ROM.`)
  return [...items]
}
