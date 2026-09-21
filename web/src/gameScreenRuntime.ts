import { createTitleModelRenderer } from './titleModelRenderer'
import { createTitleAnimationState, type TitleAnimationState } from './titleAnimation'
import type { IntroRenderState } from './game/intro/introTypes'
import type { NitroGraphic, NitroModelPreview, NitroTexturePreview, RomInventory } from './ndsTypes'
import { createCanvasAssetCache } from './rendering/canvas/canvasAssets'
import { resolveGameRenderPixelRatio } from './rendering/renderResolution'
import { getRevealedDialogText } from './game/intro/dialogTextAnimation'
import { HgssSplParticleCanvasPlayback } from './game/battle/splParticleCanvas'
import { createOpeningCinematicState, type OpeningCinematicState } from './game/boot/openingCinematic'
import { hgssMillisecondsToVBlanks, hgssVBlanksToMilliseconds } from './game/time/hgssFrameTiming'
import { confirmationChoiceGap, getResponsiveIntroLayout, type LayoutRect } from './game/intro/responsiveIntroLayout'
import {
  getAdaptiveViewport,
  storySafeHeight as storyNativeHeight,
  storySafeWidth as storyNativeWidth,
} from './rendering/canvas/adaptiveViewport'

export type { IntroRenderState } from './game/intro/introTypes'

export type GameScreenRuntime = {
  setMode: (mode: 'story' | 'map') => void
  showCanvas: (visible: boolean) => void
  drawOpening: (inventory: RomInventory, elapsedMs: number, force?: boolean) => void
  drawTitle: (inventory: RomInventory, force?: boolean) => void
  drawIntro: (inventory: RomInventory, intro: IntroRenderState, force?: boolean) => void
  drawIntroShrink: (inventory: RomInventory, gender: 'male' | 'female', elapsedMs: number) => void
  completeIntroTextAnimation: () => boolean
  canAdvanceIntro: (inventory: RomInventory, intro: IntroRenderState) => boolean
  dispose: () => void
}

const dsScreenWidth = 256
const dsScreenHeight = 192
const titleRenderScale = 2

const titleModelRenderer = createTitleModelRenderer()
const canvasAssets = createCanvasAssetCache()

function wrapDialogText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  for (const sourceLine of text.split('\n')) {
    const words = sourceLine.trim().split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      lines.push('')
      continue
    }
    let line = ''
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (context.measureText(candidate).width > maxWidth && line) {
        lines.push(line)
        line = word
      } else {
        line = candidate
      }
    }
    if (line || sourceLine.length === 0) lines.push(line)
  }
  return lines
}

function drawGraphicRegion(
  context: CanvasRenderingContext2D,
  graphic: NitroGraphic | undefined,
  sourceX: number,
  sourceY: number,
  sourceWidth: number,
  sourceHeight: number,
  targetX: number,
  targetY: number,
  targetWidth: number,
  targetHeight: number,
  smoothing = false,
): void {
  if (!graphic) return
  const clampedWidth = Math.max(0, Math.min(sourceWidth, graphic.width - sourceX))
  const clampedHeight = Math.max(0, Math.min(sourceHeight, graphic.height - sourceY))
  if (clampedWidth <= 0 || clampedHeight <= 0) return
  context.save()
  context.imageSmoothingEnabled = smoothing
  if (smoothing) context.imageSmoothingQuality = 'high'
  context.drawImage(
    canvasAssets.getGraphicCanvas(graphic),
    sourceX,
    sourceY,
    clampedWidth,
    clampedHeight,
    targetX,
    targetY,
    targetWidth,
    targetHeight,
  )
  context.restore()
}

function drawGraphicContainAt(
  context: CanvasRenderingContext2D,
  graphic: NitroGraphic | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
  smoothing = false,
): void {
  if (!graphic) return
  const scale = Math.min(width / graphic.width, height / graphic.height)
  const targetWidth = graphic.width * scale
  const targetHeight = graphic.height * scale
  drawGraphicRegion(context, graphic, 0, 0, graphic.width, graphic.height,
    x + (width - targetWidth) / 2, y + (height - targetHeight) / 2, targetWidth, targetHeight, smoothing)
}

const opaqueGraphicBounds = new WeakMap<NitroGraphic, { x: number, y: number, width: number, height: number }>()

function getOpaqueGraphicBounds(graphic: NitroGraphic): { x: number, y: number, width: number, height: number } {
  const cached = opaqueGraphicBounds.get(graphic)
  if (cached) return cached
  let minX = graphic.width
  let minY = graphic.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < graphic.height; y += 1) {
    for (let x = 0; x < graphic.width; x += 1) {
      if (graphic.pixels[(y * graphic.width + x) * 4 + 3] === 0) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  const padding = 3
  const bounds = maxX < minX || maxY < minY
    ? { x: 0, y: 0, width: graphic.width, height: graphic.height }
    : {
        x: Math.max(0, minX - padding),
        y: Math.max(0, minY - padding),
        width: Math.min(graphic.width - Math.max(0, minX - padding), maxX - minX + 1 + padding * 2),
        height: Math.min(graphic.height - Math.max(0, minY - padding), maxY - minY + 1 + padding * 2),
      }
  opaqueGraphicBounds.set(graphic, bounds)
  return bounds
}

function drawGraphicSubjectContainAt(
  context: CanvasRenderingContext2D,
  graphic: NitroGraphic | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  if (!graphic) return
  const source = getOpaqueGraphicBounds(graphic)
  const scale = Math.min(width / source.width, height / source.height)
  const targetWidth = source.width * scale
  const targetHeight = source.height * scale
  drawGraphicRegion(context, graphic, source.x, source.y, source.width, source.height,
    x + (width - targetWidth) / 2, y + (height - targetHeight) / 2, targetWidth, targetHeight, false)
}

function drawGraphicCover(
  context: CanvasRenderingContext2D,
  graphic: NitroGraphic | undefined,
  targetWidth: number,
  targetHeight: number,
  smoothing = false,
  offsetX = 0,
  offsetY = 0,
  zoom = 1,
): void {
  if (!graphic) return
  const sourceWidth = Math.min(dsScreenWidth, graphic.width)
  const sourceHeight = Math.min(dsScreenHeight, graphic.height)
  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight) * zoom
  const cropWidth = targetWidth / scale
  const cropHeight = targetHeight / scale
  const sourceX = (sourceWidth - cropWidth) * (0.5 + Math.max(-1, Math.min(1, offsetX)) * 0.5)
  const sourceY = (sourceHeight - cropHeight) * (0.5 + Math.max(-1, Math.min(1, offsetY)) * 0.5)
  drawGraphicRegion(
    context,
    graphic,
    sourceX,
    sourceY,
    cropWidth,
    cropHeight,
    0,
    0,
    targetWidth,
    targetHeight,
    smoothing,
  )
}

function drawGraphicAdaptiveContain(
  context: CanvasRenderingContext2D,
  graphic: NitroGraphic | undefined,
  targetWidth: number,
  targetHeight: number,
  smoothing = false,
): void {
  if (!graphic) return
  // One authored ROM background, stretched to the single-screen viewport.
  // The previous contain + dimmed-cover composition rendered the same image
  // twice and made old DS backgrounds look blurred and badly tiled.
  context.save()
  context.imageSmoothingEnabled = smoothing
  context.drawImage(canvasAssets.getGraphicCanvas(graphic), 0, 0, graphic.width, graphic.height, 0, 0, targetWidth, targetHeight)
  context.restore()
}

type OpeningMovieSprite = NonNullable<RomInventory['openingMovieSprites']>[number]

function getCellSequenceDurationMs(sprite: OpeningMovieSprite | undefined, sequenceIndex: number): number {
  const sequence = sprite?.animation.sequences[sequenceIndex]
  if (!sequence) return 0
  return hgssVBlanksToMilliseconds(sequence.frames.reduce((sum, frame) => sum + Math.max(1, frame.durationFrames), 0))
}

