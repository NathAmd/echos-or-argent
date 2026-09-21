import { hgssVBlankDurationMs } from '../time/hgssFrameTiming'

export type OpeningScene = 'copyright-sunrise' | 'players' | 'johto-rival' | 'starters' | 'final-scroll'

export type OpeningCinematicState = {
  scene: OpeningScene
  shot: number
  shotElapsedMs: number
  shotDurationMs: number
  elapsedMs: number
  sceneProgress: number
  shotProgress: number
  fadeFromBlack: number
  fadeToBlack: number
  cameraZoom: number
  cameraPanX: number
  cameraPanY: number
  legendAlpha: number
  legendScale: number
  logoAlpha: number
  letterbox: number
  transition: 'cut' | 'fade-black' | 'fade-white' | 'wipe' | 'iris' | 'iris-white'
  transitionProgress: number
  flashAlpha: number
  complete: boolean
}

const nativeFrameMs = hgssVBlankDurationMs

// Durées des plans en VBlank, directement issues des attentes, panoramiques,
// wipes, animations NANR et émetteurs SPL des cinq scènes natives.
const sceneShotFrames = {
  'copyright-sunrise': [91, 20, 110, 370, 155],
  players: [65, 90, 7, 84],
  'johto-rival': [50, 55, 115, 155, 60, 215, 254],
  starters: [59, 43, 34, 51, 25],
  'final-scroll': [90],
} as const satisfies Record<OpeningScene, readonly number[]>

const sceneFrames = (Object.keys(sceneShotFrames) as OpeningScene[])
  .map((scene) => sceneShotFrames[scene].reduce((sum, frames) => sum + frames, 0))
const sceneEnds = sceneFrames.reduce<number[]>((ends, frames) => [
  ...ends,
  (ends.at(-1) ?? 0) + frames * nativeFrameMs,
], [])
export const openingCinematicDurationMs = sceneEnds[4]
export const openingCinematicMinimumSkipMs = 1_850

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function easeInOut(value: number): number {
  const t = clamp01(value)
  return t * t * (3 - 2 * t)
}

function segment(elapsedMs: number, startMs: number, endMs: number): number {
  return easeInOut((elapsedMs - startMs) / Math.max(1, endMs - startMs))
}

type Shot = {
  durationFrames: number
  transitionIn?: OpeningCinematicState['transition']
  transitionInFrames?: number
  transitionOut?: OpeningCinematicState['transition']
  transitionOutFrames?: number
}

const sceneShots: Record<OpeningScene, readonly Shot[]> = {
  'copyright-sunrise': [
    { durationFrames: 91, transitionIn: 'fade-black', transitionInFrames: 3, transitionOut: 'fade-black', transitionOutFrames: 60 },
    { durationFrames: 20 },
    { durationFrames: 110 },
    { durationFrames: 370 },
    { durationFrames: 155, transitionOut: 'fade-white', transitionOutFrames: 65 },
  ],
  players: [
    { durationFrames: 65, transitionIn: 'fade-white', transitionInFrames: 3 },
    { durationFrames: 90 },
    { durationFrames: 7 },
    { durationFrames: 84, transitionOut: 'iris-white', transitionOutFrames: 8 },
  ],
  'johto-rival': [
    { durationFrames: 50, transitionIn: 'iris-white', transitionInFrames: 8, transitionOut: 'iris', transitionOutFrames: 8 },
    { durationFrames: 55, transitionIn: 'iris', transitionInFrames: 8, transitionOut: 'iris', transitionOutFrames: 8 },
    { durationFrames: 115, transitionIn: 'iris', transitionInFrames: 8, transitionOut: 'iris', transitionOutFrames: 8 },
    { durationFrames: 155, transitionIn: 'iris', transitionInFrames: 8, transitionOut: 'wipe', transitionOutFrames: 7 },
    { durationFrames: 60, transitionIn: 'wipe', transitionInFrames: 7 },
    { durationFrames: 215, transitionOut: 'wipe', transitionOutFrames: 10 },
    { durationFrames: 254, transitionIn: 'wipe', transitionInFrames: 10 },
  ],
  starters: [
    { durationFrames: 59, transitionIn: 'wipe', transitionInFrames: 10, transitionOut: 'wipe', transitionOutFrames: 10 },
    { durationFrames: 43 },
    { durationFrames: 34 },
    { durationFrames: 51, transitionOut: 'fade-black', transitionOutFrames: 26 },
    { durationFrames: 25, transitionIn: 'fade-black', transitionInFrames: 1 },
  ],
  'final-scroll': [
    { durationFrames: 90, transitionIn: 'wipe', transitionInFrames: 18, transitionOut: 'fade-white', transitionOutFrames: 50 },
  ],
}

