import type { NitroGraphic } from '../../ndsTypes'
import type { HgssBattleBallSpriteAsset } from '../../rom/battle/battleBallSprites'
import { hgssVBlanksToMilliseconds } from '../time/hgssFrameTiming'
import {
  clearBattleCssAnimations,
  restartBattleCssAnimation,
  type BattleCssAnimationRun,
} from './battleCssAnimation'

export type BattleBallSendOutSide = 'player' | 'opponent'
export type BattleBallSendOutSequence = 'closed' | 'active'
export type BattleBallSendOutGraphicSource = 'ball-sprite' | 'generic'

export type BattleBallSendOutPresentation = Readonly<{
  side: BattleBallSendOutSide
  slot: number
  ballId: number
  ball: HTMLElement
  transient: boolean
  graphicSource: BattleBallSendOutGraphicSource
}>

export type CreateBattleBallSendOutPresentationOptions = Readonly<{
  side: BattleBallSendOutSide
  slot: number
  ballId: number
  host: HTMLElement
  stage: HTMLElement
  transient: boolean
  resolveAsset: (ballId: number) => HgssBattleBallSpriteAsset | undefined
  createGraphic: (graphic: NitroGraphic) => HTMLElement
}>

type DomAnimation = Pick<Animation, 'cancel' | 'finish'>
type MutablePresentation = Omit<BattleBallSendOutPresentation, 'graphicSource'> & {
  graphicSource: BattleBallSendOutGraphicSource
}
type PresentationState = {
  asset?: HgssBattleBallSpriteAsset
  renderedCell?: number
  createGraphic: CreateBattleBallSendOutPresentationOptions['createGraphic']
  throwAnimation?: DomAnimation
  throwCssAnimation?: BattleCssAnimationRun
  openAnimation?: DomAnimation
}

const states = new WeakMap<BattleBallSendOutPresentation, PresentationState>()

function stateOf(presentation: BattleBallSendOutPresentation): PresentationState {
  const state = states.get(presentation)
  if (!state) throw new Error("Présentation de Ball d'envoi inconnue.")
  return state
}

function targetPosition(side: BattleBallSendOutSide, slot: number): { left: number, top: number } {
  const second = slot > 0
  if (side === 'player') return second ? { left: 45, top: 59 } : { left: 32, top: 72 }
  return second ? { left: 58, top: 41 } : { left: 72, top: 29 }
}

function clearInlinePresentation(ball: HTMLElement): void {
  for (const property of [
    'background', 'border', 'borderRadius', 'boxShadow', 'bottom', 'right', 'filter',
    'opacity', 'transform', 'width', 'aspectRatio', 'left', 'top',
  ] as const) ball.style[property] = ''
}

function cloneTransientHost(host: HTMLElement, side: BattleBallSendOutSide): HTMLElement {
  const ball = host.cloneNode(false) as HTMLElement
  ball.replaceChildren()
  for (const key of Object.keys(ball.dataset)) delete ball.dataset[key]
  clearInlinePresentation(ball)
  ball.classList.remove('is-thrown', 'is-opening')
  ball.classList.add('battle-pokeball', `battle-pokeball-${side}`, 'battle-pokeball-sendout')
  ball.hidden = false
  ball.setAttribute('aria-hidden', 'true')
  return ball
}

function sequenceFrames(asset: HgssBattleBallSpriteAsset, sequenceIndex: number) {
  const sequence = asset.animation.sequences[sequenceIndex]
  if (!sequence?.frames.length) return undefined
  const reverse = sequence.playbackMode === 3 || sequence.playbackMode === 4
  return { sequence, frames: reverse ? [...sequence.frames].reverse() : sequence.frames }
}

/** Résout une cellule NANR à une VBlank donnée, boucles et lectures inverses comprises. */
export function resolveBattleBallSendOutCell(
  asset: HgssBattleBallSpriteAsset,
  sequenceIndex: number,
  elapsedFrames: number,
): number | undefined {
  const timeline = sequenceFrames(asset, sequenceIndex)
  if (!timeline) return undefined
  const durations = timeline.frames.map(({ durationFrames }) => Math.max(1, durationFrames))
  const total = durations.reduce((sum, duration) => sum + duration, 0)
  const loops = timeline.sequence.playbackMode === 2 || timeline.sequence.playbackMode === 4
  let cursor = loops ? elapsedFrames % total : Math.min(elapsedFrames, total - 1)
  for (const [index, frame] of timeline.frames.entries()) {
    if (cursor < durations[index]!) return frame.cellIndex
    cursor -= durations[index]!
  }
  return timeline.frames.at(-1)?.cellIndex
}

function sizeNativeGraphic(graphic: HTMLElement, frame: NitroGraphic): void {
  const containerSize = 32
  Object.assign(graphic.style, {
    position: 'absolute',
    display: 'block',
    left: `${(containerSize - frame.width) * 50 / containerSize}%`,
    top: `${(containerSize - frame.height) * 50 / containerSize}%`,
    width: `${frame.width * 100 / containerSize}%`,
    height: `${frame.height * 100 / containerSize}%`,
    overflow: 'visible',
  })
}

