import type { NitroGraphic, OpeningMapPreview } from '../../ndsTypes'
import type { HgssPokegearMapData, HgssPokegearMapLocation } from '../../rom/pokegear/mapData'
import type { MapEncounterLandmark } from '../../rom/pokegear/mapEncounterLandmarks'
import type { HgssPhoneBookEntry } from '../../rom/phone/phoneBook'
import type { HgssRoamer } from '../encounters/hgssRoamers'
import type { PokemonParty } from '../pokemon/pokemonParty'
import { getFieldMoveAvailability } from '../player/hgssPlayerMovement'
import { HGSS_PAL_PARK_SYSTEM_FLAG, HGSS_SAFARI_SYSTEM_FLAG } from '../scripts/hgssFieldSystemFlags'
import { resolveHgssFieldVisualTime, resolveHgssTimeOfDay } from '../time/hgssRtc'
import { canFlyBetweenPokegearRegions, hgssPokegearFlypointFlagBase, isPokegearDestinationVisible, resolvePokegearRegion, type PokegearMapMarkings, type PokegearRegion } from './pokegearNativeState'

const mapXMaximumByUnlockLevel = [25, 28, 44] as const
const cianwoodNameMapId = 75
const sinjohMapIds = new Set([521, 522, 523])
const ssAquaMapIds = new Set([307, 308, 309, 310, 311, 328, 329])
const regionProgression: Readonly<Record<PokegearRegion, number>> = { johto: 0, indigo: 1, kanto: 2 }
const backgroundCompositionCache = new WeakMap<NitroGraphic, Map<string, NitroGraphic>>()
const highlightCompositionCache = new WeakMap<NitroGraphic, Map<string, NitroGraphic>>()

export type PokegearMapCursor = { x: number, y: number }

export type PokegearMapLocation = HgssPokegearMapLocation & {
  label: string
  region: PokegearRegion
  flavor: string
  visited: boolean
  progressionIndex: number
}

export type PokegearFlypoint = {
  nameMapId: number
  warpMapId: number
  flagIndex: number
  markerPalette: number
  x: number
  y: number
  width: number
  height: number
  tilemapSourceX: number
  tilemapSourceY: number
  tilemapWidth: number
  tilemapHeight: number
  tilemapDestinationX: number
  tilemapDestinationY: number
  label: string
  unlocked: boolean
  region: PokegearRegion
}

export type PokegearMapRoamer = {
  roamerId: number
  speciesId: number
  mapId: number
  x: number
  y: number
}

export type PokegearMapAttention = {
  mapId: number
  x: number
  y: number
  label: string
}

export type PokegearMapEncounter = {
  mapId: number
  locationMapId: number
  speciesId: number
  x: number
  y: number
  completed: boolean
}

export type PokegearMapDisplayedMarkings = PokegearMapMarkings & PokegearMapCursor

export type PokegearMapModel = {
  background: NitroGraphic
  backgroundKey: string
  highlight?: NitroGraphic
  highlightKey: string
  locationPreview?: NitroGraphic
  areaBanner?: NitroGraphic
  presentationKey: string
  cursor: PokegearMapCursor
  currentCursor: PokegearMapCursor
  currentPosition: PokegearMapCursor
  currentLocation?: PokegearMapLocation
  currentLocationLabel: string
  regionLabel: string
  location?: PokegearMapLocation
  locations: PokegearMapLocation[]
  flypoint?: PokegearFlypoint
  flypoints: PokegearFlypoint[]
  roamers: PokegearMapRoamer[]
  encounters: PokegearMapEncounter[]
  phoneAttention: PokegearMapAttention[]
  markings: PokegearMapDisplayedMarkings[]
  selectedMarkings?: PokegearMapDisplayedMarkings
  canFly: boolean
  prompt: string
  flyLabel: string
  closeLabel: string
}

