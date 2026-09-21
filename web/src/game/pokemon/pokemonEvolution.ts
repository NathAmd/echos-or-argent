import type { PokemonCatalog } from '../../ndsTypes'
import type { PokemonEvolutionRule } from '../../rom/pokemon/evolutionData'
import type { HgssItemCatalog } from '../../rom/items/itemData'
import { cloneCanonicalPokemon, type CanonicalPokemon } from './canonicalPokemon'
import { calculatePokemonStats, getAbilityFromPersonality, getGenderFromPersonality, resolvePokemonPersonalData } from './pokemonFormulas'
import { isHgssNighttime, type HgssTimeOfDay } from '../time/hgssRtc'
import { applyPokemonMovesAtLevel, type PokemonMoveLearningOutcome } from './pokemonLevelUp'

export type LevelUpEvolutionContext = {
  timeOfDay: HgssTimeOfDay
  itemCatalog?: HgssItemCatalog
  party?: readonly CanonicalPokemon[]
  /** HGSS transmet toujours EVO_NONE ; réservé aux données héritées de D/P/Pl. */
  locationMethod?: 24 | 25 | 26
}

export type PokemonEvolutionIdentity = {
  instanceId: CanonicalPokemon['instanceId']
  /** Conservée uniquement pour les diagnostics et règles PK4 natives. */
  personality: number
  speciesId: number
}

export type PokemonPartyEvolutionResult = {
  pokemon: CanonicalPokemon
  partySlot: number
  alreadyApplied: boolean
  sourceSpeciesId: number
  targetSpeciesId: number
  rule?: PokemonEvolutionRule
  learnedMoveIds: number[]
  skippedMoveIds: number[]
  consumedHeldItemId?: number
}

export type PokemonEvolutionMutationResult = PokemonMoveLearningOutcome & {
  sourceSpeciesId: number
  targetSpeciesId: number
  rule?: PokemonEvolutionRule
  consumedHeldItemId?: number
}

export type TradeEvolutionContext = {
  itemCatalog?: HgssItemCatalog
}

export type PokemonEvolutionMutationOptions = {
  /** Munja copie les capacités du Ninjask produit et ne relit pas son learnset. */
  learnTargetLevelMoves?: boolean
}

export function createPokemonEvolutionIdentity(pokemon: CanonicalPokemon): PokemonEvolutionIdentity {
  return {
    instanceId: pokemon.instanceId,
    personality: pokemon.personality,
    speciesId: pokemon.speciesId,
  }
}

export function matchesPokemonEvolutionIdentity(
  pokemon: CanonicalPokemon,
  identity: PokemonEvolutionIdentity,
): boolean {
  return matchesPokemonPersistentEvolutionIdentity(pokemon, identity)
    && pokemon.speciesId === identity.speciesId
}

/** Identité stable à travers SetMonData(SPECIES), utile aux transactions idempotentes. */
export function matchesPokemonPersistentEvolutionIdentity(
  pokemon: CanonicalPokemon,
  identity: PokemonEvolutionIdentity,
): boolean {
  return pokemon.instanceId === identity.instanceId
}

export function resolveItemUseEvolution(
  pokemon: CanonicalPokemon,
  catalog: PokemonCatalog,
  itemId: number,
): PokemonEvolutionRule | undefined {
  if (pokemon.isEgg || (pokemon.speciesId === 172 && pokemon.form === 1)) return undefined
  return catalog.evolutions[pokemon.speciesId]?.find((rule) => {
    if (rule.parameter !== itemId) return false
    if (rule.method === 7) return true
    if (rule.method === 16) return pokemon.gender === 'male'
    if (rule.method === 17) return pokemon.gender === 'female'
    return false
  })
}

