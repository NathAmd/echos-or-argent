import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readRomInventory } from '../../nds'
import type { NitroGraphic } from '../../ndsTypes'
import {
  HGSS_SAFARI_CUSTOMIZER_UI_ARCHIVE_PATH,
  HGSS_SAFARI_DECORATOR_UI_ARCHIVE_PATH,
  type HgssSafariCellSpriteAsset,
} from './safariUiAssets'

const defaultRomPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const romPath = process.env.ROM_AUDIT_PATH ? resolve(process.env.ROM_AUDIT_PATH) : defaultRomPath
const probe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip

const customizerMemberSizes = [
  294, 4160, 2084, 2084, 2084, 600, 4160, 2084, 2084, 2084, 2084,
  192, 11056, 566, 438, 570, 107, 111,
  ...Array.from({ length: 12 }, () => 4160),
]
const decoratorMemberSizes = [124, 4160, 1572, 1572, 226, 3136, 2084, 2084, 2084, 124, 5680, 491, 515]

function checksum(graphic: NitroGraphic): number {
  let hash = 0x811c9dc5
  for (const value of graphic.pixels) {
    hash ^= value
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function summarizeSprite(sprite: HgssSafariCellSpriteAsset) {
  return {
    members: [sprite.paletteMemberId, sprite.characterMemberId, sprite.cellMemberId, sprite.animationMemberId],
    paletteColors: sprite.palette.length,
    cells: sprite.cells.length,
    frames: sprite.frames.map(({ width, height }) => `${width}x${height}`),
    sequences: sprite.animation.sequences.length,
    declaredAnimationFrames: sprite.animation.declaredFrameCount,
  }
}

describe('HGSS Safari native UI ROM inventory', () => {
  probe('decodes every customizer and decorator layer, cell and animation from the French ROM', async () => {
    const bytes = await readFile(romPath)
    const inventory = await readRomInventory(new File([bytes], basename(romPath)))
    const customizerArchive = inventory.files.find(({ path }) => path === HGSS_SAFARI_CUSTOMIZER_UI_ARCHIVE_PATH)
    const decoratorArchive = inventory.files.find(({ path }) => path === HGSS_SAFARI_DECORATOR_UI_ARCHIVE_PATH)

    expect(customizerArchive).toMatchObject({ size: 87064, archiveEntries: 30 })
    expect(customizerArchive!.archiveMembers.map(({ index, size }) => ({ index, size }))).toEqual(
      customizerMemberSizes.map((size, index) => ({ index, size })),
    )
    expect(decoratorArchive).toMatchObject({ size: 24012, archiveEntries: 13 })
    expect(decoratorArchive!.archiveMembers.map(({ index, size }) => ({ index, size }))).toEqual(
      decoratorMemberSizes.map((size, index) => ({ index, size })),
    )
    expect(inventory.uiMessageBanks[429]).toMatchObject({
      0: 'Que voulez-vous faire?',
      1: 'Echanger avec quelle zone?',
      2: 'La mettre où?',
      3: 'Les Blocs posés seront retirés.\nContinuer?',
      4: 'RETOUR',
      6: 'ANNULER',
      7: 'ECHANGER',
      8: 'ORDRE',
      16: 'Prairie',
      27: 'Désert',
    })
    expect(inventory.uiMessageBanks[430]).toMatchObject({
      0: 'Poser Bloc {108 0,0}?',
      8: 'Retour',
      12: '{132 0,0}/{132 1,0}',
      14: 'Bosquet',
      61: 'Un panier pour jeter les déchets.\nUtilisons-le, ou ramenons les ordures\nà la maison!',
    })

    const { customizer, decorator } = inventory.safariUiAssets
    expect(customizer.backgroundGroups.map(({ layers }) => layers.length)).toEqual([3, 4])
    expect(decorator.backgroundGroups.map(({ layers }) => layers.length)).toEqual([2, 3])
    expect(customizer.backgroundGroups.map(({ palette, layers }) => ({
      paletteColors: palette.length,
      sizes: layers.map(({ graphic }) => `${graphic.width}x${graphic.height}`),
      checksums: layers.map(({ graphic }) => checksum(graphic)),
    }))).toEqual([
      { paletteColors: 112, sizes: ['256x256', '256x256', '256x256'], checksums: [2453476699, 3251330611, 3002820981] },
      { paletteColors: 256, sizes: ['256x256', '256x256', '256x256', '256x256'], checksums: [2285749333, 60240757, 2021712005, 1833063029] },
    ])
    expect(decorator.backgroundGroups.map(({ palette, layers }) => ({
      paletteColors: palette.length,
      sizes: layers.map(({ graphic }) => `${graphic.width}x${graphic.height}`),
      checksums: layers.map(({ graphic }) => checksum(graphic)),
    }))).toEqual([
      { paletteColors: 32, sizes: ['256x192', '256x192'], checksums: [1683763037, 626263729] },
      { paletteColors: 80, sizes: ['256x256', '256x256', '256x256'], checksums: [2687775765, 480789445, 4096973581] },
    ])
    expect(summarizeSprite(customizer.objectSprites)).toEqual({
      members: [11, 12, 13, 14],
      paletteColors: 64,
      cells: 13,
      frames: ['80x80', '64x32', '80x80', '80x80', '32x32', '32x32', '32x32', '32x32', '32x32', '32x32', '64x32', '64x32', '64x32'],
      sequences: 8,
      declaredAnimationFrames: 12,
    })
    expect(customizer.objectSprites.animation.sequences.map(({ frames }) => frames.map(({ cellIndex }) => cellIndex))).toEqual([
      [0], [1], [2], [3], [4, 6, 4], [5, 7, 5], [8], [9],
    ])
    expect(summarizeSprite(decorator.objectSprites)).toEqual({
      members: [9, 10, 11, 12],
      paletteColors: 32,
      cells: 11,
      frames: ['128x32', '64x32', '32x32', '32x32', '32x32', '32x32', '32x32', '32x32', '64x32', '64x32', '64x32'],
      sequences: 11,
      declaredAnimationFrames: 14,
    })
    expect(decorator.objectSprites.animation.sequences.map(({ frames }) => frames.map(({ cellIndex }) => cellIndex))).toEqual([
      [0], [1], [8], [9, 8, 9, 8], [10], [2], [3], [4], [5], [6], [7],
    ])
    expect(customizer.areaPreviews).toHaveLength(12)
    expect(customizer.areaPreviews.map(({ areaId, characterMemberId }) => ({ areaId, characterMemberId }))).toEqual(
      Array.from({ length: 12 }, (_, areaId) => ({ areaId, characterMemberId: areaId + 18 })),
    )

    const allLayers = [
      ...customizer.backgroundGroups.flatMap(({ layers }) => layers),
      ...decorator.backgroundGroups.flatMap(({ layers }) => layers),
    ]
    expect(allLayers.every(({ graphic }) => graphic.width > 0 && graphic.height > 0 && graphic.pixels.some((value) => value !== 0))).toBe(true)
    const areaPreviewChecksums = customizer.areaPreviews.map(({ frames }) => checksum(frames[0]!))
    expect(areaPreviewChecksums).toEqual([
      718897699, 2615369744, 2669940501, 1529589190, 188454057, 472690490,
      346772417, 2577909178, 172322153, 1739652183, 1569151941, 2014339201,
    ])
    expect(customizer.areaPreviews.every(({ frames }) => frames.length === 1 && frames[0]!.width === 64 && frames[0]!.height === 64)).toBe(true)
    expect(customizer.areaPreviews.every(({ cells, frames, animation }) => (
      cells.length > 0 && frames.length === cells.length && animation.sequences.length > 0
    ))).toBe(true)

    console.log(JSON.stringify({
      customizerBackgrounds: customizer.backgroundGroups.map((group) => ({
        members: [group.paletteMemberId, group.characterMemberId],
        paletteColors: group.palette.length,
        layers: group.layers.map(({ screenMemberId, graphic }) => ({ screenMemberId, size: `${graphic.width}x${graphic.height}`, checksum: checksum(graphic) })),
      })),
      customizerObjects: summarizeSprite(customizer.objectSprites),
      areaPreviews: customizer.areaPreviews.map(({ areaId, characterMemberId, frames }) => ({
        areaId,
        characterMemberId,
        frames: frames.map(({ width, height }) => `${width}x${height}`),
        checksum: checksum(frames[0]!),
      })),
      decoratorBackgrounds: decorator.backgroundGroups.map((group) => ({
        members: [group.paletteMemberId, group.characterMemberId],
        paletteColors: group.palette.length,
        layers: group.layers.map(({ screenMemberId, graphic }) => ({ screenMemberId, size: `${graphic.width}x${graphic.height}`, checksum: checksum(graphic) })),
      })),
      decoratorObjects: summarizeSprite(decorator.objectSprites),
    }, null, 2))
  }, 180_000)
})
