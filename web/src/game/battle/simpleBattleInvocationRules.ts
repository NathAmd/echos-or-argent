export type HgssMoveInvocationKind = 'mirrorMove' | 'copycat' | 'metronome' | 'sleepTalk' | 'assist'

const mirrorMoveForbiddenIds = new Set([102, 165, 166, 448])
const copycatForbiddenIds = new Set([
  68, 102, 118, 119, 165, 166, 168, 182, 197, 203, 214, 243, 264, 266, 270, 271,
  274, 289, 343, 364, 382, 383, 415, 448,
])
const metronomeForbiddenIds = new Set([
  68, 102, 118, 119, 165, 166, 214, 243, 264, 266, 270, 274, 289, 343, 364, 382, 383, 448,
])
const sleepTalkForbiddenIds = new Set([118, 165, 214, 264, 274, 382, 383, 448])
const assistForbiddenIds = new Set([68, 102, 118, 119, 165, 166, 214, 243, 264, 266, 270, 274, 289, 343, 364, 382, 383, 448])

/** Listes d’échec Gen IV utilisées par les scripts d’invocation, séparées par commande. */
export function isHgssMoveCallableBy(moveId: number, kind: HgssMoveInvocationKind): boolean {
  if (moveId <= 0) return false
  const forbidden = kind === 'mirrorMove' ? mirrorMoveForbiddenIds
    : kind === 'copycat' ? copycatForbiddenIds : kind === 'metronome' ? metronomeForbiddenIds
      : kind === 'sleepTalk' ? sleepTalkForbiddenIds : assistForbiddenIds
  return !forbidden.has(moveId)
}
