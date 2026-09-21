import type { HgssBattleAnimationInstruction, HgssBattleAnimationScript } from '../../rom/battle/battleAnimationScripts'
import type { HgssBattleSpriteResource, HgssBattleSpriteResourceRequest } from '../../rom/battle/battleSpriteResources'
import type { HgssSplParticleResource } from '../../rom/battle/splParticleResources'
import { hgssSoloBattlerWorldPosition, type HgssBattleParticleWorldPosition } from './battleParticlePlacement'
import { captureBattlePokemonSpritePresentation, isBattlePokemonSpritePresentationCurrent } from './battlePokemonSpritePresentation'
import type { SimpleBattleSide } from './simpleBattleSession'
import { HgssSplParticleCanvasPlayback, type HgssSplParticleCanvasDiagnostic } from './splParticleCanvas'
import { hgssVBlanksToMilliseconds, sampleHgssVBlankFrame } from '../time/hgssFrameTiming'

const battleSpriteWidth = 80
const maxShakeCycles = 4
const battleAnimAttacker = 1 << 1
const battleAnimAttackerPartner = 1 << 2
const battleAnimDefender = 1 << 3
const battleAnimDefenderPartner = 1 << 4
const battleAnimSpecificBattler = 1 << 11
const battlerSpriteAttacker = 0x102
const battlerSpriteDefender = 0x108
const battlerSpriteDefenderPartner = 0x110
const fx32One = 4096
const battleParticlePixelFactor = 172

export type ConfirmedHgssBattleMotion =
  | { kind: 'moveBattler', frames: number, offsetX: number, offsetY: number, target: number }
  | { kind: 'moveBattlerX', frames: number, offsetX: number, target: number }
  | { kind: 'playfulHops', target: 'attacker' | 'defender' }
  | { kind: 'revolveBattler', target: number, revolutions: number, framesPerRevolution: number }
  | { kind: 'shake', extentX: number, extentY: number, interval: number, amount: number, targets: number }
  | { kind: 'renderPokemonSprites', frames: number }
  | { kind: 'rockBattler', startRotation: number, endRotation: number, framesPerLeg: number }
  | { kind: 'setBattlerVisibility', hidden: boolean, targets: number }
  | { kind: 'blinkAttacker', count: number, interval: number }
  | { kind: 'fadeBattlerSprite', target: number, fadeStepFrames: number, cycles: number, color: number, alpha: number, holdFrames: number }
  | { kind: 'fadeBackground', delay: number, startAlpha: number, endAlpha: number, color: number }
  | { kind: 'setBackgroundGrayscale', enabled: boolean }
  | { kind: 'scaleBattlerSprite', target: number, startX: number, endX: number, startY: number, endY: number, reference: number, cycles: number, holdFrames: number, scaleFrames: number, restoreFrames: number }
  | { kind: 'moveEmitter', trajectory: 'linear' | 'parabolic', emitterId: number, offsetX: number, offsetY: number, startDelay: number, frames: number, radius: number, battlerMode: number, skipFrames: number, maxFrames: number, curve: boolean, particleSystemIndex: number }
  | { kind: 'revolveEmitter', emitterId: number, startX: number, endX: number, startY: number, endY: number, radiusX: number, radiusY: number, frames: number, battlerMode: number, particleSystemIndex: number }

export type HgssBattlerFadeSample = {
  alpha: number
  complete: boolean
}

export type HgssBattlerScaleSample = {
  scaleX: number
  scaleY: number
  complete: boolean
}

export type HgssBattlerRevolutionSample = {
  offsetX: number
  offsetY: number
  complete: boolean
}

export type HgssPlayfulHopsSample = {
  offsetY: number
  rotationIndex: number
  pivotX: number
  pivotY: 50
  complete: boolean
}

export type HgssEmitterRevolutionSample = {
  position: HgssBattleParticleWorldPosition
  complete: boolean
}

export type HgssEmitterTrajectorySample = {
  position: readonly [number, number]
  complete: boolean
}

export type ConfirmedHgssBattleSprite = {
  kind: 'anger'
  managerId: number
  callbackId: 10
  resource: HgssBattleSpriteResourceRequest
}

export type HgssBattleSpriteEffectSample = {
  visible: boolean
  offsetX: number
  offsetY: number
  scale: number
  complete: boolean
}

export type HgssBattleSpriteEffectHandle = {
  render: (sample: HgssBattleSpriteEffectSample) => void
  destroy: () => void
}

export type HgssBattleAnimationSpritePlayback = {
  resolveResource: (request: HgssBattleSpriteResourceRequest) => HgssBattleSpriteResource
  createSprite: (
    resource: HgssBattleSpriteResource,
    targetSide: SimpleBattleSide,
    target: HTMLElement,
  ) => HgssBattleSpriteEffectHandle
}

export type HgssRockBattlerSample = {
  rotationIndex: number
  pivotX: number
  pivotY: number
  complete: boolean
}

export type ConfirmedHgssGenericEmitterCallback = {
  consumedInstructions: 2
  disableSideFlip: boolean
  offsetFx32: readonly [number, number, number]
}

export type ConfirmedHgssPokemonCry = {
  modulation: number
  pan: number
  volume: number
}

export type ConfirmedHgssPannedSoundEffect = {
  sequenceId: number
  pan: number
}

export type HgssBattleAnimationPlaybackElements = {
  player: HTMLElement
  opponent: HTMLElement
  effects?: HTMLCanvasElement
  background?: HTMLElement
  /** Autres cibles touchées par le même mouvement de zone, sans rejouer son script ni son audio. */
  additionalDefenders?: readonly HTMLElement[]
  attackerPartner?: HTMLElement
  defenderPartner?: HTMLElement
  playerBattlers?: readonly HTMLElement[]
  opponentBattlers?: readonly HTMLElement[]
}

export type HgssBattleAnimationPlaybackAudio = {
  playSoundEffect: (sequenceId: number) => Promise<void>
  playPannedSoundEffect: (sequenceId: number, pan: number) => Promise<void>
  playMovingSoundEffect?: (sequenceId: number, startPan: number, endPan: number, panStep: number, intervalFrames: number) => Promise<void>
  stopSoundEffect: (sequenceId: number) => void
  playPokemonCry: (side: SimpleBattleSide, modulation: number, pan: number, volume: number) => Promise<void>
  isPokemonCryPlaying: () => boolean
}

export type HgssBattleAnimationPlaybackContext = {
  /** Valeur context->effectChance choisie par le moteur pour les variantes visuelles. */
  effectChance?: number
  weather?: 'clear' | 'rain' | 'sandstorm' | 'sun' | 'hail'
  contest?: boolean
  friendlyFire?: boolean
  /** Champ contextuel testé par JumpIfUnknown01 dans les scripts DS. */
  unknown01?: boolean
  /** Un appui utilisateur termine les attentes sans changer le résultat. */
  signal?: AbortSignal
  /** Instrumentation des approximations et commandes visuelles non portées. */
  onDiagnostic?: (diagnostic: HgssBattleAnimationPlaybackDiagnostic) => void
}

export type HgssBattleAnimationPlaybackDiagnostic = {
  kind: 'native-function-fallback' | 'instruction-fallback' | 'particle-fallback'
  scriptId: number
  offsetWords: number
  instructionName: string
  opcode: number
  operands: readonly number[]
  fallbackFrames: number
  reason: string
}

const nativeFunctionNames = [
  'Nop', 'AnimExample', 'SoundExample', 'GenericExample', 'RotateMon', 'Strength', 'BulkUp', 'DoubleTeam',
  'QuickAttack', 'DrillPeck', 'Submission', 'Confusion', 'AcidArmor', 'Growth', 'Meditate', 'Teleport',
  'Flash', 'NightShadeAttacker', 'NightShadeDefender', 'Splash', 'Spite', 'Harden', 'Minimize', 'FaintAttack',
  'Earthquake', 'PlayfulHops', 'Nightmare', 'Flail', 'Magnitude', 'Return', 'VitalThrow', 'Swagger', 'Memento',
  'FadeBg', 'FadeBattlerSprite', 'ScalePokemonSprite', 'Shake', 'Extrasensory', 'AlphaFadePokemonSprite',
  'OdorSleuth', 'HideBattler', 'FakeOutCurtain', 'ScaleBattlerSprite', 'FakeOut', 'ScrollCustomBg', 'MuddyWater',
  'Megahorn', 'MegahornAttacker', 'MegahornDefender', 'Surf', 'BlinkAttacker', 'MoveBattlerX', 'MoveBattlerX2',
  'ShakeAndScaleAttacker', 'ShakeAndScaleAttacker2', 'Camouflage', 'Superpower', 'MoveBattler', 'Mimic',
  'ShadowPunch', 'RevolveBattler', 'MoveBattlerOffScreen', 'MoveBattlerToDefaultPos', 'FadePokemonSprite',
  'BattlerPartialDrawTest', 'MoveEmitterA2BLinear', 'MoveEmitterA2BParabolic', 'BattlerPartialDraw', 'ShakeBg',
  'PixelatePokemonSprite', 'RolePlay', 'Snatch', 'RevolveEmitter', 'MoveEmitterViewportTop', 'SetBgGrayscale',
  'SetPokemonSpritePriority', 'ScrollSwitchedBg', 'MoveBattlerOnOrOffScreen', 'RenderPokemonSprites', 'Sketch',
  'StatChangeUp', 'StatChangeDown', 'StatChangeHeal', 'StatChangeMetal',
] as const

function positiveFrame(value: number | undefined, fallback: number): number {
  const frame = Math.abs(signed(value ?? fallback))
  return Number.isFinite(frame) ? Math.max(1, Math.min(180, frame)) : fallback
}

function packedFrameTotal(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const low = value & 0xffff
  const high = value >>> 16
  return positiveFrame((low || fallback) + high, fallback)
}

function hgssPaletteFadeTaskFrames(delay: number, startAlpha: number, endAlpha: number): number {
  const step = delay < 0 ? 2 + Math.abs(delay) : 2
  const updates = Math.max(1, Math.ceil(Math.abs(endAlpha - startAlpha) / step))
  return 2 + (updates - 1) * (Math.max(0, delay) + 1)
}

/**
 * Durée de remplacement des tâches natives encore sans rendu Web. Les champs
 * utilisés sont ceux des contextes officiels (frames, cycles, hold), plafonnés
 * pour qu'une ressource corrompue ne bloque jamais un combat.
 */
