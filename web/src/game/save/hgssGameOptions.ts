export type HgssTextSpeed = 'slow' | 'normal' | 'fast'

export type HgssGameOptions = {
  textSpeed: HgssTextSpeed
  battleAnimations: boolean
  localWeather: boolean
}

type OptionsStorage = Pick<Storage, 'getItem' | 'setItem'>

type StoredHgssGameOptions = {
  version: 1
  gameCode: string
  options: HgssGameOptions
}

const optionsStoragePrefix = 'pokemaster.hgss.options.v1.'

export function createDefaultHgssGameOptions(): HgssGameOptions {
  return { textSpeed: 'normal', battleAnimations: true, localWeather: false }
}

export function cycleHgssTextSpeed(speed: HgssTextSpeed): HgssTextSpeed {
  return stepHgssTextSpeed(speed, 1)
}

export function stepHgssTextSpeed(speed: HgssTextSpeed, direction: -1 | 1): HgssTextSpeed {
  const speeds = ['slow', 'normal', 'fast'] as const
  return speeds[(speeds.indexOf(speed) + direction + speeds.length) % speeds.length]!
}

/** Valeurs exactes renvoyées par `Options_GetTextFrameDelay`. */
export function getHgssTextFrameDelay(speed: HgssTextSpeed): 1 | 4 | 8 {
  return speed === 'slow' ? 8 : speed === 'normal' ? 4 : 1
}

export function getHgssGameOptionsStorageKey(gameCode: string): string {
  return `${optionsStoragePrefix}${gameCode}`
}

export function validateHgssGameOptions(value: unknown): HgssGameOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Les options HGSS sont invalides.')
  const options = value as Partial<HgssGameOptions>
  if (options.textSpeed !== 'slow' && options.textSpeed !== 'normal' && options.textSpeed !== 'fast') {
    throw new Error('La vitesse de texte HGSS est invalide.')
  }
  if (typeof options.battleAnimations !== 'boolean') throw new Error('Le réglage des animations de combat HGSS est invalide.')
  if (options.localWeather !== undefined && typeof options.localWeather !== 'boolean') {
    throw new Error('Le réglage de météo locale HGSS est invalide.')
  }
  return { textSpeed: options.textSpeed, battleAnimations: options.battleAnimations, localWeather: options.localWeather ?? false }
}

export function writeHgssGameOptions(storage: OptionsStorage, gameCode: string, options: HgssGameOptions): void {
  const stored: StoredHgssGameOptions = { version: 1, gameCode, options: validateHgssGameOptions(options) }
  storage.setItem(getHgssGameOptionsStorageKey(gameCode), JSON.stringify(stored))
}

export function readHgssGameOptions(storage: OptionsStorage, gameCode: string): HgssGameOptions | undefined {
  const encoded = storage.getItem(getHgssGameOptionsStorageKey(gameCode))
  if (encoded === null) return undefined
  let value: unknown
  try {
    value = JSON.parse(encoded)
  } catch {
    throw new Error('Les options HGSS enregistrées ne contiennent pas un JSON valide.')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Les options HGSS enregistrées sont invalides.')
  const stored = value as Partial<StoredHgssGameOptions>
  if (stored.version !== 1) throw new Error(`La version d’options HGSS ${String(stored.version)} n’est pas prise en charge.`)
  if (stored.gameCode !== gameCode) throw new Error(`Les options HGSS ${String(stored.gameCode)} ne correspondent pas à la ROM ${gameCode}.`)
  return validateHgssGameOptions(stored.options)
}
