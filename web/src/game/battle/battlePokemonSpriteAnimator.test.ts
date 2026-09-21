import { describe, expect, it } from 'vitest'
import type { NitroGraphic } from '../../ndsTypes'
import type { BattlePokemonSprite } from '../../rom/pokemon/battlePokemonSprites'
import { createBattlePokemonSpriteAnimator } from './battlePokemonSpriteAnimator'

function graphic(offset: number): NitroGraphic {
  return {
    width: 1,
    height: 1,
    pixels: new Uint8ClampedArray(4),
    graphicsOffset: offset,
    paletteOffset: 0,
    colorDepth: 4,
  }
}

function sprite(): BattlePokemonSprite {
  const frames = [graphic(0), graphic(1)]
  return {
    graphic: frames[0]!,
    frames,
    animationScript: [
      { next: 0, duration: 1, xOffset: 0 },
      { next: 1, duration: 2, xOffset: 3 },
      { next: -1, duration: 0, xOffset: 0 },
    ],
    height: 1,
    memberIndex: 0,
    paletteMemberIndex: 0,
    animationFrameCount: 2,
  }
}

class FakeElement {
  children: FakeElement[] = []
  dataset: Record<string, string> = {}
  hidden = false
  style = { transform: '' }
  readonly removedClasses: string[] = []
  readonly classList = { remove: (...names: string[]) => { this.removedClasses.push(...names) } }
  querySelector() { return this.children[0] ?? null }
  replaceChildren(...children: FakeElement[]) { this.children = children }
  append(child: FakeElement) { this.children.push(child) }
}

function createFixture() {
  const mounted: Array<{ host: HTMLElement, frame: NitroGraphic, canvas: FakeElement }> = []
  const animator = createBattlePokemonSpriteAnimator({
    resolveBattleFrameHost: (element) => element,
    mountGraphicCanvas: (host, frame) => {
      const canvas = new FakeElement()
      mounted.push({ host, frame, canvas })
      return canvas as unknown as HTMLCanvasElement
    },
  })
  return { animator, mounted }
}

describe('lecteur central des sprites Pokémon de combat', () => {
  it('possède les lecteurs simple et nettoie l’état de K.O. du Pokémon vivant', () => {
    const { animator, mounted } = createFixture()
    const player = new FakeElement()
    animator.registerSimple('player', player as unknown as HTMLElement, sprite(), 10)

    animator.animate(12, { mode: 'simple', isSimpleSideAlive: (side) => side === 'player' })
    expect(player.removedClasses).toEqual(['is-fainting'])
    expect(mounted[0]?.frame.graphicsOffset).toBe(1)
    expect(mounted[0]?.canvas.style.transform).toBe('translateX(3.75%)')

    animator.clearSimple()
    animator.animate(13, { mode: 'simple' })
    expect(mounted).toHaveLength(1)
  })

  it('refuse un lecteur double devenu incohérent avec son occupant', () => {
    const { animator, mounted } = createFixture()
    const opponent = new FakeElement()
    const position = { side: 'opponent', slot: 1 } as const
    animator.registerDouble(position, opponent as unknown as HTMLElement, sprite(), 20)

    animator.animate(22, { mode: 'double', isDoublePlaybackCurrent: () => false })
    expect(mounted).toHaveLength(0)
    animator.animate(22, { mode: 'double', isDoublePlaybackCurrent: () => true })
    expect(mounted[0]?.frame.graphicsOffset).toBe(1)
  })

  it('possède le cycle évolution, son redémarrage et sa libération', () => {
    const { animator, mounted } = createFixture()
    const from = new FakeElement()
    const to = new FakeElement()
    animator.registerEvolution([
      { host: from as unknown as HTMLElement, sprite: sprite() },
      { host: to as unknown as HTMLElement, sprite: sprite() },
    ], 100)

    animator.animate(102, { mode: 'none' })
    expect(mounted.slice(-2).map(({ frame }) => frame.graphicsOffset)).toEqual([1, 1])
    animator.restartEvolution(200)
    animator.animate(200, { mode: 'none' })
    expect(mounted.slice(-2).map(({ frame }) => frame.graphicsOffset)).toEqual([0, 0])

    animator.clearEvolution()
    const count = mounted.length
    animator.animate(202, { mode: 'none' })
    expect(mounted).toHaveLength(count)
  })

  it('libère tous les lecteurs en une opération', () => {
    const { animator, mounted } = createFixture()
    const element = new FakeElement() as unknown as HTMLElement
    animator.registerSimple('player', element, sprite(), 0)
    animator.registerDouble({ side: 'player', slot: 0 }, element, sprite(), 0)
    animator.registerEvolution([{ host: element, sprite: sprite() }, { host: element, sprite: sprite() }], 0)
    animator.dispose()
    animator.animate(2, { mode: 'simple' })
    expect(mounted).toHaveLength(0)
  })
})
