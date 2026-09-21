import type { HgssSplEmitterResource } from '../../rom/battle/splParticleResources'

const fxOne = 4096
const maximumParticles = 256

type Vector = { x: number, y: number, z: number }

type Particle = {
  position: Vector
  velocity: Vector
  emitterPosition: Vector
  baseScale: number
  animatedScale: number
  color: number
  baseAlpha: number
  animatedAlpha: number
  rotation: number
  angularVelocity: number
  lifetime: number
  age: number
  textureIndex: number
  loopTimeFactor: number
  lifetimeFactor: number
  lifetimeOffset: number
  child: boolean
}

export type HgssSplParticleSample = {
  x: number
  y: number
  z: number
  velocityX: number
  velocityY: number
  velocityZ: number
  scaleX: number
  scaleY: number
  color: number
  alpha: number
  rotation: number
  textureIndex: number
  drawType: number
  child: boolean
}

function rawFx(value: number): number {
  return Math.round(value * fxOne)
}

function fxMultiply(left: number, right: number): number {
  return Math.floor(left * right / fxOne)
}

function divide(left: number, right: number): number {
  return right === 0 ? 0 : Math.trunc(left / right)
}

function normalize(vector: Vector): Vector {
  const length = Math.hypot(vector.x, vector.y, vector.z)
  if (length === 0) return { x: 0, y: 0, z: 0 }
  return {
    x: Math.round(vector.x * fxOne / length),
    y: Math.round(vector.y * fxOne / length),
    z: Math.round(vector.z * fxOne / length),
  }
}

function cross(left: Vector, right: Vector): Vector {
  return {
    x: fxMultiply(left.y, right.z) - fxMultiply(left.z, right.y),
    y: fxMultiply(left.z, right.x) - fxMultiply(left.x, right.z),
    z: fxMultiply(left.x, right.y) - fxMultiply(left.y, right.x),
  }
}

function dot(left: Vector, right: Vector): number {
  return fxMultiply(left.x, right.x) + fxMultiply(left.y, right.y) + fxMultiply(left.z, right.z)
}

function rotate(vector: Vector, axis: number, angleIndex: number): Vector {
  const radians = (angleIndex & 0xffff) * Math.PI * 2 / 0x10000
  const sine = Math.sin(radians)
  const cosine = Math.cos(radians)
  if (axis === 0) return {
    x: vector.x,
    y: Math.round(vector.y * cosine - vector.z * sine),
    z: Math.round(vector.y * sine + vector.z * cosine),
  }
  if (axis === 1) return {
    x: Math.round(vector.x * cosine + vector.z * sine),
    y: vector.y,
    z: Math.round(-vector.x * sine + vector.z * cosine),
  }
  return {
    x: Math.round(vector.x * cosine - vector.y * sine),
    y: Math.round(vector.x * sine + vector.y * cosine),
    z: vector.z,
  }
}

export class HgssSplRandom {
  state: number

  constructor(seed = 0) {
    this.state = seed >>> 0
  }

  next(): number {
    this.state = (Math.imul(this.state, 0x5eedf715) + 0x1b0cb173) >>> 0
    return this.state
  }

  unsigned(bits: number): number {
    return this.next() >>> (32 - bits)
  }

  signed(bits: number): number {
    const value = this.next() >>> (32 - bits)
    return bits === 32 ? value | 0 : value
  }

  fixed(bits: number): number {
    return (this.next() | 0) >> (32 - bits)
  }

  vector(xyOnly = false): Vector {
    return normalize({ x: this.fixed(24), y: this.fixed(24), z: xyOnly ? 0 : this.fixed(24) })
  }

  scaledRange(value: number, range: number): number {
    return Math.floor(value * (255 - (range * this.unsigned(8) >> 8)) / 256)
  }

  doubleScaledRange(value: number, range: number): number {
    return Math.floor(value * (255 + range - (range * this.unsigned(8) >> 7)) / 256)
  }

  range(value: number): number {
    return Math.floor((value * this.unsigned(9) - value * 256) / 256)
  }
}

function animateScale(resource: HgssSplEmitterResource, particle: Particle, lifeRate: number): void {
  const animation = resource.scaleAnimation
  if (!animation) return
  const start = rawFx(animation.start)
  const middle = rawFx(animation.middle)
  const end = rawFx(animation.end)
  if (lifeRate < animation.curve.in) {
    particle.animatedScale = start + divide(lifeRate * (middle - start), animation.curve.in)
  } else if (lifeRate < animation.curve.out) {
    particle.animatedScale = middle
  } else {
    particle.animatedScale = end + divide((lifeRate - 255) * (end - middle), 255 - animation.curve.out)
  }
}

