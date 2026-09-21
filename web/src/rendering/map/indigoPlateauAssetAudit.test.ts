import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { readRomInventory } from '../../nds'
import { readNitroTextureSet } from '../../rom/model/nitroModelResources'
import { findNitroTextureSection } from '../../rom/model/nitroTextureResources'
import { buildSceneMesh } from './mapSceneBuilder'

const romPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const probe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip

describe('Indigo Plateau field assets', () => {
  probe('keeps the League exterior texture lit after its GX NORMAL commands', async () => {
    const buffer = await readFile(romPath)
    const rom = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    const inventory = await readRomInventory(new File([buffer], basename(romPath)))
    const map = inventory.resolvedMapCatalog.maps.find(({ id }) => id === 58)
    expect(map?.header.areaDataBank).toBe(10)
    expect(map?.model?.mapProps?.some(({ modelId }) => modelId === 146)).toBe(true)
    if (!map) throw new Error('La carte ROM du Plateau Indigo est absente.')

    const building = inventory.mapPropModelResolver?.(146, map.header.areaDataBank, 'field')
    const surface = building?.surfaces?.find(({ materialName }) => materialName === 'pke_league_lm1')
    const texture = building?.textures?.find(({ name }) => name === 'pke_league')
    expect(surface).toMatchObject({
      textureName: 'pke_league',
      paletteName: 'pke_league_pl',
    })
    expect(surface?.positions.length).toBe(1_008 * 3)
    expect(surface?.colors && Math.min(...surface.colors)).toBe(1)
    expect(texture).toMatchObject({ width: 64, height: 64, paletteName: 'pke_league_pl' })
    expect(texture?.pixels.some((value, index) => index % 4 !== 3 && value !== 0)).toBe(true)
    expect(texture?.pixels.every((value, index) => index % 4 !== 3 || value === 255)).toBe(true)

    const fieldModels = inventory.files.find(({ path }) => path.endsWith('/bm_field.narc'))
    const member = fieldModels?.archiveMembers[146]
    const section = member && findNitroTextureSection(rom, member)
    const sourceTexture = member && section
      ? readNitroTextureSet(rom, section.view, member.offset, section.textureSectionOffset, section.fileSize)
        ?.textures.find(({ name }) => name === 'pke_league')
      : undefined
    expect(sourceTexture).toMatchObject({
      width: 64,
      height: 64,
      format: 3,
      color0Transparent: false,
    })

    const scene = building && buildSceneMesh(
      { ...map, model: building },
      undefined,
      { indoorDepthLayers: false, replaceLegacyPropShadows: true },
    )
    const leagueMesh = scene?.object.children.find((child): child is THREE.Mesh => {
      if (!(child instanceof THREE.Mesh)) return false
      const material = Array.isArray(child.material) ? child.material[0] : child.material
      const image = material instanceof THREE.MeshLambertMaterial
        ? material.map?.image as { width?: number, height?: number } | undefined
        : undefined
      return image?.width === 64 && image.height === 64
    })
    const colors = leagueMesh?.geometry.getAttribute('color')
    expect(leagueMesh).toMatchObject({ visible: true })
    expect(colors instanceof THREE.BufferAttribute && Math.min(...colors.array)).toBe(1)
    expect(scene?.object.children.filter((child) => child.userData.replacedLegacyPropShadow).every(({ visible }) => !visible)).toBe(true)
    scene?.dispose()
  }, 120_000)
})