export function getOakMarillTiming(inventory: RomInventory): { materializeAtMs: number, cryAtMs: number, textAtMs: number } {
  const materializeAtMs = hgssVBlanksToMilliseconds(34)
  const appearanceDurationMs = getCellSequenceDurationMs(inventory.introMarillSprite, 1)
  const cryAtMs = materializeAtMs + appearanceDurationMs + hgssVBlanksToMilliseconds(16)
  return { materializeAtMs, cryAtMs, textAtMs: cryAtMs + hgssVBlanksToMilliseconds(40) }
}

const oakReturnFadeMs = hgssVBlanksToMilliseconds(16)
const oakReturnWaitMs = hgssVBlanksToMilliseconds(30)
const oakReturnSlideMs = hgssVBlanksToMilliseconds(26)
const oakReturnTextAtMs = oakReturnFadeMs + oakReturnWaitMs + oakReturnSlideMs
const oakShiftTextAtMs = hgssVBlanksToMilliseconds(26)

function getLogicalCanvasSize(context: CanvasRenderingContext2D): { width: number, height: number } {
  const transform = context.getTransform()
  return {
    width: context.canvas.width / Math.max(.001, Math.abs(transform.a)),
    height: context.canvas.height / Math.max(.001, Math.abs(transform.d)),
  }
}

function sampleOpeningMovieSprite(sprite: OpeningMovieSprite, elapsedMs: number, sequenceIndex = 0): { graphic: NitroGraphic, x: number, y: number } | undefined {
  const sequence = sprite.animation.sequences[sequenceIndex]
  if (!sequence?.frames.length) return undefined
  const durations = sequence.frames.map((frame) => Math.max(1, frame.durationFrames))
  const totalFrames = durations.reduce((sum, duration) => sum + duration, 0)
  const loopStart = durations.slice(0, sequence.loopStartFrame).reduce((sum, duration) => sum + duration, 0)
  const elapsedFrames = Math.floor(hgssMillisecondsToVBlanks(elapsedMs))
  const loops = sequence.playbackMode === 2 || sequence.playbackMode === 4
  let cursor = loops && elapsedFrames >= loopStart
    ? loopStart + (elapsedFrames - loopStart) % Math.max(1, totalFrames - loopStart)
    : Math.min(totalFrames - 1, elapsedFrames)
  const frames = sequence.playbackMode === 3 || sequence.playbackMode === 4
    ? [...sequence.frames].reverse()
    : sequence.frames
  for (const frame of frames) {
    const duration = Math.max(1, frame.durationFrames)
    if (cursor < duration) {
      const graphic = sprite.frames[frame.cellIndex]
      return graphic ? { graphic, x: frame.positionX, y: frame.positionY } : undefined
    }
    cursor -= duration
  }
  return undefined
}

function drawOpeningMovieSprite(
  context: CanvasRenderingContext2D,
  sprite: OpeningMovieSprite | undefined,
  elapsedMs: number,
  centerX: number,
  centerY: number,
  scale = 1,
  alpha = 1,
  sequenceIndex = 0,
  rotation = 0,
): void {
  if (!sprite) return
  const sample = sampleOpeningMovieSprite(sprite, elapsedMs, sequenceIndex)
  if (!sample) return
  const viewport = getLogicalCanvasSize(context)
  const viewportScale = Math.min(viewport.width / dsScreenWidth, viewport.height / dsScreenHeight)
  const width = sample.graphic.width * viewportScale * scale
  const height = sample.graphic.height * viewportScale * scale
  context.save()
  context.globalAlpha = alpha
  context.imageSmoothingEnabled = false
  context.translate(centerX + sample.x * viewportScale, centerY + sample.y * viewportScale)
  context.rotate(rotation)
  context.drawImage(
    canvasAssets.getGraphicCanvas(sample.graphic),
    -width / 2,
    -height / 2,
    width,
    height,
  )
  context.restore()
}

function drawStarterParticles(
  context: CanvasRenderingContext2D,
  kind: 'grass' | 'fire' | 'water',
  progress: number,
): void {
  const colors = kind === 'grass' ? ['#eaffac', '#78cf52', '#287c3d']
    : kind === 'fire' ? ['#fff1a1', '#ffad32', '#e44d24']
      : ['#ecffff', '#64d9f4', '#297bd1']
  const viewport = getLogicalCanvasSize(context)
  const cx = viewport.width * .5
  const cy = viewport.height * .57
  context.save()
  context.imageSmoothingEnabled = false
  for (let index = 0; index < 22; index += 1) {
    const angle = index * 2.399 + progress * (kind === 'fire' ? -3 : 2)
    const distance = (24 + index * 7) * Math.min(1, progress * 2.2)
    const drift = kind === 'fire' ? -progress * 72 : kind === 'water' ? Math.sin(angle * 2) * 18 : progress * 20
    const x = cx + Math.cos(angle) * distance
    const y = cy + Math.sin(angle) * distance * .62 + drift
    const size = 3 + index % 3
    context.globalAlpha = Math.max(0, Math.min(1, 1.35 - progress - index / 80))
    context.fillStyle = colors[index % colors.length]
    context.fillRect(Math.round(x), Math.round(y), size, size)
  }
  context.restore()
}

function drawOpeningModel(
  context: CanvasRenderingContext2D,
  model: NitroModelPreview | undefined,
  frames: NitroModelPreview[] | undefined,
  animationFrameCount: number | undefined,
  elapsedMs: number,
): boolean {
  const viewport = getLogicalCanvasSize(context)
  const frameCount = Math.max(1, animationFrameCount ?? frames?.length ?? 1)
  const frameFloat = hgssMillisecondsToVBlanks(elapsedMs) % frameCount
  const animation: TitleAnimationState = {
    frame: Math.floor(frameFloat), frameFloat, frameCount,
    sparkleAlpha: 0, promptAlpha: 0,
    modelOffsetY: 0, modelOffsetZ: 0, modelRoll: 0, modelYaw: 0, modelScale: 1,
    atmosphereOffsetY: 0, atmosphereOffsetZ: 0, atmosphereTextureOffset: 0,
  }
  const modelCanvas = titleModelRenderer.render(model, undefined, animation, frames, viewport.width / Math.max(1, viewport.height))
  if (!modelCanvas) return false
  const scale = 1.08
  const width = viewport.width * scale
  const height = viewport.height * scale
  context.save()
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.translate((viewport.width - width) / 2, (viewport.height - height) / 2)
  context.drawImage(modelCanvas, 0, 0, width, height)
  context.restore()
  return true
}

function drawOpeningTransition(context: CanvasRenderingContext2D, cinematic: OpeningCinematicState): void {
  const viewport = getLogicalCanvasSize(context)
  if (cinematic.transition === 'fade-black') {
    context.fillStyle = `rgba(0, 0, 0, ${1 - cinematic.transitionProgress})`
    context.fillRect(0, 0, viewport.width, viewport.height)
  } else if (cinematic.transition === 'fade-white') {
    context.fillStyle = `rgba(255, 255, 255, ${cinematic.flashAlpha})`
    context.fillRect(0, 0, viewport.width, viewport.height)
  } else if (cinematic.transition === 'wipe') {
    const closedWidth = viewport.width * (1 - cinematic.transitionProgress) / 2
    context.fillStyle = '#000'
    context.fillRect(0, 0, closedWidth, viewport.height)
    context.fillRect(viewport.width - closedWidth, 0, closedWidth, viewport.height)
  } else if (cinematic.transition === 'iris' || cinematic.transition === 'iris-white') {
    const radius = Math.hypot(viewport.width, viewport.height) * cinematic.transitionProgress * .62
    context.save()
    context.beginPath()
    context.rect(0, 0, viewport.width, viewport.height)
    context.arc(viewport.width / 2, viewport.height / 2, radius, 0, Math.PI * 2)
    context.fillStyle = cinematic.transition === 'iris-white' ? '#fff' : '#000'
    context.fill('evenodd')
    context.restore()
  }
}

