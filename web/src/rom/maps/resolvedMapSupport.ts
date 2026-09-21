import type { MapHeaderPreview, MapMatrixPreview } from '../../ndsTypes'
import { stripMessageControls } from '../messages/hgssMessageBank'

export function usesWorldMatrixCoordinates(mapId: number, matrix: MapMatrixPreview): boolean {
  if (matrix.hasHeaders === false) return false
  const mapCell = matrix.headers.indexOf(mapId)
  return mapCell >= 0 && (matrix.width > 1 || matrix.height > 1)
}

export function resolveMapLabel(mapId: number, header: MapHeaderPreview, mapSectionNames: Record<number, string>): string {
  const label = stripMessageControls(mapSectionNames[header.mapSection] ?? '')
  if (!label) throw new Error(`Le nom ROM de la section ${header.mapSection} de la carte ${mapId} est absent.`)
  return label
}
