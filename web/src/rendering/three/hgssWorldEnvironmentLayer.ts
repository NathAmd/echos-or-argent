import * as THREE from 'three'
import type { HgssFieldVisualTime } from '../../game/time/hgssRtc'
import { resolveHgssFieldVisualTime } from '../../game/time/hgssRtc'
import { hgssWeather, isHgssExteriorMapType, type HgssWeather } from '../../game/world/hgssWeather'
import type { HgssWorldEnvironmentPresentation } from '../../game/world/hgssEnvironmentCoordinator'
import { resolveHgssWeatherVisualProfile, type HgssWeatherVisualProfile } from './hgssWeatherPresentation'

type LightingProfile = {
  sky: number
  ground: number
  hemisphereIntensity: number
  sun: number
  sunIntensity: number
}

const fieldLighting: Readonly<Record<HgssFieldVisualTime, LightingProfile>> = {
  0: { sky: 0xffd8bd, ground: 0x4d6073, hemisphereIntensity: 2.05, sun: 0xffc685, sunIntensity: 2.15 },
  1: { sky: 0xd8f2f5, ground: 0x34485b, hemisphereIntensity: 2.2, sun: 0xffe4ae, sunIntensity: 2.4 },
  2: { sky: 0xe6a685, ground: 0x423d61, hemisphereIntensity: 1.7, sun: 0xf18b62, sunIntensity: 1.75 },
  3: { sky: 0x7188ad, ground: 0x172337, hemisphereIntensity: 1.15, sun: 0x91a8d8, sunIntensity: 1.05 },
}

const neutralLighting = fieldLighting[1]
const particleCount = 192
const sunOffset = new THREE.Vector3(-18, 30, 14)

export function syncHgssSunAnchor(sun: THREE.DirectionalLight, focus: THREE.Vector3): void {
  sun.target.position.copy(focus)
  sun.position.copy(focus).add(sunOffset)
  sun.target.updateMatrixWorld()
}

