import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readRomInventory } from '../../nds'
import { findStrengthHoleTiles } from './strengthBoulderMechanism'

const romPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const probe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip

describe('Ice Path ROM mechanism audit', () => {
  probe('resolves native holes, boulder states, and the area-selected stair model', async () => {
    const romBuffer = await readFile(romPath)
    const inventory = await readRomInventory(new File([romBuffer], basename(romPath)))
    const maps = inventory.resolvedMapCatalog.maps
    const upper = maps.find((map) => map.id === 237)!
    const lower = maps.find((map) => map.id === 238)!

    expect([...findStrengthHoleTiles(upper)].sort()).toEqual(['10:18', '11:10', '18:7', '19:19'])
    expect(upper.events?.objects.filter((object) => object.spriteId === 84 && object.scriptId === 10002 && object.eventFlag > 0).map((object) => object.eventFlag)).toEqual([490, 491, 492, 493])
    expect(lower.events?.objects.filter((object) => object.spriteId === 84).map((object) => object.eventFlag)).toEqual([494, 495, 496, 497])

    const stair = inventory.mapPropModelResolver?.(70, upper.header.areaDataBank, 'room')
    expect(stair?.surfaces?.some((surface) => surface.materialName === 'dun_stairdw')).toBe(true)
    expect(stair?.surfaces?.some((surface) => surface.materialName === 'shelf07_mat')).toBe(false)
  }, 120000)
})
