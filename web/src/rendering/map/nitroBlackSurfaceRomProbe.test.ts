import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { usesWorldMatrixCoordinates } from '../../game/world/mapCoordinates'
import { readRomInventory } from '../../nds'
import type { NitroModelPreview, NitroSurfacePreview } from '../../ndsTypes'
import { decodeAreaMapPropDomain } from '../../rom/maps/areaMapPropDomain'
import { resolveNitroSurfaceMaterialColor } from '../three/nitroSurfaceMaterialColor'
import { buildSceneMesh } from './mapSceneBuilder'

const romPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const probe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip

type SurfaceUsage = {
  key: string
  mapId: number
  modelId: number
  model: NitroModelPreview
  surface: NitroSurfacePreview
}

function maximum(values: ArrayLike<number> | undefined): number {
  let result = 0
  for (let index = 0; index < (values?.length ?? 0); index += 1) result = Math.max(result, values![index] ?? 0)
  return result
}

function maximumTextureRgb(pixels: Uint8ClampedArray | undefined): number {
  let result = 0
  for (let offset = 0; offset + 2 < (pixels?.length ?? 0); offset += 4) {
    result = Math.max(result, pixels![offset] ?? 0, pixels![offset + 1] ?? 0, pixels![offset + 2] ?? 0)
  }
  return result
}

function diagnostic({ key, mapId, modelId, surface }: SurfaceUsage): object {
  return {
    key,
    mapId,
    modelId,
    material: surface.materialName,
    texture: surface.textureName,
    diffuse: surface.materialColor,
    ambient: surface.materialAmbientColor,
    emission: surface.materialEmissionColor,
    vertexMaximum: maximum(surface.colors),
    resolved: resolveNitroSurfaceMaterialColor(surface),
  }
}

