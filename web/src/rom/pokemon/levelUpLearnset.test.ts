import { describe, expect, it } from 'vitest'
import {
  decodePokemonLevelUpLearnset,
  deriveInitialMoveIds,
  hgssLevelUpLearnsetEnd,
} from './levelUpLearnset'

function encodeLearnset(entries: ReadonlyArray<readonly [level: number, moveId: number]>): Uint8Array {
  const payload = new Uint8Array((entries.length + 1) * 2)
  const view = new DataView(payload.buffer)
  entries.forEach(([level, moveId], index) => view.setUint16(index * 2, (level << 9) | moveId, true))
  view.setUint16(entries.length * 2, hgssLevelUpLearnsetEnd, true)
  return payload
}

describe('HGSS Pokemon level-up learnsets', () => {
  it('decodes packed move and level fields up to the final terminator', () => {
    expect(decodePokemonLevelUpLearnset(encodeLearnset([[1, 33], [5, 45], [12, 0x1ff]]), 152)).toEqual([
      { level: 1, moveId: 33 },
      { level: 5, moveId: 45 },
      { level: 12, moveId: 0x1ff },
    ])
  })

  it('derives the four current moves with HGSS append and replacement semantics', () => {
    const learnset = decodePokemonLevelUpLearnset(
      encodeLearnset([[1, 1], [1, 2], [3, 3], [4, 4], [5, 2], [5, 5], [6, 6]]),
      1,
    )
    expect(deriveInitialMoveIds(learnset, 5)).toEqual([2, 3, 4, 5])
  })

  it('rejects malformed members and invalid levels', () => {
    expect(() => decodePokemonLevelUpLearnset(new Uint8Array([1]), 1)).toThrow('taille impaire')
    expect(() => decodePokemonLevelUpLearnset(new Uint8Array([1, 0]), 1)).toThrow('pas de terminateur')
    expect(decodePokemonLevelUpLearnset(new Uint8Array([0xff, 0xff, 0, 0]), 1)).toEqual([])
    expect(() => decodePokemonLevelUpLearnset(new Uint8Array([0xff, 0xff, 1, 0]), 1)).toThrow('apres son terminateur')
    expect(() => deriveInitialMoveIds([], 0)).toThrow('niveau Pokemon')
  })
})