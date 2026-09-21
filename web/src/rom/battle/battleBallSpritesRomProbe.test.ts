import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { readRomInventory } from '../../nds'

const romPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const probe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip

probe('décode les Balls normale, Safari et Fargas depuis la LUT OBJ de la ROM', async () => {
  const romBuffer = await readFile(romPath)
  const inventory = await readRomInventory(new File([romBuffer], basename(romPath)))
  const summaries = [1, 4, 5, 17, 24].map((ballId) => {
    const asset = inventory.battleAnimationCatalog.ballSpriteResolver(ballId)
    return {
      ballId,
      members: [asset.characterMemberId, asset.paletteMemberId, asset.cellMemberId, asset.animationMemberId],
      cellCount: asset.frames.length,
      sequences: asset.animation.sequences.map((sequence) => ({
        frames: sequence.frames.map(({ cellIndex, durationFrames }) => [cellIndex, durationFrames]),
        playbackMode: sequence.playbackMode,
      })),
    }
  })
  expect(summaries).toEqual([
    { ballId: 1, members: [261, 83, 260, 259], cellCount: 10, sequences: [
      { frames: [[0, 2], [1, 2], [2, 6], [3, 2], [4, 2], [5, 2], [6, 6], [7, 2]], playbackMode: 2 },
      { frames: [[0, 10], [8, 10], [9, 50]], playbackMode: 1 },
    ] },
    { ballId: 4, members: [270, 86, 269, 268], cellCount: 10, sequences: [
      { frames: [[0, 2], [1, 2], [2, 6], [3, 2], [4, 2], [5, 2], [6, 6], [7, 2]], playbackMode: 2 },
      { frames: [[0, 10], [8, 10], [9, 50]], playbackMode: 1 },
    ] },
    { ballId: 5, members: [273, 87, 272, 271], cellCount: 10, sequences: [
      { frames: [[0, 2], [1, 2], [2, 6], [3, 2], [4, 2], [5, 2], [6, 6], [7, 2]], playbackMode: 2 },
      { frames: [[0, 10], [8, 10], [9, 50]], playbackMode: 1 },
    ] },
    { ballId: 17, members: [309, 99, 308, 307], cellCount: 10, sequences: [
      { frames: [[0, 2], [1, 2], [2, 6], [3, 2], [4, 2], [5, 2], [6, 6], [7, 2]], playbackMode: 2 },
      { frames: [[0, 10], [8, 10], [9, 50]], playbackMode: 1 },
    ] },
    { ballId: 24, members: [330, 106, 329, 328], cellCount: 10, sequences: [
      { frames: [[0, 2], [1, 2], [2, 6], [3, 2], [4, 2], [5, 2], [6, 6], [7, 2]], playbackMode: 2 },
      { frames: [[0, 10], [8, 10], [9, 50]], playbackMode: 1 },
    ] },
  ])
}, 120_000)
