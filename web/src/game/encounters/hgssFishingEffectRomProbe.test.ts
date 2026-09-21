import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readRomInventory } from '../../nds'

const romPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const probe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip

describe('effet de touche de pêche HGSS', () => {
  probe('verrouille le modèle, la texture et la timeline chargés par ov01_02200540', async () => {
    const bytes = await readFile(romPath)
    const inventory = await readRomInventory(new File([bytes], basename(romPath)))
    const archive = inventory.files.find((file) => file.path === '/a/1/0/3')
    expect(archive).toBeDefined()
    if (!archive) return
    expect(archive.archiveMembers[24]).toMatchObject({ index: 24, size: 308 })
    expect(archive.archiveMembers[125]).toMatchObject({ index: 125, size: 768 })
    expect(archive.archiveMembers[140]).toMatchObject({ index: 140, size: 20 })
    const effect = inventory.fishingBiteEffectResolver()
    expect(effect.model).toMatchObject({ modelId: 125 })
    expect(effect.model.surfaces?.length ?? 0).toBeGreaterThan(0)
    expect(effect.texture).toMatchObject({ name: 'saisen_ef', paletteName: 'saisen_ef_pl', width: 16, height: 16, sourceMemberIndex: 24 })
    expect(effect.timeline).toEqual({
      keyFrames: [0, 4, 8, 12],
      textureAddressOffsets: [0, 1, 2, 3],
      paletteAddressOffsets: [0, 0, 0, 0],
    })
  }, 90_000)
})
