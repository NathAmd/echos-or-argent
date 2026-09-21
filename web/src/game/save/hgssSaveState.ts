import type { PlayerDirection, PokemonCatalog } from '../../ndsTypes'
import type { PlayerProfile } from '../../playerProfile'
import type { CanonicalPokemon, CanonicalPokemonMove } from '../pokemon/canonicalPokemon'
import type { SavedFollowerWorldState } from '../world/worldSession'
import { restoreHgssSessionRng, snapshotHgssSessionRng, type HgssSessionRng, type HgssSessionRngSnapshot } from '../pokemon/hgssSessionRng'
import { createFieldScriptState, type FieldMapProp, type FieldPokemonRuntime, type FieldScriptActorState, type FieldScriptState } from '../scripts/fieldScriptRunner'
import { isHgssFieldMapTemporaryVariable, isHgssFieldScriptTemporaryVariable } from '../scripts/fieldVariableLifecycle'
import { createDefaultHgssGameOptions, type HgssGameOptions } from './hgssGameOptions'
import type { HgssItemCatalog } from '../../rom/items/itemData'
import type { HgssPokedexCatalog } from '../../rom/pokedex/pokedexData'
import type { PlayerLocomotionMode } from '../player/hgssPlayerMovement'
import { validateBagInventoryEntries } from '../items/bagInventory'
import { hgssPokedexMagic, restoreHgssPokedex, snapshotHgssPokedex, type HgssPokedexSnapshot } from '../pokedex/hgssPokedex'
import { createPokemonStorage, hgssStorageBoxCapacity, hgssStorageBoxCount } from '../pokemon/pokemonStorage'
import { getPokemonPartyPokeathlonModifiers } from '../pokemon/pokemonParty'
import type { HgssPokeathlonModifiers } from '../../rom/pokemon/pokeathlonPerformance'
import type { HgssMailMessage } from '../trainerHouse/hgssTrainerHouse'
import { createHgssRoamerSaveState, type HgssRoamer, type HgssRoamerSaveState } from '../encounters/hgssRoamers'
import { cloneHgssFriendGroupState, createHgssFriendGroupState, type HgssFriendGroupState } from '../multiplayer/hgssFriendGroups'
import { parseHgssP2pTradeReceipts, type HgssP2pTradeReceipt } from '../multiplayer/hgssP2pTradeReceipt'
import { parseHgssP2pTradeJournals, type HgssP2pTradeJournal } from '../multiplayer/hgssP2pTradeJournal'
import { restoreHgssPhoneContacts } from '../../rom/phone/phoneBook'
import { resolveHgssTimeOfDay, type HgssTimeOfDay } from '../time/hgssRtc'
import { hgssWeather, type HgssWeather } from '../world/hgssWeather'
import { clonePokegearNativeState, normalizePokegearNativeState } from '../pokegear/pokegearNativeState'
import {
  restoreHgssSafariProgression,
  restoreHgssSafariState,
  snapshotHgssSafariProgression,
  snapshotHgssSafariState,
  validateSavedHgssSafariProgression,
  validateSavedHgssSafariState,
  type SavedHgssSafariProgressionState,
  type SavedHgssSafariState,
} from '../safari/hgssSafariPersistence'
import { hgssBaobaPhoneContactId, hgssSafariQuestStageVariable, synchronizeHgssSafariQuestState } from '../safari/hgssSafariFieldRuntime'
import { restoreHgssInGameTime, type HgssInGameTime } from '../time/hgssInGameTime'
import { restoreHgssPhotoAlbum, snapshotHgssDataOnlyPhotoAlbum, type HgssDataOnlyPhotoAlbum, type HgssPhotoAlbumState } from '../photo/hgssPhotoAlbum'
import {
  restoreHgssRtcPenaltyState,
  snapshotHgssRtcPenaltyState,
  validateHgssRtcPenaltyState,
  type HgssRtcContinueOptions,
  type HgssRtcPenaltyState,
} from '../time/hgssRtcPenalty'
import { isNewGamePlusSourceForGameCode } from '../newGamePlus/newGamePlusProfile'
import type { NewGamePlusProfileV1 } from '../newGamePlus/newGamePlusTypes'
import { createBuiltInNewGamePlusRegistry } from '../newGamePlus/modules'
import { HGSS_LEGACY_HALL_OF_FAME_EVIDENCE_FLAG } from '../newGamePlus/newGamePlusEligibility'
import { HGSS_GAME_CLEAR_SYSTEM_FLAG } from '../scripts/hgssFieldSystemFlags'
import type { VersionedSaveExtensions } from './versionedSaveExtensions'
import { deriveLegacyPokemonInstanceId, parsePokemonInstanceId, parsePortablePokemonInstanceId, type PokemonInstanceId } from '../pokemon/pokemonInstanceId'
import type { HgssNpcTrade } from '../../rom/pokemon/npcTradeData'
import type { HgssPhotoDataCatalog } from '../../rom/photo/photoData'
import { parseHgssDataOnlyExtensions } from './hgssDataOnlyExtensions'
import { assertHgssSharedCampaignProgressionMatchesFieldState } from '../multiplayer/hgssSharedCampaignProgression'
import { readHgssSharedCampaignSaveExtension } from './hgssSharedCampaignSaveExtension'

const hgssDataOnlyNewGamePlusRegistry = createBuiltInNewGamePlusRegistry()

function assertSharedCampaignMatchesField(
  field: Readonly<{
    gender: FieldScriptState['gender']
    playerName: string
    flags: Iterable<number>
    badges: Iterable<number>
    trainerFlags: Iterable<number>
    variables: Iterable<readonly [number, number]>
  }>,
  extensions: VersionedSaveExtensions | undefined,
): void {
  const campaign = readHgssSharedCampaignSaveExtension(extensions)
  if (!campaign) return
  const projection = createFieldScriptState(field.gender, field.playerName)
  projection.flags = new Set(field.flags)
  projection.badges = new Set(field.badges)
  projection.trainerFlags = new Set(field.trainerFlags)
  projection.variables = new Map(field.variables)
  assertHgssSharedCampaignProgressionMatchesFieldState(
    projection,
    campaign.appliedProgression,
  )
}

// Drapeaux natifs de flags.h. Le script T20R0201 les remet dans cet ordre
// pendant la toute premiere conversation avec Maman.
const hgssGotStarterFlag = 0x6a
const hgssGotPokegearFlag = 0x9c
const hgssGotBagFlag = 0x11b
const hgssGotSaveButtonFlag = 0x11d
const hgssGotOptionsButtonFlag = 0x11e
const hgssPlayersHouseSceneVariable = 0x4106
const hgssCherrygroveSceneVariable = 0x4073
const hgssLanguageByRegion: Readonly<Record<string, number>> = { J: 1, E: 2, F: 3, I: 4, D: 5, S: 7, K: 8 }

function resolveNumericRomIdentity(gameCode: string): { gameVersion: number, language: number } {
  const gameVersion = gameCode.slice(0, 3) === 'IPK' ? 7 : gameCode.slice(0, 3) === 'IPG' ? 8 : undefined
  const language = hgssLanguageByRegion[gameCode[3] ?? '']
  if (gameVersion === undefined || language === undefined) throw new Error(`Le code ROM HGSS ${gameCode} n'est pas pris en charge.`)
  return { gameVersion, language }
}

type SavedPokemonMove = Pick<CanonicalPokemonMove, 'moveId' | 'pp' | 'maxPp' | 'ppUps'>
type SavedPokemonTrainer = {
  id: number
  gender: 'male' | 'female'
  /** Préserve les règles mécaniques d'OT sans transporter son nom. */
  isPlayer?: boolean
  /** Anciennes saves: texte sans provenance. Nouvelles saves: uniquement saisie joueur attestée. */
  name?: string
  nameSource?: 'user-text' | 'local-ref'
  /** Référence locale à l'entrée de l'échange PNJ, sans recopier son libellé ROM. */
  localTradeId?: number
}
type SavedPokemon = {
  instanceId?: PokemonInstanceId
  speciesId: number
  nickname?: string
  nicknameSource?: 'user-text' | 'local-ref'
  /** 0 = libellé local d'Œuf; N > 0 = échange PNJ N - 1. */
  nicknameLocalRef?: number
  form: number
  personality: number
  originalTrainer: SavedPokemonTrainer
  origin: CanonicalPokemon['origin']
  level: number
  experience: number
  individualValues: CanonicalPokemon['individualValues']
  effortValues: CanonicalPokemon['effortValues']
  nature: number
  gender: CanonicalPokemon['gender']
  abilityId: number
  shiny: boolean
  friendship: number
  moves: SavedPokemonMove[]
  stats: CanonicalPokemon['stats']
  currentHp: number
  status: number
  /** Absent des sauvegardes antérieures à la conservation de l'octet PK4. */
  pokerus?: number
  heldItemId: number
  /** Anciennes saves uniquement. */
  mailIdentity?: 'kenya'
  /** 1 désigne le courrier Kenya; extensible sans chaîne locale. */
  mailIdentityCode?: number
  ballId: number
  isEgg: boolean
  fatefulEncounter: boolean
  shinyLeafMask: number
  contestValues?: CanonicalPokemon['contestValues']
  ribbonIds: number[]
}
type SavedTrainerHouseEntry = {
  trainerId: number
  spriteId: number
  language: number
  gameVersion: number
  gender: 'male' | 'female'
  name: string
  nameSource?: 'user-text'
  introMessage: HgssMailMessage
  winMessage: HgssMailMessage
  loseMessage: HgssMailMessage
  party: SavedPokemon[]
}
type SavedDaycareState = {
  mons: Array<{ pokemon: SavedPokemon, steps: number } | null>
  eggPersonality: number
  eggCycleCounter: number
}
type SavedRoamer = Omit<HgssRoamer, 'instanceId'> & { instanceId?: PokemonInstanceId }
type SavedRoamerState = Omit<HgssRoamerSaveState, 'roamers'> & { roamers: Array<SavedRoamer | null> }

export type HgssSavedWorldPosition = {
  mapId: number
  tileX: number
  tileZ: number
  direction: PlayerDirection
  /** Absent des sauvegardes créées avant les états Vélo et Surf. */
  locomotion?: PlayerLocomotionMode
  follower?: SavedFollowerWorldState
}

type SavedFieldScriptState = {
  mailboxMessageCount: number
  /** Absent des sauvegardes antérieures au décodage du courrier Kenya. */
  mailboxMailIdentities?: Array<'kenya' | null>
  /** Identités de courrier portables; 1 désigne Kenya. */
  mailboxMailIdentityCodes?: Array<number | null>
  gender: 'male' | 'female'
  playerName: string
  playerNameSource?: 'user-text'
  friendName?: string
  friendNameSource?: 'user-text'
  rivalName?: string
  rivalNameSource?: 'user-text'
  variables: [number, number][]
  flags: number[]
  /** Absent des sauvegardes créées avant les scripts Dresseur complets. */
  trainerFlags?: number[]
  hiddenObjectIds: number[]
  buffers: [number, string][]
  inventory: [number, number][]
  /** SaveApricornBox natif; absent des sauvegardes antérieures à son décodage. */
  apricornBox?: [number, number, number, number, number, number, number]
  harvestedApricornTrees?: number[]
  apricornTreeDay?: string
  badges: number[]
  phoneContacts: number[]
  /** Absent des sauvegardes créées avant les revanches Pokématos. */
  phoneRematchSeeking?: number[]
  /** Absent des sauvegardes créées avant les cadeaux Pokématos. */
  phoneGiftItems?: [number, number][]
  /** Drapeaux persistants des appels narratifs en attente. */
  phoneCallTriggers?: number[]
  kenjiActive?: boolean
  kenjiWaitDays?: number
  kenjiDay?: string
  /** Absent des sauvegardes créées avant la file de cadeaux de Maman. */
  momGiftItems?: number[]
  pokegearCards: number[]
  pokegearMapUnlockLevel?: number
  pokegear?: FieldScriptState['pokegear']
  /** LocalFieldData::musicId, utilisé par la Radio, la Flûte Poké et les scripts. */
  radioMusicSequenceId?: number
  /** Compteur LocalFieldData des dégâts de poison hors combat (0..3). */
  poisonStepCounter?: number
  /** Compteur SaveVarsFlags du gain d'amitié de marche (0..127). */
  friendshipStepCounter?: number
  friendRosterCount?: number
  /** Absent des sauvegardes antérieures au décodage de SAV_FRIEND_GRP. */
  friendGroups?: HgssFriendGroupState
  easyChatTrendySayings?: number[]
  easyChatMailMessages?: [number, number][]
  battleGreetingWords?: [number, number, number, number]
  fashionPortraits?: number[]
  fashionPortraitEasyChatWords?: [number, number][]
  /** Quantités de la Boîte Mode, absentes des sauvegardes antérieures à son décodage. */
  fashionAccessories?: [number, number][]
  /** Décors de la Boîte Mode, absents des sauvegardes antérieures à son décodage. */
  fashionBackgrounds?: number[]
  trainerHouseEntries?: Array<SavedTrainerHouseEntry | null>
  daycare?: SavedDaycareState
  /** Absent des sauvegardes antérieures au décodage des Pokémon fuyards. */
  roamers?: SavedRoamerState
  /** Absent des sauvegardes antérieures au décodage du Pokémon favori SaveMisc. */
  favoritePokemon?: { speciesId: number, form: number, isEgg: boolean }
  unionAvatarSpriteId?: number
  money: number
  coins?: number
  athletePoints?: number
  battlePoints?: number
  battlePointsReceived?: number
  battlePointsSpent?: number
  pokeathlonRecords?: number[]
  /** Absent des sauvegardes antérieures au décodage des Cartes Données Pokéathlon. */
  pokeathlonDataCards?: number[]
  bankBalance: number
  /** Absent des sauvegardes créées avant le score natif GameStats. */
  gameScore?: number
  gameStats?: [number, number][]
  /** Reçus data-only récents; absents des sauvegardes créées avant les échanges P2P. */
  p2pTradeReceipts?: HgssP2pTradeReceipt[]
  /** Transactions P2P data-only non finalisées, nécessaires à une reprise après coupure. */
  p2pTradeJournals?: HgssP2pTradeJournal[]
  /** Absent des sauvegardes créées avant les records Frontier. */
  frontierRecords?: [number, number][]
  /** Paliers natifs de 20/50/100 victoires déjà remis à la Tour. */
  frontierMilestoneRewards?: number[]
  judgeStatPosition?: number
  frontierChallengeState?: number
  battleHallUsedSpecies?: number[]
  /** Session Frontier inter-carte; uniquement des choix/IDs numériques. */
  frontierSession?: {
    towerMode: number
    requiredCount: number
    partySlots: number[]
    resumed: boolean
    multiBattleAllyId: number
    statTrainerMons: Array<Array<{ speciesId: number, firstMoveId: number }>>
  }
  blackoutSpawn: number
  party: SavedPokemon[]
  /** PartyExtra natif; absent des sauvegardes antérieures au calcul Pokéathlon follower. */
  partyPokeathlonModifiers?: HgssPokeathlonModifiers[]
  /** Absent des anciennes sauvegardes V1 creees avant l'implementation du PC. */
  pokemonStorage?: {
    currentBox: number
    boxes: (SavedPokemon | null)[][]
  }
  pokedex?: HgssPokedexSnapshot
  caughtSpeciesIds?: number[]
  timeOfDay: HgssTimeOfDay
  /** LocalFieldData::weatherType; absent des sauvegardes antérieures à la météo globale. */
  weather?: HgssWeather
  starterChoice?: number
  /** Espèce effective du Pokémon qui remplit le rôle narratif du starter. */
  starterStorySpeciesId?: number
  followMonActive: boolean
  followMonMovementPaused: boolean
  followMonInhibited?: boolean
  followerMood?: number
  pokedexEnabled?: boolean
  runningShoes: boolean
  mysteryGiftActive: boolean
  safariZone?: SavedHgssSafariState
  safariProgression?: SavedHgssSafariProgressionState
  /** Save_PhotoAlbum natif; absent des sauvegardes navigateur antérieures. */
  photoAlbum?: HgssPhotoAlbumState | HgssDataOnlyPhotoAlbum
  /** Absent des sauvegardes créées avant le décodage du Parc des Amis. */
  palPark?: {
    catchingShowActive: boolean
    migratedPokemon: SavedPokemon[]
    catchingPoints?: number
    timePoints?: number
    typePoints?: number
  }
  bugContest?: {
    weekday: number
    registeredContestants: number[]
    elapsedMinutes?: number
    caughtPokemon?: SavedPokemon
    placement?: number
    prizeItemId?: number
  }
  kurtApricornType?: number
  kurtApricornQuantity?: number
  kurtBallId?: number
  togepiEggIdentity?: { personality: number, gender: 'male' | 'female' | 'genderless' }
  playerState?: number
  pendingPhoneCall?: { callerId: number, parameter1: number, parameter2: number }
  player: FieldScriptActorState
  objects: [number, FieldScriptActorState][]
  mapProps: FieldMapProp[]
  currentMapId?: number
  previousMapId?: number
  dynamicWarp?: { mapId: number, warpId: number, x: number, z: number, direction: number }
  /** Absent des sauvegardes antérieures au bloc Save_Gymmick natif. */
  gymmick?: { type: number, data: number[] }
}

