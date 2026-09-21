import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readRomInventory } from '../../nds'
import { getPlayerAvatarSpriteId } from './hgssPlayerMovement'

const defaultRomPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const romPath = process.env.ROM_AUDIT_PATH ? resolve(process.env.ROM_AUDIT_PATH) : defaultRomPath
const probe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip

describe('HGSS player avatar ROM probe', () => {
  probe('resolves walking, Bicycle and Surf graphics for both protagonists', async () => {
    const bytes = await readFile(romPath)
    const inventory = await readRomInventory(new File([bytes], basename(romPath)))
    const resolver = inventory.eventTextureResolver
    expect(resolver).toBeDefined()

    for (const gender of ['male', 'female'] as const) {
      for (const locomotion of ['walking', 'cycling', 'surfing'] as const) {
        const spriteId = getPlayerAvatarSpriteId(gender, locomotion)
        const resource = locomotion === 'walking'
          ? { frames: inventory.playerTextureFramesByGender?.[gender] }
          : resolver?.(spriteId)
        expect(resource?.frames, `${gender}/${locomotion} sprite ${spriteId}`).toBeDefined()
        expect(resource?.frames?.walking.south.length).toBeGreaterThanOrEqual(1)
        if (locomotion === 'walking') expect(resource?.frames?.running?.south.length).toBe(4)
      }
    }
  }, 30_000)
})
