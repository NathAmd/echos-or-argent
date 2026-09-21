import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readRomInventory } from '../../nds'
import type { NitroModelPreview } from '../../ndsTypes'
import { classifyNitroTextureAlpha, type NitroTextureAlphaMode } from './nitroMaterialTransparency'

const romPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const probe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip

describe('Nitro material transparency ROM probe', () => {
  probe('finds native cutout and blended alpha in decoded HGSS model textures', async () => {
    const bytes = await readFile(romPath)
    const inventory = await readRomInventory(new File([bytes], basename(romPath)))
    const models: NitroModelPreview[] = [
      ...inventory.resolvedMapCatalog.maps.flatMap(({ model }) => model ? [model] : []),
      ...(inventory.openingMovieModels ?? []),
      ...(inventory.titleLegendModel ? [inventory.titleLegendModel] : []),
      ...(inventory.titleSparklesModel ? [inventory.titleSparklesModel] : []),
      ...(inventory.starterMachineModel ? [inventory.starterMachineModel] : []),
    ]
    const counts: Record<NitroTextureAlphaMode, number> = { opaque: 0, cutout: 0, blend: 0 }
    for (const model of models) {
      for (const texture of model.textures ?? []) counts[classifyNitroTextureAlpha(texture.pixels)] += 1
    }

    expect(counts.opaque).toBeGreaterThan(0)
    expect(counts.cutout).toBeGreaterThan(0)
    expect(counts.blend).toBeGreaterThan(0)
  }, 120_000)
})
