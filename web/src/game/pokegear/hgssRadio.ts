import type { OpeningMapPreview } from '../../ndsTypes'
import type { RomAudioRuntime } from '../../audio/romAudioRuntime'
import { stripMessageControls } from '../../rom/messages/hgssMessageBank'
import type { HgssWildEncounterData } from '../../rom/encounters/wildEncounterData'
export { hgssRadioMessageBanks } from '../../rom/pokegear/radioPrograms'
import type { EncounterRadioEffect } from '../encounters/wildEncounterSelection'
import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import { formatHgssRomMessage } from '../ui/romMessageFormatting'
import { hgssPokegearFlypointFlagBase } from './pokegearNativeState'

export type HgssRadioStationSelection = 'no-signal' | 'johto' | 'kanto' | 'kanto-expn' | 'alph' | 'rocket' | 'mahogany'

export type HgssRadioProgram = {
  id: number
  slot: number
  title: string
  host: string
  broadcast: string
  tunerX: number
  tunerY: number
  sequenceIds: readonly number[]
}

export type HgssRadioModel = {
  selection: HgssRadioStationSelection
  programs: HgssRadioProgram[]
  selected?: HgssRadioProgram
  cursorX: number
  cursorY: number
  signalStrength: 0 | 1 | 2
}

export type HgssRadioContext = {
  map: OpeningMapPreview
  flags: ReadonlySet<number>
  variables: ReadonlyMap<number, number>
  now: Date
  nationalDexEnabled: boolean
  hasGbSounds: boolean
}

export type HgssRadioBroadcastContext = HgssRadioContext & {
  badges: ReadonlySet<number>
  inventory: ReadonlyMap<number, number>
  maps: readonly OpeningMapPreview[]
  wildEncounters: readonly HgssWildEncounterData[]
  speciesNames: readonly string[]
  caughtSpeciesIds: ReadonlySet<number>
  buenasPasswordMessages: Readonly<Record<number, string>>
  swarm?: { mapId: number, speciesId: number }
}

export type HgssRadioBroadcast = {
  messages: readonly string[]
  episodeId?: number
}

export const hgssRadioRestoredPowerFlag = 0x118
export const hgssRadioExpnCardFlag = 0x11f
export const hgssRadioRocketHideoutClearedFlag = 0xca
export const hgssRadioRocketTakeoverVariable = 0x4077
export const hgssGbSoundsItemId = 502
export const hgssBlueCardItemId = 472

const gotPokedexFlag = 0x6b
const beatAzaleaRocketsFlag = 0x7b
const beatRadioTowerRocketsFlag = 0xc6
const gameClearFlag = 0x964
// Indices réellement stockés dans gMapFlypointParams (overlay 101). L'ordre
// géographique de cette table diffère des anciens noms symboliques reconstruits
// pour Irisia, Doublonville et Rosalia : la Radio doit lire les mêmes bits que
// ceux posés par la Carte, pas une seconde table nominale.
const flypointVermilion = 5
const flypointCianwood = 15
const flypointGoldenrod = 16
const flypointOlivine = 17
const flypointEcruteak = 18
const flypointMahogany = 19
const flypointBlackthorn = 21
const flypointRoute47And48 = 25
const plainBadgeId = 2

const pokemonTalkFilteredMapIds = new Set([
  449, 513, 487, 315, 490, 491, 492, 237, 238, 239, 242, 243, 298, 357,
])

type CommercialUnlock = 'always' | 'pokedex' | 'ecruteak' | 'cianwood' | 'olivine' | 'game-clear' | 'vermilion' | 'power'
type CommercialRegion = 1 | 2 | 3
type CommercialSpec = readonly [CommercialUnlock, CommercialRegion, number]

