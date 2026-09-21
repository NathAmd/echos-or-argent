import { describe, expect, it, vi } from 'vitest'
import type { HgssBattleAnimationInstruction, HgssBattleAnimationScript } from '../../rom/battle/battleAnimationScripts'
import type { HgssSplEmitterResource, HgssSplParticleResource } from '../../rom/battle/splParticleResources'
import { HgssSplParticleCanvasPlayback } from './splParticleCanvas'
import {
  decodeConfirmedHgssBattleMotion,
  decodeConfirmedHgssBattleSprite,
  decodeConfirmedHgssGenericEmitterCallback,
  decodeConfirmedHgssPokemonCry,
  decodeConfirmedHgssPannedSoundEffect,
  estimateHgssNativeTaskFrames,
  isConfirmedHgssNoOpNativeFunction,
  playConfirmedHgssBattleAnimation,
  resolveConfirmedHgssGenericEmitterPosition,
  sampleConfirmedHgssAngerSprite,
  sampleConfirmedHgssBackgroundFade,
  sampleConfirmedHgssBattlerFade,
  sampleConfirmedHgssBattlerRevolution,
  sampleConfirmedHgssBattlerScale,
  sampleConfirmedHgssEmitterRevolution,
  sampleConfirmedHgssEmitterTrajectory,
  sampleConfirmedHgssPlayfulHops,
  sampleConfirmedHgssRockBattler,
} from './battleAnimationPlayback'

function callFunc(...operands: number[]): HgssBattleAnimationInstruction {
  return { offsetWords: 0, opcode: 45, name: 'CallFunc', operands: Uint32Array.from(operands) }
}

function instruction(name: string, ...operands: number[]): HgssBattleAnimationInstruction {
  return { offsetWords: 0, opcode: 0, name, operands: Uint32Array.from(operands) }
}

function particleEmitter(overrides: Partial<HgssSplEmitterResource> = {}): HgssSplEmitterResource {
  return {
    id: 0, flags: 0, emissionType: 0, drawType: 0, circleAxis: 0,
    basePosition: [0, 0, 0], emissionCount: 1, radius: 0, length: 0, axis: [0, 0, 0],
    color: 0x7fff, initialVelocityPositionAmplifier: 0, initialVelocityAxisAmplifier: 0,
    baseScale: 1, aspectRatio: 1, startDelayFrames: 0, minimumRotation: 0, maximumRotation: 0,
    initialAngle: 0, emitterLifetimeFrames: 1, particleLifetimeFrames: 1,
    randomAttenuation: { baseScale: 0, lifetime: 0, initialVelocity: 0 }, emissionIntervalFrames: 1,
    baseAlpha: 31, airResistance: 208, textureIndex: 0, loopFrames: 1, doubleBillboardScale: 0,
    textureTileCountS: 0, textureTileCountT: 0, scaleAnimationDirection: 0, faceEmitter: false,
    flipTextureS: false, flipTextureT: false, polygonX: 1, polygonY: 1, userFlags: 0, behaviors: [],
    ...overrides,
  }
}