const savedFieldScriptStateKeys = new Set([
  'apricornBox', 'apricornTreeDay', 'athletePoints', 'badges', 'bankBalance', 'battleGreetingWords',
  'battleHallUsedSpecies', 'battlePoints', 'battlePointsReceived', 'battlePointsSpent', 'blackoutSpawn',
  'buffers', 'bugContest', 'caughtSpeciesIds', 'coins', 'currentMapId', 'daycare', 'dynamicWarp',
  'easyChatMailMessages', 'easyChatTrendySayings', 'fashionAccessories', 'fashionBackgrounds',
  'fashionPortraitEasyChatWords', 'fashionPortraits', 'favoritePokemon', 'flags', 'followMonActive',
  'followMonInhibited', 'followMonMovementPaused', 'followerMood', 'friendGroups', 'friendName',
  'friendNameSource', 'friendRosterCount', 'friendshipStepCounter', 'frontierChallengeState', 'frontierSession',
  'frontierMilestoneRewards', 'frontierRecords', 'gameScore', 'gameStats', 'gender', 'gymmick',
  'harvestedApricornTrees', 'hiddenObjectIds', 'inventory', 'judgeStatPosition', 'kenjiActive',
  'kenjiDay', 'kenjiWaitDays', 'kurtApricornQuantity', 'kurtApricornType', 'kurtBallId',
  'mailboxMailIdentities', 'mailboxMailIdentityCodes', 'mailboxMessageCount', 'mapProps', 'money', 'mysteryGiftActive',
  'momGiftItems', 'objects', 'palPark', 'party', 'partyPokeathlonModifiers', 'pendingPhoneCall', 'phoneCallTriggers', 'phoneContacts',
  'phoneGiftItems', 'phoneRematchSeeking', 'photoAlbum', 'player', 'playerName', 'playerNameSource',
  'playerState', 'poisonStepCounter', 'pokedex', 'pokedexEnabled', 'pokeathlonDataCards',
  'pokeathlonRecords', 'pokegear', 'pokegearCards', 'pokegearMapUnlockLevel', 'pokemonStorage',
  'p2pTradeJournals', 'p2pTradeReceipts', 'previousMapId', 'radioMusicSequenceId', 'rivalName', 'rivalNameSource', 'roamers', 'runningShoes',
  'safariProgression', 'safariZone', 'starterChoice', 'starterStorySpeciesId', 'timeOfDay',
  'togepiEggIdentity', 'trainerFlags', 'trainerHouseEntries', 'unionAvatarSpriteId', 'variables', 'weather',
])

export type HgssSaveStateV1 = {
  version: 1
  /** Anciennes sauvegardes uniquement; les nouvelles utilisent l'identité numérique. */
  romGameCode?: string
  romIdentity?: { gameVersion: number, language: number }
  profile: PlayerProfile & { nameSource?: 'user-text' }
  rng: HgssSessionRngSnapshot
  world: HgssSavedWorldPosition
  field: SavedFieldScriptState
  options?: HgssGameOptions
  /** Save_PlayerData::IGT; absent des sauvegardes navigateur antérieures. */
  igt?: HgssInGameTime
  /** Save_SysInfo::rtc_info portable; absent des sauvegardes navigateur antérieures. */
  rtcPenalty?: HgssRtcPenaltyState
  /** Absent des parties normales : le gameplay de base ne consulte jamais ce profil. */
  newGamePlus?: NewGamePlusProfileV1
  /** État privé des règles optionnelles, versionné par contributeur. */
  extensions?: VersionedSaveExtensions
}

export type RestoredHgssSaveState = {
  profile: PlayerProfile
  rng: HgssSessionRng
  world: HgssSavedWorldPosition
  field: FieldScriptState
  options: HgssGameOptions
  igt: HgssInGameTime
  rtcPenalty: HgssRtcPenaltyState
  newGamePlus?: NewGamePlusProfileV1
  extensions?: VersionedSaveExtensions
}

export type HgssSaveLocalRomResources = Readonly<{
  npcTradeCatalog?: readonly HgssNpcTrade[]
  photoDataCatalog?: HgssPhotoDataCatalog
}>

function restoreGameOptions(value: unknown): HgssGameOptions {
  if (value === undefined) return createDefaultHgssGameOptions()
  const options = requireRecord(value, 'options')
  requireOnlyKeys(options, new Set(['battleAnimations', 'localWeather', 'textSpeed']), 'options')
  if (options.textSpeed !== 'slow' && options.textSpeed !== 'normal' && options.textSpeed !== 'fast') {
    throw new Error('La sauvegarde HGSS contient une vitesse invalide a options.textSpeed.')
  }
  const battleAnimations = requireBoolean(options.battleAnimations, 'options.battleAnimations')
  const localWeather = options.localWeather === undefined ? false : requireBoolean(options.localWeather, 'options.localWeather')
  return { textSpeed: options.textSpeed, battleAnimations, localWeather }
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`La sauvegarde HGSS contient une valeur invalide a ${path}.`)
  }
  return value as Record<string, unknown>
}

function requireOnlyKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>, path: string): void {
  const unknownKey = Object.keys(record).find((key) => !allowed.has(key))
  if (unknownKey !== undefined) throw new Error(`La sauvegarde HGSS contient un champ inconnu à ${path}.${unknownKey}.`)
}

function requireInteger(value: unknown, path: string, minimum = 0, maximum = 0xffffffff): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`La sauvegarde HGSS contient un entier invalide a ${path}.`)
  }
  return value as number
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new Error(`La sauvegarde HGSS contient un texte invalide a ${path}.`)
  return value
}

function requireBoundedText(value: unknown, path: string, maximumCharacters: number, minimumCharacters = 0): string {
  const text = requireString(value, path)
  const length = [...text].length
  if (length < minimumCharacters || length > maximumCharacters) {
    throw new Error(`La sauvegarde HGSS contient un texte hors limites a ${path}.`)
  }
  return text
}

function requireFieldDay(value: unknown, path: string): string {
  const text = requireString(value, path)
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text)
  const year = Number(match?.[1])
  const month = Number(match?.[2])
  const day = Number(match?.[3])
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (!match || parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new Error(`La sauvegarde HGSS contient un jour invalide a ${path}.`)
  }
  return text
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`La sauvegarde HGSS contient un booleen invalide a ${path}.`)
  return value
}

function requireFiniteNumber(value: unknown, path: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`La sauvegarde HGSS contient un nombre invalide a ${path}.`)
  }
  return value
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`La sauvegarde HGSS contient une liste invalide a ${path}.`)
  return value
}

function validateIntegerList(value: unknown, path: string): void {
  requireArray(value, path).forEach((entry, index) => requireInteger(entry, `${path}[${index}]`))
}

function validateIntegerPairs(value: unknown, path: string): void {
  requireArray(value, path).forEach((entry, index) => {
    const pair = requireArray(entry, `${path}[${index}]`)
    if (pair.length !== 2) throw new Error(`La sauvegarde HGSS contient un tuple invalide a ${path}[${index}].`)
    requireInteger(pair[0], `${path}[${index}][0]`)
    requireInteger(pair[1], `${path}[${index}][1]`)
  })
}

function validateActor(value: unknown, path: string): void {
  const actor = requireRecord(value, path)
  requireOnlyKeys(actor, new Set(['direction', 'groundHeight', 'movement', 'x', 'z']), path)
  requireInteger(actor.x, `${path}.x`, -0x8000, 0x7fff)
  requireInteger(actor.z, `${path}.z`, -0x8000, 0x7fff)
  if (!['north', 'south', 'east', 'west'].includes(String(actor.direction))) {
    throw new Error(`La sauvegarde HGSS contient une direction invalide a ${path}.direction.`)
  }
  if (actor.groundHeight !== undefined) requireFiniteNumber(actor.groundHeight, `${path}.groundHeight`, -0x8000, 0x7fff)
  if (actor.movement !== undefined) requireInteger(actor.movement, `${path}.movement`, 0, 0xffff)
}

function validateStats(value: unknown, path: string): void {
  const stats = requireRecord(value, path)
  requireOnlyKeys(stats, new Set(['attack', 'defense', 'hp', 'specialAttack', 'specialDefense', 'speed']), path)
  for (const stat of ['hp', 'attack', 'defense', 'speed', 'specialAttack', 'specialDefense']) {
    requireInteger(stats[stat], `${path}.${stat}`, 0, 0xffff)
  }
}

function validateSavedPokemon(value: unknown, path: string): void {
  const pokemon = requireRecord(value, path)
  requireOnlyKeys(pokemon, new Set([
    'abilityId', 'ballId', 'contestValues', 'currentHp', 'effortValues', 'experience', 'fatefulEncounter',
    'form', 'friendship', 'gender', 'heldItemId', 'individualValues', 'instanceId', 'isEgg', 'level',
    'mailIdentity', 'mailIdentityCode', 'moves', 'nature', 'nickname', 'nicknameLocalRef', 'nicknameSource',
    'origin', 'originalTrainer', 'personality', 'pokerus', 'ribbonIds', 'shiny', 'shinyLeafMask', 'speciesId', 'stats', 'status',
  ]), path)
  if (pokemon.instanceId !== undefined) parsePokemonInstanceId(pokemon.instanceId)
  for (const key of ['speciesId', 'form', 'personality', 'level', 'experience', 'nature', 'abilityId', 'friendship', 'currentHp', 'status', 'heldItemId', 'ballId']) {
    requireInteger(pokemon[key], `${path}.${key}`)
  }
  if (pokemon.pokerus !== undefined) requireInteger(pokemon.pokerus, `${path}.pokerus`, 0, 0xff)
  const trainer = requireRecord(pokemon.originalTrainer, `${path}.originalTrainer`)
  requireOnlyKeys(trainer, new Set(['gender', 'id', 'isPlayer', 'localTradeId', 'name', 'nameSource']), `${path}.originalTrainer`)
  requireInteger(trainer.id, `${path}.originalTrainer.id`)
  if (trainer.isPlayer !== undefined) requireBoolean(trainer.isPlayer, `${path}.originalTrainer.isPlayer`)
  if (trainer.name !== undefined) requireBoundedText(trainer.name, `${path}.originalTrainer.name`, 7)
  if (trainer.nameSource !== undefined && trainer.nameSource !== 'user-text' && trainer.nameSource !== 'local-ref') {
    throw new Error(`La sauvegarde HGSS contient une provenance OT invalide a ${path}.originalTrainer.nameSource.`)
  }
  if (trainer.localTradeId !== undefined) requireInteger(trainer.localTradeId, `${path}.originalTrainer.localTradeId`, 0, 12)
  // Un OT externe d'une save legacy peut être un autre joueur ou un libellé
  // local de cadeau impossible à distinguer. Son ID/genre restent jouables ;
  // le texte ambigu est omis au lieu d'être faussement attesté.
  if (trainer.nameSource === 'user-text' && trainer.name === undefined) {
    throw new Error(`La sauvegarde HGSS contient une provenance OT sans texte a ${path}.originalTrainer.`)
  }
  if (trainer.gender !== 'male' && trainer.gender !== 'female') throw new Error(`La sauvegarde HGSS contient un genre invalide a ${path}.originalTrainer.gender.`)
  const origin = requireRecord(pokemon.origin, `${path}.origin`)
  requireOnlyKeys(origin, new Set(['eggDate', 'eggLocation', 'gameVersion', 'language', 'metDate', 'metLevel', 'metLocation', 'metTerrain']), `${path}.origin`)
  for (const key of ['language', 'gameVersion', 'metLocation', 'metLevel', 'metTerrain']) requireInteger(origin[key], `${path}.origin.${key}`)
  if (origin.metDate !== undefined) {
    const metDate = requireRecord(origin.metDate, `${path}.origin.metDate`)
    requireOnlyKeys(metDate, new Set(['day', 'month', 'year']), `${path}.origin.metDate`)
    // The runtime deliberately keeps a civil year (for example 2026). The
    // native PK4 encoding only stores the last two digits, but rejecting the
    // richer runtime representation here made every newly caught or received
    // Pokémon invalidate the complete browser save on the next boot. Keep
    // accepting legacy two-digit snapshots while validating full civil years.
    const year = requireInteger(metDate.year, `${path}.origin.metDate.year`, 0, 9999)
    if (year > 99 && year < 1900) {
      throw new Error(`La sauvegarde HGSS contient une année invalide a ${path}.origin.metDate.year.`)
    }
    requireInteger(metDate.month, `${path}.origin.metDate.month`, 1, 12)
    requireInteger(metDate.day, `${path}.origin.metDate.day`, 1, 31)
  }
  if (origin.eggLocation !== undefined) requireInteger(origin.eggLocation, `${path}.origin.eggLocation`)
  if (origin.eggDate !== undefined) {
    const eggDate = requireRecord(origin.eggDate, `${path}.origin.eggDate`)
    requireOnlyKeys(eggDate, new Set(['day', 'month', 'year']), `${path}.origin.eggDate`)
    const year = requireInteger(eggDate.year, `${path}.origin.eggDate.year`, 0, 9999)
    if (year > 99 && year < 1900) throw new Error(`La sauvegarde HGSS contient une année invalide a ${path}.origin.eggDate.year.`)
    requireInteger(eggDate.month, `${path}.origin.eggDate.month`, 1, 12)
    requireInteger(eggDate.day, `${path}.origin.eggDate.day`, 1, 31)
  }
  if (pokemon.nickname !== undefined) requireBoundedText(pokemon.nickname, `${path}.nickname`, 10, 1)
  if (pokemon.nicknameSource !== undefined
    && pokemon.nicknameSource !== 'user-text'
    && pokemon.nicknameSource !== 'local-ref') {
    throw new Error(`La sauvegarde HGSS contient une provenance de surnom invalide a ${path}.nicknameSource.`)
  }
  if (pokemon.nickname === undefined && pokemon.nicknameSource !== undefined) {
    throw new Error(`La sauvegarde HGSS contient une provenance sans surnom a ${path}.nicknameSource.`)
  }
  if (pokemon.nicknameLocalRef !== undefined) requireInteger(pokemon.nicknameLocalRef, `${path}.nicknameLocalRef`, 0, 13)
  if (pokemon.nickname !== undefined && pokemon.nicknameLocalRef !== undefined) {
    throw new Error(`La sauvegarde HGSS contient à la fois un texte et une référence de surnom a ${path}.`)
  }
  if (pokemon.mailIdentity !== undefined && pokemon.mailIdentity !== 'kenya') {
    throw new Error(`La sauvegarde HGSS contient une identité de courrier invalide à ${path}.mailIdentity.`)
  }
  if (pokemon.mailIdentityCode !== undefined) requireInteger(pokemon.mailIdentityCode, `${path}.mailIdentityCode`, 1, 1)
  if (!['male', 'female', 'genderless'].includes(String(pokemon.gender))) throw new Error(`La sauvegarde HGSS contient un genre invalide a ${path}.gender.`)
  validateStats(pokemon.individualValues, `${path}.individualValues`)
  validateStats(pokemon.effortValues, `${path}.effortValues`)
  validateStats(pokemon.stats, `${path}.stats`)
  requireBoolean(pokemon.shiny, `${path}.shiny`)
  requireBoolean(pokemon.isEgg, `${path}.isEgg`)
  requireBoolean(pokemon.fatefulEncounter, `${path}.fatefulEncounter`)
  if (pokemon.shinyLeafMask !== undefined) requireInteger(pokemon.shinyLeafMask, `${path}.shinyLeafMask`, 0, 0x1f)
  if (pokemon.contestValues !== undefined) {
    const contestValues = requireArray(pokemon.contestValues, `${path}.contestValues`)
    if (contestValues.length !== 6) throw new Error(`La sauvegarde HGSS contient des valeurs de concours invalides à ${path}.contestValues.`)
    contestValues.forEach((value, index) => requireInteger(value, `${path}.contestValues[${index}]`, 0, 255))
  }
  validateIntegerList(pokemon.ribbonIds, `${path}.ribbonIds`)
  requireArray(pokemon.moves, `${path}.moves`).forEach((value, index) => {
    const move = requireRecord(value, `${path}.moves[${index}]`)
    requireOnlyKeys(move, new Set(['maxPp', 'moveId', 'pp', 'ppUps']), `${path}.moves[${index}]`)
    for (const key of ['moveId', 'pp', 'maxPp', 'ppUps']) requireInteger(move[key], `${path}.moves[${index}].${key}`)
  })
}

