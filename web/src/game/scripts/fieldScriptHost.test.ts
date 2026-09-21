import { describe, expect, it, vi } from 'vitest'
import { createFieldScriptHost, type FieldScriptStepHandler } from './fieldScriptHost'
import type { FieldScriptRunner, FieldScriptStep } from './fieldScriptProtocol'

function createRunner(steps: readonly FieldScriptStep[]): FieldScriptRunner {
  let index = 0
  const unavailable = () => undefined
  return {
    resume: () => steps[index++] ?? { kind: 'ended' },
    choose: unavailable,
    enterNumber: unavailable,
    enterNickname: unavailable,
    submitBattleResult: unavailable,
    submitMultiplayerResult: unavailable,
    submitEasyChat: unavailable,
    closePcBox: unavailable,
    closePokeathlonApp: unavailable,
    closeFrontierRecordsApp: unavailable,
    closeGameClear: unavailable,
    finishAlphPuzzle: unavailable,
    closeAlphHiddenRoom: unavailable,
    finishEggHatch: unavailable,
  }
}

describe('fieldScriptHost', () => {
  it('continue tant que le host de domaine rend la main immédiatement', () => {
    let runner: FieldScriptRunner | undefined = createRunner([
      { kind: 'dialogue', action: 'open' },
      { kind: 'ended' },
    ])
    const seen: string[] = []
    const handler: FieldScriptStepHandler = {
      handle: (step) => {
        seen.push(step.kind)
        if (step.kind === 'ended') runner = undefined
        return step.kind === 'ended' ? 'suspend' : 'continue'
      },
    }

    createFieldScriptHost({ readRunner: () => runner, handlers: [handler], onError: vi.fn() }).advance()

    expect(seen).toEqual(['dialogue', 'ended'])
  })

  it('suspend le runner dès qu’un host attend une présentation', () => {
    const runner = createRunner([{ kind: 'inputWait', accepts: ['confirm'] }, { kind: 'ended' }])
    const handle = vi.fn<FieldScriptStepHandler['handle']>(() => 'suspend')

    createFieldScriptHost({
      readRunner: () => runner,
      handlers: [{ handle }],
      onError: vi.fn(),
    }).advance()

    expect(handle).toHaveBeenCalledOnce()
  })

  it('essaie les hosts dans l’ordre jusqu’au premier qui reconnaît l’étape', () => {
    const runner = createRunner([{ kind: 'ended' }])
    const order: string[] = []
    const onError = vi.fn()

    createFieldScriptHost({
      readRunner: () => runner,
      handlers: [
        { handle: () => { order.push('ui'); return 'unhandled' } },
        { handle: () => { order.push('lifecycle'); return 'suspend' } },
        { handle: () => { order.push('late'); return 'suspend' } },
      ],
      onError,
    }).advance()

    expect(order).toEqual(['ui', 'lifecycle'])
    expect(onError).not.toHaveBeenCalled()
  })

  it('relit le runner actif après une étape continue', () => {
    const replacement = createRunner([{ kind: 'ended' }])
    let runner: FieldScriptRunner | undefined = createRunner([{ kind: 'dialogue', action: 'close' }])
    const seen: FieldScriptStep['kind'][] = []

    createFieldScriptHost({
      readRunner: () => runner,
      handlers: [{
        handle: (step) => {
          seen.push(step.kind)
          if (step.kind === 'dialogue') {
            runner = replacement
            return 'continue'
          }
          runner = undefined
          return 'suspend'
        },
      }],
      onError: vi.fn(),
    }).advance()

    expect(seen).toEqual(['dialogue', 'ended'])
  })

  it('signale les erreurs de handler et les étapes sans propriétaire', () => {
    const handlerError = new Error('presentation cassée')
    const onHandlerError = vi.fn()
    createFieldScriptHost({
      readRunner: () => createRunner([{ kind: 'save' }]),
      handlers: [{ handle: () => { throw handlerError } }],
      onError: onHandlerError,
    }).advance()
    expect(onHandlerError).toHaveBeenCalledWith(handlerError)

    const onUnhandledError = vi.fn()
    createFieldScriptHost({
      readRunner: () => createRunner([{ kind: 'save' }]),
      handlers: [{ handle: () => 'unhandled' }],
      onError: onUnhandledError,
    }).advance()
    expect(onUnhandledError.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      message: "L'étape de script ROM save n'a aucun host.",
    }))
  })
})
