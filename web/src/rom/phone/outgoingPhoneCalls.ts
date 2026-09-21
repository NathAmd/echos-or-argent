import type { HgssLcrng } from '../../game/pokemon/hgssPokemonRng'
import type { HgssMersenneTwister } from '../../game/pokemon/hgssSessionRng'
import { resolveHgssTimeOfDayByHour, resolveHgssWildTimeOfDay } from '../../game/time/hgssRtc'
import type { HgssPhoneBookEntry } from './phoneBook'
import { hgssGenericPhoneHeaders, hgssPhoneScriptEffects, hgssPhoneScriptMessages } from './phoneNativeTables'

export type HgssOutgoingPhoneMessage = {
  source: 'greeting' | 'contact'
  messageId: number
  buffers?: Readonly<Partial<Record<number, string>>>
}

export type HgssOutgoingPhoneEffect =
  | { kind: 'rematch', contactId: number }
  | { kind: 'item', contactId: number, itemId: number }
  | { kind: 'flag', flagId: number, enabled: boolean }
  | { kind: 'kenji-active', enabled: boolean }

export type HgssOutgoingPhoneChoiceValue = 'yes' | 'no' | 'johto-dex' | 'national-dex' | 'hang-up'
export type HgssOutgoingPhoneChoice = {
  kind: 'mom-saving' | 'oak-dex' | 'gym-rematch'
  options: ReadonlyArray<{ value: HgssOutgoingPhoneChoiceValue, label?: string, labelMessageId?: number }>
  defaultIndex: number
}

export type HgssOutgoingPhoneCall = {
  callerId: number
  scriptId: number
  messages: HgssOutgoingPhoneMessage[]
  effects: HgssOutgoingPhoneEffect[]
  choice?: HgssOutgoingPhoneChoice
  wordMessageId?: number
  bufferSpeciesIds?: Readonly<Partial<Record<10 | 11, number>>>
}

export type HgssOutgoingPhoneDexSummary = {
  seen: number
  owned: number
  ratingMessageId: number
  complete: boolean
}

export type HgssOutgoingPhoneDaycareMon = { nickname: string, levelGrowth: number }

export type HgssOutgoingPhoneContext = {
  entry: HgssPhoneBookEntry
  currentMapId: number
  gender: 'male' | 'female'
  now: Date
  flags: ReadonlySet<number>
  variables: ReadonlyMap<number, number>
  rematchSeeking: ReadonlySet<number>
  giftItems: ReadonlyMap<number, number>
  bugContestActive: boolean
  badgeCount: number
  currentMapMomCallIntroParam?: number
  bankBalance?: number
  momGiftQueueSize?: number
  storageEmptySlots?: number
  storageBoxName?: string
  kurtQuantity?: number
  kurtBallName?: string
  kenjiActive?: boolean
  kenjiWaitDays?: number
  daycare?: {
    hasEgg: boolean
    compatibilityMessageIndex: number
    mons: readonly [HgssOutgoingPhoneDaycareMon | undefined, HgssOutgoingPhoneDaycareMon | undefined]
  }
  nationalDexEnabled?: boolean
  johtoDex?: HgssOutgoingPhoneDexSummary
  nationalDex?: HgssOutgoingPhoneDexSummary
  trainerPartySpeciesIds?: readonly number[]
  encounterSpeciesIds?: readonly number[]
  mt: HgssMersenneTwister
  lc: HgssLcrng
}

const beatRadioTowerRocketsFlag = 0xc6
const nationalParkMapId = 96
const rocketTakeoverVariable = 0x4077

const greetingMessageIds = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
  [72, 72, 73, 73, 74, 74, 72, 72, 73, 73, 74, 74],
  [75, 75, 76, 76, 77, 77, 75, 75, 76, 76, 77, 77],
  [24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35],
  [36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47],
  [48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59],
  [60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71],
] as const

/** Ordre exact de `GearPhoneCall_GetEthanLyraMessage`. */
const ethanLyraMapIds = [
  9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
  91, 92, 93, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41,
  42, 43, 94, 95, 44, 45, 46, 47, 48, 151, 152, 49, 50, 51, 52, 53, 54, 55,
  56, 57, 58, 59, 60, 67, 73, 74, 75, 76, 77, 78, 87, 88, 89, 90, 96, 113, 174,
] as const