function validateSavedPokedex(value: unknown): void {
  const pokedex = requireRecord(value, 'field.pokedex')
  requireOnlyKeys(pokedex, new Set([
    'canDetectForms', 'caughtLanguages', 'caughtShinySpeciesIds', 'caughtSpeciesIds', 'caughtUnownForms',
    'enabled', 'internationalViewEnabled', 'magic', 'nationalDexEnabled', 'seenForms', 'seenGenders',
    'seenSpeciesIds', 'spindaPersonality',
  ]), 'field.pokedex')
  requireInteger(pokedex.magic, 'field.pokedex.magic')
  if (pokedex.magic !== hgssPokedexMagic) throw new Error('La sauvegarde HGSS contient une magie invalide a field.pokedex.magic.')
  for (const key of ['seenSpeciesIds', 'caughtSpeciesIds', 'caughtUnownForms']) {
    validateIntegerList(pokedex[key], `field.pokedex.${key}`)
  }
  if (pokedex.caughtShinySpeciesIds !== undefined) validateIntegerList(pokedex.caughtShinySpeciesIds, 'field.pokedex.caughtShinySpeciesIds')
  requireInteger(pokedex.spindaPersonality, 'field.pokedex.spindaPersonality')
  for (const key of ['canDetectForms', 'internationalViewEnabled', 'enabled', 'nationalDexEnabled']) {
    requireBoolean(pokedex[key], `field.pokedex.${key}`)
  }
  requireArray(pokedex.seenGenders, 'field.pokedex.seenGenders').forEach((entry, index) => {
    const pair = requireArray(entry, `field.pokedex.seenGenders[${index}]`)
    if (pair.length !== 2) throw new Error(`La sauvegarde HGSS contient un tuple invalide a field.pokedex.seenGenders[${index}].`)
    requireInteger(pair[0], `field.pokedex.seenGenders[${index}][0]`, 1, 493)
    requireArray(pair[1], `field.pokedex.seenGenders[${index}][1]`).forEach((gender, genderIndex) => {
      if (!['male', 'female', 'genderless'].includes(String(gender))) {
        throw new Error(`La sauvegarde HGSS contient un genre invalide a field.pokedex.seenGenders[${index}][1][${genderIndex}].`)
      }
    })
  })
  for (const key of ['seenForms', 'caughtLanguages']) {
    requireArray(pokedex[key], `field.pokedex.${key}`).forEach((entry, index) => {
      const pair = requireArray(entry, `field.pokedex.${key}[${index}]`)
      if (pair.length !== 2) throw new Error(`La sauvegarde HGSS contient un tuple invalide a field.pokedex.${key}[${index}].`)
      requireInteger(pair[0], `field.pokedex.${key}[${index}][0]`, 1, 493)
      validateIntegerList(pair[1], `field.pokedex.${key}[${index}][1]`)
    })
  }
}

function validateSavedP2pTradeRecovery(field: SavedFieldScriptState): void {
  const journals = parseHgssP2pTradeJournals(field.p2pTradeJournals ?? [])
  const receipts = parseHgssP2pTradeReceipts(field.p2pTradeReceipts ?? [])
  for (const journal of journals) {
    const occupant = journal.destination.kind === 'party'
      ? field.party[journal.destination.slot]
      : field.pokemonStorage?.boxes[journal.destination.box]?.[journal.destination.slot]
    const receipt = receipts.find(({ transactionId }) => transactionId === journal.transactionId)
    if (journal.phase === 'prepared') {
      if (occupant?.instanceId !== journal.outgoing.instanceId) {
        throw new Error("Un journal P2P préparé ne retrouve pas le Pokémon sortant à sa destination.")
      }
      if (receipt) throw new Error("Un journal P2P préparé ne peut pas déjà posséder un reçu de commit.")
      continue
    }
    if (occupant?.instanceId !== journal.incoming.instanceId
      || occupant.speciesId !== journal.result.receivedSpeciesId) {
      throw new Error("Un journal P2P commité ne retrouve pas son Pokémon reçu à sa destination.")
    }
    if (!receipt
      || receipt.sentPokemonInstanceId !== journal.outgoing.instanceId
      || receipt.receivedPokemonInstanceId !== journal.incoming.instanceId) {
      throw new Error("Un journal P2P commité ne possède pas son reçu exact.")
    }
  }
}