function matchesLevelUpRule(pokemon: CanonicalPokemon, rule: PokemonEvolutionRule, context: LevelUpEvolutionContext): boolean {
  const personalityHigh = pokemon.personality >>> 16
  switch (rule.method) {
    case 1: return pokemon.friendship >= 220
    case 2: return pokemon.friendship >= 220 && !isHgssNighttime(context.timeOfDay)
    case 3: return pokemon.friendship >= 220 && isHgssNighttime(context.timeOfDay)
    case 4: return pokemon.level >= rule.parameter
    case 8: return pokemon.level >= rule.parameter && pokemon.stats.attack > pokemon.stats.defense
    case 9: return pokemon.level >= rule.parameter && pokemon.stats.attack === pokemon.stats.defense
    case 10: return pokemon.level >= rule.parameter && pokemon.stats.attack < pokemon.stats.defense
    case 11: return pokemon.level >= rule.parameter && personalityHigh % 10 < 5
    case 12: return pokemon.level >= rule.parameter && personalityHigh % 10 >= 5
    case 13: return pokemon.level >= rule.parameter
    case 15: return (pokemon.contestValues?.[1] ?? 0) >= rule.parameter
    case 18: return !isHgssNighttime(context.timeOfDay) && pokemon.heldItemId === rule.parameter
    case 19: return isHgssNighttime(context.timeOfDay) && pokemon.heldItemId === rule.parameter
    case 20: return pokemon.moves.some((move) => move.moveId === rule.parameter)
    case 21: return context.party?.some((member) => !member.isEgg && member.speciesId === rule.parameter) ?? false
    case 22: return pokemon.gender === 'male' && pokemon.level >= rule.parameter
    case 23: return pokemon.gender === 'female' && pokemon.level >= rule.parameter
    case 24:
    case 25:
    case 26: return context.locationMethod === rule.method
    default: return false
  }
}

export function resolveLevelUpEvolution(
  pokemon: CanonicalPokemon,
  catalog: PokemonCatalog,
  context: LevelUpEvolutionContext,
): PokemonEvolutionRule | undefined {
  if (pokemon.isEgg) return undefined
  const heldItem = context.itemCatalog?.items[pokemon.heldItemId]
  if (pokemon.speciesId !== 64 && heldItem?.holdEffect === 64) return undefined
  if (pokemon.speciesId === 172 && pokemon.form === 1) return undefined
  return catalog.evolutions[pokemon.speciesId]?.find((rule) => matchesLevelUpRule(pokemon, rule, context))
}

/** La méthode 14 est un résultat secondaire de la méthode 13, jamais un écran autonome. */
export function resolveShedinjaEvolution(
  pokemon: CanonicalPokemon,
  catalog: PokemonCatalog,
): PokemonEvolutionRule | undefined {
  if (pokemon.isEgg) return undefined
  return catalog.evolutions[pokemon.speciesId]?.find((rule) => rule.method === 14)
}

/** Résout les méthodes 5/6 après réception du Pokémon échangé. */
export function resolveTradeEvolution(
  pokemon: CanonicalPokemon,
  catalog: PokemonCatalog,
  context: TradeEvolutionContext = {},
): PokemonEvolutionRule | undefined {
  if (pokemon.isEgg || (pokemon.speciesId === 172 && pokemon.form === 1)) return undefined
  const heldItem = context.itemCatalog?.items[pokemon.heldItemId]
  // Le bug natif HGSS laisse Kadabra évoluer par échange malgré la Pierre Stase.
  if (pokemon.speciesId !== 64 && heldItem?.holdEffect === 64) return undefined
  return catalog.evolutions[pokemon.speciesId]?.find((rule) => (
    rule.method === 5 || (rule.method === 6 && pokemon.heldItemId === rule.parameter)
  ))
}

function findEvolutionRuleForTarget(
  sourceSpeciesId: number,
  targetSpeciesId: number,
  catalog: PokemonCatalog,
): PokemonEvolutionRule | undefined {
  return catalog.evolutions[sourceSpeciesId]?.find((rule) => rule.targetSpeciesId === targetSpeciesId)
}

