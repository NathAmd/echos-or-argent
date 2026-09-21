import { describe, expect, it, vi } from 'vitest'
import type { NitroGraphic } from '../../ndsTypes'
import type { HgssBattleBallSpriteAsset } from '../../rom/battle/battleBallSprites'
import {
  fadeHgssCapturedBall,
  playHgssBattleCaptureAnimation,
  resetHgssBattleBallPresentation,
  sampleHgssCaptureThrow,
} from './battleCapturePlayback'

type FakeElement = {
  hidden: boolean
  dataset: Record<string, string>
  style: Record<string, string>
  children: FakeElement[]
  classes: string[]
  attributes: Record<string, string>
  classList: { add: (...names: string[]) => void, remove: (...names: string[]) => void }
  append: (...children: FakeElement[]) => void
  setAttribute: (name: string, value: string) => void
  replaceChildren: (...children: FakeElement[]) => void
}

function element(): FakeElement {
  const value: FakeElement = {
    hidden: false,
    dataset: {},
    style: {},
    children: [],
    classes: [],
    attributes: {},
    classList: {
      add: (...names) => { value.classes.push(...names) },
      remove: (...names) => { value.classes = value.classes.filter((name) => !names.includes(name)) },
    },
    append: (...children) => { value.children.push(...children) },
    setAttribute: (name, content) => { value.attributes[name] = content },
    replaceChildren: (...children) => { value.children = children },
  }
  return value
}

const cast = (value: FakeElement): HTMLElement => value as unknown as HTMLElement

function graphic(size = 16): NitroGraphic {
  return { width: size, height: size, pixels: new Uint8ClampedArray(size * size * 4), graphicsOffset: 0, paletteOffset: 0, colorDepth: 4 }
}

function nativeBallAsset(): HgssBattleBallSpriteAsset {
  const frames = Array.from({ length: 10 }, (_, index) => graphic(index === 9 ? 32 : 16))
  return {
    ballId: 5,
    characterMemberId: 273,
    paletteMemberId: 87,
    cellMemberId: 272,
    animationMemberId: 271,
    closedSequenceIndex: 0,
    activeSequenceIndex: 1,
    frames,
    animation: {
      declaredFrameCount: 11,
      sequences: [
        {
          loopStartFrame: 0, animationElement: 0, animationType: 1, playbackMode: 2,
          frames: [2, 2, 6, 2, 2, 2, 6, 2].map((durationFrames, cellIndex) => ({ cellIndex, durationFrames, positionX: 0, positionY: 0 })),
        },
        {
          loopStartFrame: 0, animationElement: 0, animationType: 1, playbackMode: 1,
          frames: [
            { cellIndex: 0, durationFrames: 10, positionX: 0, positionY: 0 },
            { cellIndex: 8, durationFrames: 10, positionX: 0, positionY: 0 },
            { cellIndex: 9, durationFrames: 50, positionX: 0, positionY: 0 },
          ],
        },
      ],
    },
  }
}

