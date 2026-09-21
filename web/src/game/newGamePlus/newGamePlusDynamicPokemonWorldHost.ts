import type { OpeningMapPreview } from '../../ndsTypes'
import type { HgssWildEncounterData } from '../../rom/encounters/wildEncounterData'
import type { EncounterRadioEffect, PreparedFieldWildEncounter } from '../encounters/wildEncounterSelection'
import { hgssVisibleWildCoverageRollCount, prepareHgssVisibleWildMapCandidates, resolveHgssVisibleWildEncounterCandidate } from '../encounters/hgssVisibleWildEncounterCandidates'
import {
  hgssVisibleSafariCoverageCandidateCount,
  prepareHgssVisibleSafariMapCandidates,
  resolveHgssVisibleSafariEncounterCandidate,
  type HgssVisibleSafariEncounterPreparer,
} from '../encounters/hgssVisibleSafariEncounterCandidates'
import { resolveHgssVisibleWildSpawnTiles } from '../encounters/hgssVisibleWildSpawnTiles'
import type { HgssMassOutbreakContext } from '../encounters/hgssMassOutbreak'
import {
  HGSS_SAFARI_AREA_COLUMNS,
  HGSS_SAFARI_AREA_GRID_CELL_X,
  HGSS_SAFARI_AREA_GRID_CELL_Z,
  HGSS_SAFARI_AREA_ROWS,
} from '../safari/hgssSafariMap'
import type { DynamicWorldActor } from '../world/dynamicWorldActorRegistry'
import { getMapOrigin } from '../world/mapCoordinates'
import { allPokemonAccessibleModuleId } from './modules/allPokemonAccessibleModule'
import type { AllPokemonQuestWorldInteraction } from './modules/allPokemonQuestWorldCoordinator'
import { tryStartVisibleWildPokemonInteraction } from './modules/visibleWildPokemonHostAdapter'
import { visibleWildPokemonModuleId } from './modules/visibleWildPokemonModule'
import type { VisibleWildPokemonRuntime } from './modules/visibleWildPokemonRule'
import type { AllPokemonAccessibleGameplayRuntime, NewGamePlusGameplayRuntime } from './newGamePlusGameplayRuntime'

export type NewGamePlusDynamicPokemonWorldContext = Readonly<{
  map: OpeningMapPreview
  encounterCatalog: readonly HgssWildEncounterData[]
  hour: number
  radioEffect: EncounterRadioEffect
  massOutbreak: HgssMassOutbreakContext
  isSafari: boolean
  /** Fourni uniquement pendant une session Safari HGSS active. */
  prepareSafariEncounter?: HgssVisibleSafariEncounterPreparer
  isTileBlocked: (mapId: number, tileX: number, tileZ: number, excludedActorId?: string) => boolean
}>

export type NewGamePlusDynamicPokemonWorldHost = Readonly<{
  syncCurrentMap: () => readonly DynamicWorldActor[]
  advanceMovement: () => readonly DynamicWorldActor[]
  tryInteract: (actorId: string) => boolean
  replacesStepEncounters: () => boolean
  clear: () => void
}>

export type NewGamePlusDynamicPokemonWorldHostOptions = Readonly<{
  readRuntime: () => NewGamePlusGameplayRuntime | undefined
  readContext: () => NewGamePlusDynamicPokemonWorldContext | undefined
  renderActors: (actors: readonly DynamicWorldActor[]) => void
  startPreparedWildEncounter: (prepared: PreparedFieldWildEncounter) => boolean
  startQuestWildEncounter: (interaction: AllPokemonQuestWorldInteraction) => boolean
}>

function visibleRuntime(runtime: NewGamePlusGameplayRuntime | undefined): VisibleWildPokemonRuntime | undefined {
  return runtime?.getModuleRuntime(visibleWildPokemonModuleId) as VisibleWildPokemonRuntime | undefined
}

function allPokemonRuntime(runtime: NewGamePlusGameplayRuntime | undefined): AllPokemonAccessibleGameplayRuntime | undefined {
  return runtime?.getModuleRuntime(allPokemonAccessibleModuleId) as AllPokemonAccessibleGameplayRuntime | undefined
}

type SurfaceMethod = 'land' | 'surfing'
type SurfaceTile = Readonly<{ tileX: number, tileZ: number }>
type SurfaceTileSets = Readonly<Record<SurfaceMethod, ReadonlySet<string>>>

