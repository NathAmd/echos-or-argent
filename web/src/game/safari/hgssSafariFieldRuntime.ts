import {
  cloneHgssSafariState,
  createHgssSafariState,
  startHgssSafariSession,
  type HgssSafariState,
} from './hgssSafariState'
import {
  createHgssSafariProgressionState,
  finishHgssSafariSession,
  isHgssSafariChallengeComplete,
  recordHgssSafariIgtReference,
  registerHgssBaobaContact,
  setHgssBaobaQuestStage,
  type HgssSafariChallengeIndex,
  type HgssSafariChallengePokemon,
  type HgssSafariProgressionState,
} from './hgssSafariProgression'
import type { HgssSafariEncounterCatalog } from '../../rom/safari/safariEncounterData'
import { createHgssSafariMorningEncounterSignature } from './hgssSafariEncounters'
import { publishHgssSafariEncounterChanges } from './hgssSafariDailyRuntime'
import { HGSS_SAFARI_SYSTEM_FLAG } from '../scripts/hgssFieldSystemFlags'

export const hgssSafariQuestStageVariable = 0x4057
export const hgssBaobaPhoneContactId = 24
/** Alias public conservé pour les consommateurs Safari. */
export const hgssSafariSystemFlag = HGSS_SAFARI_SYSTEM_FLAG

export type HgssSafariFieldSlice = {
  safariZone: HgssSafariState
  safariProgression: HgssSafariProgressionState
}

type HgssSafariScriptSlice = HgssSafariFieldSlice & {
  variables: Map<number, number>
  phoneContacts: Set<number>
  party: { members: readonly HgssSafariChallengePokemon[] }
  pokemonRuntime?: {
    trainer: { id: number }
    igtMinutes?: () => number
    safariEncounterCatalog?: HgssSafariEncounterCatalog
  }
  phoneCallTriggers: Set<number>
}

export function createHgssSafariFieldSlice(initialRandomValue: number): HgssSafariFieldSlice {
  return {
    safariZone: createHgssSafariState(initialRandomValue),
    safariProgression: createHgssSafariProgressionState(),
  }
}

export function cloneHgssSafariFieldSlice(state: HgssSafariFieldSlice): HgssSafariFieldSlice {
  return {
    safariZone: cloneHgssSafariState(state.safariZone),
    safariProgression: {
      ...state.safariProgression,
      pendingEncounterAreaIds: [...state.safariProgression.pendingEncounterAreaIds],
    },
  }
}

/**
 * Réconcilie le miroir structuré Safari avec les deux données natives qui font
 * autorité pour les scripts : VAR_UNK_4057 et le carnet du Pokématos.
 *
 * Les premières versions du port pouvaient sauvegarder ou projeter un seul des
 * deux côtés. Sans cette frontière, le dialogue de Baoba lisait la variable ROM
 * tandis que l'hôte des appels lisait une ancienne copie et la quête restait
 * silencieusement bloquée.
 */
export function synchronizeHgssSafariQuestState(
  state: Pick<HgssSafariScriptSlice, 'variables' | 'phoneContacts' | 'safariProgression'>,
): void {
  const nativeStage = state.variables.get(hgssSafariQuestStageVariable)
  if (nativeStage !== undefined && nativeStage !== state.safariProgression.baobaQuestStage) {
    state.safariProgression = setHgssBaobaQuestStage(state.safariProgression, nativeStage)
  } else if (nativeStage === undefined && state.safariProgression.baobaQuestStage !== 0) {
    state.variables.set(hgssSafariQuestStageVariable, state.safariProgression.baobaQuestStage)
  }

  const nativeContactRegistered = state.phoneContacts.has(hgssBaobaPhoneContactId)
  if (nativeContactRegistered && !state.safariProgression.baobaContactRegistered) {
    state.safariProgression = registerHgssBaobaContact(state.safariProgression)
  } else if (!nativeContactRegistered && state.safariProgression.baobaContactRegistered) {
    state.phoneContacts.add(hgssBaobaPhoneContactId)
  }
}

export function writeHgssSafariScriptVariable(
  state: Pick<HgssSafariScriptSlice, 'variables' | 'safariProgression'>,
  variableId: number,
  value: number,
): void {
  state.variables.set(variableId, value)
  if (variableId === hgssSafariQuestStageVariable) {
    state.safariProgression = setHgssBaobaQuestStage(state.safariProgression, value)
  }
}

