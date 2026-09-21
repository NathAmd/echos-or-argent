import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFieldScriptExecutionState } from './fieldScriptExecutionState'
import { createFieldScriptLifecycleHost } from './fieldScriptLifecycleHost'
import type { FieldScriptRunner } from './fieldScriptProtocol'

function createFixture() {
  const execution = createFieldScriptExecutionState<FieldScriptRunner>()
  execution.setRunner({} as FieldScriptRunner)
  let acknowledged = false
  const resume = vi.fn()
  const persistManualSave = vi.fn(() => true)
  const reportStatus = vi.fn()
  const performBlackout = vi.fn()
  const finishScript = vi.fn()
  const host = createFieldScriptLifecycleHost({
    execution,
    isMessageAcknowledged: () => acknowledged,
    setMessageAcknowledged: (value) => { acknowledged = value },
    scheduleTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
    framesToMilliseconds: (frames) => frames * 10,
    resume,
    persistManualSave,
    reportStatus,
    performBlackout,
    finishScript,
  })
  return {
    execution,
    host,
    resume,
    persistManualSave,
    reportStatus,
    performBlackout,
    finishScript,
    acknowledge: () => { acknowledged = true },
  }
}

describe('fieldScriptLifecycleHost', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('ouvre une attente avec seulement les inputs demandés', () => {
    const fixture = createFixture()
    expect(fixture.host.handle({ kind: 'inputWait', accepts: ['cancel', 'direction'] }, {} as FieldScriptRunner)).toBe('suspend')
    expect(fixture.execution.getWait()).toBe('input')
    expect(fixture.execution.getAcceptedInputs()).toEqual(['cancel', 'direction'])
  })

  it('consomme sans suspendre un acquittement confirm déjà reçu', () => {
    const fixture = createFixture()
    fixture.acknowledge()
    expect(fixture.host.handle({ kind: 'inputWait', accepts: ['confirm'] }, {} as FieldScriptRunner)).toBe('continue')
    expect(fixture.execution.getWait()).toBeUndefined()
  })

  it('reprend une attente temporisée uniquement si sa génération est encore active', () => {
    const fixture = createFixture()
    fixture.host.handle({ kind: 'inputWait', accepts: ['confirm'], frames: 4 }, {} as FieldScriptRunner)
    fixture.execution.invalidateAsync()
    vi.advanceTimersByTime(40)
    expect(fixture.resume).not.toHaveBeenCalled()

    fixture.host.handle({ kind: 'waiting', waitFor: 'timer', frames: 3 }, {} as FieldScriptRunner)
    vi.advanceTimersByTime(30)
    expect(fixture.execution.getWait()).toBeUndefined()
    expect(fixture.resume).toHaveBeenCalledOnce()
  })

  it('laisse les attentes de mouvement au host monde', () => {
    const fixture = createFixture()
    expect(fixture.host.handle({ kind: 'waiting', waitFor: 'movement' }, {} as FieldScriptRunner)).toBe('unhandled')
    expect(fixture.host.handle({ kind: 'waiting', waitFor: 'followerMovement' }, {} as FieldScriptRunner)).toBe('unhandled')
  })

  it('centralise sauvegarde, blackout et fin du runner', () => {
    const fixture = createFixture()
    expect(fixture.host.handle({ kind: 'save' }, {} as FieldScriptRunner)).toBe('continue')
    expect(fixture.reportStatus).toHaveBeenCalledWith('Sauvegarde effectuée.')
    expect(fixture.host.handle({ kind: 'blackout' }, {} as FieldScriptRunner)).toBe('continue')
    expect(fixture.performBlackout).toHaveBeenCalledOnce()
    fixture.execution.addMovementTask(Promise.resolve())
    expect(fixture.host.handle({ kind: 'ended' }, {} as FieldScriptRunner)).toBe('suspend')
    expect(fixture.execution.hasMovementTasks()).toBe(false)
    expect(fixture.finishScript).toHaveBeenCalledOnce()
  })
})
