import { describe, expect, it } from 'vitest'
import type { RomFile } from '../../ndsTypes'
import { decodeHgssItemCatalog, decodeHgssItemData, getHgssItemDataMemberIndex, hgssItemCount, hgssItemDataMemberCount, hgssItemDataSize } from './itemData'

describe('HGSS item data', () => {
  it('decodes the native packed pocket flags and core item fields', () => {
    const payload = new Uint8Array(hgssItemDataSize)
    const view = new DataView(payload.buffer)
    view.setUint16(0, 300, true)
    payload.set([4, 5, 6, 7, 80, 60], 2)
    view.setUint16(8, 12 | 0x20 | 0x40 | (4 << 7) | (17 << 11), true)
    payload.set([9, 10, 11], 0x0a)
    payload.set([0x95, 0xa5, 0x93, 0x74, 0xed, 0xeb, 0xab], 0x0e)
    payload.set([0xff, 2, 0xfd, 4, 0xfb, 6, 0xfe, 7, 0xf8, 9, 0xf6], 0x15)

    expect(decodeHgssItemData(payload, 149, '{100}BAIE ORAN', 'Rend des PV.')).toMatchObject({
      itemId: 149,
      name: 'BAIE ORAN',
      description: 'Rend des PV.',
      price: 300,
      holdEffect: 4,
      holdEffectParameter: 5,
      pluckEffect: 6,
      flingEffect: 7,
      flingPower: 80,
      naturalGiftPower: 60,
      naturalGiftType: 12,
      preventToss: true,
      selectable: true,
      fieldPocket: 4,
      battlePocket: 17,
      fieldUseFunction: 9,
      battleUseFunction: 10,
      partyUse: 11,
      partyParameters: {
        sleepHeal: true,
        poisonHeal: false,
        burnHeal: true,
        freezeHeal: false,
        paralysisHeal: true,
        confusionHeal: false,
        infatuationHeal: false,
        guardSpec: true,
        revive: true,
        reviveAll: false,
        levelUp: true,
        evolve: false,
        attackStages: 10,
        defenseStages: 3,
        specialAttackStages: 9,
        specialDefenseStages: 4,
        speedStages: 7,
        accuracyStages: 13,
        criticalRateStages: 2,
        ppUp: true,
        ppMax: true,
        ppRestore: true,
        ppRestoreAll: true,
        hpRestore: false,
        hpEvUp: true,
        attackEvUp: false,
        defenseEvUp: true,
        speedEvUp: true,
        specialAttackEvUp: true,
        specialDefenseEvUp: true,
        friendshipLow: true,
        friendshipMedium: false,
        friendshipHigh: true,
        hpEvParameter: -1,
        attackEvParameter: 2,
        defenseEvParameter: -3,
        speedEvParameter: 4,
        specialAttackEvParameter: -5,
        specialDefenseEvParameter: 6,
        hpRestoreParameter: 254,
        ppRestoreParameter: 7,
        friendshipLowParameter: -8,
        friendshipMediumParameter: 9,
        friendshipHighParameter: -10,
      },
    })
  })

  it('rejects malformed payloads and non-native pockets', () => {
    expect(() => decodeHgssItemData(new Uint8Array(1), 1, 'A', 'B')).toThrow('1 octets')
    const payload = new Uint8Array(hgssItemDataSize)
    new DataView(payload.buffer).setUint16(8, 8 << 7, true)
    expect(() => decodeHgssItemData(payload, 1, 'A', 'B')).toThrow('poche HGSS 8')
  })

  it('maps unused item identifiers through the native compact archive table', () => {
    expect([112, 113, 134, 135, 427, 428, 429, 536].map(getHgssItemDataMemberIndex)).toEqual([112, 0, 0, 113, 405, 0, 406, 513])
  })

  it('builds a contiguous catalog from ROM archive members and message banks', () => {
    const rom = new Uint8Array(hgssItemDataMemberCount * hgssItemDataSize)
    const archive: RomFile = {
      id: 1,
      path: '/a/0/1/7',
      offset: 0,
      size: rom.byteLength,
      signature: 'NARC',
      archiveEntries: hgssItemDataMemberCount,
      archiveMembers: Array.from({ length: hgssItemDataMemberCount }, (_, index) => ({
        index,
        offset: index * hgssItemDataSize,
        size: hgssItemDataSize,
        signature: '',
      })),
    }
    const names = Object.fromEntries(Array.from({ length: hgssItemCount }, (_, index) => [index, `Objet ${index}`]))
    const descriptions = Object.fromEntries(Array.from({ length: hgssItemCount }, (_, index) => [index, `Description ${index}`]))
    const pocketNames = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [index, `{100}Poche ${index}`]))

    const catalog = decodeHgssItemCatalog(rom, archive, names, descriptions, pocketNames)

    expect(catalog.items).toHaveLength(hgssItemCount)
    expect(catalog.pocketNames).toEqual(Array.from({ length: 8 }, (_, index) => `Poche ${index}`))
    expect(catalog.items[536]).toMatchObject({ itemId: 536, name: 'Objet 536', description: 'Description 536' })
  })
})