/** Table `sCommercialsData` de la ROM : condition, région et canal natif. */
const commercialSpecs: readonly CommercialSpec[] = [
  ['always', 3, 0xff], ['always', 3, 0xff], ['always', 3, 0xff], ['always', 3, 0xff], ['always', 3, 0xff],
  ['always', 1, 0xff], ['always', 1, 0xff], ['always', 1, 0xff], ['always', 1, 0xff],
  ['always', 3, 2], ['always', 3, 2],
  ['pokedex', 3, 0xff], ['pokedex', 3, 0xff], ['pokedex', 3, 0xff], ['pokedex', 3, 0xff],
  ['ecruteak', 1, 3], ['ecruteak', 1, 3], ['ecruteak', 1, 3],
  ['ecruteak', 1, 2], ['ecruteak', 1, 2], ['ecruteak', 3, 2],
  ['cianwood', 3, 2], ['cianwood', 1, 3],
  ['olivine', 3, 1], ['olivine', 3, 1], ['olivine', 3, 1], ['olivine', 3, 1], ['olivine', 3, 1], ['olivine', 3, 1],
  ['game-clear', 3, 3],
  ['vermilion', 2, 3], ['vermilion', 2, 3], ['vermilion', 2, 3], ['vermilion', 2, 3], ['vermilion', 2, 3],
  ['power', 3, 3],
]

const alphMaps = new Set([315, 323, 490, 491, 492])
const mahoganyMaps = new Set([
  87, 133, 140, 396, 397, 246, 368, 116, 247, 248, 249, 45, 142, 245, 88, 294, 295,
])

const tunerCoordinates: Readonly<Record<number, readonly [number, number]>> = {
  0: [112, 76], 1: [152, 76], 2: [96, 108], 3: [136, 116], 4: [128, 48],
  5: [128, 92], 6: [128, 92], 7: [128, 92],
}

const programSequenceIds: Readonly<Record<number, readonly number[]>> = {
  1: [1103], 2: [1173], 3: [1173], 4: [1104], 5: [1171], 6: [1172],
  7: [1102], 8: [1101], 9: [1182], 10: [1093], 11: [1098],
}

const gbSoundsSequenceIds = [
  1218, 1220, 1228, 1229, 1306, 1317, 1318, 1319, 1320, 1321, 1322, 1323, 1324,
  1325, 1326, 1327, 1332, 1316, 1310, 1315, 1312, 1311, 1314, 1222, 1279,
] as const

export function resolveHgssRadioStationSelection(
  map: OpeningMapPreview,
  flags: ReadonlySet<number>,
  variables: ReadonlyMap<number, number>,
): HgssRadioStationSelection {
  if (!map.header.radioSignal) return 'no-signal'
  if (alphMaps.has(map.id)) return 'alph'
  if (map.header.region !== 0) {
    if (!flags.has(hgssRadioRestoredPowerFlag)) return 'no-signal'
    return flags.has(hgssRadioExpnCardFlag) ? 'kanto-expn' : 'kanto'
  }
  if (mahoganyMaps.has(map.id) && !flags.has(hgssRadioRocketHideoutClearedFlag)) return 'mahogany'
  const rocketTakeoverScene = variables.get(hgssRadioRocketTakeoverVariable) ?? 0
  if (rocketTakeoverScene >= 2 && rocketTakeoverScene <= 4) return 'rocket'
  return 'johto'
}

export function resolveHgssRadioProgramId(slot: number, hour: number): number {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error(`Heure radio HGSS ${hour} invalide.`)
  if (slot === 0) return 0
  if (slot === 1) return 1
  if (slot === 2) return 5 + hour % 2
  if (slot === 3) return 2 + hour % 3
  if (slot >= 4 && slot <= 7) return slot + 3
  return 0
}

export function resolveHgssPokemonMusicSequenceIds(
  weekday: number,
  nationalDexEnabled: boolean,
  hasGbSounds: boolean,
): readonly number[] {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new Error(`Jour radio HGSS ${weekday} invalide.`)
  if (weekday === 0) return hasGbSounds ? gbSoundsSequenceIds : [1100]
  if (weekday === 1 || weekday === 5) return [1100]
  if (weekday === 3) return [nationalDexEnabled ? 1169 : 1100]
  if (weekday === 2 || weekday === 6) return [1099]
  return [nationalDexEnabled ? 1170 : 1099]
}

