import type { NitroGraphic, OpeningMapPreview, PlayerDirection, PokemonCatalog } from '../../ndsTypes'
import { resolveMapInitScripts, type MapInitPhase } from '../../rom/scripts/fieldScripts'
import { cloneCanonicalPokemon, createCanonicalPokemon, type CanonicalPokemon, type PokemonTrainerIdentity } from '../pokemon/canonicalPokemon'
import { surviveHgssFieldPoisoning } from '../pokemon/hgssFieldPoison'
import {
  findHgssHatchableEggSlot,
  hatchHgssPartyEgg,
  hgssEggsHatchedGameStat,
  hgssElmEggHatchedCallTrigger,
  hgssHatchedEggScore,
  hgssHatchedTogepiFlag,
  isHgssMrPokemonTogepi,
} from '../pokemon/hgssEggHatching'
import { resolvePokemonFollowerSelection } from '../pokemon/followerSelection'
import { setPokemonNickname } from '../pokemon/pokemonNickname'
import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import type { HgssMersenneTwister } from '../pokemon/hgssSessionRng'
import { getHgssTmHmMoveId, type HgssItemCatalog } from '../../rom/items/itemData'
import { clonePokemonParty, createPokemonParty, getFirstUsablePokemonPartySlot, getPokemonPartyMember, hasPokemonPartyPokerus, type PokemonParty } from '../pokemon/pokemonParty'; import { basePokemonPartyHealingPolicy, healPokemonPartyWithPolicy, type PokemonPartyHealingPolicy } from '../pokemon/pokemonPartyHealingPolicy'; import { basePokemonTeamPolicy, getPokemonBattleEligiblePartySlots, type PokemonTeamPolicy } from '../pokemon/pokemonTeamPolicy'
import type { HgssPokeathlonModifiers } from '../../rom/pokemon/pokeathlonPerformance'
import { basePokemonInitialTeamResolver, type PokemonInitialTeamResolver } from '../pokemon/pokemonInitialTeamResolver'; import { basePokemonLevelPolicy, type PokemonLevelPolicy } from '../pokemon/pokemonLevelPolicy'
import { calculatePokemonStats, getAbilityFromPersonality, resolvePokemonPersonalData } from '../pokemon/pokemonFormulas'
import { hgssStarterSpeciesIds } from '../pokemon/hgssStarters'
import { decodeFieldMovement, type FieldMovementAction } from './fieldMovement'
import { runHgssWaterfallScriptCommand } from './hgssWaterfallMovement'
import { readAbsentFollowerMapObjectSignal, type FollowerMapObjectSignalReader } from '../world/followerMapObjectSignal'
import { resolveHgssFieldMoveEffectProfile } from '../world/hgssFieldMoveEffect'
import { isHgssFieldMapTemporaryVariable, isHgssFieldScriptTemporaryVariable } from './fieldVariableLifecycle'; import { applyHgssGameClearState } from './hgssGameClear'
import { decodeHgssPlayerDirection, encodeHgssPlayerDirection, hgssPlayerDirections } from '../player/playerDirection'
import { addBagItem, canAddBagItem, getBagItemQuantity, hasBagItem, takeBagItem } from '../items/bagInventory'
import { cloneHgssPokedex, createHgssPokedex, enableHgssNationalDex, enableHgssPokedex, markPokemonCaught, markPokemonSeen, type HgssPokedexState } from '../pokedex/hgssPokedex'
import { evaluateHgssPokedex } from '../pokedex/hgssDexEvaluation'
import { clonePokemonStorage, createPokemonStorage, hgssStorageBoxCapacity, hgssStorageBoxCount, placePokemonInFirstStorageSlot, type PokemonStorage } from '../pokemon/pokemonStorage'
import {
  createHgssPhoneContacts,
  getHgssPhoneMessageBank,
  isHgssPhoneContactRegistered,
  registerHgssPhoneContact,
  registerHgssPokegearCard,
  type HgssPhoneBookEntry,
} from '../../rom/phone/phoneBook'
import type { HgssTrainer } from '../../rom/battle/trainerData'
import type { HgssNpcTrade } from '../../rom/pokemon/npcTradeData'
import { getHgssTrainerMessage, type HgssTrainerMessageCatalog } from '../../rom/battle/trainerMessages'
import { getHgssSpecialMartItemIds, getHgssStandardMartItemIds } from '../items/hgssMarts'
import { chooseHgssMartOption, createHgssMartSession, createHgssMartView, enterHgssMartQuantity, type HgssMartSession } from '../items/hgssMartSession'
import type { HgssPokedexCatalog } from '../../rom/pokedex/pokedexData'
import type { HgssEasyChatCatalog } from '../../rom/easyChat/easyChatData'
import {
  buyHgssPokeathlonDataCard,
  changeHgssPokeathlonJumpRecord,
  countConsecutiveHgssPokeathlonDataCards,
  createHgssPokeathlonRecords,
  getHgssPokeathlonDataCardShop,
  getHgssPokeathlonDataRows,
  readHgssPokeathlonScriptRecord,
} from '../pokeathlon/hgssPokeathlonSave'
import { cloneHgssTrainerHouseEntry, hgssMailMessageBankIds, hgssTrainerHouseSlotCount, type HgssTrainerHouseEntry } from '../trainerHouse/hgssTrainerHouse'
import { clonePokegearNativeState, createPokegearNativeState, type PokegearNativeState } from '../pokegear/pokegearNativeState'
import { createHgssAlphPuzzleTiles, hgssAlphPuzzleFlags } from '../alph/hgssAlphPuzzle'
import {
  cloneHgssDaycareState,
  createHgssDaycareState,
  getHgssDaycareCompatibilityMessageIndex,
  getHgssDaycareLevelGrowth,
  getHgssDaycareSaveState,
  getHgssDaycareUpdatedLevel,
  getHgssDaycareWithdrawCost,
  giveHgssDaycareEgg,
  putPokemonInHgssDaycare,
  retrievePokemonFromHgssDaycare,
  type HgssDaycareState,
} from '../daycare/hgssDaycare'
import {
  assertHgssMultiplayerResult,
  decodeHgssCommunicationClubCommand,
  hgssMultiplayerProtocolVersion,
  serializeHgssMultiplayerPokemon,
  type HgssMultiplayerRequest,
  type HgssMultiplayerResult,
  type HgssRemoteFieldAvatar,
} from '../multiplayer/hgssMultiplayerGateway'
import { cloneHgssRoamerSaveState, createHgssRoamer, createHgssRoamerSaveState, updateHgssRoamersForMapTransition, type HgssRoamerSaveState } from '../encounters/hgssRoamers'
import {
  areHgssFriendGroupsEqual,
  cloneHgssFriendGroupState,
  copyHgssFriendGroup,
  createHgssFriendGroupState,
  initializePlayerHgssFriendGroup,
  isHgssFriendGroupActive,
  type HgssFriendGroupState,
} from '../multiplayer/hgssFriendGroups'; import type { HgssP2pTradeReceipt } from '../multiplayer/hgssP2pTradeReceipt'; import { parseHgssP2pTradeJournals, type HgssP2pTradeJournal } from '../multiplayer/hgssP2pTradeJournal'
import {
  getHgssBattleFacilityEligiblePartySlots,
  hgssBattleFrontierBannedSpeciesIds,
  isHgssPartyValidForBattleFrontier,
  isHgssPartyValidForBattleHall,
} from '../frontier/hgssBattleFrontier'
import { resolveHgssTrainerEncounterMusic } from '../battle/trainerEncounterMusic'
import { resolveBaseFieldBattleFormat, type FieldBattleFormatResolver } from '../battle/fieldBattleFormatResolver'
import { createHgssFrontierRecordPage } from '../frontier/hgssFrontierRecords'
import { getHgssAthleteShop, type HgssAthleteShopItem } from '../pokeathlon/hgssAthleteShop'
import { refreshHgssTimeOfDayState, resolveHgssTimeOfDay, resolveHgssWeekday, resolveHgssWildTimeOfDay, type HgssTimeOfDay } from '../time/hgssRtc'
import { hgssWeather, resolveHgssMapWeather, type HgssWeather } from '../world/hgssWeather'
import { formatHgssFieldDay, refreshHgssApricornTreesForCurrentDay } from '../time/hgssDailyState'
import {
  canGiveHgssFashionAccessory,
  chooseHgssBargainAccessory,
  chooseMissingHgssBargainBackground,
  giveHgssFashionAccessory,
  hasAllHgssBargainBackgrounds,
  hasRoomForHgssBargainAccessory,
} from '../fashion/hgssFashionCase'
import { cloneHgssSafariFieldSlice, createHgssSafariFieldSlice, registerHgssSafariPhoneContact, runHgssSafariChallengeCheckOpcode, runHgssSafariZoneActionOpcode, updateHgssSafariIgtReferenceFromRuntime, writeHgssSafariScriptVariable, type HgssSafariFieldSlice } from '../safari/hgssSafariFieldRuntime'
import type { HgssSafariEncounterCatalog } from '../../rom/safari/safariEncounterData'
import { applyHgssSafariAreaExchangeResult, createHgssSafariAreaExchangeRequest, createHgssSafariFieldAppRuntime, runHgssSafariImmediateOpcode } from '../safari/hgssSafariFieldOpcodeRuntime'
import type { HgssPhotoDataCatalog } from '../../rom/photo/photoData'
import { cloneHgssPhotoFieldSlice, createHgssPhotoFieldAppRuntime, createHgssPhotoFieldSlice, runHgssPhotoImmediateOpcode, type HgssPhotoFieldSlice } from '../photo/hgssPhotoFieldRuntime'
import { applyPlayerAvatarTransition } from './fieldPlayerAvatarState'
import { createHgssGymmickState, initializeHgssGymmickState, runHgssGymmickFieldCommand, type HgssGymmickState } from './hgssGymmickFieldRuntime'
import { createFieldScriptSequenceRunner, projectFieldScriptState, type FieldMapProp, type FieldScriptActorState, type FieldScriptRunner, type FieldScriptStep } from './fieldScriptProtocol'
import { appendScriptedPokemonToParty, giveHgssStarterToParty, removeScriptedPokemonFromParty, replaceScriptedPokemonInParty, resolveScriptedPokemonRemovalDecision, tryAppendScriptedPokemonToParty } from './fieldScriptPokemonTransactions'
export { formatFieldMessage } from './fieldMessageFormatter'
export { createFieldPhoneCallRunner, createFieldScriptSequenceRunner, projectFieldScriptState } from './fieldScriptProtocol'
export type { FieldMapProp, FieldScriptActorState, FieldScriptBattle, FieldScriptRunner, FieldScriptStep } from './fieldScriptProtocol'
export type { HgssGymmickState, HgssGymmickType } from './hgssGymmickFieldRuntime'
// sPokemonCenterMaps dans map_header.c. ScrCmd_840 distingue ces halls du
// lobby de la Ligue (MAP_POKEMON_LEAGUE_ENTRANCE = 300).
const hgssPokemonCenterMapIds = new Set([
  0, 69, 81, 158, 166, 169, 185, 226, 236, 246, 293,
  358, 393, 407, 428, 434, 466, 475, 482, 501, 508, 511, 514, 528, 534,
])
export type FieldPokemonRuntime = {
  catalog: PokemonCatalog
  pokedexCatalog?: HgssPokedexCatalog
  itemCatalog?: HgssItemCatalog
  safariEncounterCatalog?: HgssSafariEncounterCatalog; photoDataCatalog?: HgssPhotoDataCatalog
  rng: HgssLcrng
  mt?: HgssMersenneTwister
  trainer: PokemonTrainerIdentity
  language: number
  gameVersion: number
  now: () => Date; ownerRtcOffset?: () => number
  igtMinutes?: () => number // Temps de jeu HGSS en minutes; jamais la RTC murale.
  rtcPenalty?: () => boolean
  phoneBookEntries?: readonly HgssPhoneBookEntry[]
  trainerCatalog?: readonly HgssTrainer[]
  trainerMessages?: HgssTrainerMessageCatalog
  npcTradeCatalog?: readonly HgssNpcTrade[]
  trainerClassNames?: readonly string[]
  easyChatCatalog?: HgssEasyChatCatalog
  pokeathlonDataMessages?: Record<number, string>
  alphPuzzleTiles?: readonly (readonly NitroGraphic[])[]
  alphPuzzleBackground?: NitroGraphic
  alphPuzzleHints?: readonly string[]
  alphHiddenRoomBackground?: NitroGraphic
  alphHiddenRoomWords?: readonly string[]
  mailMessageBanks?: Record<number, Record<number, string>>
  trainerHouseDefaultName?: string
  /** Résout le palier de revanche HGSS déverrouillé pour un Dresseur. */
  resolvePhoneRematchTrainerId?: (baseTrainerId: number, trainerFlags: ReadonlySet<number>, eventFlags: ReadonlySet<number>) => number
  mapSectionForMapId?: (mapId: number) => number | undefined
}
const hgssApricornTypes = [6, 4, 1, 3, 2, 3, 3, 4, 6, 4, 6, 3, 2, 0, 2, 6, 5, 3, 4, 3, 1, 6, 0, 3, 3, 1, 2, 5, 0, 1, 5] as const
export function resolveHgssApricornType(treeIndex: number): number | undefined {
  return hgssApricornTypes[treeIndex]
}
const hgssGameScoreModifiers = [
  1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 7, 7, 7, 10, 10, 11, 11,
  11, 20, 30, 35, 40, 500, 10000, 7, 7, 7, 7, 1000, 11, 20, 10, 15, 11, 11, 10, 10,
] as const
function addHgssGameScore(state: FieldScriptState, reason: number): void {
  const amount = hgssGameScoreModifiers[reason]
  if (amount === undefined) throw new Error(`Événement de score HGSS ${reason} invalide.`)
  state.gameScore = Math.min(99_999_999, state.gameScore + amount)
}
function allOwnedPokemon(state: FieldScriptState): CanonicalPokemon[] {
  return [
    ...state.party.members,
    ...state.pokemonStorage.boxes.flatMap((box) => box.filter((pokemon): pokemon is CanonicalPokemon => pokemon !== undefined)),
    ...state.daycare.mons.flatMap((entry) => entry ? [entry.pokemon] : []),
  ]
}
function resetHgssFrontierFacility(state: FieldScriptState, facility: 'factory' | 'hall' | 'castle' | 'arcade', mode: number, levelMode = 0): void {
  if (!Number.isInteger(mode) || mode < 0 || mode > 3) throw new Error(`Mode Frontier HGSS ${mode} invalide.`)
  if (facility === 'factory') {
    const currentTrades = [0x0c, 0x14, 0x1c, 0x74] as const
    const currentStreaks = [0x0d, 0x15, 0x1d, 0x75] as const
    state.frontierRecords.set(currentTrades[mode]! + levelMode * 4, 0)
    state.frontierRecords.set(currentStreaks[mode]! + levelMode * 4, 0)
    if (mode === 3) state.frontierRecords.set(levelMode === 0 ? 0x66 : 0x68, 0)
    return
  }
  if (facility === 'hall') {
    for (const statId of [[0x23, 0x24], [0x2f, 0x30], [0x3b, 0x3c], [0x7b, 0x7c]][mode]!) state.frontierRecords.set(statId, 0)
    return
  }
  if (facility === 'castle') {
    const ids = [[0x46, 0x47, 0x48, 0x4a], [0x4e, 0x4f, 0x50, 0x52], [0x56, 0x57, 0x58, 0x5a], [0x86, 0x87, 0x88, 0x8a]][mode]!
    for (const statId of ids) state.frontierRecords.set(statId, 0)
    return
  }
  for (const statId of [[0x5e, 0x5f], [0x60, 0x61], [0x62, 0x63], [0x8e, 0x8f]][mode]!) state.frontierRecords.set(statId, 0)
}
function refreshApricornTreesForCurrentDay(state: FieldScriptState): void {
  refreshHgssApricornTreesForCurrentDay(state)
}
const hgssTutorMoves = [
  291, 189, 210, 196, 205, 9, 7, 276, 8, 442, 401, 466, 380, 173, 180, 314, 270, 283,
  200, 246, 235, 324, 428, 410, 414, 441, 239, 402, 334, 393, 387, 340, 271, 257, 282, 389,
  129, 253, 162, 220, 81, 366, 356, 388, 277, 272, 215, 67, 143, 335, 450, 29,
] as const
const hgssTutorMovePrices = [
  40, 32, 32, 48, 32, 64, 64, 48, 64, 40, 40, 48, 32, 32, 40, 48, 40, 64, 48, 40, 40, 40,
  64, 48, 40, 32, 40, 40, 40, 32, 48, 32, 48, 48, 40, 40, 32, 48, 40, 64, 32, 48, 32, 32,
  32, 48, 48, 32, 64, 32, 40, 0,
] as const
const hgssTutorNpcByMoveIndex = [
  0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 2, 2, 0, 2, 1, 1, 1, 2, 1, 0, 0, 1, 1,
  1, 1, 1, 2, 2, 1, 0, 1, 0, 0, 2, 2, 1, 1, 2, 2, 2, 2, 2, 2, 2, 1, 1, 2, 0, 3,
] as const
function getMoveTutorLearnsetIndex(pokemon: CanonicalPokemon): number {
  const specialFormSpecies = pokemon.speciesId === 386 && pokemon.form >= 1 && pokemon.form <= 3
    ? 496 + pokemon.form - 1
    : pokemon.speciesId === 413 && pokemon.form >= 1 && pokemon.form <= 2
      ? 499 + pokemon.form - 1
      : pokemon.speciesId === 487 && pokemon.form === 1 ? 501
        : pokemon.speciesId === 492 && pokemon.form === 1 ? 502
          : pokemon.speciesId === 479 && pokemon.form >= 1 && pokemon.form <= 5 ? 502 + pokemon.form
            : undefined
  return specialFormSpecies === undefined ? pokemon.speciesId - 1 : specialFormSpecies - 3
}
function getLearnableTutorMoveIds(state: FieldScriptState, slot: number, tutorNpc: number): number[] {
  const pokemon = getPokemonPartyMember(state.party, slot)
  if (!pokemon || pokemon.isEgg) return []
  const learnset = requirePokemonRuntime(state).catalog.moveTutorLearnsets?.[getMoveTutorLearnsetIndex(pokemon)]
  if (!learnset) throw new Error(`Le learnset ROM du maître des capacités pour ${pokemon.speciesName} est absent.`)
  const currentMoves = new Set(pokemon.moves.map((move) => move.moveId))
  return hgssTutorMoves.filter((moveId, moveIndex) => (
    hgssTutorNpcByMoveIndex[moveIndex] === tutorNpc
    && ((learnset[Math.floor(moveIndex / 8)] ?? 0) & (1 << (moveIndex % 8))) !== 0
    && !currentMoves.has(moveId)
  ))
}
const unionAvatarIndexChoices = [
  [0, 1, 2, 3], [1, 6, 7, 0], [2, 3, 4, 5], [3, 0, 5, 6],
  [4, 1, 2, 7], [5, 2, 7, 0], [6, 3, 4, 1], [7, 4, 5, 6],
] as const
const unionAvatarAttributes = {
  male: [
    { spriteId: 3, trainerClassId: 60 }, { spriteId: 5, trainerClassId: 6 },
    { spriteId: 11, trainerClassId: 24 }, { spriteId: 31, trainerClassId: 57 },
    { spriteId: 50, trainerClassId: 48 }, { spriteId: 51, trainerClassId: 14 },
    { spriteId: 62, trainerClassId: 32 }, { spriteId: 70, trainerClassId: 49 },
  ],
  female: [
    { spriteId: 6, trainerClassId: 3 }, { spriteId: 7, trainerClassId: 10 },
    { spriteId: 13, trainerClassId: 36 }, { spriteId: 14, trainerClassId: 25 },
    { spriteId: 35, trainerClassId: 85 }, { spriteId: 37, trainerClassId: 35 },
    { spriteId: 42, trainerClassId: 18 }, { spriteId: 63, trainerClassId: 33 },
  ],
} as const
function getUnionAvatarAttribute(state: FieldScriptState, choice: number) {
  const trainerId = state.pokemonRuntime?.trainer.id ?? 0
  const index = unionAvatarIndexChoices[trainerId & 7]?.[choice]
  const attribute = index === undefined ? undefined : unionAvatarAttributes[state.gender][index]
  if (!attribute) throw new Error(`Choix d’avatar Salle Union HGSS ${choice} invalide.`)
  return attribute
}
const hgssGotStarterFlag = 0x6a
function requirePokemonRuntime(state: FieldScriptState): FieldPokemonRuntime {
  if (!state.pokemonRuntime) throw new Error('Le runtime Pokémon HGSS requis par le script n’est pas initialisé.')
  return state.pokemonRuntime
}
function getStarterName(state: FieldScriptState, choice: number | undefined): string {
  const speciesId = choice === undefined ? undefined : hgssStarterSpeciesIds[choice]
  if (speciesId === undefined) return ''
  const name = requirePokemonRuntime(state).catalog.speciesNames[speciesId]
  if (!name) throw new Error(`Le nom ROM du starter ${speciesId} est absent.`)
  return name
}
function normalizeStarterChoice(value: number): number | undefined {
  if (hgssStarterSpeciesIds[value] !== undefined) return value
  const speciesChoice = hgssStarterSpeciesIds.indexOf(value as typeof hgssStarterSpeciesIds[number])
  return speciesChoice === -1 ? undefined : speciesChoice
}

function getSpeciesName(state: FieldScriptState, speciesId: number): string {
  const name = requirePokemonRuntime(state).catalog.speciesNames[speciesId]
  if (!name) throw new Error(`Le nom ROM de l’espèce Pokémon ${speciesId} est absent.`)
  return name
}

function getItem(state: FieldScriptState, itemId: number) {
  const item = requirePokemonRuntime(state).itemCatalog?.items[itemId]
  if (!item) throw new Error(`L'objet ROM HGSS ${itemId} est absent du catalogue.`)
  return item
}

function getItemCatalog(state: FieldScriptState): HgssItemCatalog {
  const catalog = requirePokemonRuntime(state).itemCatalog
  if (!catalog) throw new Error('Le catalogue ROM HGSS des objets requis par le script est absent.')
  return catalog
}

function resolveTrainerHouseMessage(state: FieldScriptState, trainerNumber: number): { messageId: number, text: string } {
  const runtime = requirePokemonRuntime(state)
  const entry = trainerNumber === hgssTrainerHouseSlotCount ? undefined : state.trainerHouseEntries[trainerNumber]
  // A zeroed native slot contains MailMessage { bank: 0, msg_no: 0,
  // fields: {0, 0} }. Normal scripts hide those actors, but preserve the
  // exact structure for audits and future server imports.
  const message = trainerNumber === hgssTrainerHouseSlotCount
    ? { bank: 0, messageId: 3, fields: [1119, 0xffff] as const }
    : entry?.introMessage ?? { bank: 0, messageId: 0, fields: [0, 0] as const }
  const bankId = hgssMailMessageBankIds[message.bank]
  const text = bankId === undefined ? undefined : runtime.mailMessageBanks?.[bankId]?.[message.messageId]
  if (text === undefined) throw new Error(`Le MailMessage Maison des Dresseurs ${message.bank}:${message.messageId} est absent de la ROM.`)
  for (let index = 0; index < message.fields.length; index += 1) {
    const wordId = message.fields[index]!
    const word = runtime.easyChatCatalog?.words[wordId]
    state.buffers.set(index, word?.text ?? '')
  }
  return { messageId: message.messageId, text }
}

function getRivalStarterName(state: FieldScriptState, choice: number | undefined): string {
  if (choice === undefined) return ''
  return getStarterName(state, (choice + 1) % hgssStarterSpeciesIds.length)
}

function getFriendStarterName(state: FieldScriptState, choice: number | undefined): string {
  if (choice === undefined) return ''
  return getStarterName(state, (choice + 2) % hgssStarterSpeciesIds.length)
}

function cloneActorState(actor: FieldScriptActorState): FieldScriptActorState {
  return { ...actor }
}

function resolveStarterBallMapProps(state: FieldScriptState): FieldMapProp[] {
  const count = state.flags.has(0x73) ? 0 : state.flags.has(0x99) ? 1 : state.party.members.length > 0 ? 2 : 3
  return [
    { modelId: 0x8d, x: 131, y: 0, z: 65 },
    { modelId: 0x8d, x: 141, y: 0, z: 65 },
    { modelId: 0x8d, x: 136, y: 0, z: 72 },
  ].slice(0, count)
}

export type FieldScriptState = HgssSafariFieldSlice & HgssPhotoFieldSlice & {
  pokemonRuntime?: FieldPokemonRuntime
  mailboxMessageCount: number
  /** Identités de courrier des 20 slots Mailbox natifs; extensible sans confondre contenu et compteur. */
  mailboxMailIdentities: Array<'kenya' | undefined>
  gender: 'male' | 'female'
  playerName: string; playerNameSource?: 'user-text'
  friendName: string; friendNameSource?: 'user-text'
  rivalName: string; rivalNameSource?: 'user-text'
  variables: Map<number, number>
  flags: Set<number>
  /** Bitset séparé de la sauvegarde native : un Dresseur vaincu n'est pas un event flag. */
  trainerFlags: Set<number>
  /** Contexte transitoire rempli par TryGetSeenByNpcTrainers avant le script standard 3739. */
  engagedTrainers: Array<{
    objectId: number
    trainerId: number
    direction: PlayerDirection
    distance: number
    encounterType: 0 | 1 | 2
  }>
  hiddenObjectIds: Set<number>
  /** Objets rendus invisibles par ScrCmd_374, mais toujours presents sur la carte. */
  invisibleObjectIds: Set<number>
  buffers: Map<number, string>
  inventory: Map<number, number>
  /** Sept compteurs du SaveApricornBox natif, dans l'ordre rouge à noir. */
  apricornBox: [number, number, number, number, number, number, number]
  /** Indices globaux des arbres déjà secoués aujourd'hui. */
  harvestedApricornTrees: Set<number>
  apricornTreeDay: string
  badges: Set<number>
  phoneContacts: Set<number>
  /** Contacts dont la demande de revanche Pokematos est active. */
  phoneRematchSeeking: Set<number>
  /** Cadeaux en attente, indexés par identifiant de contact Pokématos. */
  phoneGiftItems: Map<number, number>
  /** PhoneCallPersistentState::callTriggerFlags, conservé jusqu'au script qui l'acquitte. */
  phoneCallTriggers: Set<number>
  /** Sous-état natif du contact Karatéka Kenji. */
  kenjiActive: boolean
  kenjiWaitDays: number
  kenjiDay: string
  /** File persistante des achats envoyés par Maman. */
  momGiftItems: number[]; pokegearCards: Set<number>
  pokegearMapUnlockLevel: number
  /** Champs persistants du SavePokegear natif hors cartes et répertoire. */ pokegear: PokegearNativeState
  /** Nombre d’entrées DWC valides dans le roster ami natif (maximum 32). */
  friendRosterCount: number
  /** Six structures SAV_FRIEND_GRP locales; les données distantes seront alimentées par le serveur. */
  friendGroups: HgssFriendGroupState
  /** Bits SaveEasyChat::trendy, exposés comme indices 0..31. */
  easyChatTrendySayings: Set<number>
  /** Quatre MailMessage édités par les modes 2..5 de l'application Easy Chat. */
  easyChatMailMessages: Array<readonly [number, number]>
  /** MailMessage de quatre mots de la salutation de combat du Terminal Mondial. */
  battleGreetingWords: [number, number, number, number]
  /** Signatures 0x2345 des onze SaveFashionDataSub du premier tableau. */
  fashionPortraits: Set<number>
  /** Premier champ MailMessage initialisé par ScrCmd_256 pour le portrait 0. */
  fashionPortraitEasyChatWords: Map<number, number>
  /** Quantités des 100 accessoires de la Boîte Mode native. */
  fashionAccessories: Map<number, number>
  /** Identifiants 0..17 des décors de la Boîte Mode native. */
  fashionBackgrounds: Set<number>
  /** Dix entrées natives, remplies plus tard par le service d’échange. */
  trainerHouseEntries: Array<HgssTrainerHouseEntry | undefined>
  /** Bloc Save_Daycare natif : deux pensionnaires et état de l’œuf. */
  daycare: HgssDaycareState
  /** Bloc Save_Roamers natif, partagé par les scripts, la carte Pokématos et les rencontres. */
  roamers: HgssRoamerSaveState
  money: number
  coins: number
  athletePoints: number
  /** FrontierData::battlePoints, plafonné nativement à 9999. */
  battlePoints: number
  battlePointsReceived: number
  battlePointsSpent: number
  /** Projection exacte des 18 valeurs exposées par ScrCmd_724. */
  pokeathlonRecords: number[]
  /** Bits 0..26 de PokeathlonSave::unk_B78 (Cartes Données). */
  pokeathlonDataCards: Set<number>
  bankBalance: number
  /** GAME_STAT_SCORE, plafonné comme la structure native GameStats. */
  gameScore: number
  /** Compteurs GameStats natifs indexés par statno (les 4 octets par entrée). */
  gameStats: Map<number, number>
  /** Records FrontierSave lus par les scripts de la Carte Dresseur. */
  frontierRecords: Map<number, number>
  /** Récompenses 20/50/100 victoires déjà remises par le réceptionniste de la Tour. */
  frontierMilestoneRewards: Set<20 | 50 | 100>
  /** Curseur tournant du Juge des IV, conservé par FieldSystem pendant la session. */
  judgeStatPosition: number
  /** Valeur FrontierData[5] lue par la sous-commande 12 de ScrCmd_412. */
  frontierChallengeState: number
  /** Espèces ayant déjà obtenu un score dans la Scène de Combat. */
  battleHallUsedSpecies: Set<number>
  /** FrontierFieldSystem transitoire, conservé entre les cartes et snapshots de campagne. */
  frontierSession?: {
    towerMode: number
    requiredCount: number
    partySlots: number[]
    resumed: boolean
    multiBattleAllyId: number
    statTrainerMons: Array<Array<{ speciesId: number, firstMoveId: number }>>
  }
  blackoutSpawn: number
  party: PokemonParty
  pokemonStorage: PokemonStorage
  pokedex: HgssPokedexState
  timeOfDay: HgssTimeOfDay
  weather: HgssWeather
  starterChoice?: number
  /** Espèce matérialisée qui remplit le rôle narratif du starter choisi. */ starterStorySpeciesId?: number
  followMonActive: boolean
  followMonMovementPaused: boolean
  followMonInhibited: boolean
  followerMood: number
  runningShoes: boolean
  mysteryGiftActive: boolean
  /** Sauvegarde des Pokémon migrés et session de capture du Parc des Amis. */
  palPark: {
    catchingShowActive: boolean
    migratedPokemon: CanonicalPokemon[]
    catchingPoints: number
    timePoints: number
    typePoints: number
  }
  /** Session transitoire du Concours de capture d'insectes. */
  bugContest?: {
    weekday: number
    registeredContestants: number[]
    elapsedMinutes: number
    caughtPokemon?: CanonicalPokemon
    placement?: number
    prizeItemId?: number
  }
  /** Selection remise à Fargas dans le sous-bloc natif SaveApricornBox. */
  kurtApricornType: number
  kurtApricornQuantity: number
  kurtBallId: number
  /** Identité conservée par SaveMisc pour reconnaître l'Œuf de M. Pokémon après évolution. */
  togepiEggIdentity?: { personality: number, gender: 'male' | 'female' | 'genderless' }
  /** Les trois champs SaveMisc écrits par SetFavoriteMon (ScrCmd_671). */
  favoritePokemon: { speciesId: number, form: number, isEgg: boolean }
  /** Champs persistants de musique et de pas natifs (LocalFieldData/SaveVarsFlags). */
  radioMusicSequenceId: number; poisonStepCounter: number; friendshipStepCounter: number
  /** Valeur de PlayerAvatar_GetState (0 marche, 1 vélo, 2 surf). */
  playerState: number
  /** FieldSystem::unk1C, état transitoire piloté par ScrCmd_815. */
  fieldSystemMode: number
  /** Pointeur logique FieldSystem::linkBattleRuleset (état de session, non sauvegardé). */
  activeLinkRulesetId?: number
  /** Commande d'activité courante de la Salle Union (ScrCmd_257/261). */
  unionActivity: number
  /** Avatars distants reçus du serveur, jamais inventés par le mode hors ligne. */
  multiplayerRemoteAvatars: HgssRemoteFieldAvatar[]
  p2pTradeReceipts: HgssP2pTradeReceipt[]; p2pTradeJournals: HgssP2pTradeJournal[]
  /** Sprite choisi dans le profil natif pour les salons et fiches réseau. */
  unionAvatarSpriteId?: number
  /** Résultat brut du dernier combat terrain, partagé entre sous-scripts HGSS. */
  lastBattleWon?: boolean
  pendingPhoneCall?: { callerId: number, parameter1: number, parameter2: number }
  activePhoneContact?: HgssPhoneBookEntry
  player: FieldScriptActorState
  objects: Map<number, FieldScriptActorState>
  mapProps: FieldMapProp[]
  /** Horodatage du chargement courant, équivalent au FieldSystem::unkB4. */
  mapLoadedAtMs: number
  currentMapId?: number
  previousMapId?: number
  /** LocalFieldData::dynamicWarp, utilisé par les ascenseurs et retours spéciaux. */
  dynamicWarp?: { mapId: number, warpId: number, x: number, z: number, direction: number }
  /** Bloc Save_Gymmick natif, effacé lors d'un warp hors connexion. */
  gymmick: HgssGymmickState
}

export function createFieldScriptState(
  gender: 'male' | 'female',
  playerName = '',
  options: {
    friendName?: string; friendNameSource?: 'user-text'
    rivalName?: string; rivalNameSource?: 'user-text'
    party?: CanonicalPokemon[]
    partyPokeathlonModifiers?: readonly HgssPokeathlonModifiers[]
    pokemonStorage?: PokemonStorage
    pokemonRuntime?: FieldPokemonRuntime
    pokedex?: HgssPokedexState
    /** Compatibilite de construction pour les anciens tests/snapshots V1. */
    caughtSpeciesIds?: number[]
    starterChoice?: number; starterStorySpeciesId?: number
    followMonActive?: boolean
    followMonMovementPaused?: boolean
    /** Compatibilite de construction pour les anciens tests/snapshots V1. */
    pokedexEnabled?: boolean
    runningShoes?: boolean
    mysteryGiftActive?: boolean
    timeOfDay?: HgssTimeOfDay
  } = {},
): FieldScriptState {
  return {
    pokemonRuntime: options.pokemonRuntime,
    mailboxMessageCount: 0,
    mailboxMailIdentities: Array.from({ length: 20 }),
    gender,
    playerName, playerNameSource: playerName ? 'user-text' : undefined,
    friendName: options.friendName ?? '', friendNameSource: options.friendNameSource,
    rivalName: options.rivalName ?? 'SILVER', rivalNameSource: options.rivalNameSource,
    variables: new Map(),
    flags: new Set(),
    trainerFlags: new Set(),
    engagedTrainers: [],
    hiddenObjectIds: new Set(),
    invisibleObjectIds: new Set(),
    buffers: new Map(),
    inventory: new Map(),
    apricornBox: [0, 0, 0, 0, 0, 0, 0],
    harvestedApricornTrees: new Set(),
    apricornTreeDay: formatHgssFieldDay(options.pokemonRuntime?.now() ?? new Date()),
    badges: new Set(),
    phoneContacts: createHgssPhoneContacts(),
    phoneRematchSeeking: new Set(),
    phoneGiftItems: new Map(),
    phoneCallTriggers: new Set(),
    kenjiActive: false,
    kenjiWaitDays: 0,
    kenjiDay: formatHgssFieldDay(options.pokemonRuntime?.now() ?? new Date()),
    momGiftItems: [],
    pokegearCards: new Set(), pokegearMapUnlockLevel: 0,
    pokegear: createPokegearNativeState(),
    friendRosterCount: 0,
    friendGroups: createHgssFriendGroupState(),
    easyChatTrendySayings: new Set(),
    easyChatMailMessages: Array.from({ length: 4 }, () => [0xffff, 0xffff] as const),
    battleGreetingWords: [0xffff, 0xffff, 0xffff, 0xffff],
    fashionPortraits: new Set(),
    fashionPortraitEasyChatWords: new Map(),
    fashionAccessories: new Map(),
    fashionBackgrounds: new Set(),
    trainerHouseEntries: Array.from({ length: hgssTrainerHouseSlotCount }),
    daycare: createHgssDaycareState(),
    roamers: createHgssRoamerSaveState(),
    money: 3000,
    coins: 0,
    athletePoints: 0,
    battlePoints: 0,
    battlePointsReceived: 0,
    battlePointsSpent: 0,
    pokeathlonRecords: createHgssPokeathlonRecords(),
    pokeathlonDataCards: new Set(),
    bankBalance: 0,
    gameScore: 0,
    gameStats: new Map(),
    frontierRecords: new Map(),
    frontierMilestoneRewards: new Set(),
    judgeStatPosition: 0,
    frontierChallengeState: 0,
    battleHallUsedSpecies: new Set(),
    blackoutSpawn: 0,
    party: createPokemonParty(options.party, options.partyPokeathlonModifiers),
    pokemonStorage: options.pokemonStorage ? clonePokemonStorage(options.pokemonStorage) : createPokemonStorage(),
    pokedex: options.pokedex
      ? cloneHgssPokedex(options.pokedex)
      : createHgssPokedex({ enabled: options.pokedexEnabled, caughtSpeciesIds: options.caughtSpeciesIds }),
    timeOfDay: options.timeOfDay ?? resolveHgssTimeOfDay(options.pokemonRuntime?.now() ?? new Date()),
    weather: hgssWeather.clear,
    starterChoice: options.starterChoice,
    starterStorySpeciesId: options.starterStorySpeciesId,
    followMonActive: options.followMonActive ?? false,
    followMonMovementPaused: options.followMonMovementPaused ?? false,
    followMonInhibited: false,
    followerMood: 0,
    runningShoes: options.runningShoes ?? false,
    mysteryGiftActive: options.mysteryGiftActive ?? false,
    ...createHgssSafariFieldSlice(options.pokemonRuntime?.trainer.id ?? 0), ...createHgssPhotoFieldSlice(),
    palPark: { catchingShowActive: false, migratedPokemon: [], catchingPoints: 0, timePoints: 0, typePoints: 0 },
    kurtApricornType: 0,
    kurtApricornQuantity: 0,
    kurtBallId: 0,
    favoritePokemon: { speciesId: 0, form: 0, isEgg: false },
    radioMusicSequenceId: 0, poisonStepCounter: 0, friendshipStepCounter: 0,
    playerState: 0,
    fieldSystemMode: 0,
    unionActivity: 0,
    multiplayerRemoteAvatars: [], p2pTradeReceipts: [], p2pTradeJournals: [],
    player: { x: 0, z: 0, direction: 'south' },
    objects: new Map(),
    mapProps: [],
    mapLoadedAtMs: options.pokemonRuntime?.now().getTime() ?? Date.now(),
    gymmick: createHgssGymmickState(),
  }
}

