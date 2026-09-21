import type { PokemonPersonalData } from '../../rom/pokemon/personalData'
import type { PokemonCatalog } from '../../ndsTypes'

export type PokemonStatValues = {
  hp: number
  attack: number
  defense: number
  speed: number
  specialAttack: number
  specialDefense: number
}

export type PokemonGender = 'male' | 'female' | 'genderless'

const shedinjaSpeciesId = 292
const maximumEffortValueSum = 510

export function resolvePokemonPersonalData(
  catalog: PokemonCatalog,
  speciesId: number,
  form = 0,
): PokemonPersonalData {
  let memberIndex = speciesId
  if (speciesId === 386 && form >= 1 && form <= 3) memberIndex = 495 + form
  else if (speciesId === 413 && form >= 1 && form <= 2) memberIndex = 498 + form
  else if (speciesId === 487 && form === 1) memberIndex = 501
  else if (speciesId === 492 && form === 1) memberIndex = 502
  else if (speciesId === 479 && form >= 1 && form <= 5) memberIndex = 502 + form
  const personalData = catalog.personalData[memberIndex]
  if (!personalData) throw new Error(`Les données personnelles ROM ${speciesId}:${form} (membre ${memberIndex}) sont absentes.`)
  return personalData
}

function validatePersonality(personality: number): void {
  if (!Number.isInteger(personality) || personality < 0 || personality > 0xffffffff) {
    throw new Error(`La personnalite Pokemon ${personality} est invalide.`)
  }
}

function validateStatInputs(values: PokemonStatValues, name: string, maximum: number): void {
  for (const [stat, value] of Object.entries(values)) {
    if (!Number.isInteger(value) || value < 0 || value > maximum) {
      throw new Error(`${name} ${stat}=${value} est invalide; maximum ${maximum}.`)
    }
  }
}

export function getNatureFromPersonality(personality: number): number {
  validatePersonality(personality)
  return personality % 25
}

export function getAbilityFromPersonality(personalData: PokemonPersonalData, personality: number): number {
  validatePersonality(personality)
  const [primaryAbility, secondaryAbility] = personalData.abilities
  return secondaryAbility !== 0 && (personality & 1) !== 0 ? secondaryAbility : primaryAbility
}

export function getGenderFromPersonality(personalData: PokemonPersonalData, personality: number): PokemonGender {
  validatePersonality(personality)
  if (personalData.genderRatio === 0) return 'male'
  if (personalData.genderRatio === 254) return 'female'
  if (personalData.genderRatio === 255) return 'genderless'
  return personalData.genderRatio > (personality & 0xff) ? 'female' : 'male'
}

export function isShinyPersonality(originalTrainerId: number, personality: number): boolean {
  validatePersonality(originalTrainerId)
  validatePersonality(personality)
  return (
    ((originalTrainerId >>> 16) ^ (originalTrainerId & 0xffff) ^ (personality >>> 16) ^ (personality & 0xffff))
    < 8
  )
}

export function applyNatureToStat(stat: number, nature: number, statIndex: 0 | 1 | 2 | 3 | 4): number {
  if (!Number.isInteger(stat) || stat < 0) throw new Error(`La statistique Pokemon ${stat} est invalide.`)
  if (!Number.isInteger(nature) || nature < 0 || nature >= 25) throw new Error(`La nature Pokemon ${nature} est invalide.`)
  const increasedStat = Math.floor(nature / 5)
  const decreasedStat = nature % 5
  if (increasedStat === decreasedStat) return stat
  if (increasedStat === statIndex) return Math.floor(stat * 110 / 100)
  if (decreasedStat === statIndex) return Math.floor(stat * 90 / 100)
  return stat
}

export function calculatePokemonStats(
  personalData: PokemonPersonalData,
  level: number,
  individualValues: PokemonStatValues,
  effortValues: PokemonStatValues,
  nature: number,
): PokemonStatValues {
  if (!Number.isInteger(level) || level < 1 || level > 100) throw new Error(`Le niveau Pokemon ${level} est invalide.`)
  validateStatInputs(individualValues, 'IV', 31)
  validateStatInputs(effortValues, 'EV', 255)
  const effortValueSum = Object.values(effortValues).reduce((sum, value) => sum + value, 0)
  if (effortValueSum > maximumEffortValueSum) throw new Error(`La somme des EV ${effortValueSum} depasse ${maximumEffortValueSum}.`)

  const calculateBaseStat = (base: number, iv: number, ev: number): number => (
    Math.floor((base * 2 + iv + Math.floor(ev / 4)) * level / 100) + 5
  )
  const { baseStats } = personalData
  const hp = personalData.speciesId === shedinjaSpeciesId
    ? 1
    : Math.floor((baseStats.hp * 2 + individualValues.hp + Math.floor(effortValues.hp / 4)) * level / 100) + level + 10
  return {
    hp,
    attack: applyNatureToStat(calculateBaseStat(baseStats.attack, individualValues.attack, effortValues.attack), nature, 0),
    defense: applyNatureToStat(calculateBaseStat(baseStats.defense, individualValues.defense, effortValues.defense), nature, 1),
    speed: applyNatureToStat(calculateBaseStat(baseStats.speed, individualValues.speed, effortValues.speed), nature, 2),
    specialAttack: applyNatureToStat(calculateBaseStat(baseStats.specialAttack, individualValues.specialAttack, effortValues.specialAttack), nature, 3),
    specialDefense: applyNatureToStat(calculateBaseStat(baseStats.specialDefense, individualValues.specialDefense, effortValues.specialDefense), nature, 4),
  }
}
