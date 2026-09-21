import type { PokemonCatalog } from '../../../ndsTypes'
import type { PokemonInitialTeamResolver } from '../../pokemon/pokemonInitialTeamResolver'
import type { PokemonTeamMember, PokemonTeamPolicy, PokemonTeamVeto } from '../../pokemon/pokemonTeamPolicy'
import { defineNewGamePlusModule } from '../newGamePlusTypes'
import {
  catalogSpeciesHasType,
  requireCatalogSpecies,
  requireHgssSpeciesId,
  requirePersistentPokemonInstanceId,
  requirePokemonTypeId,
  requireStrictArray,
  requireStrictRecord,
} from './teamRuleSerialization'

export const eeveeTeamModuleId = 'eevee-team'
export const eeveeSpeciesId = 133

export type EeveeEvolutionAssignment = Readonly<{
  targetSpeciesId: number
  typeId: number
}>

export type EeveeTeamConfig = Readonly<{
  assignments: readonly EeveeEvolutionAssignment[]
}>

export type EeveeTeamRuntimeMemberState = Readonly<{
  instanceId: string
  targetSpeciesId: number
  typeId: number
}>

export type EeveeTeamRuntimeStateV1 = Readonly<{
  version: 1
  members: readonly EeveeTeamRuntimeMemberState[] | null
}>

export type EeveePermanentDeathLookup = (instanceId: string) => boolean

const eeveeEvolutionTypeBySpecies = new Map<number, number>([
  [134, 11], // Aquali / Eau
  [135, 13], // Voltali / Électrik
  [136, 10], // Pyroli / Feu
  [196, 14], // Mentali / Psy
  [197, 17], // Noctali / Ténèbres
  [470, 12], // Phyllali / Plante
  [471, 15], // Givrali / Glace
])

export const defaultEeveeTeamConfig: EeveeTeamConfig = Object.freeze({
  assignments: Object.freeze([
    Object.freeze({ targetSpeciesId: 134, typeId: 11 }),
    Object.freeze({ targetSpeciesId: 135, typeId: 13 }),
    Object.freeze({ targetSpeciesId: 136, typeId: 10 }),
    Object.freeze({ targetSpeciesId: 196, typeId: 14 }),
    Object.freeze({ targetSpeciesId: 197, typeId: 17 }),
    Object.freeze({ targetSpeciesId: 470, typeId: 12 }),
  ]),
})

function decodeAssignment(value: unknown, label: string): EeveeEvolutionAssignment {
  const assignment = requireStrictRecord(value, ['targetSpeciesId', 'typeId'], label)
  const targetSpeciesId = requireHgssSpeciesId(assignment.targetSpeciesId, `${label}, évolution`)
  const typeId = requirePokemonTypeId(assignment.typeId, `${label}, type`)
  if (eeveeEvolutionTypeBySpecies.get(targetSpeciesId) !== typeId) {
    throw new Error(`${label} n’est pas une affectation d’évolution d’Évoli HGSS valide.`)
  }
  return Object.freeze({ targetSpeciesId, typeId })
}

function requireSixUniqueAssignments(values: unknown, label: string): readonly EeveeEvolutionAssignment[] {
  const serializedValues = requireStrictArray(values, 6, label)
  const assignments = serializedValues.map((value, index) => decodeAssignment(value, `${label} ${index + 1}`))
  if (new Set(assignments.map(({ targetSpeciesId }) => targetSpeciesId)).size !== assignments.length
    || new Set(assignments.map(({ typeId }) => typeId)).size !== assignments.length) {
    throw new Error(`${label} doit attribuer six évolutions et six types distincts.`)
  }
  return Object.freeze(assignments)
}

export function decodeEeveeTeamConfig(value: unknown): EeveeTeamConfig {
  const config = requireStrictRecord(value, ['assignments'], 'La configuration Équipe Évoli')
  return Object.freeze({
    assignments: requireSixUniqueAssignments(config.assignments, 'Les affectations Évoli'),
  })
}

function decodeRuntimeMember(value: unknown, index: number): EeveeTeamRuntimeMemberState {
  const label = `Le membre runtime Évoli ${index + 1}`
  const member = requireStrictRecord(value, ['instanceId', 'targetSpeciesId', 'typeId'], label)
  const assignment = decodeAssignment({
    targetSpeciesId: member.targetSpeciesId,
    typeId: member.typeId,
  }, label)
  return Object.freeze({
    instanceId: requirePersistentPokemonInstanceId(member.instanceId, `${label}, instance`),
    ...assignment,
  })
}

