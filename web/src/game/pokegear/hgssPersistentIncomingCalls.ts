import type { HgssPendingPhoneCall } from '../../rom/phone/phoneCalls'
import type { HgssLcrng } from '../pokemon/hgssPokemonRng'

export const HGSS_PERSISTENT_PHONE_CALL_TRIGGER_COUNT = 13 as const
export const HGSS_PROF_OAK_PHONE_CONTACT_ID = 2 as const
export const HGSS_DAY_C_MAN_PHONE_CONTACT_ID = 6 as const
export const HGSS_BILL_PHONE_CONTACT_ID = 9 as const
export const HGSS_BILL_PC_FULL_CALL_TRIGGER_ID = 3 as const
export const HGSS_OAK_DEX_PROGRESS_CALL_TRIGGER_ID = 4 as const
/** `SEQ_SE_GS_PHONE1` dans la table sonore HGSS. */
export const HGSS_PHONE_RING_SOUND_SEQUENCE_ID = 2169 as const
/** Le task natif remet son compteur de sonnerie à zéro toutes les 30 frames. */
export const HGSS_PHONE_RING_CYCLE_FRAMES = 30 as const

/** Table native `ov02_02253C84`, dans l'ordre exact des flags persistants. */
export const hgssPersistentIncomingCallTable = [
  { triggerId: 0, callerId: 1, phoneScriptId: 13, forcePickUp: false },
  { triggerId: 1, callerId: 1, phoneScriptId: 7, forcePickUp: false },
  { triggerId: 2, callerId: 15, phoneScriptId: 85, forcePickUp: true },
  { triggerId: HGSS_BILL_PC_FULL_CALL_TRIGGER_ID, callerId: HGSS_BILL_PHONE_CONTACT_ID, phoneScriptId: 93, forcePickUp: true },
  { triggerId: HGSS_OAK_DEX_PROGRESS_CALL_TRIGGER_ID, callerId: HGSS_PROF_OAK_PHONE_CONTACT_ID, phoneScriptId: 0, forcePickUp: false },
  { triggerId: 5, callerId: HGSS_DAY_C_MAN_PHONE_CONTACT_ID, phoneScriptId: 0, forcePickUp: false },
  { triggerId: 6, callerId: 24, phoneScriptId: 0, forcePickUp: false },
  { triggerId: 7, callerId: 24, phoneScriptId: 142, forcePickUp: true },
  { triggerId: 8, callerId: 24, phoneScriptId: 143, forcePickUp: true },
  { triggerId: 9, callerId: 24, phoneScriptId: 144, forcePickUp: true },
  { triggerId: 10, callerId: 24, phoneScriptId: 145, forcePickUp: true },
  { triggerId: 11, callerId: 24, phoneScriptId: 146, forcePickUp: true },
  { triggerId: 12, callerId: 0, phoneScriptId: 27, forcePickUp: false },
] as const

export type HgssPersistentPhoneCallTriggerId = typeof hgssPersistentIncomingCallTable[number]['triggerId']

export type HgssPersistentIncomingCall = {
  triggerId: HgssPersistentPhoneCallTriggerId
  call: HgssPendingPhoneCall
  forcePickUp: boolean
}

export type HgssPersistentIncomingCallLaunch =
  | {
      kind: 'ringing'
      /** HGSS attend que le joueur ouvre l'app Téléphone du Pokématos. */
      answerAction: 'openPokegearPhone'
      soundSequenceId: typeof HGSS_PHONE_RING_SOUND_SEQUENCE_ID
      soundCycleFrames: typeof HGSS_PHONE_RING_CYCLE_FRAMES
    }
  | {
      kind: 'forcePickUp'
    }

export type HgssPersistentIncomingCallPhoneBookEntry = {
  id: number
  mapId: number
}

export type HgssPersistentIncomingCallSelection = {
  pendingTriggerIds: ReadonlySet<number>
  phoneBookEntries: readonly HgssPersistentIncomingCallPhoneBookEntry[]
  currentMapId: number
  rng: HgssLcrng
  /** Équivalent du test global `unk_var8 >= unk_varC` et de l'absence d'appel actif. */
  canSelectIncoming: boolean | (() => boolean)
  /** Sous-ensemble de domaines optionnel ; le sélecteur global omet ce filtre. */
  allowedTriggerIds?: ReadonlySet<number>
  registeredContactIds?: ReadonlySet<number>
  isContactRegistered?: (contactId: number) => boolean
}

function requireMapId(value: number): void {
  if (!Number.isInteger(value) || value < 0) throw new Error(`La carte d'appel Pokématos ${value} est invalide.`)
}

function gateIsOpen(gate: HgssPersistentIncomingCallSelection['canSelectIncoming']): boolean {
  return typeof gate === 'function' ? gate() : gate
}

function isDayCManRegistered(options: HgssPersistentIncomingCallSelection): boolean {
  return options.isContactRegistered?.(HGSS_DAY_C_MAN_PHONE_CONTACT_ID)
    ?? options.registeredContactIds?.has(HGSS_DAY_C_MAN_PHONE_CONTACT_ID)
    ?? false
}

/**
 * Port de `ov02_02252218`: filtre tous les flags admissibles, puis consomme
 * exactement un `LCRandom()` pour choisir uniformément le trigger à présenter.
 */
export function selectHgssPersistentIncomingCall(
  options: HgssPersistentIncomingCallSelection,
): HgssPersistentIncomingCall | undefined {
  requireMapId(options.currentMapId)
  if (!gateIsOpen(options.canSelectIncoming)) return undefined

  const eligible = hgssPersistentIncomingCallTable.filter((entry) => {
    if (!options.pendingTriggerIds.has(entry.triggerId)
      || options.allowedTriggerIds && !options.allowedTriggerIds.has(entry.triggerId)) return false
    const phoneBookEntry = options.phoneBookEntries.find(({ id }) => id === entry.callerId)
    if (!phoneBookEntry) throw new Error(`Le contact ROM ${entry.callerId} du trigger ${entry.triggerId} est absent.`)
    if (phoneBookEntry.id === HGSS_DAY_C_MAN_PHONE_CONTACT_ID) return isDayCManRegistered(options)
    return phoneBookEntry.mapId !== options.currentMapId
  })
  if (eligible.length === 0) return undefined

  const selected = eligible[options.rng.nextU16() % eligible.length]!
  return {
    triggerId: selected.triggerId,
    call: { callerId: selected.callerId, parameter1: 3, parameter2: selected.phoneScriptId },
    forcePickUp: selected.forcePickUp,
  }
}

/**
 * Décrit le lancement commun de tout trigger persistant type 3. La décision
 * dépend uniquement du bit `forcePickUp` de la table native, jamais du caller.
 */
export function resolveHgssPersistentIncomingCallLaunch(
  incoming: HgssPersistentIncomingCall,
): HgssPersistentIncomingCallLaunch {
  if (incoming.forcePickUp) return { kind: 'forcePickUp' }
  return {
    kind: 'ringing',
    answerAction: 'openPokegearPhone',
    soundSequenceId: HGSS_PHONE_RING_SOUND_SEQUENCE_ID,
    soundCycleFrames: HGSS_PHONE_RING_CYCLE_FRAMES,
  }
}

/** Le trigger type 3 est effacé au décrochage; `Set.delete` rend l'opération idempotente. */
export function consumeHgssPersistentIncomingCall(
  pendingTriggerIds: Set<number>,
  triggerId: HgssPersistentPhoneCallTriggerId,
): boolean {
  return pendingTriggerIds.delete(triggerId)
}
