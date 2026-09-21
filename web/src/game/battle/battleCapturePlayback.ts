import type { NitroGraphic } from '../../ndsTypes'
import type { HgssBattleBallSpriteAsset } from '../../rom/battle/battleBallSprites'
import { hgssVBlanksToMilliseconds } from '../time/hgssFrameTiming'
import {
  createHgssCaptureAnimationPlan,
  type HgssCaptureAnimationPhase,
  type HgssCaptureAnimationPlan,
  type HgssCaptureMode,
  type HgssCaptureShakeCount,
} from './hgssCaptureAnimationContract'
import { clearBattleCssAnimations } from './battleCssAnimation'

const nativeBattleWidth = 256
const nativeBattleHeight = 192
const nativeThrowStart = { x: -30, y: 160 }
const nativeCapturePoint = { x: 192, y: 56 }
const nativeThrowArcAmplitude = 64

export type HgssCaptureThrowSample = {
  frame: number
  x: number
  y: number
}

/**
 * Échantillonne `ov07_02222338`: interpolation FX32 sur 16 VBlank, additionnée
 * au cosinus 0x3fff→0xbfff d'amplitude 64 configuré par le cas capture 15.
 */
export function sampleHgssCaptureThrow(frame: number): HgssCaptureThrowSample {
  if (!Number.isInteger(frame) || frame < 0 || frame > 16) {
    throw new Error(`Frame du lancer de capture HGSS hors de 0..16 : ${frame}.`)
  }
  if (frame === 0) return { frame, ...nativeThrowStart }
  const progress = frame / 16
  const linearX = Math.floor(nativeThrowStart.x + (nativeCapturePoint.x - nativeThrowStart.x) * progress)
  const linearY = Math.floor(nativeThrowStart.y + (nativeCapturePoint.y - nativeThrowStart.y) * progress)
  const angle = 0x3fff + 0x8000 * progress
  const arcY = Math.round(Math.cos(angle * Math.PI * 2 / 0x10000) * nativeThrowArcAmplitude)
  return { frame, x: linearX, y: linearY + arcY }
}

/** Adaptateurs DOM utilisés seulement quand aucun renderer de BALL_ANIM n'est fourni. */
export const HGSS_CAPTURE_DOM_FALLBACK_TIMING = Object.freeze({
  clickFrames: 10,
  breakoutFrames: 18,
  fadePaletteFrames: 10,
  fadeAlphaFrames: 16,
})

type HgssCaptureDomAnimation = {
  cancel?: () => void
  finish?: () => void
}

export type HgssBattleCapturePlaybackOptions = {
  mode: HgssCaptureMode
  /** Toujours l'identifiant d'objet ROM (1..16 ou 492..499), jamais BALL 17..24. */
  itemId: number
  shakes: HgssCaptureShakeCount
  caught: boolean
  ball: HTMLElement
  opponent: HTMLElement
  resolveBallAsset?: (ballId: number) => HgssBattleBallSpriteAsset | undefined
  createGraphic?: (graphic: NitroGraphic) => HTMLElement
  /** Repli obligatoire et toujours issu de `itemIconResolver(itemId)` de la ROM. */
  createItemIcon: (itemId: number) => HTMLElement
  playSoundEffect?: (sequenceId: number) => void | Promise<void>
  playPannedSoundEffect?: (sequenceId: number, pan: number) => void | Promise<void>
  onPhase?: (phase: HgssCaptureAnimationPhase, plan: HgssCaptureAnimationPlan) => void | Promise<void>
  /** Premier point où le DOM a le droit de distinguer réussite et échec. */
  onOutcomeAnimationStart?: (outcome: 'click' | 'breakout', plan: HgssCaptureAnimationPlan) => void
  /** Barrière du renderer natif pour OPEN/CLICK. Les délais fixes restent appliqués avant elle. */
  waitForBallAnimation?: (animationId: 1 | 6, plan: HgssCaptureAnimationPlan) => void | Promise<void>
  /** Rejoue le send-out natif lors d'un échec; sa résolution autorise le message 863..866. */
  playPokemonSendOut?: (ballId: number, ball: HTMLElement, opponent: HTMLElement) => void | Promise<void>
  waitFrames?: (frames: number) => Promise<void>
  animateElement?: (element: HTMLElement, keyframes: Keyframe[], frames: number) => HgssCaptureDomAnimation | void
  reducedMotion?: boolean
  /** Empêche un ancien lecteur de réécrire des hosts recyclés par une nouvelle scène. */
  isCurrent?: () => boolean
}