function validateSavedField(value: unknown): asserts value is SavedFieldScriptState {
  const field = requireRecord(value, 'field')
  requireOnlyKeys(field, savedFieldScriptStateKeys, 'field')
  requireInteger(field.mailboxMessageCount, 'field.mailboxMessageCount')
  if (field.mailboxMailIdentities !== undefined) {
    const identities = requireArray(field.mailboxMailIdentities, 'field.mailboxMailIdentities')
    if (identities.length !== 20) throw new Error('La sauvegarde HGSS doit contenir les 20 emplacements de la boîte aux lettres.')
    identities.forEach((identity, index) => {
      if (identity !== null && identity !== 'kenya') {
        throw new Error(`Identité de courrier invalide à field.mailboxMailIdentities[${index}].`)
      }
    })
  }
  if (field.mailboxMailIdentityCodes !== undefined) {
    const identities = requireArray(field.mailboxMailIdentityCodes, 'field.mailboxMailIdentityCodes')
    if (identities.length !== 20) throw new Error('La sauvegarde HGSS doit contenir les 20 codes de la boîte aux lettres.')
    identities.forEach((identity, index) => {
      if (identity !== null) requireInteger(identity, `field.mailboxMailIdentityCodes[${index}]`, 1, 1)
    })
  }
  if (field.gender !== 'male' && field.gender !== 'female') throw new Error('La sauvegarde HGSS contient un genre invalide a field.gender.')
  requireBoundedText(field.playerName, 'field.playerName', 7)
  if (field.playerNameSource !== undefined && field.playerNameSource !== 'user-text') throw new Error('La provenance de field.playerName est invalide.')
  for (const key of ['friendName', 'rivalName'] as const) {
    if (field[key] !== undefined) requireBoundedText(field[key], `field.${key}`, 7, 1)
    const source = field[`${key}Source`]
    if (source !== undefined && source !== 'user-text') throw new Error(`La provenance de field.${key} est invalide.`)
    if (source === 'user-text' && field[key] === undefined) throw new Error(`La provenance de field.${key} est sans texte.`)
  }
  validateIntegerPairs(field.variables, 'field.variables')
  validateIntegerList(field.flags, 'field.flags')
  if (field.trainerFlags !== undefined) validateIntegerList(field.trainerFlags, 'field.trainerFlags')
  validateIntegerList(field.hiddenObjectIds, 'field.hiddenObjectIds')
  requireArray(field.buffers, 'field.buffers').forEach((entry, index) => {
    const pair = requireArray(entry, `field.buffers[${index}]`)
    if (pair.length !== 2) throw new Error(`La sauvegarde HGSS contient un tuple invalide a field.buffers[${index}].`)
    requireInteger(pair[0], `field.buffers[${index}][0]`)
    requireString(pair[1], `field.buffers[${index}][1]`)
  })
  validateIntegerPairs(field.inventory, 'field.inventory')
  if (field.apricornBox !== undefined) {
    const counts = requireArray(field.apricornBox, 'field.apricornBox')
    if (counts.length !== 7) throw new Error('La Boîte Noigrume HGSS doit contenir sept compteurs.')
    counts.forEach((count, index) => requireInteger(count, `field.apricornBox[${index}]`, 0, 99))
  }
  if (field.harvestedApricornTrees !== undefined) {
    const trees = requireArray(field.harvestedApricornTrees, 'field.harvestedApricornTrees')
    trees.forEach((tree, index) => requireInteger(tree, `field.harvestedApricornTrees[${index}]`, 0, 30))
  }
  if (field.apricornTreeDay !== undefined) requireFieldDay(field.apricornTreeDay, 'field.apricornTreeDay')
  for (const key of ['badges', 'phoneContacts', 'pokegearCards']) validateIntegerList(field[key], `field.${key}`)
  if (field.pokegearMapUnlockLevel !== undefined) requireInteger(field.pokegearMapUnlockLevel, 'field.pokegearMapUnlockLevel', 0, 0xff)
  if (field.pokegear !== undefined) {
    const pokegear = requireRecord(field.pokegear, 'field.pokegear')
    requireOnlyKeys(pokegear, new Set(['lastUsedApp', 'mapMarkings', 'mapZoomed', 'radioCursorX', 'radioCursorY', 'skin', 'visitedMapIds']), 'field.pokegear')
    requireInteger(pokegear.lastUsedApp, 'field.pokegear.lastUsedApp', 0, 3)
    requireInteger(pokegear.skin, 'field.pokegear.skin', 0, 7)
    if (typeof pokegear.mapZoomed !== 'boolean') throw new Error('La sauvegarde HGSS contient un zoom Pokématos invalide.')
    requireInteger(pokegear.radioCursorX, 'field.pokegear.radioCursorX', 0, 255)
    requireInteger(pokegear.radioCursorY, 'field.pokegear.radioCursorY', 0, 255)
    if (pokegear.visitedMapIds !== undefined) {
      const visitedMapIds = requireArray(pokegear.visitedMapIds, 'field.pokegear.visitedMapIds')
      if (visitedMapIds.length > 0x21a) throw new Error('La sauvegarde HGSS contient trop de cartes visitées.')
      visitedMapIds.forEach((mapId, index) => requireInteger(mapId, `field.pokegear.visitedMapIds[${index}]`, 0, 0xffff))
    }
    if (pokegear.mapMarkings !== undefined) {
      const markings = requireArray(pokegear.mapMarkings, 'field.pokegear.mapMarkings')
      if (markings.length > 100) throw new Error('La sauvegarde HGSS contient plus de 100 annotations Pokématos.')
      markings.forEach((value, index) => {
        const marking = requireRecord(value, `field.pokegear.mapMarkings[${index}]`)
        requireOnlyKeys(marking, new Set(['icons', 'mapId', 'words']), `field.pokegear.mapMarkings[${index}]`)
        requireInteger(marking.mapId, `field.pokegear.mapMarkings[${index}].mapId`, 0, 0xffff)
        const icons = requireArray(marking.icons, `field.pokegear.mapMarkings[${index}].icons`)
        const words = requireArray(marking.words, `field.pokegear.mapMarkings[${index}].words`)
        if (icons.length !== 4 || words.length !== 4) throw new Error(`Annotation Pokématos ${index} invalide.`)
        icons.forEach((icon, slot) => { if (icon !== null) requireInteger(icon, `field.pokegear.mapMarkings[${index}].icons[${slot}]`, 0, 7) })
        words.forEach((word, slot) => { if (word !== null) requireInteger(word, `field.pokegear.mapMarkings[${index}].words[${slot}]`, 0, 0xfffe) })
      })
    }
  }
  if (field.radioMusicSequenceId !== undefined) requireInteger(field.radioMusicSequenceId, 'field.radioMusicSequenceId', 0, 0xffff)
  if (field.poisonStepCounter !== undefined) requireInteger(field.poisonStepCounter, 'field.poisonStepCounter', 0, 3)
  if (field.friendshipStepCounter !== undefined) requireInteger(field.friendshipStepCounter, 'field.friendshipStepCounter', 0, 127)
  if (field.friendRosterCount !== undefined) requireInteger(field.friendRosterCount, 'field.friendRosterCount', 0, 32)
  if (field.friendGroups !== undefined) {
    const groups = requireArray(field.friendGroups, 'field.friendGroups')
    if (groups.length !== 6) throw new Error('La sauvegarde HGSS doit contenir les six groupes amis locaux.')
    groups.forEach((value, index) => {
      const group = requireRecord(value, `field.friendGroups[${index}]`)
      requireOnlyKeys(group, new Set(['groupId', 'groupName', 'groupNameSource', 'language', 'memberGender', 'memberName', 'memberNameSource', 'randomValue']), `field.friendGroups[${index}]`)
      if (group.groupName !== undefined) requireBoundedText(group.groupName, `field.friendGroups[${index}].groupName`, 7, 1)
      if (group.memberName !== undefined) requireBoundedText(group.memberName, `field.friendGroups[${index}].memberName`, 7, 1)
      for (const key of ['groupNameSource', 'memberNameSource']) {
        if (group[key] !== undefined && group[key] !== 'user-text') throw new Error(`Provenance de groupe ami invalide à field.friendGroups[${index}].${key}.`)
      }
      if (group.groupNameSource === 'user-text' && group.groupName === undefined) throw new Error(`Provenance sans nom de groupe ami à l’emplacement ${index}.`)
      if (group.memberNameSource === 'user-text' && group.memberName === undefined) throw new Error(`Provenance sans nom de membre ami à l’emplacement ${index}.`)
      if (group.memberGender !== 'male' && group.memberGender !== 'female') throw new Error(`Genre de groupe ami invalide à l’emplacement ${index}.`)
      for (const key of ['language', 'groupId', 'randomValue']) requireInteger(group[key], `field.friendGroups[${index}].${key}`)
    })
  }
  if (field.easyChatTrendySayings !== undefined) {
    requireArray(field.easyChatTrendySayings, 'field.easyChatTrendySayings').forEach((entry, index) => (
      requireInteger(entry, `field.easyChatTrendySayings[${index}]`, 0, 31)
    ))
  }
  if (field.easyChatMailMessages !== undefined) {
    requireArray(field.easyChatMailMessages, 'field.easyChatMailMessages').forEach((entry, index) => {
      const fields = requireArray(entry, `field.easyChatMailMessages[${index}]`)
      if (fields.length !== 2) throw new Error(`La sauvegarde HGSS contient un MailMessage invalide à field.easyChatMailMessages[${index}].`)
      fields.forEach((word, fieldIndex) => requireInteger(word, `field.easyChatMailMessages[${index}][${fieldIndex}]`, 0, 0xffff))
    })
  }
  if (field.battleGreetingWords !== undefined) {
    const words = requireArray(field.battleGreetingWords, 'field.battleGreetingWords')
    if (words.length !== 4) throw new Error('La sauvegarde HGSS contient une salutation de combat invalide.')
    words.forEach((word, index) => requireInteger(word, `field.battleGreetingWords[${index}]`, 0, 0xffff))
  }
  if (field.fashionPortraits !== undefined) {
    requireArray(field.fashionPortraits, 'field.fashionPortraits').forEach((entry, index) => (
      requireInteger(entry, `field.fashionPortraits[${index}]`, 0, 10)
    ))
  }
  if (field.fashionPortraitEasyChatWords !== undefined) validateIntegerPairs(field.fashionPortraitEasyChatWords, 'field.fashionPortraitEasyChatWords')
  if (field.fashionAccessories !== undefined) {
    const accessories = requireArray(field.fashionAccessories, 'field.fashionAccessories')
    accessories.forEach((entry, index) => {
      const pair = requireArray(entry, `field.fashionAccessories[${index}]`)
      if (pair.length !== 2) throw new Error(`Entrée Boîte Mode invalide à field.fashionAccessories[${index}].`)
      const accessoryId = requireInteger(pair[0], `field.fashionAccessories[${index}][0]`, 0, 99)
      requireInteger(pair[1], `field.fashionAccessories[${index}][1]`, 0, accessoryId < 61 ? 9 : 1)
    })
  }
  if (field.fashionBackgrounds !== undefined) {
    requireArray(field.fashionBackgrounds, 'field.fashionBackgrounds').forEach((entry, index) => (
      requireInteger(entry, `field.fashionBackgrounds[${index}]`, 0, 17)
    ))
  }
  if (field.trainerHouseEntries !== undefined) {
    const entries = requireArray(field.trainerHouseEntries, 'field.trainerHouseEntries')
    if (entries.length !== 10) throw new Error('La sauvegarde HGSS doit contenir les 10 emplacements de la Maison des Dresseurs.')
    entries.forEach((value, index) => {
      if (value === null) return
      const entry = requireRecord(value, `field.trainerHouseEntries[${index}]`)
      requireOnlyKeys(entry, new Set(['gameVersion', 'gender', 'introMessage', 'language', 'loseMessage', 'name', 'nameSource', 'party', 'spriteId', 'trainerId', 'winMessage']), `field.trainerHouseEntries[${index}]`)
      for (const key of ['trainerId', 'spriteId', 'language', 'gameVersion']) requireInteger(entry[key], `field.trainerHouseEntries[${index}].${key}`)
      if (entry.gender !== 'male' && entry.gender !== 'female') throw new Error(`Genre Maison des Dresseurs invalide à l’emplacement ${index}.`)
      requireBoundedText(entry.name, `field.trainerHouseEntries[${index}].name`, 7, 1)
      if (entry.nameSource !== undefined && entry.nameSource !== 'user-text') throw new Error(`Provenance Maison des Dresseurs invalide à l’emplacement ${index}.`)
      for (const key of ['introMessage', 'winMessage', 'loseMessage']) {
        const message = requireRecord(entry[key], `field.trainerHouseEntries[${index}].${key}`)
        requireOnlyKeys(message, new Set(['bank', 'fields', 'messageId']), `field.trainerHouseEntries[${index}].${key}`)
        requireInteger(message.bank, `field.trainerHouseEntries[${index}].${key}.bank`, 0, 4)
        requireInteger(message.messageId, `field.trainerHouseEntries[${index}].${key}.messageId`, 0, 0xffff)
        const fields = requireArray(message.fields, `field.trainerHouseEntries[${index}].${key}.fields`)
        if (fields.length !== 2) throw new Error(`MailMessage Maison des Dresseurs invalide à l’emplacement ${index}.`)
        fields.forEach((word, fieldIndex) => requireInteger(word, `field.trainerHouseEntries[${index}].${key}.fields[${fieldIndex}]`, 0, 0xffff))
      }
      const party = requireArray(entry.party, `field.trainerHouseEntries[${index}].party`)
      if (party.length > 6) throw new Error(`Équipe Maison des Dresseurs trop grande à l’emplacement ${index}.`)
      party.forEach((pokemon, partyIndex) => validateSavedPokemon(pokemon, `field.trainerHouseEntries[${index}].party[${partyIndex}]`))
    })
  }
  if (field.daycare !== undefined) {
    const daycare = requireRecord(field.daycare, 'field.daycare')
    requireOnlyKeys(daycare, new Set(['eggCycleCounter', 'eggPersonality', 'mons']), 'field.daycare')
    const mons = requireArray(daycare.mons, 'field.daycare.mons')
    if (mons.length !== 2) throw new Error('La sauvegarde HGSS doit contenir les deux emplacements de la Pension.')
    mons.forEach((value, index) => {
      if (value === null) return
      const entry = requireRecord(value, `field.daycare.mons[${index}]`)
      requireOnlyKeys(entry, new Set(['pokemon', 'steps']), `field.daycare.mons[${index}]`)
      validateSavedPokemon(entry.pokemon, `field.daycare.mons[${index}].pokemon`)
      requireInteger(entry.steps, `field.daycare.mons[${index}].steps`)
    })
    requireInteger(daycare.eggPersonality, 'field.daycare.eggPersonality')
    requireInteger(daycare.eggCycleCounter, 'field.daycare.eggCycleCounter', 0, 0xff)
  }
  if (field.roamers !== undefined) {
    const roamers = requireRecord(field.roamers, 'field.roamers')
    requireOnlyKeys(roamers, new Set(['flutePlayed', 'massOutbreaksEnabled', 'playerLocationHistory', 'repelSteps', 'roamers']), 'field.roamers')
    const history = requireArray(roamers.playerLocationHistory, 'field.roamers.playerLocationHistory')
    if (history.length !== 2) throw new Error('L’historique des routes des Pokémon fuyards doit contenir deux entrées.')
    history.forEach((mapId, index) => requireInteger(mapId, `field.roamers.playerLocationHistory[${index}]`))
    const entries = requireArray(roamers.roamers, 'field.roamers.roamers')
    if (entries.length !== 4) throw new Error('La sauvegarde HGSS doit contenir quatre emplacements de Pokémon fuyards.')
    entries.forEach((value, index) => {
      if (value === null) return
      const roamer = requireRecord(value, `field.roamers.roamers[${index}]`)
      requireOnlyKeys(roamer, new Set(['active', 'currentHp', 'individualValues', 'instanceId', 'level', 'locationIndex', 'metLocation', 'personality', 'speciesId', 'status']), `field.roamers.roamers[${index}]`)
      if (roamer.instanceId !== undefined) parsePokemonInstanceId(roamer.instanceId)
      for (const key of ['metLocation', 'locationIndex', 'personality', 'speciesId', 'currentHp', 'level', 'status']) {
        requireInteger(roamer[key], `field.roamers.roamers[${index}].${key}`)
      }
      validateStats(roamer.individualValues, `field.roamers.roamers[${index}].individualValues`)
      requireBoolean(roamer.active, `field.roamers.roamers[${index}].active`)
    })
    requireBoolean(roamers.massOutbreaksEnabled, 'field.roamers.massOutbreaksEnabled')
    requireInteger(roamers.repelSteps, 'field.roamers.repelSteps', 0, 0xff)
    requireInteger(roamers.flutePlayed, 'field.roamers.flutePlayed', 0, 2)
  }
  if (field.favoritePokemon !== undefined) {
    const favorite = requireRecord(field.favoritePokemon, 'field.favoritePokemon')
    requireOnlyKeys(favorite, new Set(['form', 'isEgg', 'speciesId']), 'field.favoritePokemon')
    requireInteger(favorite.speciesId, 'field.favoritePokemon.speciesId', 0, 0xffff)
    requireInteger(favorite.form, 'field.favoritePokemon.form', 0, 0x7f)
    requireBoolean(favorite.isEgg, 'field.favoritePokemon.isEgg')
  }
  if (field.unionAvatarSpriteId !== undefined) requireInteger(field.unionAvatarSpriteId, 'field.unionAvatarSpriteId', 0, 0xffff)
  if (field.phoneRematchSeeking !== undefined) validateIntegerList(field.phoneRematchSeeking, 'field.phoneRematchSeeking')
  if (field.phoneGiftItems !== undefined) validateIntegerPairs(field.phoneGiftItems, 'field.phoneGiftItems')
  if (field.phoneCallTriggers !== undefined) validateIntegerList(field.phoneCallTriggers, 'field.phoneCallTriggers')
  if (field.kenjiActive !== undefined) requireBoolean(field.kenjiActive, 'field.kenjiActive')
  if (field.kenjiWaitDays !== undefined) requireInteger(field.kenjiWaitDays, 'field.kenjiWaitDays', 0, 0xff)
  if (field.kenjiDay !== undefined) requireFieldDay(field.kenjiDay, 'field.kenjiDay')
  if (field.momGiftItems !== undefined) validateIntegerList(field.momGiftItems, 'field.momGiftItems')
  if (field.pokedex !== undefined) validateSavedPokedex(field.pokedex)
  else {
    validateIntegerList(field.caughtSpeciesIds, 'field.caughtSpeciesIds')
    requireBoolean(field.pokedexEnabled, 'field.pokedexEnabled')
  }
  for (const key of ['money', 'bankBalance', 'blackoutSpawn']) requireInteger(field[key], `field.${key}`)
  if (field.coins !== undefined) requireInteger(field.coins, 'field.coins', 0, 50_000)
  if (field.athletePoints !== undefined) requireInteger(field.athletePoints, 'field.athletePoints', 0, 99_999)
  if (field.battlePoints !== undefined) requireInteger(field.battlePoints, 'field.battlePoints', 0, 9_999)
  if (field.battlePointsReceived !== undefined) requireInteger(field.battlePointsReceived, 'field.battlePointsReceived', 0, 65_535)
  if (field.battlePointsSpent !== undefined) requireInteger(field.battlePointsSpent, 'field.battlePointsSpent', 0, 65_535)
  if (field.pokeathlonRecords !== undefined) {
    const records = requireArray(field.pokeathlonRecords, 'field.pokeathlonRecords')
    if (records.length !== 30) throw new Error('La sauvegarde HGSS doit contenir les 30 valeurs du bloc Pokéathlon à field.pokeathlonRecords.')
    records.forEach((record, index) => requireInteger(record, `field.pokeathlonRecords[${index}]`, 0, 0xffffffff))
  }
  if (field.pokeathlonDataCards !== undefined) {
    const dataCards = requireArray(field.pokeathlonDataCards, 'field.pokeathlonDataCards')
    validateIntegerList(dataCards, 'field.pokeathlonDataCards')
    if (dataCards.some((index) => typeof index === 'number' && (index < 0 || index >= 27))) {
      throw new Error('Les indices de Cartes Données Pokéathlon doivent rester entre 0 et 26.')
    }
  }
  if (field.gameScore !== undefined) requireInteger(field.gameScore, 'field.gameScore', 0, 99_999_999)
  if (field.gameStats !== undefined) validateIntegerPairs(field.gameStats, 'field.gameStats')
  if (field.p2pTradeJournals !== undefined) parseHgssP2pTradeJournals(field.p2pTradeJournals)
  if (field.p2pTradeReceipts !== undefined) parseHgssP2pTradeReceipts(field.p2pTradeReceipts)
  validateSavedP2pTradeRecovery(field as SavedFieldScriptState)
  if (field.frontierRecords !== undefined) validateIntegerPairs(field.frontierRecords, 'field.frontierRecords')
  if (field.judgeStatPosition !== undefined) requireInteger(field.judgeStatPosition, 'field.judgeStatPosition', 0, 5)
  if (field.frontierChallengeState !== undefined) requireInteger(field.frontierChallengeState, 'field.frontierChallengeState', 0, 0xffff)
  if (field.battleHallUsedSpecies !== undefined) validateIntegerList(field.battleHallUsedSpecies, 'field.battleHallUsedSpecies')
  if (field.frontierSession !== undefined) {
    const session = requireRecord(field.frontierSession, 'field.frontierSession')
    requireOnlyKeys(session, new Set(['multiBattleAllyId', 'partySlots', 'requiredCount', 'resumed', 'statTrainerMons', 'towerMode']), 'field.frontierSession')
    const towerMode = requireInteger(session.towerMode, 'field.frontierSession.towerMode', 0, 6)
    const expectedRequiredCount = [3, 4, 2, 2, 3, 3, 2][towerMode]!
    if (session.requiredCount !== expectedRequiredCount) throw new Error('La session Frontier contient un effectif incohérent.')
    requireBoolean(session.resumed, 'field.frontierSession.resumed')
    requireInteger(session.multiBattleAllyId, 'field.frontierSession.multiBattleAllyId', 0, 0xffff)
    const partySlots = requireArray(session.partySlots, 'field.frontierSession.partySlots')
    if (partySlots.length > 6 || new Set(partySlots).size !== partySlots.length) throw new Error('La sélection Frontier est invalide.')
    partySlots.forEach((slot, index) => requireInteger(slot, `field.frontierSession.partySlots[${index}]`, 0, 5))
    const teams = requireArray(session.statTrainerMons, 'field.frontierSession.statTrainerMons')
    if (teams.length > 5) throw new Error('La session Frontier contient trop d’équipes alliées.')
    teams.forEach((teamValue, teamIndex) => {
      const team = requireArray(teamValue, `field.frontierSession.statTrainerMons[${teamIndex}]`)
      if (team.length > 4) throw new Error(`L’équipe Frontier ${teamIndex} est trop grande.`)
      team.forEach((pokemonValue, pokemonIndex) => {
        const pokemon = requireRecord(pokemonValue, `field.frontierSession.statTrainerMons[${teamIndex}][${pokemonIndex}]`)
        requireOnlyKeys(pokemon, new Set(['firstMoveId', 'speciesId']), `field.frontierSession.statTrainerMons[${teamIndex}][${pokemonIndex}]`)
        requireInteger(pokemon.speciesId, `field.frontierSession.statTrainerMons[${teamIndex}][${pokemonIndex}].speciesId`, 0, 493)
        requireInteger(pokemon.firstMoveId, `field.frontierSession.statTrainerMons[${teamIndex}][${pokemonIndex}].firstMoveId`, 0, 0xffff)
      })
    })
  }
  if (field.safariZone !== undefined) validateSavedHgssSafariState(field.safariZone)
  if (field.safariProgression !== undefined) validateSavedHgssSafariProgression(field.safariProgression)
  if (field.photoAlbum !== undefined) restoreHgssPhotoAlbum(field.photoAlbum)
  if (field.bugContest !== undefined) {
    const contest = requireRecord(field.bugContest, 'field.bugContest')
    requireOnlyKeys(contest, new Set(['caughtPokemon', 'elapsedMinutes', 'placement', 'prizeItemId', 'registeredContestants', 'weekday']), 'field.bugContest')
    requireInteger(contest.weekday, 'field.bugContest.weekday', 0, 6)
    validateIntegerList(contest.registeredContestants, 'field.bugContest.registeredContestants')
    if (contest.elapsedMinutes !== undefined) requireInteger(contest.elapsedMinutes, 'field.bugContest.elapsedMinutes', 0, 20)
    if (contest.caughtPokemon !== undefined) validateSavedPokemon(contest.caughtPokemon, 'field.bugContest.caughtPokemon')
    if (contest.placement !== undefined) requireInteger(contest.placement, 'field.bugContest.placement', 0, 3)
    if (contest.prizeItemId !== undefined) requireInteger(contest.prizeItemId, 'field.bugContest.prizeItemId', 0, 0xffff)
  }
  if (field.palPark !== undefined) {
    const palPark = requireRecord(field.palPark, 'field.palPark')
    requireOnlyKeys(palPark, new Set(['catchingPoints', 'catchingShowActive', 'migratedPokemon', 'timePoints', 'typePoints']), 'field.palPark')
    requireBoolean(palPark.catchingShowActive, 'field.palPark.catchingShowActive')
    const migratedPokemon = requireArray(palPark.migratedPokemon, 'field.palPark.migratedPokemon')
    if (migratedPokemon.length > 6) throw new Error('Le Parc des Amis ne peut contenir que six Pokémon migrés.')
    migratedPokemon.forEach((pokemon, index) => validateSavedPokemon(pokemon, `field.palPark.migratedPokemon[${index}]`))
    for (const key of ['catchingPoints', 'timePoints', 'typePoints'] as const) {
      if (palPark[key] !== undefined) requireInteger(palPark[key], `field.palPark.${key}`, 0, 0xffff)
    }
  }
  if (field.kurtApricornType !== undefined) requireInteger(field.kurtApricornType, 'field.kurtApricornType', 0, 6)
  if (field.kurtApricornQuantity !== undefined) requireInteger(field.kurtApricornQuantity, 'field.kurtApricornQuantity', 0, 99)
  if (field.kurtBallId !== undefined) requireInteger(field.kurtBallId, 'field.kurtBallId', 0, 0xffff)
  if (field.frontierMilestoneRewards !== undefined) {
    const milestones = requireArray(field.frontierMilestoneRewards, 'field.frontierMilestoneRewards')
    validateIntegerList(milestones, 'field.frontierMilestoneRewards')
    if (milestones.some((milestone) => milestone !== 20 && milestone !== 50 && milestone !== 100)) {
      throw new Error('Les paliers Frontier sauvegardés doivent être 20, 50 ou 100.')
    }
  }
  const party = requireArray(field.party, 'field.party')
  if (party.length > 6) throw new Error("L'équipe HGSS ne peut contenir que six Pokémon.")
  party.forEach((pokemon, index) => validateSavedPokemon(pokemon, `field.party[${index}]`))
  if (field.partyPokeathlonModifiers !== undefined) {
    const modifiers = requireArray(field.partyPokeathlonModifiers, 'field.partyPokeathlonModifiers')
    if (modifiers.length !== party.length) throw new Error('Les modificateurs Aprijuice HGSS ne correspondent pas aux slots de l’équipe sauvegardée.')
    modifiers.forEach((entry, slot) => {
      const values = requireArray(entry, `field.partyPokeathlonModifiers[${slot}]`)
      if (values.length !== 5) throw new Error(`Le slot Aprijuice HGSS ${slot} ne contient pas cinq valeurs.`)
      values.forEach((value, index) => requireInteger(value, `field.partyPokeathlonModifiers[${slot}][${index}]`, -128, 127))
    })
  }
  if (field.pokemonStorage !== undefined) {
    const storage = requireRecord(field.pokemonStorage, 'field.pokemonStorage')
    requireOnlyKeys(storage, new Set(['boxes', 'currentBox']), 'field.pokemonStorage')
    requireInteger(storage.currentBox, 'field.pokemonStorage.currentBox', 0, hgssStorageBoxCount - 1)
    const boxes = requireArray(storage.boxes, 'field.pokemonStorage.boxes')
    if (boxes.length !== hgssStorageBoxCount) {
      throw new Error(`La sauvegarde HGSS doit contenir ${hgssStorageBoxCount} Boites a field.pokemonStorage.boxes.`)
    }
    boxes.forEach((boxValue, boxIndex) => {
      const box = requireArray(boxValue, `field.pokemonStorage.boxes[${boxIndex}]`)
      if (box.length !== hgssStorageBoxCapacity) {
        throw new Error(`La sauvegarde HGSS doit contenir ${hgssStorageBoxCapacity} places a field.pokemonStorage.boxes[${boxIndex}].`)
      }
      box.forEach((pokemon, slot) => {
        if (pokemon !== null) validateSavedPokemon(pokemon, `field.pokemonStorage.boxes[${boxIndex}][${slot}]`)
      })
    })
  }
  requireInteger(field.timeOfDay, 'field.timeOfDay', 0, 4)
  if (field.weather !== undefined) requireInteger(field.weather, 'field.weather', 0, 13)
  if (field.starterChoice !== undefined) requireInteger(field.starterChoice, 'field.starterChoice')
  if (field.starterStorySpeciesId !== undefined) requireInteger(field.starterStorySpeciesId, 'field.starterStorySpeciesId', 1, 493)
  if (field.togepiEggIdentity !== undefined) {
    const identity = requireRecord(field.togepiEggIdentity, 'field.togepiEggIdentity')
    requireOnlyKeys(identity, new Set(['gender', 'personality']), 'field.togepiEggIdentity')
    requireInteger(identity.personality, 'field.togepiEggIdentity.personality', 0, 0xffffffff)
    if (identity.gender !== 'male' && identity.gender !== 'female' && identity.gender !== 'genderless') {
      throw new Error('La sauvegarde HGSS contient un genre invalide à field.togepiEggIdentity.gender.')
    }
  }
  for (const key of ['followMonActive', 'followMonMovementPaused', 'runningShoes', 'mysteryGiftActive']) requireBoolean(field[key], `field.${key}`)
  if (field.followMonInhibited !== undefined) requireBoolean(field.followMonInhibited, 'field.followMonInhibited')
  if (field.playerState !== undefined) requireInteger(field.playerState, 'field.playerState', 0, 14)
  if (field.currentMapId !== undefined) requireInteger(field.currentMapId, 'field.currentMapId', 0, 0xffff)
  if (field.previousMapId !== undefined) requireInteger(field.previousMapId, 'field.previousMapId', 0, 0xffff)
  if (field.dynamicWarp !== undefined) {
    const warp = requireRecord(field.dynamicWarp, 'field.dynamicWarp')
    requireOnlyKeys(warp, new Set(['direction', 'mapId', 'warpId', 'x', 'z']), 'field.dynamicWarp')
    for (const key of ['mapId', 'warpId', 'x', 'z', 'direction']) requireInteger(warp[key], `field.dynamicWarp.${key}`, 0, 0xffff)
  }
  if (field.gymmick !== undefined) {
    const gymmick = requireRecord(field.gymmick, 'field.gymmick')
    requireOnlyKeys(gymmick, new Set(['data', 'type']), 'field.gymmick')
    requireInteger(gymmick.type, 'field.gymmick.type', 0, 9)
    const data = requireArray(gymmick.data, 'field.gymmick.data')
    if (data.length !== 0x20) throw new Error('La sauvegarde HGSS doit contenir 32 octets à field.gymmick.data.')
    data.forEach((byte, index) => requireInteger(byte, `field.gymmick.data[${index}]`, 0, 0xff))
  }
  if (field.followerMood !== undefined) requireInteger(field.followerMood, 'field.followerMood', -127, 127)
  if (field.pendingPhoneCall !== undefined) {
    const call = requireRecord(field.pendingPhoneCall, 'field.pendingPhoneCall')
    requireOnlyKeys(call, new Set(['callerId', 'parameter1', 'parameter2']), 'field.pendingPhoneCall')
    for (const key of ['callerId', 'parameter1', 'parameter2']) requireInteger(call[key], `field.pendingPhoneCall.${key}`)
  }
  validateActor(field.player, 'field.player')
  requireArray(field.objects, 'field.objects').forEach((entry, index) => {
    const pair = requireArray(entry, `field.objects[${index}]`)
    if (pair.length !== 2) throw new Error(`La sauvegarde HGSS contient un tuple invalide a field.objects[${index}].`)
    requireInteger(pair[0], `field.objects[${index}][0]`)
    validateActor(pair[1], `field.objects[${index}][1]`)
  })
  requireArray(field.mapProps, 'field.mapProps').forEach((value, index) => {
    const prop = requireRecord(value, `field.mapProps[${index}]`)
    requireOnlyKeys(prop, new Set(['modelId', 'x', 'y', 'z']), `field.mapProps[${index}]`)
    for (const key of ['modelId', 'x', 'y', 'z']) requireInteger(prop[key], `field.mapProps[${index}].${key}`, -0x80000000, 0xffffffff)
  })
}

