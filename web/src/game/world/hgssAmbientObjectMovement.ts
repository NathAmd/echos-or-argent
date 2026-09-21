import type { MapEventPreview, PlayerDirection } from '../../ndsTypes'
import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import { decodeHgssPlayerDirection } from '../player/playerDirection'
import { hgssVBlankRate } from './hgssWorldAnimationClock'

type MapObjectEventPreview = MapEventPreview['objects'][number]
const randomWaitFrames = [16, 32, 48, 64] as const
const directionDelta: Record<PlayerDirection, readonly [number, number]> = {
  north: [0, -1],
  south: [0, 1],
  west: [-1, 0],
  east: [1, 0],
}

// _020FD838 dans le moteur ARM9. Ces listes sont terminées par -1 dans la ROM.
const randomDirectionSets: readonly (readonly PlayerDirection[])[] = [
  ['north', 'south', 'west', 'east'],
  ['north', 'west'],
  ['north', 'east'],
  ['south', 'west'],
  ['south', 'east'],
  ['north', 'south', 'west'],
  ['north', 'south', 'east'],
  ['south', 'west', 'east'],
  ['north', 'west', 'east'],
  ['north', 'south'],
  ['west', 'east'],
]

const randomWalkDirectionSets: Readonly<Record<3 | 4 | 5, readonly PlayerDirection[]>> = {
  3: ['north', 'south', 'west', 'east'],
  4: ['north', 'south'],
  5: ['west', 'east'],
}

const fixedFacingDirections: Readonly<Record<14 | 15 | 16 | 17, PlayerDirection>> = {
  14: 'north',
  15: 'south',
  16: 'west',
  17: 'east',
}

const turningDirectionSequences: Readonly<Record<18 | 19, readonly PlayerDirection[]>> = {
  18: ['north', 'west', 'south', 'east'],
  19: ['north', 'east', 'south', 'west'],
}

// Identifiants 0x0e..0x25 de _020FD838, utilisés par les mouvements 21..44.
const routeDirectionSequences: readonly (readonly PlayerDirection[])[] = [
  ['north', 'east', 'west', 'south'],
  ['east', 'west', 'south', 'north'],
  ['south', 'north', 'east', 'west'],
  ['west', 'south', 'north', 'east'],
  ['west', 'east', 'south', 'north'],
  ['west', 'east', 'south', 'north'],
  ['south', 'north', 'west', 'east'],
  ['east', 'south', 'north', 'west'],
  ['west', 'north', 'south', 'east'],
  ['north', 'south', 'east', 'west'],
  ['east', 'west', 'north', 'south'],
  ['south', 'east', 'west', 'north'],
  ['east', 'north', 'south', 'west'],
  ['north', 'south', 'west', 'east'],
  ['west', 'east', 'north', 'south'],
  ['south', 'east', 'north', 'west'],
  ['north', 'west', 'south', 'east'],
  ['south', 'east', 'north', 'west'],
  ['west', 'south', 'east', 'north'],
  ['east', 'north', 'west', 'south'],
  ['north', 'east', 'south', 'west'],
  ['south', 'west', 'north', 'east'],
  ['west', 'north', 'east', 'south'],
  ['east', 'south', 'west', 'north'],
]

// Le troisième paramètre de sub_02061AEC choisit l'axe testé au retour au
// point initial. Il ne correspond pas aux xRange/zRange de l'événement.
const routeUsesInitialZ = [
  false, false, true, true, false, false, true, true,
  true, true, false, false, true, true, false, false,
  true, true, false, false, true, true, false, false,
] as const

const playerAwareMovementTypes = new Set([2, 6, 7, 8, 9, 10, 11, 12, 13, 18, 19, 45, 46])

type AmbientBehavior =
  | { kind: 'still' }
  | { kind: 'random-facing', directions: readonly PlayerDirection[] }
  | { kind: 'random-walk', directions: readonly PlayerDirection[] }
  | { kind: 'fixed-facing', direction: PlayerDirection }
  | { kind: 'turning', directions: readonly PlayerDirection[] }
  | { kind: 'continuous-walk' }
  | { kind: 'route', directions: readonly PlayerDirection[], usesInitialZ: boolean }

