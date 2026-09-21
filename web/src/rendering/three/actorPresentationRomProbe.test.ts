import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readRomInventory } from '../../nds'
import { resolveActorSpriteDepthMode } from './actorGroundPresentation'

const romPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const probe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip

describe('actor presentation ROM inventory', () => {
  probe('keeps Olivine actor and prop density bounded by the decoded map resources', async () => {
    const bytes = await readFile(romPath)
    const inventory = await readRomInventory(new File([bytes], basename(romPath)))
    const maps = inventory.resolvedMapCatalog.maps.filter(({ label }) => /oliv/i.test(label))
    const summary = maps.map((map) => ({
      id: map.id,
      label: map.label,
      actors: map.events?.objects.length ?? 0,
      props: map.model?.mapProps?.length ?? 0,
      surfaces: map.model?.surfaces?.length ?? 0,
      matrix: `${map.matrix.width}x${map.matrix.height}`,
      matrixCells: map.matrix.headers.length,
    }))
    expect(maps).toHaveLength(11)
    expect(summary.find(({ id }) => id === 77)).toEqual({
      id: 77,
      label: 'Oliville',
      actors: 9,
      props: 32,
      surfaces: 155,
      matrix: '47x17',
      matrixCells: 799,
    })
    expect(summary.every(({ actors }) => actors < 128)).toBe(true)
    expect(resolveActorSpriteDepthMode(maps.find(({ id }) => id === 77))).toBe('upright')
    expect(maps.every((map) => resolveActorSpriteDepthMode(map) === 'upright')).toBe(true)
    expect(resolveActorSpriteDepthMode(maps.find(({ id }) => id === 226))).toBe('upright')
  }, 120_000)
})
