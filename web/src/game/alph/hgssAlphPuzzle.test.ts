import { describe, expect, it } from 'vitest'
import { canPlaceHgssAlphPuzzleTile, createHgssAlphPuzzleTiles, isHgssAlphPuzzleComplete } from './hgssAlphPuzzle'

describe('HGSS Ruins of Alph puzzle', () => {
  it('reproduit les quatre dispositions 6x6 natives sans dupliquer de pièce', () => {
    for (let puzzle = 0; puzzle < 4; puzzle += 1) {
      const tiles = createHgssAlphPuzzleTiles(puzzle)
      expect(tiles.map(({ tileIndex }) => tileIndex).sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, index) => index))
      expect(isHgssAlphPuzzleComplete(tiles)).toBe(false)
    }
  })

  it('applique les cases interdites et la condition de résolution native', () => {
    const tiles = createHgssAlphPuzzleTiles(0)
    expect(canPlaceHgssAlphPuzzleTile(tiles, 5, 0, 0)).toBe(false)
    expect(canPlaceHgssAlphPuzzleTile(tiles, 5, 5, 5)).toBe(false)
    const solved = tiles.map((tile) => ({ ...tile, x: tile.tileIndex % 4 + 1, y: Math.floor(tile.tileIndex / 4) + 1, rotation: 0 }))
    expect(isHgssAlphPuzzleComplete(solved)).toBe(true)
  })
})
