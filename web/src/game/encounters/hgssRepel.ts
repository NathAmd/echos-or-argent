import type { HgssItemData } from '../../rom/items/itemData'
import { hasBagItem, takeBagItem } from '../items/bagInventory'
import type { HgssRoamerSaveState } from './hgssRoamers'

// Confirmed against the decoded HGSS FR item catalog. Item IDs are the native
// constants; descriptions expose the corresponding 200/250/100-step values.
const hgssRepelStepsByItemId = new Map<number, number>([
  [76, 200],
  [77, 250],
  [79, 100],
])

export type UseHgssRepelResult =
  | { kind: 'used', steps: number, remaining: number }
  | { kind: 'unsupported' | 'missing-item', reason: string }

export function getHgssRepelStepCount(itemId: number): number | undefined {
  return hgssRepelStepsByItemId.get(itemId)
}

export function useHgssRepel(
  inventory: Map<number, number>,
  item: HgssItemData,
  state: HgssRoamerSaveState,
): UseHgssRepelResult {
  const steps = getHgssRepelStepCount(item.itemId)
  if (steps === undefined) return { kind: 'unsupported', reason: `${item.name} n’est pas un Repousse HGSS.` }
  const quantity = inventory.get(item.itemId) ?? 0
  if (!hasBagItem(inventory, item.itemId, 1)) return { kind: 'missing-item', reason: `${item.name} n’est plus dans le Sac.` }
  if (!takeBagItem(inventory, item.itemId, 1)) throw new Error(`La consommation de ${item.name} a perdu sa source.`)
  state.repelSteps = steps
  return { kind: 'used', steps, remaining: quantity - 1 }
}

/** L'étape d'expiration ouvre le script standard avant le contrôle sauvage. */
export function advanceHgssRepelStep(state: HgssRoamerSaveState): { protected: boolean, expired: boolean, blocksEncounter: boolean } {
  if (state.repelSteps <= 0) return { protected: false, expired: false, blocksEncounter: false }
  state.repelSteps -= 1
  const expired = state.repelSteps === 0
  return { protected: true, expired, blocksEncounter: expired }
}

export function isHgssEncounterRepelled(protectedStep: boolean, encounterLevel: number, leadLevel: number | undefined): boolean {
  return protectedStep && leadLevel !== undefined && encounterLevel < leadLevel
}