describe('playback global de capture HGSS', () => {
  it('échantillonne le lancer natif sur 16 frames avec son arche de 64 pixels', () => {
    expect(sampleHgssCaptureThrow(0)).toEqual({ frame: 0, x: -30, y: 160 })
    expect(sampleHgssCaptureThrow(8)).toEqual({ frame: 8, x: 81, y: 44 })
    expect(sampleHgssCaptureThrow(16)).toEqual({ frame: 16, x: 192, y: 56 })
    expect(() => sampleHgssCaptureThrow(17)).toThrow(/0\.\.16/)
  })

  it('nettoie le host partagé avant un lancer standard ou une nouvelle Ball', () => {
    const ball = element()
    ball.hidden = true
    ball.children = [element()]
    ball.dataset.romBall = 'true'
    ball.dataset.ballItemId = '496'
    ball.dataset.ballId = '21'
    ball.dataset.ballGraphicSource = 'ball-sprite'
    ball.style.left = '75%'
    ball.style.filter = 'brightness(.25)'
    resetHgssBattleBallPresentation(cast(ball))
    expect(ball.hidden).toBe(false)
    expect(ball.children).toEqual([])
    expect(ball.dataset).toEqual({})
    expect(ball.style.left).toBe('')
    expect(ball.style.filter).toBe('')
  })

  it('ne restaure pas les hosts lorsqu’une nouvelle scène remplace la capture', async () => {
    const ball = element()
    const opponent = element()
    let current = true
    await expect(playHgssBattleCaptureAnimation({
      mode: 'normal', itemId: 4, shakes: 0, caught: false,
      ball: cast(ball), opponent: cast(opponent), createItemIcon: () => cast(element()),
      isCurrent: () => current,
      waitFrames: async () => {
        current = false
        ball.style.opacity = 'new-ball'
        opponent.style.opacity = 'new-opponent'
        opponent.hidden = true
      },
      animateElement: () => undefined,
    })).rejects.toThrow('remplacée')
    expect(ball.style.opacity).toBe('new-ball')
    expect(opponent.style.opacity).toBe('new-opponent')
    expect(opponent.hidden).toBe(true)
  })

  it('garde l’issue cachée jusqu’au clic, avec trois secousses et tous les sons natifs', async () => {
    const ball = element()
    const opponent = element()
    ball.style.filter = 'brightness(.2)'
    opponent.style.opacity = '.9'
    opponent.style.transform = 'translateX(3px)'
    opponent.style.filter = 'contrast(1.1)'
    const icon = element()
    const phases: string[] = []
    const revealStates: boolean[] = []
    const sounds: number[] = []
    const waits: number[] = []
    const createItemIcon = vi.fn(() => cast(icon))
    const result = await playHgssBattleCaptureAnimation({
      mode: 'normal',
      itemId: 496,
      shakes: 4,
      caught: true,
      ball: cast(ball),
      opponent: cast(opponent),
      createItemIcon,
      playSoundEffect: (sequenceId) => { sounds.push(sequenceId) },
      playPannedSoundEffect: (sequenceId) => { sounds.push(sequenceId) },
      onPhase: (phase) => {
        phases.push(phase.kind)
        if (['fall', 'shake', 'shake-cooldown', 'pre-click'].includes(phase.kind)) revealStates.push(opponent.hidden)
        if (phase.kind === 'fall') expect(ball.style.filter).toBe('')
      },
      onOutcomeAnimationStart: () => { revealStates.push(opponent.hidden) },
      waitFrames: async (frames) => { waits.push(frames) },
      animateElement: () => undefined,
    })

    expect(result.graphicSource).toBe('item-icon')
    expect(result.plan.ballId).toBe(21)
    expect(createItemIcon).toHaveBeenCalledWith(496)
    expect(ball.dataset).toMatchObject({ romBall: 'true', ballItemId: '496', ballId: '21', ballGraphicSource: 'item-icon' })
    expect(phases).toEqual([
      'throw', 'open', 'fall',
      'shake', 'shake-cooldown', 'shake', 'shake-cooldown', 'shake', 'shake-cooldown',
      'pre-click', 'click',
    ])
    expect(revealStates.every(Boolean)).toBe(true)
    expect(sounds).toEqual([1802, 1800, 1510, 1510, 1511, 1512, 1513, 1533, 1533, 1533, 1801])
    expect(waits.filter((frames) => frames === 14)).toHaveLength(3)
    expect(waits.filter((frames) => frames === 12)).toHaveLength(4)
    expect(opponent.hidden).toBe(true)
    expect(opponent.style).toMatchObject({ opacity: '.9', transform: 'translateX(3px)', filter: 'contrast(1.1)' })
    expect(ball.style.filter).toBe('')
    expect(ball.hidden).toBe(false)
  })

  it('glisse de +32 en 10 frames avant de démarrer les rebonds et leurs sons', async () => {
    const ball = element()
    const opponent = element()
    const animations: Array<{ frames: number, keyframes: Keyframe[] }> = []
    const events: string[] = []
    await playHgssBattleCaptureAnimation({
      mode: 'safari', itemId: 5, shakes: 0, caught: false,
      ball: cast(ball), opponent: cast(opponent), createItemIcon: () => cast(element()),
      waitFrames: async (frames) => { events.push(`wait:${frames}`) },
      playPannedSoundEffect: (sequenceId) => { events.push(`sound:${sequenceId}`) },
      animateElement: (_target, keyframes, frames) => { animations.push({ frames, keyframes }) },
    })
    const throwAnimation = animations.find(({ frames, keyframes }) => frames === 16 && keyframes.length === 17)
    expect(throwAnimation?.keyframes[8]).toMatchObject({ left: '31.640625%', top: '22.916666666666668%', offset: .5 })
    const slide = animations.find(({ frames, keyframes }) => frames === 10 && keyframes.length === 2)
    expect(slide?.keyframes).toEqual([
      expect.objectContaining({ left: '75%', top: '29.166666666666668%' }),
      expect.objectContaining({ left: '87.5%', top: '29.166666666666668%' }),
    ])
    const bounce = animations.find(({ frames }) => frames === 21)
    expect(bounce?.keyframes).toHaveLength(22)
    expect(bounce?.keyframes[0]).toMatchObject({ left: '87.5%', top: '29.166666666666668%' })
    expect(bounce?.keyframes[1]).toMatchObject({ left: '87.5%', top: '25.520833333333332%' })
    expect(bounce?.keyframes.at(-1)).toMatchObject({ left: '87.5%', top: '29.166666666666668%' })
    expect(events.indexOf('wait:10')).toBeLessThan(events.indexOf('sound:1510'))
  })

  it('joue NANR 0 au lancer et NANR 1 à OPEN, mais aucune séquence au CLICK natif', async () => {
    const ball = element()
    const opponent = element()
    const asset = nativeBallAsset()
    const sequenceByPhase: Partial<Record<string, string | undefined>> = {}
    const waitsByPhase: Partial<Record<string, number[]>> = {}
    const widthsByPhase: Partial<Record<string, string[]>> = {}
    let nativeOpenBallAnimationCalls = 0
    let currentPhase = ''
    vi.stubGlobal('document', { createElement: () => cast(element()) })
    try {
      const result = await playHgssBattleCaptureAnimation({
        mode: 'safari', itemId: 5, shakes: 4, caught: true,
        ball: cast(ball), opponent: cast(opponent),
        resolveBallAsset: () => asset,
        createGraphic: () => cast(element()),
        createItemIcon: () => cast(element()),
        onPhase: (phase) => { currentPhase = phase.kind },
        waitFrames: async (frames) => {
          if (['throw', 'open', 'click'].includes(currentPhase)) {
            sequenceByPhase[currentPhase] = ball.children[0]?.dataset.nitroSequence
            ;(waitsByPhase[currentPhase] ??= []).push(frames)
            ;(widthsByPhase[currentPhase] ??= []).push(ball.children[0]?.style.width ?? '')
          }
        },
        animateElement: (target) => {
          if (currentPhase === 'open' && target === cast(ball)) nativeOpenBallAnimationCalls += 1
        },
      })
      expect(result.graphicSource).toBe('ball-sprite')
      expect(sequenceByPhase).toEqual({ throw: '0', open: '1', click: undefined })
      expect(waitsByPhase.throw).toEqual([2, 2, 6, 2, 2, 2])
      expect(waitsByPhase.open).toEqual([10, 10, 3])
      expect(widthsByPhase.open).toEqual(['50%', '50%', '100%'])
      expect(nativeOpenBallAnimationCalls).toBe(0)
      expect(ball.children[0]?.style.width).toBe('50%')
      expect(ball.children[0]?.style.left).toBe('25%')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('force les six cellules d’impact NANR pendant FALL puis revient à la cellule fermée', async () => {
    const ball = element()
    const opponent = element()
    const asset = nativeBallAsset()
    const fallFrames: number[] = []
    let currentPhase = ''
    vi.stubGlobal('document', { createElement: () => cast(element()) })
    try {
      await playHgssBattleCaptureAnimation({
        mode: 'safari', itemId: 5, shakes: 0, caught: false,
        ball: cast(ball), opponent: cast(opponent),
        resolveBallAsset: () => asset,
        createGraphic: () => cast(element()),
        createItemIcon: () => cast(element()),
        onPhase: (phase) => { currentPhase = phase.kind },
        waitFrames: async (frames) => {
          if (currentPhase === 'fall' && frames === 1) {
            const frame = Number(ball.children[0]?.dataset.nitroFrame)
            if (Number.isInteger(frame)) fallFrames.push(frame)
          }
        },
        animateElement: () => undefined,
      })
      expect(fallFrames).toEqual([
        1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1,
      ])
      expect(ball.children[0]?.dataset.nitroSequence).toBeUndefined()
      expect(ball.children[0]?.dataset.nitroCell).toBe('0')
      expect(ball.children[0]?.style.width).toBe('50%')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('déclenche le send-out seulement au breakout et détruit l’ancienne Ball après deux frames', async () => {
    const ball = element()
    const opponent = element()
    const events: string[] = []
    const waits: number[] = []
    await playHgssBattleCaptureAnimation({
      mode: 'safari',
      itemId: 5,
      shakes: 0,
      caught: false,
      ball: cast(ball),
      opponent: cast(opponent),
      createItemIcon: () => cast(element()),
      onPhase: (phase) => { events.push(`phase:${phase.kind}:${opponent.hidden}`) },
      onOutcomeAnimationStart: (outcome) => { events.push(`reveal:${outcome}:${opponent.hidden}`) },
      playPokemonSendOut: (ballId) => { events.push(`sendout:${ballId}`) },
      waitFrames: async (frames) => { waits.push(frames) },
      animateElement: () => undefined,
    })
    expect(events.slice(-3)).toEqual(['phase:breakout:true', 'reveal:breakout:true', 'sendout:5'])
    expect(waits.at(-1)).toBe(2)
    expect(ball.hidden).toBe(true)
    expect(opponent.hidden).toBe(false)
  })

  it('attend les deux sous-états de BALL_ANIM_FADE après le printer', async () => {
    const ball = element()
    const waits: number[] = []
    await fadeHgssCapturedBall({
      ball: cast(ball),
      waitFrames: async (frames) => { waits.push(frames) },
      animateElement: () => undefined,
    })
    expect(waits).toEqual([10, 16])
    expect(ball.hidden).toBe(true)
    expect(ball.style.opacity).toBe('0')
  })

  it('cesse le fade sans masquer la Ball d’une scène plus récente', async () => {
    const ball = element()
    let current = true
    await fadeHgssCapturedBall({
      ball: cast(ball),
      isCurrent: () => current,
      waitFrames: async () => {
        current = false
        ball.style.opacity = 'new-ball'
      },
      animateElement: () => undefined,
    })
    expect(ball.hidden).toBe(false)
    expect(ball.style.opacity).toBe('new-ball')
  })
})