function slotsForSelection(selection: HgssRadioStationSelection): readonly number[] {
  if (selection === 'johto') return [0, 1, 2, 3]
  if (selection === 'kanto') return [0, 1, 2]
  if (selection === 'kanto-expn') return [0, 1, 2, 3, 4]
  if (selection === 'alph') return [5]
  if (selection === 'rocket') return [6]
  if (selection === 'mahogany') return [7]
  return []
}

const stationRadii: Readonly<Record<number, number>> = { 0: 16, 1: 20, 2: 16, 3: 20, 4: 8, 5: 16, 6: 52, 7: 52 }
const nativePresetCoordinates = [[112, 76], [152, 76], [96, 108], [136, 116]] as const

export function isHgssRadioTuningCoordinate(x: number, y: number): boolean {
  return Math.hypot(x - 128, y - 92) <= 52
}

/** Traduction directe de Radio_HandleKeyInput : deux pixels par VBlank. */
export function moveHgssRadioCursor(x: number, y: number, deltaX: number, deltaY: number): { x: number, y: number } {
  let nextX = x
  let nextY = y
  if (isHgssRadioTuningCoordinate(nextX + deltaX, nextY)) nextX += deltaX
  if (isHgssRadioTuningCoordinate(nextX, nextY + deltaY)) nextY += deltaY
  return { x: nextX, y: nextY }
}

export function getHgssRadioPresetCoordinate(button: number): { x: number, y: number } {
  const coordinate = nativePresetCoordinates[((button % 4) + 4) % 4]!
  return { x: coordinate[0], y: coordinate[1] }
}

/** Reproduit l'ordre des hitboxes circulaires de Radio_GetTunedStationID. */
export function resolveHgssRadioTuning(selection: HgssRadioStationSelection, x: number, y: number): { slot?: number, signalStrength: 0 | 1 | 2 } {
  const slots = slotsForSelection(selection)
  for (const slot of slots) {
    const [stationX, stationY] = tunerCoordinates[slot]!
    const distance = Math.hypot(x - stationX, y - stationY)
    const exactRadius = slot === 6 || slot === 7 ? 38 : 4
    if (distance <= exactRadius) return { slot, signalStrength: 2 }
    if (distance <= stationRadii[slot]!) return { slot, signalStrength: 1 }
  }
  return { signalStrength: 0 }
}

function radioMessage(bank: Readonly<Record<number, string>>, messageId: number, values: readonly string[] = []): string {
  return formatHgssRomMessage(bank[messageId] ?? '', values).trim()
}

function existingMessages(messages: readonly string[]): string[] {
  return messages.filter((message) => message.length > 0)
}

function pickIndex(length: number, random: () => number): number {
  if (length <= 0) return -1
  return (random() & 0xffff) % length
}

function pickUniqueIndexes(length: number, count: number, random: () => number): number[] {
  const selected: number[] = []
  while (selected.length < Math.min(length, count)) {
    const index = pickIndex(length, random)
    if (!selected.includes(index)) selected.push(index)
  }
  return selected
}

function hasFlypoint(context: HgssRadioBroadcastContext, flypoint: number): boolean {
  return context.flags.has(hgssPokegearFlypointFlagBase + flypoint)
}

function isCommercialUnlocked(context: HgssRadioBroadcastContext, unlock: CommercialUnlock): boolean {
  if (unlock === 'always') return true
  if (unlock === 'pokedex') return context.flags.has(gotPokedexFlag)
  if (unlock === 'ecruteak') return hasFlypoint(context, flypointEcruteak)
  if (unlock === 'cianwood') return hasFlypoint(context, flypointCianwood)
  if (unlock === 'olivine') return hasFlypoint(context, flypointOlivine)
  if (unlock === 'game-clear') return context.flags.has(gameClearFlag)
  if (unlock === 'vermilion') return hasFlypoint(context, flypointVermilion)
  return context.flags.has(hgssRadioRestoredPowerFlag)
}

