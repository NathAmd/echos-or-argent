import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readRomInventory } from '../../nds'
import { getMapMatrixFootprint } from '../../rom/maps/mapFootprint'
import { composeHgssSafariMatrix, hgssSafariObjectConfigs } from './hgssSafariMap'
import { createHgssSafariAreaSet, createHgssSafariState, placeHgssSafariObject } from './hgssSafariState'

const defaultRomPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const romPath = process.env.ROM_AUDIT_PATH ? resolve(process.env.ROM_AUDIT_PATH) : defaultRomPath
const probe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip

describe('composition de la carte Safari dans la ROM francaise', () => {
  probe('verrouille les cartes 343-354, la matrice 212 et les modeles des 24 Blocs', async () => {
    const romBuffer = await readFile(romPath)
    const inventory = await readRomInventory(new File([romBuffer], basename(romPath)))
    const templates = Array.from({ length: 12 }, (_, areaId) => {
      const map = inventory.resolvedMapCatalog.maps.find(({ id }) => id === 343 + areaId)
      expect(map).toBeDefined()
      expect(map?.matrix).toMatchObject({
        matrixIndex: 197 + areaId,
        width: 1,
        height: 1,
        hasHeaders: false,
      })
      expect([...map!.matrix.modelIds]).toEqual([652 + areaId])
      return { areaId, mapId: map!.id, matrixId: map!.matrix.matrixIndex, modelId: map!.matrix.modelIds[0] }
    })

    const safari = inventory.resolvedMapCatalog.maps.find(({ id }) => id === 357)
    expect(safari).toBeDefined()
    expect(safari?.matrix).toMatchObject({ matrixIndex: 212, width: 5, height: 4, hasHeaders: true })
    expect(safari?.header).toMatchObject({ areaDataBank: 75, mapSection: 202, scriptsBank: 120, eventsBank: 314 })
    expect(safari?.matrix.headers).toHaveLength(20)
    expect(safari?.matrix.altitudes).toHaveLength(20)
    expect(safari?.matrix.modelIds).toHaveLength(20)
    expect([...safari!.matrix.headers]).toEqual([
      0, 0, 0, 0, 0,
      0, 357, 357, 357, 0,
      0, 357, 357, 357, 0,
      0, 0, 357, 0, 0,
    ])
    expect([...safari!.matrix.altitudes]).toEqual(new Array(20).fill(0))
    expect([...safari!.matrix.modelIds]).toEqual([
      211, 211, 211, 211, 211,
      211, 0xffff, 0xffff, 0xffff, 211,
      211, 0xffff, 0xffff, 0xffff, 211,
      211, 211, 666, 211, 211,
    ])
    expect(getMapMatrixFootprint(357, safari!.matrix)).toMatchObject({
      minCellX: 1,
      maxCellX: 3,
      minCellZ: 1,
      maxCellZ: 3,
      widthCells: 3,
      heightCells: 3,
    })

    const composed = composeHgssSafariMatrix(
      safari!.matrix,
      createHgssSafariAreaSet([11, 10, 9, 8, 7, 6]),
    )
    expect([6, 7, 8, 11, 12, 13].map((index) => composed.modelIds[index])).toEqual([663, 662, 661, 660, 659, 658])
    expect(safari!.matrix.modelIds).not.toBe(composed.modelIds)

    const modelIds = [...new Set(hgssSafariObjectConfigs.flatMap((config) => (
      config.hasGenderedLayout ? [config.baseModelId, config.baseModelId + 1] : [config.baseModelId]
    )))]
    expect(modelIds).toEqual(Array.from({ length: 26 }, (_, index) => 189 + index))
    expect(modelIds.every((modelId) => Boolean(inventory.mapPropModelResolver?.(modelId, 75, 'field')))).toBe(true)

    let safariState = createHgssSafariState(0)
    safariState = placeHgssSafariObject(safariState, 0, 0, { objectId: 18, x: 2, y: 0, z: 2 })
    const resolved = inventory.mapVariantResolver?.(safari!, {
      weekday: 1,
      rocketHideoutCleared: false,
      safariZone: safariState,
      playerGender: 'female',
    })
    expect(resolved).toBeDefined()
    expect([6, 7, 8, 11, 12, 13].map((index) => resolved!.matrix.modelIds[index])).toEqual([652, 659, 653, 657, 655, 658])
    expect(resolved?.model?.mapProps).toContainEqual({
      modelId: 208,
      position: [2.5, 0, 2.5],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      mapMatrixCellIndex: 6,
    })
    expect(resolved?.terrain).toMatchObject({ width: 96, height: 96 })
    expect(resolved?.terrain?.attributes[2 * 96 + 2]).toBe(0x8023)

    // La septieme cellule du header 357 est le raccord d'entree sous la
    // grille 3x2. `ov02_0224E31C` la rabat sur la zone 0, mais son terrain ne
    // doit jamais pouvoir declencher une rencontre Safari.
    const encounterBehaviors = new Set([2, 3, 5, 8, 11, 16, 18, 21, 37, 42, 114, 119, 123, 166, 167])
    const entranceEncounterTiles: Array<readonly [number, number, number]> = []
    for (let z = 64; z < 96; z++) {
      for (let x = 32; x < 64; x++) {
        const behavior = (resolved!.terrain!.attributes[z * 96 + x] ?? 0xff) & 0xff
        if (encounterBehaviors.has(behavior)) entranceEncounterTiles.push([x, z, behavior])
      }
    }
    expect(entranceEncounterTiles).toEqual([])

    console.log(JSON.stringify({
      templates,
      safari: {
        matrixId: safari!.matrix.matrixIndex,
        dimensions: [safari!.matrix.width, safari!.matrix.height],
        headers: [...safari!.matrix.headers],
        altitudes: [...safari!.matrix.altitudes],
        sourceModels: [...safari!.matrix.modelIds],
        footprint: getMapMatrixFootprint(357, safari!.matrix),
        composedModels: [...composed.modelIds],
      },
      blockModels: modelIds,
    }, null, 2))
  }, 120_000)
})
