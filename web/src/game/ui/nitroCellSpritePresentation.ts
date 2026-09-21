import type { NitroCellSpritePreview, NitroGraphic } from '../../ndsTypes'

const nitroFramesPerSecond = 60

export type NitroCellSpriteTimelineFrame = {
  graphic: NitroGraphic
  durationFrames: number
  startFrame: number
  endFrame: number
  positionX: number
  positionY: number
  rotation: number
  scaleX: number
  scaleY: number
  left: number
  top: number
}

export type NitroCellSpriteTimeline = {
  width: number
  height: number
  originX: number
  originY: number
  durationFrames: number
  repeats: boolean
  frames: readonly NitroCellSpriteTimelineFrame[]
}

/**
 * Résout une séquence NANR en timeline indépendante du DOM. Les séquences
 * Nitro qui possèdent une introduction avant leur boucle restent en lecture
 * unique : les répéter depuis zéro déformerait leur animation native.
 */
export function resolveNitroCellSpriteTimeline(
  sprite: NitroCellSpritePreview,
  sequenceIndex: number,
): NitroCellSpriteTimeline | undefined {
  const sequence = sprite.animation.sequences[sequenceIndex]
  if (!sequence?.frames.length) return undefined
  const reverse = sequence.playbackMode === 3 || sequence.playbackMode === 4
  const sourceFrames = reverse ? [...sequence.frames].reverse() : sequence.frames
  const frames: NitroCellSpriteTimelineFrame[] = []
  let cursor = 0
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const source of sourceFrames) {
    const graphic = sprite.frames[source.cellIndex]
    if (!graphic) return undefined
    const cell = sprite.cells?.[source.cellIndex]
    const left = source.positionX + (cell?.minX ?? -graphic.width / 2)
    const top = source.positionY + (cell?.minY ?? -graphic.height / 2)
    const durationFrames = Math.max(1, source.durationFrames)
    frames.push({
      graphic,
      durationFrames,
      startFrame: cursor,
      endFrame: cursor + durationFrames,
      positionX: source.positionX,
      positionY: source.positionY,
      rotation: source.rotation ?? 0,
      scaleX: source.scaleX ?? 1,
      scaleY: source.scaleY ?? 1,
      left,
      top,
    })
    cursor += durationFrames
    minX = Math.min(minX, left)
    minY = Math.min(minY, top)
    maxX = Math.max(maxX, left + graphic.width)
    maxY = Math.max(maxY, top + graphic.height)
  }
  const nativeLoop = sequence.playbackMode === 2 || sequence.playbackMode === 4
  return {
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
    originX: minX,
    originY: minY,
    durationFrames: cursor,
    repeats: nativeLoop && sequence.loopStartFrame === 0,
    frames,
  }
}

function visibilityKeyframes(start: number, end: number): Keyframe[] {
  const keyframes: Keyframe[] = [{ opacity: start === 0 ? 1 : 0, offset: 0 }]
  if (start > 0) keyframes.push({ opacity: 0, offset: start }, { opacity: 1, offset: start })
  keyframes.push({ opacity: 1, offset: end })
  if (end < 1) keyframes.push({ opacity: 0, offset: end }, { opacity: 0, offset: 1 })
  return keyframes
}

function reducedMotionRequested(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Crée un OBJ Nitro animé ; son cycle est annulé automatiquement avec le DOM. */
export function createNitroCellSprite(
  sprite: NitroCellSpritePreview,
  sequenceIndex: number,
  createGraphic: (graphic: NitroGraphic) => HTMLElement,
  className = '',
): HTMLElement {
  const root = document.createElement('span')
  root.className = ['nitro-cell-sprite', 'pokegear-native-cell-sprite', className].filter(Boolean).join(' ')
  root.dataset.nitroSequence = String(sequenceIndex)
  root.setAttribute('aria-hidden', 'true')
  const timeline = resolveNitroCellSpriteTimeline(sprite, sequenceIndex)
  if (!timeline) {
    root.hidden = true
    return root
  }

  root.dataset.nativeWidth = String(timeline.width)
  root.dataset.nativeHeight = String(timeline.height)
  root.style.aspectRatio = `${timeline.width} / ${timeline.height}`
  const animate = timeline.frames.length > 1 && !reducedMotionRequested()
  for (const [index, frame] of timeline.frames.entries()) {
    const layer = createGraphic(frame.graphic)
    layer.classList.add('nitro-cell-frame', 'pokegear-native-cell-frame')
    layer.dataset.nitroFrame = String(index)
    layer.style.left = `${(frame.left - timeline.originX + frame.graphic.width / 2) / timeline.width * 100}%`
    layer.style.top = `${(frame.top - timeline.originY + frame.graphic.height / 2) / timeline.height * 100}%`
    layer.style.width = `${frame.graphic.width / timeline.width * 100}%`
    layer.style.height = `${frame.graphic.height / timeline.height * 100}%`
    layer.style.opacity = index === 0 ? '1' : '0'
    layer.style.transform = `translate(-50%, -50%) rotate(${frame.rotation * 360 / 0x10000}deg) scale(${frame.scaleX}, ${frame.scaleY})`
    layer.style.position = 'absolute'
    layer.style.imageRendering = 'pixelated'
    root.append(layer)
    if (!animate || typeof layer.animate !== 'function') continue
    layer.animate(
      visibilityKeyframes(frame.startFrame / timeline.durationFrames, frame.endFrame / timeline.durationFrames),
      {
        duration: timeline.durationFrames * 1000 / nitroFramesPerSecond,
        easing: 'linear',
        fill: timeline.repeats ? 'none' : 'forwards',
        iterations: timeline.repeats ? Infinity : 1,
      },
    )
  }
  return root
}
