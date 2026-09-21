import * as THREE from 'three'
import type { OpeningMapPreview } from '../../ndsTypes'
import { getMapGroundHeight, usesWorldMatrixCoordinates } from '../../game/world/mapCoordinates'

export type SceneLayout = {
  floorMinX: number
  floorMaxX: number
  floorMinZ: number
  floorMaxZ: number
  cameraHeight: number
  cameraDistance: number
  focusX: number
  focusZ: number
}

const indoorTileSize = 16

export function projectMapPosition(
  _layout: SceneLayout | undefined,
  map: OpeningMapPreview | undefined,
  x: number,
  z: number,
  y = 0.08,
  referenceGroundHeight?: number,
): THREE.Vector3 {
  if (!map) throw new Error('Aucune carte ROM active pour projeter la position.')
  if (usesWorldMatrixCoordinates(map)) {
    // À une couture d'en-tête, le sprite du follower peut encore se trouver
    // une case dans la parcelle voisine. Sa BDHC a déjà été résolue par le
    // monde, mais elle n'appartient pas au terrain de la carte de rendu.
    const groundHeight = getMapGroundHeight(map, x, z, referenceGroundHeight) ?? referenceGroundHeight ?? 0
    return new THREE.Vector3(x + 0.5, groundHeight + y, z + 0.5)
  }
  if (!map.terrain) throw new Error(`La carte ROM ${map.id} ne contient aucun terrain.`)
  const groundHeight = getMapGroundHeight(map, x, z, referenceGroundHeight) ?? referenceGroundHeight ?? 0
  return new THREE.Vector3(
    (x + 0.5 - map.terrain.width / 2) * indoorTileSize,
    groundHeight + y,
    (z + 0.5 - map.terrain.height / 2) * indoorTileSize,
  )
}

/** Inverse la projection affine des tuiles sans sonder les 1 024 cases de la carte. */
export function unprojectMapTile(
  map: OpeningMapPreview | undefined,
  position: Pick<THREE.Vector3, 'x' | 'z'>,
): { x: number, z: number } {
  if (!map) return { x: 0, z: 0 }
  if (usesWorldMatrixCoordinates(map)) return { x: Math.round(position.x - 0.5), z: Math.round(position.z - 0.5) }
  const width = map.terrain?.width ?? 32
  const height = map.terrain?.height ?? 32
  return {
    x: Math.round(position.x / indoorTileSize + width / 2 - 0.5),
    z: Math.round(position.z / indoorTileSize + height / 2 - 0.5),
  }
}
