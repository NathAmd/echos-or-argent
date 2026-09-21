export type HgssAlphPuzzleTile = {
  tileIndex: number
  x: number
  y: number
  rotation: number
  immovable: boolean
}

export const hgssAlphPuzzleCount = 4
export const hgssAlphPuzzleFlags = [0x977, 0x978, 0x979, 0x97a] as const

type TileSeed = readonly [index: number, rotation: number, immovable: boolean]
type CellSeed = TileSeed | undefined

// Literal 6x6 tables from alph_puzzle.c. Undefined entries are the native
// blank cells surrounding the 4x4 target square.
const layouts: readonly (readonly CellSeed[])[] = [
  [
    undefined, undefined, undefined, undefined, undefined, undefined,
    [6, 1, false], [1, 0, true], undefined, [3, 0, true], [4, 0, true], undefined,
    undefined, [5, 0, true], undefined, [7, 0, true], [8, 0, true], [11, 2, false],
    undefined, undefined, [10, 0, true], undefined, [12, 0, true], undefined,
    [2, 3, false], [13, 0, true], [14, 0, true], [15, 0, true], [16, 0, true], undefined,
    undefined, undefined, undefined, undefined, [9, 1, false], undefined,
  ],
  [
    undefined, [10, 3, false], undefined, [14, 2, false], undefined, undefined,
    undefined, undefined, undefined, [3, 0, true], [4, 0, true], undefined,
    undefined, undefined, undefined, [7, 0, true], [8, 0, true], [16, 3, false],
    [2, 3, false], [9, 0, true], undefined, [11, 0, true], [12, 0, true], undefined,
    undefined, [13, 0, true], undefined, [15, 0, true], undefined, [6, 2, false],
    undefined, undefined, [1, 2, false], undefined, [5, 1, false], undefined,
  ],
  [
    undefined, undefined, [11, 1, false], undefined, [10, 0, false], undefined,
    [9, 0, false], undefined, [2, 0, true], [3, 0, true], [4, 0, true], undefined,
    undefined, [5, 0, true], [6, 0, true], undefined, undefined, [14, 2, false],
    [8, 0, false], undefined, undefined, undefined, undefined, [13, 3, false],
    [1, 3, false], undefined, undefined, [15, 0, true], [16, 0, true], undefined,
    undefined, [7, 2, false], [12, 1, false], undefined, undefined, undefined,
  ],
  [
    undefined, undefined, [9, 0, false], [14, 3, false], [1, 3, false], undefined,
    [15, 2, false], undefined, undefined, [3, 0, true], [4, 0, true], undefined,
    [13, 2, false], [5, 0, true], [6, 0, true], [7, 0, true], undefined, [10, 3, false],
    [2, 3, false], undefined, undefined, undefined, [12, 0, true], undefined,
    undefined, undefined, undefined, undefined, [16, 0, true], [11, 3, false],
    undefined, [5, 2, false], [8, 1, false], undefined, undefined, undefined,
  ],
]

export function createHgssAlphPuzzleTiles(puzzleIndex: number): HgssAlphPuzzleTile[] {
  const layout = layouts[puzzleIndex]
  if (!layout) throw new Error(`Puzzle des Ruines d’Alpha HGSS ${puzzleIndex} invalide.`)
  const tiles: Array<HgssAlphPuzzleTile | undefined> = Array.from({ length: 16 })
  layout.forEach((seed, position) => {
    if (!seed) return
    const [index, rotation, immovable] = seed
    tiles[index - 1] = { tileIndex: index - 1, x: position % 6, y: Math.floor(position / 6), rotation, immovable }
  })
  if (tiles.some((tile) => tile === undefined)) throw new Error(`Disposition native incomplète pour le puzzle ${puzzleIndex}.`)
  return tiles as HgssAlphPuzzleTile[]
}

export function isHgssAlphPuzzleComplete(tiles: readonly HgssAlphPuzzleTile[]): boolean {
  return tiles.length === 16 && tiles.every((tile) => (
    tile.rotation === 0
    && tile.x === (tile.tileIndex % 4) + 1
    && tile.y === Math.floor(tile.tileIndex / 4) + 1
  ))
}

export function canPlaceHgssAlphPuzzleTile(tiles: readonly HgssAlphPuzzleTile[], tileIndex: number, x: number, y: number): boolean {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x > 5 || y < 0 || y > 5) return false
  if ((x === 0 || x === 5) && (y === 0 || y === 5)) return false
  return !tiles.some((tile) => tile.tileIndex !== tileIndex && tile.x === x && tile.y === y)
}
