import { describe, expect, it } from 'vitest'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { bindBattlePokemonSpritePresentation } from './battlePokemonSpritePresentation'
import {
  playBattleImpact,
  playBattlePokemonFaint,
  playBattleTrainerEntrance,
  playBattleTrainerThrow,
  revealBattlePokemon,
} from './battleSceneAnimations'

class FakeElement {
  readonly dataset: Record<string, string> = {}
  readonly style: Record<string, string> = {}
  readonly children: FakeElement[] = []
  readonly classes = new Set<string>()
  hidden = false
  readonly offsetWidth = 256

  readonly classList = {
    add: (...names: string[]) => names.forEach((name) => this.classes.add(name)),
    remove: (...names: string[]) => names.forEach((name) => this.classes.delete(name)),
    contains: (name: string) => this.classes.has(name),
  }

  constructor(...classes: string[]) {
    this.classList.add(...classes)
  }

  get childElementCount(): number {
    return this.children.length
  }

  addEventListener(): void {}

  removeEventListener(): void {}

  getAnimations(): Animation[] {
    return []
  }

  querySelectorAll<T extends Element = Element>(): NodeListOf<T> {
    return [] as unknown as NodeListOf<T>
  }

  append(...children: FakeElement[]): void {
    this.children.push(...children)
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children.splice(0, this.children.length, ...children)
  }
}

const cast = (element: FakeElement): HTMLElement => element as unknown as HTMLElement

const pokemon = (instanceId: string, currentHp: number) => ({
  instanceId: instanceId as CanonicalPokemon['instanceId'],
  currentHp,
})

describe('battle scene animation primitives', () => {
  it('révèle le Pokémon et son HUD après avoir neutralisé leurs anciens états', async () => {
    const sprite = new FakeElement('battle-pokemon-sprite', 'is-fainting')
    const hud = new FakeElement('battle-hud', 'is-updating')
    sprite.hidden = true
    hud.hidden = true

    const animations = revealBattlePokemon({ sprite: cast(sprite), hud: cast(hud) })

    expect(sprite.hidden).toBe(false)
    expect(sprite.classes.has('is-fainting')).toBe(false)
    expect(sprite.classes.has('is-arriving')).toBe(true)
    expect(hud.hidden).toBe(false)
    expect(hud.classes.has('is-updating')).toBe(false)
    expect(hud.classes.has('is-arriving')).toBe(true)
    await expect(animations.spriteAnimation.finished).resolves.toMatchObject({ reason: 'no-animation' })
    await expect(animations.hudAnimation?.finished).resolves.toMatchObject({ reason: 'no-animation' })
    expect(sprite.classes.has('is-arriving')).toBe(false)
    expect(hud.classes.has('is-arriving')).toBe(false)
  })

  it('protège les phases dresseur et ignore les hosts vides ou masqués', async () => {
    const empty = new FakeElement('battle-trainer')
    empty.hidden = true
    expect(playBattleTrainerEntrance({ trainer: cast(empty) })).toBeUndefined()

    const trainer = new FakeElement('battle-trainer', 'is-throwing')
    trainer.hidden = true
    trainer.append(new FakeElement('trainer-graphic'))
    const entrance = playBattleTrainerEntrance({ trainer: cast(trainer) })
    expect(trainer.hidden).toBe(false)
    expect(trainer.classes.has('is-throwing')).toBe(false)
    expect(trainer.classes.has('is-arriving')).toBe(true)

    const throwing = playBattleTrainerThrow({ trainer: cast(trainer) })
    expect(trainer.classes.has('is-arriving')).toBe(false)
    expect(trainer.classes.has('is-throwing')).toBe(true)
    await expect(entrance?.finished).resolves.toMatchObject({ reason: 'cleared' })
    await expect(throwing?.finished).resolves.toMatchObject({ reason: 'no-animation' })

    trainer.hidden = true
    expect(playBattleTrainerThrow({ trainer: cast(trainer) })).toBeUndefined()
  })

  it('choisit l’impact lourd au quart des PV et remplace l’impact précédent', async () => {
    const root = new FakeElement('battle-screen', 'is-heavy-impact')
    const sprite = new FakeElement('battle-pokemon-sprite', 'is-arriving')
    expect(playBattleImpact({ root: cast(root), sprite: cast(sprite), damage: 0, maximumHp: 100 })).toBeUndefined()

    const light = playBattleImpact({ root: cast(root), sprite: cast(sprite), damage: 24, maximumHp: 100 })
    expect(light?.kind).toBe('light')
    expect(root.classes.has('is-heavy-impact')).toBe(false)
    expect(root.classes.has('is-impact')).toBe(true)
    expect(sprite.classes.has('is-arriving')).toBe(false)
    expect(sprite.classes.has('is-hit')).toBe(true)

    const heavy = playBattleImpact({ root: cast(root), sprite: cast(sprite), damage: 25, maximumHp: 100 })
    expect(heavy?.kind).toBe('heavy')
    expect(root.classes.has('is-impact')).toBe(false)
    expect(root.classes.has('is-heavy-impact')).toBe(true)
    await expect(light?.sceneAnimation.finished).resolves.toMatchObject({ reason: 'cleared' })
    await expect(heavy?.sceneAnimation.finished).resolves.toMatchObject({ reason: 'no-animation' })
  })

  it('persiste le K.O. seulement tant que le Pokémon vaincu occupe encore le host', async () => {
    const defeated = pokemon('defeated', 0)
    const validSprite = new FakeElement('battle-pokemon-sprite', 'is-stat-up', 'is-stat-down', 'is-heal')
    bindBattlePokemonSpritePresentation(cast(validSprite), defeated, { hidden: false })

    const faint = playBattlePokemonFaint({ sprite: cast(validSprite), defeated, current: pokemon('defeated', 0) })
    expect(validSprite.classes.has('is-stat-up')).toBe(false)
    expect(validSprite.classes.has('is-stat-down')).toBe(false)
    expect(validSprite.classes.has('is-heal')).toBe(false)
    await expect(faint?.finished).resolves.toMatchObject({ reason: 'no-animation' })
    expect(validSprite.hidden).toBe(true)
    expect(validSprite.classes.has('is-fainting')).toBe(true)

    const reboundSprite = new FakeElement('battle-pokemon-sprite')
    bindBattlePokemonSpritePresentation(cast(reboundSprite), defeated, { hidden: false })
    const staleFaint = playBattlePokemonFaint({ sprite: cast(reboundSprite), defeated, current: defeated })
    bindBattlePokemonSpritePresentation(cast(reboundSprite), pokemon('replacement', 20), { hidden: false })

    await expect(staleFaint?.finished).resolves.toMatchObject({ reason: 'cleared' })
    expect(reboundSprite.hidden).toBe(false)
    expect(reboundSprite.classes.has('is-fainting')).toBe(false)
    expect(playBattlePokemonFaint({ sprite: cast(reboundSprite), defeated, current: defeated })).toBeUndefined()
    expect(playBattlePokemonFaint({ sprite: cast(reboundSprite), defeated, current: pokemon('defeated', 12) })).toBeUndefined()
  })
})