export type HgssBattleCapturePlaybackResult = {
  plan: HgssCaptureAnimationPlan
  graphicSource: 'ball-sprite' | 'item-icon'
}

type InstalledBallGraphic = HgssBattleCapturePlaybackResult & {
  asset?: HgssBattleBallSpriteAsset
}

function defaultWaitFrames(frames: number): Promise<void> {
  if (frames <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, hgssVBlanksToMilliseconds(frames)))
}

function defaultAnimateElement(element: HTMLElement, keyframes: Keyframe[], frames: number): HgssCaptureDomAnimation | void {
  if (typeof element.animate !== 'function' || frames <= 0) return
  return element.animate(keyframes, {
    duration: hgssVBlanksToMilliseconds(frames),
    easing: `steps(${Math.max(1, frames)}, end)`,
    fill: 'forwards',
  })
}

function applyFinalKeyframe(element: HTMLElement, keyframes: readonly Keyframe[]): void {
  const last = keyframes.at(-1)
  if (!last) return
  for (const property of ['left', 'top', 'opacity', 'transform', 'filter'] as const) {
    const value = last[property]
    if (typeof value === 'string' || typeof value === 'number') element.style[property] = String(value)
  }
}

function playAudio(callback: (() => void | Promise<void>) | undefined): void {
  if (!callback) return
  try {
    void Promise.resolve(callback()).catch(() => undefined)
  } catch {
    // La présentation native ne doit pas bloquer le task si WebAudio est suspendu.
  }
}

function playPannedAudio(options: HgssBattleCapturePlaybackOptions, sequenceId: number, pan: number): void {
  playAudio(options.playPannedSoundEffect
    ? () => options.playPannedSoundEffect!(sequenceId, pan)
    : options.playSoundEffect
      ? () => options.playSoundEffect!(sequenceId)
      : undefined)
}

function nativePercent(value: number, dimension: number): string {
  return `${value * 100 / dimension}%`
}

/** Rend le host réutilisable par un lancer standard ou une nouvelle capture. */
export function resetHgssBattleBallPresentation(ball: HTMLElement): void {
  clearBattleCssAnimations(ball)
  ball.classList.remove('is-thrown')
  ball.replaceChildren()
  ball.hidden = false
  for (const property of ['background', 'border', 'borderRadius', 'boxShadow', 'bottom', 'right', 'filter', 'opacity', 'transform', 'width', 'aspectRatio', 'left', 'top'] as const) {
    ball.style[property] = ''
  }
  delete ball.dataset.romBall
  delete ball.dataset.ballItemId
  delete ball.dataset.ballId
  delete ball.dataset.ballGraphicSource
}

function decorateBallGraphic(graphic: HTMLElement): HTMLElement {
  graphic.classList.add('battle-capture-ball-graphic')
  graphic.setAttribute('aria-hidden', 'true')
  return graphic
}

function sizeNativeBallGraphic(graphic: HTMLElement, width: number, height: number): void {
  const containerSize = 32
  Object.assign(graphic.style, {
    position: 'absolute',
    display: 'block',
    left: `${(containerSize - width) * 50 / containerSize}%`,
    top: `${(containerSize - height) * 50 / containerSize}%`,
    width: `${width * 100 / containerSize}%`,
    height: `${height * 100 / containerSize}%`,
    overflow: 'visible',
  })
}