function drawStoryPanel(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number): void {
  context.save()
  const px = Math.max(2, Math.round(Math.min(width, height) / 44))
  context.fillStyle = 'rgba(12, 29, 37, .42)'
  context.fillRect(x + px * 2, y + px * 2, width, height)
  context.fillStyle = '#263944'
  context.fillRect(x, y, width, height)
  context.fillStyle = '#f7f8ee'
  context.fillRect(x + px, y + px, width - px * 2, height - px * 2)
  context.fillStyle = '#68b9c4'
  context.fillRect(x + px * 2, y + px * 2, width - px * 4, height - px * 4)
  context.fillStyle = '#fffdf0'
  context.fillRect(x + px * 3, y + px * 3, width - px * 6, height - px * 6)
  context.fillStyle = '#e7b73c'
  context.fillRect(x + px * 5, y + px * 2, Math.min(58, width * .18), px)
  context.restore()
}

function drawStoryBackdrop(context: CanvasRenderingContext2D, graphic: NitroGraphic | undefined): void {
  context.fillStyle = '#000'
  context.fillRect(0, 0, context.canvas.width, context.canvas.height)
  drawGraphicAdaptiveContain(context, graphic, context.canvas.width, context.canvas.height)
}

function drawDialogText(context: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, maxLines: number): void {
  context.save()
  context.fillStyle = '#17262e'
  context.font = '700 17px "Courier New", ui-monospace, monospace'
  context.textAlign = 'left'
  context.textBaseline = 'top'
  wrapDialogText(context, text, width).slice(0, maxLines).forEach((line, index) => {
    context.fillText(line, x, y + index * 24)
  })
  context.restore()
}

function drawUiLabel(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  options: { font?: string, color?: string } = {},
): void {
  context.save()
  context.fillStyle = options.color ?? '#202020'
  context.font = options.font ?? '700 16px "Courier New", ui-monospace, monospace'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(text, x + width / 2, y + height / 2)
  context.restore()
}

function drawDialogChoices(context: CanvasRenderingContext2D, intro: IntroRenderState, choiceRect: LayoutRect): void {
  if (!intro.choices?.length) return
  for (let index = 0; index < Math.min(2, intro.choices.length); index += 1) {
    const x = choiceRect.x + index * (choiceRect.width + confirmationChoiceGap)
    const y = choiceRect.y
    const { width, height } = choiceRect
    const selected = intro.selectedChoice === index
    context.save()
    context.fillStyle = '#263944'
    context.fillRect(x, y, width, height)
    context.fillStyle = selected ? '#e7b73c' : '#68b9c4'
    context.fillRect(x + 3, y + 3, width - 6, height - 6)
    context.fillStyle = selected ? '#fff0a5' : '#fffdf0'
    context.fillRect(x + 6, y + 6, width - 12, height - 12)
    drawUiLabel(context, intro.choices[index], x, y, width, height, { font: '700 13px "Courier New", ui-monospace, monospace' })
    context.restore()
  }
}

function drawStoryDialogBox(context: CanvasRenderingContext2D, intro: IntroRenderState, motion = 1, now = 0): void {
  const hasChoices = intro.mode === 'gender-confirm' || intro.mode === 'name-confirm'
  const layout = getResponsiveIntroLayout(getAdaptiveViewport(context.canvas.width, context.canvas.height), hasChoices)
  const offsetY = (1 - motion) * 28
  context.save()
  context.globalAlpha = motion
  context.translate(0, offsetY)
  drawStoryPanel(context, layout.dialog.x, layout.dialog.y, layout.dialog.width, layout.dialog.height)
  if (intro.speakerName) {
    const tagWidth = Math.min(190, Math.max(108, intro.speakerName.length * 10 + 30))
    const tagHeight = 30
    drawStoryPanel(context, layout.dialog.x + 12, layout.dialog.y - tagHeight - 7, tagWidth, tagHeight)
    drawUiLabel(context, intro.speakerName, layout.dialog.x + 12, layout.dialog.y - tagHeight - 7, tagWidth, tagHeight, {
      font: '900 13px "Courier New", ui-monospace, monospace',
      color: '#17262e',
    })
  }
  drawDialogText(context, intro.text, layout.dialogText.x, layout.dialogText.y, layout.dialogText.width, 2)
  if (hasChoices) drawDialogChoices(context, intro, layout.confirmationChoices)
  if (!hasChoices && intro.text) {
    const pulse = 0.55 + Math.sin(now / 240) * 0.35
    context.globalAlpha = pulse
    context.fillStyle = '#c85a31'
    context.beginPath()
    context.moveTo(layout.dialog.x + layout.dialog.width - 27, layout.dialog.y + layout.dialog.height - 26)
    context.lineTo(layout.dialog.x + layout.dialog.width - 15, layout.dialog.y + layout.dialog.height - 26)
    context.lineTo(layout.dialog.x + layout.dialog.width - 21, layout.dialog.y + layout.dialog.height - 17)
    context.closePath()
    context.fill()
  }
  context.restore()
}

function drawFullscreenTutorialText(context: CanvasRenderingContext2D, intro: IntroRenderState, motion = 1, now = 0): void {
  const width = Math.min(430, context.canvas.width - 72)
  context.save()
  context.font = '700 17px "Courier New", ui-monospace, monospace'
  const lines = wrapDialogText(context, intro.text, width)
  const lineHeight = 27
  const startY = (context.canvas.height - lines.length * lineHeight) / 2
  context.globalAlpha = motion
  context.fillStyle = '#fff'
  context.textAlign = 'center'
  context.textBaseline = 'top'
  context.shadowColor = 'rgba(0, 0, 0, .72)'
  context.shadowBlur = 0
  context.shadowOffsetX = 2
  context.shadowOffsetY = 2
  lines.forEach((line, index) => context.fillText(line, context.canvas.width / 2, startY + index * lineHeight))
  if (intro.text) {
    context.globalAlpha = .5 + Math.sin(now / 240) * .3
    context.fillStyle = '#fff'
    context.beginPath()
    context.moveTo(context.canvas.width / 2 - 6, startY + lines.length * lineHeight + 18)
    context.lineTo(context.canvas.width / 2 + 6, startY + lines.length * lineHeight + 18)
    context.lineTo(context.canvas.width / 2, startY + lines.length * lineHeight + 27)
    context.fill()
  }
  context.restore()
}

function drawTutorialChoiceMenu(context: CanvasRenderingContext2D, intro: IntroRenderState, motion = 1): void {
  if (!intro.choices?.length) return
  const layout = getResponsiveIntroLayout(getAdaptiveViewport(context.canvas.width, context.canvas.height))
  intro.choices.forEach((choice, index) => {
    const x = layout.tutorialChoices.x
    const y = layout.tutorialChoices.y + index * 54
    const { width, height } = layout.tutorialChoices
    const selected = intro.selectedChoice === index
    context.save()
    context.globalAlpha = Math.max(0, Math.min(1, motion * 1.5 - index * 0.16))
    context.translate((1 - motion) * (index % 2 === 0 ? -34 : 34), 0)
    context.fillStyle = '#263944'
    context.fillRect(x, y, width, height)
    context.fillStyle = selected ? '#e7b73c' : '#68b9c4'
    context.fillRect(x + 3, y + 3, width - 6, height - 6)
    context.fillStyle = selected ? '#fff0a5' : '#fffdf0'
    context.fillRect(x + 6, y + 6, width - 12, height - 12)
    if (selected) {
      context.fillStyle = '#c85a31'
      context.beginPath()
      context.moveTo(x + 15, y + height / 2 - 6)
      context.lineTo(x + 25, y + height / 2)
      context.lineTo(x + 15, y + height / 2 + 6)
      context.fill()
    }
    drawUiLabel(context, choice, x + 12, y, width - 12, height, { font: '700 16px "Courier New", ui-monospace, monospace' })
    context.restore()
  })
}

