import type { RomInventory } from '../../ndsTypes'
import { resolveHgssEncounterRadioEffect } from '../pokegear/hgssRadio'
import { HGSS_SAFARI_MAP_ID } from '../safari/hgssSafariMap'
import type { FieldScriptState } from '../scripts/fieldScriptRunner'
import { getMapOrigin } from '../world/mapCoordinates'
import type { WorldSession } from '../world/worldSession'
import {
  createNewGamePlusDynamicPokemonWorldHost,
  type NewGamePlusDynamicPokemonWorldContext,
  type NewGamePlusDynamicPokemonWorldHost,
  type NewGamePlusDynamicPokemonWorldHostOptions,
} from './newGamePlusDynamicPokemonWorldHost'

type WorldContextSources = Readonly<{
  readInventory: () => Pick<RomInventory, 'wildEncounterCatalog'> | undefined
  readWorldSession: () => WorldSession | undefined
  readFieldState: () => FieldScriptState
  prepareSafariEncounter: NonNullable<NewGamePlusDynamicPokemonWorldContext['prepareSafariEncounter']>
  hasDynamicBlockingActor: (
    mapId: number,
    tileX: number,
    tileZ: number,
    excludedActorId?: string,
  ) => boolean
}>

export type BrowserNewGamePlusWorldCompositionOptions = WorldContextSources & Readonly<{
  readRuntime: NewGamePlusDynamicPokemonWorldHostOptions['readRuntime']
  renderActors: NewGamePlusDynamicPokemonWorldHostOptions['renderActors']
  startPreparedWildEncounter: NewGamePlusDynamicPokemonWorldHostOptions['startPreparedWildEncounter']
  startQuestWildEncounter: NewGamePlusDynamicPokemonWorldHostOptions['startQuestWildEncounter']
}>

/** Projette les sources mutables de la page en contexte atomique pour un tick NG+. */
export function createBrowserNewGamePlusWorldContext(
  options: WorldContextSources,
): NewGamePlusDynamicPokemonWorldContext | undefined {
  const inventory = options.readInventory()
  const session = options.readWorldSession()
  const world = session?.getState()
  const fieldState = options.readFieldState()
  const pokemonRuntime = fieldState.pokemonRuntime
  if (!inventory || !session || !world || !pokemonRuntime) return undefined
  const follower = session.getFollowerState()
  const origin = getMapOrigin(world.map)
  return Object.freeze({
    map: world.map,
    encounterCatalog: inventory.wildEncounterCatalog,
    hour: pokemonRuntime.now().getHours(),
    radioEffect: resolveHgssEncounterRadioEffect(fieldState.radioMusicSequenceId),
    massOutbreak: Object.freeze({
      active: fieldState.roamers.massOutbreaksEnabled,
      randomValue: fieldState.friendGroups[1]?.randomValue ?? 0,
    }),
    isSafari: world.map.id === HGSS_SAFARI_MAP_ID && fieldState.safariZone.session.active,
    prepareSafariEncounter: options.prepareSafariEncounter,
    isTileBlocked: (mapId, tileX, tileZ, excludedActorId) => mapId !== world.map.id
      || world.tileX === tileX && world.tileZ === tileZ
      || follower?.map.id === mapId && follower.tileX === tileX && follower.tileZ === tileZ
      || (world.map.events?.objects ?? []).some((object) => {
        const actor = fieldState.objects.get(object.id)
        return Boolean(
          actor
          && (object.eventFlag === 0 || !fieldState.flags.has(object.eventFlag))
          && !fieldState.hiddenObjectIds.has(object.id)
          && actor.x === origin.x + tileX
          && actor.z === origin.z + tileZ,
        )
      })
      || options.hasDynamicBlockingActor(mapId, tileX, tileZ, excludedActorId),
  })
}

export function createBrowserNewGamePlusWorldComposition(
  options: BrowserNewGamePlusWorldCompositionOptions,
): NewGamePlusDynamicPokemonWorldHost {
  return createNewGamePlusDynamicPokemonWorldHost({
    readRuntime: options.readRuntime,
    readContext: () => createBrowserNewGamePlusWorldContext(options),
    renderActors: options.renderActors,
    startPreparedWildEncounter: options.startPreparedWildEncounter,
    startQuestWildEncounter: options.startQuestWildEncounter,
  })
}
