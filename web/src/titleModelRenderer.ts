import * as THREE from 'three'
import type { TitleAnimationState } from './titleAnimation'
import type { NitroModelPreview } from './ndsTypes'
import { addTitleModelToGroup, fitTitleRoot, type TitleAnimatedMesh, type TitleAtmosphereMesh, type TitleMorphSurface } from './rendering/title/titleModelScene'

type TitleModelCache = {
  legend: NitroModelPreview | undefined
  legendFrames: NitroModelPreview[] | undefined
  sparkles: NitroModelPreview | undefined
  canvas: HTMLCanvasElement
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.OrthographicCamera
  root: THREE.Group
  textures: THREE.DataTexture[]
  animatedMeshes: TitleAnimatedMesh[]
  atmosphereMeshes: TitleAtmosphereMesh[]
  legendMorphSurfaces: TitleMorphSurface[]
  basePosition: THREE.Vector3
  baseRotation: THREE.Euler
  baseScale: THREE.Vector3
  renderAspect: number
}

export type TitleModelRenderer = {
  render: (
    legend: NitroModelPreview | undefined,
    sparkles: NitroModelPreview | undefined,
    animation?: TitleAnimationState,
    legendFrames?: NitroModelPreview[],
    aspect?: number,
  ) => HTMLCanvasElement | undefined
  dispose: () => void
}

const titleModelWidth = 256
const titleModelHeight = 192
const titleModelRenderScale = 4
const titleModelAspect = titleModelWidth / titleModelHeight

export function getTitleModelViewSize(requestedAspect: number): { width: number, height: number } {
  const aspect = Math.max(0.25, Math.min(4, requestedAspect))
  let viewWidth = titleModelWidth
  let viewHeight = titleModelHeight
  if (aspect > titleModelAspect) viewWidth = titleModelHeight * aspect
  else if (aspect < titleModelAspect) viewHeight = titleModelWidth / aspect
  return { width: viewWidth, height: viewHeight }
}

function syncRenderViewport(cache: TitleModelCache, requestedAspect: number): void {
  const aspect = Math.max(0.25, Math.min(4, requestedAspect))
  if (Math.abs(cache.renderAspect - aspect) < 0.001) return
  cache.renderAspect = aspect
  const view = getTitleModelViewSize(aspect)

  cache.renderer.setSize(
    Math.max(1, Math.round(view.width * titleModelRenderScale)),
    Math.max(1, Math.round(view.height * titleModelRenderScale)),
    false,
  )
  cache.camera.left = -view.width / 2
  cache.camera.right = view.width / 2
  cache.camera.top = view.height / 2
  cache.camera.bottom = -view.height / 2
  cache.camera.updateProjectionMatrix()
}

function applyTitleLegendMorph(cache: TitleModelCache, animation: TitleAnimationState | undefined): void {
  const frames = cache.legendFrames
  if (!animation || !frames || frames.length < 2) return
  const framePosition = animation.frameFloat * frames.length / Math.max(1, animation.frameCount)
  const firstFrameIndex = Math.floor(framePosition) % frames.length
  const secondFrameIndex = (firstFrameIndex + 1) % frames.length
  const mix = framePosition - Math.floor(framePosition)
  const firstFrame = frames[firstFrameIndex]
  const secondFrame = frames[secondFrameIndex]
  const firstSurfaces = firstFrame.surfaces
  const secondSurfaces = secondFrame.surfaces
  if (!firstSurfaces || !secondSurfaces) return

  for (const morphSurface of cache.legendMorphSurfaces) {
    const firstPositions = firstSurfaces[morphSurface.surfaceIndex]?.positions
    const secondPositions = secondSurfaces[morphSurface.surfaceIndex]?.positions
    const output = morphSurface.positionAttribute.array
    if (!(output instanceof Float32Array) || !firstPositions || !secondPositions) continue
    if (firstPositions.length !== output.length || secondPositions.length !== output.length) continue
    for (let index = 0; index < output.length; index += 1) {
      output[index] = firstPositions[index] + (secondPositions[index] - firstPositions[index]) * mix
    }
    morphSurface.positionAttribute.needsUpdate = true
  }
}