function installNativeBallFrame(
  options: HgssBattleCapturePlaybackOptions,
  asset: HgssBattleBallSpriteAsset,
  cellIndex: number,
  sequenceFrame?: { sequenceIndex: number, frameIndex: number },
): void {
  const frame = asset.frames[cellIndex]
  if (!frame || !options.createGraphic) return
  const graphic = decorateBallGraphic(options.createGraphic(frame))
  graphic.dataset.nitroCell = String(cellIndex)
  if (sequenceFrame) {
    graphic.dataset.nitroSequence = String(sequenceFrame.sequenceIndex)
    graphic.dataset.nitroFrame = String(sequenceFrame.frameIndex)
  }
  sizeNativeBallGraphic(graphic, frame.width, frame.height)
  options.ball.replaceChildren(graphic)
}

function canPlayNativeBallSequence(
  options: HgssBattleCapturePlaybackOptions,
  asset: HgssBattleBallSpriteAsset,
  sequenceIndex: number,
): boolean {
  if (!options.createGraphic) return false
  const sequence = asset.animation.sequences[sequenceIndex]
  return Boolean(sequence?.frames.length && sequence.frames.every(({ cellIndex }) => asset.frames[cellIndex]))
}

/** Lecteur déterministe des entrées NANR, cadencé par le même VBlank que le task. */
async function playNativeBallSequenceForFrames(
  options: HgssBattleCapturePlaybackOptions,
  asset: HgssBattleBallSpriteAsset,
  sequenceIndex: number,
  frameBudget: number,
  waitFrames: (frames: number) => Promise<void>,
): Promise<boolean> {
  if (!canPlayNativeBallSequence(options, asset, sequenceIndex)) return false
  const sequence = asset.animation.sequences[sequenceIndex]!
  const reverse = sequence.playbackMode === 3 || sequence.playbackMode === 4
  const sourceFrames = reverse ? [...sequence.frames].reverse() : sequence.frames
  const loops = sequence.playbackMode === 2 || sequence.playbackMode === 4
  let remaining = frameBudget
  let index = 0
  while (remaining > 0 && sourceFrames[index]) {
    const source = sourceFrames[index]!
    installNativeBallFrame(options, asset, source.cellIndex, { sequenceIndex, frameIndex: index })
    const duration = Math.min(remaining, Math.max(1, source.durationFrames))
    await waitFrames(duration)
    remaining -= duration
    index += 1
    if (index >= sourceFrames.length && loops) index = Math.min(sequence.loopStartFrame, sourceFrames.length - 1)
  }
  if (remaining > 0) await waitFrames(remaining)
  return true
}

function installBallGraphic(options: HgssBattleCapturePlaybackOptions, plan: HgssCaptureAnimationPlan): InstalledBallGraphic {
  resetHgssBattleBallPresentation(options.ball)
  let graphic: HTMLElement | undefined
  let nativeAsset: HgssBattleBallSpriteAsset | undefined
  let source: 'ball-sprite' | 'item-icon' = 'item-icon'
  if (options.resolveBallAsset && options.createGraphic) {
    try {
      const asset = options.resolveBallAsset(plan.ballId)
      const frame = asset?.frames[0]
      if (asset && frame) {
        graphic = options.createGraphic(frame)
        graphic.dataset.ballId = String(asset.ballId)
        graphic.dataset.ballCharacterMember = String(asset.characterMemberId)
        graphic.dataset.ballPaletteMember = String(asset.paletteMemberId)
        graphic.dataset.ballCellMember = String(asset.cellMemberId)
        graphic.dataset.ballAnimationMember = String(asset.animationMemberId)
        nativeAsset = asset
        sizeNativeBallGraphic(graphic, frame.width, frame.height)
        source = 'ball-sprite'
      }
    } catch {
      // Une ROM partiellement décodable conserve au minimum son icône d'objet.
    }
  }
  graphic ??= options.createItemIcon(plan.itemId)
  options.ball.replaceChildren(decorateBallGraphic(graphic))
  options.ball.dataset.romBall = 'true'
  options.ball.dataset.ballItemId = String(plan.itemId)
  options.ball.dataset.ballId = String(plan.ballId)
  options.ball.dataset.ballGraphicSource = source
  options.ball.style.background = 'none'
  options.ball.style.border = '0'
  options.ball.style.borderRadius = '0'
  options.ball.style.boxShadow = 'none'
  options.ball.style.bottom = 'auto'
  options.ball.style.right = 'auto'
  options.ball.style.filter = ''
  options.ball.style.opacity = '1'
  options.ball.style.transform = ''
  options.ball.style.width = nativePercent(source === 'ball-sprite' ? 32 : 24, nativeBattleWidth)
  options.ball.style.aspectRatio = '1'
  return { plan, graphicSource: source, asset: nativeAsset }
}