export function decodeEeveeTeamRuntimeState(value: unknown): EeveeTeamRuntimeStateV1 {
  const state = requireStrictRecord(value, ['version', 'members'], 'L’état runtime Équipe Évoli')
  if (state.version !== 1) throw new Error('La version de l’état runtime Équipe Évoli est inconnue.')
  if (state.members === null) return Object.freeze({ version: 1, members: null })
  const serializedMembers = requireStrictArray(state.members, 6, 'Les membres de l’état runtime Équipe Évoli')
  const members = serializedMembers.map(decodeRuntimeMember)
  if (new Set(members.map(({ instanceId }) => instanceId)).size !== members.length) {
    throw new Error('Les six instances runtime Évoli doivent être distinctes.')
  }
  requireSixUniqueAssignments(members.map(({ targetSpeciesId, typeId }) => ({ targetSpeciesId, typeId })), 'Les affectations runtime Évoli')
  return Object.freeze({ version: 1, members: Object.freeze(members) })
}

export type EeveeTeamRuntime = Readonly<{
  config: EeveeTeamConfig
  initialTeamResolver: PokemonInitialTeamResolver
  teamPolicy: PokemonTeamPolicy
  /** À appeler après la publication transactionnelle des six Évoli. */
  bindInitialTeam: (party: readonly PokemonTeamMember[]) => void
  isBound: () => boolean
  snapshot: () => EeveeTeamRuntimeStateV1
}>

const unboundEeveeVeto: PokemonTeamVeto = Object.freeze({
  code: 'eevee-team-unbound',
  reason: 'Les six instances de l’Équipe Évoli ne sont pas encore liées.',
})
const lockedEeveeVeto: PokemonTeamVeto = Object.freeze({
  code: 'eevee-team-locked',
  reason: 'L’Équipe Évoli interdit l’ajout, le remplacement ou le retrait d’un membre vivant.',
})
const evolutionEeveeVeto: PokemonTeamVeto = Object.freeze({
  code: 'eevee-team-evolution-locked',
  reason: 'Cet Évoli ne peut évoluer que vers l’évolution et le type qui lui sont affectés.',
})

function hasSixDistinctEevee(members: readonly PokemonTeamMember[]): boolean {
  return members.length === 6
    && members.every(({ speciesId, instanceId, isEgg, currentHp }) => speciesId === eeveeSpeciesId
      && !isEgg
      && currentHp > 0
      && (() => {
      try {
        requirePersistentPokemonInstanceId(instanceId, 'L’instance Évoli initiale')
        return true
      } catch {
        return false
      }
    })())
    && new Set(members.map(({ instanceId }) => instanceId)).size === 6
}

function assignmentsMatchConfig(
  members: readonly EeveeTeamRuntimeMemberState[],
  config: EeveeTeamConfig,
): boolean {
  return members.every((member, index) => {
    const assignment = config.assignments[index]
    return assignment?.targetSpeciesId === member.targetSpeciesId
      && assignment.typeId === member.typeId
  })
}

