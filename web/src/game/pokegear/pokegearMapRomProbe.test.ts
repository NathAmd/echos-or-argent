import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readRomInventory } from '../../nds'
import { hgssPokegearFlypointCount, hgssPokegearMapLocationCount } from '../../rom/pokegear/mapData'

const romPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const probe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip

describe('Carte du Pokematos issue de la ROM chargee', () => {
  probe('conserve un canevas 47 x 20 commun a Johto, Indigo et Kanto', async () => {
    const bytes = await readFile(romPath)
    const inventory = await readRomInventory(new File([bytes], basename(romPath)))
    const { locations, flypoints } = inventory.pokegearMapData

    expect(locations).toHaveLength(hgssPokegearMapLocationCount)
    expect(flypoints).toHaveLength(hgssPokegearFlypointCount)
    expect(inventory.uiAssets.pokegearMapBackgrounds.length).toBeGreaterThan(0)
    expect(inventory.uiAssets.pokegearMapBackgrounds.every(({ width, height }) => width === 47 * 8 && height === 20 * 8)).toBe(true)
    expect(locations.every(({ x, y, width, height }) => (
      x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= 47 && y + height <= 20
    ))).toBe(true)
    expect(flypoints.every(({ x, y, width, height }) => (
      x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= 47 && y + height + 2 <= 20
    ))).toBe(true)
    expect(locations.some(({ x }) => x <= 21)).toBe(true)
    expect(locations.some(({ x }) => x > 28)).toBe(true)
  }, 60_000)
})
