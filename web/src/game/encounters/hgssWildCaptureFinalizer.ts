import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { findFirstPokemonStorageSlot, type PokemonStorage } from '../pokemon/pokemonStorage'
import { markPokemonCaught, type HgssPokedexState } from '../pokedex/hgssPokedex'
import { hasHgssPokemonNicknameInput } from '../pokemon/pokemonNickname'
import {
  HGSS_BILL_PC_FULL_CALL_TRIGGER_ID,
  HGSS_BILL_PHONE_CONTACT_ID,
  HGSS_OAK_DEX_PROGRESS_CALL_TRIGGER_ID,
  HGSS_PROF_OAK_PHONE_CONTACT_ID,
} from '../pokegear/hgssPersistentIncomingCalls'

/**
 * Sources pret pokeheartgold:
 * - `src/encounter.c` (`Task_WildEncounter`, `Task_SafariEncounter`,
 *   `sub_02051660`);
 * - `src/battle/battle_command.c` états GET_POKEMON;
 * - `src/battle/battle_system.c` (`ov12_0223BB44`);
 * - `src/game_stats.c` (`sScoreMods`, plafonds et `GameStats_AddScore`);
 * - `src/naming_screen.c` (`NamingScreenApp_Exit`, `noInput`);
 * - `src/unk_02092BE8.c` (`sub_02093070`, `sub_020930C4`).
 */

export const HGSS_WILD_ENCOUNTERS_GAME_STAT_ID = 8 as const
export const HGSS_CAUGHT_POKEMON_GAME_STAT_ID = 10 as const
export const HGSS_NICKNAMES_GIVEN_GAME_STAT_ID = 50 as const
export const HGSS_WILD_POKEMON_FLED_GAME_STAT_ID = 100 as const

export const HGSS_REGISTER_SPECIES_CAUGHT_SCORE_EVENT_ID = 21 as const
export const HGSS_CAUGHT_REGIONAL_POKEMON_SCORE_EVENT_ID = 10 as const
export const HGSS_CAUGHT_NATIONAL_POKEMON_SCORE_EVENT_ID = 11 as const

export const HGSS_REGISTER_SPECIES_CAUGHT_SCORE = 20 as const
export const HGSS_CAUGHT_REGIONAL_POKEMON_SCORE = 2 as const
export const HGSS_CAUGHT_NATIONAL_POKEMON_SCORE = 3 as const

export const HGSS_BILL_PC_FULL_ACKNOWLEDGED_FLAG_ID = 0x985 as const
export const HGSS_OAK_NATIONAL_DEX_ACKNOWLEDGEMENT_BASE_FLAG_ID = 0x988 as const

const hgssWideGameStatMaximum = 999_999_999
const hgssNormalWordGameStatMaximum = 999_999
const hgssNormalHalfwordGameStatMaximum = 9_999
const hgssGameScoreMaximum = 99_999_999
const hgssNationalDexSpeciesCount = 493

export type HgssWildEncounterStatState = {
  gameStats: Map<number, number>
}

export type HgssWildCaptureProgressState = HgssWildEncounterStatState & {
  gameScore: number
  pokedex: HgssPokedexState
  pokemonStorage: PokemonStorage
  phoneContacts: ReadonlySet<number>
  flags: ReadonlySet<number>
  phoneCallTriggers: Set<number>
}

export type HgssWildCapturePreparationOptions = {
  /** Langue de la ROM active, passée à `Pokedex_SetMonCaughtFlag`. */
  nativeGameLanguage: number
  /** LUT ROM `species -> Johto Dex no`; 0 signifie hors Pokédex de Johto. */
  johtoDexNumbers: readonly number[]
}

export type HgssWildCaptureCommitOptions = {
  /** `NamingScreenArgs::noInput == FALSE`, indépendamment du texte choisi. */
  nicknameWasEntered: boolean
  /** Reproduit l'amorçage urgent de `sub_02092E14(..., TRUE)` pour Bill. */
  onUrgentTriggerScheduled?: (triggerId: typeof HGSS_BILL_PC_FULL_CALL_TRIGGER_ID) => void
}

