import {
  HGSS_SAFARI_AREAS_PER_SET,
  cloneHgssSafariState,
  closeHgssSafariSessionState,
  incrementHgssSafariObjectUnlockLevel,
  type HgssSafariAreaId,
  type HgssSafariAreaSet,
  type HgssSafariAreaSlot,
  type HgssSafariState,
} from './hgssSafariState'

export const HGSS_SAFARI_MAP_SECTION_ID = 202 as const
export const HGSS_SAFARI_FIRST_CHALLENGE_SPECIES_ID = 74 as const
export const HGSS_SAFARI_SECOND_CHALLENGE_SPECIES_ID = 27 as const
export const HGSS_BAOBA_CALL_DELAY_MINUTES = 180 as const
export const HGSS_IGT_MAX_MINUTES = 59_999 as const

export type HgssSafariEncounterSignatureResolver = (
  areaSet: HgssSafariAreaSet,
  areaSlot: HgssSafariAreaSlot,
) => string

export type HgssSafariAreaDayAdvanceResult = {
  state: HgssSafariState
  /** Identités de zones dont au moins une table matinale a changé, dans l'ordre des six emplacements. */
  changedAreaIds: HgssSafariAreaId[]
}

function requireElapsedDays(days: number): void {
  if (!Number.isInteger(days)) throw new Error(`Le nombre de jours Safari ${days} est invalide.`)
}

function applyAreaDaysImmediately(
  state: HgssSafariState,
  days: number,
  resolveEncounterSignature?: HgssSafariEncounterSignatureResolver,
): HgssSafariAreaDayAdvanceResult {
  if (days <= 0 || state.objectUnlockLevel === 0) {
    return { state: cloneHgssSafariState(state), changedAreaIds: [] }
  }

  const beforeSet = state.areaSets[0]
  const beforeSignatures = resolveEncounterSignature
    ? beforeSet.areas.map((_, slot) => resolveEncounterSignature(beforeSet, slot as HgssSafariAreaSlot))
    : undefined
  const next = cloneHgssSafariState(state)
  const agedAreaIds = new Set<HgssSafariAreaId>()

  for (const area of next.areaSets[0].areas) {
    if (agedAreaIds.has(area.areaId)) continue
    agedAreaIds.add(area.areaId)
    next.areaSets[0].areaLevels[area.areaId] = Math.min(0xff, next.areaSets[0].areaLevels[area.areaId] + days)
  }

  if (!resolveEncounterSignature || !beforeSignatures) return { state: next, changedAreaIds: [] }

  const changedAreaIds: HgssSafariAreaId[] = []
  const recordedAreaIds = new Set<HgssSafariAreaId>()
  for (let slot = 0; slot < HGSS_SAFARI_AREAS_PER_SET; slot++) {
    const areaSlot = slot as HgssSafariAreaSlot
    const areaId = next.areaSets[0].areas[areaSlot].areaId
    if (recordedAreaIds.has(areaId)) continue
    const afterSignature = resolveEncounterSignature(next.areaSets[0], areaSlot)
    if (afterSignature !== beforeSignatures[areaSlot]) {
      changedAreaIds.push(areaId)
      recordedAreaIds.add(areaId)
    }
  }
  return { state: next, changedAreaIds }
}

/**
 * Applique le hook journalier HGSS. Pendant une partie Safari, la ROM conserve
 * les jours dans un u8 et ne vieillit les zones du set joueur qu'à la sortie.
 */
export function advanceHgssSafariAreaDays(
  state: HgssSafariState,
  days: number,
  resolveEncounterSignature?: HgssSafariEncounterSignatureResolver,
): HgssSafariAreaDayAdvanceResult {
  requireElapsedDays(days)
  if (days <= 0 || state.objectUnlockLevel === 0) {
    return { state: cloneHgssSafariState(state), changedAreaIds: [] }
  }
  if (!state.session.active) return applyAreaDaysImmediately(state, days, resolveEncounterSignature)

  const next = cloneHgssSafariState(state)
  next.pendingAreaDays = (next.pendingAreaDays + days) & 0xff
  return { state: next, changedAreaIds: [] }
}

