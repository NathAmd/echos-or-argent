import type { FieldScriptState } from '../scripts/fieldScriptRunner'
import type { HgssBrowserSaveSlot } from '../save/hgssSaveStorage'

export type NewGamePlusJsonPrimitive = string | number | boolean | null
export type NewGamePlusJsonValue =
  | NewGamePlusJsonPrimitive
  | readonly NewGamePlusJsonValue[]
  | { readonly [key: string]: NewGamePlusJsonValue }

export type NewGamePlusSource = Readonly<{
  /** Legacy uniquement; le parseur canonique le remplace par deux identifiants numériques. */
  gameCode?: string
  gameVersion?: number
  language?: number
  slot: HgssBrowserSaveSlot
  playerName: string
  playerNameSource?: 'user-text'
  leagueCompletedAt: string
}>

export type NewGamePlusModuleSelection = Readonly<{
  id: string
  revision: number
  config: NewGamePlusJsonValue
}>

export type NewGamePlusProfileV1 = Readonly<{
  format: 'pokemaster-hgss-new-game-plus'
  version: 1
  source: NewGamePlusSource
  modules: readonly NewGamePlusModuleSelection[]
}>

export type NewGamePlusProfileDraft = Readonly<{
  source: NewGamePlusSource
  modules: readonly Readonly<{
    id: string
    /** Une configuration absente demande la valeur par défaut du module. */
    config?: unknown
  }>[]
}>

/**
 * Le registre fournit une copie de la source à chaque module et une copie de
 * la destination à l'ensemble de la transaction. Aucun module ne reçoit la
 * sauvegarde active possédée par l'appelant.
 */
export type NewGamePlusModuleApplicationContext = Readonly<{
  source: Readonly<FieldScriptState>
  destination: FieldScriptState
}>

export type NewGamePlusModuleDefinition = Readonly<{
  id: string
  revision: number
  title: string
  description: string
  enabledByDefault?: boolean
  createDefaultConfig: () => NewGamePlusJsonValue
  decodeConfig: (value: unknown) => NewGamePlusJsonValue
  apply: (context: NewGamePlusModuleApplicationContext, config: NewGamePlusJsonValue) => void
}>

type TypedNewGamePlusModuleDefinition<Config> = Readonly<{
  id: string
  revision: number
  title: string
  description: string
  enabledByDefault?: boolean
  createDefaultConfig: () => Config
  decodeConfig: (value: unknown) => Config
  apply: (context: NewGamePlusModuleApplicationContext, config: Readonly<Config>) => void
}>

/** Garde le type concret de la configuration à l'intérieur de son module. */
export function defineNewGamePlusModule<Config>(
  definition: TypedNewGamePlusModuleDefinition<Config>,
): NewGamePlusModuleDefinition {
  return Object.freeze({
    id: definition.id,
    revision: definition.revision,
    title: definition.title,
    description: definition.description,
    enabledByDefault: definition.enabledByDefault,
    // La frontière du registre vérifie ensuite que ces valeurs sont bien du
    // JSON. Le module conserve ainsi un type de configuration précis sans lui
    // imposer une signature d'index artificielle.
    createDefaultConfig: () => definition.createDefaultConfig() as NewGamePlusJsonValue,
    decodeConfig: (value: unknown) => definition.decodeConfig(value) as NewGamePlusJsonValue,
    apply: (context: NewGamePlusModuleApplicationContext, config: NewGamePlusJsonValue) => {
      definition.apply(context, config as Config)
    },
  })
}

export class NewGamePlusValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'NewGamePlusValidationError'
  }
}

export class NewGamePlusApplicationError extends Error {
  readonly moduleId: string

  constructor(moduleId: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    super(`Le module New Game+ ${moduleId} n'a pas pu être appliqué : ${detail}`, { cause })
    this.name = 'NewGamePlusApplicationError'
    this.moduleId = moduleId
  }
}
