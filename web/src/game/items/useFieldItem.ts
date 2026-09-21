import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import type { HgssItemData, HgssItemPartyParameters } from '../../rom/items/itemData'
import type { PokemonCatalog } from '../../ndsTypes'
import { hasBagItem, takeBagItem } from './bagInventory'
import { createPokemonEvolutionIdentity, evolveCanonicalPokemon, resolveItemUseEvolution, resolveLevelUpEvolution } from '../pokemon/pokemonEvolution'
import { resolvePokemonEvolutionMutationDecision } from '../pokemon/pokemonEvolutionTransaction'
import { basePokemonTeamPolicy, type PokemonTeamPolicy } from '../pokemon/pokemonTeamPolicy'
import { calculatePokemonStats, resolvePokemonPersonalData, type PokemonStatValues } from '../pokemon/pokemonFormulas'
import { getExperienceForLevel } from '../../rom/pokemon/growthTable'
import type { HgssItemCatalog } from '../../rom/items/itemData'
import type { HgssTimeOfDay } from '../time/hgssRtc'
import { applyHgssFriendshipGain, applyPokemonMovesAtLevel } from '../pokemon/pokemonLevelUp'
import type { PokemonEvolutionRule } from '../../rom/pokemon/evolutionData'
import { resolvePokemonLevelCap, type PokemonLevelPolicy } from '../pokemon/pokemonLevelPolicy'
import {
  basePokemonPartyHealingPolicy,
  getPokemonHealingVeto,
  type PokemonHealingSource,
  type PokemonPartyHealingPolicy,
} from '../pokemon/pokemonPartyHealingPolicy'

const sleepMask = 0x7
const poisonMask = 0x8 | 0x80 | 0xf00
const burnMask = 0x10
const freezeMask = 0x20
const paralysisMask = 0x40

export type FieldItemEffect = {
  hpRestored: number
  statusHealed: boolean
  ppRestored: number
  ppUpsAdded: number
  revived: boolean
  evolvedFromSpeciesId?: number
  evolvedToSpeciesId?: number
  evolutionContext?: 'level-up' | 'item-use'
  evolutionMethod?: number
  evolutionParameter?: number
  consumedHeldItemId?: number
  levelsGained: number
  learnedMoveIds: number[]
  skippedMoveIds: number[]
  effortValueChange: number
  friendshipChange: number
}

export type UseFieldItemContext = {
  pokemonCatalog?: PokemonCatalog
  itemCatalog?: HgssItemCatalog
  levelPolicy?: PokemonLevelPolicy
  healingPolicy?: PokemonPartyHealingPolicy
  partyIndex?: number
  healingSource?: PokemonHealingSource
  currentLocationId?: number
  timeOfDay?: HgssTimeOfDay
  party?: readonly CanonicalPokemon[]
  teamPolicy?: PokemonTeamPolicy
  locationMethod?: 24 | 25 | 26
  /** L'interface lance d'abord l'ecran ROM, puis valide l'espece au flash final. */
  deferEvolution?: boolean
}

export type UseFieldItemResult =
  | { kind: 'used', effect: FieldItemEffect, remaining: number }
  | { kind: 'no-effect', reason: string }
  | { kind: 'unsupported', reason: string }
  | { kind: 'missing-item', reason: string }
  | { kind: 'move-required', reason: string }
  | { kind: 'blocked', code: string, reason: string }

export type UseFieldItemOnPartyResult =
  | { kind: 'used', effects: readonly { partySlot: number, effect: FieldItemEffect }[], remaining: number }
  | Exclude<UseFieldItemResult, { kind: 'used' } | { kind: 'move-required' }>

export function getFieldItemEvolutionRule(effect: FieldItemEffect): PokemonEvolutionRule | undefined {
  if (effect.evolvedToSpeciesId === undefined || effect.evolutionMethod === undefined || effect.evolutionParameter === undefined) return undefined
  return { method: effect.evolutionMethod, parameter: effect.evolutionParameter, targetSpeciesId: effect.evolvedToSpeciesId }
}

function getUnsupportedReason(parameters: HgssItemPartyParameters): string | undefined {
  if (parameters.guardSpec || parameters.attackStages || parameters.defenseStages || parameters.specialAttackStages
    || parameters.specialDefenseStages || parameters.speedStages || parameters.accuracyStages || parameters.criticalRateStages) {
    return 'Cet effet est réservé au moteur de combat.'
  }
  return undefined
}

export function canTargetFieldItemAtPokemon(item: HgssItemData): boolean {
  return item.partyUse === 1 && !item.partyParameters.reviveAll && getUnsupportedReason(item.partyParameters) === undefined
}

