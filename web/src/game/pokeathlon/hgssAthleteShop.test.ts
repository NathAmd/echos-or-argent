import { describe, expect, it } from 'vitest'
import { getHgssAthleteShop } from './hgssAthleteShop'

describe('HGSS Athlete Shop ROM tables', () => {
  it('uses the Sunday pre-National-Dex assortment and Athlete Point prices', () => {
    expect(getHgssAthleteShop(0, false)).toEqual([
      { itemId: 485, price: 200 },
      { itemId: 487, price: 200 },
      { itemId: 491, price: 200 },
      { itemId: 33, price: 100 },
      { itemId: 221, price: 3000 },
      { itemId: 93, price: 1000 },
    ])
  })

  it('adds the six National Dex prizes for the correct weekday', () => {
    expect(getHgssAthleteShop(3, true).slice(-6)).toEqual([
      { itemId: 23, price: 500 },
      { itemId: 235, price: 2500 },
      { itemId: 83, price: 2500 },
      { itemId: 81, price: 3000 },
      { itemId: 107, price: 3000 },
      { itemId: 109, price: 3000 },
    ])
  })
})
