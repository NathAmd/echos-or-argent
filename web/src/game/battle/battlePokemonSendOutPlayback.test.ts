import { describe, expect, it, vi } from 'vitest'
import type { NitroGraphic } from '../../ndsTypes'
import type { HgssBattleBallSpriteAsset } from '../../rom/battle/battleBallSprites'
import {
  HGSS_BATTLE_SEND_OUT_SOUND_CUES,
  playHgssBattlePokemonSendOut,
  type HgssBattlePokemonSendOutPhase,
} from './battlePokemonSendOutPlayback'

class FakeElement {
  readonly dataset: Record<string, string> = {}
  readonly style: Record<string, string> = {}
  readonly classes = new Set<string>()
  readonly attributes: Record<string, string> = {}
  children: FakeElement[] = []
  hidden = false
  parent?: FakeElement
  readonly offsetWidth = 256

  readonly classList = {
    add: (...names: string[]) => names.forEach((name) => this.classes.add(name)),
    remove: (...names: string[]) => names.forEach((name) => this.classes.delete(name)),
    contains: (name: string) => this.classes.has(name),
  }

  get childElementCount(): number {
    return this.children.length
  }

  addEventListener(): void {}
  removeEventListener(): void {}
  getAnimations(): Animation[] { return [] }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value
  }

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

function graphic(id: number): NitroGraphic {
  return {
    width: 16,
    height: 16,
    pixels: new Uint8ClampedArray(16 * 16 * 4),
    graphicsOffset: id,
    paletteOffset: 0,
    colorDepth: 4,
  }
}

function ballAsset(ballId: number): HgssBattleBallSpriteAsset {
  return {
    ballId,
    characterMemberId: ballId * 10 + 1,
    paletteMemberId: ballId * 10 + 2,
    cellMemberId: ballId * 10 + 3,
    animationMemberId: ballId * 10 + 4,
    closedSequenceIndex: 0,
    activeSequenceIndex: 1,
    frames: [graphic(ballId * 10), graphic(ballId * 10 + 1), graphic(ballId * 10 + 2)],
    animation: {
      declaredFrameCount: 5,
      sequences: [
        {
          loopStartFrame: 0,
          animationElement: 0,
          animationType: 1,
          playbackMode: 2,
          frames: [
            { cellIndex: 0, durationFrames: 2, positionX: 0, positionY: 0 },
            { cellIndex: 1, durationFrames: 2, positionX: 0, positionY: 0 },
          ],
        },
        {
          loopStartFrame: 0,
          animationElement: 0,
          animationType: 1,
          playbackMode: 1,
          frames: [
            { cellIndex: 0, durationFrames: 2, positionX: 0, positionY: 0 },
            { cellIndex: 2, durationFrames: 3, positionX: 0, positionY: 0 },
          ],
        },
      ],
    },
  }
}

function host(side: 'player' | 'opponent'): FakeElement {
  const element = new FakeElement()
  element.classList.add('battle-pokeball', `battle-pokeball-${side}`)
  return element
}

function entry(side: 'player' | 'opponent', slot: number, ballId: number) {
  return {
    side,
    slot,
    pokemon: { speciesId: slot + 1, ballId },
    sprite: cast(new FakeElement()),
    hud: cast(new FakeElement()),
    host: cast(host(side)),
  } as const
}

