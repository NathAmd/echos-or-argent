import {
  noopDetailedBattleOutcomeObserver,
  type DetailedBattleOutcomeEvent,
  type DetailedBattleOutcomeObserver,
} from '../../battle/battleOutcomeObserver'
import {
  basePokemonPartyHealingPolicy,
  type PokemonPartyHealingPolicy,
} from '../../pokemon/pokemonPartyHealingPolicy'
import {
  basePokemonTeamPolicy,
  type PokemonTeamPolicy,
  type PokemonTeamVeto,
} from '../../pokemon/pokemonTeamPolicy'
import {
  defineVersionedSaveExtension,
  type VersionedSaveExtensionContributor,
} from '../../save/versionedSaveExtensions'
import {
  createEmptyPermanentDeathState,
  isPermanentDeathStateV1,
  parsePermanentDeathStateV1,
  type PermanentDeathStateV1,
} from './permanentDeathState'

export const permanentDeathSaveExtensionKey = 'new-game-plus.permanent-death'
export const permanentDeathSaveExtensionVersion = 1

export type PermanentDeathRuntimeOptions = Readonly<{
  /** L'appelant lie cette valeur à la présence du module dans le profil. */
  enabled: boolean
  state?: unknown
}>

export type PermanentDeathRuntime = Readonly<{
  enabled: boolean
  detailedBattleOutcomeObserver: DetailedBattleOutcomeObserver
  teamPolicy: PokemonTeamPolicy
  healingPolicy: PokemonPartyHealingPolicy
  isPermanentlyDead: (instanceId: string) => boolean
  snapshotState: () => PermanentDeathStateV1 | undefined
  restoreState: (value: unknown) => void
}>

const deadBattleVeto: PokemonTeamVeto = Object.freeze({
  code: 'new-game-plus.permanent-death.battle-forbidden',
  reason: 'Ce Pokémon est définitivement K.O. et ne peut plus combattre.',
})
const returnToPartyVeto: PokemonTeamVeto = Object.freeze({
  code: 'new-game-plus.permanent-death.return-to-party-forbidden',
  reason: "Un Pokémon définitivement K.O. ne peut pas revenir dans l'équipe.",
})
const deadHealingVeto = Object.freeze({
  code: 'new-game-plus.permanent-death.healing-forbidden',
  reason: 'Un Pokémon définitivement K.O. ne peut plus être soigné.',
})

function snapshot(deadPokemonInstanceIds: ReadonlySet<string>): PermanentDeathStateV1 {
  return parsePermanentDeathStateV1({
    ...createEmptyPermanentDeathState(),
    deadPokemonInstanceIds: [...deadPokemonInstanceIds].sort(),
  })
}

/**
 * Runtime autonome de la règle. Un KO joueur devient définitif au moment où
 * l'événement détaillé est publié, indépendamment de l'issue du combat.
 */
export function createPermanentDeathRuntime(options: PermanentDeathRuntimeOptions): PermanentDeathRuntime {
  const initialState = options.state === undefined
    ? createEmptyPermanentDeathState()
    : parsePermanentDeathStateV1(options.state)
  let deadPokemonInstanceIds = new Set<string>(initialState.deadPokemonInstanceIds)

  const restoreState = (value: unknown): void => {
    const parsed = parsePermanentDeathStateV1(value)
    deadPokemonInstanceIds = new Set(parsed.deadPokemonInstanceIds)
  }
  const isPermanentlyDead = (instanceId: string): boolean => deadPokemonInstanceIds.has(instanceId)

  if (!options.enabled) {
    return Object.freeze({
      enabled: false,
      detailedBattleOutcomeObserver: noopDetailedBattleOutcomeObserver,
      teamPolicy: basePokemonTeamPolicy,
      healingPolicy: basePokemonPartyHealingPolicy,
      isPermanentlyDead,
      snapshotState: () => undefined,
      restoreState,
    })
  }

  const detailedBattleOutcomeObserver: DetailedBattleOutcomeObserver = Object.freeze({
    observeBattleOutcome(event: DetailedBattleOutcomeEvent) {
      if (event.kind === 'pokemon-knocked-out' && event.pokemon.side === 'player') {
        deadPokemonInstanceIds.add(event.pokemon.instanceId)
      }
    },
  })

  const teamPolicy: PokemonTeamPolicy = Object.freeze({
    vetoBattleEligibility: ({ pokemon }) => (
      isPermanentlyDead(pokemon.instanceId) ? deadBattleVeto : undefined
    ),
    vetoPartyMutation: ({ before, after }) => {
      const previousInstanceIds = new Set(before.map(({ instanceId }) => instanceId))
      return after.some(({ instanceId }) => (
        isPermanentlyDead(instanceId) && !previousInstanceIds.has(instanceId)
      ))
        ? returnToPartyVeto
        : undefined
    },
  })

  const healingPolicy: PokemonPartyHealingPolicy = Object.freeze({
    vetoFullHealRestoration: ({ pokemon }) => (
      isPermanentlyDead(pokemon.instanceId) ? deadHealingVeto : undefined
    ),
  })

  return Object.freeze({
    enabled: true,
    detailedBattleOutcomeObserver,
    teamPolicy,
    healingPolicy,
    isPermanentlyDead,
    snapshotState: () => snapshot(deadPokemonInstanceIds),
    restoreState,
  })
}

/** Contributeur monté uniquement lorsque le module est sélectionné. */
export const permanentDeathSaveExtension: VersionedSaveExtensionContributor<
  PermanentDeathRuntime,
  PermanentDeathRuntime
> =
  defineVersionedSaveExtension<PermanentDeathRuntime, PermanentDeathRuntime, PermanentDeathStateV1>({
    key: permanentDeathSaveExtensionKey,
    version: permanentDeathSaveExtensionVersion,
    save: (runtime) => runtime.snapshotState(),
    validate: isPermanentDeathStateV1,
    load: (runtime, value) => runtime.restoreState(value),
  })
