import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readRomInventory } from './nds'
import { getMapOrigin, usesWorldMatrixCoordinates } from './game/world/mapCoordinates'
import { getMapMatrixFootprint, getMapMatrixLoadedCellIndices, getMapMatrixRenderableCellIndices, getMapMatrixRenderCellIndices } from './rom/maps/mapFootprint'
import { resolveFieldCameraProjection } from './rom/maps/fieldCamera'
import { resolveDoorTransitionDescriptor } from './rom/maps/doorTransition'
import { decodeMapTerrain } from './rom/maps/mapData'

const romPath = fileURLToPath(new URL('../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const probe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip

function fix32(value: number): number {
  return value / 4096
}

function parseRecord(view: DataView, offset: number) {
  return {
    propModelId: view.getUint32(offset, true),
    position: [
      fix32(view.getInt32(offset + 4, true)),
      fix32(view.getInt32(offset + 8, true)),
      fix32(view.getInt32(offset + 12, true)),
    ],
    scale: [
      fix32(view.getInt32(offset + 28, true)),
      fix32(view.getInt32(offset + 32, true)),
      fix32(view.getInt32(offset + 36, true)),
    ],
  }
}

function scoreRecord(record: ReturnType<typeof parseRecord>, fieldModelCount: number): number {
  let score = 0
  if (record.propModelId > 0 && record.propModelId < fieldModelCount) score += 2
  if (record.position.every((value) => Number.isFinite(value) && Math.abs(value) <= 256)) score += 1
  if (record.scale.every((value) => Number.isFinite(value) && value > 0 && value <= 8)) score += 2
  return score
}

function inspectMember(bytes: Uint8Array, offset: number, size: number, fieldModelCount: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, size)
  const terrainSize = view.getUint32(0, true)
  const propListSize = view.getUint32(4, true)
  const embeddedModelSize = view.getUint32(8, true)
  const extraModelDataSize = view.getUint32(12, true)
  const bgsDataLength = view.getUint16(18, true)
  const terrainOffset = 0x14 + bgsDataLength
  const propListOffset = terrainOffset + terrainSize
  const embeddedModelOffset = size - embeddedModelSize - extraModelDataSize
  const candidates = Array.from({ length: 33 }, (_, index) => index * 4)
    .map((shift) => {
      const sampleOffsets = [propListOffset + shift, propListOffset + shift + 0x30, propListOffset + shift + 0x60]
        .filter((sampleOffset) => sampleOffset + 0x30 <= embeddedModelOffset)
      const sample = sampleOffsets.map((sampleOffset) => parseRecord(view, sampleOffset))
      const score = sample.reduce((sum, record) => sum + scoreRecord(record, fieldModelCount), 0)
      return { shift, score, sample }
    })
    .sort((left, right) => right.score - left.score || left.shift - right.shift)
    .slice(0, 6)
  return {
    terrainSize,
    bgsDataLength,
    terrainOffset,
    propListSize,
    embeddedModelSize,
    extraModelDataSize,
    propListOffset,
    declaredPropListEnd: propListOffset + propListSize,
    embeddedModelOffset,
    gapBeforeModel: embeddedModelOffset - (propListOffset + propListSize),
    sampleAtDeclaredStart: Array.from({ length: 4 }, (_, index) => parseRecord(view, propListOffset + index * 0x30)),
    candidates,
  }
}

describe('land data probe', () => {
  probe('audits the reported Route 33 and Ecorcia matrix compositions', async () => {
    const romBuffer = await readFile(romPath)
    const inventory = await readRomInventory(new File([romBuffer], basename(romPath)))
    const map = inventory.resolvedMapCatalog.maps.find(({ id }) => id === 37)
    expect(map).toBeTruthy()
    const props = map?.model?.mapProps ?? []
    const footprint = map && getMapMatrixFootprint(map.id, map.matrix)
    expect(map).toMatchObject({ label: 'Route 33', terrain: { width: 32, height: 32 } })
    expect(footprint).toBeTruthy()
    const worldX = footprint!.minCellX * 32 + 10
    const worldZ = footprint!.minCellZ * 32 + 23
    const loadedCellIndices = new Set(getMapMatrixLoadedCellIndices(map!.matrix, worldX, worldZ))
    const renderCellIndices = new Set(getMapMatrixRenderCellIndices(map!.id, map!.matrix))
    const visibleSurfaces = map!.model!.surfaces!.filter((surface) => loadedCellIndices.has(surface.mapMatrixCellIndex!))
    const visibleModelIds = new Set(visibleSurfaces.map((surface) => Number(surface.textureId?.split(':')[0])))

    // La position du rapport se trouve dans la moitié sud-ouest de la
    // parcelle : la fenêtre DS native contient Route 33, Route 32 à l'ouest et
    // les deux chunks de bordure au sud. Notre rendu mono-écran conserve toute
    // la marge prédécodée afin que le changement de quadrant ne soit pas visible.
    expect(loadedCellIndices).toHaveLength(4)
    expect(renderCellIndices).toHaveLength(9)
    expect([...loadedCellIndices].every((cellIndex) => renderCellIndices.has(cellIndex))).toBe(true)
    expect(visibleModelIds).toEqual(new Set([32, 34, 208]))
    expect(map?.model?.surfaces?.every((surface) => surface.mapMatrixCellIndex !== undefined)).toBe(true)
    expect(props.length).toBeGreaterThan(0)
    expect(props.every((prop) => prop.mapMatrixCellIndex !== undefined)).toBe(true)
    expect(props.every((prop) => prop.position.every(Number.isFinite))).toBe(true)

    const azalea = inventory.resolvedMapCatalog.maps.find(({ id }) => id === 74)
    const azaleaFootprint = azalea && getMapMatrixFootprint(azalea.id, azalea.matrix)
    expect(azalea).toMatchObject({ label: 'Ecorcia', header: { cameraType: 0 } })
    expect(azaleaFootprint).toMatchObject({
      minCellX: 12,
      maxCellX: 13,
      minCellZ: 14,
      maxCellZ: 14,
    })
    const southernFillers = [12, 13].map((x) => {
      const index = 15 * azalea!.matrix.width + x
      return {
        index,
        header: azalea!.matrix.headers[index],
        modelId: azalea!.matrix.modelIds[index],
        altitude: azalea!.matrix.altitudes[index],
      }
    })
    expect(southernFillers).toEqual([
      { index: 717, header: 0, modelId: 208, altitude: 2 },
      { index: 718, header: 0, modelId: 208, altitude: 2 },
    ])
    expect(getMapMatrixRenderableCellIndices(azalea!.id, azalea!.matrix)).toEqual([
      622, 625,
      669, 670, 671, 672,
    ])
    expect(resolveFieldCameraProjection(inventory.fieldCameraParams[azalea!.header.cameraType]!, 1 / 16).kind).toBe('perspective')

    const topologyIssues: Array<{ matrix: number, header: number, cells: number, components: number }> = []
    const matrices = new Map(inventory.resolvedMapCatalog.maps.map((candidate) => [candidate.matrix.matrixIndex, candidate.matrix]))
    for (const matrix of matrices.values()) {
      if (!matrix.hasHeaders) continue
      const headers = new Set(matrix.headers)
      for (const header of headers) {
        const remaining = new Set(Array.from(matrix.headers, (value, index) => value === header ? index : -1).filter((index) => index >= 0))
        let components = 0
        while (remaining.size > 0) {
          components += 1
          const pending = [remaining.values().next().value!]
          remaining.delete(pending[0])
          while (pending.length > 0) {
            const index = pending.pop()!
            const x = index % matrix.width
            const z = Math.floor(index / matrix.width)
            for (const neighbor of [index - 1, index + 1, index - matrix.width, index + matrix.width]) {
              if (!remaining.has(neighbor)) continue
              const neighborX = neighbor % matrix.width
              const neighborZ = Math.floor(neighbor / matrix.width)
              if (Math.abs(neighborX - x) + Math.abs(neighborZ - z) !== 1) continue
              remaining.delete(neighbor)
              pending.push(neighbor)
            }
          }
        }
        if (components > 1) topologyIssues.push({ matrix: matrix.matrixIndex, header, cells: matrix.headers.filter((value) => value === header).length, components })
      }
    }
    // Seul MAP_EVERYWHERE (0), la Mystery Zone de remplissage native, possède
    // plusieurs composantes. Tous les headers de jeu ont un footprint connexe.
    expect(topologyIssues.filter((issue) => issue.header !== 0)).toEqual([])

    const ownershipIssues = inventory.resolvedMapCatalog.maps
      .filter(usesWorldMatrixCoordinates)
      .flatMap((candidate) => {
        const unownedSurfaces = candidate.model?.surfaces?.filter((surface) => surface.mapMatrixCellIndex === undefined).length ?? 0
        const unownedProps = candidate.model?.mapProps?.filter((prop) => prop.mapMatrixCellIndex === undefined).length ?? 0
        return unownedSurfaces > 0 || unownedProps > 0
          ? [{ mapId: candidate.id, matrix: candidate.matrix.matrixIndex, unownedSurfaces, unownedProps }]
          : []
      })
    expect(ownershipIssues).toEqual([])
  }, 120_000)

  probe('prints suspect member layouts', async () => {
    const romBuffer = await readFile(romPath)
    const romBytes = new Uint8Array(romBuffer.buffer, romBuffer.byteOffset, romBuffer.byteLength)
    const inventory = await readRomInventory(new File([romBuffer], basename(romPath)))
    const landDataArchive = inventory.files.find((entry) => entry.path === '/a/0/6/5')
    const fieldModelArchive = inventory.files.find((entry) => entry.path === '/fielddata/build_model/bm_field.narc')
    expect(landDataArchive).toBeTruthy()
    expect(fieldModelArchive).toBeTruthy()

    const memberIds = [0, 1, 6, 11, 113]
    const result = Object.fromEntries(memberIds.map((memberId) => {
      const member = landDataArchive!.archiveMembers[memberId]
      const terrain = decodeMapTerrain(romBytes, landDataArchive, memberId)
      const plates = terrain?.collisionPlates ?? []
      return [memberId, {
        ...inspectMember(romBytes, member.offset, member.size, fieldModelArchive!.archiveMembers.length),
        plateCount: plates.length,
        plateBounds: plates.length === 0 ? undefined : {
          minX: Math.min(...plates.map((plate) => plate.minX)),
          maxX: Math.max(...plates.map((plate) => plate.maxX)),
          minZ: Math.min(...plates.map((plate) => plate.minZ)),
          maxZ: Math.max(...plates.map((plate) => plate.maxZ)),
        },
        firstPlates: plates.slice(0, 4),
      }]
    }))

    console.log(JSON.stringify(result, null, 2))
    expect(true).toBe(true)
  }, 30000)

  probe('preserves opening map prop identities and native metadata classes', async () => {
    const romBuffer = await readFile(romPath)
    const romBytes = new Uint8Array(romBuffer.buffer, romBuffer.byteOffset, romBuffer.byteLength)
    const inventory = await readRomInventory(new File([romBuffer], basename(romPath)))
    const hgMetadata = inventory.files.find((entry) => entry.path === '/a/1/0/7')
    const ssMetadata = inventory.files.find((entry) => entry.path === '/a/1/0/8')
    expect(hgMetadata).toBeTruthy()
    expect(ssMetadata).toBeTruthy()

    const maps = inventory.resolvedMapCatalog.maps.filter((map) => map.id >= 60 && map.id <= 64)
    const openingMaps = inventory.resolvedMapCatalog.maps.filter((map) => map.id >= 60 && map.id <= 66)
    expect(openingMaps.flatMap((map) => Array.from(map.terrain?.attributes ?? []))
      .every((attribute) => (attribute & 0xff) !== 106 && (attribute & 0xff) !== 107)).toBe(true)
    expect(openingMaps.flatMap((map) => map.model?.mapProps ?? [])
      .every((prop) => ![11, 12, 13, 14].includes(prop.modelId))).toBe(true)
    const props = maps.flatMap((map) => map.model?.mapProps ?? [])
    expect(props.length).toBeGreaterThan(0)
    expect(props.every((prop) => Number.isInteger(prop.modelId)
      && prop.position.every(Number.isFinite)
      && prop.rotation.every(Number.isFinite)
      && prop.scale.every(Number.isFinite))).toBe(true)

    const readClasses = (archive: NonNullable<typeof hgMetadata>) => props
      .map((prop) => archive.archiveMembers[prop.modelId])
      .filter((member): member is NonNullable<typeof member> => Boolean(member && member.size >= 5))
      .map((member) => romBytes[member.offset + 4]!)
    const hgClasses = readClasses(hgMetadata!)
    const ssClasses = readClasses(ssMetadata!)
    expect(hgClasses.every((soundClass) => soundClass >= 0 && soundClass <= 4)).toBe(true)
    expect(ssClasses.every((soundClass) => soundClass >= 0 && soundClass <= 4)).toBe(true)
    expect(hgClasses.some((soundClass) => soundClass > 0)).toBe(true)

    const resolveMetadata = inventory.mapPropAnimationMetadataResolver
    expect(resolveMetadata).toBeTypeOf('function')
    const doorAudit: Array<{ mapId: number, tileX: number, tileZ: number, classifiedProps: Array<{ modelId: number, classId: number, position: readonly [number, number, number] }> }> = []
    const doors = maps.flatMap((map) => {
      if (!map.terrain || !resolveMetadata) return []
      const origin = getMapOrigin(map)
      return (map.events?.warps ?? []).flatMap((warp) => {
        const tileX = warp.x - origin.x
        const tileZ = warp.z - origin.z
        const attribute = map.terrain?.attributes[tileZ * map.terrain.width + tileX]
        if (attribute === undefined || (attribute & 0xff) !== 105) return []
        doorAudit.push({
          mapId: map.id,
          tileX,
          tileZ,
          classifiedProps: (map.model?.mapProps ?? []).flatMap((prop) => {
            const metadata = resolveMetadata(prop.modelId)
            return metadata?.classId ? [{ modelId: prop.modelId, classId: metadata.classId, position: prop.position }] : []
          }),
        })
        const descriptor = resolveDoorTransitionDescriptor(tileX, tileZ + 1, map.model?.mapProps ?? [], resolveMetadata)
        const arrivalDescriptor = resolveDoorTransitionDescriptor(tileX, tileZ, map.model?.mapProps ?? [], resolveMetadata, 'arrival')
        return descriptor && arrivalDescriptor ? [{ mapId: map.id, tileX, tileZ, descriptor, arrivalDescriptor }] : []
      })
    })
    expect(doors.length, JSON.stringify(doorAudit, null, 2)).toBeGreaterThan(0)
    expect(doors.every(({ descriptor }) => descriptor.tag === 1
      && descriptor.classId >= 1
      && descriptor.classId <= 4
      && descriptor.animationArchiveIds.length >= 2)).toBe(true)
    expect(doors.every(({ descriptor, arrivalDescriptor }) => descriptor.modelId === arrivalDescriptor.modelId)).toBe(true)
    const animationArchive = inventory.files.find((entry) => entry.path === '/a/1/0/6')
    expect(animationArchive).toBeTruthy()
    const animationMembers = doors.flatMap(({ descriptor }) => descriptor.animationArchiveIds.slice(0, 2)
      .map((archiveId) => animationArchive?.archiveMembers[archiveId]))
    expect(animationMembers.every((member) => member?.signature === 'B C A 0')).toBe(true)
    const resolveAnimation = inventory.mapPropAnimationResolver
    expect(resolveAnimation).toBeTypeOf('function')
    const animationAudit = doors.flatMap(({ mapId, descriptor }) => {
      const map = maps.find((candidate) => candidate.id === mapId)!
      return descriptor.animationArchiveIds.slice(0, 2).map((archiveId) => ({
        mapId,
        modelId: descriptor.modelId,
        archiveId,
        animation: resolveAnimation?.(descriptor.modelId, map.header.areaDataBank, archiveId),
      }))
    })
    expect(animationAudit.every(({ animation }) => animation
      && animation.frameCount > 1
      && animation.frames.length === animation.frameCount
      && animation.frames.every((frame) => frame.surfaces?.length && frame.textures?.length)), JSON.stringify(
      animationAudit.filter(({ animation }) => !animation
        || animation.frameCount <= 1
        || animation.frames.length !== animation.frameCount
        || animation.frames.some((frame) => !frame.surfaces?.length || !frame.textures?.length))
        .map(({ mapId, modelId, archiveId }) => ({ mapId, modelId, archiveId })),
    )).toBe(true)
  }, 30000)
})