describe('global HGSS black map surface audit', () => {
  probe('keeps every native map and MapProp material from erasing decoded GX colors', async () => {
    const buffer = await readFile(romPath)
    const rom = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    const inventory = await readRomInventory(new File([buffer], basename(romPath)))
    const areaData = inventory.files.find(({ path }) => path === '/a/0/4/2')
    const usages: SurfaceUsage[] = []
    const propModels = new Map<string, { mapId: number, modelId: number, model: NitroModelPreview }>()

    for (const map of inventory.resolvedMapCatalog.maps) {
      for (const surface of map.model?.surfaces ?? []) usages.push({
        key: `map:${map.id}`,
        mapId: map.id,
        modelId: map.model!.modelId,
        model: map.model!,
        surface,
      })
      const areaMember = areaData?.archiveMembers[map.header.areaDataBank]
      const domain = areaMember
        ? decodeAreaMapPropDomain(rom.subarray(areaMember.offset, areaMember.offset + areaMember.size))
          ?? (usesWorldMatrixCoordinates(map) ? 'field' : 'room')
        : usesWorldMatrixCoordinates(map) ? 'field' : 'room'
      for (const { modelId } of map.model?.mapProps ?? []) {
        const key = `${domain}:${map.header.areaDataBank}:${modelId}`
        if (propModels.has(key)) continue
        const model = inventory.mapPropModelResolver?.(modelId, map.header.areaDataBank, domain)
        if (model) propModels.set(key, { mapId: map.id, modelId, model })
      }
    }
    for (const [key, entry] of propModels) for (const surface of entry.model.surfaces ?? []) usages.push({
      key: `prop:${key}`,
      ...entry,
      surface,
    })

    const missingTextures = usages.filter(({ model, surface }) => (
      Boolean(surface.textureId) && !model.textures?.some(({ id }) => id === surface.textureId)
    ))
    const nativeColorSurfacesWithBlackDiffuse = usages.filter(({ surface }) => (
      surface.materialColor?.every((channel) => channel === 0)
      && (maximum(surface.colors) > 0 || maximum(surface.materialAmbientColor) > 0 || maximum(surface.materialEmissionColor) > 0)
    ))
    const erasedNativeColors = nativeColorSurfacesWithBlackDiffuse.filter(({ surface }) => (
      maximum(resolveNitroSurfaceMaterialColor(surface)) === 0
    ))

    expect(inventory.resolvedMapCatalog.maps).toHaveLength(519)
    expect(propModels.size).toBeGreaterThan(1_300)
    expect(usages.length).toBeGreaterThan(27_000)
    expect(nativeColorSurfacesWithBlackDiffuse.length).toBeGreaterThan(400)
    expect(missingTextures.map(diagnostic)).toEqual([])
    expect(erasedNativeColors.map(diagnostic)).toEqual([])

    const normalOnlyAmbientFallbacks = [
      { modelId: 167, materialName: 'd_mat01_mat' },
      { modelId: 256, materialName: 'stair01_1' },
    ].map(({ modelId, materialName }) => {
      const model = [...propModels.values()].find((entry) => entry.modelId === modelId)?.model
      const surface = model?.surfaces?.find((candidate) => candidate.materialName === materialName)
      const texture = model?.textures?.find(({ id }) => id === surface?.textureId)
      return {
        modelId,
        materialName,
        hasVertexColors: Boolean(surface?.colors),
        diffuse: surface?.materialColor,
        ambient: surface?.materialAmbientColor,
        textureHasVisibleColor: maximumTextureRgb(texture?.pixels) > 0,
        resolved: surface && resolveNitroSurfaceMaterialColor(surface),
      }
    })
    expect(normalOnlyAmbientFallbacks).toEqual([
      {
        modelId: 167,
        materialName: 'd_mat01_mat',
        hasVertexColors: false,
        diffuse: [0, 0, 0],
        ambient: [1, 1, 1],
        textureHasVisibleColor: true,
        resolved: [1, 1, 1],
      },
      {
        modelId: 256,
        materialName: 'stair01_1',
        hasVertexColors: false,
        diffuse: [0, 0, 0],
        ambient: [1, 1, 1],
        textureHasVisibleColor: true,
        resolved: [1, 1, 1],
      },
    ])

    const league = inventory.resolvedMapCatalog.maps.find(({ id }) => id === 300)
    const plantIndex = league?.model?.surfaces?.findIndex(({ materialName }) => materialName === 'p_lea_plant_lm1') ?? -1
    expect(league).toBeDefined()
    expect(plantIndex).toBeGreaterThanOrEqual(0)
    if (!league?.model || plantIndex < 0) throw new Error('Le décor ROM du hall de la Ligue est absent.')
    const plantSurface = league.model.surfaces![plantIndex]!
    const leagueScene = buildSceneMesh({
      ...league,
      model: {
        ...league.model,
        positions: plantSurface.positions,
        surfaces: [plantSurface],
      },
    }, undefined, { indoorDepthLayers: false })
    const plantMesh = leagueScene?.object.children[0] as THREE.Mesh | undefined
    const plantMaterial = plantMesh && (Array.isArray(plantMesh.material) ? plantMesh.material[0] : plantMesh.material)
    expect(plantMaterial).toBeInstanceOf(THREE.MeshLambertMaterial)
    expect((plantMaterial as THREE.MeshLambertMaterial).color.getHex()).toBe(0xffffff)
    leagueScene?.dispose()

    const leaguePropIds = [...new Set(league.model.mapProps?.map(({ modelId }) => modelId) ?? [])]
    const correctedLeagueProps = leaguePropIds.flatMap((modelId) => {
      const model = inventory.mapPropModelResolver?.(modelId, league.header.areaDataBank, 'room')
      return (model?.surfaces ?? []).filter(({ materialName }) => ['d_mat01_mat', 'd_mat04_mat', 't_map01_mat'].includes(materialName ?? ''))
    })
    expect(new Set(correctedLeagueProps.map(({ materialName }) => materialName))).toEqual(new Set(['d_mat01_mat', 'd_mat04_mat', 't_map01_mat']))
    expect(correctedLeagueProps.every((surface) => maximum(resolveNitroSurfaceMaterialColor(surface)) === 1)).toBe(true)
  }, 120_000)
})
