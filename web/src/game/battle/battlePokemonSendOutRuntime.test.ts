import { describe, expect, it, vi } from 'vitest'
import {
  createBattlePokemonSendOutRuntime,
  type BattlePokemonSendOutRuntimeEntry,
  type BattlePokemonSendOutRuntimeOptions,
  type BattlePokemonSendOutRuntimeResources,
} from './battlePokemonSendOutRuntime'

class FakeElement {
  readonly dataset: Record<string, string> = {}
  readonly style: Record<string, string> = {}
  readonly classes = new Set<string>()
  children: FakeElement[] = []
  parent?: FakeElement
  hidden = false
  readonly offsetWidth = 256

  readonly classList = {
    add: (...names: string[]) => names.forEach((name) => this.classes.add(name)),
    remove: (...names: string[]) => names.forEach((name) => this.classes.delete(name)),
    contains: (name: string) => this.classes.has(name),
  }

  get childElementCount(): number { return this.children.length }
  addEventListener(): void {}
  removeEventListener(): void {}
  getAnimations(): Animation[] { return [] }
  setAttribute(): void {}

  append(...children: FakeElement[]): void {
    for (const child of children) {
      child.remove()
      child.parent = this
      this.children.push(child)
    }
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children.forEach((child) => { child.parent = undefined })
    this.children = []
    this.append(...children)
  }

  cloneNode(): FakeElement {
    const clone = new FakeElement()
    this.classes.forEach((name) => clone.classes.add(name))
    Object.assign(clone.dataset, this.dataset)
    Object.assign(clone.style, this.style)
    return clone
  }

  remove(): void {
    if (!this.parent) return
    this.parent.children = this.parent.children.filter((child) => child !== this)
    this.parent = undefined
  }
}

const cast = (element: FakeElement): HTMLElement => element as unknown as HTMLElement

function ballHost(side: 'player' | 'opponent'): FakeElement {
  const host = new FakeElement()
  host.classList.add('battle-pokeball', `battle-pokeball-${side}`)
  return host
}

function entry(side: 'player' | 'opponent', slot: number, ballId: number): BattlePokemonSendOutRuntimeEntry {
  return {
    side,
    slot,
    pokemon: { speciesId: 150 + slot, ballId },
    sprite: cast(new FakeElement()),
    hud: cast(new FakeElement()),
  }
}

function fixture(overrides: Partial<BattlePokemonSendOutRuntimeOptions> = {}) {
  const stage = new FakeElement()
  const hosts = { player: ballHost('player'), opponent: ballHost('opponent') }
  const resolver = vi.fn((ballId: number) => {
    void ballId
    return undefined
  })
  const createGraphic = vi.fn(() => cast(new FakeElement()))
  const playSoundEffect = vi.fn()
  const resources: BattlePokemonSendOutRuntimeResources = {
    ballSpriteResolver: resolver,
    createGraphic,
    playSoundEffect,
  }
  const register = vi.fn()
  const readBallHost = vi.fn((side: 'player' | 'opponent') => cast(hosts[side]))
  let generation = 7
  const options: BattlePokemonSendOutRuntimeOptions = {
    readStage: () => cast(stage),
    readResources: () => resources,
    readBallHost,
    reducedMotion: () => true,
    readGeneration: () => generation,
    register,
    ...overrides,
  }
  return {
    runtime: createBattlePokemonSendOutRuntime(options),
    stage,
    hosts,
    resolver,
    createGraphic,
    playSoundEffect,
    register,
    readBallHost,
    setGeneration: (value: number) => { generation = value },
  }
}