function drawGenderCard(
  context: CanvasRenderingContext2D,
  graphic: NitroGraphic | undefined,
  gender: 'male' | 'female',
  selected: boolean,
  rect: LayoutRect,
): void {
  context.save()
  context.fillStyle = gender === 'male' ? '#e7f6ff' : '#fff0f2'
  context.fillRect(rect.x, rect.y, rect.width, rect.height)
  drawGraphicSubjectContainAt(context, graphic, rect.x + 12, rect.y + 8, rect.width - 24, rect.height - 16)
  context.strokeStyle = selected ? '#e5ae2f' : '#5b8ca0'
  context.lineWidth = selected ? 5 : 2
  context.strokeRect(rect.x, rect.y, rect.width, rect.height)
  context.restore()
}

function drawGenderSelect(context: CanvasRenderingContext2D, inventory: RomInventory, intro: IntroRenderState, motion = 1, now = 0): void {
  const layout = getResponsiveIntroLayout(getAdaptiveViewport(context.canvas.width, context.canvas.height))
  drawStoryBackdrop(context, inventory.introGenderBackgroundGraphic ?? inventory.introGraphicPreview)
  context.save()
  context.globalAlpha = motion
  context.translate(-(1 - motion) * context.canvas.width * .38, 0)
  drawGenderCard(context, inventory.introBoyGraphic ?? inventory.introGraphicPreview, 'male', intro.selectedGender !== 'female', layout.genderMale)
  context.restore()
  context.save()
  context.globalAlpha = motion
  context.translate((1 - motion) * context.canvas.width * .38, 0)
  drawGenderCard(context, inventory.introGirlGraphic ?? inventory.introGraphicPreview, 'female', intro.selectedGender === 'female', layout.genderFemale)
  context.restore()
  drawStoryDialogBox(context, intro, motion, now)
}

function drawOakIntroScene(context: CanvasRenderingContext2D, inventory: RomInventory, intro: IntroRenderState, motion: number, now: number, sceneAge: number): void {
  const background = intro.scene === 'tutorial'
    ? inventory.introTutorialBackgroundGraphics?.[intro.tutorialLayout ?? 1]
      ?? inventory.introTopBackgroundGraphic
      ?? inventory.introGraphicPreview
    : inventory.introTopBackgroundGraphic ?? inventory.introOakGraphicPreview ?? inventory.introGraphicPreview
  drawStoryBackdrop(context, background)
  if (intro.scene === 'text' || intro.scene === 'tutorial') return
  context.save()
  const oakPersists = intro.scene === 'oak-shifted' || intro.scene === 'oak-marill' || intro.scene === 'oak-returning'
  context.globalAlpha = oakPersists ? 1 : motion
  const drift = Math.sin(now / 1_350) * 2
  const oakReturnProgress = Math.max(0, Math.min(1, (sceneAge - oakReturnFadeMs - oakReturnWaitMs) / oakReturnSlideMs))
  const oakOffset = intro.scene === 'oak-marill'
    ? context.canvas.width * .2
    : intro.scene === 'oak-shifted'
      ? context.canvas.width * .2 * motion
    : intro.scene === 'oak-returning'
      ? context.canvas.width * .2 * (1 - oakReturnProgress)
      : 0
  const entranceOffset = oakPersists ? 0 : (1 - motion) * 42
  const oakWidth = Math.min(235, context.canvas.width * .38)
  const oakHeight = Math.min(300, context.canvas.height * .75)
  context.translate(oakOffset + entranceOffset, (oakPersists ? 0 : (1 - motion) * 16) + drift)
  drawGraphicSubjectContainAt(context, inventory.introOakSpriteGraphic,
    (context.canvas.width - oakWidth) / 2, Math.max(6, context.canvas.height * .03), oakWidth, oakHeight)
  context.restore()
  if (intro.scene === 'oak-marill') {
    const marillSize = Math.min(150, context.canvas.width * .27)
    const timing = getOakMarillTiming(inventory)
    const revealRaw = Math.max(0, Math.min(1, (sceneAge - timing.materializeAtMs) / Math.max(1, timing.cryAtMs - timing.materializeAtMs)))
    const reveal = revealRaw * revealRaw * (3 - 2 * revealRaw)
    if (inventory.introMarillSprite && sceneAge < timing.cryAtMs) {
      const sequence = sceneAge < timing.materializeAtMs ? 3 : sceneAge < timing.cryAtMs ? 1 : 2
      const sequenceElapsedMs = sequence === 3 ? sceneAge : sequence === 1 ? sceneAge - timing.materializeAtMs : sceneAge - timing.cryAtMs
      drawOpeningMovieSprite(
        context,
        inventory.introMarillSprite,
        sequenceElapsedMs,
        context.canvas.width * .4,
        context.canvas.height * .43,
        1.2,
        sequence === 3 ? 1 : Math.max(.15, reveal),
        sequence,
        sequence === 1 ? (-.13 + reveal * .13) : sequence === 2 ? Math.sin(sequenceElapsedMs / 115) * .035 : 0,
      )
    } else {
      context.save()
      context.globalAlpha = reveal
      drawGraphicContainAt(context, inventory.introMarillGraphic,
        context.canvas.width * .2 + marillSize * (1 - reveal) / 2,
        context.canvas.height * .29 + marillSize * (1 - reveal) / 2,
        marillSize * reveal, marillSize * reveal, false)
      context.restore()
    }
  } else if (intro.scene === 'oak-returning' && inventory.introMarillSprite && sceneAge < oakReturnFadeMs) {
    drawOpeningMovieSprite(
      context,
      inventory.introMarillSprite,
      sceneAge,
      context.canvas.width * .4,
      context.canvas.height * .43,
      1.2,
      1 - sceneAge / oakReturnFadeMs,
      2,
    )
  }
  const shade = context.createLinearGradient(0, 0, 0, context.canvas.height)
  shade.addColorStop(0, 'rgba(4, 24, 54, .06)')
  shade.addColorStop(.7, 'rgba(4, 24, 54, 0)')
  shade.addColorStop(1, 'rgba(4, 24, 54, .32)')
  context.fillStyle = shade
  context.fillRect(0, 0, context.canvas.width, context.canvas.height)
}

function drawProfileIntroScene(context: CanvasRenderingContext2D, inventory: RomInventory, intro: IntroRenderState, motion: number, now: number): void {
  drawStoryBackdrop(context, inventory.introGenderBackgroundGraphic ?? inventory.introGraphicPreview)
  const graphic = intro.selectedGender === 'female' ? inventory.introGirlGraphic : inventory.introBoyGraphic
  const width = Math.min(210, context.canvas.width * .38)
  const height = Math.min(260, context.canvas.height * .67)
  const x = (context.canvas.width - width) / 2
  const y = Math.max(14, context.canvas.height - height - 82)
  context.save()
  context.globalAlpha = motion
  context.translate(x + width / 2, y + height / 2)
  context.scale(.84 + motion * .16, .84 + motion * .16)
  context.translate(-(x + width / 2), -(y + height / 2) + Math.sin(now / 1_250) * 1.5)
  drawGraphicSubjectContainAt(context, graphic, x, y, width, height)
  context.restore()
}

