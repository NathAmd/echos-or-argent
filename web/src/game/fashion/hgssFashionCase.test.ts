import { describe, expect, it } from 'vitest'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import {
  canGiveHgssFashionAccessory,
  chooseMissingHgssBargainBackground,
  getHgssFashionAccessoryCapacity,
  giveHgssFashionAccessory,
  hasAllHgssBargainBackgrounds,
  hasRoomForHgssBargainAccessory,
  hgssBargainAccessoryIds,
} from './hgssFashionCase'

describe('HGSS Fashion Case native limits', () => {
  it('caps accessories 0..60 at nine and 61..99 at one', () => {
    expect(getHgssFashionAccessoryCapacity(60)).toBe(9)
    expect(getHgssFashionAccessoryCapacity(61)).toBe(1)
    expect(canGiveHgssFashionAccessory(new Map([[60, 8], [61, 1]]), 60, 1)).toBe(true)
    expect(canGiveHgssFashionAccessory(new Map([[61, 1]]), 61, 1)).toBe(false)
  })

  it('recognizes a full bargain pool and clamps grants like FashionCase_GiveFashionItem', () => {
    const inventory = new Map(hgssBargainAccessoryIds.map((id) => [id, id < 61 ? 9 : 1]))
    expect(hasRoomForHgssBargainAccessory(inventory)).toBe(false)
    giveHgssFashionAccessory(inventory, 47, 10)
    expect(inventory.get(47)).toBe(9)
  })

  it('selects only among missing bargain backgrounds', () => {
    const backgrounds = new Set(Array.from({ length: 14 }, (_, id) => id).filter((id) => id !== 7))
    expect(hasAllHgssBargainBackgrounds(backgrounds)).toBe(false)
    expect(chooseMissingHgssBargainBackground(backgrounds, createHgssLcrng(1))).toBe(7)
  })
})
