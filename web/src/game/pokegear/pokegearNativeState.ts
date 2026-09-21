import type { HgssPhoneBookEntry } from '../../rom/phone/phoneBook'
import type { OpeningMapPreview } from '../../ndsTypes'
import type { HgssPokegearFlypoint } from '../../rom/pokegear/mapData'

/** Base de FLAG_VISITED_* utilisée par gMapFlypointParams dans HGSS. */
export const hgssPokegearFlypointFlagBase = 0x9b0

/** Valeurs exactes de l'enum PokegearAppId de HGSS. */
export type PokegearNativeApp = 0 | 1 | 2 | 3
export type PokegearPhoneSort = 'manual' | 'trainer' | 'alphabet' | 'location'
export type PokegearMapMarkings = {
  mapId: number
  icons: [number | null, number | null, number | null, number | null]
  words: [number | null, number | null, number | null, number | null]
}

export type PokegearNativeState = {
  lastUsedApp: PokegearNativeApp
  skin: number
  mapZoomed: boolean
  radioCursorX: number
  radioCursorY: number
  /** MapMarkingsSaveArray[100] : quatre icônes et quatre mots Easy Chat par lieu. */
  mapMarkings: PokegearMapMarkings[]
  /** Historique de découverte du port web; les identifiants restent ceux des cartes ROM. */
  visitedMapIds: number[]
}

export function createPokegearNativeState(): PokegearNativeState {
  return { lastUsedApp: 3, skin: 0, mapZoomed: false, radioCursorX: 128, radioCursorY: 128, mapMarkings: [], visitedMapIds: [] }
}

function normalizeVisitedMapIds(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  const result: number[] = []
  const seen = new Set<number>()
  for (const mapId of value) {
    if (!Number.isInteger(mapId) || mapId < 0 || mapId > 0xffff || seen.has(mapId)) continue
    seen.add(mapId)
    result.push(mapId)
    if (result.length === 0x21a) break
  }
  return result
}

function normalizeMapMarkings(value: unknown): PokegearMapMarkings[] {
  if (!Array.isArray(value)) return []
  const result: PokegearMapMarkings[] = []
  const mapIds = new Set<number>()
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue
    const source = candidate as Partial<PokegearMapMarkings>
    if (!Number.isInteger(source.mapId) || source.mapId! < 0 || source.mapId! > 0xffff || mapIds.has(source.mapId!)) continue
    const icons = Array.from({ length: 4 }, (_, index) => {
      const icon = Array.isArray(source.icons) ? source.icons[index] : null
      return Number.isInteger(icon) && icon! >= 0 && icon! <= 7 ? icon as number : null
    }) as PokegearMapMarkings['icons']
    const words = Array.from({ length: 4 }, (_, index) => {
      const word = Array.isArray(source.words) ? source.words[index] : null
      return Number.isInteger(word) && word! >= 0 && word! < 0xffff ? word as number : null
    }) as PokegearMapMarkings['words']
    if (!icons.some((icon) => icon !== null) && !words.some((word) => word !== null)) continue
    result.push({ mapId: source.mapId!, icons, words })
    mapIds.add(source.mapId!)
    if (result.length === 100) break
  }
  return result
}

export function normalizePokegearNativeState(value?: Partial<PokegearNativeState>): PokegearNativeState {
  const defaults = createPokegearNativeState()
  const lastUsedApp = Number.isInteger(value?.lastUsedApp) && value!.lastUsedApp! >= 0 && value!.lastUsedApp! <= 3 ? value!.lastUsedApp! as PokegearNativeApp : defaults.lastUsedApp
  const skin = Number.isInteger(value?.skin) && value!.skin! >= 0 && value!.skin! < 8 ? value!.skin! : defaults.skin
  const radioCursorX = Number.isInteger(value?.radioCursorX) ? value!.radioCursorX! : defaults.radioCursorX
  const radioCursorY = Number.isInteger(value?.radioCursorY) ? value!.radioCursorY! : defaults.radioCursorY
  const distance = Math.hypot(radioCursorX - 128, radioCursorY - 92)
  const scale = distance > 52 ? 52 / distance : 1
  return {
    lastUsedApp,
    skin,
    mapZoomed: value?.mapZoomed === true,
    radioCursorX: Math.round(128 + (radioCursorX - 128) * scale),
    radioCursorY: Math.round(92 + (radioCursorY - 92) * scale),
    mapMarkings: normalizeMapMarkings(value?.mapMarkings),
    visitedMapIds: normalizeVisitedMapIds(value?.visitedMapIds),
  }
}

export function clonePokegearNativeState(state: PokegearNativeState): PokegearNativeState {
  return {
    ...state,
    mapMarkings: state.mapMarkings.map(({ mapId, icons, words }) => ({ mapId, icons: [...icons], words: [...words] })),
    visitedMapIds: [...state.visitedMapIds],
  }
}

