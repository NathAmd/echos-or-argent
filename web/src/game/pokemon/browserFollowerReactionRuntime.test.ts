import { describe, expect, it, vi } from 'vitest'
import type { HgssFollowerEmote } from '../../rom/overworld/followerEmotes'
import type {
  HgssFollowerReaction,
  HgssFollowerReactionMotion,
} from '../../rom/overworld/followerReactions'
import type { FieldScriptWaitKind } from '../ui/fieldDialogWait'
import type { CanonicalPokemon } from './canonicalPokemon'
import {
  createBrowserFollowerReactionRuntime,
  type BrowserFollowerReactionResources,
} from './browserFollowerReactionRuntime'

function pokemon(overrides: Partial<CanonicalPokemon> = {}): CanonicalPokemon {
  return {
    speciesId: 155,
    speciesName: 'HÉRICENDRE',
    nickname: 'FLAMME',
    heldItemId: 7,
    friendship: 100,
    shinyLeafMask: 0,
    ...overrides,
  } as CanonicalPokemon
}

function reaction(
  steps: HgssFollowerReaction['steps'],
  effects: Partial<HgssFollowerReaction['effects']> = {},
): HgssFollowerReaction {
  return {
    reactionId: 495,
    steps,
    terminated: true,
    effects: {
      rawPrefix: [],
      friendshipDelta: 0,
      moodDelta: 0,
      fashionItemId: 0,
      shinyLeafIndex: 0,
      ...effects,
    },
  }
}

async function flushMicrotasks(count = 12): Promise<void> {
  for (let index = 0; index < count; index += 1) await Promise.resolve()
}

function createFixture(options: {
  formatMessage?: (message: string, state: TestState) => string
  playMotion?: (motion: HgssFollowerReactionMotion, ignoreHeight?: boolean, onSound?: (segmentIndex: number) => void) => Promise<void>
} = {}) {
  type TimerEntry = { callback: () => void, cancelled: boolean }
  const events: string[] = []
  const originalBuffers = new Map<number, string>([[9, 'conservé']])
  const state: TestState = {
    buffers: originalBuffers,
    playerName: 'LUTH',
    followerMood: 4,
  }
  const motion = { movementId: 1, segments: [], terminated: true } as HgssFollowerReactionMotion
  const emote = { emoteId: 1, textures: [], timeline: {}, soundId: 1501 } as unknown as HgssFollowerEmote
  const resources: BrowserFollowerReactionResources = {
    catalog: {
      interactionMessages: { 0: 'MESSAGE ROM' },
      movements: [motion],
    },
    resolveEmote: () => emote,
    getItemName: (itemId) => itemId === 7 ? 'BAIE' : undefined,
  }
  let wait: FieldScriptWaitKind | undefined
  const setRunner = vi.fn()
  const beginWait = vi.fn((nextWait: 'input' | 'followerReaction') => {
    wait = nextWait
    events.push(`wait:${nextWait}`)
  })
  const clearWait = vi.fn(() => { wait = undefined })
  const showMessages = vi.fn((message: string) => { events.push(`message:${message}`) })
  const hide = vi.fn(() => { events.push('dialogue:hide') })
  const playFollowerReactionMotion = vi.fn(options.playMotion ?? (async (_motion, ignoreHeight, onSound) => {
    events.push(`motion:${String(ignoreHeight)}`)
    onSound?.(0)
  }))
  const playFollowerEmote = vi.fn(async (_emote, onSound?: (soundId: number) => void) => {
    events.push('emote')
    onSound?.(1501)
  })
  const playSoundEffect = vi.fn(async (soundId: number) => { events.push(`sound:${soundId}`) })
  const playCry = vi.fn(async (speciesId: number, pattern: number, _pan?: number, _volume?: number, form?: number) => { events.push(`cry:${speciesId}:${pattern}:${String(form)}`) })
  const reportStatus = vi.fn((message: string) => { events.push(`status:${message}`) })
  const giveFashionAccessory = vi.fn((accessoryId: number) => { events.push(`accessory:${accessoryId}`) })
  const advance = vi.fn(() => { events.push('advance') })
  const clearMovement = vi.fn(() => { events.push('movement:clear') })
  let nextTimer = 1
  const timers = new Map<number, TimerEntry>()
  const allTimers = new Map<number, TimerEntry>()
  const schedule = vi.fn((callback: () => void, delayMs: number) => {
    const handle = nextTimer++
    const entry = { callback, cancelled: false }
    timers.set(handle, entry)
    allTimers.set(handle, entry)
    events.push(`timer:${delayMs}`)
    return handle
  })
  const cancelTimer = vi.fn((handle: unknown) => {
    const entry = timers.get(handle as number)
    if (entry) entry.cancelled = true
    timers.delete(handle as number)
  })
  const runtime = createBrowserFollowerReactionRuntime({
    readState: () => state,
    readMapLabel: () => 'ROUTE 29',
    readResources: () => resources,
    formatMessage: options.formatMessage ?? ((message, currentState) => (
      `${message}|${[0, 1, 2, 3, 4].map((id) => currentState.buffers.get(id)).join('|')}`
    )),
    runtime: { playFollowerReactionMotion, playFollowerEmote },
    readAudio: () => ({ playSoundEffect, playCry }),
    dialogue: {
      showMessages: showMessages as never,
      hide,
    },
    execution: { setRunner, beginWait, clearWait },
    clearMovement,
    giveFashionAccessory,
    reportStatus,
    advance,
    timer: {
      schedule,
      cancel: cancelTimer,
      framesToMilliseconds: (frames) => frames * 17,
    },
  })
  return {
    runtime,
    state,
    originalBuffers,
    resources,
    events,
    showMessages,
    hide,
    setRunner,
    beginWait,
    clearWait,
    playFollowerReactionMotion,
    playFollowerEmote,
    playSoundEffect,
    playCry,
    reportStatus,
    giveFashionAccessory,
    advance,
    clearMovement,
    schedule,
    cancelTimer,
    timers,
    runTimer(handle = [...timers.keys()][0]) {
      const entry = handle === undefined ? undefined : timers.get(handle)
      if (!entry) throw new Error('Timer de test absent.')
      timers.delete(handle!)
      entry.callback()
    },
    runStaleTimer(handle: number) {
      allTimers.get(handle)?.callback()
    },
    getWait: () => wait,
  }
}

