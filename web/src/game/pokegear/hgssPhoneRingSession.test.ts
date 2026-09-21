import { describe, expect, it, vi } from 'vitest'
import {
  advanceHgssPhoneIncomingGate,
  canSelectHgssPhoneIncoming,
  createHgssPhoneIncomingGateState,
  createHgssPhoneRingSession,
  HGSS_PHONE_INCOMING_INTERVAL_MINUTES,
  HGSS_PHONE_RING_MAX_ACTIVE_SECONDS,
  HGSS_PHONE_URGENT_PRIME_MINUTES,
  primeHgssPhoneIncomingGate,
  reinitializeHgssPhoneIncomingGate,
  resetHgssPhoneIncomingGate,
  syncHgssPhoneIncomingGate,
} from './hgssPhoneRingSession'

describe('sonnerie Pokématos HGSS', () => {
  it('porte le seuil natif et ignore un premier grand delta temporel', () => {
    expect(HGSS_PHONE_INCOMING_INTERVAL_MINUTES).toBe(10)
    expect(HGSS_PHONE_URGENT_PRIME_MINUTES).toBe(9)
    const initialized = advanceHgssPhoneIncomingGate(createHgssPhoneIncomingGateState(), 10)
    expect(initialized).toEqual({ timeAdvanceInitialized: true, elapsedMinutes: 0 })
    const elapsed = advanceHgssPhoneIncomingGate(initialized, 10)
    expect(elapsed.elapsedMinutes).toBe(10)
    expect(canSelectHgssPhoneIncoming(elapsed)).toBe(true)
  })

  it('synchronise les minutes absolues sans recompter et refuse un recul', () => {
    const first = syncHgssPhoneIncomingGate(createHgssPhoneIncomingGateState(), 100)
    expect(first).toEqual({ timeAdvanceInitialized: true, elapsedMinutes: 0, lastSyncedMinute: 100 })
    const second = syncHgssPhoneIncomingGate(first, 109)
    expect(second.elapsedMinutes).toBe(9)
    expect(canSelectHgssPhoneIncoming(second)).toBe(false)
    expect(syncHgssPhoneIncomingGate(second, 110).elapsedMinutes).toBe(10)
    expect(() => syncHgssPhoneIncomingGate(second, 108)).toThrow(/recule/)
    expect(() => advanceHgssPhoneIncomingGate(second, -1)).toThrow(/invalide/)
    expect(() => advanceHgssPhoneIncomingGate(second, 0.5)).toThrow(/invalide/)
  })

  it('réinitialise la chronologie lors du chargement avant une minute plus basse', () => {
    const previousSave = syncHgssPhoneIncomingGate(createHgssPhoneIncomingGateState(), 100)
    expect(() => syncHgssPhoneIncomingGate(previousSave, 0)).toThrow(/recule/)
    const restored = reinitializeHgssPhoneIncomingGate(0)
    expect(restored).toEqual({ timeAdvanceInitialized: false, elapsedMinutes: 0, lastSyncedMinute: 0 })
    expect(syncHgssPhoneIncomingGate(restored, 1)).toEqual({
      timeAdvanceInitialized: true,
      elapsedMinutes: 1,
      lastSyncedMinute: 1,
    })
  })

  it('prime un trigger urgent à neuf et conserve l’initialisation lors du reset', () => {
    const initialized = advanceHgssPhoneIncomingGate(createHgssPhoneIncomingGateState(), 0)
    const primed = primeHgssPhoneIncomingGate(initialized)
    expect(primed.elapsedMinutes).toBe(9)
    expect(canSelectHgssPhoneIncoming(primed)).toBe(false)
    const eligible = advanceHgssPhoneIncomingGate(primed, 1)
    expect(canSelectHgssPhoneIncoming(eligible)).toBe(true)
    expect(resetHgssPhoneIncomingGate(eligible)).toEqual({
      timeAdvanceInitialized: true,
      elapsedMinutes: 0,
    })
  })

  it('joue immédiatement puis au cycle natif sans superposer le même SE', () => {
    const play = vi.fn(), stop = vi.fn()
    let playing = false
    const session = createHgssPhoneRingSession<string>({ isSoundPlaying: () => playing, playSound: play, stopSound: stop })
    expect(session.start('Baoba', { soundSequenceId: 2169, soundCycleFrames: 30 }, 10, 1000)).toBe(true)
    session.tick(10, 1000); session.tick(39, 1200)
    expect(play).toHaveBeenCalledTimes(1)
    playing = true; session.tick(40, 1500)
    expect(play).toHaveBeenCalledTimes(1)
  })

  it('ne remplace jamais un appel déjà en sonnerie', () => {
    const session = createHgssPhoneRingSession<string>({ isSoundPlaying: () => false, playSound: vi.fn(), stopSound: vi.fn() })
    expect(session.start('premier', { soundSequenceId: 1, soundCycleFrames: 30 }, 0, 0)).toBe(true)
    expect(session.start('second', { soundSequenceId: 2, soundCycleFrames: 30 }, 0, 0)).toBe(false)
    expect(session.peek()).toBe('premier')
  })

  it('rend l’appel une seule fois au décrochage et arrête le son', () => {
    const stop = vi.fn(), states: boolean[] = []
    const session = createHgssPhoneRingSession<number>({ isSoundPlaying: () => true, playSound: vi.fn(), stopSound: stop, onStateChange: (value) => states.push(value) })
    session.start(24, { soundSequenceId: 2169, soundCycleFrames: 30 }, 0, 0)
    expect(session.answer()).toBe(24)
    expect(session.answer()).toBeUndefined()
    expect(stop).toHaveBeenCalledWith(2169)
    expect(states).toEqual([true, false])
  })

  it('expire après la durée native sans consommer la donnée persistante', () => {
    const session = createHgssPhoneRingSession<string>({ isSoundPlaying: () => false, playSound: vi.fn(), stopSound: vi.fn() })
    session.start('encore présent', { soundSequenceId: 2169, soundCycleFrames: 30 }, 0, 0)
    session.tick(1801, HGSS_PHONE_RING_MAX_ACTIVE_SECONDS * 1000 + 1)
    expect(session.isRinging()).toBe(false)
    expect(session.answer()).toBeUndefined()
  })

  it('expose la garde globale et remet son compteur à zéro au reset actif', () => {
    const session = createHgssPhoneRingSession<string>({ isSoundPlaying: () => false, playSound: vi.fn(), stopSound: vi.fn() })
    session.advanceIncomingCallMinutes(0)
    session.primeUrgentIncomingCall()
    session.advanceIncomingCallMinutes(1)
    expect(session.canSelectIncoming()).toBe(true)

    session.start('appel', { soundSequenceId: 2169, soundCycleFrames: 30 }, 0, 0)
    expect(session.canSelectIncoming()).toBe(false)
    session.reset()
    expect(session.getIncomingGateState()).toEqual({ timeAdvanceInitialized: true, elapsedMinutes: 0 })
    session.advanceIncomingCallMinutes(10)
    expect(session.canSelectIncoming()).toBe(true)
  })

  it('réinitialise une sauvegarde et consomme un appel forcé sans sonnerie artificielle', () => {
    const states: boolean[] = []
    const session = createHgssPhoneRingSession<string>({
      isSoundPlaying: () => false,
      playSound: vi.fn(),
      stopSound: vi.fn(),
      onStateChange: (state) => states.push(state),
    })
    session.syncIncomingCallMinutes(100)
    session.reinitializeIncomingCallGate(0)
    session.syncIncomingCallMinutes(0)
    session.syncIncomingCallMinutes(10)
    expect(session.getIncomingGateState()).toEqual({
      timeAdvanceInitialized: true,
      elapsedMinutes: 10,
      lastSyncedMinute: 10,
    })
    expect(session.canSelectIncoming()).toBe(true)
    session.consumeForcedIncomingCall()
    expect(session.getIncomingGateState()).toEqual({
      timeAdvanceInitialized: true,
      elapsedMinutes: 0,
      lastSyncedMinute: 10,
    })
    expect(states).toEqual([])
  })
})
