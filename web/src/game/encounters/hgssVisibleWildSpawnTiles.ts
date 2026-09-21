import type { OpeningMapPreview } from '../../ndsTypes'
import { isSurfableMetatile, isWaterfallMetatile } from '../player/hgssPlayerMovement'
import { getMapOrigin } from '../world/mapCoordinates'
import type { HgssVisibleWildEncounterMethod, HgssVisibleWildSpawnTile } from './hgssVisibleWildEncounterCandidates'

export type HgssVisibleWildSpawnTileOptions = Readonly<{
  map: OpeningMapPreview
  method: HgssVisibleWildEncounterMethod
  maximum?: number
  isBlocked?: (tileX: number, tileZ: number) => boolean
}>

function collectRomOccupiedTiles(map: OpeningMapPreview): ReadonlySet<string> {
  const origin = getMapOrigin(map), occupied = new Set<string>()
  const add = (x: number, z: number) => occupied.add(`${x - origin.x}:${z - origin.z}`)
  for (const object of map.events?.objects ?? []) add(object.x, object.z)
  for (const warp of map.events?.warps ?? []) add(warp.x, warp.z)
  for (const background of map.events?.backgrounds ?? []) add(background.x, background.z)
  for (const coordinate of map.events?.coordinateEvents ?? []) {
    for (let z = 0; z < Math.max(1, coordinate.height); z += 1) {
      for (let x = 0; x < Math.max(1, coordinate.width); x += 1) add(coordinate.x + x, coordinate.z + z)
    }
  }
  return occupied
}

/** Cases issues uniquement du terrain ROM et débarrassées des événements fixes. */
export function resolveHgssVisibleWildSpawnTiles(
  options: HgssVisibleWildSpawnTileOptions,
): readonly HgssVisibleWildSpawnTile[] {
  const terrain = options.map.terrain
  const maximum = options.maximum ?? 64
  if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum > 4_096) throw new Error('La limite de cases sauvages visibles est invalide.')
  if (!terrain || maximum === 0) return Object.freeze([])
  const occupied = collectRomOccupiedTiles(options.map), tiles: HgssVisibleWildSpawnTile[] = []
  for (let tileZ = 0; tileZ < terrain.height && tiles.length < maximum; tileZ += 1) for (let tileX = 0; tileX < terrain.width && tiles.length < maximum; tileX += 1) {
    const attribute = terrain.attributes[tileZ * terrain.width + tileX]
    const valid = options.method === 'surfing'
      ? isSurfableMetatile(attribute) && !isWaterfallMetatile(attribute)
      : attribute !== undefined && (attribute & 0x8000) === 0 && !isSurfableMetatile(attribute) && !isWaterfallMetatile(attribute)
    if (valid && !occupied.has(`${tileX}:${tileZ}`) && !options.isBlocked?.(tileX, tileZ)) tiles.push(Object.freeze({ tileX, tileZ }))
  }
  return Object.freeze(tiles)
}
