import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { readRomInventory } from '../../nds'
import {
  decodeConfirmedHgssBattleMotion,
  decodeConfirmedHgssGenericEmitterCallback,
  type ConfirmedHgssBattleMotion,
} from './battleAnimationPlayback'
import {
  resolveHgssBattlePresentationScript,
  type HgssBattlePresentationAnimation,
} from './hgssBattlePresentationAnimation'

const romPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const probe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip

probe('binds every status presentation to its particle emitter from the French HeartGold ROM', async () => {
  const romBuffer = await readFile(romPath)
  const inventory = await readRomInventory(new File([romBuffer], basename(romPath)))
  const expected = [
    ['sleep', 1, 27, 9, 3],
    ['poison', 2, 27, 7, 3],
    ['burn', 3, 27, 2, 3],
    ['freeze', 4, 27, 6, 3],
    ['paralysis', 5, 115, 1, 3],
    ['confusion', 6, 27, 5, 17],
    ['infatuation', 7, 27, 3, 3],
    ['heal', 14, 27, 4, 3],
  ] as const satisfies readonly (readonly [HgssBattlePresentationAnimation, number, number, number, number])[]

  for (const [animation, scriptId, particleMemberId, emitterId, callbackId] of expected) {
    const script = resolveHgssBattlePresentationScript(inventory.battleAnimationCatalog, animation)
    expect(script?.id).toBe(scriptId)
    expect(script?.instructions.find(({ name }) => name === 'LoadParticleSystem')?.operands[1]).toBe(particleMemberId)
    const createIndex = script?.instructions.findIndex(({ name }) => name === 'CreateEmitter') ?? -1
    expect(createIndex).toBeGreaterThanOrEqual(0)
    expect([...script!.instructions[createIndex]!.operands]).toEqual([0, emitterId, callbackId])
    expect(inventory.battleAnimationCatalog.particleResourceResolver(particleMemberId).emitters[emitterId]).toBeDefined()
  }

  const confusion = resolveHgssBattlePresentationScript(inventory.battleAnimationCatalog, 'confusion')!
  const createIndex = confusion.instructions.findIndex(({ name }) => name === 'CreateEmitter')
  expect(decodeConfirmedHgssGenericEmitterCallback(confusion.instructions, createIndex)).toEqual({
    consumedInstructions: 2,
    disableSideFlip: true,
    offsetFx32: [0, 8256, 0],
  })

  const renderPokemonSprites = { kind: 'renderPokemonSprites', frames: 3 } as const
  const expectedMotionsByScript = {
    1: [renderPokemonSprites],
    2: [renderPokemonSprites, { kind: 'fadeBattlerSprite', target: 2, fadeStepFrames: 0, cycles: 1, color: 31_764, alpha: 10, holdFrames: 0 }],
    3: [renderPokemonSprites, { kind: 'fadeBattlerSprite', target: 2, fadeStepFrames: 0, cycles: 1, color: 31, alpha: 10, holdFrames: 0 }],
    4: [renderPokemonSprites],
    5: [renderPokemonSprites, { kind: 'fadeBattlerSprite', target: 2, fadeStepFrames: 0, cycles: 1, color: 0, alpha: 15, holdFrames: 0 }],
    6: [renderPokemonSprites],
    7: [renderPokemonSprites],
    8: [renderPokemonSprites, { kind: 'fadeBattlerSprite', target: 2, fadeStepFrames: 0, cycles: 1, color: 32_767, alpha: 10, holdFrames: 0 }],
    9: [renderPokemonSprites],
    10: [
      renderPokemonSprites,
      { kind: 'fadeBattlerSprite', target: 2, fadeStepFrames: 0, cycles: 1, color: 32_767, alpha: 10, holdFrames: 0 },
      { kind: 'scaleBattlerSprite', target: 258, startX: 100, endX: 80, startY: 100, endY: 140, reference: 100, cycles: 1, holdFrames: 0, scaleFrames: 5, restoreFrames: 5 },
      { kind: 'scaleBattlerSprite', target: 258, startX: 100, endX: 120, startY: 100, endY: 80, reference: 100, cycles: 1, holdFrames: 0, scaleFrames: 5, restoreFrames: 5 },
    ],
    11: [],
    12: [],
    13: [],
    14: [renderPokemonSprites],
  } as const satisfies Readonly<Record<number, readonly ConfirmedHgssBattleMotion[]>>

  for (const script of inventory.battleAnimationCatalog.battleScripts.slice(1, 15)) {
    const callbacks = script.instructions
      .filter(({ name }) => name === 'CreateEmitter')
      .map(({ operands }) => operands[2])
    expect(callbacks.every((callbackId) => callbackId === 3 || script.id === 6 && callbackId === 17)).toBe(true)
    const motions = script.instructions.flatMap((instruction) => {
      const motion = decodeConfirmedHgssBattleMotion(instruction)
      return motion ? [motion] : []
    })
    expect(motions).toEqual(expectedMotionsByScript[script.id as keyof typeof expectedMotionsByScript])
  }
}, 120_000)