export type PokegearMapContext = {
  mapData: HgssPokegearMapData
  maps: readonly OpeningMapPreview[]
  currentMap: OpeningMapPreview
  flags: ReadonlySet<number>
  badges: ReadonlySet<number>
  party: PokemonParty
  background: NitroGraphic
  backgroundAtlas?: NitroGraphic
  highlightAtlas?: NitroGraphic
  mapUnlockLevel: number
  mapMessages: Record<number, string>
  cursor?: PokegearMapCursor
  /** Cellule de la matrice monde occupée par le joueur, avec l'offset UI +2. */
  playerMapPosition?: PokegearMapCursor
  roamers: readonly (HgssRoamer | undefined)[]
  encounterLandmarks?: readonly MapEncounterLandmark[]
  phoneBookEntries: readonly HgssPhoneBookEntry[]
  phoneRematchSeeking: ReadonlySet<number>
  phoneGiftItems: ReadonlyMap<number, number>
  mapMarkings: readonly PokegearMapMarkings[]
  visitedMapIds?: readonly number[]
  now?: Date
  locationPreviewResolver?: (mapId: number, visualTime: 0 | 1 | 2 | 3) => NitroGraphic | undefined
  areaBannerResolver?: (areaIcon: number) => NitroGraphic | undefined
}

function clampCursor(cursor: PokegearMapCursor, unlockLevel: number): PokegearMapCursor {
  const maximumX = mapXMaximumByUnlockLevel[Math.max(0, Math.min(2, unlockLevel))]!
  return {
    x: Math.max(2, Math.min(maximumX, Math.round(cursor.x))),
    y: Math.max(2, Math.min(17, Math.round(cursor.y))),
  }
}

export function getInitialPokegearMapCursor(currentMap: OpeningMapPreview, unlockLevel: number): PokegearMapCursor {
  return clampCursor({ x: currentMap.header.worldMapX, y: currentMap.header.worldMapY + 2 }, unlockLevel)
}

export function movePokegearMapSelection(
  model: Pick<PokegearMapModel, 'cursor' | 'location' | 'locations'> & Partial<Pick<PokegearMapModel, 'flypoints'>>,
  direction: 'left' | 'right' | 'up' | 'down',
): PokegearMapCursor {
  const locations = model.locations.filter((location, index, all) => all.findIndex(({ mapId }) => mapId === location.mapId) === index)
  const origin = model.cursor
  const originRegion = model.location?.region ?? resolvePokegearRegion(origin.x, origin.y - 2)
  const candidates = locations.map((location) => {
    const cursor = getPokegearLocationSelectionCursor(model, location)
    const dx = cursor.x - origin.x
    const dy = cursor.y - origin.y
    const primary = direction === 'left' ? -dx : direction === 'right' ? dx : direction === 'up' ? -dy : dy
    const perpendicular = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx)
    return {
      location,
      cursor,
      primary,
      regionChange: location.region === originRegion ? 0 : 1,
      score: primary + perpendicular * 1.75,
    }
  }).filter(({ location, primary }) => location.mapId !== model.location?.mapId && primary > .01)
    // Une direction parcourt d'abord la région courante. Elle ne franchit la
    // jonction Johto/Indigo/Kanto que lorsqu'aucun autre lieu n'existe devant
    // le curseur dans cette région, comme la navigation spatiale de la ROM.
    .sort((left, right) => left.regionChange - right.regionChange
      || left.score - right.score
      || left.primary - right.primary
      || left.location.progressionIndex - right.location.progressionIndex)
  const selected = candidates[0]
  return selected?.cursor ?? model.cursor
}

/** Sélectionne le point de Vol natif lorsqu'il est découvert, sinon le lieu. */
export function getPokegearLocationSelectionCursor(
  model: Pick<PokegearMapModel, 'flypoints'> | { flypoints?: readonly PokegearFlypoint[] },
  location: Pick<PokegearMapLocation, 'x' | 'y' | 'width' | 'height'>,
): PokegearMapCursor {
  const flypoint = model.flypoints?.find((candidate) => candidate.unlocked
    && location.x <= candidate.x && candidate.x < location.x + location.width
    && location.y <= candidate.y + 2 && candidate.y + 2 < location.y + location.height)
  return flypoint ? { x: flypoint.x, y: flypoint.y + 2 } : { x: location.x, y: location.y }
}

/**
 * Convertit un point choisi directement sur la carte 47 x 20 en une
 * destination ROM. Un clic entre deux zones rejoint la plus proche afin que
 * le tactile ne puisse jamais laisser le curseur sur une cellule vide.
 */
