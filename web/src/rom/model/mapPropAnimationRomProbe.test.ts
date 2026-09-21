import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readRomInventory } from '../../nds'
import { usesWorldMatrixCoordinates } from '../../game/world/mapCoordinates'
import { decodeNitroPatternAnimation } from './nitroPatternAnimations'
import { resolveMapPropAnimationLoadMode } from './mapPropAnimationMetadata'
import { composeNitroModelAnimationFrames } from './nitroModelFrameComposition'
import { buildSceneMesh } from '../../rendering/map/mapSceneBuilder'
import { applyNitroMapPropFrame, createNitroMapPropRuntime } from '../../rendering/three/nitroMapPropRuntime'
import { decodeAreaMapPropDomain } from '../maps/areaMapPropDomain'

const romPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const probe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip

function greatestCommonDivisor(left: number, right: number): number {
  while (right !== 0) [left, right] = [right, left % right]
  return left
}

describe('global HGSS MapProp animation inventory', () => {
  probe('decodes every animation referenced by every used field and room model', async () => {
    const buffer = await readFile(romPath)
    const inventory = await readRomInventory(new File([buffer], basename(romPath)))
    const rom = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    const areaData = inventory.files.find(({ path }) => path === '/a/0/4/2')
    const textureAnimations = Object.values(inventory.fieldTextureAnimations ?? {})
    expect(textureAnimations.length).toBeGreaterThan(0)
    expect(new Set(textureAnimations.map(({ sourceMemberIndex }) => sourceMemberIndex)).size).toBe(textureAnimations.length)
    expect(textureAnimations.every((animation) => animation.frames.length > 0
      && animation.frames.every(({ texture }) => texture.sourceMemberIndex === animation.sourceMemberIndex))).toBe(true)
    const combinations = new Map<string, { modelId: number, areaDataBank: number, domain: 'field' | 'room' }>()
    for (const map of inventory.resolvedMapCatalog.maps) {
      const areaMember = areaData?.archiveMembers[map.header.areaDataBank]
      const domain = areaMember
        ? decodeAreaMapPropDomain(rom.subarray(areaMember.offset, areaMember.offset + areaMember.size)) ?? (usesWorldMatrixCoordinates(map) ? 'field' : 'room')
        : usesWorldMatrixCoordinates(map) ? 'field' : 'room'
      for (const prop of map.model?.mapProps ?? []) combinations.set(`${domain}:${map.header.areaDataBank}:${prop.modelId}`, {
        modelId: prop.modelId,
        areaDataBank: map.header.areaDataBank,
        domain,
      })
    }
    const animated = [...combinations.values()].flatMap((entry) => {
      const base = inventory.mapPropModelResolver?.(entry.modelId, entry.areaDataBank, entry.domain)
      const metadata = inventory.mapPropAnimationMetadataResolver?.(entry.modelId, entry.domain, entry.areaDataBank)
      return base && metadata?.hasAnimations ? [{ ...entry, metadata, base }] : []
    })
    const tracks = animated.flatMap((entry) => entry.metadata.animationArchiveIds.map((archiveId) => ({
      ...entry,
      archiveId,
      animation: inventory.mapPropAnimationResolver?.(entry.modelId, entry.areaDataBank, archiveId, entry.domain),
    })))
    expect(animated).toHaveLength(457)
    expect(tracks).toHaveLength(923)
    const animationArchive = inventory.files.find(({ path }) => path === '/a/1/0/6')
    expect(tracks.filter(({ animation }) => !animation?.frames.length).map(({ domain, areaDataBank, modelId, archiveId, base }) => {
      const member = animationArchive?.archiveMembers[archiveId]
      const pattern = member ? decodeNitroPatternAnimation(rom.subarray(member.offset, member.offset + member.size)) : undefined
      return {
        domain, areaDataBank, modelId, archiveId,
        pattern,
        surfaces: base.surfaces?.map(({ materialName, textureName, paletteName }) => ({ materialName, textureName, paletteName })),
        textures: base.textures?.map(({ name, paletteName }) => ({ name, paletteName })),
      }
    })).toEqual([])
    const automatic = animated.filter(({ metadata }) => resolveMapPropAnimationLoadMode(metadata) === 'automatic')
    const compositionFailures: Array<{ modelId: number, areaDataBank: number, domain: 'field' | 'room', frame: number, error: string }> = []
    let composedFrameCount = 0
    for (const entry of automatic) {
      const decoded = entry.metadata.animationArchiveIds.map((archiveId) => inventory.mapPropAnimationResolver?.(
        entry.modelId,
        entry.areaDataBank,
        archiveId,
        entry.domain,
      )?.frames).filter((frames): frames is NonNullable<typeof frames> => Boolean(frames?.length))
      if (decoded.length < 2 || decoded.length !== entry.metadata.animationArchiveIds.length) continue
      const frameCount = decoded.reduce((cycle, { length }) => cycle / greatestCommonDivisor(cycle, length) * length, 1)
      for (let frame = 0; frame < frameCount; frame += 1) {
        try {
          composeNitroModelAnimationFrames(entry.base, decoded.map((frames) => [frames[frame % frames.length]!]))
          composedFrameCount += 1
        } catch (reason) {
          compositionFailures.push({
            modelId: entry.modelId,
            areaDataBank: entry.areaDataBank,
            domain: entry.domain,
            frame,
            error: reason instanceof Error ? reason.message : String(reason),
          })
          break
        }
      }
    }
    expect(composedFrameCount).toBeGreaterThan(0)
    expect(compositionFailures).toEqual([])

    // Oliville combine la BCA 67 et la BTA 68 sur les vagues du yacht. Le
    // BufferAttribute Three doit rester une copie : appliquer la BTA ne doit
    // jamais transformer les UV du modèle ROM servant de base à la BCA.
    const olivine = inventory.resolvedMapCatalog.maps.find(({ id }) => id === 77)
    const yacht = olivine && inventory.mapPropModelResolver?.(119, olivine.header.areaDataBank, 'field')
    const yachtTracks = olivine && [67, 68].map((archiveId) => inventory.mapPropAnimationResolver?.(
      119,
      olivine.header.areaDataBank,
      archiveId,
      'field',
    )?.frames)
    expect(olivine && yacht && yachtTracks?.every(Boolean)).toBeTruthy()
    if (!olivine || !yacht || !yachtTracks?.[0] || !yachtTracks[1]) throw new Error('Les animations ROM du yacht d’Oliville sont absentes.')
    const baseUv = yacht.surfaces?.[0]?.uvs?.[0]
    const scene = buildSceneMesh({ ...olivine, model: yacht }, undefined, { indoorDepthLayers: false })
    expect(scene).toBeDefined()
    if (!scene) throw new Error('Le modèle ROM du yacht d’Oliville ne peut pas être rendu.')
    const runtime = createNitroMapPropRuntime(scene.object, yacht)
    for (let frame = 0; frame < 60; frame += 1) {
      const composed = composeNitroModelAnimationFrames(yacht, [[yachtTracks[0][frame]!], [yachtTracks[1][frame]!]])[0]
      expect(composed).toBeDefined()
      if (composed) applyNitroMapPropFrame(runtime, composed)
      expect(yacht.surfaces?.[0]?.uvs?.[0]).toBe(baseUv)
    }
    scene.dispose()
    expect([...new Set(animated.map(({ metadata }) => metadata.flags))].sort((a, b) => a - b)).toEqual([0, 2, 3, 8])
    for (const modelId of [33, 138]) {
      const usage = inventory.resolvedMapCatalog.maps.find((map) => !usesWorldMatrixCoordinates(map)
        && map.model?.mapProps?.some((prop) => prop.modelId === modelId))
      expect(usage).toBeDefined()
      const metadata = inventory.mapPropAnimationMetadataResolver?.(modelId, 'room', usage!.header.areaDataBank)
      expect(metadata && resolveMapPropAnimationLoadMode(metadata)).toBe('one-shot')
      expect(metadata?.animationArchiveIds).toHaveLength(2)
      expect(metadata?.animationArchiveIds.map((archiveId) => inventory.mapPropAnimationResolver?.(
        modelId,
        usage!.header.areaDataBank,
        archiveId,
        'room',
      )?.frames.length)).toEqual(expect.arrayContaining([expect.any(Number), expect.any(Number)]))
    }
    const rocketHideout = inventory.resolvedMapCatalog.maps.find(({ id }) => id === 248)
    expect(rocketHideout).toBeDefined()
    if (!rocketHideout) throw new Error('La carte ROM 248 de la Repaire Rocket est absente.')
    expect(rocketHideout.model?.mapProps?.map(({ modelId }) => modelId)).toEqual(expect.arrayContaining([149, 152, 153]))
    for (const modelId of [149, 152, 153]) {
      const metadata = inventory.mapPropAnimationMetadataResolver?.(modelId, 'room', rocketHideout.header.areaDataBank)
      expect(metadata && resolveMapPropAnimationLoadMode(metadata)).toBe('deferred-attachment')
      expect(metadata?.animationArchiveIds).toEqual([86, 87])
      expect(metadata?.animationArchiveIds.map((archiveId) => inventory.mapPropAnimationResolver?.(
        modelId,
        rocketHideout.header.areaDataBank,
        archiveId,
        'room',
      )?.frames.length)).toEqual([361, 361])
    }
  }, 120_000)
})
