import type { NitroGraphic } from '../../ndsTypes'
import type { HgssBattleBallSpriteAsset } from '../../rom/battle/battleBallSprites'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { hgssVBlanksToMilliseconds } from '../time/hgssFrameTiming'
import {
  clearBattleCssAnimation,
  clearBattleCssAnimations,
  restartBattleCssAnimation,
  type BattleCssAnimationRun,
} from './battleCssAnimation'
import {
  beginBattleBallSendOutOpen,
  beginBattleBallSendOutThrow,
  cancelBattleBallSendOutPresentation,
  createBattleBallSendOutPresentation,
  finishBattleBallSendOutOpen,
  finishBattleBallSendOutThrow,
  hasNativeBattleBallSendOutAsset,
  removeTransientBattleBallSendOut,
  renderBattleBallSendOutFrame,
  resetSharedBattleBallSendOut,
  type BattleBallSendOutPresentation,
} from './battleBallSendOutPresentation'
import { hgssBattleAudioSequences } from './hgssBattleAudio'
import { resolveHgssBattleSendOutBallId } from './hgssBattleSendOutBall'
import { playBattlePokemonEntrance } from './battleSceneAnimations'

export type HgssBattleSendOutSide = 'player' | 'opponent'
export type HgssBattlePokemonSendOutMode = 'throw' | 'release-only'
export type HgssBattlePokemonSendOutPhase = 'throw' | 'open' | 'materialize' | 'hud'
export type HgssBattlePokemonSendOutStatus = 'completed' | 'cancelled' | 'stale'

export const HGSS_BATTLE_SEND_OUT_TIMING = Object.freeze({
  throwFrames: 16,
  openFrames: 23,
  releaseLeadFrames: 2,
  switchWindowFrames: 72,
  playerIntroductionWindowFrames: 96,
  opponentIntroductionWindowFrames: 112,
  hudFrames: 18,
})

export const HGSS_BATTLE_SEND_OUT_SOUND_CUES = Object.freeze({
  throw: hgssBattleAudioSequences.throwSound,
  open: hgssBattleAudioSequences.ballOpenSound,
})

export type HgssBattlePokemonSendOutEntry = Readonly<{
  side: HgssBattleSendOutSide
  slot: number
  pokemon: Pick<CanonicalPokemon, 'speciesId'> & Partial<Pick<CanonicalPokemon, 'ballId'>>
  /** Prioritaire sur le PK4, notamment lors du breakout d'une capture. */
  ballId?: number
  sprite: HTMLElement
  hud?: HTMLElement | null
  /** Modèle de host en lancer normal, host déjà placé en release-only. */
  host: HTMLElement
}>

export type HgssBattlePokemonSendOutPhaseEvent = Readonly<{
  phase: HgssBattlePokemonSendOutPhase
  ballIds: readonly number[]
}>

export type HgssBattlePokemonSendOutPresentation = Readonly<{
  side: HgssBattleSendOutSide
  slot: number
  ballId: number
  ball: HTMLElement
  graphicSource: 'ball-sprite' | 'generic'
}>

export type HgssBattlePokemonSendOutResult = Readonly<{
  status: HgssBattlePokemonSendOutStatus
  mode: HgssBattlePokemonSendOutMode
  phases: readonly HgssBattlePokemonSendOutPhase[]
  presentations: readonly HgssBattlePokemonSendOutPresentation[]
}>

export type HgssBattlePokemonSendOutRun = Readonly<{
  finished: Promise<HgssBattlePokemonSendOutResult>
  cancel: () => void
}>

