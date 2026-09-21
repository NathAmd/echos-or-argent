import type { PokemonCatalog } from '../../../ndsTypes'
import type { PokemonInitialTeamResolver } from '../../pokemon/pokemonInitialTeamResolver'
import type { PokemonTeamPolicy, PokemonTeamVeto } from '../../pokemon/pokemonTeamPolicy'
import { defineNewGamePlusModule } from '../newGamePlusTypes'
import {
  catalogSpeciesHasType,
  freezeArray,
  requirePokemonTypeId,
  requireStrictRecord,
} from './teamRuleSerialization'

export const monotypeModuleId = 'monotype'

export type MonotypeConfig = Readonly<{
  typeId: number
}>

export type MonotypeRuntimeStateV1 = Readonly<{
  version: 1
  typeId: number
}>

export const defaultMonotypeConfig: MonotypeConfig = Object.freeze({ typeId: 12 })

export function decodeMonotypeConfig(value: unknown): MonotypeConfig {
  const config = requireStrictRecord(value, ['typeId'], 'La configuration Monotype')
  return Object.freeze({
    typeId: requirePokemonTypeId(config.typeId, 'Le type Monotype'),
  })
}

export function decodeMonotypeRuntimeState(value: unknown): MonotypeRuntimeStateV1 {
  const state = requireStrictRecord(value, ['version', 'typeId'], 'L’état runtime Monotype')
  if (state.version !== 1) throw new Error('La version de l’état runtime Monotype est inconnue.')
  return Object.freeze({
    version: 1,
    typeId: requirePokemonTypeId(state.typeId, 'Le type de l’état runtime Monotype'),
  })
}

export type MonotypeTeamRuntime = Readonly<{
  config: MonotypeConfig
  initialTeamResolver: PokemonInitialTeamResolver
  teamPolicy: PokemonTeamPolicy
  snapshot: () => MonotypeRuntimeStateV1
}>

function isCompleteMonotypeStarterSpecies(
  catalog: PokemonCatalog,
  speciesId: number,
  typeId: number,
): boolean {
  const personal = catalog.personalData[speciesId]
  return personal?.speciesId === speciesId
    && personal.types.includes(typeId)
    && Boolean(catalog.speciesNames[speciesId])
    && Boolean(catalog.growthTables[personal.growthRate])
    && Boolean(catalog.levelUpLearnsets[speciesId])
}

/** Utilise exactement le même critère de complétude que le starter Monotype. */
export function hasCompleteMonotypeStarterSpecies(
  catalog: PokemonCatalog,
  typeId: number,
): boolean {
  const resolvedTypeId = requirePokemonTypeId(typeId, 'Le type Monotype proposé')
  for (let speciesId = 1; speciesId <= 493; speciesId += 1) {
    if (isCompleteMonotypeStarterSpecies(catalog, speciesId, resolvedTypeId)) return true
  }
  return false
}

function collectMonotypeStarterSpeciesIds(
  catalog: PokemonCatalog,
  typeId: number,
): readonly number[] {
  const speciesIds: number[] = []
  for (let speciesId = 1; speciesId <= 493; speciesId += 1) {
    if (isCompleteMonotypeStarterSpecies(catalog, speciesId, typeId)) speciesIds.push(speciesId)
  }
  if (speciesIds.length === 0) {
    throw new Error(`Le catalogue Pokémon ne contient aucun starter complet du type Monotype ${typeId}.`)
  }
  return Object.freeze(speciesIds)
}

function monotypeVeto(typeId: number, speciesId: number): PokemonTeamVeto {
  return Object.freeze({
    code: 'monotype-species-type',
    reason: `L’espèce ${speciesId} ne possède pas le type Monotype ${typeId}.`,
  })
}

/**
 * Construit les deux contributions Monotype sans modifier le catalogue ROM.
 * `types.includes` accepte naturellement le type primaire comme le type secondaire.
 */
export function createMonotypeTeamRuntime(
  catalog: PokemonCatalog,
  configValue: unknown = defaultMonotypeConfig,
  stateValue?: unknown,
): MonotypeTeamRuntime {
  const config = decodeMonotypeConfig(configValue)
  const state = stateValue === undefined
    ? Object.freeze({ version: 1 as const, typeId: config.typeId })
    : decodeMonotypeRuntimeState(stateValue)
  if (state.typeId !== config.typeId) {
    throw new Error('Le type de l’état runtime Monotype ne correspond pas à sa configuration.')
  }
  const starterSpeciesIds = collectMonotypeStarterSpeciesIds(catalog, config.typeId)

  const initialTeamResolver: PokemonInitialTeamResolver = (request, currentTeam) => {
    const resolved = currentTeam.length > 0 ? currentTeam : [request.baseDefinition]
    return freezeArray(resolved.map((definition, index) => {
      if (catalogSpeciesHasType(catalog, definition.speciesId, config.typeId)) {
        return Object.freeze({ ...definition })
      }
      return Object.freeze({
        ...definition,
        speciesId: starterSpeciesIds[(request.choice + index) % starterSpeciesIds.length]!,
        form: 0,
      })
    }))
  }

  const teamPolicy: PokemonTeamPolicy = Object.freeze({
    vetoBattleEligibility: ({ pokemon }) => (
      catalogSpeciesHasType(catalog, pokemon.speciesId, config.typeId)
        ? undefined
        : monotypeVeto(config.typeId, pokemon.speciesId)
    ),
    // Les espèces hors type peuvent toujours être acquises et stockées. Une
    // évolution ne peut toutefois pas faire perdre son type à un membre qui
    // respectait jusque-là la règle Monotype.
    vetoPartyMutation: ({ reason, before, after }) => {
      if (reason !== 'evolution') return undefined
      const beforeById = new Map(before.map((pokemon) => [pokemon.instanceId, pokemon]))
      for (const pokemon of after) {
        const previous = beforeById.get(pokemon.instanceId)
        if (previous && previous.speciesId !== pokemon.speciesId
          && catalogSpeciesHasType(catalog, previous.speciesId, config.typeId)
          && !catalogSpeciesHasType(catalog, pokemon.speciesId, config.typeId)) {
          return monotypeVeto(config.typeId, pokemon.speciesId)
        }
      }
      return undefined
    },
  })

  return Object.freeze({
    config,
    initialTeamResolver,
    teamPolicy,
    snapshot: () => Object.freeze({ ...state }),
  })
}

/** Le registre conserve la configuration ; le runtime est branché séparément par la composition NG+. */
export const monotypeModule = defineNewGamePlusModule<MonotypeConfig>({
  id: monotypeModuleId,
  revision: 1,
  title: 'Monotype',
  description: 'Seuls les Pokémon possédant le type choisi peuvent combattre ; les autres vont au PC.',
  enabledByDefault: false,
  createDefaultConfig: () => ({ ...defaultMonotypeConfig }),
  decodeConfig: decodeMonotypeConfig,
  apply: () => undefined,
})
