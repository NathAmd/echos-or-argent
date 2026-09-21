import { describe, expect, it, vi } from 'vitest'
import type { OpeningMapPreview, RomInventory } from '../../ndsTypes'
import type { DoorTransitionDescriptor } from '../../rom/maps/doorTransition'
import type { WorldSession } from '../world/worldSession'
import {
  createFieldScriptEffectsHost,
  type FieldScriptEffectsHostPorts,
  type FieldScriptEffectsSurface,
} from './fieldScriptEffectsHost'
import type { FieldScriptRunner, FieldScriptState, FieldScriptStep } from './fieldScriptRunner'

const runner = {} as FieldScriptRunner

function createMap(label = 'Route 29'): OpeningMapPreview {
  return {
    id: 1,
    label,
    header: {},
    fieldScripts: { bank: 0, bytes: new Uint8Array(), headerSize: 0, entryOffsets: [] },
    initScripts: [],
    messages: {},
    matrix: {
      matrixIndex: 0,
      name: 'test',
      width: 1,
      height: 1,
      hasHeaders: false,
      headers: new Uint16Array([1]),
      altitudes: new Uint8Array([0]),
      modelIds: new Uint16Array([0]),
    },
  } as unknown as OpeningMapPreview
}

function createSurface() {
  const animate = vi.fn((
    _keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
    _options?: number | KeyframeAnimationOptions,
  ) => {
    void _keyframes
    void _options
    return { finished: Promise.resolve() } as unknown as Animation
  })
  return {
    surface: { animate } as unknown as FieldScriptEffectsSurface,
    animate,
  }
}

function createFixture() {
  const activeMap = createMap()
  const state = {
    playerName: 'Luth',
    badges: new Set([1, 2]),
    money: 1234,
    buffers: new Map<number, string>([[0, 'Sous-sol 2']]),
    coins: 41,
    battlePoints: 9,
    athletePoints: 17,
    variables: new Map<number, number>(),
  } as FieldScriptState
  const door = { tag: 1, classId: 1 } as DoorTransitionDescriptor
  const worldState = { map: activeMap, groundHeight: 7 }
  const world = {
    getState: vi.fn(() => worldState),
    setObjectState: vi.fn(),
    resolveScriptDoor: vi.fn(() => door),
  } as unknown as WorldSession
  const inventory = {
    mapPropModelResolver: vi.fn(),
    mapPropAnimationResolver: vi.fn(),
    mapPropAnimationMetadataResolver: vi.fn(),
    gymOverlayModelResolver: vi.fn(),
    gymOverlayAnimationResolver: vi.fn(),
  } as unknown as RomInventory
  const audio = {
    playSoundEffect: vi.fn(async () => undefined),
    stopSoundEffect: vi.fn(),
  }
  const firstSurface = createSurface()
  const secondSurface = createSurface()
  const runtime = {
    syncAzaleaGymMechanism: vi.fn(),
    setAzaleaGymSwitchState: vi.fn(),
    playAzaleaGymSwitch: vi.fn(async () => undefined),
    playAzaleaGymRide: vi.fn(async (_ride, onTravelStart?: () => void) => { onTravelStart?.() }),
    setPlayerPosition: vi.fn(() => 'movement'),
    playApricornTreeAnimation: vi.fn(async () => undefined),
    playFieldMoveEffect: vi.fn(async () => 'completed' as const),
    clearFieldMoveEffect: vi.fn(),
    setMapPropDeferredAnimations: vi.fn(),
    loadMapPropOneShotAnimation: vi.fn(),
    playMapPropOneShotAnimation: vi.fn(),
    waitMapPropOneShotAnimation: vi.fn(async () => undefined),
    unloadMapPropOneShotAnimation: vi.fn(),
    playDoorAnimation: vi.fn(async () => undefined),
  } as unknown as FieldScriptEffectsHostPorts['runtime']
  const waitForPresentation = vi.fn<FieldScriptEffectsHostPorts['presentation']['waitForPresentation']>()
  const applyScreenFade = vi.fn()
  const reportStatus = vi.fn()
  const refreshMainMenu = vi.fn()
  const syncFollowerPresentation = vi.fn()
  const scheduleAutosave = vi.fn()
  const handleGymStep = vi.fn(() => false)
  const readState = vi.fn(() => state)
  const readWorld = vi.fn((): WorldSession | undefined => world)
  const readInventory = vi.fn((): RomInventory | undefined => inventory)
  const readAudio = vi.fn(() => audio)
  const ports = {
    runtime,
    context: { readState, readWorld, readInventory, readAudio },
    presentation: {
      surfaces: [firstSurface.surface, secondSurface.surface],
      framesToMilliseconds: (frames: number) => frames * 10,
      applyScreenFade,
      waitForPresentation,
    },
    gym: { handleStep: handleGymStep },
    field: { reportStatus, refreshMainMenu, syncFollowerPresentation, scheduleAutosave },
  } satisfies FieldScriptEffectsHostPorts

  return {
    host: createFieldScriptEffectsHost(ports),
    state,
    world,
    inventory,
    audio,
    runtime,
    firstSurface,
    secondSurface,
    waitForPresentation,
    applyScreenFade,
    reportStatus,
    refreshMainMenu,
    syncFollowerPresentation,
    scheduleAutosave,
    handleGymStep,
    readInventory,
  }
}

