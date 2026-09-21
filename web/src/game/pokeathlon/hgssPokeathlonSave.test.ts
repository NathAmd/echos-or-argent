import { describe, expect, it } from 'vitest'
import {
  buyHgssPokeathlonDataCard,
  changeHgssPokeathlonJumpRecord,
  countConsecutiveHgssPokeathlonDataCards,
  createHgssPokeathlonRecords,
  getHgssPokeathlonDataCardShop,
  getHgssPokeathlonDataRows,
  readHgssPokeathlonScriptRecord,
} from './hgssPokeathlonSave'

describe('bloc de records Pokéathlon HGSS', () => {
  it('reproduit les limites de ScrCmd_724 et ScrCmd_725', () => {
    const records = createHgssPokeathlonRecords()
    records[10] = 70_000
    expect(readHgssPokeathlonScriptRecord(records, 0)).toBe(0xffff)
    expect(readHgssPokeathlonScriptRecord(records, 18)).toBe(0)

    changeHgssPokeathlonJumpRecord(records, 0, 70_000)
    expect(records[29]).toBe(0xffff)
    changeHgssPokeathlonJumpRecord(records, 1, 70_000)
    expect(records[29]).toBe(0)
  })

  it("suit l'ordre et les libellés de l'overlay 03", () => {
    const records = createHgssPokeathlonRecords()
    records[20] = 42
    const rows = getHgssPokeathlonDataRows(records, 2, { 24: 'Action ROM' })
    expect(rows).toHaveLength(9)
    expect(rows[0]).toEqual({ label: 'Action ROM', value: 42 })
  })

  it('reproduit les paliers et achats des 27 Cartes Données de ScrCmd_772/835', () => {
    const cards = new Set<number>()
    expect(countConsecutiveHgssPokeathlonDataCards(cards)).toBe(0)
    expect(getHgssPokeathlonDataCardShop(cards)).toEqual([
      { itemId: 505, price: 500 }, { itemId: 506, price: 500 },
      { itemId: 507, price: 1000 }, { itemId: 508, price: 1000 },
      { itemId: 509, price: 500 }, { itemId: 510, price: 500 },
    ])

    const points = buyHgssPokeathlonDataCard(cards, 505, 500)
    expect(points).toBe(0)
    expect(countConsecutiveHgssPokeathlonDataCards(cards)).toBe(1)
    expect(buyHgssPokeathlonDataCard(cards, 505, points)).toBe(0)

    for (let index = 1; index < 6; index += 1) cards.add(index)
    expect(getHgssPokeathlonDataCardShop(cards)[0]).toEqual({ itemId: 511, price: 1000 })
    cards.delete(2)
    expect(countConsecutiveHgssPokeathlonDataCards(cards)).toBe(2)
    expect(getHgssPokeathlonDataCardShop(cards)[0]).toEqual({ itemId: 505, price: 500 })
  })
})