function breakoutFallbackKeyframes(): Keyframe[] {
  return [
    { opacity: '0', transform: 'scale(.05)', filter: 'brightness(4) saturate(.25)' },
    { opacity: '1', transform: 'scale(1)', filter: 'brightness(1) saturate(1)' },
  ]
}

/**
 * Lecteur DOM global de la machine `Task_GetPokemon`. La fonction ne présente
 * jamais le texte de résultat : elle se résout seulement une fois CLICK ou le
 * send-out de breakout terminé, ce qui donne au contrôleur le bon verrou.
 */
export async function playHgssBattleCaptureAnimation(
  options: HgssBattleCapturePlaybackOptions,
): Promise<HgssBattleCapturePlaybackResult> {
  const plan = createHgssCaptureAnimationPlan(options)
  const installedBall = installBallGraphic(options, plan)
  const graphicSource = installedBall.graphicSource
  const opponentBaseline = {
    opacity: options.opponent.style.opacity,
    transform: options.opponent.style.transform,
    filter: options.opponent.style.filter,
  }
  const reducedMotion = options.reducedMotion
    ?? (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const isCurrent = options.isCurrent ?? (() => true)
  const ensureCurrent = (): void => { if (!isCurrent()) throw new Error('Présentation de capture remplacée.') }
  const baseWaitFrames = reducedMotion ? async () => {} : options.waitFrames ?? defaultWaitFrames
  const waitFrames = async (frames: number): Promise<void> => { ensureCurrent(); await baseWaitFrames(frames); ensureCurrent() }
  const animateElement = options.animateElement ?? defaultAnimateElement

  const beginAnimation = (element: HTMLElement, keyframes: Keyframe[], frames: number): HgssCaptureDomAnimation | undefined => {
    if (reducedMotion) return undefined
    return animateElement(element, keyframes, frames) ?? undefined
  }
  const finishAnimation = (element: HTMLElement, keyframes: Keyframe[], handle?: HgssCaptureDomAnimation): void => {
    try { handle?.finish?.() } catch { /* Une animation déjà achevée n'a rien à terminer. */ }
    applyFinalKeyframe(element, keyframes)
    try { handle?.cancel?.() } catch { /* Une animation annulée est déjà nettoyée. */ }
  }
  const runAnimation = async (element: HTMLElement, keyframes: Keyframe[], frames: number): Promise<void> => {
    const handle = beginAnimation(element, keyframes, frames)
    await waitFrames(frames)
    finishAnimation(element, keyframes, handle)
  }
  const enterPhase = async (phase: HgssCaptureAnimationPhase): Promise<void> => {
    await options.onPhase?.(phase, plan)
    ensureCurrent()
  }

  let completed = false
  try {
    ensureCurrent()
    options.ball.hidden = false
    options.ball.style.opacity = '1'
    options.ball.style.left = nativePercent(nativeThrowStart.x, nativeBattleWidth)
    options.ball.style.top = nativePercent(nativeThrowStart.y, nativeBattleHeight)
    options.ball.style.transform = 'translate(-50%, -50%) rotate(0deg)'
    options.opponent.hidden = false

    for (const phase of plan.phases) {
    await enterPhase(phase)
    if (phase.kind === 'throw') {
      playAudio(() => options.playSoundEffect?.(phase.soundEffectId))
      const samples = Array.from({ length: phase.motionFrames + 1 }, (_, frame) => sampleHgssCaptureThrow(frame))
      const throwKeys = samples.map((sample) => ({
        left: nativePercent(sample.x, nativeBattleWidth),
        top: nativePercent(sample.y, nativeBattleHeight),
        offset: sample.frame / phase.motionFrames,
        opacity: '1',
        transform: `translate(-50%, -50%) rotate(${sample.frame * 45}deg)`,
      }))
      const throwAnimation = beginAnimation(options.ball, throwKeys, phase.motionFrames)
      const nativeSequencePlayed = installedBall.asset
        ? await playNativeBallSequenceForFrames(options, installedBall.asset, installedBall.asset.closedSequenceIndex, phase.motionFrames, waitFrames)
        : false
      if (!nativeSequencePlayed) await waitFrames(phase.motionFrames)
      finishAnimation(options.ball, throwKeys, throwAnimation)
      continue
    }
    if (phase.kind === 'open') {
      playPannedAudio(options, phase.soundEffectId, 0x75)
      const playsNativeSequence = Boolean(installedBall.asset
        && canPlayNativeBallSequence(options, installedBall.asset, installedBall.asset.activeSequenceIndex))
      const ballKeys: Keyframe[] = [
        { opacity: '1', transform: 'translate(-50%, -50%) rotate(720deg) scale(1)' },
        { opacity: '1', transform: 'translate(-50%, -50%) rotate(720deg) scale(1.22)', filter: 'brightness(2.5)', offset: .2 },
        { opacity: '0', transform: 'translate(-50%, -50%) rotate(720deg) scale(.82)', filter: 'brightness(3)' },
      ]
      const opponentKeys: Keyframe[] = [
        { opacity: '1', transform: 'scale(1)', filter: 'brightness(1)' },
        { opacity: '1', transform: 'scale(1.08)', filter: 'brightness(3) saturate(.2)', offset: .45 },
        { opacity: '0', transform: 'scale(.05)', filter: 'brightness(4) saturate(0)' },
      ]
      const ballAnimation = playsNativeSequence ? undefined : beginAnimation(options.ball, ballKeys, phase.captureRollAfterFrames)
      const opponentAnimation = beginAnimation(options.opponent, opponentKeys, phase.captureRollAfterFrames)
      const nativeBarrier = options.waitForBallAnimation?.(phase.animationId, plan)
      if (playsNativeSequence) {
        await playNativeBallSequenceForFrames(
          options,
          installedBall.asset!,
          installedBall.asset!.activeSequenceIndex,
          phase.captureRollAfterFrames,
          waitFrames,
        )
      } else {
        await waitFrames(phase.captureRollAfterFrames)
      }
      await nativeBarrier
      ensureCurrent()
      if (!playsNativeSequence) finishAnimation(options.ball, ballKeys, ballAnimation)
      finishAnimation(options.opponent, opponentKeys, opponentAnimation)
      options.opponent.hidden = true
      options.ball.hidden = false
      options.ball.style.opacity = '1'
      options.ball.style.filter = ''
      options.ball.style.transform = 'translate(-50%, -50%) rotate(720deg)'
      if (installedBall.asset) installNativeBallFrame(options, installedBall.asset, 0)
      continue
    }
    if (phase.kind === 'fall') {
      const bounceOrigin = {
        x: nativeCapturePoint.x + phase.slideHorizontalPixels,
        y: nativeCapturePoint.y,
      }
      await runAnimation(options.ball, [
        { left: nativePercent(nativeCapturePoint.x, nativeBattleWidth), top: nativePercent(nativeCapturePoint.y, nativeBattleHeight), transform: 'translate(-50%, -50%) rotate(720deg)' },
        { left: nativePercent(bounceOrigin.x, nativeBattleWidth), top: nativePercent(bounceOrigin.y, nativeBattleHeight), transform: 'translate(-50%, -50%) rotate(720deg)' },
      ], phase.slideFrames)
      const cumulativeOffsets: number[] = []
      let offset = 0
      for (const delta of phase.verticalOffsets) {
        offset += delta
        cumulativeOffsets.push(offset)
      }
      const fallKeys: Keyframe[] = [
        { left: nativePercent(bounceOrigin.x, nativeBattleWidth), top: nativePercent(bounceOrigin.y, nativeBattleHeight), transform: 'translate(-50%, -50%) rotate(720deg)' },
        ...cumulativeOffsets.map((verticalOffset, index) => ({
          left: nativePercent(bounceOrigin.x, nativeBattleWidth),
          top: nativePercent(bounceOrigin.y + verticalOffset, nativeBattleHeight),
          transform: 'translate(-50%, -50%) rotate(720deg)',
          offset: (index + 1) / phase.completionFrames,
        })),
        { left: nativePercent(bounceOrigin.x, nativeBattleWidth), top: nativePercent(bounceOrigin.y, nativeBattleHeight), transform: 'translate(-50%, -50%) rotate(720deg)' },
      ]
      const fallAnimation = beginAnimation(options.ball, fallKeys, phase.completionFrames)
      let displayedAnimationFrame = 0
      for (const [index, animationFrame] of phase.animationFrameIndexes.entries()) {
        if (installedBall.asset && animationFrame !== displayedAnimationFrame) {
          const sequence = installedBall.asset.animation.sequences[installedBall.asset.activeSequenceIndex]
          const cellIndex = sequence?.frames[animationFrame]?.cellIndex
          if (cellIndex !== undefined) installNativeBallFrame(options, installedBall.asset, cellIndex, {
            sequenceIndex: installedBall.asset.activeSequenceIndex,
            frameIndex: animationFrame,
          })
          displayedAnimationFrame = animationFrame
        }
        await waitFrames(1)
        const frame = index + 1
        const cue = phase.soundCues.find((candidate) => candidate.frame === frame)
        if (cue) playPannedAudio(options, cue.sequenceId, cue.pan)
      }
      // Le 21e appel rencontre la sentinelle : retour à l'entrée 0, sans offset +255.
      if (installedBall.asset && displayedAnimationFrame !== 0) {
        const sequence = installedBall.asset.animation.sequences[installedBall.asset.activeSequenceIndex]
        const cellIndex = sequence?.frames[0]?.cellIndex
        if (cellIndex !== undefined) installNativeBallFrame(options, installedBall.asset, cellIndex)
      }
      await waitFrames(phase.completionFrames - phase.animationFrameIndexes.length)
      finishAnimation(options.ball, fallKeys, fallAnimation)
      continue
    }
    if (phase.kind === 'shake') {
      await waitFrames(phase.windupFrames)
      const shakeKeys: Keyframe[] = [
        { transform: 'translate(-50%, -50%) rotate(720deg)' },
        ...phase.horizontalOffsets.map((horizontalOffset, index) => ({
          transform: `translate(calc(-50% + ${horizontalOffset}px), -50%) rotate(${720 + horizontalOffset * 2}deg)`,
          offset: (index + 1) / phase.completionFrames,
        })),
        { transform: 'translate(-50%, -50%) rotate(720deg)' },
      ]
      const shakeAnimation = beginAnimation(options.ball, shakeKeys, phase.completionFrames)
      await waitFrames(phase.soundCue.frame)
      playPannedAudio(options, phase.soundCue.sequenceId, phase.soundCue.pan)
      await waitFrames(phase.completionFrames - phase.soundCue.frame)
      finishAnimation(options.ball, shakeKeys, shakeAnimation)
      continue
    }
    if (phase.kind === 'shake-cooldown' || phase.kind === 'pre-click') {
      await waitFrames(phase.frames)
      continue
    }
    if (phase.kind === 'click') {
      options.onOutcomeAnimationStart?.('click', plan)
      playPannedAudio(options, phase.soundEffectId, 0x75)
      const keys: Keyframe[] = [
        { opacity: '1', transform: 'translate(-50%, -50%) rotate(720deg) scale(1)', filter: 'brightness(1)' },
        { opacity: '1', transform: 'translate(-50%, -50%) rotate(720deg) scale(1.18)', filter: 'brightness(2.4)', offset: .45 },
        { opacity: '1', transform: 'translate(-50%, -50%) rotate(720deg) scale(1)', filter: 'brightness(1)' },
      ]
      const handle = beginAnimation(options.ball, keys, HGSS_CAPTURE_DOM_FALLBACK_TIMING.clickFrames)
      const nativeBarrier = options.waitForBallAnimation?.(phase.animationId, plan)
      await waitFrames(HGSS_CAPTURE_DOM_FALLBACK_TIMING.clickFrames)
      await nativeBarrier
      finishAnimation(options.ball, keys, handle)
      options.ball.style.filter = ''
      continue
    }
    options.onOutcomeAnimationStart?.('breakout', plan)
    options.opponent.hidden = false
    if (options.playPokemonSendOut) {
      const sendOut = options.playPokemonSendOut(plan.ballId, options.ball, options.opponent)
      await waitFrames(phase.ballCleanupFrames)
      options.ball.hidden = true
      await sendOut
      ensureCurrent()
    } else {
      const keys = breakoutFallbackKeyframes()
      const opponentAnimation = beginAnimation(options.opponent, keys, HGSS_CAPTURE_DOM_FALLBACK_TIMING.breakoutFrames)
      const ballKeys: Keyframe[] = [
        { opacity: '1', transform: 'translate(-50%, -50%) scale(1)', filter: 'brightness(1)' },
        { opacity: '0', transform: 'translate(-50%, -50%) scale(1.7)', filter: 'brightness(3)' },
      ]
      const ballAnimation = beginAnimation(options.ball, ballKeys, phase.ballCleanupFrames)
      await waitFrames(phase.ballCleanupFrames)
      finishAnimation(options.ball, ballKeys, ballAnimation)
      options.ball.hidden = true
      await waitFrames(HGSS_CAPTURE_DOM_FALLBACK_TIMING.breakoutFrames - phase.ballCleanupFrames)
      finishAnimation(options.opponent, keys, opponentAnimation)
    }
    }
    completed = true
    return { plan, graphicSource }
  } finally {
    if (isCurrent()) {
      options.opponent.style.opacity = opponentBaseline.opacity
      options.opponent.style.transform = opponentBaseline.transform
      options.opponent.style.filter = opponentBaseline.filter
      options.opponent.hidden = completed ? plan.caught : false
      if (completed) options.ball.style.filter = ''
      else resetHgssBattleBallPresentation(options.ball)
    }
  }
}

/** BALL_ANIM_FADE, à appeler seulement après la fin du printer de message 867. */
export async function fadeHgssCapturedBall(options: {
  ball: HTMLElement
  waitFrames?: (frames: number) => Promise<void>
  animateElement?: (element: HTMLElement, keyframes: Keyframe[], frames: number) => HgssCaptureDomAnimation | void
  reducedMotion?: boolean
  isCurrent?: () => boolean
}): Promise<void> {
  const isCurrent = options.isCurrent ?? (() => true)
  if (!isCurrent()) return
  const baseWaitFrames = options.reducedMotion ? async () => {} : options.waitFrames ?? defaultWaitFrames
  const waitFrames = async (frames: number): Promise<boolean> => { await baseWaitFrames(frames); return isCurrent() }
  const animateElement = options.animateElement ?? defaultAnimateElement
  const paletteKeys: Keyframe[] = [{ filter: 'brightness(1)' }, { filter: 'brightness(.25) saturate(.2)' }]
  const palette = options.reducedMotion ? undefined : animateElement(options.ball, paletteKeys, HGSS_CAPTURE_DOM_FALLBACK_TIMING.fadePaletteFrames) ?? undefined
  if (!await waitFrames(HGSS_CAPTURE_DOM_FALLBACK_TIMING.fadePaletteFrames)) return
  try { palette?.finish?.() } catch { /* déjà achevée */ }
  applyFinalKeyframe(options.ball, paletteKeys)
  try { palette?.cancel?.() } catch { /* déjà nettoyée */ }
  const alphaKeys: Keyframe[] = [{ opacity: '1' }, { opacity: '0' }]
  const alpha = options.reducedMotion ? undefined : animateElement(options.ball, alphaKeys, HGSS_CAPTURE_DOM_FALLBACK_TIMING.fadeAlphaFrames) ?? undefined
  if (!await waitFrames(HGSS_CAPTURE_DOM_FALLBACK_TIMING.fadeAlphaFrames)) return
  try { alpha?.finish?.() } catch { /* déjà achevée */ }
  applyFinalKeyframe(options.ball, alphaKeys)
  try { alpha?.cancel?.() } catch { /* déjà nettoyée */ }
  options.ball.hidden = true
}
