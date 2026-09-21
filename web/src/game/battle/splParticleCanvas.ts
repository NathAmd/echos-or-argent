import type { HgssSplEmitterResource, HgssSplParticleResource, HgssSplTexture } from '../../rom/battle/splParticleResources'
import type { SimpleBattleSide } from './simpleBattleSession'
import { resolveHgssBattlerWorldPosition, type HgssBattleParticleWorldPosition } from './battleParticlePlacement'
import { HgssSplEmitterSimulation, HgssSplRandom, type HgssSplParticleSample } from './splParticleSimulation'
import { hgssVBlankDurationMs, sampleBoundedFixedSteps } from '../time/hgssFrameTiming'

const dsWidth = 256
const dsHeight = 192
const viewportCenterX = 128
const viewportCenterY = 96
const particlePixelFactor = 172
const maximumSimulationStepsPerPaint = 2
type ActiveEmitter = {
  simulation: HgssSplEmitterSimulation
  resource: HgssSplParticleResource
  particleSystemIndex: number
  emitterId: number
  trackingBattler?: { side: SimpleBattleSide, element?: HTMLElement }
  completionResolvers: Array<() => void>
}

export type HgssSplParticleBattlers = Record<SimpleBattleSide, HTMLElement | readonly HTMLElement[]>

export type HgssSplParticleCanvasDiagnostic = {
  kind: 'unsupported-emitter' | 'approximate-callback'
  memberId: number
  emitterId: number
  callbackId: number
  reason: string
}

export type HgssSplEmitterSupport = { supported: true } | { supported: false, reason: string }

/** Contrat de rendu fini du lecteur Canvas, séparé du chargement de ressource. */
export function classifyHgssSplEmitterSupport(emitter: HgssSplEmitterResource): HgssSplEmitterSupport {
  if (!Number.isInteger(emitter.emissionType) || emitter.emissionType < 0 || emitter.emissionType > 9) {
    return { supported: false, reason: `type d'émission SPL ${emitter.emissionType} inconnu` }
  }
  if (!Number.isInteger(emitter.drawType) || emitter.drawType < 0 || emitter.drawType > 3) {
    return { supported: false, reason: `type de dessin SPL ${emitter.drawType} inconnu` }
  }
  if (emitter.emitterLifetimeFrames === 0) {
    return { supported: false, reason: 'émetteur externe sans durée finie' }
  }
  return { supported: true }
}

function rgb555Channel(value: number, shift: number): number {
  return value >> shift & 0x1f
}

export class HgssSplParticleCanvasPlayback {
  private readonly canvas: HTMLCanvasElement
  private readonly battlers?: HgssSplParticleBattlers
  private readonly onDiagnostic?: (diagnostic: HgssSplParticleCanvasDiagnostic) => void
  private readonly context: CanvasRenderingContext2D
  private readonly random = new HgssSplRandom()
  private readonly active: ActiveEmitter[] = []
  private readonly tintedTextures = new Map<string, HTMLCanvasElement>()
  private animationFrame?: number
  private previousFrameTime = 0
  private accumulatedTime = 0

  constructor(
    canvas: HTMLCanvasElement,
    battlers?: HgssSplParticleBattlers,
    onDiagnostic?: (diagnostic: HgssSplParticleCanvasDiagnostic) => void,
  ) {
    this.canvas = canvas
    this.battlers = battlers
    this.onDiagnostic = onDiagnostic
    canvas.width = dsWidth
    canvas.height = dsHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error("Le canevas d'effets de combat n'est pas disponible.")
    context.imageSmoothingEnabled = false
    this.context = context
  }

  battlerWorldPosition(side: SimpleBattleSide): HgssBattleParticleWorldPosition {
    return this.battlerWorldPositions(side)[0]!
  }

  /** Toutes les positions d'un camp, dans l'ordre stable fourni par la scène. */
  battlerWorldPositions(side: SimpleBattleSide): readonly HgssBattleParticleWorldPosition[] {
    const battlers = this.battlers?.[side]
    const elements = Array.isArray(battlers) ? [...new Set(battlers)] : battlers ? [battlers] : [undefined]
    return elements.map((element) => resolveHgssBattlerWorldPosition(this.canvas, element, side))
  }

