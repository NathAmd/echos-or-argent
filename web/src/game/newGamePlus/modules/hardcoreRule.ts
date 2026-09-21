import {
  baseBattleActionPolicy,
  type BattleActionPolicy,
  type BattleActionVeto,
} from '../../battle/battleActionPolicy'
import {
  basePokemonLevelPolicy,
  type PokemonLevelPolicy,
} from '../../pokemon/pokemonLevelPolicy'
import {
  defineVersionedSaveExtension,
  type VersionedSaveExtensionContributor,
} from '../../save/versionedSaveExtensions'
import {
  decodeHardcoreConfig,
  defaultHardcoreConfig,
  type HardcoreConfig,
  type HardcoreLevelCapStage,
} from './hardcoreModule'
import {
  createInitialHardcoreState,
  isHardcoreStateV1,
  parseHardcoreStateV1,
  type HardcoreStateV1,
} from './hardcoreState'

export const hardcoreSaveExtensionKey = 'new-game-plus.hardcore'
export const hardcoreSaveExtensionVersion = 1

type HardcoreRuntimeCommonOptions = Readonly<{
  config?: unknown
  state?: unknown
}>

export type HardcoreRuntimeOptions =
  | (HardcoreRuntimeCommonOptions & Readonly<{
    enabled: true
    /** Retourne la progression campagne correspondant aux seuils de config. */
    readProgression: () => number
  }>)
  | (HardcoreRuntimeCommonOptions & Readonly<{
    enabled: false
    readProgression?: () => number
  }>)

export type HardcoreRuntime = Readonly<{
  enabled: boolean
  config: HardcoreConfig
  battleActionPolicy: BattleActionPolicy
  pokemonLevelPolicy: PokemonLevelPolicy
  readActiveLevelCap: () => HardcoreLevelCapStage
  snapshotState: () => HardcoreStateV1 | undefined
  restoreState: (value: unknown) => void
}>

const bagVeto: BattleActionVeto = Object.freeze({
  code: 'new-game-plus.hardcore.bag-forbidden',
  reason: 'Le mode Hardcore interdit le sac pendant un combat.',
})

const voluntarySwitchVeto: BattleActionVeto = Object.freeze({
  code: 'new-game-plus.hardcore.free-switch-forbidden',
  reason: 'Le mode Hardcore interdit le changement gratuit avant le prochain Pokémon adverse.',
})

function requireProgression(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error('Le lecteur de progression Hardcore doit retourner un entier positif ou nul.')
  }
  return value as number
}

function resolveStage(config: HardcoreConfig, progression: number): HardcoreLevelCapStage {
  let active = config.levelCaps[0]!
  for (const stage of config.levelCaps) {
    if (stage.progression > progression) break
    active = stage
  }
  return active
}

/**
 * Construit uniquement les restrictions Hardcore. Il ne fournit délibérément
 * aucun observateur Nuzlocke, aucune règle de capture et aucune politique de
 * décès permanent.
 *
 * Le jeu actuel enchaîne déjà automatiquement le prochain Pokémon adverse.
 * Le mode distinct garde le contrat exact si une présentation de choix gratuit
 * est ajoutée plus tard, sans interdire un changement volontaire coûtant un tour.
 */
export function createHardcoreRuntime(options: HardcoreRuntimeOptions): HardcoreRuntime {
  const config = decodeHardcoreConfig(options.config ?? defaultHardcoreConfig)
  const initialState = options.state === undefined
    ? createInitialHardcoreState()
    : parseHardcoreStateV1(options.state)
  let highestProgression = initialState.highestProgression

  const observeProgression = (): number => {
    if (!options.enabled) return highestProgression
    highestProgression = Math.max(highestProgression, requireProgression(options.readProgression()))
    return highestProgression
  }
  const readActiveLevelCap = (): HardcoreLevelCapStage => resolveStage(config, observeProgression())
  const restoreState = (value: unknown): void => {
    const parsed = parseHardcoreStateV1(value)
    highestProgression = parsed.highestProgression
  }

  if (!options.enabled) {
    return Object.freeze({
      enabled: false,
      config,
      battleActionPolicy: baseBattleActionPolicy,
      pokemonLevelPolicy: basePokemonLevelPolicy,
      readActiveLevelCap,
      snapshotState: () => undefined,
      restoreState,
    })
  }

  const battleActionPolicy: BattleActionPolicy = Object.freeze({
    vetoPlayerAction(intent) {
      // Une Ball est la mécanique de capture, pas un consommable tactique :
      // la bloquer rendrait Nuzlocke et Tous-les-Pokémon impossibles.
      if (intent.kind === 'bag' && intent.role !== 'capture') return bagVeto
      if (intent.kind === 'switch' && intent.mode === 'free-between-opponents') return voluntarySwitchVeto
      return undefined
    },
  })
  const pokemonLevelPolicy: PokemonLevelPolicy = Object.freeze({
    resolveLevelCap: () => readActiveLevelCap().levelCap,
  })

  return Object.freeze({
    enabled: true,
    config,
    battleActionPolicy,
    pokemonLevelPolicy,
    readActiveLevelCap,
    snapshotState: () => Object.freeze({
      ...createInitialHardcoreState(),
      highestProgression: observeProgression(),
    }),
    restoreState,
  })
}

export const hardcoreSaveExtension: VersionedSaveExtensionContributor<HardcoreRuntime, HardcoreRuntime> =
  defineVersionedSaveExtension<HardcoreRuntime, HardcoreRuntime, HardcoreStateV1>({
    key: hardcoreSaveExtensionKey,
    version: hardcoreSaveExtensionVersion,
    save: (runtime) => runtime.snapshotState(),
    validate: isHardcoreStateV1,
    load: (runtime, value) => runtime.restoreState(value),
  })
