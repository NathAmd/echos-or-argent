import { describe, expect, it, vi } from 'vitest'
import type { OpeningMapPreview } from '../../ndsTypes'
import type { RomAudioRuntime } from '../../audio/romAudioRuntime'
import { createFieldScriptExecutionState } from './fieldScriptExecutionState'
import { createFieldScriptAudioHost } from './fieldScriptAudioHost'
import type { FieldScriptRunner } from './fieldScriptProtocol'

function createAudio(): RomAudioRuntime {
  return {
    playMapMusic: vi.fn(async () => 1),
    playMusic: vi.fn(async () => undefined),
    playMusicByName: vi.fn(async () => 1),
    stopMusic: vi.fn(),
    fadeMusic: vi.fn(async () => undefined),
    playSoundEffect: vi.fn(async () => undefined),
    playPannedSoundEffect: vi.fn(async () => undefined),
    playMovingSoundEffect: vi.fn(async () => undefined),
    stopSoundEffect: vi.fn(),
    isSoundEffectPlaying: vi.fn(() => false),
    isAnySoundEffectPlaying: vi.fn(() => false),
    playFanfare: vi.fn(async () => undefined),
    isFanfarePlaying: vi.fn(() => false),
    playCry: vi.fn(async () => undefined),
    playCryAndWait: vi.fn(async () => undefined),
    isCryPlaying: vi.fn(() => false),
    stop: vi.fn(),
    dispose: vi.fn(async () => undefined),
  }
}

function createFixture(audio: RomAudioRuntime | null = createAudio()) {
  const execution = createFieldScriptExecutionState<FieldScriptRunner>()
  const reportStatus = vi.fn()
  const waitForPresentation = vi.fn()
  const map = {} as OpeningMapPreview
  const host = createFieldScriptAudioHost({
    execution,
    readAudio: () => audio ?? undefined,
    readActiveMap: () => map,
    reportStatus,
    waitForPresentation,
  })
  return { audio: audio ?? undefined, execution, host, map, reportStatus, waitForPresentation }
}

describe('fieldScriptAudioHost', () => {
  it('ignore explicitement les étapes d’un autre domaine', () => {
    const { host } = createFixture()
    expect(host.handle({ kind: 'save' }, {} as FieldScriptRunner)).toBe('unhandled')
  })

  it('joue, arrête et réinitialise la musique de la carte active', () => {
    const fixture = createFixture()
    expect(fixture.host.handle({ kind: 'music', action: 'play', sequenceId: 42 }, {} as FieldScriptRunner)).toBe('suspend')
    expect(fixture.audio?.playMusic).toHaveBeenCalledWith(42)
    expect(fixture.waitForPresentation).toHaveBeenLastCalledWith('music', expect.any(Promise), 'La musique ROM ne peut pas être lue.')

    expect(fixture.host.handle({ kind: 'music', action: 'reset' }, {} as FieldScriptRunner)).toBe('suspend')
    expect(fixture.audio?.playMapMusic).toHaveBeenCalledWith(fixture.map)

    expect(fixture.host.handle({ kind: 'music', action: 'stop' }, {} as FieldScriptRunner)).toBe('continue')
    expect(fixture.audio?.stopMusic).toHaveBeenCalledOnce()
  })

  it('applique les volumes natifs des fondus BGM', () => {
    const fixture = createFixture()
    fixture.host.handle({ kind: 'music', action: 'fadeOut', targetVolume: 24, frames: 30 }, {} as FieldScriptRunner)
    fixture.host.handle({ kind: 'music', action: 'fadeIn', targetVolume: 3, frames: 20 }, {} as FieldScriptRunner)
    expect(fixture.audio?.fadeMusic).toHaveBeenNthCalledWith(1, 24, 30)
    expect(fixture.audio?.fadeMusic).toHaveBeenNthCalledWith(2, 127, 20)
  })

  it('ne suspend WaitSE que tant que la séquence demandée joue', () => {
    const fixture = createFixture()
    expect(fixture.host.handle({ kind: 'soundEffect', action: 'wait', sequenceId: 1375 }, {} as FieldScriptRunner)).toBe('continue')
    vi.mocked(fixture.audio!.isSoundEffectPlaying).mockReturnValue(true)
    expect(fixture.host.handle({ kind: 'soundEffect', action: 'wait', sequenceId: 1375 }, {} as FieldScriptRunner)).toBe('suspend')
    expect(fixture.execution.snapshot()).toEqual(expect.objectContaining({
      wait: 'soundEffect',
      soundEffectId: 1375,
    }))
  })

  it('démarre les effets sans bloquer et présente fanfares et cris avec attente', async () => {
    const fixture = createFixture()
    expect(fixture.host.handle({ kind: 'soundEffect', action: 'play', sequenceId: 1500 }, {} as FieldScriptRunner)).toBe('continue')
    expect(fixture.audio?.playSoundEffect).toHaveBeenCalledWith(1500)

    expect(fixture.host.handle({ kind: 'fanfare', action: 'play', sequenceId: 1168 }, {} as FieldScriptRunner)).toBe('suspend')
    expect(fixture.waitForPresentation).toHaveBeenLastCalledWith('fanfareStart', expect.any(Promise), 'La fanfare ROM ne peut pas être lue.', { dismissMessage: false })

    expect(fixture.host.handle({ kind: 'cry', action: 'play', speciesId: 25, pattern: 9 }, {} as FieldScriptRunner)).toBe('suspend')
    expect(fixture.audio?.playCry).toHaveBeenCalledWith(25, 9)
    await Promise.resolve()
  })

  it('continue avec un diagnostic quand les archives audio sont absentes', () => {
    const fixture = createFixture(null)
    expect(fixture.host.handle({ kind: 'music', action: 'play', sequenceId: 1 }, {} as FieldScriptRunner)).toBe('continue')
    expect(fixture.host.handle({ kind: 'fanfare', action: 'play', sequenceId: 1 }, {} as FieldScriptRunner)).toBe('continue')
    expect(fixture.host.handle({ kind: 'cry', action: 'play', speciesId: 1, pattern: 0 }, {} as FieldScriptRunner)).toBe('continue')
    expect(fixture.reportStatus).toHaveBeenCalledTimes(3)
  })
})