function validateSavedWorld(value: unknown): asserts value is HgssSavedWorldPosition {
  const world = requireRecord(value, 'world')
  requireOnlyKeys(world, new Set(['direction', 'follower', 'locomotion', 'mapId', 'tileX', 'tileZ']), 'world')
  requireInteger(world.mapId, 'world.mapId', 0, 0xffff)
  requireInteger(world.tileX, 'world.tileX', -0x8000, 0x7fff)
  requireInteger(world.tileZ, 'world.tileZ', -0x8000, 0x7fff)
  if (!['north', 'south', 'east', 'west'].includes(String(world.direction))) {
    throw new Error('La sauvegarde HGSS contient une direction invalide a world.direction.')
  }
  if (world.locomotion !== undefined && !['walking', 'cycling', 'surfing'].includes(String(world.locomotion))) {
    throw new Error('La sauvegarde HGSS contient un état de déplacement invalide à world.locomotion.')
  }
  if (world.follower !== undefined) {
    const follower = requireRecord(world.follower, 'world.follower')
    requireOnlyKeys(follower, new Set(['direction', 'movement', 'tileX', 'tileZ']), 'world.follower')
    requireInteger(follower.tileX, 'world.follower.tileX', -0x8000, 0x7fff)
    requireInteger(follower.tileZ, 'world.follower.tileZ', -0x8000, 0x7fff)
    if (!['north', 'south', 'east', 'west'].includes(String(follower.direction))) {
      throw new Error('La sauvegarde HGSS contient une direction invalide a world.follower.direction.')
    }
    if (follower.movement !== undefined) requireInteger(follower.movement, 'world.follower.movement', 0, 0xffff)
  }
}

type SavePokemonContext = Readonly<{
  playerName: string
  playerGender: 'male' | 'female'
  playerTrainerId?: number
  npcTradeCatalog?: readonly HgssNpcTrade[]
}>

function inferPokemonLocalTradeId(pokemon: CanonicalPokemon, context: SavePokemonContext): number | undefined {
  if (Number.isInteger(pokemon.originalTrainer.localTradeId)) return pokemon.originalTrainer.localTradeId
  return context.npcTradeCatalog?.find((trade) => (
    trade.givenSpeciesId === pokemon.speciesId
    && trade.originalTrainerId === pokemon.originalTrainer.id
    && trade.originalTrainerGender === pokemon.originalTrainer.gender
    && (trade.nickname === pokemon.nickname || trade.originalTrainerName === pokemon.originalTrainer.name)
  ))?.tradeId
}

function inferSavedPokemonLocalTradeId(saved: SavedPokemon, catalog: readonly HgssNpcTrade[] | undefined): number | undefined {
  if (saved.originalTrainer.nameSource === 'user-text') return undefined
  return catalog?.find((trade) => (
    trade.givenSpeciesId === saved.speciesId
    && trade.originalTrainerId === saved.originalTrainer.id
    && trade.originalTrainerGender === saved.originalTrainer.gender
    && (saved.originalTrainer.name === trade.originalTrainerName
      || saved.originalTrainer.name === undefined && saved.nickname === trade.nickname)
  ))?.tradeId
}

function savePokemon(pokemon: CanonicalPokemon, context: SavePokemonContext): SavedPokemon {
  const localTradeId = pokemon.originalTrainer.nameSource === 'local-ref'
    || pokemon.nicknameSource === 'local-ref'
    ? inferPokemonLocalTradeId(pokemon, context)
    : undefined
  const trainerNameIsUserText = pokemon.originalTrainer.nameSource === 'user-text'
    || (pokemon.originalTrainer.nameSource === undefined
      && pokemon.originalTrainer.name === context.playerName
      && pokemon.originalTrainer.gender === context.playerGender
      && (context.playerTrainerId === undefined || pokemon.originalTrainer.id === context.playerTrainerId))
  const originalTrainerIsPlayer = pokemon.originalTrainer.isPlayer ?? (
    pokemon.originalTrainer.name === context.playerName
    && pokemon.originalTrainer.gender === context.playerGender
    && (context.playerTrainerId === undefined || pokemon.originalTrainer.id === context.playerTrainerId)
  )
  const nicknameLocalRef = pokemon.nicknameSource === 'local-ref'
    ? pokemon.nicknameLocalRef ?? (pokemon.isEgg ? 0 : localTradeId === undefined ? undefined : localTradeId + 1)
    : undefined
  return {
    instanceId: pokemon.instanceId,
    speciesId: pokemon.speciesId,
    ...(pokemon.nickname !== undefined && pokemon.nicknameSource === 'user-text'
      ? { nickname: pokemon.nickname, nicknameSource: 'user-text' as const }
      : {}),
    ...(nicknameLocalRef === undefined ? {} : { nicknameLocalRef }),
    form: pokemon.form,
    personality: pokemon.personality,
    originalTrainer: {
      id: pokemon.originalTrainer.id,
      gender: pokemon.originalTrainer.gender,
      isPlayer: originalTrainerIsPlayer,
      ...(trainerNameIsUserText ? { name: pokemon.originalTrainer.name, nameSource: 'user-text' as const } : {}),
      ...(localTradeId === undefined ? {} : { localTradeId }),
    },
    origin: {
      language: pokemon.origin.language,
      gameVersion: pokemon.origin.gameVersion,
      metLocation: pokemon.origin.metLocation,
      metLevel: pokemon.origin.metLevel,
      metTerrain: pokemon.origin.metTerrain,
      ...(pokemon.origin.metDate ? { metDate: { year: pokemon.origin.metDate.year, month: pokemon.origin.metDate.month, day: pokemon.origin.metDate.day } } : {}),
      ...(pokemon.origin.eggLocation === undefined ? {} : { eggLocation: pokemon.origin.eggLocation }),
      ...(pokemon.origin.eggDate ? { eggDate: { year: pokemon.origin.eggDate.year, month: pokemon.origin.eggDate.month, day: pokemon.origin.eggDate.day } } : {}),
    },
    level: pokemon.level,
    experience: pokemon.experience,
    individualValues: {
      hp: pokemon.individualValues.hp, attack: pokemon.individualValues.attack, defense: pokemon.individualValues.defense,
      speed: pokemon.individualValues.speed, specialAttack: pokemon.individualValues.specialAttack, specialDefense: pokemon.individualValues.specialDefense,
    },
    effortValues: {
      hp: pokemon.effortValues.hp, attack: pokemon.effortValues.attack, defense: pokemon.effortValues.defense,
      speed: pokemon.effortValues.speed, specialAttack: pokemon.effortValues.specialAttack, specialDefense: pokemon.effortValues.specialDefense,
    },
    nature: pokemon.nature,
    gender: pokemon.gender,
    abilityId: pokemon.abilityId,
    shiny: pokemon.shiny,
    friendship: pokemon.friendship,
    moves: pokemon.moves.map((move) => ({ moveId: move.moveId, pp: move.pp, maxPp: move.maxPp, ppUps: move.ppUps })),
    stats: {
      hp: pokemon.stats.hp, attack: pokemon.stats.attack, defense: pokemon.stats.defense,
      speed: pokemon.stats.speed, specialAttack: pokemon.stats.specialAttack, specialDefense: pokemon.stats.specialDefense,
    },
    currentHp: pokemon.currentHp,
    status: pokemon.status,
    pokerus: pokemon.pokerus ?? 0,
    heldItemId: pokemon.heldItemId,
    ...(pokemon.mailIdentity === 'kenya' ? { mailIdentityCode: 1 } : {}),
    ballId: pokemon.ballId,
    isEgg: pokemon.isEgg,
    fatefulEncounter: pokemon.fatefulEncounter,
    shinyLeafMask: pokemon.shinyLeafMask ?? 0,
    contestValues: [...(pokemon.contestValues ?? [0, 0, 0, 0, 0, 0])] as CanonicalPokemon['contestValues'],
    ribbonIds: [...pokemon.ribbonIds],
  }
}

