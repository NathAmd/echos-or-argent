import type { PokemonCatalog } from '../../../ndsTypes'
import { getExperienceForLevel } from '../../../rom/pokemon/growthTable'
import type { HgssTrainerPokemon } from '../../../rom/battle/trainerData'
import type {
  FieldBattleRosterPolicy,
  FieldTrainerHouseRosterContext,
  FieldTrainerRosterContext,
} from '../../battle/fieldBattleRosterPolicy'
import {
  createFieldWildEncounterIdentityPort,
  type FieldWildEncounterIdentityPort,
} from '../../encounters/fieldWildEncounterIdentityPort'
import type { CanonicalPokemon } from '../../pokemon/canonicalPokemon'
import {
  calculatePokemonStats,
  getAbilityFromPersonality,
  getGenderFromPersonality,
  resolvePokemonPersonalData,
} from '../../pokemon/pokemonFormulas'
import type { PokemonInitialTeamResolver } from '../../pokemon/pokemonInitialTeamResolver'
import { defineNewGamePlusModule } from '../newGamePlusTypes'
import { requireStrictRecord } from './teamRuleSerialization'

export const randomizerModuleId = 'randomizer'
export const randomizerMappingVersion = 1

export type RandomizerConfig = Readonly<{
  /** Le seed est public et stocke tel quel dans le profil NG+ ; ce n'est pas un secret. */
  seed: string
  /** Atteste une chaîne de configuration indépendante de tout texte résolu depuis la ROM. */
  seedSource?: 'config-text'
}>

export const defaultRandomizerConfig: RandomizerConfig = Object.freeze({
  seed: 'pokemaster-ng-plus',
  seedSource: 'config-text',
})

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0)!
    return codePoint <= 0x1f || codePoint === 0x7f
  })
}

function requireRandomizerSeed(value: unknown): string {
  if (typeof value !== 'string'
    || value.length < 1
    || value.length > 128
    || value.trim() !== value
    || value.normalize('NFC') !== value
    || containsControlCharacter(value)) {
    throw new Error(
      'Le seed Randomizer doit être une chaîne NFC visible de 1 à 128 caractères, sans espaces de bord ni contrôle.',
    )
  }
  return value
}

/** Décode une configuration JSON sans accepter de champs, prototypes ou accesseurs implicites. */
export function decodeRandomizerConfig(value: unknown): RandomizerConfig {
  const hasSeedSource = !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.hasOwn(value, 'seedSource')
  const config = requireStrictRecord(
    value,
    hasSeedSource ? ['seed', 'seedSource'] : ['seed'],
    'La configuration Randomizer',
  )
  if (hasSeedSource && config.seedSource !== 'config-text') {
    throw new Error('La provenance du seed Randomizer doit être « config-text ».')
  }
  return Object.freeze({ seed: requireRandomizerSeed(config.seed), seedSource: 'config-text' })
}

function collectAvailableSpeciesIds(catalog: PokemonCatalog): readonly number[] {
  const speciesIds: number[] = []
  for (let speciesId = 1; speciesId <= 493; speciesId += 1) {
    const personal = catalog.personalData[speciesId]
    if (personal?.speciesId !== speciesId
      || !catalog.speciesNames[speciesId]
      || !catalog.growthTables[personal.growthRate]
      || !catalog.levelUpLearnsets[speciesId]) continue
    speciesIds.push(speciesId)
  }
  if (speciesIds.length === 0) {
    throw new Error('Le catalogue Pokémon ne contient aucune espèce HGSS complète entre 1 et 493.')
  }
  return Object.freeze(speciesIds)
}

/**
 * FNV-1a 32 bits suivi d'une avalanche fixe. Les deux octets de chaque unité
 * UTF-16 sont intégrés explicitement : le résultat ne dépend ni de la locale,
 * ni du moteur, ni du RNG HGSS/JavaScript.
 */
function stableHash32(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    hash = Math.imul(hash ^ (codeUnit & 0xff), 0x01000193)
    hash = Math.imul(hash ^ (codeUnit >>> 8), 0x01000193)
  }
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x85ebca6b)
  hash ^= hash >>> 13
  hash = Math.imul(hash, 0xc2b2ae35)
  return (hash ^ (hash >>> 16)) >>> 0
}