export function canUseFieldItemOnParty(item: HgssItemData): boolean {
  return item.partyUse === 1 && item.partyParameters.reviveAll && getUnsupportedReason(item.partyParameters) === undefined
}

function getRestorationAmount(parameter: number, maximum: number): number {
  if (maximum === 1) return 1
  if (parameter === 0xff) return maximum
  if (parameter === 0xfe) return Math.floor(maximum / 2)
  if (parameter === 0xfd) return Math.floor(maximum / 4)
  return parameter
}

function healStatus(status: number, parameters: HgssItemPartyParameters): number {
  let result = status
  if (parameters.sleepHeal) result &= ~sleepMask
  if (parameters.poisonHeal) result &= ~poisonMask
  if (parameters.burnHeal) result &= ~burnMask
  if (parameters.freezeHeal) result &= ~freezeMask
  if (parameters.paralysisHeal) result &= ~paralysisMask
  return result
}

const effortStats: readonly [keyof PokemonStatValues, keyof HgssItemPartyParameters, keyof HgssItemPartyParameters][] = [
  ['hp', 'hpEvUp', 'hpEvParameter'],
  ['attack', 'attackEvUp', 'attackEvParameter'],
  ['defense', 'defenseEvUp', 'defenseEvParameter'],
  ['speed', 'speedEvUp', 'speedEvParameter'],
  ['specialAttack', 'specialAttackEvUp', 'specialAttackEvParameter'],
  ['specialDefense', 'specialDefenseEvUp', 'specialDefenseEvParameter'],
]

function recalculatePokemonStats(pokemon: CanonicalPokemon, catalog: PokemonCatalog): void {
  const personalData = resolvePokemonPersonalData(catalog, pokemon.speciesId, pokemon.form)
  const oldMaximumHp = pokemon.stats.hp
  const oldCurrentHp = pokemon.currentHp
  pokemon.stats = calculatePokemonStats(personalData, pokemon.level, pokemon.individualValues, pokemon.effortValues, pokemon.nature)
  if (oldCurrentHp !== 0 || oldMaximumHp === 0) {
    pokemon.currentHp = pokemon.speciesId === 292
      ? 1
      : pokemon.stats.hp < oldMaximumHp
        ? Math.min(oldCurrentHp, pokemon.stats.hp)
        : Math.min(pokemon.stats.hp, oldCurrentHp + pokemon.stats.hp - oldMaximumHp)
  }
}

function applyEffortValueChanges(pokemon: CanonicalPokemon, parameters: HgssItemPartyParameters): number {
  let totalChange = 0
  for (const [stat, enabledKey, parameterKey] of effortStats) {
    if (!parameters[enabledKey] || (stat === 'hp' && pokemon.speciesId === 292)) continue
    const change = parameters[parameterKey] as number
    const current = pokemon.effortValues[stat]
    const otherTotal = Object.entries(pokemon.effortValues).reduce((sum, [name, value]) => name === stat ? sum : sum + value, 0)
    if ((change < 0 && current === 0) || (change > 0 && (current >= 100 || current + otherTotal >= 510))) continue
    const next = change > 0
      ? Math.min(100, 510 - otherTotal, current + change)
      : Math.max(0, current + change)
    pokemon.effortValues[stat] = next
    totalChange += next - current
  }
  return totalChange
}

function applyFriendshipChange(
  pokemon: CanonicalPokemon,
  parameters: HgssItemPartyParameters,
  context: UseFieldItemContext,
): number {
  const parameter = pokemon.friendship < 100
    ? parameters.friendshipLow ? parameters.friendshipLowParameter : 0
    : pokemon.friendship < 200
      ? parameters.friendshipMedium ? parameters.friendshipMediumParameter : 0
      : parameters.friendshipHigh ? parameters.friendshipHighParameter : 0
  if (parameter === 0 || (parameter > 0 && pokemon.friendship === 255) || (parameter < 0 && pokemon.friendship === 0)) return 0
  if (parameter > 0) {
    return applyHgssFriendshipGain(pokemon, parameter, {
      currentLocationId: context.currentLocationId,
      holdEffect: context.itemCatalog?.items[pokemon.heldItemId]?.holdEffect,
    })
  }
  const before = pokemon.friendship
  pokemon.friendship = Math.max(0, before + parameter)
  return pokemon.friendship - before
}

