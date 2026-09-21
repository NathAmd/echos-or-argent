import { describe, expect, it } from 'vitest'
import {
  resolveBaseFieldBattleBagAction,
  selectBaseFieldBattleBagEntries,
  type FieldBattleBagCatalogItem,
} from './fieldBattleBagActionResolver'

const neutralStatParameters = {
  guardSpec: false,
  attackStages: 0,
  defenseStages: 0,
  specialAttackStages: 0,
  specialDefenseStages: 0,
  speedStages: 0,
  accuracyStages: 0,
  criticalRateStages: 0,
} as const

function bagItem(
  itemId: number,
  options: Partial<Omit<FieldBattleBagCatalogItem, 'itemId' | 'partyParameters'>> & {
    partyParameters?: Partial<FieldBattleBagCatalogItem['partyParameters']>
  } = {},
): FieldBattleBagCatalogItem {
  return {
    itemId,
    name: `Objet ${itemId}`,
    description: 'Description ROM',
    battlePocket: 1,
    battleUseFunction: 0,
    ...options,
    partyParameters: { ...neutralStatParameters, ...options.partyParameters },
  }
}

describe('base field battle bag action resolver', () => {
  it.each([
    [bagItem(4), 'wild', { kind: 'capture' }],
    [bagItem(4), 'trainer', { kind: 'blocked', reason: 'trainer-capture' }],
    [bagItem(80, { battleUseFunction: 3 }), 'wild', { kind: 'escape' }],
    [bagItem(80, { battleUseFunction: 3 }), 'trainer', { kind: 'blocked', reason: 'trainer-escape' }],
    [bagItem(57, { partyParameters: { attackStages: 1 } }), 'wild', { kind: 'battle-stat' }],
    [bagItem(58, { partyParameters: { guardSpec: true } }), 'trainer', { kind: 'battle-stat' }],
    [bagItem(17), 'wild', { kind: 'party-target' }],
  ] as const)('routes item $0 against $1 opponents to $2', (item, opponent, expected) => {
    expect(resolveBaseFieldBattleBagAction(item, { opponent })).toEqual(expected)
  })

  it('keeps Ball precedence over escape and stat flags', () => {
    const item = Object.freeze(bagItem(4, {
      battleUseFunction: 3,
      partyParameters: { attackStages: 1 },
    }))

    expect(resolveBaseFieldBattleBagAction(item, { opponent: 'wild' })).toEqual({ kind: 'capture' })
    expect(item.battleUseFunction).toBe(3)
    expect(item.partyParameters.attackStages).toBe(1)
  })

  it('lists only owned battle-pocket items in item-id order', () => {
    const catalog: Array<FieldBattleBagCatalogItem | undefined> = []
    catalog[4] = bagItem(4)
    catalog[17] = bagItem(17, { battlePocket: 0 })
    catalog[57] = bagItem(57)

    expect(selectBaseFieldBattleBagEntries(new Map([
      [57, 2],
      [17, 3],
      [999, 1],
      [4, 1],
      [58, 0],
    ]), catalog)).toEqual([
      { item: catalog[4], quantity: 1 },
      { item: catalog[57], quantity: 2 },
    ])
  })
})