/**
 * Libère les états qui n'ont de sens que tant qu'un contexte de script est
 * actif. Cette frontière est utilisée par le runtime, le simulateur et le
 * codec de sauvegarde pour qu'une interruption ne puisse pas verrouiller la
 * carte suivante.
 */
export function releaseFieldScriptExecutionState(state: FieldScriptState): void {
  for (const variableId of state.variables.keys()) {
    if (isHgssFieldScriptTemporaryVariable(variableId)) state.variables.delete(variableId)
  }
  state.lastBattleWon = undefined
  state.pendingPhoneCall = undefined
  state.followMonMovementPaused = false
}

export function cloneFieldScriptState(state: FieldScriptState): FieldScriptState {
  return {
    ...state,
    mailboxMailIdentities: [...state.mailboxMailIdentities],
    variables: new Map(state.variables),
    flags: new Set(state.flags),
    trainerFlags: new Set(state.trainerFlags),
    engagedTrainers: state.engagedTrainers.map((trainer) => ({ ...trainer })),
    hiddenObjectIds: new Set(state.hiddenObjectIds),
    invisibleObjectIds: new Set(state.invisibleObjectIds),
    buffers: new Map(state.buffers),
    inventory: new Map(state.inventory),
    apricornBox: [...state.apricornBox],
    harvestedApricornTrees: new Set(state.harvestedApricornTrees),
    badges: new Set(state.badges),
    phoneContacts: new Set(state.phoneContacts),
    phoneRematchSeeking: new Set(state.phoneRematchSeeking),
    phoneGiftItems: new Map(state.phoneGiftItems),
    phoneCallTriggers: new Set(state.phoneCallTriggers),
    easyChatTrendySayings: new Set(state.easyChatTrendySayings),
    easyChatMailMessages: state.easyChatMailMessages.map((message) => [...message] as [number, number]),
    battleGreetingWords: [...state.battleGreetingWords] as FieldScriptState['battleGreetingWords'],
    fashionPortraits: new Set(state.fashionPortraits),
    fashionPortraitEasyChatWords: new Map(state.fashionPortraitEasyChatWords),
    fashionAccessories: new Map(state.fashionAccessories),
    fashionBackgrounds: new Set(state.fashionBackgrounds),
    friendGroups: cloneHgssFriendGroupState(state.friendGroups),
    trainerHouseEntries: state.trainerHouseEntries.map((entry) => entry && cloneHgssTrainerHouseEntry(entry)),
    daycare: cloneHgssDaycareState(state.daycare),
    roamers: cloneHgssRoamerSaveState(state.roamers),
    favoritePokemon: { ...state.favoritePokemon },
    pokeathlonRecords: [...state.pokeathlonRecords],
    pokeathlonDataCards: new Set(state.pokeathlonDataCards),
    momGiftItems: [...state.momGiftItems],
    pokegearCards: new Set(state.pokegearCards), pokegear: clonePokegearNativeState(state.pokegear),
    frontierRecords: new Map(state.frontierRecords),
    gameStats: new Map(state.gameStats),
    frontierMilestoneRewards: new Set(state.frontierMilestoneRewards),
    battleHallUsedSpecies: new Set(state.battleHallUsedSpecies),
    frontierSession: state.frontierSession && {
      ...state.frontierSession,
      partySlots: [...state.frontierSession.partySlots],
      statTrainerMons: state.frontierSession.statTrainerMons.map((team) => team.map((pokemon) => ({ ...pokemon }))),
    },
    party: clonePokemonParty(state.party),
    pokemonStorage: clonePokemonStorage(state.pokemonStorage),
    pokedex: cloneHgssPokedex(state.pokedex),
    activePhoneContact: state.activePhoneContact && {
      ...state.activePhoneContact,
      sortParameters: [...state.activePhoneContact.sortParameters] as [number, number, number, number],
    },
    player: cloneActorState(state.player),
    objects: new Map([...state.objects].map(([objectId, actor]) => [objectId, cloneActorState(actor)])),
    mapProps: state.mapProps.map((prop) => ({ ...prop })),
    dynamicWarp: state.dynamicWarp && { ...state.dynamicWarp },
    ...cloneHgssSafariFieldSlice(state), ...cloneHgssPhotoFieldSlice(state),
    palPark: {
      catchingShowActive: state.palPark.catchingShowActive,
      migratedPokemon: state.palPark.migratedPokemon.map(cloneCanonicalPokemon),
      catchingPoints: state.palPark.catchingPoints,
      timePoints: state.palPark.timePoints,
      typePoints: state.palPark.typePoints,
    },
    bugContest: state.bugContest && {
      ...state.bugContest,
      registeredContestants: [...state.bugContest.registeredContestants],
      caughtPokemon: state.bugContest.caughtPokemon && cloneCanonicalPokemon(state.bugContest.caughtPokemon),
    },
    multiplayerRemoteAvatars: state.multiplayerRemoteAvatars.map((avatar) => ({
      ...avatar,
      player: { ...avatar.player },
    })), p2pTradeReceipts: state.p2pTradeReceipts.map((receipt) => ({ ...receipt })), p2pTradeJournals: parseHgssP2pTradeJournals(state.p2pTradeJournals).map((journal) => journal),
    gymmick: { type: state.gymmick.type, data: state.gymmick.data.slice() },
  }
}

function setStarterParty(state: FieldScriptState, choice: number, map: OpeningMapPreview, teamPolicy: PokemonTeamPolicy, initialTeamResolver: PokemonInitialTeamResolver): void {
  const runtime = requirePokemonRuntime(state)
  const storyStarter = giveHgssStarterToParty(state.party, state.pokedex, choice, map.header.mapSection, runtime, teamPolicy, initialTeamResolver)
  state.starterChoice = choice
  state.starterStorySpeciesId = storyStarter.speciesId
}

export function syncFieldScriptFollowerActivity(state: FieldScriptState, map: OpeningMapPreview): void {
  if (!state.pokemonRuntime) return
  if (!state.flags.has(hgssGotStarterFlag) || state.followMonInhibited) {
    state.followMonActive = false
    state.followMonMovementPaused = false
    return
  }
  const selection = resolvePokemonFollowerSelection(
    state.party,
    { id: map.id, followMode: map.header.followMode },
    state.pokemonRuntime.catalog.followers,
  )
  state.followMonActive = selection?.visible ?? false
  if (!state.followMonActive) state.followMonMovementPaused = false
}

export function setFieldScriptPlayerState(state: FieldScriptState, x: number, z: number, direction: PlayerDirection, groundHeight?: number): void {
  state.player = { x, z, direction, groundHeight }
}

export function setFieldScriptMapState(
  state: FieldScriptState,
  map: OpeningMapPreview,
  playerX: number,
  playerZ: number,
  direction: PlayerDirection,
): void {
  for (const variableId of state.variables.keys()) {
    if (isHgssFieldMapTemporaryVariable(variableId)) state.variables.delete(variableId)
  }
  // Le moteur natif libere l'inhibition temporaire du suiveur a chaque transition.
  state.followMonInhibited = false
  // HidePerson et SetVisible(FALSE) restent locaux au MapObject de la carte.
  state.hiddenObjectIds.clear()
  state.invisibleObjectIds.clear()
  if (state.currentMapId !== undefined && state.currentMapId !== map.id) {
    state.previousMapId = state.currentMapId
    if (state.pokemonRuntime) updateHgssRoamersForMapTransition(state.roamers, map.id, state.pokemonRuntime.rng)
  }
  state.currentMapId = map.id
  state.weather = resolveHgssMapWeather(map.id, map.header.weather ?? hgssWeather.clear, state.pokemonRuntime?.now() ?? new Date(), state.pokemonRuntime?.rtcPenalty?.())
  setFieldScriptPlayerState(state, playerX, playerZ, direction)
  state.objects = new Map((map.events?.objects ?? []).map((object) => [object.id, {
    x: object.x,
    z: object.z,
    direction: decodeHgssPlayerDirection(object.facingDirection),
    movement: object.movement,
  }]))
  state.mapProps = []
  state.mapLoadedAtMs = state.pokemonRuntime?.now().getTime() ?? Date.now()
}

function setFieldScriptObjectState(
  state: FieldScriptState,
  objectId: number,
  updates: { x?: number, z?: number, direction?: PlayerDirection, movement?: number },
): FieldScriptActorState | undefined {
  const actor = getFieldScriptActorState(state, objectId)
  if (!actor) return undefined
  if (updates.x !== undefined) actor.x = updates.x
  if (updates.z !== undefined) actor.z = updates.z
  if (updates.direction !== undefined) actor.direction = updates.direction
  if (updates.movement !== undefined) actor.movement = updates.movement
  return actor
}

function getFieldScriptActorState(state: FieldScriptState, objectId: number): FieldScriptActorState | undefined {
  if (objectId === 255) return state.player
  return state.objects.get(objectId)
}

function applyFieldScriptMovementState(state: FieldScriptState, objectId: number, actions: FieldMovementAction[]): void {
  const actor = getFieldScriptActorState(state, objectId)
  if (!actor) return
  const offsets: Record<PlayerDirection, readonly [number, number]> = {
    north: [0, -1],
    south: [0, 1],
    west: [-1, 0],
    east: [1, 0],
  }
  for (const action of actions) {
    if (action.direction && (action.kind === 'face' || action.kind === 'walk' || action.kind === 'walkInPlace' || action.kind === 'jump')) {
      actor.direction = action.direction
    }
    if ((action.kind !== 'walk' && action.kind !== 'jump') || !action.direction) continue
    const offset = offsets[action.direction]
    const tileDistance = action.kind === 'jump' ? action.tileDistance : 1
    actor.x += offset[0] * action.repetitions * tileDistance
    actor.z += offset[1] * action.repetitions * tileDistance
  }
}

function faceFieldScriptObjectAtPlayer(state: FieldScriptState, objectId: number): PlayerDirection | undefined {
  const actor = state.objects.get(objectId)
  if (!actor) return undefined
  const deltaX = state.player.x - actor.x
  const deltaZ = state.player.z - actor.z
  actor.direction = Math.abs(deltaX) > Math.abs(deltaZ)
    ? deltaX < 0 ? 'west' : 'east'
    : deltaZ < 0 ? 'north' : 'south'
  return actor.direction
}

export function resolveObjectSpriteId(spriteId: number, state: FieldScriptState): number {
  if (spriteId < 101 || spriteId > 117) return spriteId
  const variableId = 0x4020 + spriteId - 101
  const resolvedSpriteId = state.variables.get(variableId)
  if (resolvedSpriteId === undefined) {
    throw new Error(`La variable ROM 0x${variableId.toString(16)} du sprite ${spriteId} n’est pas initialisee.`)
  }
  return resolvedSpriteId
}

function requireBytes(bytes: Uint8Array, offset: number, size: number, opcode: number): void {
  if (offset < 0 || offset + size > bytes.byteLength) {
    throw new Error(`La commande script ${opcode} est tronquee a l’offset ${offset}.`)
  }
}

function findStandardScriptBank(map: OpeningMapPreview, scriptId: number): NonNullable<OpeningMapPreview['standardScripts']> | undefined {
  const banks = map.standardScriptBanks?.length ? map.standardScriptBanks : map.standardScripts ? [map.standardScripts] : []
  // Plusieurs banques standards peuvent être attachées à une carte. Il faut
  // sélectionner la banque qui contient réellement l'identifiant, et non la
  // première dont la base est simplement inférieure (ce qui détournait des
  // scripts locaux 3/13 vers un scénario standard sans rapport).
  return banks
    .filter((bank) => scriptId >= bank.baseScriptId && bank.entryOffsets[scriptId - bank.baseScriptId] !== undefined)
    .sort((left, right) => right.baseScriptId - left.baseScriptId)[0]
}

function trainerIdFromStandardScriptId(scriptId: number): number | undefined {
  if (scriptId >= 3000 && scriptId < 5000) return scriptId - 2999
  if (scriptId >= 5000 && scriptId < 7000) return scriptId - 4999
  return undefined
}

export function hasFieldScript(map: OpeningMapPreview, scriptId: number): boolean {
  if (!Number.isInteger(scriptId) || scriptId < 1) return false
  if (map.fieldScripts.entryOffsets[scriptId - 1] !== undefined) return true
  const standardBank = findStandardScriptBank(map, scriptId)
  return standardBank !== undefined
}

export function initializeNewGameFieldScriptState(map: OpeningMapPreview, state: FieldScriptState, healingPolicy: PokemonPartyHealingPolicy = basePokemonPartyHealingPolicy, teamPolicy: PokemonTeamPolicy = basePokemonTeamPolicy, initialTeamResolver: PokemonInitialTeamResolver = basePokemonInitialTeamResolver, levelPolicy: PokemonLevelPolicy = basePokemonLevelPolicy, battleFormatResolver: FieldBattleFormatResolver = resolveBaseFieldBattleFormat, readFollowerMapObjectSignal: FollowerMapObjectSignalReader = readAbsentFollowerMapObjectSignal): void {
  projectFieldScriptState(createFieldScriptRunner(map, 9600, state, undefined, healingPolicy, teamPolicy, initialTeamResolver, levelPolicy, battleFormatResolver, readFollowerMapObjectSignal))
}

export function createFieldScriptMapInitSequenceRunner(
  map: OpeningMapPreview,
  state: FieldScriptState,
  phase: MapInitPhase,
  interruptedRunner?: FieldScriptRunner, healingPolicy: PokemonPartyHealingPolicy = basePokemonPartyHealingPolicy, teamPolicy: PokemonTeamPolicy = basePokemonTeamPolicy, initialTeamResolver: PokemonInitialTeamResolver = basePokemonInitialTeamResolver, levelPolicy: PokemonLevelPolicy = basePokemonLevelPolicy, battleFormatResolver: FieldBattleFormatResolver = resolveBaseFieldBattleFormat, readFollowerMapObjectSignal: FollowerMapObjectSignalReader = readAbsentFollowerMapObjectSignal,
): FieldScriptRunner | undefined {
  const phases: MapInitPhase[] = phase === 'transition'
    ? ['transition', 'load', 'resume']
    : phase === 'load'
      ? ['load', 'resume']
      : ['resume']
  const runners = [
    ...phases
      .flatMap((currentPhase) => resolveMapInitScripts(map.initScripts, currentPhase))
      .map((scriptId) => createFieldScriptRunner(map, scriptId, state, undefined, healingPolicy, teamPolicy, initialTeamResolver, levelPolicy, battleFormatResolver, readFollowerMapObjectSignal)),
    interruptedRunner,
  ].filter((runner): runner is FieldScriptRunner => Boolean(runner))
  if (runners.length === 0) return undefined
  return runners.length === 1 ? runners[0] : createFieldScriptSequenceRunner(runners)
}