export function estimateHgssNativeTaskFrames(instruction: HgssBattleAnimationInstruction): number {
  if (instruction.name !== 'CallFunc') return 0
  const functionId = instruction.operands[0]
  const args = instruction.operands.slice(2)
  switch (functionId) {
  case 0:
  case 40:
  case 74:
  case 75:
    return 0
  case 25:
    return 33
  case 33:
    return positiveFrame(hgssPaletteFadeTaskFrames(signed(args[1] ?? 0), signed(args[2] ?? 0), signed(args[3] ?? 0)), 12)
  case 34: {
    const fadeFrames = (Math.max(0, signed(args[1] ?? 0)) + 1) * Math.max(0, signed(args[4] ?? 0)) * 2
    const cycles = Math.max(1, signed(args[2] ?? 1))
    return positiveFrame((fadeFrames + 4) * cycles + Math.max(0, signed(args[5] ?? 0)), 24)
  }
  case 35:
    return positiveFrame(packedFrameTotal(args[6], 18) * positiveFrame(args[5], 1) + 4, 22)
  case 38:
    return positiveFrame(args[5], 8) + 2
  case 42: {
    const cyclesAndHold = args[6] ?? 1
    const cycles = Math.max(1, cyclesAndHold & 0xffff)
    const hold = cyclesAndHold >>> 16
    return positiveFrame(packedFrameTotal(args[7], 10) * cycles + hold + cycles * 4, 18)
  }
  case 50:
    return positiveFrame((positiveFrame(args[0], 1) * 2 + 1) * (positiveFrame(args[1], 0) + 1), 12)
  case 51:
  case 52:
    return positiveFrame(args[0], 8) + 3
  case 60:
    return positiveFrame(positiveFrame(args[1], 1) * positiveFrame(args[2], 10) + 3, 24)
  case 61:
    return positiveFrame(args[1], 16) + 3
  case 62:
    return positiveFrame(args[0], 8) + 3
  case 63:
    return positiveFrame(Math.abs(signed(args[4] ?? 0) - signed(args[3] ?? 0)) * positiveFrame(args[0], 1) + 3, 14)
  case 65:
  case 66:
  case 67:
    return positiveFrame(args[4], 13) + 2
  case 68:
    return positiveFrame(positiveFrame(args[2], 1) * maxShakeCycles * positiveFrame(args[3], 1) * positiveFrame(args[4], 1) + 2, 18)
  case 69:
    return positiveFrame(16 / positiveFrame(args[1], 1) + 2, 12)
  case 72:
    return positiveFrame(args[7], 7) + 2
  case 76:
    return 16
  case 77:
    return positiveFrame(args[2], 10) + 3
  case 78:
    return positiveFrame(args[0], 3)
  default:
    return 24
  }
}

const silentDeclarativeInstructions = new Set([
  'Nop0', 'Nop1', 'Nop2', 'Nop3', 'Nop4', 'Nop5', 'Nop6', 'Nop7', 'Nop8', 'Nop9', 'Nop10', 'Nop11',
  'InitPokemonSpriteManager', 'LoadPokemonSpriteDummyResources', 'FreePokemonSpriteManager',
  'CancelTrackingTask', 'SetCameraProjection', 'SetCameraFlip', 'InitSpriteManager',
  'LoadCharResObj', 'LoadPlttRes', 'LoadCellResObj', 'LoadAnimResObj', 'FreeSpriteManager',
  'StopPokemonSpriteDrawTask', 'SetExtraParams',
])

const loggedDiagnosticSignatures = new Set<string>()

function signed(value: number): number {
  return value | 0
}

export function isConfirmedHgssNoOpNativeFunction(instruction: HgssBattleAnimationInstruction): boolean {
  return instruction.name === 'CallFunc' && instruction.operands[0] === 0
}

export function decodeConfirmedHgssBattleMotion(
  instruction: HgssBattleAnimationInstruction,
  currentParticleSystemIndex?: number,
): ConfirmedHgssBattleMotion | undefined {
  if (instruction.name !== 'CallFunc') return undefined
  const [functionId, argumentCount, ...rawArguments] = instruction.operands
  if (functionId === 57 && argumentCount === 4 && rawArguments.length === 4) {
    return {
      kind: 'moveBattler',
      frames: signed(rawArguments[0]!),
      offsetX: signed(rawArguments[1]!),
      offsetY: signed(rawArguments[2]!),
      target: rawArguments[3]!,
    }
  }
  if ((functionId === 51 || functionId === 52) && argumentCount === 3 && rawArguments.length === 3) {
    const [frames, offsetX, target] = rawArguments
    if (frames === undefined || offsetX === undefined || target === undefined
      || (target !== battlerSpriteAttacker && target !== battlerSpriteDefender && target !== battlerSpriteDefenderPartner)) return undefined
    return { kind: 'moveBattlerX', frames: signed(frames), offsetX: signed(offsetX), target }
  }
  if (functionId === 50 && argumentCount === 2 && rawArguments.length === 2) {
    const count = signed(rawArguments[0]!)
    const interval = signed(rawArguments[1]!)
    if (count < 0 || interval < 0) return undefined
    return { kind: 'blinkAttacker', count, interval }
  }
  if (functionId === 25 && (argumentCount === 0 || argumentCount === 1) && rawArguments.length === argumentCount) {
    const target = rawArguments[0] ?? 0
    if (target !== 0 && target !== 1) return undefined
    return { kind: 'playfulHops', target: target === 0 ? 'attacker' : 'defender' }
  }
  if (functionId === 60 && argumentCount === 3 && rawArguments.length === 3) {
    const [target, revolutions, framesPerRevolution] = rawArguments
    if (target === undefined || revolutions === undefined || framesPerRevolution === undefined
      || !new Set([battleAnimAttacker, battleAnimAttackerPartner, battleAnimDefender, battleAnimDefenderPartner]).has(target)
      || signed(revolutions) <= 0 || signed(revolutions) > 16
      || signed(framesPerRevolution) <= 0 || signed(framesPerRevolution) > 180) return undefined
    return {
      kind: 'revolveBattler',
      target,
      revolutions: signed(revolutions),
      framesPerRevolution: signed(framesPerRevolution),
    }
  }
  if (functionId === 74 && argumentCount === 1 && rawArguments.length === 1) {
    const enabled = rawArguments[0]
    if (enabled !== 0 && enabled !== 1) return undefined
    return { kind: 'setBackgroundGrayscale', enabled: enabled === 1 }
  }
  if (functionId === 33 && argumentCount === 5 && rawArguments.length === 5) {
    const [backgroundType, delay, startAlpha, endAlpha, color] = rawArguments
    if (backgroundType !== 0 || delay === undefined || startAlpha === undefined || endAlpha === undefined || color === undefined
      || signed(delay) < -15 || signed(delay) > 63 || startAlpha > 16 || endAlpha > 16 || color > 0xffff) return undefined
    return {
      kind: 'fadeBackground',
      delay: signed(delay),
      startAlpha,
      endAlpha,
      color,
    }
  }
  if ((functionId === 65 || functionId === 66) && rawArguments.length === argumentCount && currentParticleSystemIndex !== undefined) {
    const supportedArgumentCounts = functionId === 65 ? new Set([6, 8, 9]) : new Set([6, 7])
    if (!supportedArgumentCounts.has(argumentCount)) return undefined
    const variables = Array.from({ length: 10 }, (_, index) => signed(rawArguments[index] ?? 0))
    const [emitterId, offsetX, offsetY, startDelay, frames, radius, battlerMode, signedParams, curve] = variables
    const params = signedParams >>> 0
    const skipFrames = params >>> 16
    const maxFrames = (params & 0xffff) || 0xff
    if (emitterId < 0 || emitterId > 255 || startDelay < 0 || startDelay > 180 || frames <= 0 || frames > 180
      || (battlerMode !== 0 && battlerMode !== 1) || (curve !== 0 && curve !== 1)
      || skipFrames > frames || currentParticleSystemIndex < 0 || currentParticleSystemIndex > 15) return undefined
    return {
      kind: 'moveEmitter',
      trajectory: functionId === 65 ? 'linear' : 'parabolic',
      emitterId,
      offsetX,
      offsetY,
      startDelay,
      frames,
      radius,
      battlerMode,
      skipFrames,
      maxFrames,
      curve: curve !== 0,
      particleSystemIndex: currentParticleSystemIndex,
    }
  }
  if (functionId === 72 && argumentCount === 10 && rawArguments.length === 10) {
    const [emitterId, startX, endX, startY, endY, radiusX, radiusY, frames, battlerMode, particleSystemIndex] = rawArguments
    if (emitterId === undefined || startX === undefined || endX === undefined || startY === undefined || endY === undefined
      || radiusX === undefined || radiusY === undefined || frames === undefined || battlerMode === undefined || particleSystemIndex === undefined
      || emitterId > 255 || signed(frames) <= 0 || signed(frames) > 180
      || (battlerMode !== 0 && battlerMode !== 1) || particleSystemIndex > 2) return undefined
    return {
      kind: 'revolveEmitter',
      emitterId,
      startX: signed(startX),
      endX: signed(endX),
      startY: signed(startY),
      endY: signed(endY),
      radiusX: signed(radiusX),
      radiusY: signed(radiusY),
      frames: signed(frames),
      battlerMode,
      particleSystemIndex,
    }
  }
  if (functionId === 34 && (argumentCount === 5 || argumentCount === 6) && rawArguments.length === argumentCount) {
    const [target, fadeStepFrames, cycles, color, alpha, holdFrames = 0] = rawArguments
    const supportedTargets = new Set([
      battleAnimAttacker,
      battleAnimAttackerPartner,
      battleAnimDefender,
      battleAnimDefenderPartner,
      battleAnimSpecificBattler | battleAnimAttacker,
      battleAnimSpecificBattler | battleAnimAttackerPartner,
      battleAnimSpecificBattler | battleAnimDefender,
      battleAnimSpecificBattler | battleAnimDefenderPartner,
    ])
    if (target === undefined || fadeStepFrames === undefined || cycles === undefined || color === undefined || alpha === undefined
      || !supportedTargets.has(target) || signed(fadeStepFrames) < 0 || signed(cycles) <= 0
      || color > 0xffff || signed(alpha) < 0 || signed(alpha) > 16 || signed(holdFrames) < 0) return undefined
    return {
      kind: 'fadeBattlerSprite',
      target,
      fadeStepFrames: signed(fadeStepFrames),
      cycles: signed(cycles),
      color,
      alpha: signed(alpha),
      holdFrames: signed(holdFrames),
    }
  }
  if (functionId === 42 && argumentCount === 8 && rawArguments.length === 8) {
    const [target, startX, endX, startY, endY, reference, holdCycles, frames] = rawArguments
    const supportedTargets = new Set([
      battlerSpriteAttacker,
      battlerSpriteDefender,
      battleAnimSpecificBattler | battleAnimAttacker,
      battleAnimSpecificBattler | battleAnimAttackerPartner,
      battleAnimSpecificBattler | battleAnimDefender,
      battleAnimSpecificBattler | battleAnimDefenderPartner,
    ])
    if (target === undefined || startX === undefined || endX === undefined || startY === undefined || endY === undefined
      || reference === undefined || holdCycles === undefined || frames === undefined || !supportedTargets.has(target)) return undefined
    const cycles = holdCycles & 0xffff
    const holdFrames = holdCycles >>> 16
    const scaleFrames = frames >>> 16
    const restoreFrames = frames & 0xffff
    if (signed(reference) <= 0 || cycles <= 0 || holdFrames > 180 || scaleFrames <= 0 || scaleFrames > 180
      || restoreFrames <= 0 || restoreFrames > 180) return undefined
    return {
      kind: 'scaleBattlerSprite',
      target,
      startX: signed(startX),
      endX: signed(endX),
      startY: signed(startY),
      endY: signed(endY),
      reference: signed(reference),
      cycles,
      holdFrames,
      scaleFrames,
      restoreFrames,
    }
  }
  if (functionId === 36 && argumentCount === 5 && rawArguments.length === 5) {
    return {
      kind: 'shake',
      extentX: signed(rawArguments[0]!),
      extentY: signed(rawArguments[1]!),
      interval: signed(rawArguments[2]!),
      amount: signed(rawArguments[3]!),
      targets: rawArguments[4]!,
    }
  }
  if (functionId === 78 && argumentCount === 1 && rawArguments.length === 1) {
    const configuredFrames = signed(rawArguments[0]!)
    if (configuredFrames < 0) return undefined
    return { kind: 'renderPokemonSprites', frames: configuredFrames === 0 ? 3 : configuredFrames }
  }
  if (functionId === 40 && argumentCount === 2 && rawArguments.length === 2) {
    const [targets, hidden] = rawArguments
    const supportedTargets = battleAnimAttacker | battleAnimDefender | battleAnimDefenderPartner
    if (targets === undefined || hidden === undefined || targets === 0 || (targets & ~supportedTargets) !== 0 || (hidden !== 0 && hidden !== 1)) return undefined
    return { kind: 'setBattlerVisibility', targets, hidden: hidden === 1 }
  }
  // BATTLE_ANIMATION_EATING (script 28) utilise exactement ce mode de la
  // fonction native 4 : rotation Z aller-retour autour du pied extérieur.
  if (functionId === 4 && argumentCount === 6 && rawArguments.length === 6
    && rawArguments[3] === 2 && rawArguments[4] === 0 && rawArguments[5] === 32) {
    const framesPerLeg = signed(rawArguments[2]!)
    if (framesPerLeg <= 0) return undefined
    return {
      kind: 'rockBattler',
      startRotation: rawArguments[0]!,
      endRotation: rawArguments[1]!,
      framesPerLeg,
    }
  }
  return undefined
}