export function getPokegearPointerSelectionCursor(
  model: Pick<PokegearMapModel, 'cursor' | 'locations' | 'flypoints'>,
  point: PokegearMapCursor,
): PokegearMapCursor {
  const locations = model.locations.filter((location, index, all) => all.findIndex((candidate) => (
    candidate.mapId === location.mapId && candidate.x === location.x && candidate.y === location.y
  )) === index)
  const pointedRegion = resolvePokegearRegion(Math.floor(point.x), Math.floor(point.y) - 2)
  const regionalLocations = locations.filter(({ region }) => region === pointedRegion)
  const candidates = regionalLocations.length > 0 ? regionalLocations : locations
  const distanceTo = (location: PokegearMapLocation): number => {
    const right = location.x + location.width
    const bottom = location.y + location.height
    const dx = point.x < location.x ? location.x - point.x : point.x >= right ? point.x - right : 0
    const dy = point.y < location.y ? location.y - point.y : point.y >= bottom ? point.y - bottom : 0
    return dx * dx + dy * dy
  }
  const selected = candidates.reduce<PokegearMapLocation | undefined>((nearest, location) => (
    !nearest
      || distanceTo(location) < distanceTo(nearest)
      || (distanceTo(location) === distanceTo(nearest) && location.width * location.height < nearest.width * nearest.height)
      ? location
      : nearest
  ), undefined)
  return selected ? getPokegearLocationSelectionCursor(model, selected) : model.cursor
}

function isLocationVisible(location: HgssPokegearMapLocation, currentMapId: number, mapUnlockLevel: number): boolean {
  // La Zone Safari est toujours visible dans HGSS; seules les deux zones de
  // voyage temporaires sont masquées hors de leur carte native.
  if (location.mapId === 521 && !sinjohMapIds.has(currentMapId)) return false
  if (location.mapId === 307 && !ssAquaMapIds.has(currentMapId)) return false
  return isPokegearDestinationVisible(location.x, location.y - 2, mapUnlockLevel, location.mapId)
}

function locationAtCursor(context: PokegearMapContext, cursor: PokegearMapCursor): HgssPokegearMapLocation | undefined {
  return context.mapData.locations.filter((location) => isLocationVisible(location, context.currentMap.id, context.mapUnlockLevel)
    && cursor.x >= location.x && cursor.x < location.x + location.width
    && cursor.y >= location.y && cursor.y < location.y + location.height)
    // Les routes et les villes se chevauchent dans sLocationSpecs. La zone la
    // plus précise doit gagner, indépendamment de l'ordre physique de la table.
    .sort((left, right) => left.width * left.height - right.width * right.height)[0]
}

function resolveMapLocations(context: PokegearMapContext, labels: ReadonlyMap<number, string>): PokegearMapLocation[] {
  const maps = new Map(context.maps.map((map) => [map.id, map]))
  const visitedMapIds = [...(context.visitedMapIds ?? []), context.currentMap.id]
  const visitedPositions = visitedMapIds.flatMap((mapId, visitIndex) => {
    const map = maps.get(mapId)
    return map ? [{ x: map.header.worldMapX, y: map.header.worldMapY + 2, visitIndex }] : []
  })
  const unlockedFlypoints = context.mapData.flypoints.filter(({ flagIndex }) => context.flags.has(hgssPokegearFlypointFlagBase + flagIndex))
  return context.mapData.locations.flatMap((location, sourceIndex): PokegearMapLocation[] => {
    // Certaines sLocationSpecs emploient un MapHeader nominal sans matrice
    // résolue (p. ex. Ruines d'Alpha, id 8). Son libellé est alors celui d'un
    // MapHeader ROM réel qui occupe le même bloc sur la carte.
    const label = labels.get(location.mapId) ?? context.maps.find((map) => (
      map.header.worldMapX >= location.x
      && map.header.worldMapX < location.x + location.width
      && map.header.worldMapY + 2 >= location.y
      && map.header.worldMapY + 2 < location.y + location.height
    ))?.label
    if (!label || !isLocationVisible(location, context.currentMap.id, context.mapUnlockLevel)) return []
    const firstVisit = visitedPositions.find(({ x, y }) => x >= location.x && x < location.x + location.width && y >= location.y && y < location.y + location.height)
    const unlockedFlypoint = unlockedFlypoints.find((flypoint) => flypoint.nameMapId === location.mapId
        || (flypoint.x >= location.x && flypoint.x < location.x + location.width
          && flypoint.y + 2 >= location.y && flypoint.y + 2 < location.y + location.height))
    const visited = Boolean(firstVisit || unlockedFlypoint)
    return [{
      ...location,
      label,
      region: resolvePokegearRegion(location.x, location.y - 2),
      flavor: context.mapMessages[location.flavorMessageId] ?? '',
      visited,
      progressionIndex: firstVisit?.visitIndex
        ?? (visitedMapIds.length + (unlockedFlypoint?.flagIndex ?? context.mapData.flypoints.length) + sourceIndex / 1000),
    }]
  }).sort((left, right) => regionProgression[left.region] - regionProgression[right.region]
    || left.progressionIndex - right.progressionIndex)
}

