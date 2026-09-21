export const HGSS_PHONE_RING_MAX_ACTIVE_SECONDS = 30 as const
/** `unk_varC` de `GearPhoneRingManager_New`. */
export const HGSS_PHONE_INCOMING_INTERVAL_MINUTES = 10 as const
/** Un trigger urgent arme le compteur à `unk_varC - 1`. */
export const HGSS_PHONE_URGENT_PRIME_MINUTES = 9 as const

export type HgssPhoneIncomingGateState = {
  /** Équivalent de `unk_var0_2`; un reset de sonnerie ne l'efface pas. */
  timeAdvanceInitialized: boolean
  /** Équivalent de `unk_var8`. */
  elapsedMinutes: number
  /** Repère optionnel utilisé par le wrapper de synchronisation absolue. */
  lastSyncedMinute?: number
}

export type HgssPhoneRingLaunch = {
  soundSequenceId: number
  soundCycleFrames: number
}

export type HgssPhoneRingSession<T> = {
  start: (payload: T, launch: HgssPhoneRingLaunch, frame: number, nowMs: number) => boolean
  tick: (frame: number, nowMs: number) => void
  answer: () => T | undefined
  reset: () => void
  peek: () => T | undefined
  isRinging: () => boolean
  advanceIncomingCallMinutes: (elapsedMinutes: number) => void
  syncIncomingCallMinutes: (currentMinute: number) => void
  primeUrgentIncomingCall: () => void
  canSelectIncoming: () => boolean
  getIncomingGateState: () => Readonly<HgssPhoneIncomingGateState>
  /** Nouveau jeu/chargement : oublie l'ancienne chronologie de l'hôte. */
  reinitializeIncomingCallGate: (currentMinute?: number) => void
  /** Décrochage forcé natif, même si l'hôte n'a pas matérialisé une sonnerie. */
  consumeForcedIncomingCall: () => void
}

export type HgssPhoneRingSessionOptions = {
  isSoundPlaying: (sequenceId: number) => boolean
  playSound: (sequenceId: number) => void
  stopSound: (sequenceId: number) => void
  onStateChange?: (ringing: boolean) => void
}

function requireCounter(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} de sonnerie Pokématos ${value} invalide.`)
  return value
}

function requireMinute(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} du compteur d'appels Pokématos ${value} invalide.`)
  }
  return value
}

function requireIncomingGateState(state: Readonly<HgssPhoneIncomingGateState>): void {
  if (typeof state.timeAdvanceInitialized !== 'boolean') {
    throw new Error("L'initialisation temporelle du compteur d'appels Pokématos est invalide.")
  }
  requireMinute(state.elapsedMinutes, 'La durée')
  if (state.lastSyncedMinute !== undefined) requireMinute(state.lastSyncedMinute, 'La minute synchronisée')
}

export function createHgssPhoneIncomingGateState(): HgssPhoneIncomingGateState {
  return { timeAdvanceInitialized: false, elapsedMinutes: 0 }
}

export function reinitializeHgssPhoneIncomingGate(currentMinute?: number): HgssPhoneIncomingGateState {
  if (currentMinute !== undefined) requireMinute(currentMinute, 'La minute de réinitialisation')
  return currentMinute === undefined
    ? createHgssPhoneIncomingGateState()
    : { ...createHgssPhoneIncomingGateState(), lastSyncedMinute: currentMinute }
}

/**
 * Port de `sub_02092E34`. Le tout premier grand delta est volontairement
 * ignoré par HGSS afin qu'un chargement ne provoque pas immédiatement un appel.
 */
export function advanceHgssPhoneIncomingGate(
  state: Readonly<HgssPhoneIncomingGateState>,
  elapsedMinutes: number,
): HgssPhoneIncomingGateState {
  requireIncomingGateState(state)
  requireMinute(elapsedMinutes, 'Le delta')
  if (!state.timeAdvanceInitialized && elapsedMinutes >= HGSS_PHONE_INCOMING_INTERVAL_MINUTES) {
    return { ...state, timeAdvanceInitialized: true }
  }
  const nextElapsedMinutes = state.elapsedMinutes + elapsedMinutes
  requireMinute(nextElapsedMinutes, 'La durée cumulée')
  return {
    ...state,
    timeAdvanceInitialized: true,
    elapsedMinutes: nextElapsedMinutes,
  }
}