function isRocketTakeover(variables: ReadonlyMap<number, number>): boolean {
  const scene = variables.get(rocketTakeoverVariable) ?? 0
  return scene >= 2 && scene <= 4
}

/** Deux sorties MTRNG, XOR, repli 16 bits puis comparaison inclusive. */
export function rollHgssPhonePercentChance(mt: HgssMersenneTwister, chance: number): boolean {
  const random = (mt.nextU32() ^ mt.nextU32()) >>> 0
  let folded = random & 0xffff
  folded = (folded ^ (random >>> 8)) & 0xffff
  return folded % 100 <= chance
}

function headerMatches(context: HgssOutgoingPhoneContext, type: number, chance: number, scriptId: number, scriptType: number): boolean {
  const beatRadioTower = context.flags.has(beatRadioTowerRocketsFlag)
  const contestConflict = context.entry.mapId === nationalParkMapId && context.bugContestActive
  if (type === 2) {
    if (context.rematchSeeking.has(context.entry.id) || context.giftItems.has(context.entry.id)) return false
    if (!beatRadioTower && scriptType === 0 && hgssPhoneScriptEffects[scriptId]?.kind === 'rematch') return false
  } else if (type === 3) {
    if (!beatRadioTower || context.now.getDay() !== context.entry.rematchWeekday) return false
    if (resolveHgssWildTimeOfDay(resolveHgssTimeOfDayByHour(context.now.getHours())) !== context.entry.rematchTimeOfDay) return false
  } else if (type === 4) {
    if (![2, 4, 6].includes(context.now.getDay())) return false
  } else if (type === 5) {
    if (!isRocketTakeover(context.variables)) return false
  } else if (type === 7) {
    if (!beatRadioTower || contestConflict || !context.rematchSeeking.has(context.entry.id)) return false
  } else if (type === 8) {
    if (contestConflict || !context.giftItems.has(context.entry.id)) return false
  }
  return rollHgssPhonePercentChance(context.mt, chance)
}

function selectGenericScript(context: HgssOutgoingPhoneContext): { scriptId: number, scriptType: number } | undefined {
  if (context.entry.mapId === context.currentMapId) return { scriptId: context.entry.localScriptId, scriptType: 0 }
  const offset = context.entry.id * 16
  for (let index = 0; index < 8; index += 1) {
    const header = hgssGenericPhoneHeaders[offset + index]
    if (!header) return undefined
    const [type, chance, scriptType, scriptId] = header
    if (type === 0 || type === 255) break
    if (headerMatches(context, type, chance, scriptId, scriptType)) return { scriptId, scriptType }
  }
  return undefined
}

function getScriptMessageId(context: HgssOutgoingPhoneContext, scriptId: number, scriptType: number): number | undefined {
  const pair = hgssPhoneScriptMessages[scriptId]
  if (!pair) return undefined
  const genderIndex = context.gender === 'male' ? 0 : 1
  if (scriptType === 0) return pair[genderIndex]
  const randomOffset = context.lc.nextU16() % 11
  return pair[0] === pair[1] ? pair[0] + randomOffset : pair[genderIndex] + randomOffset * 2 + genderIndex
}

function getScriptMetadata(context: HgssOutgoingPhoneContext, scriptId: number): Pick<HgssOutgoingPhoneCall, 'effects' | 'wordMessageId'> {
  const definition = hgssPhoneScriptEffects[scriptId]
  if (!definition) return { effects: [] }
  if (definition.kind === 'rematch') return { effects: [{ kind: 'rematch', contactId: context.entry.id }] }
  if (definition.kind === 'flag') return { effects: [{ kind: 'flag', flagId: definition.param1, enabled: definition.param0 !== 0 }] }
  if (definition.kind === 'word') return { effects: [], wordMessageId: definition.param1 + context.lc.nextU16() % definition.param0 }
  let itemId = definition.param1
  if (itemId === 149) itemId += context.mt.nextU32() % 10
  else if (itemId === 4) itemId = 2 + context.mt.nextU32() % 3
  return { effects: [{ kind: 'item', contactId: context.entry.id, itemId }] }
}

