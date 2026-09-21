import type { FieldCameraParam } from '../../ndsTypes'
import { readArm9OverlayFromRom } from '../arm9Overlay'

const cameraCount = 17
const cameraRecordSize = 36

export type FieldCameraProjection =
  | { kind: 'perspective', verticalFovDegrees: number }
  | { kind: 'orthographic', viewHeight: number }

export type FieldCameraGroundMargins = {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

type Vector3 = { x: number, y: number, z: number }

const remasteredElevationRatio = 0.88

function signedNitroAngle(angle: number): number {
  return (angle >= 0x8000 ? angle - 0x10000 : angle) * Math.PI * 2 / 0x10000
}

/**
 * Conserve le profil propre a chaque carte ROM en abaissant seulement son
 * elevation. Le facteur modere evite la vue trop plongeante sur grand ecran
 * sans uniformiser les cameras speciales des arenes et des interieurs.
 */
export function resolveRemasteredFieldCameraAngles(camera: FieldCameraParam): { angleX: number, angleY: number } {
  return {
    angleX: signedNitroAngle(camera.angleX) * remasteredElevationRatio,
    angleY: signedNitroAngle(camera.angleY),
  }
}

function normalize(vector: Vector3): Vector3 {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length }
}

function cross(left: Vector3, right: Vector3): Vector3 {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  }
}

/**
 * Convertit le profil Nitro en projection Three.js sans perdre la distinction
 * native entre perspective (0) et orthographique (1). NNS_G3d reçoit le sinus
 * et le cosinus du demi-angle vertical ; Three.js attend l'angle vertical
 * complet en degrés.
 */
export function resolveFieldCameraProjection(
  camera: FieldCameraParam,
  distanceScale = 1,
): FieldCameraProjection {
  const halfFovRadians = camera.perspectiveAngle * Math.PI * 2 / 0x10000
  if (camera.perspectiveType === 0) {
    return {
      kind: 'perspective',
      verticalFovDegrees: halfFovRadians * 2 * 180 / Math.PI,
    }
  }
  return {
    kind: 'orthographic',
    viewHeight: Math.max(0.01, Math.tan(halfFovRadians) * camera.distance * distanceScale * 2),
  }
}

/**
 * Projette les quatre coins de l'écran sur le plan du sol passant par la cible.
 * Ces marges permettent de bloquer la caméra avant une bordure MAP_EVERYWHERE
 * sans modifier sa distance ou son angle ROM.
 */
export function resolveFieldCameraGroundMargins(
  camera: FieldCameraParam,
  distanceScale: number,
  aspect: number,
): FieldCameraGroundMargins | undefined {
  const distance = camera.distance * distanceScale
  const { angleX, angleY } = resolveRemasteredFieldCameraAngles(camera)
  const horizontalDistance = Math.cos(angleX) * distance
  const cameraOffset = {
    x: Math.sin(angleY) * horizontalDistance,
    y: Math.sin(-angleX) * distance,
    z: Math.cos(angleY) * horizontalDistance,
  }
  if (cameraOffset.y <= 0.001) return undefined

  const forward = normalize({ x: -cameraOffset.x, y: -cameraOffset.y, z: -cameraOffset.z })
  const right = normalize(cross(forward, { x: 0, y: 1, z: 0 }))
  const up = normalize(cross(right, forward))
  const projection = resolveFieldCameraProjection(camera, distanceScale)
  const halfHeight = projection.kind === 'perspective'
    ? Math.tan(projection.verticalFovDegrees * Math.PI / 360)
    : projection.viewHeight / (2 * distance)
  const halfWidth = halfHeight * Math.max(0.01, aspect)
  const intersections: Vector3[] = []

  for (const screenY of [-1, 1]) {
    for (const screenX of [-1, 1]) {
      const origin = projection.kind === 'orthographic'
        ? {
            x: cameraOffset.x + right.x * halfWidth * distance * screenX + up.x * halfHeight * distance * screenY,
            y: cameraOffset.y + right.y * halfWidth * distance * screenX + up.y * halfHeight * distance * screenY,
            z: cameraOffset.z + right.z * halfWidth * distance * screenX + up.z * halfHeight * distance * screenY,
          }
        : cameraOffset
      const direction = projection.kind === 'perspective'
        ? normalize({
            x: forward.x + right.x * halfWidth * screenX + up.x * halfHeight * screenY,
            y: forward.y + right.y * halfWidth * screenX + up.y * halfHeight * screenY,
            z: forward.z + right.z * halfWidth * screenX + up.z * halfHeight * screenY,
          })
        : forward
      if (direction.y >= -0.0001) return undefined
      const travel = -origin.y / direction.y
      intersections.push({
        x: origin.x + direction.x * travel,
        y: 0,
        z: origin.z + direction.z * travel,
      })
    }
  }

  return {
    minX: Math.min(...intersections.map(({ x }) => x)),
    maxX: Math.max(...intersections.map(({ x }) => x)),
    minZ: Math.min(...intersections.map(({ z }) => z)),
    maxZ: Math.max(...intersections.map(({ z }) => z)),
  }
}

