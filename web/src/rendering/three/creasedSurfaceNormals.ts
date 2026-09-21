import * as THREE from 'three'
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export const defaultWorldCreaseAngle = THREE.MathUtils.degToRad(65)

/**
 * Lisse l'éclairage entre les facettes proches sans modifier les positions ROM.
 * Les coins francs restent séparés afin que les murs et les marches ne fondent
 * pas visuellement les uns dans les autres.
 */
export function applyCreasedSurfaceNormals(
  geometry: THREE.BufferGeometry,
  creaseAngle = defaultWorldCreaseAngle,
): THREE.BufferGeometry {
  const position = geometry.getAttribute('position')
  if (!(position instanceof THREE.BufferAttribute) || position.count < 3) return geometry
  return toCreasedNormals(geometry, creaseAngle)
}
