import { describe, expect, it, vi } from 'vitest'
import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import {
  consumeHgssPersistentIncomingCall,
  HGSS_PHONE_RING_CYCLE_FRAMES,
  HGSS_PHONE_RING_SOUND_SEQUENCE_ID,
  hgssPersistentIncomingCallTable,
  resolveHgssPersistentIncomingCallLaunch,
  selectHgssPersistentIncomingCall,
} from './hgssPersistentIncomingCalls'

function fixedRng(value: number, next = vi.fn(() => value)): HgssLcrng & { nextU16: typeof next } {
  return { getSeed: () => 0, nextU16: next }
}

const phoneBookEntries = [
  { id: 0, mapId: 1 },
  { id: 1, mapId: 61 },
  { id: 2, mapId: 2 },
  { id: 6, mapId: 50 },
  { id: 9, mapId: 9 },
  { id: 15, mapId: 15 },
  { id: 24, mapId: 524 },
]

describe('sélection globale des appels persistants HGSS', () => {
  it('porte les treize métadonnées exactes de ov02_02253C84', () => {
    expect(hgssPersistentIncomingCallTable.map(({ callerId, phoneScriptId, forcePickUp }) => (
      [callerId, phoneScriptId, forcePickUp]
    ))).toEqual([
      [1, 13, false], [1, 7, false], [15, 85, true], [9, 93, true],
      [2, 0, false], [6, 0, false], [24, 0, false], [24, 142, true],
      [24, 143, true], [24, 144, true], [24, 145, true], [24, 146, true],
      [0, 27, false],
    ])
  })

  it('met Orme et Baoba en compétition uniforme avec un seul tirage LCRNG', () => {
    const firstRng = fixedRng(0)
    expect(selectHgssPersistentIncomingCall({
      pendingTriggerIds: new Set([0, 6]),
      phoneBookEntries,
      currentMapId: 100,
      rng: firstRng,
      canSelectIncoming: true,
    })).toEqual({
      triggerId: 0,
      call: { callerId: 1, parameter1: 3, parameter2: 13 },
      forcePickUp: false,
    })
    expect(firstRng.nextU16).toHaveBeenCalledTimes(1)

    const secondRng = fixedRng(1)
    expect(selectHgssPersistentIncomingCall({
      pendingTriggerIds: new Set([0, 6]),
      phoneBookEntries,
      currentMapId: 100,
      rng: secondRng,
      canSelectIncoming: true,
    })).toEqual({
      triggerId: 6,
      call: { callerId: 24, parameter1: 3, parameter2: 0 },
      forcePickUp: false,
    })
    expect(secondRng.nextU16).toHaveBeenCalledTimes(1)
  })

  it('écarte le contact de sa propre carte mais conserve l’exception Day-C-Man enregistrée', () => {
    expect(selectHgssPersistentIncomingCall({
      pendingTriggerIds: new Set([0, 6]),
      phoneBookEntries,
      currentMapId: 61,
      rng: fixedRng(0),
      canSelectIncoming: true,
    })?.triggerId).toBe(6)
    expect(selectHgssPersistentIncomingCall({
      pendingTriggerIds: new Set([0, 6]),
      phoneBookEntries,
      currentMapId: 524,
      rng: fixedRng(0),
      canSelectIncoming: true,
    })?.triggerId).toBe(0)

    const daycare = {
      pendingTriggerIds: new Set([5]),
      phoneBookEntries,
      currentMapId: 50,
      rng: fixedRng(0),
      canSelectIncoming: true,
    }
    expect(selectHgssPersistentIncomingCall(daycare)).toBeUndefined()
    expect(selectHgssPersistentIncomingCall({ ...daycare, registeredContactIds: new Set([6]) })?.triggerId).toBe(5)
    expect(selectHgssPersistentIncomingCall({ ...daycare, isContactRegistered: (id) => id === 6 })?.triggerId).toBe(5)
  })

  it('exige la garde globale avant tout tirage et conserve les flags forcés', () => {
    const rng = fixedRng(0)
    expect(selectHgssPersistentIncomingCall({
      pendingTriggerIds: new Set([7]),
      phoneBookEntries,
      currentMapId: 100,
      rng,
      canSelectIncoming: () => false,
    })).toBeUndefined()
    expect(rng.nextU16).not.toHaveBeenCalled()
    expect(selectHgssPersistentIncomingCall({
      pendingTriggerIds: new Set([2, 3, 7, 8, 9, 10, 11]),
      phoneBookEntries,
      currentMapId: 100,
      rng: fixedRng(6),
      canSelectIncoming: true,
    })).toMatchObject({ triggerId: 11, forcePickUp: true })
  })

  it('résout la sonnerie ou le décrochage forcé sans branche propre au caller', () => {
    expect(resolveHgssPersistentIncomingCallLaunch({
      triggerId: 0,
      call: { callerId: 1, parameter1: 3, parameter2: 13 },
      forcePickUp: false,
    })).toEqual({
      kind: 'ringing',
      answerAction: 'openPokegearPhone',
      soundSequenceId: 2169,
      soundCycleFrames: 30,
    })
    expect(resolveHgssPersistentIncomingCallLaunch({
      triggerId: 7,
      call: { callerId: 24, parameter1: 3, parameter2: 142 },
      forcePickUp: true,
    })).toEqual({ kind: 'forcePickUp' })
    expect(HGSS_PHONE_RING_SOUND_SEQUENCE_ID).toBe(2169)
    expect(HGSS_PHONE_RING_CYCLE_FRAMES).toBe(30)
  })

  it('consomme le flag exactement une fois au décrochage', () => {
    const pending = new Set<number>([0, 6])
    expect(consumeHgssPersistentIncomingCall(pending, 0)).toBe(true)
    expect(consumeHgssPersistentIncomingCall(pending, 0)).toBe(false)
    expect([...pending]).toEqual([6])
  })
})
