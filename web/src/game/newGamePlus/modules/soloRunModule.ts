import type { PokemonCatalog } from '../../../ndsTypes'
import type { PokemonInitialTeamResolver } from '../../pokemon/pokemonInitialTeamResolver'
import type { PokemonTeamMember, PokemonTeamPolicy, PokemonTeamVeto } from '../../pokemon/pokemonTeamPolicy'
import { defineNewGamePlusModule } from '../newGamePlusTypes'
import {
  requireCatalogSpecies,
  requireHgssSpeciesId,
  requirePersistentPokemonInstanceId,
  requirePokemonForm,
  requireStrictRecord,
} from './teamRuleSerialization'

export const soloRunModuleId = 'solo-run'

export type SoloRunConfig = Readonly<{
  speciesId: number
  form: number
}>

export type SoloRunRuntimeStateV1 = Readonly<{
  version: 1
  instanceId: string | null
}>

export const defaultSoloRunConfig: SoloRunConfig = Object.freeze({ speciesId: 152, form: 0 })

export function decodeSoloRunConfig(value: unknown): SoloRunConfig {
  const config = requireStrictRecord(value, ['speciesId', 'form'], 'La configuration Solo Run')
  return Object.freeze({
    speciesId: requireHgssSpeciesId(config.speciesId, 'L’espèce Solo Run'),
    form: requirePokemonForm(config.form, 'La forme Solo Run'),
  })
}

export function decodeSoloRunRuntimeState(value: unknown): SoloRunRuntimeStateV1 {
  const state = requireStrictRecord(value, ['version', 'instanceId'], 'L’état runtime Solo Run')
  if (state.version !== 1) throw new Error('La version de l’état runtime Solo Run est inconnue.')
  return Object.freeze({
    version: 1,
    instanceId: state.instanceId === null
      ? null
      : requirePersistentPokemonInstanceId(state.instanceId, 'L’instance Solo Run'),
  })
}

export type SoloRunTeamRuntime = Readonly<{
  config: SoloRunConfig
  initialTeamResolver: PokemonInitialTeamResolver
  teamPolicy: PokemonTeamPolicy
  /** À appeler après la publication transactionnelle de l’équipe initiale. */
  bindInitialTeam: (party: readonly PokemonTeamMember[]) => void
  isBound: () => boolean
  snapshot: () => SoloRunRuntimeStateV1
}>

const unboundSoloVeto: PokemonTeamVeto = Object.freeze({
  code: 'solo-run-unbound',
  reason: 'L’instance Solo Run n’est pas encore liée à l’équipe initiale.',
})
const lockedSoloVeto: PokemonTeamVeto = Object.freeze({
  code: 'solo-run-team-locked',
  reason: 'L’instance combattante Solo Run ne peut pas être retirée ou remplacée.',
})

function isValidUnboundStarter(
  members: readonly PokemonTeamMember[],
  config: SoloRunConfig,
): boolean {
  const member = members[0]
  return members.length === 1
    && !!member
    && member.speciesId === config.speciesId
    && !member.isEgg
    && member.currentHp > 0
    && requireValidMemberId(member.instanceId)
}

function requireValidMemberId(value: string): boolean {
  try {
    requirePersistentPokemonInstanceId(value, 'L’instance Pokémon initiale')
    return true
  } catch {
    return false
  }
}

/**
 * L’instance est liée explicitement après le commit du starter. Le préflight
 * `PokemonTeamPolicy` reste ainsi pur même si une politique composée plus tard
 * refuse la transaction.
 */
export function createSoloRunTeamRuntime(
  catalog: PokemonCatalog,
  configValue: unknown = defaultSoloRunConfig,
  stateValue?: unknown,
): SoloRunTeamRuntime {
  const config = decodeSoloRunConfig(configValue)
  requireCatalogSpecies(catalog, config.speciesId, 'L’espèce Solo Run')
  let instanceId = stateValue === undefined
    ? null
    : decodeSoloRunRuntimeState(stateValue).instanceId

  const initialTeamResolver: PokemonInitialTeamResolver = Object.freeze(Object.assign(
    (request: Parameters<PokemonInitialTeamResolver>[0]) => Object.freeze([Object.freeze({
      speciesId: config.speciesId,
      level: request.baseDefinition.level,
      form: config.form,
    })]),
    { onInitialTeamCommitted: (party: readonly PokemonTeamMember[]) => bindInitialTeam(party) },
  ))

  const teamPolicy: PokemonTeamPolicy = Object.freeze({
    vetoBattleEligibility: ({ pokemon }) => {
      if (instanceId === null) return unboundSoloVeto
      return pokemon.instanceId === instanceId ? undefined : lockedSoloVeto
    },
    vetoPartyMutation: ({ reason, before, after }) => {
      if (instanceId === null) {
        return reason === 'starter' && isValidUnboundStarter(after, config)
          ? undefined
          : unboundSoloVeto
      }
      const matchingAfter = after.filter((member) => member.instanceId === instanceId)
      const matchingBefore = before.filter((member) => member.instanceId === instanceId)
      const next = matchingAfter[0]
      const previous = matchingBefore[0]
      if (matchingAfter.length !== 1 || matchingBefore.length !== 1 || !next || !previous) return lockedSoloVeto
      if (previous && previous.speciesId !== next.speciesId && reason !== 'evolution') return lockedSoloVeto
      return undefined
    },
  })

  function bindInitialTeam(party: readonly PokemonTeamMember[]): void {
    if (!isValidUnboundStarter(party, config)) {
      throw new Error('L’équipe initiale Solo Run doit contenir exactement l’espèce configurée avec une instance valide.')
    }
    const nextInstanceId = party[0]!.instanceId
    if (instanceId !== null && instanceId !== nextInstanceId) {
      throw new Error('L’instance Solo Run est déjà liée à un autre Pokémon.')
    }
    instanceId = nextInstanceId
  }

  return Object.freeze({
    config,
    initialTeamResolver,
    teamPolicy,
    bindInitialTeam,
    isBound: () => instanceId !== null,
    snapshot: () => Object.freeze({ version: 1, instanceId }),
  })
}

/** Le registre conserve la sélection ; la composition crée ensuite son runtime stateful. */
export const soloRunModule = defineNewGamePlusModule<SoloRunConfig>({
  id: soloRunModuleId,
  revision: 1,
  title: 'Solo Run',
  description: 'Commence avec l’espèce choisie et verrouille cette instance comme unique combattant autorisé.',
  enabledByDefault: false,
  createDefaultConfig: () => ({ ...defaultSoloRunConfig }),
  decodeConfig: decodeSoloRunConfig,
  apply: () => undefined,
})
