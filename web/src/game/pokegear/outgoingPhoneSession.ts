import type { OpeningMapPreview, RomInventory } from '../../ndsTypes'
import { resolveHgssOutgoingPhoneCall, resolveHgssOutgoingPhoneChoice, type HgssOutgoingPhoneCall, type HgssOutgoingPhoneChoiceValue, type HgssOutgoingPhoneContext, type HgssOutgoingPhoneEffect } from '../../rom/phone/outgoingPhoneCalls'
import { getHgssDaycareCompatibilityMessageIndex, getHgssDaycareLevelGrowth } from '../daycare/hgssDaycare'
import { evaluateHgssPokedex } from '../pokedex/hgssDexEvaluation'
import type { HgssSessionRng } from '../pokemon/hgssSessionRng'
import { basePokemonLevelPolicy, type PokemonLevelPolicy } from '../pokemon/pokemonLevelPolicy'
import { refreshKenjiPhoneDay } from './phoneDailyState'
import { formatFieldMessage, type FieldScriptState } from '../scripts/fieldScriptRunner'
import { resolveHgssTimeOfDayByHour, resolveHgssWildTimeOfDay } from '../time/hgssRtc'

export type HgssOutgoingPhoneSession = {
  context: HgssOutgoingPhoneContext
  call: HgssOutgoingPhoneCall
}

function countDexEntries(ids: ReadonlySet<number>, predicate: (speciesId: number) => boolean): number {
  let count = 0
  for (const speciesId of ids) if (speciesId >= 1 && speciesId <= 493 && predicate(speciesId)) count += 1
  return count
}

function getEncounterSpeciesIds(entryMap: OpeningMapPreview | undefined, entryTrainerClass: number, inventory: RomInventory, now: Date): number[] {
  if (!entryMap || entryMap.header.wildEncounterBank === 0xff) return [19]
  const encounters = inventory.wildEncounterCatalog[entryMap.header.wildEncounterBank]
  if (!encounters) throw new Error(`La banque de rencontres téléphoniques ${entryMap.header.wildEncounterBank} est absente de la ROM.`)
  const wildTime = resolveHgssWildTimeOfDay(resolveHgssTimeOfDayByHour(now.getHours()))
  if (entryTrainerClass === 11) {
    const species = encounters.goodRod.map(({ speciesId }) => speciesId)
    if (wildTime === 2) species[3] = encounters.swarm.nightFishingSpeciesId
    return species
  }
  return (wildTime === 0 ? encounters.land.morning : wildTime === 1 ? encounters.land.day : encounters.land.night).map(({ speciesId }) => speciesId)
}

function createDexSummary(state: FieldScriptState, inventory: RomInventory, national: boolean) {
  const johtoNumbers = inventory.pokedexCatalog.johtoDexNumbers
  const rating = evaluateHgssPokedex(state.pokedex.caughtSpeciesIds, national, state.gender, national ? undefined : johtoNumbers)
  const included = national ? () => true : (speciesId: number) => (johtoNumbers[speciesId] ?? 0) !== 0
  return {
    seen: countDexEntries(state.pokedex.seenSpeciesIds, included),
    owned: countDexEntries(state.pokedex.caughtSpeciesIds, included),
    ratingMessageId: rating.messageId,
    complete: rating.complete,
  }
}

export function createHgssOutgoingPhoneSession(
  contactId: number,
  state: FieldScriptState,
  inventory: RomInventory,
  map: OpeningMapPreview,
  rng: HgssSessionRng,
  levelPolicy: PokemonLevelPolicy = basePokemonLevelPolicy,
): HgssOutgoingPhoneSession | undefined {
  if (!map.header.outgoingCalls) return undefined
  const entry = inventory.phoneBookEntries.find(({ id }) => id === contactId)
  if (!entry || !state.phoneContacts.has(contactId)) return undefined
  const now = state.pokemonRuntime?.now() ?? new Date()
  refreshKenjiPhoneDay(state, now, rng.lc)
  const entryMap = inventory.resolvedMapCatalog.maps.find(({ id }) => id === entry.mapId)
  const trainer = inventory.trainerCatalog[entry.trainerId]
  const currentBox = state.pokemonStorage.currentBox
  const daycareMon = (index: number) => {
    const mon = state.daycare.mons[index]
    return mon && { nickname: mon.pokemon.nickname ?? mon.pokemon.speciesName, levelGrowth: getHgssDaycareLevelGrowth(mon, inventory.pokemonCatalog, levelPolicy) }
  }
  const context: HgssOutgoingPhoneContext = {
    entry,
    currentMapId: map.id,
    gender: state.gender,
    now,
    flags: state.flags,
    variables: state.variables,
    rematchSeeking: state.phoneRematchSeeking,
    giftItems: state.phoneGiftItems,
    bugContestActive: Boolean(state.bugContest),
    badgeCount: state.badges.size,
    currentMapMomCallIntroParam: map.header.momCallIntroParam,
    bankBalance: state.bankBalance,
    momGiftQueueSize: state.momGiftItems.length,
    storageEmptySlots: state.pokemonStorage.boxes.reduce((count, box) => count + box.filter((pokemon) => pokemon === undefined).length, 0),
    storageBoxName: inventory.storageBoxNames[currentBox],
    kurtQuantity: state.kurtApricornQuantity,
    kurtBallName: inventory.itemCatalog.items[state.kurtBallId]?.name,
    kenjiActive: state.kenjiActive,
    kenjiWaitDays: state.kenjiWaitDays,
    daycare: {
      hasEgg: state.daycare.eggPersonality !== 0,
      compatibilityMessageIndex: getHgssDaycareCompatibilityMessageIndex(state.daycare, inventory.pokemonCatalog),
      mons: [daycareMon(0), daycareMon(1)],
    },
    nationalDexEnabled: state.pokedex.nationalDexEnabled,
    johtoDex: createDexSummary(state, inventory, false),
    nationalDex: createDexSummary(state, inventory, true),
    trainerPartySpeciesIds: trainer?.party.map(({ speciesId }) => speciesId),
    encounterSpeciesIds: getEncounterSpeciesIds(entryMap, entry.trainerClass, inventory, now),
    mt: rng.mt,
    lc: rng.lc,
  }
  const call = resolveHgssOutgoingPhoneCall(context)
  return call ? { context, call } : undefined
}