function colorChannel(color: number, shift: number): number {
  return color >> shift & 0x1f
}

function rgb555(red: number, green: number, blue: number): number {
  return red | green << 5 | blue << 10
}

function interpolateColor(from: number, to: number, amount: number, span: number): number {
  return rgb555(
    colorChannel(from, 0) + divide(amount * (colorChannel(to, 0) - colorChannel(from, 0)), span),
    colorChannel(from, 5) + divide(amount * (colorChannel(to, 5) - colorChannel(from, 5)), span),
    colorChannel(from, 10) + divide(amount * (colorChannel(to, 10) - colorChannel(from, 10)), span),
  )
}

function animateColor(resource: HgssSplEmitterResource, particle: Particle, lifeRate: number): void {
  const animation = resource.colorAnimation
  if (!animation || animation.randomStart) return
  const peak = animation.curve.peak ?? animation.curve.in
  if (lifeRate < animation.curve.in) particle.color = animation.start
  else if (lifeRate < peak) particle.color = animation.interpolate
    ? interpolateColor(animation.start, resource.color, lifeRate - animation.curve.in, peak - animation.curve.in)
    : resource.color
  else if (lifeRate < animation.curve.out) particle.color = animation.interpolate
    ? interpolateColor(resource.color, animation.end, lifeRate - peak, animation.curve.out - peak)
    : animation.end
  else particle.color = animation.end
}

function animateAlpha(resource: HgssSplEmitterResource, particle: Particle, lifeRate: number, random: HgssSplRandom): void {
  const animation = resource.alphaAnimation
  if (!animation) return
  let value: number
  if (lifeRate < animation.curve.in) {
    value = animation.start + divide(lifeRate * (animation.middle - animation.start), animation.curve.in)
  } else if (lifeRate < animation.curve.out) value = animation.middle
  else value = animation.end + divide((lifeRate - 255) * (animation.end - animation.middle), 255 - animation.curve.out)
  particle.animatedAlpha = random.scaledRange(value, animation.randomRange)
}

function animateTexture(resource: HgssSplEmitterResource, particle: Particle, lifeRate: number): void {
  const animation = resource.textureAnimation
  if (!animation || animation.randomStart) return
  for (let index = 0; index < animation.textureIndexes.length; index += 1) {
    if (lifeRate < animation.stepFrames * (index + 1)) {
      particle.textureIndex = animation.textureIndexes[index]!
      return
    }
  }
}

/**
 * Port du cycle SPL officiel utilisé par HGSS. Le simulateur conserve les
 * valeurs internes au format fixe 20.12 et partage le générateur aléatoire
 * entre les émetteurs, comme la variable globale gSPLRandomState de la DS.
 */
export class HgssSplEmitterSimulation {
  readonly resource: HgssSplEmitterResource
  readonly random: HgssSplRandom
  private readonly emitterPosition: Vector
  private emitterAxis: Vector
  private readonly behaviorTargets: Partial<Record<'magnet' | 'convergence', Vector>> = {}
  private readonly particles: Particle[] = []
  private age = 0
  private emissionFraction = 0
  private started = false
  private terminated = false

  constructor(resource: HgssSplEmitterResource, random: HgssSplRandom, emitterPosition: readonly [number, number, number] = [0, 0, 0]) {
    this.resource = resource
    this.random = random
    this.emitterPosition = {
      x: 0,
      y: 0,
      z: 0,
    }
    this.emitterAxis = {
      x: rawFx(resource.axis[0]),
      y: rawFx(resource.axis[1]),
      z: rawFx(resource.axis[2]),
    }
    this.setEmitterPosition(emitterPosition)
  }

  /** Les callbacks 3/4/19 de la ROM suivent le battler pendant l'émission. */
  setEmitterPosition(emitterPosition: readonly [number, number, number]): void {
    this.setEmitterPositionInternal([
      emitterPosition[0] + this.resource.basePosition[0],
      emitterPosition[1] + this.resource.basePosition[1],
      emitterPosition[2] + this.resource.basePosition[2],
    ])
  }

  /** SPLEmitter_SetPos remplace la position issue de la ressource. */
  setEmitterAbsolutePosition(emitterPosition: readonly [number, number] | readonly [number, number, number]): void {
    this.setEmitterPositionInternal(emitterPosition)
  }

