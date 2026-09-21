import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import {
  HGSS_PHONE_RING_CYCLE_FRAMES,
  HGSS_PHONE_RING_SOUND_SEQUENCE_ID,
  resolveHgssPersistentIncomingCallLaunch,
  selectHgssPersistentIncomingCall,
  type HgssPersistentIncomingCall,
  type HgssPersistentIncomingCallLaunch,
} from '../pokegear/hgssPersistentIncomingCalls'
import {
  applyHgssBaobaCall,
  resolveHgssBaobaCallTrigger,
  type HgssBaobaCallTrigger,
  type HgssSafariProgressionState,
} from './hgssSafariProgression'
import type { HgssSafariAreaId, HgssSafariState } from './hgssSafariState'

export const HGSS_BAOBA_PHONE_CONTACT_ID = 24 as const
export { HGSS_PHONE_RING_CYCLE_FRAMES, HGSS_PHONE_RING_SOUND_SEQUENCE_ID }

export type HgssSafariPhoneSlice = {
  safariZone: HgssSafariState
  safariProgression: HgssSafariProgressionState
  variables: Map<number, number>
  phoneCallTriggers: Set<number>
}

export type HgssSafariIncomingCall = {
  triggerId: 6 | 7 | 8 | 9 | 10 | 11
  call: { callerId: typeof HGSS_BAOBA_PHONE_CONTACT_ID, parameter1: 3, parameter2: number }
  forcePickUp: boolean
}

export type HgssSafariUrgentCallTriggerId = Exclude<HgssSafariIncomingCall['triggerId'], 6>

export type HgssSafariIncomingCallLaunch = HgssPersistentIncomingCallLaunch

const triggerDetails = {
  nextTest: 7,
  objectArrangement: 8,
  moreObjects: 9,
  evenMoreObjects: 10,
  memoryLoss: 11,
} as const satisfies Readonly<Record<Exclude<HgssBaobaCallTrigger, 'newPokemon'>, HgssSafariUrgentCallTriggerId>>

const safariTriggerIds = new Set<number>([6, 7, 8, 9, 10, 11])

const triggerNames = new Map<number, Exclude<HgssBaobaCallTrigger, 'newPokemon'>>(
  Object.entries(triggerDetails).map(([name, triggerId]) => [triggerId, name as Exclude<HgssBaobaCallTrigger, 'newPokemon'>]),
)

export function scheduleHgssBaobaProgressionCall(
  state: HgssSafariPhoneSlice,
  currentIgtMinutes: number,
  hasNationalDex: boolean,
): HgssSafariUrgentCallTriggerId | undefined {
  if (!state.safariProgression.baobaContactRegistered) return undefined
  if ([7, 8, 9, 10, 11].some((triggerId) => state.phoneCallTriggers.has(triggerId))) return undefined
  const trigger = resolveHgssBaobaCallTrigger(
    state.safariProgression,
    state.safariZone,
    currentIgtMinutes,
    hasNationalDex,
  )
  if (!trigger) return undefined
  const triggerId = triggerDetails[trigger]
  state.phoneCallTriggers.add(triggerId)
  return triggerId
}

export function selectHgssSafariIncomingCall(
  state: Pick<HgssSafariPhoneSlice, 'safariProgression' | 'phoneCallTriggers'>,
  rng: HgssLcrng,
  currentMapId: number,
  baobaMapId: number,
): HgssSafariIncomingCall | undefined {
  if (!state.safariProgression.baobaContactRegistered || currentMapId === baobaMapId) return undefined
  const selected = selectHgssPersistentIncomingCall({
    pendingTriggerIds: state.phoneCallTriggers,
    phoneBookEntries: [{ id: HGSS_BAOBA_PHONE_CONTACT_ID, mapId: baobaMapId }],
    currentMapId,
    rng,
    canSelectIncoming: true,
    allowedTriggerIds: safariTriggerIds,
  })
  if (!selected) return undefined
  return resolveHgssSafariIncomingCall(selected)
}

/** Adapte le résultat du tirage global au domaine Safari sans second tirage. */
export function resolveHgssSafariIncomingCall(
  incoming: HgssPersistentIncomingCall,
): HgssSafariIncomingCall | undefined {
  if (!safariTriggerIds.has(incoming.triggerId)
    || incoming.call.callerId !== HGSS_BAOBA_PHONE_CONTACT_ID) return undefined
  return incoming as HgssSafariIncomingCall
}

/**
 * Décrit le lancement natif sans consommer le flag persistant. Le trigger 6
 * ne lance pas le dialogue : il fait seulement sonner le Pokématos jusqu'à ce
 * que le joueur ouvre son app Téléphone. Les triggers 7–11 sont décrochés par
 * le script de carte spécial.
 */
export function resolveHgssSafariIncomingCallLaunch(
  incoming: HgssSafariIncomingCall,
): HgssSafariIncomingCallLaunch {
  return resolveHgssPersistentIncomingCallLaunch(incoming)
}

export function resolveHgssSafariNewPokemonCallMessage(
  progression: HgssSafariProgressionState,
  gender: 'male' | 'female',
): { messageId: number, areaIds: readonly HgssSafariAreaId[] } {
  const areaIds = progression.pendingEncounterAreaIds
  const baseMessageId = areaIds.length === 0 ? 38 : areaIds.length >= 6 ? 24 : 14 + 2 * (areaIds.length - 1)
  return {
    messageId: baseMessageId + (gender === 'female' ? 1 : 0),
    areaIds,
  }
}

/**
 * Consomme l'appel au décrochage, comme `FieldSystem_InitPokegearArgs`.
 * La donnée des zones annoncées reste sauvegardée dans HGSS ; seule une passe
 * quotidienne ultérieure la remplace. L'opération est idempotente afin qu'une
 * fermeture d'UI ne puisse jamais appliquer deux fois un déblocage de blocs.
 */
export function answerHgssSafariIncomingCall(
  state: HgssSafariPhoneSlice,
  triggerId: HgssSafariIncomingCall['triggerId'],
  currentIgtMinutes: number,
): boolean {
  if (!state.phoneCallTriggers.has(triggerId)) return false
  if (triggerId !== 6) {
    const trigger = triggerNames.get(triggerId)
    if (!trigger) throw new Error(`Le trigger d'appel Safari HGSS ${triggerId} est invalide.`)
    const applied = applyHgssBaobaCall(
      state.safariProgression,
      state.safariZone,
      trigger,
      currentIgtMinutes,
    )
    state.safariProgression = applied.progression
    state.safariZone = applied.safari
    state.variables.set(0x4057, applied.progression.baobaQuestStage)
  }
  state.phoneCallTriggers.delete(triggerId)
  return true
}

/** Compatibilité de l'hôte existant ; l'effet natif se produit au décrochage. */
export function completeHgssSafariIncomingCall(
  state: HgssSafariPhoneSlice,
  triggerId: HgssSafariIncomingCall['triggerId'],
  currentIgtMinutes: number,
): void {
  answerHgssSafariIncomingCall(state, triggerId, currentIgtMinutes)
}
