import {
  NewGamePlusValidationError,
  type NewGamePlusJsonValue,
  type NewGamePlusModuleSelection,
  type NewGamePlusProfileV1,
  type NewGamePlusSource,
} from './newGamePlusTypes'

export const newGamePlusProfileFormat = 'pokemaster-hgss-new-game-plus' as const
export const newGamePlusProfileVersion = 1 as const

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new NewGamePlusValidationError(`Le profil New Game+ contient une valeur invalide à ${path}.`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new NewGamePlusValidationError(`Le profil New Game+ contient un objet non sérialisable à ${path}.`)
  }
  return value as Record<string, unknown>
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new NewGamePlusValidationError(`Le profil New Game+ contient un texte invalide à ${path}.`)
  }
  return value
}

function requirePlayerName(value: unknown, path: string): string {
  const name = requireString(value, path)
  if ([...name].length > 7) throw new NewGamePlusValidationError(`Le nom joueur New Game+ est trop long à ${path}.`)
  return name
}

function requirePositiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new NewGamePlusValidationError(`Le profil New Game+ contient un entier invalide à ${path}.`)
  }
  return value as number
}

function requireByte(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 0xff) {
    throw new NewGamePlusValidationError(`Le profil New Game+ contient un octet invalide à ${path}.`)
  }
  return value as number
}

const languageByRegion: Readonly<Record<string, number>> = { J: 1, E: 2, F: 3, I: 4, D: 5, S: 7, K: 8 }

export function resolveNewGamePlusGameCodeIdentity(gameCode: string): Readonly<{ gameVersion: number, language: number }> {
  if (!/^[A-Z0-9]{4}$/.test(gameCode)) throw new NewGamePlusValidationError(`Le code ROM New Game+ ${gameCode} est invalide.`)
  const gameVersion = gameCode.slice(0, 3) === 'IPK' ? 7 : gameCode.slice(0, 3) === 'IPG' ? 8 : undefined
  const language = languageByRegion[gameCode[3] ?? '']
  if (gameVersion === undefined || language === undefined) throw new NewGamePlusValidationError(`Le code ROM New Game+ ${gameCode} est inconnu.`)
  return Object.freeze({ gameVersion, language })
}

export function isNewGamePlusSourceForGameCode(source: NewGamePlusSource, gameCode: string): boolean {
  const expected = resolveNewGamePlusGameCodeIdentity(gameCode)
  return source.gameVersion === expected.gameVersion && source.language === expected.language
}

export function requireNewGamePlusModuleId(value: unknown, path = 'module.id'): string {
  const id = requireString(value, path)
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw new NewGamePlusValidationError(`L'identifiant de module New Game+ ${id} est invalide à ${path}.`)
  }
  return id
}

export function normalizeNewGamePlusJsonValue(value: unknown, path = 'config'): NewGamePlusJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new NewGamePlusValidationError(`Le profil New Game+ contient un nombre non sérialisable à ${path}.`)
    }
    return value
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => normalizeNewGamePlusJsonValue(entry, `${path}[${index}]`))
  }
  const record = requireRecord(value, path)
  return Object.fromEntries(Object.entries(record).map(([key, entry]) => [
    key,
    normalizeNewGamePlusJsonValue(entry, `${path}.${key}`),
  ]))
}

function freezeJsonValue(value: NewGamePlusJsonValue): NewGamePlusJsonValue {
  if (value && typeof value === 'object') {
    if (Array.isArray(value)) value.forEach(freezeJsonValue)
    else Object.values(value).forEach(freezeJsonValue)
    Object.freeze(value)
  }
  return value
}

function parseSource(value: unknown): NewGamePlusSource {
  const source = requireRecord(value, 'source')
  const identity = source.gameVersion === undefined || source.language === undefined
    ? resolveNewGamePlusGameCodeIdentity(requireString(source.gameCode, 'source.gameCode'))
    : { gameVersion: requireByte(source.gameVersion, 'source.gameVersion'), language: requireByte(source.language, 'source.language') }
  const slot = requirePositiveInteger(source.slot, 'source.slot')
  if (slot > 3) throw new NewGamePlusValidationError(`L'emplacement source New Game+ ${slot} est invalide.`)
  const playerName = requirePlayerName(source.playerName, 'source.playerName')
  const leagueCompletedAt = requireString(source.leagueCompletedAt, 'source.leagueCompletedAt')
  const completedAt = new Date(leagueCompletedAt)
  if (Number.isNaN(completedAt.getTime())) {
    throw new NewGamePlusValidationError('La date de victoire à la Ligue du profil New Game+ est invalide.')
  }
  return Object.freeze({
    gameVersion: identity.gameVersion,
    language: identity.language,
    slot: slot as NewGamePlusSource['slot'],
    playerName,
    playerNameSource: 'user-text',
    leagueCompletedAt: completedAt.toISOString(),
  })
}

function parseSelection(value: unknown, index: number): NewGamePlusModuleSelection {
  const path = `modules[${index}]`
  const selection = requireRecord(value, path)
  const config = freezeJsonValue(normalizeNewGamePlusJsonValue(selection.config, `${path}.config`))
  return Object.freeze({
    id: requireNewGamePlusModuleId(selection.id, `${path}.id`),
    revision: requirePositiveInteger(selection.revision, `${path}.revision`),
    config,
  })
}

/**
 * Parse aussi les objets déjà typés : toute restauration repasse ainsi par la
 * même frontière que le JSON provenant du stockage navigateur.
 */
export function parseNewGamePlusProfileV1(value: unknown): NewGamePlusProfileV1 {
  const profile = requireRecord(value, 'profil')
  if (profile.format !== newGamePlusProfileFormat || profile.version !== newGamePlusProfileVersion) {
    throw new NewGamePlusValidationError(
      `Le format New Game+ ${String(profile.format)} v${String(profile.version)} n'est pas pris en charge.`,
    )
  }
  if (!Array.isArray(profile.modules)) {
    throw new NewGamePlusValidationError('Le profil New Game+ ne contient pas une liste de modules valide.')
  }
  const parsed = {
    format: newGamePlusProfileFormat,
    version: newGamePlusProfileVersion,
    source: parseSource(profile.source),
    modules: Object.freeze(profile.modules.map(parseSelection)),
  } satisfies NewGamePlusProfileV1
  return Object.freeze(parsed)
}