type TestState = {
  buffers: Map<number, string>
  playerName: string
  followerMood: number
}

describe('browser follower reaction runtime', () => {
  it('joue mouvement, emote, message et délai puis applique les effets', async () => {
    const fixture = createFixture()
    const target = pokemon()
    fixture.runtime.start(target, reaction([{
      movementId: 1,
      emoteId: 1,
      messageId: 1,
      soundId: 12,
      delay: 2,
    }], {
      friendshipDelta: 5,
      moodDelta: -3,
      shinyLeafIndex: 1,
      fashionItemId: 8,
    }))

    await flushMicrotasks()
    expect(fixture.runtime.isActive()).toBe(true)
    expect(fixture.showMessages).toHaveBeenCalledWith(
      'MESSAGE ROM|FLAMME|HÉRICENDRE|LUTH|ROUTE 29|BAIE',
      { speaker: 'FLAMME' },
    )
    expect(fixture.state.buffers).toBe(fixture.originalBuffers)
    expect(fixture.runtime.consumeMessageConfirmation()).toBe(true)
    expect(fixture.runtime.consumeMessageConfirmation()).toBe(false)
    await flushMicrotasks()

    expect(fixture.schedule).toHaveBeenCalledWith(expect.any(Function), 34)
    fixture.runTimer()
    await flushMicrotasks()

    expect(fixture.runtime.isActive()).toBe(false)
    expect(target.friendship).toBe(105)
    expect(target.shinyLeafMask).toBe(1)
    expect(fixture.state.followerMood).toBe(1)
    expect(fixture.giveFashionAccessory).toHaveBeenCalledWith(8)
    expect(fixture.advance).toHaveBeenCalledOnce()
    expect(fixture.reportStatus).toHaveBeenLastCalledWith(
      'FLAMME termine la réaction ROM 495. Accessoire 8 remis.',
    )
    expect(fixture.events).toEqual(expect.arrayContaining([
      'motion:false',
      'sound:12',
      'emote',
      'sound:1501',
      'movement:clear',
      'dialogue:hide',
      'timer:34',
      'accessory:8',
      'advance',
    ]))
  })

  it('route les IDs sonores follower vers PlaySE et les deux motifs PlayCryEx natifs', async () => {
    const fixture = createFixture()
    fixture.runtime.start(pokemon({ speciesId: 492, form: 1 }), reaction([0, 2378, 2379, 2380].map((soundId) => ({
      movementId: 1,
      emoteId: 0,
      messageId: 0,
      soundId,
      delay: 0,
    }))))
    await flushMicrotasks(24)

    expect(fixture.playSoundEffect.mock.calls).toEqual([[2378]])
    expect(fixture.playCry.mock.calls).toEqual([
      [492, 0, undefined, undefined, 1],
      [492, 11, undefined, undefined, 1],
    ])
    expect(fixture.reportStatus).toHaveBeenLastCalledWith('FLAMME termine la réaction ROM 495.')
    expect(fixture.runtime.isActive()).toBe(false)
  })

  it('consomme une confirmation exactement une fois avant de reprendre le playback', async () => {
    const fixture = createFixture()
    fixture.runtime.start(pokemon(), reaction([{
      movementId: 0,
      emoteId: 0,
      messageId: 1,
      soundId: 0,
      delay: 0,
    }]))
    await flushMicrotasks()

    expect(fixture.getWait()).toBe('input')
    expect(fixture.runtime.consumeMessageConfirmation()).toBe(true)
    expect(fixture.runtime.consumeMessageConfirmation()).toBe(false)
    expect(fixture.hide).toHaveBeenCalledOnce()
    expect(fixture.beginWait).toHaveBeenLastCalledWith('followerReaction')
    await flushMicrotasks()
    expect(fixture.advance).toHaveBeenCalledOnce()
  })

  it('annule un message en attente sans effets ni reprise tardive', async () => {
    const fixture = createFixture()
    const target = pokemon()
    fixture.runtime.start(target, reaction([{
      movementId: 0,
      emoteId: 0,
      messageId: 1,
      soundId: 0,
      delay: 0,
    }], { friendshipDelta: 20, moodDelta: 20 }))
    await flushMicrotasks()

    expect(fixture.runtime.cancel()).toBe(true)
    expect(fixture.runtime.cancel()).toBe(false)
    expect(fixture.runtime.consumeMessageConfirmation()).toBe(false)
    await flushMicrotasks()

    expect(fixture.runtime.isActive()).toBe(false)
    expect(target.friendship).toBe(100)
    expect(fixture.state.followerMood).toBe(4)
    expect(fixture.advance).not.toHaveBeenCalled()
    expect(fixture.reportStatus).not.toHaveBeenCalled()
    expect(fixture.hide).toHaveBeenCalledOnce()
    expect(fixture.clearWait).toHaveBeenLastCalledWith({
      invalidateAsync: true,
      clearAcceptedInputs: true,
    })
  })

  it('annule et neutralise un timer, y compris si son callback arrive tardivement', async () => {
    const fixture = createFixture()
    const target = pokemon()
    fixture.runtime.start(target, reaction([{
      movementId: 0,
      emoteId: 0,
      messageId: 0,
      soundId: 0,
      delay: 6,
    }], { friendshipDelta: 10 }))
    await flushMicrotasks()
    const timerHandle = [...fixture.timers.keys()][0]!

    expect(fixture.runtime.cancel()).toBe(true)
    fixture.runStaleTimer(timerHandle)
    await flushMicrotasks()

    expect(fixture.cancelTimer).toHaveBeenCalledWith(timerHandle)
    expect(target.friendship).toBe(100)
    expect(fixture.advance).not.toHaveBeenCalled()
    expect(fixture.reportStatus).not.toHaveBeenCalled()
  })

  it('restaure les buffers même quand le formatage échoue et ferme le script en erreur', async () => {
    const formatError = new Error('format invalide')
    const fixture = createFixture({
      formatMessage: () => { throw formatError },
    })
    fixture.runtime.start(pokemon(), reaction([{
      movementId: 0,
      emoteId: 0,
      messageId: 1,
      soundId: 0,
      delay: 0,
    }]))
    await flushMicrotasks()

    expect(fixture.state.buffers).toBe(fixture.originalBuffers)
    expect(fixture.runtime.isActive()).toBe(false)
    expect(fixture.reportStatus).toHaveBeenCalledWith('format invalide')
    expect(fixture.setRunner).toHaveBeenCalledWith(undefined)
    expect(fixture.clearWait).toHaveBeenLastCalledWith({
      invalidateAsync: true,
      clearAcceptedInputs: true,
      clearSoundEffect: true,
    })
    expect(fixture.hide).toHaveBeenCalledOnce()
    expect(fixture.advance).not.toHaveBeenCalled()
  })

  it('ignore une erreur asynchrone provenant d’un playback déjà remplacé', async () => {
    let rejectFirstMotion: ((error: Error) => void) | undefined
    const fixture = createFixture({
      playMotion: () => new Promise<void>((_resolve, reject) => { rejectFirstMotion = reject }),
    })
    fixture.runtime.start(pokemon(), reaction([{
      movementId: 1,
      emoteId: 0,
      messageId: 0,
      soundId: 0,
      delay: 0,
    }]))
    await flushMicrotasks()
    fixture.runtime.start(pokemon(), reaction([]))
    await flushMicrotasks()
    rejectFirstMotion?.(new Error('ancienne animation'))
    await flushMicrotasks()

    expect(fixture.reportStatus).not.toHaveBeenCalledWith('ancienne animation')
    expect(fixture.advance).toHaveBeenCalledOnce()
    expect(fixture.runtime.isActive()).toBe(false)
  })
})
