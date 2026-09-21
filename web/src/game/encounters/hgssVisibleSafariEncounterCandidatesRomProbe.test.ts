import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readRomInventory } from '../../nds'
import {
  prepareHgssSafariEncounter,
  resolveHgssSafariEncounterSlots,
  resolveHgssSafariEncounterTimeByHour,
} from '../safari/hgssSafariEncounters'
import { resolveHgssSafariAreaCellAtWorldPosition } from '../safari/hgssSafariMap'
import { createHgssSafariState } from '../safari/hgssSafariState'
import { getMapOrigin } from '../world/mapCoordinates'
import { resolveHgssVisibleWildSpawnTiles } from './hgssVisibleWildSpawnTiles'
import {
  hgssVisibleSafariCoverageCandidateCount,
  prepareHgssVisibleSafariMapCandidates,
} from './hgssVisibleSafariEncounterCandidates'

const defaultRomPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const romPath = process.env.ROM_AUDIT_PATH ? resolve(process.env.ROM_AUDIT_PATH) : defaultRomPath
const probe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip

function signature(value: {
  areaSlot: number
  method: 'land' | 'surf'
  slotIndex: number
  speciesId: number
  level: number
}): string {
  return `${value.areaSlot}:${value.method}:${value.slotIndex}:${value.speciesId}:${value.level}`
}

describe('couverture visible des tables Safari de la ROM', () => {
  probe('parcourt les dix slots actifs de chaque zone terrestre et aquatique', async () => {
    const inventory = await readRomInventory(new File([await readFile(romPath)], basename(romPath)))
    const source = inventory.resolvedMapCatalog.maps.find(({ id }) => id === 357)
    expect(source).toBeDefined()
    const safariZone = createHgssSafariState(0)
    const areaSet = safariZone.areaSets[0]
    const map = inventory.mapVariantResolver?.(source!, {
      weekday: 1,
      rocketHideoutCleared: false,
      safariZone,
      playerGender: 'male',
    })
    expect(map).toBeDefined()
    const spawnTiles = Object.fromEntries((['land', 'surfing'] as const).map((method) => [
      method,
      resolveHgssVisibleWildSpawnTiles({ map: map!, method, maximum: 4_096, isBlocked: () => false }),
    ])) as Record<'land' | 'surfing', ReturnType<typeof resolveHgssVisibleWildSpawnTiles>>

    const preparation = prepareHgssVisibleSafariMapCandidates({
      seed: 'safari-visible-rom-probe',
      map: map!,
      hour: 12,
      candidateCount: hgssVisibleSafariCoverageCandidateCount,
      prepareSafariEncounter: (request) => {
        const area = resolveHgssSafariAreaCellAtWorldPosition(
          areaSet,
          request.worldTileX,
          request.worldTileZ,
        )
        if (!area) return undefined
        const native = prepareHgssSafariEncounter(
          inventory.safariEncounterCatalog,
          areaSet,
          area.areaSlot,
          request.method,
          resolveHgssSafariEncounterTimeByHour(request.hour),
          request.rng,
        )
        return { ...native, method: 'safari', safariMethod: native.method }
      },
      resolveSafeSpawnTiles: (method) => spawnTiles[method],
    })

    const origin = getMapOrigin(map!)
    const availableAreaMethods = new Set((['land', 'surf'] as const).flatMap((method) => (
      spawnTiles[method === 'land' ? 'land' : 'surfing'].flatMap((tile) => {
        const area = resolveHgssSafariAreaCellAtWorldPosition(
          areaSet,
          origin.x + tile.tileX,
          origin.z + tile.tileZ,
        )
        return area ? [`${area.areaSlot}:${method}`] : []
      })
    )))
    const expected = new Set(Array.from({ length: 6 }, (_, areaSlot) => (
      (['land', 'surf'] as const).flatMap((method) => (
        availableAreaMethods.has(`${areaSlot}:${method}`) ? resolveHgssSafariEncounterSlots(
          inventory.safariEncounterCatalog,
          areaSet,
          areaSlot,
          method,
          'day',
        ).map((slot, slotIndex) => signature({ areaSlot, method, slotIndex, ...slot })) : []
      ))
    )).flat())
    const visible = new Set(preparation.encounters.flatMap(({ prepared }) => {
      const encounter = prepared.encounter
      return encounter.method === 'safari'
        && (encounter.safariMethod === 'land' || encounter.safariMethod === 'surf')
        ? [signature({
            areaSlot: encounter.areaSlot,
            method: encounter.safariMethod,
            slotIndex: encounter.slotIndex,
            speciesId: encounter.speciesId,
            level: encounter.level,
          })]
        : []
    }))

    expect(visible).toEqual(expected)
    expect(new Set([...visible].map((entry) => Number(entry.split(':')[3])))).toEqual(
      new Set([...expected].map((entry) => Number(entry.split(':')[3]))),
    )
  }, 180_000)
})
