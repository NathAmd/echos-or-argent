export const HGSS_RTC_SYSTEM_CHANGE_PENALTY_MINUTES = 1_440 as const
export const HGSS_RTC_PENALTY_STATE_SCHEMA_VERSION = 1 as const

/** Partie portable de `SysInfo_RTC` qui gouverne `FieldSystem_HasPenalty`. */
export type HgssRtcPenaltyState = {
  schemaVersion: typeof HGSS_RTC_PENALTY_STATE_SCHEMA_VERSION
  /** Dernière date/heure RTC effectivement mémorisée par `sub_02055478`. */
  lastObservedTimestampSeconds: number
  /** Date civile mémorisée séparément par `sub_02055450`. */
  lastObservedDayOrdinal: number
  /** Valeur opaque de `SysInfo::rtc_offset`; 0 si l'hôte ne peut pas l'observer. */
  ownerRtcOffset: number
  /** `SysInfo_RTC::penaltyInMinutes` (u32). */
  penaltyMinutes: number
}

export type HgssRtcContinueOptions = {
  /** Valeur native/émulateur fiable de `OS_GetOwnerRtcOffset`, si disponible. */
  ownerRtcOffset?: number
  /** Pour un hôte capable d'observer une identité système fiable (MAC native). */
  systemIdentityChanged?: boolean
}

export type HgssRtcPenaltyAdvanceResult = {
  state: HgssRtcPenaltyState
  elapsedDays: number
  elapsedMinutes: number
  /** La ROM exécute les tâches quotidiennes avant de décrémenter la pénalité. */
  hadPenaltyForDailyTasks: boolean
}

function requireDate(now: Date): void {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error('La date RTC HGSS est invalide.')
}

function requireSafeInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} RTC HGSS ${value} est invalide.`)
  }
  return value
}

export function getHgssRtcTimestampSeconds(now: Date): number {
  requireDate(now)
  // `RTC_ConvertDateTimeToSecond` convertit les champs civils de la RTC, pas
  // un instant UTC. Cette forme ne crée donc pas de saut DST artificiel.
  return requireSafeInteger(Math.floor(Date.UTC(
    now.getFullYear(), now.getMonth(), now.getDate(),
    now.getHours(), now.getMinutes(), now.getSeconds(),
  ) / 1_000), 0, Number.MAX_SAFE_INTEGER, "L'horodatage")
}

/** Ordinal des champs civils locaux, équivalent de `RTC_ConvertDateToDay`. */
export function getHgssRtcDayOrdinal(now: Date): number {
  requireDate(now)
  return requireSafeInteger(
    Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86_400_000),
    0,
    Number.MAX_SAFE_INTEGER,
    'Le jour',
  )
}

function requireRtcOffset(value: number): number {
  return requireSafeInteger(value, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 'Le décalage propriétaire')
}

export function validateHgssRtcPenaltyState(
  value: unknown,
  path = 'rtcPenalty',
): asserts value is HgssRtcPenaltyState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`La sauvegarde HGSS contient un état RTC invalide à ${path}.`)
  }
  const state = value as Partial<HgssRtcPenaltyState>
  if (state.schemaVersion !== HGSS_RTC_PENALTY_STATE_SCHEMA_VERSION) {
    throw new Error(`La sauvegarde HGSS contient une version RTC invalide à ${path}.schemaVersion.`)
  }
  requireSafeInteger(state.lastObservedTimestampSeconds as number, 0, Number.MAX_SAFE_INTEGER, `${path}.lastObservedTimestampSeconds`)
  requireSafeInteger(state.lastObservedDayOrdinal as number, 0, Number.MAX_SAFE_INTEGER, `${path}.lastObservedDayOrdinal`)
  requireRtcOffset(state.ownerRtcOffset as number)
  requireSafeInteger(state.penaltyMinutes as number, 0, 0xffff_ffff, `${path}.penaltyMinutes`)
}

export function createHgssRtcPenaltyState(
  now: Date,
  ownerRtcOffset = 0,
): HgssRtcPenaltyState {
  return {
    schemaVersion: HGSS_RTC_PENALTY_STATE_SCHEMA_VERSION,
    lastObservedTimestampSeconds: getHgssRtcTimestampSeconds(now),
    lastObservedDayOrdinal: getHgssRtcDayOrdinal(now),
    ownerRtcOffset: requireRtcOffset(ownerRtcOffset),
    penaltyMinutes: 0,
  }
}

export function snapshotHgssRtcPenaltyState(
  state: Readonly<HgssRtcPenaltyState>,
): HgssRtcPenaltyState {
  validateHgssRtcPenaltyState(state)
  return { ...state }
}

/**
 * Port de `SysInfoRTC_HandleContinueOnNewConsole`. Le navigateur n'expose ni
 * la MAC matérielle ni `OS_GetOwnerRtcOffset`. Un hôte natif/émulateur peut
 * fournir ces signaux; en leur absence on conserve la valeur sauvegardée sans
 * assimiler à tort le fuseau/DST du navigateur à l'offset matériel de la DS.
 */
export function continueHgssRtcPenaltyState(
  state: Readonly<HgssRtcPenaltyState>,
  now: Date,
  options: HgssRtcContinueOptions = {},
): HgssRtcPenaltyState {
  validateHgssRtcPenaltyState(state)
  const ownerRtcOffset = options.ownerRtcOffset === undefined
    ? state.ownerRtcOffset
    : requireRtcOffset(options.ownerRtcOffset)
  if (!options.systemIdentityChanged && ownerRtcOffset === state.ownerRtcOffset) return { ...state }
  return {
    ...createHgssRtcPenaltyState(now, ownerRtcOffset),
    penaltyMinutes: HGSS_RTC_SYSTEM_CHANGE_PENALTY_MINUTES,
  }
}

/** Une ancienne sauvegarde sans SysInfo portable est initialisée sans pénalité inventée. */
export function restoreHgssRtcPenaltyState(
  value: unknown,
  now: Date,
  options: HgssRtcContinueOptions = {},
): HgssRtcPenaltyState {
  if (value === undefined) {
    return createHgssRtcPenaltyState(now, options.ownerRtcOffset)
  }
  validateHgssRtcPenaltyState(value)
  return continueHgssRtcPenaltyState(value, now, options)
}

export function hasHgssRtcPenalty(state: Readonly<HgssRtcPenaltyState>): boolean {
  validateHgssRtcPenaltyState(state)
  return state.penaltyMinutes !== 0
}

/**
 * Compose `sub_02055450`, `sub_02055478` et
 * `Save_SysInfo_RTC_DecrementPenalty` dans leur ordre natif.
 */
export function advanceHgssRtcPenaltyState(
  state: Readonly<HgssRtcPenaltyState>,
  now: Date,
): HgssRtcPenaltyAdvanceResult {
  validateHgssRtcPenaltyState(state)
  const next = { ...state }
  const currentDayOrdinal = getHgssRtcDayOrdinal(now)
  let elapsedDays = 0
  if (currentDayOrdinal < next.lastObservedDayOrdinal) next.lastObservedDayOrdinal = currentDayOrdinal
  else if (currentDayOrdinal > next.lastObservedDayOrdinal) {
    elapsedDays = currentDayOrdinal - next.lastObservedDayOrdinal
    next.lastObservedDayOrdinal = currentDayOrdinal
  }

  const hadPenaltyForDailyTasks = next.penaltyMinutes !== 0
  const currentTimestampSeconds = getHgssRtcTimestampSeconds(now)
  if (currentTimestampSeconds < next.lastObservedTimestampSeconds) {
    next.lastObservedTimestampSeconds = currentTimestampSeconds
    return { state: next, elapsedDays, elapsedMinutes: 0, hadPenaltyForDailyTasks }
  }
  const elapsedMinutes = Math.floor((currentTimestampSeconds - next.lastObservedTimestampSeconds) / 60)
  if (elapsedMinutes <= 0) return { state: next, elapsedDays, elapsedMinutes: 0, hadPenaltyForDailyTasks }

  let penaltyMinutes = Math.min(next.penaltyMinutes, HGSS_RTC_SYSTEM_CHANGE_PENALTY_MINUTES)
  penaltyMinutes = penaltyMinutes < elapsedMinutes ? 0 : penaltyMinutes - elapsedMinutes
  next.penaltyMinutes = penaltyMinutes
  next.lastObservedTimestampSeconds = currentTimestampSeconds
  return { state: next, elapsedDays, elapsedMinutes, hadPenaltyForDailyTasks }
}
