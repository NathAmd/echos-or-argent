import type { PlayerDirection } from '../../ndsTypes'

export type PlayerTransitionMotionKind = 'rise' | 'descend' | 'teleporter'
export type PlayerTransitionMotionPhase = 'exit' | 'entry'

/**
 * Mouvement visuel temporaire d'un PlayerAvatar pendant un changement de carte.
 * Les offsets sont exprimes en cases afin de rester independants de la projection
 * exterieure (1 unite/case) ou interieure (16 unites/case).
 */
export type PlayerTransitionMotion = {
  kind: PlayerTransitionMotionKind
  phase: PlayerTransitionMotionPhase
  direction: PlayerDirection
  durationFrames: number
}

export type PlayerTransitionMotionSample = {
  offsetYTiles: number
  complete: boolean
}

type ActivePlayerTransitionMotion = {
  motion: PlayerTransitionMotion
  startedAtMs: number
  settled: boolean
  resolve: () => void
  reject: (reason: PlayerTransitionMotionCancelledError) => void
}

export class PlayerTransitionMotionCancelledError extends Error {
  override readonly name = 'PlayerTransitionMotionCancelledError'

  constructor() { super('La motion de transition joueur a ete annulee.') }
}

const nativeTeleporterFrames = 20
const nativeTeleporterQuadraticFx = 2048
const nativeTeleporterLinearFx = 9011.2
const nativeFx32Scale = 4096
const nativeTileSize = 16
const ladderHeightTiles = 2
const southLadderHeightTiles = 0.5

function requireMotion(motion: PlayerTransitionMotion): void {
  if (!Number.isInteger(motion.durationFrames) || motion.durationFrames <= 0) {
    throw new Error(`La duree de transition joueur ${motion.durationFrames} VBlank est invalide.`)
  }
}

function teleporterOffsetTiles(progress: number): number {
  const frame = nativeTeleporterFrames * progress
  const offsetFx = Math.trunc(frame * (frame * nativeTeleporterQuadraticFx + nativeTeleporterLinearFx))
  return offsetFx / nativeFx32Scale / nativeTileSize
}

export function scalePlayerTransitionOffset(offsetYTiles: number, usesWorldCoordinates: boolean): number {
  return offsetYTiles * (usesWorldCoordinates ? 1 : nativeTileSize)
}

/** Reproduit les offsets Y des routines echelle et WarpPanel de HGSS. */
export function samplePlayerTransitionMotion(
  motion: PlayerTransitionMotion,
  elapsedFrames: number,
): PlayerTransitionMotionSample {
  requireMotion(motion)
  const progress = Math.min(1, Math.max(0, elapsedFrames / motion.durationFrames))
  const complete = elapsedFrames >= motion.durationFrames
  if (motion.kind === 'teleporter') {
    return {
      offsetYTiles: teleporterOffsetTiles(motion.phase === 'exit' ? progress : 1 - progress),
      complete,
    }
  }

  // La sortie d'une echelle orientee sud est diagonale dans la ROM : sa
  // composante verticale ne couvre qu'une demi-case au lieu de deux.
  const height = motion.kind === 'rise' && motion.direction === 'south'
    ? southLadderHeightTiles
    : ladderHeightTiles
  const sign = motion.kind === 'rise' ? 1 : -1
  return {
    offsetYTiles: sign * height * (motion.phase === 'exit' ? progress : progress - 1),
    complete,
  }
}

/**
 * Petit ordonnanceur sans dependance Three.js. Une sortie achevee conserve son
 * offset terminal jusqu'au chargement de carte; une entree revient a zero et se
 * libere. `cancel` rejette la Promise avec une erreur dediee afin qu'un ancien
 * flux asynchrone ne puisse jamais continuer sur la carte suivante.
 */
export class PlayerTransitionMotionController {
  private active: ActivePlayerTransitionMotion | undefined

  get isActive(): boolean {
    return this.active !== undefined
  }

  play(motion: PlayerTransitionMotion, startedAtMs: number): Promise<void> {
    requireMotion(motion)
    if (!Number.isFinite(startedAtMs)) throw new Error('Le debut de transition joueur est invalide.')
    this.cancel()
    return new Promise<void>((resolve, reject) => {
      this.active = { motion, startedAtMs, settled: false, resolve, reject }
    })
  }

  update(nowMs: number, frameDurationMs: number): PlayerTransitionMotionSample | undefined {
    const active = this.active
    if (!active) return undefined
    const elapsedFrames = !Number.isFinite(nowMs) || !Number.isFinite(frameDurationMs) || frameDurationMs <= 0
      ? 0
      : Math.floor(Math.max(0, nowMs - active.startedAtMs) / frameDurationMs + 1e-9)
    const sample = samplePlayerTransitionMotion(active.motion, elapsedFrames)
    if (sample.complete && !active.settled) {
      active.settled = true
      active.resolve()
    }
    if (sample.complete && active.motion.phase === 'entry') this.active = undefined
    return sample
  }

  cancel(): void {
    const active = this.active
    if (!active) return
    this.active = undefined
    if (!active.settled) active.reject(new PlayerTransitionMotionCancelledError())
  }
}