type AmbientObjectState = {
  template: MapObjectEventPreview
  movement: number
  behavior: AmbientBehavior
  phase: 'init' | 'prime' | 'wait' | 'ready'
  dueFrame: number
  routeIndex: number
  returning: boolean
  busy: boolean
  active: boolean
}

export type HgssAmbientObjectState = {
  x: number
  z: number
  direction: PlayerDirection
  movement: number
}

export type HgssAmbientPlayerState = {
  x: number
  z: number
}

export type HgssAmbientMotion = {
  objectId: number
  direction: PlayerDirection
  kind: 'walk' | 'walkInPlace'
}

export type HgssAmbientObjectMovementHooks = {
  getObjectState: (objectId: number) => HgssAmbientObjectState | undefined
  getPlayerState: () => HgssAmbientPlayerState | undefined
  isObjectActive: (object: MapObjectEventPreview) => boolean
  isObjectBusy: (objectId: number) => boolean
  faceObject: (objectId: number, direction: PlayerDirection) => void
  tryMoveObject: (objectId: number, direction: PlayerDirection) => boolean
  startMotion: (motion: HgssAmbientMotion, onComplete: () => void) => void
}

function randomChoice<T>(values: readonly T[], rng: HgssLcrng): T {
  const value = values[rng.nextU16() % values.length]
  if (value === undefined) throw new Error('La table ROM de mouvement autonome est vide.')
  return value
}

function nextRandomWait(rng: HgssLcrng): number {
  return randomChoice(randomWaitFrames, rng)
}

function randomFacingSetIndex(movement: number): number | undefined {
  if (movement === 2) return 0
  if (movement >= 6 && movement <= 13) return movement - 5
  if (movement === 45) return 9
  if (movement === 46) return 10
  return undefined
}

export function resolveHgssAmbientObjectBehavior(movement: number): AmbientBehavior {
  const randomSetIndex = randomFacingSetIndex(movement)
  if (randomSetIndex !== undefined) return { kind: 'random-facing', directions: randomDirectionSets[randomSetIndex]! }
  if (movement >= 3 && movement <= 5) return { kind: 'random-walk', directions: randomWalkDirectionSets[movement as 3 | 4 | 5] }
  if (movement >= 14 && movement <= 17) return { kind: 'fixed-facing', direction: fixedFacingDirections[movement as 14 | 15 | 16 | 17] }
  if (movement === 18 || movement === 19) return { kind: 'turning', directions: turningDirectionSequences[movement] }
  if (movement === 20) return { kind: 'continuous-walk' }
  if (movement >= 21 && movement <= 44) {
    const index = movement - 21
    return { kind: 'route', directions: routeDirectionSequences[index]!, usesInitialZ: routeUsesInitialZ[index]! }
  }
  // 0/1 sont immobiles. 47..56 sont des contrôleurs spécialisés (follower,
  // objets 3D et effets) et ne doivent jamais recevoir une marche générique.
  return { kind: 'still' }
}

function createObjectState(template: MapObjectEventPreview, movement: number, frame: number, rng: HgssLcrng, active = true): AmbientObjectState {
  const behavior = resolveHgssAmbientObjectBehavior(movement)
  const dueFrame = active && behavior.kind === 'random-facing' ? frame + nextRandomWait(rng) : frame
  return {
    template,
    movement,
    behavior,
    phase: behavior.kind === 'random-walk' ? 'prime' : 'init',
    dueFrame,
    routeIndex: 0,
    returning: false,
    busy: false,
    active,
  }
}

