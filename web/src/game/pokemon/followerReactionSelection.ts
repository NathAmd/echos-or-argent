import type { HgssLcrng } from './hgssPokemonRng'
import type { CanonicalPokemon } from './canonicalPokemon'
import type { PokemonPersonalData } from '../../rom/pokemon/personalData'
import { resolveHgssTimeOfDay } from '../time/hgssRtc'
import {
  getHgssFollowerRuleOrder,
  type HgssFollowerReaction,
  type HgssFollowerReactionCatalog,
  type HgssFollowerReactionRule,
} from '../../rom/overworld/followerReactions'

export type HgssFollowerReactionContext = {
  heldItemPresent: boolean
  heldItemClass: number
  hpClass: number
  statusClass: number
  levelClass: number
  primaryTypeClass: number
  secondaryTypeClass: number
  friendship: number
  natureClass: number
  genderClass: number
  speciesReactionClass: number
  shinyLeafMask: number
  nearbyObjectCount: number
  hiddenItemCount: number
  weatherClass: number
  metatileBehavior: number
  terrainClass: number
  mapId: number
  timeOfDayClass: number
  mood: number
  pokeathlonStatClass: number
  facingClass: number
  hasFlag: (flagId: number) => boolean
}

export type HgssFollowerReactionSelection = {
  rule: HgssFollowerReactionRule
  reaction: HgssFollowerReaction
}

export type HgssFollowerReactionEffectResult = {
  friendship: number
  mood: number
  shinyLeafGranted: number
  fashionItemId: number
}

export type HgssFollowerEnvironment = {
  nearbyObjectCount: number
  hiddenItemCount: number
  weather: number
  metatileBehavior: number
  mapId: number
  time: Date
  mood: number
  pokeathlonStatClass: number
  facingClass: number
  hasFlag: (flagId: number) => boolean
}

const natureClasses = [4, 5, 4, 4, 1, 4, 3, 2, 1, 2, 5, 6, 3, 1, 1, 3, 6, 3, 5, 6, 2, 2, 1, 3, 6] as const
const typeClasses = [1, 7, 10, 8, 9, 13, 12, 14, 17, 0, 2, 3, 5, 4, 11, 6, 15, 16] as const
const heldItemClasses = [4, 2, 1, 7, 6, 5, 3] as const
const encounterMetatileBehaviors = new Set([2, 3, 5, 8, 11, 16, 18, 21, 37, 42, 114, 119, 123, 166, 167])

function resolveHpClass(pokemon: CanonicalPokemon): number {
  if (pokemon.stats.hp <= 0) throw new Error(`Les PV maximum du Pokémon follower ${pokemon.stats.hp} sont invalides.`)
  const percent = Math.floor((pokemon.currentHp * 100) / pokemon.stats.hp)
  if (percent === 100) return 1
  if (percent >= 75) return 2
  if (percent >= 50) return 3
  if (percent >= 25) return 4
  return 5
}

function resolveStatusClass(status: number): number {
  if ((status & 0x88) !== 0) return 5
  if ((status & 0x07) !== 0) return 8
  if ((status & 0x10) !== 0) return 2
  if ((status & 0x20) !== 0) return 3
  if ((status & 0x40) !== 0) return 4
  return 1
}

function resolveLevelClass(level: number): number {
  if (level <= 47) return 4
  if (level >= 53) return 6
  return 5
}

export function resolveHgssFollowerTimeOfDayClass(time: Date): number {
  return resolveHgssTimeOfDay(time) + 1
}

export function resolveHgssFollowerFacingClass(direction: 'north' | 'south' | 'west' | 'east'): number {
  return { north: 3, south: 4, west: 2, east: 1 }[direction]
}

