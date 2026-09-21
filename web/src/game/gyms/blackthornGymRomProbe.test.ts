import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readRomInventory } from '../../nds'
import { blackthornMagmaMetatileBehavior } from './blackthornGymMechanism'

const romPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const probe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip

describe('Blackthorn Gym ROM data', () => {
  probe('locks the mechanism collision behavior and platform assets to map 141', async () => {
    const buffer = await readFile(romPath)
    const inventory = await readRomInventory(new File([buffer], basename(romPath)))
    const map = inventory.resolvedMapCatalog.maps.find(({ id }) => id === 141)
    expect(map?.terrain).toBeTruthy()
    const terrain = map!.terrain!
    const behaviorCounts = new Map<number, number>()
    for (const attribute of terrain.attributes) {
      const behavior = attribute & 0xff
      behaviorCounts.set(behavior, (behaviorCounts.get(behavior) ?? 0) + 1)
    }
    expect({ width: terrain.width, height: terrain.height }).toEqual({ width: 32, height: 96 })
    expect([...behaviorCounts].sort(([a], [b]) => a - b)).toEqual([
      [0, 1999],
      [blackthornMagmaMetatileBehavior, 1068],
      [101, 1],
      [103, 4],
    ])
    expect([120, 121, 120].map((modelId) => inventory.mapPropModelResolver?.(modelId, map!.header.areaDataBank, 'room')).every(Boolean)).toBe(true)
    for (const modelId of [154, 155, 156]) {
      const metadata = inventory.mapPropAnimationMetadataResolver?.(modelId, 'room')
      expect(metadata).toMatchObject({ hasAnimations: true, flags: 0, controlValue: 0x01020000, animationArchiveIds: [104, 105] })
      expect(metadata?.animationArchiveIds.map((archiveId) => inventory.mapPropAnimationResolver?.(modelId, map!.header.areaDataBank, archiveId, 'room')?.frames.length)).toEqual([481, 481])
    }
  }, 120_000)
})