function directionTowardPlayer(
  state: AmbientObjectState,
  actor: HgssAmbientObjectState,
  player: HgssAmbientPlayerState | undefined,
): PlayerDirection | undefined {
  if (!player || !playerAwareMovementTypes.has(state.movement) || (state.template.type !== 1 && state.template.type !== 2)) return undefined
  const range = state.template.parameters?.[0] ?? 0
  if (range < 1 || Math.abs(player.x - actor.x) > range || Math.abs(player.z - actor.z) > range) return undefined
  const direction = actor.x > player.x
    ? 'west'
    : actor.x < player.x
      ? 'east'
      : actor.z <= player.z
        ? 'south'
        : 'north'
  const allowed = state.behavior.kind === 'random-facing'
    ? state.behavior.directions
    : state.behavior.kind === 'turning'
      ? state.behavior.directions
      : undefined
  return allowed?.includes(direction) ? direction : undefined
}

function isInsideNativeRange(template: MapObjectEventPreview, actor: HgssAmbientObjectState, direction: PlayerDirection): boolean {
  const [deltaX, deltaZ] = directionDelta[direction]
  const nextX = actor.x + deltaX
  const nextZ = actor.z + deltaZ
  return (template.xRange < 0 || Math.abs(nextX - template.x) <= template.xRange)
    && (template.zRange < 0 || Math.abs(nextZ - template.z) <= template.zRange)
}

function beginMotion(
  state: AmbientObjectState,
  direction: PlayerDirection,
  kind: HgssAmbientMotion['kind'],
  frame: number,
  hooks: HgssAmbientObjectMovementHooks,
  states: Map<number, AmbientObjectState>,
): void {
  state.busy = true
  hooks.startMotion({ objectId: state.template.id, direction, kind }, () => {
    if (states.get(state.template.id) !== state) return
    state.busy = false
    state.phase = state.behavior.kind === 'random-walk' ? 'prime' : 'ready'
    state.dueFrame = Math.max(frame, state.dueFrame) + 1
  })
}

function attemptMove(
  state: AmbientObjectState,
  actor: HgssAmbientObjectState,
  direction: PlayerDirection,
  hooks: HgssAmbientObjectMovementHooks,
): boolean {
  hooks.faceObject(state.template.id, direction)
  return isInsideNativeRange(state.template, actor, direction) && hooks.tryMoveObject(state.template.id, direction)
}

export function hgssAmbientVBlankFrame(nowMs: number): number {
  return Math.max(0, Math.floor(nowMs * hgssVBlankRate / 1000))
}

export type HgssAmbientObjectMovementController = {
  reset: (objects: readonly MapObjectEventPreview[], frame: number, rng: HgssLcrng, isObjectActive?: (object: MapObjectEventPreview) => boolean) => void
  update: (frame: number, rng: HgssLcrng, hooks: HgssAmbientObjectMovementHooks, paused?: boolean) => void
  clear: () => void
}

