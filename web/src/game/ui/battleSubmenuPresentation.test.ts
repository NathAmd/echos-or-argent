import { describe, expect, it } from 'vitest'
import { resolveBattleCarouselSlot, resolveBattlePartyArcPosition } from './battleSubmenuPresentation'

describe('battle bag carousel', () => {
  it('keeps at most five consecutive items around the selection', () => {
    const slots = Array.from({ length: 8 }, (_, index) => resolveBattleCarouselSlot(index, 0, 8))

    expect(slots).toEqual([0, 1, 2, undefined, undefined, undefined, -2, -1])
    expect(slots.filter((slot) => slot !== undefined)).toHaveLength(5)
  })

  it('wraps the visible window around either end of the inventory', () => {
    const lastSelected = Array.from({ length: 8 }, (_, index) => resolveBattleCarouselSlot(index, 7, 8))
    const firstSelected = Array.from({ length: 8 }, (_, index) => resolveBattleCarouselSlot(index, 0, 8))

    expect(lastSelected[0]).toBe(1)
    expect(lastSelected[1]).toBe(2)
    expect(lastSelected[7]).toBe(0)
    expect(firstSelected[7]).toBe(-1)
  })

  it('shows every item when the bag contains fewer than five entries', () => {
    const slots = Array.from({ length: 3 }, (_, index) => resolveBattleCarouselSlot(index, 1, 3))

    expect(slots).toEqual([-1, 0, 1])
  })
})

describe('battle party arc', () => {
  it('places all six party members on fixed symmetric positions', () => {
    const positions = Array.from({ length: 6 }, (_, index) => resolveBattlePartyArcPosition(index, 6)!)

    expect(positions.map(({ centeredPosition }) => centeredPosition)).toEqual([0, 1, 2, 3, 4, 5])
    expect(positions[0]!.horizontalOffset).toBeCloseTo(positions[5]!.horizontalOffset)
    expect(positions[1]!.horizontalOffset).toBeCloseTo(positions[4]!.horizontalOffset)
    expect(positions.map(({ tilt }) => tilt)).toEqual([-5, -3, -1, 1, 3, 5])
  })

  it('centers a smaller party without changing positions during selection', () => {
    const positions = Array.from({ length: 3 }, (_, index) => resolveBattlePartyArcPosition(index, 3)!)

    expect(positions.map(({ centeredPosition }) => centeredPosition)).toEqual([1.5, 2.5, 3.5])
    expect(resolveBattlePartyArcPosition(3, 3)).toBeUndefined()
  })
})