function copyGraphicBlock(
  source: NitroGraphic,
  target: Uint8ClampedArray,
  sourceX: number,
  sourceY: number,
  destinationX: number,
  destinationY: number,
  width: number,
  height: number,
  skipTransparent = false,
): void {
  const targetWidth = 47 * 8
  const targetHeight = 20 * 8
  for (let y = 0; y < height; y += 1) {
    const fromY = sourceY + y
    const toY = destinationY + y
    if (fromY < 0 || fromY >= source.height || toY < 0 || toY >= targetHeight) continue
    for (let x = 0; x < width; x += 1) {
      const fromX = sourceX + x
      const toX = destinationX + x
      if (fromX < 0 || fromX >= source.width || toX < 0 || toX >= targetWidth) continue
      const from = (fromY * source.width + fromX) * 4
      const to = (toY * targetWidth + toX) * 4
      if (skipTransparent && source.pixels[from + 3] === 0) continue
      target[to] = source.pixels[from]!
      target[to + 1] = source.pixels[from + 1]!
      target[to + 2] = source.pixels[from + 2]!
      target[to + 3] = source.pixels[from + 3]!
    }
  }
}

/** Rejoue les copies de blocs de ov101 sur le canevas 47 x 20 affiché. */
export function composePokegearMapBackground(
  fallback: NitroGraphic,
  atlas: NitroGraphic | undefined,
  flypoints: readonly PokegearFlypoint[],
  mapUnlockLevel = 2,
  currentMapId?: number,
): NitroGraphic {
  if (!atlas || atlas.width < 47 * 8 || atlas.height < 48 * 8) return fallback
  const width = 47 * 8
  const height = 20 * 8
  const pixels = new Uint8ClampedArray(width * height * 4)
  if (fallback.width === width && fallback.height === height) pixels.set(fallback.pixels)
  else copyGraphicBlock(atlas, pixels, 0, 0, 0, 0, width, height)
  if (mapUnlockLevel === 0) copyGraphicBlock(atlas, pixels, 48 * 8, 0, 22 * 8, 0, 6 * 8, height)
  else if (mapUnlockLevel === 1) copyGraphicBlock(atlas, pixels, 54 * 8, 0, 29 * 8, 0, 3 * 8, height)
  // ov101 masque les destinations non découvertes. Copier les destinations
  // déjà visitées produisait jusque-là la carte inverse du jeu natif.
  for (const flypoint of flypoints) {
    if (flypoint.unlocked
      || flypoint.nameMapId === cianwoodNameMapId
      || flypoint.markerPalette === 0xff
      || (mapUnlockLevel < 2 && flypoint.region === 'kanto')
      || flypoint.tilemapWidth <= 0
      || flypoint.tilemapHeight <= 0) continue
    copyGraphicBlock(
      atlas,
      pixels,
      flypoint.tilemapSourceX * 8,
      flypoint.tilemapSourceY * 8,
      (flypoint.x - flypoint.tilemapDestinationX) * 8,
      (flypoint.y + 2 - flypoint.tilemapDestinationY) * 8,
      flypoint.tilemapWidth * 8,
      flypoint.tilemapHeight * 8,
    )
  }
  // Le booléen natif au nom trompeur vérifie exactement l'index 15 (0x9BF),
  // associé à Irisia dans la table ROM, pour révéler l'ouest de Johto.
  const hasWestJohtoRevealFlag = flypoints.some(({ flagIndex, unlocked }) => flagIndex === 15 && unlocked)
  if (!hasWestJohtoRevealFlag) copyGraphicBlock(atlas, pixels, 48 * 8, 27 * 8, 1 * 8, 9 * 8, 5 * 8, 6 * 8)
  if (currentMapId !== undefined && sinjohMapIds.has(currentMapId)) {
    copyGraphicBlock(atlas, pixels, 55 * 8, 20 * 8, 19 * 8, 1 * 8, 3 * 8, 4 * 8)
  }
  if (currentMapId !== undefined && ssAquaMapIds.has(currentMapId)) {
    copyGraphicBlock(atlas, pixels, 55 * 8, 24 * 8, 24 * 8, 15 * 8, 3 * 8, 3 * 8)
  }
  return { ...atlas, width, height, pixels }
}

