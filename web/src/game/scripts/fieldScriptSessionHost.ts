import type { OpeningMapPreview } from '../../ndsTypes'
import { formatPreparedFieldBattle } from '../battle/prepareFieldBattle'
import type { FieldBattleLauncher } from '../battle/runtime/fieldBattleHost'
import {
  executeHgssMultiplayerWithOfflineFallback,
  type HgssMultiplayerGateway,
} from '../multiplayer/hgssMultiplayerGateway'
import { HgssFieldPartyInvariantError } from '../pokemon/pokemonParty'
import type { WorldSession } from '../world/worldSession'
import type { FieldScriptExecutionState } from './fieldScriptExecutionState'
import type { FieldScriptStepDisposition, FieldScriptStepHandler } from './fieldScriptHost'
import type { FieldScriptRunner, FieldScriptStep } from './fieldScriptProtocol'

type FieldScriptSessionStep = Extract<FieldScriptStep, {
  kind: 'warp' | 'multiplayer' | 'battle'
}>

export type FieldScriptSessionWorld = Pick<WorldSession, 'scriptWarpTo'>

export type FieldScriptSessionHostPorts = Readonly<{
  execution: FieldScriptExecutionState<FieldScriptRunner>
  clearMovement: () => void
  reportStatus: (message: string) => void
  warp: Readonly<{
    readWorldSession: () => FieldScriptSessionWorld | undefined
    loadTransition: (
      map: OpeningMapPreview,
      interruptedRunner: FieldScriptRunner | undefined,
    ) => void
  }>
  multiplayer: Readonly<{
    gateway: HgssMultiplayerGateway
    dismissAcknowledgedMessage: () => void
    resume: () => void
  }>
  battle: Readonly<{
    launcher: FieldBattleLauncher
    setDialogueAcknowledged: (acknowledged: boolean) => void
    setActiveRunner: (runner: FieldScriptRunner | undefined) => void
    closeDialogue: () => void
    isBotRunning: () => boolean
    suspendBot: () => void
    resetAfterFailedLaunch: () => void
  }>
}>

export type FieldScriptSessionHost = FieldScriptStepHandler

function isFieldScriptSessionStep(step: FieldScriptStep): step is FieldScriptSessionStep {
  return step.kind === 'warp' || step.kind === 'multiplayer' || step.kind === 'battle'
}

export function createFieldScriptSessionHost(ports: FieldScriptSessionHostPorts): FieldScriptSessionHost {
  const handleWarp = (step: Extract<FieldScriptSessionStep, { kind: 'warp' }>): FieldScriptStepDisposition => {
    const interruptedRunner = ports.execution.getRunner()
    const result = ports.warp.readWorldSession()?.scriptWarpTo(step.mapId, step.x, step.z, step.direction)
    if (!result || result.kind === 'missing-map' || result.kind === 'missing-anchor') {
      throw new Error(`Warp script ROM vers la carte ${step.mapId} indisponible.`)
    }
    ports.clearMovement()
    ports.warp.loadTransition(result.state.map, interruptedRunner)
    return 'suspend'
  }

  const handleMultiplayer = (
    step: Extract<FieldScriptSessionStep, { kind: 'multiplayer' }>,
    runner: FieldScriptRunner,
  ): FieldScriptStepDisposition => {
    ports.multiplayer.dismissAcknowledgedMessage()
    const waitToken = ports.execution.beginAsyncWait('multiplayer', { bindRunner: true })
    void executeHgssMultiplayerWithOfflineFallback(ports.multiplayer.gateway, step.request)
      .then((execution) => {
        if (!ports.execution.isAsyncWaitCurrent(waitToken)) return
        runner.submitMultiplayerResult(execution.result)
        ports.execution.clearWait()
        if ('error' in execution) {
          ports.reportStatus(
            execution.error instanceof Error
              ? execution.error.message
              : 'Le service multijoueur HGSS est indisponible.',
          )
        }
        ports.multiplayer.resume()
      })
    return 'suspend'
  }

  const handleBattle = (
    step: Extract<FieldScriptSessionStep, { kind: 'battle' }>,
    runner: FieldScriptRunner,
  ): FieldScriptStepDisposition => {
    ports.battle.setDialogueAcknowledged(false)
    ports.clearMovement()
    try {
      const launch = ports.battle.launcher.launch(step.battle)
      ports.battle.setActiveRunner(runner)
      ports.battle.closeDialogue()
      ports.reportStatus(formatPreparedFieldBattle(launch.battle))
      if (ports.battle.isBotRunning()) ports.battle.suspendBot()
      return 'suspend'
    } catch (error) {
      if (error instanceof HgssFieldPartyInvariantError) throw error
      if (ports.battle.isBotRunning()) {
        ports.battle.resetAfterFailedLaunch()
        throw error
      }
      runner.submitBattleResult(false)
      ports.battle.resetAfterFailedLaunch()
      ports.reportStatus(error instanceof Error ? error.message : 'Le combat ROM ne peut pas être préparé.')
      // submitBattleResult a avancé le contexte suspendu : ce même runner doit
      // redevenir actif avant que FieldScriptHost appelle resume() à nouveau.
      ports.execution.setRunner(runner)
      return 'continue'
    }
  }

  return Object.freeze({
    handle: (step: FieldScriptStep, runner: FieldScriptRunner): FieldScriptStepDisposition => {
      if (!isFieldScriptSessionStep(step)) return 'unhandled'
      if (step.kind === 'warp') return handleWarp(step)
      if (step.kind === 'multiplayer') return handleMultiplayer(step, runner)
      return handleBattle(step, runner)
    },
  })
}
