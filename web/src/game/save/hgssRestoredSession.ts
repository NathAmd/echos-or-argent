import type { OpeningMapPreview, RomInventory } from '../../ndsTypes'
import { restoreHgssSessionRng, snapshotHgssSessionRng } from '../pokemon/hgssSessionRng'
import { cloneFieldScriptState, setFieldScriptMapState, type FieldScriptState } from '../scripts/fieldScriptRunner'
import { snapshotHgssRtcPenaltyState } from '../time/hgssRtcPenalty'
import { getMapOrigin } from '../world/mapCoordinates'
import type { HgssGameOptions } from './hgssGameOptions'
import type { RestoredHgssSaveState } from './hgssSaveState'
import { cloneVersionedSaveExtensions } from './versionedSaveExtensions'

type PokemonRuntime = NonNullable<FieldScriptState['pokemonRuntime']>

export type HgssRestoredSessionBindings = Pick<PokemonRuntime, 'igtMinutes' | 'ownerRtcOffset' | 'rtcPenalty'>

/**
 * Reconstruit depuis la carte ROM locale les acteurs/props transitoires qui ne
 * font volontairement pas partie du document portable. Les scripts `resume`
 * de la carte restent exécutés ensuite par l'hôte pour dériver ses MapProps.
 */
export function rebuildHgssLocalFieldMapProjection(
  field: FieldScriptState,
  map: OpeningMapPreview,
  world: RestoredHgssSaveState['world'],
): void {
  if (map.id !== world.mapId) throw new Error(`La carte locale ${map.id} ne correspond pas à la reprise ${world.mapId}.`)
  const origin = getMapOrigin(map)
  setFieldScriptMapState(field, map, origin.x + world.tileX, origin.z + world.tileZ, world.direction)
}

export function prepareHgssRestoredSession(
  inventory: RomInventory,
  restored: RestoredHgssSaveState,
  bindings: HgssRestoredSessionBindings,
  preferredOptions?: HgssGameOptions,
) {
  const profile = { ...restored.profile }
  const rng = restoreHgssSessionRng(snapshotHgssSessionRng(restored.rng))
  const field = cloneFieldScriptState(restored.field)
  if (field.pokemonRuntime) field.pokemonRuntime = {
    ...field.pokemonRuntime,
    rng: rng.lc,
    mt: rng.mt,
    safariEncounterCatalog: inventory.safariEncounterCatalog,
    photoDataCatalog: inventory.photoDataCatalog,
    easyChatCatalog: inventory.easyChatCatalog,
    pokeathlonDataMessages: inventory.pokeathlonDataMessages,
    alphPuzzleTiles: inventory.alphPuzzleTiles,
    alphPuzzleBackground: inventory.alphPuzzleBackground,
    alphPuzzleHints: inventory.alphPuzzleHints,
    alphHiddenRoomBackground: inventory.alphHiddenRoomBackground,
    alphHiddenRoomWords: inventory.alphHiddenRoomWords,
    mailMessageBanks: inventory.mailMessageBanks,
    trainerHouseDefaultName: inventory.trainerHouseDefaultName,
    phoneBookEntries: inventory.phoneBookEntries,
    trainerCatalog: inventory.trainerCatalog,
    trainerMessages: inventory.trainerMessages,
    npcTradeCatalog: inventory.npcTradeCatalog,
    trainerClassNames: inventory.trainerClassNames,
    mapSectionForMapId: (mapId) => inventory.resolvedMapCatalog.maps.find((map) => map.id === mapId)?.header.mapSection,
    ...bindings,
  }
  return Object.freeze({
    profile,
    rng,
    field,
    options: { ...(preferredOptions ?? restored.options) },
    rtcPenalty: snapshotHgssRtcPenaltyState(restored.rtcPenalty),
    extensions: restored.extensions && cloneVersionedSaveExtensions(restored.extensions),
  })
}
