export type DoubleBattleRosterSide = 'player' | 'opponent'
export type DoubleBattleRosterSlot = 0 | 1
export type DoubleBattleRosterPosition = { side: DoubleBattleRosterSide, slot: DoubleBattleRosterSlot }

type DoubleBattleRosterContext<T> = {
  teams: Record<DoubleBattleRosterSide, readonly T[]>
}

/** Les slots occupés sont les seules positions que le moteur doit simuler. */
export function getDoubleBattleOccupiedPositions<T>(
  context: DoubleBattleRosterContext<T>,
  side?: DoubleBattleRosterSide,
): DoubleBattleRosterPosition[] {
  const sides = side ? [side] : (['player', 'opponent'] as const)
  return sides.flatMap((currentSide) => context.teams[currentSide].map((_, slot) => ({
    side: currentSide,
    slot: slot as DoubleBattleRosterSlot,
  })))
}

export function getDoubleBattleParticipantAt<T>(
  context: DoubleBattleRosterContext<T>,
  position: DoubleBattleRosterPosition,
): T | undefined {
  return position.slot < context.teams[position.side].length
    ? context.teams[position.side][position.slot]
    : undefined
}

export function requireDoubleBattleParticipantAt<T>(
  context: DoubleBattleRosterContext<T>,
  position: DoubleBattleRosterPosition,
): T {
  const participant = getDoubleBattleParticipantAt(context, position)
  if (!participant) throw new Error(`Le slot ${position.side}:${position.slot} n'est pas occupé dans ce combat.`)
  return participant
}

export function isDoubleBattlePositionOccupied<T>(
  context: DoubleBattleRosterContext<T>,
  position: DoubleBattleRosterPosition,
): boolean {
  return getDoubleBattleParticipantAt(context, position) !== undefined
}