function resolveShot(scene: OpeningScene, elapsedMs: number): Pick<OpeningCinematicState, 'shot' | 'shotElapsedMs' | 'shotDurationMs' | 'shotProgress' | 'transition' | 'transitionProgress' | 'flashAlpha'> {
  const shots = sceneShots[scene]
  const sceneStart = scene === 'copyright-sunrise' ? 0
    : scene === 'players' ? sceneEnds[0]
      : scene === 'johto-rival' ? sceneEnds[1]
        : scene === 'starters' ? sceneEnds[2] : sceneEnds[3]
  let shotStart = sceneStart
  for (let shot = 0; shot < shots.length; shot += 1) {
    const definition = shots[shot]
    const shotDurationMs = definition.durationFrames * nativeFrameMs
    const shotEnd = shotStart + shotDurationMs
    if (elapsedMs < shotEnd || shot === shots.length - 1) {
      const shotElapsedMs = Math.max(0, elapsedMs - shotStart)
      const rawProgress = clamp01(shotElapsedMs / Math.max(1, shotDurationMs))
      const inDurationMs = (definition.transitionInFrames ?? 0) * nativeFrameMs
      const outDurationMs = (definition.transitionOutFrames ?? 0) * nativeFrameMs
      let transition: OpeningCinematicState['transition'] = 'cut'
      let transitionProgress = 1
      if (definition.transitionIn && shotElapsedMs < inDurationMs) {
        transition = definition.transitionIn
        transitionProgress = easeInOut(shotElapsedMs / Math.max(1, inDurationMs))
      } else if (definition.transitionOut && shotElapsedMs > shotDurationMs - outDurationMs) {
        transition = definition.transitionOut
        transitionProgress = easeInOut((shotDurationMs - shotElapsedMs) / Math.max(1, outDurationMs))
      }
      return {
        shot,
        shotElapsedMs,
        shotDurationMs,
        shotProgress: easeInOut(rawProgress),
        transition,
        transitionProgress,
        flashAlpha: transition === 'fade-white' ? 1 - transitionProgress : 0,
      }
    }
    shotStart = shotEnd
  }
  return { shot: 0, shotElapsedMs: 0, shotDurationMs: 1, shotProgress: 0, transition: 'cut', transitionProgress: 1, flashAlpha: 0 }
}

export function canSkipOpeningCinematic(elapsedMs: number): boolean {
  return elapsedMs >= openingCinematicMinimumSkipMs
}

export function createOpeningCinematicState(elapsedMs: number): OpeningCinematicState {
  const elapsed = Math.max(0, elapsedMs)
  const complete = elapsed >= openingCinematicDurationMs
  const fadeFromBlack = 1 - segment(elapsed, 0, 500)
  // Scene 5 exits through the ROM's white brightness fade; the title owns the
  // following fade-in, so a global black veil would erase the native effect.
  const fadeToBlack = 0

  if (elapsed < sceneEnds[0]) {
    const progress = segment(elapsed, 0, sceneEnds[0])
    const shot = resolveShot('copyright-sunrise', elapsed)
    return {
      scene: 'copyright-sunrise', ...shot, elapsedMs: elapsed, sceneProgress: progress, fadeFromBlack, fadeToBlack,
      cameraZoom: 1.08, cameraPanX: 0, cameraPanY: .22 - progress * .44,
      legendAlpha: 0, legendScale: 1, logoAlpha: 0, letterbox: 0, complete,
    }
  }
  if (elapsed < sceneEnds[1]) {
    const progress = segment(elapsed, sceneEnds[0], sceneEnds[1])
    const shot = resolveShot('players', elapsed)
    return {
      scene: 'players', ...shot, elapsedMs: elapsed, sceneProgress: progress, fadeFromBlack, fadeToBlack,
      cameraZoom: 1.1, cameraPanX: -.25 + progress * .5, cameraPanY: .18 - progress * .36,
      legendAlpha: 0, legendScale: 1, logoAlpha: 0, letterbox: 0, complete,
    }
  }
  if (elapsed < sceneEnds[2]) {
    const progress = segment(elapsed, sceneEnds[1], sceneEnds[2])
    const shot = resolveShot('johto-rival', elapsed)
    return {
      scene: 'johto-rival', ...shot, elapsedMs: elapsed, sceneProgress: progress, fadeFromBlack, fadeToBlack,
      cameraZoom: 1.04 + Math.sin(progress * Math.PI * 3) * .04, cameraPanX: -.18 + progress * .36,
      cameraPanY: 0, legendAlpha: 0, legendScale: 1, logoAlpha: 0,
      letterbox: progress > .48 ? 1 : 0, complete,
    }
  }
  if (elapsed < sceneEnds[3]) {
    const progress = segment(elapsed, sceneEnds[2], sceneEnds[3])
    const shot = resolveShot('starters', elapsed)
    return {
      scene: 'starters', ...shot, elapsedMs: elapsed, sceneProgress: progress, fadeFromBlack, fadeToBlack,
      cameraZoom: 1.06, cameraPanX: 0, cameraPanY: .08 - progress * .16,
      legendAlpha: 0, legendScale: 1, logoAlpha: 0, letterbox: 0, complete,
    }
  }
  const progress = segment(elapsed, sceneEnds[3], openingCinematicDurationMs)
  const shot = resolveShot('final-scroll', elapsed)
  return {
    scene: 'final-scroll', ...shot, elapsedMs: elapsed, sceneProgress: progress, fadeFromBlack, fadeToBlack,
    cameraZoom: 1.04, cameraPanX: 0, cameraPanY: -.15 + progress * .3, legendAlpha: 0,
    legendScale: 1, logoAlpha: 0, letterbox: 0, complete,
  }
}