function restorePokemon(runtime: FieldPokemonRuntime, saved: SavedPokemon, identityNamespace: string, path: string): CanonicalPokemon {
  const speciesName = runtime.catalog.speciesNames[saved.speciesId]
  if (!speciesName) throw new Error(`L'espece Pokemon sauvegardee ${saved.speciesId} est absente de la ROM.`)
  const moves = saved.moves.map((move): CanonicalPokemonMove => {
    const data = runtime.catalog.moves[move.moveId]
    if (!data) throw new Error(`La capacite Pokemon sauvegardee ${move.moveId} est absente de la ROM.`)
    return { moveId: move.moveId, pp: move.pp, maxPp: move.maxPp, ppUps: move.ppUps, data }
  })
  const localTradeId = saved.originalTrainer.localTradeId
    ?? inferSavedPokemonLocalTradeId(saved, runtime.npcTradeCatalog)
  const localTrade = localTradeId === undefined ? undefined : runtime.npcTradeCatalog?.[localTradeId]
  const originalTrainerIsPlayer = saved.originalTrainer.isPlayer ?? (!localTrade
    && saved.originalTrainer.id === runtime.trainer.id
    && saved.originalTrainer.gender === runtime.trainer.gender
    && (saved.originalTrainer.name === undefined || saved.originalTrainer.name === runtime.trainer.name))
  const originalTrainerName = localTrade?.originalTrainerName
    ?? saved.originalTrainer.name
    ?? (originalTrainerIsPlayer ? runtime.trainer.name : '')
  const originalTrainerSource = localTrade
    ? 'local-ref' as const
    : saved.originalTrainer.nameSource === 'user-text'
      || (saved.originalTrainer.name === undefined && originalTrainerIsPlayer)
      ? 'user-text' as const
      : saved.originalTrainer.nameSource === 'local-ref' ? 'local-ref' as const : undefined
  const inferredNicknameLocalRef = saved.nicknameSource === 'user-text'
    ? undefined
    : saved.isEgg
      ? 0
      : localTrade && (saved.nickname === undefined || saved.nickname === localTrade.nickname)
        ? localTradeId! + 1
        : undefined
  const nicknameLocalRef = saved.nicknameLocalRef ?? inferredNicknameLocalRef
  const nicknameTradeId = nicknameLocalRef === undefined || nicknameLocalRef === 0
    ? undefined
    : nicknameLocalRef - 1
  const localNickname = nicknameLocalRef === 0
    ? 'ŒUF'
    : nicknameTradeId === undefined ? undefined : runtime.npcTradeCatalog?.[nicknameTradeId]?.nickname
  const nickname = localNickname ?? saved.nickname
  const nicknameSource = localNickname !== undefined
    ? 'local-ref' as const
    : saved.nicknameSource ?? (saved.nickname === undefined ? undefined : 'user-text' as const)
  return {
    instanceId: saved.instanceId ? parsePokemonInstanceId(saved.instanceId) : deriveLegacyPokemonInstanceId(identityNamespace, path),
    speciesId: saved.speciesId,
    speciesName,
    ...(nickname === undefined ? {} : { nickname }),
    ...(nicknameSource === undefined ? {} : { nicknameSource }),
    ...(nicknameLocalRef === undefined ? {} : { nicknameLocalRef }),
    form: saved.form,
    personality: saved.personality,
    shinyLeafMask: saved.shinyLeafMask ?? 0,
    originalTrainer: {
      id: saved.originalTrainer.id,
      name: originalTrainerName,
      gender: saved.originalTrainer.gender,
      isPlayer: originalTrainerIsPlayer,
      ...(originalTrainerSource === undefined ? {} : { nameSource: originalTrainerSource }),
      ...(localTradeId === undefined ? {} : { localTradeId }),
    },
    origin: {
      language: saved.origin.language,
      gameVersion: saved.origin.gameVersion,
      metLocation: saved.origin.metLocation,
      metLevel: saved.origin.metLevel,
      metTerrain: saved.origin.metTerrain,
      ...(saved.origin.metDate ? { metDate: { year: saved.origin.metDate.year, month: saved.origin.metDate.month, day: saved.origin.metDate.day } } : {}),
      ...(saved.origin.eggLocation === undefined ? {} : { eggLocation: saved.origin.eggLocation }),
      ...(saved.origin.eggDate ? { eggDate: { year: saved.origin.eggDate.year, month: saved.origin.eggDate.month, day: saved.origin.eggDate.day } } : {}),
    },
    level: saved.level,
    experience: saved.experience,
    individualValues: {
      hp: saved.individualValues.hp, attack: saved.individualValues.attack, defense: saved.individualValues.defense,
      speed: saved.individualValues.speed, specialAttack: saved.individualValues.specialAttack, specialDefense: saved.individualValues.specialDefense,
    },
    effortValues: {
      hp: saved.effortValues.hp, attack: saved.effortValues.attack, defense: saved.effortValues.defense,
      speed: saved.effortValues.speed, specialAttack: saved.effortValues.specialAttack, specialDefense: saved.effortValues.specialDefense,
    },
    nature: saved.nature,
    gender: saved.gender,
    abilityId: saved.abilityId,
    shiny: saved.shiny,
    friendship: saved.friendship,
    moves,
    stats: {
      hp: saved.stats.hp, attack: saved.stats.attack, defense: saved.stats.defense,
      speed: saved.stats.speed, specialAttack: saved.stats.specialAttack, specialDefense: saved.stats.specialDefense,
    },
    currentHp: saved.currentHp,
    status: saved.status,
    pokerus: saved.pokerus ?? 0,
    heldItemId: saved.heldItemId,
    ...((saved.mailIdentityCode === 1 || saved.mailIdentity === 'kenya') ? { mailIdentity: 'kenya' as const } : {}),
    ballId: saved.ballId,
    isEgg: saved.isEgg,
    fatefulEncounter: saved.fatefulEncounter,
    contestValues: [...(saved.contestValues ?? [0, 0, 0, 0, 0, 0])] as CanonicalPokemon['contestValues'],
    ribbonIds: [...saved.ribbonIds],
  }
}

function saveFieldState(state: FieldScriptState): SavedFieldScriptState {
  const pokemonContext: SavePokemonContext = {
    playerName: state.playerName,
    playerGender: state.gender,
    playerTrainerId: state.pokemonRuntime?.trainer.id,
    npcTradeCatalog: state.pokemonRuntime?.npcTradeCatalog,
  }
  const snapshotPokemon = (pokemon: CanonicalPokemon): SavedPokemon => savePokemon(pokemon, pokemonContext)
  return {
    mailboxMessageCount: state.mailboxMessageCount,
    mailboxMailIdentityCodes: state.mailboxMailIdentities.map((identity) => identity === 'kenya' ? 1 : null),
    gender: state.gender,
    playerName: state.playerNameSource === 'user-text' ? state.playerName : state.pokemonRuntime?.trainer.name ?? '',
    playerNameSource: 'user-text',
    ...(state.friendName && state.friendNameSource === 'user-text'
      ? { friendName: state.friendName, friendNameSource: 'user-text' as const }
      : {}),
    ...(state.rivalName && state.rivalNameSource === 'user-text'
      ? { rivalName: state.rivalName, rivalNameSource: 'user-text' as const }
      : {}),
    // Les registres 0x8000–0x800F vivent dans ScriptEnvironment, pas dans le
    // bloc VarsFlags de la sauvegarde HGSS. Les sérialiser réinjectait les
    // choix et identifiants d'acteurs d'une ancienne scène dans la suivante.
    variables: [...state.variables].filter(([variableId]) => !isHgssFieldScriptTemporaryVariable(variableId) && !isHgssFieldMapTemporaryVariable(variableId)),
    flags: [...state.flags],
    trainerFlags: [...state.trainerFlags],
    // Les suppressions de MapObject sont locales a la carte dans HGSS. Les
    // disparitions persistantes sont deja representees par les event flags.
    hiddenObjectIds: [],
    // Les buffers appartiennent au contexte d'affichage du script courant.
    // Ils peuvent contenir des noms ou des phrases resolus depuis la ROM et ne
    // constituent jamais une progression a reprendre apres un chargement.
    buffers: [],
    inventory: [...state.inventory],
    apricornBox: [...state.apricornBox],
    harvestedApricornTrees: [...state.harvestedApricornTrees],
    apricornTreeDay: state.apricornTreeDay,
    badges: [...state.badges],
    phoneContacts: [...state.phoneContacts],
    phoneRematchSeeking: [...state.phoneRematchSeeking],
    phoneGiftItems: [...state.phoneGiftItems],
    phoneCallTriggers: [...state.phoneCallTriggers],
    kenjiActive: state.kenjiActive,
    kenjiWaitDays: state.kenjiWaitDays,
    kenjiDay: state.kenjiDay,
    momGiftItems: [...state.momGiftItems],
    pokegearCards: [...state.pokegearCards],
    pokegearMapUnlockLevel: state.pokegearMapUnlockLevel,
    pokegear: clonePokegearNativeState(state.pokegear),
    radioMusicSequenceId: state.radioMusicSequenceId,
    poisonStepCounter: state.poisonStepCounter,
    friendshipStepCounter: state.friendshipStepCounter,
    friendRosterCount: state.friendRosterCount,
    friendGroups: state.friendGroups.map((group) => ({
      ...(group.groupName !== undefined && group.groupNameSource === 'user-text'
        ? { groupName: group.groupName, groupNameSource: 'user-text' as const } : {}),
      ...(group.memberName !== undefined && group.memberNameSource === 'user-text'
        ? { memberName: group.memberName, memberNameSource: 'user-text' as const } : {}),
      memberGender: group.memberGender,
      language: group.language,
      groupId: group.groupId,
      randomValue: group.randomValue,
    })),
    easyChatTrendySayings: [...state.easyChatTrendySayings],
    easyChatMailMessages: state.easyChatMailMessages.map((message) => [...message]),
    battleGreetingWords: [...state.battleGreetingWords],
    fashionPortraits: [...state.fashionPortraits],
    fashionPortraitEasyChatWords: [...state.fashionPortraitEasyChatWords],
    fashionAccessories: [...state.fashionAccessories],
    fashionBackgrounds: [...state.fashionBackgrounds],
    trainerHouseEntries: state.trainerHouseEntries.map((entry) => entry?.nameSource === 'user-text' ? {
      trainerId: entry.trainerId,
      spriteId: entry.spriteId,
      language: entry.language,
      gameVersion: entry.gameVersion,
      gender: entry.gender,
      name: entry.name,
      nameSource: 'user-text',
      introMessage: { bank: entry.introMessage.bank, messageId: entry.introMessage.messageId, fields: [...entry.introMessage.fields] as [number, number] },
      winMessage: { bank: entry.winMessage.bank, messageId: entry.winMessage.messageId, fields: [...entry.winMessage.fields] as [number, number] },
      loseMessage: { bank: entry.loseMessage.bank, messageId: entry.loseMessage.messageId, fields: [...entry.loseMessage.fields] as [number, number] },
      party: entry.party.map((pokemon) => savePokemon(pokemon, {
        playerName: entry.name, playerGender: entry.gender, playerTrainerId: entry.trainerId,
        npcTradeCatalog: pokemonContext.npcTradeCatalog,
      })),
    } : null),
    daycare: {
      mons: state.daycare.mons.map((entry) => entry ? { pokemon: snapshotPokemon(entry.pokemon), steps: entry.steps } : null),
      eggPersonality: state.daycare.eggPersonality,
      eggCycleCounter: state.daycare.eggCycleCounter,
    },
    roamers: {
      playerLocationHistory: [...state.roamers.playerLocationHistory],
      roamers: state.roamers.roamers.map((roamer) => roamer ? {
        instanceId: roamer.instanceId,
        metLocation: roamer.metLocation,
        locationIndex: roamer.locationIndex,
        individualValues: {
          hp: roamer.individualValues.hp, attack: roamer.individualValues.attack, defense: roamer.individualValues.defense,
          speed: roamer.individualValues.speed, specialAttack: roamer.individualValues.specialAttack, specialDefense: roamer.individualValues.specialDefense,
        },
        personality: roamer.personality,
        speciesId: roamer.speciesId,
        currentHp: roamer.currentHp,
        level: roamer.level,
        status: roamer.status,
        active: roamer.active,
      } : null),
      massOutbreaksEnabled: state.roamers.massOutbreaksEnabled,
      repelSteps: state.roamers.repelSteps,
      flutePlayed: state.roamers.flutePlayed,
    },
    favoritePokemon: { speciesId: state.favoritePokemon.speciesId, form: state.favoritePokemon.form, isEgg: state.favoritePokemon.isEgg },
    unionAvatarSpriteId: state.unionAvatarSpriteId,
    money: state.money,
    coins: state.coins,
    athletePoints: state.athletePoints,
    battlePoints: state.battlePoints,
    battlePointsReceived: state.battlePointsReceived,
    battlePointsSpent: state.battlePointsSpent,
    pokeathlonRecords: [...state.pokeathlonRecords],
    pokeathlonDataCards: [...state.pokeathlonDataCards],
    bankBalance: state.bankBalance,
    gameScore: state.gameScore,
    gameStats: [...state.gameStats],
    ...(state.p2pTradeReceipts.length > 0
      ? { p2pTradeReceipts: state.p2pTradeReceipts.map((receipt) => ({ ...receipt })) }
      : {}),
    ...(state.p2pTradeJournals.length > 0
      ? { p2pTradeJournals: parseHgssP2pTradeJournals(state.p2pTradeJournals).map((journal) => journal) }
      : {}),
    frontierRecords: [...state.frontierRecords],
    frontierMilestoneRewards: [...state.frontierMilestoneRewards],
    judgeStatPosition: state.judgeStatPosition,
    frontierChallengeState: state.frontierChallengeState,
    battleHallUsedSpecies: [...state.battleHallUsedSpecies],
    frontierSession: state.frontierSession && {
      towerMode: state.frontierSession.towerMode,
      requiredCount: state.frontierSession.requiredCount,
      partySlots: [...state.frontierSession.partySlots],
      resumed: state.frontierSession.resumed,
      multiBattleAllyId: state.frontierSession.multiBattleAllyId,
      statTrainerMons: state.frontierSession.statTrainerMons.map((team) => team.map((pokemon) => ({
        speciesId: pokemon.speciesId, firstMoveId: pokemon.firstMoveId,
      }))),
    },
    blackoutSpawn: state.blackoutSpawn,
    party: state.party.members.map(snapshotPokemon),
    partyPokeathlonModifiers: state.party.members.map((_, slot) => getPokemonPartyPokeathlonModifiers(state.party, slot)),
    pokemonStorage: {
      currentBox: state.pokemonStorage.currentBox,
      boxes: state.pokemonStorage.boxes.map((box) => box.map((pokemon) => pokemon ? snapshotPokemon(pokemon) : null)),
    },
    pokedex: snapshotHgssPokedex(state.pokedex),
    timeOfDay: state.timeOfDay,
    weather: state.weather,
    starterChoice: state.starterChoice,
    starterStorySpeciesId: state.starterStorySpeciesId,
    followMonActive: state.followMonActive,
    // Une sauvegarde automatique n'est jamais une continuation de script :
    // les verrous d'exécution sont relâchés lors de la restauration.
    followMonMovementPaused: false,
    followMonInhibited: state.followMonInhibited,
    followerMood: state.followerMood,
    runningShoes: state.runningShoes,
    mysteryGiftActive: state.mysteryGiftActive,
    safariZone: snapshotHgssSafariState(state.safariZone),
    safariProgression: snapshotHgssSafariProgression(state.safariProgression),
    photoAlbum: snapshotHgssDataOnlyPhotoAlbum(state.photoAlbum, state.pokemonRuntime?.photoDataCatalog, state.playerName),
    palPark: {
      catchingShowActive: state.palPark.catchingShowActive,
      migratedPokemon: state.palPark.migratedPokemon.map(snapshotPokemon),
      catchingPoints: state.palPark.catchingPoints,
      timePoints: state.palPark.timePoints,
      typePoints: state.palPark.typePoints,
    },
    bugContest: state.bugContest && {
      weekday: state.bugContest.weekday,
      registeredContestants: [...state.bugContest.registeredContestants],
      elapsedMinutes: state.bugContest.elapsedMinutes,
      caughtPokemon: state.bugContest.caughtPokemon && snapshotPokemon(state.bugContest.caughtPokemon),
      placement: state.bugContest.placement,
      prizeItemId: state.bugContest.prizeItemId,
    },
    kurtApricornType: state.kurtApricornType,
    kurtApricornQuantity: state.kurtApricornQuantity,
    kurtBallId: state.kurtBallId,
    togepiEggIdentity: state.togepiEggIdentity && { personality: state.togepiEggIdentity.personality, gender: state.togepiEggIdentity.gender },
    playerState: state.playerState,
    pendingPhoneCall: undefined,
    // La hauteur est reconstruite depuis le terrain local et le mouvement est
    // une référence de présentation ROM qui n'appartient pas à l'avatar.
    player: { x: state.player.x, z: state.player.z, direction: state.player.direction },
    // Positions d'objets et props appartiennent à la présentation de la carte
    // ROM courante; le monde les reconstruit depuis les IDs/flags persistants.
    objects: [],
    mapProps: [],
    currentMapId: state.currentMapId,
    previousMapId: state.previousMapId,
    dynamicWarp: state.dynamicWarp && {
      mapId: state.dynamicWarp.mapId, warpId: state.dynamicWarp.warpId,
      x: state.dynamicWarp.x, z: state.dynamicWarp.z, direction: state.dynamicWarp.direction,
    },
    gymmick: { type: state.gymmick.type, data: [...state.gymmick.data] },
  }
}