  createEmitter(
    particleResource: HgssSplParticleResource,
    resourceEmitterId: number,
    callbackId: number,
    attackerSide: SimpleBattleSide,
    explicitWorldPosition?: HgssBattleParticleWorldPosition,
    particleSystemIndex = 0,
    nativeEmitterId = resourceEmitterId,
  ): Promise<void> | undefined {
    const emitter = particleResource.emitters[resourceEmitterId]
    if (!emitter) {
      this.onDiagnostic?.({ kind: 'unsupported-emitter', memberId: particleResource.memberId, emitterId: resourceEmitterId, callbackId, reason: 'index absent de la ressource SPL' })
      return undefined
    }
    const support = classifyHgssSplEmitterSupport(emitter)
    if (!support.supported) {
      this.onDiagnostic?.({ kind: 'unsupported-emitter', memberId: particleResource.memberId, emitterId: resourceEmitterId, callbackId, reason: support.reason })
      return undefined
    }
    if (callbackId < 0 || callbackId > 22) {
      this.onDiagnostic?.({ kind: 'unsupported-emitter', memberId: particleResource.memberId, emitterId: resourceEmitterId, callbackId, reason: 'callback SPL hors table native 0..22' })
      return undefined
    }
    // Table native : 3/19/21 attaquant, 4/20 défenseur, 1 ennemi fixe,
    // 2 joueur fixe, 5..16 axe/comportement et 17 callback générique.
    const defenderSide = attackerSide === 'player' ? 'opponent' : 'player'
    const targetSide = callbackId === 2
      ? 'player'
      : callbackId === 1
        ? 'opponent'
        : callbackId === 3 || callbackId === 19 || callbackId === 21 || callbackId === 17
      ? attackerSide
      : callbackId === 4 || callbackId === 20
        ? defenderSide
        : callbackId === 6
          ? defenderSide
          : callbackId >= 5 && callbackId <= 16
            ? attackerSide
        : undefined
    const centered = callbackId === 0 || callbackId === 18 || callbackId === 22
    const attackerPosition = this.battlerWorldPosition(attackerSide)
    const attackerBattlers = this.battlers?.[attackerSide]
    const attackerElement = Array.isArray(attackerBattlers) ? attackerBattlers[0] : attackerBattlers
    const defenderPositions = this.battlerWorldPositions(defenderSide)
    const targetBattlers = this.battlers?.[targetSide ?? attackerSide]
    const targetElements = Array.isArray(targetBattlers) ? [...new Set(targetBattlers)] : targetBattlers ? [targetBattlers] : [undefined]
    const followsEachDefender = !explicitWorldPosition
      && (callbackId === 4 || callbackId === 20 || (callbackId >= 5 && callbackId <= 16))
    const placements = followsEachDefender
      ? defenderPositions.map((defenderPosition, index) => ({
          defenderPosition,
          worldPosition: callbackId === 6 ? defenderPosition : callbackId >= 5 && callbackId <= 16 ? attackerPosition : defenderPosition,
          trackingElement: callbackId === 6 || callbackId === 4 || callbackId === 20
            ? targetElements[index]
            : attackerElement,
        }))
      : [{
          defenderPosition: defenderPositions[0]!,
          worldPosition: explicitWorldPosition
            ?? (targetSide ? this.battlerWorldPosition(targetSide) : centered ? [0, 0, 0] as const : undefined),
          trackingElement: targetSide && !explicitWorldPosition ? targetElements[0] : undefined,
        }]
    if (placements.some(({ worldPosition }) => !worldPosition)) {
      this.onDiagnostic?.({ kind: 'unsupported-emitter', memberId: particleResource.memberId, emitterId: resourceEmitterId, callbackId, reason: 'placement du callback SPL non résolu' })
      return undefined
    }
    if (callbackId === 17 && !explicitWorldPosition) {
      this.onDiagnostic?.({
        kind: 'approximate-callback',
        memberId: particleResource.memberId,
        emitterId: resourceEmitterId,
        callbackId,
        reason: 'paramètres génériques absents : ancrage attaquant conservateur',
      })
    }
    const completions = placements.map(({ defenderPosition, worldPosition, trackingElement }) => {
      const resolvedWorldPosition = worldPosition!
      const simulation = new HgssSplEmitterSimulation(emitter, this.random, resolvedWorldPosition)
      if (callbackId >= 5 && callbackId <= 16) {
        const start = callbackId === 6 ? defenderPosition : attackerPosition
        const end = callbackId === 6 ? attackerPosition : defenderPosition
        const delta = [end[0] - start[0], end[1] - start[1], end[2] - start[2]] as const
        const magnitude = Math.hypot(...delta) || 1
        simulation.setEmitterAxis([delta[0] / magnitude, delta[1] / magnitude, delta[2] / magnitude])
        const target = callbackId === 8 || callbackId === 13
          ? [0, 0, 0] as const
          : callbackId === 9 || callbackId === 14
            ? defenderPosition
            : callbackId === 10 || callbackId === 15
              ? attackerPosition
              : undefined
        if (target) {
          const relativeTarget = [target[0] - resolvedWorldPosition[0], target[1] - resolvedWorldPosition[1], target[2] - resolvedWorldPosition[2]] as const
          simulation.setBehaviorTarget(callbackId <= 11 ? 'convergence' : 'magnet', relativeTarget)
        }
      }
      const trackingBattler = targetSide && !explicitWorldPosition
        ? { side: targetSide, element: trackingElement }
        : undefined
      return new Promise<void>((resolve) => this.active.unshift({
        simulation,
        resource: particleResource,
        particleSystemIndex,
        emitterId: nativeEmitterId,
        trackingBattler,
        completionResolvers: [resolve],
      }))
    })
    this.start()
    return Promise.all(completions).then(() => undefined)
  }