  private setEmitterPositionInternal(emitterPosition: readonly [number, number] | readonly [number, number, number]): void {
    this.emitterPosition.x = rawFx(emitterPosition[0])
    this.emitterPosition.y = rawFx(emitterPosition[1])
    if (emitterPosition[2] !== undefined) this.emitterPosition.z = rawFx(emitterPosition[2])
    for (const particle of this.particles) {
      const follows = particle.child ? this.resource.childResource?.followEmitter : (this.resource.flags & 1 << 15) !== 0
      if (follows) particle.emitterPosition = { ...this.emitterPosition }
    }
  }

  /** Les callbacks SPL 5/6 orientent l'émetteur sur l'axe attaquant-cible. */
  setEmitterAxis(axis: readonly [number, number, number]): void {
    this.emitterAxis = { x: rawFx(axis[0]), y: rawFx(axis[1]), z: rawFx(axis[2]) }
  }

  /** Les callbacks SPL 7..16 remplacent les cibles des comportements natifs. */
  setBehaviorTarget(kind: 'magnet' | 'convergence', target: readonly [number, number, number]): void {
    this.behaviorTargets[kind] = { x: rawFx(target[0]), y: rawFx(target[1]), z: rawFx(target[2]) }
  }

  get complete(): boolean {
    return this.terminated
  }

  get particleCount(): number {
    return this.particles.length
  }

  private emitParent(): void {
    const rawEmissionCount = rawFx(this.resource.emissionCount) + this.emissionFraction
    const count = rawEmissionCount >> 12
    this.emissionFraction = rawEmissionCount & 0xfff
    for (let index = 0; index < count && this.particles.length < maximumParticles; index += 1) {
      const emitted = this.emitPosition(index, count)
      if (!emitted) continue
      const { position } = emitted
      const direction = emitted.velocityDirection
        ?? (position.x === 0 && position.y === 0 && position.z === 0 ? this.random.vector() : normalize(position))
      const attenuation = this.resource.randomAttenuation.initialVelocity
      const positionMagnitude = this.random.doubleScaledRange(rawFx(this.resource.initialVelocityPositionAmplifier), attenuation)
      const axisMagnitude = this.random.doubleScaledRange(rawFx(this.resource.initialVelocityAxisAmplifier), attenuation)
      const axis = this.emitterAxis
      const baseScale = this.random.doubleScaledRange(rawFx(this.resource.baseScale), this.resource.randomAttenuation.baseScale)
      let color = this.resource.color
      if (this.resource.colorAnimation?.randomStart) {
        const colors = [this.resource.colorAnimation.start, this.resource.color, this.resource.colorAnimation.end]
        color = colors[this.random.signed(12) % 3] ?? color
      }
      const rotation = (this.resource.flags & 1 << 13) !== 0 ? this.random.signed(32) : this.resource.initialAngle
      const angularVelocity = (this.resource.flags & 1 << 12) !== 0
        ? ((this.resource.maximumRotation - this.resource.minimumRotation) * this.random.unsigned(12) + this.resource.minimumRotation * fxOne) >> 12
        : 0
      const lifetime = this.random.scaledRange(this.resource.particleLifetimeFrames, this.resource.randomAttenuation.lifetime) + 1
      let textureIndex = this.resource.textureIndex
      if (this.resource.textureAnimation) {
        textureIndex = this.resource.textureAnimation.randomStart
          ? this.resource.textureAnimation.textureIndexes[this.random.unsigned(12) % this.resource.textureAnimation.textureIndexes.length] ?? textureIndex
          : this.resource.textureAnimation.textureIndexes[0] ?? textureIndex
      }
      this.particles.unshift({
        position,
        velocity: {
          x: fxMultiply(direction.x, positionMagnitude) + fxMultiply(axis.x, axisMagnitude),
          y: fxMultiply(direction.y, positionMagnitude) + fxMultiply(axis.y, axisMagnitude),
          z: fxMultiply(direction.z, positionMagnitude) + fxMultiply(axis.z, axisMagnitude),
        },
        emitterPosition: { ...this.emitterPosition },
        baseScale,
        animatedScale: fxOne,
        color,
        baseAlpha: this.resource.baseAlpha,
        animatedAlpha: 31,
        rotation,
        angularVelocity,
        lifetime,
        age: 0,
        textureIndex,
        loopTimeFactor: Math.floor(0xffff / Math.max(1, this.resource.loopFrames)),
        lifetimeFactor: Math.floor(0xffff / lifetime),
        lifetimeOffset: (this.resource.flags & 1 << 20) !== 0 ? this.random.signed(8) & 0xff : 0,
        child: false,
      })
    }
  }

