import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readRomInventory } from '../../nds'
import { resolveHgssAmbientObjectBehavior } from './hgssAmbientObjectMovement'

const romPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const romProbe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip

describe('HGSS autonomous map-object ROM inventory', () => {
  romProbe('covers every movement type used by all decoded maps', async () => {
    const buffer = await readFile(romPath)
    const inventory = await readRomInventory(new File([buffer], basename(romPath)))
    const counts = new Map<number, number>()
    for (const object of inventory.resolvedMapCatalog.maps.flatMap((map) => map.events?.objects ?? [])) {
      counts.set(object.movement, (counts.get(object.movement) ?? 0) + 1)
    }

    expect([...counts].sort(([left], [right]) => left - right)).toEqual([
      [0, 1329], [2, 97], [3, 153], [4, 36], [5, 72], [6, 8], [7, 12], [8, 17], [9, 14],
      [10, 5], [11, 1], [13, 3], [14, 134], [15, 449], [16, 125], [17, 159], [18, 6], [19, 3],
      [20, 27], [38, 1], [39, 2], [41, 1], [42, 1], [44, 3], [45, 2], [46, 1], [53, 6],
    ])

    const positionalMovementTypes = [...counts.keys()]
      .filter((movement) => resolveHgssAmbientObjectBehavior(movement).kind !== 'still')
      .sort((left, right) => left - right)
    expect(positionalMovementTypes).toEqual([
      2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 18, 19, 20, 38, 39, 41, 42, 44, 45, 46,
    ])
    expect([...counts.keys()].filter((movement) => resolveHgssAmbientObjectBehavior(movement).kind === 'still').sort((left, right) => left - right)).toEqual([0, 53])
  }, 120000)
})