type RandomizerDomain = 'starter' | 'wild' | 'trainer' | 'trainer-house'

function createSpeciesMapper(config: RandomizerConfig, speciesIds: readonly number[]) {
  return (domain: RandomizerDomain, identity: readonly (string | number)[]): number => {
    const stableKey = JSON.stringify([
      'pokemaster-ng-plus-randomizer',
      randomizerMappingVersion,
      config.seed,
      domain,
      ...identity,
    ])
    return speciesIds[stableHash32(stableKey) % speciesIds.length]!
  }
}

function requireTrainerContext(context: FieldTrainerRosterContext): void {
  if (!Number.isSafeInteger(context.trainerId) || context.trainerId < 0 || context.trainerId > 0xffffffff) {
    throw new Error(`L’identifiant de Dresseur Randomizer ${context.trainerId} est invalide.`)
  }
  if (!['trainer', 'tag-trainer', 'multi-trainer'].includes(context.battleKind)
    || !['ally', 'opponent'].includes(context.role)) {
    throw new Error('Le contexte de Dresseur Randomizer est invalide.')
  }
}

function requireTrainerHouseContext(context: FieldTrainerHouseRosterContext): void {
  if (!Number.isSafeInteger(context.trainerId) || context.trainerId < 0 || context.trainerId > 0xffffffff) {
    throw new Error(`L’identifiant de Maison des Dresseurs Randomizer ${context.trainerId} est invalide.`)
  }
  if (!Number.isSafeInteger(context.trainerHouseSlot)
    || context.trainerHouseSlot < 0
    || context.trainerHouseSlot > 0xffff
    || context.battleKind !== 'trainer-house'
    || context.role !== 'opponent') {
    throw new Error('Le contexte de Maison des Dresseurs Randomizer est invalide.')
  }
}

function randomizeTrainerPokemon(
  pokemon: Readonly<HgssTrainerPokemon>,
  speciesId: number,
): Readonly<HgssTrainerPokemon> {
  if (speciesId === pokemon.speciesId) return pokemon
  return Object.freeze({ ...pokemon, speciesId, form: 0 })
}

function randomizeTrainerHousePokemon(
  pokemon: CanonicalPokemon,
  speciesId: number,
  catalog: PokemonCatalog,
): CanonicalPokemon {
  if (speciesId === pokemon.speciesId) return pokemon
  const personal = resolvePokemonPersonalData(catalog, speciesId, 0)
  const growthTable = catalog.growthTables[personal.growthRate]
  const speciesName = catalog.speciesNames[speciesId]
  if (!growthTable || !speciesName) {
    throw new Error(`L’espèce Randomizer ${speciesId} est incomplète dans le catalogue.`)
  }
  const stats = calculatePokemonStats(
    personal,
    pokemon.level,
    pokemon.individualValues,
    pokemon.effortValues,
    pokemon.nature,
  )
  const previousMaximumHp = Math.max(1, pokemon.stats.hp)
  const hpRatio = Math.max(0, Math.min(1, pokemon.currentHp / previousMaximumHp))
  const currentHp = pokemon.currentHp <= 0
    ? 0
    : Math.max(1, Math.min(stats.hp, Math.round(stats.hp * hpRatio)))
  return {
    ...pokemon,
    speciesId,
    speciesName,
    form: 0,
    experience: getExperienceForLevel(growthTable, pokemon.level),
    gender: getGenderFromPersonality(personal, pokemon.personality),
    abilityId: getAbilityFromPersonality(personal, pokemon.personality),
    stats,
    currentHp,
  }
}

export type RandomizerRuntime = Readonly<{
  config: RandomizerConfig
  availableSpeciesIds: readonly number[]
  initialTeamResolver: PokemonInitialTeamResolver
  fieldWildEncounterIdentityPort: FieldWildEncounterIdentityPort
  fieldBattleRosterPolicy: FieldBattleRosterPolicy
}>

export type RandomizerRuntimeOptions = Readonly<{
  /** Filtre seulement le starter, notamment pour composer Monotype. */
  isStarterSpeciesAllowed?: (speciesId: number) => boolean
  /** Un mode d'équipe explicite (Solo/Évoli) reste propriétaire du starter. */
  preserveExplicitInitialTeam?: boolean
}>