  setEmitterAbsolutePosition(
    particleSystemIndex: number,
    emitterId: number,
    position: readonly [number, number] | HgssBattleParticleWorldPosition,
  ): boolean {
    const emitters = this.active.filter((emitter) => (
      emitter.particleSystemIndex === particleSystemIndex && emitter.emitterId === emitterId
    ))
    for (const emitter of emitters) {
      emitter.trackingBattler = undefined
      emitter.simulation.setEmitterAbsolutePosition(position)
    }
    return emitters.length > 0
  }

  waitForEmitterCompletion(particleSystemIndex: number, emitterId: number): Promise<void> | undefined {
    const emitters = this.active.filter((emitter) => (
      emitter.particleSystemIndex === particleSystemIndex && emitter.emitterId === emitterId
    ))
    if (emitters.length === 0) return undefined
    return Promise.all(emitters.map((emitter) => new Promise<void>((resolve) => {
      emitter.completionResolvers.push(resolve)
    }))).then(() => undefined)
  }

  clear(): void {
    if (this.animationFrame !== undefined) cancelAnimationFrame(this.animationFrame)
    this.animationFrame = undefined
    for (const emitter of this.active.splice(0)) {
      for (const resolve of emitter.completionResolvers) resolve()
    }
    this.context.clearRect(0, 0, dsWidth, dsHeight)
  }

  private start(): void {
    if (this.animationFrame !== undefined) return
    this.previousFrameTime = performance.now()
    this.accumulatedTime = 0
    this.animationFrame = requestAnimationFrame(this.tick)
  }

  private readonly tick = (now: number): void => {
    const fixedStep = sampleBoundedFixedSteps(
      this.accumulatedTime,
      Math.min(100, now - this.previousFrameTime),
      hgssVBlankDurationMs,
      maximumSimulationStepsPerPaint,
    )
    this.accumulatedTime = fixedStep.remainderMs
    this.previousFrameTime = now
    for (let step = 0; step < fixedStep.steps; step += 1) {
      for (const emitter of this.active) {
        if (emitter.trackingBattler) {
          const { side, element } = emitter.trackingBattler
          emitter.simulation.setEmitterPosition(resolveHgssBattlerWorldPosition(this.canvas, element, side))
        }
        emitter.simulation.step()
      }
      for (let index = this.active.length - 1; index >= 0; index -= 1) {
        if (!this.active[index]!.simulation.complete) continue
        const emitter = this.active.splice(index, 1)[0]!
        for (const resolve of emitter.completionResolvers) resolve()
      }
    }
    this.render()
    if (this.active.length === 0) {
      this.animationFrame = undefined
      this.context.clearRect(0, 0, dsWidth, dsHeight)
      return
    }
    this.animationFrame = requestAnimationFrame(this.tick)
  }

