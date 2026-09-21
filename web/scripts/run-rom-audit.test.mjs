import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { listFailedRomCertifications } from './rom-audit-certifications.mjs'

const execFileAsync = promisify(execFile)
const webRoot = fileURLToPath(new URL('..', import.meta.url))

describe('runner audit ROM', () => {
  it('échoue fermé dès qu’une certification consolidée n’est pas vraie', () => {
    expect(listFailedRomCertifications({ scripts: true, battle: false, world: undefined }))
      .toEqual(['battle', 'world'])
    expect(listFailedRomCertifications({ scripts: true, battle: true })).toEqual([])
  })

  it('recense sans ROM tous les gates découverts, y compris les audits spécialisés', async () => {
    const { stdout } = await execFileAsync(process.execPath, ['./scripts/run-rom-audit.mjs', '--list-probes'], {
      cwd: webRoot,
      env: {
        ...process.env,
        ROM_AUDIT_PATH: resolve(tmpdir(), `pokemaster-missing-rom-${process.pid}.nds`),
      },
    })
    const counts = Object.fromEntries([...stdout.matchAll(/^(RUN_[A-Z0-9_]+) \((\d+)\)$/gm)]
      .map((match) => [match[1], Number(match[2])]))

    expect(stdout).toContain('59 gates ROM découverts :')
    expect(counts).toEqual({
      RUN_FOLLOWER_AUDIT: 1,
      RUN_FULL_ROM_AUDIT: 1,
      RUN_GYM_AUDIT: 1,
      RUN_ITEM_CATALOG_AUDIT: 1,
      RUN_MOVE_EFFECT_AUDIT: 1,
      RUN_ROM_JOURNEY: 4,
      RUN_ROM_PROBES: 48,
      RUN_UI_ROM_PROBE: 1,
      RUN_WORLD_AUDIT: 1,
    })
    expect(stdout).toContain('src/game/newGamePlus/newGamePlusFirstBadgeAllConfigurationsRomGate.test.ts')
    expect(stdout).toContain('src/game/newGamePlus/newGamePlusFirstBadgeRomBattleGate.test.ts')
    expect(stdout).toContain('src/game/simulation/openingJourney.test.ts')
    expect(stdout).toContain('src/game/simulation/zephyrTrainerIdentityRomProbe.test.ts')
    expect(stdout).toContain('src/game/gyms/hgssGymRomAudit.test.ts')
    expect(stdout).toContain('src/rom/graphics/uiAssetsProbe.test.ts')
    expect(stdout).toContain('src/rom/items/itemCatalogProbe.test.ts')
    expect(stdout).toContain('src/rom/overworld/followerParametersProbe.test.ts')
  })
})