/** Reproduit `SafariZoneAction 1`: vieillissement différé, puis remise sur le set 1 et zéro Ball. */
export function finishHgssSafariSession(
  state: HgssSafariState,
  resolveEncounterSignature?: HgssSafariEncounterSignatureResolver,
): HgssSafariAreaDayAdvanceResult {
  const pendingDays = state.pendingAreaDays
  const beforeAging = cloneHgssSafariState(state)
  beforeAging.session.active = false
  beforeAging.pendingAreaDays = 0
  const aged = applyAreaDaysImmediately(beforeAging, pendingDays, resolveEncounterSignature)
  return {
    state: closeHgssSafariSessionState(aged.state),
    changedAreaIds: aged.changedAreaIds,
  }
}

export type HgssBaobaQuestStage = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7

export type HgssSafariProgressionState = {
  schemaVersion: 1
  baobaContactRegistered: boolean
  /** Valeur exacte de VAR_UNK_4057. */
  baobaQuestStage: HgssBaobaQuestStage
  /** Minute IGT mémorisée par `UpdateSafariZoneIGT`. */
  baobaIgtReferenceMinutes: number
  /** Référence civile de l'actualisation quotidienne native, conservée par l'hôte. */
  lastAreaUpdateDay?: string
  /** Zones dont Baoba doit annoncer les nouvelles rencontres (trigger 6). */
  pendingEncounterAreaIds: HgssSafariAreaId[]
}

export type HgssSafariChallengePokemon = {
  speciesId: number
  isEgg: boolean
  originalTrainer: { id: number }
  origin: {
    metLocation: number
    eggLocation?: number
  }
}

export type HgssSafariChallengeIndex = 0 | 1

export type HgssBaobaCallTrigger =
  | 'newPokemon'
  | 'nextTest'
  | 'objectArrangement'
  | 'moreObjects'
  | 'evenMoreObjects'
  | 'memoryLoss'

export function createHgssSafariProgressionState(): HgssSafariProgressionState {
  return {
    schemaVersion: 1,
    baobaContactRegistered: false,
    baobaQuestStage: 0,
    baobaIgtReferenceMinutes: 0,
    pendingEncounterAreaIds: [],
  }
}

function cloneProgression(state: HgssSafariProgressionState): HgssSafariProgressionState {
  return { ...state, pendingEncounterAreaIds: [...state.pendingEncounterAreaIds] }
}

function requireIgtMinutes(minutes: number): number {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > HGSS_IGT_MAX_MINUTES) {
    throw new Error(`La minute IGT Safari ${minutes} est invalide.`)
  }
  return minutes
}

export function registerHgssBaobaContact(state: HgssSafariProgressionState): HgssSafariProgressionState {
  const next = cloneProgression(state)
  next.baobaContactRegistered = true
  return next
}

export function setHgssBaobaQuestStage(
  state: HgssSafariProgressionState,
  stage: number,
): HgssSafariProgressionState {
  if (!Number.isInteger(stage) || stage < 0 || stage > 7) {
    throw new Error(`L’étape de quête Safari ${stage} est invalide.`)
  }
  const next = cloneProgression(state)
  next.baobaQuestStage = stage as HgssBaobaQuestStage
  return next
}

export function recordHgssSafariIgtReference(
  state: HgssSafariProgressionState,
  currentIgtMinutes: number,
): HgssSafariProgressionState {
  const next = cloneProgression(state)
  next.baobaIgtReferenceMinutes = requireIgtMinutes(currentIgtMinutes)
  return next
}

/** Appel scénarisé d'Oliville qui ouvre le Parc et place VAR_UNK_4057 à 1. */
export function openHgssSafariZoneAfterLighthouse(state: HgssSafariProgressionState): HgssSafariProgressionState {
  const next = cloneProgression(state)
  next.baobaQuestStage = 1
  return next
}

/** Les deux scènes automatiques de l'entrée transforment respectivement 1→2 et 4→5. */
export function applyHgssSafariGateChallengeScene(state: HgssSafariProgressionState): HgssSafariProgressionState {
  const next = cloneProgression(state)
  if (state.baobaQuestStage === 1) next.baobaQuestStage = 2
  else if (state.baobaQuestStage === 4) next.baobaQuestStage = 5
  return next
}

