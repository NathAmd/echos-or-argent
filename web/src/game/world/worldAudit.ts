import type { OpeningMapPreview } from '../../ndsTypes'
import { getMapOrigin } from './mapCoordinates'
import { createWorldSession } from './worldSession'
import { getMapMatrixFootprint, mapMatrixCellSize } from '../../rom/maps/mapFootprint'

export type WorldAuditIssue = {
  kind: 'missing-destination' | 'missing-anchor' | 'wrong-spawn'
  sourceMapId: number
  sourceWarpIndex: number
  destinationMapId: number
  anchor: number
  details: string
}

export function auditWorldWarps(maps: OpeningMapPreview[]): WorldAuditIssue[] {
  const issues: WorldAuditIssue[] = []
  const mapsById = new Map(maps.map((map) => [map.id, map]))
  for (const source of maps) {
    for (const [sourceWarpIndex, warp] of (source.events?.warps ?? []).entries()) {
      // 0xFFF / 0x100 est le sentinel HGSS des destinations choisies par un
      // script natif (ascenseurs, téléporteurs, etc.). Ce n'est pas une carte
      // absente et il ne peut pas être validé sans exécuter ce script.
      if (warp.header === 0x0fff && warp.anchor === 0x0100) continue
      const destination = mapsById.get(warp.header)
      if (!destination) {
        issues.push({ kind: 'missing-destination', sourceMapId: source.id, sourceWarpIndex, destinationMapId: warp.header, anchor: warp.anchor, details: 'La carte destination est absente du catalogue ROM.' })
        continue
      }
      const expected = destination.events?.warps[warp.anchor]
      if (!expected) {
        issues.push({ kind: 'missing-anchor', sourceMapId: source.id, sourceWarpIndex, destinationMapId: warp.header, anchor: warp.anchor, details: 'L’ancre destination est absente des événements ROM.' })
        continue
      }
      const session = createWorldSession(maps)
      const origin = getMapOrigin(source)
      session.loadMap(source.id, warp.x - origin.x, warp.z - origin.z)
      const result = session.transitionTo(warp.header, warp.anchor)
      if (result.kind !== 'transitioned') {
        issues.push({ kind: 'missing-anchor', sourceMapId: source.id, sourceWarpIndex, destinationMapId: warp.header, anchor: warp.anchor, details: `Transition refusée : ${result.kind}.` })
        continue
      }
      const destinationOrigin = getMapOrigin(destination)
      const anchorTileX = expected.x - destinationOrigin.x
      const anchorTileZ = expected.z - destinationOrigin.z
      // Une porte extérieure porte son warp sur la tuile murale. Le moteur
      // natif enchaîne ensuite le pas de sortie vers le sud (comportement 105).
      // L'audit valide à la fois l'ancre et ce déplacement, au lieu de prendre
      // la position jouable finale pour une mauvaise destination.
      const expectedTileX = anchorTileX
      const expectedTileZ = result.arrival ? anchorTileZ + 1 : anchorTileZ
      const arrivalMatchesAnchor = !result.arrival
        || (result.arrival.fromTileX === anchorTileX && result.arrival.fromTileZ === anchorTileZ)
      if (!arrivalMatchesAnchor || result.state.tileX !== expectedTileX || result.state.tileZ !== expectedTileZ) {
        issues.push({ kind: 'wrong-spawn', sourceMapId: source.id, sourceWarpIndex, destinationMapId: warp.header, anchor: warp.anchor, details: `Spawn obtenu ${result.state.tileX},${result.state.tileZ}, attendu ${expectedTileX},${expectedTileZ}.` })
      }
    }
  }
  return issues
}

export type WorldGeometryIssue = {
  kind: 'matrix-size' | 'missing-footprint' | 'terrain-size' | 'terrain-footprint' | 'invalid-collision' | 'invalid-surface' | 'invalid-surface-owner'
  mapId: number
  details: string
}

/**
 * Vérifie les contrats structurels qui doivent être vrais avant tout rendu ou
 * déplacement. Cet audit porte sur toutes les cartes décodées, pas seulement
 * sur celles visitées par le parcours d'ouverture.
 */
export function auditWorldGeometry(maps: readonly OpeningMapPreview[]): WorldGeometryIssue[] {
  const issues: WorldGeometryIssue[] = []
  for (const map of maps) {
    const matrix = map.matrix
    const cellCount = matrix.width * matrix.height
    if (matrix.width <= 0 || matrix.height <= 0 || matrix.headers.length !== cellCount
      || matrix.altitudes.length !== cellCount || matrix.modelIds.length !== cellCount) {
      issues.push({ kind: 'matrix-size', mapId: map.id, details: `Matrice ${matrix.width}×${matrix.height}, headers=${matrix.headers.length}, altitudes=${matrix.altitudes.length}, modèles=${matrix.modelIds.length}.` })
      continue
    }
    const footprint = getMapMatrixFootprint(map.id, matrix)
    if (matrix.hasHeaders !== false && !footprint) {
      issues.push({ kind: 'missing-footprint', mapId: map.id, details: 'Aucune cellule de matrice ne possède ce header.' })
    }
    const terrain = map.terrain
    if (terrain) {
      if (terrain.width <= 0 || terrain.height <= 0 || terrain.attributes.length !== terrain.width * terrain.height) {
        issues.push({ kind: 'terrain-size', mapId: map.id, details: `Terrain ${terrain.width}×${terrain.height}, attributs=${terrain.attributes.length}.` })
      }
      if (matrix.hasHeaders !== false && footprint
        && (terrain.width !== footprint.widthCells * mapMatrixCellSize || terrain.height !== footprint.heightCells * mapMatrixCellSize)) {
        issues.push({ kind: 'terrain-footprint', mapId: map.id, details: `Terrain ${terrain.width}×${terrain.height}, empreinte ${footprint.widthCells}×${footprint.heightCells} parcelles.` })
      }
      for (const [index, plate] of (terrain.collisionPlates ?? []).entries()) {
        const values = [plate.minX, plate.maxX, plate.minZ, plate.maxZ, plate.normalX, plate.normalY, plate.normalZ, plate.distance]
        if (values.some((value) => !Number.isFinite(value)) || Math.hypot(plate.normalX, plate.normalY, plate.normalZ) < 1e-8) {
          issues.push({ kind: 'invalid-collision', mapId: map.id, details: `Plaque BDHC ${index} invalide.` })
        }
      }
    }
    for (const [surfaceIndex, surface] of (map.model?.surfaces ?? []).entries()) {
      if (surface.positions.length % 9 !== 0 || [...surface.positions].some((value) => !Number.isFinite(value))) {
        issues.push({ kind: 'invalid-surface', mapId: map.id, details: `Surface ${surfaceIndex}, positions=${surface.positions.length}.` })
      }
      if (surface.mapMatrixCellIndex !== undefined
        && (surface.mapMatrixCellIndex < 0 || surface.mapMatrixCellIndex >= cellCount)) {
        issues.push({ kind: 'invalid-surface-owner', mapId: map.id, details: `Surface ${surfaceIndex}, cellule=${surface.mapMatrixCellIndex}, total=${cellCount}.` })
      }
    }
  }
  return issues
}