describe("lecteur global d'envoi de Pokémon HGSS", () => {
  it('rend deux Balls natives distinctes et conserve lancer, ouverture, cri puis HUD', async () => {
    const stage = new FakeElement()
    const entries = [entry('player', 0, 5), entry('player', 1, 24)]
    const events: string[] = []
    const hostsByBall = new Map<string, FakeElement>()
    let phase: HgssBattlePokemonSendOutPhase | undefined
    const resolver = vi.fn((ballId: number) => ballAsset(ballId))
    const sounds: number[] = []
    const playCry = vi.fn()
    const playCrySequence = vi.fn((cries: readonly { pokemon: { speciesId: number } }[]) => {
      expect(stage.children).toHaveLength(2)
      expect(stage.children.every(({ hidden }) => !hidden)).toBe(true)
      events.push(`cries:${cries.map(({ pokemon }) => pokemon.speciesId).join(',')}:${phase}`)
    })
    let elapsedFrames = 0
    let hudStartedAt = -1

    const run = playHgssBattlePokemonSendOut({
      entries,
      stage: cast(stage),
      ballSpriteResolver: resolver,
      createGraphic: (value) => {
        const element = new FakeElement()
        element.dataset.graphic = String(value.graphicsOffset)
        return cast(element)
      },
      playSoundEffect: (soundId) => { sounds.push(soundId) },
      playCry,
      playCrySequence,
      waitFrames: async (frames) => { elapsedFrames += frames },
      onPhase: (event) => {
        phase = event.phase
        events.push(`phase:${event.phase}`)
        if (event.phase === 'hud') hudStartedAt = elapsedFrames
        if (event.phase === 'throw') {
          expect(stage.children).toHaveLength(2)
          for (const ball of stage.children) hostsByBall.set(ball.dataset.ballId!, ball)
          expect(stage.children[0]).not.toBe(stage.children[1])
          expect(stage.children.map(({ dataset }) => dataset.ballId)).toEqual(['5', '24'])
          expect(stage.children.every(({ dataset }) => dataset.ballGraphicSource === 'ball-sprite')).toBe(true)
        }
      },
    })
    const result = await run.finished

    expect(result.status).toBe('completed')
    expect(result.phases).toEqual(['throw', 'open', 'materialize', 'hud'])
    expect(result.presentations.map(({ ballId, graphicSource }) => ({ ballId, graphicSource }))).toEqual([
      { ballId: 5, graphicSource: 'ball-sprite' },
      { ballId: 24, graphicSource: 'ball-sprite' },
    ])
    expect(resolver.mock.calls.map(([ballId]) => ballId)).toEqual([5, 24])
    expect(hostsByBall.get('5')).not.toBe(hostsByBall.get('24'))
    expect(events).toEqual([
      'phase:throw',
      'phase:open',
      'phase:materialize',
      'cries:1,2:materialize',
      'phase:hud',
    ])
    expect(playCrySequence).toHaveBeenCalledTimes(1)
    expect(playCry).not.toHaveBeenCalled()
    expect(sounds).toEqual([HGSS_BATTLE_SEND_OUT_SOUND_CUES.throw, HGSS_BATTLE_SEND_OUT_SOUND_CUES.open])
    expect(hudStartedAt).toBe(72)
    expect(stage.children).toEqual([])
    for (const pokemon of entries) {
      expect(pokemon.sprite.hidden).toBe(false)
      expect(pokemon.hud.hidden).toBe(false)
      expect(pokemon.sprite.dataset.battleSendOut).toBeUndefined()
      expect(pokemon.hud.dataset.battleSendOut).toBeUndefined()
    }
  })

  it('normalise les anciennes données et garde la Ball CSS générique si la ROM est indécodable', async () => {
    const stage = new FakeElement()
    const invalid = entry('opponent', 0, 496)
    let thrownBall: FakeElement | undefined
    const run = playHgssBattlePokemonSendOut({
      entries: [invalid],
      stage: cast(stage),
      ballSpriteResolver: () => { throw new Error('NARC tronqué') },
      createGraphic: () => cast(new FakeElement()),
      waitFrames: async () => undefined,
      onPhase: ({ phase }) => {
        if (phase === 'throw') thrownBall = stage.children[0]
      },
    })
    const result = await run.finished

    expect(result.presentations[0]).toMatchObject({ ballId: 4, graphicSource: 'generic' })
    expect(thrownBall?.classes.has('battle-pokeball-opponent')).toBe(true)
    expect(thrownBall?.dataset).toMatchObject({ ballId: '4', ballGraphicSource: 'generic' })
    expect(thrownBall?.dataset.romBall).toBeUndefined()
    expect(thrownBall?.children).toEqual([])
  })

  it('termine toutes les phases sans attente en mouvement réduit', async () => {
    const stage = new FakeElement()
    const pokemon = entry('player', 0, 11)
    const waitFrames = vi.fn(async () => undefined)
    const phases: string[] = []
    const playCry = vi.fn()

    const result = await playHgssBattlePokemonSendOut({
      entries: [pokemon],
      stage: cast(stage),
      ballSpriteResolver: ballAsset,
      createGraphic: () => cast(new FakeElement()),
      waitFrames,
      reducedMotion: true,
      playCry,
      onPhase: ({ phase }) => { phases.push(phase) },
    }).finished

    expect(result.status).toBe('completed')
    expect(phases).toEqual(['throw', 'open', 'materialize', 'hud'])
    expect(waitFrames).not.toHaveBeenCalled()
    expect(playCry).toHaveBeenCalledTimes(1)
    expect(stage.children).toEqual([])
    expect(pokemon.sprite.hidden).toBe(false)
    expect(pokemon.hud.hidden).toBe(false)
  })

  it('fast-forward immédiatement au résultat visible quand le registre de skip appelle cancel', async () => {
    const stage = new FakeElement()
    const pokemon = entry('player', 0, 17)
    let finishWait!: () => void
    const waiting = new Promise<void>((resolve) => { finishWait = resolve })
    const waitFrames = vi.fn(() => waiting)
    const playCry = vi.fn()
    const playCrySequence = vi.fn()
    const run = playHgssBattlePokemonSendOut({
      entries: [pokemon],
      stage: cast(stage),
      ballSpriteResolver: ballAsset,
      createGraphic: () => cast(new FakeElement()),
      waitFrames,
      playCry,
      playCrySequence,
    })

    expect(stage.children).toHaveLength(1)
    run.cancel()
    const result = await run.finished
    expect(result.status).toBe('cancelled')
    expect(result.phases).toEqual(['throw'])
    expect(stage.children).toEqual([])
    expect(pokemon.sprite.hidden).toBe(false)
    expect(pokemon.hud.hidden).toBe(false)
    expect(pokemon.sprite.dataset.battleSendOut).toBeUndefined()
    expect(playCrySequence).toHaveBeenCalledTimes(1)
    expect(playCry).not.toHaveBeenCalled()
    finishWait()
    await waiting
    expect(stage.children).toEqual([])
  })

  it("n'écrase pas des hosts réaffectés quand la génération devient obsolète", async () => {
    const stage = new FakeElement()
    const pokemon = entry('opponent', 0, 4)
    let current = true
    const result = await playHgssBattlePokemonSendOut({
      entries: [pokemon],
      stage: cast(stage),
      ballSpriteResolver: ballAsset,
      createGraphic: () => cast(new FakeElement()),
      isCurrent: () => current,
      waitFrames: async () => {
        current = false
        pokemon.sprite.hidden = false
        pokemon.sprite.dataset.battleSendOut = 'new-sprite'
        pokemon.hud.hidden = false
        pokemon.hud.dataset.battleSendOut = 'new-hud'
      },
    }).finished

    expect(result.status).toBe('stale')
    expect(stage.children).toEqual([])
    expect(pokemon.sprite.hidden).toBe(false)
    expect(pokemon.sprite.dataset.battleSendOut).toBe('new-sprite')
    expect(pokemon.hud.hidden).toBe(false)
    expect(pokemon.hud.dataset.battleSendOut).toBe('new-hud')
  })

  it("n'ajoute pas les 18 VBlank du HUD lorsque toutes les entrées en sont dépourvues", async () => {
    const stage = new FakeElement()
    const withHud = entry('opponent', 0, 4)
    const pokemon = { ...withHud, hud: undefined }
    let elapsedFrames = 0

    const result = await playHgssBattlePokemonSendOut({
      entries: [pokemon],
      stage: cast(stage),
      ballSpriteResolver: ballAsset,
      createGraphic: () => cast(new FakeElement()),
      waitFrames: async (frames) => { elapsedFrames += frames },
    }).finished

    expect(result.status).toBe('completed')
    expect(result.phases).toEqual(['throw', 'open', 'materialize', 'hud'])
    expect(elapsedFrames).toBe(72)
    expect(pokemon.sprite.hidden).toBe(false)
  })

  it("révèle l'état final et nettoie sa Ball avant de propager une erreur inattendue", async () => {
    const stage = new FakeElement()
    const pokemon = entry('player', 0, 4)
    const run = playHgssBattlePokemonSendOut({
      entries: [pokemon],
      stage: cast(stage),
      ballSpriteResolver: ballAsset,
      createGraphic: () => cast(new FakeElement()),
      waitFrames: async () => undefined,
      onPhase: ({ phase }) => {
        if (phase === 'throw') throw new Error('observer défaillant')
      },
    })

    await expect(run.finished).rejects.toThrow('observer défaillant')
    expect(stage.children).toEqual([])
    expect(pokemon.sprite.hidden).toBe(false)
    expect(pokemon.hud.hidden).toBe(false)
    expect(pokemon.sprite.dataset.battleSendOut).toBeUndefined()
    expect(pokemon.hud.dataset.battleSendOut).toBeUndefined()
  })

  it('réutilise au breakout la Ball déjà ouverte et son override sans nouveau lancer', async () => {
    const stage = new FakeElement()
    const existingBall = host('player')
    stage.append(existingBall)
    const pokemon = entry('opponent', 0, 4)
    const phases: string[] = []
    const resolver = vi.fn((ballId: number) => ballAsset(ballId))

    const result = await playHgssBattlePokemonSendOut({
      mode: 'release-only',
      entries: [{ ...pokemon, ballId: 21, host: cast(existingBall) }],
      stage: cast(stage),
      ballSpriteResolver: resolver,
      createGraphic: () => cast(new FakeElement()),
      waitFrames: async () => undefined,
      onPhase: ({ phase }) => { phases.push(phase) },
    }).finished

    expect(result.status).toBe('completed')
    expect(result.presentations[0]).toMatchObject({ ballId: 21, ball: cast(existingBall) })
    expect(phases).toEqual(['open', 'materialize', 'hud'])
    expect(resolver).toHaveBeenCalledWith(21)
    expect(stage.children).toEqual([existingBall])
    expect(existingBall.hidden).toBe(false)
    expect(existingBall.children).toEqual([])
    expect(existingBall.dataset).toEqual({})
    expect(existingBall.style.left).toBe('')
    expect(existingBall.style.opacity).toBe('')
    expect(pokemon.sprite.hidden).toBe(false)
  })
})