export function createFieldScriptRunner(map: OpeningMapPreview, scriptId: number, state: FieldScriptState, actorId?: number, healingPolicy: PokemonPartyHealingPolicy = basePokemonPartyHealingPolicy, teamPolicy: PokemonTeamPolicy = basePokemonTeamPolicy, initialTeamResolver: PokemonInitialTeamResolver = basePokemonInitialTeamResolver, levelPolicy: PokemonLevelPolicy = basePokemonLevelPolicy, battleFormatResolver: FieldBattleFormatResolver = resolveBaseFieldBattleFormat, readFollowerMapObjectSignal: FollowerMapObjectSignalReader = readAbsentFollowerMapObjectSignal): FieldScriptRunner {
  syncFieldScriptFollowerActivity(state, map)
  if (actorId !== undefined) state.variables.set(0x800d, actorId)
  const hasLocalScript = map.fieldScripts.entryOffsets[scriptId - 1] !== undefined
  const standardBank = hasLocalScript ? undefined : findStandardScriptBank(map, scriptId)
  const usesStandardBank = standardBank !== undefined
  const scriptMap = usesStandardBank
    ? { ...map, fieldScripts: standardBank, messages: standardBank.messages }
    : map
  const entryIndex = usesStandardBank ? scriptId - standardBank!.baseScriptId : scriptId - 1
  const entryOffset = scriptMap.fieldScripts.entryOffsets[entryIndex]
  if (!Number.isInteger(scriptId) || scriptId < 1 || entryOffset === undefined) {
    throw new Error(`Le script HGSS ${scriptId} n’existe pas dans sa banque ROM.`)
  }

  const bytes = scriptMap.fieldScripts.bytes
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let cursor = entryOffset
  let ended = false
  let comparisonResult: -1 | 0 | 1 = 0
  const returnOffsets: number[] = []
  let pendingChoice: { variableId: number, options: { label?: string, value: number }[], cancellable: boolean } | undefined
  let pendingStarterChoice = false
  let pendingMapPropsRefresh = false; let pendingMovementWait = false
  let buildingMenu: { variableId: number, options: { label: string, value: number }[], cancellable: boolean, messages: Record<number, string> } | undefined
  let pendingNumber: { variableId: number, mode: 0 | 1, max: number } | undefined
  let pendingApricornSelection: { phase: 'type' } | { phase: 'quantity', type: number } | undefined
  let pendingNickname:
    | { kind: 'pokemon', slot: number, destination: number }
    | { kind: 'friend-group', destination: number }
    | { kind: 'rival', destination: number }
    | undefined
  let pendingEggHatchSlot: number | undefined
  let pendingPartySelection: { initialSlot: number } | undefined
  let partyMenuResult: { slot: number, selectedAction: number } | undefined
  let pendingMoveDeletion: { slot: number } | undefined
  let moveDeletionResult: number | undefined
  let pendingFrontierPartySelection: {
    facility: 'hall' | 'castle' | 'arcade'
    requiredCount: number
    eligibleSlots: number[]
    selectedSlots: number[]
  } | undefined
  let frontierPartySelectionResult: { cancelled: boolean, slots: number[] } | undefined
  let pendingMartSession: HgssMartSession | undefined
  let pendingPokeathlonDataCards: ReturnType<typeof getHgssPokeathlonDataCardShop> | undefined
  let pendingAthleteShop: readonly HgssAthleteShopItem[] | undefined
  let activeNpcTradeId: number | undefined; let preparedDaycareDepositSlot: number | undefined; let preparedLoanReturnSlot: number | undefined
  let nestedRunner: FieldScriptRunner | undefined
  // Les opcodes de texte ne répètent pas le locuteur. Le moteur DS conserve
  // implicitement l'objet qui a lancé le script ou qui vient d'être animé.
  let speakerObjectId = actorId
  let pendingFadeFrames = 0
  let awaitingBattle = false
  let multiplayerRequestSerial = 0
  let awaitingMultiplayer: {
    request: HgssMultiplayerRequest
    apply: (result: HgssMultiplayerResult) => void
  } | undefined
  let awaitingEasyChat:
    | { kind: 'word', mode: number, resultVariable: number, outputVariable: number, secondOutputVariable?: number }
    | { kind: 'battleGreeting', resultVariable: number }
    | undefined
  let awaitingPcBox = false; const mapPropAnimationTags = new Set<number>()
  let awaitingPokeathlonApp = false
  let awaitingFrontierRecordsApp = false; let awaitingGameClear = false
  let awaitingAlphPuzzle: number | undefined
  let awaitingAlphHiddenRoom = false
  let pendingAppRestoreFade = false
  let lastBattleWon: boolean | undefined = state.lastBattleWon
  const readVariable = (variableId: number): number => state.variables.get(variableId) ?? 0
  const readScriptValue = (offset: number): number => {
    const value = view.getUint16(offset, true)
    return value >= 0x4000 ? readVariable(value) : value
  }
  const multiplayerRequestBase = (romOpcode: number, commandOffset: number) => ({
    protocolVersion: hgssMultiplayerProtocolVersion,
    requestId: `${scriptMap.id}:${scriptId}:${commandOffset}:${multiplayerRequestSerial++}`,
    romOpcode,
    player: {
      trainerId: state.pokemonRuntime?.trainer.id ?? 0,
      name: state.playerName,
      gender: state.gender,
    },
  }) as const
  const suspendMultiplayer = (
    request: HgssMultiplayerRequest,
    apply: (result: HgssMultiplayerResult) => void = () => undefined,
  ): Extract<FieldScriptStep, { kind: 'multiplayer' }> => {
    awaitingMultiplayer = { request, apply }
    return { kind: 'multiplayer', request }
  }
  const safariApps = createHgssSafariFieldAppRuntime(scriptMap, state); const photoApps = createHgssPhotoFieldAppRuntime(state)
  const createShopStep = (): FieldScriptStep => {
    if (pendingAthleteShop) {
      return {
        kind: 'choice',
        options: [
          ...pendingAthleteShop.map(({ itemId, price }) => {
            const item = getItem(state, itemId)
            return { label: `${item.name} · ${price} P.A. · ×${getBagItemQuantity(state.inventory, itemId)}`, value: itemId }
          }),
          { label: 'Quitter', value: 0xfffe },
        ],
        cancellable: true,
      }
    }
    if (pendingPokeathlonDataCards) {
      return {
        kind: 'choice',
        options: [
          ...pendingPokeathlonDataCards.map(({ itemId, price }) => {
            const item = getItem(state, itemId)
            const obtained = state.pokeathlonDataCards.has(itemId - 505)
            return { label: `${item.name} · ${price} P.A.${obtained ? ' · Obtenue' : ''}`, value: itemId }
          }),
          { label: 'Quitter', value: 0xfffe },
        ],
        cancellable: true,
      }
    }
    if (!pendingMartSession) throw new Error('Aucune boutique HGSS n’est active.')
    const view = createHgssMartView(pendingMartSession, state.inventory, getItemCatalog(state), state.money)
    const shop = { mode: view.mode, balance: view.balance, transaction: view.transaction }
    return view.phase === 'quantity'
      ? { kind: 'number', min: 1, max: view.transaction!.maxQuantity, shop: { ...shop, transaction: view.transaction! } }
      : { kind: 'choice', options: view.options, cancellable: true, presentation: 'shop', shop: { ...shop, phase: view.phase } }
  }
  const createFrontierPartySelectionStep = (): Extract<FieldScriptStep, { kind: 'choice' }> => {
    if (!pendingFrontierPartySelection) throw new Error("Aucun sélecteur d'équipe Frontier HGSS n'est actif.")
    return {
      kind: 'choice',
      options: [
        ...pendingFrontierPartySelection.eligibleSlots
          .filter((slot) => !pendingFrontierPartySelection?.selectedSlots.includes(slot))
          .filter((slot) => {
            const selection = pendingFrontierPartySelection!
            if (selection.selectedSlots.length === 0) return true
            const speciesId = state.party.members[slot]!.speciesId
            const selectedSpecies = selection.selectedSlots.map((selectedSlot) => state.party.members[selectedSlot]!.speciesId)
            return selection.facility === 'hall' && selection.requiredCount === 2
              ? speciesId === selectedSpecies[0]
              : !selectedSpecies.includes(speciesId)
          })
          .map((slot) => {
            const pokemon = state.party.members[slot]!
            return {
              label: `${pendingFrontierPartySelection!.selectedSlots.length + 1}. ${pokemon.nickname ?? pokemon.speciesName} · Nv.${pokemon.level}`,
              value: slot,
            }
          }),
        { label: 'Retour', value: 0xfffe },
      ],
      cancellable: true,
      presentation: 'party',
    }
  }
  const createMoveDeletionStep = (): Extract<FieldScriptStep, { kind: 'choice' }> => {
    if (!pendingMoveDeletion) throw new Error('Aucun écran HGSS de suppression de capacité n’est actif.')
    const pokemon = getPokemonPartyMember(state.party, pendingMoveDeletion.slot)
    if (!pokemon || pokemon.isEgg) throw new Error(`Le Pokémon ${pendingMoveDeletion.slot} ne peut pas oublier de capacité.`)
    return {
      kind: 'choice',
      options: [
        ...pokemon.moves.map((move, moveSlot) => ({
          label: requirePokemonRuntime(state).catalog.moveNames[move.moveId] ?? `Capacité ${move.moveId}`,
          value: moveSlot,
        })),
        { label: 'Retour', value: 0xff },
      ],
      cancellable: true,
    }
  }

  return {
    submitSafariCustomizerChange(change): void { if (nestedRunner?.submitSafariCustomizerChange) nestedRunner.submitSafariCustomizerChange(change); else safariApps.submitSafariCustomizerChange(change) },
    closeSafariCustomizer(): void { if (nestedRunner?.closeSafariCustomizer) nestedRunner.closeSafariCustomizer(); else safariApps.closeSafariCustomizer() },
    submitSafariDecoratorSelection(objectId): void { if (nestedRunner?.submitSafariDecoratorSelection) nestedRunner.submitSafariDecoratorSelection(objectId); else safariApps.submitSafariDecoratorSelection(objectId) },
    finishPhotoCapture(): void { if (nestedRunner?.finishPhotoCapture) nestedRunner.finishPhotoCapture(); else photoApps.finishPhotoCapture() }, closePhotoAlbum(photos): void { if (nestedRunner?.closePhotoAlbum) nestedRunner.closePhotoAlbum(photos); else photoApps.closePhotoAlbum(photos) },
    closePcBox(): void { if (nestedRunner) { nestedRunner.closePcBox(); return }; if (!awaitingPcBox) throw new Error("Aucune Boîte PC HGSS n'est active."); awaitingPcBox = false },
    closeFrontierRecordsApp(): void {
      if (nestedRunner) {
        nestedRunner.closeFrontierRecordsApp()
        return
      }
      if (!awaitingFrontierRecordsApp) throw new Error("Aucun écran de records Frontier HGSS n'est actif.")
      awaitingFrontierRecordsApp = false
    },
    closeGameClear(): void { if (nestedRunner) { nestedRunner.closeGameClear(); return }; if (!awaitingGameClear) throw new Error("Aucun écran de fin de Ligue HGSS n'est actif."); awaitingGameClear = false },
    closeAlphHiddenRoom(): void {
      if (nestedRunner) {
        nestedRunner.closeAlphHiddenRoom()
        return
      }
      if (!awaitingAlphHiddenRoom) throw new Error("Aucune inscription secrète des Ruines d’Alpha HGSS n'est active.")
      awaitingAlphHiddenRoom = false
    },
    finishAlphPuzzle(solved: boolean): void {
      if (nestedRunner) {
        nestedRunner.finishAlphPuzzle(solved)
        return
      }
      if (awaitingAlphPuzzle === undefined) throw new Error("Aucun puzzle des Ruines d’Alpha HGSS n'est actif.")
      if (solved) state.flags.add(hgssAlphPuzzleFlags[awaitingAlphPuzzle]!)
      awaitingAlphPuzzle = undefined
    },
    closePokeathlonApp(): void {
      if (nestedRunner) {
        nestedRunner.closePokeathlonApp()
        return
      }
      if (!awaitingPokeathlonApp) throw new Error("Aucune application Pokéathlon HGSS n'est active.")
      awaitingPokeathlonApp = false
    },
    submitEasyChat(wordId: number | readonly number[] | undefined): void {
      if (nestedRunner) {
        nestedRunner.submitEasyChat(wordId)
        return
      }
      if (!awaitingEasyChat) throw new Error("Aucune saisie Easy Chat HGSS n'est active.")
      const pending = awaitingEasyChat
      awaitingEasyChat = undefined
      if (pending.kind === 'battleGreeting') {
        if (wordId === undefined) {
          state.variables.set(pending.resultVariable, 0)
        } else {
          const words = (Array.isArray(wordId) ? wordId : [wordId]).slice(0, 4)
          const catalog = requirePokemonRuntime(state).easyChatCatalog
          if (!catalog || words.some((word) => !catalog.words[word])) {
            throw new Error('La salutation Easy Chat HGSS contient un mot ROM invalide.')
          }
          while (words.length < 4) words.push(0xffff)
          state.battleGreetingWords = words as FieldScriptState['battleGreetingWords']
          state.variables.set(pending.resultVariable, 1)
        }
        // sub_02096260 recharge le field overlay et révèle la carte avant de
        // rendre la main au script, contrairement aux autres modes Easy Chat.
        pendingAppRestoreFade = true
        return
      }
      state.variables.set(pending.outputVariable, 0xffff)
      if (wordId === undefined) {
        state.variables.set(pending.resultVariable, 0)
        return
      }
      if (typeof wordId !== 'number') throw new Error('Cette commande Easy Chat HGSS attend un seul mot.')
      const catalog = requirePokemonRuntime(state).easyChatCatalog
      if (!catalog?.words[wordId]) throw new Error(`Le mot Easy Chat HGSS ${wordId} est invalide.`)
      state.variables.set(pending.resultVariable, 1)
      if (pending.mode === 1) {
        const category = catalog.categories.find((candidate) => wordId >= candidate.firstWordId && wordId < candidate.firstWordId + candidate.wordCount)
        if (!category) throw new Error(`La catégorie du mot Easy Chat HGSS ${wordId} est absente.`)
        state.variables.set(pending.outputVariable, category.messageBankId)
        if (pending.secondOutputVariable !== undefined) state.variables.set(pending.secondOutputVariable, wordId - category.firstWordId)
      } else {
        state.variables.set(pending.outputVariable, wordId)
      }
      if (pending.mode >= 2 && pending.mode <= 5) {
        state.easyChatMailMessages[pending.mode - 2] = [wordId, 0xffff]
      }
    },
    submitMultiplayerResult(result): void {
      if (nestedRunner) {
        nestedRunner.submitMultiplayerResult(result)
        return
      }
      if (!awaitingMultiplayer) throw new Error("Aucune commande multijoueur HGSS n'attend de résultat.")
      assertHgssMultiplayerResult(awaitingMultiplayer.request, result)
      const pending = awaitingMultiplayer
      awaitingMultiplayer = undefined
      pending.apply(result)
    },
    submitBattleResult(won: boolean): void {
      if (nestedRunner) {
        nestedRunner.submitBattleResult(won)
        // Le résultat de combat vit au niveau FieldSystem natif : un CallStd
        // peut lancer le combat puis le script parent relit ce même résultat.
        lastBattleWon = won
        state.lastBattleWon = won
        return
      }
      if (!awaitingBattle) throw new Error("Aucun combat HGSS n'attend de résultat.")
      awaitingBattle = false
      lastBattleWon = won
      state.lastBattleWon = won
    },
    choose(value: number): void {
      if (nestedRunner) {
        nestedRunner.choose(value)
        return
      }
      if (pendingStarterChoice) {
        setStarterParty(state, value, map, teamPolicy, initialTeamResolver)
        pendingStarterChoice = false
        state.mapProps = resolveStarterBallMapProps(state)
        pendingMapPropsRefresh = true
        return
      }
      if (pendingApricornSelection?.phase === 'type') {
        if (value === 0xfffe) {
          pendingApricornSelection = undefined
          return
        }
        const quantity = state.apricornBox[value]
        if (quantity === undefined || quantity <= 0) throw new Error(`Le Noigrume HGSS ${value} n'est pas disponible pour Fargas.`)
        pendingApricornSelection = { phase: 'quantity', type: value }
        return
      }
      if (pendingPartySelection) {
        if (value === 0xfffe) {
          partyMenuResult = { slot: 0xff, selectedAction: 0 }
        } else {
          if (!Number.isInteger(value) || value < 0 || value >= state.party.members.length) {
            throw new Error(`Le Pokémon d’équipe ${value} n’est pas disponible dans le sélecteur HGSS.`)
          }
          partyMenuResult = { slot: value, selectedAction: 0 }
        }
        pendingPartySelection = undefined
        return
      }
      if (pendingFrontierPartySelection) {
        if (value === 0xfffe) {
          frontierPartySelectionResult = { cancelled: true, slots: [] }
          pendingFrontierPartySelection = undefined
          return
        }
        if (!createFrontierPartySelectionStep().options.some((option) => option.value === value)) {
          throw new Error(`Le slot ${value} n'est pas disponible dans le sélecteur Frontier HGSS.`)
        }
        pendingFrontierPartySelection.selectedSlots.push(value)
        if (pendingFrontierPartySelection.selectedSlots.length >= pendingFrontierPartySelection.requiredCount) {
          frontierPartySelectionResult = { cancelled: false, slots: [...pendingFrontierPartySelection.selectedSlots] }
          pendingFrontierPartySelection = undefined
        }
        return
      }
      if (pendingMoveDeletion) {
        const choice = createMoveDeletionStep()
        if (!choice.options.some((option) => option.value === value)) {
          throw new Error(`La capacité ${value} n’est pas disponible dans l’écran de suppression HGSS.`)
        }
        moveDeletionResult = value === 0xff ? 0xff : value
        pendingMoveDeletion = undefined
        return
      }
      if (pendingMartSession) {
        const result = chooseHgssMartOption(pendingMartSession, value, state.inventory, getItemCatalog(state), state.money)
        state.money = result.balance
        if (result.closed) pendingMartSession = undefined
        return
      }
      if (pendingPokeathlonDataCards) {
        if (value === 0xfffe) {
          pendingPokeathlonDataCards = undefined
          return
        }
        if (!pendingPokeathlonDataCards.some((card) => card.itemId === value)) {
          throw new Error(`La Carte Données ${value} n'est pas vendue dans ce palier HGSS.`)
        }
        state.athletePoints = buyHgssPokeathlonDataCard(
          state.pokeathlonDataCards,
          value,
          state.athletePoints,
        )
        return
      }
      if (pendingAthleteShop) {
        if (value === 0xfffe) {
          pendingAthleteShop = undefined
          return
        }
        const offer = pendingAthleteShop.find(({ itemId }) => itemId === value)
        if (!offer) throw new Error(`L'objet ${value} n'est pas vendu par la Boutique Athlète HGSS.`)
        const itemCatalog = getItemCatalog(state)
        if (state.athletePoints >= offer.price && canAddBagItem(state.inventory, itemCatalog, value, 1)) {
          state.athletePoints -= offer.price
          addBagItem(state.inventory, itemCatalog, value, 1)
        }
        return
      }
      if (pendingChoice?.cancellable && value === 0xfffe) {
        state.variables.set(pendingChoice.variableId, value)
        pendingChoice = undefined
        return
      }
      if (!pendingChoice || !pendingChoice.options.some((option) => option.value === value)) {
        throw new Error(`Le choix HGSS ${value} n’est pas disponible.`)
      }
      state.variables.set(pendingChoice.variableId, value)
      pendingChoice = undefined
    },
    enterNumber(value: number | undefined): void {
      if (nestedRunner) {
        nestedRunner.enterNumber(value)
        return
      }
      if (pendingMartSession?.phase === 'quantity') { enterHgssMartQuantity(pendingMartSession, value, state.inventory, getItemCatalog(state), state.money); return }
      if (pendingApricornSelection?.phase === 'quantity') {
        const type = pendingApricornSelection.type
        pendingApricornSelection = undefined
        if (value === undefined) return
        const quantity = Math.trunc(value)
        if (quantity < 1 || quantity > state.apricornBox[type]!) throw new Error(`La quantité de Noigrumes HGSS ${quantity} est invalide.`)
        state.apricornBox[type]! -= quantity
        state.kurtApricornType = type
        state.kurtApricornQuantity = quantity
        return
      }
      if (!pendingNumber) throw new Error('Aucune saisie numerique HGSS n’est active.')
      if (value === undefined) {
        state.variables.set(pendingNumber.variableId, 1)
      } else {
        const amount = Math.trunc(value)
        if (amount < 0 || amount > pendingNumber.max) throw new Error(`Le montant HGSS ${amount} est hors limites.`)
        if (pendingNumber.mode === 0) {
          state.money -= amount
          state.bankBalance += amount
        } else {
          state.bankBalance -= amount
          state.money += amount
        }
        state.variables.set(pendingNumber.variableId, 0)
      }
      pendingNumber = undefined
    },
    enterNickname(value: string | undefined): void {
      if (nestedRunner) {
        nestedRunner.enterNickname(value)
        return
      }
      if (!pendingNickname) throw new Error('Aucune saisie de surnom HGSS n’est active.')
      if (pendingNickname.kind === 'friend-group') {
        const duplicate = value !== undefined && state.friendGroups.some((group) => group.groupName === value)
        state.variables.set(pendingNickname.destination, value === undefined || value.trim() === '' ? 1 : duplicate ? 2 : 0)
        if (value !== undefined && value.trim() !== '' && !duplicate) Object.assign(state.friendGroups[0]!, { groupName: value.slice(0, 7), groupNameSource: 'user-text' as const })
      } else if (pendingNickname.kind === 'rival') {
        const name = value?.trim()
        state.variables.set(pendingNickname.destination, name ? 0 : 1)
        if (name) Object.assign(state, { rivalName: name.slice(0, 7), rivalNameSource: 'user-text' as const })
      } else {
        const pokemon = getPokemonPartyMember(state.party, pendingNickname.slot)
        if (!pokemon) throw new Error(`Le Pokémon d’équipe ${pendingNickname.slot} demandé par NicknameInput est absent.`)
        setPokemonNickname(pokemon, value ?? '')
        state.variables.set(pendingNickname.destination, 0)
      }
      pendingNickname = undefined
    },
    finishEggHatch(nickname: string | undefined): void {
      if (nestedRunner) {
        nestedRunner.finishEggHatch(nickname)
        return
      }
      if (pendingEggHatchSlot === undefined) throw new Error("Aucune éclosion HGSS n'est active.")
      const runtime = requirePokemonRuntime(state)
      const result = hatchHgssPartyEgg(state.party, pendingEggHatchSlot, {
        catalog: runtime.catalog,
        pokedex: state.pokedex,
        trainer: runtime.trainer,
        language: runtime.language,
        gameVersion: runtime.gameVersion,
        mapSection: scriptMap.header.mapSection,
        now: runtime.now(),
        nickname,
        togepiEggIdentity: state.togepiEggIdentity,
      })
      state.gameStats.set(hgssEggsHatchedGameStat, Math.min(0xffff_ffff, (state.gameStats.get(hgssEggsHatchedGameStat) ?? 0) + 1))
      state.gameScore = Math.min(99_999_999, state.gameScore + hgssHatchedEggScore)
      if (result.isMrPokemonTogepi) {
        state.flags.add(hgssHatchedTogepiFlag)
        state.phoneCallTriggers.add(hgssElmEggHatchedCallTrigger)
      }
      pendingEggHatchSlot = undefined
    },
    resume(): FieldScriptStep {
      if (safariApps.isAwaitingInput()) throw new Error("Le script HGSS attend encore la fermeture de l'application Safari."); if (photoApps.isAwaitingInput()) throw new Error("Le script HGSS attend encore la fermeture de l'application PhotoAlbum.")
      if (awaitingBattle) throw new Error("Le script HGSS attend encore le résultat du combat.")
      if (awaitingMultiplayer) throw new Error("Le script HGSS attend encore la réponse du service multijoueur.")
      if (awaitingEasyChat) throw new Error("Le script HGSS attend encore la saisie Easy Chat.")
      if (awaitingPcBox) throw new Error("Le script HGSS attend encore la fermeture des Boîtes PC.")
      if (awaitingPokeathlonApp) throw new Error("Le script HGSS attend encore la fermeture de l'application Pokéathlon.")
      if (awaitingFrontierRecordsApp) throw new Error("Le script HGSS attend encore la fermeture des records Frontier."); if (awaitingGameClear) throw new Error("Le script HGSS attend encore la fermeture du Panthéon.")
      if (pendingEggHatchSlot !== undefined) throw new Error("Le script HGSS attend encore la fin de l'éclosion.")
      if (pendingAppRestoreFade) {
        pendingAppRestoreFade = false
        return { kind: 'screenFade', durationFrames: 6, type: 1, color: 0 }
      }
      if (pendingMapPropsRefresh) {
        pendingMapPropsRefresh = false
        return { kind: 'mapProps', props: state.mapProps.map((prop) => ({ ...prop })) }
      }
      if (pendingMovementWait) { pendingMovementWait = false; return { kind: 'waiting', waitFor: 'movement' } }
      if (nestedRunner) {
        const nestedStep = nestedRunner.resume()
        if (nestedStep.kind !== 'ended') return nestedStep
        nestedRunner = undefined
      }
      if (ended) return { kind: 'ended' }
      if (pendingChoice) return { kind: 'choice', options: pendingChoice.options, cancellable: pendingChoice.cancellable }
      if (pendingApricornSelection?.phase === 'type') {
        return {
          kind: 'choice',
          options: [
            ...state.apricornBox.flatMap((quantity, type) => quantity > 0
              ? [{ label: `${scriptMap.externalMessages?.[21]?.[7 + type] ?? `Noigrume ${type}`} ×${quantity}`, value: type }]
              : []),
            { label: 'Retour', value: 0xfffe },
          ],
          cancellable: true,
        }
      }
      if (pendingApricornSelection?.phase === 'quantity') return { kind: 'number', min: 1, max: state.apricornBox[pendingApricornSelection.type]! }
      if (pendingMartSession) return createShopStep()
      if (pendingPokeathlonDataCards) return createShopStep()
      if (pendingAthleteShop) return createShopStep()
      if (pendingMoveDeletion) return createMoveDeletionStep()
      if (pendingStarterChoice) {
        return {
          kind: 'choice',
          options: hgssStarterSpeciesIds.map((_, value) => ({ label: getStarterName(state, value), value })),
          cancellable: false,
          presentation: 'starter',
        }
      }
      if (pendingPartySelection) {
        return {
          kind: 'choice',
          options: [
            ...state.party.members.map((pokemon, value) => ({
              label: `${pokemon.nickname ?? pokemon.speciesName} · Nv.${pokemon.level} · PV ${pokemon.currentHp}/${pokemon.stats.hp}`,
              value,
            })),
            { label: 'Retour', value: 0xfffe },
          ],
          cancellable: true,
          presentation: 'party',
        }
      }
      if (pendingFrontierPartySelection) return createFrontierPartySelectionStep()
      if (pendingNumber) return { kind: 'number', min: 0, max: pendingNumber.max }
      if (pendingNickname) {
        if (pendingNickname.kind === 'friend-group') {
          return { kind: 'nickname', slot: -1, currentName: '', maxLength: 7, cancellable: true, promptMessageId: 5 }
        }
        if (pendingNickname.kind === 'rival') {
          return { kind: 'nickname', slot: -1, currentName: state.rivalName, maxLength: 7, cancellable: false, promptMessageId: 3 }
        }
        const pokemon = getPokemonPartyMember(state.party, pendingNickname.slot)
        if (!pokemon) throw new Error(`Le Pokémon d’équipe ${pendingNickname.slot} demandé par NicknameInput est absent.`)
        return {
          kind: 'nickname', slot: pendingNickname.slot, currentName: pokemon.nickname ?? getSpeciesName(state, pokemon.speciesId), maxLength: 10,
          cancellable: true, promptMessageId: 1, promptValues: [pokemon.nickname ?? getSpeciesName(state, pokemon.speciesId)],
        }
      }
      for (let commandCount = 0; commandCount < 1024; commandCount += 1) {
        requireBytes(bytes, cursor, 2, -1)
        const commandOffset = cursor
        const opcode = view.getUint16(cursor, true)
        cursor += 2

        switch (opcode) {
          case 2:
            ended = true
            return { kind: 'ended' }
          case 21:
            ended = true
            return { kind: 'ended' }
          case 3: {
            requireBytes(bytes, cursor, 4, opcode)
            const frames = view.getUint16(cursor, true)
            const resultVariable = view.getUint16(cursor + 2, true)
            cursor += 4
            state.variables.set(resultVariable, frames)
            return { kind: 'inputWait', accepts: ['confirm', 'cancel'], frames }
          }
          case 17: {
            requireBytes(bytes, cursor, 4, opcode)
            const variableId = view.getUint16(cursor, true)
            const value = view.getUint16(cursor + 2, true)
            cursor += 4
            const variable = readVariable(variableId)
            comparisonResult = variable < value ? -1 : variable > value ? 1 : 0
            break
          }
          case 28: {
            requireBytes(bytes, cursor, 5, opcode)
            const condition = bytes[cursor]
            const relativeOffset = view.getInt32(cursor + 1, true)
            cursor += 5
            const conditionMatches = [
              comparisonResult < 0,
              comparisonResult === 0,
              comparisonResult > 0,
              comparisonResult <= 0,
              comparisonResult >= 0,
              comparisonResult !== 0,
            ][condition]
            if (conditionMatches === undefined) {
              throw new Error(`Condition HGSS ${condition} invalide a l’offset ${commandOffset}.`)
            }
            if (conditionMatches) {
              const target = cursor + relativeOffset
              requireBytes(bytes, target, 2, opcode)
              cursor = target
            }
            break
          }
          case 18: {
            requireBytes(bytes, cursor, 4, opcode)
            const left = readVariable(view.getUint16(cursor, true))
            const right = readVariable(view.getUint16(cursor + 2, true))
            cursor += 4
            comparisonResult = left < right ? -1 : left > right ? 1 : 0
            break
          }
          case 22:
          case 26: {
            requireBytes(bytes, cursor, 4, opcode)
            const relativeOffset = view.getInt32(cursor, true)
            cursor += 4
            if (opcode === 26) returnOffsets.push(cursor)
            const target = cursor + relativeOffset
            requireBytes(bytes, target, 2, opcode)
            cursor = target
            break
          }
          case 27: {
            const target = returnOffsets.pop()
            if (target === undefined) throw new Error(`Return HGSS sans Call a l’offset ${commandOffset}.`)
            cursor = target
            break
          }
          case 143: {
            requireBytes(bytes, cursor, 2, opcode)
            const destination = view.getUint16(cursor, true)
            cursor += 2
            pendingNickname = { kind: 'rival', destination }
            return { kind: 'nickname', slot: -1, currentName: state.rivalName, maxLength: 7, cancellable: false, promptMessageId: 3 }
          }
          case 144: {
            requireBytes(bytes, cursor, 2, opcode)
            const destination = view.getUint16(cursor, true)
            cursor += 2
            state.variables.set(destination, state.gender === 'male' ? 97 : 0)
            break
          }
          case 146: {
            requireBytes(bytes, cursor, 2, opcode)
            const contactValue = view.getUint16(cursor, true)
            const contactId = contactValue >= 0x4000 ? readVariable(contactValue) : contactValue
            cursor += 2
            registerHgssPhoneContact(state.phoneContacts, contactId)
            registerHgssSafariPhoneContact(state, contactId)
            break
          }
          case 147: {
            requireBytes(bytes, cursor, 4, opcode)
            const contactValue = view.getUint16(cursor, true)
            const contactId = contactValue >= 0x4000 ? readVariable(contactValue) : contactValue
            const destination = view.getUint16(cursor + 2, true)
            state.variables.set(destination, isHgssPhoneContactRegistered(state.phoneContacts, contactId) ? 1 : 0)
            cursor += 4
            break
          }
          case 145: {
            // RegisterPokegearCard lit un identifiant sur un octet.
            requireBytes(bytes, cursor, 1, opcode)
            registerHgssPokegearCard(state.pokegearCards, bytes[cursor]!)
            cursor += 1
            break
          }
          case 150:
            // RestoreOverworld est une tâche graphique native. Le monde web
            // est déjà présent ; elle ne doit surtout pas suspendre le script.
            break
          case 149: {
            requireBytes(bytes, cursor, 1, opcode)
            state.phoneCallTriggers.delete(bytes[cursor]!)
            cursor += 1
            break
          }
          case 281: {
            requireBytes(bytes, cursor, 2, opcode)
            const destination = view.getUint16(cursor, true)
            cursor += 2
            state.variables.set(destination, state.gender === 'male' ? 0 : 1)
            break
          }
          case 280: {
            requireBytes(bytes, cursor, 2, opcode)
            const spawnValue = view.getUint16(cursor, true)
            cursor += 2
            state.blackoutSpawn = spawnValue >= 0x4000 ? readVariable(spawnValue) : spawnValue
            break
          }
          case 282:
            healPokemonPartyWithPolicy(state.party, healingPolicy)
            break
          case 219:
            return { kind: 'blackout' }
          case 436:
            // LeaveOverworld prépare l'application de soin DS. Dans le rendu
            // web la scène reste chargée jusqu'au RestoreOverworld suivant.
            break
          case 290: {
            requireBytes(bytes, cursor, 2, opcode)
            const destination = view.getUint16(cursor, true)
            cursor += 2
            state.variables.set(destination, state.pokedex.enabled ? 1 : 0)
            break
          }
          case 291:
            enableHgssPokedex(state.pokedex)
            break
          case 292: {
            requireBytes(bytes, cursor, 2, opcode)
            const destination = view.getUint16(cursor, true)
            cursor += 2
            state.variables.set(destination, state.runningShoes ? 1 : 0)
            break
          }
          case 293:
            state.runningShoes = true
            break
          case 573:
            state.mysteryGiftActive = true
            break
          case 294: {
            requireBytes(bytes, cursor, 4, opcode)
            const badgeValue = view.getUint16(cursor, true)
            const badge = badgeValue >= 0x4000 ? readVariable(badgeValue) : badgeValue
            const destination = view.getUint16(cursor + 2, true)
            cursor += 4
            state.variables.set(destination, state.badges.has(badge) ? 1 : 0)
            break
          }
          case 296:
            requireBytes(bytes, cursor, 2, opcode)
            state.variables.set(view.getUint16(cursor, true), state.badges.size)
            cursor += 2
            break
          case 297:
            requireBytes(bytes, cursor, 2, opcode)
            state.variables.set(view.getUint16(cursor, true), state.flags.has(0x960) ? 1 : 0)
            cursor += 2
            break
          case 298:
            state.flags.add(0x960)
            break
          case 299:
            requireBytes(bytes, cursor, 2, opcode)
            state.variables.set(view.getUint16(cursor, true), state.flags.has(0x961) ? 1 : 0)
            cursor += 2
            break
          case 300:
            state.flags.add(0x961)
            break
          case 301:
            state.flags.delete(0x961)
            break
          case 302:
            requireBytes(bytes, cursor, 2, opcode)
            state.variables.set(view.getUint16(cursor, true), state.flags.has(0x965) ? 1 : 0)
            cursor += 2
            break
          case 303:
            state.flags.add(0x965)
            break
          case 304:
            state.flags.delete(0x965)
            break
          case 305:
            requireBytes(bytes, cursor, 2, opcode)
            state.variables.set(view.getUint16(cursor, true), state.flags.has(0x964) ? 1 : 0)
            cursor += 2
            break
          case 306:
            state.flags.add(0x964)
            break
          case 503: {
            requireBytes(bytes, cursor, 2, opcode)
            const destination = view.getUint16(cursor, true)
            const low = readVariable(0x403c)
            // ScrCmd_LotoIDGet affecte l'u32 à un pointeur u16 : seul le mot bas
            // reste visible par le langage de script.
            state.variables.set(destination, low)
            cursor += 2
            break
          }
          case 504: {
            requireBytes(bytes, cursor, 8, opcode)
            const positionDestination = view.getUint16(cursor, true)
            const digitsDestination = view.getUint16(cursor + 2, true)
            const sourceDestination = view.getUint16(cursor + 4, true)
            const lotoValue = view.getUint16(cursor + 6, true)
            const lotoId = (lotoValue >= 0x4000 ? readVariable(lotoValue) : lotoValue) & 0xffff
            cursor += 8

            const countMatchingDigits = (originalTrainerId: number): number => {
              let lotoDigits = lotoId
              let trainerDigits = originalTrainerId & 0xffff
              let count = 0
              while (count < 5 && lotoDigits % 10 === trainerDigits % 10) {
                count += 1
                lotoDigits = Math.floor(lotoDigits / 10)
                trainerDigits = Math.floor(trainerDigits / 10)
              }
              return count
            }

            let partyDigits = 0
            let partyPosition = 0
            for (let slot = 0; slot < state.party.members.length; slot += 1) {
              const pokemon = state.party.members[slot]!
              if (pokemon.isEgg) continue
              const digits = countMatchingDigits(pokemon.originalTrainer.id)
              if (digits !== 0 && partyDigits < digits) {
                partyDigits = digits
                partyPosition = slot
              }
            }

            let boxDigits = 0
            let boxPosition = 0
            for (let box = 0; box < hgssStorageBoxCount; box += 1) {
              for (let slot = 0; slot < hgssStorageBoxCapacity; slot += 1) {
                const pokemon = state.pokemonStorage.boxes[box]![slot]
                if (!pokemon || pokemon.isEgg) continue
                const digits = countMatchingDigits(pokemon.originalTrainer.id)
                if (digits !== 0 && boxDigits < digits) {
                  boxDigits = digits
                  boxPosition = box * hgssStorageBoxCapacity + slot
                }
              }
            }

            if (partyDigits === 0 && boxDigits === 0) {
              state.variables.set(positionDestination, 0)
              state.variables.set(digitsDestination, 0)
              state.variables.set(sourceDestination, 0)
            } else if (partyDigits >= boxDigits) {
              state.variables.set(positionDestination, partyPosition)
              state.variables.set(digitsDestination, partyDigits)
              state.variables.set(sourceDestination, 0)
            } else {
              state.variables.set(positionDestination, boxPosition)
              state.variables.set(digitsDestination, boxDigits)
              state.variables.set(sourceDestination, 1)
            }
            break
          }
          case 505: {
            const rng = requirePokemonRuntime(state).rng
            rng.nextU16()
            const high = rng.nextU16()
            // La ROM commerciale contient ce bug : les deux moitiés sont écrites
            // dans VAR_LOTO_NUMBER_LO, la seconde écrasant la première.
            state.variables.set(0x403c, high)
            break
          }
          case 307: {
            requireBytes(bytes, cursor, 9, opcode)
            const chunkX = view.getUint16(cursor, true)
            const chunkZ = view.getUint16(cursor + 2, true)
            const xValue = view.getUint16(cursor + 4, true)
            const zValue = view.getUint16(cursor + 6, true)
            const tag = bytes[cursor + 8]
            cursor += 9
            const x = xValue >= 0x4000 ? readVariable(xValue) : xValue
            const z = zValue >= 0x4000 ? readVariable(zValue) : zValue
            return { kind: 'doorAnimation', action: 'setup', tag, worldX: x + 32 * chunkX, worldZ: z + 32 * chunkZ }
          }
          case 308: {
            requireBytes(bytes, cursor, 1, opcode)
            const tag = bytes[cursor]
            cursor += 1
            return mapPropAnimationTags.has(tag) ? { kind: 'mapPropAnimation', action: 'wait', tag } : { kind: 'doorAnimation', action: 'wait', tag }
          }
          case 309: {
            requireBytes(bytes, cursor, 1, opcode)
            const tag = bytes[cursor]
            cursor += 1
            return mapPropAnimationTags.delete(tag) ? { kind: 'mapPropAnimation', action: 'unload', tag } : { kind: 'doorAnimation', action: 'unload', tag }
          }
          case 310:
          case 311: {
            requireBytes(bytes, cursor, 1, opcode)
            const tag = bytes[cursor]
            cursor += 1
            return { kind: 'doorAnimation', action: 'play', tag, animationIndex: opcode === 310 ? 0 : 1 }
          }
          case 314:
          case 315:
          case 316:
          case 317:
          case 318:
          case 319:
          case 320:
          case 321:
          case 322:
          case 323:
          case 324:
          case 325:
          case 326:
          case 327:
          case 328:
          case 329:
          case 330:
          case 331: {
            let gymRng: HgssLcrng | undefined
            const result = runHgssGymmickFieldCommand(opcode, state, bytes, cursor, {
              readVariable,
              nextRandomU16: () => (gymRng ??= requirePokemonRuntime(state).rng).nextU16(),
            })
            cursor = result.cursor
            if (result.step) return result.step
            break
          }
          case 29: {
            requireBytes(bytes, cursor, 5, opcode)
            const condition = bytes[cursor]
            const relativeOffset = view.getInt32(cursor + 1, true)
            cursor += 5
            const matches = [comparisonResult < 0, comparisonResult === 0, comparisonResult > 0, comparisonResult <= 0, comparisonResult >= 0, comparisonResult !== 0][condition]
            if (matches === undefined) throw new Error(`Condition HGSS ${condition} invalide a l’offset ${commandOffset}.`)
            if (matches) {
              returnOffsets.push(cursor)
              cursor += relativeOffset
              requireBytes(bytes, cursor, 2, opcode)
            }
            break
          }
          case 30: {
            requireBytes(bytes, cursor, 2, opcode)
            const flagId = view.getUint16(cursor, true)
            state.flags.add(flagId)
            cursor += 2
            if (flagId === hgssGotStarterFlag) syncFieldScriptFollowerActivity(state, map)
            break
          }
          case 31: {
            requireBytes(bytes, cursor, 2, opcode)
            const flagId = view.getUint16(cursor, true)
            state.flags.delete(flagId)
            cursor += 2
            if (flagId === hgssGotStarterFlag) syncFieldScriptFollowerActivity(state, map)
            break
          }
          case 32:
            requireBytes(bytes, cursor, 2, opcode)
            comparisonResult = state.flags.has(view.getUint16(cursor, true)) ? 0 : -1
            cursor += 2
            break
          case 33:
          case 34: {
            requireBytes(bytes, cursor, 2, opcode)
            const flagId = readVariable(view.getUint16(cursor, true))
            if (opcode === 33) state.flags.add(flagId)
            else state.flags.delete(flagId)
            cursor += 2
            break
          }
          case 35: {
            requireBytes(bytes, cursor, 4, opcode)
            const flagId = readVariable(view.getUint16(cursor, true))
            const destination = view.getUint16(cursor + 2, true)
            state.variables.set(destination, state.flags.has(flagId) ? 1 : 0)
            cursor += 4
            break
          }
          case 36:
          case 37:
          case 38: {
            requireBytes(bytes, cursor, 2, opcode)
            const trainerValue = view.getUint16(cursor, true)
            const trainerId = trainerValue >= 0x4000 ? readVariable(trainerValue) : trainerValue
            cursor += 2
            if (opcode === 36) state.trainerFlags.add(trainerId)
            else if (opcode === 37) state.trainerFlags.delete(trainerId)
            // CheckTrainerFlag stocke directement FALSE (0) ou TRUE (1)
            // dans l'index ternaire natif {inferieur, egal, superieur}. Dans
            // notre representation {-1, 0, 1}, TRUE correspond donc a 0 et
            // FALSE a -1, exactement comme CheckFlag ci-dessus.
            else comparisonResult = state.trainerFlags.has(trainerId) ? 0 : -1
            break
          }
          case 39: {
            requireBytes(bytes, cursor, 4, opcode)
            const variableId = view.getUint16(cursor, true)
            const operand = view.getUint16(cursor + 2, true)
            writeHgssSafariScriptVariable(state, variableId, (readVariable(variableId) + (operand >= 0x4000 ? readVariable(operand) : operand)) & 0xffff)
            cursor += 4
            break
          }
          case 40: {
            requireBytes(bytes, cursor, 4, opcode)
            const variableId = view.getUint16(cursor, true)
            const operand = view.getUint16(cursor + 2, true)
            writeHgssSafariScriptVariable(state, variableId, (readVariable(variableId) - (operand >= 0x4000 ? readVariable(operand) : operand)) & 0xffff)
            cursor += 4
            break
          }
          case 41: {
            requireBytes(bytes, cursor, 4, opcode)
            const variableId = view.getUint16(cursor, true)
            const value = view.getUint16(cursor + 2, true)
            writeHgssSafariScriptVariable(state, variableId, value)
            cursor += 4
            break
          }
          case 42:
          case 43: {
            requireBytes(bytes, cursor, 4, opcode)
            const destination = view.getUint16(cursor, true)
            const source = view.getUint16(cursor + 2, true)
            writeHgssSafariScriptVariable(state, destination, opcode === 42 || source >= 0x4000 ? readVariable(source) : source)
            cursor += 4
            break
          }
          case 44:
          case 45: {
            requireBytes(bytes, cursor, 1, opcode)
            const messageId = bytes[cursor]
            cursor += 1
            const text = scriptMap.messages[messageId]
            if (text === undefined) {
              throw new Error(`Le message ${messageId} est absent de la banque ${map.header.msgBank}.`)
            }
            return opcode === 44
              ? { kind: 'message', messageId, text }
              : { kind: 'message', messageId, text, speakerObjectId }
          }
          case 46:
          case 47: {
            requireBytes(bytes, cursor, 2, opcode)
            const messageId = readVariable(view.getUint16(cursor, true)) & 0xff
            cursor += 2
            const text = scriptMap.messages[messageId]
            if (text === undefined) throw new Error(`Le message variable ${messageId} est absent de la banque ${map.header.msgBank}.`)
            return { kind: 'message', messageId, text, speakerObjectId }
          }
          case 55: {
            // DirectionSignpost: message (u8), signpost type (u8), map (u16), result (u16).
            requireBytes(bytes, cursor, 6, opcode)
            const messageId = bytes[cursor]
            cursor += 6
            const text = scriptMap.messages[messageId]
            if (text === undefined) throw new Error(`Le message de panneau ${messageId} est absent de la banque ${map.header.msgBank}.`)
            return { kind: 'message', messageId, text }
          }
          case 56:
            // SetSignpostMap: signpost type (u8), map section (u16).
            requireBytes(bytes, cursor, 3, opcode)
            cursor += 3
            break
          case 57:
            requireBytes(bytes, cursor, 1, opcode)
            cursor += 1
            break
          case 58:
            break
          case 59: {
            requireBytes(bytes, cursor, 3, opcode)
            const messageId = bytes[cursor]
            cursor += 3
            const text = scriptMap.messages[messageId]
            if (text === undefined) throw new Error(`Le message de conseil ${messageId} est absent de la banque ${map.header.msgBank}.`)
            return { kind: 'message', messageId, text }
          }
          case 60:
            requireBytes(bytes, cursor, 2, opcode)
            cursor += 2
            break
          case 49:
            return { kind: 'inputWait', accepts: ['confirm', 'cancel'] }
          case 50:
          case 51:
            return { kind: 'inputWait', accepts: ['confirm', 'cancel', 'direction'] }
          case 52:
            return { kind: 'dialogue', action: 'open' }
          case 53:
            return { kind: 'dialogue', action: 'close' }
          case 54:
            return { kind: 'dialogue', action: 'hold' }
          case 151:
            // Tâche native de restauration du menu contextuel après fermeture
            // de l'écran tactile. Sur l'écran unique, elle resynchronise les
            // boutons réellement déverrouillés sans ouvrir un second menu.
            return { kind: 'objectEffect', action: 'configure', objectIds: [], parameters: [151] }
          case 166: {
            requireBytes(bytes, cursor, 2, opcode)
            const destination = view.getUint16(cursor, true)
            cursor += 2
            // sub_02078B78 attend une opération de communication locale DS.
            // Hors session serveur, le protocole répond proprement « annulé ».
            state.variables.set(destination, 0)
            break
          }
          case 284:
            // sub_02058190 est la restauration terrain aussi appelée après un
            // combat. Elle doit notamment reconstruire le follower.
            if (state.followMonActive) return { kind: 'followerMovement', action: 'refresh' }
            break
          case 283:
            // Ferme le club de communication apres une erreur, une annulation
            // ou l'echange. La passerelle n'entretient aucun overlay DS local.
            break
          case 254: {
            requireBytes(bytes, cursor, 2, opcode)
            state.variables.set(view.getUint16(cursor, true), 1)
            cursor += 2
            return { kind: 'save' }
          }
          case 63:
          case 748: {
            requireBytes(bytes, cursor, 2, opcode)
            const variableId = view.getUint16(cursor, true)
            cursor += 2
            pendingChoice = {
              variableId,
              options: [{ label: 'Oui', value: 0 }, { label: 'Non', value: 1 }],
              cancellable: false,
            }
            return { kind: 'choice', options: pendingChoice.options, cancellable: false }
          }
          case 96:
          case 97:
          case 609:
          case 746:
          case 747:
          case 796:
            break
          case 409:
            // FrontierFieldSystem_0204A810 exige un pointeur nul avant une
            // nouvelle inscription. Une session web abandonnée est donc
            // libérée au même point de cycle que dans le field system natif.
            state.frontierSession = undefined
            break
          case 410: {
            requireBytes(bytes, cursor, 4, opcode)
            const resumeFromPrevious = view.getUint16(cursor, true) !== 0
            const requestedMode = view.getUint16(cursor + 2, true)
            cursor += 4
            const towerMode = resumeFromPrevious
              ? (state.frontierSession?.towerMode ?? 0)
              : requestedMode
            const requiredCount = [3, 4, 2, 2, 3, 3, 2][towerMode] ?? 0
            state.frontierSession = {
              towerMode,
              requiredCount,
              partySlots: resumeFromPrevious ? [...(state.frontierSession?.partySlots ?? [])] : [],
              resumed: resumeFromPrevious,
              multiBattleAllyId: resumeFromPrevious ? (state.frontierSession?.multiBattleAllyId ?? 0) : 0,
              statTrainerMons: resumeFromPrevious
                ? state.frontierSession?.statTrainerMons.map((team) => team.map((pokemon) => ({ ...pokemon }))) ?? []
                : [],
            }
            break
          }
          case 411:
            state.frontierSession = undefined
            break
          case 414: {
            requireBytes(bytes, cursor, 2, opcode)
            const resultVariable = view.getUint16(cursor, true)
            cursor += 2
            const wins = state.frontierRecords.get(0) ?? 0
            const milestone = ([20, 50, 100] as const).find((candidate) => (
              wins >= candidate && !state.frontierMilestoneRewards.has(candidate)
            ))
            if (milestone !== undefined) state.frontierMilestoneRewards.add(milestone)
            state.variables.set(resultVariable, milestone === 20 ? 1 : milestone === 50 ? 2 : milestone === 100 ? 3 : 0)
            break
          }
          case 419: {
            requireBytes(bytes, cursor, 2, opcode)
            // sub_0202D7B8 lit le bit de présence du bloc de Dresseur Wi-Fi.
            // Aucun bloc distant n'existe avant la future synchronisation serveur.
            state.variables.set(view.getUint16(cursor, true), 0)
            cursor += 2
            break
          }
          case 412: {
            requireBytes(bytes, cursor, 6, opcode)
            const command = view.getUint16(cursor, true)
            const argument = readScriptValue(cursor + 2)
            const resultVariable = view.getUint16(cursor + 4, true)
            cursor += 6
            if (command === 1) {
              state.variables.set(
                resultVariable,
                isHgssPartyValidForBattleFrontier(
                  state.party,
                  argument === 0 ? (state.frontierSession?.requiredCount ?? 0) : argument,
                ) ? 1 : 0,
              )
            } else if (command === 3) {
              state.frontierRecords.clear()
              state.frontierChallengeState = 0
            } else if (command === 4) {
              // Le roster téléchargé de la Tour Wi-Fi n'existe qu'après une
              // synchronisation serveur réussie.
              state.variables.set(resultVariable, 0)
            } else if (command === 6) {
              state.flags.delete(0x966)
            } else if (command === 11) {
              state.frontierChallengeState = argument === 0 ? 2 : 1
            } else if (command === 12) {
              state.variables.set(resultVariable, state.frontierChallengeState)
            } else if (command === 14) {
              const towerMode = state.frontierSession?.towerMode ?? 0
              state.variables.set(resultVariable, towerMode)
              if (towerMode === 6) state.frontierRecords.set(100, 0)
              else state.frontierRecords.set(towerMode * 2 + 1, 0)
            } else if (command === 15) {
              // sub_0204A800 lit le bloc Frontier Wi-Fi, absent tant que le
              // futur serveur n'a injecté aucune session distante.
              state.variables.set(resultVariable, 0)
            } else if (command === 43) {
              state.variables.set(resultVariable, state.frontierSession?.towerMode ?? 0)
            } else if (command === 50) {
              state.frontierSession ??= {
                towerMode: 0, requiredCount: 3, partySlots: [], resumed: false,
                multiBattleAllyId: 0, statTrainerMons: [],
              }
              state.frontierSession.multiBattleAllyId = argument
            } else if (command === 51) {
              state.variables.set(resultVariable, state.frontierSession?.multiBattleAllyId ?? 0)
            } else if (command === 53) {
              state.variables.set(resultVariable, state.frontierSession?.partySlots[argument] ?? 0xff)
            } else if (command === 56) {
              const session = state.frontierSession ??= {
                towerMode: 0, requiredCount: 3, partySlots: [], resumed: false,
                multiBattleAllyId: 0, statTrainerMons: [],
              }
              const trainers = requirePokemonRuntime(state).trainerCatalog ?? []
              session.statTrainerMons = Array.from({ length: 5 }, (_, index) => {
                const party = trainers[300 + index]?.party ?? []
                return Array.from({ length: Math.max(2, session.requiredCount) }, (_, monIndex) => {
                  const pokemon = party[monIndex % Math.max(1, party.length)]
                  return { speciesId: pokemon?.speciesId ?? 0, firstMoveId: pokemon?.moveIds?.[0] ?? 0 }
                })
              })
            } else if (command === 100) {
              state.variables.set(resultVariable, state.frontierSession ? 0 : 1)
            } else {
              throw new Error(`Opcode HGSS 412 sous-commande ${command} non pris en charge a l’offset ${commandOffset}.`)
            }
            break
          }
          case 413: {
            requireBytes(bytes, cursor, 8, opcode)
            const allyIndex = readScriptValue(cursor)
            const monIndex = readScriptValue(cursor + 2)
            const speciesDestination = view.getUint16(cursor + 4, true)
            const moveDestination = view.getUint16(cursor + 6, true)
            cursor += 8
            const pokemon = state.frontierSession?.statTrainerMons[allyIndex]?.[monIndex]
            state.variables.set(speciesDestination, pokemon?.speciesId ?? 0)
            state.variables.set(moveDestination, pokemon?.firstMoveId ?? 0)
            break
          }
          case 415: {
            requireBytes(bytes, cursor, 2, opcode)
            const wins = state.frontierRecords.get(0) ?? 0
            const pending = wins < 20 ? 0
              : !state.frontierMilestoneRewards.has(20) ? 1
                : wins < 50 ? 0
                  : !state.frontierMilestoneRewards.has(50) ? 2
                    : wins >= 100 && !state.frontierMilestoneRewards.has(100) ? 3 : 0
            state.variables.set(view.getUint16(cursor, true), pending)
            cursor += 2
            break
          }
          case 420: {
            requireBytes(bytes, cursor, 2, opcode)
            const statId = view.getUint16(cursor, true)
            cursor += 2
            state.gameStats.set(statId, Math.min(0xffff_ffff, (state.gameStats.get(statId) ?? 0) + 1))
            break
          }
          case 421: {
            requireBytes(bytes, cursor, 6, opcode)
            const statId = view.getUint16(cursor, true)
            const highDestination = view.getUint16(cursor + 2, true)
            const lowDestination = view.getUint16(cursor + 4, true)
            cursor += 6
            const value = state.gameStats.get(statId) ?? 0
            state.variables.set(highDestination, (value >>> 16) & 0xffff)
            state.variables.set(lowDestination, value & 0xffff)
            break
          }
          case 422: {
            requireBytes(bytes, cursor, 7, opcode)
            const statId = view.getUint16(cursor, true)
            const value = ((view.getUint16(cursor + 2, true) << 16) | view.getUint16(cursor + 4, true)) >>> 0
            const action = bytes[cursor + 6]!
            cursor += 7
            const current = state.gameStats.get(statId) ?? 0
            if (action === 0) state.gameStats.set(statId, Math.min(0xffff_ffff, current + value))
            else if (action === 1) state.gameStats.set(statId, value)
            else if (action === 2) state.gameStats.set(statId, Math.max(current, value))
            else throw new Error(`Action GameStats HGSS ${action} invalide.`)
            break
          }
          case 444: {
            requireBytes(bytes, cursor, 6, opcode)
            const baseMessageId = bytes[cursor]!
            const requiredCount = readScriptValue(cursor + 1)
            cursor += 6
            state.buffers.set(0, String(requiredCount))
            const seenBannedSpecies = hgssBattleFrontierBannedSpeciesIds.filter((speciesId) => (
              state.pokedex.seenSpeciesIds.has(speciesId)
            ))
            seenBannedSpecies.forEach((speciesId, index) => state.buffers.set(index + 1, getSpeciesName(state, speciesId)))
            const messageId = baseMessageId + seenBannedSpecies.length
            const text = scriptMap.messages[messageId]
            if (text === undefined) throw new Error(`Le message Frontier ${messageId} est absent de la banque ${scriptMap.header.msgBank}.`)
            return { kind: 'message', messageId, text }
          }
          case 98:
          case 99:
            requireBytes(bytes, cursor, 2, opcode)
            cursor += 2
            break
          case 125:
          case 127: {
            requireBytes(bytes, cursor, 6, opcode)
            const itemValue = view.getUint16(cursor, true)
            const quantityValue = view.getUint16(cursor + 2, true)
            const destination = view.getUint16(cursor + 4, true)
            const item = itemValue >= 0x4000 ? readVariable(itemValue) : itemValue
            const quantity = quantityValue >= 0x4000 ? readVariable(quantityValue) : quantityValue
            const itemCatalog = getItemCatalog(state)
            const canStore = opcode === 125
              ? addBagItem(state.inventory, itemCatalog, item, quantity)
              : canAddBagItem(state.inventory, itemCatalog, item, quantity)
            state.variables.set(destination, canStore ? 1 : 0)
            cursor += 6
            break
          }
          case 126: {
            requireBytes(bytes, cursor, 6, opcode)
            const itemValue = view.getUint16(cursor, true)
            const quantityValue = view.getUint16(cursor + 2, true)
            const destination = view.getUint16(cursor + 4, true)
            const item = itemValue >= 0x4000 ? readVariable(itemValue) : itemValue
            const quantity = quantityValue >= 0x4000 ? readVariable(quantityValue) : quantityValue
            getItem(state, item)
            const removed = takeBagItem(state.inventory, item, quantity)
            state.variables.set(destination, removed ? 1 : 0)
            cursor += 6
            break
          }
          case 129: {
            requireBytes(bytes, cursor, 4, opcode)
            const itemValue = view.getUint16(cursor, true)
            const item = itemValue >= 0x4000 ? readVariable(itemValue) : itemValue
            const destination = view.getUint16(cursor + 2, true)
            state.variables.set(destination, getItem(state, item).fieldPocket === 3 ? 1 : 0)
            cursor += 4
            break
          }
          case 130: {
            requireBytes(bytes, cursor, 4, opcode)
            const itemValue = view.getUint16(cursor, true)
            const itemId = itemValue >= 0x4000 ? readVariable(itemValue) : itemValue
            const destination = view.getUint16(cursor + 2, true)
            state.variables.set(destination, getItem(state, itemId).fieldPocket)
            cursor += 4
            break
          }
          case 669: {
            requireBytes(bytes, cursor, 4, opcode)
            const itemValue = view.getUint16(cursor, true)
            const itemId = itemValue >= 0x4000 ? readVariable(itemValue) : itemValue
            const destination = view.getUint16(cursor + 2, true)
            getItem(state, itemId)
            state.variables.set(destination, getBagItemQuantity(state.inventory, itemId))
            cursor += 4
            break
          }
          case 470: {
            requireBytes(bytes, cursor, 1, opcode)
            const tradeId = bytes[cursor]!
            cursor += 1
            if (!requirePokemonRuntime(state).npcTradeCatalog?.[tradeId]) {
              throw new Error(`L'échange interne ROM ${tradeId} demandé par LoadNPCTrade est absent.`)
            }
            activeNpcTradeId = tradeId
            break
          }
          case 471:
          case 472: {
            requireBytes(bytes, cursor, 2, opcode)
            if (activeNpcTradeId === undefined) throw new Error(`Opcode HGSS ${opcode} exécuté sans LoadNPCTrade.`)
            const trade = requirePokemonRuntime(state).npcTradeCatalog?.[activeNpcTradeId]
            if (!trade) throw new Error(`L'échange interne ROM ${activeNpcTradeId} actif est absent.`)
            state.variables.set(
              view.getUint16(cursor, true),
              opcode === 471 ? trade.givenSpeciesId : trade.requestedSpeciesId,
            )
            cursor += 2
            break
          }
          case 473: {
            requireBytes(bytes, cursor, 2, opcode)
            if (activeNpcTradeId === undefined) throw new Error('NPCTradeExec HGSS exécuté sans LoadNPCTrade.')
            const slot = readScriptValue(cursor)
            cursor += 2
            const offeredPokemon = state.party.members[slot]
            if (!offeredPokemon) throw new Error(`Le slot ${slot} demandé par NPCTradeExec HGSS est absent.`)
            const runtime = requirePokemonRuntime(state)
            const trade = runtime.npcTradeCatalog?.[activeNpcTradeId]
            if (!trade) throw new Error(`L'échange interne ROM ${activeNpcTradeId} actif est absent.`)
            const now = runtime.now()
            const receivedPokemon = createCanonicalPokemon(runtime.catalog, {
              speciesId: trade.givenSpeciesId,
              level: offeredPokemon.level,
              heldItemId: trade.heldItemId,
              rng: runtime.rng,
              personality: { kind: 'fixed', value: trade.personality },
              // _CreateTradeMon appelle CreateMon avant d'écraser les six IV.
              individualValues: { kind: 'random' },
              originalTrainer: {
                id: trade.originalTrainerId,
                name: trade.originalTrainerName,
                gender: trade.originalTrainerGender, nameSource: 'local-ref', localTradeId: activeNpcTradeId,
              },
              origin: {
                language: trade.language,
                gameVersion: runtime.gameVersion,
                metLocation: scriptMap.header.mapSection,
                metLevel: offeredPokemon.level,
                metTerrain: 0,
                metDate: { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() },
              },
              ballId: 4,
            })
            Object.assign(receivedPokemon, { nickname: trade.nickname, nicknameSource: 'local-ref' as const, nicknameLocalRef: activeNpcTradeId + 1 })
            receivedPokemon.individualValues = { ...trade.individualValues }
            receivedPokemon.stats = calculatePokemonStats(
              runtime.catalog.personalData[trade.givenSpeciesId]!,
              receivedPokemon.level,
              receivedPokemon.individualValues,
              receivedPokemon.effortValues,
              receivedPokemon.nature,
            )
            receivedPokemon.currentHp = receivedPokemon.stats.hp
            if (receivedPokemon.shiny) throw new Error(`Le Pokémon de l'échange ROM ${activeNpcTradeId} est chromatique contrairement à l'assertion native.`)
            replaceScriptedPokemonInParty(state.party, slot, receivedPokemon, teamPolicy)
            markPokemonCaught(state.pokedex, receivedPokemon, receivedPokemon.origin.language)
            return {
              kind: 'objectEffect',
              action: 'configure',
              objectIds: [],
              parameters: [473, activeNpcTradeId, slot, offeredPokemon.speciesId, receivedPokemon.speciesId],
            }
          }
          case 474:
            if (activeNpcTradeId === undefined) throw new Error('NPCTradeEnd HGSS exécuté sans LoadNPCTrade.')
            activeNpcTradeId = undefined
            break
          case 671: {
            const pokemon = state.party.members[0]
            if (!pokemon) throw new Error("SetFavoriteMon HGSS requiert le premier Pokémon de l'équipe.")
            state.favoritePokemon = {
              speciesId: pokemon.speciesId,
              form: pokemon.form,
              isEgg: pokemon.isEgg,
            }
            break
          }
          case 672: {
            requireBytes(bytes, cursor, 6, opcode)
            state.variables.set(view.getUint16(cursor, true), state.favoritePokemon.speciesId)
            state.variables.set(view.getUint16(cursor + 2, true), state.favoritePokemon.form)
            state.variables.set(view.getUint16(cursor + 4, true), state.favoritePokemon.isEgg ? 1 : 0)
            cursor += 6
            break
          }
          case 673: {
            requireBytes(bytes, cursor, 10, opcode)
            const ownedForms = new Set(allOwnedPokemon(state)
              .filter((pokemon) => pokemon.speciesId === 479 && !pokemon.isEgg && pokemon.form >= 1 && pokemon.form <= 5)
              .map((pokemon) => pokemon.form))
            for (let form = 1; form <= 5; form += 1) {
              state.variables.set(view.getUint16(cursor + (form - 1) * 2, true), ownedForms.has(form) ? 1 : 0)
            }
            cursor += 10
            break
          }
          case 674: {
            requireBytes(bytes, cursor, 4, opcode)
            const countDestination = view.getUint16(cursor, true)
            const firstIndexDestination = view.getUint16(cursor + 2, true)
            cursor += 4
            const indexes = state.party.members
              .map((pokemon, index) => ({ pokemon, index }))
              .filter(({ pokemon }) => pokemon.speciesId === 479 && pokemon.form !== 0 && !pokemon.isEgg)
              .map(({ index }) => index)
            state.variables.set(countDestination, indexes.length)
            state.variables.set(firstIndexDestination, indexes[0] ?? 255)
            break
          }
          case 675: {
            requireBytes(bytes, cursor, 8, opcode)
            const slot = readScriptValue(cursor)
            const defaultMoveSlot = readScriptValue(cursor + 2)
            const form = readScriptValue(cursor + 6)
            cursor += 8
            if (form < 0 || form > 5) throw new Error(`Forme Motisma HGSS ${form} invalide.`)
            const pokemon = getPokemonPartyMember(state.party, slot)
            if (!pokemon || pokemon.speciesId !== 479 || pokemon.isEgg) throw new Error(`Le slot ${slot} ne contient aucun Motisma transformable.`)
            const formMoves = [0, 315, 56, 59, 403, 437] as const
            const allFormMoves = new Set(formMoves.slice(1))
            let replacementMoveId = formMoves[form]!
            const rewritten = pokemon.moves.flatMap((move) => {
              if (!allFormMoves.has(move.moveId as typeof formMoves[number])) return [move]
              if (replacementMoveId === 0) return []
              const data = requirePokemonRuntime(state).catalog.moves[replacementMoveId]
              if (!data) throw new Error(`La capacité de forme Motisma ${replacementMoveId} est absente de la ROM.`)
              const replacement = { moveId: replacementMoveId, pp: data.pp, maxPp: data.pp, ppUps: 0, data }
              replacementMoveId = 0
              return [replacement]
            })
            if (replacementMoveId !== 0) {
              const data = requirePokemonRuntime(state).catalog.moves[replacementMoveId]
              if (!data) throw new Error(`La capacité de forme Motisma ${replacementMoveId} est absente de la ROM.`)
              const move = { moveId: replacementMoveId, pp: data.pp, maxPp: data.pp, ppUps: 0, data }
              if (rewritten.length < 4) rewritten.push(move)
              else rewritten[Math.min(3, Math.max(0, defaultMoveSlot))] = move
            }
            if (rewritten.length === 0) {
              const data = requirePokemonRuntime(state).catalog.moves[84]
              if (!data) throw new Error("Éclair est absent du catalogue de capacités ROM.")
              rewritten.push({ moveId: 84, pp: data.pp, maxPp: data.pp, ppUps: 0, data })
            }
            pokemon.moves = rewritten
            pokemon.form = form
            const personalData = resolvePokemonPersonalData(requirePokemonRuntime(state).catalog, 479, form)
            const oldMaxHp = pokemon.stats.hp
            pokemon.stats = calculatePokemonStats(personalData, pokemon.level, pokemon.individualValues, pokemon.effortValues, pokemon.nature)
            pokemon.currentHp = pokemon.currentHp === 0 ? 0 : Math.min(pokemon.stats.hp, pokemon.currentHp + pokemon.stats.hp - oldMaxHp)
            pokemon.abilityId = getAbilityFromPersonality(personalData, pokemon.personality)
            markPokemonCaught(state.pokedex, pokemon, pokemon.origin.language)
            break
          }
          case 131: {
            requireBytes(bytes, cursor, 2, opcode)
            const choiceValue = view.getUint16(cursor, true)
            const choice = choiceValue >= 0x4000 ? readVariable(choiceValue) : choiceValue
            const normalizedChoice = choice === state.starterStorySpeciesId
              ? state.starterChoice
              : normalizeStarterChoice(choice)
            if (normalizedChoice === undefined) throw new Error(`Starter HGSS ${choice} invalide.`)
            if (state.starterChoice !== normalizedChoice) state.starterStorySpeciesId = undefined
            state.starterChoice = normalizedChoice
            cursor += 2
            break
          }
          case 100:
          case 101: {
            requireBytes(bytes, cursor, 2, opcode)
            const objectValue = view.getUint16(cursor, true)
            const objectId = objectValue >= 0x4000 ? readVariable(objectValue) : objectValue
            cursor += 2
            if (opcode === 100) {
              state.hiddenObjectIds.delete(objectId)
              state.invisibleObjectIds.delete(objectId)
            } else {
              // MapObject_Delete pose le flag de l'ObjectEvent avant de le
              // retirer. Sans cette écriture persistante, les objets-balles
              // revenaient au rechargement et les quêtes qui testent leur
              // disparition (dont CS07 dans la Route de Glace) restaient à 0.
              const eventFlag = map.events?.objects.find((object) => object.id === objectId)?.eventFlag
              if (eventFlag) state.flags.add(eventFlag)
              state.hiddenObjectIds.add(objectId)
              state.invisibleObjectIds.delete(objectId)
            }
            return { kind: 'objectVisibility', objectId, visible: opcode === 100 }
          }
          case 104:
            if (actorId !== undefined) {
              faceFieldScriptObjectAtPlayer(state, actorId)
              speakerObjectId = actorId
            }
            return { kind: 'facePlayer', objectId: actorId }
          case 102: {
            requireBytes(bytes, cursor, 4, opcode)
            const xValue = view.getUint16(cursor, true)
            const zValue = view.getUint16(cursor + 2, true)
            const x = xValue >= 0x4000 ? readVariable(xValue) : xValue
            const z = zValue >= 0x4000 ? readVariable(zValue) : zValue
            cursor += 4
            return { kind: 'cameraTarget', target: 'position', x, z }
          }
          case 103:
            return { kind: 'cameraTarget', target: 'player' }
          case 95:
            return { kind: 'waiting', waitFor: 'movement' }
          case 20: {
            requireBytes(bytes, cursor, 2, opcode)
            const standardScript = view.getUint16(cursor, true)
            cursor += 2
            const standardBank = findStandardScriptBank(map, standardScript)
            if (!standardBank) {
              throw new Error(`La banque standard ROM du script HGSS ${standardScript} est absente a l’offset ${commandOffset}.`)
            }
            if (!hasFieldScript(map, standardScript)) {
              throw new Error(`Le script standard HGSS ${standardScript} est absent de la banque ROM ${standardBank.bank}.`)
            }
            nestedRunner = createFieldScriptRunner(map, standardScript, state, actorId, healingPolicy, teamPolicy, initialTeamResolver, levelPolicy, battleFormatResolver, readFollowerMapObjectSignal)
            const nestedStep = nestedRunner.resume()
            if (nestedStep.kind !== 'ended') return nestedStep
            nestedRunner = undefined
            break
          }
          case 73:
          case 74:
          case 75: {
            requireBytes(bytes, cursor, 2, opcode)
            const sequenceValue = view.getUint16(cursor, true)
            const sequenceId = sequenceValue >= 0x4000 ? readVariable(sequenceValue) : sequenceValue
            cursor += 2
            const action = opcode === 73 ? 'play' : opcode === 74 ? 'stop' : 'wait'
            return { kind: 'soundEffect', action, sequenceId }
          }
          case 76: {
            requireBytes(bytes, cursor, 4, opcode)
            const speciesValue = view.getUint16(cursor, true)
            const patternValue = view.getUint16(cursor + 2, true)
            const speciesId = speciesValue >= 0x4000 ? readVariable(speciesValue) : speciesValue
            const pattern = patternValue >= 0x4000 ? readVariable(patternValue) : patternValue
            cursor += 4
            getSpeciesName(state, speciesId)
            return { kind: 'cry', action: 'play', speciesId, pattern }
          }
          case 77:
            return { kind: 'cry', action: 'wait' }
          case 80:
          case 87:
          case 81: {
            requireBytes(bytes, cursor, 2, opcode)
            const sequenceId = view.getUint16(cursor, true)
            cursor += 2
            return { kind: 'music', action: opcode === 81 ? 'stop' : 'play', sequenceId }
          }
          case 82:
            return { kind: 'music', action: 'reset' }
          case 84: {
            requireBytes(bytes, cursor, 4, opcode)
            const targetVolume = view.getUint16(cursor, true)
            const frames = view.getUint16(cursor + 2, true)
            cursor += 4
            return { kind: 'music', action: 'fadeOut', targetVolume, frames }
          }
          case 85: {
            requireBytes(bytes, cursor, 2, opcode)
            const frames = view.getUint16(cursor, true)
            cursor += 2
            return { kind: 'music', action: 'fadeIn', frames }
          }
          case 78: {
            requireBytes(bytes, cursor, 2, opcode)
            const sequenceValue = view.getUint16(cursor, true)
            const sequenceId = sequenceValue >= 0x4000 ? readVariable(sequenceValue) : sequenceValue
            cursor += 2
            return { kind: 'fanfare', action: 'play', sequenceId }
          }
          case 79:
            return { kind: 'fanfare', action: 'wait' }
          case 94: {
            requireBytes(bytes, cursor, 6, opcode)
            const objectId = view.getUint16(cursor, true)
            const relativeOffset = view.getInt32(cursor + 2, true)
            cursor += 6
            const movementOffset = cursor + relativeOffset
            requireBytes(bytes, movementOffset, 2, opcode)
            const actions = decodeFieldMovement(bytes, movementOffset)
            applyFieldScriptMovementState(state, objectId, actions)
            // 255 est le joueur et 253 le Pokémon suiveur. Ils ne remplacent
            // pas le dernier PNJ parlant dans une cinématique à plusieurs.
            if (objectId !== 255 && objectId !== 253) speakerObjectId = objectId
            return { kind: 'movement', objectId, actions }
          }
          case 332: {
            requireBytes(bytes, cursor, 2, opcode)
            const variableId = view.getUint16(cursor, true)
            cursor += 2
            state.variables.set(variableId, state.party.members.length & 0xffff)
            break
          }
          case 349:
          case 350:
          case 566: {
            const options = state.party.members.map((pokemon, slot) => ({
              label: pokemon.nickname ?? getSpeciesName(state, pokemon.speciesId),
              value: slot,
            }))
            if (options.length === 0) options.push({ label: 'Annuler', value: 0xfffe })
            pendingChoice = { variableId: 0xfffd, options, cancellable: true }
            return { kind: 'choice', options, cancellable: true }
          }
          case 351: {
            requireBytes(bytes, cursor, 2, opcode)
            const selection = readVariable(0xfffd)
            state.variables.delete(0xfffd)
            state.variables.set(view.getUint16(cursor, true), selection === 0xfffe ? 0xff : selection)
            cursor += 2
            break
          }
          case 358: {
            requireBytes(bytes, cursor, 2, opcode)
            const alivePartyCount = state.party.members.filter((pokemon) => !pokemon.isEgg && pokemon.currentHp > 0).length
            const storedPokemonCount = state.pokemonStorage.boxes.reduce((count, box) => count + box.filter(Boolean).length, 0)
            state.variables.set(view.getUint16(cursor, true), alivePartyCount + storedPokemonCount)
            cursor += 2
            break
          }
          case 354: {
            requireBytes(bytes, cursor, 4, opcode)
            const slotValue = view.getUint16(cursor, true)
            const slot = slotValue >= 0x4000 ? readVariable(slotValue) : slotValue
            const destination = view.getUint16(cursor + 2, true)
            const pokemon = getPokemonPartyMember(state.party, slot)
            state.variables.set(destination, pokemon && !pokemon.isEgg ? pokemon.speciesId : 0)
            cursor += 4
            break
          }
          case 355: {
            requireBytes(bytes, cursor, 4, opcode)
            const slot = readScriptValue(cursor)
            const destination = view.getUint16(cursor + 2, true)
            const pokemon = getPokemonPartyMember(state.party, slot)
            if (!pokemon) throw new Error(`Le slot ${slot} demandé par PartyMonIsMine HGSS est absent.`)
            const playerTrainerId = requirePokemonRuntime(state).trainer.id & 0xffff
            state.variables.set(destination, (pokemon.originalTrainer.id & 0xffff) === playerTrainerId ? 0 : 1)
            cursor += 4
            break
          }
          case 438: {
            requireBytes(bytes, cursor, 4, opcode)
            const categoryValue = view.getUint16(cursor, true)
            const category = categoryValue >= 0x4000 ? readVariable(categoryValue) : categoryValue
            const destination = view.getUint16(cursor + 2, true)
            const messageIds = [752, 211, 30, 435]
            state.variables.set(destination, messageIds[category] ?? 0)
            cursor += 4
            break
          }
          case 439:
          case 440: {
            requireBytes(bytes, cursor, 4, opcode)
            const bankValue = view.getUint16(cursor, true)
            const messageValue = view.getUint16(cursor + 2, true)
            const bankId = bankValue >= 0x4000 ? readVariable(bankValue) : bankValue
            const messageId = messageValue >= 0x4000 ? readVariable(messageValue) : messageValue
            cursor += 4
            const text = map.externalMessages?.[bankId]?.[messageId]
            if (text === undefined) throw new Error(`Le message externe ${messageId} de la banque ${bankId} est absent.`)
            return { kind: 'message', messageId, text }
          }
          case 338: {
            requireBytes(bytes, cursor, 6, opcode)
            const objectValue = view.getUint16(cursor, true)
            const objectId = objectValue >= 0x4000 ? readVariable(objectValue) : objectValue
            const x = view.getUint16(cursor + 2, true)
            const z = view.getUint16(cursor + 4, true)
            cursor += 6
            setFieldScriptObjectState(state, objectId, { x, z })
            return { kind: 'objectState', objectId, x, z }
          }
          case 339: {
            requireBytes(bytes, cursor, 10, opcode)
            const objectValue = view.getUint16(cursor, true)
            const objectId = objectValue >= 0x4000 ? readVariable(objectValue) : objectValue
            const x = view.getUint16(cursor + 2, true)
            const z = view.getUint16(cursor + 6, true)
            const direction = decodeHgssPlayerDirection(view.getUint16(cursor + 8, true))
            cursor += 10
            setFieldScriptObjectState(state, objectId, { x, z, direction })
            return { kind: 'objectState', objectId, x, z, direction }
          }
          case 341: {
            requireBytes(bytes, cursor, 4, opcode)
            const objectValue = view.getUint16(cursor, true)
            const objectId = objectValue >= 0x4000 ? readVariable(objectValue) : objectValue
            const direction = decodeHgssPlayerDirection(view.getUint16(cursor + 2, true))
            cursor += 4
            setFieldScriptObjectState(state, objectId, { direction })
            return { kind: 'objectState', objectId, direction }
          }
          case 342: {
            requireBytes(bytes, cursor, 6, opcode)
            const readOperand = (offset: number) => {
              const value = view.getUint16(offset, true)
              return value >= 0x4000 ? readVariable(value) : value
            }
            const eventId = readOperand(cursor)
            const x = readOperand(cursor + 2)
            const z = readOperand(cursor + 4)
            cursor += 6
            const warp = map.events?.warps[eventId]
            if (warp) {
              warp.x = x
              warp.z = z
            }
            return { kind: 'mapEventState', event: 'warp', eventId, x, z }
          }
          case 344: {
            requireBytes(bytes, cursor, 4, opcode)
            const readOperand = (offset: number) => {
              const value = view.getUint16(offset, true)
              return value >= 0x4000 ? readVariable(value) : value
            }
            const objectId = readOperand(cursor)
            const direction = readOperand(cursor + 2)
            cursor += 4
            return { kind: 'objectEffect', action: 'configure', objectIds: [objectId], parameters: [direction] }
          }
          case 345:
            return { kind: 'dialogue', action: 'waitingIconAdd' }
          case 346:
            return { kind: 'dialogue', action: 'waitingIconRemove' }
          case 348: {
            requireBytes(bytes, cursor, 2, opcode)
            const frames = readScriptValue(cursor)
            cursor += 2
            // ScrCmd_WaitButtonOrDelay reprend au premier A/B ou à
            // l'expiration : c'est la même primitive web que Wait (opcode 3).
            return { kind: 'inputWait', accepts: ['confirm', 'cancel'], frames }
          }
          case 105: {
            requireBytes(bytes, cursor, 4, opcode)
            const xVariableId = view.getUint16(cursor, true)
            const zVariableId = view.getUint16(cursor + 2, true)
            cursor += 4
            state.variables.set(xVariableId, state.player.x & 0xffff)
            state.variables.set(zVariableId, state.player.z & 0xffff)
            break
          }
          case 106: {
            requireBytes(bytes, cursor, 6, opcode)
            const objectValue = view.getUint16(cursor, true)
            const objectId = objectValue >= 0x4000 ? readVariable(objectValue) : objectValue
            const xVariableId = view.getUint16(cursor + 2, true)
            const zVariableId = view.getUint16(cursor + 4, true)
            const object = getFieldScriptActorState(state, objectId)
            state.variables.set(xVariableId, object ? object.x & 0xffff : 255)
            state.variables.set(zVariableId, object ? object.z & 0xffff : 255)
            cursor += 6
            break
          }
          case 107:
            // Decalage conjoint de l'avatar et de la camera pendant une mise
            // en scene. Il ne change pas les coordonnees de cases utilisees
            // par la collision, mais ses trois operandes doivent etre lus.
            requireBytes(bytes, cursor, 6, opcode)
            cursor += 6
            break
          case 109: {
            requireBytes(bytes, cursor, 4, opcode)
            const objectValue = view.getUint16(cursor, true)
            const objectId = objectValue >= 0x4000 ? readVariable(objectValue) : objectValue
            const parameter = view.getUint16(cursor + 2, true)
            cursor += 4
            return { kind: 'objectEffect', action: 'configure', objectIds: [objectId], parameters: [parameter] }
          }
          case 110:
          case 111: {
            requireBytes(bytes, cursor, 4, opcode)
            const amount = view.getUint32(cursor, true)
            state.money = opcode === 110 ? Math.min(999999, state.money + amount) : Math.max(0, state.money - amount)
            cursor += 4
            break
          }
          case 112: {
            requireBytes(bytes, cursor, 6, opcode)
            const destination = view.getUint16(cursor, true)
            const amount = view.getUint32(cursor + 2, true)
            state.variables.set(destination, state.money >= amount ? 1 : 0)
            cursor += 6
            break
          }
          case 113:
            requireBytes(bytes, cursor, 4, opcode)
            cursor += 4
            break
          case 114:
          case 115:
            break
          case 116: {
            requireBytes(bytes, cursor, 5, opcode)
            const type = bytes[cursor]!
            const xValue = view.getUint16(cursor + 1, true)
            const yValue = view.getUint16(cursor + 3, true)
            const x = xValue >= 0x4000 ? readVariable(xValue) : xValue
            const y = yValue >= 0x4000 ? readVariable(yValue) : yValue
            cursor += 5
            return { kind: 'fieldOverlay', overlay: 'points', action: 'show', type, x, y }
          }
          case 117:
            return { kind: 'fieldOverlay', overlay: 'points', action: 'hide' }
          case 118: {
            requireBytes(bytes, cursor, 1, opcode)
            const type = bytes[cursor++]!
            return { kind: 'fieldOverlay', overlay: 'points', action: 'update', type }
          }
          case 119:
            requireBytes(bytes, cursor, 2, opcode)
            state.variables.set(view.getUint16(cursor, true), state.coins)
            cursor += 2
            break
          case 120:
          case 121: {
            requireBytes(bytes, cursor, 2, opcode)
            const value = view.getUint16(cursor, true)
            const amount = value >= 0x4000 ? readVariable(value) : value
            state.coins = opcode === 120 ? Math.min(50_000, state.coins + amount) : Math.max(0, state.coins - amount)
            cursor += 2
            break
          }
          case 122:
          case 123: {
            requireBytes(bytes, cursor, 2, opcode)
            const value = view.getUint16(cursor, true)
            const amount = value >= 0x4000 ? readVariable(value) : value
            state.athletePoints = opcode === 122
              ? Math.min(99_999, state.athletePoints + amount)
              : Math.max(0, state.athletePoints - amount)
            cursor += 2
            break
          }
          case 124: {
            requireBytes(bytes, cursor, 4, opcode)
            const destination = view.getUint16(cursor, true)
            const value = view.getUint16(cursor + 2, true)
            const amount = value >= 0x4000 ? readVariable(value) : value
            state.variables.set(destination, state.athletePoints >= amount ? 1 : 0)
            cursor += 4
            break
          }
          case 132: {
            requireBytes(bytes, cursor, 2, opcode)
            const messageId = bytes[cursor + (state.gender === 'female' ? 1 : 0)]
            cursor += 2
            const text = scriptMap.messages[messageId]
            if (text === undefined) {
              throw new Error(`Le message ${messageId} est absent de la banque ${scriptMap.header.msgBank}.`)
            }
            return { kind: 'message', messageId, text, speakerObjectId }
          }
          case 137: {
            requireBytes(bytes, cursor, 12, opcode)
            const readOperand = (offset: number): number => {
              const value = view.getUint16(offset, true)
              return value >= 0x4000 ? readVariable(value) : value
            }
            const speciesId = readOperand(cursor)
            const level = readOperand(cursor + 2) & 0xff
            const heldItemId = readOperand(cursor + 4)
            const form = readOperand(cursor + 6) & 0xff
            const ability = readOperand(cursor + 8)
            const destination = view.getUint16(cursor + 10, true)
            cursor += 12
            const runtime = requirePokemonRuntime(state)
            const now = runtime.now()
            const pokemon = createCanonicalPokemon(runtime.catalog, {
              speciesId,
              level,
              form,
              heldItemId,
              rng: runtime.rng,
              personality: { kind: 'random' },
              individualValues: { kind: 'random' },
              originalTrainer: runtime.trainer,
              origin: {
                language: runtime.language,
                gameVersion: runtime.gameVersion,
                metLocation: map.header.mapSection,
                metLevel: level,
                metTerrain: 24,
                metDate: { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() },
              },
              ballId: 4,
            })
            if (ability !== 0) pokemon.abilityId = ability
            const accepted = state.party.members.length < 6
              && tryAppendScriptedPokemonToParty(state.party, pokemon, 'gift', teamPolicy).kind === 'added'
            if (accepted) {
              markPokemonCaught(state.pokedex, pokemon, runtime.language)
            }
            state.variables.set(destination, accepted ? 1 : 0)
            break
          }
          case 139: case 654: {
            requireBytes(bytes, cursor, 6, opcode)
            const slot = readScriptValue(cursor)
            const moveSlot = readScriptValue(cursor + 2)
            const moveId = readScriptValue(cursor + 4)
            const pokemon = getPokemonPartyMember(state.party, slot)
            const data = requirePokemonRuntime(state).catalog.moves[moveId]
            if (!pokemon || !data || moveSlot < 0 || moveSlot >= 4) throw new Error(`SetMonMove HGSS invalide: équipe ${slot}, case ${moveSlot}, capacité ${moveId}.`)
            const move = { moveId, pp: data.pp, maxPp: data.pp, ppUps: 0, data }
            if (moveSlot < pokemon.moves.length) pokemon.moves[moveSlot] = move
            else pokemon.moves.push(move)
            cursor += 6
            break
          }
          case 140: {
            requireBytes(bytes, cursor, 6, opcode)
            const destination = view.getUint16(cursor, true)
            const moveId = readScriptValue(cursor + 2)
            const slot = readScriptValue(cursor + 4)
            const pokemon = getPokemonPartyMember(state.party, slot)
            state.variables.set(destination, pokemon && !pokemon.isEgg && pokemon.moves.some((move) => move.moveId === moveId) ? 1 : 0)
            cursor += 6
            break
          }
          case 141: {
            requireBytes(bytes, cursor, 4, opcode)
            const destination = view.getUint16(cursor, true)
            const moveValue = view.getUint16(cursor + 2, true)
            const moveId = moveValue >= 0x4000 ? readVariable(moveValue) : moveValue
            const slot = state.party.members.findIndex((pokemon) => !pokemon.isEgg && pokemon.moves.some((move) => move.moveId === moveId))
            state.variables.set(destination, slot < 0 ? 6 : slot)
            cursor += 4
            break
          }
          case 244:
          case 245:
          case 246: {
            requireBytes(bytes, cursor, 2, opcode)
            const destination = view.getUint16(cursor, true)
            const observed = opcode === 245
              ? state.pokedex.seenSpeciesIds
              : state.pokedex.caughtSpeciesIds
            const johtoNumbers = requirePokemonRuntime(state).pokedexCatalog?.johtoDexNumbers
            if (opcode === 244 && !johtoNumbers) {
              throw new Error('La table ROM du Pokédex de Johto est absente.')
            }
            const count = opcode === 244
              ? [...observed].filter((speciesId) => (johtoNumbers![speciesId] ?? 0) > 0).length
              : observed.size
            state.variables.set(destination, count)
            cursor += 2
            break
          }
          case 240: {
            requireBytes(bytes, cursor, 10, opcode)
            const operands = Array.from({ length: 5 }, (_, index) => {
              const value = view.getUint16(cursor + index * 2, true)
              return value >= 0x4000 ? readVariable(value) : value
            })
            state.dynamicWarp = {
              mapId: operands[0]!,
              warpId: operands[1]!,
              x: operands[2]!,
              z: operands[3]!,
              direction: operands[4]!,
            }
            cursor += 10
            break
          }
          case 241: {
            requireBytes(bytes, cursor, 2, opcode)
            const floorByMapId: Readonly<Record<number, number>> = {
              115: 0, 225: 1,
              189: 0, 190: 1,
              191: 1, 192: 2, 193: 3, 194: 4, 195: 5, 196: 6, 200: 0,
              370: 0, 371: 1, 372: 2, 373: 3, 374: 4, 375: 5,
              376: 0, 377: 1, 378: 2, 379: 3,
              402: 0, 403: 1,
            }
            state.variables.set(view.getUint16(cursor, true), floorByMapId[state.dynamicWarp?.mapId ?? 0] ?? 0)
            cursor += 2
            break
          }
          case 142: {
            requireBytes(bytes, cursor, 4, opcode)
            const contactValue = view.getUint16(cursor, true)
            const contactId = contactValue >= 0x4000 ? readVariable(contactValue) : contactValue
            const destination = view.getUint16(cursor + 2, true)
            cursor += 4
            if (!state.phoneRematchSeeking.has(contactId) || (contactId === 0x10 && resolveHgssWildTimeOfDay(refreshHgssTimeOfDayState(state)) !== 1)) {
              state.variables.set(destination, 0)
              break
            }
            const runtime = requirePokemonRuntime(state)
            const baseTrainerId = runtime.phoneBookEntries?.find((entry) => entry.id === contactId)?.trainerId
            if (baseTrainerId === undefined || !runtime.resolvePhoneRematchTrainerId) {
              throw new Error(`La revanche Pokématos ${contactId} ne peut pas être résolue sans le catalogue ROM des paliers.`)
            }
            state.variables.set(destination, runtime.resolvePhoneRematchTrainerId(baseTrainerId, state.trainerFlags, state.flags))
            break
          }
          case 158: { requireBytes(bytes, cursor, 1, opcode); const mode = bytes[cursor++]!; if (mode > 4) throw new Error(`Mode des Boîtes PC HGSS invalide (${mode}).`); awaitingPcBox = true; return { kind: 'pcBox', mode: mode as 0 | 1 | 2 | 3 | 4 } }
          case 159:
          case 160:
          case 162: {
            const request: HgssMultiplayerRequest = {
              ...multiplayerRequestBase(opcode, commandOffset),
              kind: 'union-activity-app',
              activity: state.unionActivity,
              party: state.party.members.map(serializeHgssMultiplayerPokemon),
            }
            return suspendMultiplayer(request)
          }
          case 161: {
            const request: HgssMultiplayerRequest = {
              ...multiplayerRequestBase(opcode, commandOffset),
              kind: 'wireless-trade',
              party: state.party.members.map(serializeHgssMultiplayerPokemon),
            }
            return suspendMultiplayer(request)
          }
          case 165: {
            requireBytes(bytes, cursor, 4, opcode)
            const modeValue = view.getUint16(cursor, true)
            const mode = modeValue >= 0x4000 ? readVariable(modeValue) : modeValue
            const destination = view.getUint16(cursor + 2, true)
            cursor += 4
            const request: HgssMultiplayerRequest = {
              ...multiplayerRequestBase(opcode, commandOffset),
              kind: 'dwc-profile-app',
              mode,
            }
            return suspendMultiplayer(request, (result) => state.variables.set(destination, result.romResult))
          }
          case 167:
            pendingStarterChoice = true
            return {
              kind: 'choice',
              options: hgssStarterSpeciesIds.map((_, value) => ({ label: getStarterName(state, value), value })),
              cancellable: false,
              presentation: 'starter',
            }
          case 168: {
            requireBytes(bytes, cursor, 2, opcode)
            const trainerIndex = readScriptValue(cursor)
            cursor += 2
            const trainer = state.engagedTrainers[trainerIndex]
            if (!trainer) throw new Error(`Le Dresseur engagé HGSS ${trainerIndex} est absent.`)
            const directionIndex = hgssPlayerDirections.indexOf(trainer.direction)
            const actions: FieldMovementAction[] = [
              { action: directionIndex, repetitions: 1, direction: trainer.direction, tileDistance: 0, kind: 'face' },
              // MOVEMENT_EMOTE_EXCLAMATION est conservé dans la chronologie
              // même si son sprite d'émote est rendu séparément sur DS.
              { action: 75, repetitions: 1, tileDistance: 0, kind: 'effect' },
            ]
            if (trainer.distance > 1) {
              actions.push({
                action: 12 + directionIndex,
                repetitions: trainer.distance - 1,
                direction: trainer.direction,
                tileDistance: 0,
                kind: 'walk',
              })
            }
            applyFieldScriptMovementState(state, trainer.objectId, actions)
            return { kind: 'movement', objectId: trainer.objectId, actions }
          }
          case 169: {
            requireBytes(bytes, cursor, 4, opcode)
            const trainerIndex = readScriptValue(cursor)
            const destination = view.getUint16(cursor + 2, true)
            cursor += 4
            if (!state.engagedTrainers[trainerIndex]) throw new Error(`Le Dresseur engagé HGSS ${trainerIndex} est absent.`)
            state.variables.set(destination, 1)
            return { kind: 'waiting', waitFor: 'movement' }
          }
          case 170: {
            requireBytes(bytes, cursor, 2, opcode)
            const trainer = state.engagedTrainers[0]
            if (!trainer) throw new Error('Le type de rencontre Dresseur est demandé sans Dresseur engagé.')
            state.variables.set(view.getUint16(cursor, true), trainer.encounterType)
            cursor += 2
            break
          }
          case 171: {
            requireBytes(bytes, cursor, 4, opcode)
            const trainerIndex = readScriptValue(cursor)
            const destination = view.getUint16(cursor + 2, true)
            const trainer = state.engagedTrainers[trainerIndex]
            if (!trainer) throw new Error(`Le numéro du Dresseur engagé HGSS ${trainerIndex} est absent.`)
            state.variables.set(destination, trainer.trainerId)
            cursor += 4
            break
          }
          case 173: {
            requireBytes(bytes, cursor, 4, opcode)
            const slotValue = view.getUint16(cursor, true)
            const slot = slotValue >= 0x4000 ? readVariable(slotValue) : slotValue
            const destination = view.getUint16(cursor + 2, true)
            cursor += 4
            pendingNickname = { kind: 'pokemon', slot, destination }
            const pokemon = getPokemonPartyMember(state.party, slot)
            if (!pokemon) throw new Error(`Le Pokémon d’équipe ${slot} demandé par NicknameInput est absent.`)
            return {
              kind: 'nickname', slot, currentName: pokemon.nickname ?? getSpeciesName(state, pokemon.speciesId), maxLength: 10,
              cancellable: true, promptMessageId: 1, promptValues: [pokemon.nickname ?? getSpeciesName(state, pokemon.speciesId)],
            }
          }
          case 174: {
            requireBytes(bytes, cursor, 8, opcode)
            const durationFrames = view.getUint16(cursor, true)
            const type = view.getUint16(cursor + 4, true)
            const color = view.getUint16(cursor + 6, true)
            cursor += 8
            pendingFadeFrames = durationFrames
            return { kind: 'screenFade', durationFrames, type, color }
          }
          case 175: {
            const frames = pendingFadeFrames
            pendingFadeFrames = 0
            if (frames > 0) return { kind: 'waiting', waitFor: 'timer', frames }
            break
          }
          case 176: {
            requireBytes(bytes, cursor, 10, opcode)
            const readOperand = (offset: number) => {
              const value = view.getUint16(offset, true)
              return value >= 0x4000 ? readVariable(value) : value
            }
            const mapId = readOperand(cursor)
            const x = readOperand(cursor + 4)
            const z = readOperand(cursor + 6)
            const direction = decodeHgssPlayerDirection(readOperand(cursor + 8))
            cursor += 10; return { kind: 'warp', mapId, x, z, direction }
          }
          case 179: requireBytes(bytes, cursor, 2, opcode); return runHgssWaterfallScriptCommand(state, readScriptValue(cursor), () => { cursor += 2; pendingMovementWait = true })
          case 181: state.weather = hgssWeather.deepDarkness; break
          case 183: {
            requireBytes(bytes, cursor, 2, opcode)
            const slot = readScriptValue(cursor)
            cursor += 2
            const pokemon = getPokemonPartyMember(state.party, slot)
            if (!pokemon) throw new Error(`Le slot ${slot} demandé par ScrCmd_183 est absent de l’équipe.`)
            // La ROM ouvre un overlay de présentation du Pokémon choisi puis
            // attend sa fin. Le runtime web réutilise le portrait déjà câblé.
            return {
              kind: 'pokemonPortrait',
              action: 'show',
              speciesId: pokemon.speciesId,
              gender: pokemon.gender === 'female' ? 1 : 0,
            }
          }
          case 184: {
            requireBytes(bytes, cursor, 2, opcode)
            state.variables.set(view.getUint16(cursor, true), state.playerState === 1 ? 1 : 0)
            cursor += 2
            break
          }
          case 185:
          case 186:
            requireBytes(bytes, cursor, 1, opcode)
            if (opcode === 185) state.playerState = bytes[cursor] === 1 ? 1 : 0
            cursor += 1
            break
          case 187: {
            requireBytes(bytes, cursor, 2, opcode)
            state.variables.set(view.getUint16(cursor, true), state.playerState)
            cursor += 2
            break
          }
          case 188:
            requireBytes(bytes, cursor, 2, opcode)
            applyPlayerAvatarTransition(state, view.getUint16(cursor, true))
            cursor += 2
            return { kind: 'waiting', waitFor: 'movement' }
          case 189:
            break
          case 251:
            // SetupAndStartTutorialBattle ne porte aucun parametre de scenario :
            // la ROM delegue l'integralite de la mise en scene au moteur de combat.
            lastBattleWon = undefined
            state.lastBattleWon = undefined
            awaitingBattle = true
            return { kind: 'battle', battle: { kind: 'tutorial' } }
          case 249: {
            requireBytes(bytes, cursor, 4, opcode)
            const readOperand = (offset: number) => {
              const value = view.getUint16(offset, true)
              return value >= 0x4000 ? readVariable(value) : value
            }
            const speciesId = readOperand(cursor)
            const level = readOperand(cursor + 2)
            cursor += 4
            lastBattleWon = undefined
            state.lastBattleWon = undefined
            awaitingBattle = true
            return { kind: 'battle', battle: { kind: 'wild', speciesId, level, battleParameter: 0 } }
          }
          case 253:
            requireBytes(bytes, cursor, 2, opcode)
            // Une session web chargée appartient nécessairement au profil
            // actif et possède une sauvegarde valide : état natif 3.
            state.variables.set(view.getUint16(cursor, true), 3)
            cursor += 2
            break
          case 213: {
            requireBytes(bytes, cursor, 6, opcode)
            const trainerValue = view.getUint16(cursor, true)
            const parameterValue = view.getUint16(cursor + 2, true)
            const trainerId = trainerValue >= 0x4000 ? readVariable(trainerValue) : trainerValue
            const trainerParameter = parameterValue >= 0x4000 ? readVariable(parameterValue) : parameterValue
            const encounterType = bytes[cursor + 4]
            const battleParameter = bytes[cursor + 5]
            cursor += 6
            // La commande native suspend le script jusqu'au retour du moteur de combat.
            lastBattleWon = undefined
            state.lastBattleWon = undefined
            awaitingBattle = true
            return { kind: 'battle', battle: { kind: 'trainer', trainerId, trainerParameter, encounterType, battleParameter } }
          }
          case 226:
          case 227: {
            const command = decodeHgssCommunicationClubCommand(opcode, bytes, cursor, readScriptValue)
            cursor = command.nextOffset
            return suspendMultiplayer({
              ...multiplayerRequestBase(opcode, commandOffset),
              ...command.request,
            }, (result) => state.variables.set(command.destination, result.romResult))
          }
          case 214: {
            requireBytes(bytes, cursor, 4, opcode)
            const trainerValue = view.getUint16(cursor, true)
            const messageValue = view.getUint16(cursor + 2, true)
            const trainerId = trainerValue >= 0x4000 ? readVariable(trainerValue) : trainerValue
            const messageId = messageValue >= 0x4000 ? readVariable(messageValue) : messageValue
            cursor += 4
            const catalog = requirePokemonRuntime(state).trainerMessages
            if (!catalog) throw new Error('Le catalogue ROM HGSS des répliques de Dresseurs est absent.')
            return { kind: 'message', messageId, text: getHgssTrainerMessage(catalog, trainerId, messageId), speakerObjectId }
          }
          case 215:
          case 216: {
            requireBytes(bytes, cursor, 6, opcode)
            const trainerId = scriptId < 5000 ? scriptId - 2999 : scriptId - 4999
            const isDouble = requirePokemonRuntime(state).trainerCatalog?.[trainerId]?.doubleBattle ?? false
            const secondPartner = scriptId >= 5000
            const values = opcode === 215
              ? !isDouble ? [0, 2, 0] : secondPartner ? [7, 9, 10] : [3, 5, 6]
              : !isDouble ? [17, 0, 0] : secondPartner ? [19, 0, 10] : [18, 0, 6]
            for (let index = 0; index < 3; index += 1) {
              state.variables.set(view.getUint16(cursor + index * 2, true), values[index]!)
            }
            cursor += 6
            break
          }
          case 217: {
            requireBytes(bytes, cursor, 2, opcode)
            const trainerId = scriptId < 5000 ? scriptId - 2999 : scriptId - 4999
            state.variables.set(view.getUint16(cursor, true), requirePokemonRuntime(state).trainerCatalog?.[trainerId]?.doubleBattle ? 1 : 0)
            cursor += 2
            break
          }
          case 218: {
            requireBytes(bytes, cursor, 2, opcode)
            const trainerValue = view.getUint16(cursor, true)
            const trainerId = trainerValue >= 0x4000 ? readVariable(trainerValue) : trainerValue
            cursor += 2
            const trainer = requirePokemonRuntime(state).trainerCatalog?.[trainerId]
            if (!trainer) throw new Error(`Le Dresseur HGSS ${trainerId} demandé par EncounterMusic est absent.`)
            return {
              kind: 'music',
              action: 'play',
              sequenceId: resolveHgssTrainerEncounterMusic(trainer.trainerClass, map.header.region),
            }
          }
          case 220: {
            requireBytes(bytes, cursor, 2, opcode)
            if (lastBattleWon === undefined) throw new Error("CheckBattleWon HGSS est exécuté sans résultat de combat.")
            state.variables.set(view.getUint16(cursor, true), lastBattleWon ? 1 : 0)
            cursor += 2
            break
          }
          case 379: {
            requireBytes(bytes, cursor, 2, opcode)
            state.variables.set(view.getUint16(cursor, true), refreshHgssTimeOfDayState(state))
            cursor += 2
            break
          }
          case 380: {
            requireBytes(bytes, cursor, 4, opcode)
            const destination = view.getUint16(cursor, true)
            const moduloValue = view.getUint16(cursor + 2, true)
            const modulo = moduloValue >= 0x4000 ? readVariable(moduloValue) : moduloValue
            if (modulo === 0) throw new Error(`Random HGSS a reçu un modulo nul à l’offset ${commandOffset}.`)
            state.variables.set(destination, requirePokemonRuntime(state).rng.nextU16() % modulo)
            cursor += 4
            break
          }
          case 382: {
            requireBytes(bytes, cursor, 4, opcode)
            const destination = view.getUint16(cursor, true)
            const slotValue = view.getUint16(cursor + 2, true)
            const slot = slotValue >= 0x4000 ? readVariable(slotValue) : slotValue
            const pokemon = getPokemonPartyMember(state.party, slot)
            if (!pokemon) throw new Error(`Le Pokémon d’équipe ${slot} demandé par MonGetFriendship est absent.`)
            state.variables.set(destination, pokemon.friendship)
            cursor += 4
            break
          }
          case 430: {
            requireBytes(bytes, cursor, 6, opcode)
            const readOperand = (offset: number): number => {
              const value = view.getUint16(offset, true)
              return value >= 0x4000 ? readVariable(value) : value
            }
            state.pendingPhoneCall = {
              callerId: readOperand(cursor),
              parameter1: readOperand(cursor + 2),
              parameter2: readOperand(cursor + 4),
            }
            cursor += 6
            return { kind: 'waiting', waitFor: 'movement' }
          }
          case 431: {
            if (!state.pendingPhoneCall) {
              throw new Error('RunPhoneCall HGSS a été exécuté sans appel préparé par SetPhoneCall.')
            }
            return { kind: 'phoneCall', call: { ...state.pendingPhoneCall } }
          }
          case 459:
            // La ROM lance ici une petite tâche overlay (utilisée notamment
            // pendant la guérison de Pharamp) puis reprend le script.
            // Le gameplay dépend de la reprise, pas du rendu DS exact.
            return { kind: 'waiting', waitFor: 'timer', frames: 1 }
          case 460: {
            requireBytes(bytes, cursor, 4, opcode)
            const trainerValue = view.getUint16(cursor, true)
            const trainerId = trainerValue >= 0x4000 ? readVariable(trainerValue) : trainerValue
            const destination = view.getUint16(cursor + 2, true)
            const entry = requirePokemonRuntime(state).phoneBookEntries?.find((candidate) => candidate.trainerId === trainerId)
            state.activePhoneContact = entry
            state.variables.set(destination, entry?.id ?? 0xff)
            cursor += 4
            break
          }
          case 461: {
            requireBytes(bytes, cursor, 5, opcode)
            const messageType = Math.min(bytes[cursor]!, 4)
            const bankDestination = view.getUint16(cursor + 1, true)
            const messageDestination = view.getUint16(cursor + 3, true)
            const contactId = state.activePhoneContact?.id
            const messageBank = contactId === undefined ? undefined : getHgssPhoneMessageBank(contactId)
            state.variables.set(bankDestination, messageBank ?? 0)
            state.variables.set(messageDestination, messageBank === undefined ? 0 : messageType + 1)
            cursor += 5
            break
          }
          case 462: {
            requireBytes(bytes, cursor, 2, opcode)
            const contactValue = view.getUint16(cursor, true)
            const contactId = contactValue >= 0x4000 ? readVariable(contactValue) : contactValue
            state.phoneRematchSeeking.delete(contactId)
            cursor += 2
            break
          }
          case 463:
            state.roamers.massOutbreaksEnabled = true
            break
          case 464: {
            requireBytes(bytes, cursor, 1, opcode)
            const roamerId = bytes[cursor]!
            cursor += 1
            const runtime = requirePokemonRuntime(state)
            createHgssRoamer(
              state.roamers,
              roamerId,
              runtime.catalog,
              runtime.rng,
              runtime.trainer,
              runtime.language,
              runtime.gameVersion,
            )
            break
          }
          case 465: {
            requireBytes(bytes, cursor, 2, opcode)
            const mode = view.getUint16(cursor, true)
            cursor += 2
            const readGroup = (groupId: number) => {
              const group = state.friendGroups[groupId]
              if (!group) throw new Error(`Le groupe ami HGSS ${groupId} est invalide.`)
              return group
            }
            if (mode >= 0 && mode <= 3) {
              requireBytes(bytes, cursor, 4, opcode)
              const groupId = readScriptValue(cursor)
              const second = view.getUint16(cursor + 2, true)
              cursor += 4
              const group = readGroup(groupId)
              if (mode === 0) state.variables.set(second, isHgssFriendGroupActive(group) ? 1 : 0)
              else if (mode === 1) state.variables.set(second, areHgssFriendGroupsEqual(state.friendGroups[1], group) ? 1 : 0)
              else {
                const fieldNo = second >= 0x4000 ? readVariable(second) : second
                state.buffers.set(fieldNo, (mode === 2 ? group.groupName : group.memberName) ?? '')
              }
              break
            }
            if (mode === 4) {
              requireBytes(bytes, cursor, 2, opcode)
              pendingNickname = { kind: 'friend-group', destination: view.getUint16(cursor, true) }
              cursor += 2
              return { kind: 'nickname', slot: -1, currentName: '', maxLength: 7, cancellable: true, promptMessageId: 5 }
            }
            if (mode === 5) {
              requireBytes(bytes, cursor, 2, opcode)
              copyHgssFriendGroup(state.friendGroups, readScriptValue(cursor), 1)
              cursor += 2
              break
            }
            if (mode === 6) {
              const mt = requirePokemonRuntime(state).mt
              if (!mt) throw new Error("Le MTRNG HGSS requis pour créer le groupe ami local n'est pas attaché.")
              initializePlayerHgssFriendGroup(state.friendGroups, state.playerName, state.gender, mt)
              break
            }
            if (mode === 7) {
              requireBytes(bytes, cursor, 2, opcode)
              const count = state.friendGroups.reduce((total, group, groupId) => (
                total + (isHgssFriendGroupActive(group) && !areHgssFriendGroupsEqual(state.friendGroups[1], group) && groupId < 6 ? 1 : 0)
              ), 0)
              state.variables.set(view.getUint16(cursor, true), count >= 4 ? 1 : 0)
              cursor += 2
              break
            }
            throw new Error(`Sous-commande FriendGroup HGSS ${mode} invalide.`)
          }
          case 589: {
            requireBytes(bytes, cursor, 5, opcode)
            const speciesValue = view.getUint16(cursor, true)
            const levelValue = view.getUint16(cursor + 2, true)
            const speciesId = speciesValue >= 0x4000 ? readVariable(speciesValue) : speciesValue
            const level = levelValue >= 0x4000 ? readVariable(levelValue) : levelValue
            const battleParameter = bytes[cursor + 4]
            cursor += 5
            lastBattleWon = undefined
            state.lastBattleWon = undefined
            awaitingBattle = true
            return { kind: 'battle', battle: { kind: 'wild', speciesId, level, battleParameter } }
          }
          case 529: {
            requireBytes(bytes, cursor, 2, opcode)
            state.variables.set(view.getUint16(cursor, true), getFirstUsablePokemonPartySlot(state.party))
            cursor += 2
            break
          }
          case 527: {
            requireBytes(bytes, cursor, 2, opcode)
            const messageId = view.getUint16(cursor, true)
            cursor += 2
            const text = scriptMap.messages[messageId]
            if (text === undefined) throw new Error(`Le message ${messageId} est absent de la banque ${scriptMap.header.msgBank}.`)
            return { kind: 'message', messageId, text, fontId: 3, speakerObjectId }
          }
          case 528:
            requireBytes(bytes, cursor, 2, opcode)
            // gSystem.unk6A vaut 0 hors d'un menu système actif. Le runtime
            // web ne maintient pas de menu DS parallèle au field script.
            state.variables.set(view.getUint16(cursor, true), 0)
            cursor += 2
            break
          case 190:
            requireBytes(bytes, cursor, 1, opcode)
            state.buffers.set(bytes[cursor], state.playerName)
            cursor += 1
            break
          case 191:
            requireBytes(bytes, cursor, 1, opcode)
            state.buffers.set(bytes[cursor], state.rivalName)
            cursor += 1
            break
          case 193: {
            requireBytes(bytes, cursor, 3, opcode)
            const bufferId = bytes[cursor]
            const slotValue = view.getUint16(cursor + 1, true)
            const slot = slotValue >= 0x4000 ? readVariable(slotValue) : slotValue
            const speciesId = getPokemonPartyMember(state.party, slot)?.speciesId
            if (speciesId === undefined) {
              throw new Error(`Le Pokémon d’équipe ${slot} demandé par BufferMonSpeciesName est absent.`)
            }
            state.buffers.set(bufferId, getSpeciesName(state, speciesId))
            cursor += 3
            break
          }
          case 202: {
            requireBytes(bytes, cursor, 6, opcode)
            const bufferId = bytes[cursor]
            const speciesValue = view.getUint16(cursor + 1, true)
            const speciesId = speciesValue >= 0x4000 ? readVariable(speciesValue) : speciesValue
            state.buffers.set(bufferId, getSpeciesName(state, speciesId))
            cursor += 6
            break
          }
          case 194:
          case 843: {
            requireBytes(bytes, cursor, 3, opcode)
            const bufferId = bytes[cursor]
            const itemValue = view.getUint16(cursor + 1, true)
            const itemId = itemValue >= 0x4000 ? readVariable(itemValue) : itemValue
            state.buffers.set(bufferId, getItem(state, itemId).name)
            cursor += 3
            break
          }
          case 195: {
            requireBytes(bytes, cursor, 3, opcode)
            const bufferId = bytes[cursor]
            const pocketValue = view.getUint16(cursor + 1, true)
            const pocket = pocketValue >= 0x4000 ? readVariable(pocketValue) : pocketValue
            const pocketName = getItemCatalog(state).pocketNames[pocket]
            if (pocketName === undefined) throw new Error(`La poche ROM HGSS ${pocket} demandée par BufferPocketName est absente.`)
            state.buffers.set(bufferId, pocketName)
            cursor += 3
            break
          }
          case 196: {
            requireBytes(bytes, cursor, 3, opcode)
            const bufferId = bytes[cursor]
            const itemValue = view.getUint16(cursor + 1, true)
            const itemId = itemValue >= 0x4000 ? readVariable(itemValue) : itemValue
            const moveId = getHgssTmHmMoveId(itemId)
            const name = requirePokemonRuntime(state).catalog.moveNames[moveId]
            if (!name) throw new Error(`La capacité ROM de la CT/CS ${itemId} est absente.`)
            state.buffers.set(bufferId, name)
            cursor += 3
            break
          }
          case 197: {
            requireBytes(bytes, cursor, 3, opcode)
            const bufferId = bytes[cursor]!
            const moveId = readScriptValue(cursor + 1)
            const name = requirePokemonRuntime(state).catalog.moveNames[moveId]
            if (!name) throw new Error(`La capacité ROM HGSS ${moveId} demandée par BufferMoveName est absente.`)
            state.buffers.set(bufferId, name)
            cursor += 3
            break
          }
          case 198: {
            requireBytes(bytes, cursor, 3, opcode)
            const bufferId = bytes[cursor]
            const value = view.getUint16(cursor + 1, true)
            state.buffers.set(bufferId, String(value >= 0x4000 ? readVariable(value) : value))
            cursor += 3
            break
          }
          case 541: {
            requireBytes(bytes, cursor, 5, opcode)
            const bufferId = bytes[cursor]
            const valueOperand = view.getUint16(cursor + 1, true)
            const value = valueOperand >= 0x4000 ? readVariable(valueOperand) : valueOperand
            const printingMode = bytes[cursor + 3]!
            const requestedDigits = bytes[cursor + 4]!
            const raw = String(value)
            const formatted = printingMode === 0
              ? raw
              : raw.padStart(requestedDigits, printingMode === 2 ? '0' : ' ')
            state.buffers.set(bufferId, formatted)
            cursor += 5
            break
          }
          case 199: {
            requireBytes(bytes, cursor, 3, opcode)
            const bufferId = bytes[cursor]
            const slotValue = view.getUint16(cursor + 1, true)
            const slot = slotValue >= 0x4000 ? readVariable(slotValue) : slotValue
            const pokemon = getPokemonPartyMember(state.party, slot)
            state.buffers.set(bufferId, pokemon?.nickname ?? getSpeciesName(state, pokemon?.speciesId ?? 0))
            cursor += 3
            break
          }
          case 203:
          case 204:
          case 205: {
            requireBytes(bytes, cursor, 1, opcode)
            const bufferId = bytes[cursor]
            const name = opcode === 203
              ? getStarterName(state, state.starterChoice)
              : opcode === 204
                ? getRivalStarterName(state, state.starterChoice)
                : getFriendStarterName(state, state.starterChoice)
            state.buffers.set(bufferId, name)
            cursor += 1
            break
          }
          case 206: {
            requireBytes(bytes, cursor, 2, opcode)
            const speciesId = state.starterChoice === undefined ? 0 : hgssStarterSpeciesIds[state.starterChoice]
            state.variables.set(view.getUint16(cursor, true), speciesId)
            cursor += 2
            break
          }
          case 212: {
            requireBytes(bytes, cursor, 2, opcode)
            const trainerId = scriptId < 5000 ? scriptId - 2999 : scriptId - 4999
            if (trainerId < 1) throw new Error(`Le script ${scriptId} ne correspond pas à un Dresseur HGSS.`)
            state.variables.set(view.getUint16(cursor, true), trainerId)
            cursor += 2
            break
          }
          case 221: {
            requireBytes(bytes, cursor, 3, opcode)
            if (lastBattleWon === undefined) throw new Error("StaticWildWonOrCaughtCheck HGSS est exécuté sans résultat de combat.")
            // IsBattleResultStaticWildWin porte un nom trompeur dans la ROM :
            // WIN et MON_CAUGHT donnent FALSE, les issues sans retrait TRUE.
            state.variables.set(view.getUint16(cursor, true), lastBattleWon ? 0 : 1)
            cursor += 3
            break
          }
          case 222: {
            requireBytes(bytes, cursor, 2, opcode)
            const usablePokemon = getPokemonBattleEligiblePartySlots(state.party.members, { format: 'double', phase: 'initial' }, teamPolicy).length
            const requiredPokemon = battleFormatResolver({ kind: 'wild' }).engine === 'double' ? 1 : 2
            state.variables.set(view.getUint16(cursor, true), usablePokemon >= requiredPokemon ? 1 : 0)
            cursor += 2
            break
          }
          case 192:
            requireBytes(bytes, cursor, 1, opcode)
            state.buffers.set(bytes[cursor], state.friendName)
            cursor += 1
            break
          case 128: {
            requireBytes(bytes, cursor, 6, opcode)
            const itemValue = view.getUint16(cursor, true)
            const quantityValue = view.getUint16(cursor + 2, true)
            const destination = view.getUint16(cursor + 4, true)
            const item = itemValue >= 0x4000 ? readVariable(itemValue) : itemValue
            const quantity = quantityValue >= 0x4000 ? readVariable(quantityValue) : quantityValue
            getItem(state, item)
            state.variables.set(destination, hasBagItem(state.inventory, item, quantity) ? 1 : 0)
            cursor += 6
            break
          }
          case 360: {
            requireBytes(bytes, cursor, 2, opcode)
            const amountValue = view.getUint16(cursor, true)
            state.money = Math.max(0, state.money - (amountValue >= 0x4000 ? readVariable(amountValue) : amountValue))
            cursor += 2
            break
          }
          case 368: {
            requireBytes(bytes, cursor, 4, opcode)
            const destination = view.getUint16(cursor, true)
            const amountValue = view.getUint16(cursor + 2, true)
            const amount = amountValue >= 0x4000 ? readVariable(amountValue) : amountValue
            state.variables.set(destination, state.money >= amount ? 1 : 0)
            cursor += 4
            break
          }
          case 295: {
            requireBytes(bytes, cursor, 2, opcode)
            const badgeValue = view.getUint16(cursor, true)
            const badgeId = badgeValue >= 0x4000 ? readVariable(badgeValue) : badgeValue
            if (badgeId >= 16) throw new Error(`Le badge HGSS ${badgeId} est invalide.`)
            state.badges.add(badgeId)
            cursor += 2
            break
          }
          case 243: {
            requireBytes(bytes, cursor, 2, opcode)
            const johtoDexNumbers = requirePokemonRuntime(state).pokedexCatalog?.johtoDexNumbers
            if (!johtoDexNumbers) throw new Error('La correspondance ROM du Pokédex de Johto requise par CountJohtoDexSeen est absente.')
            const seen = [...state.pokedex.seenSpeciesIds].reduce((count, speciesId) => (
              (johtoDexNumbers[speciesId] ?? 0) > 0 ? count + 1 : count
            ), 0)
            state.variables.set(view.getUint16(cursor, true), seen)
            cursor += 2
            break
          }
          case 238:
            requireBytes(bytes, cursor, 2, opcode)
            state.variables.set(view.getUint16(cursor, true), hasPokemonPartyPokerus(state.party) ? 1 : 0)
            cursor += 2
            break
          case 239: {
            requireBytes(bytes, cursor, 4, opcode)
            const slot = readScriptValue(cursor)
            const destination = view.getUint16(cursor + 2, true)
            const gender = getPokemonPartyMember(state.party, slot)?.gender
            state.variables.set(destination, gender === 'male' ? 0 : gender === 'female' ? 1 : 2)
            cursor += 4
            break
          }
          case 242: {
            requireBytes(bytes, cursor, 6, opcode)
            const x = bytes[cursor]!
            const y = bytes[cursor + 1]!
            const windowVariable = view.getUint16(cursor + 2, true)
            const floor = readScriptValue(cursor + 4)
            state.variables.set(windowVariable, floor)
            const bank = scriptMap.externalMessages?.[191]
            const messageId = floor === 0 ? 122 : 116 + floor - 1
            state.buffers.set(0, bank?.[messageId] ?? (floor === 0 ? 'RDC' : `${floor}F`))
            cursor += 6
            return { kind: 'fieldOverlay', overlay: 'floor', action: 'show', type: floor, x, y }
          }
          case 356: {
            requireBytes(bytes, cursor, 2, opcode)
            state.variables.set(
              view.getUint16(cursor, true),
              state.party.members.reduce((count, pokemon) => count + (pokemon.isEgg ? 0 : 1), 0),
            )
            cursor += 2
            break
          }
          case 275:
          case 276: {
            requireBytes(bytes, cursor, 2, opcode)
            const argumentValue = view.getUint16(cursor, true)
            const argument = argumentValue >= 0x4000 ? readVariable(argumentValue) : argumentValue
            const itemIds = opcode === 275 ? getHgssStandardMartItemIds(state.badges.size) : getHgssSpecialMartItemIds(argument)
            pendingMartSession = createHgssMartSession(itemIds, 'buy')
            for (const itemId of itemIds) getItem(state, itemId)
            cursor += 2
            return createShopStep()
          }
          case 782:
            pendingMartSession = createHgssMartSession([], 'sell')
            return createShopStep()
          case 374:
          case 375: {
            requireBytes(bytes, cursor, 2, opcode)
            const objectValue = view.getUint16(cursor, true)
            const objectId = objectValue >= 0x4000 ? readVariable(objectValue) : objectValue
            cursor += 2
            if (opcode === 374) state.invisibleObjectIds.add(objectId)
            else state.invisibleObjectIds.delete(objectId)
            return { kind: 'objectVisibility', objectId, visible: opcode === 375 }
          }
          case 400: {
            requireBytes(bytes, cursor, 1, opcode)
            const action = bytes[cursor]
            cursor += 1
            // FLAG_ACTION_CLEAR=0 et FLAG_ACTION_SET=1 dans la ROM. Cette
            // commande pilote tous les rochers Force, pas seulement le script
            // standard qui affiche le dialogue d'activation.
            if (action === 0) state.flags.delete(0x962)
            else if (action === 1) state.flags.add(0x962)
            else if (action === 2) {
              requireBytes(bytes, cursor, 2, opcode)
              state.variables.set(view.getUint16(cursor, true), state.flags.has(0x962) ? 1 : 0)
              cursor += 2
            } else throw new Error(`Action Force HGSS ${action} invalide.`)
            break
          }
          case 403: {
            requireBytes(bytes, cursor, 4, opcode)
            const accessoryId = readScriptValue(cursor)
            const quantity = readScriptValue(cursor + 2)
            giveHgssFashionAccessory(state.fashionAccessories, accessoryId, quantity)
            cursor += 4
            break
          }
          case 404: {
            requireBytes(bytes, cursor, 6, opcode)
            const accessoryId = readScriptValue(cursor)
            const quantity = readScriptValue(cursor + 2)
            state.variables.set(
              view.getUint16(cursor + 4, true),
              canGiveHgssFashionAccessory(state.fashionAccessories, accessoryId, quantity) ? 1 : 0,
            )
            cursor += 6
            break
          }
          case 405: {
            requireBytes(bytes, cursor, 6, opcode)
            const accessoryId = readScriptValue(cursor)
            const quantity = readScriptValue(cursor + 2)
            state.variables.set(
              view.getUint16(cursor + 4, true),
              quantity <= (state.fashionAccessories.get(accessoryId) ?? 0) ? 1 : 0,
            )
            cursor += 6
            break
          }
          case 406: {
            requireBytes(bytes, cursor, 2, opcode)
            const backgroundId = readScriptValue(cursor)
            if (backgroundId < 0 || backgroundId >= 18) throw new Error(`Décor HGSS ${backgroundId} invalide.`)
            state.fashionBackgrounds.add(backgroundId)
            cursor += 2
            break
          }
          case 407: {
            requireBytes(bytes, cursor, 4, opcode)
            const backgroundId = readScriptValue(cursor)
            if (backgroundId < 0 || backgroundId >= 18) throw new Error(`Décor HGSS ${backgroundId} invalide.`)
            state.variables.set(view.getUint16(cursor + 2, true), state.fashionBackgrounds.has(backgroundId) ? 0 : 1)
            cursor += 4
            break
          }
          case 408: {
            requireBytes(bytes, cursor, 4, opcode)
            const mode = readScriptValue(cursor)
            const viewIndex = readScriptValue(cursor + 2)
            cursor += 4
            const page = createHgssFrontierRecordPage(1, Math.min(2, viewIndex), 0, state.frontierRecords)
            awaitingFrontierRecordsApp = true
            return {
              kind: 'frontierRecordsApp',
              page: { ...page, title: mode === 0 ? 'Records de la Tour de Combat' : 'Records Wi-Fi de la Tour' },
            }
          }
          case 553: {
            requireBytes(bytes, cursor, 3, opcode)
            const limit = Math.min(bytes[cursor]!, 100)
            state.variables.set(
              view.getUint16(cursor + 1, true),
              requirePokemonRuntime(state).rng.nextU16() % 101 <= limit ? 1 : 0,
            )
            cursor += 3
            break
          }
          case 560: {
            requireBytes(bytes, cursor, 4, opcode)
            const mode = resolveHgssFieldMoveEffectProfile(readScriptValue(cursor)).mode
            const destination = view.getUint16(cursor + 2, true)
            cursor += 4
            state.variables.set(destination, 0)
            return { kind: 'fieldMoveEffect', mode, completionVariable: destination }
          }
          case 642:
            requireBytes(bytes, cursor, 2, opcode)
            // Save_CheckExtraChunksExist concerne les blocs secondaires DS
            // (vidéos de combat et données réseau). Le format navigateur n'en
            // crée aucun tant que le futur service serveur n'en fournit pas.
            state.variables.set(view.getUint16(cursor, true), 0)
            cursor += 2
            break
          case 641:
            // Save_WipeExtraChunks réinitialise les seuls blocs secondaires
            // propres au format de sauvegarde DS. Ils n'existent pas dans la
            // sauvegarde navigateur : l'effet global correspondant est vide.
            break
          case 749:
          case 750: {
            requireBytes(bytes, cursor, 6, opcode)
            const cancellable = bytes[cursor + 3] !== 0
            const variableId = view.getUint16(cursor + 4, true)
            cursor += 6
            const messages = opcode === 749 ? scriptMap.externalMessages?.[191] : scriptMap.messages
            if (!messages) throw new Error('La banque ROM HGSS 191 des menus standards est absente.')
            buildingMenu = { variableId, options: [], cancellable, messages }
            break
          }
          case 751: {
            requireBytes(bytes, cursor, 6, opcode)
            if (!buildingMenu) throw new Error(`MenuItemAdd HGSS sans MenuInit a l’offset ${commandOffset}.`)
            const messageValue = view.getUint16(cursor, true)
            const valueValue = view.getUint16(cursor + 4, true)
            const messageId = messageValue >= 0x4000 ? readVariable(messageValue) : messageValue
            const value = valueValue >= 0x4000 ? readVariable(valueValue) : valueValue
            const label = buildingMenu.messages[messageId]
            if (label === undefined) throw new Error(`Le choix ${messageId} est absent de la banque ${map.header.msgBank}.`)
            buildingMenu.options.push({ label, value })
            cursor += 6
            break
          }
          case 752:
            if (!buildingMenu || buildingMenu.options.length === 0) throw new Error(`MenuExec HGSS sans options a l’offset ${commandOffset}.`)
            pendingChoice = buildingMenu
            buildingMenu = undefined
            return { kind: 'choice', options: pendingChoice.options, cancellable: pendingChoice.cancellable }
          case 795:
            requireBytes(bytes, cursor, 4, opcode)
            cursor += 4
            break
          case 793: {
            requireBytes(bytes, cursor, 4, opcode)
            const mode = view.getUint16(cursor, true)
            const variableId = view.getUint16(cursor + 2, true)
            if (mode !== 0 && mode !== 1) throw new Error(`Mode bancaire HGSS ${mode} invalide a l’offset ${commandOffset}.`)
            const max = mode === 0
              ? Math.min(state.money, 999999 - state.bankBalance)
              : Math.min(state.bankBalance, 999999 - state.money)
            cursor += 4
            pendingNumber = { mode, variableId, max }
            return { kind: 'number', min: 0, max }
          }
          case 794: {
            requireBytes(bytes, cursor, 6, opcode)
            const destination = view.getUint16(cursor, true)
            const amount = view.getUint32(cursor + 2, true)
            state.variables.set(destination, state.bankBalance >= amount ? 1 : 0)
            cursor += 6
            break
          }
          case 838: {
            requireBytes(bytes, cursor, 4, opcode)
            const action = view.getUint16(cursor, true)
            const destination = view.getUint16(cursor + 2, true)
            state.variables.set(destination, (action === 0 ? state.bankBalance : state.money) === 999999 ? 1 : 0)
            cursor += 4
            break
          }
          case 377: {
            requireBytes(bytes, cursor, 2, opcode)
            const variableId = view.getUint16(cursor, true)
            cursor += 2
            state.variables.set(variableId, state.mailboxMessageCount)
            break
          }
          case 378: {
            requireBytes(bytes, cursor, 4, opcode)
            const pageScroll = readScriptValue(cursor)
            const cursorPosition = readScriptValue(cursor + 2)
            cursor += 4
            const scope = Math.floor(pageScroll / 3)
            const page = pageScroll % 3
            const pageLabels = ['Pokémon', 'Tour de Combat', 'Activités']
            const values = page === 0
              ? [state.pokedex.seenSpeciesIds.size, state.pokedex.caughtSpeciesIds.size]
              : page === 1
                ? [state.frontierRecords.get(0) ?? 0, state.frontierRecords.get(1) ?? 0]
                : [state.gameScore, state.badges.size]
            awaitingFrontierRecordsApp = true
            return {
              kind: 'frontierRecordsApp',
              page: {
                facility: 'tower',
                facilityId: 1,
                title: 'Classements',
                view: 'single',
                viewLabel: `${scope === 0 ? 'Groupe' : 'Monde'} · ${pageLabels[page] ?? `Page ${page}`} · curseur ${cursorPosition}`,
                rows: [
                  { label: page === 0 ? 'Pokémon vus' : page === 1 ? 'Record personnel' : 'Score', value: values[0]!, tone: 'record' },
                  { label: page === 0 ? 'Pokémon obtenus' : page === 1 ? 'Série actuelle' : 'Badges', value: values[1]!, tone: 'current' },
                ],
              },
            }
          }
          case 423:
          case 424: {
            requireBytes(bytes, cursor, 2, opcode)
            const mythicalSpecies = opcode === 423
              ? new Set([151, 251])
              : new Set([151, 251, 385, 386, 489, 490, 491, 492, 493])
            const caughtCount = opcode === 423
              ? [...state.pokedex.caughtSpeciesIds].reduce((count, speciesId) => {
                  const johtoNumber = requirePokemonRuntime(state).pokedexCatalog?.johtoDexNumbers[speciesId] ?? 0
                  return count + (johtoNumber > 0 && !mythicalSpecies.has(speciesId) ? 1 : 0)
                }, 0)
              : [...state.pokedex.caughtSpeciesIds].reduce((count, speciesId) => (
                  count + (speciesId >= 1 && speciesId <= 493 && !mythicalSpecies.has(speciesId) ? 1 : 0)
                ), 0)
            state.variables.set(view.getUint16(cursor, true), caughtCount >= (opcode === 423 ? 254 : 484) ? 1 : 0)
            cursor += 2
            break
          }
          case 429: {
            requireBytes(bytes, cursor, 2, opcode)
            const fossilItemIds = [103, 101, 102, 99, 100, 104, 105] as const
            const total = fossilItemIds.reduce((quantity, itemId) => quantity + (state.inventory.get(itemId) ?? 0), 0)
            state.variables.set(view.getUint16(cursor, true), total)
            cursor += 2
            break
          }
          case 432: {
            requireBytes(bytes, cursor, 4, opcode)
            const fossilSpecies = new Map([
              [103, 142], [101, 138], [102, 140], [99, 345], [100, 347], [104, 410], [105, 408],
            ])
            const fossilValue = view.getUint16(cursor + 2, true)
            const fossilItemId = fossilValue >= 0x4000 ? readVariable(fossilValue) : fossilValue
            state.variables.set(view.getUint16(cursor, true), fossilSpecies.get(fossilItemId) ?? 0)
            cursor += 4
            break
          }
          case 433: {
            requireBytes(bytes, cursor, 6, opcode)
            const fossilItemIds = [103, 101, 102, 99, 100, 104, 105] as const
            const neededValue = view.getUint16(cursor + 4, true)
            const needed = neededValue >= 0x4000 ? readVariable(neededValue) : neededValue
            let runningTotal = 0
            let selectedItemId = 0
            let selectedIndex = 0
            for (let index = 0; index < fossilItemIds.length; index += 1) {
              const itemId = fossilItemIds[index]!
              runningTotal += state.inventory.get(itemId) ?? 0
              if (runningTotal < needed) continue
              selectedItemId = itemId
              selectedIndex = index
              break
            }
            state.variables.set(view.getUint16(cursor, true), selectedItemId)
            state.variables.set(view.getUint16(cursor + 2, true), selectedIndex)
            cursor += 6
            break
          }
          case 435: {
            requireBytes(bytes, cursor, 4, opcode)
            const destination = view.getUint16(cursor, true)
            const slot = readScriptValue(cursor + 2)
            const pokemon = getPokemonPartyMember(state.party, slot)
            if (!pokemon) throw new Error(`Le slot Pokémon ${slot} demandé par SurvivePoisoning est absent.`)
            state.variables.set(destination, surviveHgssFieldPoisoning(pokemon) ? 1 : 0)
            cursor += 4
            break
          }
          case 437: {
            requireBytes(bytes, cursor, 2, opcode)
            // Commande de debug native : elle ne fait que résoudre la variable.
            const watchedValue = view.getUint16(cursor, true)
            if (watchedValue >= 0x4000) readVariable(watchedValue)
            cursor += 2
            break
          }
          case 445:
          case 446: {
            requireBytes(bytes, cursor, 2, opcode)
            state.variables.set(view.getUint16(cursor, true), opcode === 445 ? state.previousMapId ?? 0 : state.currentMapId ?? map.id)
            cursor += 2
            break
          }
          case 447: cursor = runHgssSafariZoneActionOpcode(state, bytes, cursor); break
          case 477: {
            requireBytes(bytes, cursor, 3, opcode)
            const action = bytes[cursor]
            const destination = view.getUint16(cursor + 1, true)
            if (action === 1) enableHgssNationalDex(state.pokedex)
            else if (action !== 2) throw new Error(`Action Pokédex national HGSS ${action} invalide.`)
            state.variables.set(destination, action === 2 && state.pokedex.nationalDexEnabled ? 1 : 0)
            cursor += 3
            break
          }
          case 530: {
            requireBytes(bytes, cursor, 3, opcode)
            const indexValue = view.getUint16(cursor, true)
            const index = indexValue >= 0x4000 ? readVariable(indexValue) : indexValue
            const action = bytes[cursor + 2]
            const validationValues = [0x6208, 0xf229, 0x0382, 0x1228] as const
            const validationValue = validationValues[index]
            if (validationValue === undefined) throw new Error(`Index de validation système HGSS ${index} invalide.`)
            state.variables.set(0x4036 + index, action === 0 ? 0 : validationValue)
            cursor += 3
            break
          }
          case 489: {
            requireBytes(bytes, cursor, 2, opcode)
            const action = view.getUint16(cursor, true)
            cursor += 2
            if (action === 0) break
            if (action === 7 || action === 8) break
            if (action >= 1 && action <= 3) {
              requireBytes(bytes, cursor, 2, opcode)
              // Aucun cadeau externe n'est injecté dans la sauvegarde web :
              // la file native est donc vide (tag invalide 0).
              state.variables.set(view.getUint16(cursor, true), 0)
              cursor += 2
              break
            }
            if (action === 4) {
              // SCR_MG_RECEIVE n'est atteint dans la ROM qu'après HAS_GIFT.
              // Avec une file vide, cette branche est sans effet.
              break
            }
            if (action === 5 || action === 6) {
              requireBytes(bytes, cursor, 4, opcode)
              state.variables.set(view.getUint16(cursor, true), 0)
              state.variables.set(view.getUint16(cursor + 2, true), 0)
              cursor += 4
              break
            }
            throw new Error(`Action MysteryGift HGSS ${action} invalide.`)
          }
          case 487: {
            requireBytes(bytes, cursor, 2, opcode)
            const value = view.getUint16(cursor, true)
            const animation = value >= 0x4000 ? readVariable(value) : value
            cursor += 2
            return { kind: 'objectEffect', action: 'pokeCenter', objectIds: [], parameters: [animation] }
          }
          case 492: {
            requireBytes(bytes, cursor, 6, opcode)
            const modeValue = view.getUint16(cursor, true)
            const mode = modeValue >= 0x4000 ? readVariable(modeValue) : modeValue
            const resultVariable = view.getUint16(cursor + 2, true)
            const outputVariable = view.getUint16(cursor + 4, true)
            cursor += 6
            const catalog = requirePokemonRuntime(state).easyChatCatalog
            if (!catalog) throw new Error('Les banques Easy Chat de la ROM sont absentes du runtime.')
            state.variables.set(outputVariable, 0xffff)
            awaitingEasyChat = { kind: 'word', mode, resultVariable, outputVariable }
            return { kind: 'easyChat', mode, catalog }
          }
          case 493: {
            requireBytes(bytes, cursor, 6, opcode)
            const resultVariable = view.getUint16(cursor, true)
            const outputVariable = view.getUint16(cursor + 2, true)
            const secondOutputVariable = view.getUint16(cursor + 4, true)
            cursor += 6
            const catalog = requirePokemonRuntime(state).easyChatCatalog
            if (!catalog) throw new Error('Les banques Easy Chat de la ROM sont absentes du runtime.')
            state.variables.set(outputVariable, 0xffff)
            state.variables.set(secondOutputVariable, 0xffff)
            awaitingEasyChat = { kind: 'word', mode: 1, resultVariable, outputVariable, secondOutputVariable }
            return { kind: 'easyChat', mode: 1, catalog }
          }
          case 494: {
            requireBytes(bytes, cursor, 4, opcode)
            const bufferValue = view.getUint16(cursor, true)
            const wordValue = view.getUint16(cursor + 2, true)
            const bufferId = bufferValue >= 0x4000 ? readVariable(bufferValue) : bufferValue
            const wordId = wordValue >= 0x4000 ? readVariable(wordValue) : wordValue
            const word = requirePokemonRuntime(state).easyChatCatalog?.words[wordId]
            if (!word) throw new Error(`Le mot Easy Chat HGSS ${wordId} demandé par ScrCmd_494 est absent.`)
            state.buffers.set(bufferId, word.text)
            cursor += 4
            break
          }
          case 255: {
            requireBytes(bytes, cursor, 4, opcode)
            const portraitIndex = view.getUint16(cursor, true)
            const destination = view.getUint16(cursor + 2, true)
            state.variables.set(destination, state.fashionPortraits.has(portraitIndex) ? 1 : 0)
            cursor += 4
            break
          }
          case 256: {
            requireBytes(bytes, cursor, 2, opcode)
            const value = view.getUint16(cursor, true)
            const wordId = value >= 0x4000 ? readVariable(value) : value
            state.fashionPortraitEasyChatWords.set(0, wordId)
            cursor += 2
            break
          }
          case 517: {
            requireBytes(bytes, cursor, 4, opcode)
            const speciesValue = view.getUint16(cursor, true)
            const destination = view.getUint16(cursor + 2, true)
            const speciesId = speciesValue >= 0x4000 ? readVariable(speciesValue) : speciesValue
            state.variables.set(destination, state.party.members.some((pokemon) => pokemon.speciesId === speciesId) ? 1 : 0)
            cursor += 4
            break
          }
          case 515: {
            requireBytes(bytes, cursor, 2, opcode)
            addHgssGameScore(state, view.getUint16(cursor, true))
            cursor += 2
            break
          }
          case 516:
          case 532: {
            requireBytes(bytes, cursor, 3, opcode)
            const bufferId = bytes[cursor]!
            const nameId = readScriptValue(cursor + 1)
            const messageBank = opcode === 516 ? 216 : 218
            const label = scriptMap.externalMessages?.[messageBank]?.[nameId]
            if (!label) {
              throw new Error(`Le nom ROM ${nameId} de la banque Mode HGSS ${messageBank} est absent.`)
            }
            state.buffers.set(bufferId, label)
            cursor += 3
            break
          }
          case 522: {
            requireBytes(bytes, cursor, 2, opcode)
            state.variables.set(view.getUint16(cursor, true), requirePokemonRuntime(state).now().getHours())
            cursor += 2
            break
          }
          case 540: {
            requireBytes(bytes, cursor, 2, opcode)
            state.variables.set(view.getUint16(cursor, true), state.easyChatTrendySayings.size >= 32 ? 1 : 0)
            cursor += 2
            break
          }
          case 538: {
            requireBytes(bytes, cursor, 4, opcode)
            const destination = view.getUint16(cursor, true)
            const bufferValue = view.getUint16(cursor + 2, true)
            const bufferId = bufferValue >= 0x4000 ? readVariable(bufferValue) : bufferValue
            cursor += 4
            const locked = Array.from({ length: 32 }, (_, index) => index)
              .filter((index) => !state.easyChatTrendySayings.has(index))
            if (locked.length === 0) {
              state.variables.set(destination, 0xffff)
              break
            }
            const unlockedIndex = locked[requirePokemonRuntime(state).rng.nextU16() % locked.length]!
            const trendyWord = requirePokemonRuntime(state).easyChatCatalog?.categories[9]?.words[unlockedIndex]
            if (!trendyWord) throw new Error(`Le mot branché ROM ${unlockedIndex} est absent du catalogue Easy Chat.`)
            state.easyChatTrendySayings.add(unlockedIndex)
            state.variables.set(destination, unlockedIndex)
            state.buffers.set(bufferId, trendyWord.text)
            break
          }
          case 523: {
            requireBytes(bytes, cursor, 10, opcode)
            const operands = Array.from({ length: 5 }, (_, index) => {
              const value = view.getUint16(cursor + index * 2, true)
              return value >= 0x4000 ? readVariable(value) : value
            })
            cursor += 10
            return { kind: 'objectEffect', action: 'moveTask', objectIds: [operands[0]!], parameters: operands.slice(1) }
          }
          case 546: {
            requireBytes(bytes, cursor, 3, opcode)
            const mode = bytes[cursor]
            if (mode > 1) throw new Error(`Mode HGSS 546 invalide: ${mode}.`)
            const expected = mode === 0 ? 0x06f2 : 0xad7c
            state.variables.set(view.getUint16(cursor + 1, true), readVariable(0x4043 + mode) === expected ? 1 : 0)
            cursor += 3
            break
          }
          case 554: {
            requireBytes(bytes, cursor, 2, opcode)
            state.variables.set(view.getUint16(cursor, true), state.battlePoints)
            cursor += 2
            break
          }
          case 555:
          case 556: {
            requireBytes(bytes, cursor, 2, opcode)
            const amountValue = view.getUint16(cursor, true)
            const amount = amountValue >= 0x4000 ? readVariable(amountValue) : amountValue
            if (opcode === 555) {
              state.battlePoints = Math.min(9999, state.battlePoints + amount)
              state.battlePointsReceived = Math.min(65535, state.battlePointsReceived + amount)
            } else {
              state.battlePoints = state.battlePoints < amount ? 0 : state.battlePoints - amount
              state.battlePointsSpent = Math.min(65535, state.battlePointsSpent + amount)
            }
            cursor += 2
            break
          }
          case 557: {
            requireBytes(bytes, cursor, 4, opcode)
            const amountValue = view.getUint16(cursor, true)
            const amount = amountValue >= 0x4000 ? readVariable(amountValue) : amountValue
            state.variables.set(view.getUint16(cursor + 2, true), state.battlePoints >= amount ? 1 : 0)
            cursor += 4
            break
          }
          case 545: {
            requireBytes(bytes, cursor, 2, opcode)
            state.variables.set(view.getUint16(cursor, true), state.pokedex.seenForms.get(201)?.length ?? 0)
            cursor += 2
            break
          }
          case 561: {
            requireBytes(bytes, cursor, 8, opcode)
            const readOperand = (offset: number): number => {
              const value = view.getUint16(offset, true)
              return value >= 0x4000 ? readVariable(value) : value
            }
            const step: FieldScriptStep = {
              kind: 'screenShake',
              x: readOperand(cursor),
              y: readOperand(cursor + 2),
              repeats: readOperand(cursor + 4),
              durationFrames: readOperand(cursor + 6),
            }
            cursor += 8
            return step
          }
          case 562: {
            requireBytes(bytes, cursor, 7, opcode)
            const readTrainerId = (offset: number): number => {
              const value = view.getUint16(offset, true)
              return value >= 0x4000 ? readVariable(value) : value
            }
            const allyTrainerId = readTrainerId(cursor)
            const opponentTrainerIds = [readTrainerId(cursor + 2), readTrainerId(cursor + 4)] as const
            const battleParameter = bytes[cursor + 6]!
            cursor += 7
            lastBattleWon = undefined
            state.lastBattleWon = undefined
            awaitingBattle = true
            return {
              kind: 'battle',
              battle: { kind: 'multiTrainer', allyTrainerId, opponentTrainerIds, battleParameter },
            }
          }
          case 565: {
            requireBytes(bytes, cursor, 2, opcode)
            const destination = view.getUint16(cursor, true)
            cursor += 2
            const request: HgssMultiplayerRequest = {
              ...multiplayerRequestBase(opcode, commandOffset),
              kind: 'friend-roster-count',
            }
            return suspendMultiplayer(request, (result) => {
              const count = Math.max(0, Math.min(32, result.friendRosterCount ?? result.romResult))
              state.friendRosterCount = count
              state.variables.set(destination, count)
            })
          }
          case 564: {
            requireBytes(bytes, cursor, 2, opcode)
            const destination = view.getUint16(cursor, true)
            cursor += 2
            const request: HgssMultiplayerRequest = {
              ...multiplayerRequestBase(opcode, commandOffset),
              kind: 'profile-status',
            }
            return suspendMultiplayer(request, (result) => state.variables.set(destination, result.romResult))
          }
          case 386: {
            requireBytes(bytes, cursor, 2, opcode)
            const variableId = view.getUint16(cursor, true)
            cursor += 2
            state.variables.set(variableId, encodeHgssPlayerDirection(state.player.direction))
            break
          }
          case 340: {
            requireBytes(bytes, cursor, 4, opcode)
            const objectId = readScriptValue(cursor)
            const movement = readScriptValue(cursor + 2)
            cursor += 4
            setFieldScriptObjectState(state, objectId, { movement })
            break
          }
          case 551: {
            requireBytes(bytes, cursor, 2, opcode)
            const initialSlot = readScriptValue(cursor)
            cursor += 2
            pendingPartySelection = { initialSlot }
            partyMenuResult = undefined
            return {
              kind: 'choice',
              options: [
                ...state.party.members.map((pokemon, value) => ({
                  label: `${pokemon.nickname ?? pokemon.speciesName} · Nv.${pokemon.level} · PV ${pokemon.currentHp}/${pokemon.stats.hp}`,
                  value,
                })),
                { label: 'Retour', value: 0xfffe },
              ],
              cancellable: true,
              presentation: 'party',
            }
          }
          case 552: {
            requireBytes(bytes, cursor, 4, opcode)
            if (!partyMenuResult) throw new Error('ScrCmd_552 HGSS est exécuté sans résultat du sélecteur d’équipe.')
            state.variables.set(view.getUint16(cursor, true), partyMenuResult.slot)
            state.variables.set(view.getUint16(cursor + 2, true), partyMenuResult.selectedAction === 0 ? 0 : 1)
            partyMenuResult = undefined
            cursor += 4
            break
          }
          case 627: {
            requireBytes(bytes, cursor, 1, opcode)
            const mode = bytes[cursor]!
            cursor += 1
            const facilityByMode = new Map<number, number>([[3, 2], [5, 1], [6, 1], [9, 3], [11, 4], [15, 5]])
            const facilityId = facilityByMode.get(mode) ?? 1
            awaitingFrontierRecordsApp = true
            return {
              kind: 'frontierRecordsApp',
              page: createHgssFrontierRecordPage(
                facilityId,
                0,
                0,
                state.frontierRecords,
                state.pokemonRuntime?.catalog.speciesNames,
              ),
            }
          }
          case 628: {
            requireBytes(bytes, cursor, 4, opcode)
            const mode = readScriptValue(cursor)
            const levelMode = readScriptValue(cursor + 2)
            cursor += 4
            resetHgssFrontierFacility(state, 'factory', mode, levelMode)
            break
          }
          case 636:
          case 640:
          case 646: {
            requireBytes(bytes, cursor, 2, opcode)
            const mode = readScriptValue(cursor)
            cursor += 2
            resetHgssFrontierFacility(state, opcode === 636 ? 'hall' : opcode === 640 ? 'castle' : 'arcade', mode)
            break
          }
          case 631: {
            requireBytes(bytes, cursor, 6, opcode)
            const viewIndex = readScriptValue(cursor)
            const facilityId = readScriptValue(cursor + 2)
            const recordIndex = readScriptValue(cursor + 4)
            cursor += 6
            awaitingFrontierRecordsApp = true
            return {
              kind: 'frontierRecordsApp',
              page: createHgssFrontierRecordPage(
                facilityId,
                viewIndex,
                recordIndex,
                state.frontierRecords,
                state.pokemonRuntime?.catalog.speciesNames,
              ),
            }
          }
          case 633:
          case 637:
          case 643: {
            requireBytes(bytes, cursor, 6, opcode)
            const command = view.getUint16(cursor, true)
            const argument = readScriptValue(cursor + 2)
            const resultVariable = view.getUint16(cursor + 4, true)
            cursor += 6
            const facility = opcode === 633 ? 'hall' : opcode === 637 ? 'castle' : 'arcade'
            if (command === 0) {
              const valid = facility === 'hall'
                ? isHgssPartyValidForBattleHall(state.party, argument)
                : isHgssPartyValidForBattleFrontier(state.party, argument, false)
              state.variables.set(resultVariable, valid ? 1 : 0)
              break
            }
            if (command === 4) {
              const requiredCount = facility === 'hall'
                ? (argument === 1 ? 2 : 1)
                : (argument === 2 ? 2 : 3)
              pendingFrontierPartySelection = {
                facility,
                requiredCount,
                eligibleSlots: getHgssBattleFacilityEligiblePartySlots(state.party, facility),
                selectedSlots: [],
              }
              frontierPartySelectionResult = undefined
              return createFrontierPartySelectionStep()
            }
            throw new Error(`Opcode HGSS ${opcode} sous-commande ${command} non pris en charge a l’offset ${commandOffset}.`)
          }
          case 635:
          case 639:
          case 645: {
            const outputCount = opcode === 635 ? 2 : 3
            requireBytes(bytes, cursor, outputCount * 2, opcode)
            if (!frontierPartySelectionResult) throw new Error(`ScrCmd_${opcode} HGSS exécuté sans sélection Frontier.`)
            const result = frontierPartySelectionResult
            frontierPartySelectionResult = undefined
            if (result.cancelled) {
              state.variables.set(view.getUint16(cursor, true), 255)
            } else {
              for (let index = 0; index < outputCount; index += 1) {
                state.variables.set(view.getUint16(cursor + index * 2, true), result.slots[index] ?? 0)
              }
            }
            cursor += outputCount * 2
            break
          }
          case 602: {
            requireBytes(bytes, cursor, 2, opcode)
            const mode = view.getUint16(cursor, true)
            cursor += 2
            if (state.followMonActive) {
              state.followMonMovementPaused = mode !== 0
              return { kind: 'followerMovement', action: 'pause', paused: state.followMonMovementPaused }
            }
            break
          }
          case 601:
            if (state.followMonActive) return { kind: 'followerMovement', action: 'facePlayer' }
            break
          case 603:
            if (state.followMonActive) return { kind: 'waiting', waitFor: 'followerMovement' }
            break
          case 604: {
            requireBytes(bytes, cursor, 2, opcode)
            const movement = view.getUint16(cursor, true)
            cursor += 2
            if (state.followMonActive) return { kind: 'followerMovement', action: 'movement', movement }
            break
          }
          case 605: {
            requireBytes(bytes, cursor, 2, opcode)
            const parameters = [bytes[cursor]!, bytes[cursor + 1]!] as const
            cursor += 2
            if (state.followMonActive) return { kind: 'followerMovement', action: 'configure', parameters }
            break
          }
          case 608:
            if (state.followMonActive) return { kind: 'followerMovement', action: 'refresh' }
            break
          case 596: {
            requireBytes(bytes, cursor, 2, opcode)
            const destination = view.getUint16(cursor, true)
            const selection = resolvePokemonFollowerSelection(
              state.party,
              { id: map.id, followMode: map.header.followMode },
              requirePokemonRuntime(state).catalog.followers,
            )
            const modelIndex = selection
              ? requirePokemonRuntime(state).catalog.followers.modelIndexBySpecies[selection.pokemon.speciesId]
              : undefined
            const parameter = modelIndex === undefined
              ? undefined
              : requirePokemonRuntime(state).catalog.followers.parameters[modelIndex]
            // ov01_022055DC lit le parametre 1 du MapObject follower puis
            // retourne ses bits 8..11, pas les quatre bits faibles.
            state.variables.set(destination, state.followMonActive && parameter ? (parameter.values[1] >> 8) & 0x0f : 0)
            cursor += 2
            break
          }
          case 597:
            if (state.followMonActive) return { kind: 'followerMovement', action: 'refresh' }
            break
          case 598: {
            requireBytes(bytes, cursor, 2, opcode)
            const mode = view.getUint16(cursor, true)
            cursor += 2
            if (mode !== 1 && mode !== 2) throw new Error(`Mode follower HGSS ${mode} invalide pour ScrCmd_598.`)
            // La tâche native fait effectuer une courte animation coordonnée
            // au joueur et au suiveur. Elle ne modifie aucun état de quête;
            // le renderer reconstruit leurs poses depuis leurs états vivants.
            if (state.followMonActive) return { kind: 'followerMovement', action: 'refresh' }
            break
          }
          case 606:
          case 607:
            // Toutes deux replacent l'objet autorisé sur le joueur; seule 606
            // pose deux bits transitoires. Aucune ne change sa visibilité.
            if (state.followMonActive) return { kind: 'followerMovement', action: 'refresh' }
            break
          case 711: {
            const selection = resolvePokemonFollowerSelection(
              state.party,
              { id: map.id, followMode: map.header.followMode },
              requirePokemonRuntime(state).catalog.followers,
            )
            if (!state.followMonActive || !selection?.visible) {
              throw new Error('FollowMonInteract 711 ne trouve aucun Pokémon suiveur visible.')
            }
            return { kind: 'followerInteraction', slot: selection.slot, speciesId: selection.pokemon.speciesId }
          }
          case 582:
            requireBytes(bytes, cursor, 6, opcode)
            cursor += 6
            break
          case 587:
            // sub_020582A8 ferme proprement la session locale DS puis attend
            // la fin de la pile communication.
            return { kind: 'specialCutscene', effect: 'linkReturn', parameter: 0 }
          case 615: { requireBytes(bytes, cursor, 2, opcode); const step = photoApps.launchCapture(view.getUint16(cursor, true)); cursor += 2; return step }
          case 616: cursor = runHgssPhotoImmediateOpcode(616, state, bytes, cursor); break
          case 617: return photoApps.launchAlbum()
          case 614: {
            requireBytes(bytes, cursor, 2, opcode)
            const destination = view.getUint16(cursor, true)
            const contactId = state.activePhoneContact?.id
            const itemId = contactId === undefined ? 0 : state.phoneGiftItems.get(contactId) ?? 0
            if (contactId !== undefined) state.phoneGiftItems.delete(contactId)
            state.variables.set(destination, itemId)
            cursor += 2
            break
          }
          case 618: cursor = runHgssPhotoImmediateOpcode(618, state, bytes, cursor); break
          case 619:
            requireBytes(bytes, cursor, 2, opcode)
            state.variables.set(view.getUint16(cursor, true), state.flags.has(0x969) ? 1 : 0)
            cursor += 2
            break
          case 620: {
            requireBytes(bytes, cursor, 1, opcode)
            if (bytes[cursor]) state.flags.add(0x969)
            else state.flags.delete(0x969)
            cursor += 1
            break
          }
          case 622: {
            requireBytes(bytes, cursor, 4, opcode)
            const objectId = view.getUint16(cursor, true)
            const destination = view.getUint16(cursor + 2, true)
            state.variables.set(destination, encodeHgssPlayerDirection(getFieldScriptActorState(state, objectId)?.direction ?? 'north'))
            cursor += 4
            break
          }
          case 623: {
            requireBytes(bytes, cursor, 2, opcode)
            const destination = view.getUint16(cursor, true)
            cursor += 2
            refreshApricornTreesForCurrentDay(state)
            const interactedObjectId = actorId ?? state.variables.get(0x800d)
            const object = interactedObjectId === undefined
              ? undefined
              : map.events?.objects.find((candidate) => candidate.id === interactedObjectId)
            const treeIndex = object?.parameters?.[0]
            const apricornType = treeIndex === undefined ? undefined : resolveHgssApricornType(treeIndex)
            if (interactedObjectId === undefined || !object || treeIndex === undefined || apricornType === undefined
              || object.spriteId < 262 || object.spriteId > 269
              || state.harvestedApricornTrees.has(treeIndex)) {
              state.variables.set(destination, 0)
              break
            }
            state.harvestedApricornTrees.add(treeIndex)
            state.variables.set(destination, 1)
            return { kind: 'apricornTree', objectId: interactedObjectId, treeIndex, apricornType }
          }
          case 624: {
            requireBytes(bytes, cursor, 2, opcode)
            const destination = view.getUint16(cursor, true)
            const interactedObjectId = actorId ?? state.variables.get(0x800d)
            const treeIndex = interactedObjectId === undefined
              ? undefined
              : map.events?.objects.find((candidate) => candidate.id === interactedObjectId)?.parameters?.[0]
            const apricornType = treeIndex === undefined ? undefined : resolveHgssApricornType(treeIndex)
            if (apricornType === undefined) throw new Error(`L'arbre Noigrume HGSS actif ne possède aucun index ROM valide.`)
            state.variables.set(destination, apricornType)
            cursor += 2
            break
          }
          case 625: {
            requireBytes(bytes, cursor, 6, opcode)
            const apricornType = readScriptValue(cursor)
            const quantity = readScriptValue(cursor + 2)
            const destination = view.getUint16(cursor + 4, true)
            const current = state.apricornBox[apricornType]
            if (current === undefined) throw new Error(`Type de Noigrume HGSS ${apricornType} invalide.`)
            const accepted = current + quantity <= 99
            if (accepted) state.apricornBox[apricornType] = current + quantity
            state.variables.set(destination, accepted ? 1 : 0)
            cursor += 6
            break
          }
          case 626: {
            requireBytes(bytes, cursor, 3, opcode)
            const bufferId = bytes[cursor]!
            const apricornType = readScriptValue(cursor + 1)
            const name = scriptMap.externalMessages?.[21]?.[7 + apricornType]
            if (apricornType < 0 || apricornType >= 7 || name === undefined) {
              throw new Error(`Nom ROM du Noigrume HGSS ${apricornType} absent.`)
            }
            state.buffers.set(bufferId, name)
            cursor += 3
            break
          }
          case 844: {
            requireBytes(bytes, cursor, 3, opcode)
            const bufferId = bytes[cursor]
            const itemValue = view.getUint16(cursor + 1, true)
            const itemId = itemValue >= 0x4000 ? readVariable(itemValue) : itemValue
            state.buffers.set(bufferId, getItem(state, itemId).name)
            cursor += 3
            break
          }
          case 845: {
            requireBytes(bytes, cursor, 3, opcode)
            const bufferId = bytes[cursor]
            const slotValue = view.getUint16(cursor + 1, true)
            const slot = slotValue >= 0x4000 ? readVariable(slotValue) : slotValue
            const speciesId = getPokemonPartyMember(state.party, slot)?.speciesId
            if (speciesId === undefined) {
              throw new Error(`Le Pokémon d’équipe ${slot} demandé par BufferPartyMonSpeciesNameIndef est absent.`)
            }
            state.buffers.set(bufferId, getSpeciesName(state, speciesId))
            cursor += 3
            break
          }
          case 846: {
            requireBytes(bytes, cursor, 6, opcode)
            const bufferId = bytes[cursor]!
            const speciesId = readScriptValue(cursor + 1)
            cursor += 6
            state.buffers.set(bufferId, getSpeciesName(state, speciesId))
            break
          }
          case 849: {
            requireBytes(bytes, cursor, 3, opcode)
            const bufferId = bytes[cursor]
            const trainerClassValue = view.getUint16(cursor + 1, true)
            const trainerClassId = trainerClassValue >= 0x4000 ? readVariable(trainerClassValue) : trainerClassValue
            const trainerClassName = requirePokemonRuntime(state).trainerClassNames?.[trainerClassId]
            if (trainerClassName === undefined) {
              throw new Error(`La classe de Dresseur ROM ${trainerClassId} demandée par BufferTrainerClassNameIndef est absente.`)
            }
            state.buffers.set(bufferId, trainerClassName)
            cursor += 3
            break
          }
          case 851: {
            requireBytes(bytes, cursor, 1, opcode)
            const bufferId = bytes[cursor]!
            const value = state.buffers.get(bufferId) ?? ''
            const characters = Array.from(value)
            if (characters.length > 0) {
              characters[0] = characters[0]!.toLocaleUpperCase('fr-FR')
              state.buffers.set(bufferId, characters.join(''))
            }
            cursor += 1
            break
          }
          case 621: {
            state.mapProps = resolveStarterBallMapProps(state)
            return { kind: 'mapProps', props: state.mapProps.map((prop) => ({ ...prop })) }
          }
          case 729: {
            requireBytes(bytes, cursor, 2, opcode)
            const variableId = view.getUint16(cursor, true)
            cursor += 2
            state.variables.set(variableId, state.followMonActive ? 1 : 0)
            break
          }
          case 727: {
            requireBytes(bytes, cursor, 2, opcode)
            const variableId = view.getUint16(cursor, true)
            cursor += 2
            state.variables.set(variableId, getFirstUsablePokemonPartySlot(state.party))
            break
          }
          case 730: {
            requireBytes(bytes, cursor, 2, opcode)
            const variableId = view.getUint16(cursor, true)
            cursor += 2
            if (!state.followMonActive) state.variables.set(variableId, 1)
            else {
              const mapObject = readFollowerMapObjectSignal()
              state.variables.set(variableId, mapObject.present && mapObject.visible ? 1 : 0)
            }
            break
          }
          case 732: {
            requireBytes(bytes, cursor, 1, opcode)
            state.followerMood += new Int8Array([bytes[cursor]!])[0]
            cursor += 1
            break
          }
          case 733: {
            requireBytes(bytes, cursor, 3, opcode)
            const destination = view.getUint16(cursor + 1, true)
            cursor += 3
            state.variables.set(destination, state.followMonActive ? 1 : 0)
            break
          }
          case 734:
            requireBytes(bytes, cursor, 1, opcode)
            cursor += 1
            return { kind: 'waiting', waitFor: 'timer', frames: 1 }
          case 682: {
            requireBytes(bytes, cursor, 2, opcode)
            // Vérification interne des tailles de heaps DS, sans état de jeu.
            const actionValue = view.getUint16(cursor, true)
            if (actionValue >= 0x4000) readVariable(actionValue)
            cursor += 2
            break
          }
          case 688: {
            requireBytes(bytes, cursor, 4, opcode)
            const destination = view.getUint16(cursor, true)
            const speciesValue = view.getUint16(cursor + 2, true)
            const speciesId = speciesValue >= 0x4000 ? readVariable(speciesValue) : speciesValue
            const slot = state.party.members.findIndex((pokemon) => (
              !pokemon.isEgg && pokemon.speciesId === speciesId && pokemon.fatefulEncounter
            ))
            state.variables.set(destination, slot < 0 ? 0xff : slot)
            cursor += 4
            break
          }
          case 689: {
            requireBytes(bytes, cursor, 2, opcode)
            const destination = view.getUint16(cursor, true)
            const griseousOrbItemId = 112
            const holders = state.party.members.filter((pokemon) => pokemon.heldItemId === griseousOrbItemId)
            if (holders.length > 0 && !addBagItem(state.inventory, getItemCatalog(state), griseousOrbItemId, holders.length)) {
              state.variables.set(destination, 0xff)
              cursor += 2
              break
            }
            for (const pokemon of holders) pokemon.heldItemId = 0
            for (const pokemon of state.party.members) {
              if (pokemon.form > 0 && (pokemon.speciesId === 479 || pokemon.speciesId === 487 || pokemon.speciesId === 492)) {
                pokemon.form = 0
              }
            }
            state.variables.set(destination, 0)
            cursor += 2
            break
          }
          case 683: {
            requireBytes(bytes, cursor, 2, opcode)
            if (lastBattleWon === undefined) throw new Error("GetStaticEncounterOutcome HGSS est exécuté sans résultat de combat.")
            state.variables.set(view.getUint16(cursor, true), lastBattleWon ? 1 : 0)
            cursor += 2
            break
          }
          case 684:
            requireBytes(bytes, cursor, 2, opcode)
            state.variables.set(view.getUint16(cursor, true), state.weather); cursor += 2
            break
          case 691: {
            requireBytes(bytes, cursor, 2, opcode)
            const elapsedMs = (state.pokemonRuntime?.now().getTime() ?? Date.now()) - state.mapLoadedAtMs
            state.variables.set(view.getUint16(cursor, true), elapsedMs >= 120_000 ? 1 : 0)
            cursor += 2
            break
          }
          case 600:
            // La commande native attend la fin de l'effet lancé par 599.
            // Aucun effet DS n'est actif dans le renderer mono-écran.
            break
          case 599:
            return { kind: 'followerMovement', action: 'refresh' }
          case 357: {
            requireBytes(bytes, cursor, 4, opcode)
            const destination = view.getUint16(cursor, true)
            const excludedValue = view.getUint16(cursor + 2, true)
            const excludedSlot = excludedValue >= 0x4000 ? readVariable(excludedValue) : excludedValue
            const alive = state.party.members.reduce((count, pokemon, slot) => (
              slot !== excludedSlot && !pokemon.isEgg && pokemon.currentHp > 0 ? count + 1 : count
            ), 0)
            state.variables.set(destination, alive)
            cursor += 4
            break
          }
          case 389: {
            requireBytes(bytes, cursor, 4, opcode)
            const destination = view.getUint16(cursor, true)
            const speciesValue = view.getUint16(cursor + 2, true)
            const speciesId = speciesValue >= 0x4000 ? readVariable(speciesValue) : speciesValue
            state.variables.set(destination, state.party.members.some((pokemon) => !pokemon.isEgg && pokemon.speciesId === speciesId) ? 1 : 0)
            cursor += 4
            break
          }
          case 396: {
            requireBytes(bytes, cursor, 4, opcode)
            const destination = view.getUint16(cursor, true)
            const slot = readScriptValue(cursor + 2)
            const pokemon = getPokemonPartyMember(state.party, slot)
            state.variables.set(destination, !pokemon || pokemon.isEgg ? 0 : pokemon.moves.length)
            cursor += 4
            break
          }
          case 394: {
            requireBytes(bytes, cursor, 2, opcode)
            const slot = readScriptValue(cursor)
            const pokemon = getPokemonPartyMember(state.party, slot)
            if (!pokemon || pokemon.isEgg) throw new Error(`Le Pokémon ${slot} ne peut pas ouvrir l’écran de suppression HGSS.`)
            pendingMoveDeletion = { slot }
            moveDeletionResult = undefined
            cursor += 2
            return createMoveDeletionStep()
          }
          case 395: {
            requireBytes(bytes, cursor, 2, opcode)
            if (moveDeletionResult === undefined) throw new Error('Le résultat de suppression de capacité HGSS est absent.')
            state.variables.set(view.getUint16(cursor, true), moveDeletionResult)
            moveDeletionResult = undefined
            cursor += 2
            break
          }
          case 397: {
            requireBytes(bytes, cursor, 4, opcode)
            const slot = readScriptValue(cursor)
            const moveSlot = readScriptValue(cursor + 2)
            const pokemon = getPokemonPartyMember(state.party, slot)
            if (!pokemon || pokemon.isEgg || moveSlot < 0 || moveSlot >= pokemon.moves.length) {
              throw new Error(`La capacité ${moveSlot} du Pokémon ${slot} ne peut pas être oubliée.`)
            }
            pokemon.moves.splice(moveSlot, 1)
            cursor += 4
            break
          }
          case 398: {
            requireBytes(bytes, cursor, 6, opcode)
            const destination = view.getUint16(cursor, true)
            const slot = readScriptValue(cursor + 2)
            const moveSlot = readScriptValue(cursor + 4)
            state.variables.set(destination, getPokemonPartyMember(state.party, slot)?.moves[moveSlot]?.moveId ?? 0)
            cursor += 6
            break
          }
          case 399: {
            requireBytes(bytes, cursor, 5, opcode)
            const bufferId = bytes[cursor]!
            const slot = readScriptValue(cursor + 1)
            const moveSlot = readScriptValue(cursor + 3)
            const move = getPokemonPartyMember(state.party, slot)?.moves[moveSlot]
            if (!move) throw new Error(`Le nom de la capacité ${moveSlot} du Pokémon ${slot} est absent.`)
            const moveName = requirePokemonRuntime(state).catalog.moveNames[move.moveId]
            if (!moveName) throw new Error(`Le nom ROM de la capacité ${move.moveId} est absent.`)
            state.buffers.set(bufferId, moveName)
            cursor += 5
            break
          }
          case 480: {
            requireBytes(bytes, cursor, 6, opcode)
            const destination = view.getUint16(cursor, true)
            const slotValue = view.getUint16(cursor + 2, true)
            const ribbonValue = view.getUint16(cursor + 4, true)
            const slot = slotValue >= 0x4000 ? readVariable(slotValue) : slotValue
            const ribbonId = ribbonValue >= 0x4000 ? readVariable(ribbonValue) : ribbonValue
            state.variables.set(destination, getPokemonPartyMember(state.party, slot)?.ribbonIds.includes(ribbonId) ? 1 : 0)
            cursor += 6
            break
          }
          case 481: {
            requireBytes(bytes, cursor, 4, opcode)
            const slot = readScriptValue(cursor)
            const ribbonId = readScriptValue(cursor + 2)
            const pokemon = getPokemonPartyMember(state.party, slot)
            if (!pokemon) throw new Error(`Le Pokémon d'équipe ${slot} demandé par GiveRibbon est absent.`)
            if (!pokemon.ribbonIds.includes(ribbonId)) pokemon.ribbonIds.push(ribbonId)
            cursor += 4
            break
          }
          case 483: {
            requireBytes(bytes, cursor, 4, opcode)
            const destination = view.getUint16(cursor, true)
            const slot = readScriptValue(cursor + 2)
            const pokemon = getPokemonPartyMember(state.party, slot)
            state.variables.set(destination, pokemon
              ? Object.values(pokemon.effortValues).reduce((total, value) => total + value, 0)
              : 0)
            cursor += 4
            break
          }
          case 484: {
            requireBytes(bytes, cursor, 2, opcode)
            state.variables.set(view.getUint16(cursor, true), resolveHgssWeekday(requirePokemonRuntime(state).now()))
            cursor += 2
            break
          }
          case 490:
          case 491:
            requireBytes(bytes, cursor, 2, opcode)
            cursor += 2
            break
          case 495: {
            requireBytes(bytes, cursor, 2, opcode)
            state.variables.set(view.getUint16(cursor, true), requirePokemonRuntime(state).gameVersion)
            cursor += 2
            break
          }
          case 497: {
            requireBytes(bytes, cursor, 6, opcode)
            const type1Variable = view.getUint16(cursor, true)
            const type2Variable = view.getUint16(cursor + 2, true)
            const slot = readScriptValue(cursor + 4)
            const pokemon = getPokemonPartyMember(state.party, slot)
            const types = pokemon && requirePokemonRuntime(state).catalog.personalData[pokemon.speciesId]?.types
            state.variables.set(type1Variable, types?.[0] ?? 0)
            state.variables.set(type2Variable, types?.[1] ?? 0)
            cursor += 6
            break
          }
          case 450: {
            const request: HgssMultiplayerRequest = {
              ...multiplayerRequestBase(opcode, commandOffset),
              kind: 'geonet-app',
            }
            return suspendMultiplayer(request)
          }
          case 449:
            return { kind: 'specialCutscene', effect: 'linkReturn', parameter: 1 }
          case 452: {
            requireBytes(bytes, cursor, 4, opcode)
            const speciesId = readScriptValue(cursor)
            const gender = readScriptValue(cursor + 2)
            cursor += 4
            const runtime = requirePokemonRuntime(state)
            const pokemon = createCanonicalPokemon(runtime.catalog, {
              speciesId,
              level: 50,
              rng: runtime.rng,
              personality: { kind: 'fixed', value: gender === 0 ? 0 : 0xff },
              individualValues: { kind: 'fixed', value: 0 },
              originalTrainer: runtime.trainer,
              origin: { language: runtime.language, gameVersion: runtime.gameVersion, metLocation: 0, metLevel: 50, metTerrain: 0 },
              ballId: 4,
            })
            markPokemonSeen(state.pokedex, pokemon)
            return { kind: 'pokemonPortrait', action: 'show', speciesId, gender }
          }
          case 453:
            return { kind: 'pokemonPortrait', action: 'hide' }
          case 454: {
            // ov26_022599D8 remplace le mouvement autonome du dernier objet
            // interpelle juste avant TrainerBattle. Pour un duo, la ROM fait
            // la meme chose sur le second objet partageant le numero de
            // Dresseur. La commande ne suspend pas le script.
            const objectId = state.variables.get(0x800d)
            const actor = objectId === undefined ? undefined : getFieldScriptActorState(state, objectId)
            if (!actor || objectId === undefined) break
            const movementByDirection: Record<PlayerDirection, number> = {
              north: 14,
              south: 15,
              west: 16,
              east: 17,
            }
            setFieldScriptObjectState(state, objectId, { movement: movementByDirection[actor.direction] })

            const interacted = map.events?.objects.find((object) => object.id === objectId)
            const trainerId = interacted && trainerIdFromStandardScriptId(interacted.scriptId)
            if (trainerId !== undefined && state.pokemonRuntime?.trainerCatalog?.[trainerId]?.doubleBattle) {
              const partner = map.events?.objects.find((object) => (
                object.id !== objectId
                && trainerIdFromStandardScriptId(object.scriptId) === trainerId
                && [1, 2, 4, 5, 6, 7, 8].includes(object.type)
              ))
              if (partner) {
                const partnerActor = getFieldScriptActorState(state, partner.id)
                if (partnerActor) setFieldScriptObjectState(state, partner.id, { movement: movementByDirection[partnerActor.direction] })
              }
            }
            break
          }
          case 507: {
            requireBytes(bytes, cursor, 2, opcode)
            const occupied = state.pokemonStorage.boxes.reduce((count, box) => count + box.filter(Boolean).length, 0)
            state.variables.set(view.getUint16(cursor, true), hgssStorageBoxCount * hgssStorageBoxCapacity - occupied)
            cursor += 2
            break
          }
          case 486:
            // Entrée Dummy officielle conservée entre le menu de règlement
            // et PokeCenAnim. Elle ne possède aucun opérande ni effet natif.
            break
          case 511: {
            requireBytes(bytes, cursor, 4, opcode)
            const scoreType = readScriptValue(cursor)
            const destination = view.getUint16(cursor + 2, true)
            cursor += 4
            const scores = [state.palPark.catchingPoints, state.palPark.timePoints, state.palPark.typePoints]
            if (scoreType < 0 || scoreType > 3) throw new Error(`Type de score Parc des Amis HGSS ${scoreType} invalide.`)
            state.variables.set(destination, scoreType === 3 ? scores.reduce((sum, value) => sum + value, 0) : scores[scoreType]!)
            break
          }
          case 512:
          case 513:
            // La ROM suspend les deux commandes pendant qu'un SysTask garde
            // puis restaure l'animation de marche du joueur autour du menu de
            // sauvegarde. Le web n'a pas ce SysTask DS, mais conserve la
            // frontière asynchrone exacte sans modifier l'état de scénario.
            return { kind: 'waiting', waitFor: 'timer', frames: 1 }
          case 514: {
            requireBytes(bytes, cursor, 2, opcode)
            const kind = readScriptValue(cursor)
            cursor += 2
            return { kind: 'specialCutscene', effect: 'hallOfFame', parameter: kind }
          }
          case 508: {
            requireBytes(bytes, cursor, 2, opcode)
            const action = readScriptValue(cursor)
            cursor += 2
            if (action === 2) {
              // Save_VarsFlags_SetPalParkSysFlag + CatchingShow_ClearState.
              state.flags.add(0x971)
              state.palPark.catchingShowActive = false
            } else if (action === 0) {
              state.palPark.catchingShowActive = true
            } else if (action === 1) {
              state.flags.delete(0x971)
              state.palPark.catchingShowActive = false
            } else {
              throw new Error(`PalParkAction HGSS ${action} invalide.`)
            }
            break
          }
          case 509: {
            requireBytes(bytes, cursor, 2, opcode)
            state.variables.set(view.getUint16(cursor, true), state.palPark.migratedPokemon.length === 6 ? 1 : 0)
            cursor += 2
            break
          }
          case 510: {
            if (state.palPark.migratedPokemon.length !== 6) {
              // Le script natif protège cette commande avec ScrCmd_509. Un
              // endpoint audité isolément conserve simplement le bloc vide.
              break
            }
            const storage = clonePokemonStorage(state.pokemonStorage)
            const now = state.pokemonRuntime?.now() ?? new Date()
            const received: CanonicalPokemon[] = []
            for (const migrated of state.palPark.migratedPokemon) {
              const pokemon = cloneCanonicalPokemon(migrated)
              pokemon.origin = {
                ...pokemon.origin,
                metLocation: 55,
                metLevel: pokemon.level,
                metDate: { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() },
              }
              if (!placePokemonInFirstStorageSlot(storage, pokemon)) {
                throw new Error('Le PC ne contient pas six places libres pour le Parc des Amis.')
              }
              received.push(pokemon)
            }
            state.pokemonStorage = storage
            for (const pokemon of received) markPokemonCaught(state.pokedex, pokemon, state.pokemonRuntime?.language)
            state.palPark.migratedPokemon = []
            break
          }
          case 584: {
            requireBytes(bytes, cursor, 2, opcode)
            // L'état canonique ne peut pas contenir le checksum corrompu que
            // la routine DS recherche ici.
            state.variables.set(view.getUint16(cursor, true), 0)
            cursor += 2
            break
          }
          case 590: {
            requireBytes(bytes, cursor, 2, opcode)
            const nationalMythicals = new Set([151, 251, 385, 386, 489, 490, 491, 492, 493])
            const nationalOwned = [...state.pokedex.caughtSpeciesIds].reduce((count, speciesId) => (
              count + (speciesId >= 1 && speciesId <= 493 && !nationalMythicals.has(speciesId) ? 1 : 0)
            ), 0)
            const hasFrontierRecord = [0, 2, 4, 6, 8].some((record) => (state.frontierRecords.get(record) ?? 0) >= 100)
            const stars = Number(state.flags.has(0x964))
              + Number(nationalOwned >= 484)
              + Number(hasFrontierRecord)
              + Number(state.flags.has(0x0f1))
              + Number(state.flags.has(0x184))
            state.variables.set(view.getUint16(cursor, true), stars)
            cursor += 2
            break
          }
          case 593:
            return { kind: 'fieldOverlay', overlay: 'saveStats', action: 'show' }
          case 594:
            return { kind: 'fieldOverlay', overlay: 'saveStats', action: 'hide' }
          case 574: {
            requireBytes(bytes, cursor, 4, opcode)
            const destination = view.getUint16(cursor, true)
            const objectValue = view.getUint16(cursor + 2, true)
            const objectId = objectValue >= 0x4000 ? readVariable(objectValue) : objectValue
            state.variables.set(destination, getFieldScriptActorState(state, objectId)?.movement ?? 0)
            cursor += 4
            break
          }
          case 783:
            requireBytes(bytes, cursor, 1, opcode)
            state.followMonInhibited = bytes[cursor] !== 0
            cursor += 1
            break
          case 784:
            requireBytes(bytes, cursor, 2, opcode)
            // Chargement/déchargement d'overlays de commandes sur DS. Leurs
            // commandes restent décodées par ce routeur unique dans le port.
            cursor += 2
            break
          case 814:
            state.flags.add(0x99a)
            break
          case 810:
            // FieldSystem_BeginCelebiTimeTravelCutsceneTask suspend le script
            // jusqu'a la fin de l'effet avant le warp vers la Route 22.
            return { kind: 'specialCutscene', effect: 'celebiTimeTravel' }
          case 257: {
            requireBytes(bytes, cursor, 2, opcode)
            const value = view.getUint16(cursor, true)
            const command = value >= 0x4000 ? readVariable(value) : value
            cursor += 2
            state.unionActivity = command
            const request: HgssMultiplayerRequest = {
              ...multiplayerRequestBase(opcode, commandOffset),
              kind: 'union-handshake',
              command,
            }
            return suspendMultiplayer(request)
          }
          case 261: {
            requireBytes(bytes, cursor, 2, opcode)
            const command = view.getUint16(cursor, true)
            cursor += 2
            state.unionActivity = command
            const request: HgssMultiplayerRequest = {
              ...multiplayerRequestBase(opcode, commandOffset),
              kind: 'union-set-command',
              command,
            }
            return suspendMultiplayer(request)
          }
          case 262: {
            state.unionActivity = 4
            const request: HgssMultiplayerRequest = {
              ...multiplayerRequestBase(opcode, commandOffset),
              kind: 'union-session-open',
              command: 4,
            }
            return suspendMultiplayer(request)
          }
          case 263: {
            const request: HgssMultiplayerRequest = {
              ...multiplayerRequestBase(opcode, commandOffset),
              kind: 'union-session-close',
            }
            return suspendMultiplayer(request, () => {
              state.unionActivity = 0
              state.multiplayerRemoteAvatars = []
            })
          }
          case 267: {
            requireBytes(bytes, cursor, 4, opcode)
            const command = view.getUint16(cursor, true)
            const destination = view.getUint16(cursor + 2, true)
            cursor += 4
            return suspendMultiplayer({
              ...multiplayerRequestBase(opcode, commandOffset),
              kind: 'union-interaction-query',
              objectId: actorId ?? readVariable(0x800d),
              command,
            }, (result) => state.variables.set(destination, result.romResult))
          }
          case 268: {
            requireBytes(bytes, cursor, 2, opcode)
            const destination = view.getUint16(cursor, true)
            cursor += 2
            return suspendMultiplayer({
              ...multiplayerRequestBase(opcode, commandOffset),
              kind: 'union-interaction-state',
              objectId: actorId ?? readVariable(0x800d),
            }, (result) => state.variables.set(destination, result.romResult))
          }
          case 274: {
            requireBytes(bytes, cursor, 4, opcode)
            const command = readScriptValue(cursor)
            const destination = view.getUint16(cursor + 2, true)
            cursor += 4
            return suspendMultiplayer({
              ...multiplayerRequestBase(opcode, commandOffset),
              kind: 'union-interaction-query',
              objectId: actorId ?? readVariable(0x800d),
              command,
            }, (result) => state.variables.set(destination, result.romResult))
          }
          case 269: {
            requireBytes(bytes, cursor, 2, opcode)
            const destination = view.getUint16(cursor, true)
            cursor += 2
            const request: HgssMultiplayerRequest = {
              ...multiplayerRequestBase(opcode, commandOffset),
              kind: 'union-wait-contact',
            }
            return suspendMultiplayer(request, (result) => state.variables.set(destination, result.romResult))
          }
          case 270: {
            const request: HgssMultiplayerRequest = {
              ...multiplayerRequestBase(opcode, commandOffset),
              kind: 'union-sync-avatars',
            }
            return suspendMultiplayer(request, (result) => {
              state.multiplayerRemoteAvatars = (result.remoteAvatars ?? []).map((avatar) => ({
                ...avatar,
                player: { ...avatar.player },
              }))
            })
          }
          case 271: {
            requireBytes(bytes, cursor, 4, opcode)
            const sideValue = view.getUint16(cursor, true)
            const activityValue = view.getUint16(cursor + 2, true)
            const side = sideValue >= 0x4000 ? readVariable(sideValue) : sideValue
            const activity = activityValue >= 0x4000 ? readVariable(activityValue) : activityValue
            cursor += 4
            const request: HgssMultiplayerRequest = {
              ...multiplayerRequestBase(opcode, commandOffset),
              kind: 'union-set-activity',
              side,
              activity,
            }
            return suspendMultiplayer(request)
          }
          case 287: {
            const trainerClassNames = requirePokemonRuntime(state).trainerClassNames
            if (!trainerClassNames) throw new Error('Les classes de Dresseur ROM requises par la Salle Union sont absentes.')
            for (let choice = 0; choice < 4; choice += 1) {
              const trainerClassId = getUnionAvatarAttribute(state, choice).trainerClassId
              const name = trainerClassNames[trainerClassId]
              if (!name) throw new Error(`La classe de Dresseur ROM ${trainerClassId} est absente.`)
              state.buffers.set(choice, name)
            }
            break
          }
          case 288: {
            requireBytes(bytes, cursor, 4, opcode)
            const choiceValue = view.getUint16(cursor, true)
            const choice = choiceValue >= 0x4000 ? readVariable(choiceValue) : choiceValue
            state.variables.set(view.getUint16(cursor + 2, true), getUnionAvatarAttribute(state, choice).trainerClassId)
            cursor += 4
            break
          }
          case 558: {
            requireBytes(bytes, cursor, 4, opcode)
            const choiceValue = view.getUint16(cursor, true)
            const choice = choiceValue >= 0x4000 ? readVariable(choiceValue) : choiceValue
            state.variables.set(view.getUint16(cursor + 2, true), getUnionAvatarAttribute(state, choice).spriteId)
            cursor += 4
            break
          }
          case 289: {
            requireBytes(bytes, cursor, 2, opcode)
            const spriteValue = view.getUint16(cursor, true)
            state.unionAvatarSpriteId = spriteValue >= 0x4000 ? readVariable(spriteValue) : spriteValue
            cursor += 2
            break
          }
          case 312: {
            const first = state.daycare.mons[0]?.pokemon
            const second = state.daycare.mons[1]?.pokemon
            if (first) {
              state.buffers.set(0, first.nickname ?? first.speciesName)
              state.buffers.set(2, first.originalTrainer.name)
            }
            if (second) state.buffers.set(1, second.nickname ?? second.speciesName)
            break
          }
          case 313: {
            requireBytes(bytes, cursor, 2, opcode)
            state.variables.set(view.getUint16(cursor, true), getHgssDaycareSaveState(state.daycare))
            cursor += 2
            break
          }
          case 361: {
            requireBytes(bytes, cursor, 4, opcode)
            const resultVariable = view.getUint16(cursor, true)
            const daycareSlot = readScriptValue(cursor + 2)
            cursor += 4
            const runtime = requirePokemonRuntime(state)
            const pokemon = retrievePokemonFromHgssDaycare(state.daycare, state.party, daycareSlot, runtime.catalog, teamPolicy, healingPolicy, levelPolicy)
            state.buffers.set(0, pokemon.nickname ?? pokemon.speciesName)
            state.variables.set(resultVariable, pokemon.speciesId)
            break
          }
          case 362: {
            requireBytes(bytes, cursor, 4, opcode)
            const tradeId = bytes[cursor]!
            const level = bytes[cursor + 1]!
            const mapId = view.getUint16(cursor + 2, true)
            cursor += 4
            const runtime = requirePokemonRuntime(state)
            const trade = runtime.npcTradeCatalog?.[tradeId]
            if (!trade) throw new Error(`L'échange interne ROM ${tradeId} demandé par GiveLoanMon est absent.`)
            if (state.party.members.length >= 6) throw new Error("GiveLoanMon HGSS a été appelé alors que l'équipe est pleine.")
            const mapSection = runtime.mapSectionForMapId?.(mapId)
            if (mapSection === undefined) throw new Error(`La section ROM de la carte ${mapId} du Pokémon prêté est absente.`)
            const now = runtime.now()
            const pokemon = createCanonicalPokemon(runtime.catalog, {
              speciesId: trade.givenSpeciesId,
              level,
              heldItemId: trade.heldItemId,
              rng: runtime.rng,
              personality: { kind: 'fixed', value: trade.personality },
              // CreateMon consomme bien deux mots LCRNG avant que les six IV
              // du fichier d'échange ne remplacent le résultat.
              individualValues: { kind: 'random' },
              originalTrainer: {
                id: trade.originalTrainerId,
                name: trade.originalTrainerName,
                gender: trade.originalTrainerGender, nameSource: 'local-ref', localTradeId: tradeId,
              },
              origin: {
                language: trade.language,
                gameVersion: runtime.gameVersion,
                metLocation: mapSection,
                metLevel: level,
                metTerrain: 0,
                metDate: { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() },
              },
              ballId: 4,
            })
            Object.assign(pokemon, { nickname: trade.nickname, nicknameSource: 'local-ref' as const, nicknameLocalRef: tradeId + 1 })
            if (tradeId === 7) pokemon.mailIdentity = 'kenya'
            pokemon.individualValues = { ...trade.individualValues }
            pokemon.stats = calculatePokemonStats(
              runtime.catalog.personalData[trade.givenSpeciesId]!,
              level,
              pokemon.individualValues,
              pokemon.effortValues,
              pokemon.nature,
            )
            pokemon.currentHp = pokemon.stats.hp
            if (pokemon.shiny) throw new Error(`Le Pokémon prêté ROM ${tradeId} est chromatique contrairement à l'assertion native.`)
            appendScriptedPokemonToParty(state.party, pokemon, 'loan', teamPolicy)
            markPokemonCaught(state.pokedex, pokemon, pokemon.origin.language)
            break
          }
          case 426: {
            requireBytes(bytes, cursor, 5, opcode)
            const destination = view.getUint16(cursor, true)
            const slot = readScriptValue(cursor + 2)
            const compareContents = bytes[cursor + 4]!
            cursor += 5
            const pokemon = getPokemonPartyMember(state.party, slot)
            const heldItem = pokemon && requirePokemonRuntime(state).itemCatalog?.items[pokemon.heldItemId]
            const hasMail = heldItem?.fieldPocket === 5
            state.variables.set(destination, hasMail && (compareContents === 0 || pokemon?.mailIdentity === 'kenya') ? 1 : 0)
            break
          }
          case 428: {
            requireBytes(bytes, cursor, 2, opcode)
            const slot = readScriptValue(cursor)
            cursor += 2
            const pokemon = getPokemonPartyMember(state.party, slot)
            if (!pokemon) throw new Error(`Le slot Pokémon ${slot} demandé par MonGiveMail est absent.`)
            const heldItem = requirePokemonRuntime(state).itemCatalog?.items[pokemon.heldItemId]
            if (heldItem?.fieldPocket === 5) {
              pokemon.heldItemId = 0
              pokemon.mailIdentity = undefined
            }
            break
          }
          case 363: {
            requireBytes(bytes, cursor, 5, opcode)
            const tradeId = bytes[cursor]!
            const slotValue = view.getUint16(cursor + 1, true)
            const slot = slotValue >= 0x4000 ? readVariable(slotValue) : slotValue
            const destination = view.getUint16(cursor + 3, true)
            cursor += 5
            const trade = requirePokemonRuntime(state).npcTradeCatalog?.[tradeId]
            if (!trade) throw new Error(`L'échange interne ROM ${tradeId} demandé par CheckReturnLoanMon est absent.`)
            const pokemon = getPokemonPartyMember(state.party, slot)
            const speciesMatches = tradeId === 7
              ? pokemon?.speciesId === 21 || pokemon?.speciesId === 22
              : pokemon?.speciesId === trade.givenSpeciesId
            const identityMatches = Boolean(pokemon && speciesMatches
              && pokemon.originalTrainer.id === trade.originalTrainerId
              && pokemon.personality === trade.personality
              && pokemon.originalTrainer.gender === trade.originalTrainerGender
              && pokemon.origin.language === trade.language)
            let result = 0
            if (!identityMatches) { result = 1; preparedLoanReturnSlot = undefined }
            else {
              const usablePartyCount = state.party.members.filter((member) => !member.isEgg && member.currentHp > 0).length
              if (usablePartyCount < 2) { result = 4; preparedLoanReturnSlot = undefined }
              else {
                const loanDecision = preparedLoanReturnSlot === slot ? undefined : resolveScriptedPokemonRemovalDecision(state.party, slot, 'loan', teamPolicy)
                if (loanDecision?.kind === 'blocked') { result = 4; preparedLoanReturnSlot = undefined }
                else { preparedLoanReturnSlot = slot; if (pokemon!.heldItemId !== 0) result = 2 }
              }
            }
            state.variables.set(destination, result)
            break
          }
          case 364: {
            requireBytes(bytes, cursor, 2, opcode)
            const slotValue = view.getUint16(cursor, true)
            const slot = slotValue >= 0x4000 ? readVariable(slotValue) : slotValue
            cursor += 2
            const authorizedPolicy = preparedLoanReturnSlot === slot ? basePokemonTeamPolicy : teamPolicy
            preparedLoanReturnSlot = undefined
            removeScriptedPokemonFromParty(state.party, slot, 'loan', authorizedPolicy)
            break
          }
          case 365:
            state.daycare.eggPersonality = 0
            state.daycare.eggCycleCounter = 0
            break
          case 366: {
            const runtime = requirePokemonRuntime(state)
            giveHgssDaycareEgg(state.daycare, state.party, runtime.catalog, runtime.rng, runtime.trainer, runtime.language, runtime.gameVersion, teamPolicy)
            break
          }
          case 367: {
            requireBytes(bytes, cursor, 4, opcode)
            const resultVariable = view.getUint16(cursor, true)
            const daycareSlot = readScriptValue(cursor + 2)
            cursor += 4
            const runtime = requirePokemonRuntime(state)
            const entry = state.daycare.mons[daycareSlot]
            if (!entry) throw new Error(`Le pensionnaire HGSS ${daycareSlot} demandé pour le tarif est absent.`)
            const price = getHgssDaycareWithdrawCost(entry, runtime.catalog, levelPolicy)
            state.buffers.set(0, entry.pokemon.nickname ?? entry.pokemon.speciesName)
            state.buffers.set(1, String(price))
            state.variables.set(resultVariable, price)
            break
          }
          case 369: {
            const partySlot = findHgssHatchableEggSlot(state.party)
            if (partySlot === undefined) throw new Error("EggHatchAnim HGSS ne trouve aucun Œuf prêt à éclore.")
            const pokemon = state.party.members[partySlot]!
            pendingEggHatchSlot = partySlot
            return { kind: 'eggHatch', partySlot, pokemon }
          }
          case 371: {
            requireBytes(bytes, cursor, 4, opcode)
            const resultVariable = view.getUint16(cursor, true)
            const daycareSlot = readScriptValue(cursor + 2)
            cursor += 4
            const runtime = requirePokemonRuntime(state)
            const entry = state.daycare.mons[daycareSlot]
            const growth = entry ? getHgssDaycareLevelGrowth(entry, runtime.catalog, levelPolicy) : 0
            if (entry) {
              state.buffers.set(0, entry.pokemon.nickname ?? entry.pokemon.speciesName)
              state.buffers.set(1, String(growth))
            }
            state.variables.set(resultVariable, growth)
            break
          }
          case 372: {
            requireBytes(bytes, cursor, 2, opcode)
            const tail = state.daycare.mons[1]?.pokemon ?? state.daycare.mons[0]?.pokemon
            state.variables.set(view.getUint16(cursor, true), tail?.speciesId ?? 0)
            if (tail) state.buffers.set(0, tail.nickname ?? tail.speciesName)
            cursor += 2
            break
          }
          case 373: {
            requireBytes(bytes, cursor, 2, opcode)
            const partySlot = readScriptValue(cursor)
            putPokemonInHgssDaycare(state.daycare, state.party, partySlot, preparedDaycareDepositSlot === partySlot ? basePokemonTeamPolicy : teamPolicy)
            preparedDaycareDepositSlot = undefined
            cursor += 2
            break
          }
          case 385: {
            requireBytes(bytes, cursor, 8, opcode)
            const nicknameBuffer = readScriptValue(cursor)
            const levelBuffer = readScriptValue(cursor + 2)
            const genderBuffer = readScriptValue(cursor + 4)
            const daycareSlot = readScriptValue(cursor + 6)
            cursor += 8
            const runtime = requirePokemonRuntime(state)
            const entry = state.daycare.mons[daycareSlot]
            if (!entry) throw new Error(`Le pensionnaire HGSS ${daycareSlot} demandé pour ses statistiques est absent.`)
            state.buffers.set(nicknameBuffer, entry.pokemon.nickname ?? entry.pokemon.speciesName)
            state.buffers.set(levelBuffer, String(getHgssDaycareUpdatedLevel(entry, runtime.catalog, levelPolicy)))
            const naturalNidoranName = (entry.pokemon.speciesId === 29 || entry.pokemon.speciesId === 32) && entry.pokemon.nickname === undefined
            state.buffers.set(genderBuffer, naturalNidoranName || entry.pokemon.gender === 'genderless' ? '' : entry.pokemon.gender === 'female' ? '♀' : '♂')
            break
          }
          case 387: {
            requireBytes(bytes, cursor, 2, opcode)
            state.variables.set(view.getUint16(cursor, true), getHgssDaycareCompatibilityMessageIndex(state.daycare, requirePokemonRuntime(state).catalog))
            cursor += 2
            break
          }
          case 388: {
            requireBytes(bytes, cursor, 2, opcode)
            state.variables.set(view.getUint16(cursor, true), state.daycare.eggPersonality === 0 ? 0 : 1)
            cursor += 2
            break
          }
          case 690: {
            requireBytes(bytes, cursor, 4, opcode)
            const partySlot = readScriptValue(cursor)
            const resultVariable = view.getUint16(cursor + 2, true)
            cursor += 4
            preparedDaycareDepositSlot = undefined
            state.variables.set(resultVariable, 0)
            if (partySlot === 0xff) break
            const pokemon = state.party.members[partySlot]
            if (!pokemon) throw new Error(`Le Pokémon d’équipe ${partySlot} à préparer pour la Pension est absent.`)
            const daycareDecision = resolveScriptedPokemonRemovalDecision(state.party, partySlot, 'daycare', teamPolicy)
            if (daycareDecision.kind === 'blocked') { state.variables.set(resultVariable, 0xff); break }
            if (pokemon.heldItemId === 112) {
              const itemCatalog = requirePokemonRuntime(state).itemCatalog
              if (!itemCatalog) throw new Error('Le catalogue d’objets ROM requis pour rendre l’Orbe Platiné est absent.')
              if (!addBagItem(state.inventory, itemCatalog, 112, 1)) {
                state.variables.set(resultVariable, 0xff)
                break
              }
              pokemon.heldItemId = 0
            }
            if ((pokemon.speciesId === 487 || pokemon.speciesId === 479 || pokemon.speciesId === 492) && pokemon.form > 0) pokemon.form = 0
            preparedDaycareDepositSlot = partySlot
            break
          }
          case 698: {
            requireBytes(bytes, cursor, 5, opcode)
            const event = bytes[cursor]!
            const slotValue = view.getUint16(cursor + 1, true)
            const slot = slotValue >= 0x4000 ? readVariable(slotValue) : slotValue
            const resultVariable = view.getUint16(cursor + 3, true)
            cursor += 5
            const pokemon = state.party.members[slot]
            let matches = false
            if (event < 4 && pokemon && !pokemon.isEgg) {
              const hasEventMetadata = event === 1
                ? !pokemon.fatefulEncounter
                  && pokemon.originalTrainer.id !== requirePokemonRuntime(state).trainer.id
                  && (pokemon.origin.gameVersion === 10 || pokemon.origin.gameVersion === 11 || pokemon.origin.gameVersion === 12)
                  && pokemon.origin.metLocation === 86
                : pokemon.fatefulEncounter
              if (hasEventMetadata) {
                if (event === 0) matches = (pokemon.speciesId === 172 || pokemon.speciesId === 25 || pokemon.speciesId === 26) && pokemon.shiny
                else if (event === 1 || event === 2) matches = pokemon.speciesId === 493
                else matches = pokemon.speciesId === 251
              }
            }
            state.variables.set(resultVariable, matches ? 1 : 0)
            break
          }
          case 708: {
            requireBytes(bytes, cursor, 2, opcode)
            const value = view.getUint16(cursor, true)
            const parameter = value >= 0x4000 ? readVariable(value) : value
            cursor += 2
            return { kind: 'objectEffect', action: 'rocketTrap', objectIds: [], parameters: [parameter] }
          }
          case 712: {
            requireBytes(bytes, cursor, 1, opcode)
            const action = bytes[cursor]!
            cursor += 1
            const apps = ['courseRecords', 'medals', 'eventRecords', 'overview'] as const
            awaitingPokeathlonApp = true
            return {
              kind: 'pokeathlonApp',
              app: apps[action] ?? 'courseRecords',
              records: [...state.pokeathlonRecords],
              athletePoints: state.athletePoints,
            }
          }
          case 713: {
            requireBytes(bytes, cursor, 1, opcode)
            let puzzleIndex = bytes[cursor]!
            cursor += 1
            if (puzzleIndex > 4) puzzleIndex = 0
            if (puzzleIndex >= hgssAlphPuzzleFlags.length) throw new Error(`Puzzle des Ruines d’Alpha HGSS ${puzzleIndex} invalide.`)
            const runtime = requirePokemonRuntime(state)
            const graphics = runtime.alphPuzzleTiles?.[puzzleIndex]
            if (!graphics || graphics.length !== 16) throw new Error(`Les 16 pièces ROM du puzzle d’Alpha ${puzzleIndex} sont absentes.`)
            awaitingAlphPuzzle = puzzleIndex
            return {
              kind: 'alphPuzzle',
              puzzleIndex,
              hint: runtime.alphPuzzleHints?.[puzzleIndex] ?? '',
              tiles: createHgssAlphPuzzleTiles(puzzleIndex),
              graphics,
              background: runtime.alphPuzzleBackground,
            }
          }
          case 714: {
            requireBytes(bytes, cursor, 1, opcode)
            const roomIndex = bytes[cursor]!
            cursor += 1
            const runtime = requirePokemonRuntime(state)
            const background = runtime.alphHiddenRoomBackground
            const word = runtime.alphHiddenRoomWords?.[roomIndex]
            if (roomIndex > 3 || !word) throw new Error(`Inscription secrète des Ruines d’Alpha HGSS ${roomIndex} invalide.`)
            if (!background) throw new Error("Le décor ROM des inscriptions secrètes des Ruines d’Alpha est absent.")
            awaitingAlphHiddenRoom = true
            return { kind: 'alphHiddenRoom', roomIndex, word, background }
          }
          case 715:
            return {
              kind: 'daycareObjects',
              objects: state.daycare.mons.flatMap((entry, index) => entry ? [{
                objectId: (250 + index) as 250 | 251,
                x: 8 + index * 2,
                z: 5 + index * 4,
                pokemon: cloneCanonicalPokemon(entry.pokemon),
              }] : []),
            }
          case 716: return safariApps.launchCustomizer()
          case 717: {
            requireBytes(bytes, cursor, 2, opcode); const destination = view.getUint16(cursor, true); cursor += 2
            return safariApps.launchDecorator(destination)
          }
          case 718: case 719: case 720: case 721: cursor = runHgssSafariImmediateOpcode(opcode, scriptMap, state, bytes, cursor); break
          case 724: {
            requireBytes(bytes, cursor, 4, opcode)
            const indexValue = view.getUint16(cursor, true)
            const index = indexValue >= 0x4000 ? readVariable(indexValue) : indexValue
            state.variables.set(view.getUint16(cursor + 2, true), readHgssPokeathlonScriptRecord(state.pokeathlonRecords, index))
            cursor += 4
            break
          }
          case 722:
          case 723: {
            requireBytes(bytes, cursor, 8, opcode)
            const parameters = [
              bytes[cursor]!,
              bytes[cursor + 1]!,
              view.getUint16(cursor + 2, true),
              view.getUint16(cursor + 4, true),
              view.getUint16(cursor + 6, true),
            ]
            cursor += 8
            // Les deux tâches utilisent les paramètres bruts du script pour
            // piloter l'éclairage/les modèles; 723 exécute le sens inverse.
            return { kind: 'objectEffect', action: 'configure', objectIds: [], parameters: [opcode, ...parameters] }
          }
          case 725: {
            requireBytes(bytes, cursor, 3, opcode)
            const operation = bytes[cursor]!
            const amountValue = view.getUint16(cursor + 1, true)
            const amount = amountValue >= 0x4000 ? readVariable(amountValue) : amountValue
            changeHgssPokeathlonJumpRecord(state.pokeathlonRecords, operation, amount)
            cursor += 3
            break
          }
          case 771:
            pendingAthleteShop = getHgssAthleteShop(
              resolveHgssWeekday(requirePokemonRuntime(state).now()),
              state.pokedex.nationalDexEnabled,
            )
            for (const { itemId } of pendingAthleteShop) getItem(state, itemId)
            return createShopStep()
          case 772:
            pendingPokeathlonDataCards = getHgssPokeathlonDataCardShop(state.pokeathlonDataCards)
            for (const { itemId } of pendingPokeathlonDataCards) getItem(state, itemId)
            return createShopStep()
          case 773: {
            requireBytes(bytes, cursor, 2, opcode)
            const scene = view.getUint16(cursor, true)
            cursor += 2
            // ScrCmd_Cinematic launches overlay 106 after leaving the
            // overworld. Its three legal values are the Ho-Oh, Lugia and
            // Arceus movies; preserve that ROM identity for the renderer.
            if (scene > 2) throw new Error(`Cinématique légendaire HGSS ${scene} invalide.`)
            return { kind: 'objectEffect', action: 'configure', objectIds: [], parameters: [opcode, scene] }
          }
          case 830:
          case 831:
          case 832:
          case 833: {
            requireBytes(bytes, cursor, 2, opcode)
            const destination = view.getUint16(cursor, true)
            cursor += 2
            if (opcode === 830) {
              state.variables.set(destination, hasRoomForHgssBargainAccessory(state.fashionAccessories) ? 0 : 1)
            } else if (opcode === 831) {
              state.variables.set(destination, chooseHgssBargainAccessory(requirePokemonRuntime(state).rng))
            } else if (opcode === 832) {
              state.variables.set(destination, hasAllHgssBargainBackgrounds(state.fashionBackgrounds) ? 1 : 0)
            } else {
              state.variables.set(destination, chooseMissingHgssBargainBackground(
                state.fashionBackgrounds,
                requirePokemonRuntime(state).rng,
              ))
            }
            break
          }
          case 835: {
            requireBytes(bytes, cursor, 2, opcode)
            state.variables.set(
              view.getUint16(cursor, true),
              countConsecutiveHgssPokeathlonDataCards(state.pokeathlonDataCards),
            )
            cursor += 2
            break
          }
          case 840: {
            requireBytes(bytes, cursor, 4, opcode)
            const mapValue = view.getUint16(cursor, true)
            const mapId = mapValue >= 0x4000 ? readVariable(mapValue) : mapValue
            const destination = view.getUint16(cursor + 2, true)
            state.variables.set(destination, hgssPokemonCenterMapIds.has(mapId) ? 1 : mapId === 300 ? 2 : 0)
            cursor += 4
            break
          }
          case 743: {
            requireBytes(bytes, cursor, 2, opcode)
            const dataValue = view.getUint16(cursor, true)
            const dataType = dataValue >= 0x4000 ? readVariable(dataValue) : dataValue
            cursor += 2
            awaitingPokeathlonApp = true
            const messages = state.pokemonRuntime?.pokeathlonDataMessages ?? {}
            return { kind: 'pokeathlonApp', app: 'data', dataType, records: [...state.pokeathlonRecords], athletePoints: state.athletePoints, rows: getHgssPokeathlonDataRows(state.pokeathlonRecords, dataType, messages) }
          }
          case 709:
            return { kind: 'objectEffect', action: 'persianStatues', objectIds: [], parameters: [] }
          case 710:
            return {
              kind: 'mapPropAnimation',
              action: 'attach',
              bindings: [149, 152, 153].map((modelId, index) => ({
                modelId,
                animationIndex: state.flags.has(0x96b + index) ? 1 : 0,
              })),
            }
          case 775: {
            requireBytes(bytes, cursor, 4, opcode)
            const readObject = (offset: number) => {
              const value = view.getUint16(offset, true)
              return value >= 0x4000 ? readVariable(value) : value
            }
            const objectIds = [readObject(cursor), readObject(cursor + 2)]
            cursor += 4
            return { kind: 'objectEffect', action: 'lakeFlight', objectIds, parameters: [] }
          }
          case 776: {
            if (state.party.members.length >= 6) break
            const runtime = requirePokemonRuntime(state)
            const personalData = runtime.catalog.personalData[175]
            const extrasensory = runtime.catalog.moves[326]
            if (!personalData) throw new Error('Les données personnelles ROM de Togepi sont absentes.')
            if (!extrasensory) throw new Error('La capacité ROM Extrasenseur est absente.')
            const now = runtime.now()
            const egg = createCanonicalPokemon(runtime.catalog, {
              speciesId: 175,
              level: 1,
              rng: runtime.rng,
              personality: { kind: 'random' },
              individualValues: { kind: 'random' },
              originalTrainer: runtime.trainer,
              origin: {
                language: runtime.language,
                gameVersion: runtime.gameVersion,
                // MAPSECTYPE_GIFT + METLOC_MR_POKEMON, représenté dans
                // notre modèle canonique par l'identifiant ROM du lieu cadeau.
                metLocation: 2013,
                metLevel: 0,
                metTerrain: 0,
                metDate: { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() },
              },
              friendship: personalData.eggCycles,
              ballId: 4,
            })
            if (egg.moves.length >= 4) egg.moves.length = 3
            egg.moves.push({ moveId: 326, pp: extrasensory.pp, maxPp: extrasensory.pp, ppUps: 0, data: { ...extrasensory } })
            Object.assign(egg, { nickname: 'ŒUF', nicknameSource: 'local-ref' as const, nicknameLocalRef: 0 })
            egg.isEgg = true
            appendScriptedPokemonToParty(state.party, egg, 'gift', teamPolicy)
            state.togepiEggIdentity = { personality: egg.personality, gender: egg.gender }
            break
          }
          case 777: {
            requireBytes(bytes, cursor, 4, opcode)
            const slotValue = view.getUint16(cursor, true)
            const slot = slotValue >= 0x4000 ? readVariable(slotValue) : slotValue
            const destination = view.getUint16(cursor + 2, true)
            cursor += 4
            const pokemon = getPokemonPartyMember(state.party, slot)
            const runtime = requirePokemonRuntime(state)
            const matches = isHgssMrPokemonTogepi(
              pokemon,
              state.togepiEggIdentity,
              runtime.trainer,
              runtime.language,
              runtime.gameVersion,
            )
            state.variables.set(destination, matches ? 1 : 0)
            break
          }
          case 778: {
            if (state.party.members.length >= 6) break
            const runtime = requirePokemonRuntime(state)
            const personalData = runtime.catalog.personalData[172]
            if (!personalData) throw new Error('Les données personnelles ROM de Pichu sont absentes.')
            const trainerXor = ((runtime.trainer.id >>> 16) ^ (runtime.trainer.id & 0xffff)) >>> 0
            let personality = ((0xff00 ^ (trainerXor & 0xff00)) << 16) >>> 0
            personality = (personality + 4 - (personality % 25)) >>> 0
            const lowByte = personality & 0xff
            if (personalData.genderRatio < lowByte) {
              personality = (personality - 25 * (Math.floor((lowByte - personalData.genderRatio) / 25) + 1)) >>> 0
              if ((personality & 1) !== 0) personality = (personality - 25) >>> 0
            }
            const now = runtime.now()
            const pichu = createCanonicalPokemon(runtime.catalog, {
              speciesId: 172,
              level: 30,
              form: 1,
              heldItemId: 300,
              moveIds: [270, 344, 207, 220],
              rng: runtime.rng,
              personality: { kind: 'fixed', value: personality },
              individualValues: { kind: 'random' },
              originalTrainer: runtime.trainer,
              origin: {
                language: runtime.language,
                gameVersion: runtime.gameVersion,
                metLocation: map.header.mapSection,
                metLevel: 30,
                metTerrain: 24,
                metDate: { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() },
              },
              ballId: 4,
            })
            appendScriptedPokemonToParty(state.party, pichu, 'gift', teamPolicy)
            markPokemonCaught(state.pokedex, pichu, runtime.language)
            break
          }
          case 779: {
            requireBytes(bytes, cursor, 4, opcode)
            const sequenceValue = view.getUint16(cursor, true)
            const sequenceId = sequenceValue >= 0x4000 ? readVariable(sequenceValue) : sequenceValue
            state.variables.set(view.getUint16(cursor + 2, true), state.radioMusicSequenceId === sequenceId ? 1 : 0)
            cursor += 4
            break
          }
          case 781: {
            requireBytes(bytes, cursor, 2, opcode)
            const destination = view.getUint16(cursor, true)
            cursor += 2
            const itemCatalog = requirePokemonRuntime(state).itemCatalog
            const partyHasKenyaMail = state.party.members.some((pokemon) => (
              pokemon.mailIdentity === 'kenya' && itemCatalog?.items[pokemon.heldItemId]?.fieldPocket === 5
            ))
            state.variables.set(destination, partyHasKenyaMail || state.mailboxMailIdentities.includes('kenya') ? 1 : 0)
            break
          }
          case 744:
            return { kind: 'objectEffect', action: 'friendshipStatues', objectIds: [], parameters: [] }
          case 807: {
            requireBytes(bytes, cursor, 4, opcode)
            const trainerValue = view.getUint16(cursor, true)
            const trainerNumber = trainerValue >= 0x4000 ? readVariable(trainerValue) : trainerValue
            const destination = view.getUint16(cursor + 2, true)
            cursor += 4
            if (trainerNumber < 0 || trainerNumber >= hgssTrainerHouseSlotCount) {
              throw new Error(`Emplacement Maison des Dresseurs HGSS ${trainerNumber} invalide.`)
            }
            const entry = state.trainerHouseEntries[trainerNumber]
            state.variables.set(0x4020 + trainerNumber, entry?.spriteId ?? 0)
            state.variables.set(destination, entry?.party[0]?.speciesId ? 1 : 0)
            break
          }
          case 808: {
            requireBytes(bytes, cursor, 2, opcode)
            const trainerValue = view.getUint16(cursor, true)
            const trainerNumber = trainerValue >= 0x4000 ? readVariable(trainerValue) : trainerValue
            cursor += 2
            if (trainerNumber < 0 || trainerNumber > hgssTrainerHouseSlotCount) {
              throw new Error(`Dresseur Maison des Dresseurs HGSS ${trainerNumber} invalide.`)
            }
            lastBattleWon = undefined
            state.lastBattleWon = undefined
            awaitingBattle = true
            return { kind: 'battle', battle: { kind: 'trainerHouse', trainerNumber } }
          }
          case 809: {
            requireBytes(bytes, cursor, 2, opcode)
            const trainerValue = view.getUint16(cursor, true)
            const trainerNumber = trainerValue >= 0x4000 ? readVariable(trainerValue) : trainerValue
            cursor += 2
            if (trainerNumber < 0 || trainerNumber > hgssTrainerHouseSlotCount) {
              throw new Error(`Dresseur Maison des Dresseurs HGSS ${trainerNumber} invalide.`)
            }
            const message = resolveTrainerHouseMessage(state, trainerNumber)
            return { kind: 'message', ...message }
          }
          case 837:
            requireBytes(bytes, cursor, 2, opcode)
            // Aucun règlement personnalisé n'est présent dans une sauvegarde
            // neuve (partyCount == 0 dans Save_LinkBattleRuleset).
            state.variables.set(view.getUint16(cursor, true), 0)
            cursor += 2
            break
          case 770: {
            requireBytes(bytes, cursor, 2, opcode)
            const letterForms = new Set((state.pokedex.seenForms.get(201) ?? []).filter((form) => form >= 0 && form < 26))
            state.variables.set(view.getUint16(cursor, true), letterForms.size === 26 ? 1 : 0)
            cursor += 2
            break
          }
          case 813:
            requireBytes(bytes, cursor, 2, opcode)
            state.variables.set(view.getUint16(cursor, true), state.momGiftItems.length > 0 ? 1 : 0)
            cursor += 2
            break
          case 815:
            requireBytes(bytes, cursor, 2, opcode)
            state.fieldSystemMode = view.getUint16(cursor, true)
            cursor += 2
            break
          case 804:
            requireBytes(bytes, cursor, 1, opcode)
            state.pokegearMapUnlockLevel = bytes[cursor]!
            cursor += 1
            break
          case 805:
            // sub_02004B24(75) ne joue aucun son : il précharge le groupe
            // audio de cette scène. Le lecteur web charge les séquences ROM
            // à la demande, donc aucun état persistant n'est modifié.
            break
          case 798: {
            requireBytes(bytes, cursor, 2, opcode)
            const ruleset = view.getUint16(cursor, true)
            cursor += 2
            const standardRulesetIndexes = [0, 1, 2, 3, 4, undefined, 0, 5, 6, 7, 8, 9] as const
            const nameIndex = standardRulesetIndexes[ruleset]
            const name = nameIndex === undefined ? '' : map.externalMessages?.[182]?.[83 + nameIndex]
            if (name === undefined) throw new Error(`Le nom ROM du règlement ${ruleset} est absent de la banque 182.`)
            state.buffers.set(0, name)
            break
          }
          case 799: {
            requireBytes(bytes, cursor, 2, opcode)
            const ruleset = readVariable(view.getUint16(cursor, true))
            cursor += 2
            const standardRulesetIndexes = [0, 1, 2, 3, 4, undefined, 0, 5, 6, 7, 8, 9] as const
            const nameIndex = standardRulesetIndexes[ruleset]
            const name = nameIndex === undefined ? '' : map.externalMessages?.[182]?.[83 + nameIndex]
            if (name === undefined) throw new Error(`Le nom ROM du règlement ${ruleset} est absent de la banque 182.`)
            state.buffers.set(0, name)
            break
          }
          case 800: {
            requireBytes(bytes, cursor, 2, opcode)
            const variableId = view.getUint16(cursor, true)
            const ruleset = readVariable(variableId)
            state.activeLinkRulesetId = ruleset === 6 || ruleset === 12 ? undefined : ruleset
            cursor += 2
            break
          }
          case 803: {
            requireBytes(bytes, cursor, 4, opcode)
            const ruleset = readVariable(view.getUint16(cursor, true))
            const destination = view.getUint16(cursor + 2, true)
            cursor += 4
            const nonEggParty = state.party.members.filter((pokemon) => !pokemon.isEgg)
            // sAlternateRulesets de link_ruleset_data.c. L'index 10 est le
            // règlement sans structure native qui exige seulement 2 Pokémon.
            const partyCounts = [3, 3, 3, 3, 4, 6, 3, 3, 4, 4, 2, 4] as const
            const maxLevels = [50, 30, 5, 50, 50, 100, 50, 100, 100, 100, 100, 100] as const
            const totalLevels = [0, 80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] as const
            const requiredCount = partyCounts[ruleset] ?? 6
            const maxLevel = maxLevels[ruleset] ?? 100
            const totalLevel = totalLevels[ruleset] ?? 0
            const legalLevels = nonEggParty.filter((pokemon) => pokemon.level <= maxLevel).map((pokemon) => pokemon.level)
            let result = legalLevels.length < requiredCount ? 1 : 0
            if (result === 0 && totalLevel > 0) {
              // sub_02074C50 cherche n'importe quelle combinaison légale du
              // nombre requis de Pokémon sous le plafond total.
              const sortedLevels = [...legalLevels].sort((left, right) => left - right)
              if (sortedLevels.slice(0, requiredCount).reduce((sum, level) => sum + level, 0) > totalLevel) result = 2
            }
            if (result !== 0) {
              const standardRulesetIndexes = [0, 1, 2, 3, 4, undefined, 0, 5, 6, 7, 8, 9] as const
              const nameIndex = standardRulesetIndexes[ruleset]
              const name = nameIndex === undefined ? '' : map.externalMessages?.[182]?.[83 + nameIndex]
              if (name === undefined) throw new Error(`Le nom ROM du règlement ${ruleset} est absent de la banque 182.`)
              state.buffers.set(0, name)
              state.buffers.set(1, String(result === 1 ? requiredCount : totalLevel))
            }
            state.variables.set(destination, result)
            break
          }
          case 163: {
            requireBytes(bytes, cursor, 2, opcode)
            const defeatedRed = view.getUint16(cursor, true) !== 0; cursor += 2
            const clear = applyHgssGameClearState(state, defeatedRed, healingPolicy); awaitingGameClear = true
            return {
              kind: 'gameClear', ...clear,
              page: {
                facility: 'tower', facilityId: 1, title: 'Panthéon', view: 'single',
                viewLabel: defeatedRed ? 'Maître de Johto · Red vaincu' : 'Maître de Johto',
                rows: state.party.members.map((pokemon) => ({ label: pokemon.nickname ?? pokemon.speciesName, value: pokemon.level, tone: 'record' as const })),
              },
            }
          }
          case 264: {
            requireBytes(bytes, cursor, 2, opcode)
            const mode = view.getUint16(cursor, true)
            const remote = state.multiplayerRemoteAvatars.find((avatar) => mode !== 0 || Number(avatar.peerId) + 1 === (actorId ?? 0))
            state.buffers.set(0, remote?.player.name ?? 'Dresseur')
            state.buffers.set(1, state.playerName)
            const language = remote ? 1 : requirePokemonRuntime(state).language
            state.buffers.set(2, scriptMap.externalMessages?.[738]?.[language >= 1 && language <= 7 ? 210 + language : 217] ?? `Langue ${language}`)
            cursor += 2
            break
          }
          case 383: {
            requireBytes(bytes, cursor, 4, opcode)
            let modifier = readScriptValue(cursor)
            const slot = readScriptValue(cursor + 2)
            const pokemon = getPokemonPartyMember(state.party, slot)
            if (pokemon && modifier !== 0) {
              if (pokemon.ballId === 11) modifier += 1
              if (pokemon.origin.metLocation === map.header.mapSection) modifier += 1
              if (getItemCatalog(state).items[pokemon.heldItemId]?.holdEffect === 53) modifier = Math.floor(modifier * 150 / 100)
              pokemon.friendship = Math.min(255, pokemon.friendship + modifier)
            }
            cursor += 4
            break
          }
          case 488: {
            requireBytes(bytes, cursor, 4, opcode)
            const direction = readScriptValue(cursor)
            const distance = readScriptValue(cursor + 2)
            cursor += 4
            return { kind: 'objectEffect', action: 'configure', objectIds: [], parameters: [488, direction, distance] }
          }
          case 500: case 501: case 502: {
            requireBytes(bytes, cursor, 1, opcode)
            const tag = bytes[cursor++]!
            if (opcode === 500) {
              mapPropAnimationTags.add(tag)
              // ScrCmd_500 recherche globalement le premier terminal parmi
              // les modeles 33/138, puis charge ses deux pistes one-shot.
              return { kind: 'mapPropAnimation', action: 'load', tag, modelIds: [33, 138], animationCount: 2, loopCount: 1, reversed: false }
            }
            return { kind: 'mapPropAnimation', action: 'play', tag, animationIndex: opcode === 501 ? 0 : 1 }
          }
          case 652: {
            requireBytes(bytes, cursor, 6, opcode)
            const slot = readScriptValue(cursor)
            const tutorNpc = readScriptValue(cursor + 2)
            const destination = view.getUint16(cursor + 4, true)
            const count = getLearnableTutorMoveIds(state, slot, tutorNpc).length
            state.variables.set(destination, count === 0 ? 0 : count <= 7 ? 1 : Math.floor(count / 6) + 1)
            cursor += 6
            break
          }
          case 653: {
            requireBytes(bytes, cursor, 8, opcode)
            const slot = readScriptValue(cursor)
            const tutorNpc = readScriptValue(cursor + 2)
            const page = readScriptValue(cursor + 4)
            const resultVariable = view.getUint16(cursor + 6, true)
            cursor += 8
            const learnableMoves = getLearnableTutorMoveIds(state, slot, tutorNpc)
            const displayed = learnableMoves.length <= 7 ? learnableMoves : learnableMoves.slice(page * 6, page * 6 + 6)
            const hasNextPage = learnableMoves.length > 7
            pendingChoice = {
              variableId: resultVariable,
              options: [
                ...displayed.map((moveId) => ({ label: requirePokemonRuntime(state).catalog.moveNames[moveId] ?? `Capacité ${moveId}`, value: moveId })),
                ...(hasNextPage ? [{ label: 'Suite', value: 0xfffd }] : []),
                { label: 'Retour', value: 0xfffe },
              ],
              cancellable: true,
            }
            return { kind: 'choice', options: pendingChoice.options, cancellable: true }
          }
          case 656: {
            requireBytes(bytes, cursor, 4, opcode)
            const slot = readScriptValue(cursor)
            state.variables.set(view.getUint16(cursor + 2, true), getLearnableTutorMoveIds(state, slot, 3).length > 0 ? 1 : 0)
            cursor += 4
            break
          }
          case 655: {
            requireBytes(bytes, cursor, 4, opcode)
            const moveId = readScriptValue(cursor)
            const moveIndex = hgssTutorMoves.indexOf(moveId as typeof hgssTutorMoves[number])
            if (moveIndex < 0) throw new Error(`La capacité ${moveId} n'appartient pas à la table ROM des maîtres.`)
            state.variables.set(view.getUint16(cursor + 2, true), hgssTutorMovePrices[moveIndex]!)
            cursor += 4
            break
          }
          case 668: {
            requireBytes(bytes, cursor, 3, opcode)
            const bufferId = bytes[cursor]!
            const typeId = readScriptValue(cursor + 1)
            const typeName = requirePokemonRuntime(state).pokedexCatalog?.typeNames[typeId]
            if (!typeName) throw new Error(`Le nom ROM du type Pokémon ${typeId} est absent.`)
            state.buffers.set(bufferId, typeName)
            cursor += 3
            break
          }
          case 657: {
            requireBytes(bytes, cursor, 8, opcode)
            const slot = readScriptValue(cursor)
            const totalDestination = view.getUint16(cursor + 2, true)
            const bestStatDestination = view.getUint16(cursor + 4, true)
            const bestIvDestination = view.getUint16(cursor + 6, true)
            const ivs = getPokemonPartyMember(state.party, slot)?.individualValues
            const values = ivs ? [ivs.hp, ivs.attack, ivs.defense, ivs.speed, ivs.specialAttack, ivs.specialDefense] : [0, 0, 0, 0, 0, 0]
            const bestIv = Math.max(...values)
            let bestIndex = state.judgeStatPosition % 6
            for (let offset = 0; offset < 6; offset += 1) {
              const candidate = (state.judgeStatPosition + offset) % 6
              if (values[candidate] === bestIv) { bestIndex = candidate; break }
            }
            state.judgeStatPosition = (bestIndex + 1) % 6
            state.variables.set(totalDestination, values.reduce((total, value) => total + value, 0))
            state.variables.set(bestStatDestination, [122, 123, 124, 127, 125, 126][bestIndex]!)
            state.variables.set(bestIvDestination, bestIv)
            cursor += 8
            break
          }
          case 670: {
            requireBytes(bytes, cursor, 4, opcode)
            const slot = readScriptValue(cursor)
            const destination = view.getUint16(cursor + 2, true)
            const pokemon = getPokemonPartyMember(state.party, slot)
            const unsupportedSpecies = new Set([10, 11, 13, 14, 129, 132, 202, 235, 265, 266, 268, 360, 374, 401, 412, 415])
            if (!pokemon || (!pokemon.isEgg && unsupportedSpecies.has(pokemon.speciesId))) {
              state.variables.set(destination, 0xffff)
            } else {
              const iv = pokemon.individualValues
              const bits = (iv.hp & 1) | ((iv.attack & 1) << 1) | ((iv.defense & 1) << 2)
                | ((iv.speed & 1) << 3) | ((iv.specialAttack & 1) << 4) | ((iv.specialDefense & 1) << 5)
              const baseType = Math.floor(bits * 15 / 63) + 1
              state.variables.set(destination, baseType >= 9 ? baseType + 1 : baseType)
            }
            cursor += 4
            break
          }
          case 681: {
            requireBytes(bytes, cursor, 2, opcode)
            const resultVariable = view.getUint16(cursor, true)
            cursor += 2
            const catalog = requirePokemonRuntime(state).easyChatCatalog
            if (!catalog) throw new Error('Les banques Easy Chat de la ROM sont absentes du runtime.')
            awaitingEasyChat = { kind: 'battleGreeting', resultVariable }
            return { kind: 'easyChat', mode: 681, catalog, wordCount: 4, initialWordIds: state.battleGreetingWords }
          }
          case 680: {
            requireBytes(bytes, cursor, 2, opcode)
            addHgssGameScore(state, view.getUint16(cursor, true))
            cursor += 2
            break
          }
          case 663: {
            requireBytes(bytes, cursor, 2, opcode)
            const connectionResult = readVariable(view.getUint16(cursor, true))
            cursor += 2
            return { kind: 'specialCutscene', effect: 'linkReturn', parameter: connectionResult }
          }
          case 693:
            requireBytes(bytes, cursor, 2, opcode)
            state.variables.set(view.getUint16(cursor, true), state.battleHallUsedSpecies.size)
            cursor += 2
            break
          case 726:
            return { kind: 'objectEffect', action: 'configure', objectIds: [], parameters: [726] }
          case 735:
            requireBytes(bytes, cursor, 2, opcode)
            state.variables.set(view.getUint16(cursor, true), state.kurtApricornQuantity)
            cursor += 2
            break
          case 736:
            state.kurtApricornType = 0
            state.kurtApricornQuantity = 0
            break
          case 737:
            requireBytes(bytes, cursor, 2, opcode)
            state.variables.set(view.getUint16(cursor, true), state.kurtBallId)
            cursor += 2
            break
          case 738:
            requireBytes(bytes, cursor, 2, opcode)
            state.variables.set(view.getUint16(cursor, true), state.apricornBox.reduce((total, quantity) => total + quantity, 0))
            cursor += 2
            break
          case 739:
            pendingApricornSelection = { phase: 'type' }
            return {
              kind: 'choice',
              options: [
                ...state.apricornBox.flatMap((quantity, type) => quantity > 0
                  ? [{ label: `${scriptMap.externalMessages?.[21]?.[7 + type] ?? `Noigrume ${type}`} ×${quantity}`, value: type }]
                  : []),
                { label: 'Retour', value: 0xfffe },
              ],
              cancellable: true,
            }
          case 755:
            return { kind: 'objectEffect', action: 'configure', objectIds: [], parameters: [755] }
          case 756:
            return { kind: 'objectEffect', action: 'configure', objectIds: [], parameters: [756] }
          case 757:
            return { kind: 'objectEffect', action: 'configure', objectIds: [], parameters: [757] }
          case 758: {
            requireBytes(bytes, cursor, 2, opcode)
            const clearBellOnly = view.getUint16(cursor, true)
            cursor += 2
            return { kind: 'objectEffect', action: 'configure', objectIds: [], parameters: [758, clearBellOnly] }
          }
          case 759:
          case 760:
          case 763:
          case 764:
          case 767:
          case 768:
          case 769:
            return { kind: 'objectEffect', action: 'configure', objectIds: [], parameters: [opcode] }
          case 761:
          case 762: {
            requireBytes(bytes, cursor, 2, opcode)
            const destination = view.getUint16(cursor, true)
            cursor += 2
            return { kind: 'objectEffect', action: 'configure', objectIds: [], parameters: [opcode, destination] }
          }
          case 765:
            return { kind: 'objectEffect', action: 'configure', objectIds: [], parameters: [765] }
          case 766:
            return { kind: 'objectEffect', action: 'configure', objectIds: [], parameters: [766] }
          case 785: {
            requireBytes(bytes, cursor, 3, opcode)
            const action = bytes[cursor]!
            const weekday = readScriptValue(cursor + 1)
            if (action === 0) {
              const registeredContestants: number[] = []
              const rng = requirePokemonRuntime(state).rng
              while (registeredContestants.length < 5) {
                const contestant = rng.nextU16() % 10
                if (!registeredContestants.includes(contestant)) registeredContestants.push(contestant)
              }
              state.bugContest = { weekday, registeredContestants, elapsedMinutes: 0 }
            }
            else if (action === 1) state.bugContest = undefined
            else throw new Error(`Action Concours Capture HGSS ${action} invalide.`)
            cursor += 3
            break
          }
          case 786: {
            requireBytes(bytes, cursor, 1, opcode)
            const place = bytes[cursor]!
            cursor += 1
            if (place > 5) throw new Error(`Place du Concours Capture HGSS ${place} invalide.`)
            const contest = state.bugContest ??= { weekday: 0, registeredContestants: [], elapsedMinutes: 0 }
            if (place === contest.placement) {
              state.buffers.set(0, state.playerName)
              state.buffers.set(1, contest.caughtPokemon ? getSpeciesName(state, contest.caughtPokemon.speciesId) : '')
            } else {
              const contestantId = contest.registeredContestants[place] ?? place
              state.buffers.set(0, scriptMap.messages[78 + contestantId] ?? `Concurrent ${contestantId + 1}`)
              state.buffers.set(1, '')
              state.buffers.set(2, '')
            }
            state.buffers.set(3, '0')
            break
          }
          case 787: {
            requireBytes(bytes, cursor, 6, opcode)
            const placementDestination = view.getUint16(cursor, true)
            const prizeDestination = view.getUint16(cursor + 2, true)
            const speciesDestination = view.getUint16(cursor + 4, true)
            cursor += 6
            const contest = state.bugContest ??= { weekday: 0, registeredContestants: [], elapsedMinutes: 0 }
            // Sans capture, le moteur natif attribue la consolation et la
            // Mue (Shed Shell). Les captures futures peuvent injecter le vrai
            // classement calculé par le runtime de rencontres.
            contest.placement ??= contest.caughtPokemon ? 0 : 3
            contest.prizeItemId ??= contest.placement === 0 ? 80 : contest.placement === 1 ? 229 : contest.placement === 2 ? 158 : 295
            state.variables.set(placementDestination, contest.placement)
            state.variables.set(prizeDestination, contest.prizeItemId)
            state.variables.set(speciesDestination, contest.caughtPokemon?.speciesId ?? 0)
            break
          }
          case 789: {
            requireBytes(bytes, cursor, 1, opcode)
            const bufferId = bytes[cursor]!
            cursor += 1
            const timeLeft = state.bugContest && state.bugContest.elapsedMinutes < 20
              ? 20 - state.bugContest.elapsedMinutes
              : 1
            state.buffers.set(bufferId, String(timeLeft).padStart(2, ' '))
            break
          }
          case 828: {
            requireBytes(bytes, cursor, 5, opcode)
            const slot = readScriptValue(cursor)
            const attribute = bytes[cursor + 2]!
            const modifier = readScriptValue(cursor + 3)
            const pokemon = getPokemonPartyMember(state.party, slot)
            if (pokemon && attribute < 6) {
              const values = pokemon.contestValues ??= [0, 0, 0, 0, 0, 0]
              if (values[5] !== 255) values[attribute] = Math.min(255, values[attribute] + modifier)
            }
            cursor += 5
            break
          }
          case 790: {
            requireBytes(bytes, cursor, 4, opcode)
            const contestantId = readScriptValue(cursor)
            const destination = view.getUint16(cursor + 2, true)
            state.variables.set(destination, state.bugContest?.registeredContestants.includes(contestantId) ? 1 : 0)
            cursor += 4
            break
          }
          case 791: cursor = runHgssSafariChallengeCheckOpcode(state, bytes, cursor); break
          case 792: updateHgssSafariIgtReferenceFromRuntime(state); break
          case 820: {
            requireBytes(bytes, cursor, 1, opcode)
            const mode = bytes[cursor]!
            cursor += 1
            if (mode > 3) throw new Error(`Effet de scène Sinjoh HGSS ${mode} invalide.`)
            return { kind: 'specialCutscene', effect: 'sinjohStage', parameter: mode }
          }
          case 822: return suspendMultiplayer(createHgssSafariAreaExchangeRequest(state, multiplayerRequestBase(opcode, commandOffset)), (result) => applyHgssSafariAreaExchangeResult(state, result))
          case 823: case 824: cursor = runHgssSafariImmediateOpcode(opcode, scriptMap, state, bytes, cursor); break
          case 816:
            return { kind: 'specialCutscene', effect: 'sinjohCircle' }
          case 817: {
            requireBytes(bytes, cursor, 1, opcode)
            const legendaryChoice = bytes[cursor]!
            cursor += 1
            if (legendaryChoice > 2) throw new Error(`Choix d’Œuf Sinjoh HGSS ${legendaryChoice} invalide.`)
            return { kind: 'specialCutscene', effect: 'sinjohEgg', parameter: legendaryChoice }
          }
          case 818:
            initializeHgssGymmickState(state, 9)
            break
          case 819:
            return { kind: 'specialCutscene', effect: 'sinjohRestore' }
          case 852: {
            requireBytes(bytes, cursor, 2, opcode)
            const bufferId = bytes[cursor]!
            const floor = bytes[cursor + 1]!
            if (floor > 6) throw new Error(`Étage de grand magasin HGSS ${floor} invalide.`)
            const messageId = floor === 0 ? 122 : 116 + floor - 1
            state.buffers.set(bufferId, scriptMap.externalMessages?.[191]?.[messageId] ?? (floor === 0 ? 'RDC' : `${floor}F`))
            cursor += 2
            break
          }
          case 247:
            // Dummy officiel conservé dans la table HGSS.
            break
          case 248: {
            requireBytes(bytes, cursor, 5, opcode)
            const national = bytes[cursor] !== 0
            const messageDestination = view.getUint16(cursor + 1, true)
            const fanfareDestination = view.getUint16(cursor + 3, true)
            cursor += 5
            const evaluation = evaluateHgssPokedex(
              state.pokedex.caughtSpeciesIds,
              national,
              state.gender,
              requirePokemonRuntime(state).pokedexCatalog?.johtoDexNumbers,
            )
            state.variables.set(messageDestination, evaluation.messageId)
            state.variables.set(fanfareDestination, evaluation.fanfareSequenceId)
            break
          }
          default:
            throw new Error(`Opcode HGSS ${opcode} non pris en charge a l’offset ${commandOffset}.`)
        }
      }
      throw new Error('Le script depasse la limite de 1024 commandes sans suspension ni fin.')
    },
  }
}
