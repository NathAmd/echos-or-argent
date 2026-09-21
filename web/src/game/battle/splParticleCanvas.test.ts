import { describe, expect, it, vi } from 'vitest'
import type { HgssSplEmitterResource, HgssSplParticleResource } from '../../rom/battle/splParticleResources'
import { classifyHgssSplEmitterSupport, HgssSplParticleCanvasPlayback } from './splParticleCanvas'

function emitter(overrides: Partial<HgssSplEmitterResource> = {}): HgssSplEmitterResource {
  return {
    id: 0, flags: 0, emissionType: 0, drawType: 0, circleAxis: 0,
    basePosition: [0, 0, 0], emissionCount: 1, radius: 0, length: 0, axis: [0, 0, 0],
    color: 0x7fff, initialVelocityPositionAmplifier: 0, initialVelocityAxisAmplifier: 0,
    baseScale: 1, aspectRatio: 1, startDelayFrames: 0, minimumRotation: 0, maximumRotation: 0,
    initialAngle: 0, emitterLifetimeFrames: 1, particleLifetimeFrames: 1,
    randomAttenuation: { baseScale: 0, lifetime: 0, initialVelocity: 0 }, emissionIntervalFrames: 1,
    baseAlpha: 31, airResistance: 208, textureIndex: 0, loopFrames: 1, doubleBillboardScale: 0,
    textureTileCountS: 0, textureTileCountT: 0, scaleAnimationDirection: 0, faceEmitter: false,
    flipTextureS: false, flipTextureT: false, polygonX: 1, polygonY: 1, userFlags: 0, behaviors: [],
    ...overrides,
  }
}

describe('HGSS SPL Canvas support', () => {
  it('accepte les dix géométries, les polygones et les émetteurs pilotés par callback', () => {
    for (let emissionType = 0; emissionType <= 9; emissionType += 1) {
      expect(classifyHgssSplEmitterSupport(emitter({
        emissionType,
        drawType: emissionType % 4,
        flags: 0,
      }))).toEqual({ supported: true })
    }
  })

  it('rejette explicitement uniquement les ressources infinies ou inconnues', () => {
    expect(classifyHgssSplEmitterSupport(emitter({ emitterLifetimeFrames: 0 }))).toMatchObject({ supported: false })
    expect(classifyHgssSplEmitterSupport(emitter({ emissionType: 10 }))).toMatchObject({ supported: false })
    expect(classifyHgssSplEmitterSupport(emitter({ drawType: 4 }))).toMatchObject({ supported: false })
  })

  it('crée un émetteur par défenseur pour les impacts et trajectoires de zone', () => {
    const context = {
      imageSmoothingEnabled: true,
      clearRect: () => undefined,
    } as unknown as CanvasRenderingContext2D
    const rect = (left: number) => ({
      left, top: 20, width: 20, height: 20, right: left + 20, bottom: 40, x: left, y: 20,
      toJSON: () => ({}),
    })
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => context,
      getBoundingClientRect: () => rect(0),
    } as unknown as HTMLCanvasElement
    const battler = (left: number) => ({ getBoundingClientRect: () => rect(left) }) as HTMLElement
    const player = battler(20)
    const firstDefender = battler(150)
    const secondDefender = battler(200)
    const resource: HgssSplParticleResource = {
      memberId: 1,
      version: 'test',
      emitters: [emitter()],
      textures: [],
    }
    vi.stubGlobal('requestAnimationFrame', () => 1)
    vi.stubGlobal('cancelAnimationFrame', () => undefined)
    try {
      const playback = new HgssSplParticleCanvasPlayback(canvas, {
        player,
        opponent: [firstDefender, secondDefender, firstDefender],
      })
      expect(playback.battlerWorldPositions('opponent')).toHaveLength(2)

      void playback.createEmitter(resource, 0, 4, 'player')
      expect(Reflect.get(playback, 'active') as unknown[]).toHaveLength(2)
      playback.clear()

      void playback.createEmitter(resource, 0, 9, 'player')
      expect(Reflect.get(playback, 'active') as unknown[]).toHaveLength(2)
      playback.clear()

      void playback.createEmitter(resource, 0, 3, 'player')
      expect(Reflect.get(playback, 'active') as unknown[]).toHaveLength(1)
      playback.clear()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('adresse et déplace absolument un émetteur par système et identifiant', async () => {
    const context = {
      imageSmoothingEnabled: true,
      clearRect: () => undefined,
    } as unknown as CanvasRenderingContext2D
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => context,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 256, height: 192 }),
    } as unknown as HTMLCanvasElement
    const resource: HgssSplParticleResource = {
      memberId: 2,
      version: 'test',
      emitters: [emitter({ id: 0 }), emitter({ id: 1, basePosition: [5, 6, 0] })],
      textures: [],
    }
    vi.stubGlobal('requestAnimationFrame', () => 1)
    vi.stubGlobal('cancelAnimationFrame', () => undefined)
    try {
      const playback = new HgssSplParticleCanvasPlayback(canvas)
      void playback.createEmitter(resource, 1, 3, 'player', undefined, 2, 7)
      expect(playback.setEmitterAbsolutePosition(2, 1, [2, 3, 0])).toBe(false)
      expect(playback.setEmitterAbsolutePosition(1, 7, [2, 3, 0])).toBe(false)
      expect(playback.setEmitterAbsolutePosition(2, 7, [2, 3, 0])).toBe(true)
      const active = Reflect.get(playback, 'active') as Array<{
        simulation: { resource: { id: number }, step: () => void, samples: () => Array<{ x: number, y: number }> },
        trackingBattler?: unknown,
      }>
      expect(active[0]!.simulation.resource.id).toBe(1)
      expect(active[0]!.trackingBattler).toBeUndefined()
      active[0]!.simulation.step()
      expect(active[0]!.simulation.samples()[0]).toMatchObject({ x: 2 * 4096, y: 3 * 4096 })

      const completion = playback.waitForEmitterCompletion(2, 7)
      expect(completion).toBeDefined()
      playback.clear()
      await completion
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