/** Décode le callback OBJ 10 employé par BATTLE_ANIMATION_ANGRY (script 29). */
export function decodeConfirmedHgssBattleSprite(
  instruction: HgssBattleAnimationInstruction,
): ConfirmedHgssBattleSprite | undefined {
  if (instruction.name !== 'AddSpriteWithFunc' || instruction.operands.length !== 9) return undefined
  const [managerId, callbackId, characterMemberId, paletteMemberId, cellMemberId, animationMemberId, multiCellId, multiAnimationId, extraParameterCount] = instruction.operands
  if (managerId === undefined || callbackId !== 10
    || characterMemberId === undefined || paletteMemberId === undefined
    || cellMemberId === undefined || animationMemberId === undefined
    || multiCellId !== 0 || multiAnimationId !== 0 || extraParameterCount !== 0) return undefined
  return {
    kind: 'anger',
    managerId,
    callbackId: 10,
    resource: { characterMemberId, paletteMemberId, cellMemberId, animationMemberId },
  }
}

function signed16(value: number): number {
  const narrowed = value & 0xffff
  return narrowed & 0x8000 ? narrowed - 0x10000 : narrowed
}

/** État exact des 23 callbacks de tâche de la fonction native 4. */
export function sampleConfirmedHgssRockBattler(
  motion: Extract<ConfirmedHgssBattleMotion, { kind: 'rockBattler' }>,
  side: SimpleBattleSide,
  taskFrame: number,
): HgssRockBattlerSample {
  const frame = Math.max(0, Math.trunc(taskFrame))
  const sideSign = side === 'player' ? 1 : -1
  const totalFrames = motion.framesPerLeg * 2 + 3
  if (frame >= totalFrames) return { rotationIndex: 0, pivotX: 0, pivotY: 0, complete: true }
  const start = motion.startRotation
  const step = Math.trunc((motion.endRotation - motion.startRotation) / motion.framesPerLeg)
  let rotation = start
  if (frame === 0) rotation = 0
  else if (frame <= motion.framesPerLeg) rotation += step * frame * sideSign
  else if (frame === motion.framesPerLeg + 1) rotation += step * motion.framesPerLeg * sideSign
  else {
    const returnFrame = Math.min(motion.framesPerLeg, frame - motion.framesPerLeg - 1)
    rotation += step * (motion.framesPerLeg - returnFrame) * sideSign
  }
  return {
    rotationIndex: signed16(rotation),
    pivotX: -40 * sideSign,
    pivotY: 40,
    complete: false,
  }
}

export function sampleConfirmedHgssBattlerFade(
  motion: Extract<ConfirmedHgssBattleMotion, { kind: 'fadeBattlerSprite' }>,
  taskFrame: number,
): HgssBattlerFadeSample {
  let state = 0
  let cycles = motion.cycles
  let holdFrames = motion.holdFrames
  let fadeActive = false
  let fadeAlpha = 0
  let fadeTarget = 0
  let fadeDelayCounter = 0
  let renderedAlpha = 0
  const startFade = (start: number, target: number) => {
    fadeActive = true
    fadeAlpha = start
    fadeTarget = target
    fadeDelayCounter = 0
  }
  const frameCount = Math.max(0, Math.trunc(taskFrame))
  for (let frame = 0; frame <= frameCount; frame += 1) {
    if (state === 0) {
      startFade(0, motion.alpha)
      state = 1
    } else if (state === 1) {
      if (!fadeActive) state = 2
    } else if (state === 2) {
      if (holdFrames === 0) {
        startFade(motion.alpha, 0)
        state = 4
      } else holdFrames -= 1
    } else if (state === 4) {
      if (!fadeActive) {
        cycles -= 1
        state = cycles <= 0 ? 5 : 0
      }
    } else {
      return { alpha: 0, complete: true }
    }

    if (fadeActive) {
      if (fadeDelayCounter === 0) {
        renderedAlpha = fadeAlpha
        fadeDelayCounter = motion.fadeStepFrames
        if (fadeAlpha === fadeTarget) fadeActive = false
        else fadeAlpha += fadeAlpha < fadeTarget ? 1 : -1
      } else fadeDelayCounter -= 1
    }
  }
  return { alpha: renderedAlpha, complete: false }
}

export function sampleConfirmedHgssBackgroundFade(
  motion: Extract<ConfirmedHgssBattleMotion, { kind: 'fadeBackground' }>,
  taskFrame: number,
): HgssBattlerFadeSample {
  const frame = Math.max(0, Math.trunc(taskFrame))
  const step = motion.delay < 0 ? 2 + Math.abs(motion.delay) : 2
  const wait = Math.max(0, motion.delay)
  const difference = motion.endAlpha - motion.startAlpha
  const direction = Math.sign(difference)
  const updates = Math.max(1, Math.ceil(Math.abs(difference) / step))
  const finalUpdateFrame = 1 + (updates - 1) * (wait + 1)
  if (frame > finalUpdateFrame) return { alpha: motion.endAlpha, complete: true }
  if (frame === 0) return { alpha: motion.startAlpha, complete: false }
  const completedUpdates = Math.min(updates, 1 + Math.floor((frame - 1) / (wait + 1)))
  return {
    alpha: motion.startAlpha + direction * Math.min(Math.abs(difference), completedUpdates * step),
    complete: false,
  }
}

export function sampleConfirmedHgssBattlerScale(
  motion: Extract<ConfirmedHgssBattleMotion, { kind: 'scaleBattlerSprite' }>,
  taskFrame: number,
): HgssBattlerScaleSample {
  const relativeScale = (value: number) => Math.trunc(value * 256 / motion.reference)
  let state = 0
  let cycles = motion.cycles
  let holdFrames = motion.holdFrames
  let steps = 0
  let currentX = relativeScale(motion.startX) * fx32One
  let currentY = relativeScale(motion.startY) * fx32One
  let stepX = 0
  let stepY = 0
  let scaleX = 1
  let scaleY = 1
  const init = (startX: number, endX: number, startY: number, endY: number, frames: number) => {
    const relativeStartX = relativeScale(startX)
    const relativeEndX = relativeScale(endX)
    const relativeStartY = relativeScale(startY)
    const relativeEndY = relativeScale(endY)
    steps = frames
    currentX = relativeStartX * fx32One
    currentY = relativeStartY * fx32One
    stepX = Math.trunc((relativeEndX - relativeStartX) * fx32One / frames)
    stepY = Math.trunc((relativeEndY - relativeStartY) * fx32One / frames)
  }
  const update = (): boolean => {
    if (steps === 0) return false
    steps -= 1
    currentX += stepX
    currentY += stepY
    scaleX = Math.floor(currentX / fx32One) / 256
    scaleY = Math.floor(currentY / fx32One) / 256
    return true
  }
  const frameCount = Math.max(0, Math.trunc(taskFrame))
  for (let frame = 0; frame <= frameCount; frame += 1) {
    if (state === 0) {
      init(motion.startX, motion.endX, motion.startY, motion.endY, motion.scaleFrames)
      update()
      state = 1
    } else if (state === 1) {
      if (!update()) state = 2
    } else if (state === 2) {
      if (holdFrames > 0) {
        holdFrames -= 1
        continue
      }
      init(motion.endX, motion.startX, motion.endY, motion.startY, motion.restoreFrames)
      update()
      state = 4
    } else if (state === 4) {
      if (!update()) {
        cycles -= 1
        state = cycles <= 0 ? 5 : 0
      }
    } else {
      return { scaleX: 1, scaleY: 1, complete: true }
    }
  }
  return { scaleX, scaleY, complete: false }
}