export function isHgssSafariChallengeComplete(
  challenge: HgssSafariChallengeIndex,
  party: readonly HgssSafariChallengePokemon[],
  playerTrainerId: number,
  safariMapSectionId: number = HGSS_SAFARI_MAP_SECTION_ID,
): boolean {
  const speciesId = challenge === 0
    ? HGSS_SAFARI_FIRST_CHALLENGE_SPECIES_ID
    : HGSS_SAFARI_SECOND_CHALLENGE_SPECIES_ID
  return party.some((pokemon) => (
    !pokemon.isEgg
    && pokemon.originalTrainer.id === playerTrainerId
    && pokemon.speciesId === speciesId
    && (pokemon.origin.eggLocation ?? 0) === 0
    && pokemon.origin.metLocation === safariMapSectionId
  ))
}

export type HgssSafariChallengeCompletionResult = {
  state: HgssSafariProgressionState
  completed: boolean
}

export function completeHgssSafariChallenge(
  state: HgssSafariProgressionState,
  challenge: HgssSafariChallengeIndex,
  party: readonly HgssSafariChallengePokemon[],
  playerTrainerId: number,
  currentIgtMinutes: number,
): HgssSafariChallengeCompletionResult {
  const expectedStage = challenge === 0 ? 2 : 5
  if (state.baobaQuestStage !== expectedStage || !isHgssSafariChallengeComplete(challenge, party, playerTrainerId)) {
    return { state: cloneProgression(state), completed: false }
  }
  const next = cloneProgression(state)
  next.baobaQuestStage = challenge === 0 ? 3 : 6
  next.baobaIgtReferenceMinutes = requireIgtMinutes(currentIgtMinutes)
  return { state: next, completed: true }
}

type IgtDelayStatus = 'waiting' | 'elapsed' | 'saturated'

function getIgtDelayStatus(referenceMinutes: number, currentMinutes: number): IgtDelayStatus {
  requireIgtMinutes(referenceMinutes)
  requireIgtMinutes(currentMinutes)
  if (currentMinutes - referenceMinutes >= HGSS_BAOBA_CALL_DELAY_MINUTES) return 'elapsed'
  return currentMinutes >= HGSS_IGT_MAX_MINUTES ? 'saturated' : 'waiting'
}

/**
 * Sélectionne les triggers 7..11 de Baoba. Le trigger 6 (`newPokemon`) vient
 * séparément du résultat de `advanceHgssSafariAreaDays`.
 */
export function resolveHgssBaobaCallTrigger(
  progression: HgssSafariProgressionState,
  safari: HgssSafariState,
  currentIgtMinutes: number,
  hasNationalDex: boolean,
): Exclude<HgssBaobaCallTrigger, 'newPokemon'> | undefined {
  if (progression.baobaQuestStage < 3 || safari.objectUnlockLevel >= 4) return undefined
  const delayStatus = getIgtDelayStatus(progression.baobaIgtReferenceMinutes, currentIgtMinutes)
  if (progression.baobaQuestStage === 3) return delayStatus === 'waiting' ? undefined : 'nextTest'
  if (progression.baobaQuestStage < 6 || !hasNationalDex || delayStatus === 'waiting') return undefined

  if (delayStatus === 'saturated') {
    return safari.objectUnlockLevel < 3 ? 'memoryLoss' : 'evenMoreObjects'
  }
  if (safari.objectUnlockLevel === 0) return 'objectArrangement'
  if (safari.objectUnlockLevel === 3) return 'evenMoreObjects'
  return 'moreObjects'
}

export type HgssBaobaCallApplicationResult = {
  progression: HgssSafariProgressionState
  safari: HgssSafariState
}

export function applyHgssBaobaCall(
  progression: HgssSafariProgressionState,
  safari: HgssSafariState,
  trigger: Exclude<HgssBaobaCallTrigger, 'newPokemon'>,
  currentIgtMinutes: number,
): HgssBaobaCallApplicationResult {
  const nextProgression = cloneProgression(progression)
  let nextSafari = cloneHgssSafariState(safari)

  if (trigger === 'nextTest') {
    nextProgression.baobaQuestStage = 4
  } else if (trigger === 'objectArrangement' || trigger === 'moreObjects') {
    nextSafari = incrementHgssSafariObjectUnlockLevel(nextSafari, 1)
    nextProgression.baobaIgtReferenceMinutes = requireIgtMinutes(currentIgtMinutes)
    nextProgression.baobaQuestStage = 7
  } else {
    nextSafari = incrementHgssSafariObjectUnlockLevel(nextSafari, 4)
    nextProgression.baobaQuestStage = 7
  }

  return { progression: nextProgression, safari: nextSafari }
}