describe('HGSS confirmed battle animation playback', () => {
  it('decodes the official Tackle MoveBattler function including signed offsets', () => {
    expect(decodeConfirmedHgssBattleMotion(callFunc(57, 4, 2, 14, 0xfffffff8, 0x102))).toEqual({
      kind: 'moveBattler',
      frames: 2,
      offsetX: 14,
      offsetY: -8,
      target: 0x102,
    })
  })

  it('decode les deux fonctions MoveBattlerX équivalentes et leur cible partenaire', () => {
    expect(decodeConfirmedHgssBattleMotion(callFunc(51, 3, 1, 8, 0x108))).toEqual({
      kind: 'moveBattlerX', frames: 1, offsetX: 8, target: 0x108,
    })
    expect(decodeConfirmedHgssBattleMotion(callFunc(52, 3, 4, 0xffffffec, 0x110))).toEqual({
      kind: 'moveBattlerX', frames: 4, offsetX: -20, target: 0x110,
    })
  })

  it('decodes the official Tackle defender shake function', () => {
    expect(decodeConfirmedHgssBattleMotion(callFunc(36, 5, 1, 0, 1, 2, 0x108))).toEqual({
      kind: 'shake',
      extentX: 1,
      extentY: 0,
      interval: 1,
      amount: 2,
      targets: 0x108,
    })
  })

  it('décode ScaleBattlerSprite et reproduit son interpolation fixe', () => {
    const scale = decodeConfirmedHgssBattleMotion(callFunc(
      42, 8, 0x102, 100, 120, 100, 80, 100, 0x00020002, 0x00020002,
    ))
    expect(scale).toEqual({
      kind: 'scaleBattlerSprite', target: 0x102,
      startX: 100, endX: 120, startY: 100, endY: 80, reference: 100,
      cycles: 2, holdFrames: 2, scaleFrames: 2, restoreFrames: 2,
    })
    if (scale?.kind !== 'scaleBattlerSprite') throw new Error('Mise à l’échelle HGSS absente.')
    expect(sampleConfirmedHgssBattlerScale(scale, 0)).toEqual({
      scaleX: 281 / 256, scaleY: 230 / 256, complete: false,
    })
    expect(sampleConfirmedHgssBattlerScale(scale, 1)).toEqual({
      scaleX: 307 / 256, scaleY: 204 / 256, complete: false,
    })
    expect(sampleConfirmedHgssBattlerScale(scale, 5)).toEqual({
      scaleX: 281 / 256, scaleY: 230 / 256, complete: false,
    })
  })

  it('conserve le bug natif du hold appliqué uniquement au premier cycle', () => {
    const scale = decodeConfirmedHgssBattleMotion(callFunc(
      42, 8, 0x108, 100, 120, 100, 80, 100, 0x00020002, 0x00020002,
    ))
    if (scale?.kind !== 'scaleBattlerSprite') throw new Error('Mise à l’échelle HGSS absente.')
    expect(sampleConfirmedHgssBattlerScale(scale, 10)).toMatchObject({ scaleX: 307 / 256, scaleY: 204 / 256, complete: false })
    expect(sampleConfirmedHgssBattlerScale(scale, 11)).toMatchObject({ scaleX: 281 / 256, scaleY: 230 / 256, complete: false })
    expect(sampleConfirmedHgssBattlerScale(scale, 14)).toEqual({ scaleX: 1, scaleY: 1, complete: true })
  })

  it('reproduit l’ellipse fixe et le retour final de RevolveBattler', () => {
    const revolution = decodeConfirmedHgssBattleMotion(callFunc(60, 3, 2, 1, 10))
    expect(revolution).toEqual({
      kind: 'revolveBattler', target: 2, revolutions: 1, framesPerRevolution: 10,
    })
    if (revolution?.kind !== 'revolveBattler') throw new Error('Révolution de battler HGSS absente.')
    expect(sampleConfirmedHgssBattlerRevolution(revolution, 0)).toEqual({ offsetX: 9, offsetY: 4, complete: false })
    expect(sampleConfirmedHgssBattlerRevolution(revolution, 4)).toEqual({ offsetX: 0, offsetY: 12, complete: false })
    expect(sampleConfirmedHgssBattlerRevolution(revolution, 10)).toEqual({ offsetX: 0, offsetY: 0, complete: true })
  })

  it('reproduit les quatre bonds inclinés et alternés de PlayfulHops', () => {
    expect(decodeConfirmedHgssBattleMotion(callFunc(25, 0))).toEqual({ kind: 'playfulHops', target: 'attacker' })
    expect(decodeConfirmedHgssBattleMotion(callFunc(25, 1, 1))).toEqual({ kind: 'playfulHops', target: 'defender' })
    expect(decodeConfirmedHgssBattleMotion(callFunc(25, 1, 2))).toBeUndefined()
    expect(estimateHgssNativeTaskFrames(callFunc(25, 0))).toBe(33)
    expect(sampleConfirmedHgssPlayfulHops(0, 1)).toEqual({
      offsetY: 0, rotationIndex: 910, pivotX: -16, pivotY: 50, complete: false,
    })
    expect(sampleConfirmedHgssPlayfulHops(2, 1)).toMatchObject({ offsetY: 2, rotationIndex: 2730 })
    expect(sampleConfirmedHgssPlayfulHops(3, 1)).toMatchObject({ offsetY: 2, rotationIndex: 2730 })
    expect(sampleConfirmedHgssPlayfulHops(7, 1)).toMatchObject({ offsetY: 0, rotationIndex: 0 })
    expect(sampleConfirmedHgssPlayfulHops(8, 1)).toMatchObject({ rotationIndex: -910, pivotX: 16 })
    expect(sampleConfirmedHgssPlayfulHops(33, 1)).toMatchObject({ complete: true })
  })

  it('does not reinterpret an unconfirmed function', () => {
    expect(decodeConfirmedHgssBattleMotion(callFunc(58, 1, 3))).toBeUndefined()
  })

  it('reproduit le premier pas immédiat et les angles fixes de RevolveEmitter', () => {
    const revolution = decodeConfirmedHgssBattleMotion(callFunc(72, 10, 3, 90, 90, 90, 90, 48, 24, 7, 0, 2))
    expect(revolution).toEqual({
      kind: 'revolveEmitter', emitterId: 3,
      startX: 90, endX: 90, startY: 90, endY: 90,
      radiusX: 48, radiusY: 24, frames: 7, battlerMode: 0, particleSystemIndex: 2,
    })
    if (revolution?.kind !== 'revolveEmitter') throw new Error("Révolution d'émetteur HGSS absente.")
    expect(sampleConfirmedHgssEmitterRevolution(revolution, 0, [1, 2, 3])).toEqual({
      position: [1 + 48 * 172 / 4096, 2, 3],
      complete: false,
    })
    expect(sampleConfirmedHgssEmitterRevolution(revolution, 7, [1, 2, 3])).toMatchObject({ complete: true })
  })

  it('conserve la division entière native sur une révolution presque complète', () => {
    const revolution = decodeConfirmedHgssBattleMotion(callFunc(72, 10, 0, 0, 360, 0, 360, 64, 48, 40, 1, 0))
    if (revolution?.kind !== 'revolveEmitter') throw new Error("Révolution d'émetteur HGSS absente.")
    const first = sampleConfirmedHgssEmitterRevolution(revolution, 0, [0, 0, 0])
    const last = sampleConfirmedHgssEmitterRevolution(revolution, 39, [0, 0, 0])
    expect(first.position).toEqual([9 * 172 / 4096, 47 * 172 / 4096, 0])
    expect(last.position).toEqual([-172 / 4096, 48 * 172 / 4096, 0])
  })

  it('décode les variables zéro-complétées et le système courant des trajectoires d’émetteur', () => {
    expect(decodeConfirmedHgssBattleMotion(callFunc(65, 6, 2, 0, 0, 0, 10, 64), 3)).toEqual({
      kind: 'moveEmitter', trajectory: 'linear', emitterId: 2,
      offsetX: 0, offsetY: 0, startDelay: 0, frames: 10, radius: 64,
      battlerMode: 0, skipFrames: 0, maxFrames: 0xff, curve: false, particleSystemIndex: 3,
    })
    expect(decodeConfirmedHgssBattleMotion(callFunc(66, 7, 0, 0, 0, 0, 12, 32, 1), 1)).toMatchObject({
      kind: 'moveEmitter', trajectory: 'parabolic', battlerMode: 1, radius: 32, particleSystemIndex: 1,
    })
    expect(decodeConfirmedHgssBattleMotion(callFunc(65, 6, 0, 0, 0, 0, 10, 64))).toBeUndefined()
  })

  it('reproduit le délai, le pas fixe et le gel maxFrames de la trajectoire linéaire', () => {
    const linear = decodeConfirmedHgssBattleMotion(callFunc(65, 8, 0, 0, 0, 2, 4, 64, 0, 0), 0)
    if (linear?.kind !== 'moveEmitter') throw new Error("Trajectoire linéaire d'émetteur HGSS absente.")
    const attacker = [0, 0, 0] as const
    const defender = [40 * 172 / 4096, 20 * 172 / 4096, 0] as const
    expect(sampleConfirmedHgssEmitterTrajectory(linear, 2, attacker, defender, 'player').position).toEqual([0, 0])
    expect(sampleConfirmedHgssEmitterTrajectory(linear, 3, attacker, defender, 'player').position).toEqual([10 * 172 / 4096, 5 * 172 / 4096])
    expect(sampleConfirmedHgssEmitterTrajectory(linear, 7, attacker, defender, 'player')).toMatchObject({
      position: [40 * 172 / 4096, 20 * 172 / 4096], complete: true,
    })

    const frozen = decodeConfirmedHgssBattleMotion(callFunc(65, 8, 0, 0, 0, 0, 8, 64, 0, 0x00020003), 0)
    if (frozen?.kind !== 'moveEmitter') throw new Error("Trajectoire linéaire bornée HGSS absente.")
    expect(sampleConfirmedHgssEmitterTrajectory(frozen, 0, attacker, defender, 'player').position)
      .toEqual([10 * 172 / 4096, 5 * 172 / 4096])
    expect(sampleConfirmedHgssEmitterTrajectory(frozen, 9, attacker, defender, 'player').position)
      .toEqual([10 * 172 / 4096, 5 * 172 / 4096])

    const skipOnly = decodeConfirmedHgssBattleMotion(callFunc(65, 8, 0, 0, 0, 0, 8, 64, 0, 0x00040000), 0)
    if (skipOnly?.kind !== 'moveEmitter') throw new Error("Trajectoire linéaire pré-avancée HGSS absente.")
    expect(sampleConfirmedHgssEmitterTrajectory(skipOnly, 9, attacker, defender, 'player').position)
      .toEqual([20 * 172 / 4096, 10 * 172 / 4096])
  })

  it('reproduit la parabole native et ignore son startDelay inutilisé', () => {
    const parabolic = decodeConfirmedHgssBattleMotion(callFunc(66, 7, 0, 0, 0, 7, 4, 32, 0), 0)
    if (parabolic?.kind !== 'moveEmitter') throw new Error("Trajectoire parabolique d'émetteur HGSS absente.")
    const attacker = [0, 0, 0] as const
    const defender = [40 * 172 / 4096, 0, 0] as const
    const first = sampleConfirmedHgssEmitterTrajectory(parabolic, 1, attacker, defender, 'player')
    expect(first.position[0]).toBe(10 * 172 / 4096)
    expect(first.position[1]).toBeGreaterThan(0)
    expect(sampleConfirmedHgssEmitterTrajectory(parabolic, 5, attacker, defender, 'player')).toMatchObject({ complete: true })
  })

  it('adresse une trajectoire native à la poignée CreateEmitterEx du système courant', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', { setTimeout })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 17))
    vi.stubGlobal('cancelAnimationFrame', (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer))
    const setPosition = vi.spyOn(HgssSplParticleCanvasPlayback.prototype, 'setEmitterAbsolutePosition')
    try {
      const rect = (left: number) => ({ left, top: 20, width: 32, height: 32, right: left + 32, bottom: 52, x: left, y: 20, toJSON: () => ({}) })
      const battler = (left: number) => ({
        style: { animation: '', transform: '', transformOrigin: '', visibility: '', filter: '' },
        getBoundingClientRect: () => rect(left),
      }) as unknown as HTMLElement
      const context = { imageSmoothingEnabled: true, clearRect: vi.fn() } as unknown as CanvasRenderingContext2D
      const canvas = {
        width: 0, height: 0,
        getContext: () => context,
        getBoundingClientRect: () => rect(0),
      } as unknown as HTMLCanvasElement
      const resource: HgssSplParticleResource = {
        memberId: 88,
        version: 'test',
        emitters: [particleEmitter({ id: 0 }), particleEmitter({ id: 1 })],
        textures: [],
      }
      const onDiagnostic = vi.fn()
      const playback = playConfirmedHgssBattleAnimation({
        id: 912,
        byteLength: 24,
        words: new Uint32Array(6),
        instructions: [
          instruction('LoadParticleSystem', 2, 88),
          instruction('CreateEmitterEx', 2, 7, 1, 3),
          callFunc(65, 6, 7, 0, 0, 0, 4, 64),
          instruction('WaitForAnimTasks'),
          instruction('WaitForAllEmitters'),
          instruction('End'),
        ],
      }, 'player', {
        player: battler(32),
        opponent: battler(192),
        effects: canvas,
      }, undefined, () => resource, { onDiagnostic })

      await vi.runAllTimersAsync()
      await playback

      expect(setPosition).toHaveBeenCalled()
      expect(setPosition.mock.calls.every(([particleSystemIndex, emitterId]) => particleSystemIndex === 2 && emitterId === 7)).toBe(true)
      expect(onDiagnostic).not.toHaveBeenCalled()
    } finally {
      setPosition.mockRestore()
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })

  it('reconnaît la fonction native 0 comme un no-op sans fallback', async () => {
    const nativeNoOp = callFunc(0, 0)
    const onDiagnostic = vi.fn()
    const element = { style: { transform: '' } } as unknown as HTMLElement
    expect(isConfirmedHgssNoOpNativeFunction(nativeNoOp)).toBe(true)
    await playConfirmedHgssBattleAnimation({
      id: 907, byteLength: 12, words: new Uint32Array(3), instructions: [nativeNoOp, instruction('End')],
    }, 'player', { player: element, opponent: element }, undefined, undefined, { onDiagnostic })
    expect(onDiagnostic).not.toHaveBeenCalled()
  })

  it('decodes the three-frame Pokemon sprite render task used by Scratch', () => {
    expect(decodeConfirmedHgssBattleMotion(callFunc(78, 1, 0))).toEqual({
      kind: 'renderPokemonSprites',
      frames: 3,
    })
  })

  it('masque et réaffiche les battlers ciblés par la fonction native 40', async () => {
    const visibilityWrites = new Map<string, string[]>()
    const battler = (name: string) => {
      const writes: string[] = []
      visibilityWrites.set(name, writes)
      let visibility = ''
      const style = { animation: '', transform: '', transformOrigin: '' } as CSSStyleDeclaration
      Object.defineProperty(style, 'visibility', {
        get: () => visibility,
        set: (value: string) => { visibility = value; writes.push(value) },
      })
      return { style } as HTMLElement
    }
    const player = battler('player')
    const opponent = battler('opponent')
    const opponentPartner = battler('opponentPartner')
    const onDiagnostic = vi.fn()
    expect(decodeConfirmedHgssBattleMotion(callFunc(40, 2, 2, 1))).toEqual({
      kind: 'setBattlerVisibility',
      hidden: true,
      targets: 2,
    })

    await playConfirmedHgssBattleAnimation({
      id: 908,
      byteLength: 40,
      words: new Uint32Array(10),
      instructions: [
        callFunc(40, 2, 2, 1),
        callFunc(40, 2, 8, 1),
        callFunc(40, 2, 16, 1),
        callFunc(40, 2, 2 | 8 | 16, 0),
        instruction('End'),
      ],
    }, 'player', {
      player,
      opponent,
      additionalDefenders: [opponent, opponentPartner],
    }, undefined, undefined, { onDiagnostic })

    expect(visibilityWrites.get('player')).toEqual(['hidden', '', ''])
    expect(visibilityWrites.get('opponent')).toEqual(['hidden', '', ''])
    expect(visibilityWrites.get('opponentPartner')).toEqual(['hidden', '', ''])
    expect(onDiagnostic).not.toHaveBeenCalled()
  })

  it('reproduit le nombre et le rythme natifs de BlinkAttacker', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', { setTimeout })
    try {
      const writes: string[] = []
      let visibility = ''
      const style = { animation: '', transform: '', transformOrigin: '' } as CSSStyleDeclaration
      Object.defineProperty(style, 'visibility', {
        get: () => visibility,
        set: (value: string) => { visibility = value; writes.push(value) },
      })
      const player = { style } as HTMLElement
      const opponent = { style: { animation: '', transform: '', transformOrigin: '', visibility: '' } } as unknown as HTMLElement
      const blink = callFunc(50, 2, 2, 0)
      const onDiagnostic = vi.fn()
      expect(decodeConfirmedHgssBattleMotion(blink)).toEqual({ kind: 'blinkAttacker', count: 2, interval: 0 })

      const playback = playConfirmedHgssBattleAnimation({
        id: 909,
        byteLength: 12,
        words: new Uint32Array(3),
        instructions: [blink, instruction('WaitForAnimTasks'), instruction('End')],
      }, 'player', { player, opponent }, undefined, undefined, { onDiagnostic })
      await vi.runAllTimersAsync()
      await playback

      expect(writes.filter((value) => value === 'hidden')).toHaveLength(2)
      expect(writes.at(-1)).toBe('')
      expect(onDiagnostic).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })

  it('décode et échantillonne les cycles natifs de FadeBattlerSprite', () => {
    const motion = decodeConfirmedHgssBattleMotion(callFunc(34, 6, 8, 0, 2, 0x7fff, 2, 1))
    expect(motion).toEqual({
      kind: 'fadeBattlerSprite', target: 8, fadeStepFrames: 0, cycles: 2, color: 0x7fff, alpha: 2, holdFrames: 1,
    })
    if (motion?.kind !== 'fadeBattlerSprite') throw new Error('Fondu HGSS absent.')
    expect(sampleConfirmedHgssBattlerFade(motion, 0)).toEqual({ alpha: 0, complete: false })
    expect(sampleConfirmedHgssBattlerFade(motion, 1).alpha).toBe(1)
    expect(sampleConfirmedHgssBattlerFade(motion, 2).alpha).toBe(2)
    expect(sampleConfirmedHgssBattlerFade(motion, 6).alpha).toBe(1)
    expect(sampleConfirmedHgssBattlerFade(motion, 8).alpha).toBe(0)
    expect(sampleConfirmedHgssBattlerFade(motion, 16).alpha).toBe(0)
    expect(sampleConfirmedHgssBattlerFade(motion, 17)).toEqual({ alpha: 0, complete: true })
    expect(estimateHgssNativeTaskFrames(callFunc(34, 6, 8, 0, 2, 0x7fff, 2, 1))).toBe(17)
  })

  it('applique FadeBattlerSprite à la cible native et restaure son filtre', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', { setTimeout })
    vi.stubGlobal('getComputedStyle', () => ({ filter: 'drop-shadow(rgb(0, 0, 0) 0px 1px 1px)' }))
    try {
      const filters: string[] = []
      let filter = ''
      const style = { animation: '', transform: '', transformOrigin: '', visibility: '' } as CSSStyleDeclaration
      Object.defineProperty(style, 'filter', {
        get: () => filter,
        set: (value: string) => { filter = value; filters.push(value) },
      })
      const player = { style } as HTMLElement
      const opponent = { style: { animation: '', transform: '', transformOrigin: '', visibility: '', filter: '' } } as unknown as HTMLElement
      const onDiagnostic = vi.fn()
      const fade = callFunc(34, 5, 2, 0, 1, 0x001f, 2)
      const playback = playConfirmedHgssBattleAnimation({
        id: 910,
        byteLength: 12,
        words: new Uint32Array(3),
        instructions: [fade, instruction('WaitForAnimTasks'), instruction('End')],
      }, 'player', { player, opponent }, undefined, undefined, { onDiagnostic })
      await vi.runAllTimersAsync()
      await playback

      expect(filters.some((value) => value.includes('feColorMatrix') && value.includes('drop-shadow'))).toBe(true)
      expect(filter).toBe('')
      expect(onDiagnostic).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })

  it('reproduit les pas accélérés des délais négatifs de FadeBg', () => {
    const motion = decodeConfirmedHgssBattleMotion(callFunc(33, 5, 0, 0xfffffffe, 0, 12, 0x7fff))
    expect(motion).toEqual({ kind: 'fadeBackground', delay: -2, startAlpha: 0, endAlpha: 12, color: 0x7fff })
    if (motion?.kind !== 'fadeBackground') throw new Error('Fondu de fond HGSS absent.')
    expect(sampleConfirmedHgssBackgroundFade(motion, 0).alpha).toBe(0)
    expect(sampleConfirmedHgssBackgroundFade(motion, 1).alpha).toBe(4)
    expect(sampleConfirmedHgssBackgroundFade(motion, 2).alpha).toBe(8)
    expect(sampleConfirmedHgssBackgroundFade(motion, 3).alpha).toBe(12)
    expect(sampleConfirmedHgssBackgroundFade(motion, 4)).toEqual({ alpha: 12, complete: true })
    expect(estimateHgssNativeTaskFrames(callFunc(33, 5, 0, 0xfffffffe, 0, 12, 0x7fff))).toBe(4)
    expect(decodeConfirmedHgssBattleMotion(callFunc(33, 5, 2, 0xfffffffc, 0, 12, 0x7fff))).toBeUndefined()
  })

  it('applique FadeBg au décor sans teinter les battlers', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', { setTimeout })
    vi.stubGlobal('getComputedStyle', () => ({ filter: 'none' }))
    try {
      const player = { style: { animation: '', transform: '', transformOrigin: '', visibility: '', filter: '' } } as unknown as HTMLElement
      const opponent = { style: { animation: '', transform: '', transformOrigin: '', visibility: '', filter: '' } } as unknown as HTMLElement
      const background = { style: { filter: '' } } as HTMLElement
      const onDiagnostic = vi.fn()
      const playback = playConfirmedHgssBattleAnimation({
        id: 911,
        byteLength: 12,
        words: new Uint32Array(3),
        instructions: [callFunc(33, 5, 0, 0, 0, 4, 0x001f), instruction('WaitForAnimTasks'), instruction('End')],
      }, 'player', { player, opponent, background }, undefined, undefined, { onDiagnostic })
      await vi.runAllTimersAsync()
      await playback

      expect(background.style.filter).toBe('')
      expect(player.style.filter).toBe('')
      expect(opponent.style.filter).toBe('')
      expect(onDiagnostic).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })

  it('bascule les palettes du fond en niveaux de gris sans toucher aux battlers', async () => {
    expect(decodeConfirmedHgssBattleMotion(callFunc(74, 1, 1))).toEqual({
      kind: 'setBackgroundGrayscale', enabled: true,
    })
    expect(decodeConfirmedHgssBattleMotion(callFunc(74, 1, 2))).toBeUndefined()
    vi.useFakeTimers()
    vi.stubGlobal('window', { setTimeout })
    vi.stubGlobal('getComputedStyle', () => ({ filter: 'sepia(1)' }))
    try {
      const filters: string[] = []
      let filter = ''
      const backgroundStyle = {} as CSSStyleDeclaration
      Object.defineProperty(backgroundStyle, 'filter', {
        get: () => filter,
        set: (value: string) => { filter = value; filters.push(value) },
      })
      const background = { style: backgroundStyle } as HTMLElement
      const player = { style: { animation: '', transform: '', transformOrigin: '', visibility: '', filter: '' } } as unknown as HTMLElement
      const opponent = { style: { animation: '', transform: '', transformOrigin: '', visibility: '', filter: '' } } as unknown as HTMLElement
      const onDiagnostic = vi.fn()
      const playback = playConfirmedHgssBattleAnimation({
        id: 913,
        byteLength: 16,
        words: new Uint32Array(4),
        instructions: [callFunc(74, 1, 1), instruction('Delay', 1), callFunc(74, 1, 0), instruction('End')],
      }, 'player', { player, opponent, background }, undefined, undefined, { onDiagnostic })
      await vi.runAllTimersAsync()
      await playback

      expect(filters).toContain('sepia(1) grayscale(1)')
      expect(filters).toContain('sepia(1)')
      expect(player.style.filter).toBe('')
      expect(opponent.style.filter).toBe('')
      expect(filter).toBe('')
      expect(onDiagnostic).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })

  it('decode et échantillonne le balancement ROM de BATTLE_ANIMATION_EATING', () => {
    const motion = decodeConfirmedHgssBattleMotion(callFunc(4, 6, 0xffff, 66445, 10, 2, 0, 32))
    expect(motion).toEqual({ kind: 'rockBattler', startRotation: 0xffff, endRotation: 66445, framesPerLeg: 10 })
    if (motion?.kind !== 'rockBattler') throw new Error('Balancement HGSS absent.')
    expect(sampleConfirmedHgssRockBattler(motion, 'player', 0)).toEqual({ rotationIndex: 0, pivotX: -40, pivotY: 40, complete: false })
    expect(sampleConfirmedHgssRockBattler(motion, 'player', 1).rotationIndex).toBe(90)
    expect(sampleConfirmedHgssRockBattler(motion, 'player', 10).rotationIndex).toBe(909)
    expect(sampleConfirmedHgssRockBattler(motion, 'player', 11).rotationIndex).toBe(909)
    expect(sampleConfirmedHgssRockBattler(motion, 'player', 12).rotationIndex).toBe(818)
    expect(sampleConfirmedHgssRockBattler(motion, 'player', 21).rotationIndex).toBe(-1)
    expect(sampleConfirmedHgssRockBattler(motion, 'player', 22).rotationIndex).toBe(-1)
    expect(sampleConfirmedHgssRockBattler(motion, 'player', 23)).toEqual({ rotationIndex: 0, pivotX: 0, pivotY: 0, complete: true })
    expect(sampleConfirmedHgssRockBattler(motion, 'opponent', 1)).toMatchObject({ rotationIndex: -92, pivotX: 40 })
    expect(sampleConfirmedHgssRockBattler(motion, 'opponent', 10).rotationIndex).toBe(-911)
    expect(sampleConfirmedHgssRockBattler(motion, 'opponent', 12).rotationIndex).toBe(-820)
  })

  it('decode le vrai OBJ ROM et les deux pulsations du callback colère 10', () => {
    const sprite = decodeConfirmedHgssBattleSprite(instruction('AddSpriteWithFunc', 0, 10, 11, 11, 11, 11, 0, 0, 0))
    expect(sprite).toEqual({
      kind: 'anger',
      managerId: 0,
      callbackId: 10,
      resource: { characterMemberId: 11, paletteMemberId: 11, cellMemberId: 11, animationMemberId: 11 },
    })
    expect(sampleConfirmedHgssAngerSprite('player', 0).visible).toBe(false)
    expect(sampleConfirmedHgssAngerSprite('player', 1)).toMatchObject({ visible: true, offsetX: 24, offsetY: -16, scale: 1 })
    expect(sampleConfirmedHgssAngerSprite('opponent', 1)).toMatchObject({ visible: true, offsetX: -24, offsetY: -16 })
    expect(sampleConfirmedHgssAngerSprite('player', 5).scale).toBe(358 / 256)
    expect(sampleConfirmedHgssAngerSprite('player', 7).scale).toBe(332 / 256)
    expect(sampleConfirmedHgssAngerSprite('player', 8).scale).toBe(307 / 256)
    expect(sampleConfirmedHgssAngerSprite('player', 9).visible).toBe(false)
    expect(sampleConfirmedHgssAngerSprite('player', 14)).toMatchObject({ visible: true, offsetX: -24, offsetY: -24, scale: 1 })
    expect(sampleConfirmedHgssAngerSprite('player', 21)).toMatchObject({ visible: true, scale: 307 / 256 })
    expect(sampleConfirmedHgssAngerSprite('player', 22).visible).toBe(false)
    expect(sampleConfirmedHgssAngerSprite('player', 24).complete).toBe(true)
  })

  it('attend la tâche OBJ colère et libère son rendu', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', { setTimeout })
    try {
      const script: HgssBattleAnimationScript = {
        id: 29,
        byteLength: 44,
        words: new Uint32Array(11),
        instructions: [
          instruction('AddSpriteWithFunc', 0, 10, 11, 11, 11, 11, 0, 0, 0),
          instruction('WaitForAnimTasks'),
          instruction('End'),
        ],
      }
      const player = { style: { animation: '', transform: '', transformOrigin: '' } } as unknown as HTMLElement
      const opponent = { style: { animation: '', transform: '', transformOrigin: '' } } as unknown as HTMLElement
      const samples: ReturnType<typeof sampleConfirmedHgssAngerSprite>[] = []
      const destroy = vi.fn()
      const resolveResource = vi.fn(() => ({
        characterMemberId: 11,
        paletteMemberId: 11,
        cellMemberId: 11,
        cellFrameIndex: 0,
        animationMemberId: 11,
        graphic: { width: 32, height: 32, pixels: new Uint8ClampedArray(32 * 32 * 4), graphicsOffset: 0, paletteOffset: 0, colorDepth: 4 as const },
      }))
      const playback = playConfirmedHgssBattleAnimation(
        script,
        'player',
        { player, opponent },
        undefined,
        undefined,
        {},
        {
          resolveResource,
          createSprite: (_resource, side, target) => {
            expect(side).toBe('opponent')
            expect(target).toBe(opponent)
            return { render: (sample) => { samples.push(sample) }, destroy }
          },
        },
      )
      await vi.runAllTimersAsync()
      await playback
      expect(resolveResource).toHaveBeenCalledWith({ characterMemberId: 11, paletteMemberId: 11, cellMemberId: 11, animationMemberId: 11 })
      expect(samples).toHaveLength(25)
      expect(samples[1]).toMatchObject({ visible: true, offsetX: 24, offsetY: -16 })
      expect(samples[24]).toMatchObject({ visible: false, complete: true })
      expect(destroy).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })

  it('rend une attaque de zone sur chaque défenseur sans dupliquer son audio', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', {
      setTimeout,
      requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 17),
    })
    try {
      const transformWrites = new Map<string, string[]>()
      const battler = (name: string) => {
        const writes: string[] = []
        transformWrites.set(name, writes)
        let transform = ''
        const style = { animation: 'float', transformOrigin: '' } as CSSStyleDeclaration
        Object.defineProperty(style, 'transform', {
          get: () => transform,
          set: (value: string) => { transform = value; writes.push(value) },
        })
        return { style } as HTMLElement
      }
      const player = battler('player')
      const opponent = battler('opponent')
      const secondOpponent = battler('secondOpponent')
      const playSoundEffect = vi.fn(async () => undefined)
      const createdOn: HTMLElement[] = []
      const destroyed: Array<ReturnType<typeof vi.fn>> = []
      const script: HgssBattleAnimationScript = {
        id: 905,
        byteLength: 20,
        words: new Uint32Array(5),
        instructions: [
          instruction('PlaySoundEffect', 1908),
          callFunc(36, 5, 1, 0, 1, 1, 0x108),
          instruction('AddSpriteWithFunc', 0, 10, 11, 11, 11, 11, 0, 0, 0),
          instruction('WaitForAnimTasks'),
          instruction('End'),
        ],
      }
      const playback = playConfirmedHgssBattleAnimation(
        script,
        'player',
        { player, opponent, additionalDefenders: [secondOpponent, opponent] },
        {
          playSoundEffect,
          playPannedSoundEffect: async () => undefined,
          stopSoundEffect: vi.fn(),
          playPokemonCry: async () => undefined,
          isPokemonCryPlaying: () => false,
        },
        undefined,
        {},
        {
          resolveResource: () => ({
            characterMemberId: 11, paletteMemberId: 11, cellMemberId: 11, cellFrameIndex: 0, animationMemberId: 11,
            graphic: { width: 1, height: 1, pixels: new Uint8ClampedArray(4), graphicsOffset: 0, paletteOffset: 0, colorDepth: 4 },
          }),
          createSprite: (_resource, _side, target) => {
            createdOn.push(target)
            const destroy = vi.fn()
            destroyed.push(destroy)
            return { render: vi.fn(), destroy }
          },
        },
      )
      await vi.runAllTimersAsync()
      await playback

      expect(playSoundEffect).toHaveBeenCalledTimes(1)
      expect(createdOn).toEqual([opponent, secondOpponent])
      expect(destroyed.every((destroy) => destroy.mock.calls.length === 1)).toBe(true)
      expect(transformWrites.get('opponent')!.some((value) => value.includes('translate(1.25%'))).toBe(true)
      expect(transformWrites.get('secondOpponent')!.some((value) => value.includes('translate(1.25%'))).toBe(true)
      expect(transformWrites.get('player')).toEqual([''])
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })

  it('termine une attente native dès que la présentation est accélérée', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', { setTimeout })
    try {
      const controller = new AbortController()
      const element = { style: { animation: '', transform: '', transformOrigin: '' } } as unknown as HTMLElement
      const playback = playConfirmedHgssBattleAnimation({
        id: 901, byteLength: 12, words: new Uint32Array(3),
        instructions: [instruction('Delay', 600), instruction('End')],
      }, 'player', { player: element, opponent: element }, undefined, undefined, { signal: controller.signal })
      controller.abort()
      await expect(playback).resolves.toBeUndefined()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })

  it('consumes the two official inline parameter blocks used by Leer callback 17', () => {
    const instructions = [
      instruction('CreateEmitter', 0, 0, 17),
      instruction('SetExtraParams', 6, 0, 1, 5, 0, 0, 0),
      instruction('SetExtraParams', 4, 0, 0xffffefe0, 0, 0),
    ]
    expect(decodeConfirmedHgssGenericEmitterCallback(instructions, 0)).toEqual({
      consumedInstructions: 2,
      disableSideFlip: false,
      offsetFx32: [-4128, 0, 0],
    })
  })

  it('mirrors the official Leer eye offset from the defender side', () => {
    const callback = {
      consumedInstructions: 2 as const,
      disableSideFlip: false,
      offsetFx32: [-4128, 0, 0] as const,
    }
    expect(resolveConfirmedHgssGenericEmitterPosition(callback, 'player')).toEqual([
      -2.3477 + 4128 / 4096,
      -1.334,
      0.0156,
    ])
    expect(resolveConfirmedHgssGenericEmitterPosition(callback, 'opponent')).toEqual([
      2.6992 - 4128 / 4096,
      1.0742,
      -1.2812,
    ])
  })

  it('applies callback offsets to the responsive battler anchor', () => {
    const callback = {
      consumedInstructions: 2 as const,
      disableSideFlip: true,
      offsetFx32: [0, 8256, 0] as const,
    }
    expect(resolveConfirmedHgssGenericEmitterPosition(callback, 'opponent', [4, 5, 6])).toEqual([
      4,
      5 + 8256 / 4096,
      6,
    ])
  })

  it('keeps unsupported generic callback layouts disabled', () => {
    const instructions = [
      instruction('CreateEmitter', 0, 0, 17),
      instruction('SetExtraParams', 6, 0, 1, 4, 0, 0, 0),
      instruction('SetExtraParams', 4, 0, 0xffffefe0, 0, 0),
    ]
    expect(decodeConfirmedHgssGenericEmitterCallback(instructions, 0)).toBeUndefined()
  })

  it('decodes Growl cries and reverses their pan for an opposing attacker', () => {
    const growlCry = instruction('PlayPokemonCry', 9, 0xffffff8b, 100)
    expect(decodeConfirmedHgssPokemonCry(growlCry, 'player')).toEqual({ modulation: 9, pan: -117, volume: 100 })
    expect(decodeConfirmedHgssPokemonCry(growlCry, 'opponent')).toEqual({ modulation: 9, pan: 117, volume: 100 })
  })

  it('decodes the official Scratch sound pan on both battle sides', () => {
    const scratchSound = instruction('PlayPannedSoundEffect', 1908, 117)
    expect(decodeConfirmedHgssPannedSoundEffect(scratchSound, 'player')).toEqual({ sequenceId: 1908, pan: 117 })
    expect(decodeConfirmedHgssPannedSoundEffect(scratchSound, 'opponent')).toEqual({ sequenceId: 1908, pan: -117 })
  })

  it('déplace le panoramique sonore ROM entre attaquant et défenseur', async () => {
    const playMovingSoundEffect = vi.fn(async () => undefined)
    const onDiagnostic = vi.fn()
    const element = { style: { transform: '' } } as unknown as HTMLElement
    const script: HgssBattleAnimationScript = {
      id: 906,
      byteLength: 28,
      words: new Uint32Array(7),
      instructions: [instruction('PlayMovingSoundEffectAtkDef', 1954, 0xffffff8b, 117, 4, 2), instruction('End')],
    }

    await playConfirmedHgssBattleAnimation(script, 'opponent', { player: element, opponent: element }, {
      playSoundEffect: async () => undefined,
      playPannedSoundEffect: async () => undefined,
      playMovingSoundEffect,
      stopSoundEffect: vi.fn(),
      playPokemonCry: async () => undefined,
      isPokemonCryPlaying: () => false,
    }, undefined, { onDiagnostic })

    expect(playMovingSoundEffect).toHaveBeenCalledWith(1954, 117, -117, 4, 2)
    expect(onDiagnostic).not.toHaveBeenCalled()
  })

  it('WaitForSoundEffects attend la fin réelle exposée par le runtime audio', async () => {
    let endSound!: () => void
    const soundFinished = new Promise<void>((resolve) => { endSound = resolve })
    const player = { style: { animation: '', transform: '', transformOrigin: '' } } as unknown as HTMLElement
    const opponent = { style: { animation: '', transform: '', transformOrigin: '' } } as unknown as HTMLElement
    let animationFinished = false
    const playback = playConfirmedHgssBattleAnimation({
      id: 902,
      byteLength: 12,
      words: new Uint32Array(3),
      instructions: [instruction('PlaySoundEffect', 1908), instruction('WaitForSoundEffects'), instruction('End')],
    }, 'player', { player, opponent }, {
      playSoundEffect: () => soundFinished,
      playPannedSoundEffect: async () => undefined,
      stopSoundEffect: vi.fn(),
      playPokemonCry: async () => undefined,
      isPokemonCryPlaying: () => false,
    }).then(() => { animationFinished = true })
    await Promise.resolve()
    await Promise.resolve()
    expect(animationFinished).toBe(false)
    endSound()
    await playback
    expect(animationFinished).toBe(true)
  })

  it('arrête les SFX déjà lancés quand la présentation est interrompue', async () => {
    const controller = new AbortController()
    const stopSoundEffect = vi.fn()
    const player = { style: { animation: '', transform: '', transformOrigin: '' } } as unknown as HTMLElement
    const opponent = { style: { animation: '', transform: '', transformOrigin: '' } } as unknown as HTMLElement
    const playback = playConfirmedHgssBattleAnimation({
      id: 903,
      byteLength: 12,
      words: new Uint32Array(3),
      instructions: [instruction('PlaySoundEffect', 2027), instruction('WaitForSoundEffects'), instruction('End')],
    }, 'player', { player, opponent }, {
      playSoundEffect: () => new Promise<void>(() => undefined),
      playPannedSoundEffect: async () => undefined,
      stopSoundEffect,
      playPokemonCry: async () => undefined,
      isPokemonCryPlaying: () => false,
    }, undefined, { signal: controller.signal })
    await Promise.resolve()
    controller.abort()
    await expect(playback).resolves.toBeUndefined()
    expect(stopSoundEffect).toHaveBeenCalledWith(2027)
  })

  it('rend RevolveBattler sans fallback et restaure sa transformation', async () => {
    const native = callFunc(60, 3, 2, 1, 3)
    expect(estimateHgssNativeTaskFrames(native)).toBe(6)
    vi.useFakeTimers()
    vi.stubGlobal('window', { setTimeout })
    try {
      const diagnostics: Array<{ fallbackFrames: number, reason: string }> = []
      const player = { style: { animation: '', transform: '', transformOrigin: '' } } as unknown as HTMLElement
      const opponent = { style: { animation: '', transform: '', transformOrigin: '' } } as unknown as HTMLElement
      const playback = playConfirmedHgssBattleAnimation({
        id: 904,
        byteLength: 12,
        words: new Uint32Array(3),
        instructions: [native, instruction('WaitForAnimTasks'), instruction('End')],
      }, 'player', { player, opponent }, undefined, undefined, {
        onDiagnostic: (diagnostic) => { diagnostics.push(diagnostic) },
      })
      await vi.runAllTimersAsync()
      await playback
      expect(diagnostics).toHaveLength(0)
      expect(player.style.transform).toBe('')
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })

  it('rend PlayfulHops sur le défenseur puis restaure sa présentation', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', { setTimeout })
    try {
      const onDiagnostic = vi.fn()
      const player = { style: { animation: 'idle-player', transform: 'player-transform', transformOrigin: 'player-origin', visibility: '', filter: '' } } as unknown as HTMLElement
      const opponent = { style: { animation: 'idle-opponent', transform: 'opponent-transform', transformOrigin: 'opponent-origin', visibility: '', filter: '' } } as unknown as HTMLElement
      const playback = playConfirmedHgssBattleAnimation({
        id: 905,
        byteLength: 12,
        words: new Uint32Array(3),
        instructions: [callFunc(25, 1, 1), instruction('WaitForAnimTasks'), instruction('End')],
      }, 'player', { player, opponent }, undefined, undefined, { onDiagnostic })

      expect(player.style.transform).toBe('player-transform')
      expect(opponent.style.transform).toBe('translate(0%, 0%) rotate(4.998779296875deg) scale(1, 1)')
      expect(opponent.style.transformOrigin).toBe('30% 112.5%')

      await vi.runAllTimersAsync()
      await playback
      expect(onDiagnostic).not.toHaveBeenCalled()
      expect(player.style.animation).toBe('idle-player')
      expect(opponent.style.animation).toBe('idle-opponent')
      expect(opponent.style.transform).toBe('opponent-transform')
      expect(opponent.style.transformOrigin).toBe('opponent-origin')
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })

  it('suit les offsets relatifs natifs de Call et Return', async () => {
    const instructions = [
      { ...instruction('Call', 4), offsetWords: 0 },
      { ...instruction('PlaySoundEffect', 10), offsetWords: 2 },
      { ...instruction('End'), offsetWords: 4 },
      { ...instruction('PlaySoundEffect', 20), offsetWords: 5 },
      { ...instruction('Return'), offsetWords: 7 },
    ]
    const script: HgssBattleAnimationScript = { id: 900, byteLength: 32, words: new Uint32Array(8), instructions }
    const played: number[] = []
    const element = { style: { transform: '' } } as unknown as HTMLElement
    await playConfirmedHgssBattleAnimation(script, 'player', { player: element, opponent: element }, {
      playSoundEffect: async (sequenceId) => { played.push(sequenceId) },
      playPannedSoundEffect: async () => undefined,
      stopSoundEffect: vi.fn(),
      playPokemonCry: async () => undefined,
      isPokemonCryPlaying: () => false,
    })
    expect(played).toEqual([20, 10])
  })

  it('ne joue que la branche paire ou impaire choisie par le contexte de combat', async () => {
    const instructions = [
      { ...instruction('JumpIfEffectChanceOdd', 2, 5), offsetWords: 0 },
      { ...instruction('PlaySoundEffect', 30), offsetWords: 3 },
      { ...instruction('Jump', 3), offsetWords: 5 },
      { ...instruction('PlaySoundEffect', 31), offsetWords: 7 },
      { ...instruction('End'), offsetWords: 9 },
    ]
    const script: HgssBattleAnimationScript = { id: 901, byteLength: 40, words: new Uint32Array(10), instructions }
    const play = async (effectChance: number) => {
      const played: number[] = []
      const element = { style: { transform: '' } } as unknown as HTMLElement
      await playConfirmedHgssBattleAnimation(script, 'player', { player: element, opponent: element }, {
        playSoundEffect: async (sequenceId) => { played.push(sequenceId) },
        playPannedSoundEffect: async () => undefined,
        stopSoundEffect: vi.fn(),
        playPokemonCry: async () => undefined,
        isPokemonCryPlaying: () => false,
      }, undefined, { effectChance })
      return played
    }
    expect(await play(2)).toEqual([30])
    expect(await play(3)).toEqual([31])
  })
})
