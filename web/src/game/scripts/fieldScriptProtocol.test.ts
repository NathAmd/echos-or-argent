import { describe, expect, it, vi } from 'vitest'
import {
  createFieldPhoneCallRunner,
  createFieldScriptSequenceRunner,
  projectFieldScriptState,
  type FieldScriptRunner,
  type FieldScriptStep,
} from './fieldScriptProtocol'

function createRunner(steps: readonly FieldScriptStep[]): FieldScriptRunner {
  let index = 0
  return {
    resume: () => steps[index++] ?? { kind: 'ended' },
    choose: () => undefined,
    enterNumber: () => undefined,
    enterNickname: () => undefined,
    submitBattleResult: () => undefined,
    submitMultiplayerResult: () => undefined,
    submitEasyChat: () => undefined,
    closePcBox: () => undefined,
    closePokeathlonApp: () => undefined,
    closeFrontierRecordsApp: () => undefined,
    closeGameClear: () => undefined,
    finishAlphPuzzle: () => undefined,
    closeAlphHiddenRoom: () => undefined,
    finishEggHatch: () => undefined,
  }
}

describe('protocole des scripts de terrain', () => {
  it('enchaîne les runners et relaie les contrôles vers le runner courant', () => {
    const choose = vi.fn()
    const decorate = vi.fn()
    const finishPhotoCapture = vi.fn()
    const closeGameClear = vi.fn()
    const first: FieldScriptRunner = {
      ...createRunner([
        { kind: 'message', messageId: 4, text: 'Bonjour' },
        { kind: 'ended' },
      ]),
      choose,
    }
    const second: FieldScriptRunner = {
      ...createRunner([
        { kind: 'inputWait', accepts: ['confirm'] },
        { kind: 'ended' },
      ]),
      submitSafariDecoratorSelection: decorate,
      finishPhotoCapture,
      closeGameClear,
    }
    const sequence = createFieldScriptSequenceRunner([first, second])

    expect(sequence.resume()).toEqual({ kind: 'message', messageId: 4, text: 'Bonjour' })
    sequence.choose(7)
    expect(choose).toHaveBeenCalledWith(7)

    expect(sequence.resume()).toEqual({ kind: 'inputWait', accepts: ['confirm'] })
    sequence.submitSafariDecoratorSelection?.(9)
    sequence.finishPhotoCapture?.()
    expect(decorate).toHaveBeenCalledWith(9)
    expect(finishPhotoCapture).toHaveBeenCalledOnce()
    sequence.closeGameClear()
    expect(closeGameClear).toHaveBeenCalledOnce()
    expect(sequence.resume()).toEqual({ kind: 'ended' })
  })

  it('expose un appel entrant une seule fois et refuse les saisies étrangères', () => {
    const call = { callerId: 12, parameter1: 34, parameter2: 56 }
    const runner = createFieldPhoneCallRunner(call)
    const firstStep = runner.resume()

    expect(firstStep).toEqual({ kind: 'phoneCall', call })
    if (firstStep.kind !== 'phoneCall') throw new Error('Étape téléphone attendue.')
    expect(firstStep.call).not.toBe(call)
    expect(runner.resume()).toEqual({ kind: 'ended' })
    expect(() => runner.choose(0)).toThrow("Cette saisie n'est pas disponible pendant un appel Pokématos entrant.")
    expect(() => runner.closeGameClear()).toThrow("Cette saisie n'est pas disponible pendant un appel Pokématos entrant.")
  })

  it('projette les étapes sans saisie et bloque dès une interaction', () => {
    expect(() => projectFieldScriptState(createRunner([
      { kind: 'mapProps', props: [] },
      { kind: 'ended' },
    ]))).not.toThrow()

    expect(() => projectFieldScriptState(createRunner([
      { kind: 'choice', options: [], cancellable: false },
    ]))).toThrow('Le script d’initialisation ROM requiert une saisie choice')

    expect(() => projectFieldScriptState(createRunner([
      {
        kind: 'gameClear', defeatedRed: false, firstClear: true,
        page: { facility: 'tower', facilityId: 1, title: 'Panthéon', view: 'single', viewLabel: 'Maître', rows: [] },
      },
    ]))).toThrow('Le script d’initialisation ROM requiert une saisie gameClear')
  })
})
