import type { SimpleBattleSide } from './simpleBattleSession'

export type HgssBattleParticleWorldPosition = readonly [number, number, number]

export type HgssBattleParticleRect = {
  left: number
  top: number
  width: number
  height: number
}

export type HgssBattleParticleCanvasSize = {
  width: number
  height: number
}

const dsViewportCenterX = 128
const dsViewportCenterY = 96
const particlePixelFactor = 172
const fx32One = 4096

// Positions « Normal » des deux battler types solo dans le repère 3D HGSS.
const soloPlayerWorldPosition: HgssBattleParticleWorldPosition = [-2.3477, -1.334, 0.0156]
const soloEnemyWorldPosition: HgssBattleParticleWorldPosition = [2.6992, 1.0742, -1.2812]

export function hgssSoloBattlerWorldPosition(side: SimpleBattleSide): HgssBattleParticleWorldPosition {
  return side === 'player' ? soloPlayerWorldPosition : soloEnemyWorldPosition
}

/** Convertit un point du canevas DS vers le repère fixe utilisé par SPL. */
export function hgssBattleCanvasPointToWorldPosition(
  x: number,
  y: number,
  z = 0,
): HgssBattleParticleWorldPosition {
  return [
    (x - dsViewportCenterX) * particlePixelFactor / fx32One,
    (dsViewportCenterY - y) * particlePixelFactor / fx32One,
    z,
  ]
}

/**
 * Replace l'ancre native d'un combattant sur son sprite réellement rendu.
 * Le script et ses offsets restent dans le repère HGSS 256×192, tandis que
 * l'ancre suit les dispositions modernes, responsives et les combats doubles.
 */
export function resolveHgssBattlerWorldPositionFromRects(
  canvasSize: HgssBattleParticleCanvasSize,
  canvasRect: HgssBattleParticleRect,
  battlerRect: HgssBattleParticleRect,
  fallbackSide: SimpleBattleSide,
): HgssBattleParticleWorldPosition {
  const fallback = hgssSoloBattlerWorldPosition(fallbackSide)
  if (canvasSize.width <= 0 || canvasSize.height <= 0 || canvasRect.width <= 0 || canvasRect.height <= 0
    || battlerRect.width <= 0 || battlerRect.height <= 0) return fallback
  const centerX = battlerRect.left + battlerRect.width / 2
  const centerY = battlerRect.top + battlerRect.height / 2
  const canvasX = (centerX - canvasRect.left) * canvasSize.width / canvasRect.width
  const canvasY = (centerY - canvasRect.top) * canvasSize.height / canvasRect.height
  return hgssBattleCanvasPointToWorldPosition(canvasX, canvasY, fallback[2])
}

export function resolveHgssBattlerWorldPosition(
  canvas: HTMLCanvasElement,
  battler: HTMLElement | undefined,
  fallbackSide: SimpleBattleSide,
): HgssBattleParticleWorldPosition {
  if (!battler) return hgssSoloBattlerWorldPosition(fallbackSide)
  return resolveHgssBattlerWorldPositionFromRects(
    { width: canvas.width, height: canvas.height },
    canvas.getBoundingClientRect(),
    battler.getBoundingClientRect(),
    fallbackSide,
  )
}
