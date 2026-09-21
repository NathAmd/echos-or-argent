import type { RomInventory } from '../../ndsTypes'
import type { VersionedSaveExtensions } from '../save/versionedSaveExtensions'
import type { FieldScriptState } from '../scripts/fieldScriptRunner'
import { createAllPokemonEncounterMapSources, resolveAllPokemonNativeOneShotSpeciesIds } from './modules/allPokemonAccessibilityPlanner'
import { allPokemonAccessibleModuleId } from './modules/allPokemonAccessibleModule'
import { createAllPokemonQuestWorldLocations } from './modules/allPokemonQuestLocationPlanner'
import type { NewGamePlusProfileV1 } from '../newGamePlus'
import type { TitleCampaignActivationKind } from './titleCampaignCoordinator'
import {
  assertNewGamePlusRuntimeExtensionsMatchProfile,
  createNewGamePlusGameplayRuntime,
  type NewGamePlusGameplayRuntime,
} from './newGamePlusGameplayRuntime'

export type TitleNewGamePlusRuntimeCompositionOptions = Readonly<{
  profile?: NewGamePlusProfileV1
  extensions?: VersionedSaveExtensions
  kind: TitleCampaignActivationKind
  inventory?: RomInventory
  readFieldState: () => FieldScriptState
}>

/** Construit les dépendances ROM du profil sans les faire remonter dans main. */
export function createTitleNewGamePlusRuntime(
  options: TitleNewGamePlusRuntimeCompositionOptions,
): NewGamePlusGameplayRuntime | undefined {
  const { profile, extensions, kind, inventory } = options
  if (!profile) {
    assertNewGamePlusRuntimeExtensionsMatchProfile(undefined, extensions, kind)
    return undefined
  }
  if (!inventory || kind === 'normal') {
    throw new Error('Le runtime New Game+ ne peut pas être activé sans ROM ni campagne.')
  }
  return createNewGamePlusGameplayRuntime(profile, {
    catalog: inventory.pokemonCatalog,
    extensions,
    activation: kind,
    readProgression: () => options.readFieldState().badges.size,
    allPokemonAccessible: {
      mapSources: createAllPokemonEncounterMapSources(inventory.resolvedMapCatalog.maps),
      encounterCatalog: inventory.wildEncounterCatalog,
      knownAccessibleSpeciesIds: resolveAllPokemonNativeOneShotSpeciesIds(
        inventory.metadata.gameCode,
        inventory.mapEncounterLandmarks.landmarks,
      ),
      transitiveOneShotEvidence: {
        gameCode: inventory.metadata.gameCode,
        landmarks: inventory.mapEncounterLandmarks.landmarks,
      },
      readStatistics: () => {
        const state = options.readFieldState()
        return {
          money: state.money,
          battlesWon: state.trainerFlags.size,
          caughtSpeciesIds: [...state.pokedex.caughtSpeciesIds],
        }
      },
    },
    ...(profile.modules.some(({ id }) => id === allPokemonAccessibleModuleId)
      ? { allPokemonQuestLocations: createAllPokemonQuestWorldLocations(inventory.resolvedMapCatalog.maps) }
      : {}),
  })
}
