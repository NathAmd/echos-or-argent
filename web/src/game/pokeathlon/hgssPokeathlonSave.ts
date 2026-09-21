/**
 * Projection de ScrCmd_724 sur Pokeathlon_UnkSubStruct_B00.
 * Les noms sont volontairement ceux des index de script tant que la ROM ne les
 * nomme pas : inventer des libellés métier casserait la compatibilité future.
 */
/** 29 lignes de l'overlay 03, puis unk70 réservé aux scripts à l'index 29. */
export const hgssPokeathlonNativeRecordCount = 30

export type HgssPokeathlonRecords = number[]

export type HgssPokeathlonDataCard = {
  itemId: number
  price: number
}

/** Tables _020FBCBA.._020FBBA4 sélectionnées par ScrCmd_772. */
const hgssPokeathlonDataCardTiers: readonly (readonly HgssPokeathlonDataCard[])[] = [
  [[505, 500], [506, 500], [507, 1000], [508, 1000], [509, 500], [510, 500]],
  [[511, 1000], [512, 1000], [513, 1000], [514, 1000], [515, 1000], [516, 1000]],
  [[517, 1500], [518, 1500], [519, 1500], [520, 1000], [521, 1000], [522, 1000]],
  [[523, 500], [524, 500], [525, 2000], [526, 2000], [527, 1000], [528, 1000]],
  [[529, 2000], [530, 3000], [531, 9999]],
].map((tier) => tier.map(([itemId, price]) => ({ itemId, price })))

export function countConsecutiveHgssPokeathlonDataCards(obtainedCardIndexes: ReadonlySet<number>): number {
  for (let index = 0; index < 27; index += 1) {
    if (!obtainedCardIndexes.has(index)) return index
  }
  return 27
}

export function getHgssPokeathlonDataCardShop(obtainedCardIndexes: ReadonlySet<number>): HgssPokeathlonDataCard[] {
  const count = countConsecutiveHgssPokeathlonDataCards(obtainedCardIndexes)
  return hgssPokeathlonDataCardTiers[Math.floor(count / 6)]!.map((card) => ({ ...card }))
}

export function buyHgssPokeathlonDataCard(
  obtainedCardIndexes: Set<number>,
  itemId: number,
  athletePoints: number,
): number {
  const card = getHgssPokeathlonDataCardShop(obtainedCardIndexes).find((candidate) => candidate.itemId === itemId)
  if (!card) throw new Error(`La Carte Données HGSS ${itemId} n'est pas proposée dans ce palier.`)
  const cardIndex = itemId - 505
  if (obtainedCardIndexes.has(cardIndex) || athletePoints < card.price) return athletePoints
  obtainedCardIndexes.add(cardIndex)
  return athletePoints - card.price
}

export function createHgssPokeathlonRecords(): HgssPokeathlonRecords {
  return Array.from({ length: hgssPokeathlonNativeRecordCount }, () => 0)
}

export function readHgssPokeathlonScriptRecord(records: readonly number[], index: number): number {
  const recordIndex = index >= 0 && index <= 9 ? 10 + index : [1, 29, 0, 20, 22, 23, 21, 24][index - 10]
  if (recordIndex === undefined) return 0
  return Math.min(0xffff, Math.max(0, Math.trunc(records[recordIndex] ?? 0)))
}

/** ScrCmd_725 ne modifie que unk70, exposé par ScrCmd_724 à l'index 11. */
export function changeHgssPokeathlonJumpRecord(records: HgssPokeathlonRecords, operation: number, amount: number): void {
  const current = Math.min(0xffff, Math.max(0, Math.trunc(records[29] ?? 0)))
  const delta = Math.max(0, Math.trunc(amount))
  records[29] = operation === 0
    ? Math.min(0xffff, current + delta)
    : Math.max(0, current - delta)
}

export function getHgssPokeathlonDataRows(records: readonly number[], dataType: number, messages: Record<number, string>): Array<{ label: string, value: number }> {
  const counts = [10, 10, 9] as const
  const count = counts[dataType as 0 | 1 | 2] ?? counts[0]
  const first = (dataType >= 0 && dataType <= 2 ? dataType : 0) * 10
  return Array.from({ length: count }, (_, index) => {
    const recordIndex = first + index
    return {
      label: messages[recordIndex + 4] ?? '',
      value: Math.min(9_999_999, Math.max(0, Math.trunc(records[recordIndex] ?? 0))),
    }
  })
}