function hgssDegreeToAngleIndex(degrees: number): number {
  return Math.trunc(degrees * 0xffff / 360) & 0xffff
}

function hgssRevolutionScreenOffset(angleIndex: number, radius: number, cosine: boolean): number {
  const tableIndex = (angleIndex & 0xffff) >>> 4
  const radians = tableIndex * Math.PI * 2 / 4096
  const trigFx32 = Math.round((cosine ? Math.cos(radians) : Math.sin(radians)) * fx32One)
  return Math.floor((trigFx32 * radius + 0.5) / fx32One)
}

export function sampleConfirmedHgssPlayfulHops(taskFrame: number, initialDirection: 1 | -1): HgssPlayfulHopsSample {
  const frame = Math.max(0, Math.trunc(taskFrame))
  const hop = Math.min(3, Math.floor(frame / 8))
  const localFrame = frame % 8
  const direction = (hop % 2 === 0 ? initialDirection : -initialDirection) as 1 | -1
  const angles = [910, 1820, 2730, 2730, 1820, 910, 0, 0] as const
  const offsetsY = [0, 1, 2, 2, 1, 0, 0, 0] as const
  return {
    offsetY: frame >= 32 ? 0 : offsetsY[localFrame]!,
    rotationIndex: frame >= 32 ? 0 : angles[localFrame]! * direction,
    pivotX: -16 * direction,
    pivotY: 50,
    complete: frame >= 33,
  }
}

export function sampleConfirmedHgssBattlerRevolution(
  motion: Extract<ConfirmedHgssBattleMotion, { kind: 'revolveBattler' }>,
  taskFrame: number,
): HgssBattlerRevolutionSample {
  const totalFrames = motion.revolutions * motion.framesPerRevolution
  const frame = Math.max(0, Math.trunc(taskFrame))
  if (frame >= totalFrames) return { offsetX: 0, offsetY: 0, complete: true }
  const angleStep = Math.trunc(hgssDegreeToAngleIndex(360) / motion.framesPerRevolution)
  const completedSteps = frame + 1
  const angle = angleStep * completedSteps & 0xffff
  return {
    offsetX: hgssRevolutionScreenOffset(angle, 16, false),
    offsetY: 8 + hgssRevolutionScreenOffset(angle, -4, true),
    complete: false,
  }
}

function hgssWorldToScreenCoordinate(world: number): number {
  return signed16(Math.trunc(Math.round(world * fx32One) / battleParticlePixelFactor))
}

function hgssLerpScreenCoordinate(start: number, end: number, frames: number, completedSteps: number): number {
  const stepFx32 = Math.trunc((end - start) * fx32One / frames)
  return signed16(Math.floor((start * fx32One + stepFx32 * completedSteps) / fx32One))
}

export function sampleConfirmedHgssEmitterTrajectory(
  motion: Extract<ConfirmedHgssBattleMotion, { kind: 'moveEmitter' }>,
  taskFrame: number,
  attackerPosition: HgssBattleParticleWorldPosition,
  defenderPosition: HgssBattleParticleWorldPosition,
  attackerSide: SimpleBattleSide,
): HgssEmitterTrajectorySample {
  const startPosition = motion.battlerMode === 0 ? attackerPosition : defenderPosition
  const endPosition = motion.battlerMode === 0 ? defenderPosition : attackerPosition
  const direction = attackerSide === 'player' ? 1 : -1
  const startX = hgssWorldToScreenCoordinate(startPosition[0])
  const startY = hgssWorldToScreenCoordinate(startPosition[1])
  const endX = hgssWorldToScreenCoordinate(endPosition[0]) + motion.offsetX * direction
  const endY = hgssWorldToScreenCoordinate(endPosition[1]) + motion.offsetY * direction
  const frame = Math.max(0, Math.trunc(taskFrame))
  const delay = motion.trajectory === 'linear' ? motion.startDelay : 0
  const taskUpdates = Math.max(0, frame - delay)
  const remainingSteps = Math.max(0, motion.frames - motion.skipFrames)
  const completedSteps = Math.min(motion.frames, motion.skipFrames + Math.min(remainingSteps, taskUpdates))
  const freezesAtInitialPosition = motion.trajectory === 'linear' && (motion.skipFrames > 0 || motion.maxFrames !== 0xff)
  const renderedSteps = freezesAtInitialPosition ? motion.skipFrames : completedSteps
  const screenX = hgssLerpScreenCoordinate(startX, endX, motion.frames, renderedSteps)
  let screenY = hgssLerpScreenCoordinate(startY, endY, motion.frames, renderedSteps)
  let curveWorldOffset = 0
  if (!freezesAtInitialPosition && motion.trajectory === 'parabolic' && renderedSteps > 0) {
    const startAngle = hgssDegreeToAngleIndex(90)
    const endAngle = hgssDegreeToAngleIndex(270)
    const angle = startAngle + Math.trunc((endAngle - startAngle) / motion.frames) * renderedSteps & 0xffff
    screenY += hgssRevolutionScreenOffset(angle, -motion.radius, true)
  } else if (!freezesAtInitialPosition && motion.trajectory === 'linear' && motion.curve && taskUpdates > 0) {
    const angle = hgssDegreeToAngleIndex(Math.trunc(360 / motion.frames) * taskUpdates)
    const tableIndex = angle >>> 4
    curveWorldOffset = Math.round(Math.sin(tableIndex * Math.PI * 2 / 4096) * fx32One) / fx32One
  }
  return {
    position: [
      screenX * battleParticlePixelFactor / fx32One,
      screenY * battleParticlePixelFactor / fx32One + curveWorldOffset,
    ],
    complete: taskUpdates > remainingSteps,
  }
}

export function sampleConfirmedHgssEmitterRevolution(
  motion: Extract<ConfirmedHgssBattleMotion, { kind: 'revolveEmitter' }>,
  taskFrame: number,
  battlerPosition: HgssBattleParticleWorldPosition,
): HgssEmitterRevolutionSample {
  const startX = hgssDegreeToAngleIndex(motion.startX)
  const endX = hgssDegreeToAngleIndex(motion.endX)
  const startY = hgssDegreeToAngleIndex(motion.startY)
  const endY = hgssDegreeToAngleIndex(motion.endY)
  const stepX = Math.trunc((endX - startX) / motion.frames)
  const stepY = Math.trunc((endY - startY) / motion.frames)
  const completedSteps = Math.min(motion.frames, Math.max(1, Math.trunc(taskFrame) + 1))
  const angleX = startX + stepX * completedSteps & 0xffff
  const angleY = startY + stepY * completedSteps & 0xffff
  const offsetX = hgssRevolutionScreenOffset(angleX, motion.radiusX, false)
  const offsetY = hgssRevolutionScreenOffset(angleY, motion.radiusY, true)
  return {
    position: [
      battlerPosition[0] + offsetX * battleParticlePixelFactor / fx32One,
      battlerPosition[1] + offsetY * battleParticlePixelFactor / fx32One,
      battlerPosition[2],
    ],
    complete: taskFrame >= motion.frames,
  }
}

function hgssBgr555FadeFilter(color: number, alpha: number): string {
  if (alpha <= 0) return ''
  const blend = Math.min(16, alpha) / 16
  const scale = 1 - blend
  const red = (color & 0x1f) / 31 * blend
  const green = ((color >>> 5) & 0x1f) / 31 * blend
  const blue = ((color >>> 10) & 0x1f) / 31 * blend
  const matrix = `${scale} 0 0 0 ${red} 0 ${scale} 0 0 ${green} 0 0 ${scale} 0 ${blue} 0 0 0 1 0`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"><filter id="f" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${matrix}"/></filter></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}#f")`
}

function nativeAffineScale(start: number, end: number, frames: number, step: number): number {
  const startUnits = Math.trunc(start * 256 / 10)
  const endUnits = Math.trunc(end * 256 / 10)
  return Math.trunc(startUnits + (endUnits - startUnits) * step / frames) / 256
}

/** État exact des 24 callbacks de tâche du callback OBJ natif 10. */
export function sampleConfirmedHgssAngerSprite(
  side: SimpleBattleSide,
  taskFrame: number,
): HgssBattleSpriteEffectSample {
  const frame = Math.max(0, Math.trunc(taskFrame))
  const sideSign = side === 'player' ? 1 : -1
  if (frame >= 24) return { visible: false, offsetX: 0, offsetY: 0, scale: 1, complete: true }
  const phase = frame >= 14 ? frame - 13 : frame
  const second = frame >= 14
  const visible = (frame >= 1 && frame <= 8) || (frame >= 14 && frame <= 21)
  let scale = 1
  if (phase >= 2 && phase <= 5) scale = nativeAffineScale(10, 14, 4, phase - 1)
  else if (phase === 6) scale = nativeAffineScale(10, 14, 4, 4)
  else if (phase >= 7 && phase <= 8) scale = nativeAffineScale(14, 12, 2, phase - 6)
  return {
    visible,
    offsetX: second ? -24 * sideSign : 24 * sideSign,
    offsetY: second ? -24 : -16,
    scale,
    complete: false,
  }
}

export function decodeConfirmedHgssPannedSoundEffect(
  instruction: HgssBattleAnimationInstruction,
  attackerSide: SimpleBattleSide,
): ConfirmedHgssPannedSoundEffect | undefined {
  if (instruction.name !== 'PlayPannedSoundEffect' || instruction.operands.length !== 2) return undefined
  const sequenceId = instruction.operands[0]
  const encodedPan = instruction.operands[1]
  if (sequenceId === undefined || encodedPan === undefined) return undefined
  const pan = signed(encodedPan)
  if (pan < -127 || pan > 127) return undefined
  return { sequenceId, pan: attackerSide === 'player' ? pan : -pan }
}

export function decodeConfirmedHgssPokemonCry(
  instruction: HgssBattleAnimationInstruction,
  attackerSide: SimpleBattleSide,
): ConfirmedHgssPokemonCry | undefined {
  if (instruction.name !== 'PlayPokemonCry' || instruction.operands.length !== 3) return undefined
  const [modulation, encodedPan, volume] = instruction.operands
  if (modulation === undefined || encodedPan === undefined || volume === undefined || volume > 127) return undefined
  const pan = signed(encodedPan)
  if (pan < -127 || pan > 127) return undefined
  return { modulation, pan: attackerSide === 'player' ? pan : -pan, volume }
}

/**
 * Décode le seul chemin du callback générique 17 actuellement porté : cible
 * inversée (défenseur vers attaquant), position Normal de l'attaquant, puis
 * décalage explicite. Les deux SetExtraParams sont lus en ligne par HGSS.
 */