export type HgssWildCaptureBeforeStorageOptions = Pick<HgssWildCaptureCommitOptions, 'nicknameWasEntered'>
export type HgssWildCaptureAfterBattleOptions = Pick<HgssWildCaptureCommitOptions, 'onUrgentTriggerScheduled'>

export type HgssWildCaptureFinalizerOptions = HgssWildCapturePreparationOptions & HgssWildCaptureCommitOptions

export type HgssPostWildBattleScheduledCall =
  | { triggerId: typeof HGSS_BILL_PC_FULL_CALL_TRIGGER_ID, forcePickUp: true }
  | { triggerId: typeof HGSS_OAK_DEX_PROGRESS_CALL_TRIGGER_ID, forcePickUp: false }

export type HgssWildCaptureFinalizationResult = {
  wasAlreadyCaught: boolean
  registeredNewSpecies: boolean
  scoreEventIds: Array<
    | typeof HGSS_REGISTER_SPECIES_CAUGHT_SCORE_EVENT_ID
    | typeof HGSS_CAUGHT_REGIONAL_POKEMON_SCORE_EVENT_ID
    | typeof HGSS_CAUGHT_NATIONAL_POKEMON_SCORE_EVENT_ID
  >
  scoreAdded: number
  scheduledCalls: HgssPostWildBattleScheduledCall[]
}

/**
 * Jeton d'une capture entre `ov12_0223BB44` (avant la fiche Pokédex) et le
 * stockage final (après le surnom). Il ne doit pas être sérialisé.
 */
export type HgssWildCapturePreparation = Readonly<{
  speciesId: number
  wasAlreadyCaught: boolean
  registeredNewSpecies: boolean
  scoreEventIds: readonly (typeof HGSS_REGISTER_SPECIES_CAUGHT_SCORE_EVENT_ID)[]
  scoreAdded: number
}>

type HgssWildCapturePreparationInternal = {
  state: HgssWildCaptureProgressState
  pokemon: CanonicalPokemon
  nativeGameLanguage: number
  johtoDexNumber: number
  scoreBefore: number
  nicknameWasEntered?: boolean
  committedBeforeStorage?: true
  result?: HgssWildCaptureFinalizationResult
}

const hgssCapturePreparations = new WeakMap<HgssWildCapturePreparation, HgssWildCapturePreparationInternal>()
const hgssCapturePreparationByState = new WeakMap<
  HgssWildCaptureProgressState,
  WeakMap<CanonicalPokemon, HgssWildCapturePreparation>
>()