  private render(): void {
    this.context.clearRect(0, 0, dsWidth, dsHeight)
    for (let emitterIndex = this.active.length - 1; emitterIndex >= 0; emitterIndex -= 1) {
      const emitter = this.active[emitterIndex]!
      const samples = emitter.simulation.samples()
      const visible = (emitter.simulation.resource.flags & 1 << 22) === 0
        ? samples
        : samples.filter((sample) => sample.child)
      const childFirst = (emitter.simulation.resource.flags & 1 << 21) !== 0
      const ordered = childFirst ? [...visible].sort((left, right) => Number(right.child) - Number(left.child)) : visible
      for (const sample of ordered) this.drawParticle(emitter.resource, emitter.simulation.resource, sample)
    }
  }

  private drawParticle(resource: HgssSplParticleResource, emitter: HgssSplEmitterResource, particle: HgssSplParticleSample): void {
    if (particle.alpha <= 0) return
    const texture = resource.textures[particle.textureIndex]
    if (!texture) return
    const source = this.getTintedTexture(texture, particle.color)
    const x = viewportCenterX + particle.x / particlePixelFactor
    const y = viewportCenterY - particle.y / particlePixelFactor
    const width = Math.max(0.5, Math.abs(2 * particle.scaleX / particlePixelFactor))
    let height = Math.max(0.5, Math.abs(2 * particle.scaleY / particlePixelFactor))
    let renderedWidth = width
    let rotation = particle.rotation * Math.PI * 2 / 0x10000
    if (particle.drawType === 1 || particle.drawType === 3) {
      const velocityLength = Math.hypot(particle.velocityX, particle.velocityY, particle.velocityZ)
      if (velocityLength === 0) return
      const depthRatio = Math.abs(particle.velocityZ) / velocityLength
      height *= 1 + (1 - depthRatio) * emitter.doubleBillboardScale / 4096
      rotation = Math.atan2(particle.velocityX, particle.velocityY)
    }
    if (particle.drawType === 2 || particle.drawType === 3) {
      renderedWidth *= Math.max(1 / 16, Math.abs(emitter.polygonX))
      height *= Math.max(1 / 16, Math.abs(emitter.polygonY))
    }
    this.context.save()
    this.context.globalAlpha = particle.alpha / 31
    this.context.translate(Math.round(x), Math.round(y))
    this.context.rotate(rotation)
    this.context.scale(this.resourceFlip(texture, 'x'), this.resourceFlip(texture, 'y'))
    this.context.drawImage(source, -renderedWidth / 2, -height / 2, renderedWidth, height)
    this.context.restore()
  }

  private resourceFlip(texture: HgssSplTexture, axis: 'x' | 'y'): number {
    return axis === 'x' ? (texture.flipS ? -1 : 1) : (texture.flipT ? -1 : 1)
  }

  private getTintedTexture(texture: HgssSplTexture, color: number): HTMLCanvasElement {
    const key = `${texture.id}:${color}`
    const cached = this.tintedTextures.get(key)
    if (cached) return cached
    const canvas = document.createElement('canvas')
    canvas.width = texture.width
    canvas.height = texture.height
    const context = canvas.getContext('2d')!
    const pixels = new Uint8ClampedArray(texture.graphic.pixels)
    // SPL module les canaux RGB555 par la couleur blanche 31 puis décale de
    // cinq bits : le diviseur matériel est donc 32, pas 31.
    const red = rgb555Channel(color, 0) / 32
    const green = rgb555Channel(color, 5) / 32
    const blue = rgb555Channel(color, 10) / 32
    for (let offset = 0; offset < pixels.length; offset += 4) {
      pixels[offset] = Math.round(pixels[offset]! * red)
      pixels[offset + 1] = Math.round(pixels[offset + 1]! * green)
      pixels[offset + 2] = Math.round(pixels[offset + 2]! * blue)
    }
    context.putImageData(new ImageData(pixels, texture.width, texture.height), 0, 0)
    this.tintedTextures.set(key, canvas)
    return canvas
  }
}
