export type PokemonMoveLearningRequest<TTarget> = {
  readonly moveId: number
  readonly target: TTarget
  phase: 'prompt' | 'choices' | 'cancel-confirmation'
}

export type PokemonMoveLearningCoordinatorOptions<TTarget> = {
  requestConfirmation: (
    kind: 'learn' | 'cancel',
    request: PokemonMoveLearningRequest<TTarget>,
    resolve: (confirmed: boolean) => void,
  ) => void
  showChoices: (request: PokemonMoveLearningRequest<TTarget>) => void
  resumeChoices: (request: PokemonMoveLearningRequest<TTarget>) => void
  commit: (request: PokemonMoveLearningRequest<TTarget>, forgetIndex: number) => void
}

export type PokemonMoveLearningCoordinator<TTarget> = {
  start: (target: TTarget, moveId: number) => boolean
  choose: (forgetIndex: number) => boolean
  cancel: () => boolean
  clear: () => void
  getPending: () => PokemonMoveLearningRequest<TTarget> | undefined
}

/**
 * Owns the confirmation gates shared by level-up move learning flows.
 *
 * The initial prompt and the cancellation prompt both default to No in the
 * UI supplied by the caller. A chosen old move is committed only after the
 * initial prompt was accepted, and a stale/doubled callback cannot commit the
 * request a second time.
 */
export function createPokemonMoveLearningCoordinator<TTarget>(
  options: PokemonMoveLearningCoordinatorOptions<TTarget>,
): PokemonMoveLearningCoordinator<TTarget> {
  let pending: PokemonMoveLearningRequest<TTarget> | undefined

  const finish = (request: PokemonMoveLearningRequest<TTarget>, forgetIndex: number): void => {
    if (pending !== request) return
    pending = undefined
    options.commit(request, forgetIndex)
  }

  return {
    start(target, moveId) {
      if (pending || !Number.isInteger(moveId) || moveId <= 0) return false
      const request: PokemonMoveLearningRequest<TTarget> = { target, moveId, phase: 'prompt' }
      pending = request
      options.requestConfirmation('learn', request, (confirmed) => {
        if (pending !== request || request.phase !== 'prompt') return
        if (!confirmed) {
          finish(request, -1)
          return
        }
        request.phase = 'choices'
        options.showChoices(request)
      })
      return true
    },
    choose(forgetIndex) {
      const request = pending
      if (!request || request.phase !== 'choices' || !Number.isInteger(forgetIndex) || forgetIndex < 0) return false
      finish(request, forgetIndex)
      return true
    },
    cancel() {
      const request = pending
      if (!request || request.phase !== 'choices') return false
      request.phase = 'cancel-confirmation'
      options.requestConfirmation('cancel', request, (confirmed) => {
        if (pending !== request || request.phase !== 'cancel-confirmation') return
        if (confirmed) {
          finish(request, -1)
          return
        }
        request.phase = 'choices'
        options.resumeChoices(request)
      })
      return true
    },
    clear() {
      pending = undefined
    },
    getPending() {
      return pending
    },
  }
}