function callFromScript(context: HgssOutgoingPhoneContext, scriptId: number): HgssOutgoingPhoneCall | undefined {
  const metadata = getScriptMetadata(context, scriptId)
  const messageId = getScriptMessageId(context, scriptId, 0)
  if (messageId === undefined) return undefined
  return { callerId: context.entry.id, scriptId, messages: [{ source: 'contact', messageId }], ...metadata }
}

function getGreetingMessage(context: HgssOutgoingPhoneContext): HgssOutgoingPhoneMessage | undefined {
  if (context.entry.unknownC === 0xff) return undefined
  const messages = greetingMessageIds[context.entry.unknownC]
  if (!messages) return undefined
  const wildTime = resolveHgssWildTimeOfDay(resolveHgssTimeOfDayByHour(context.now.getHours()))
  return { source: 'greeting', messageId: messages[wildTime * 2 + (context.gender === 'male' ? 0 : 1)] }
}

function chooseSpecies(context: HgssOutgoingPhoneContext, values: readonly number[] | undefined): number | undefined {
  if (!values?.length) return undefined
  return values[context.lc.nextU16() % values.length]
}

/** Résolution exacte des contacts `PHONECALLTYPE_GENERIC` (type 0). */
export function resolveHgssGenericOutgoingPhoneCall(context: HgssOutgoingPhoneContext): HgssOutgoingPhoneCall | undefined {
  if (context.entry.type !== 0) return undefined
  const selected = selectGenericScript(context)
  if (!selected) return undefined
  const metadata = getScriptMetadata(context, selected.scriptId)
  const bufferSpeciesIds = selected.scriptType === 0 ? {
    10: chooseSpecies(context, context.trainerPartySpeciesIds),
    11: chooseSpecies(context, context.encounterSpeciesIds),
  } : undefined
  const messageId = getScriptMessageId(context, selected.scriptId, selected.scriptType)
  if (messageId === undefined) return undefined
  return {
    callerId: context.entry.id,
    scriptId: selected.scriptId,
    messages: [getGreetingMessage(context), { source: 'contact', messageId }].filter((message): message is HgssOutgoingPhoneMessage => Boolean(message)),
    ...metadata,
    bufferSpeciesIds,
  }
}

function resolveMotherCall(context: HgssOutgoingPhoneContext): HgssOutgoingPhoneCall | undefined {
  if (context.entry.mapId === context.currentMapId) return callFromScript(context, 23)
  if (!context.flags.has(0x79)) return callFromScript(context, 25)
  if (!context.flags.has(0xa7)) return callFromScript(context, 26)
  const intro = 7 + (context.currentMapMomCallIntroParam ?? 0)
  if ((context.momGiftQueueSize ?? 0) >= 5) return { callerId: context.entry.id, scriptId: 0, messages: [{ source: 'contact', messageId: intro }, { source: 'contact', messageId: 21 }], effects: [] }
  const saving = context.flags.has(0x986)
  const prompt = saving ? (context.bankBalance ?? 0) !== 0 ? 23 : 27 : (context.bankBalance ?? 0) !== 0 ? 24 : 28
  return {
    callerId: context.entry.id,
    scriptId: 0,
    messages: [{ source: 'contact', messageId: intro }, { source: 'contact', messageId: prompt, buffers: { 10: String(context.bankBalance ?? 0) } }],
    effects: [],
    choice: { kind: 'mom-saving', options: [{ value: 'yes' }, { value: 'no' }], defaultIndex: 0 },
  }
}

function resolveElmCall(context: HgssOutgoingPhoneContext): HgssOutgoingPhoneCall | undefined {
  let scriptId = 1
  if (context.entry.mapId !== context.currentMapId) {
    if (!context.flags.has(0xee)) scriptId = 8
    else if (!context.flags.has(0x79)) scriptId = 9
    else if (!context.flags.has(0x9f)) scriptId = 10
    else if (!context.flags.has(0x70)) scriptId = 11
    else if (context.badgeCount < 7) scriptId = !context.flags.has(0x983) ? 12 : context.flags.has(0x11a) ? 14 + context.lc.nextU16() % 2 : 13
    else if (isRocketTakeover(context.variables)) scriptId = 16
    else if (context.badgeCount < 8) scriptId = 17
    else if (!context.flags.has(0x964)) scriptId = 18
    else if (!context.flags.has(0xf2)) scriptId = 19
    else if (!context.flags.has(0x11a)) scriptId = context.flags.has(0x983) ? 13 : 12
    else scriptId = 20 + context.lc.nextU16() % (context.flags.has(0x65) ? 3 : 2)
  }
  return callFromScript(context, scriptId)
}