/** Synchronise un compteur absolu (RTC/IGT hôte) puis applique seulement son delta. */
export function syncHgssPhoneIncomingGate(
  state: Readonly<HgssPhoneIncomingGateState>,
  currentMinute: number,
): HgssPhoneIncomingGateState {
  requireIncomingGateState(state)
  requireMinute(currentMinute, 'La minute courante')
  const previousMinute = state.lastSyncedMinute
  if (previousMinute !== undefined && currentMinute < previousMinute) {
    throw new Error(`La minute du compteur d'appels Pokématos recule de ${previousMinute} à ${currentMinute}.`)
  }
  const advanced = advanceHgssPhoneIncomingGate(
    state,
    previousMinute === undefined ? currentMinute : currentMinute - previousMinute,
  )
  return { ...advanced, lastSyncedMinute: currentMinute }
}

/** Port du reset actif : compteur à zéro, mais garde d'initialisation conservée. */
export function resetHgssPhoneIncomingGate(
  state: Readonly<HgssPhoneIncomingGateState>,
): HgssPhoneIncomingGateState {
  requireIncomingGateState(state)
  return { ...state, elapsedMinutes: 0 }
}

/** Port du chemin urgent de `sub_02092E14(..., TRUE)`. */
export function primeHgssPhoneIncomingGate(
  state: Readonly<HgssPhoneIncomingGateState>,
): HgssPhoneIncomingGateState {
  requireIncomingGateState(state)
  return {
    ...state,
    elapsedMinutes: Math.max(state.elapsedMinutes, HGSS_PHONE_URGENT_PRIME_MINUTES),
  }
}

export function canSelectHgssPhoneIncoming(
  state: Readonly<HgssPhoneIncomingGateState>,
): boolean {
  requireIncomingGateState(state)
  return state.elapsedMinutes >= HGSS_PHONE_INCOMING_INTERVAL_MINUTES
}

/** Gestion unique du GearPhoneRingManager natif : son, cycle, expiration et décrochage. */
export function createHgssPhoneRingSession<T>(options: HgssPhoneRingSessionOptions): HgssPhoneRingSession<T> {
  let active: { payload: T, launch: HgssPhoneRingLaunch, startedAtMs: number, nextSoundFrame: number } | undefined
  let incomingGate = createHgssPhoneIncomingGateState()

  const reset = (): void => {
    if (!active) return
    options.stopSound(active.launch.soundSequenceId)
    active = undefined
    incomingGate = resetHgssPhoneIncomingGate(incomingGate)
    options.onStateChange?.(false)
  }

  return {
    start(payload, launch, frame, nowMs) {
      requireCounter(frame, 'La frame')
      if (!Number.isFinite(nowMs) || launch.soundCycleFrames < 1 || !Number.isInteger(launch.soundCycleFrames)) {
        throw new Error('Les paramètres de sonnerie Pokématos sont invalides.')
      }
      if (active) return false
      active = { payload, launch, startedAtMs: nowMs, nextSoundFrame: frame }
      options.onStateChange?.(true)
      return true
    },
    tick(frame, nowMs) {
      const ringing = active
      if (!ringing) return
      requireCounter(frame, 'La frame')
      if (!Number.isFinite(nowMs)) throw new Error(`L’horodatage de sonnerie Pokématos ${nowMs} est invalide.`)
      if (nowMs - ringing.startedAtMs > HGSS_PHONE_RING_MAX_ACTIVE_SECONDS * 1000) { reset(); return }
      if (frame < ringing.nextSoundFrame) return
      ringing.nextSoundFrame = frame + ringing.launch.soundCycleFrames
      if (!options.isSoundPlaying(ringing.launch.soundSequenceId)) options.playSound(ringing.launch.soundSequenceId)
    },
    answer() {
      const payload = active?.payload
      reset()
      return payload
    },
    reset,
    peek: () => active?.payload,
    isRinging: () => active !== undefined,
    advanceIncomingCallMinutes(elapsedMinutes) {
      incomingGate = advanceHgssPhoneIncomingGate(incomingGate, elapsedMinutes)
    },
    syncIncomingCallMinutes(currentMinute) {
      incomingGate = syncHgssPhoneIncomingGate(incomingGate, currentMinute)
    },
    primeUrgentIncomingCall() {
      incomingGate = primeHgssPhoneIncomingGate(incomingGate)
    },
    canSelectIncoming: () => !active && canSelectHgssPhoneIncoming(incomingGate),
    getIncomingGateState: () => ({ ...incomingGate }),
    reinitializeIncomingCallGate(currentMinute) {
      incomingGate = reinitializeHgssPhoneIncomingGate(currentMinute)
    },
    consumeForcedIncomingCall() {
      incomingGate = resetHgssPhoneIncomingGate(incomingGate)
    },
  }
}
