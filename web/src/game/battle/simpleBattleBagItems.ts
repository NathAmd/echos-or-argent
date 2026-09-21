import type { PokemonCatalog } from '../../ndsTypes'
import type { HgssItemCatalog, HgssItemData, HgssItemPartyParameters } from '../../rom/items/itemData'
import { takeBagItem } from '../items/bagInventory'
import { useFieldItemOnPokemon } from '../items/useFieldItem'
import { cloneCanonicalPokemon, type CanonicalPokemon } from '../pokemon/canonicalPokemon'
import type { PokemonPartyHealingPolicy } from '../pokemon/pokemonPartyHealingPolicy'
import { escapeSimpleBattleWithItem, type SimpleBattleEvent, type SimpleBattleSession } from './simpleBattleSession'

const simpleBattleStatItemStats = [
  'attack',
  'defense',
  'specialAttack',
  'specialDefense',
  'speed',
  'accuracy',
] as const

type SimpleBattleStatItemStat = typeof simpleBattleStatItemStats[number]

type SimpleBattleStatItemParameters = Readonly<Pick<
  HgssItemPartyParameters,
  | 'guardSpec'
  | 'attackStages'
  | 'defenseStages'
  | 'specialAttackStages'
  | 'specialDefenseStages'
  | 'speedStages'
  | 'accuracyStages'
  | 'criticalRateStages'
>>

export type SimpleBattleStatItemSource = {
  readonly itemId: number
  readonly name: string
  readonly partyParameters: SimpleBattleStatItemParameters
}

export type SimpleBattleStatItemState = {
  readonly player: {
    readonly stages: Record<SimpleBattleStatItemStat, number>
    readonly screens: { mistTurns: number }
    readonly volatile: { focusEnergy: boolean }
  }
}

export type ApplySimpleBattleStatItemResult =
  | { readonly kind: 'not-stat-item' }
  | { readonly kind: 'no-effect', readonly reason: string }
  | { readonly kind: 'used' }

export type SimpleBattlePartyItemState = {
  readonly player: { pokemon: CanonicalPokemon }
}

export type ApplySimpleBattlePartyItemResult =
  | { readonly kind: 'ignored' }
  | { readonly kind: 'move-required', readonly target: CanonicalPokemon, readonly restoreOnly: boolean }
  | { readonly kind: 'rejected', readonly reason: string }
  | {
    readonly kind: 'used'
    readonly activeTarget: boolean
    readonly hpGained: number
    readonly statusChanged: boolean
    readonly currentStatus: number
  }

export type ApplySimpleBattleEscapeItemResult =
  | { readonly kind: 'not-escape-item' }
  | { readonly kind: 'trainer-blocked', readonly events: readonly SimpleBattleEvent[] }
  | { readonly kind: 'used', readonly events: readonly SimpleBattleEvent[] }

export function applySimpleBattlePartyItem(options: {
  readonly state: SimpleBattlePartyItemState
  readonly inventory: Map<number, number>
  readonly item: HgssItemData
  readonly playerParty: CanonicalPokemon[]
  readonly activePartyIndex: number
  readonly targetPartyIndex: number
  readonly moveIndex?: number
  readonly pokemonCatalog: PokemonCatalog
  readonly itemCatalog: HgssItemCatalog
  readonly currentLocationId?: number
  readonly healingPolicy?: PokemonPartyHealingPolicy
}): ApplySimpleBattlePartyItemResult {
  const target = options.playerParty[options.targetPartyIndex]
  if (!target) return { kind: 'ignored' }
  const parameters = options.item.partyParameters
  if (options.moveIndex === undefined && (parameters.ppRestore || parameters.ppUp || parameters.ppMax)) {
    return {
      kind: 'move-required',
      target,
      restoreOnly: Boolean(parameters.ppRestore && !parameters.ppUp && !parameters.ppMax),
    }
  }
  const hpBefore = target.currentHp
  const statusBefore = target.status
  const result = useFieldItemOnPokemon(options.inventory, options.item, target, options.moveIndex, {
    pokemonCatalog: options.pokemonCatalog,
    itemCatalog: options.itemCatalog,
    currentLocationId: options.currentLocationId,
    healingPolicy: options.healingPolicy,
    partyIndex: options.targetPartyIndex,
    healingSource: 'battle-item',
  })
  if (result.kind !== 'used') return { kind: 'rejected', reason: result.reason }
  const activeTarget = options.targetPartyIndex === options.activePartyIndex
  if (activeTarget) options.state.player.pokemon = cloneCanonicalPokemon(target)
  return {
    kind: 'used',
    activeTarget,
    hpGained: target.currentHp - hpBefore,
    statusChanged: target.status !== statusBefore,
    currentStatus: target.status,
  }
}

/**
 * Applique uniquement l'etat HGSS de l'objet. La presentation et le tour
 * adverse restent la responsabilite du coordinateur du combat simple.
 */
export function applySimpleBattleStatItem(
  state: SimpleBattleStatItemState,
  inventory: Map<number, number>,
  item: SimpleBattleStatItemSource,
): ApplySimpleBattleStatItemResult {
  const parameters = item.partyParameters
  const changes = simpleBattleStatItemStats.map((stat) => [
    stat,
    parameters[`${stat}Stages` as keyof SimpleBattleStatItemParameters] as number,
  ] as const)
  if (!changes.some(([, change]) => change > 0) && !parameters.guardSpec && parameters.criticalRateStages <= 0) {
    return { kind: 'not-stat-item' }
  }

  let applied = false
  for (const [stat, change] of changes) {
    if (change <= 0) continue
    const before = state.player.stages[stat]
    state.player.stages[stat] = Math.min(6, before + change)
    applied ||= state.player.stages[stat] !== before
  }
  if (parameters.guardSpec && state.player.screens.mistTurns === 0) {
    state.player.screens.mistTurns = 5
    applied = true
  }
  if (parameters.criticalRateStages > 0 && !state.player.volatile.focusEnergy) {
    state.player.volatile.focusEnergy = true
    applied = true
  }
  if (!applied) return { kind: 'no-effect', reason: `${item.name} n’aurait aucun effet.` }
  if (!takeBagItem(inventory, item.itemId, 1)) {
    throw new Error(`${item.name} a disparu du Sac avant son utilisation.`)
  }
  return { kind: 'used' }
}

export function applySimpleBattleEscapeItem(
  session: SimpleBattleSession,
  inventory: Map<number, number>,
  item: Pick<HgssItemData, 'itemId' | 'name' | 'battleUseFunction'>,
): ApplySimpleBattleEscapeItemResult {
  if (item.battleUseFunction !== 3) return { kind: 'not-escape-item' }
  if (session.kind === 'trainer') return { kind: 'trainer-blocked', events: [{ kind: 'cannotRunTrainer' }] }
  if (!takeBagItem(inventory, item.itemId, 1)) {
    throw new Error(`${item.name} a disparu du Sac avant son utilisation.`)
  }
  return { kind: 'used', events: escapeSimpleBattleWithItem(session) }
}