  private circleAxes(): { first: Vector, second: Vector, normal: Vector } {
    const configuredAxis = this.resource.circleAxis === 0
      ? { x: 0, y: 0, z: fxOne }
      : this.resource.circleAxis === 1
        ? { x: 0, y: fxOne, z: 0 }
        : this.resource.circleAxis === 2
          ? { x: fxOne, y: 0, z: 0 }
          : normalize(this.emitterAxis)
    let up = { x: 0, y: fxOne, z: 0 }
    if (Math.abs(configuredAxis.y) === fxOne) up = { x: fxOne, y: 0, z: 0 }
    const first = normalize(cross(configuredAxis, up))
    const second = normalize(cross(configuredAxis, first))
    return { first, second, normal: normalize(cross(first, second)) }
  }

  private tilt(position: Vector, axes = this.circleAxes()): Vector {
    return {
      x: fxMultiply(position.x, axes.first.x) + fxMultiply(position.y, axes.second.x) + fxMultiply(position.z, axes.normal.x),
      y: fxMultiply(position.x, axes.first.y) + fxMultiply(position.y, axes.second.y) + fxMultiply(position.z, axes.normal.y),
      z: fxMultiply(position.x, axes.first.z) + fxMultiply(position.y, axes.second.z) + fxMultiply(position.z, axes.normal.z),
    }
  }

  private emitPosition(index: number, count: number): { position: Vector, velocityDirection?: Vector } | undefined {
    const type = this.resource.emissionType
    const radius = rawFx(this.resource.radius)
    if (type === 0) return { position: { x: 0, y: 0, z: 0 } }
    if (type === 1) {
      const direction = this.random.vector()
      return { position: {
        x: fxMultiply(direction.x, radius),
        y: fxMultiply(direction.y, radius),
        z: fxMultiply(direction.z, radius),
      } }
    }
    if (type === 2 || type === 3 || type === 5 || type === 6 || type === 7) {
      const axes = this.circleAxes()
      const direction = type === 3
        ? {
            x: Math.round(Math.sin(index * Math.PI * 2 / Math.max(1, count)) * fxOne),
            y: Math.round(Math.cos(index * Math.PI * 2 / Math.max(1, count)) * fxOne),
            z: 0,
          }
        : this.random.vector(true)
      let x = fxMultiply(direction.x, radius)
      let y = fxMultiply(direction.y, radius)
      if (type === 5 || type === 7) {
        x = fxMultiply(x, this.random.range(fxOne))
        y = fxMultiply(y, this.random.range(fxOne))
      }
      const z = type === 6 || type === 7 ? this.random.range(rawFx(this.resource.length)) : 0
      const position = this.tilt({ x, y, z }, axes)
      const velocityDirection = type === 6 ? normalize(this.tilt(direction, axes)) : undefined
      return { position, velocityDirection }
    }
    if (type === 4) {
      const direction = this.random.vector()
      return { position: {
        x: fxMultiply(fxMultiply(direction.x, radius), this.random.range(fxOne)),
        y: fxMultiply(fxMultiply(direction.y, radius), this.random.range(fxOne)),
        z: fxMultiply(fxMultiply(direction.z, radius), this.random.range(fxOne)),
      } }
    }
    if (type === 8 || type === 9) {
      const normal = this.circleAxes().normal
      const direction = this.random.vector()
      if (dot(normal, direction) <= 0) {
        direction.x = -direction.x
        direction.y = -direction.y
        direction.z = -direction.z
      }
      const volumeScale = () => type === 8 ? fxOne : (this.random.range(fxOne) >> 1) + fxOne / 2
      return { position: {
        x: fxMultiply(fxMultiply(direction.x, radius), volumeScale()),
        y: fxMultiply(fxMultiply(direction.y, radius), volumeScale()),
        z: fxMultiply(fxMultiply(direction.z, radius), volumeScale()),
      } }
    }
    return undefined
  }