function resolveOakCall(context: HgssOutgoingPhoneContext): HgssOutgoingPhoneCall | undefined {
  if (context.entry.mapId === context.currentMapId) return callFromScript(context, 68)
  if (context.flags.has(0x988)) return callFromScript(context, 81)
  if (!context.nationalDexEnabled && context.flags.has(0x987)) return callFromScript(context, 80)
  const options = context.nationalDexEnabled
    ? context.flags.has(0x987)
      ? [{ value: 'national-dex', labelMessageId: 19 }, { value: 'hang-up', labelMessageId: 16 }]
      : [{ value: 'johto-dex', labelMessageId: 18 }, { value: 'national-dex', labelMessageId: 19 }, { value: 'hang-up', labelMessageId: 16 }]
    : [{ value: 'johto-dex', labelMessageId: 17 }, { value: 'hang-up', labelMessageId: 16 }]
  return {
    callerId: context.entry.id,
    scriptId: 0,
    messages: [{ source: 'contact', messageId: context.gender === 'male' ? 13 : 14 }, { source: 'contact', messageId: 15 }],
    effects: [],
    choice: { kind: 'oak-dex', options: options as HgssOutgoingPhoneChoice['options'], defaultIndex: 0 },
  }
}

function resolveKurtCall(context: HgssOutgoingPhoneContext): HgssOutgoingPhoneCall | undefined {
  if (context.entry.mapId === context.currentMapId) return callFromScript(context, 83)
  const first = context.flags.has(0x127) ? 6 : 2
  const second = (context.kurtQuantity ?? 0) === 0 ? 5 : context.flags.has(0xaa2) ? 4 : 3
  const buffers = { 10: context.kurtBallName ?? '', 11: String(context.kurtQuantity ?? 0) }
  return { callerId: context.entry.id, scriptId: 0, messages: [{ source: 'contact', messageId: first }, { source: 'contact', messageId: second, buffers }], effects: [] }
}

function resolveKenjiCall(context: HgssOutgoingPhoneContext): HgssOutgoingPhoneCall | undefined {
  if (context.entry.mapId === context.currentMapId) return callFromScript(context, 86)
  const waitDays = context.kenjiWaitDays ?? 0
  if (waitDays > 1) return callFromScript(context, 87)
  if (waitDays === 1) return callFromScript(context, 88)
  if (context.kenjiActive && !context.rematchSeeking.has(16)) return callFromScript(context, 87)
  const rtcTime = resolveHgssTimeOfDayByHour(context.now.getHours())
  if (rtcTime === 2 || rtcTime === 3) return callFromScript(context, 91)
  const call = callFromScript(context, resolveHgssWildTimeOfDay(rtcTime) === 1 ? 90 : 89)
  if (call && !context.kenjiActive) call.effects.push({ kind: 'kenji-active', enabled: true }, { kind: 'rematch', contactId: 16 })
  return call
}

function resolveBillCall(context: HgssOutgoingPhoneContext): HgssOutgoingPhoneCall | undefined {
  if (context.entry.mapId === context.currentMapId) return callFromScript(context, 92)
  const count = context.storageEmptySlots ?? 0
  const status = count === 0 ? 9 : 5 + context.lc.nextU16() % 3
  const buffers = { 10: context.storageBoxName ?? '', 11: String(count) }
  return {
    callerId: context.entry.id,
    scriptId: 0,
    messages: [getGreetingMessage(context), { source: 'contact', messageId: context.gender === 'male' ? 3 : 4 }, { source: 'contact', messageId: status, buffers }, { source: 'contact', messageId: 8 }].filter((message): message is HgssOutgoingPhoneMessage => Boolean(message)),
    effects: [],
  }
}

