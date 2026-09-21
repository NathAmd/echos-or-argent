import { defineNewGamePlusModule } from '../newGamePlusTypes'
import { requireStrictRecord } from './teamRuleSerialization'

export const visibleWildPokemonModuleId = 'visible-wild-pokemon'

export type VisibleWildPokemonMovement = 'stationary' | 'wander'

export type VisibleWildPokemonConfig = Readonly<{
  /** Seed public : il stabilise le choix et la position des acteurs visibles. */
  seed: string
  /** Atteste une chaîne de configuration indépendante de tout texte résolu depuis la ROM. */
  seedSource?: 'config-text'
  actorsPerMap: number
  includeSafari: boolean
  movement: VisibleWildPokemonMovement
}>

export const defaultVisibleWildPokemonConfig: VisibleWildPokemonConfig = Object.freeze({
  seed: 'pokemaster-visible-wild-v1',
  seedSource: 'config-text',
  actorsPerMap: 3,
  includeSafari: true,
  movement: 'wander',
})

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0)!
    return codePoint <= 0x1f || codePoint === 0x7f
  })
}

function requireSeed(value: unknown): string {
  if (typeof value !== 'string'
    || value.length < 1
    || value.length > 128
    || value.trim() !== value
    || value.normalize('NFC') !== value
    || containsControlCharacter(value)) {
    throw new Error(
      'Le seed des Pokémon visibles doit être une chaîne NFC visible de 1 à 128 caractères, sans espaces de bord ni contrôle.',
    )
  }
  return value
}

export function decodeVisibleWildPokemonConfig(value: unknown): VisibleWildPokemonConfig {
  const hasSeedSource = !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.hasOwn(value, 'seedSource')
  const config = requireStrictRecord(
    value,
    hasSeedSource
      ? ['actorsPerMap', 'includeSafari', 'movement', 'seed', 'seedSource']
      : ['actorsPerMap', 'includeSafari', 'movement', 'seed'],
    'La configuration Pokémon visibles',
  )
  if (hasSeedSource && config.seedSource !== 'config-text') {
    throw new Error('La provenance du seed des Pokémon visibles doit être « config-text ».')
  }
  if (!Number.isSafeInteger(config.actorsPerMap)
    || (config.actorsPerMap as number) < 1
    || (config.actorsPerMap as number) > 8) {
    throw new Error('Le nombre de Pokémon visibles par carte doit être compris entre 1 et 8.')
  }
  if (typeof config.includeSafari !== 'boolean') {
    throw new Error("L'inclusion du Safari dans les Pokémon visibles doit être un booléen.")
  }
  if (config.movement !== 'stationary' && config.movement !== 'wander') {
    throw new Error('Le mouvement des Pokémon visibles doit être « stationary » ou « wander ».')
  }
  return Object.freeze({
    seed: requireSeed(config.seed),
    seedSource: 'config-text',
    actorsPerMap: config.actorsPerMap as number,
    includeSafari: config.includeSafari,
    movement: config.movement,
  })
}

/** Marqueur de profil ; le runtime monde est monté séparément et reste optionnel. */
export const visibleWildPokemonModule = defineNewGamePlusModule<VisibleWildPokemonConfig>({
  id: visibleWildPokemonModuleId,
  revision: 1,
  title: 'Pokémon visibles',
  description: 'Matérialise des rencontres sauvages préparées comme acteurs du monde, y compris au Safari si demandé.',
  enabledByDefault: false,
  createDefaultConfig: () => ({ ...defaultVisibleWildPokemonConfig }),
  decodeConfig: decodeVisibleWildPokemonConfig,
  apply: () => undefined,
})