export function createHgssFollowerReactionContext(
  pokemon: CanonicalPokemon,
  personalData: PokemonPersonalData,
  heldItemEffect: number,
  speciesReactionClass: number,
  shinyLeafMask: number,
  environment: HgssFollowerEnvironment,
): HgssFollowerReactionContext {
  if (!Number.isInteger(shinyLeafMask) || shinyLeafMask < 0 || shinyLeafMask > 0x1f) {
    throw new Error(`Le masque de Feuilles Dorées follower ${shinyLeafMask} est invalide.`)
  }
  if (!Number.isInteger(environment.mood) || environment.mood < -127 || environment.mood > 127) {
    throw new Error(`L’humeur follower HGSS ${environment.mood} est invalide.`)
  }
  // 0 est un sentinel explicite pour un runtime qui n'a pas encore décodé
  // les performances Pokéathlon; les règles spécialisées ne correspondront pas.
  if (!Number.isInteger(environment.pokeathlonStatClass) || environment.pokeathlonStatClass < 0 || environment.pokeathlonStatClass > 5) {
    throw new Error(`La statistique Pokéathlon follower HGSS ${environment.pokeathlonStatClass} est invalide.`)
  }
  const primaryTypeClass = typeClasses[personalData.types[0]]
  const secondaryTypeClass = typeClasses[personalData.types[1]]
  if (primaryTypeClass === undefined || secondaryTypeClass === undefined) {
    throw new Error(`Les types du Pokémon follower ${pokemon.speciesId} sont invalides.`)
  }
  const natureClass = natureClasses[pokemon.nature]
  if (natureClass === undefined) throw new Error(`La nature follower HGSS ${pokemon.nature} est invalide.`)
  const heldItemClass = heldItemEffect === 0 ? 8 : heldItemClasses[heldItemEffect - 1] ?? 8
  return {
    heldItemPresent: pokemon.heldItemId !== 0,
    heldItemClass,
    hpClass: resolveHpClass(pokemon),
    statusClass: resolveStatusClass(pokemon.status),
    levelClass: resolveLevelClass(pokemon.level),
    primaryTypeClass,
    secondaryTypeClass,
    friendship: pokemon.friendship,
    natureClass,
    genderClass: pokemon.gender === 'male' ? 1 : 2,
    speciesReactionClass,
    shinyLeafMask,
    nearbyObjectCount: environment.nearbyObjectCount,
    hiddenItemCount: environment.hiddenItemCount,
    weatherClass: environment.weather === 0 ? 1 : environment.weather === 1 ? 3 : 0,
    metatileBehavior: environment.metatileBehavior,
    terrainClass: encounterMetatileBehaviors.has(environment.metatileBehavior) ? 1 : 2,
    mapId: environment.mapId,
    timeOfDayClass: resolveHgssFollowerTimeOfDayClass(environment.time),
    mood: environment.mood,
    pokeathlonStatClass: environment.pokeathlonStatClass,
    facingClass: environment.facingClass,
    hasFlag: environment.hasFlag,
  }
}

function matchesFriendshipRange(selector: number, friendship: number): boolean {
  switch (selector) {
    case 0: return true
    case 1: return friendship === 255
    case 2: return friendship >= 200 && friendship < 255
    case 3: return friendship >= 150 && friendship < 200
    case 4: return friendship >= 90 && friendship < 150
    case 5: return friendship >= 60 && friendship < 90
    case 6: return friendship >= 30 && friendship < 60
    case 7: return friendship >= 1 && friendship < 30
    case 8: return friendship === 0
    case 9: return friendship >= 90
    case 10: return friendship < 60
    default: return false
  }
}

function matchesMoodRange(selector: number, mood: number): boolean {
  switch (selector) {
    case 0: return true
    case 1: return mood === 127
    case 2: return mood >= 100 && mood < 127
    case 3: return mood >= 50 && mood < 100
    case 4: return mood >= 30 && mood < 50
    case 5: return mood >= -29 && mood < 30
    case 6: return mood >= -49 && mood <= -30
    case 7: return mood >= -126 && mood <= -50
    case 8: return mood === -127
    case 9: return mood >= 0
    case 10: return mood <= -1
    default: return false
  }
}

function matchesSpeciesReactionClass(selector: number, speciesReactionClass: number): boolean {
  if (selector === 0) return true
  if (selector <= 249) return selector === speciesReactionClass
  switch (selector) {
    case 250: return speciesReactionClass <= 19
    case 251: return speciesReactionClass <= 130
    case 252: return speciesReactionClass >= 140 && speciesReactionClass <= 149
    case 253: return speciesReactionClass >= 160
    case 254: return speciesReactionClass >= 220
    default: return false
  }
}

function matchesMissingShinyLeaf(selector: number, shinyLeafMask: number): boolean {
  if (selector === 0) return true
  if (selector < 1 || selector > 5) return false
  return (shinyLeafMask & (1 << (selector - 1))) === 0
}

function matchesCountClass(selector: number, value: number, atLeastSelector: number): boolean {
  if (selector === 0) return true
  return selector === atLeastSelector ? value >= atLeastSelector : selector === value
}

