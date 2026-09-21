import { describe, expect, it, vi } from 'vitest'
import type { NitroGraphic } from '../../ndsTypes'
import type { HgssBattleThrowSpriteAsset } from '../../rom/battle/battleThrowSprites'
import { playHgssBattleThrowSprite, resolveHgssBattleThrowTiming } from './battleThrowPlayback'

const graphic: NitroGraphic = {
  width: 16,
  height: 16,
  pixels: new Uint8ClampedArray(16 * 16 * 4),
  graphicsOffset: 0,
  paletteOffset: 0,
  colorDepth: 4,
}

function asset(): HgssBattleThrowSpriteAsset {
  return {
    kind: 'safari-rock',
    characterMemberId: 336,
    paletteMemberId: 108,
    cellMemberId: 335,
    animationMemberId: 334,
    sequenceIndex: 1,
    nativeOrigin: [64, 112],
    frames: [graphic, graphic, graphic, graphic, graphic],
    animation: {
      declaredFrameCount: 5,
      sequences: [
        { loopStartFrame: 0, animationElement: 0, animationType: 0, playbackMode: 1, frames: [{ durationFrames: 1, cellIndex: 0, positionX: 0, positionY: 0 }] },
        {
          loopStartFrame: 0,
          animationElement: 2,
          animationType: 1,
          playbackMode: 1,
          frames: [2, 3, 4, 5, 6].map((durationFrames, cellIndex) => ({ durationFrames, cellIndex, positionX: 0, positionY: 0 })),
        },
      ],
    },
  }
}

class ThrowElement {
  readonly children: ThrowElement[] = []
  readonly dataset: Record<string, string> = {}
  readonly style: Record<string, string> = {}
  className = ''
  hidden = false
  parent?: ThrowElement
  readonly classList = { add: (...names: string[]) => { this.className = [...new Set([...this.className.split(' ').filter(Boolean), ...names])].join(' ') } }
  append(...children: ThrowElement[]): void { children.forEach((child) => { child.parent = this; this.children.push(child) }) }
  remove(): void { if (!this.parent) return; this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = undefined }
  setAttribute(): void {}
}

describe('HGSS battle throw playback', () => {
  it('cale le son sur la frame 3 et libère l’OBJ huit VBlank après la frame 4', () => {
    expect(resolveHgssBattleThrowTiming(asset())).toEqual({ impactFrame: 3, completionFrame: 12 })
  })

  it('retire immédiatement le projectile si la scène est fermée pendant un son lent', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('document', { createElement: () => new ThrowElement() })
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) })
    const stage = new ThrowElement()
    const abort = new AbortController()
    let releaseSound: (() => void) | undefined
    const sound = new Promise<void>((resolve) => { releaseSound = resolve })
    const playImpactSound = vi.fn(() => sound)
    try {
      const playback = playHgssBattleThrowSprite({
        stage: stage as unknown as HTMLElement,
        asset: asset(),
        createGraphic: () => new ThrowElement() as unknown as HTMLElement,
        playImpactSound,
        reducedMotion: true,
        signal: abort.signal,
      })
      await Promise.resolve(); await Promise.resolve()
      expect(playImpactSound).toHaveBeenCalledOnce()
      expect(stage.children).toHaveLength(1)

      abort.abort()

      await expect(playback).rejects.toMatchObject({ name: 'AbortError' })
      expect(stage.children).toHaveLength(0)
      releaseSound?.()
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })
})
