import type { PokemonStatValues } from './pokemonFormulas'

export const pokemonTrainingStatKeys = [
  'hp',
  'attack',
  'defense',
  'specialAttack',
  'specialDefense',
  'speed',
] as const satisfies readonly (keyof PokemonStatValues)[]

export const pokemonIndividualValueMaximum = 31
export const pokemonEffortValueMaximum = 255
export const pokemonEffortValueTotalMaximum = 510
const pokemonNatureStatKeys = ['attack', 'defense', 'speed', 'specialAttack', 'specialDefense'] as const

export function calculatePokemonIvScore(individualValues: PokemonStatValues): number {
  const maximumTotal = pokemonTrainingStatKeys.length * pokemonIndividualValueMaximum
  const total = pokemonTrainingStatKeys.reduce((sum, stat) => (
    sum + Math.max(0, Math.min(pokemonIndividualValueMaximum, individualValues[stat]))
  ), 0)
  return Math.round(total / maximumTotal * 100) / 10
}

export function formatPokemonIvScore(individualValues: PokemonStatValues): string {
  return calculatePokemonIvScore(individualValues).toLocaleString('fr-FR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
}

export function calculatePokemonEvTotal(effortValues: PokemonStatValues): number {
  return pokemonTrainingStatKeys.reduce((sum, stat) => sum + effortValues[stat], 0)
}

export function resolvePokemonNatureStatModifier(nature: number, stat: keyof PokemonStatValues): -1 | 0 | 1 {
  if (stat === 'hp') return 0
  const statIndex = pokemonNatureStatKeys.indexOf(stat as typeof pokemonNatureStatKeys[number])
  const increasedStat = Math.floor(nature / 5)
  const decreasedStat = nature % 5
  if (increasedStat === decreasedStat) return 0
  if (statIndex === increasedStat) return 1
  if (statIndex === decreasedStat) return -1
  return 0
}
