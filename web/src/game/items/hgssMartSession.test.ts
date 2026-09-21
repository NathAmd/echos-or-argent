import { describe, expect, it } from 'vitest'
import type { HgssItemCatalog, HgssItemData } from '../../rom/items/itemData'
import { chooseHgssMartOption, createHgssMartSession, createHgssMartView, enterHgssMartQuantity, getHgssMartSellPrice, hgssMartConfirmNoChoice, hgssMartConfirmYesChoice, hgssMartExitChoice } from './hgssMartSession'

const item = (itemId: number, price: number, fieldPocket: HgssItemData['fieldPocket']): HgssItemData => ({
  itemId, name: `ITEM ${itemId}`, description: `DESC ${itemId}`, price, holdEffect: 0, holdEffectParameter: 0,
  pluckEffect: 0, flingEffect: 0, flingPower: 0, naturalGiftPower: 0, naturalGiftType: 0, preventToss: false,
  selectable: true, fieldPocket, battlePocket: 0, fieldUseFunction: 0, battleUseFunction: 0, partyUse: 0,
  partyParameters: {} as HgssItemData['partyParameters'],
})
const catalog = {
  items: Object.assign([], { 4: item(4, 200, 2), 17: item(17, 300, 1), 18: item(18, 100, 1), 99: item(99, 0, 0) }),
  pocketNames: ['OBJETS', 'MEDICAMENTS', 'BALLS'],
} as unknown as HgssItemCatalog

describe('HGSS mart session', () => {
  it('ouvre directement la commande native demandée et la ferme sans second menu', () => {
    const session = createHgssMartSession([4], 'buy')
    expect(createHgssMartView(session, new Map(), catalog, 500).options.map(({ value }) => value)).toEqual([4, hgssMartExitChoice])
    expect(chooseHgssMartOption(session, hgssMartExitChoice, new Map(), catalog, 500)).toEqual({ balance: 500, closed: true })
  })

  it('achète, vend à moitié prix et trie les objets par poche puis identifiant ROM', () => {
    const inventory = new Map([[4, 1], [17, 2], [18, 1], [99, 1]])
    const buySession = createHgssMartSession([4], 'buy')
    chooseHgssMartOption(buySession, 4, inventory, catalog, 500)
    expect(createHgssMartView(buySession, inventory, catalog, 500)).toMatchObject({ phase: 'quantity', transaction: { maxQuantity: 2 } })
    enterHgssMartQuantity(buySession, 2, inventory, catalog, 500)
    expect(createHgssMartView(buySession, inventory, catalog, 500).options.map(({ value }) => value)).toEqual([hgssMartConfirmNoChoice, hgssMartConfirmYesChoice])
    expect(chooseHgssMartOption(buySession, hgssMartConfirmYesChoice, inventory, catalog, 500).balance).toBe(100)
    expect(inventory.get(4)).toBe(3)
    const sellSession = createHgssMartSession([], 'sell')
    const sellView = createHgssMartView(sellSession, inventory, catalog, 100)
    expect(sellView.options.map(({ value }) => value)).toEqual([17, 18, 4, hgssMartExitChoice])
    expect(sellView.options.slice(0, 3).map(({ pocketLabel }) => pocketLabel)).toEqual(['MEDICAMENTS', 'MEDICAMENTS', 'BALLS'])
    chooseHgssMartOption(sellSession, 17, inventory, catalog, 100)
    enterHgssMartQuantity(sellSession, 2, inventory, catalog, 100)
    expect(chooseHgssMartOption(sellSession, hgssMartConfirmYesChoice, inventory, catalog, 100).balance).toBe(400)
    expect(inventory.has(17)).toBe(false)
    expect(getHgssMartSellPrice(301)).toBe(150)
  })

  it('annule la quantité ou la confirmation sans modifier le sac et présélectionne Non', () => {
    const inventory = new Map<number, number>()
    const session = createHgssMartSession([4], 'buy')
    chooseHgssMartOption(session, 4, inventory, catalog, 500)
    enterHgssMartQuantity(session, undefined, inventory, catalog, 500)
    expect(session.phase).toBe('browse')
    chooseHgssMartOption(session, 4, inventory, catalog, 500)
    enterHgssMartQuantity(session, 1, inventory, catalog, 500)
    expect(createHgssMartView(session, inventory, catalog, 500).options[0]?.value).toBe(hgssMartConfirmNoChoice)
    expect(chooseHgssMartOption(session, hgssMartConfirmNoChoice, inventory, catalog, 500)).toEqual({ balance: 500, closed: false })
    expect(inventory.size).toBe(0)
  })
})