function applyTitleAnimation(cache: TitleModelCache, animation: TitleAnimationState | undefined): void {
  applyTitleLegendMorph(cache, animation)
  cache.root.position.copy(cache.basePosition)
  cache.root.rotation.copy(cache.baseRotation)
  cache.root.scale.copy(cache.baseScale)
  for (const entry of cache.animatedMeshes) entry.mesh.rotation.copy(entry.baseRotation)
  for (const entry of cache.atmosphereMeshes) {
    entry.mesh.position.copy(entry.basePosition)
    entry.texture?.offset.set(0, 0)
  }
  if (!animation) return

  cache.root.position.y += animation.modelOffsetY
  cache.root.position.z += animation.modelOffsetZ
  cache.root.rotation.x += animation.modelRoll
  cache.root.rotation.y += animation.modelYaw
  cache.root.scale.multiplyScalar(animation.modelScale)
  const inverseScale = 1 / Math.max(cache.root.scale.x, 0.001)
  for (const entry of cache.atmosphereMeshes) {
    entry.mesh.position.y += (animation.atmosphereOffsetY - animation.modelOffsetY) * inverseScale
    entry.mesh.position.z += (animation.atmosphereOffsetZ - animation.modelOffsetZ) * inverseScale
    entry.texture?.offset.set(animation.atmosphereTextureOffset, 0)
  }
}

function disposeCache(cache: TitleModelCache | undefined): void {
  if (!cache) return
  cache.root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    object.geometry.dispose()
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) material.dispose()
  })
  for (const texture of cache.textures) texture.dispose()
  cache.renderer.dispose()
}

function createCache(legend: NitroModelPreview | undefined, sparkles: NitroModelPreview | undefined, legendFrames: NitroModelPreview[] | undefined): TitleModelCache {
  const canvas = document.createElement('canvas')
  canvas.width = titleModelWidth * titleModelRenderScale
  canvas.height = titleModelHeight * titleModelRenderScale
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, canvas, preserveDrawingBuffer: true })
  renderer.setPixelRatio(1)
  renderer.setSize(titleModelWidth * titleModelRenderScale, titleModelHeight * titleModelRenderScale, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.setClearColor(0x000000, 0)

  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-128, 128, 96, -96, -10000, 10000)
  camera.position.set(-1000, 0, 0)
  camera.lookAt(new THREE.Vector3(0, 0, 0))

  const root = new THREE.Group()
  const modelRoot = new THREE.Group()
  const textures: THREE.DataTexture[] = []
  const animatedMeshes: TitleAnimatedMesh[] = []
  const atmosphereMeshes: TitleAtmosphereMesh[] = []
  const legendMorphSurfaces: TitleMorphSurface[] = []
  if (legend) addTitleModelToGroup(modelRoot, legend, textures, animatedMeshes, atmosphereMeshes, legendFrames ? legendMorphSurfaces : undefined)
  if (sparkles) addTitleModelToGroup(modelRoot, sparkles, textures, animatedMeshes, atmosphereMeshes)
  root.add(modelRoot)
  fitTitleRoot(root)
  const basePosition = root.position.clone()
  const baseRotation = root.rotation.clone()
  const baseScale = root.scale.clone()
  scene.add(root)

  return { legend, legendFrames, sparkles, canvas, renderer, scene, camera, root, textures, animatedMeshes, atmosphereMeshes, legendMorphSurfaces, basePosition, baseRotation, baseScale, renderAspect: titleModelAspect }
}

export function createTitleModelRenderer(): TitleModelRenderer {
  let cache: TitleModelCache | undefined

  return {
    render(legend, sparkles, animation, legendFrames, aspect = titleModelAspect) {
      if (!legend && !sparkles) return undefined
      if (!cache || cache.legend !== legend || cache.legendFrames !== legendFrames || cache.sparkles !== sparkles) {
        disposeCache(cache)
        cache = createCache(legend, sparkles, legendFrames)
      }
      syncRenderViewport(cache, aspect)
      applyTitleAnimation(cache, animation)
      cache.renderer.clear()
      cache.renderer.render(cache.scene, cache.camera)
      return cache.canvas
    },
    dispose() {
      disposeCache(cache)
      cache = undefined
    },
  }
}
