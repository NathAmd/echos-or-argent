import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readRomInventory } from '../../nds'
import { resolveHgssFieldMoveEffectProfile } from '../../game/world/hgssFieldMoveEffect'
import { resolveHgssFieldMoveEffectAsset } from './hgssFieldMoveEffectAssets'

const defaultRomPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const romPath = process.env.ROM_AUDIT_PATH ? resolve(process.env.ROM_AUDIT_PATH) : defaultRomPath
const probe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip

describe('ressources ROM de ScrCmd_560', () => {
  probe('décode et compose les BMD0/BCA0/BMA0/BTA0/BTP0 natifs des six modes', async () => {
    const bytes = await readFile(romPath)
    const inventory = await readRomInventory(new File([bytes], basename(romPath)))
    const archive = inventory.files.find(({ path }) => path === '/a/1/3/4')

    expect(archive).toMatchObject({ signature: 'N A R C', archiveEntries: 24 })
    expect(archive?.archiveMembers.map(({ index, signature, size }) => ({ index, signature, size })))
      .toEqual(expect.arrayContaining([
        { index: 0, signature: 'B C A 0', size: 4740 },
        { index: 1, signature: 'B M A 0', size: 520 },
        { index: 2, signature: 'B T A 0', size: 860 },
        { index: 3, signature: 'B M D 0', size: 4248 },
        { index: 4, signature: 'B C A 0', size: 6400 },
        { index: 5, signature: 'B M A 0', size: 432 },
        { index: 6, signature: 'B T P 0', size: 212 },
        { index: 7, signature: 'B T A 0', size: 860 },
        { index: 8, signature: 'B M D 0', size: 3472 },
        { index: 17, signature: 'B C A 0', size: 4328 },
        { index: 18, signature: 'B M A 0', size: 348 },
        { index: 19, signature: 'B M D 0', size: 3544 },
    ]))

    const expectedGeometry = new Map([
      [3, { positions: 153, surfaces: 5 }],
      [8, { positions: 126, surfaces: 4 }],
      [19, { positions: 126, surfaces: 4 }],
    ])
    for (const mode of [0, 1, 2, 3, 4, 5] as const) {
      const profile = resolveHgssFieldMoveEffectProfile(mode)
      const asset = resolveHgssFieldMoveEffectAsset(
        mode,
        inventory.gymOverlayModelResolver,
        inventory.gymOverlayAnimationResolver,
      )
      const geometry = expectedGeometry.get(profile.modelMember)!
      expect(asset.profile).toBe(profile)
      expect(asset.model.modelId).toBe(profile.modelMember)
      expect(asset.model.positions).toHaveLength(geometry.positions)
      expect(asset.model.surfaces).toHaveLength(geometry.surfaces)
      expect(asset.frames).toHaveLength(45)
      expect(asset.frames.every(({ positions, surfaces }) => (
        positions?.length === geometry.positions && surfaces?.length === geometry.surfaces
      ))).toBe(true)
    }
  }, 120_000)
})