function drawIntroTransitionOverlay(
  context: CanvasRenderingContext2D,
  intro: IntroRenderState,
  motion: number,
  sceneAge: number,
): void {
  const inverse = 1 - motion
  const oakPersists = intro.scene === 'oak-shifted' || intro.scene === 'oak-marill' || intro.scene === 'oak-returning'
  if (oakPersists) {
    // Oak remains on the same native BG layer through these three states.
  } else if (intro.showGenderSelect) {
    const curtain = context.canvas.width * inverse / 2
    context.fillStyle = '#193b57'
    context.fillRect(0, 0, curtain, context.canvas.height)
    context.fillRect(context.canvas.width - curtain, 0, curtain, context.canvas.height)
  } else if (intro.mode === 'tutorial-choice' || intro.mode === 'name-input') {
    const shutter = context.canvas.height * inverse / 2
    context.fillStyle = '#000'
    context.fillRect(0, 0, context.canvas.width, shutter)
    context.fillRect(0, context.canvas.height - shutter, context.canvas.width, shutter)
  } else {
    context.fillStyle = `rgba(0, 0, 0, ${inverse * .72})`
    context.fillRect(0, 0, context.canvas.width, context.canvas.height)
  }
  const marillFlashStartMs = hgssVBlanksToMilliseconds(30)
  const marillFlashEndMs = hgssVBlanksToMilliseconds(34)
  if (intro.scene === 'oak-marill' && sceneAge >= marillFlashStartMs && sceneAge < marillFlashEndMs) {
    const flash = Math.sin(Math.max(0, Math.min(1, (sceneAge - marillFlashStartMs) / (marillFlashEndMs - marillFlashStartMs))) * Math.PI)
    context.fillStyle = `rgba(255, 255, 238, ${flash * .72})`
    context.fillRect(0, 0, context.canvas.width, context.canvas.height)
  }
}

function drawNameInput(context: CanvasRenderingContext2D, inventory: RomInventory, intro: IntroRenderState): void {
  if (!intro.nameInput) return
  const nameInput = intro.nameInput
  const layout = getResponsiveIntroLayout(getAdaptiveViewport(context.canvas.width, context.canvas.height))
  drawStoryBackdrop(context, inventory.nameInputGraphicPreview ?? inventory.introOakGraphicPreview ?? inventory.introGraphicPreview)
  context.fillStyle = 'rgba(5, 25, 47, .34)'
  context.fillRect(0, 0, context.canvas.width, context.canvas.height)
  drawStoryPanel(context, layout.namePanel.x, layout.namePanel.y, layout.namePanel.width, layout.namePanel.height)
  drawDialogText(context, intro.text, layout.namePanel.x + 22, layout.namePanel.y + 22, layout.namePanel.width - 44, 2)

  context.save()
  context.fillStyle = '#263944'
  context.fillRect(layout.nameEntry.x, layout.nameEntry.y, layout.nameEntry.width, layout.nameEntry.height)
  context.fillStyle = '#68b9c4'
  context.fillRect(layout.nameEntry.x + 3, layout.nameEntry.y + 3, layout.nameEntry.width - 6, layout.nameEntry.height - 6)
  context.fillStyle = '#fffdf0'
  context.fillRect(layout.nameEntry.x + 6, layout.nameEntry.y + 6, layout.nameEntry.width - 12, layout.nameEntry.height - 12)
  context.fillStyle = '#14243a'
  context.font = '800 22px "Courier New", ui-monospace, monospace'
  context.textAlign = 'left'
  context.textBaseline = 'middle'
  context.fillText(nameInput.value || '_', layout.nameEntry.x + 20, layout.nameEntry.y + layout.nameEntry.height / 2)
  context.fillStyle = '#497283'
  context.font = '700 12px "Courier New", ui-monospace, monospace'
  context.textAlign = 'right'
  context.fillText(`${nameInput.value.length}/${nameInput.maxLength}`, layout.namePanel.x + layout.namePanel.width - 36, layout.nameEntry.y + layout.nameEntry.height / 2)
  context.restore()
}

function findTitleSparkleTexture(inventory: RomInventory): NitroTexturePreview | undefined {
  return inventory.titleSparklesModel?.textures?.find((texture) => texture.name.startsWith('hou_kira'))
}

function drawTitleModelLayer(
  context: CanvasRenderingContext2D,
  inventory: RomInventory,
  animation: TitleAnimationState,
  targetX = 0,
  targetY = 174,
  targetWidth = storyNativeWidth,
  targetHeight = 210,
): void {
  const modelCanvas = titleModelRenderer.render(
    inventory.titleLegendModel,
    inventory.titleSparklesModel,
    animation,
    inventory.titleLegendModelFrames,
    targetWidth / Math.max(1, targetHeight),
  )
  if (!modelCanvas) return
  context.save()
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.translate(targetX + targetWidth, 0)
  context.scale(-1, 1)
  context.drawImage(modelCanvas, 0, targetY, targetWidth, targetHeight)
  context.restore()
}

function drawTitleSparkleLayer(
  context: CanvasRenderingContext2D,
  inventory: RomInventory,
  animation: TitleAnimationState,
  x: number,
  y: number,
): void {
  const sparkle = animation.sparkleTexture ?? findTitleSparkleTexture(inventory)
  if (!sparkle) return
  context.save()
  context.imageSmoothingEnabled = false
  context.globalAlpha = animation.sparkleAlpha
  context.drawImage(canvasAssets.getTextureCanvas(sparkle), x, y, sparkle.width * 2, sparkle.height * 2)
  context.restore()
}

function drawTitleOverlayGraphic(
  context: CanvasRenderingContext2D,
  graphic: NitroGraphic | undefined,
  viewportWidth: number,
  viewportHeight: number,
  scale = 1,
): void {
  if (!graphic) return
  const width = Math.min(storyNativeWidth * scale, viewportWidth - 32)
  const height = width * dsScreenHeight / dsScreenWidth
  const y = Math.max(0, Math.min(24, (viewportHeight - height) / 2))
  drawGraphicRegion(
    context,
    graphic,
    0,
    0,
    Math.min(dsScreenWidth, graphic.width),
    Math.min(dsScreenHeight, graphic.height),
    (viewportWidth - width) / 2,
    y,
    width,
    height,
    true,
  )
}

function drawTitlePrompt(
  context: CanvasRenderingContext2D,
  inventory: RomInventory,
  animation: TitleAnimationState,
  centerX = storyNativeWidth / 2,
  y = 350,
): void {
  const romMessage = inventory.titleTouchMessage ?? ''
  const message = romMessage.replace(/TOUCHEZ/i, 'APPUYEZ').replace(/L ECRAN TACTILE/i, 'UNE TOUCHE')
  context.save()
  context.globalAlpha = animation.promptAlpha
  context.font = '600 16px "Segoe UI", sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.lineJoin = 'round'
  context.lineWidth = 4
  context.strokeStyle = 'rgba(74, 23, 8, 0.9)'
  context.strokeText(message, centerX, y)
  context.fillStyle = '#fff4d6'
  context.shadowColor = 'rgba(0, 0, 0, 0.35)'
  context.shadowBlur = 3
  context.shadowOffsetY = 2
  context.fillText(message, centerX, y)
  context.restore()
}