  private emitChildren(parent: Particle): void {
    const child = this.resource.childResource
    if (!child) return
    const velocityRatio = fxMultiply(child.velocityRatio * fxOne, rawFx(1 / 256))
    for (let index = 0; index < child.emissionCount && this.particles.length < maximumParticles; index += 1) {
      const parentScale = fxMultiply(parent.baseScale, parent.animatedScale)
      const rotation = child.rotationType === 0 ? 0 : parent.rotation
      this.particles.push({
        position: { ...parent.position },
        velocity: {
          x: fxMultiply(parent.velocity.x, velocityRatio) + this.random.range(rawFx(child.randomInitialVelocityMagnitude)),
          y: fxMultiply(parent.velocity.y, velocityRatio) + this.random.range(rawFx(child.randomInitialVelocityMagnitude)),
          z: fxMultiply(parent.velocity.z, velocityRatio) + this.random.range(rawFx(child.randomInitialVelocityMagnitude)),
        },
        emitterPosition: { ...parent.emitterPosition },
        baseScale: parentScale * (child.scaleRatio + 1) >> 6,
        animatedScale: fxOne,
        color: child.useChildColor ? child.color : parent.color,
        baseAlpha: parent.baseAlpha * (parent.animatedAlpha + 1) >> 5,
        animatedAlpha: 31,
        rotation,
        angularVelocity: child.rotationType === 2 ? parent.angularVelocity : 0,
        lifetime: child.lifetimeFrames,
        age: 0,
        textureIndex: child.textureIndex,
        loopTimeFactor: Math.floor(0xffff / Math.max(1, parent.lifetime >> 1)),
        lifetimeFactor: Math.floor(0xffff / Math.max(1, parent.lifetime)),
        lifetimeOffset: 0,
        child: true,
      })
    }
  }

