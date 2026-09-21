import type { NitroGraphic } from '../../ndsTypes'
import { sampleHgssBattlePokemonAnimation } from '../../rom/pokemon/battlePokemonSprites'
import type { PokemonUiPreview } from './pokemonUiPreview'
import { hgssVBlanksToMilliseconds } from '../time/hgssFrameTiming'

export const pokemonUiIconFrameDurationVblanks = 24
export const pokemonUiIconFrameDurationMs = hgssVBlanksToMilliseconds(pokemonUiIconFrameDurationVblanks)

export function samplePokemonUiIconVBlankFrame(vblank: number, frameCount: number): number {
  const count = Math.max(1, Math.floor(frameCount))
  return Math.floor(Math.max(0, vblank) / pokemonUiIconFrameDurationVblanks) % count
}

export function samplePokemonUiIconFrame(now: number, frameCount: number): number {
  const count = Math.max(1, Math.floor(frameCount))
  return Math.floor(Math.max(0, now) / pokemonUiIconFrameDurationMs) % count
}

type AnimatedPokemonUiCanvas = {
  frames: readonly NitroGraphic[]
  animationScript?: PokemonUiPreview['animationScript']
  startedAtVblank: number
  frameIndex: number
  xOffset: number
}

export type PokemonUiAnimationRegistry = {
  register: (canvas: HTMLCanvasElement, preview: PokemonUiPreview, vblank: number) => void
  animate: (now: number, vblank: number) => void
}

/** Lecteur commun des animations natives pour toutes les UI, PC compris. */
export function createPokemonUiAnimationRegistry(
  resolveFrameCanvas: (frame: NitroGraphic) => HTMLCanvasElement,
): PokemonUiAnimationRegistry {
  const entries = new Map<HTMLCanvasElement, AnimatedPokemonUiCanvas>()
  return {
    register(canvas, preview, vblank) {
      entries.set(canvas, { frames: preview.frames, animationScript: preview.animationScript, startedAtVblank: vblank, frameIndex: 0, xOffset: 0 })
    },
    animate(now, vblank) {
      for (const [canvas, animation] of entries) {
        if (!canvas.isConnected) { entries.delete(canvas); continue }
        if (canvas.closest('[hidden]')) continue
        let frameIndex = samplePokemonUiIconFrame(now, animation.frames.length)
        let xOffset = 0
        if (animation.animationScript) {
          let elapsed = (vblank - animation.startedAtVblank) >>> 0
          let sample = sampleHgssBattlePokemonAnimation(animation.animationScript, elapsed)
          if (sample.complete && elapsed > 90) {
            animation.startedAtVblank = vblank
            elapsed = 0
            sample = sampleHgssBattlePokemonAnimation(animation.animationScript, elapsed)
          }
          frameIndex = sample.frameIndex
          xOffset = sample.xOffset
        }
        if (frameIndex === animation.frameIndex && xOffset === animation.xOffset) continue
        const frame = animation.frames[frameIndex] ?? animation.frames[0]
        if (!frame) continue
        animation.frameIndex = frameIndex
        animation.xOffset = xOffset
        const context = canvas.getContext('2d')
        context?.clearRect(0, 0, canvas.width, canvas.height)
        context?.drawImage(resolveFrameCanvas(frame), 0, 0)
        canvas.style.transform = xOffset === 0 ? '' : `translateX(${xOffset * 1.25}%)`
      }
    },
  }
}