export type HgssBattlePokemonSendOutOptions = Readonly<{
  mode?: HgssBattlePokemonSendOutMode
  entries: readonly HgssBattlePokemonSendOutEntry[]
  stage: HTMLElement
  ballSpriteResolver: (ballId: number) => HgssBattleBallSpriteAsset | undefined
  createGraphic: (graphic: NitroGraphic) => HTMLElement
  playCry?: (pokemon: HgssBattlePokemonSendOutEntry['pokemon'], side: HgssBattleSendOutSide, slot: number) => void | Promise<void>
  playCrySequence?: (entries: readonly Readonly<{
    pokemon: HgssBattlePokemonSendOutEntry['pokemon']
    side: HgssBattleSendOutSide
    slot: number
  }>[]) => void | Promise<void>
  playSoundEffect?: (sequenceId: number) => void | Promise<void>
  waitFrames?: (frames: number) => Promise<void>
  /** Fenêtre depuis l'émission du send-out jusqu'au HUD : 72 switch, 96 intro joueur, 112 intro adverse. */
  completionWindowFrames?: number
  reducedMotion?: boolean
  isCurrent?: () => boolean
  onPhase?: (event: HgssBattlePokemonSendOutPhaseEvent) => void
}>

type MutablePresentation = {
  entry: HgssBattlePokemonSendOutEntry
  ballPresentation: BattleBallSendOutPresentation
  spriteAnimation?: BattleCssAnimationRun
  hudAnimation?: BattleCssAnimationRun
}

const pokemonMotionClasses = ['is-arriving', 'is-hit', 'is-stat-up', 'is-stat-down', 'is-heal', 'is-fainting'] as const
let playbackGeneration = 0

class SendOutStopped {
  readonly status: Exclude<HgssBattlePokemonSendOutStatus, 'completed'>

  constructor(status: Exclude<HgssBattlePokemonSendOutStatus, 'completed'>) {
    this.status = status
  }
}

function defaultWaitFrames(frames: number): Promise<void> {
  if (frames <= 0) return Promise.resolve()
  return new Promise((resolve) => globalThis.setTimeout(resolve, hgssVBlanksToMilliseconds(frames)))
}

function resolveEntryBallId(entry: HgssBattlePokemonSendOutEntry): number {
  return entry.ballId === undefined
    ? resolveHgssBattleSendOutBallId(entry.pokemon)
    : resolveHgssBattleSendOutBallId({ ballId: entry.ballId })
}

function playAudio(callback: (() => void | Promise<void>) | undefined): void {
  if (!callback) return
  try { void Promise.resolve(callback()).catch(() => undefined) } catch { /* WebAudio suspendu */ }
}

function preparePokemonHost(element: HTMLElement, token: string): void {
  clearBattleCssAnimations(element, { cancelSubtreeAnimations: false })
  for (const className of pokemonMotionClasses) element.classList.remove(className)
  element.dataset.battleSendOut = token
  element.hidden = true
}

function ownsPokemonHost(element: HTMLElement, token: string): boolean {
  return element.dataset.battleSendOut === token
}

/**
 * Lecteur unique des introductions simples, doubles et remplacements. Chaque
 * entrée possède sa propre Ball, tandis que les quatre barrières restent
 * communes afin que deux Pokémon ne divergent jamais visuellement.
 */
