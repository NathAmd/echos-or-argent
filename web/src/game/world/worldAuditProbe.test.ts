import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readRomInventory } from '../../nds'
import { auditWorldGeometry, auditWorldWarps } from './worldAudit'

const defaultRomPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const romPath = process.env.ROM_AUDIT_PATH ? resolve(process.env.ROM_AUDIT_PATH) : defaultRomPath
const fullWorldAudit = process.env.RUN_WORLD_AUDIT === '1' && existsSync(romPath) ? it : it.skip

describe('world ROM audit', () => {
  fullWorldAudit('checks every decoded warp against its ROM destination anchor', async () => {
    const bytes = await readFile(romPath)
    const inventory = await readRomInventory(new File([bytes], basename(romPath)))
    const issues = auditWorldWarps(inventory.resolvedMapCatalog.maps)
    const geometryIssues = auditWorldGeometry(inventory.resolvedMapCatalog.maps)

    expect(issues, JSON.stringify({ decodedMaps: inventory.resolvedMapCatalog.maps.length, issues }, null, 2)).toEqual([])
    expect(geometryIssues, JSON.stringify({ decodedMaps: inventory.resolvedMapCatalog.maps.length, geometryIssues }, null, 2)).toEqual([])
  }, 180000)
})