function resolveDaycareManCall(context: HgssOutgoingPhoneContext): HgssOutgoingPhoneCall {
  const daycare = context.daycare
  const mons = daycare?.mons.filter((entry): entry is HgssOutgoingPhoneDaycareMon => Boolean(entry)) ?? []
  const buffers = Object.fromEntries(mons.map((mon, index) => [10 + index, mon.nickname]))
  const messages: HgssOutgoingPhoneMessage[] = [{ source: 'contact', messageId: 2 }]
  if (daycare?.hasEgg) messages.push({ source: 'contact', messageId: 3 })
  else if (mons.length === 0) messages.push({ source: 'contact', messageId: 4 }, { source: 'contact', messageId: 11 })
  else if (mons.length === 1) messages.push({ source: 'contact', messageId: 5, buffers }, { source: 'contact', messageId: 11 })
  else messages.push({ source: 'contact', messageId: 6, buffers }, { source: 'contact', messageId: 7 + (daycare?.compatibilityMessageIndex ?? 3), buffers }, { source: 'contact', messageId: 11 })
  return { callerId: context.entry.id, scriptId: 0, messages, effects: [] }
}

function resolveDaycareLadyCall(context: HgssOutgoingPhoneContext): HgssOutgoingPhoneCall | undefined {
  if (context.entry.mapId === context.currentMapId) return callFromScript(context, 97)
  const mons = context.daycare?.mons ?? [undefined, undefined]
  const present = mons.filter(Boolean).length
  const messages: HgssOutgoingPhoneMessage[] = [{ source: 'contact', messageId: context.gender === 'male' ? 3 : 4 }]
  if (present === 0) messages.push({ source: 'contact', messageId: 10 })
  else {
    messages.push({ source: 'contact', messageId: 5 })
    for (const mon of mons) if (mon && mon.levelGrowth !== 0) messages.push({ source: 'contact', messageId: 6, buffers: { 10: mon.nickname, 11: String(mon.levelGrowth) } })
    messages.push({ source: 'contact', messageId: present === 1 ? 8 : 9 })
  }
  return { callerId: context.entry.id, scriptId: 0, messages, effects: [] }
}

function isBuenasPasswordOnAir(hour: number): boolean {
  return hour % 3 === 2
}

function resolveBuenaCall(context: HgssOutgoingPhoneContext): HgssOutgoingPhoneCall | undefined {
  if (isRocketTakeover(context.variables)) return callFromScript(context, 99)
  if (isBuenasPasswordOnAir(context.now.getHours())) return callFromScript(context, 100)
  if (context.entry.mapId === context.currentMapId) return callFromScript(context, 98)
  const time = resolveHgssWildTimeOfDay(resolveHgssTimeOfDayByHour(context.now.getHours()))
  const range = 11 + (context.flags.has(0x964) ? 3 : 0)
  const random = context.lc.nextU16() % range
  const second = random === 13 ? (context.gender === 'male' ? 34 : 35) : 21 + random
  return { callerId: context.entry.id, scriptId: 0, messages: [{ source: 'contact', messageId: 15 + time * 2 + (context.gender === 'male' ? 0 : 1) }, { source: 'contact', messageId: second }], effects: [] }
}

function resolveEthanLyraCall(context: HgssOutgoingPhoneContext): HgssOutgoingPhoneCall | undefined {
  if (context.entry.mapId === context.currentMapId) return callFromScript(context, context.gender === 'male' ? 102 : 101)
  const time = resolveHgssWildTimeOfDay(resolveHgssTimeOfDayByHour(context.now.getHours()))
  const index = ethanLyraMapIds.indexOf(context.currentMapId as typeof ethanLyraMapIds[number])
  const locationMessage = index >= 0 ? 13 + index : 10 + context.lc.nextU16() % 3
  return { callerId: context.entry.id, scriptId: 0, messages: [{ source: 'contact', messageId: 4 + time }, { source: 'contact', messageId: locationMessage }], effects: [] }
}