function restoreFieldState(saved: SavedFieldScriptState, pokemonRuntime: FieldPokemonRuntime, identityNamespace: string): FieldScriptState {
  const state = createFieldScriptState(saved.gender, saved.playerName, {
    friendName: saved.friendName ?? '',
    // L'ancien port ne suivait pas la provenance : ce champ n'a jamais eu de
    // writer ROM et représente exclusivement un nom de profil ami.
    friendNameSource: saved.friendNameSource ?? (saved.friendName ? 'user-text' : undefined),
    rivalName: saved.rivalName ?? 'SILVER',
    // SILVER sans provenance est le défaut local. Toute autre valeur legacy
    // provient de l'écran de saisie du rival et peut être migrée sans perte.
    rivalNameSource: saved.rivalNameSource ?? (saved.rivalName && saved.rivalName !== 'SILVER' ? 'user-text' : undefined),
    party: saved.party.map((pokemon, index) => restorePokemon(pokemonRuntime, pokemon, identityNamespace, `party/${index}`)),
    partyPokeathlonModifiers: saved.partyPokeathlonModifiers,
    pokemonStorage: saved.pokemonStorage
      ? createPokemonStorage(
          saved.pokemonStorage.boxes.map((box, boxIndex) => box.map((pokemon, slot) => (
            pokemon ? restorePokemon(pokemonRuntime, pokemon, identityNamespace, `storage/${boxIndex}/${slot}`) : undefined
          ))),
          saved.pokemonStorage.currentBox,
        )
      : createPokemonStorage(),
    pokemonRuntime,
    pokedex: saved.pokedex
      ? restoreHgssPokedex(saved.pokedex)
      : undefined,
    caughtSpeciesIds: saved.caughtSpeciesIds,
    starterChoice: saved.starterChoice,
    starterStorySpeciesId: saved.starterStorySpeciesId,
    followMonActive: saved.followMonActive,
    followMonMovementPaused: false,
    pokedexEnabled: saved.pokedexEnabled,
    runningShoes: saved.runningShoes,
    mysteryGiftActive: saved.mysteryGiftActive,
    // TIMEOFDAY est une vue de l'horloge système, pas un état de progression.
    // Les anciennes sauvegardes (0..2) restent lisibles sans figer leur heure.
    timeOfDay: resolveHgssTimeOfDay(pokemonRuntime.now()),
  })
  state.playerNameSource = saved.playerNameSource === 'user-text' || saved.playerName === pokemonRuntime.trainer.name
    ? 'user-text'
    : undefined
  state.mailboxMessageCount = saved.mailboxMessageCount
  state.weather = saved.weather ?? hgssWeather.clear
  state.mailboxMailIdentities = saved.mailboxMailIdentityCodes
    ? saved.mailboxMailIdentityCodes.map((identity) => identity === 1 ? 'kenya' : undefined)
    : (saved.mailboxMailIdentities ?? Array.from({ length: 20 }, () => null)).map((identity) => identity ?? undefined)
  // Migration des sauvegardes du port qui avaient sérialisé les registres
  // volatils du ScriptEnvironment et pouvaient reprendre un ancien choix.
  state.variables = new Map(saved.variables.filter(([variableId]) => !isHgssFieldScriptTemporaryVariable(variableId) && !isHgssFieldMapTemporaryVariable(variableId)))
  state.flags = new Set(saved.flags)
  repairLegacyProgressionFlags(saved, state.flags)
  state.trainerFlags = new Set(saved.trainerFlags ?? [])
  // Migration des anciennes sauvegardes qui persistaient a tort des IDs
  // locaux et pouvaient masquer un autre PNJ portant le meme ID sur une carte
  // ulterieure.
  state.hiddenObjectIds = new Set()
  state.buffers = new Map()
  state.inventory = new Map(saved.inventory)
  state.apricornBox = saved.apricornBox ? [...saved.apricornBox] : [0, 0, 0, 0, 0, 0, 0]
  state.harvestedApricornTrees = new Set(saved.harvestedApricornTrees ?? [])
  state.apricornTreeDay = saved.apricornTreeDay ?? state.apricornTreeDay
  state.badges = new Set(saved.badges)
  state.phoneContacts = restoreHgssPhoneContacts(saved.phoneContacts)
  state.phoneRematchSeeking = new Set(saved.phoneRematchSeeking ?? [])
  state.phoneGiftItems = new Map(saved.phoneGiftItems ?? [])
  state.phoneCallTriggers = new Set(saved.phoneCallTriggers ?? [])
  state.kenjiActive = saved.kenjiActive ?? false
  state.kenjiWaitDays = saved.kenjiWaitDays ?? 0
  state.kenjiDay = saved.kenjiDay ?? state.kenjiDay
  state.momGiftItems = [...(saved.momGiftItems ?? [])]
  state.pokegearCards = new Set(saved.pokegearCards)
  if ((state.variables.get(hgssCherrygroveSceneVariable) ?? 0) >= 2) state.pokegearCards.add(1)
  state.pokegearMapUnlockLevel = saved.pokegearMapUnlockLevel ?? 0
  state.pokegear = normalizePokegearNativeState(saved.pokegear)
  state.radioMusicSequenceId = saved.radioMusicSequenceId ?? 0
  state.poisonStepCounter = saved.poisonStepCounter ?? 0
  state.friendshipStepCounter = saved.friendshipStepCounter ?? 0
  state.friendRosterCount = saved.friendRosterCount ?? 0
  state.friendGroups = saved.friendGroups ? cloneHgssFriendGroupState(saved.friendGroups) : createHgssFriendGroupState()
  // Ces six slots ne contiennent que des noms de groupes/profils joueurs ;
  // contrairement à un buffer de script, l'ancien schéma suffit à établir
  // leur provenance utilisateur.
  state.friendGroups.forEach((group) => {
    if (group.groupName) group.groupNameSource = 'user-text'
    if (group.memberName) group.memberNameSource = 'user-text'
  })
  state.easyChatTrendySayings = new Set(saved.easyChatTrendySayings ?? [])
  state.easyChatMailMessages = (saved.easyChatMailMessages ?? Array.from({ length: 4 }, () => [0xffff, 0xffff] as [number, number]))
    .map((message) => [...message] as [number, number])
  state.battleGreetingWords = [...(saved.battleGreetingWords ?? [0xffff, 0xffff, 0xffff, 0xffff])] as FieldScriptState['battleGreetingWords']
  state.fashionPortraits = new Set(saved.fashionPortraits ?? [])
  state.fashionPortraitEasyChatWords = new Map(saved.fashionPortraitEasyChatWords ?? [])
  state.fashionAccessories = new Map(saved.fashionAccessories ?? [])
  state.fashionBackgrounds = new Set(saved.fashionBackgrounds ?? [])
  state.trainerHouseEntries = (saved.trainerHouseEntries ?? Array.from({ length: 10 }, () => null)).map((entry, index) => entry ? {
    ...entry,
    // Les slots 0–9 sont exclusivement des profils joueurs distants. Le PNJ
    // par défaut est le slot virtuel 10 et n'entre jamais dans ce tableau.
    nameSource: 'user-text',
    introMessage: { ...entry.introMessage, fields: [...entry.introMessage.fields] as [number, number] } as HgssMailMessage,
    winMessage: { ...entry.winMessage, fields: [...entry.winMessage.fields] as [number, number] } as HgssMailMessage,
    loseMessage: { ...entry.loseMessage, fields: [...entry.loseMessage.fields] as [number, number] } as HgssMailMessage,
    party: entry.party.map((pokemon, partyIndex) => restorePokemon(pokemonRuntime, pokemon, `${identityNamespace}:trainer-house`, `entry/${index}/${partyIndex}`)),
  } : undefined)
  state.daycare = saved.daycare
    ? {
        mons: saved.daycare.mons.map((entry, index) => entry ? { pokemon: restorePokemon(pokemonRuntime, entry.pokemon, identityNamespace, `daycare/${index}`), steps: entry.steps } : undefined),
        eggPersonality: saved.daycare.eggPersonality,
        eggCycleCounter: saved.daycare.eggCycleCounter,
      }
    : { mons: [undefined, undefined], eggPersonality: 0, eggCycleCounter: 0 }
  state.roamers = saved.roamers
    ? {
        ...saved.roamers,
        playerLocationHistory: [...saved.roamers.playerLocationHistory],
        roamers: saved.roamers.roamers.map((roamer, index) => roamer ? {
          ...roamer,
          instanceId: roamer.instanceId ? parsePokemonInstanceId(roamer.instanceId) : deriveLegacyPokemonInstanceId(identityNamespace, `roamer/${index}`),
          individualValues: { ...roamer.individualValues },
        } : undefined),
      }
    : createHgssRoamerSaveState()
  state.favoritePokemon = saved.favoritePokemon
    ? { ...saved.favoritePokemon }
    : { speciesId: 0, form: 0, isEgg: false }
  state.unionAvatarSpriteId = saved.unionAvatarSpriteId
  state.money = saved.money
  state.coins = saved.coins ?? 0
  state.athletePoints = saved.athletePoints ?? 0
  state.battlePoints = saved.battlePoints ?? 0
  state.battlePointsReceived = saved.battlePointsReceived ?? 0
  state.battlePointsSpent = saved.battlePointsSpent ?? 0
  state.pokeathlonRecords = [...(saved.pokeathlonRecords ?? Array.from({ length: 30 }, () => 0))]
  state.pokeathlonDataCards = new Set(saved.pokeathlonDataCards ?? [])
  state.bankBalance = saved.bankBalance
  state.gameScore = saved.gameScore ?? 0
  state.gameStats = new Map(saved.gameStats ?? [])
  state.p2pTradeReceipts = parseHgssP2pTradeReceipts(saved.p2pTradeReceipts ?? []).map((receipt) => ({ ...receipt }))
  state.p2pTradeJournals = parseHgssP2pTradeJournals(saved.p2pTradeJournals ?? []).map((journal) => journal)
  state.frontierRecords = new Map(saved.frontierRecords ?? [])
  state.frontierMilestoneRewards = new Set((saved.frontierMilestoneRewards ?? []) as Array<20 | 50 | 100>)
  state.judgeStatPosition = saved.judgeStatPosition ?? 0
  state.frontierChallengeState = saved.frontierChallengeState ?? 0
  state.battleHallUsedSpecies = new Set(saved.battleHallUsedSpecies ?? [])
  state.frontierSession = saved.frontierSession && {
    towerMode: saved.frontierSession.towerMode,
    requiredCount: saved.frontierSession.requiredCount,
    partySlots: [...saved.frontierSession.partySlots],
    resumed: saved.frontierSession.resumed,
    multiBattleAllyId: saved.frontierSession.multiBattleAllyId,
    statTrainerMons: saved.frontierSession.statTrainerMons.map((team) => team.map((pokemon) => ({
      speciesId: pokemon.speciesId, firstMoveId: pokemon.firstMoveId,
    }))),
  }
  state.blackoutSpawn = saved.blackoutSpawn
  state.followerMood = saved.followerMood ?? 0
  // Les anciennes versions pouvaient sauvegarder l'inhibition transitoire d'une
  // cinematique. Le moteur HGSS la relache lors d'une transition de carte.
  state.followMonInhibited = false
  state.playerState = saved.playerState ?? 0
  state.togepiEggIdentity = saved.togepiEggIdentity && { ...saved.togepiEggIdentity }
  // Le jeu natif interdit la sauvegarde au milieu d'un appel scripté. Un
  // appel en préparation trouvé dans une ancienne sauvegarde est donc un
  // résidu d'exécution, jamais une progression à restaurer.
  state.pendingPhoneCall = undefined
  state.safariZone = restoreHgssSafariState(saved.safariZone, pokemonRuntime.trainer.id)
  state.safariProgression = restoreHgssSafariProgression(
    saved.safariProgression,
    state.variables.get(hgssSafariQuestStageVariable),
    state.phoneContacts.has(hgssBaobaPhoneContactId),
  )
  synchronizeHgssSafariQuestState(state)
  state.photoAlbum = restoreHgssPhotoAlbum(saved.photoAlbum, pokemonRuntime.photoDataCatalog)
  state.palPark = saved.palPark
    ? {
        catchingShowActive: saved.palPark.catchingShowActive,
        migratedPokemon: saved.palPark.migratedPokemon.map((pokemon, index) => restorePokemon(pokemonRuntime, pokemon, identityNamespace, `pal-park/${index}`)),
        catchingPoints: saved.palPark.catchingPoints ?? 0,
        timePoints: saved.palPark.timePoints ?? 0,
        typePoints: saved.palPark.typePoints ?? 0,
      }
    : { catchingShowActive: false, migratedPokemon: [], catchingPoints: 0, timePoints: 0, typePoints: 0 }
  state.bugContest = saved.bugContest && {
    ...saved.bugContest,
    registeredContestants: [...saved.bugContest.registeredContestants],
    elapsedMinutes: saved.bugContest.elapsedMinutes ?? 0,
    caughtPokemon: saved.bugContest.caughtPokemon && restorePokemon(pokemonRuntime, saved.bugContest.caughtPokemon, identityNamespace, 'bug-contest'),
  }
  state.kurtApricornType = saved.kurtApricornType ?? 0
  state.kurtApricornQuantity = saved.kurtApricornQuantity ?? 0
  state.kurtBallId = saved.kurtBallId ?? 0
  state.player = { ...saved.player }
  state.objects = new Map()
  state.mapProps = []
  state.currentMapId = saved.currentMapId
  state.previousMapId = saved.previousMapId
  state.dynamicWarp = saved.dynamicWarp && { ...saved.dynamicWarp }
  if (saved.gymmick) {
    state.gymmick = { type: saved.gymmick.type as typeof state.gymmick.type, data: Uint8Array.from(saved.gymmick.data) }
  }
  const retainedPokemon = [
    ...state.party.members,
    ...state.pokemonStorage.boxes.flatMap((box) => box.flatMap((pokemon) => pokemon ? [pokemon] : [])),
    ...state.daycare.mons.flatMap((entry) => entry ? [entry.pokemon] : []),
    ...state.palPark.migratedPokemon,
    ...(state.bugContest?.caughtPokemon ? [state.bugContest.caughtPokemon] : []),
  ]
  const ownedInstanceIds = [
    ...retainedPokemon.map(({ instanceId }) => instanceId),
    ...state.roamers.roamers.flatMap((roamer) => roamer ? [roamer.instanceId] : []),
  ]
  if (new Set(ownedInstanceIds).size !== ownedInstanceIds.length) {
    throw new Error('La sauvegarde HGSS contient plusieurs Pokémon avec le même identifiant persistant.')
  }
  for (const pokemon of retainedPokemon) {
    if (!pokemon.shiny || pokemon.isEgg) continue
    state.pokedex.caughtShinySpeciesIds.add(pokemon.speciesId)
    state.pokedex.caughtSpeciesIds.add(pokemon.speciesId)
    state.pokedex.seenSpeciesIds.add(pokemon.speciesId)
  }
  return state
}

/**
 * Les premieres sauvegardes du port conservaient bien la progression, mais
 * pas toujours les drapeaux de progression dérivables. On ne débloque ici
 * que ce que d'autres données de la sauvegarde prouvent déjà.
 */
function repairLegacyProgressionFlags(saved: SavedFieldScriptState, flags: Set<number>): void {
  if (flags.has(HGSS_LEGACY_HALL_OF_FAME_EVIDENCE_FLAG)) flags.add(HGSS_GAME_CLEAR_SYSTEM_FLAG)
  const playersHouseScene = saved.variables.find(([variable]) => variable === hgssPlayersHouseSceneVariable)?.[1] ?? 0
  const hasStarter = flags.has(hgssGotStarterFlag) || saved.starterChoice !== undefined || saved.party.length > 0
  const receivedInitialMenu = playersHouseScene >= 1
    || hasStarter
    || flags.has(hgssGotBagFlag)
    || flags.has(hgssGotSaveButtonFlag)
    || flags.has(hgssGotOptionsButtonFlag)

  if (receivedInitialMenu) {
    flags.add(hgssGotBagFlag)
    flags.add(hgssGotSaveButtonFlag)
    flags.add(hgssGotOptionsButtonFlag)
  }
  if (hasStarter) flags.add(hgssGotStarterFlag)

  const hasPokegearData = saved.phoneContacts.some((contactId) => contactId !== 0)
    || saved.pokegearCards.length > 0
    || (saved.pokegearMapUnlockLevel ?? 0) > 0
  if (hasPokegearData) flags.add(hgssGotPokegearFlag)
}