function useGenericBall(presentation: MutablePresentation, state: PresentationState): void {
  state.asset = undefined
  state.renderedCell = undefined
  presentation.graphicSource = 'generic'
  presentation.ball.replaceChildren()
  delete presentation.ball.dataset.romBall
  presentation.ball.dataset.ballGraphicSource = 'generic'
  for (const property of ['background', 'border', 'borderRadius', 'boxShadow', 'width', 'aspectRatio'] as const) {
    presentation.ball.style[property] = ''
  }
}

function mountNativeCell(
  presentation: MutablePresentation,
  state: PresentationState,
  cellIndex: number,
  sequenceIndex?: number,
): boolean {
  if (state.renderedCell === cellIndex && presentation.ball.childElementCount > 0) return true
  const frame = state.asset?.frames[cellIndex]
  if (!frame) return false
  try {
    const graphic = state.createGraphic(frame)
    graphic.classList.add('battle-capture-ball-graphic', 'battle-sendout-ball-graphic')
    graphic.setAttribute('aria-hidden', 'true')
    graphic.dataset.ballId = String(presentation.ballId)
    graphic.dataset.nitroCell = String(cellIndex)
    if (sequenceIndex !== undefined) graphic.dataset.nitroSequence = String(sequenceIndex)
    sizeNativeGraphic(graphic, frame)
    presentation.ball.replaceChildren(graphic)
    state.renderedCell = cellIndex
    return true
  } catch {
    useGenericBall(presentation, state)
    return false
  }
}

function installAsset(
  presentation: MutablePresentation,
  state: PresentationState,
  resolveAsset: CreateBattleBallSendOutPresentationOptions['resolveAsset'],
): void {
  const { ball, ballId } = presentation
  ball.dataset.ballId = String(ballId)
  ball.dataset.battleSide = presentation.side
  ball.dataset.battleSlot = String(presentation.slot)
  try { state.asset = resolveAsset(ballId) } catch { state.asset = undefined }
  const sequenceIndex = state.asset?.closedSequenceIndex
  const firstCell = state.asset && sequenceIndex !== undefined
    ? resolveBattleBallSendOutCell(state.asset, sequenceIndex, 0)
    : undefined
  if (firstCell === undefined || !mountNativeCell(presentation, state, firstCell, sequenceIndex)) {
    useGenericBall(presentation, state)
    return
  }
  presentation.graphicSource = 'ball-sprite'
  ball.dataset.romBall = 'true'
  ball.dataset.ballGraphicSource = 'ball-sprite'
  ball.style.background = 'none'
  ball.style.border = '0'
  ball.style.borderRadius = '0'
  ball.style.boxShadow = 'none'
  ball.style.width = '12.5%'
  ball.style.aspectRatio = '1'
}

/** Clone un host modèle en lancer standard ou réutilise le host OPEN de capture. */
export function createBattleBallSendOutPresentation(
  options: CreateBattleBallSendOutPresentationOptions,
): BattleBallSendOutPresentation {
  const ball = options.transient ? cloneTransientHost(options.host, options.side) : options.host
  const presentation: MutablePresentation = {
    side: options.side,
    slot: options.slot,
    ballId: options.ballId,
    ball,
    transient: options.transient,
    graphicSource: 'generic',
  }
  const state: PresentationState = { createGraphic: options.createGraphic }
  states.set(presentation, state)
  if (presentation.transient) options.stage.append(ball)
  installAsset(presentation, state, options.resolveAsset)
  return presentation
}

export function hasNativeBattleBallSendOutAsset(presentation: BattleBallSendOutPresentation): boolean {
  return Boolean(stateOf(presentation).asset)
}

/** Monte la cellule fermée ou active correspondant exactement à la VBlank. */
export function renderBattleBallSendOutFrame(
  presentation: BattleBallSendOutPresentation,
  sequence: BattleBallSendOutSequence,
  elapsedFrames: number,
): boolean {
  const mutable = presentation as MutablePresentation
  const state = stateOf(presentation)
  const asset = state.asset
  if (!asset) return false
  const sequenceIndex = sequence === 'closed' ? asset.closedSequenceIndex : asset.activeSequenceIndex
  const cellIndex = resolveBattleBallSendOutCell(asset, sequenceIndex, elapsedFrames)
  return cellIndex !== undefined && mountNativeCell(mutable, state, cellIndex, sequenceIndex)
}

function beginDomAnimation(element: HTMLElement, keyframes: Keyframe[], frames: number): DomAnimation | undefined {
  if (typeof element.animate !== 'function' || frames <= 0) return undefined
  try {
    return element.animate(keyframes, {
      duration: hgssVBlanksToMilliseconds(frames),
      easing: `steps(${Math.max(1, frames)}, end)`,
      fill: 'forwards',
    })
  } catch {
    return undefined
  }
}