const tileKey = ({ tileX, tileZ }: SurfaceTile): string => `${tileX}:${tileZ}`

function toSurfaceTileSets(
  land: readonly SurfaceTile[],
  surfing: readonly SurfaceTile[],
): SurfaceTileSets {
  return Object.freeze({
    land: new Set(land.map(tileKey)),
    surfing: new Set(surfing.map(tileKey)),
  })
}

function resolveMovementSurfaceTiles(context: NewGamePlusDynamicPokemonWorldContext): SurfaceTileSets {
  const resolve = (method: SurfaceMethod) => resolveHgssVisibleWildSpawnTiles({
    map: context.map,
    method,
    maximum: 4_096,
  })
  return toSurfaceTileSets(resolve('land'), resolve('surfing'))
}

function resolveSafariAreaSlot(map: OpeningMapPreview, tile: SurfaceTile): number | undefined {
  const origin = getMapOrigin(map)
  const column = Math.floor((origin.x + tile.tileX) / 32) - HGSS_SAFARI_AREA_GRID_CELL_X
  const row = Math.floor((origin.z + tile.tileZ) / 32) - HGSS_SAFARI_AREA_GRID_CELL_Z
  return column >= 0 && column < HGSS_SAFARI_AREA_COLUMNS && row >= 0 && row < HGSS_SAFARI_AREA_ROWS
    ? row * HGSS_SAFARI_AREA_COLUMNS + column
    : undefined
}