export class HgssWorldEnvironmentLayer {
  private readonly scene: THREE.Scene
  private readonly group = new THREE.Group()
  private readonly geometry = new THREE.BufferGeometry()
  private readonly positions = new Float32Array(particleCount * 3)
  private readonly rainGeometry = new THREE.BufferGeometry()
  private readonly rainPositions = new Float32Array(particleCount * 6)
  private readonly seeds = new Float32Array(particleCount)
  private readonly material = new THREE.PointsMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: false,
    sizeAttenuation: false,
    size: 2,
  })
  private readonly rainMaterial = new THREE.LineBasicMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: false,
  })
  private readonly points: THREE.Points
  private readonly rainLines: THREE.LineSegments
  private readonly targetSky = new THREE.Color(neutralLighting.sky)
  private readonly targetGround = new THREE.Color(neutralLighting.ground)
  private readonly targetSun = new THREE.Color(neutralLighting.sun)
  private targetHemisphereIntensity = neutralLighting.hemisphereIntensity
  private targetSunIntensity = neutralLighting.sunIntensity
  private weather: HgssWeather = hgssWeather.clear
  private weatherProfile: HgssWeatherVisualProfile = resolveHgssWeatherVisualProfile(hgssWeather.clear)
  private ownedFog: THREE.FogExp2 | undefined
  private previousUpdate = performance.now()
  private readonly hemisphere: THREE.HemisphereLight
  private readonly sun: THREE.DirectionalLight

  constructor(
    scene: THREE.Scene,
    hemisphere: THREE.HemisphereLight,
    sun: THREE.DirectionalLight,
  ) {
    this.scene = scene
    this.hemisphere = hemisphere
    this.sun = sun
    scene.add(this.sun.target)
    let seed = 0x6d2b79f5
    const random = (): number => {
      seed = Math.imul(seed ^ seed >>> 15, seed | 1)
      seed ^= seed + Math.imul(seed ^ seed >>> 7, seed | 61)
      return ((seed ^ seed >>> 14) >>> 0) / 0x1_0000_0000
    }
    for (let index = 0; index < particleCount; index += 1) {
      const offset = index * 3
      this.positions[offset] = (random() - 0.5) * 38
      this.positions[offset + 1] = random() * 26 - 2
      this.positions[offset + 2] = (random() - 0.5) * 32
      this.seeds[index] = random()
    }
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    this.rainGeometry.setAttribute('position', new THREE.BufferAttribute(this.rainPositions, 3))
    this.points = new THREE.Points(this.geometry, this.material)
    this.rainLines = new THREE.LineSegments(this.rainGeometry, this.rainMaterial)
    this.points.renderOrder = 250_000
    this.rainLines.renderOrder = 250_000
    this.points.frustumCulled = false
    this.rainLines.frustumCulled = false
    this.group.add(this.points, this.rainLines)
    this.group.visible = false
    this.scene.add(this.group)
  }

  setEnvironment(environment: HgssWorldEnvironmentPresentation): void {
    this.weather = environment.weather
    this.weatherProfile = resolveHgssWeatherVisualProfile(environment.weather)
    const visualTime = resolveHgssFieldVisualTime(environment.timeOfDay)
    const profile = isHgssExteriorMapType(environment.mapType) ? fieldLighting[visualTime] : neutralLighting
    const darkness = environment.weather === hgssWeather.darkness
      ? 0.58
      : environment.weather === hgssWeather.deepDarkness
        ? 0.38
        : environment.weather === hgssWeather.lowLight
          ? 0.72
          : 1
    const weatherLighting = darkness * this.weatherProfile.lighting
    this.targetSky.set(profile.sky).multiplyScalar(weatherLighting)
    this.targetGround.set(profile.ground).multiplyScalar(weatherLighting)
    this.targetSun.set(profile.sun).multiplyScalar(weatherLighting)
    this.targetHemisphereIntensity = profile.hemisphereIntensity * weatherLighting
    this.targetSunIntensity = profile.sunIntensity * weatherLighting
    this.group.visible = this.weatherProfile.particleCount > 0
    this.points.visible = this.weatherProfile.particleMode !== 'none' && this.weatherProfile.particleMode !== 'rain'
    this.rainLines.visible = this.weatherProfile.particleMode === 'rain'
    this.geometry.setDrawRange(0, this.weatherProfile.particleCount)
    this.rainGeometry.setDrawRange(0, this.weatherProfile.particleCount * 2)
    this.material.color.set(this.weatherProfile.color)
    this.material.opacity = this.weatherProfile.opacity
    this.material.size = this.weatherProfile.size
    this.rainMaterial.color.set(this.weatherProfile.color)
    this.rainMaterial.opacity = this.weatherProfile.opacity
    this.syncWeatherFog(environment.mapType)
    this.syncRainStreaks()
  }

  private syncWeatherFog(mapType: number): void {
    const density = isHgssExteriorMapType(mapType) ? this.weatherProfile.fogDensity : 0
    if (density <= 0) {
      if (this.scene.fog === this.ownedFog) this.scene.fog = null
      this.ownedFog = undefined
      return
    }
    this.ownedFog ??= new THREE.FogExp2(this.weatherProfile.color, density)
    this.ownedFog.color.set(this.weatherProfile.color)
    this.ownedFog.density = density
    this.scene.fog = this.ownedFog
  }

  private syncRainStreaks(): void {
    if (this.weatherProfile.particleMode !== 'rain') return
    for (let index = 0; index < this.weatherProfile.particleCount; index += 1) {
      const pointOffset = index * 3
      const lineOffset = index * 6
      const x = this.positions[pointOffset]!
      const y = this.positions[pointOffset + 1]!
      const z = this.positions[pointOffset + 2]!
      this.rainPositions[lineOffset] = x
      this.rainPositions[lineOffset + 1] = y
      this.rainPositions[lineOffset + 2] = z
      this.rainPositions[lineOffset + 3] = x - this.weatherProfile.streakLength * 0.22
      this.rainPositions[lineOffset + 4] = y + this.weatherProfile.streakLength
      this.rainPositions[lineOffset + 5] = z
    }
    this.rainGeometry.attributes.position!.needsUpdate = true
  }

  update(now: number, camera: THREE.Camera, shadowFocus?: THREE.Vector3): void {
    const delta = Math.min(50, Math.max(0, now - this.previousUpdate))
    this.previousUpdate = now
    const blend = 1 - Math.exp(-delta / 520)
    this.hemisphere.color.lerp(this.targetSky, blend)
    this.hemisphere.groundColor.lerp(this.targetGround, blend)
    this.sun.color.lerp(this.targetSun, blend)
    this.hemisphere.intensity = THREE.MathUtils.lerp(this.hemisphere.intensity, this.targetHemisphereIntensity, blend)
    this.sun.intensity = THREE.MathUtils.lerp(this.sun.intensity, this.targetSunIntensity, blend)
    syncHgssSunAnchor(this.sun, shadowFocus ?? camera.position)
    if (!this.group.visible) return

    const weatherFocus = shadowFocus ?? camera.position
    this.group.position.copy(weatherFocus)
    const mode = this.weatherProfile.particleMode
    for (let index = 0; index < this.weatherProfile.particleCount; index += 1) {
      const offset = index * 3
      if (mode === 'rain') {
        this.positions[offset] += delta * this.weatherProfile.horizontalSpeed
        this.positions[offset + 1] += delta * this.weatherProfile.verticalSpeed
      } else if (mode === 'snow' || mode === 'diamond') {
        this.positions[offset] += delta * this.weatherProfile.horizontalSpeed
          + Math.sin(now * 0.0015 + this.seeds[index]! * 12) * delta * 0.002
        this.positions[offset + 1] += delta * this.weatherProfile.verticalSpeed
      } else if (mode === 'sand') {
        this.positions[offset] += delta * this.weatherProfile.horizontalSpeed
        this.positions[offset + 1] += Math.sin(now * 0.002 + this.seeds[index]! * 9) * delta * 0.001
      } else {
        this.positions[offset] += delta * this.weatherProfile.horizontalSpeed
          + Math.sin(now * 0.0007 + this.seeds[index]! * 10) * delta * 0.0015
      }
      if (this.positions[offset] > 19) this.positions[offset] = -19
      if (this.positions[offset] < -19) this.positions[offset] = 19
      if (this.positions[offset + 1] < -2) this.positions[offset + 1] = 24
      if (this.positions[offset + 1] > 24) this.positions[offset + 1] = -2
    }
    this.geometry.attributes.position!.needsUpdate = true
    this.syncRainStreaks()
    if (this.weather === hgssWeather.diamondDust) {
      this.material.opacity = 0.35 + (Math.sin(now * 0.004) + 1) * 0.18
    }
    if (this.weather === hgssWeather.thunderstorm || this.weather === hgssWeather.storm) {
      const flash = Math.max(0, Math.sin(now * 0.0063) - 0.985) * 40
      this.sun.intensity += flash
    }
  }

  dispose(): void {
    this.group.removeFromParent()
    this.sun.target.removeFromParent()
    if (this.scene.fog === this.ownedFog) this.scene.fog = null
    this.geometry.dispose()
    this.rainGeometry.dispose()
    this.material.dispose()
    this.rainMaterial.dispose()
  }
}