export function playHgssBattlePokemonSendOut(
  options: HgssBattlePokemonSendOutOptions,
): HgssBattlePokemonSendOutRun {
  const mode = options.mode ?? 'throw'
  const reducedMotion = options.reducedMotion ?? false
  const isCurrent = options.isCurrent ?? (() => true)
  const baseWaitFrames = options.waitFrames ?? defaultWaitFrames
  const token = String(++playbackGeneration)
  const phases: HgssBattlePokemonSendOutPhase[] = []
  const presentations: MutablePresentation[] = []
  let stopped: Exclude<HgssBattlePokemonSendOutStatus, 'completed'> | undefined
  let settled = false
  let criesPlayed = false
  let releaseStop!: () => void
  const stopBarrier = new Promise<void>((resolve) => { releaseStop = resolve })

  const ensureCurrent = (): void => {
    if (stopped) throw new SendOutStopped(stopped)
    if (!isCurrent()) {
      stopped = 'stale'
      releaseStop()
      throw new SendOutStopped('stale')
    }
  }
  const waitFrames = async (frames: number): Promise<void> => {
    ensureCurrent()
    if (!reducedMotion && frames > 0) await Promise.race([baseWaitFrames(frames), stopBarrier])
    ensureCurrent()
  }
  const enterPhase = (phase: HgssBattlePokemonSendOutPhase): void => {
    ensureCurrent()
    phases.push(phase)
    options.onPhase?.({ phase, ballIds: presentations.map(({ ballPresentation }) => ballPresentation.ballId) })
    ensureCurrent()
  }
  const playNativeSequence = async (sequence: 'closed' | 'active', frames: number): Promise<void> => {
    const native = presentations.filter(({ ballPresentation }) => hasNativeBattleBallSendOutAsset(ballPresentation))
    if (native.length === 0) return waitFrames(frames)
    for (let elapsed = 0; elapsed < frames; elapsed += 1) {
      ensureCurrent()
      for (const { ballPresentation } of native) renderBattleBallSendOutFrame(ballPresentation, sequence, elapsed)
      await waitFrames(1)
    }
  }

  const playCries = (): void => {
    if (criesPlayed) return
    const entries = presentations
      .filter(({ entry }) => ownsPokemonHost(entry.sprite, token))
      .map(({ entry }) => ({ pokemon: entry.pokemon, side: entry.side, slot: entry.slot }))
    if (entries.length === 0) return
    criesPlayed = true
    if (options.playCrySequence) {
      playAudio(() => options.playCrySequence!(entries))
      return
    }
    for (const entry of entries) playAudio(() => options.playCry?.(entry.pokemon, entry.side, entry.slot))
  }

  const materialize = (): void => {
    enterPhase('materialize')
    for (const presentation of presentations) {
      if (!ownsPokemonHost(presentation.entry.sprite, token)) continue
      presentation.spriteAnimation = playBattlePokemonEntrance({
        sprite: presentation.entry.sprite,
        reducedMotion,
      })
    }
    playCries()
  }

  const fastForward = (): void => {
    if (!isCurrent()) return
    for (const presentation of presentations) {
      finishBattleBallSendOutOpen(presentation.ballPresentation)
      removeTransientBattleBallSendOut(presentation.ballPresentation)
      if (ownsPokemonHost(presentation.entry.sprite, token)) {
        clearBattleCssAnimations(presentation.entry.sprite, { cancelSubtreeAnimations: false })
        for (const className of pokemonMotionClasses) presentation.entry.sprite.classList.remove(className)
        presentation.entry.sprite.hidden = false
      }
      const hud = presentation.entry.hud
      if (hud && ownsPokemonHost(hud, token)) {
        clearBattleCssAnimations(hud, { cancelSubtreeAnimations: false })
        hud.classList.remove('is-arriving', 'is-updating')
        hud.hidden = false
      }
    }
    playCries()
  }

  const cleanup = (status: HgssBattlePokemonSendOutStatus): void => {
    for (const presentation of presentations) {
      const ball = presentation.ballPresentation
      cancelBattleBallSendOutPresentation(ball)
      removeTransientBattleBallSendOut(ball)
      if (!ball.transient && status !== 'stale' && ownsPokemonHost(ball.ball, token)) {
        resetSharedBattleBallSendOut(ball)
      }
      for (const element of [presentation.entry.sprite, presentation.entry.hud].filter(Boolean) as HTMLElement[]) {
        if (status === 'stale') continue
        if (!ownsPokemonHost(element, token)) continue
        delete element.dataset.battleSendOut
      }
    }
  }

  const run = async (): Promise<HgssBattlePokemonSendOutResult> => {
    let status: HgssBattlePokemonSendOutStatus = 'completed'
    try {
      ensureCurrent()
      for (const entry of options.entries) {
        const ballPresentation = createBattleBallSendOutPresentation({
          side: entry.side,
          slot: entry.slot,
          ballId: resolveEntryBallId(entry),
          host: entry.host,
          stage: options.stage,
          transient: mode !== 'release-only',
          resolveAsset: options.ballSpriteResolver,
          createGraphic: options.createGraphic,
        })
        const presentation: MutablePresentation = {
          entry,
          ballPresentation,
        }
        presentations.push(presentation)
        if (!ballPresentation.transient) ballPresentation.ball.dataset.battleSendOut = token
        preparePokemonHost(entry.sprite, token)
        if (entry.hud) preparePokemonHost(entry.hud, token)
      }

      if (mode === 'throw') {
        enterPhase('throw')
        playAudio(() => options.playSoundEffect?.(HGSS_BATTLE_SEND_OUT_SOUND_CUES.throw))
        presentations.forEach(({ ballPresentation }) => beginBattleBallSendOutThrow(
          ballPresentation,
          HGSS_BATTLE_SEND_OUT_TIMING.throwFrames,
          reducedMotion,
        ))
        await playNativeSequence('closed', HGSS_BATTLE_SEND_OUT_TIMING.throwFrames)
        ensureCurrent()
        presentations.forEach(({ ballPresentation }) => finishBattleBallSendOutThrow(ballPresentation))
      }

      enterPhase('open')
      playAudio(() => options.playSoundEffect?.(HGSS_BATTLE_SEND_OUT_SOUND_CUES.open))
      presentations.forEach(({ ballPresentation }) => beginBattleBallSendOutOpen(
        ballPresentation,
        HGSS_BATTLE_SEND_OUT_TIMING.openFrames,
        reducedMotion,
      ))
      for (let elapsed = 0; elapsed < HGSS_BATTLE_SEND_OUT_TIMING.openFrames; elapsed += 1) {
        if (elapsed === HGSS_BATTLE_SEND_OUT_TIMING.releaseLeadFrames) materialize()
        for (const { ballPresentation } of presentations) renderBattleBallSendOutFrame(ballPresentation, 'active', elapsed)
        await waitFrames(1)
      }
      if (!phases.includes('materialize')) materialize()
      presentations.forEach(({ ballPresentation }) => {
        finishBattleBallSendOutOpen(ballPresentation)
        removeTransientBattleBallSendOut(ballPresentation)
      })
      await waitFrames(Math.max(
        0,
        (options.completionWindowFrames ?? HGSS_BATTLE_SEND_OUT_TIMING.switchWindowFrames)
          - HGSS_BATTLE_SEND_OUT_TIMING.openFrames
          - (mode === 'throw' ? HGSS_BATTLE_SEND_OUT_TIMING.throwFrames : 0),
      ))

      enterPhase('hud')
      let hasHud = false
      for (const presentation of presentations) {
        const hud = presentation.entry.hud
        if (!hud || !ownsPokemonHost(hud, token)) continue
        hasHud = true
        clearBattleCssAnimation(hud, 'is-updating')
        hud.hidden = false
        presentation.hudAnimation = restartBattleCssAnimation(hud, 'is-arriving', { reducedMotion })
      }
      if (hasHud) await waitFrames(HGSS_BATTLE_SEND_OUT_TIMING.hudFrames)
      ensureCurrent()
    } catch (error) {
      if (error instanceof SendOutStopped) {
        status = error.status
        if (status === 'cancelled') fastForward()
      } else {
        fastForward()
        throw error
      }
    } finally {
      cleanup(status)
      settled = true
    }
    return {
      status,
      mode,
      phases: [...phases],
      presentations: presentations.map(({ entry, ballPresentation }) => ({
        side: entry.side,
        slot: entry.slot,
        ballId: ballPresentation.ballId,
        ball: ballPresentation.ball,
        graphicSource: ballPresentation.graphicSource,
      })),
    }
  }

  return {
    finished: run(),
    cancel: () => {
      if (settled || stopped) return
      stopped = 'cancelled'
      releaseStop()
    },
  }
}