export function createNewGamePlusDynamicPokemonWorldHost(
  options: NewGamePlusDynamicPokemonWorldHostOptions,
): NewGamePlusDynamicPokemonWorldHost {
  const render = (): readonly DynamicWorldActor[] => {
    const runtime = options.readRuntime(), context = options.readContext()
    const actors = context ? [
      ...(visibleRuntime(runtime)?.registry.getActorsOnMap(context.map.id) ?? []),
      ...(allPokemonRuntime(runtime)?.questWorldCoordinator.listActors().filter(({ mapId }) => mapId === context.map.id) ?? []),
    ] : []
    options.renderActors(Object.freeze(actors))
    return actors
  }

  const syncCurrentMap = (): readonly DynamicWorldActor[] => {
    const runtime = options.readRuntime(), context = options.readContext(), visible = visibleRuntime(runtime)
    if (!runtime || !context) return render()
    if (visible) {
      const canOccupy = ({ mapId, tileX, tileZ }: Readonly<{ mapId: number, tileX: number, tileZ: number }>) => (
        !context.isTileBlocked(mapId, tileX, tileZ)
      )
      if (context.isSafari) {
        let safeLandTiles: readonly SurfaceTile[] = Object.freeze([])
        let safeSurfingTiles: readonly SurfaceTile[] = Object.freeze([])
        const preparation = visible.config.includeSafari && context.prepareSafariEncounter
          ? prepareHgssVisibleSafariMapCandidates({
            seed: visible.config.seed, map: context.map, hour: context.hour,
            candidateCount: hgssVisibleSafariCoverageCandidateCount,
            prepareSafariEncounter: context.prepareSafariEncounter,
            fieldWildEncounterIdentityPort: runtime.ports.fieldWildEncounterIdentityPort,
            resolveSafeSpawnTiles: (method) => {
              const tiles = resolveHgssVisibleWildSpawnTiles({
                map: context.map, method, maximum: 4_096,
                isBlocked: (tileX, tileZ) => context.isTileBlocked(context.map.id, tileX, tileZ),
              })
              if (method === 'land') safeLandTiles = tiles
              else safeSurfingTiles = tiles
              return tiles
            },
          })
          : { mapId: context.map.id, spawnTiles: Object.freeze([]), prepareEncounters: () => Object.freeze([]) }
        const safeTiles = toSurfaceTileSets(safeLandTiles, safeSurfingTiles)
        visible.syncMap({ ...preparation, canOccupy,
          canPlaceCandidate: ({ encounterKey }, tile) => {
            const encounter = resolveHgssVisibleSafariEncounterCandidate(
              { seed: visible.config.seed, map: context.map }, encounterKey,
            )?.prepared.encounter
            if (encounter?.method !== 'safari') return false
            const method = encounter.safariMethod === 'land' ? 'land' : 'surfing'
            return safeTiles[method].has(tileKey(tile))
              && resolveSafariAreaSlot(context.map, tile) === encounter.areaSlot
          } })
      } else {
        const common = { seed: visible.config.seed, map: context.map, encounterCatalog: context.encounterCatalog, hour: context.hour,
          candidateCount: hgssVisibleWildCoverageRollCount, generationContext: { radioEffect: context.radioEffect, massOutbreak: context.massOutbreak }, fieldWildEncounterIdentityPort: runtime.ports.fieldWildEncounterIdentityPort }
        const prepare = (method: 'land' | 'surfing') => prepareHgssVisibleWildMapCandidates({ ...common, method,
          resolveSafeSpawnTiles: () => resolveHgssVisibleWildSpawnTiles({ map: context.map, method, isBlocked: (tileX, tileZ) => context.isTileBlocked(context.map.id, tileX, tileZ) }) })
        const land = prepare('land'), surfing = prepare('surfing')
        const safeTiles = toSurfaceTileSets(land.spawnTiles, surfing.spawnTiles)
        visible.syncMap({ mapId: context.map.id, spawnTiles: Object.freeze([...land.spawnTiles, ...surfing.spawnTiles]),
          prepareEncounters: () => Object.freeze([...land.encounters, ...surfing.encounters]), canOccupy,
          canPlaceCandidate: ({ encounterMethod }, tile) => encounterMethod !== 'safari'
            && safeTiles[encounterMethod].has(tileKey(tile)) })
      }
    }
    return render()
  }

  const advanceMovement = (): readonly DynamicWorldActor[] => {
    const runtime = options.readRuntime(), context = options.readContext(), visible = visibleRuntime(runtime)
    if (!runtime || !context || !visible) return Object.freeze([])
    if (visible.hasPendingRepopulation(context.map.id)) return syncCurrentMap()
    const safeTiles = resolveMovementSurfaceTiles(context)
    visible.advanceMovement({ mapId: context.map.id,
      canOccupy: (tile, actor) => {
        if (context.isTileBlocked(tile.mapId, tile.tileX, tile.tileZ, actor.id)) return false
        const interaction = visible.getInteraction(actor.id)
        if (!interaction) return false
        if (interaction.encounterMethod !== 'safari') {
          return safeTiles[interaction.encounterMethod].has(tileKey(tile))
        }
        const encounter = resolveHgssVisibleSafariEncounterCandidate(
          { seed: visible.config.seed, map: context.map }, interaction.encounterKey,
        )?.prepared.encounter
        if (encounter?.method !== 'safari') return false
        const method = encounter.safariMethod === 'land' ? 'land' : 'surfing'
        return safeTiles[method].has(tileKey(tile))
          && resolveSafariAreaSlot(context.map, tile) === encounter.areaSlot
      } })
    return render()
  }

  const tryInteract = (actorId: string): boolean => {
    const runtime = options.readRuntime(), context = options.readContext(), visible = visibleRuntime(runtime)
    if (!runtime || !context) return false
    if (visible && tryStartVisibleWildPokemonInteraction(visible, actorId, {
      resolvePreparedEncounter: ({ encounterKey, encounterMethod }) => encounterMethod === 'safari'
        ? resolveHgssVisibleSafariEncounterCandidate({ seed: visible.config.seed, map: context.map }, encounterKey)?.prepared
        : resolveHgssVisibleWildEncounterCandidate({ seed: visible.config.seed, map: context.map,
          encounterCatalog: context.encounterCatalog, fieldWildEncounterIdentityPort: runtime.ports.fieldWildEncounterIdentityPort }, encounterKey)?.prepared,
      startPreparedEncounter: options.startPreparedWildEncounter,
    })) { render(); return true }
    const quests = allPokemonRuntime(runtime)?.questWorldCoordinator
    if (quests?.startInteraction(actorId, options.startQuestWildEncounter)) { render(); return true }
    return false
  }

  return Object.freeze({
    syncCurrentMap,
    advanceMovement,
    tryInteract,
    replacesStepEncounters: () => {
      const visible = visibleRuntime(options.readRuntime()), context = options.readContext()
      return Boolean(visible && context && (!context.isSafari || visible.config.includeSafari)
        && visible.registry.getActorsOnMap(context.map.id).some(({ kind }) => kind === 'visible-wild'))
    },
    clear: () => options.renderActors(Object.freeze([])),
  })
}
