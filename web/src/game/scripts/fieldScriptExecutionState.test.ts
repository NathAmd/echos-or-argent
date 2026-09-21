import { describe, expect, it } from 'vitest'
import { createFieldScriptExecutionState } from './fieldScriptExecutionState'

type TestRunner = Readonly<{ id: string }>

describe('état d’exécution des scripts terrain', () => {
  it('expose un état initial vide sans partager sa collection d’inputs', () => {
    const state = createFieldScriptExecutionState<TestRunner>()
    const acceptedInputs = state.getAcceptedInputs() as string[]
    acceptedInputs.push('confirm')

    expect(state.snapshot()).toEqual({
      active: false,
      wait: undefined,
      acceptedInputs: [],
      asyncGeneration: 0,
      pendingMovementTaskCount: 0,
      soundEffectId: undefined,
    })
  })

  it('commence et efface une attente sans invalider implicitement les tâches asynchrones', () => {
    const state = createFieldScriptExecutionState<TestRunner>()
    state.beginWait('input', { acceptedInputs: ['confirm', 'direction'] })
    state.beginWait('soundEffect', { soundEffectId: 1375 })

    expect(state.getWait()).toBe('soundEffect')
    expect(state.getAcceptedInputs()).toEqual(['confirm', 'direction'])
    expect(state.getSoundEffectId()).toBe(1375)
    expect(state.getAsyncGeneration()).toBe(0)

    state.clearWait()
    expect(state.getWait()).toBeUndefined()
    expect(state.getAcceptedInputs()).toEqual(['confirm', 'direction'])
    expect(state.getSoundEffectId()).toBe(1375)
    expect(state.getAsyncGeneration()).toBe(0)

    state.clearWait({ invalidateAsync: true, clearAcceptedInputs: true, clearSoundEffect: true })
    expect(state.getAcceptedInputs()).toEqual([])
    expect(state.getSoundEffectId()).toBeUndefined()
    expect(state.getAsyncGeneration()).toBe(1)
  })

  it('valide séparément les délais libres et les présentations liées au runner', () => {
    const state = createFieldScriptExecutionState<TestRunner>()
    const firstRunner = { id: 'first' }
    const secondRunner = { id: 'second' }
    state.setRunner(firstRunner)

    const timer = state.beginAsyncWait('timer')
    expect(state.isAsyncWaitCurrent(timer)).toBe(true)
    state.setRunner(secondRunner)
    expect(state.isAsyncWaitCurrent(timer)).toBe(true)

    const presentation = state.beginAsyncWait('music', { bindRunner: true })
    expect(state.isAsyncWaitCurrent(timer)).toBe(false)
    expect(state.isAsyncWaitCurrent(presentation)).toBe(true)
    state.setRunner(firstRunner)
    expect(state.isAsyncWaitCurrent(presentation)).toBe(false)

    state.setRunner(secondRunner)
    const replacement = state.beginAsyncWait('music', { bindRunner: true })
    expect(state.isAsyncWaitCurrent(presentation)).toBe(false)
    expect(state.isAsyncWaitCurrent(replacement)).toBe(true)
    state.invalidateAsync()
    expect(state.isAsyncWaitCurrent(replacement)).toBe(false)
  })

  it('reprend uniquement un input accepté avec un runner actif', () => {
    const state = createFieldScriptExecutionState<TestRunner>()
    state.beginWait('input', { acceptedInputs: ['direction', 'cancel'] })
    expect(state.resumeInput('left')).toBe(false)

    const runner = { id: 'runner' }
    state.setRunner(runner)
    expect(state.resumeInput('confirm')).toBe(false)
    expect(state.resumeInput('secondary')).toBe(false)
    expect(state.resumeInput('left')).toBe(true)

    expect(state.getRunner()).toBe(runner)
    expect(state.getWait()).toBeUndefined()
    expect(state.getAcceptedInputs()).toEqual([])
    expect(state.getAsyncGeneration()).toBe(1)
    expect(state.resumeInput('cancel')).toBe(false)
  })

  it('draine atomiquement les tâches de mouvement et permet leur abandon', () => {
    const state = createFieldScriptExecutionState<TestRunner>()
    const first = Promise.resolve()
    const second = Promise.resolve()
    state.addMovementTask(first)
    state.addMovementTask(second)

    expect(state.hasMovementTasks()).toBe(true)
    expect(state.getPendingMovementTaskCount()).toBe(2)
    expect(state.drainMovementTasks()).toEqual([first, second])
    expect(state.hasMovementTasks()).toBe(false)
    expect(state.drainMovementTasks()).toEqual([])

    state.addMovementTask(first)
    state.clearMovementTasks()
    expect(state.hasMovementTasks()).toBe(false)
  })

  it('reset invalide la génération et efface tous les états possédés', () => {
    const state = createFieldScriptExecutionState<TestRunner>()
    state.setRunner({ id: 'runner' })
    const token = state.beginAsyncWait('soundEffect', {
      acceptedInputs: ['confirm'],
      soundEffectId: 1500,
      bindRunner: true,
    })
    state.addMovementTask(Promise.resolve())

    state.reset()

    expect(state.isAsyncWaitCurrent(token)).toBe(false)
    expect(state.snapshot()).toEqual({
      active: false,
      wait: undefined,
      acceptedInputs: [],
      asyncGeneration: 2,
      pendingMovementTaskCount: 0,
      soundEffectId: undefined,
    })
  })

  it('peut relier le runner à un stockage de session existant pendant la migration', () => {
    let runner: TestRunner | undefined = { id: 'external' }
    const state = createFieldScriptExecutionState<TestRunner>({
      read: () => runner,
      write: (next) => { runner = next },
    })

    expect(state.getRunner()).toEqual({ id: 'external' })
    const token = state.beginAsyncWait('music', { bindRunner: true })
    runner = { id: 'replacement' }
    expect(state.isAsyncWaitCurrent(token)).toBe(false)

    state.setRunner({ id: 'written' })
    expect(runner).toEqual({ id: 'written' })
    state.reset()
    expect(runner).toBeUndefined()
  })
})