export function decodeConfirmedHgssGenericEmitterCallback(
  instructions: readonly HgssBattleAnimationInstruction[],
  createEmitterIndex: number,
): ConfirmedHgssGenericEmitterCallback | undefined {
  const createEmitter = instructions[createEmitterIndex]
  if (createEmitter?.name !== 'CreateEmitter' || createEmitter.operands[2] !== 17) return undefined
  const genericParams = instructions[createEmitterIndex + 1]
  const positionParams = instructions[createEmitterIndex + 2]
  if (genericParams?.name !== 'SetExtraParams' || positionParams?.name !== 'SetExtraParams') return undefined
  const expectedGenericParams = [6, 0, 1, 5, 0, 0, 0]
  if (genericParams.operands.length !== expectedGenericParams.length
    || expectedGenericParams.some((value, index) => genericParams.operands[index] !== value)) return undefined
  if (positionParams.operands.length !== 5 || positionParams.operands[0] !== 4) return undefined
  const flipMode = positionParams.operands[1]
  if (flipMode !== 0 && flipMode !== 1) return undefined
  return {
    consumedInstructions: 2,
    disableSideFlip: flipMode === 1,
    offsetFx32: [
      signed(positionParams.operands[2]!),
      signed(positionParams.operands[3]!),
      signed(positionParams.operands[4]!),
    ],
  }
}

export function resolveConfirmedHgssGenericEmitterPosition(
  callback: ConfirmedHgssGenericEmitterCallback,
  attackerSide: SimpleBattleSide,
  attackerPosition = hgssSoloBattlerWorldPosition(attackerSide),
): HgssBattleParticleWorldPosition {
  // Le mode cible 1 utilise le défenseur comme battler de départ. Le moteur
  // renvoie +1 pour un battler joueur et -1 pour un battler adverse.
  const defenderSide = attackerSide === 'player' ? 'opponent' : 'player'
  const direction = callback.disableSideFlip ? 1 : defenderSide === 'player' ? 1 : -1
  return [
    attackerPosition[0] + callback.offsetFx32[0] * direction / fx32One,
    attackerPosition[1] + callback.offsetFx32[1] * direction / fx32One,
    attackerPosition[2] + callback.offsetFx32[2] * direction / fx32One,
  ]
}

function waitFrames(frames: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted || frames <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    const finish = () => { globalThis.clearTimeout(timer); signal?.removeEventListener('abort', finish); resolve() }
    const timer = window.setTimeout(finish, hgssVBlanksToMilliseconds(frames))
    signal?.addEventListener('abort', finish, { once: true })
  })
}

function animateFrames(frames: number, sample: (progress: number, elapsedFrames: number) => void, signal?: AbortSignal): Promise<void> {
  if (frames <= 0) {
    sample(1, 0)
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    const startedAt = performance.now()
    const duration = hgssVBlanksToMilliseconds(frames)
    let complete = false
    const finish = () => {
      if (complete) return
      complete = true
      signal?.removeEventListener('abort', finish)
      sample(1, frames)
      resolve()
    }
    const tick = (now: number) => {
      if (complete || signal?.aborted) { finish(); return }
      const elapsed = Math.max(0, now - startedAt)
      const progress = Math.min(1, elapsed / duration)
      sample(progress, sampleHgssVBlankFrame(now, startedAt))
      if (progress >= 1) finish()
      else window.requestAnimationFrame(tick)
    }
    sample(0, 0)
    signal?.addEventListener('abort', finish, { once: true })
    window.requestAnimationFrame(tick)
  })
}

async function animateNativeTaskFrames(frames: number, sample: (taskFrame: number) => void, signal?: AbortSignal): Promise<void> {
  sample(0)
  for (let frame = 1; frame <= frames; frame += 1) {
    await waitFrames(1, signal)
    if (signal?.aborted) { sample(frames); return }
    sample(frame)
  }
}

async function waitForTasks(tasks: readonly Promise<unknown>[], signal?: AbortSignal): Promise<void> {
  if (tasks.length === 0 || signal?.aborted) return
  if (!signal) { await Promise.all(tasks); return }
  await new Promise<void>((resolve) => {
    const finish = () => { signal.removeEventListener('abort', finish); resolve() }
    signal.addEventListener('abort', finish, { once: true })
    void Promise.all(tasks).then(finish, finish)
  })
}

function resolveBattlerElements(
  target: number,
  attackerSide: SimpleBattleSide,
  elements: HgssBattleAnimationPlaybackElements,
): readonly HTMLElement[] {
  const defenderSide = attackerSide === 'player' ? 'opponent' : 'player'
  if (target === battlerSpriteAttacker) return [elements[attackerSide]]
  if (target !== battlerSpriteDefender) return []
  return [...new Set([elements[defenderSide], ...(elements.additionalDefenders ?? [])])]
}

function resolveExactBattlerSpriteElements(
  target: number,
  attackerSide: SimpleBattleSide,
  elements: HgssBattleAnimationPlaybackElements,
): readonly HTMLElement[] {
  const defenderSide = attackerSide === 'player' ? 'opponent' : 'player'
  if (target === battlerSpriteAttacker) return [elements[attackerSide]]
  const defender = elements[defenderSide]
  if (target === battlerSpriteDefender) return [defender]
  if (target === battlerSpriteDefenderPartner) {
    return [...new Set((elements.additionalDefenders ?? []).filter((element) => element !== defender && element !== elements[attackerSide]))]
  }
  return []
}

function resolveNativeBattlerRoleElements(
  targets: number,
  attackerSide: SimpleBattleSide,
  elements: HgssBattleAnimationPlaybackElements,
): readonly HTMLElement[] {
  const defenderSide = attackerSide === 'player' ? 'opponent' : 'player'
  const attacker = elements[attackerSide]
  const defender = elements[defenderSide]
  const resolved: HTMLElement[] = []
  if ((targets & battleAnimAttacker) !== 0) resolved.push(attacker)
  if ((targets & battleAnimDefender) !== 0) resolved.push(defender)
  if ((targets & battleAnimDefenderPartner) !== 0) {
    resolved.push(...(elements.additionalDefenders ?? []).filter((element) => element !== defender && element !== attacker))
  }
  return [...new Set(resolved)]
}

function resolveNativeBattlerElement(
  target: number,
  attackerSide: SimpleBattleSide,
  elements: HgssBattleAnimationPlaybackElements,
): HTMLElement | undefined {
  if (target === battleAnimAttacker) return elements[attackerSide]
  if (target === battleAnimDefender) return elements[attackerSide === 'player' ? 'opponent' : 'player']
  if (target === battleAnimAttackerPartner) return elements.attackerPartner
  if (target === battleAnimDefenderPartner) return elements.defenderPartner
  if (target === (battleAnimSpecificBattler | battleAnimAttacker)) return elements.playerBattlers?.[0] ?? elements.player
  if (target === (battleAnimSpecificBattler | battleAnimAttackerPartner)) return elements.playerBattlers?.[1] ?? elements.player
  if (target === (battleAnimSpecificBattler | battleAnimDefender)) return elements.opponentBattlers?.[0] ?? elements.opponent
  if (target === (battleAnimSpecificBattler | battleAnimDefenderPartner)) return elements.opponentBattlers?.[1] ?? elements.player
  return undefined
}

/**
 * Exécute les mouvements confirmés dans l'interpréteur officiel et les six
 * familles de placement SPL observées dans l'ensemble des scripts de la ROM.
 */