/** Couche MAIN_2 transparente des landmarks sélectionnés, séparée du fond. */
export function composePokegearMapHighlight(
  atlas: NitroGraphic | undefined,
  locations: readonly HgssPokegearMapLocation[],
): NitroGraphic | undefined {
  if (!atlas || atlas.width < 47 * 8 || atlas.height < 48 * 8 || locations.length === 0) return undefined
  const width = 47 * 8
  const height = 20 * 8
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (const location of locations) {
    if (location.tilemapWidth <= 0 || location.tilemapHeight <= 0) continue
    const destinationX = location.x - Math.floor(Math.max(0, location.tilemapWidth - location.width) / 2)
    const destinationY = location.y - Math.floor(Math.max(0, location.tilemapHeight - location.height) / 2)
    copyGraphicBlock(
      atlas,
      pixels,
      location.tilemapSourceX * 8,
      location.tilemapSourceY * 8,
      destinationX * 8,
      destinationY * 8,
      location.tilemapWidth * 8,
      location.tilemapHeight * 8,
      true,
    )
  }
  return { ...atlas, width, height, pixels }
}

function getCachedMapComposition(
  cache: WeakMap<NitroGraphic, Map<string, NitroGraphic>>,
  atlas: NitroGraphic | undefined,
  key: string,
  compose: () => NitroGraphic | undefined,
): NitroGraphic | undefined {
  if (!atlas) return compose()
  let entries = cache.get(atlas)
  if (!entries) {
    entries = new Map()
    cache.set(atlas, entries)
  }
  const cached = entries.get(key)
  if (cached) return cached
  const graphic = compose()
  if (graphic) entries.set(key, graphic)
  return graphic
}

function getLocationMarkerPosition(location: HgssPokegearMapLocation): PokegearMapCursor {
  // ov101_021EA238 place les objets depuis le centre de la tuile, puis ajoute
  // les deux offsets en pixels encodés dans sLocationSpecs.
  return {
    x: location.x + 0.5 + location.objectOffsetX / 8,
    y: location.y + 0.5 + location.objectOffsetY / 8,
  }
}

