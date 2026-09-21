import type { PokemonCatalog } from '../../ndsTypes'
import { calculateLevelFromExperience, getExperienceForLevel } from '../../rom/pokemon/growthTable'
import type { PokemonStatValues } from '../pokemon/pokemonFormulas'
import { calculatePokemonStats, resolvePokemonPersonalData } from '../pokemon/pokemonFormulas'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { applyHgssLevelUpFriendship, applyPokemonMovesAtLevel } from '../pokemon/pokemonLevelUp'
import {
  basePokemonLevelPolicy,
  resolvePokemonLevelCap,
  type PokemonLevelPolicy,
} from '../pokemon/pokemonLevelPolicy'

export type BattleLevelUp = {
  level: number
  statsBefore: PokemonStatValues
  statsAfter: PokemonStatValues
  currentHpBefore: number
  currentHpAfter: number
  friendshipBefore: number
  friendshipAfter: number
  learnedMoveIds: number[]
  skippedMoveIds: number[]
}

export type BattleProgressionResult = {
  experienceGained: number
  levels: BattleLevelUp[]
}

export type HgssBattleExperienceModifiers = {
  participated?: boolean
  participantCount?: number
  hasExpShare?: boolean
  expShareCount?: number
  holdEffect?: number
  holdEffectParameter?: number
  traded?: 'none' | 'same-language' | 'foreign-language'
  currentLocationId?: number
}

const hgssExpShareHoldEffect = 51
const hgssExpUpHoldEffect = 66

function requireEntry<T>(entries: readonly T[], index: number, label: string): T {
  const entry = entries[index]
  if (!entry) throw new Error(`${label} ${index} est absent du catalogue ROM.`)
  return entry
}

function addEffortValues(
  pokemon: CanonicalPokemon,
  yieldValues: PokemonStatValues,
  holdEffect = 0,
  holdEffectParameter = 0,
): void {
  let remaining = Math.max(0, 510 - Object.values(pokemon.effortValues).reduce((sum, value) => sum + value, 0))
  const powerEffectByStat: Record<keyof PokemonStatValues, number> = {
    hp: 122, attack: 117, defense: 118, speed: 121, specialAttack: 119, specialDefense: 120,
  }
  for (const stat of Object.keys(pokemon.effortValues) as (keyof PokemonStatValues)[]) {
    let amount = yieldValues[stat] + (holdEffect === powerEffectByStat[stat] ? holdEffectParameter : 0)
    if (holdEffect === 50) amount *= 2 // Bracelet Macho
    const gained = Math.min(amount, 255 - pokemon.effortValues[stat], remaining)
    pokemon.effortValues[stat] += gained
    remaining -= gained
  }
}

export function applyDefeatedPokemonProgression(
  pokemon: CanonicalPokemon,
  defeated: CanonicalPokemon,
  catalog: PokemonCatalog,
  trainerBattle: boolean,
  experienceDivisor = 1,
  modifiers: HgssBattleExperienceModifiers = {},
  levelPolicy: PokemonLevelPolicy = basePokemonLevelPolicy,
): BattleProgressionResult {
  const defeatedPersonal = resolvePokemonPersonalData(catalog, defeated.speciesId, defeated.form)
  const playerPersonal = requireEntry(catalog.personalData, pokemon.speciesId, 'L’espece du joueur')
  const playerFormPersonal = resolvePokemonPersonalData(catalog, pokemon.speciesId, pokemon.form)
  const growthTable = requireEntry(catalog.growthTables, playerPersonal.growthRate, 'La courbe de croissance')
  requireEntry(catalog.levelUpLearnsets, pokemon.speciesId, 'Le learnset Pokemon')
  const levelCap = resolvePokemonLevelCap(pokemon, 'battle', levelPolicy)
  const participantCount = Math.max(1, Math.trunc(modifiers.participantCount ?? experienceDivisor))
  const expShareCount = Math.max(0, Math.trunc(modifiers.expShareCount ?? 0))
  const participated = modifiers.participated ?? true
  const hasExpShare = modifiers.hasExpShare ?? modifiers.holdEffect === hgssExpShareHoldEffect
  const eligible = participated || hasExpShare
  const previousExperience = pokemon.experience
  let experienceGained = 0
  if (pokemon.level < levelCap && eligible) {
    // battle_command.c calcule d'abord b * L / 7, partage ensuite cette valeur,
    // puis applique les multiplicateurs dans Task_GetExp, chacun avec sa propre
    // troncature entière.
    const totalExperience = Math.floor(defeatedPersonal.experienceYield * defeated.level / 7)
    if (expShareCount > 0) {
      if (participated) experienceGained += Math.max(1, Math.floor(Math.floor(totalExperience / 2) / participantCount))
      if (hasExpShare) experienceGained += Math.max(1, Math.floor(Math.floor(totalExperience / 2) / expShareCount))
    } else if (participated) {
      experienceGained = Math.max(1, Math.floor(totalExperience / participantCount))
    }
    if (modifiers.holdEffect === hgssExpUpHoldEffect) experienceGained = Math.floor(experienceGained * 150 / 100)
    if (trainerBattle) experienceGained = Math.floor(experienceGained * 150 / 100)
    if (modifiers.traded === 'foreign-language') experienceGained = Math.floor(experienceGained * 170 / 100)
    else if (modifiers.traded === 'same-language') experienceGained = Math.floor(experienceGained * 150 / 100)
  }
  const maximumExperience = getExperienceForLevel(growthTable, levelCap)
  pokemon.experience = Math.max(
    pokemon.experience,
    Math.min(maximumExperience, pokemon.experience + experienceGained),
  )
  experienceGained = pokemon.experience - previousExperience
  // Dans Task_GetExp, le calcul des EV se trouve dans le même bloc que l'EXP :
  // un Pokémon K.O., non éligible ou déjà niveau 100 n'en reçoit pas.
  if (pokemon.level < 100 && eligible) {
    addEffortValues(pokemon, defeatedPersonal.evYield, modifiers.holdEffect, modifiers.holdEffectParameter)
  }

  const targetLevel = Math.min(levelCap, calculateLevelFromExperience(growthTable, pokemon.experience))
  const levels: BattleLevelUp[] = []
  while (pokemon.level < targetLevel) {
    const statsBefore = { ...pokemon.stats }
    const currentHpBefore = pokemon.currentHp
    const friendshipBefore = pokemon.friendship
    const previousHp = pokemon.stats.hp
    pokemon.level += 1
    pokemon.stats = calculatePokemonStats(playerFormPersonal, pokemon.level, pokemon.individualValues, pokemon.effortValues, pokemon.nature)
    pokemon.currentHp = Math.min(pokemon.stats.hp, pokemon.currentHp + pokemon.stats.hp - previousHp)
    applyHgssLevelUpFriendship(pokemon, {
      currentLocationId: modifiers.currentLocationId,
      holdEffect: modifiers.holdEffect,
    })
    const { learnedMoveIds, skippedMoveIds } = applyPokemonMovesAtLevel(pokemon, catalog)
    levels.push({
      level: pokemon.level,
      statsBefore,
      statsAfter: { ...pokemon.stats },
      currentHpBefore,
      currentHpAfter: pokemon.currentHp,
      friendshipBefore,
      friendshipAfter: pokemon.friendship,
      learnedMoveIds,
      skippedMoveIds,
    })
  }
  return { experienceGained, levels }
}
