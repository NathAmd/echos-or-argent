/** Save_PlayerData::IGT: the native game stores play time as 999:59:59. */
export type HgssInGameTime = {
  hours: number
  minutes: number
  seconds: number
}

export type HgssInGameTimeClock = {
  resume: () => void
  pause: () => void
  snapshot: () => HgssInGameTime
  totalMinutes: () => number
  running: () => boolean
}

const maxHours = 999

function requireInteger(value: unknown, label: string, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    throw new Error(`Le temps de jeu HGSS contient une valeur invalide à ${label}.`)
  }
  return value as number
}

export function restoreHgssInGameTime(value: unknown): HgssInGameTime {
  if (value === undefined) return { hours: 0, minutes: 0, seconds: 0 }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Le temps de jeu HGSS sauvegardé est invalide.')
  }
  const saved = value as Partial<HgssInGameTime>
  return {
    hours: requireInteger(saved.hours, 'igt.hours', maxHours),
    minutes: requireInteger(saved.minutes, 'igt.minutes', 59),
    seconds: requireInteger(saved.seconds, 'igt.seconds', 59),
  }
}

/** Port of AddIGTSeconds, including HeartGold/SoulSilver's 999-hour clamp. */
export function addHgssInGameTimeSeconds(time: HgssInGameTime, secondsToAdd: number): HgssInGameTime {
  const current = restoreHgssInGameTime(time)
  if (!Number.isInteger(secondsToAdd) || secondsToAdd < 0) {
    throw new Error(`Le nombre de secondes HGSS ${secondsToAdd} est invalide.`)
  }
  if (current.hours === maxHours && current.minutes === 59 && current.seconds === 59) return current

  let seconds = current.seconds + secondsToAdd
  let minutes = current.minutes
  let hours = current.hours
  if (seconds > 59) {
    minutes += Math.floor(seconds / 60)
    seconds %= 60
    if (minutes > 59) {
      hours += Math.floor(minutes / 60)
      minutes %= 60
      // Retail HGSS uses >= here: crossing into hour 999 saturates all fields.
      if (hours >= maxHours) return { hours: maxHours, minutes: 59, seconds: 59 }
    }
  }
  return { hours, minutes, seconds }
}

export function createHgssInGameTimeClock(
  initial: HgssInGameTime = { hours: 0, minutes: 0, seconds: 0 },
  nowMilliseconds: () => number = () => performance.now(),
): HgssInGameTimeClock {
  let value = restoreHgssInGameTime(initial)
  let startedAt: number | undefined
  let accountedSeconds = 0

  const update = (): void => {
    if (startedAt === undefined) return
    const elapsedSeconds = Math.max(0, Math.floor((nowMilliseconds() - startedAt) / 1_000))
    if (elapsedSeconds <= accountedSeconds) return
    value = addHgssInGameTimeSeconds(value, elapsedSeconds - accountedSeconds)
    accountedSeconds = elapsedSeconds
  }

  return {
    resume: () => {
      if (startedAt !== undefined) return
      startedAt = nowMilliseconds()
      accountedSeconds = 0
    },
    pause: () => {
      update()
      startedAt = undefined
      accountedSeconds = 0
    },
    snapshot: () => {
      update()
      return { ...value }
    },
    totalMinutes: () => {
      update()
      return value.hours * 60 + value.minutes
    },
    running: () => startedAt !== undefined,
  }
}
