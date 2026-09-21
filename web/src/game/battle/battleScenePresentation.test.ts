import { describe, expect, it, vi } from 'vitest'
import { resetBattleScenePresentation } from './battleScenePresentation'

type FakeAnimation = { cancel: ReturnType<typeof vi.fn>, finished: Promise<void> }

class FakeElement {
  readonly dataset: Record<string, string> = {}
  readonly style: Record<string, string> = {}
  readonly children: FakeElement[] = []
  readonly animations: FakeAnimation[] = []
  readonly classes = new Set<string>()
  hidden = false
  readonly tagName: string
  private canvasWidth = 256
  bitmapResets = 0

  readonly classList = {
    add: (...names: string[]) => names.forEach((name) => this.classes.add(name)),
    remove: (...names: string[]) => names.forEach((name) => this.classes.delete(name)),
    contains: (name: string) => this.classes.has(name),
  }

  constructor(tagName = 'div', ...classes: string[]) {
    this.tagName = tagName.toUpperCase()
    this.classList.add(...classes)
  }

  get width(): number { return this.canvasWidth }
  set width(value: number) { this.canvasWidth = value; this.bitmapResets += 1 }

  append(...children: FakeElement[]): void {
    this.children.push(...children)
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children.splice(0, this.children.length, ...children)
  }

  getAnimations(options?: GetAnimationsOptions): Animation[] {
    const animations = options?.subtree
      ? [this, ...this.allDescendants()].flatMap((element) => element.animations)
      : this.animations
    return animations as unknown as Animation[]
  }

  querySelectorAll<T extends Element = Element>(selector: string): NodeListOf<T> {
    if (selector.startsWith(':scope')) return [] as unknown as NodeListOf<T>
    const candidates = this.allDescendants()
    if (selector === '*') return candidates as unknown as NodeListOf<T>
    const classNames = selector.split(',').map((part) => part.trim().replace(/^\./, ''))
    return candidates.filter((element) => classNames.some((name) => element.classes.has(name))) as unknown as NodeListOf<T>
  }

  private allDescendants(): FakeElement[] {
    return this.children.flatMap((child) => [child, ...child.allDescendants()])
  }
}

const cast = (element: FakeElement): HTMLElement => element as unknown as HTMLElement

function animation(): FakeAnimation {
  return { cancel: vi.fn(), finished: Promise.resolve() }
}

function buildScene(effectsTag = 'div'): {
  root: FakeElement
  trainer: FakeElement
  hud: FakeElement
  message: FakeElement
  statCard: FakeElement
  sprite: FakeElement
  ball: FakeElement
  party: FakeElement
  commands: FakeElement
  moves: FakeElement
  effects: FakeElement
} {
  const root = new FakeElement('section', 'battle-screen', 'is-impact', 'is-heavy-impact', 'is-capture-success', 'is-trainer-encounter', 'is-level-up', 'is-exp-gaining', 'is-evolution-only', 'is-egg-hatch')
  Object.assign(root.dataset, {
    presentation: 'action',
    phase: 'action',
    actionType: '10',
    action: 'move',
    terrain: 'field',
    battleKind: 'double',
    kind: 'trainer',
    weather: 'rain',
    uiMode: 'party',
    ui: 'menu',
    safariMessageAdvance: 'automatic',
    safariMessagePageTransition: 'page',
    persistent: 'kept',
  })
  const trainer = new FakeElement('div', 'battle-trainer', 'is-arriving', 'is-throwing', 'is-double')
  const hud = new FakeElement('section', 'battle-hud', 'is-arriving', 'is-updating')
  const message = new FakeElement('section', 'battle-message', 'is-changing')
  const statCard = new FakeElement('section', 'battle-stat-gains', 'is-revealed')
  const sprite = new FakeElement('div', 'battle-pokemon-sprite', 'is-arriving', 'is-hit', 'is-fainting')
  Object.assign(sprite.dataset, { battlePokemonIdentity: 'old', battlePokemonVisual: 'old', shiny: 'true' })
  sprite.style.opacity = '0'
  const ball = new FakeElement('div', 'battle-pokeball', 'is-thrown')
  Object.assign(ball.dataset, { romBall: 'true', ballItemId: '4' })
  ball.style.transform = 'translate(10px, 20px)'
  ball.append(new FakeElement('canvas'))
  const party = new FakeElement('div', 'battle-party-gauge')
  const commands = new FakeElement('nav', 'battle-commands')
  const moves = new FakeElement('nav', 'battle-moves', 'battle-learn-move')
  const effects = new FakeElement(effectsTag, 'battle-effects')
  effects.append(new FakeElement('canvas'))
  root.append(trainer, hud, message, statCard, sprite, ball, party, commands, moves, effects)
  return { root, trainer, hud, message, statCard, sprite, ball, party, commands, moves, effects }
}

describe('battle scene presentation reset', () => {
  it('neutralise et masque entièrement une scène quittée', () => {
    const scene = buildScene()
    const rootAnimation = animation()
    const hudAnimation = animation()
    scene.root.animations.push(rootAnimation)
    scene.hud.animations.push(hudAnimation)

    resetBattleScenePresentation(cast(scene.root), { mode: 'exit', clearDatasets: true })

    expect(rootAnimation.cancel).toHaveBeenCalled()
    expect(hudAnimation.cancel).toHaveBeenCalled()
    expect(scene.root.hidden).toBe(true)
    expect([...scene.root.classes]).toEqual(['battle-screen'])
    expect(scene.root.dataset).toEqual({ persistent: 'kept' })

    expect(scene.trainer.hidden).toBe(true)
    expect(scene.trainer.classes).toEqual(new Set(['battle-trainer']))
    expect(scene.hud.hidden).toBe(true)
    expect(scene.hud.classes).toEqual(new Set(['battle-hud']))
    expect(scene.message.hidden).toBe(true)
    expect(scene.message.classes).toEqual(new Set(['battle-message']))
    expect(scene.statCard.hidden).toBe(true)
    expect(scene.statCard.classes).toEqual(new Set(['battle-stat-gains']))

    expect(scene.sprite.hidden).toBe(true)
    expect(scene.sprite.classes).toEqual(new Set(['battle-pokemon-sprite']))
    expect(scene.sprite.dataset).toEqual({ battlePresentationRevision: '1' })
    expect(scene.sprite.style.opacity).toBe('')
    expect(scene.ball.children).toEqual([])
    expect(scene.ball.classes).toEqual(new Set(['battle-pokeball']))
    expect(scene.ball.dataset).toEqual({})
    expect(scene.ball.style.transform).toBe('')

    expect(scene.party.hidden).toBe(true)
    expect(scene.commands.hidden).toBe(true)
    expect(scene.moves.hidden).toBe(true)
    expect(scene.moves.classes).toEqual(new Set(['battle-moves']))
    expect(scene.effects.children).toEqual([])
  })

  it('prépare un démarrage sans révéler/masquer le root ni effacer les datasets si désactivé', () => {
    const scene = buildScene('canvas')
    scene.root.hidden = false
    const canvasFallback = scene.effects.children[0]

    resetBattleScenePresentation(cast(scene.root), { mode: 'start', clearDatasets: false })

    expect(scene.root.hidden).toBe(false)
    expect(scene.root.dataset.presentation).toBe('action')
    expect(scene.root.dataset.uiMode).toBe('party')
    expect(scene.hud.hidden).toBe(true)
    expect(scene.commands.hidden).toBe(true)
    expect(scene.effects.children).toEqual([canvasFallback])
    expect(scene.effects.bitmapResets).toBe(1)
  })
})