// Signature des deux premiers profils natifs. Elle sert uniquement à trouver
// la table dans l'overlay relogeable ; les valeurs utilisées par le rendu sont
// ensuite toutes relues depuis la ROM sélectionnée.
const tablePrefix = [
  { distance: 0x0029aec1, angleX: 0xdd62, perspective: 0x05c1, near: 0x00096000, far: 0x004b0000 },
  { distance: 0x0019465c, angleX: 0xe383, perspective: 0x0981, near: 0x00086000, far: 0x004b0000 },
] as const

export function locateFieldCameraTable(overlay: Uint8Array): number {
  const view = new DataView(overlay.buffer, overlay.byteOffset, overlay.byteLength)
  const matches: number[] = []
  for (let offset = 0; offset + cameraCount * cameraRecordSize <= overlay.byteLength; offset += 4) {
    const matchesPrefix = tablePrefix.every((expected, index) => {
      const entry = offset + index * cameraRecordSize
      return view.getUint32(entry, true) === expected.distance
        && view.getUint16(entry + 4, true) === expected.angleX
        && view.getUint16(entry + 14, true) === expected.perspective
        && view.getUint32(entry + 16, true) === expected.near
        && view.getUint32(entry + 20, true) === expected.far
    })
    if (matchesPrefix) matches.push(offset)
  }
  if (matches.length !== 1) throw new Error(`La table camera HGSS doit etre unique; ${matches.length} candidate(s) trouvee(s).`)
  return matches[0]!
}

export function decodeFieldCameraTable(overlay: Uint8Array, tableOffset = locateFieldCameraTable(overlay)): FieldCameraParam[] {
  if (tableOffset < 0 || tableOffset + cameraCount * cameraRecordSize > overlay.byteLength) {
    throw new Error('La table camera HGSS est hors limites.')
  }
  const view = new DataView(overlay.buffer, overlay.byteOffset, overlay.byteLength)
  const fixed = (offset: number): number => view.getInt32(offset, true) / 4096
  return Array.from({ length: cameraCount }, (_, type) => {
    const offset = tableOffset + type * cameraRecordSize
    return {
      type,
      distance: fixed(offset),
      angleX: view.getUint16(offset + 4, true),
      angleY: view.getUint16(offset + 6, true),
      angleZ: view.getUint16(offset + 8, true),
      perspectiveType: view.getUint8(offset + 12),
      perspectiveAngle: view.getUint16(offset + 14, true),
      near: fixed(offset + 16),
      far: fixed(offset + 20),
      lookAtOffsetX: fixed(offset + 24),
      lookAtOffsetY: fixed(offset + 28),
      lookAtOffsetZ: fixed(offset + 32),
    }
  })
}

export function decodeFieldCameraParamsFromRom(rom: Uint8Array): FieldCameraParam[] {
  return decodeFieldCameraTable(readArm9OverlayFromRom(rom, 1))
}
