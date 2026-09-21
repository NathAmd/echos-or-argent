import type { RomInventory } from '../../ndsTypes'
import type { PlayerProfile } from '../../playerProfile'
import type { HgssSessionRng } from '../pokemon/hgssSessionRng'
import { createFieldScriptState, type FieldScriptState } from '../scripts/fieldScriptRunner'

export type HgssPostOakTemporalBindings = Readonly<{
  now: () => Date
  ownerRtcOffset: () => number
  igtMinutes: () => number
  rtcPenalty: () => boolean
}>

type InitializedHgssPlayerProfile = PlayerProfile & Required<Pick<PlayerProfile, 'trainerId' | 'language' | 'gameVersion'>>

function requireInitializedProfile(profile: PlayerProfile): asserts profile is InitializedHgssPlayerProfile {
  if (profile.trainerId === undefined || profile.language === undefined || profile.gameVersion === undefined) {
    throw new Error('Le profil HGSS post-Oak est incomplet.')
  }
}

/**
 * Builds the ROM-backed field state after Oak without owning mutable session
 * clocks. Temporal values stay behind live callbacks because restoring a save
 * replaces their backing objects.
 */
export function createHgssPostOakFieldState(
  inventory: RomInventory,
  profile: PlayerProfile,
  sessionRng: HgssSessionRng,
  temporal: HgssPostOakTemporalBindings,
): FieldScriptState {
  requireInitializedProfile(profile)
  return createFieldScriptState(profile.gender, profile.name, {
    pokemonRuntime: {
      catalog: inventory.pokemonCatalog,
      safariEncounterCatalog: inventory.safariEncounterCatalog,
      photoDataCatalog: inventory.photoDataCatalog,
      pokedexCatalog: inventory.pokedexCatalog,
      itemCatalog: inventory.itemCatalog,
      rng: sessionRng.lc,
      mt: sessionRng.mt,
      trainer: {
        id: profile.trainerId,
        name: profile.name,
        gender: profile.gender,
        nameSource: 'user-text',
      },
      language: profile.language,
      gameVersion: profile.gameVersion,
      now: temporal.now,
      ownerRtcOffset: temporal.ownerRtcOffset,
      igtMinutes: temporal.igtMinutes,
      rtcPenalty: temporal.rtcPenalty,
      phoneBookEntries: inventory.phoneBookEntries,
      trainerCatalog: inventory.trainerCatalog,
      trainerMessages: inventory.trainerMessages,
      npcTradeCatalog: inventory.npcTradeCatalog,
      trainerClassNames: inventory.trainerClassNames,
      easyChatCatalog: inventory.easyChatCatalog,
      pokeathlonDataMessages: inventory.pokeathlonDataMessages,
      alphPuzzleTiles: inventory.alphPuzzleTiles,
      alphPuzzleBackground: inventory.alphPuzzleBackground,
      alphPuzzleHints: inventory.alphPuzzleHints,
      alphHiddenRoomBackground: inventory.alphHiddenRoomBackground,
      alphHiddenRoomWords: inventory.alphHiddenRoomWords,
      mailMessageBanks: inventory.mailMessageBanks,
      trainerHouseDefaultName: inventory.trainerHouseDefaultName,
      mapSectionForMapId: (mapId) => inventory.resolvedMapCatalog.maps
        .find((map) => map.id === mapId)?.header.mapSection,
    },
  })
}