function requireStoredCounter(value: number, label: string, maximum: number): void {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${label} HGSS ${value} est invalide.`)
  }
}

function incrementGameStat(state: HgssWildEncounterStatState, statId: number, maximum: number): void {
  const current = state.gameStats.get(statId) ?? 0
  requireStoredCounter(current, `Le compteur GameStats ${statId}`, maximum)
  state.gameStats.set(statId, Math.min(maximum, current + 1))
}

function addGameScore(state: Pick<HgssWildCaptureProgressState, 'gameScore'>, amount: number): void {
  requireStoredCounter(state.gameScore, 'Le score GameStats', hgssGameScoreMaximum)
  state.gameScore = Math.min(hgssGameScoreMaximum, state.gameScore + amount)
}

function requireWildPokemon(pokemon: CanonicalPokemon, johtoDexNumbers: readonly number[]): number {
  if (pokemon.isEgg) throw new Error('Un Œuf ne peut pas être finalisé comme capture sauvage HGSS.')
  if (!Number.isInteger(pokemon.speciesId) || pokemon.speciesId < 1 || pokemon.speciesId > hgssNationalDexSpeciesCount) {
    throw new Error(`L’espèce capturée HGSS ${pokemon.speciesId} est invalide.`)
  }
  const johtoDexNumber = johtoDexNumbers[pokemon.speciesId]
  if (!Number.isInteger(johtoDexNumber) || johtoDexNumber! < 0) {
    throw new Error(`L’index Johto ROM de l’espèce ${pokemon.speciesId} est absent.`)
  }
  return johtoDexNumber!
}

function validatePreparationState(
  state: Pick<HgssWildCaptureProgressState, 'gameScore' | 'gameStats'>,
  options: HgssWildCapturePreparationOptions,
): void {
  requireStoredCounter(state.gameScore, 'Le score GameStats', hgssGameScoreMaximum)
  requireStoredCounter(
    state.gameStats.get(HGSS_CAUGHT_POKEMON_GAME_STAT_ID) ?? 0,
    `Le compteur GameStats ${HGSS_CAUGHT_POKEMON_GAME_STAT_ID}`,
    hgssNormalWordGameStatMaximum,
  )
  requireStoredCounter(
    state.gameStats.get(HGSS_NICKNAMES_GIVEN_GAME_STAT_ID) ?? 0,
    `Le compteur GameStats ${HGSS_NICKNAMES_GIVEN_GAME_STAT_ID}`,
    hgssNormalWordGameStatMaximum,
  )
  if (!Number.isInteger(options.nativeGameLanguage) || options.nativeGameLanguage < 0 || options.nativeGameLanguage > 0xff) {
    throw new Error(`La langue native HGSS ${options.nativeGameLanguage} est invalide.`)
  }
}

function requireNicknameWasEntered(value: boolean): void {
  if (typeof value !== 'boolean') throw new Error('L’état de saisie du surnom HGSS est invalide.')
}

function countNationalDexOwned(pokedex: HgssPokedexState): number {
  let owned = 0
  for (let speciesId = 1; speciesId <= hgssNationalDexSpeciesCount; speciesId += 1) {
    if (pokedex.caughtSpeciesIds.has(speciesId)) owned += 1
  }
  return owned
}

/** `Task_WildEncounter` et `Task_SafariEncounter`, case 0. */
export function recordHgssWildEncounterStarted(state: HgssWildEncounterStatState): void {
  incrementGameStat(state, HGSS_WILD_ENCOUNTERS_GAME_STAT_ID, hgssWideGameStatMaximum)
}

/** Sous-script 230 `RunAwayWildMon`, également utilisé par la fuite adverse Safari. */
export function recordHgssWildOpponentFled(state: HgssWildEncounterStatState): void {
  incrementGameStat(state, HGSS_WILD_POKEMON_FLED_GAME_STAT_ID, hgssNormalHalfwordGameStatMaximum)
}

/**
 * Analogue navigateur de `NamingScreenArgs::noInput == FALSE` pour l'écran
 * Pokémon de HGSS. La ROM considère l'entrée vide ou composée uniquement de
 * `CHAR_SPACE` comme une absence de saisie; les espaces autour d'un autre
 * caractère restent dans le surnom.
 */
export { hasHgssPokemonNicknameInput }

/** Flag exact contrôlé par `sub_020930C4`, ou `undefined` avant 50 espèces. */
export function resolveHgssOakDexProgressAcknowledgementFlag(ownedCount: number): number | undefined {
  if (!Number.isInteger(ownedCount) || ownedCount < 0 || ownedCount > hgssNationalDexSpeciesCount) {
    throw new Error(`Le total national HGSS ${ownedCount} est invalide.`)
  }
  const bucket = Math.min(9, Math.floor(ownedCount / 50))
  return bucket === 0 ? undefined : HGSS_OAK_NATIONAL_DEX_ACKNOWLEDGEMENT_BASE_FLAG_ID + bucket
}

/**
 * Hooks de retour communs après un combat sauvage. La ROM les appelle après
 * que la capture a rempli l'équipe/le PC et mis à jour le Pokédex; cette API
 * peut également être appelée par le chemin sauvage ordinaire sans capture.
 */
export function scheduleHgssPostWildBattleCalls(
  state: Pick<HgssWildCaptureProgressState, 'pokedex' | 'pokemonStorage' | 'phoneContacts' | 'flags' | 'phoneCallTriggers'>,
  onUrgentTriggerScheduled?: HgssWildCaptureFinalizerOptions['onUrgentTriggerScheduled'],
): HgssPostWildBattleScheduledCall[] {
  const scheduled: HgssPostWildBattleScheduledCall[] = []
  if (state.phoneContacts.has(HGSS_BILL_PHONE_CONTACT_ID)
    && !state.flags.has(HGSS_BILL_PC_FULL_ACKNOWLEDGED_FLAG_ID)
    && findFirstPokemonStorageSlot(state.pokemonStorage) === undefined) {
    state.phoneCallTriggers.add(HGSS_BILL_PC_FULL_CALL_TRIGGER_ID)
    onUrgentTriggerScheduled?.(HGSS_BILL_PC_FULL_CALL_TRIGGER_ID)
    scheduled.push({ triggerId: HGSS_BILL_PC_FULL_CALL_TRIGGER_ID, forcePickUp: true })
  }

  if (state.phoneContacts.has(HGSS_PROF_OAK_PHONE_CONTACT_ID)) {
    const acknowledgementFlag = resolveHgssOakDexProgressAcknowledgementFlag(countNationalDexOwned(state.pokedex))
    if (acknowledgementFlag !== undefined && !state.flags.has(acknowledgementFlag)) {
      state.phoneCallTriggers.add(HGSS_OAK_DEX_PROGRESS_CALL_TRIGGER_ID)
      scheduled.push({ triggerId: HGSS_OAK_DEX_PROGRESS_CALL_TRIGGER_ID, forcePickUp: false })
    }
  }
  return scheduled
}

/**
 * Phase native précédant la fiche Pokédex. `ov12_0223BB44` crédite event 21
 * immédiatement après le message « données ajoutées », bien avant le surnom,
 * `Pokedex_SetMonCaughtFlag` et le stockage. Rejouer cette phase avec la même
 * paire état/Pokémon rend le même jeton sans doubler le score.
 */
export function prepareHgssWildCaptureProgression(
  state: HgssWildCaptureProgressState,
  pokemon: CanonicalPokemon,
  options: HgssWildCapturePreparationOptions,
): HgssWildCapturePreparation {
  const johtoDexNumber = requireWildPokemon(pokemon, options.johtoDexNumbers)
  validatePreparationState(state, options)

  let preparationsForPokemon = hgssCapturePreparationByState.get(state)
  const existing = preparationsForPokemon?.get(pokemon)
  if (existing) {
    const internal = hgssCapturePreparations.get(existing)!
    if (internal.nativeGameLanguage !== options.nativeGameLanguage || internal.johtoDexNumber !== johtoDexNumber) {
      throw new Error('La même capture HGSS a été préparée avec des données ROM incompatibles.')
    }
    return existing
  }

  const wasAlreadyCaught = state.pokedex.caughtSpeciesIds.has(pokemon.speciesId)
  const scoreBefore = state.gameScore
  if (!wasAlreadyCaught) {
    addGameScore(state, HGSS_REGISTER_SPECIES_CAUGHT_SCORE)
  }

  const preparation: HgssWildCapturePreparation = Object.freeze({
    speciesId: pokemon.speciesId,
    wasAlreadyCaught,
    registeredNewSpecies: !wasAlreadyCaught,
    scoreEventIds: Object.freeze(wasAlreadyCaught ? [] : [HGSS_REGISTER_SPECIES_CAUGHT_SCORE_EVENT_ID]),
    scoreAdded: state.gameScore - scoreBefore,
  })
  hgssCapturePreparations.set(preparation, {
    state,
    pokemon,
    nativeGameLanguage: options.nativeGameLanguage,
    johtoDexNumber,
    scoreBefore,
  })
  preparationsForPokemon ??= new WeakMap()
  preparationsForPokemon.set(pokemon, preparation)
  hgssCapturePreparationByState.set(state, preparationsForPokemon)
  return preparation
}

/**
 * Phase native au retour du Naming Screen, juste avant l'ajout Équipe/PC :
 * stat #50 éventuel, flag Pokédex caught puis stat #10. Elle est idempotente.
 */
export function commitHgssWildCaptureBeforeStorage(
  preparation: HgssWildCapturePreparation,
  options: HgssWildCaptureBeforeStorageOptions,
): void {
  const internal = hgssCapturePreparations.get(preparation)
  if (!internal) throw new Error('La préparation de capture HGSS est inconnue ou a été fabriquée.')
  requireNicknameWasEntered(options.nicknameWasEntered)
  if (internal.committedBeforeStorage) {
    if (internal.nicknameWasEntered !== options.nicknameWasEntered) {
      throw new Error('La même capture HGSS a reçu deux états de surnom incompatibles.')
    }
    return
  }

  const { state, pokemon } = internal
  if (options.nicknameWasEntered) {
    incrementGameStat(state, HGSS_NICKNAMES_GIVEN_GAME_STAT_ID, hgssNormalWordGameStatMaximum)
  }

  markPokemonCaught(state.pokedex, pokemon, internal.nativeGameLanguage)
  incrementGameStat(state, HGSS_CAUGHT_POKEMON_GAME_STAT_ID, hgssNormalWordGameStatMaximum)
  internal.nicknameWasEntered = options.nicknameWasEntered
  internal.committedBeforeStorage = true
}

/**
 * Phase de retour de `Task_WildEncounter`/`Task_SafariEncounter`, après le
 * placement et l'éventuel message PC : appels Bill/Chen, puis score régional
 * ou national. Elle refuse volontairement de devancer le stockage.
 */
export function completeHgssWildCaptureAfterBattle(
  preparation: HgssWildCapturePreparation,
  options: HgssWildCaptureAfterBattleOptions = {},
): HgssWildCaptureFinalizationResult {
  const internal = hgssCapturePreparations.get(preparation)
  if (!internal) throw new Error('La préparation de capture HGSS est inconnue ou a été fabriquée.')
  if (!internal.committedBeforeStorage) throw new Error('La capture HGSS doit être validée avant son retour post-combat.')
  if (internal.result) return internal.result

  const { state } = internal

  // `Task_*Encounter` vérifie Bill/Chen avant `sub_02051660`, qui attribue
  // ensuite le score régional/national de la capture.
  const scheduledCalls = scheduleHgssPostWildBattleCalls(state, options.onUrgentTriggerScheduled)

  const scoreEventIds: HgssWildCaptureFinalizationResult['scoreEventIds'] = [...preparation.scoreEventIds]
  if (internal.johtoDexNumber !== 0) {
    addGameScore(state, HGSS_CAUGHT_REGIONAL_POKEMON_SCORE)
    scoreEventIds.push(HGSS_CAUGHT_REGIONAL_POKEMON_SCORE_EVENT_ID)
  } else {
    addGameScore(state, HGSS_CAUGHT_NATIONAL_POKEMON_SCORE)
    scoreEventIds.push(HGSS_CAUGHT_NATIONAL_POKEMON_SCORE_EVENT_ID)
  }

  internal.result = {
    wasAlreadyCaught: preparation.wasAlreadyCaught,
    registeredNewSpecies: preparation.registeredNewSpecies,
    scoreEventIds,
    scoreAdded: state.gameScore - internal.scoreBefore,
    scheduledCalls,
  }
  return internal.result
}

/** Adaptateur composé historique : identité, puis retour post-combat. */
export function commitHgssWildCaptureProgression(
  preparation: HgssWildCapturePreparation,
  options: HgssWildCaptureCommitOptions,
): HgssWildCaptureFinalizationResult {
  commitHgssWildCaptureBeforeStorage(preparation, options)
  return completeHgssWildCaptureAfterBattle(preparation, options)
}

/**
 * Adaptateur rétrocompatible pour les chemins sans présentation intermédiaire.
 * Les écrans de capture doivent préférer explicitement `prepare...`, présenter
 * la fiche si nécessaire, puis appeler `commit...` après le surnom/stockage.
 */
export function finalizeHgssWildCaptureProgression(
  state: HgssWildCaptureProgressState,
  pokemon: CanonicalPokemon,
  options: HgssWildCaptureFinalizerOptions,
): HgssWildCaptureFinalizationResult {
  return commitHgssWildCaptureProgression(
    prepareHgssWildCaptureProgression(state, pokemon, options),
    options,
  )
}