export function evolveCanonicalPokemon(
  pokemon: CanonicalPokemon,
  targetSpeciesId: number,
  catalog: PokemonCatalog,
  explicitRule?: PokemonEvolutionRule,
  options: PokemonEvolutionMutationOptions = {},
): PokemonEvolutionMutationResult {
  const sourceSpeciesId = pokemon.speciesId
  const rule = explicitRule ?? findEvolutionRuleForTarget(sourceSpeciesId, targetSpeciesId, catalog)
  if (rule && rule.targetSpeciesId !== targetSpeciesId) {
    throw new Error(`La règle d'évolution ${rule.method} cible ${rule.targetSpeciesId} au lieu de ${targetSpeciesId}.`)
  }
  const speciesName = catalog.speciesNames[targetSpeciesId]
  if (!speciesName) throw new Error(`L'espece d'evolution ROM ${targetSpeciesId} est absente.`)
  // sub_020763FC dans la ROM ne remet pas MON_DATA_FORM a zero : la forme du
  // Pokemon reste donc celle de la structure PK4 pendant SetMonData(SPECIES).
  const target = resolvePokemonPersonalData(catalog, targetSpeciesId, pokemon.form)
  const previousMaximumHp = pokemon.stats.hp
  const previousCurrentHp = pokemon.currentHp
  pokemon.speciesId = targetSpeciesId
  pokemon.speciesName = speciesName
  pokemon.abilityId = getAbilityFromPersonality(target, pokemon.personality)
  pokemon.gender = getGenderFromPersonality(target, pokemon.personality)
  pokemon.stats = calculatePokemonStats(target, pokemon.level, pokemon.individualValues, pokemon.effortValues, pokemon.nature)
  // Port de CalcMonStats : un K.O. reste K.O.; Munja vivant passe a 1 PV;
  // sinon le gain de PV max est ajoute, tandis qu'une baisse ne retire pas de
  // PV courants tant qu'ils tiennent encore dans le nouveau maximum.
  pokemon.currentHp = previousCurrentHp === 0
    ? 0
    : targetSpeciesId === 292
      ? 1
      : pokemon.stats.hp < previousMaximumHp
        ? Math.min(previousCurrentHp, pokemon.stats.hp)
        : Math.min(pokemon.stats.hp, previousCurrentHp + pokemon.stats.hp - previousMaximumHp)
  const consumedHeldItemId = rule && [6, 18, 19].includes(rule.method) && pokemon.heldItemId === rule.parameter
    ? pokemon.heldItemId
    : undefined
  if (consumedHeldItemId !== undefined) pokemon.heldItemId = 0
  const moveLearning = options.learnTargetLevelMoves === false
    ? { learnedMoveIds: [], skippedMoveIds: [] }
    : applyPokemonMovesAtLevel(pokemon, catalog)
  return {
    sourceSpeciesId,
    targetSpeciesId,
    rule,
    consumedHeldItemId,
    ...moveLearning,
  }
}

/**
 * Remplace transactionnellement le membre du slot, comme PartyPokemon dans la
 * ROM. Le repli par identite protege la validation differee si l'equipe a ete
 * reordonnee entre le gain de niveau et l'ecran d'evolution.
 */
export function evolveCanonicalPokemonPartyMember(
  party: CanonicalPokemon[],
  preferredPartySlot: number,
  identity: PokemonEvolutionIdentity,
  targetSpeciesId: number,
  catalog: PokemonCatalog,
  explicitRule?: PokemonEvolutionRule,
): PokemonPartyEvolutionResult {
  const preferred = party[preferredPartySlot]
  const partySlot = preferred && matchesPokemonEvolutionIdentity(preferred, identity)
    ? preferredPartySlot
    : party.findIndex((pokemon) => matchesPokemonEvolutionIdentity(pokemon, identity))
  if (partySlot < 0) {
    const alreadyAppliedSlot = party.findIndex((pokemon) => (
      pokemon.speciesId === targetSpeciesId && matchesPokemonPersistentEvolutionIdentity(pokemon, identity)
    ))
    if (alreadyAppliedSlot >= 0) {
      return {
        pokemon: party[alreadyAppliedSlot]!,
        partySlot: alreadyAppliedSlot,
        alreadyApplied: true,
        sourceSpeciesId: identity.speciesId,
        targetSpeciesId,
        rule: explicitRule ?? findEvolutionRuleForTarget(identity.speciesId, targetSpeciesId, catalog),
        learnedMoveIds: [],
        skippedMoveIds: [],
      }
    }
    throw new Error(`Le Pokemon ${identity.speciesId}/${identity.personality} a evoluer n'est plus dans l'equipe.`)
  }
  const evolved = cloneCanonicalPokemon(party[partySlot]!)
  const mutation = evolveCanonicalPokemon(evolved, targetSpeciesId, catalog, explicitRule)
  party[partySlot] = evolved
  return { pokemon: evolved, partySlot, alreadyApplied: false, ...mutation }
}

export function evolveCanonicalPokemonPartyMemberByRule(
  party: CanonicalPokemon[],
  preferredPartySlot: number,
  identity: PokemonEvolutionIdentity,
  rule: PokemonEvolutionRule,
  catalog: PokemonCatalog,
): PokemonPartyEvolutionResult {
  return evolveCanonicalPokemonPartyMember(
    party,
    preferredPartySlot,
    identity,
    rule.targetSpeciesId,
    catalog,
    rule,
  )
}