function applySupportedEffect(
  pokemon: CanonicalPokemon,
  item: HgssItemData,
  moveIndex?: number,
  context: UseFieldItemContext = {},
): UseFieldItemResult {
  const parameters = item.partyParameters
  const effect: FieldItemEffect = {
    hpRestored: 0,
    statusHealed: false,
    ppRestored: 0,
    ppUpsAdded: 0,
    revived: false,
    levelsGained: 0,
    learnedMoveIds: [],
    skippedMoveIds: [],
    effortValueChange: 0,
    friendshipChange: 0,
  }
  let restorationVetoReason: string | undefined
  const restorationAllowed = (restoration: 'hp' | 'status' | 'move-pp'): boolean => {
    const veto = getPokemonHealingVeto(
      pokemon,
      context.partyIndex ?? 0,
      restoration,
      context.healingSource ?? 'field-item',
      context.healingPolicy ?? basePokemonPartyHealingPolicy,
    )
    if (!veto) return true
    restorationVetoReason ??= veto.reason
    return false
  }
  const nextStatus = healStatus(pokemon.status, parameters)
  if (nextStatus !== pokemon.status && restorationAllowed('status')) {
    pokemon.status = nextStatus
    effect.statusHealed = true
  }

  if (parameters.revive && pokemon.currentHp === 0) {
    const restored = Math.min(pokemon.stats.hp, getRestorationAmount(parameters.hpRestoreParameter, pokemon.stats.hp))
    if (restored > 0 && restorationAllowed('hp')) {
      pokemon.currentHp = restored
      effect.hpRestored = restored
      effect.revived = true
    }
  } else if (parameters.hpRestore && pokemon.currentHp > 0 && pokemon.currentHp < pokemon.stats.hp) {
    const restored = Math.min(
      pokemon.stats.hp - pokemon.currentHp,
      getRestorationAmount(parameters.hpRestoreParameter, pokemon.stats.hp),
    )
    if (restored > 0 && restorationAllowed('hp')) {
      pokemon.currentHp += restored
      effect.hpRestored = restored
    }
  }

  if (parameters.ppRestore || parameters.ppUp || parameters.ppMax) {
    if (moveIndex === undefined) return { kind: 'move-required', reason: 'Choisissez une capacité de ce Pokémon.' }
    const move = pokemon.moves[moveIndex]
    if (!move) return { kind: 'no-effect', reason: 'Cette capacité est absente.' }
    const targetUps = parameters.ppMax ? 3 : Math.min(3, move.ppUps + 1)
    const canRaiseMaximumPp = Boolean((parameters.ppUp || parameters.ppMax) && move.data.pp >= 5 && targetUps > move.ppUps)
    const canRestorePp = Boolean(parameters.ppRestore && move.pp < move.maxPp && parameters.ppRestoreParameter > 0)
    const ppRestorationAllowed = !(canRaiseMaximumPp || canRestorePp) || restorationAllowed('move-pp')
    if (ppRestorationAllowed && (parameters.ppUp || parameters.ppMax)) {
      const oldUps = move.ppUps
      if (move.data.pp >= 5 && targetUps > move.ppUps) {
        const oldMaximum = move.maxPp
        move.ppUps = targetUps
        move.maxPp = Math.floor(move.data.pp * (5 + move.ppUps) / 5)
        move.pp += move.maxPp - oldMaximum
        effect.ppUpsAdded = targetUps - oldUps
      }
    }
    if (ppRestorationAllowed && parameters.ppRestore && move.pp < move.maxPp) {
      const restored = Math.min(
        move.maxPp - move.pp,
        parameters.ppRestoreParameter === 0x7f ? move.maxPp : parameters.ppRestoreParameter,
      )
      move.pp += restored
      effect.ppRestored += restored
    }
  } else if (parameters.ppRestoreAll) {
    if (pokemon.moves.some((move) => move.pp < move.maxPp) && restorationAllowed('move-pp')) for (const move of pokemon.moves) {
      if (move.pp >= move.maxPp) continue
      const restored = Math.min(
        move.maxPp - move.pp,
        parameters.ppRestoreParameter === 0x7f ? move.maxPp : parameters.ppRestoreParameter,
      )
      move.pp += restored
      effect.ppRestored += restored
    }
  }

  if (parameters.levelUp) {
    if (!context.pokemonCatalog) return { kind: 'unsupported', reason: 'La courbe de croissance ROM est absente de ce contexte.' }
    const levelCap = resolvePokemonLevelCap(pokemon, 'rare-candy', context.levelPolicy)
    if (pokemon.level < levelCap) {
      const hpRestorationAllowed = pokemon.currentHp !== 0 || restorationAllowed('hp')
      const oldMaximumHp = pokemon.stats.hp
      const personalData = context.pokemonCatalog.personalData[pokemon.speciesId]
      const growthTable = personalData && context.pokemonCatalog.growthTables[personalData.growthRate]
      if (!personalData || !growthTable) throw new Error(`La croissance ROM de l’espèce ${pokemon.speciesId} est absente.`)
      pokemon.level += 1
      pokemon.experience = getExperienceForLevel(growthTable, pokemon.level)
      recalculatePokemonStats(pokemon, context.pokemonCatalog)
      if (hpRestorationAllowed && pokemon.currentHp === 0 && pokemon.stats.hp > oldMaximumHp) {
        pokemon.currentHp = pokemon.stats.hp - oldMaximumHp
        effect.hpRestored += pokemon.currentHp
        effect.revived = true
      }
      effect.levelsGained = 1
      const moveLearning = applyPokemonMovesAtLevel(pokemon, context.pokemonCatalog)
      effect.learnedMoveIds.push(...moveLearning.learnedMoveIds)
      effect.skippedMoveIds.push(...moveLearning.skippedMoveIds)
    }
  }

  effect.effortValueChange = applyEffortValueChanges(pokemon, parameters)
  if (effect.effortValueChange !== 0) {
    if (!context.pokemonCatalog) return { kind: 'unsupported', reason: 'Les statistiques ROM sont absentes de ce contexte.' }
    recalculatePokemonStats(pokemon, context.pokemonCatalog)
  }
  effect.friendshipChange += applyFriendshipChange(pokemon, parameters, context)


  if (parameters.evolve) {
    if (!context.pokemonCatalog) {
      return { kind: 'unsupported', reason: 'Cet objet d’évolution ne peut pas être utilisé dans ce contexte.' }
    }
    const evolution = resolveItemUseEvolution(pokemon, context.pokemonCatalog, item.itemId)
    if (evolution) {
      effect.evolvedFromSpeciesId = pokemon.speciesId
      effect.evolvedToSpeciesId = evolution.targetSpeciesId
      effect.evolutionContext = 'item-use'
      effect.evolutionMethod = evolution.method
      effect.evolutionParameter = evolution.parameter
      if (!context.deferEvolution) {
        const mutation = evolveCanonicalPokemon(pokemon, evolution.targetSpeciesId, context.pokemonCatalog, evolution)
        effect.learnedMoveIds.push(...mutation.learnedMoveIds)
        effect.skippedMoveIds.push(...mutation.skippedMoveIds)
        effect.consumedHeldItemId = mutation.consumedHeldItemId
      }
    }
  }

  if (effect.levelsGained > 0 && effect.evolvedToSpeciesId === undefined && context.pokemonCatalog) {
    const evolution = resolveLevelUpEvolution(pokemon, context.pokemonCatalog, {
      timeOfDay: context.timeOfDay ?? 1,
      itemCatalog: context.itemCatalog,
      party: context.party,
      locationMethod: context.locationMethod,
    })
    if (evolution) {
      effect.evolvedFromSpeciesId = pokemon.speciesId
      effect.evolvedToSpeciesId = evolution.targetSpeciesId
      effect.evolutionContext = 'level-up'
      effect.evolutionMethod = evolution.method
      effect.evolutionParameter = evolution.parameter
      if (!context.deferEvolution) {
        const mutation = evolveCanonicalPokemon(pokemon, evolution.targetSpeciesId, context.pokemonCatalog, evolution)
        effect.learnedMoveIds.push(...mutation.learnedMoveIds)
        effect.skippedMoveIds.push(...mutation.skippedMoveIds)
        effect.consumedHeldItemId = mutation.consumedHeldItemId
      }
    }
  }

  return effect.hpRestored > 0 || effect.statusHealed || effect.ppRestored > 0 || effect.ppUpsAdded > 0
    || effect.evolvedToSpeciesId !== undefined || effect.levelsGained > 0 || effect.effortValueChange !== 0
    || effect.friendshipChange !== 0
    ? { kind: 'used', effect, remaining: 0 }
    : { kind: 'no-effect', reason: restorationVetoReason ?? 'Cet objet n’aurait aucun effet.' }
}

