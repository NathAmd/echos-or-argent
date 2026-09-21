import type { OpeningMapPreview } from '../../ndsTypes'
import type { RomAudioRuntime } from '../../audio/romAudioRuntime'
import { startRomSoundEffect } from '../../audio/romAudioPresentation'
import type { FieldScriptWaitKind } from '../ui/fieldDialogWait'
import type { FieldScriptExecutionState } from './fieldScriptExecutionState'
import type { FieldScriptStepDisposition, FieldScriptStepHandler } from './fieldScriptHost'
import type { FieldScriptRunner, FieldScriptStep } from './fieldScriptProtocol'

type FieldScriptAudioStep = Extract<FieldScriptStep, {
  kind: 'music' | 'soundEffect' | 'fanfare' | 'cry'
}>

type OptionalPresentationOptions = Readonly<{
  dismissMessage?: boolean
  afterResume?: () => void
}>

export type FieldScriptAudioHostPorts = Readonly<{
  execution: FieldScriptExecutionState<FieldScriptRunner>
  readAudio: () => RomAudioRuntime | undefined
  readActiveMap: () => OpeningMapPreview | undefined
  reportStatus: (message: string) => void
  waitForPresentation: (
    waitKind: FieldScriptWaitKind,
    task: Promise<unknown>,
    fallbackMessage: string,
    options?: OptionalPresentationOptions,
  ) => void
}>

export type FieldScriptAudioHost = FieldScriptStepHandler

function isFieldScriptAudioStep(step: FieldScriptStep): step is FieldScriptAudioStep {
  return step.kind === 'music'
    || step.kind === 'soundEffect'
    || step.kind === 'fanfare'
    || step.kind === 'cry'
}

export function createFieldScriptAudioHost(ports: FieldScriptAudioHostPorts): FieldScriptAudioHost {
  const handleAudioStep = (step: FieldScriptAudioStep): Exclude<FieldScriptStepDisposition, 'unhandled'> => {
    const audio = ports.readAudio()
    if (step.kind === 'music') {
      if (!audio) {
        ports.reportStatus('L’archive audio ROM n’est pas chargée ; le script continue sans musique.')
        return 'continue'
      }
      if (step.action === 'stop') {
        audio.stopMusic()
        return 'continue'
      }
      const map = ports.readActiveMap()
      const musicPromise = step.action === 'fadeOut' || step.action === 'fadeIn'
        ? step.frames === undefined
          ? Promise.reject(new Error('Le fondu BGM ROM ne contient aucune duree.'))
          : audio.fadeMusic(step.action === 'fadeIn' ? 127 : step.targetVolume ?? 0, step.frames)
        : step.action === 'reset'
          ? map
            ? audio.playMapMusic(map).then(() => undefined)
            : Promise.reject(new Error('La carte ROM active est absente pour ResetBGM.'))
          : step.sequenceId === undefined
            ? Promise.reject(new Error('PlayBGM ne contient aucune sequence ROM.'))
            : audio.playMusic(step.sequenceId)
      ports.waitForPresentation('music', musicPromise, 'La musique ROM ne peut pas être lue.')
      return 'suspend'
    }

    if (step.kind === 'soundEffect') {
      if (!audio) return 'continue'
      if (step.action === 'stop') {
        audio.stopSoundEffect(step.sequenceId)
        return 'continue'
      }
      if (step.action === 'wait') {
        if (!audio.isSoundEffectPlaying(step.sequenceId)) return 'continue'
        ports.execution.beginWait('soundEffect', { soundEffectId: step.sequenceId })
        return 'suspend'
      }
      startRomSoundEffect(audio, step.sequenceId, (error: unknown) => {
        ports.reportStatus(error instanceof Error ? error.message : 'L’effet sonore ROM ne peut pas etre lu.')
      })
      return 'continue'
    }

    if (step.kind === 'fanfare') {
      if (!audio) {
        ports.reportStatus('L’archive audio ROM n’est pas chargée ; le script continue sans fanfare.')
        return 'continue'
      }
      if (step.action === 'wait') {
        if (!audio.isFanfarePlaying()) return 'continue'
        ports.execution.beginWait('fanfare')
        return 'suspend'
      }
      ports.waitForPresentation(
        'fanfareStart',
        audio.playFanfare(step.sequenceId),
        'La fanfare ROM ne peut pas être lue.',
        { dismissMessage: false },
      )
      return 'suspend'
    }

    if (!audio) {
      ports.reportStatus('L’archive audio ROM n’est pas chargée ; le script continue sans cri.')
      return 'continue'
    }
    if (step.action === 'wait') {
      if (!audio.isCryPlaying()) return 'continue'
      ports.execution.beginWait('cry')
      return 'suspend'
    }
    ports.waitForPresentation(
      'cryStart',
      audio.playCry(step.speciesId, step.pattern),
      'Le cri Pokémon ROM ne peut pas être lu.',
      { dismissMessage: false },
    )
    return 'suspend'
  }

  return Object.freeze({
    handle: (step: FieldScriptStep): FieldScriptStepDisposition => (
      isFieldScriptAudioStep(step) ? handleAudioStep(step) : 'unhandled'
    ),
  })
}