describe('adaptateur runtime de sortie de Pokémon', () => {
  it('ne démarre pas si la scène, les ressources ROM ou un host requis manque', () => {
    const noStage = fixture({ readStage: () => undefined })
    const noResources = fixture({ readResources: () => undefined })
    const noHost = fixture({ readBallHost: () => undefined })
    const pokemon = entry('player', 0, 4)

    expect(noStage.runtime.play([pokemon])).toBeUndefined()
    expect(noResources.runtime.play([pokemon])).toBeUndefined()
    expect(noHost.runtime.play([pokemon])).toBeUndefined()
    expect(noStage.register).not.toHaveBeenCalled()
    expect(noResources.register).not.toHaveBeenCalled()
    expect(noHost.register).not.toHaveBeenCalled()
  })

  it('fige les dépendances, réutilise le host modèle et enregistre un run simple ou double', async () => {
    const playCry = vi.fn()
    const test = fixture({ playCry })
    const entries = [entry('player', 0, 5), entry('player', 1, 24)]

    const run = test.runtime.play(entries)
    expect(run).toBeDefined()
    expect(test.register).toHaveBeenCalledWith(run)
    const result = await run!.finished

    expect(result.status).toBe('completed')
    expect(result.presentations.map(({ ballId }) => ballId)).toEqual([5, 24])
    expect(result.presentations[0]!.ball).not.toBe(result.presentations[1]!.ball)
    expect(result.presentations.every(({ ball }) => ball !== cast(test.hosts.player))).toBe(true)
    expect(test.readBallHost).toHaveBeenCalledTimes(1)
    expect(test.readBallHost).toHaveBeenCalledWith('player')
    expect(test.resolver.mock.calls.map(([ballId]) => ballId)).toEqual([5, 24])
    expect(playCry.mock.calls).toEqual([[150, 'player', 0], [151, 'player', 1]])
    expect(test.playSoundEffect).toHaveBeenCalledTimes(2)
    expect(test.stage.children).toEqual([])
  })

  it('transmet les cris doubles en une séquence ordonnée et garde le cri unitaire en fallback', async () => {
    const playCry = vi.fn()
    const playCrySequence = vi.fn()
    const test = fixture({ playCry, playCrySequence })

    const run = test.runtime.play([
      entry('opponent', 0, 5),
      entry('opponent', 1, 24),
    ])
    expect(run).toBeDefined()
    await run!.finished

    expect(playCrySequence).toHaveBeenCalledTimes(1)
    const [speciesIds, cries, isCurrent] = playCrySequence.mock.calls[0]!
    expect(speciesIds).toEqual([150, 151])
    expect(cries).toEqual([
      { speciesId: 150, side: 'opponent', slot: 0 },
      { speciesId: 151, side: 'opponent', slot: 1 },
    ])
    expect(isCurrent()).toBe(true)
    expect(playCry).not.toHaveBeenCalled()
    test.setGeneration(8)
    expect(isCurrent()).toBe(false)
  })

  it('accepte le host déjà ouvert de la capture uniquement en release-only', async () => {
    const readBallHost = vi.fn(() => undefined)
    const test = fixture({ readBallHost })
    const openedBall = ballHost('player')

    const run = test.runtime.play([entry('opponent', 0, 7)], {
      mode: 'release-only',
      host: cast(openedBall),
    })
    expect(run).toBeDefined()
    const result = await run!.finished

    expect(result.status).toBe('completed')
    expect(result.phases).toEqual(['open', 'materialize', 'hud'])
    expect(result.presentations[0]!.ball).toBe(cast(openedBall))
    expect(readBallHost).not.toHaveBeenCalled()
    expect(test.runtime.play([
      entry('opponent', 0, 4),
      entry('opponent', 1, 4),
    ], { mode: 'release-only', host: cast(openedBall) })).toBeUndefined()
  })

  it('rend le lecteur stale dès que la génération capturée change', async () => {
    const test = fixture()
    test.resolver.mockImplementation(() => {
      test.setGeneration(8)
      return undefined
    })

    const run = test.runtime.play([entry('player', 0, 11)])
    expect(run).toBeDefined()
    const result = await run!.finished

    expect(result.status).toBe('stale')
    expect(test.register).toHaveBeenCalledWith(run)
    expect(test.stage.children).toEqual([])
  })
})
