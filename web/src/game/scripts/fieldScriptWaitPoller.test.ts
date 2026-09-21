import { describe, expect, it, vi } from 'vitest'
import type { FieldScriptExecutionWaitKind } from './fieldScriptExecutionState'
import { createFieldScriptWaitPoller } from './fieldScriptWaitPoller'

function createFixture() {
  let active = true
  let wait: FieldScriptExecutionWaitKind | undefined
  let soundEffectId: number | undefined = 1500
  let scriptMoving = false
  let followerMoving = false
  let soundPlaying = false
  let fanfarePlaying = false
  let cryPlaying = false
  const clearWait = vi.fn((options?: { clearSoundEffect?: boolean }) => {
    wait = undefined
    if (options?.clearSoundEffect) soundEffectId = undefined
  })
  const resume = vi.fn()
  const poller = createFieldScriptWaitPoller({
    execution: {
      getWait: () => wait,
      getSoundEffectId: () => soundEffectId,
      clearWait,
    },
    runtime: {
      isScriptMoving: () => scriptMoving,
      isFollowerMoving: () => followerMoving,
    },
    isScriptActive: () => active,
    readAudio: () => ({
      isSoundEffectPlaying: () => soundPlaying,
      isFanfarePlaying: () => fanfarePlaying,
      isCryPlaying: () => cryPlaying,
    }),
    resume,
  })
  return {
    poller,
    clearWait,
    resume,
    setActive: (value: boolean) => { active = value },
    setWait: (value: FieldScriptExecutionWaitKind | undefined) => { wait = value },
    setSoundEffectId: (value: number | undefined) => { soundEffectId = value },
    setMoving: (script: boolean, follower: boolean) => {
      scriptMoving = script
      followerMoving = follower
    },
    setAudioPlaying: (sound: boolean, fanfare: boolean, cry: boolean) => {
      soundPlaying = sound
      fanfarePlaying = fanfare
      cryPlaying = cry
    },
  }
}

describe('field script wait poller', () => {
  it('settles movement and follower movement only after their runtime stops', () => {
    const fixture = createFixture()
    fixture.setMoving(true, true)
    fixture.setWait('movement')
    fixture.poller.tick()
    expect(fixture.resume).not.toHaveBeenCalled()

    fixture.setMoving(false, true)
    fixture.poller.tick()
    expect(fixture.clearWait).toHaveBeenCalledOnce()
    expect(fixture.resume).toHaveBeenCalledOnce()

    fixture.setWait('followerMovement')
    fixture.poller.tick()
    expect(fixture.resume).toHaveBeenCalledOnce()
    fixture.setMoving(false, false)
    fixture.poller.tick()
    expect(fixture.resume).toHaveBeenCalledTimes(2)
  })

  it('waits for active audio and clears the sound-effect identity on completion', () => {
    const fixture = createFixture()
    fixture.setAudioPlaying(true, true, true)
    fixture.setWait('soundEffect')
    fixture.poller.tick()
    expect(fixture.resume).not.toHaveBeenCalled()

    fixture.setAudioPlaying(false, false, false)
    fixture.poller.tick()
    expect(fixture.clearWait).toHaveBeenCalledWith({ clearSoundEffect: true })
    expect(fixture.resume).toHaveBeenCalledOnce()

    fixture.setWait('fanfare')
    fixture.poller.tick()
    fixture.setWait('cry')
    fixture.poller.tick()
    expect(fixture.resume).toHaveBeenCalledTimes(3)
  })

  it('does not settle an inactive script or a sound wait without sequence id', () => {
    const fixture = createFixture()
    fixture.setWait('movement')
    fixture.setActive(false)
    fixture.poller.tick()
    fixture.setActive(true)
    fixture.setWait('soundEffect')
    fixture.setSoundEffectId(undefined)
    fixture.poller.tick()
    expect(fixture.clearWait).not.toHaveBeenCalled()
    expect(fixture.resume).not.toHaveBeenCalled()
  })

  it('preserves same-frame cascading after each resumed step', () => {
    const fixture = createFixture()
    const sequence: FieldScriptExecutionWaitKind[] = [
      'followerMovement',
      'soundEffect',
      'fanfare',
      'cry',
    ]
    fixture.setWait('movement')
    fixture.resume.mockImplementation(() => { fixture.setWait(sequence.shift()) })

    fixture.poller.tick()

    expect(fixture.resume).toHaveBeenCalledTimes(5)
    expect(sequence).toEqual([])
  })
})
