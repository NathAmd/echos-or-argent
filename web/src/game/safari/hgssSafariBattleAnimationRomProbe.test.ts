import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { readRomInventory } from '../../nds'
import { resolveHgssBattleThrowTiming } from '../battle/battleThrowPlayback'

const romPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const probe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip

probe('verrouille les animations Appât, repas et colère sur les scripts ROM 27 à 29', async () => {
  const romBuffer = await readFile(romPath)
  const inventory = await readRomInventory(new File([romBuffer], basename(romPath)))
  const scripts = inventory.battleAnimationCatalog.battleScripts.slice(27, 30)
  expect(scripts.map(({ id }) => id)).toEqual([27, 28, 29])
  expect(scripts.map(({ instructions }) => instructions.map(({ name, operands }) => [name, [...operands]]))).toEqual([
    [
      ['BeginLoop', [2]], ['PlayPannedSoundEffect', [1821, 117]], ['CallFunc', [57, 4, 4, 0, 8, 264]], ['Delay', [4]],
      ['CallFunc', [57, 4, 4, 0, 0xfffffff8, 264]], ['Delay', [4]], ['EndLoop', []], ['End', []],
    ],
    [
      ['BeginLoop', [2]], ['PlayPannedSoundEffect', [1927, 117]], ['CallFunc', [4, 6, 0xffff, 66445, 10, 2, 0, 32]],
      ['WaitForAnimTasks', []], ['EndLoop', []], ['End', []],
    ],
    [
      ['InitSpriteManager', [0, 7, 2, 2, 2, 2, 0, 0]], ['LoadCharResObj', [0, 11]], ['LoadPlttRes', [0, 11, 1]],
      ['LoadCellResObj', [0, 11]], ['LoadAnimResObj', [0, 11]], ['PlayLoopedSoundEffect', [2027, 117, 10, 2]],
      ['AddSpriteWithFunc', [0, 10, 11, 11, 11, 11, 0, 0, 0]], ['Delay', [16]], ['WaitForAnimTasks', []],
      ['FreeSpriteManager', [0]], ['End', []],
    ],
  ])
}, 120_000)

probe('décode les projectiles Appât et Boue depuis leurs OBJ ROM natifs', async () => {
  const romBuffer = await readFile(romPath)
  const inventory = await readRomInventory(new File([romBuffer], basename(romPath)))
  const assets = (['safari-rock', 'safari-bait'] as const).map((kind) => inventory.battleAnimationCatalog.throwSpriteResolver(kind))
  expect(assets.map((asset) => ({
    kind: asset.kind,
    members: [asset.characterMemberId, asset.paletteMemberId, asset.cellMemberId, asset.animationMemberId],
    frameCount: asset.frames.length,
    sequenceFrameCount: asset.animation.sequences[asset.sequenceIndex]?.frames.length,
    timing: resolveHgssBattleThrowTiming(asset),
  }))).toEqual([
    { kind: 'safari-rock', members: [336, 108, 335, 334], frameCount: 7, sequenceFrameCount: 4, timing: { impactFrame: 3, completionFrame: 12 } },
    { kind: 'safari-bait', members: [339, 109, 338, 337], frameCount: 10, sequenceFrameCount: 1, timing: { impactFrame: 3, completionFrame: 12 } },
  ])
}, 120_000)