  step(): readonly HgssSplParticleSample[] {
    if (this.terminated) return []
    if (!this.started && this.age >= this.resource.startDelayFrames) {
      this.started = true
      this.age = 0
    }
    if (this.started && (this.resource.emitterLifetimeFrames === 0 || this.age < this.resource.emitterLifetimeFrames)
      && this.age % Math.max(1, this.resource.emissionIntervalFrames) === 0) this.emitParent()

    const parentParticles = this.particles.filter((particle) => !particle.child)
    for (const particle of parentParticles) {
      const normalRate = particle.lifetimeFactor * particle.age >> 8
      const loopRate = (particle.lifetimeOffset + (particle.loopTimeFactor * particle.age >> 8)) & 0xff
      animateScale(this.resource, particle, this.resource.scaleAnimation?.loop ? loopRate : normalRate)
      animateColor(this.resource, particle, this.resource.colorAnimation?.loop ? loopRate : normalRate)
      animateAlpha(this.resource, particle, this.resource.alphaAnimation?.loop ? loopRate : normalRate, this.random)
      animateTexture(this.resource, particle, this.resource.textureAnimation?.loop ? loopRate : normalRate)
      this.updateParticle(particle, true)
    }
    const child = this.resource.childResource
    for (const particle of this.particles.filter((item) => item.child)) {
      const lifeRate = divide(particle.age << 8, particle.lifetime)
      if (child?.hasScaleAnimation) particle.animatedScale = rawFx(child.endScale) + divide((rawFx(child.endScale) - fxOne) * (lifeRate - 255), 255)
      if (child?.hasAlphaAnimation) particle.animatedAlpha = divide((255 - lifeRate) * 31, 255)
      this.updateParticle(particle, child?.usesBehaviors ?? false)
    }
    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      if (this.particles[index]!.age > this.particles[index]!.lifetime) this.particles.splice(index, 1)
    }
    this.age += 1
    // Les callbacks natifs conservent un handle pour les émetteurs non
    // self-maintaining. Le lecteur web joue une ressource finie sans exposer ce
    // handle : il la libère donc au même seuil de vie au lieu de rester bloqué.
    if (this.resource.emitterLifetimeFrames !== 0 && this.started
      && this.age > this.resource.emitterLifetimeFrames && this.particles.length === 0) this.terminated = true
    return this.samples()
  }

  private updateParticle(particle: Particle, useBehaviors: boolean): void {
    const acceleration = { x: 0, y: 0, z: 0 }
    if (useBehaviors) {
      for (const behavior of this.resource.behaviors) {
        if (behavior.kind === 'gravity') {
          acceleration.x += rawFx(behavior.magnitude[0])
          acceleration.y += rawFx(behavior.magnitude[1])
          acceleration.z += rawFx(behavior.magnitude[2])
        } else if (behavior.kind === 'random' && particle.age % Math.max(1, behavior.applyIntervalFrames) === 0) {
          acceleration.x += this.random.range(rawFx(behavior.magnitude[0]))
          acceleration.y += this.random.range(rawFx(behavior.magnitude[1]))
          acceleration.z += this.random.range(rawFx(behavior.magnitude[2]))
        } else if (behavior.kind === 'magnet') {
          const target = this.behaviorTargets.magnet ?? {
            x: rawFx(behavior.target[0]),
            y: rawFx(behavior.target[1]),
            z: rawFx(behavior.target[2]),
          }
          const force = rawFx(behavior.force)
          acceleration.x += fxMultiply(force, target.x - particle.position.x - particle.velocity.x)
          acceleration.y += fxMultiply(force, target.y - particle.position.y - particle.velocity.y)
          acceleration.z += fxMultiply(force, target.z - particle.position.z - particle.velocity.z)
        } else if (behavior.kind === 'spin') {
          particle.position = rotate(particle.position, behavior.axis, behavior.angle)
        } else if (behavior.kind === 'collisionPlane') {
          const planeY = rawFx(behavior.y)
          const emitterY = particle.emitterPosition.y
          const crossed = (emitterY < planeY && emitterY + particle.position.y > planeY)
            || (emitterY >= planeY && emitterY + particle.position.y < planeY)
          if (crossed) {
            particle.position.y = planeY - emitterY
            if (behavior.collisionType === 0) particle.age = particle.lifetime
            else particle.velocity.y = -fxMultiply(particle.velocity.y, rawFx(behavior.elasticity))
          }
        } else if (behavior.kind === 'convergence') {
          const target = this.behaviorTargets.convergence ?? {
            x: rawFx(behavior.target[0]),
            y: rawFx(behavior.target[1]),
            z: rawFx(behavior.target[2]),
          }
          const force = rawFx(behavior.force)
          particle.position.x += fxMultiply(force, target.x - particle.position.x)
          particle.position.y += fxMultiply(force, target.y - particle.position.y)
          particle.position.z += fxMultiply(force, target.z - particle.position.z)
        }
      }
    }
    particle.rotation = particle.rotation + particle.angularVelocity & 0xffff
    const airResistance = this.resource.airResistance + 48
    particle.velocity.x = Math.floor(particle.velocity.x * airResistance / 512)
    particle.velocity.y = Math.floor(particle.velocity.y * airResistance / 512)
    particle.velocity.z = Math.floor(particle.velocity.z * airResistance / 512)
    particle.velocity.x += acceleration.x
    particle.velocity.y += acceleration.y
    particle.velocity.z += acceleration.z
    particle.position.x += particle.velocity.x
    particle.position.y += particle.velocity.y
    particle.position.z += particle.velocity.z
    const child = this.resource.childResource
    if (!particle.child && child) {
      const delayedAge = particle.age - (particle.lifetime * child.emissionDelay >> 8)
      if (delayedAge >= 0 && delayedAge % Math.max(1, child.emissionIntervalFrames) === 0) this.emitChildren(particle)
    }
    particle.age += 1
  }

  samples(): readonly HgssSplParticleSample[] {
    return this.particles.map((particle) => {
      let scaleX = fxMultiply(particle.baseScale, rawFx(this.resource.aspectRatio))
      let scaleY = particle.baseScale
      if (this.resource.scaleAnimationDirection === 0) {
        scaleX = fxMultiply(scaleX, particle.animatedScale)
        scaleY = fxMultiply(scaleY, particle.animatedScale)
      } else if (this.resource.scaleAnimationDirection === 1) scaleX = fxMultiply(scaleX, particle.animatedScale)
      else scaleY = fxMultiply(scaleY, particle.animatedScale)
      return {
        x: particle.position.x + particle.emitterPosition.x,
        y: particle.position.y + particle.emitterPosition.y,
        z: particle.position.z + particle.emitterPosition.z,
        velocityX: particle.velocity.x,
        velocityY: particle.velocity.y,
        velocityZ: particle.velocity.z,
        scaleX,
        scaleY,
        color: particle.color,
        alpha: particle.baseAlpha * (particle.animatedAlpha + 1) >> 5,
        rotation: particle.rotation,
        textureIndex: particle.textureIndex,
        drawType: particle.child ? this.resource.childResource?.drawType ?? this.resource.drawType : this.resource.drawType,
        child: particle.child,
      }
    })
  }
}
