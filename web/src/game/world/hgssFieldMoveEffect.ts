import type { PlayerDirection } from '../../ndsTypes'

export type HgssFieldMoveEffectMode = 0 | 1 | 2 | 3 | 4 | 5
export type HgssFieldMoveEffectKind = 'cut' | 'rockSmash' | 'headbutt'
export type HgssFieldMoveEffectTarget = 'player' | 'follower'

export type HgssFieldMoveEffectProfile = Readonly<{
  mode: HgssFieldMoveEffectMode
  kind: HgssFieldMoveEffectKind
  target: HgssFieldMoveEffectTarget
  archivePath: '/a/1/3/4'
  modelMember: number
  animationMembers: readonly number[]
  soundSequenceId: number
}>

export type HgssFieldMoveEffectSample = Readonly<{
  animationFrame: number
  visible: boolean
  cameraPulse: boolean
  complete: boolean
}>

export const hgssFieldMoveEffectAnimationFrames = 45
export const hgssFieldMoveEffectCompletionFrames = hgssFieldMoveEffectAnimationFrames + 2

const archivePath = '/a/1/3/4' as const
const profiles = Object.freeze([
  { mode: 0, kind: 'cut', target: 'player', archivePath, modelMember: 3, animationMembers: [0, 1, 2], soundSequenceId: 1610 },
  { mode: 1, kind: 'rockSmash', target: 'player', archivePath, modelMember: 8, animationMembers: [4, 5, 6, 7], soundSequenceId: 1609 },
  { mode: 2, kind: 'rockSmash', target: 'follower', archivePath, modelMember: 8, animationMembers: [4, 5, 6, 7], soundSequenceId: 1609 },
  { mode: 3, kind: 'cut', target: 'follower', archivePath, modelMember: 3, animationMembers: [0, 1, 2], soundSequenceId: 1610 },
  { mode: 4, kind: 'headbutt', target: 'player', archivePath, modelMember: 19, animationMembers: [17, 18], soundSequenceId: 2302 },
  { mode: 5, kind: 'headbutt', target: 'follower', archivePath, modelMember: 19, animationMembers: [17, 18], soundSequenceId: 2302 },
] as const satisfies readonly HgssFieldMoveEffectProfile[])

export function resolveHgssFieldMoveEffectProfile(mode: number): HgssFieldMoveEffectProfile {
  const profile = profiles[mode]
  if (!profile) throw new Error(`Effet terrain HGSS ${mode} invalide pour ScrCmd_560.`)
  return profile
}

export function resolveHgssFieldMoveDirectionOffset(
  direction: PlayerDirection,
  distance: number,
): Readonly<{ x: number, z: number }> {
  if (direction === 'north') return { x: 0, z: -distance }
  if (direction === 'south') return { x: 0, z: distance }
  if (direction === 'west') return { x: -distance, z: 0 }
  return { x: distance, z: 0 }
}

/**
 * Reproduit les trois tâches natives : 45 avances d'animation, une passe de
 * restauration/destruction, puis la publication de la variable de résultat.
 * Headbutt translate position et cible caméra aux updates 1-2 puis 5-6.
 */
export function sampleHgssFieldMoveEffect(
  mode: HgssFieldMoveEffectMode,
  elapsedUpdates: number,
): HgssFieldMoveEffectSample {
  const update = Math.max(0, Math.floor(elapsedUpdates))
  const headbutt = resolveHgssFieldMoveEffectProfile(mode).kind === 'headbutt'
  return {
    animationFrame: Math.min(update, hgssFieldMoveEffectAnimationFrames - 1),
    visible: update < hgssFieldMoveEffectAnimationFrames,
    cameraPulse: headbutt && (update === 1 || update === 2 || update === 5 || update === 6),
    complete: update >= hgssFieldMoveEffectCompletionFrames,
  }
}
