import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readRomInventory } from '../../nds'
import { hgssNativeWaterTextureAnimationNames, isHgssNativeWaterTextureAnimation } from './hgssNativeFieldSurface'

const romPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const probe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip

describe('HGSS native field surface animation inventory', () => {
  probe('keeps the animated surface names and timings sourced from fldtanime', async () => {
    const buffer = await readFile(romPath)
    const inventory = await readRomInventory(new File([buffer], basename(romPath)))
    const animations = Object.values(inventory.fieldTextureAnimations ?? {})
    expect(animations.map((animation) => ({
      name: animation.name,
      durations: animation.frames.map(({ durationFrames }) => durationFrames),
    }))).toEqual([
      { name: 'sea_on', durations: [18, 18, 18, 18, 18, 18] },
      { name: 'swave_p', durations: [12, 4, 4, 2, 2, 38, 4, 4, 4, 4, 12] },
      { name: 'swave_un', durations: [40, 39, 5, 6] },
      { name: 'sea_rock', durations: [8, 8, 8, 8, 8, 10, 8, 8, 8, 8, 8] },
      { name: 'sea_rock_m', durations: [8, 8, 8, 8, 8, 10, 8, 8, 8, 8, 8] },
      { name: 'flower01', durations: [18, 18, 18, 18] },
      { name: 'flower02', durations: [18, 18, 18, 18] },
      { name: 'dsea_on', durations: [18, 18, 18, 18, 18, 18] },
      { name: 'r_sea_rock', durations: [8, 8, 8, 8, 8, 10, 8, 8, 8, 8, 8] },
    ])
    expect(animations.filter(isHgssNativeWaterTextureAnimation).map(({ name }) => name)).toEqual(hgssNativeWaterTextureAnimationNames)
    expect(animations.find(({ name }) => name === 'swave_p')?.frames.map(({ texture }) => texture.name)).toEqual([
      'swave_p.1', 'swave_p.2', 'swave_p.3', 'swave_p.4', 'swave_p.5', 'swave_p.6',
      'swave_p.5', 'swave_p.4', 'swave_p.3', 'swave_p.2', 'swave_p.1',
    ])
    expect(animations.filter(isHgssNativeWaterTextureAnimation).every((animation) => (
      inventory.resolvedMapCatalog.maps.some((map) => map.model?.surfaces?.some((surface) => surface.textureName === animation.name))
    ))).toBe(true)
    expect(animations.every(({ frames }) => frames.length > 0 && frames.every(({ durationFrames }) => durationFrames > 0))).toBe(true)
  }, 120_000)
})
