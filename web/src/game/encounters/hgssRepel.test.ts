import { describe, expect, it } from 'vitest'
import type { HgssItemData } from '../../rom/items/itemData'
import { createHgssRoamerSaveState } from './hgssRoamers'
import { advanceHgssRepelStep, getHgssRepelStepCount, isHgssEncounterRepelled, useHgssRepel } from './hgssRepel'

const item = (itemId: number, name: string): HgssItemData => ({ itemId, name } as HgssItemData)

describe('HGSS Repel', () => {
  it('uses the durations confirmed by the decoded ROM item catalog', () => {
    expect([76, 77, 79].map(getHgssRepelStepCount)).toEqual([200, 250, 100])
  })

  it('consumes one item, replaces the counter, and expires on the final protected step', () => {
    const inventory = new Map([[79, 2]])
    const state = createHgssRoamerSaveState()
    state.repelSteps = 4
    expect(useHgssRepel(inventory, item(79, 'Repousse'), state)).toEqual({ kind: 'used', steps: 100, remaining: 1 })
    state.repelSteps = 1
    expect(advanceHgssRepelStep(state)).toEqual({ protected: true, expired: true, blocksEncounter: true })
    expect(state.repelSteps).toBe(0)
    expect(advanceHgssRepelStep(state)).toEqual({ protected: false, expired: false, blocksEncounter: false })
  })

  it('only rejects wild Pokémon below the first party level', () => {
    expect(isHgssEncounterRepelled(true, 4, 5)).toBe(true)
    expect(isHgssEncounterRepelled(true, 5, 5)).toBe(false)
    expect(isHgssEncounterRepelled(false, 4, 5)).toBe(false)
  })
})