export function registerHgssSafariPhoneContact(
  state: Pick<HgssSafariScriptSlice, 'safariProgression'>,
  contactId: number,
): void {
  if (contactId === hgssBaobaPhoneContactId) {
    state.safariProgression = registerHgssBaobaContact(state.safariProgression)
  }
}

export function applyHgssSafariZoneAction(
  state: Pick<HgssSafariScriptSlice, 'safariZone' | 'safariProgression' | 'pokemonRuntime' | 'phoneCallTriggers'> & { flags: Set<number> },
  action: number,
  areaSet: number,
): void {
  if (action === 0) {
    state.safariZone = startHgssSafariSession(state.safariZone, areaSet)
    state.flags.add(hgssSafariSystemFlag)
  }
  else if (action === 1) {
    const mustPublish = state.safariZone.pendingAreaDays > 0 && state.safariZone.objectUnlockLevel > 0
    const catalog = mustPublish ? state.pokemonRuntime?.safariEncounterCatalog : undefined
    if (mustPublish && !catalog) throw new Error('Le catalogue ROM des rencontres Safari est absent du runtime de sortie.')
    const result = finishHgssSafariSession(state.safariZone, catalog
      ? (set, slot) => createHgssSafariMorningEncounterSignature(catalog, set, slot)
      : undefined)
    state.safariZone = result.state
    state.flags.delete(hgssSafariSystemFlag)
    if (mustPublish) publishHgssSafariEncounterChanges(state, result.changedAreaIds)
  }
  else throw new Error(`Action Parc Safari HGSS ${action} invalide.`)
}

function requireSafariOpcodeBytes(bytes: Uint8Array, offset: number, size: number, opcode: number): void {
  if (offset < 0 || offset + size > bytes.byteLength) {
    throw new Error(`La commande script ${opcode} est tronquee a l’offset ${offset}.`)
  }
}

export function runHgssSafariZoneActionOpcode(
  state: Pick<HgssSafariScriptSlice, 'safariZone' | 'safariProgression' | 'pokemonRuntime' | 'phoneCallTriggers'> & { flags: Set<number> },
  bytes: Uint8Array,
  offset: number,
): number {
  requireSafariOpcodeBytes(bytes, offset, 2, 447)
  applyHgssSafariZoneAction(state, bytes[offset]!, bytes[offset + 1]!)
  return offset + 2
}

export function runHgssSafariChallengeCheck(
  state: Pick<HgssSafariScriptSlice, 'variables' | 'party' | 'pokemonRuntime'>,
  challenge: number,
  destination: number,
): void {
  if (challenge !== 0 && challenge !== 1) throw new Error(`Défi du Parc Safari HGSS ${challenge} invalide.`)
  const trainerId = state.pokemonRuntime?.trainer.id
  if (trainerId === undefined) throw new Error('Le runtime Pokémon est absent du script HGSS.')
  state.variables.set(destination, isHgssSafariChallengeComplete(
    challenge as HgssSafariChallengeIndex,
    state.party.members,
    trainerId,
  ) ? 1 : 0)
}

export function runHgssSafariChallengeCheckOpcode(
  state: Pick<HgssSafariScriptSlice, 'variables' | 'party' | 'pokemonRuntime'>,
  bytes: Uint8Array,
  offset: number,
): number {
  requireSafariOpcodeBytes(bytes, offset, 3, 791)
  const destination = bytes[offset + 1]! | bytes[offset + 2]! << 8
  runHgssSafariChallengeCheck(state, bytes[offset]!, destination)
  return offset + 3
}

export type { HgssSafariState, HgssSafariProgressionState }

export function updateHgssSafariIgtReferenceFromRuntime(
  state: Pick<HgssSafariScriptSlice, 'safariProgression' | 'pokemonRuntime'>,
): void {
  const igtMinutes = state.pokemonRuntime?.igtMinutes
  if (!igtMinutes) {
    throw new Error('Le compteur IGT HGSS est absent du runtime; la RTC ne peut pas remplacer le temps de jeu de Baoba.')
  }
  state.safariProgression = recordHgssSafariIgtReference(state.safariProgression, igtMinutes())
}
