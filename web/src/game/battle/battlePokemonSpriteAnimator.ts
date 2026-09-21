import type { NitroGraphic } from '../../ndsTypes'
import {
  sampleHgssBattlePokemonAnimation,
  type BattlePokemonSprite,
} from '../../rom/pokemon/battlePokemonSprites'

export type BattlePokemonSpriteSide = 'player' | 'opponent'
export type BattlePokemonSpritePosition = Readonly<{
  side: BattlePokemonSpriteSide
  slot: 0 | 1
}>

type RegisteredBattleSprite = {
  element: HTMLElement
  sprite: BattlePokemonSprite
  startedAtVblank: number
}

type RegisteredEvolutionSprites = {
  startedAtVblank: number
  entries: readonly [
    Readonly<{ host: HTMLElement, sprite: BattlePokemonSprite }>,
    Readonly<{ host: HTMLElement, sprite: BattlePokemonSprite }>,
  ]
}

export type BattlePokemonSpriteAnimationContext = {
  mode: 'none' | 'simple' | 'double'
  isSimpleSideAlive?: (side: BattlePokemonSpriteSide) => boolean
  isDoublePlaybackCurrent?: (position: BattlePokemonSpritePosition, element: HTMLElement) => boolean
}

export type BattlePokemonSpriteAnimatorOptions = {
  resolveBattleFrameHost: (element: HTMLElement) => HTMLElement
  mountGraphicCanvas: (host: HTMLElement, graphic: NitroGraphic) => HTMLCanvasElement
}

export type BattlePokemonSpriteAnimator = {
  registerSimple: (
    side: BattlePokemonSpriteSide,
    element: HTMLElement,
    sprite: BattlePokemonSprite,
    startedAtVblank: number,
  ) => void
  registerDouble: (
    position: BattlePokemonSpritePosition,
    element: HTMLElement,
    sprite: BattlePokemonSprite,
    startedAtVblank: number,
  ) => void
  clearSimple: () => void
  clearDouble: () => void
  registerEvolution: (
    entries: RegisteredEvolutionSprites['entries'],
    startedAtVblank: number,
  ) => void
  restartEvolution: (startedAtVblank: number) => void
  clearEvolution: () => void
  animate: (vblank: number, context: BattlePokemonSpriteAnimationContext) => void
  dispose: () => void
}

const simpleSides = ['player', 'opponent'] as const
const doublePositions: readonly BattlePokemonSpritePosition[] = simpleSides.flatMap((side) => [
  { side, slot: 0 },
  { side, slot: 1 },
])

function doublePositionKey(position: BattlePokemonSpritePosition): string {
  return `${position.side}:${position.slot}`
}

/** Possède les lecteurs Poképic des combats sans connaître les sessions moteur. */
export function createBattlePokemonSpriteAnimator(
  options: BattlePokemonSpriteAnimatorOptions,
): BattlePokemonSpriteAnimator {
  const simple = new Map<BattlePokemonSpriteSide, RegisteredBattleSprite>()
  const double = new Map<string, RegisteredBattleSprite>()
  let evolution: RegisteredEvolutionSprites | undefined

  const renderBattleSprite = (playback: RegisteredBattleSprite, vblank: number): void => {
    const elapsedVblanks = (vblank - playback.startedAtVblank) >>> 0
    const sample = sampleHgssBattlePokemonAnimation(playback.sprite.animationScript, elapsedVblanks)
    const canvas = options.mountGraphicCanvas(
      options.resolveBattleFrameHost(playback.element),
      playback.sprite.frames[sample.frameIndex]!,
    )
    canvas.style.transform = `translateX(${sample.xOffset * 1.25}%)`
  }

  const animateBattle = (vblank: number, context: BattlePokemonSpriteAnimationContext): void => {
    if (context.mode === 'simple') {
      for (const side of simpleSides) {
        const playback = simple.get(side)
        if (!playback) continue
        if (context.isSimpleSideAlive?.(side)) playback.element.classList.remove('is-fainting')
        renderBattleSprite(playback, vblank)
      }
      return
    }
    if (context.mode !== 'double') return
    for (const position of doublePositions) {
      const playback = double.get(doublePositionKey(position))
      if (!playback || context.isDoublePlaybackCurrent?.(position, playback.element) === false) continue
      renderBattleSprite(playback, vblank)
    }
  }

  const animateEvolution = (vblank: number): void => {
    if (!evolution) return
    const elapsedVblanks = (vblank - evolution.startedAtVblank) >>> 0
    for (const { host, sprite } of evolution.entries) {
      let sample = sampleHgssBattlePokemonAnimation(sprite.animationScript, elapsedVblanks)
      if (sample.complete && elapsedVblanks > 90) {
        sample = sampleHgssBattlePokemonAnimation(sprite.animationScript, elapsedVblanks % 90)
      }
      const canvas = options.mountGraphicCanvas(host, sprite.frames[sample.frameIndex]!)
      canvas.style.transform = `translateX(${sample.xOffset * 1.25}%)`
    }
  }

  const clearSimple = (): void => { simple.clear() }
  const clearDouble = (): void => { double.clear() }
  const clearEvolution = (): void => { evolution = undefined }

  return {
    registerSimple(side, element, sprite, startedAtVblank) {
      simple.set(side, { element, sprite, startedAtVblank: startedAtVblank >>> 0 })
    },
    registerDouble(position, element, sprite, startedAtVblank) {
      double.set(doublePositionKey(position), { element, sprite, startedAtVblank: startedAtVblank >>> 0 })
    },
    clearSimple,
    clearDouble,
    registerEvolution(entries, startedAtVblank) {
      evolution = { entries, startedAtVblank: startedAtVblank >>> 0 }
    },
    restartEvolution(startedAtVblank) {
      if (evolution) evolution.startedAtVblank = startedAtVblank >>> 0
    },
    clearEvolution,
    animate(vblank, context) {
      const frame = vblank >>> 0
      animateBattle(frame, context)
      animateEvolution(frame)
    },
    dispose() {
      clearSimple()
      clearDouble()
      clearEvolution()
    },
  }
}
