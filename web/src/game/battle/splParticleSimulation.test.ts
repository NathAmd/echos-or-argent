import { describe, expect, it } from 'vitest'
import type { HgssSplEmitterResource } from '../../rom/battle/splParticleResources'
import { HgssSplEmitterSimulation, HgssSplRandom } from './splParticleSimulation'

function pointEmitter(overrides: Partial<HgssSplEmitterResource> = {}): HgssSplEmitterResource {
  return {
    id: 0,
    flags: 1 << 14,
    emissionType: 0,
    drawType: 0,
    circleAxis: 0,
    basePosition: [0, 0, 0],
    emissionCount: 1,
    radius: 0,
    length: 0,
    axis: [0, 0, 0],
    color: 0x7fff,
    initialVelocityPositionAmplifier: 0,
    initialVelocityAxisAmplifier: 0,
    baseScale: 1,
    aspectRatio: 1,
    startDelayFrames: 0,
    minimumRotation: 0,
    maximumRotation: 0,
    initialAngle: 0,
    emitterLifetimeFrames: 1,
    particleLifetimeFrames: 1,
    randomAttenuation: { baseScale: 0, lifetime: 0, initialVelocity: 0 },
    emissionIntervalFrames: 1,
    baseAlpha: 31,
    airResistance: 208,
    textureIndex: 0,
    loopFrames: 1,
    doubleBillboardScale: 0,
    textureTileCountS: 0,
    textureTileCountT: 0,
    scaleAnimationDirection: 0,
    faceEmitter: false,
    flipTextureS: false,
    flipTextureT: false,
    polygonX: 0,
    polygonY: 0,
    userFlags: 0,
    behaviors: [],
    ...overrides,
  }
}

describe('HGSS SPL particle simulation', () => {
  it('uses the exact global SPL linear congruential random sequence', () => {
    const random = new HgssSplRandom(0)
    expect([random.next(), random.next(), random.next(), random.next()]).toEqual([
      0x1b0cb173,
      0x13c434e2,
      0xfa6515fd,
      0x6ec79a34,
    ])
  })

  it('emits, updates and self-terminates on the same frame boundaries as SPLManager', () => {
    const simulation = new HgssSplEmitterSimulation(pointEmitter(), new HgssSplRandom(0))
    const firstFrame = simulation.step()
    expect(firstFrame).toHaveLength(1)
    expect(firstFrame[0]).toMatchObject({ x: 0, y: 0, z: 0, alpha: 31, textureIndex: 0 })
    expect(simulation.complete).toBe(false)

    expect(simulation.step()).toEqual([])
    expect(simulation.complete).toBe(true)
  })

  it('replaces the resource base position for native absolute emitter moves', () => {
    const simulation = new HgssSplEmitterSimulation(pointEmitter({
      basePosition: [5, 6, 0],
      emitterLifetimeFrames: 1,
      particleLifetimeFrames: 2,
    }), new HgssSplRandom())
    simulation.setEmitterAbsolutePosition([2, 3, 0])
    simulation.step()

    expect(simulation.samples()[0]).toMatchObject({ x: 2 * 4096, y: 3 * 4096 })
  })

  it('applies the official 48/512 air-resistance offset and gravity behavior', () => {
    const simulation = new HgssSplEmitterSimulation(pointEmitter({
      axis: [1, 0, 0],
      initialVelocityAxisAmplifier: 1,
      airResistance: 208,
      behaviors: [{ kind: 'gravity', magnitude: [0, -0.25, 0] }],
    }), new HgssSplRandom(0))
    const [particle] = simulation.step()
    expect(particle).toBeDefined()
    expect(particle!.x).toBeGreaterThan(0)
    expect(particle!.y).toBe(-1024)
  })

  it('places a uniform circle on the configured SPL Z axis', () => {
    const simulation = new HgssSplEmitterSimulation(pointEmitter({
      emissionType: 3,
      circleAxis: 0,
      emissionCount: 4,
      radius: 1,
    }), new HgssSplRandom(0))
    const positions = simulation.step().map(({ x, y }) => [x, y]).sort((left, right) => left[0]! - right[0]! || left[1]! - right[1]!)
    expect(positions).toEqual([[-4096, 0], [0, -4096], [0, 4096], [4096, 0]])
  })

  it('moves the emitter origin for particles spawned by a tracking callback', () => {
    const simulation = new HgssSplEmitterSimulation(pointEmitter({
      emitterLifetimeFrames: 2,
      particleLifetimeFrames: 4,
    }), new HgssSplRandom(0))
    expect(simulation.step().map(({ x }) => x)).toEqual([0])
    simulation.setEmitterPosition([1, 0, 0])
    expect(simulation.step().map(({ x }) => x)).toContain(4096)
  })

  it('émet les dix géométries SPL officielles sans supprimer la ressource', () => {
    for (let emissionType = 0; emissionType <= 9; emissionType += 1) {
      const simulation = new HgssSplEmitterSimulation(pointEmitter({
        emissionType,
        emissionCount: 4,
        radius: 1,
        length: 2,
        axis: [0, 1, 0],
      }), new HgssSplRandom(0))
      expect(simulation.step(), `emission ${emissionType}`).toHaveLength(4)
    }
  })

  it('termine une ressource finie même si son callback DS possédait le handle', () => {
    const simulation = new HgssSplEmitterSimulation(pointEmitter({ flags: 0 }), new HgssSplRandom(0))
    simulation.step()
    simulation.step()
    expect(simulation.complete).toBe(true)
  })

  it('applique magnétisme, convergence et rotation SPL', () => {
    const magnet = new HgssSplEmitterSimulation(pointEmitter({
      particleLifetimeFrames: 8,
      behaviors: [{ kind: 'magnet', target: [2, 0, 0], force: 0.5 }],
    }), new HgssSplRandom(0))
    expect(magnet.step()[0]!.velocityX).toBeGreaterThan(0)

    const convergence = new HgssSplEmitterSimulation(pointEmitter({
      emissionType: 1,
      radius: 1,
      particleLifetimeFrames: 8,
      behaviors: [{ kind: 'convergence', target: [0, 0, 0], force: 0.5 }],
    }), new HgssSplRandom(0))
    const beforeConvergence = Math.hypot(...convergence.step().map(({ x, y, z }) => Math.hypot(x, y, z)))
    const afterConvergence = Math.hypot(...convergence.step().map(({ x, y, z }) => Math.hypot(x, y, z)))
    expect(afterConvergence).toBeLessThan(beforeConvergence)

    const spin = new HgssSplEmitterSimulation(pointEmitter({
      emissionType: 3,
      emissionCount: 1,
      radius: 1,
      particleLifetimeFrames: 8,
      behaviors: [{ kind: 'spin', angle: 0x4000, axis: 2 }],
    }), new HgssSplRandom(0))
    const [spun] = spin.step()
    expect(Math.abs(spun!.x)).toBeGreaterThan(4_000)
    expect(Math.abs(spun!.y)).toBeLessThan(8)
  })
})