export function createGameScreenRuntime(screenCanvas: HTMLCanvasElement, runtimePanel: HTMLElement): GameScreenRuntime {
  const screenContext = screenCanvas.getContext('2d')
  const storyCanvas = document.createElement('canvas')
  storyCanvas.width = storyNativeWidth
  storyCanvas.height = storyNativeHeight
  const storyContext = storyCanvas.getContext('2d')
  const openingParticleCanvas = document.createElement('canvas')
  const openingParticlePlayback = new HgssSplParticleCanvasPlayback(openingParticleCanvas)
  let openingParticleShot: number | undefined
  let lastRenderKey: string | undefined
  let titleStartedAt: number | undefined
  let introTextAnimation: { key: string, startedAt: number, completed: boolean } | undefined
  let introSceneAnimation: { key: string, startedAt: number } | undefined
  let storyViewport = getAdaptiveViewport(storyNativeWidth, storyNativeHeight)

  function getAnimatedIntroText(intro: IntroRenderState, now: number): string {
    const animated = intro.mode === 'dialog' || intro.mode === 'gender-select' || intro.mode === 'gender-confirm' || intro.mode === 'name-confirm'
    if (!animated || !intro.text) {
      introTextAnimation = undefined
      return intro.text
    }
    const key = `${intro.mode}:${intro.text}`
    if (!introTextAnimation || introTextAnimation.key !== key) introTextAnimation = { key, startedAt: now, completed: false }
    if (introTextAnimation.completed) return intro.text
    const visibleText = getRevealedDialogText(intro.text, now - introTextAnimation.startedAt)
    if (visibleText === intro.text) introTextAnimation.completed = true
    return visibleText
  }

  function completeIntroTextAnimation(): boolean {
    if (!introTextAnimation || introTextAnimation.completed) return false
    introTextAnimation.completed = true
    lastRenderKey = undefined
    return true
  }

  function canAdvanceIntro(inventory: RomInventory, intro: IntroRenderState): boolean {
    if (intro.scene !== 'oak-shifted' && intro.scene !== 'oak-marill' && intro.scene !== 'oak-returning') return true
    if (!introSceneAnimation) return false
    const requiredAge = intro.scene === 'oak-marill'
      ? getOakMarillTiming(inventory).textAtMs
      : intro.scene === 'oak-returning' ? oakReturnTextAtMs : oakShiftTextAtMs
    return performance.now() - introSceneAnimation.startedAt >= requiredAge
  }

  function resizeScreenCanvas(): boolean {
    const ratio = resolveGameRenderPixelRatio(screenCanvas.clientWidth, screenCanvas.clientHeight, window.devicePixelRatio || 1)
    const width = Math.max(1, Math.round(screenCanvas.clientWidth * ratio))
    const height = Math.max(1, Math.round(screenCanvas.clientHeight * ratio))
    if (screenCanvas.width === width && screenCanvas.height === height) return false
    screenCanvas.width = width
    screenCanvas.height = height
    storyViewport = getAdaptiveViewport(width, height)
    storyCanvas.width = storyViewport.width
    storyCanvas.height = storyViewport.height
    return true
  }

  function setMode(mode: 'story' | 'map'): void {
    runtimePanel.classList.toggle('runtime-panel-story', mode === 'story')
    runtimePanel.classList.toggle('runtime-panel-map', mode === 'map')
    lastRenderKey = undefined
    if (mode === 'map') titleStartedAt = undefined
  }

  function showCanvas(visible: boolean): void {
    screenCanvas.hidden = !visible
    lastRenderKey = undefined
  }

  function drawOpening(inventory: RomInventory, elapsedMs: number, force = false): void {
    if (!screenContext || !storyContext || screenCanvas.hidden) return
    screenCanvas.style.imageRendering = 'auto'
    const resized = resizeScreenCanvas()
    const cinematic = createOpeningCinematicState(elapsedMs)
    const frame = Math.floor(hgssMillisecondsToVBlanks(elapsedMs))
    const key = `opening:${cinematic.scene}:${frame}:${screenCanvas.width}x${screenCanvas.height}`
    if (!force && !resized && lastRenderKey === key) return
    lastRenderKey = key

    clearStoryFrame(titleRenderScale)
    const movieGraphics = inventory.openingMovieGraphics ?? []
    const scenes = inventory.openingMovieSceneGraphics ?? []
    const sprites = inventory.openingMovieSprites ?? []
    const models = inventory.openingMovieModels ?? []
    const modelFrames = inventory.openingMovieModelFrames ?? []
    const modelAnimations = inventory.openingMovieModelAnimations ?? []
    const starterParticles = inventory.openingStarterParticleResource
    const drawSceneGraphic = (graphic: NitroGraphic | undefined, panX = cinematic.cameraPanX, panY = cinematic.cameraPanY, zoom = cinematic.cameraZoom) => {
      drawGraphicCover(storyContext, graphic, storyViewport.width, storyViewport.height, false, panX, panY, zoom)
    }
    const drawLayer = (graphic: NitroGraphic | undefined, panX = 0, panY = 0, zoom = 1, alpha = 1) => {
      if (!graphic) return
      storyContext.save()
      storyContext.globalAlpha = alpha
      drawSceneGraphic(graphic, panX, panY, zoom)
      storyContext.restore()
    }
    const clipHalf = (side: 'left' | 'right', draw: () => void) => {
      storyContext.save()
      storyContext.beginPath()
      storyContext.rect(side === 'left' ? 0 : storyViewport.width / 2, 0, storyViewport.width / 2, storyViewport.height)
      storyContext.clip()
      draw()
      storyContext.restore()
    }

    if (cinematic.scene === 'copyright-sunrise') {
      const scene = scenes[0] ?? []
      if (cinematic.shot === 0) drawSceneGraphic(scene[0] ?? movieGraphics[0], 0, 0, 1)
      else if (cinematic.shot === 1) {
        storyContext.fillStyle = '#000'
        storyContext.fillRect(0, 0, storyViewport.width, storyViewport.height)
      } else if (cinematic.shot === 2) drawSceneGraphic(scene[1] ?? movieGraphics[1], 0, 0, 1)
      else {
        const sunriseProgress = cinematic.shot === 3 ? cinematic.shotProgress * .74 : .74 + cinematic.shotProgress * .26
        const sunriseElapsedMs = cinematic.shot === 3
          ? cinematic.shotElapsedMs
          : hgssVBlanksToMilliseconds(370) + cinematic.shotElapsedMs
        drawLayer(scene[4] ?? movieGraphics[2], 0, .22 - sunriseProgress * .42, 1.02)
        drawLayer(scene[5], 0, .08 - sunriseProgress * .16, 1.02)
        drawLayer(scene[6], 0, 0, 1.02)
        drawOpeningMovieSprite(storyContext, sprites[0], sunriseElapsedMs, storyViewport.width * .5, storyViewport.height * (.66 - sunriseProgress * .28), 1.1, .95, 0)
        if (cinematic.shot === 4) {
          drawOpeningMovieSprite(
            storyContext, sprites[0], cinematic.shotElapsedMs,
            storyViewport.width * (1.08 - cinematic.shotProgress * 1.2),
            storyViewport.height * (.26 + Math.sin(cinematic.shotProgress * Math.PI) * .08),
            .85, 1, 1,
          )
        }
      }
    } else if (cinematic.scene === 'players') {
      const scene = scenes[1] ?? []
      drawLayer(scene[0] ?? movieGraphics[3], cinematic.cameraPanX, cinematic.cameraPanY, 1.03)
      drawLayer(scene[2], cinematic.cameraPanX * .55, cinematic.cameraPanY * .55, 1.03)
      drawLayer(scene[3], cinematic.cameraPanX * .2, cinematic.cameraPanY * .2, 1.03)
      if (cinematic.shot === 0) {
        const flowerAppearFrames = [1, 8, 16, 24, 28, 32, 34, 38, 42, 48]
        for (let index = 0; index < 10; index += 1) {
          const reveal = Math.max(0, Math.min(1, cinematic.shotProgress * 2.2 - index * .09))
          const flowerElapsedMs = cinematic.shotElapsedMs - hgssVBlanksToMilliseconds(flowerAppearFrames[index]!)
          if (flowerElapsedMs < 0) continue
          drawOpeningMovieSprite(
            storyContext, sprites[5], flowerElapsedMs,
            storyViewport.width * .5,
            storyViewport.height * (.88 - reveal * .08),
            .72, reveal, index % 4,
          )
        }
      } else {
        const isLyra = cinematic.shot === 3
        const baseSequence = isLyra ? 3 : 0
        const entrance = Math.min(1, cinematic.shotProgress * (cinematic.shot === 2 ? 5 : 2.2))
        const x = storyViewport.width * (isLyra ? 1.08 - entrance * .58 : -.08 + entrance * .58)
        for (let layer = 0; layer < 3; layer += 1) {
          drawOpeningMovieSprite(storyContext, sprites[4], cinematic.shotElapsedMs, x, storyViewport.height * .56, 1.08, 1, baseSequence + layer)
        }
      }
    } else if (cinematic.scene === 'johto-rival') {
      const scene = scenes[2] ?? []
      if (cinematic.shot <= 2) {
        const renderedModel = drawOpeningModel(
          storyContext,
          models[cinematic.shot],
          modelFrames[cinematic.shot],
          modelAnimations[cinematic.shot]?.frameCount,
          cinematic.shotElapsedMs,
        )
        if (!renderedModel) drawSceneGraphic(scene[0] ?? movieGraphics[4], 0, 0, 1.02)
      } else if (cinematic.shot === 3) {
        const shotFrame = hgssMillisecondsToVBlanks(cinematic.shotElapsedMs)
        const panelFrame = Math.max(0, shotFrame - 9)
        const panelIndex = panelFrame < 73 ? 0 : panelFrame < 92 ? 1 : 2
        const rivalGraphic = shotFrame >= 111 ? scene[5] : scene[panelIndex]
        drawLayer(rivalGraphic ?? movieGraphics[4], 0, 0, 1.02)
        drawOpeningMovieSprite(storyContext, sprites[2], cinematic.shotElapsedMs, storyViewport.width * .5, storyViewport.height * .55, 1.05)
      } else if (cinematic.shot <= 5) {
        drawLayer(scene[4], -.12 + cinematic.shotProgress * .12, 0, 1.02)
        drawLayer(scene[5], .12 - cinematic.shotProgress * .12, 0, 1.02)
        drawLayer(scene[6], 0, 0, 1.02)
        drawLayer(scene[7], 0, 0, 1.02)
        if (cinematic.shot === 5) {
          const shotFrame = hgssMillisecondsToVBlanks(cinematic.shotElapsedMs)
          if (shotFrame >= 56) {
            drawOpeningMovieSprite(storyContext, sprites[3], hgssVBlanksToMilliseconds(shotFrame - 56), storyViewport.width * .125, storyViewport.height * .58, .92, 1, 0)
          }
          if (shotFrame >= 145) {
            drawOpeningMovieSprite(storyContext, sprites[3], hgssVBlanksToMilliseconds(shotFrame - 145), storyViewport.width * .5, storyViewport.height * .42, .92, 1, 1)
          }
          if (shotFrame >= 155) {
            drawOpeningMovieSprite(storyContext, sprites[3], hgssVBlanksToMilliseconds(shotFrame - 155), storyViewport.width * .5, storyViewport.height * .62, .92, 1, 2)
          }
          if (shotFrame >= 175) {
            drawOpeningMovieSprite(storyContext, sprites[3], hgssVBlanksToMilliseconds(shotFrame - 175), storyViewport.width * .5, storyViewport.height * .52, .92, 1, 3)
          }
        }
      } else {
        drawLayer(scene[8], 0, -.12 + cinematic.shotProgress * .18, 1.02)
        drawLayer(scene[9], 0, -.06 + cinematic.shotProgress * .12, 1.02)
        drawLayer(scene[10], 0, 0, 1.02)
      }
    } else if (cinematic.scene === 'starters') {
      const scene = scenes[3] ?? []
      if (cinematic.shot === 0) {
        clipHalf('left', () => {
          drawLayer(scene[0] ?? movieGraphics[5], -.16 + cinematic.shotProgress * .16, 0, 1.04)
          drawLayer(scene[1], 0, 0, 1.04)
          drawLayer(scene[2], 0, 0, 1.04)
          drawOpeningMovieSprite(storyContext, sprites[6], cinematic.shotElapsedMs, storyViewport.width * .28, storyViewport.height * .58, .9, 1, 0)
        })
        clipHalf('right', () => {
          drawLayer(scene[3] ?? movieGraphics[5], .16 - cinematic.shotProgress * .16, 0, 1.04)
          drawLayer(scene[1], 0, 0, 1.04)
          drawLayer(scene[2], 0, 0, 1.04)
          drawOpeningMovieSprite(storyContext, sprites[6], cinematic.shotElapsedMs, storyViewport.width * .72, storyViewport.height * .58, .9, 1, 1)
        })
      } else if (cinematic.shot <= 3) {
        const starterSprites = [7, 9, 8]
        const particleKinds = ['grass', 'fire', 'water'] as const
        const starterIndex = cinematic.shot - 1
        drawLayer((starterIndex === 2 ? scene[3] : scene[0]) ?? movieGraphics[5], 0, 0, 1.03)
        drawLayer(scene[starterIndex === 1 ? 2 : 1], 0, 0, 1.03)
        const entrance = Math.min(1, cinematic.shotProgress * 3)
        drawOpeningMovieSprite(
          storyContext, sprites[starterSprites[starterIndex]], cinematic.shotElapsedMs,
          storyViewport.width * (.5 + (1 - entrance) * .34), storyViewport.height * .59,
          1.14 + Math.sin(cinematic.shotProgress * Math.PI) * .08, entrance,
        )
        if (starterParticles) {
          const particlesStarted = cinematic.shotElapsedMs >= hgssVBlanksToMilliseconds(2)
          if (!particlesStarted && openingParticleShot !== undefined) {
            openingParticlePlayback.clear()
            openingParticleShot = undefined
          } else if (particlesStarted && openingParticleShot !== cinematic.shot) {
            openingParticlePlayback.clear()
            openingParticleShot = cinematic.shot
            const emitterGroups = [[6, 7, 8], [3, 4, 5], [0, 1, 2]] as const
            for (const emitterId of emitterGroups[starterIndex]) {
              void openingParticlePlayback.createEmitter(starterParticles, emitterId, 0, 'player', [0, 0, .015625])
            }
          }
          if (particlesStarted) {
            storyContext.save()
            storyContext.imageSmoothingEnabled = false
            storyContext.drawImage(openingParticleCanvas, 0, 0, storyViewport.width, storyViewport.height)
            storyContext.restore()
          }
        } else {
          drawStarterParticles(storyContext, particleKinds[starterIndex], cinematic.shotProgress)
        }
      } else {
        storyContext.fillStyle = '#000'
        storyContext.fillRect(0, 0, storyViewport.width, storyViewport.height)
        drawOpeningMovieSprite(storyContext, sprites[6], cinematic.shotElapsedMs, storyViewport.width * .5, storyViewport.height * .5, 1.3, 1, 2)
      }
    } else {
      const scene = scenes[4] ?? []
      const scroll = -.3 + cinematic.shotProgress * .6
      clipHalf('left', () => {
        drawLayer(scene[0] ?? movieGraphics[6], 0, scroll, 1.04)
        drawLayer(scene[1], 0, -scroll * .7, 1.04)
      })
      clipHalf('right', () => {
        drawLayer(scene[2] ?? movieGraphics[6], 0, -scroll, 1.04)
        drawLayer(scene[3], 0, scroll * .7, 1.04)
      })
    }

    if ((cinematic.scene !== 'starters' || cinematic.shot < 1 || cinematic.shot > 3) && openingParticleShot !== undefined) {
      openingParticlePlayback.clear()
      openingParticleShot = undefined
    }

    const barHeight = 24 * cinematic.letterbox
    storyContext.fillStyle = '#02070d'
    storyContext.fillRect(0, 0, storyViewport.width, barHeight)
    storyContext.fillRect(0, storyViewport.height - barHeight, storyViewport.width, barHeight)
    drawOpeningTransition(storyContext, cinematic)
    storyContext.fillStyle = `rgba(0, 0, 0, ${Math.max(cinematic.fadeFromBlack, cinematic.fadeToBlack)})`
    storyContext.fillRect(0, 0, storyViewport.width, storyViewport.height)
    presentStoryFrame()
  }

  function clearStoryFrame(renderScale = 1): void {
    if (!storyContext) return
    const width = Math.round(storyViewport.width * renderScale)
    const height = Math.round(storyViewport.height * renderScale)
    if (storyCanvas.width !== width || storyCanvas.height !== height) {
      storyCanvas.width = width
      storyCanvas.height = height
    }
    storyContext.setTransform(1, 0, 0, 1, 0, 0)
    storyContext.imageSmoothingEnabled = false
    storyContext.fillStyle = '#000'
    storyContext.fillRect(0, 0, storyCanvas.width, storyCanvas.height)
    storyContext.setTransform(renderScale, 0, 0, renderScale, 0, 0)
  }

  function drawAdaptiveTitleBackdrop(inventory: RomInventory, animation: TitleAnimationState): void {
    if (!storyContext) return
    const background = inventory.titleBackgroundGraphicPreview ?? inventory.openingGraphicPreview ?? inventory.graphicPreview
    drawGraphicCover(
      storyContext,
      background,
      storyViewport.width,
      storyViewport.height,
      true,
      animation.atmosphereOffsetZ / 12.5,
      animation.atmosphereOffsetY / 1.8,
      1.09,
    )
  }

  function presentStoryFrame(smoothing = false): void {
    if (!screenContext) return
    screenContext.save()
    screenContext.imageSmoothingEnabled = smoothing
    if (smoothing) screenContext.imageSmoothingQuality = 'high'
    screenContext.fillStyle = '#000'
    screenContext.fillRect(0, 0, screenCanvas.width, screenCanvas.height)
    screenContext.drawImage(storyCanvas, 0, 0, screenCanvas.width, screenCanvas.height)
    screenContext.restore()
  }

  function drawTitle(inventory: RomInventory, force = false): void {
    if (!screenContext || !storyContext || screenCanvas.hidden) return
    screenCanvas.style.imageRendering = 'auto'
    const resized = resizeScreenCanvas()
    if (force || titleStartedAt === undefined) titleStartedAt = performance.now()
    const animation = createTitleAnimationState(inventory, performance.now() - titleStartedAt)
    const key = `title:${inventory.titleTouchMessage ?? ''}:${screenCanvas.width}x${screenCanvas.height}:${animation.frame}`
    if (!force && !resized && lastRenderKey === key) return
    lastRenderKey = key

    clearStoryFrame(titleRenderScale)
    drawAdaptiveTitleBackdrop(inventory, animation)
    drawTitleModelLayer(storyContext, inventory, animation, 0, 0, storyViewport.width, storyViewport.height)
    drawTitleSparkleLayer(storyContext, inventory, animation, storyViewport.width * 0.76, storyViewport.height * 0.7)
    drawTitleOverlayGraphic(storyContext, inventory.titleLogoGraphicPreview, storyViewport.width, storyViewport.height, 0.82)
    // Le crédit « Developed by GAME FREAK inc. » est une couche ROM isolée.
    // Le menu mono-écran conserve le logo officiel mais omet cette signature.
    drawTitlePrompt(storyContext, inventory, animation, storyViewport.width / 2, storyViewport.height - 34)
    const titleAge = performance.now() - titleStartedAt
    // intro_movie_scene_5 and TitleScreen_Init hand the display over in white.
    // Fading from black introduced a visible black flash that does not exist in HGSS.
    const titleFade = Math.max(0, 1 - titleAge / 420)
    storyContext.fillStyle = `rgba(255, 255, 255, ${titleFade})`
    storyContext.fillRect(0, 0, storyViewport.width, storyViewport.height)
    presentStoryFrame(true)
  }

  function drawIntro(inventory: RomInventory, intro: IntroRenderState, force = false): void {
    if (!screenContext || !storyContext || screenCanvas.hidden) return
    screenCanvas.style.imageRendering = 'pixelated'
    const resized = resizeScreenCanvas()
    const now = performance.now()
    const sceneSelection = intro.mode === 'gender-confirm' || intro.mode === 'name-confirm' ? intro.selectedGender ?? '' : ''
    const sceneKey = `${intro.mode === 'dialog' ? 'dialog' : intro.mode}:${intro.messageId ?? ''}:${intro.scene ?? ''}:${intro.showGenderSelect}:${sceneSelection}`
    if (!introSceneAnimation || introSceneAnimation.key !== sceneKey) introSceneAnimation = { key: sceneKey, startedAt: now }
    const sceneAge = now - introSceneAnimation.startedAt
    const holdOakShiftText = intro.scene === 'oak-shifted' && sceneAge < oakShiftTextAtMs
    const holdMarillText = intro.scene === 'oak-marill' && sceneAge < getOakMarillTiming(inventory).textAtMs
    const holdOakReturnText = intro.scene === 'oak-returning' && sceneAge < oakReturnTextAtMs
    const visibleText = holdOakShiftText || holdMarillText || holdOakReturnText ? '' : getAnimatedIntroText(intro, now)
    const renderedIntro = visibleText === intro.text ? intro : { ...intro, text: visibleText }
    const motionRaw = Math.max(0, Math.min(1, sceneAge / 420))
    const motion = motionRaw * motionRaw * (3 - 2 * motionRaw)
    const animationFrame = Math.floor(sceneAge / (1000 / 30))
    const key = `intro:${intro.mode}:${intro.showGenderSelect}:${intro.selectedGender ?? ''}:${intro.selectedChoice ?? ''}:${intro.playerName ?? ''}:${visibleText}:${animationFrame}:${screenCanvas.width}x${screenCanvas.height}`
    if (!force && !resized && lastRenderKey === key) return
    lastRenderKey = key

    clearStoryFrame()
    if (intro.mode === 'name-input') {
      drawNameInput(storyContext, inventory, renderedIntro)
    } else if (intro.showGenderSelect) {
      drawGenderSelect(storyContext, inventory, renderedIntro, motion, now)
    } else {
      if (intro.scene === 'profile') drawProfileIntroScene(storyContext, inventory, intro, motion, now)
      else if (intro.mode === 'tutorial-choice') {
        drawStoryBackdrop(
          storyContext,
          inventory.introTutorialBackgroundGraphics?.[intro.tutorialLayout ?? 1]
            ?? inventory.introLowerBackgroundGraphic
            ?? inventory.introGraphicPreview,
        )
      }
      else drawOakIntroScene(storyContext, inventory, intro, motion, now, sceneAge)
      if (intro.mode === 'tutorial-choice') drawTutorialChoiceMenu(storyContext, renderedIntro, motion)
      else if (intro.presentation === 'fullscreen') drawFullscreenTutorialText(storyContext, renderedIntro, motion, now)
      else drawStoryDialogBox(storyContext, renderedIntro, motion, now)
    }
    drawIntroTransitionOverlay(storyContext, intro, motion, sceneAge)
    presentStoryFrame()
  }

  function drawIntroShrink(inventory: RomInventory, gender: 'male' | 'female', elapsedMs: number): void {
    if (!screenContext || !storyContext || screenCanvas.hidden) return
    screenCanvas.style.imageRendering = 'pixelated'
    resizeScreenCanvas()
    clearStoryFrame()
    drawStoryBackdrop(storyContext, inventory.introTopBackgroundGraphic ?? inventory.introGraphicPreview)
    const frames = gender === 'female' ? inventory.introGirlShrinkGraphics : inventory.introBoyShrinkGraphics
    const frameIndex = elapsedMs < 600 ? 0 : Math.min(4, 1 + Math.floor((elapsedMs - 600) / 150))
    const graphic = frames?.[frameIndex] ?? (gender === 'female' ? inventory.introGirlGraphic : inventory.introBoyGraphic)
    drawGraphicCover(storyContext, graphic, storyViewport.width, storyViewport.height, false)
    const fadeFromBlack = Math.max(0, 1 - elapsedMs / 100)
    storyContext.fillStyle = `rgba(0, 0, 0, ${fadeFromBlack})`
    storyContext.fillRect(0, 0, storyViewport.width, storyViewport.height)
    presentStoryFrame()
  }

  function dispose(): void {
    openingParticlePlayback.clear()
    titleModelRenderer.dispose()
    canvasAssets.clear()
  }

  return { setMode, showCanvas, drawOpening, drawTitle, drawIntro, drawIntroShrink, completeIntroTextAnimation, canAdvanceIntro, dispose }
}
