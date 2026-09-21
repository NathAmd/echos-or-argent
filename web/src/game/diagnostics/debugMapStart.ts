import type { OpeningMapPreview, PlayerDirection } from '../../ndsTypes'
import type { MapInitPhase } from '../../rom/scripts/fieldScripts'
import { getMapOrigin } from '../world/mapCoordinates'

export type DebugMapStart = {
  mapId: number
  tileX?: number
  tileZ?: number
  direction: PlayerDirection
  phase?: MapInitPhase
}

export function readDebugMapStart(search: string): DebugMapStart | undefined {
  const query = new URLSearchParams(search)
  const mapId = Number.parseInt(query.get('debugMap') ?? '', 10)
  if (!Number.isInteger(mapId) || mapId < 0) return undefined
  const tileX = Number.parseInt(query.get('debugX') ?? '', 10)
  const tileZ = Number.parseInt(query.get('debugZ') ?? '', 10)
  const direction = query.get('debugDirection')
  const phase = query.get('debugPhase')
  return {
    mapId,
    tileX: Number.isInteger(tileX) ? tileX : undefined,
    tileZ: Number.isInteger(tileZ) ? tileZ : undefined,
    direction: direction === 'north' || direction === 'south' || direction === 'west' || direction === 'east' ? direction : 'south',
    phase: phase === 'transition' || phase === 'resume' || phase === 'load' ? phase : undefined,
  }
}

export function resolveDebugSpawn(map: OpeningMapPreview, requested: DebugMapStart): { tileX: number, tileZ: number } {
  if (requested.tileX !== undefined && requested.tileZ !== undefined) return { tileX: requested.tileX, tileZ: requested.tileZ }
  const origin = getMapOrigin(map)
  const warp = map.events?.warps[0]
  if (warp) return { tileX: warp.x - origin.x, tileZ: warp.z - origin.z }
  if (map.terrain) return { tileX: Math.max(0, Math.floor(map.terrain.width / 2)), tileZ: Math.max(0, Math.floor(map.terrain.height / 2)) }
  const bounds = map.model?.tileBounds
  return bounds
    ? { tileX: Math.max(0, Math.floor((bounds.minX + bounds.maxX - 1) / 2)), tileZ: Math.max(0, Math.floor((bounds.minZ + bounds.maxZ - 1) / 2)) }
    : { tileX: 0, tileZ: 0 }
}
