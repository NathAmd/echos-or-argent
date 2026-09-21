import type { FieldScriptExecutionState } from './fieldScriptExecutionState'
import type { FieldScriptStepDisposition, FieldScriptStepHandler } from './fieldScriptHost'
import type { FieldScriptRunner, FieldScriptStep } from './fieldScriptProtocol'

type FieldScriptLifecycleStep = Extract<FieldScriptStep, {
  kind: 'inputWait' | 'waiting' | 'save' | 'blackout' | 'ended'
}>

export type FieldScriptLifecycleHostPorts = Readonly<{
  execution: FieldScriptExecutionState<FieldScriptRunner>
  isMessageAcknowledged: () => boolean
  setMessageAcknowledged: (acknowledged: boolean) => void
  scheduleTimeout: (callback: () => void, delayMs: number) => unknown
  framesToMilliseconds: (frames: number) => number
  resume: () => void
  persistManualSave: () => boolean
  reportStatus: (message: string) => void
  performBlackout: () => void
  finishScript: () => void
}>

export type FieldScriptLifecycleHost = FieldScriptStepHandler

function isFieldScriptLifecycleStep(step: FieldScriptStep): step is FieldScriptLifecycleStep {
  return step.kind === 'inputWait'
    || step.kind === 'waiting'
    || step.kind === 'save'
    || step.kind === 'blackout'
    || step.kind === 'ended'
}

export function createFieldScriptLifecycleHost(ports: FieldScriptLifecycleHostPorts): FieldScriptLifecycleHost {
  const handleLifecycleStep = (step: FieldScriptLifecycleStep): FieldScriptStepDisposition => {
    if (step.kind === 'inputWait') {
      if (ports.isMessageAcknowledged() && step.accepts.includes('confirm')) {
        ports.setMessageAcknowledged(false)
        return 'continue'
      }
      if (step.frames === undefined) {
        ports.execution.beginWait('input', { acceptedInputs: step.accepts })
        return 'suspend'
      }
      const token = ports.execution.beginAsyncWait('input', { acceptedInputs: step.accepts })
      ports.scheduleTimeout(() => {
        if (!ports.execution.isAsyncWaitCurrent(token)) return
        ports.execution.clearWait({ clearAcceptedInputs: true })
        ports.setMessageAcknowledged(false)
        ports.resume()
      }, ports.framesToMilliseconds(step.frames))
      return 'suspend'
    }

    if (step.kind === 'waiting') {
      if (step.waitFor === 'movement' || step.waitFor === 'followerMovement') return 'unhandled'
      if (step.frames !== undefined) {
        const token = ports.execution.beginAsyncWait('timer')
        ports.scheduleTimeout(() => {
          if (!ports.execution.isAsyncWaitCurrent(token)) return
          ports.execution.clearWait()
          ports.resume()
        }, ports.framesToMilliseconds(step.frames))
      } else if (ports.isMessageAcknowledged()) {
        ports.setMessageAcknowledged(false)
        return 'continue'
      } else {
        ports.execution.beginWait('input')
      }
      return 'suspend'
    }

    if (step.kind === 'save') {
      ports.reportStatus(ports.persistManualSave() ? 'Sauvegarde effectuée.' : 'Sauvegarde impossible.')
      return 'continue'
    }

    if (step.kind === 'blackout') {
      ports.performBlackout()
      return 'continue'
    }

    ports.execution.clearMovementTasks()
    ports.finishScript()
    return 'suspend'
  }

  return Object.freeze({
    handle: (step: FieldScriptStep): FieldScriptStepDisposition => (
      isFieldScriptLifecycleStep(step) ? handleLifecycleStep(step) : 'unhandled'
    ),
  })
}