export async function playConfirmedHgssBattleAnimation(
  script: HgssBattleAnimationScript,
  attackerSide: SimpleBattleSide,
  elements: HgssBattleAnimationPlaybackElements,
  audio?: HgssBattleAnimationPlaybackAudio,
  resolveParticleResource?: (memberId: number) => HgssSplParticleResource,
  context: HgssBattleAnimationPlaybackContext = {},
  spritePlayback?: HgssBattleAnimationSpritePlayback,
): Promise<void> {
  type TransformState = { moveX: number, moveY: number, revolveX: number, revolveY: number, hopY: number, shakeX: number, shakeY: number, rotationDegrees: number, scaleX: number, scaleY: number }
  const battlerElements = [...new Set([
    elements.player,
    elements.opponent,
    ...(elements.additionalDefenders ?? []),
    ...(elements.attackerPartner ? [elements.attackerPartner] : []),
    ...(elements.defenderPartner ? [elements.defenderPartner] : []),
    ...(elements.playerBattlers ?? []),
    ...(elements.opponentBattlers ?? []),
  ])]
  const states = new Map<HTMLElement, TransformState>(battlerElements.map((element) => [
    element,
    { moveX: 0, moveY: 0, revolveX: 0, revolveY: 0, hopY: 0, shakeX: 0, shakeY: 0, rotationDegrees: 0, scaleX: 1, scaleY: 1 },
  ]))
  const originalStyles = new Map([...states.keys()].map((element) => [element, {
    animation: element.style.animation,
    transform: element.style.transform,
    transformOrigin: element.style.transformOrigin,
    visibility: element.style.visibility,
    filter: element.style.filter,
    computedFilter: typeof getComputedStyle === 'function' ? getComputedStyle(element).filter : '',
    presentation: captureBattlePokemonSpritePresentation(element),
  }]))
  const background = elements.background
    ?? elements.player.closest?.('.battle-stage')?.querySelector<HTMLElement>('.battle-background')
    ?? undefined
  const backgroundStyle = background ? {
    filter: background.style.filter,
    computedFilter: typeof getComputedStyle === 'function' ? getComputedStyle(background).filter : '',
  } : undefined
  let backgroundGrayscale = false
  let backgroundFadeFilter = ''
  const renderBackgroundFilter = () => {
    if (!background || !backgroundStyle) return
    const baseFilter = backgroundStyle.computedFilter && backgroundStyle.computedFilter !== 'none'
      ? backgroundStyle.computedFilter
      : ''
    background.style.filter = [baseFilter, backgroundGrayscale ? 'grayscale(1)' : '', backgroundFadeFilter]
      .filter(Boolean)
      .join(' ') || backgroundStyle.filter
  }
  const ownsElement = (element: HTMLElement) => {
    const presentation = originalStyles.get(element)?.presentation
    return presentation !== undefined && isBattlePokemonSpritePresentationCurrent(element, presentation)
  }
  // Les mouvements ROM pilotent la pose du battler. Le flottement CSS moderne
  // est suspendu pendant cette courte fenêtre pour conserver les pas natifs.
  for (const element of states.keys()) element.style.animation = 'none'
  const render = (element: HTMLElement) => {
    if (!ownsElement(element)) return
    const state = states.get(element)!
    element.style.transform = `translate(${(state.moveX + state.revolveX + state.shakeX) * 100 / battleSpriteWidth}%, ${(state.moveY + state.revolveY + state.hopY + state.shakeY) * 100 / battleSpriteWidth}%) rotate(${state.rotationDegrees}deg) scale(${state.scaleX}, ${state.scaleY})`
  }
  let tasks: Promise<void>[] = []
  let emitterTasks: Promise<void>[] = []
  let soundTasks: Promise<void>[] = []
  let backgroundTasks: Promise<void>[] = []
  let partialBackgroundTasks: Promise<void>[] = []
  let cryTask: Promise<void> | undefined
  let completedNormally = false
  const startedSoundEffectIds = new Set<number>()
  const loopStack: Array<{ startInstructionIndex: number, remaining: number }> = []
  const callStack: number[] = []
  const scriptVariables = Array.from({ length: 10 }, () => 0)
  const instructionIndexByOffset = new Map(script.instructions.map((instruction, index) => [instruction.offsetWords, index]))
  const particleSystems = new Map<number, HgssSplParticleResource>()
  let currentParticleSystemIndex: number | undefined
  const reportDiagnostic = (
    instruction: HgssBattleAnimationInstruction,
    diagnostic: Omit<HgssBattleAnimationPlaybackDiagnostic, 'scriptId' | 'offsetWords' | 'instructionName' | 'opcode' | 'operands'>,
  ): void => {
    const fullDiagnostic: HgssBattleAnimationPlaybackDiagnostic = {
      ...diagnostic,
      scriptId: script.id,
      offsetWords: instruction.offsetWords,
      instructionName: instruction.name,
      opcode: instruction.opcode,
      operands: [...instruction.operands],
    }
    if (context.onDiagnostic) {
      context.onDiagnostic(fullDiagnostic)
      return
    }
    if (!import.meta.env.DEV) return
    const signature = `${fullDiagnostic.kind}:${fullDiagnostic.instructionName}:${fullDiagnostic.operands[0] ?? ''}:${fullDiagnostic.reason}`
    if (loggedDiagnosticSignatures.has(signature)) return
    loggedDiagnosticSignatures.add(signature)
    console.warn('[HGSS battle animation fallback]', fullDiagnostic)
  }
  let currentParticleInstruction: HgssBattleAnimationInstruction | undefined
  const reportParticleDiagnostic = (diagnostic: HgssSplParticleCanvasDiagnostic): void => {
    const instruction = currentParticleInstruction
    if (!instruction) return
    reportDiagnostic(instruction, {
      kind: 'particle-fallback',
      fallbackFrames: 0,
      reason: `${diagnostic.reason} (membre ${diagnostic.memberId}, émetteur ${diagnostic.emitterId}, callback ${diagnostic.callbackId})`,
    })
  }
  const particlePlayback = elements.effects && resolveParticleResource
    ? new HgssSplParticleCanvasPlayback(
        elements.effects,
        attackerSide === 'player'
          ? { player: elements.player, opponent: [elements.opponent, ...(elements.additionalDefenders ?? [])] }
          : { player: [elements.player, ...(elements.additionalDefenders ?? [])], opponent: elements.opponent },
        reportParticleDiagnostic,
      )
    : undefined
  const wait = (frames: number) => waitFrames(frames, context.signal)
  const enqueueSoundEffect = (sequenceId: number, play: () => Promise<void>): Promise<void> => {
    startedSoundEffectIds.add(sequenceId)
    const task = play().catch(() => undefined)
    soundTasks.push(task)
    return task
  }
  const drainSoundEffects = async (): Promise<void> => {
    while (soundTasks.length > 0 && !context.signal?.aborted) {
      const pending = soundTasks
      soundTasks = []
      await waitForTasks(pending, context.signal)
    }
  }
  const abortPlayback = () => {
    particlePlayback?.clear()
    if (audio) for (const sequenceId of startedSoundEffectIds) audio.stopSoundEffect(sequenceId)
  }
  context.signal?.addEventListener('abort', abortPlayback, { once: true })
  if (context.signal?.aborted) abortPlayback()

  const animateEmitterUntilComplete = async (
    completion: Promise<void>,
    sample: (taskFrame: number) => boolean,
  ): Promise<void> => {
    let emitterComplete = false
    void completion.then(() => { emitterComplete = true })
    let taskFrame = 0
    let transformComplete = sample(taskFrame)
    while ((!emitterComplete || !transformComplete) && !context.signal?.aborted) {
      await wait(1)
      taskFrame += 1
      transformComplete = sample(taskFrame)
    }
    await completion
  }
  const startMotion = (motion: ConfirmedHgssBattleMotion, instruction: HgssBattleAnimationInstruction): void => {
    const emitterFallback = (reason: string): void => {
      const fallbackFrames = estimateHgssNativeTaskFrames(instruction)
      if (fallbackFrames > 0) tasks.push(wait(fallbackFrames))
      reportDiagnostic(instruction, { kind: 'native-function-fallback', fallbackFrames, reason })
    }
    if (motion.kind === 'revolveEmitter') {
      if (!particlePlayback) {
        emitterFallback('canevas SPL indisponible pour la révolution native')
        return
      }
      const battlerSide = motion.battlerMode === 0
        ? attackerSide
        : attackerSide === 'player' ? 'opponent' : 'player'
      const battlerPosition = particlePlayback.battlerWorldPosition(battlerSide)
      const initialSample = sampleConfirmedHgssEmitterRevolution(motion, 0, battlerPosition)
      if (!particlePlayback.setEmitterAbsolutePosition(
        motion.particleSystemIndex,
        motion.emitterId,
        [initialSample.position[0], initialSample.position[1]],
      )) {
        emitterFallback(`émetteur natif ${motion.particleSystemIndex}:${motion.emitterId} introuvable`)
        return
      }
      const completion = particlePlayback.waitForEmitterCompletion(motion.particleSystemIndex, motion.emitterId)
      if (!completion) {
        emitterFallback(`cycle de vie de l'émetteur natif ${motion.particleSystemIndex}:${motion.emitterId} introuvable`)
        return
      }
      tasks.push(animateEmitterUntilComplete(completion, (taskFrame) => {
        const sample = sampleConfirmedHgssEmitterRevolution(motion, taskFrame, battlerPosition)
        particlePlayback.setEmitterAbsolutePosition(
          motion.particleSystemIndex,
          motion.emitterId,
          [sample.position[0], sample.position[1]],
        )
        return sample.complete
      }))
      return
    }
    if (motion.kind === 'moveEmitter') {
      if (!particlePlayback) {
        emitterFallback('canevas SPL indisponible pour la trajectoire native')
        return
      }
      const defenderSide = attackerSide === 'player' ? 'opponent' : 'player'
      const attackerPosition = particlePlayback.battlerWorldPosition(attackerSide)
      const defenderPosition = particlePlayback.battlerWorldPosition(defenderSide)
      const initialSample = sampleConfirmedHgssEmitterTrajectory(motion, 0, attackerPosition, defenderPosition, attackerSide)
      if (!particlePlayback.setEmitterAbsolutePosition(motion.particleSystemIndex, motion.emitterId, initialSample.position)) {
        emitterFallback(`émetteur natif ${motion.particleSystemIndex}:${motion.emitterId} introuvable`)
        return
      }
      const completion = particlePlayback.waitForEmitterCompletion(motion.particleSystemIndex, motion.emitterId)
      if (!completion) {
        emitterFallback(`cycle de vie de l'émetteur natif ${motion.particleSystemIndex}:${motion.emitterId} introuvable`)
        return
      }
      tasks.push(animateEmitterUntilComplete(completion, (taskFrame) => {
        const sample = sampleConfirmedHgssEmitterTrajectory(motion, taskFrame, attackerPosition, defenderPosition, attackerSide)
        particlePlayback.setEmitterAbsolutePosition(motion.particleSystemIndex, motion.emitterId, sample.position)
        return sample.complete
      }))
      return
    }
    if (motion.kind === 'fadeBackground') {
      if (!background) return
      const totalFrames = hgssPaletteFadeTaskFrames(motion.delay, motion.startAlpha, motion.endAlpha)
      tasks.push(animateNativeTaskFrames(totalFrames, (taskFrame) => {
        const sample = sampleConfirmedHgssBackgroundFade(motion, taskFrame)
        backgroundFadeFilter = hgssBgr555FadeFilter(motion.color, sample.alpha)
        renderBackgroundFilter()
      }, context.signal))
      return
    }
    if (motion.kind === 'setBackgroundGrayscale') {
      backgroundGrayscale = motion.enabled
      renderBackgroundFilter()
      return
    }
    if (motion.kind === 'fadeBattlerSprite') {
      const element = resolveNativeBattlerElement(motion.target, attackerSide, elements)
      if (!element) return
      const totalFrames = ((motion.fadeStepFrames + 1) * motion.alpha * 2 + 4) * motion.cycles + motion.holdFrames
      tasks.push(animateNativeTaskFrames(totalFrames, (taskFrame) => {
        if (!ownsElement(element)) return
        const sample = sampleConfirmedHgssBattlerFade(motion, taskFrame)
        const nativeFilter = hgssBgr555FadeFilter(motion.color, sample.alpha)
        const baseFilter = originalStyles.get(element)?.computedFilter
        element.style.filter = nativeFilter
          ? `${baseFilter && baseFilter !== 'none' ? `${baseFilter} ` : ''}${nativeFilter}`
          : originalStyles.get(element)?.filter ?? ''
      }, context.signal))
      return
    }
    if (motion.kind === 'scaleBattlerSprite') {
      const element = resolveNativeBattlerElement(motion.target, attackerSide, elements)
      if (!element) return
      const totalFrames = (motion.scaleFrames + motion.restoreFrames + 3) * motion.cycles + motion.holdFrames
      const state = states.get(element)!
      tasks.push(animateNativeTaskFrames(totalFrames, (taskFrame) => {
        if (!ownsElement(element)) return
        const sample = sampleConfirmedHgssBattlerScale(motion, taskFrame)
        state.scaleX = sample.scaleX
        state.scaleY = sample.scaleY
        render(element)
      }, context.signal))
      return
    }
    if (motion.kind === 'revolveBattler') {
      const element = resolveNativeBattlerElement(motion.target, attackerSide, elements)
      if (!element) return
      const totalFrames = motion.revolutions * motion.framesPerRevolution
      const state = states.get(element)!
      tasks.push(animateNativeTaskFrames(totalFrames, (taskFrame) => {
        if (!ownsElement(element)) return
        const sample = sampleConfirmedHgssBattlerRevolution(motion, taskFrame)
        state.revolveX = sample.offsetX
        state.revolveY = sample.offsetY
        render(element)
      }, context.signal))
      return
    }
    if (motion.kind === 'playfulHops') {
      const targetSide = motion.target === 'attacker'
        ? attackerSide
        : attackerSide === 'player' ? 'opponent' : 'player'
      const element = elements[targetSide]
      const state = states.get(element)!
      const initialDirection = (context.contest
        ? attackerSide === 'player' ? -1 : 1
        : attackerSide === 'player' ? 1 : -1) as 1 | -1
      tasks.push(animateNativeTaskFrames(33, (taskFrame) => {
        if (!ownsElement(element)) return
        const sample = sampleConfirmedHgssPlayfulHops(taskFrame, initialDirection)
        state.hopY = sample.offsetY
        state.rotationDegrees = sample.rotationIndex * 360 / 0x10000
        element.style.transformOrigin = `${50 + sample.pivotX * 100 / battleSpriteWidth}% ${50 + sample.pivotY * 100 / battleSpriteWidth}%`
        render(element)
      }, context.signal))
      return
    }
    if (motion.kind === 'blinkAttacker') {
      const element = elements[attackerSide]
      const transitionFrames = motion.interval + 1
      const toggleCount = motion.count * 2
      const totalFrames = (toggleCount + 1) * transitionFrames
      tasks.push(animateNativeTaskFrames(totalFrames, (taskFrame) => {
        if (!ownsElement(element)) return
        const completedToggles = Math.min(toggleCount, Math.floor(taskFrame / transitionFrames))
        element.style.visibility = completedToggles % 2 === 1 ? 'hidden' : ''
      }, context.signal))
      return
    }
    if (motion.kind === 'setBattlerVisibility') {
      for (const element of resolveNativeBattlerRoleElements(motion.targets, attackerSide, elements)) {
        if (ownsElement(element)) element.style.visibility = motion.hidden ? 'hidden' : ''
      }
      return
    }
    if (motion.kind === 'renderPokemonSprites') {
      tasks.push(wait(motion.frames))
      return
    }
    if (motion.kind === 'moveBattler' || motion.kind === 'moveBattlerX') {
      if (motion.frames < 0) return
      const targetSide = motion.target === battlerSpriteAttacker
        ? attackerSide
        : attackerSide === 'player' ? 'opponent' : 'player'
      const targetElements = motion.kind === 'moveBattlerX'
        ? resolveExactBattlerSpriteElements(motion.target, attackerSide, elements)
        : resolveBattlerElements(motion.target, attackerSide, elements)
      for (const element of targetElements) {
        const state = states.get(element)!
        const startX = state.moveX
        const startY = state.moveY
        const sideDirection = targetSide === 'player' ? 1 : -1
        const endX = startX + motion.offsetX * sideDirection
        const endY = startY + (motion.kind === 'moveBattlerX' ? 0 : motion.offsetY * sideDirection)
        tasks.push(animateFrames(motion.frames, (progress) => {
          state.moveX = startX + (endX - startX) * progress
          state.moveY = startY + (endY - startY) * progress
          render(element)
        }, context.signal))
      }
      return
    }

    if (motion.kind === 'rockBattler') {
      // Le mode 2 de ov07_02223A94 travaille sur le target du contexte
      // d'animation, pas sur l'attacker qui a déclenché le sous-script.
      const targetSide = attackerSide === 'player' ? 'opponent' : 'player'
      const totalFrames = motion.framesPerLeg * 2 + 3
      for (const element of resolveBattlerElements(battlerSpriteDefender, attackerSide, elements)) {
        const state = states.get(element)!
        tasks.push(animateNativeTaskFrames(totalFrames, (taskFrame) => {
          if (!ownsElement(element)) return
          const sample = sampleConfirmedHgssRockBattler(motion, targetSide, taskFrame)
          element.style.transformOrigin = sample.complete
            ? '50% 50%'
            : `${50 + sample.pivotX * 100 / battleSpriteWidth}% ${50 + sample.pivotY * 100 / battleSpriteWidth}%`
          state.rotationDegrees = sample.rotationIndex * 360 / 0x10000
          render(element)
        }, context.signal))
      }
      return
    }

    if (motion.interval <= 0 || motion.amount <= 0) return
    for (const target of [battlerSpriteAttacker, battlerSpriteDefender]) {
      if ((motion.targets & target) !== target) continue
      for (const element of resolveBattlerElements(target, attackerSide, elements)) {
        const state = states.get(element)!
        const frames = motion.interval * maxShakeCycles * motion.amount
        tasks.push(animateFrames(frames, (_progress, elapsedFrames) => {
          const step = Math.min(maxShakeCycles * motion.amount, Math.floor(elapsedFrames / motion.interval) + 1)
          const phase = step % maxShakeCycles
          state.shakeX = phase === 1 ? motion.extentX : phase === 3 ? -motion.extentX : 0
          state.shakeY = phase === 1 ? motion.extentY : phase === 3 ? -motion.extentY : 0
          if (elapsedFrames >= frames) state.shakeX = state.shakeY = 0
          render(element)
        }, context.signal))
      }
    }
  }

  const branchTarget = (instruction: HgssBattleAnimationInstruction, operandIndex: number): number => {
    const encoded = instruction.operands[operandIndex]
    if (encoded === undefined) throw new Error(`Branche d'animation HGSS tronquée à ${instruction.offsetWords}.`)
    // Les macros DS encodent (label - adresse_de_l_operande) / 4.
    const targetOffset = instruction.offsetWords + 1 + operandIndex + signed(encoded)
    const targetIndex = instructionIndexByOffset.get(targetOffset)
    if (targetIndex === undefined) throw new Error(`Cible d'animation HGSS ${targetOffset} absente du script ${script.id}.`)
    return targetIndex
  }

  try {
    let instructionIndex = 0
    let executedInstructions = 0
    const maximumExecutedInstructions = Math.max(1024, script.instructions.length * 64)
    while (instructionIndex < script.instructions.length) {
      if (context.signal?.aborted) break
      if (++executedInstructions > maximumExecutedInstructions) throw new Error(`Boucle de contrôle infinie dans l'animation HGSS ${script.id}.`)
      const instruction = script.instructions[instructionIndex]!
      let nextInstructionIndex = instructionIndex + 1
      if (instruction.name === 'Delay') await wait(signed(instruction.operands[0] ?? 0))
      else if (instruction.name === 'BeginLoop') {
        loopStack.push({ startInstructionIndex: nextInstructionIndex, remaining: Math.max(1, signed(instruction.operands[0] ?? 1)) })
      } else if (instruction.name === 'EndLoop') {
        const loop = loopStack.at(-1)
        if (loop && --loop.remaining > 0) nextInstructionIndex = loop.startInstructionIndex
        else loopStack.pop()
      } else if (instruction.name === 'Call') {
        if (callStack.length >= 4) throw new Error(`Pile d'appels saturée dans l'animation HGSS ${script.id}.`)
        callStack.push(nextInstructionIndex)
        nextInstructionIndex = branchTarget(instruction, 0)
      } else if (instruction.name === 'Return') {
        const returnIndex = callStack.pop()
        if (returnIndex === undefined) throw new Error(`Return sans Call dans l'animation HGSS ${script.id}.`)
        nextInstructionIndex = returnIndex
      } else if (instruction.name === 'SetVar') {
        const variableId = instruction.operands[0]
        if (variableId !== undefined && variableId < scriptVariables.length) scriptVariables[variableId] = signed(instruction.operands[1] ?? 0)
      } else if (instruction.name === 'ResetVars') {
        scriptVariables.fill(0)
      } else if (instruction.name === 'Jump') {
        nextInstructionIndex = branchTarget(instruction, 0)
      } else if (instruction.name === 'JumpIfEqual') {
        const variableId = instruction.operands[0]
        if (variableId !== undefined && scriptVariables[variableId] === signed(instruction.operands[1] ?? 0)) nextInstructionIndex = branchTarget(instruction, 2)
      } else if (instruction.name === 'JumpIfEffectChanceOdd') {
        nextInstructionIndex = branchTarget(instruction, ((context.effectChance ?? 0) & 1) === 0 ? 0 : 1)
      } else if (instruction.name === 'JumpIfEffectChance') {
        if (signed(instruction.operands[0] ?? 0) === (context.effectChance ?? 0)) nextInstructionIndex = branchTarget(instruction, 1)
      } else if (instruction.name === 'JumpIfBattlerSide') {
        const testedSide = instruction.operands[0] === 0
          ? attackerSide
          : context.friendlyFire
            ? attackerSide
            : attackerSide === 'player' ? 'opponent' : 'player'
        nextInstructionIndex = branchTarget(instruction, testedSide === 'player' ? 1 : 2)
      } else if (instruction.name === 'JumpIfWeather') {
        const weatherOperand = context.weather === 'rain' ? 1
          : context.weather === 'sandstorm' ? 2
            : context.weather === 'sun' ? 3
              : context.weather === 'hail' ? 4 : 0
        nextInstructionIndex = branchTarget(instruction, weatherOperand)
      } else if (instruction.name === 'JumpIfContest') {
        if (context.contest) nextInstructionIndex = branchTarget(instruction, 0)
      } else if (instruction.name === 'JumpIfFriendlyFire') {
        if (context.friendlyFire) nextInstructionIndex = branchTarget(instruction, 0)
      } else if (instruction.name === 'JumpIfUnknown01') {
        if (context.unknown01) nextInstructionIndex = branchTarget(instruction, 0)
      } else if (instruction.name === 'WaitForAnimTasks') {
        await waitForTasks(tasks, context.signal)
        tasks = []
      } else if (instruction.name === 'PlaySoundEffect') {
        const sequenceId = signed(instruction.operands[0] ?? -1)
        if (sequenceId >= 0 && audio) enqueueSoundEffect(sequenceId, () => audio.playSoundEffect(sequenceId))
      } else if (instruction.name === 'PlayPannedSoundEffect' && audio) {
        const soundEffect = decodeConfirmedHgssPannedSoundEffect(instruction, attackerSide)
        if (soundEffect) enqueueSoundEffect(soundEffect.sequenceId, () => audio.playPannedSoundEffect(soundEffect.sequenceId, soundEffect.pan))
      } else if (instruction.name === 'StopSoundEffect') {
        audio?.stopSoundEffect(signed(instruction.operands[0] ?? -1))
      } else if (instruction.name === 'PlayPokemonCry' && audio) {
        const cry = decodeConfirmedHgssPokemonCry(instruction, attackerSide)
          if (cry) {
          cryTask = audio.playPokemonCry(attackerSide, cry.modulation, cry.pan, cry.volume).catch(() => undefined)
        }
      } else if (instruction.name === 'WaitForPokemonCries' && audio) {
        if (cryTask) await waitForTasks([cryTask], context.signal)
        cryTask = undefined
        while (!context.signal?.aborted && audio.isPokemonCryPlaying()) await wait(1)
      } else if (instruction.name === 'PlayDelayedSoundEffect' && audio) {
        const [sequenceId, encodedPan, delay] = instruction.operands
        if (sequenceId !== undefined && encodedPan !== undefined && delay !== undefined) {
          const pan = signed(encodedPan) * (attackerSide === 'player' ? 1 : -1)
          const delayedTask = wait(signed(delay)).then(() => {
            if (!context.signal?.aborted) enqueueSoundEffect(sequenceId, () => audio.playPannedSoundEffect(sequenceId, pan))
          }).catch(() => undefined)
          soundTasks.push(delayedTask)
        }
      } else if (instruction.name === 'PlayLoopedSoundEffect' && audio) {
        const [sequenceId, encodedPan, interval, count] = instruction.operands
        if (sequenceId !== undefined && encodedPan !== undefined && interval !== undefined && count !== undefined) {
          const pan = signed(encodedPan) * (attackerSide === 'player' ? 1 : -1)
          soundTasks.push((async () => {
            // Le task natif initialise son compteur au délai demandé : le
            // premier son part au premier callback, puis après délai + 1 ticks.
            let delayCounter = Math.max(0, signed(interval))
            let remaining = Math.max(0, signed(count))
            while (remaining > 0) {
              await wait(1)
              if (context.signal?.aborted) break
              const previousCounter = delayCounter
              delayCounter += 1
              if (previousCounter < interval) continue
              delayCounter = 0
              remaining -= 1
              enqueueSoundEffect(sequenceId, () => audio.playPannedSoundEffect(sequenceId, pan))
            }
          })())
        }
      } else if ((instruction.name === 'PlayMovingSoundEffectAtkDef'
        || instruction.name === 'PlayMovingSoundEffectAtkDef2'
        || instruction.name === 'PlayMovingSoundEffectNoCorrection') && audio) {
        const [sequenceId, encodedStartPan, encodedEndPan, encodedPanStep, encodedInterval] = instruction.operands
        if (sequenceId !== undefined && encodedStartPan !== undefined && encodedEndPan !== undefined && encodedPanStep !== undefined && encodedInterval !== undefined) {
          const sideSign = attackerSide === 'player' ? 1 : -1
          const startPan = signed(encodedStartPan) * sideSign
          const endPan = signed(encodedEndPan) * sideSign
          const panStep = signed(encodedPanStep)
          const intervalFrames = signed(encodedInterval)
          if (audio.playMovingSoundEffect) {
            enqueueSoundEffect(sequenceId, () => audio.playMovingSoundEffect!(sequenceId, startPan, endPan, panStep, intervalFrames))
          } else {
            enqueueSoundEffect(sequenceId, () => audio.playPannedSoundEffect(sequenceId, startPan))
            reportDiagnostic(instruction, {
              kind: 'instruction-fallback',
              fallbackFrames: 0,
              reason: 'panoramique mobile approximé par sa position initiale',
            })
          }
        }
      } else if (instruction.name === 'WaitForSoundEffects') {
        await drainSoundEffects()
      } else if (instruction.name === 'SwitchBg' || instruction.name === 'SwitchBgEx' || instruction.name === 'RestoreBg') {
        const frames = Math.min(24, Math.max(8, (instruction.operands.at(-1)! & 0xffff) * 8))
        backgroundTasks.push(wait(frames))
        partialBackgroundTasks.push(wait(Math.ceil(frames / 2)))
        reportDiagnostic(instruction, {
          kind: 'instruction-fallback',
          fallbackFrames: frames,
          reason: 'transition de fond temporisée sans texture BG native',
        })
      } else if (instruction.name === 'WaitForPartialBgSwitch') {
        await waitForTasks(partialBackgroundTasks, context.signal)
        partialBackgroundTasks = []
      } else if (instruction.name === 'WaitForBgSwitch') {
        await waitForTasks(backgroundTasks, context.signal)
        backgroundTasks = []
        partialBackgroundTasks = []
      } else if (instruction.name === 'LoadParticleSystem' && resolveParticleResource) {
        const particleSystemIndex = instruction.operands[0]
        const memberId = instruction.operands[1]
        if (particleSystemIndex !== undefined && memberId !== undefined) {
          particleSystems.set(particleSystemIndex, resolveParticleResource(memberId))
          await wait(2)
        }
      } else if ((instruction.name === 'CreateEmitter' || instruction.name === 'CreateEmitterEx') && particlePlayback) {
        const particleSystemIndex = instruction.operands[0]
        const particleSystem = particleSystems.get(particleSystemIndex ?? -1)
        const nativeEmitterId = instruction.name === 'CreateEmitterEx' ? instruction.operands[1] : 0
        const resourceEmitterId = instruction.name === 'CreateEmitterEx' ? instruction.operands[2] : instruction.operands[1]
        const callbackId = instruction.name === 'CreateEmitterEx' ? instruction.operands[3] : instruction.operands[2]
        if (particleSystemIndex !== undefined) currentParticleSystemIndex = particleSystemIndex
        if (particleSystem && nativeEmitterId !== undefined && resourceEmitterId !== undefined && callbackId !== undefined) {
          const genericCallback = callbackId === 17
            ? decodeConfirmedHgssGenericEmitterCallback(script.instructions, instructionIndex)
            : undefined
          const explicitWorldPosition = genericCallback
            ? resolveConfirmedHgssGenericEmitterPosition(
                genericCallback,
                attackerSide,
                particlePlayback.battlerWorldPosition(attackerSide),
              )
            : undefined
          if (genericCallback) nextInstructionIndex += genericCallback.consumedInstructions
          currentParticleInstruction = instruction
          const task = particlePlayback.createEmitter(
            particleSystem,
            resourceEmitterId,
            callbackId,
            attackerSide,
            explicitWorldPosition,
            particleSystemIndex,
            nativeEmitterId,
          )
          currentParticleInstruction = undefined
          if (task) emitterTasks.push(task)
        }
      } else if (instruction.name === 'WaitForAllEmitters') {
        await waitForTasks(emitterTasks, context.signal)
        emitterTasks = []
      } else if (instruction.name === 'UnloadParticleSystem') {
        particleSystems.delete(instruction.operands[0] ?? -1)
      } else if (instruction.name === 'AddSpriteWithFunc' && spritePlayback) {
        const sprite = decodeConfirmedHgssBattleSprite(instruction)
        if (sprite) {
          const resource = spritePlayback.resolveResource(sprite.resource)
          // Le callback 10 prend son signe depuis l'attacker, mais ancre les
          // deux glyphes sur le target (ov07_0221C468 / ov07_0221C470).
          const targetSide = attackerSide === 'player' ? 'opponent' : 'player'
          for (const target of resolveBattlerElements(battlerSpriteDefender, attackerSide, elements)) {
            const handle = spritePlayback.createSprite(resource, targetSide, target)
            tasks.push(animateNativeTaskFrames(24, (taskFrame) => {
              handle.render(sampleConfirmedHgssAngerSprite(attackerSide, taskFrame))
              if (taskFrame === 24) handle.destroy()
            }, context.signal).catch((error) => {
              handle.destroy()
              throw error
            }))
          }
        }
      } else if (instruction.name === 'CallFunc') {
        const motion = decodeConfirmedHgssBattleMotion(instruction, currentParticleSystemIndex)
        if (motion) startMotion(motion, instruction)
        else if (isConfirmedHgssNoOpNativeFunction(instruction)) {
          // La fonction native 0 est explicitement Nop dans la table HGSS.
        }
        else {
          const fallbackFrames = estimateHgssNativeTaskFrames(instruction)
          if (fallbackFrames > 0) tasks.push(wait(fallbackFrames))
          const functionId = instruction.operands[0]
          reportDiagnostic(instruction, {
            kind: 'native-function-fallback',
            fallbackFrames,
            reason: `fonction native ${functionId ?? '?'} (${nativeFunctionNames[functionId ?? -1] ?? 'inconnue'}) sans rendu dédié`,
          })
        }
      } else if (instruction.name === 'StartBattlerSlideIn' || instruction.name === 'StartBattlerSlideOut') {
        tasks.push(wait(8))
        reportDiagnostic(instruction, {
          kind: 'instruction-fallback',
          fallbackFrames: 8,
          reason: 'glissement de battler conservé comme tâche native temporisée',
        })
      } else if (instruction.name === 'HgssUnknown85') {
        const frames = positiveFrame(instruction.operands[0], 8)
        tasks.push(wait(frames))
        reportDiagnostic(instruction, { kind: 'instruction-fallback', fallbackFrames: frames, reason: 'tâche HGSS 85 temporisée par son opérande' })
      } else if (instruction.name === 'HgssUnknown86') {
        const frames = 8
        tasks.push(wait(frames))
        reportDiagnostic(instruction, { kind: 'instruction-fallback', fallbackFrames: frames, reason: 'tâche HGSS 86 conservée avec délai borné' })
      } else if (instruction.name === 'WaitForLRX') {
        await wait(1)
        reportDiagnostic(instruction, { kind: 'instruction-fallback', fallbackFrames: 1, reason: 'synchronisation matérielle L/R/X ramenée à un VBlank' })
      } else if (instruction.name !== 'End' && !silentDeclarativeInstructions.has(instruction.name)) {
        reportDiagnostic(instruction, {
          kind: 'instruction-fallback',
          fallbackFrames: 0,
          reason: 'commande connue mais présentation Web non portée',
        })
      }
      if (instruction.name === 'End') break
      instructionIndex = nextInstructionIndex
    }
    await waitForTasks(tasks, context.signal)
    await waitForTasks(emitterTasks, context.signal)
    completedNormally = true
  } finally {
    context.signal?.removeEventListener('abort', abortPlayback)
    if (!completedNormally || context.signal?.aborted) abortPlayback()
    particlePlayback?.clear()
    for (const [element, styles] of originalStyles) {
      if (!isBattlePokemonSpritePresentationCurrent(element, styles.presentation)) continue
      element.style.animation = styles.animation
      element.style.transform = styles.transform
      element.style.transformOrigin = styles.transformOrigin
      element.style.visibility = styles.visibility
      element.style.filter = styles.filter
    }
    if (background && backgroundStyle) background.style.filter = backgroundStyle.filter
  }
}
