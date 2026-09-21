import type { NitroAnimationPreview, NitroTexturePreview, RomInventory } from './ndsTypes'

export type TitleAnimationState = {
  frame: number
  frameFloat: number
  frameCount: number
  sparkleTexture?: NitroTexturePreview
  sparkleAlpha: number
  promptAlpha: number
  modelOffsetY: number
  modelOffsetZ: number
  modelRoll: number
  modelYaw: number
  modelScale: number
  atmosphereOffsetY: number
  atmosphereOffsetZ: number
  atmosphereTextureOffset: number
}

const titleFrameRate = 60

function requireFrameCount(animation: NitroAnimationPreview | undefined, label: string): number {
  if (!animation?.frameCount || animation.frameCount <= 0) throw new Error(`L’animation ROM ${label} est absente ou vide.`)
  return animation.frameCount
}

function trailingNumber(value: string): number {
  const match = /\.(\d+)$/.exec(value)
  return match ? Number(match[1]) : 0
}

function getSparkleTextures(inventory: RomInventory): NitroTexturePreview[] {
  return [...(inventory.titleSparklesModel?.textures ?? [])]
    .filter((texture) => texture.name.startsWith('hou_kira'))
    .sort((left, right) => trailingNumber(left.name) - trailingNumber(right.name) || left.name.localeCompare(right.name))
}

export function createTitleAnimationState(inventory: RomInventory, nowMs = performance.now()): TitleAnimationState {
  const frameCount = requireFrameCount(inventory.titleLegendAnimation, 'du Pokemon legendaire')
  const elapsedFrames = nowMs * titleFrameRate / 1000
  const frameFloat = elapsedFrames % frameCount
  const frame = Math.floor(frameFloat)
  const normalized = frame / frameCount
  const cycle = normalized * Math.PI * 2
  const elapsedSeconds = nowMs / 1000
  const flightWave = elapsedSeconds * 0.72
  const horizontalPhase = flightWave * 0.39 + 0.4
  const verticalPhase = flightWave * 0.53 - 0.7
  const horizontalPosition = Math.sin(horizontalPhase)
  const edgeProximity = Math.pow(Math.abs(horizontalPosition), 0.65)
  const patternFrameCount = requireFrameCount(inventory.titleSparkleAnimation, 'des etincelles du titre')
  const patternFrame = Math.floor(nowMs * titleFrameRate / 1000) % patternFrameCount
  const sparkleTextures = getSparkleTextures(inventory)
  if (sparkleTextures.length === 0) throw new Error('Les textures ROM des etincelles du titre sont absentes.')
  const sparkleTexture = sparkleTextures[Math.floor(patternFrame / 6) % sparkleTextures.length]
  const sparklePulse = 0.5 + 0.5 * Math.sin(patternFrame * Math.PI / 12)

  return {
    frame,
    frameFloat,
    frameCount,
    sparkleTexture,
    sparkleAlpha: 0.45 + sparklePulse * 0.55,
    promptAlpha: 0.35 + (0.5 + 0.5 * Math.sin(cycle * 2)) * 0.65,
    modelOffsetY: Math.sin(verticalPhase) * 27
      + Math.sin(flightWave * 1.17 + 0.8) * 3.5,
    modelOffsetZ: horizontalPosition * 58
      + Math.sin(flightWave * 0.79 - 0.2) * 6,
    modelRoll: Math.cos(horizontalPhase) * 0.075
      + Math.sin(flightWave * 0.79 - 0.2) * 0.012,
    modelYaw: Math.cos(horizontalPhase) * 0.035,
    modelScale: 0.72 + edgeProximity * 0.56,
    atmosphereOffsetY: Math.sin(elapsedSeconds * 0.19 + 1.7) * 1.8,
    atmosphereOffsetZ: Math.sin(elapsedSeconds * 0.11 + 0.3) * 7
      + Math.sin(elapsedSeconds * 0.037 - 1.1) * 4
      + Math.sin(elapsedSeconds * 0.29 + 2.2) * 1.5,
    atmosphereTextureOffset: (elapsedSeconds * 0.006) % 1,
  }
}
