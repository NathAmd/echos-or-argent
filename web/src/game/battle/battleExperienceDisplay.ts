import type { PokemonCatalog } from '../../ndsTypes'
import { getExperienceForLevel } from '../../rom/pokemon/growthTable'

export type BattleExperienceDisplay = {
  level: number
  total: number
  levelStart: number
  levelEnd: number
  progress: number
  required: number
  remaining: number
  levelCap: boolean
}

/**
 * Converts the cumulative EXP stored by the ROM into the interval displayed by
 * the HGSS battle gauge. Keeping this outside the DOM prevents the static HUD
 * and the level-up animation from disagreeing at a level boundary.
 */
export function createBattleExperienceDisplay(
  pokemon: Pick<{ speciesId: number, level: number, experience: number }, 'speciesId' | 'level' | 'experience'>,
  catalog: PokemonCatalog,
): BattleExperienceDisplay {
  const personal = catalog.personalData[pokemon.speciesId]
  if (!personal) throw new Error(`Les donnees d'EXP ROM de l'espece ${pokemon.speciesId} sont absentes.`)
  const growth = catalog.growthTables[personal.growthRate]
  if (!growth) throw new Error(`La courbe de croissance ROM ${personal.growthRate} est absente.`)
  const level = Math.max(1, Math.min(100, Math.trunc(pokemon.level)))
  const levelStart = getExperienceForLevel(growth, level)
  const levelCap = level >= 100
  const levelEnd = levelCap ? levelStart : getExperienceForLevel(growth, level + 1)
  const required = levelCap ? 1 : Math.max(1, levelEnd - levelStart)
  const boundedTotal = levelCap
    ? levelStart
    : Math.max(levelStart, Math.min(levelEnd, Math.trunc(pokemon.experience)))
  const progress = levelCap ? 0 : boundedTotal - levelStart
  return {
    level,
    total: Math.max(0, Math.trunc(pokemon.experience)),
    levelStart,
    levelEnd,
    progress,
    required,
    remaining: levelCap ? 0 : Math.max(0, required - progress),
    levelCap,
  }
}