/**
 * Runtime pur : une identité complète produit toujours la même espèce. Les
 * Pokémon fuyards et sauvages scriptés restent natifs, car leur espèce peut
 * être reliée à des drapeaux, scripts ou états persistants de la campagne.
 */
export function createRandomizerRuntime(
  catalog: PokemonCatalog,
  configValue: unknown = defaultRandomizerConfig,
  options: RandomizerRuntimeOptions = {},
): RandomizerRuntime {
  const config = decodeRandomizerConfig(configValue)
  const availableSpeciesIds = collectAvailableSpeciesIds(catalog)
  const mapSpecies = createSpeciesMapper(config, availableSpeciesIds)
  const starterSpeciesIds = options.isStarterSpeciesAllowed
    ? availableSpeciesIds.filter(options.isStarterSpeciesAllowed)
    : availableSpeciesIds
  if (starterSpeciesIds.length === 0) throw new Error('Le Randomizer ne possède aucun starter compatible avec les autres règles.')
  const mapStarterSpecies = createSpeciesMapper(config, starterSpeciesIds)

  const initialTeamResolver: PokemonInitialTeamResolver = Object.freeze((request, currentTeam) => {
    const nativeDefinition = request.baseDefinition
    const input = currentTeam.length === 0 ? [nativeDefinition] : currentTeam
    if (options.preserveExplicitInitialTeam) return currentTeam.length === 0 ? input : currentTeam
    const isNativeStarter = input.length === 1
      && input[0]?.speciesId === nativeDefinition.speciesId
      && input[0].level === nativeDefinition.level
      && input[0].form === nativeDefinition.form
    // Les modes d'équipe explicites (Solo Run / Équipe Évoli) gardent la
    // priorité, quel que soit l'ordre de composition des modules.
    if (!isNativeStarter) return currentTeam
    const speciesId = mapStarterSpecies('starter', [request.choice])
    return Object.freeze([Object.freeze({
      speciesId,
      level: nativeDefinition.level,
      form: speciesId === nativeDefinition.speciesId ? nativeDefinition.form : 0,
    })])
  })

  const validateUnchangedWildIdentity = createFieldWildEncounterIdentityPort((identity) => identity)
  const randomizeWildIdentity = createFieldWildEncounterIdentityPort((identity, context) => ({
    speciesId: mapSpecies('wild', [context.mapId, context.source, identity.speciesId, identity.level]),
    level: identity.level,
  }))
  const fieldWildEncounterIdentityPort: FieldWildEncounterIdentityPort = (prepared, context) => (
    prepared.encounter.method === 'roamer'
      ? validateUnchangedWildIdentity(prepared, context)
      : randomizeWildIdentity(prepared, context)
  )

  const fieldBattleRosterPolicy: FieldBattleRosterPolicy = Object.freeze({
    transformTrainerParty: (party, context) => {
      requireTrainerContext(context)
      return Object.freeze(party.map((pokemon, slot) => randomizeTrainerPokemon(
        pokemon,
        mapSpecies('trainer', [context.trainerId, slot]),
      )))
    },
    transformTrainerHouseParty: (party, context) => {
      requireTrainerHouseContext(context)
      return Object.freeze(party.map((pokemon, slot) => randomizeTrainerHousePokemon(
        pokemon,
        mapSpecies('trainer-house', [context.trainerId, slot]),
        catalog,
      )))
    },
    // Les légendaires et autres Pokémon scriptés sont laissés intacts pour
    // conserver les conditions de progression HGSS qui dépendent de l'espèce.
    transformScriptedWildPokemon: (pokemon) => pokemon,
  })

  return Object.freeze({
    config,
    availableSpeciesIds,
    initialTeamResolver,
    fieldWildEncounterIdentityPort,
    fieldBattleRosterPolicy,
  })
}

/** Le module est optionnel ; sa contribution runtime est branchée par le compositeur NG+. */
export const randomizerModule = defineNewGamePlusModule<RandomizerConfig>({
  id: randomizerModuleId,
  revision: 1,
  title: 'Randomizer',
  description: 'Randomise starters, rencontres et Dresseurs avec un seed public stable, sans toucher au RNG du jeu.',
  enabledByDefault: false,
  createDefaultConfig: () => ({ ...defaultRandomizerConfig }),
  decodeConfig: decodeRandomizerConfig,
  apply: () => undefined,
})
