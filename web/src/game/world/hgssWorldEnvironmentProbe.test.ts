import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readRomInventory } from '../../nds'

const romPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const probe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip

describe('sonde environnement de la ROM française', () => {
  probe('retrouve les météos des headers et décode la variante du mercredi', async () => {
    const romBuffer = await readFile(romPath)
    const inventory = await readRomInventory(new File([romBuffer], basename(romPath)))
    const weatherByMap = new Map(inventory.resolvedMapCatalog.maps.map((map) => [map.id, map.header.weather]))
    expect([...weatherByMap].filter(([, weather]) => weather !== 0)).toEqual([
      [37, 1], [88, 1],
      [108, 11], [121, 11], [123, 11], [145, 11], [176, 11], [242, 11],
      [278, 13], [450, 11], [451, 11], [452, 11],
      [465, 5], [521, 5],
    ])

    const lake = inventory.resolvedMapCatalog.maps.find((map) => map.id === 88)
    expect(lake).toBeDefined()
    const variant = lake && inventory.mapVariantResolver?.(lake, { weekday: 3, rocketHideoutCleared: true })
    expect(variant?.model).toBeDefined()
    expect(variant?.terrain).toBeDefined()
    expect([
      variant?.matrix.modelIds[variant.matrix.width + 15],
      variant?.matrix.modelIds[variant.matrix.width + 16],
      variant?.matrix.modelIds[variant.matrix.width + 17],
      variant?.matrix.modelIds[variant.matrix.width * 2 + 15],
      variant?.matrix.modelIds[variant.matrix.width * 2 + 16],
      variant?.matrix.modelIds[variant.matrix.width * 2 + 17],
    ]).toEqual([95, 96, 97, 98, 99, 100])
  }, 120_000)
})
