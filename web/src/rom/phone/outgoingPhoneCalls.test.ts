import { describe, expect, it } from 'vitest'
import { createHgssLcrng } from '../../game/pokemon/hgssPokemonRng'
import { createHgssMersenneTwister } from '../../game/pokemon/hgssSessionRng'
import type { HgssPhoneBookEntry } from './phoneBook'
import { resolveHgssGenericOutgoingPhoneCall, resolveHgssOutgoingPhoneCall, resolveHgssOutgoingPhoneChoice, rollHgssPhonePercentChance } from './outgoingPhoneCalls'

const joey: HgssPhoneBookEntry = {
  id: 10, type: 0, unknown2: 0, trainerClass: 0, trainerId: 0, mapId: 20, giftItemId: 0,
  localScriptId: 29, unknownC: 0, rematchWeekday: 1, rematchTimeOfDay: 1, unknownF: 0,
  sortParameters: [0, 0, 0, 0],
}

function context(overrides: Partial<Parameters<typeof resolveHgssGenericOutgoingPhoneCall>[0]> = {}) {
  return {
    entry: joey, currentMapId: 1, gender: 'male' as const, now: new Date(2026, 7, 17, 12),
    flags: new Set<number>(), variables: new Map<number, number>(), rematchSeeking: new Set<number>(),
    giftItems: new Map<number, number>(), bugContestActive: false, badgeCount: 0,
    mt: createHgssMersenneTwister(7), lc: createHgssLcrng(7), ...overrides,
  }
}

describe('native outgoing Pokegear calls', () => {
  it('reproduces the inclusive two-word MTRNG percentage fold', () => {
    const values = [0x12345678, 0x87654321]
    expect(rollHgssPhonePercentChance({ nextU32: () => values.shift()!, snapshot: () => ({ state: [], cycle: 0 }) }, 100)).toBe(true)
  })

  it('uses the local phone script without consulting remote rules', () => {
    const call = resolveHgssGenericOutgoingPhoneCall(context({ currentMapId: 20 }))
    expect(call).toMatchObject({ callerId: 10, scriptId: 29, effects: [] })
    expect(call?.messages.at(-1)).toEqual({ source: 'contact', messageId: 6 })
  })

  it('blocks pre-Radio-Tower rematches and selects the native fallback header', () => {
    const call = resolveHgssGenericOutgoingPhoneCall(context())
    expect(call?.scriptId).toBe(35)
    expect(call?.messages[0]).toEqual({ source: 'greeting', messageId: 2 })
  })

  it('selects an already-requested rematch after the Radio Tower', () => {
    const call = resolveHgssGenericOutgoingPhoneCall(context({ flags: new Set([0xc6]), rematchSeeking: new Set([10]) }))
    expect(call).toMatchObject({ scriptId: 34, effects: [] })
    expect(call?.messages.at(-1)).toEqual({ source: 'contact', messageId: 11 })
  })

  it('routes Professor Elm through the exact story branches', () => {
    const elm = { ...joey, id: 1, type: 2, localScriptId: 1 }
    expect(resolveHgssOutgoingPhoneCall(context({ entry: elm }))?.scriptId).toBe(8)
    expect(resolveHgssOutgoingPhoneCall(context({ entry: elm, flags: new Set([0xee]) }))?.scriptId).toBe(9)
    expect(resolveHgssOutgoingPhoneCall(context({ entry: elm, currentMapId: elm.mapId }))?.scriptId).toBe(1)
  })

  it('keeps Mother savings behind the native yes/no continuation', () => {
    const mother = { ...joey, id: 0, type: 1 }
    const base = context({ entry: mother, flags: new Set([0x79, 0xa7]), bankBalance: 1200 })
    const call = resolveHgssOutgoingPhoneCall(base)
    expect(call?.messages.map(({ messageId }) => messageId)).toEqual([7, 24])
    expect(call?.choice?.kind).toBe('mom-saving')
    expect(call && resolveHgssOutgoingPhoneChoice(base, call, 'no')).toMatchObject({
      messages: [{ messageId: 26 }], effects: [{ kind: 'flag', flagId: 0x986, enabled: false }],
    })
  })

  it('evaluates Oak dex choices with the supplied native rating', () => {
    const oak = { ...joey, id: 2, type: 3 }
    const base = context({
      entry: oak,
      nationalDexEnabled: true,
      johtoDex: { seen: 210, owned: 190, ratingMessageId: 40, complete: false },
      nationalDex: { seen: 493, owned: 484, ratingMessageId: 24, complete: true },
    })
    const call = resolveHgssOutgoingPhoneCall(base)
    expect(call?.choice?.options.map(({ value }) => value)).toEqual(['johto-dex', 'national-dex', 'hang-up'])
    expect(call && resolveHgssOutgoingPhoneChoice(base, call, 'national-dex')).toMatchObject({
      messages: [{ messageId: 20 }, { messageId: 24 }],
      effects: [{ kind: 'flag', flagId: 0x988, enabled: true }],
    })
  })

  it('reports both daycare level gains without sharing stale buffers', () => {
    const lady = { ...joey, id: 7, type: 9 }
    const call = resolveHgssOutgoingPhoneCall(context({ entry: lady, daycare: {
      hasEgg: false,
      compatibilityMessageIndex: 1,
      mons: [{ nickname: 'GERMIGNON', levelGrowth: 2 }, { nickname: 'METAMORPH', levelGrowth: 1 }],
    } }))
    expect(call?.messages.map(({ messageId }) => messageId)).toEqual([3, 5, 6, 6, 9])
    expect(call?.messages.filter(({ messageId }) => messageId === 6).map(({ buffers }) => buffers)).toEqual([
      { 10: 'GERMIGNON', 11: '2' }, { 10: 'METAMORPH', 11: '1' },
    ])
  })

  it('creates the Gym Leader rematch only after the native confirmation', () => {
    const leader = { ...joey, id: 17, type: 12, rematchWeekday: 1, rematchTimeOfDay: 1 }
    const base = context({ entry: leader, badgeCount: 16, now: new Date(2026, 7, 17, 12) })
    const call = resolveHgssOutgoingPhoneCall(base)
    expect(call?.messages.map(({ messageId }) => messageId)).toEqual([2, 5])
    expect(call?.effects).toEqual([])
    expect(call && resolveHgssOutgoingPhoneChoice(base, call, 'yes')?.effects).toEqual([{ kind: 'rematch', contactId: 17 }])
  })

  it('applies native randomized gift item sets at call start', () => {
    const wadeGift = { ...joey, id: 11, localScriptId: 43 }
    const call = resolveHgssGenericOutgoingPhoneCall(context({ entry: wadeGift, currentMapId: wadeGift.mapId }))
    expect(call?.effects[0]).toMatchObject({ kind: 'item', contactId: 11 })
    expect((call?.effects[0] as { itemId: number }).itemId).toBeGreaterThanOrEqual(149)
    expect((call?.effects[0] as { itemId: number }).itemId).toBeLessThanOrEqual(158)
  })
})