/**
 * Résout les points de Vol découverts en entrant dans une carte.
 *
 * Les intérieurs d'une ville n'emploient pas nécessairement le même
 * MapHeader que son entrée dans gMapFlypointParams. Le moteur natif les
 * rattache à leur nom de zone et à leurs coordonnées de carte du monde : on
 * reproduit cette règle à partir des seules tables de la ROM, sans liste de
 * villes maintenue à la main.
 */
export function getVisitedPokegearFlypointFlags(
  map: OpeningMapPreview,
  maps: readonly OpeningMapPreview[],
  flypoints: readonly HgssPokegearFlypoint[],
): number[] {
  const labels = new Map(maps.map((candidate) => [candidate.id, candidate.label]))
  const x = map.header.worldMapX
  const y = map.header.worldMapY
  return flypoints.flatMap((flypoint): number[] => {
    const directMap = map.id === flypoint.nameMapId || map.id === flypoint.warpMapId
    const flypointLabel = labels.get(flypoint.nameMapId) ?? labels.get(flypoint.warpMapId)
    const matchingArea = flypointLabel === map.label
      && x >= flypoint.x && x < flypoint.x + flypoint.width
      && y >= flypoint.y && y < flypoint.y + flypoint.height
    return directMap || matchingArea ? [hgssPokegearFlypointFlagBase + flypoint.flagIndex] : []
  })
}

export function setPokegearMapMarking(
  markings: readonly PokegearMapMarkings[],
  mapId: number,
  kind: 'icon' | 'word',
  slot: number,
  value: number | null,
): PokegearMapMarkings[] {
  if (!Number.isInteger(mapId) || mapId < 0 || mapId > 0xffff) return [...markings]
  if (!Number.isInteger(slot) || slot < 0 || slot >= 4) return [...markings]
  if (value !== null && (!Number.isInteger(value) || value < 0 || value >= (kind === 'icon' ? 8 : 0xffff))) return [...markings]
  const result = markings.map(({ mapId: id, icons, words }) => ({ mapId: id, icons: [...icons] as PokegearMapMarkings['icons'], words: [...words] as PokegearMapMarkings['words'] }))
  let entry = result.find((candidate) => candidate.mapId === mapId)
  if (!entry && value !== null && result.length < 100) {
    entry = { mapId, icons: [null, null, null, null], words: [null, null, null, null] }
    result.push(entry)
  }
  if (!entry) return result
  entry[kind === 'icon' ? 'icons' : 'words'][slot] = value
  return entry.icons.some((icon) => icon !== null) || entry.words.some((word) => word !== null)
    ? result
    : result.filter((candidate) => candidate !== entry)
}

/** L'UI utilise 0 Téléphone, 1 Carte, 2 Radio, 3 Habillage. */
export function pokegearCardToNativeApp(card: number): PokegearNativeApp {
  return Math.max(0, Math.min(3, 3 - card)) as PokegearNativeApp
}

export function pokegearNativeAppToCard(app: PokegearNativeApp): number {
  return 3 - app
}

export function sortPokegearPhoneContacts(
  contactIds: Iterable<number>,
  entries: readonly HgssPhoneBookEntry[],
  sort: PokegearPhoneSort,
): number[] {
  const ids = [...contactIds]
  if (sort === 'manual') return ids
  const parameter = sort === 'trainer' ? 0 : sort === 'alphabet' ? 1 : 2
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  return ids.map((id, index) => ({ id, index, value: byId.get(id)?.sortParameters[parameter] ?? 0xffff }))
    .sort((a, b) => a.value - b.value || a.index - b.index).map(({ id }) => id)
}

export type PokegearRegion = 'johto' | 'indigo' | 'kanto'

/** Traduction exacte de Pokegear_RegionFromCoords. */
export function resolvePokegearRegion(x: number, y: number): PokegearRegion {
  if (x <= 21 || (x === 25 && y === 8)) return 'johto'
  if (x === 28 && (y === 6 || (y > 8 && y < 13))) return 'indigo'
  return 'kanto'
}

export function isPokegearDestinationVisible(x: number, y: number, unlockLevel: number, mapId?: number): boolean {
  const region = resolvePokegearRegion(x, y)
  return unlockLevel >= 2 || region === 'johto' || (unlockLevel >= 1 && (region === 'indigo' || mapId === 58 || mapId === 124))
}

/** Indigo est le pivot natif; Route 26 et Plateau Indigo restent toujours franchissables. */
export function canFlyBetweenPokegearRegions(current: PokegearRegion, destination: PokegearRegion, mapId: number): boolean {
  return current === 'indigo' || current === destination || mapId === 58 || mapId === 124
}