export function createPokegearMapModel(context: PokegearMapContext): PokegearMapModel {
  const cursor = clampCursor(context.cursor ?? getInitialPokegearMapCursor(context.currentMap, context.mapUnlockLevel), context.mapUnlockLevel)
  const labels = new Map(context.maps.map((map) => [map.id, map.label]))
  const locations = resolveMapLocations(context, labels)
  const rawCurrentCursor = context.playerMapPosition
    ?? { x: context.currentMap.header.worldMapX, y: context.currentMap.header.worldMapY + 2 }
  const containsCurrentCursor = (candidate: PokegearMapLocation): boolean => rawCurrentCursor.x >= candidate.x
    && rawCurrentCursor.x < candidate.x + candidate.width
    && rawCurrentCursor.y >= candidate.y
    && rawCurrentCursor.y < candidate.y + candidate.height
  const currentLocation = locations.find((candidate) => candidate.mapId === context.currentMap.id && containsCurrentCursor(candidate))
    ?? locations.find((candidate) => candidate.label === context.currentMap.label && containsCurrentCursor(candidate))
    ?? locations.find(containsCurrentCursor)
    ?? locations.find((candidate) => candidate.mapId === context.currentMap.id)
    ?? locations.find((candidate) => candidate.label === context.currentMap.label)
  // Le marqueur joueur appartient au MapHeader. Les offsets de sLocationSpecs
  // sont réservés aux icônes de lieux, aux fuyards et aux alertes téléphone.
  const currentCursor = clampCursor(rawCurrentCursor, context.mapUnlockLevel)
  const currentPosition = currentCursor
  const rawLocation = locationAtCursor(context, cursor)
  const location = rawLocation ? locations.find((candidate) => candidate === rawLocation
    || (candidate.mapId === rawLocation.mapId && candidate.x === rawLocation.x && candidate.y === rawLocation.y)) : undefined
  const currentRegion = resolvePokegearRegion(rawCurrentCursor.x, rawCurrentCursor.y - 2)
  const flypoints = context.mapData.flypoints.flatMap((flypoint): PokegearFlypoint[] => {
    const label = labels.get(flypoint.nameMapId) ?? labels.get(flypoint.warpMapId)
    if (!label) return []
    return [{
      nameMapId: flypoint.nameMapId,
      warpMapId: flypoint.warpMapId,
      flagIndex: flypoint.flagIndex,
      markerPalette: flypoint.markerPalette,
      x: flypoint.x,
      y: flypoint.y,
      width: flypoint.width,
      height: flypoint.height,
      tilemapSourceX: flypoint.tilemapSourceX,
      tilemapSourceY: flypoint.tilemapSourceY,
      tilemapWidth: flypoint.tilemapWidth,
      tilemapHeight: flypoint.tilemapHeight,
      tilemapDestinationX: flypoint.tilemapDestinationX,
      tilemapDestinationY: flypoint.tilemapDestinationY,
      label,
      unlocked: context.flags.has(hgssPokegearFlypointFlagBase + flypoint.flagIndex),
      region: resolvePokegearRegion(flypoint.x, flypoint.y),
    }]
  })
  const flypoint = flypoints.find((candidate) => candidate.unlocked
    && cursor.x >= candidate.x && cursor.x < candidate.x + candidate.width
    && cursor.y - 2 >= candidate.y && cursor.y - 2 < candidate.y + candidate.height)
  const availability = getFieldMoveAvailability('fly', context.badges, context.party.members)
  const canFly = Boolean(flypoint && context.currentMap.header.flyAllowed && availability.available
    && !context.flags.has(HGSS_SAFARI_SYSTEM_FLAG) && !context.flags.has(HGSS_PAL_PARK_SYSTEM_FLAG)
    && canFlyBetweenPokegearRegions(currentRegion, flypoint.region, flypoint.nameMapId))
  const region = resolvePokegearRegion(cursor.x, cursor.y - 2)
  const regionLabels: Readonly<Record<PokegearRegion, string>> = {
    johto: context.mapMessages[1] ?? '',
    indigo: labels.get(58) ?? context.mapMessages[0] ?? '',
    kanto: context.mapMessages[0] ?? '',
  }
  const roamers = context.roamers.flatMap((roamer, roamerId): PokegearMapRoamer[] => {
    if (!roamer?.active) return []
    const roamerLocation = context.mapData.locations.find(({ mapId }) => mapId === roamer.metLocation)
    if (!roamerLocation) return []
    const position = getLocationMarkerPosition(roamerLocation)
    return [{ roamerId, speciesId: roamer.speciesId, mapId: roamer.metLocation, ...position }]
  })
  const encounters = (context.encounterLandmarks ?? []).flatMap((encounter): PokegearMapEncounter[] => {
    // La carte ne doit pas transformer toute commande de combat statique en
    // « légendaire ». L'index ne donne ce marqueur qu'à partir des propriétés
    // personnelles de l'espèce réellement décodées dans la ROM.
    if (encounter.command !== 'wildBattle' || !encounter.isRomLegendary) return []
    const encounterMap = context.maps.find(({ id }) => id === encounter.mapId)
    if (!encounterMap) return []
    const mapX = encounterMap.header.worldMapX
    const mapY = encounterMap.header.worldMapY + 2
    const rawLocation = context.mapData.locations.find((candidate) => candidate.mapId === encounter.mapId)
      ?? context.mapData.locations.find((candidate) => mapX >= candidate.x && mapX < candidate.x + candidate.width
        && mapY >= candidate.y && mapY < candidate.y + candidate.height)
    if (!rawLocation) return []
    const resolvedLocation = locations.find((candidate) => candidate.mapId === rawLocation.mapId
      && candidate.x === rawLocation.x && candidate.y === rawLocation.y)
    if (!resolvedLocation?.visited) return []
    const hidden = encounter.disappearanceFlagId !== undefined && context.flags.has(encounter.disappearanceFlagId)
    const conditionsMet = encounter.conditions.every(({ flagId, state }) => context.flags.has(flagId) === (state === 'set'))
    // Un eventFlag d'ObjectEvent signifie seulement « objet caché » dans la
    // ROM; il peut être posé avant le déblocage comme après le combat. Il ne
    // constitue donc pas une preuve de capture/achèvement.
    if (!conditionsMet || hidden) return []
    return [{
      mapId: encounter.mapId,
      locationMapId: rawLocation.mapId,
      speciesId: encounter.speciesId,
      ...getLocationMarkerPosition(rawLocation),
      completed: false,
    }]
  }).filter((encounter, index, all) => all.findIndex((candidate) => (
    candidate.locationMapId === encounter.locationMapId && candidate.speciesId === encounter.speciesId
  )) === index)
  const phoneEntries = new Map(context.phoneBookEntries.map((entry) => [entry.id, entry]))
  const phoneMapIds = new Set<number>()
  for (const contactId of context.phoneRematchSeeking) {
    const mapId = phoneEntries.get(contactId)?.mapId
    if (mapId !== undefined) phoneMapIds.add(mapId)
  }
  for (const contactId of context.phoneGiftItems.keys()) {
    const mapId = phoneEntries.get(contactId)?.mapId
    if (mapId !== undefined) phoneMapIds.add(mapId)
  }
  const phoneAttention = [...phoneMapIds].flatMap((mapId): PokegearMapAttention[] => {
    const attentionLocation = context.mapData.locations.find((candidate) => candidate.mapId === mapId)
    if (!attentionLocation) return []
    return [{ mapId, label: labels.get(mapId) ?? '', ...getLocationMarkerPosition(attentionLocation) }]
  })
  const markings = context.mapMarkings.flatMap((marking): PokegearMapDisplayedMarkings[] => {
    const markingLocation = context.mapData.locations.find(({ mapId }) => mapId === marking.mapId)
    return markingLocation ? [{ ...marking, ...getLocationMarkerPosition(markingLocation) }] : []
  })
  const selectedMapCandidates = location ? context.maps.filter((map) => (
    map.id === location.mapId
    || (map.header.worldMapX >= location.x
      && map.header.worldMapX < location.x + location.width
      && map.header.worldMapY + 2 >= location.y
      && map.header.worldMapY + 2 < location.y + location.height)
  )) : []
  const selectedMap = selectedMapCandidates.find(({ id }) => id === location?.mapId) ?? selectedMapCandidates[0]
  const resolvedVisualTime = context.now
    ? resolveHgssFieldVisualTime(resolveHgssTimeOfDay(context.now))
    : 1
  const locationPreview = location
    ? context.locationPreviewResolver?.(location.mapId, resolvedVisualTime)
    : undefined
  const areaBanner = selectedMap?.header.areaIcon ? context.areaBannerResolver?.(selectedMap.header.areaIcon) : undefined
  const highlightedLocations = location ? context.mapData.locations.filter(({ mapId }) => mapId === location.mapId) : []
  const specialMapLayer = sinjohMapIds.has(context.currentMap.id)
    ? 'sinjoh'
    : ssAquaMapIds.has(context.currentMap.id) ? 'ss-aqua' : 'standard'
  const backgroundKey = `${context.mapUnlockLevel}:${specialMapLayer}:${flypoints.filter(({ unlocked }) => unlocked).map(({ flagIndex }) => flagIndex).join(',')}`
  const highlightKey = highlightedLocations.map(({ mapId, x, y, tilemapBlockId }) => `${mapId}:${x}:${y}:${tilemapBlockId}`).join('|')
  const composedBackground = getCachedMapComposition(
    backgroundCompositionCache,
    context.backgroundAtlas,
    backgroundKey,
    () => composePokegearMapBackground(context.background, context.backgroundAtlas, flypoints, context.mapUnlockLevel, context.currentMap.id),
  ) ?? context.background
  const composedHighlight = getCachedMapComposition(
    highlightCompositionCache,
    context.highlightAtlas,
    highlightKey,
    () => composePokegearMapHighlight(context.highlightAtlas, highlightedLocations),
  )
  return {
    background: composedBackground,
    backgroundKey,
    highlight: composedHighlight,
    highlightKey,
    locationPreview,
    areaBanner,
    presentationKey: `${location?.mapId ?? -1}:${resolvedVisualTime}:${selectedMap?.header.areaIcon ?? 0}`,
    cursor,
    currentCursor,
    currentPosition,
    currentLocation,
    currentLocationLabel: currentLocation?.label ?? context.currentMap.label,
    regionLabel: regionLabels[region],
    location,
    locations,
    flypoint,
    flypoints,
    roamers,
    encounters,
    phoneAttention,
    markings,
    selectedMarkings: location ? markings.find(({ mapId }) => mapId === location.mapId) : undefined,
    canFly,
    prompt: context.mapMessages[4] ?? '',
    flyLabel: context.mapMessages[7] ?? '',
    closeLabel: context.mapMessages[6] ?? '',
  }
}
