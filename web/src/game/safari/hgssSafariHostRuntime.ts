import type { RomInventory } from '../../ndsTypes'
import { resolveHgssScriptedPhoneMessage } from '../../rom/phone/phoneCalls'
import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import type { FieldScriptState } from '../scripts/fieldScriptRunner'
import { createHgssSafariMorningEncounterSignature } from './hgssSafariEncounters'
import { refreshHgssSafariForCurrentDay } from './hgssSafariDailyRuntime'
import { synchronizeHgssSafariQuestState } from './hgssSafariFieldRuntime'
import {
  completeHgssSafariIncomingCall,
  resolveHgssSafariNewPokemonCallMessage,
  scheduleHgssBaobaProgressionCall,
  selectHgssSafariIncomingCall,
  type HgssSafariIncomingCall,
  type HgssSafariUrgentCallTriggerId,
} from './hgssSafariPhoneRuntime'

type SafariHostInventory = Pick<
  RomInventory,
  'phoneBookEntries' | 'phoneContactMessages' | 'phoneContactNames' | 'safariEncounterCatalog' | 'uiMessageBanks'
>

export type HgssSafariIncomingCallPresentation = {
  incoming: HgssSafariIncomingCall
  callerName: string
  message: string
  buffers: ReadonlyMap<number, string>
}

export type HgssSafariHostStepOptions = {
  state: FieldScriptState
  inventory: SafariHostInventory
  rng: HgssLcrng
  now: Date
  currentIgtMinutes: number
  currentMapId: number
  incomingCallsEnabled: boolean
  playerGender: 'male' | 'female'
  /** Pénalité anti-changement d'horloge de `FieldSystem_HasPenalty`. */
  rtcPenalty?: boolean
  /** Garde globale `unk_var8 >= unk_varC`; absente pour les anciens hôtes. */
  canSelectIncoming?: () => boolean
  /** Permet au gestionnaire global de reproduire `sub_02092E14(..., TRUE)`. */
  onUrgentTriggerScheduled?: (triggerId: HgssSafariUrgentCallTriggerId) => void
}

export type HgssSafariHostUpdateOptions = Pick<
  HgssSafariHostStepOptions,
  'state' | 'inventory' | 'now' | 'currentIgtMinutes' | 'rtcPenalty' | 'onUrgentTriggerScheduled'
>

export type HgssSafariIncomingCallPresentationOptions = Pick<
  HgssSafariHostStepOptions,
  'state' | 'inventory' | 'playerGender'
>

function requireMessage(value: string | undefined, label: string): string {
  if (value === undefined) throw new Error(`${label} est absent de la ROM.`)
  return value
}

/** Met à jour les tâches Safari de pas sans sélectionner ni présenter d'appel. */
export function updateHgssSafariHostStep(
  options: HgssSafariHostUpdateOptions,
): HgssSafariUrgentCallTriggerId | undefined {
  const { state, inventory } = options
  synchronizeHgssSafariQuestState(state)
  refreshHgssSafariForCurrentDay(state, options.now, (areaSet, areaSlot) => (
    createHgssSafariMorningEncounterSignature(inventory.safariEncounterCatalog, areaSet, areaSlot)
  ), options.rtcPenalty)
  const scheduledTriggerId = scheduleHgssBaobaProgressionCall(
    state,
    options.currentIgtMinutes,
    state.pokedex.nationalDexEnabled,
  )
  if (scheduledTriggerId !== undefined) options.onUrgentTriggerScheduled?.(scheduledTriggerId)
  return scheduledTriggerId
}

/** Résout uniquement les textes et buffers ROM d'un appel Safari déjà tiré. */
export function prepareHgssSafariIncomingCallPresentation(
  options: HgssSafariIncomingCallPresentationOptions,
  incoming: HgssSafariIncomingCall,
): HgssSafariIncomingCallPresentation {
  const { state, inventory } = options
  const callerName = requireMessage(inventory.phoneContactNames[incoming.call.callerId], 'Le nom ROM de Baoba')
  if (incoming.triggerId === 6) {
    const resolved = resolveHgssSafariNewPokemonCallMessage(state.safariProgression, options.playerGender)
    const message = requireMessage(inventory.phoneContactMessages[incoming.call.callerId]?.[resolved.messageId], `Le message Safari ${resolved.messageId}`)
    const areaMessages = inventory.uiMessageBanks[428]
    const buffers = new Map(resolved.areaIds.map((areaId, index) => [
      10 + index,
      requireMessage(areaMessages?.[areaId], `Le nom de zone Safari ${areaId}`),
    ]))
    return { incoming, callerName, message, buffers }
  }

  const resolved = resolveHgssScriptedPhoneMessage(incoming.call, options.playerGender)
  if (!resolved) throw new Error(`L'appel Safari ROM ${incoming.triggerId} n'est pas résolu.`)
  const message = requireMessage(inventory.phoneContactMessages[resolved.callerId]?.[resolved.messageId], `Le message Safari ${resolved.messageId}`)
  return { incoming, callerName, message, buffers: new Map() }
}

/**
 * API historique : compose la mise à jour, la garde, le tirage Safari puis la
 * préparation. Les hôtes à tirage global utilisent les deux fonctions ci-dessus.
 */
export function advanceHgssSafariHostStep(
  options: HgssSafariHostStepOptions,
): HgssSafariIncomingCallPresentation | undefined {
  updateHgssSafariHostStep(options)
  if (!options.incomingCallsEnabled) return undefined
  if (options.canSelectIncoming && !options.canSelectIncoming()) return undefined
  const { state, inventory } = options
  const baobaMapId = inventory.phoneBookEntries.find(({ id }) => id === 24)?.mapId
  if (baobaMapId === undefined) throw new Error('La carte ROM du contact Baoba est absente.')
  const incoming = selectHgssSafariIncomingCall(state, options.rng, options.currentMapId, baobaMapId)
  if (!incoming) return undefined
  return prepareHgssSafariIncomingCallPresentation(options, incoming)
}

export function finishHgssSafariHostCall(
  state: FieldScriptState,
  presentation: HgssSafariIncomingCallPresentation,
  currentIgtMinutes: number,
): void {
  completeHgssSafariIncomingCall(state, presentation.incoming.triggerId, currentIgtMinutes)
  state.pendingPhoneCall = undefined
}