function selectCommercialMessage(
  program: HgssRadioProgram,
  context: HgssRadioBroadcastContext,
  messages: Readonly<Record<number, Readonly<Record<number, string>>>>,
  random: () => number,
): string {
  const regionMask: CommercialRegion = context.map.header.region === 0 ? 1 : 2
  const available = commercialSpecs.flatMap(([unlock, regions, channel], index) => (
    isCommercialUnlocked(context, unlock) && (regions & regionMask) !== 0 && (channel === 0xff || channel === program.slot) ? [index] : []
  ))
  const selected = available[pickIndex(available.length, random)]
  return selected === undefined ? '' : radioMessage(messages[11] ?? {}, 2 + selected)
}

function collectEncounterSpecies(encounters: HgssWildEncounterData): number[] {
  const species: number[] = []
  const add = (speciesId: number) => {
    if (speciesId > 0 && speciesId <= 493 && !species.includes(speciesId)) species.push(speciesId)
  }
  if (encounters.rates.walking !== 0) {
    for (const slot of [...encounters.land.morning, ...encounters.land.day, ...encounters.land.night]) add(slot.speciesId)
  }
  if (encounters.rates.surfing !== 0) for (const slot of encounters.surfing) add(slot.speciesId)
  if (encounters.rates.rockSmash !== 0) for (const slot of encounters.rockSmash) add(slot.speciesId)
  if (encounters.rates.oldRod !== 0) for (const slot of encounters.oldRod) add(slot.speciesId)
  if (encounters.rates.goodRod !== 0) for (const slot of encounters.goodRod) add(slot.speciesId)
  if (encounters.rates.superRod !== 0) for (const slot of encounters.superRod) add(slot.speciesId)
  add(encounters.swarm.nightFishingSpeciesId)
  return species
}

function samplePokemonTalkPairs(
  context: HgssRadioBroadcastContext,
  random: () => number,
): Array<{ location: string, species: string }> {
  const visitedRoute47And48 = hasFlypoint(context, flypointRoute47And48)
  const candidates = context.maps.filter((map) => map.header.wildEncounterBank !== 0xff
    && map.header.region === context.map.header.region
    && !pokemonTalkFilteredMapIds.has(map.id)
    && (visitedRoute47And48 || (map.id !== 151 && map.id !== 152)))
  const selected: Array<{ location: string, species: string }> = []
  const usedLocations = new Set<string>()
  let attempts = 0
  while (selected.length < 5 && candidates.length > usedLocations.size && attempts < candidates.length * 32) {
    attempts += 1
    const map = candidates[pickIndex(candidates.length, random)]
    if (!map || usedLocations.has(map.label)) continue
    const encounters = context.wildEncounters[map.header.wildEncounterBank]
    if (!encounters) continue
    const species = collectEncounterSpecies(encounters)
    const priority = species.filter((speciesId) => !context.caughtSpeciesIds.has(speciesId))
    const pool = priority.length === 0 || (priority.length === 1 && random() % 1000 < 500) ? species : priority
    const speciesId = pool[pickIndex(pool.length, random)]
    const speciesName = speciesId === undefined ? undefined : context.speciesNames[speciesId]
    if (!speciesName) continue
    usedLocations.add(map.label)
    selected.push({ location: map.label, species: speciesName })
  }
  return selected
}

function createPokemonTalkMessages(
  context: HgssRadioBroadcastContext,
  bank: Readonly<Record<number, string>>,
  random: () => number,
): string[] {
  const pairs = samplePokemonTalkPairs(context, random)
  const step = ((random() % 3) + 1) * 2
  let firstFlavor = random() % 13
  let secondFlavor = random() % 13
  const result = [radioMessage(bank, 2)]
  if (context.swarm) {
    const swarmMap = context.maps.find(({ id }) => id === context.swarm?.mapId)
    const swarmSpecies = context.speciesNames[context.swarm.speciesId]
    if (swarmMap && swarmSpecies) result.push(radioMessage(bank, 32, [swarmMap.label, swarmSpecies]))
  }
  for (const pair of pairs) {
    result.push(radioMessage(bank, 4, [pair.location, pair.species]))
    result.push(radioMessage(bank, 5, [
      pair.location,
      pair.species,
      radioMessage(bank, 6 + firstFlavor),
      radioMessage(bank, 19 + secondFlavor),
    ]))
    firstFlavor = (firstFlavor + step) % 13
    secondFlavor = (secondFlavor + step) % 13
  }
  result.push(radioMessage(bank, 3))
  return existingMessages(result)
}