function handle(fixture: ReturnType<typeof createFixture>, step: FieldScriptStep) {
  return fixture.host.handle(step, runner)
}

describe('fieldScriptEffectsHost', () => {
  it('laisse les étapes hors domaine au host suivant', () => {
    const fixture = createFixture()

    expect(handle(fixture, { kind: 'message', messageId: 1, text: 'Bonjour' })).toBe('unhandled')
    expect(fixture.applyScreenFade).not.toHaveBeenCalled()
  })

  it('applique immédiatement les fades, overlays et effets sans attente', () => {
    const fixture = createFixture()

    expect(handle(fixture, { kind: 'screenFade', durationFrames: 8, type: 2, color: 0x7fff })).toBe('continue')
    expect(fixture.applyScreenFade).toHaveBeenCalledWith(8, 2, 0x7fff)

    expect(handle(fixture, { kind: 'fieldOverlay', overlay: 'saveStats', action: 'show' })).toBe('continue')
    expect(handle(fixture, { kind: 'fieldOverlay', overlay: 'floor', action: 'update', type: 3 })).toBe('continue')
    expect(handle(fixture, { kind: 'fieldOverlay', overlay: 'points', action: 'show', type: 1 })).toBe('continue')
    expect(handle(fixture, { kind: 'fieldOverlay', overlay: 'points', action: 'hide' })).toBe('continue')
    expect(fixture.reportStatus.mock.calls.map(([message]) => message)).toEqual([
      'Luth · 2 badges · ₽1234',
      'Sous-sol 2',
      'Points de Combat · 9',
      'Route 29',
    ])

    expect(handle(fixture, { kind: 'objectEffect', action: 'configure', objectIds: [], parameters: [151] })).toBe('continue')
    expect(fixture.refreshMainMenu).toHaveBeenCalledOnce()
    expect(fixture.syncFollowerPresentation).toHaveBeenCalledWith(false, true)
    expect(handle(fixture, { kind: 'mapEventState', event: 'warp', eventId: 4, x: 2, z: 6 })).toBe('continue')
  })

  it('borne le tremblement, anime toutes les surfaces et suspend le script', () => {
    const fixture = createFixture()

    expect(handle(fixture, { kind: 'screenShake', x: 80, y: -90, repeats: 0, durationFrames: 0 })).toBe('suspend')
    expect(fixture.firstSurface.animate).toHaveBeenCalledWith([
      { transform: 'translate(0, 0)' },
      { transform: 'translate(32px, -32px)' },
      { transform: 'translate(-32px, 32px)' },
      { transform: 'translate(0, 0)' },
    ], { duration: 10, iterations: 1, easing: 'linear' })
    expect(fixture.secondSurface.animate).toHaveBeenCalledOnce()
    expect(fixture.waitForPresentation).toHaveBeenCalledWith(
      'screenShake',
      expect.any(Promise),
      "L'animation de tremblement ROM a été interrompue.",
    )
  })

  it.each([
    ['celebiTimeTravel', 1500],
    ['hallOfFame', 2200],
    ['sinjohStage', 720],
    ['sinjohCircle', 1900],
    ['sinjohEgg', 2400],
    ['sinjohRestore', 360],
    ['linkReturn', 460],
  ] as const)('préserve la durée de la cinématique %s', (effect, duration) => {
    const fixture = createFixture()

    expect(handle(fixture, { kind: 'specialCutscene', effect, parameter: 2 })).toBe('suspend')
    expect(fixture.firstSurface.animate.mock.calls[0]?.[1]).toEqual({ duration, easing: 'steps(12, end)' })
    expect(fixture.waitForPresentation).toHaveBeenCalledWith(
      'specialCutscene',
      expect.any(Promise),
      'La mise en scène ROM a été interrompue.',
    )
  })

  it('pilote le cycle attach/load/play/wait/unload des animations MapProp', () => {
    const fixture = createFixture()
    const bindings = [{ modelId: 3, animationIndex: 1 }]

    expect(handle(fixture, { kind: 'mapPropAnimation', action: 'attach', bindings })).toBe('continue')
    expect(fixture.runtime.setMapPropDeferredAnimations).toHaveBeenCalledWith(bindings)
    expect(handle(fixture, { kind: 'mapPropAnimation', action: 'load', tag: 90, modelIds: [33, 138], animationCount: 2, loopCount: 1, reversed: false })).toBe('continue')
    expect(fixture.runtime.loadMapPropOneShotAnimation).toHaveBeenCalledWith(
      90,
      [33, 138],
      2,
      1,
      false,
      fixture.inventory.mapPropAnimationResolver,
      fixture.inventory.mapPropAnimationMetadataResolver,
    )
    expect(handle(fixture, { kind: 'mapPropAnimation', action: 'play', tag: 90, animationIndex: 1 })).toBe('continue')
    expect(handle(fixture, { kind: 'mapPropAnimation', action: 'wait', tag: 90 })).toBe('suspend')
    expect(fixture.waitForPresentation).toHaveBeenLastCalledWith(
      'mapPropAnimation',
      expect.any(Promise),
      "L'animation MapProp ROM 90 ne peut pas etre terminee.",
    )
    expect(handle(fixture, { kind: 'mapPropAnimation', action: 'unload', tag: 90 })).toBe('continue')
    expect(fixture.runtime.playMapPropOneShotAnimation).toHaveBeenCalledWith(90, 1)
    expect(fixture.runtime.unloadMapPropOneShotAnimation).toHaveBeenCalledWith(90)
  })

  it('refuse un chargement MapProp privé de ses résolveurs ROM', () => {
    const fixture = createFixture()
    fixture.readInventory.mockReturnValue(undefined)

    expect(() => handle(fixture, {
      kind: 'mapPropAnimation',
      action: 'load',
      tag: 2,
      modelIds: [1],
      animationCount: 1,
      loopCount: 1,
      reversed: false,
    })).toThrow('Les ressources MapProp ROM du tag 2 sont absentes.')
  })

  it('attend le Noigrume et programme son autosave uniquement après la reprise', () => {
    const fixture = createFixture()

    expect(handle(fixture, { kind: 'apricornTree', objectId: 10, treeIndex: 30, apricornType: 5 })).toBe('suspend')
    expect(fixture.runtime.playApricornTreeAnimation).toHaveBeenCalledWith(10, 5)
    const options = fixture.waitForPresentation.mock.calls[0]?.[3]
    expect(fixture.scheduleAutosave).not.toHaveBeenCalled()
    options?.afterResume?.()
    expect(fixture.scheduleAutosave).toHaveBeenCalledWith(0)
  })

  it('lance ScrCmd_560 avant son SE, continue et publie la fin native en arrière-plan', async () => {
    const fixture = createFixture()
    const order: string[] = []
    let finish: ((result: 'completed' | 'cancelled') => void) | undefined
    fixture.runtime.playFieldMoveEffect = vi.fn(() => {
      order.push('runtime')
      return new Promise<'completed' | 'cancelled'>((resolve) => { finish = resolve })
    })
    fixture.audio.playSoundEffect.mockImplementation(async () => { order.push('sound') })
    fixture.state.variables.set(0x4000, 0)

    expect(handle(fixture, { kind: 'fieldMoveEffect', mode: 4, completionVariable: 0x4000 })).toBe('continue')
    expect(order).toEqual(['runtime', 'sound'])
    expect(fixture.runtime.playFieldMoveEffect).toHaveBeenCalledWith(
      4,
      fixture.inventory.gymOverlayModelResolver,
      fixture.inventory.gymOverlayAnimationResolver,
    )
    expect(fixture.audio.playSoundEffect).toHaveBeenCalledWith(2302)
    expect(fixture.state.variables.get(0x4000)).toBe(0)

    finish?.('completed')
    await Promise.resolve()
    expect(fixture.state.variables.get(0x4000)).toBe(1)
  })

  it('invalide la complétion ScrCmd_560 lors du reset et refuse les ressources absentes', async () => {
    const fixture = createFixture()
    let finish: ((result: 'completed' | 'cancelled') => void) | undefined
    fixture.runtime.playFieldMoveEffect = vi.fn(() => new Promise<'completed' | 'cancelled'>((resolve) => { finish = resolve }))
    fixture.state.variables.set(0x4000, 0)
    expect(handle(fixture, { kind: 'fieldMoveEffect', mode: 0, completionVariable: 0x4000 })).toBe('continue')

    fixture.host.reset()
    finish?.('completed')
    await Promise.resolve()
    expect(fixture.runtime.clearFieldMoveEffect).toHaveBeenCalledOnce()
    expect(fixture.state.variables.get(0x4000)).toBe(0)

    fixture.readInventory.mockReturnValue(undefined)
    expect(() => handle(fixture, { kind: 'fieldMoveEffect', mode: 1, completionVariable: 0x4001 }))
      .toThrow("Les ressources Nitro de l'effet terrain 1 sont absentes.")
  })

  it('délègue d’abord les arènes reconnues puis gère le mécanisme d’Écorcia', () => {
    const delegated = createFixture()
    delegated.handleGymStep.mockReturnValue(true)
    const init: FieldScriptStep = { kind: 'gymMechanism', gymType: 5, action: 'init', spiderNodes: [0, 1], switchState: 2 }

    expect(handle(delegated, init)).toBe('continue')
    expect(delegated.runtime.syncAzaleaGymMechanism).not.toHaveBeenCalled()

    const fixture = createFixture()
    expect(handle(fixture, init)).toBe('continue')
    expect(fixture.runtime.syncAzaleaGymMechanism).toHaveBeenCalledWith(
      [0, 1],
      2,
      fixture.inventory.mapPropModelResolver,
      fixture.inventory.mapPropAnimationResolver,
      fixture.inventory.mapPropAnimationMetadataResolver,
    )

    expect(handle(fixture, { kind: 'gymMechanism', gymType: 5, action: 'flipSwitch', parameter: 1, switchState: 3 })).toBe('suspend')
    expect(fixture.audio.playSoundEffect).toHaveBeenCalledWith(1561)
    expect(fixture.waitForPresentation).toHaveBeenLastCalledWith(
      'gymMechanism',
      expect.any(Promise),
      "L'animation ROM de l'aiguillage a été interrompue.",
      expect.objectContaining({ afterResume: expect.any(Function) }),
    )
    fixture.waitForPresentation.mock.calls.at(-1)?.[3]?.afterResume?.()
    expect(fixture.scheduleAutosave).toHaveBeenCalledWith(0)
  })

  it('suspend le trajet Spinarak, déplace joueur et follower puis arrête son son', () => {
    const fixture = createFixture()
    const ride = {
      sourceNode: 0,
      destinationNode: 1,
      spiderIndex: 0,
      switchState: 0,
      direction: 'north',
      route: [{ x: 1, z: 1 }],
      destination: { x: 4, z: 7, direction: 'west' },
      followerDestination: { x: 3, z: 7, direction: 'east' },
    } as const

    expect(handle(fixture, {
      kind: 'gymMechanism',
      gymType: 5,
      action: 'rideSpinarak',
      ride,
      destination: { x: 4, z: 7, direction: 'west' },
      followerDestination: { x: 3, z: 7, direction: 'east' },
    })).toBe('suspend')
    expect(fixture.world.setObjectState).toHaveBeenNthCalledWith(1, 255, 4, 7, 'west')
    expect(fixture.world.setObjectState).toHaveBeenNthCalledWith(2, 253, 3, 7, 'east')
    expect(fixture.audio.playSoundEffect).toHaveBeenCalledWith(2171)
    fixture.waitForPresentation.mock.calls[0]?.[3]?.afterResume?.()
    expect(fixture.audio.stopSoundEffect).toHaveBeenCalledWith(2171)
    expect(fixture.scheduleAutosave).toHaveBeenCalledWith(0)
  })

  it('conserve le cycle setup/play/wait/unload et le son natif des portes', async () => {
    const fixture = createFixture()

    expect(handle(fixture, { kind: 'doorAnimation', action: 'setup', tag: 77, worldX: 69, worldZ: 103 })).toBe('continue')
    expect(fixture.world.resolveScriptDoor).toHaveBeenCalledWith(69, 103)
    expect(handle(fixture, { kind: 'doorAnimation', action: 'play', tag: 77, animationIndex: 0 })).toBe('continue')
    expect(fixture.audio.playSoundEffect).toHaveBeenCalledWith(1540)
    expect(fixture.runtime.playDoorAnimation).toHaveBeenCalledWith(
      expect.objectContaining({ classId: 1 }),
      0,
      fixture.inventory.mapPropAnimationResolver,
    )
    expect(handle(fixture, { kind: 'doorAnimation', action: 'wait', tag: 77 })).toBe('suspend')
    await expect(fixture.waitForPresentation.mock.calls[0]?.[1]).resolves.toBeUndefined()
    expect(handle(fixture, { kind: 'doorAnimation', action: 'unload', tag: 77 })).toBe('continue')
    expect(() => handle(fixture, { kind: 'doorAnimation', action: 'wait', tag: 77 })).toThrow("Le tag de porte ROM 77 n'a aucune animation active.")
  })

  it('propage au wait l’échec différé d’une animation de porte et réinitialise le registre', async () => {
    const fixture = createFixture()
    const failure = new Error('porte bloquée')
    fixture.runtime.playDoorAnimation = vi.fn(async () => { throw failure })

    handle(fixture, { kind: 'doorAnimation', action: 'setup', tag: 2, worldX: 1, worldZ: 2 })
    handle(fixture, { kind: 'doorAnimation', action: 'play', tag: 2, animationIndex: 1 })
    expect(handle(fixture, { kind: 'doorAnimation', action: 'wait', tag: 2 })).toBe('suspend')
    await expect(fixture.waitForPresentation.mock.calls[0]?.[1]).rejects.toBe(failure)

    fixture.host.reset()
    expect(() => handle(fixture, { kind: 'doorAnimation', action: 'unload', tag: 2 })).toThrow("Le tag de porte ROM 2 n'est pas charge.")
  })
})