export function useFieldItemOnPokemon(
  inventory: Map<number, number>,
  item: HgssItemData,
  pokemon: CanonicalPokemon,
  moveIndex?: number,
  context: UseFieldItemContext = {},
): UseFieldItemResult {
  const quantity = inventory.get(item.itemId) ?? 0
  if (!hasBagItem(inventory, item.itemId, 1)) return { kind: 'missing-item', reason: `${item.name} n’est plus dans le Sac.` }
  if (item.partyUse !== 1) return { kind: 'unsupported', reason: `${item.name} ne s’utilise pas sur un Pokémon.` }
  const unsupportedReason = getUnsupportedReason(item.partyParameters)
  if (unsupportedReason) return { kind: 'unsupported', reason: unsupportedReason }
  if (pokemon.isEgg) return { kind: 'no-effect', reason: 'Cet objet ne peut pas être utilisé sur un Œuf.' }

  const candidate = structuredClone(pokemon)
  const result = applySupportedEffect(candidate, item, moveIndex, { ...context, deferEvolution: true })
  if (result.kind !== 'used') return result

  const evolutionRule = getFieldItemEvolutionRule(result.effect)
  if (evolutionRule && context.pokemonCatalog) {
    const partySlot = context.party
      ? context.partyIndex ?? context.party.findIndex((member) => member.instanceId === pokemon.instanceId)
      : 0
    if (partySlot < 0 || (context.party && context.party[partySlot]?.instanceId !== pokemon.instanceId)) {
      throw new Error("Le Pokémon ciblé par l'objet n'est plus dans l'équipe.")
    }
    const partyPreview = context.party
      ? context.party.map((member, index) => index === partySlot ? candidate : member)
      : [candidate]
    const decision = resolvePokemonEvolutionMutationDecision(
      partyPreview,
      partySlot,
      createPokemonEvolutionIdentity(candidate),
      evolutionRule,
      context.pokemonCatalog,
      context.teamPolicy ?? basePokemonTeamPolicy,
    )
    if (decision.kind === 'blocked') return decision
    if (!context.deferEvolution) {
      const mutation = evolveCanonicalPokemon(candidate, evolutionRule.targetSpeciesId, context.pokemonCatalog, evolutionRule)
      result.effect.learnedMoveIds.push(...mutation.learnedMoveIds)
      result.effect.skippedMoveIds.push(...mutation.skippedMoveIds)
      result.effect.consumedHeldItemId = mutation.consumedHeldItemId
    }
  }

  Object.assign(pokemon, candidate)
  if (!takeBagItem(inventory, item.itemId, 1)) throw new Error(`La consommation de ${item.name} a perdu sa source.`)
  const remaining = quantity - 1
  return { ...result, remaining }
}

