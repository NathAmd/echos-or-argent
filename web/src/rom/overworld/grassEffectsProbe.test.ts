import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readRomInventory } from '../../nds'

const romPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const probe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip

describe('effets d herbe de la ROM HGSS', () => {
  probe('lie les NSBMD, BTX et timelines natives des deux comportements terrain', async () => {
    const bytes = await readFile(romPath)
    const inventory = await readRomInventory(new File([bytes], basename(romPath)))
    const tallGrass = inventory.grassEffectResolver('tallGrass')
    const veryTallGrass = inventory.grassEffectResolver('veryTallGrass')

    expect(tallGrass.model.modelId).toBe(126)
    expect(tallGrass.textures.map((texture) => texture.name)).toEqual(['kusaeff.1', 'kusaeff.2', 'kusaeff.3', 'kusaeff.4'])
    expect(tallGrass.timeline).toEqual({ keyFrames: [0, 4, 8, 12], textureIndexes: [0, 1, 2, 3], paletteIndexes: [0, 0, 0, 0] })
    expect(veryTallGrass.model.modelId).toBe(122)
    expect(veryTallGrass.textures.map((texture) => texture.name)).toEqual(['lgrass_ani1.1', 'lgrass_ani1.2'])
    expect(veryTallGrass.timeline).toEqual({ keyFrames: [0, 2, 4, 6, 8, 10, 12], textureIndexes: [0, 1, 0, 1, 0, 1, 0], paletteIndexes: [0, 1, 0, 1, 0, 1, 0] })
  }, 90_000)
})