export function createHgssSaveState(
  romGameCode: string,
  profile: PlayerProfile,
  rng: HgssSessionRng,
  world: HgssSavedWorldPosition,
  field: FieldScriptState,
  options: HgssGameOptions = createDefaultHgssGameOptions(),
  igt: HgssInGameTime = { hours: 0, minutes: 0, seconds: 0 },
  rtcPenalty?: Readonly<HgssRtcPenaltyState>,
  newGamePlus?: NewGamePlusProfileV1,
  extensions?: VersionedSaveExtensions,
): HgssSaveStateV1 {
  const parsedExtensions = extensions === undefined ? undefined : parseHgssDataOnlyExtensions(extensions)
  assertSharedCampaignMatchesField(field, parsedExtensions)
  const parsedNewGamePlus = newGamePlus ? hgssDataOnlyNewGamePlusRegistry.restoreProfile(newGamePlus) : undefined
  if (parsedNewGamePlus && !isNewGamePlusSourceForGameCode(parsedNewGamePlus.source, romGameCode)) throw new Error(`Le profil New Game+ ne correspond pas a la ROM ${romGameCode}.`)
  const romIdentity = resolveNumericRomIdentity(romGameCode)
  if (profile.gameVersion !== romIdentity.gameVersion || profile.language !== romIdentity.language) {
    throw new Error('Le profil joueur ne correspond pas à l’identité numérique de la ROM.')
  }
  return {
    version: 1,
    romIdentity,
    profile: {
      gender: profile.gender,
      name: profile.name,
      nameSource: 'user-text',
      trainerId: profile.trainerId,
      language: profile.language,
      gameVersion: profile.gameVersion,
    },
    rng: snapshotHgssSessionRng(rng),
    world: {
      mapId: world.mapId,
      tileX: world.tileX,
      tileZ: world.tileZ,
      direction: world.direction,
      ...(world.locomotion === undefined ? {} : { locomotion: world.locomotion }),
      ...(world.follower ? { follower: {
        tileX: world.follower.tileX,
        tileZ: world.follower.tileZ,
        direction: world.follower.direction,
        ...(world.follower.movement === undefined ? {} : { movement: world.follower.movement }),
      } } : {}),
    },
    field: saveFieldState(field),
    options: { textSpeed: options.textSpeed, battleAnimations: options.battleAnimations, localWeather: options.localWeather },
    igt: restoreHgssInGameTime(igt),
    ...(rtcPenalty ? {
      rtcPenalty: {
        schemaVersion: snapshotHgssRtcPenaltyState(rtcPenalty).schemaVersion,
        lastObservedTimestampSeconds: rtcPenalty.lastObservedTimestampSeconds,
        lastObservedDayOrdinal: rtcPenalty.lastObservedDayOrdinal,
        ownerRtcOffset: rtcPenalty.ownerRtcOffset,
        penaltyMinutes: rtcPenalty.penaltyMinutes,
      },
    } : {}),
    ...(parsedNewGamePlus ? { newGamePlus: parsedNewGamePlus } : {}),
    ...(parsedExtensions ? { extensions: parsedExtensions } : {}),
  }
}

const hgssDataOnlySaveTopLevelKeys = new Set([
  'extensions', 'field', 'igt', 'newGamePlus', 'options', 'profile', 'rng',
  'romIdentity', 'rtcPenalty', 'version', 'world',
])

function assertDataOnlySavedPokemon(pokemon: SavedPokemon, path: string): void {
  if (pokemon.instanceId !== undefined) parsePortablePokemonInstanceId(pokemon.instanceId)
  if (typeof pokemon.originalTrainer.isPlayer !== 'boolean') throw new Error(`L'appartenance OT à ${path} n'est pas canonique.`)
  if (pokemon.originalTrainer.localTradeId !== undefined && pokemon.originalTrainer.isPlayer) {
    throw new Error(`L'OT local à ${path} ne peut pas appartenir au joueur.`)
  }
  if (pokemon.mailIdentity !== undefined) throw new Error(`Une identité de courrier legacy subsiste à ${path}.mailIdentity.`)
  if (pokemon.nickname !== undefined && pokemon.nicknameSource !== 'user-text') throw new Error(`Le surnom à ${path} n'est pas attesté utilisateur.`)
  if (pokemon.nicknameSource === 'local-ref') throw new Error(`Le surnom local à ${path} n'est pas projeté par référence.`)
  if (pokemon.originalTrainer.name !== undefined && pokemon.originalTrainer.nameSource !== 'user-text') {
    throw new Error(`Le nom OT à ${path}.originalTrainer n'est pas attesté utilisateur.`)
  }
  if (pokemon.originalTrainer.nameSource === 'local-ref') throw new Error(`Le nom OT local à ${path} n'est pas projeté par référence.`)
}

function assertDataOnlySavedField(field: SavedFieldScriptState): void {
  if (field.playerNameSource !== 'user-text') throw new Error("Le nom joueur terrain n'est pas attesté.")
  if (field.player.groundHeight !== undefined || field.player.movement !== undefined) {
    throw new Error("L'avatar terrain contient encore une projection locale.")
  }
  if (field.friendName !== undefined && field.friendNameSource !== 'user-text') throw new Error("Le nom ami terrain n'est pas attesté.")
  if (field.rivalName !== undefined && field.rivalNameSource !== 'user-text') throw new Error("Le nom rival terrain n'est pas attesté.")
  field.party.forEach((pokemon, index) => assertDataOnlySavedPokemon(pokemon, `field.party[${index}]`))
  field.pokemonStorage?.boxes.forEach((box, boxIndex) => box.forEach((pokemon, slot) => {
    if (pokemon) assertDataOnlySavedPokemon(pokemon, `field.pokemonStorage.boxes[${boxIndex}][${slot}]`)
  }))
  field.daycare?.mons.forEach((entry, index) => {
    if (entry) assertDataOnlySavedPokemon(entry.pokemon, `field.daycare.mons[${index}].pokemon`)
  })
  field.trainerHouseEntries?.forEach((entry, index) => {
    if (!entry) return
    if (entry.nameSource !== 'user-text') throw new Error(`Le nom distant à field.trainerHouseEntries[${index}] n'est pas attesté.`)
    entry.party.forEach((pokemon, partyIndex) => assertDataOnlySavedPokemon(pokemon, `field.trainerHouseEntries[${index}].party[${partyIndex}]`))
  })
  field.palPark?.migratedPokemon.forEach((pokemon, index) => assertDataOnlySavedPokemon(pokemon, `field.palPark.migratedPokemon[${index}]`))
  if (field.bugContest?.caughtPokemon) assertDataOnlySavedPokemon(field.bugContest.caughtPokemon, 'field.bugContest.caughtPokemon')
  field.roamers?.roamers.forEach((roamer) => {
    if (roamer?.instanceId !== undefined) parsePortablePokemonInstanceId(roamer.instanceId)
  })
  if (field.p2pTradeJournals !== undefined) parseHgssP2pTradeJournals(field.p2pTradeJournals)
  if (field.p2pTradeReceipts !== undefined) parseHgssP2pTradeReceipts(field.p2pTradeReceipts)
  field.friendGroups?.forEach((group, index) => {
    if (group.groupName !== undefined && group.groupNameSource !== 'user-text') throw new Error(`Le nom à field.friendGroups[${index}].groupName n'est pas attesté.`)
    if (group.memberName !== undefined && group.memberNameSource !== 'user-text') throw new Error(`Le nom à field.friendGroups[${index}].memberName n'est pas attesté.`)
  })
}

function isSameJsonValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((entry, index) => isSameJsonValue(entry, right[index]))
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = Object.keys(leftRecord).sort()
  const rightKeys = Object.keys(rightRecord).sort()
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && isSameJsonValue(leftRecord[key], rightRecord[key]))
}

/**
 * Valide le document canonique produit localement, sans résoudre le moindre
 * catalogue ROM. La restauration legacy reste volontairement une API séparée.
 */
export function parseHgssSaveStateV1(value: unknown): HgssSaveStateV1 {
  const saved = requireRecord(value, 'save')
  for (const key of Object.keys(saved)) {
    if (!hgssDataOnlySaveTopLevelKeys.has(key)) throw new Error(`La sauvegarde HGSS data-only contient un champ inconnu à save.${key}.`)
  }
  if (saved.version !== 1) throw new Error(`La version de sauvegarde HGSS ${String(saved.version)} n'est pas prise en charge.`)
  const romIdentity = requireRecord(saved.romIdentity, 'romIdentity')
  if (Object.keys(romIdentity).some((key) => key !== 'gameVersion' && key !== 'language')) throw new Error('romIdentity contient un champ inconnu.')
  requireInteger(romIdentity.gameVersion, 'romIdentity.gameVersion', 0, 0xff)
  requireInteger(romIdentity.language, 'romIdentity.language', 0, 0xff)
  const profile = requireRecord(saved.profile, 'profile')
  const profileKeys = new Set(['gameVersion', 'gender', 'language', 'name', 'nameSource', 'trainerId'])
  if (Object.keys(profile).some((key) => !profileKeys.has(key))) throw new Error('profile contient un champ inconnu.')
  if (profile.gender !== 'male' && profile.gender !== 'female') throw new Error('La sauvegarde HGSS contient un genre invalide a profile.gender.')
  requireBoundedText(profile.name, 'profile.name', 7, 1)
  if (profile.nameSource !== 'user-text') throw new Error('Le nom du profil HGSS data-only n’est pas attesté.')
  requireInteger(profile.trainerId, 'profile.trainerId')
  requireInteger(profile.language, 'profile.language')
  requireInteger(profile.gameVersion, 'profile.gameVersion')
  const rng = requireRecord(saved.rng, 'rng')
  requireOnlyKeys(rng, new Set(['lcSeed', 'mt', 'seed']), 'rng')
  const mt = requireRecord(rng.mt, 'rng.mt')
  requireOnlyKeys(mt, new Set(['cycle', 'state']), 'rng.mt')
  restoreHgssSessionRng(saved.rng as HgssSessionRngSnapshot)
  validateSavedWorld(saved.world)
  validateSavedField(saved.field)
  const field = saved.field as SavedFieldScriptState
  if (romIdentity.gameVersion !== profile.gameVersion || romIdentity.language !== profile.language) {
    throw new Error("L'identité ROM numérique ne correspond pas au profil HGSS.")
  }
  if (field.playerName !== profile.name || field.gender !== profile.gender) {
    throw new Error('Le profil HGSS ne correspond pas à son état terrain.')
  }
  if (field.mailboxMailIdentities !== undefined || field.buffers.length || field.objects.length || field.mapProps.length) {
    throw new Error('La sauvegarde HGSS data-only contient encore une projection locale ou legacy.')
  }
  assertDataOnlySavedField(field)
  if (field.safariZone !== undefined) validateSavedHgssSafariState(field.safariZone, 'field.safariZone', true)
  if (field.photoAlbum !== undefined && field.photoAlbum.schemaVersion !== 2) throw new Error("L'album HGSS n'est pas projeté par identifiants locaux.")
  if (saved.options !== undefined) restoreGameOptions(saved.options)
  if (saved.igt !== undefined) {
    const igt = requireRecord(saved.igt, 'igt')
    requireOnlyKeys(igt, new Set(['hours', 'minutes', 'seconds']), 'igt')
    restoreHgssInGameTime(saved.igt)
  }
  if (saved.rtcPenalty !== undefined) {
    const rtcPenalty = requireRecord(saved.rtcPenalty, 'rtcPenalty')
    requireOnlyKeys(rtcPenalty, new Set(['lastObservedDayOrdinal', 'lastObservedTimestampSeconds', 'ownerRtcOffset', 'penaltyMinutes', 'schemaVersion']), 'rtcPenalty')
    validateHgssRtcPenaltyState(saved.rtcPenalty)
  }
  const newGamePlus = saved.newGamePlus === undefined
    ? undefined
    : hgssDataOnlyNewGamePlusRegistry.restoreProfile(saved.newGamePlus)
  if (newGamePlus && !isSameJsonValue(saved.newGamePlus, newGamePlus)) {
    throw new Error('Le profil New Game+ HGSS n’est pas sous sa forme data-only canonique.')
  }
  const extensions = saved.extensions === undefined ? undefined : parseHgssDataOnlyExtensions(saved.extensions)
  assertSharedCampaignMatchesField({
    gender: field.gender,
    playerName: field.playerName,
    flags: field.flags,
    badges: field.badges,
    trainerFlags: field.trainerFlags ?? [],
    variables: field.variables,
  }, extensions)
  if (extensions && !isSameJsonValue(saved.extensions, extensions)) {
    throw new Error('Les extensions HGSS ne sont pas sous leur forme data-only canonique.')
  }
  return JSON.parse(JSON.stringify({
    ...saved,
    ...(newGamePlus ? { newGamePlus } : {}),
    ...(extensions ? { extensions } : {}),
  })) as HgssSaveStateV1
}

export function restoreHgssSaveState(
  value: unknown,
  expectedGameCode: string,
  catalog: PokemonCatalog,
  now: () => Date,
  itemCatalog?: HgssItemCatalog,
  pokedexCatalog?: HgssPokedexCatalog,
  rtcContinueOptions: HgssRtcContinueOptions = {},
  localResources: HgssSaveLocalRomResources = {},
): RestoredHgssSaveState {
  if (!value || typeof value !== 'object') throw new Error('La sauvegarde HGSS est absente ou invalide.')
  const saved = value as Partial<HgssSaveStateV1>
  if (saved.version !== 1) throw new Error(`La version de sauvegarde HGSS ${String(saved.version)} n'est pas prise en charge.`)
  const expectedIdentity = resolveNumericRomIdentity(expectedGameCode)
  if (saved.romIdentity
    ? saved.romIdentity.gameVersion !== expectedIdentity.gameVersion || saved.romIdentity.language !== expectedIdentity.language
    : saved.romGameCode !== expectedGameCode) {
    throw new Error(`La sauvegarde ne correspond pas a la ROM ${expectedGameCode}.`)
  }
  if (!saved.profile || !saved.rng || !saved.world || !saved.field) throw new Error('La sauvegarde HGSS V1 est incomplete.')
  validateSavedWorld(saved.world)
  validateSavedField(saved.field)
  if (saved.extensions !== undefined) parseHgssDataOnlyExtensions(saved.extensions)
  if (itemCatalog) {
    validateBagInventoryEntries(saved.field.inventory, itemCatalog, 'field.inventory')
    saved.field.party.forEach((pokemon, index) => {
      if (pokemon.heldItemId !== 0 && !itemCatalog.items[pokemon.heldItemId]) {
        throw new Error(`L’objet tenu ${pokemon.heldItemId} est absent de la ROM à field.party[${index}].heldItemId.`)
      }
    })
    saved.field.pokemonStorage?.boxes.forEach((box, boxIndex) => box.forEach((pokemon, slot) => {
      if (pokemon?.heldItemId && !itemCatalog.items[pokemon.heldItemId]) {
        throw new Error(`L’objet tenu ${pokemon.heldItemId} est absent de la ROM à field.pokemonStorage.boxes[${boxIndex}][${slot}].heldItemId.`)
      }
    }))
  }
  const profileValue = requireRecord(saved.profile, 'profile')
  if (profileValue.gender !== 'male' && profileValue.gender !== 'female') throw new Error('La sauvegarde HGSS contient un genre invalide a profile.gender.')
  requireBoundedText(profileValue.name, 'profile.name', 7, 1)
  requireInteger(profileValue.trainerId, 'profile.trainerId')
  requireInteger(profileValue.language, 'profile.language')
  requireInteger(profileValue.gameVersion, 'profile.gameVersion')
  const profile: PlayerProfile = {
    gender: saved.profile.gender,
    name: saved.profile.name,
    trainerId: saved.profile.trainerId,
    language: saved.profile.language,
    gameVersion: saved.profile.gameVersion,
  }
  if (profile.trainerId === undefined || profile.language === undefined || profile.gameVersion === undefined || !profile.name) {
    throw new Error('Le profil de la sauvegarde HGSS est incomplet.')
  }
  const rng = restoreHgssSessionRng(saved.rng)
  const igt = restoreHgssInGameTime(saved.igt)
  const rtcPenalty = restoreHgssRtcPenaltyState(saved.rtcPenalty, now(), rtcContinueOptions)
  const newGamePlus = saved.newGamePlus === undefined ? undefined : hgssDataOnlyNewGamePlusRegistry.restoreProfile(saved.newGamePlus)
  if (newGamePlus && !isNewGamePlusSourceForGameCode(newGamePlus.source, expectedGameCode)) throw new Error(`Le profil New Game+ ne correspond pas a la ROM ${expectedGameCode}.`)
  const extensions = saved.extensions && parseHgssDataOnlyExtensions(saved.extensions)
  const pokemonRuntime: FieldPokemonRuntime = {
    catalog,
    pokedexCatalog,
    itemCatalog,
    npcTradeCatalog: localResources.npcTradeCatalog,
    photoDataCatalog: localResources.photoDataCatalog,
    rng: rng.lc,
    mt: rng.mt,
    trainer: { id: profile.trainerId, name: profile.name, gender: profile.gender, nameSource: 'user-text' },
    language: profile.language,
    gameVersion: profile.gameVersion,
    now,
  }
  const pokemonIdentityNamespace = `hgss-${profile.gameVersion}-${profile.trainerId.toString(16).padStart(8, '0')}`
  const field = restoreFieldState(saved.field, pokemonRuntime, pokemonIdentityNamespace)
  assertSharedCampaignMatchesField(field, extensions)
  return {
    profile,
    rng,
    world: { ...saved.world, follower: saved.world.follower && { ...saved.world.follower } },
    field,
    options: restoreGameOptions(saved.options),
    igt,
    rtcPenalty,
    ...(newGamePlus ? { newGamePlus } : {}),
    ...(extensions ? { extensions } : {}),
  }
}