export function continueHgssOutgoingPhoneSession(
  session: HgssOutgoingPhoneSession,
  value: HgssOutgoingPhoneChoiceValue,
): HgssOutgoingPhoneSession | undefined {
  const call = resolveHgssOutgoingPhoneChoice(session.context, session.call, value)
  return call ? { ...session, call } : undefined
}

export function applyHgssOutgoingPhoneEffects(effects: readonly HgssOutgoingPhoneEffect[], state: FieldScriptState): void {
  for (const effect of effects) {
    if (effect.kind === 'rematch') state.phoneRematchSeeking.add(effect.contactId)
    else if (effect.kind === 'item') state.phoneGiftItems.set(effect.contactId, effect.itemId)
    else if (effect.kind === 'flag') {
      if (effect.enabled) state.flags.add(effect.flagId)
      else state.flags.delete(effect.flagId)
    } else state.kenjiActive = effect.enabled
  }
}

export function formatHgssOutgoingPhoneMessages(
  session: HgssOutgoingPhoneSession,
  state: FieldScriptState,
  inventory: RomInventory,
  currentMap: OpeningMapPreview,
): string[] {
  const contactMessages = inventory.phoneContactMessages[session.call.callerId] ?? {}
  const caller = inventory.phoneContactNames[session.call.callerId] ?? ''
  const contactMap = inventory.resolvedMapCatalog.maps.find(({ id }) => id === session.context.entry.mapId)
  const baseBuffers = new Map<number, string>([
    [0, state.playerName], [1, caller], [2, currentMap.label], [3, contactMap?.label ?? ''],
  ])
  if (session.call.wordMessageId !== undefined) baseBuffers.set(4, contactMessages[session.call.wordMessageId] ?? '')
  for (const [bufferId, speciesId] of Object.entries(session.call.bufferSpeciesIds ?? {})) {
    if (speciesId !== undefined) baseBuffers.set(Number(bufferId), inventory.pokemonCatalog.speciesNames[speciesId] ?? '')
  }
  const previousBuffers = state.buffers
  try {
    return session.call.messages.map((message) => {
      const text = message.source === 'greeting' ? inventory.phoneGreetingMessages[message.messageId] : contactMessages[message.messageId]
      if (text === undefined) throw new Error(`Le message téléphonique ROM ${message.source}/${message.messageId} du contact ${session.call.callerId} est absent.`)
      state.buffers = new Map(baseBuffers)
      for (const [bufferId, value] of Object.entries(message.buffers ?? {})) if (value !== undefined) state.buffers.set(Number(bufferId), value)
      return formatFieldMessage(text, state)
    })
  } finally {
    state.buffers = previousBuffers
  }
}

export function getHgssPhoneChoiceLabels(session: HgssOutgoingPhoneSession, inventory: RomInventory): string[] {
  const messages = inventory.phoneContactMessages[session.call.callerId] ?? {}
  const phoneUiMessages = inventory.uiMessageBanks[271] ?? {}
  const yesMessageId = session.call.choice?.kind === 'mom-saving' ? 8 : 18
  const noMessageId = session.call.choice?.kind === 'mom-saving' ? 9 : 19
  return session.call.choice?.options.map((option) => option.label
    ?? (option.value === 'yes' ? phoneUiMessages[yesMessageId] : option.value === 'no' ? phoneUiMessages[noMessageId] : undefined)
    ?? messages[option.labelMessageId ?? -1]
    ?? '') ?? []
}