export function createHgssAmbientObjectMovementController(): HgssAmbientObjectMovementController {
  const states = new Map<number, AmbientObjectState>()
  let lastFrame = 0

  const clear = (): void => {
    states.clear()
    lastFrame = 0
  }

  const reset = (objects: readonly MapObjectEventPreview[], frame: number, rng: HgssLcrng, isObjectActive: (object: MapObjectEventPreview) => boolean = () => true): void => {
    states.clear()
    lastFrame = frame
    for (const object of objects) states.set(object.id, createObjectState(object, object.movement, frame, rng, isObjectActive(object)))
  }

  const update = (frame: number, rng: HgssLcrng, hooks: HgssAmbientObjectMovementHooks, paused = false): void => {
    if (frame < lastFrame) lastFrame = frame
    const elapsed = Math.max(0, frame - lastFrame)
    lastFrame = frame
    if (paused) {
      for (const state of states.values()) state.dueFrame += elapsed
      return
    }

    for (const [objectId, previous] of states) {
      const actor = hooks.getObjectState(objectId)
      if (!actor) continue
      let state = previous
      if (!hooks.isObjectActive(state.template)) {
        state.active = false
        continue
      }
      if (!state.active) {
        state = createObjectState(state.template, actor.movement, frame, rng)
        states.set(objectId, state)
      }
      if (actor.movement !== state.movement) {
        state = createObjectState(state.template, actor.movement, frame, rng)
        states.set(objectId, state)
      }
      if (state.busy || hooks.isObjectBusy(objectId)) continue

      const playerDirection = directionTowardPlayer(state, actor, hooks.getPlayerState())
      if (playerDirection) {
        hooks.faceObject(objectId, playerDirection)
        if (state.behavior.kind === 'random-facing') state.dueFrame += elapsed
        else if (state.behavior.kind === 'turning') state.dueFrame = frame + 25
        continue
      }
      if (frame < state.dueFrame) continue

      switch (state.behavior.kind) {
        case 'still':
          break
        case 'fixed-facing':
          hooks.faceObject(objectId, state.behavior.direction)
          state.behavior = { kind: 'still' }
          break
        case 'random-facing': {
          // sub_02061338 tire d'abord le prochain délai, puis la direction.
          state.dueFrame = frame + nextRandomWait(rng)
          hooks.faceObject(objectId, randomChoice(state.behavior.directions, rng))
          break
        }
        case 'random-walk': {
          if (state.phase === 'prime') {
            hooks.faceObject(objectId, actor.direction)
            state.phase = 'wait'
            state.dueFrame = frame + 1
            break
          }
          if (state.phase === 'wait') {
            state.phase = 'ready'
            state.dueFrame = frame + nextRandomWait(rng)
            break
          }
          const direction = randomChoice(state.behavior.directions, rng)
          if (attemptMove(state, actor, direction, hooks)) beginMotion(state, direction, 'walk', frame, hooks, states)
          else {
            state.phase = 'prime'
            state.dueFrame = frame + 1
          }
          break
        }
        case 'turning': {
          const currentIndex = Math.max(0, state.behavior.directions.indexOf(actor.direction))
          const direction = state.behavior.directions[(currentIndex + 1) % state.behavior.directions.length]!
          hooks.faceObject(objectId, direction)
          // Une pose tenue d'une VBlank précède le compteur natif de 24.
          state.dueFrame = frame + 25
          break
        }
        case 'continuous-walk': {
          let direction = actor.direction
          if (state.returning && actor.x === state.template.x && actor.z === state.template.z) {
            direction = oppositeDirection(direction)
            state.returning = false
          }
          let moved = attemptMove(state, actor, direction, hooks)
          if (!moved) {
            state.returning = true
            direction = oppositeDirection(direction)
            moved = attemptMove(state, actor, direction, hooks)
          }
          beginMotion(state, direction, moved ? 'walk' : 'walkInPlace', frame, hooks, states)
          break
        }
        case 'route': {
          if (state.routeIndex === 2) {
            const onInitialAxis = state.behavior.usesInitialZ ? actor.z === state.template.z : actor.x === state.template.x
            if (onInitialAxis) state.routeIndex += 1
          }
          if (state.routeIndex === 3 && actor.x === state.template.x && actor.z === state.template.z) state.routeIndex = 0
          let direction = state.behavior.directions[state.routeIndex]!
          let moved = attemptMove(state, actor, direction, hooks)
          if (!moved) {
            state.routeIndex = (state.routeIndex + 1) % state.behavior.directions.length
            direction = state.behavior.directions[state.routeIndex]!
            moved = attemptMove(state, actor, direction, hooks)
          }
          beginMotion(state, direction, moved ? 'walk' : 'walkInPlace', frame, hooks, states)
          break
        }
      }
    }
  }

  return { reset, update, clear }
}

function oppositeDirection(direction: PlayerDirection): PlayerDirection {
  return ({ north: 'south', south: 'north', west: 'east', east: 'west' } as const)[direction]
}

export function decodeHgssAmbientInitialDirection(object: MapObjectEventPreview): PlayerDirection {
  return decodeHgssPlayerDirection(object.facingDirection)
}