export function matchesHgssFollowerReactionRule(
  rule: HgssFollowerReactionRule,
  context: HgssFollowerReactionContext,
  randomPercent: number,
): boolean {
  if (!Number.isInteger(randomPercent) || randomPercent < 0 || randomPercent >= 100) {
    throw new Error(`Le tirage de réaction follower HGSS ${randomPercent} est invalide.`)
  }
  if (randomPercent >= rule.probability) return false
  if (rule.requiredFlag !== 0 && !context.hasFlag(rule.requiredFlag)) return false
  const conditions = rule.conditions
  if (conditions.heldItemClass !== 0) {
    if (conditions.heldItemClass === 9) {
      if (!context.heldItemPresent) return false
    } else if (conditions.heldItemClass !== context.heldItemClass) return false
  }
  if (conditions.hpClass !== 0 && conditions.hpClass !== context.hpClass) return false
  if (conditions.statusClass !== 0) {
    const anyAilment = conditions.statusClass === 7 && [2, 3, 4, 5, 8].includes(context.statusClass)
    if (!anyAilment && conditions.statusClass !== context.statusClass) return false
  }
  if (!matchesCountClass(conditions.nearbyObjectCountClass, context.nearbyObjectCount, 5)) return false
  if (!matchesCountClass(conditions.hiddenItemCountClass, context.hiddenItemCount, 4)) return false
  if (conditions.levelClass !== 0 && conditions.levelClass !== context.levelClass) return false
  // Aucun des 7 120 enregistrements de la ROM n'utilise ces deux bits. Le chemin overlay rejette toute valeur non nulle.
  if (conditions.reservedObjectCondition !== 0) return false
  if (conditions.typeClass !== 0 && conditions.typeClass !== context.primaryTypeClass && conditions.typeClass !== context.secondaryTypeClass) return false
  if (conditions.weatherClass !== 0 && conditions.weatherClass !== context.weatherClass) return false
  if (conditions.metatileBehavior !== 0 && conditions.metatileBehavior !== context.metatileBehavior) return false
  if (conditions.terrainClass !== 0 && conditions.terrainClass !== context.terrainClass) return false
  if (conditions.mapIdPlusOne !== 0 && conditions.mapIdPlusOne - 1 !== context.mapId) return false
  if (conditions.timeOfDayClass !== 0 && conditions.timeOfDayClass !== context.timeOfDayClass) return false
  if (!matchesMoodRange(conditions.moodRange, context.mood)) return false
  if (conditions.pokeathlonStatClass !== 0 && conditions.pokeathlonStatClass !== context.pokeathlonStatClass) return false
  if (!matchesFriendshipRange(conditions.friendshipRange, context.friendship)) return false
  if (conditions.natureClass !== 0 && conditions.natureClass !== context.natureClass) return false
  if (!matchesSpeciesReactionClass(conditions.speciesReactionClass, context.speciesReactionClass)) return false
  if (!matchesMissingShinyLeaf(conditions.missingShinyLeaf, context.shinyLeafMask)) return false
  if (conditions.genderClass !== 0 && conditions.genderClass !== context.genderClass) return false
  if (conditions.facingClass !== 0 && conditions.facingClass !== context.facingClass) return false
  return true
}

export function selectHgssFollowerReaction(
  catalog: HgssFollowerReactionCatalog,
  mapSection: number,
  context: HgssFollowerReactionContext,
  rng: HgssLcrng,
): HgssFollowerReactionSelection {
  for (const rule of getHgssFollowerRuleOrder(catalog, mapSection)) {
    if (rule.reactionId === 0) continue
    const randomPercent = rng.nextU16() % 100
    if (!matchesHgssFollowerReactionRule(rule, context, randomPercent)) continue
    const reaction = catalog.reactions[rule.reactionId - 1]
    if (!reaction) throw new Error(`La réaction follower HGSS ${rule.reactionId} est absente du catalogue ROM.`)
    return { rule, reaction }
  }
  throw new Error(`Aucune réaction follower HGSS n'est valide pour la section ${mapSection}.`)
}

export function applyHgssFollowerReactionEffects(
  pokemon: CanonicalPokemon,
  mood: number,
  reaction: HgssFollowerReaction,
): HgssFollowerReactionEffectResult {
  const friendship = Math.max(0, Math.min(255, pokemon.friendship + reaction.effects.friendshipDelta))
  const nextMood = Math.max(-127, Math.min(127, mood + reaction.effects.moodDelta))
  let shinyLeafGranted = 0
  const shinyLeafIndex = reaction.effects.shinyLeafIndex
  if (shinyLeafIndex >= 1 && shinyLeafIndex <= 5) {
    const bit = 1 << (shinyLeafIndex - 1)
    if ((pokemon.shinyLeafMask & bit) === 0) {
      pokemon.shinyLeafMask |= bit
      shinyLeafGranted = shinyLeafIndex
    }
  }
  pokemon.friendship = friendship
  return { friendship, mood: nextMood, shinyLeafGranted, fashionItemId: reaction.effects.fashionItemId }
}
