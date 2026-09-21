import type { OpeningMapPreview } from '../../../ndsTypes'
import { isSurfableMetatile, isWaterfallMetatile } from '../../player/hgssPlayerMovement'
import { HGSS_SAFARI_MAP_ID } from '../../safari/hgssSafariMap'
import { getMapOrigin } from '../../world/mapCoordinates'
import { createWorldMapEntryReachability, type WorldMapEntryReachability } from '../../world/worldMapEntryReachability'
import type { AllPokemonQuestWorldLocation } from './allPokemonQuestWorldCoordinator'

export type AllPokemonQuestLocationPlannerOptions = Readonly<{
  maximumLocations?: number
}>

function isWalkableLand(attribute: number | undefined): boolean {
  return attribute !== undefined
    && (attribute & 0x8000) === 0
    && !isSurfableMetatile(attribute)
    && !isWaterfallMetatile(attribute)
}

function occupiedTiles(map: OpeningMapPreview): ReadonlySet<string> {
  const origin = getMapOrigin(map)
  const keys = new Set<string>()
  const add = (x: number, z: number) => keys.add(`${x - origin.x}:${z - origin.z}`)
  for (const object of map.events?.objects ?? []) add(object.x, object.z)
  for (const warp of map.events?.warps ?? []) add(warp.x, warp.z)
  for (const background of map.events?.backgrounds ?? []) add(background.x, background.z)
  for (const coordinate of map.events?.coordinateEvents ?? []) add(coordinate.x, coordinate.z)
  return keys
}

function findLocation(
  map: OpeningMapPreview,
  reachability: WorldMapEntryReachability,
): AllPokemonQuestWorldLocation | undefined {
  const terrain = map.terrain
  if (!terrain || terrain.width < 3 || terrain.height < 3 || map.header.wildEncounterBank === 0xff) return undefined
  const occupied = occupiedTiles(map)
  const read = (x: number, z: number) => terrain.attributes[z * terrain.width + x]
  const centerX = (terrain.width - 1) / 2, centerZ = (terrain.height - 1) / 2
  const candidates: Array<{ tileX: number, tileZ: number, direction: AllPokemonQuestWorldLocation['direction'], score: number }> = []
  for (let tileZ = 1; tileZ < terrain.height - 1; tileZ += 1) for (let tileX = 1; tileX < terrain.width - 1; tileX += 1) {
    if (!isWalkableLand(read(tileX, tileZ)) || occupied.has(`${tileX}:${tileZ}`)) continue
    const approaches = [
      { x: tileX, z: tileZ + 1, direction: 'north' as const },
      { x: tileX, z: tileZ - 1, direction: 'south' as const },
      { x: tileX + 1, z: tileZ, direction: 'west' as const },
      { x: tileX - 1, z: tileZ, direction: 'east' as const },
    ]
    const approach = approaches.find(({ x, z }) => (
      isWalkableLand(read(x, z))
      && !occupied.has(`${x}:${z}`)
      && reachability.isReachable(x, z)
    ))
    if (approach) candidates.push({ tileX, tileZ, direction: approach.direction, score: Math.abs(tileX - centerX) + Math.abs(tileZ - centerZ) })
  }
  const selected = candidates.sort((left, right) => left.score - right.score || left.tileZ - right.tileZ || left.tileX - right.tileX)[0]
  return selected && Object.freeze({ mapId: map.id, mapSectionId: map.header.mapSection, tileX: selected.tileX, tileZ: selected.tileZ, direction: selected.direction })
}

/** Répartit les autels de quête sur des zones sauvages praticables distinctes. */
export function createAllPokemonQuestWorldLocations(
  maps: readonly OpeningMapPreview[],
  options: AllPokemonQuestLocationPlannerOptions = {},
): readonly AllPokemonQuestWorldLocation[] {
  const maximum = options.maximumLocations ?? 12
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 64) throw new Error("Le nombre d'emplacements de quêtes est invalide.")
  const sections = new Set<string>()
  const locations: AllPokemonQuestWorldLocation[] = []
  for (const map of [...maps].sort((left, right) => left.header.region - right.header.region || left.id - right.id)) {
    // Une quete standard ne doit pas remplacer le moteur, les Balles ni la
    // sortie propres a une session Safari active.
    if (map.id === HGSS_SAFARI_MAP_ID) continue
    const sectionKey = `${map.header.region}:${map.header.mapSection}`
    if (sections.has(sectionKey)) continue
    const location = findLocation(map, createWorldMapEntryReachability(maps, map.id))
    if (!location) continue
    sections.add(sectionKey)
    locations.push(location)
    if (locations.length >= maximum) break
  }
  if (locations.length === 0) throw new Error('Aucune zone praticable ne peut accueillir les quêtes Tous les Pokémon.')
  return Object.freeze(locations)
}