export function createEeveeTeamRuntime(
  catalog: PokemonCatalog,
  configValue: unknown = defaultEeveeTeamConfig,
  stateValue?: unknown,
  isPermanentlyDead: EeveePermanentDeathLookup = () => false,
): EeveeTeamRuntime {
  const config = decodeEeveeTeamConfig(configValue)
  requireCatalogSpecies(catalog, eeveeSpeciesId, 'Évoli')
  for (const assignment of config.assignments) {
    requireCatalogSpecies(catalog, assignment.targetSpeciesId, 'L’évolution Évoli')
    if (!catalogSpeciesHasType(catalog, assignment.targetSpeciesId, assignment.typeId)) {
      throw new Error(`L’évolution ${assignment.targetSpeciesId} ne possède pas le type affecté ${assignment.typeId} dans le catalogue.`)
    }
  }
  if (typeof isPermanentlyDead !== 'function') {
    throw new Error('Le lecteur de mort définitive de l’Équipe Évoli est invalide.')
  }

  let boundMembers = stateValue === undefined
    ? null
    : decodeEeveeTeamRuntimeState(stateValue).members
  if (boundMembers && !assignmentsMatchConfig(boundMembers, config)) {
    throw new Error('Les affectations de l’état runtime Évoli ne correspondent pas à sa configuration.')
  }

  const initialTeamResolver: PokemonInitialTeamResolver = Object.freeze(Object.assign(
    (request: Parameters<PokemonInitialTeamResolver>[0]) => Object.freeze(
      config.assignments.map(() => Object.freeze({
        speciesId: eeveeSpeciesId,
        level: request.baseDefinition.level,
        form: 0,
      })),
    ),
    { onInitialTeamCommitted: (party: readonly PokemonTeamMember[]) => bindInitialTeam(party) },
  ))

  const teamPolicy: PokemonTeamPolicy = Object.freeze({
    vetoBattleEligibility: ({ pokemon }) => {
      if (!boundMembers) return unboundEeveeVeto
      const assignment = boundMembers.find(({ instanceId }) => instanceId === pokemon.instanceId)
      if (!assignment) return lockedEeveeVeto
      return pokemon.speciesId === eeveeSpeciesId || pokemon.speciesId === assignment.targetSpeciesId
        ? undefined
        : evolutionEeveeVeto
    },
    vetoPartyMutation: ({ reason, before, after }) => {
      if (!boundMembers) {
        return reason === 'starter' && hasSixDistinctEevee(after) ? undefined : unboundEeveeVeto
      }

      const assignmentById = new Map(boundMembers.map((member) => [member.instanceId, member]))
      const beforeById = new Map(before.map((member) => [member.instanceId, member]))
      const afterIds = after.map(({ instanceId }) => instanceId)
      if (new Set(afterIds).size !== afterIds.length
        || before.some(({ instanceId }) => !assignmentById.has(instanceId))
        || after.some(({ instanceId }) => !assignmentById.has(instanceId))) return lockedEeveeVeto

      for (const previous of before) {
        if (!afterIds.includes(previous.instanceId) && !isPermanentlyDead(previous.instanceId)) return lockedEeveeVeto
      }
      for (const next of after) {
        const assignment = assignmentById.get(next.instanceId)!
        const previous = beforeById.get(next.instanceId)
        if (!previous) return lockedEeveeVeto
        if (next.speciesId !== eeveeSpeciesId && next.speciesId !== assignment.targetSpeciesId) {
          return evolutionEeveeVeto
        }
        if (next.speciesId !== previous.speciesId
          && (reason !== 'evolution'
            || previous.speciesId !== eeveeSpeciesId
            || next.speciesId !== assignment.targetSpeciesId)) return evolutionEeveeVeto
      }
      return undefined
    },
  })

  function bindInitialTeam(party: readonly PokemonTeamMember[]): void {
    if (!hasSixDistinctEevee(party)) {
      throw new Error('L’équipe initiale Évoli doit contenir exactement six instances distinctes d’Évoli.')
    }
    const nextMembers = Object.freeze(party.map(({ instanceId }, index) => Object.freeze({
      instanceId,
      ...config.assignments[index]!,
    })))
    if (boundMembers) {
      if (boundMembers.some((member, index) => member.instanceId !== nextMembers[index]?.instanceId)) {
        throw new Error('Les instances de l’Équipe Évoli sont déjà liées à une autre équipe.')
      }
      return
    }
    boundMembers = nextMembers
  }

  return Object.freeze({
    config,
    initialTeamResolver,
    teamPolicy,
    bindInitialTeam,
    isBound: () => boundMembers !== null,
    snapshot: () => Object.freeze({
      version: 1,
      members: boundMembers && Object.freeze(boundMembers.map((member) => Object.freeze({ ...member }))),
    }),
  })
}

/** Le registre valide les six affectations ; le runtime et ses IDs sont raccordés séparément. */
export const eeveeTeamModule = defineNewGamePlusModule<EeveeTeamConfig>({
  id: eeveeTeamModuleId,
  revision: 1,
  title: 'Équipe Évoli',
  description: 'Commence avec six Évoli, chacun lié à une évolution et un type distincts.',
  enabledByDefault: false,
  createDefaultConfig: () => ({
    assignments: defaultEeveeTeamConfig.assignments.map((assignment) => ({ ...assignment })),
  }),
  decodeConfig: decodeEeveeTeamConfig,
  apply: () => undefined,
})