export function beginBattleBallSendOutThrow(
  presentation: BattleBallSendOutPresentation,
  frames: number,
  reducedMotion: boolean,
): void {
  const state = stateOf(presentation)
  const target = targetPosition(presentation.side, presentation.slot)
  const start = presentation.side === 'player' ? { left: -5, top: 94 } : { left: 105, top: -5 }
  const apex = { left: start.left + (target.left - start.left) * .58, top: Math.min(start.top, target.top) - 18 }
  presentation.ball.hidden = false
  presentation.ball.style.bottom = 'auto'
  presentation.ball.style.right = 'auto'
  if (reducedMotion) {
    Object.assign(presentation.ball.style, { left: `${target.left}%`, top: `${target.top}%`, opacity: '1', transform: 'rotate(0deg)' })
    return
  }
  const direction = presentation.side === 'player' ? 1 : -1
  state.throwAnimation = beginDomAnimation(presentation.ball, [
    { left: `${start.left}%`, top: `${start.top}%`, opacity: '0', transform: 'rotate(0deg)', offset: 0 },
    { opacity: '1', offset: .1 },
    { left: `${apex.left}%`, top: `${apex.top}%`, opacity: '1', transform: `rotate(${direction * 450}deg)`, offset: .58 },
    { left: `${target.left}%`, top: `${target.top}%`, opacity: '1', transform: `rotate(${direction * 720}deg)`, offset: 1 },
  ], frames)
  if (!state.throwAnimation) state.throwCssAnimation = restartBattleCssAnimation(presentation.ball, 'is-thrown')
}

export function finishBattleBallSendOutThrow(presentation: BattleBallSendOutPresentation): void {
  const state = stateOf(presentation)
  const target = targetPosition(presentation.side, presentation.slot)
  try { state.throwAnimation?.finish() } catch { /* animation déjà achevée */ }
  try { state.throwAnimation?.cancel() } catch { /* animation déjà détachée */ }
  state.throwCssAnimation?.cancel()
  presentation.ball.classList.remove('is-thrown')
  Object.assign(presentation.ball.style, {
    bottom: 'auto',
    right: 'auto',
    left: `${target.left}%`,
    top: `${target.top}%`,
    opacity: '1',
    transform: 'translate(-50%, -50%) rotate(0deg)',
  })
}

export function beginBattleBallSendOutOpen(
  presentation: BattleBallSendOutPresentation,
  frames: number,
  reducedMotion: boolean,
): void {
  const state = stateOf(presentation)
  presentation.ball.classList.add('is-opening')
  presentation.ball.hidden = false
  presentation.ball.style.opacity = '1'
  if (reducedMotion) return
  state.openAnimation = beginDomAnimation(presentation.ball, [
    { opacity: '1', transform: 'translate(-50%, -50%) scale(1)', filter: 'brightness(1)' },
    { opacity: '1', transform: 'translate(-50%, -50%) scale(1.28)', filter: 'brightness(2.6)', offset: .28 },
    { opacity: '.7', transform: 'translate(-50%, -50%) scale(1.65)', filter: 'brightness(3.2)', offset: .68 },
    { opacity: '0', transform: 'translate(-50%, -50%) scale(2)', filter: 'brightness(4)' },
  ], frames)
}

export function finishBattleBallSendOutOpen(presentation: BattleBallSendOutPresentation): void {
  const state = stateOf(presentation)
  try { state.openAnimation?.finish() } catch { /* animation déjà achevée */ }
  try { state.openAnimation?.cancel() } catch { /* animation déjà détachée */ }
  presentation.ball.classList.remove('is-opening')
  presentation.ball.style.opacity = '0'
  presentation.ball.hidden = true
}

export function cancelBattleBallSendOutPresentation(presentation: BattleBallSendOutPresentation): void {
  const state = stateOf(presentation)
  try { state.throwAnimation?.cancel() } catch { /* déjà détachée */ }
  try { state.openAnimation?.cancel() } catch { /* déjà détachée */ }
  state.throwCssAnimation?.cancel()
}

export function removeTransientBattleBallSendOut(presentation: BattleBallSendOutPresentation): void {
  if (presentation.transient) presentation.ball.remove()
}

/** Rend un host release-only au pool sans conserver la Ball de la capture. */
export function resetSharedBattleBallSendOut(presentation: BattleBallSendOutPresentation): void {
  if (presentation.transient) return
  cancelBattleBallSendOutPresentation(presentation)
  const { ball } = presentation
  clearBattleCssAnimations(ball)
  ball.classList.remove('is-thrown', 'is-opening')
  ball.replaceChildren()
  ball.hidden = false
  for (const key of [
    'romBall', 'ballItemId', 'ballId', 'ballGraphicSource',
    'battleSide', 'battleSlot', 'battleSendOut',
  ]) delete ball.dataset[key]
  clearInlinePresentation(ball)
}
