import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readRomInventory } from '../../nds'
import { decodeObjectGraphicsFromRom } from '../../rom/overworld/objectGraphics'

const defaultRomPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const romPath = process.env.ROM_AUDIT_PATH ? resolve(process.env.ROM_AUDIT_PATH) : defaultRomPath
const probe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip

describe('HGSS Surf actor presentation ROM probe', () => {
  probe('audits the native player and Surf object graphics', async () => {
    const bytes = await readFile(romPath)
    const inventory = await readRomInventory(new File([bytes], basename(romPath)))
    const objectGraphics = new Map(decodeObjectGraphicsFromRom(bytes).map((entry) => [entry.spriteId, entry]))
    expect(objectGraphics.get(178)).toEqual({ spriteId: 178, mapModelId: 73, flags: 9440 })
    expect(objectGraphics.get(179)).toEqual({ spriteId: 179, mapModelId: 74, flags: 9440 })

    const maleSurf = inventory.eventTextureResolver?.(178)
    const femaleSurf = inventory.eventTextureResolver?.(179)
    expect(maleSurf?.preview).toMatchObject({ name: 'swimhero.1', width: 32, height: 32, sourcePath: '/a/0/8/1', sourceMemberIndex: 73 })
    expect(femaleSurf?.preview).toMatchObject({ name: 'swimheroine.1', width: 32, height: 32, sourcePath: '/a/0/8/1', sourceMemberIndex: 74 })
    expect(Object.values(maleSurf!.frames!.standing).map(({ name }) => name)).toEqual([
      'swimhero.1', 'swimhero.2', 'swimhero.3', 'swimhero.4',
    ])
    expect(Object.values(femaleSurf!.frames!.standing).map(({ name }) => name)).toEqual([
      'swimheroine.1', 'swimheroine.2', 'swimheroine.3', 'swimheroine.4',
    ])

    // waterhero est une pose d'action isolée et non le jeu cardinal Surf.
    // La distinguer empêche une future "correction" d'écraser swimhero.
    expect(inventory.eventTextureResolver?.(180)).toMatchObject({
      preview: { name: 'waterhero.1', sourcePath: '/a/0/8/1', sourceMemberIndex: 77 },
      frames: undefined,
    })
  }, 30_000)
})
