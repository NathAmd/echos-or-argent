import type { HgssItemPartyParameters } from '../../rom/items/itemData'
import { isHgssBallItem } from './hgssCapture'

type FieldBattleStatItemParameters = Readonly<Pick<
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

export type FieldBattleBagItemSource = {
  readonly itemId: number
  readonly battleUseFunction: number
  readonly partyParameters: FieldBattleStatItemParameters
}

export type FieldBattleBagCatalogItem = FieldBattleBagItemSource & {
  readonly name: string
  readonly description: string
  readonly battlePocket: number
}

export type ResolvedFieldBattleBagAction =
  | { readonly kind: 'blocked', readonly reason: 'trainer-capture' | 'trainer-escape' }
  | { readonly kind: 'capture' }
  | { readonly kind: 'escape' }
  | { readonly kind: 'battle-stat' }
  | { readonly kind: 'party-target' }

export type FieldBattleBagActionResolver = (
  item: FieldBattleBagItemSource,
  context: { readonly opponent: 'wild' | 'trainer' },
) => ResolvedFieldBattleBagAction

function isBattleStatItem(item: FieldBattleBagItemSource): boolean {
  const parameters = item.partyParameters
  return parameters.guardSpec
    || parameters.criticalRateStages > 0
    || [
      parameters.attackStages,
      parameters.defenseStages,
      parameters.specialAttackStages,
      parameters.specialDefenseStages,
      parameters.speedStages,
      parameters.accuracyStages,
    ].some((change) => change > 0)
}

/** Classe un objet sans le consommer, appliquer son effet ni avancer le RNG. */
export const resolveBaseFieldBattleBagAction: FieldBattleBagActionResolver = (item, context) => {
  if (isHgssBallItem(item.itemId)) return context.opponent === 'wild'
    ? { kind: 'capture' }
    : { kind: 'blocked', reason: 'trainer-capture' }
  if (item.battleUseFunction === 3) return context.opponent === 'wild'
    ? { kind: 'escape' }
    : { kind: 'blocked', reason: 'trainer-escape' }
  return isBattleStatItem(item) ? { kind: 'battle-stat' } : { kind: 'party-target' }
}

/** Reproduit l'ordre et le filtrage du Sac de combat HGSS actuel. */
export function selectBaseFieldBattleBagEntries<T extends FieldBattleBagCatalogItem>(
  quantities: ReadonlyMap<number, number>,
  catalog: readonly (T | undefined)[],
): Array<{ readonly item: T, readonly quantity: number }> {
  return [...quantities.entries()]
    .filter(([, quantity]) => quantity > 0)
    .flatMap(([itemId, quantity]) => {
      const item = catalog[itemId]
      return item && item.battlePocket > 0 ? [{ item, quantity }] : []
    })
    .sort((left, right) => left.item.itemId - right.item.itemId)
}