function unlockedSearchPartyEpisodes(context: HgssRadioBroadcastContext): number[] {
  const badgeCount = context.badges.size
  const conditions = [
    true,
    true,
    context.flags.has(beatAzaleaRocketsFlag),
    context.badges.has(plainBadgeId),
    context.flags.has(beatRadioTowerRocketsFlag),
    badgeCount >= 8,
    badgeCount >= 9,
    hasFlypoint(context, flypointVermilion),
    hasFlypoint(context, flypointVermilion),
    hasFlypoint(context, flypointVermilion),
    badgeCount >= 16,
    badgeCount >= 16,
    badgeCount >= 16,
  ]
  return conditions.flatMap((unlocked, index) => unlocked ? [index] : [])
}

function unlockedTownEpisodes(context: HgssRadioBroadcastContext): number[] {
  const conditions = [
    true, true, true, true, true, true, true,
    hasFlypoint(context, flypointGoldenrod),
    hasFlypoint(context, flypointMahogany),
    hasFlypoint(context, flypointBlackthorn),
    ...Array(10).fill(hasFlypoint(context, flypointVermilion)) as boolean[],
  ]
  return conditions.flatMap((unlocked, index) => unlocked ? [index] : [])
}

/**
 * Rejoue les machines d'état des émissions HGSS avec les banques ROM. Les
 * choix aléatoires sont injectés pour utiliser le même LCRNG que le gameplay.
 */
export function createHgssRadioBroadcast(
  program: HgssRadioProgram,
  context: HgssRadioBroadcastContext,
  messages: Readonly<Record<number, Readonly<Record<number, string>>>>,
  random: () => number,
  lastEpisodeId = 0,
): HgssRadioBroadcast {
  const bank = messages[program.id] ?? {}
  let episodeId: number | undefined
  let broadcast: string[]
  if (program.id === 0) {
    let dailyMessageId = 3 + context.now.getDay()
    if (context.now.getDay() === 0 && !context.hasGbSounds) dailyMessageId = 12
    else if (context.now.getDay() === 3 && context.nationalDexEnabled) dailyMessageId = 10
    else if (context.now.getDay() === 4 && context.nationalDexEnabled) dailyMessageId = 11
    broadcast = [radioMessage(bank, 2), radioMessage(bank, dailyMessageId)]
  } else if (program.id === 1) {
    broadcast = createPokemonTalkMessages(context, bank, random)
  } else if (program.id === 2) {
    const unlocked = unlockedSearchPartyEpisodes(context)
    let selectedIndex = pickIndex(unlocked.length, random)
    if (selectedIndex === lastEpisodeId) selectedIndex = (selectedIndex + 1) % unlocked.length
    episodeId = selectedIndex
    broadcast = [radioMessage(bank, 2), radioMessage(bank, 4 + (unlocked[selectedIndex] ?? 0)), radioMessage(bank, 3)]
  } else if (program.id === 3) {
    episodeId = pickIndex(22, random)
    if (episodeId === lastEpisodeId) episodeId = (episodeId + 1) % 22
    broadcast = [radioMessage(bank, 2), radioMessage(bank, 4 + episodeId), radioMessage(bank, 3)]
  } else if (program.id === 4) {
    const hasBlueCard = (context.inventory.get(hgssBlueCardItemId) ?? 0) > 0
    const passwordSet = (context.variables.get(0x4033) ?? 0) % 30
    const password = context.buenasPasswordMessages[40 + passwordSet] ?? ''
    broadcast = [radioMessage(bank, 2), radioMessage(bank, hasBlueCard ? 4 : 5, [password]), radioMessage(bank, 3)]
  } else if (program.id === 5) {
    broadcast = [radioMessage(bank, 2), ...pickUniqueIndexes(16, 3, random).map((index) => radioMessage(bank, 4 + index)), radioMessage(bank, 3)]
  } else if (program.id === 6) {
    const unlocked = unlockedTownEpisodes(context)
    broadcast = [radioMessage(bank, 2), ...pickUniqueIndexes(unlocked.length, 3, random).map((index) => radioMessage(bank, 4 + unlocked[index]!)), radioMessage(bank, 3)]
  } else if (program.id === 9) {
    broadcast = [radioMessage(bank, 2)]
  } else {
    broadcast = []
  }
  if (program.id >= 1 && program.id <= 6) {
    broadcast.push(selectCommercialMessage(program, context, messages, random))
  }
  return { messages: existingMessages(broadcast), ...(episodeId === undefined ? {} : { episodeId }) }
}

