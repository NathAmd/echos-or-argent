import type { FieldScriptRunner, FieldScriptStep } from './fieldScriptProtocol'

export type FieldScriptStepDisposition = 'continue' | 'suspend' | 'unhandled'

export type FieldScriptStepHandler = {
  handle: (step: FieldScriptStep, runner: FieldScriptRunner) => FieldScriptStepDisposition
}

export type FieldScriptHost = {
  advance: () => void
}

export type FieldScriptHostPorts = {
  readRunner: () => FieldScriptRunner | undefined
  beforeStep?: (step: FieldScriptStep, runner: FieldScriptRunner) => void
  handlers: readonly FieldScriptStepHandler[]
  onError: (error: unknown) => void
  onUnhandledStep?: (step: FieldScriptStep) => never
}

function throwUnhandledFieldScriptStep(step: FieldScriptStep): never {
  throw new Error(`L'étape de script ROM ${step.kind} n'a aucun host.`)
}

/**
 * Boucle d'orchestration des scripts de terrain.
 *
 * Chaque host de domaine doit déclarer explicitement s'il a consommé l'étape
 * et si le runner peut continuer immédiatement. Une étape inconnue provoque
 * une erreur au lieu d'être ignorée silencieusement.
 */
export function createFieldScriptHost(ports: FieldScriptHostPorts): FieldScriptHost {
  const advance = (): void => {
    if (!ports.readRunner()) return
    try {
      for (;;) {
        const runner = ports.readRunner()
        if (!runner) return
        const step = runner.resume()
        ports.beforeStep?.(step, runner)

        let disposition: FieldScriptStepDisposition = 'unhandled'
        for (const handler of ports.handlers) {
          disposition = handler.handle(step, runner)
          if (disposition !== 'unhandled') break
        }

        if (disposition === 'continue') continue
        if (disposition === 'suspend') return
        ;(ports.onUnhandledStep ?? throwUnhandledFieldScriptStep)(step)
      }
    } catch (error) {
      ports.onError(error)
    }
  }

  return { advance }
}
