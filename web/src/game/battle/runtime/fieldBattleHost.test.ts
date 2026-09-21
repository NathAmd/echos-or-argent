import { describe, expect, it } from 'vitest'
import type { DoubleBattleSession } from '../doubleBattleSession'
import type { SimpleBattleSession } from '../simpleBattleSession'
import {
  createActiveBattleSnapshot,
  createIdleBattleSnapshot,
  isBattleCommandReady,
  type BattleSnapshotRuntimeState,
  type DoubleFieldBattleStartRequest,
  type SimpleFieldBattleStartRequest,
} from './fieldBattleHost'

function simpleRequest(
  phase: SimpleBattleSession['phase'] = 'command',
): SimpleFieldBattleStartRequest {
  return {
    format: 'simple',
    requestId: 'script-12',
    session: { kind: 'wild', phase } as SimpleBattleSession,
  }
}

function doubleRequest(
  phase: DoubleBattleSession['phase'] = 'command',
): DoubleFieldBattleStartRequest {
  return {
    format: 'double',
    requestId: 'trainer-pair-7',
    session: { kind: 'multi', phase } as DoubleBattleSession,
  }
}

function runtimeState(
  overrides: Partial<BattleSnapshotRuntimeState> = {},
): BattleSnapshotRuntimeState {
  return {
    presentationPhase: 'command',
    uiMode: 'command',
    queuedMessageCount: 0,
    messageInputLocked: false,
    presentationAnimationLocks: 0,
    hpAnimationLocks: 0,
    exitPending: false,
    ...overrides,
  }
}

describe('contrat du host de combat de terrain', () => {
  it('expose un snapshot inactif stable et immuable', () => {
    const first = createIdleBattleSnapshot()
    const second = createIdleBattleSnapshot()

    expect(first).toBe(second)
    expect(first).toEqual({
      active: false,
      format: 'none',
      kind: 'none',
      sessionPhase: 'none',
      presentationPhase: 'idle',
      uiMode: 'none',
      queuedMessageCount: 0,
      inputLocked: false,
      exitPending: false,
      commandSelectionPending: false,
    })
    expect(Object.isFrozen(first)).toBe(true)
  })

  it('projette les sessions simple et double sans perdre leur discrimination', () => {
    const simple = createActiveBattleSnapshot(simpleRequest(), runtimeState())
    const double = createActiveBattleSnapshot(
      doubleRequest('replacement'),
      runtimeState({ uiMode: 'party', commandSelectionPending: true }),
    )

    expect(simple).toMatchObject({
      active: true,
      format: 'simple',
      kind: 'wild',
      sessionPhase: 'command',
      requestId: 'script-12',
    })
    expect(double).toMatchObject({
      active: true,
      format: 'double',
      kind: 'multi',
      sessionPhase: 'replacement',
      requestId: 'trainer-pair-7',
      commandSelectionPending: true,
    })
    expect(Object.isFrozen(simple)).toBe(true)
    expect(Object.isFrozen(double)).toBe(true)
  })

  it('agrège les verrous internes sans exposer leurs compteurs', () => {
    const messageLock = createActiveBattleSnapshot(
      simpleRequest(),
      runtimeState({ messageInputLocked: true }),
    )
    const presentationLock = createActiveBattleSnapshot(
      simpleRequest(),
      runtimeState({ presentationAnimationLocks: 2 }),
    )
    const hpLock = createActiveBattleSnapshot(
      simpleRequest(),
      runtimeState({ hpAnimationLocks: 1 }),
    )

    expect(messageLock.inputLocked).toBe(true)
    expect(presentationLock.inputLocked).toBe(true)
    expect(hpLock.inputLocked).toBe(true)
    expect(createActiveBattleSnapshot(simpleRequest(), runtimeState()).inputLocked).toBe(false)
  })

  it('rejette les compteurs de runtime invalides', () => {
    expect(() => createActiveBattleSnapshot(
      simpleRequest(),
      runtimeState({ queuedMessageCount: -1 }),
    )).toThrow('queuedMessageCount')
    expect(() => createActiveBattleSnapshot(
      simpleRequest(),
      runtimeState({ presentationAnimationLocks: 0.5 }),
    )).toThrow('presentationAnimationLocks')
    expect(() => createActiveBattleSnapshot(
      simpleRequest(),
      runtimeState({ hpAnimationLocks: Number.NaN }),
    )).toThrow('hpAnimationLocks')
  })

  it('centralise la condition de disponibilité des commandes temps réel', () => {
    const ready = createActiveBattleSnapshot(simpleRequest(), runtimeState())
    expect(isBattleCommandReady(ready)).toBe(true)
    expect(isBattleCommandReady(createIdleBattleSnapshot())).toBe(false)
    expect(isBattleCommandReady(createActiveBattleSnapshot(
      simpleRequest('ended'),
      runtimeState(),
    ))).toBe(false)
    expect(isBattleCommandReady(createActiveBattleSnapshot(
      doubleRequest(),
      runtimeState({ queuedMessageCount: 1 }),
    ))).toBe(false)
    expect(isBattleCommandReady(createActiveBattleSnapshot(
      doubleRequest(),
      runtimeState({ presentationAnimationLocks: 1 }),
    ))).toBe(false)
    expect(isBattleCommandReady(createActiveBattleSnapshot(
      doubleRequest(),
      runtimeState({ commandSelectionPending: true }),
    ))).toBe(false)
    expect(isBattleCommandReady(createActiveBattleSnapshot(
      doubleRequest(),
      runtimeState({ exitPending: true }),
    ))).toBe(false)
  })
})