export function createHgssRadioModel(
  context: HgssRadioContext,
  messages: Readonly<Record<number, Readonly<Record<number, string>>>>,
  tuning?: number | { x: number, y: number },
): HgssRadioModel {
  const selection = resolveHgssRadioStationSelection(context.map, context.flags, context.variables)
  const programs = slotsForSelection(selection).map((slot): HgssRadioProgram => {
    const id = resolveHgssRadioProgramId(slot, context.now.getHours())
    const bank = messages[id] ?? {}
    const [tunerX, tunerY] = tunerCoordinates[slot]!
    return {
      id,
      slot,
      title: stripMessageControls(bank[0] ?? ''),
      host: stripMessageControls(bank[1] ?? ''),
      broadcast: stripMessageControls(bank[2] ?? ''),
      tunerX,
      tunerY,
      sequenceIds: id === 0
        ? resolveHgssPokemonMusicSequenceIds(context.now.getDay(), context.nationalDexEnabled, context.hasGbSounds)
        : programSequenceIds[id] ?? [],
    }
  })
  const cursorX = typeof tuning === 'object' ? tuning.x : tunerCoordinates[tuning ?? programs[0]?.slot ?? 0]?.[0] ?? 128
  const cursorY = typeof tuning === 'object' ? tuning.y : tunerCoordinates[tuning ?? programs[0]?.slot ?? 0]?.[1] ?? 128
  const reception = typeof tuning === 'number' ? { slot: tuning, signalStrength: 2 as const } : resolveHgssRadioTuning(selection, cursorX, cursorY)
  return { selection, programs, selected: programs.find(({ slot }) => slot === reception.slot), cursorX, cursorY, signalStrength: reception.signalStrength }
}

export function selectHgssRadioSequence(program: HgssRadioProgram, randomValue: number): number | undefined {
  if (program.sequenceIds.length === 0) return undefined
  if (program.sequenceIds.length === 1) return program.sequenceIds[0]
  const normalized = randomValue >>> 0
  return program.sequenceIds[Math.floor(normalized % 25000 / 1000)]
}

export function tuneHgssRadioProgram(program: HgssRadioProgram, rng: HgssLcrng): number | undefined {
  if (program.sequenceIds.length <= 1) return program.sequenceIds[0]
  return selectHgssRadioSequence(program, rng.nextU16())
}

export function resolveHgssEncounterRadioEffect(sequenceId: number): EncounterRadioEffect {
  if (sequenceId === 1100 || sequenceId === 1312) return 'march'
  if (sequenceId === 1099 || sequenceId === 1311) return 'lullaby'
  if (sequenceId === 1169) return 'hoenn'
  if (sequenceId === 1170) return 'sinnoh'
  return 'none'
}

export function playHgssFieldMusic(
  audio: RomAudioRuntime | undefined,
  map: OpeningMapPreview,
  radioMusicSequenceId: number,
  now?: Date,
): Promise<number> | undefined {
  if (!audio) return undefined
  return radioMusicSequenceId !== 0
    ? audio.playMusic(radioMusicSequenceId).then(() => radioMusicSequenceId)
    : audio.playMapMusic(map, now)
}