function resolveGymLeaderCall(context: HgssOutgoingPhoneContext): HgssOutgoingPhoneCall {
  const messages: HgssOutgoingPhoneMessage[] = [{ source: 'contact', messageId: context.entry.mapId === context.currentMapId ? 1 : 2 }]
  if (context.entry.mapId === context.currentMapId) return { callerId: context.entry.id, scriptId: 0, messages, effects: [] }
  if (context.badgeCount < 16) messages.push({ source: 'contact', messageId: 3 })
  else if (context.rematchSeeking.has(context.entry.id)) messages.push({ source: 'contact', messageId: 9 })
  else if (context.now.getDay() !== context.entry.rematchWeekday || resolveHgssWildTimeOfDay(resolveHgssTimeOfDayByHour(context.now.getHours())) !== context.entry.rematchTimeOfDay) messages.push({ source: 'contact', messageId: 4 })
  else return { callerId: context.entry.id, scriptId: 0, messages: [...messages, { source: 'contact', messageId: 5 }], effects: [], choice: { kind: 'gym-rematch', options: [{ value: 'yes' }, { value: 'no' }], defaultIndex: 0 } }
  return { callerId: context.entry.id, scriptId: 0, messages, effects: [] }
}

/** Branches sortantes des quinze types réellement présents dans pmtel_book.dat. */
export function resolveHgssOutgoingPhoneCall(context: HgssOutgoingPhoneContext): HgssOutgoingPhoneCall | undefined {
  switch (context.entry.type) {
  case 0: return resolveHgssGenericOutgoingPhoneCall(context)
  case 1: return resolveMotherCall(context)
  case 2: return resolveElmCall(context)
  case 3: return resolveOakCall(context)
  case 4: return resolveKurtCall(context)
  case 5: return callFromScript(context, context.entry.mapId === context.currentMapId ? 84 : 85)
  case 6: return resolveKenjiCall(context)
  case 7: return resolveBillCall(context)
  case 8: return resolveDaycareManCall(context)
  case 9: return resolveDaycareLadyCall(context)
  case 10: return resolveBuenaCall(context)
  case 11: return resolveEthanLyraCall(context)
  case 12: return resolveGymLeaderCall(context)
  case 13: return callFromScript(context, context.entry.mapId === context.currentMapId ? 140 : (context.variables.get(0x4057) ?? 0) + 147)
  case 14: return callFromScript(context, isRocketTakeover(context.variables) ? 156 : 172 + context.lc.nextU16() % 3)
  default: return undefined
  }
}

/** Continuation pure des trois menus téléphoniques interactifs natifs. */
export function resolveHgssOutgoingPhoneChoice(
  context: HgssOutgoingPhoneContext,
  call: HgssOutgoingPhoneCall,
  value: HgssOutgoingPhoneChoiceValue,
): HgssOutgoingPhoneCall | undefined {
  if (!call.choice) return undefined
  if (call.choice.kind === 'mom-saving') {
    const enabled = value === 'yes'
    return { callerId: call.callerId, scriptId: 0, messages: [{ source: 'contact', messageId: enabled ? 25 : 26 }], effects: [{ kind: 'flag', flagId: 0x986, enabled }] }
  }
  if (call.choice.kind === 'gym-rematch') {
    if (value !== 'yes') return { callerId: call.callerId, scriptId: 0, messages: [{ source: 'contact', messageId: 7 }], effects: [] }
    return { callerId: call.callerId, scriptId: 0, messages: [{ source: 'contact', messageId: 6 }], effects: [{ kind: 'rematch', contactId: call.callerId }] }
  }
  if (value === 'hang-up') return { callerId: call.callerId, scriptId: 0, messages: [{ source: 'contact', messageId: 21 }], effects: [] }
  const summary = value === 'national-dex' ? context.nationalDex : context.johtoDex
  if (!summary) return undefined
  const effects: HgssOutgoingPhoneEffect[] = summary.complete
    ? [{ kind: 'flag', flagId: value === 'national-dex' ? 0x988 : 0x987, enabled: true }]
    : []
  const messages: HgssOutgoingPhoneMessage[] = [
    { source: 'contact', messageId: 20, buffers: { 5: String(summary.seen), 6: String(summary.owned) } },
    { source: 'contact', messageId: summary.ratingMessageId },
  ]
  if (!summary.complete) messages.push({ source: 'contact', messageId: 21 })
  return { callerId: call.callerId, scriptId: 0, messages, effects }
}