/** Exécute transactionnellement l'effet ROM des objets qui ciblent toute l'Équipe. */
export function useFieldItemOnParty(
  inventory: Map<number, number>,
  item: HgssItemData,
  party: readonly CanonicalPokemon[],
  context: Pick<UseFieldItemContext, 'healingPolicy' | 'healingSource'> = {},
): UseFieldItemOnPartyResult {
  const quantity = inventory.get(item.itemId) ?? 0
  if (!hasBagItem(inventory, item.itemId, 1)) return { kind: 'missing-item', reason: `${item.name} n’est plus dans le Sac.` }
  if (!canUseFieldItemOnParty(item)) return { kind: 'unsupported', reason: `${item.name} ne s’utilise pas sur toute l’Équipe.` }

  const candidates = party.map((pokemon) => structuredClone(pokemon))
  const effects: { partySlot: number, effect: FieldItemEffect }[] = []
  let restorationVetoReason: string | undefined
  for (const [partySlot, pokemon] of candidates.entries()) {
    if (pokemon.isEgg || pokemon.currentHp > 0) continue
    const restored = Math.min(pokemon.stats.hp, getRestorationAmount(item.partyParameters.hpRestoreParameter, pokemon.stats.hp))
    if (restored <= 0) continue
    const veto = getPokemonHealingVeto(
      pokemon,
      partySlot,
      'hp',
      context.healingSource ?? 'field-item',
      context.healingPolicy ?? basePokemonPartyHealingPolicy,
    )
    if (veto) {
      restorationVetoReason ??= veto.reason
      continue
    }
    pokemon.currentHp = restored
    effects.push({
      partySlot,
      effect: {
        hpRestored: restored,
        statusHealed: false,
        ppRestored: 0,
        ppUpsAdded: 0,
        revived: true,
        levelsGained: 0,
        learnedMoveIds: [],
        skippedMoveIds: [],
        effortValueChange: 0,
        friendshipChange: 0,
      },
    })
  }
  if (effects.length === 0) return { kind: 'no-effect', reason: restorationVetoReason ?? 'Aucun Pokémon de l’Équipe n’est K.O.' }

  for (const { partySlot } of effects) Object.assign(party[partySlot]!, candidates[partySlot]!)
  if (!takeBagItem(inventory, item.itemId, 1)) throw new Error(`La consommation de ${item.name} a perdu sa source.`)
  return { kind: 'used', effects, remaining: quantity - 1 }
}
