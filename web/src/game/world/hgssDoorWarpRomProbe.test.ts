import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readRomInventory } from '../../nds'
import type { OpeningMapPreview } from '../../ndsTypes'
import { getMapOrigin } from './mapCoordinates'
import { createWorldSession } from './worldSession'

const defaultRomPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const romPath = process.env.ROM_AUDIT_PATH ? resolve(process.env.ROM_AUDIT_PATH) : defaultRomPath
const probe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip

type MapWarp = NonNullable<OpeningMapPreview['events']>['warps'][number]

function getWarpTerrainAttribute(map: OpeningMapPreview, warp: MapWarp): number | undefined {
  if (!map.terrain) return undefined
  const origin = getMapOrigin(map)
  const tileX = warp.x - origin.x
  const tileZ = warp.z - origin.z
  if (tileX < 0 || tileZ < 0 || tileX >= map.terrain.width || tileZ >= map.terrain.height) return undefined
  return map.terrain.attributes[tileZ * map.terrain.width + tileX]
}

describe('HGSS door and warp ROM probe', () => {
  probe('keeps native warp structure and the Kanto League story-door collision', async () => {
    const romBuffer = await readFile(romPath)
    const inventory = await readRomInventory(new File([romBuffer], basename(romPath)))
    const maps = inventory.resolvedMapCatalog.maps
    const warps = maps.flatMap((map) => (map.events?.warps ?? []).map((warp) => ({
      map,
      warp,
      attribute: getWarpTerrainAttribute(map, warp),
    })))

    const doorBehaviorWarps = warps.filter(({ attribute }) => (
      attribute !== undefined
      && (attribute & 0xff) === 105
    ))
    const objectOverlaps = warps.filter(({ map, warp }) => (
      map.events?.objects.some((object) => object.x === warp.x && object.z === warp.z)
    ))
    const inertAnchorBehaviors = new Set([0, 6, 8])
    const inertAnchors = warps.filter(({ attribute }) => (
      attribute !== undefined && inertAnchorBehaviors.has(attribute & 0xff)
    ))

    expect(warps).toHaveLength(1_317)
    expect(doorBehaviorWarps).toHaveLength(189)
    expect(doorBehaviorWarps.every(({ attribute }) => (
      attribute !== undefined && (attribute & 0x8000) !== 0
    ))).toBe(true)
    expect(objectOverlaps).toHaveLength(31)
    expect(inertAnchors).toHaveLength(19)

    const leagueRoom = maps.find(({ id }) => id === 301)
    expect(leagueRoom).toBeDefined()
    if (!leagueRoom) return

    const leagueDoorWarp = leagueRoom.events?.warps.find(({ x, z }) => x === 6 && z === 2)
    const leagueDoorObject = leagueRoom.events?.objects.find(({ x, z, eventFlag }) => (
      x === 6 && z === 2 && eventFlag === 529
    ))
    expect(leagueDoorWarp).toMatchObject({ header: 302 })
    expect(leagueDoorObject).toBeDefined()
    expect(leagueDoorWarp ? (getWarpTerrainAttribute(leagueRoom, leagueDoorWarp) ?? 0) & 0xff : undefined).toBe(110)

    const lockedSession = createWorldSession(maps, new Set())
    expect(lockedSession.loadMap(301, 6, 3, 'north')).toBeDefined()
    const lockedMove = lockedSession.tryMove(0, -1, 'north')
    expect(lockedMove).toMatchObject({
      kind: 'blocked',
      reason: 'npc',
      tileX: 6,
      tileZ: 2,
      event: { kind: 'npc', id: leagueDoorObject?.id },
    })
    expect(lockedMove && 'warp' in lockedMove).toBe(false)
    expect(lockedSession.getState()).toMatchObject({ map: { id: 301 }, tileX: 6, tileZ: 3 })

    const unlockedSession = createWorldSession(maps, new Set([529]))
    expect(unlockedSession.loadMap(301, 6, 3, 'north')).toBeDefined()
    const unlockedMove = unlockedSession.tryMove(0, -1, 'north')
    expect(unlockedMove).toMatchObject({
      kind: 'moved',
      state: { map: { id: 301 }, tileX: 6, tileZ: 2 },
      warp: { kind: 'warp', header: 302 },
      warpActivation: { trigger: 'completed-step', transition: 'direct', direction: 'north' },
    })

    const radioTower = maps.find(({ id }) => id === 188)
    expect(radioTower).toBeDefined()
    if (!radioTower) return
    const radioOrigin = getMapOrigin(radioTower)
    const radioSession = createWorldSession(maps, new Set())
    radioSession.loadMap(188, 22 - radioOrigin.x, 5 - radioOrigin.z, 'east')
    expect(radioSession.tryMove(1, 0, 'east')).toMatchObject({
      kind: 'moved',
      state: { tileX: 23 - radioOrigin.x, tileZ: 5 - radioOrigin.z },
      warpActivation: { trigger: 'completed-step-held', behavior: 94, transition: 'stairs', heldDirection: 'east' },
    })
    expect(radioSession.findEngagingTrainers()).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectId: 3, direction: 'north', distance: 3 }),
    ]))
  }, 120_000)
})
