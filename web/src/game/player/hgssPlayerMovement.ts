import type { PlayerDirection } from '../../ndsTypes'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'

/** Etats `PlayerAvatar` 0, 1 et 2 de HGSS. */
export type PlayerLocomotionMode = 'walking' | 'cycling' | 'surfing'

export type PlayerMovementKind =
  | 'turn'
  | 'walk'
  | 'run'
  | 'cycle'
  | 'surf'
  | 'ledge-jump'
  | 'ice-slide'
  | 'forced-slide'
  | 'ladder'

export const hgssFieldMoveIds = {
  cut: 15,
  fly: 19,
  headbutt: 29,
  surf: 57,
  strength: 70,
  waterfall: 127,
  rockSmash: 249,
  whirlpool: 250,
  rockClimb: 431,
  sweetScent: 230,
} as const

export type HgssFieldMove = keyof typeof hgssFieldMoveIds

// Indices utilisés par FieldSystem_CheckBadge dans la ROM HGSS.
export const hgssFieldMoveBadgeIndex: Readonly<Partial<Record<HgssFieldMove, number>>> = {
  rockSmash: 0,
  cut: 1,
  strength: 2,
  surf: 3,
  fly: 4,
  whirlpool: 6,
  waterfall: 7,
  rockClimb: 15,
}

/** Obstacles BDHC qui demandent une capacite distincte pendant Surf. */
export const hgssSurfFieldMoveMetatileBehaviors = {
  whirlpool: 17,
  waterfall: 19,
} as const

const surfableBehaviors = new Set([
  16,
  hgssSurfFieldMoveMetatileBehaviors.whirlpool,
  18,
  hgssSurfFieldMoveMetatileBehaviors.waterfall,
  20,
  21,
  25,
  42,
  80,
  81,
  82,
  83,
  115,
  120,
  124,
])
const ledgeDirections: Readonly<Partial<Record<number, PlayerDirection>>> = {
  56: 'east',
  57: 'west',
  58: 'north',
  59: 'south',
}
const forcedSlideDirections: Readonly<Partial<Record<number, PlayerDirection>>> = {
  64: 'east',
  65: 'west',
  66: 'north',
  67: 'south',
}

export function getMetatileBehavior(attribute: number | undefined): number | undefined {
  return attribute === undefined ? undefined : attribute & 0xff
}

export function isSurfableMetatile(attribute: number | undefined): boolean {
  const behavior = getMetatileBehavior(attribute)
  return behavior !== undefined && surfableBehaviors.has(behavior)
}

export function isWaterfallMetatile(attribute: number | undefined): boolean {
  return getMetatileBehavior(attribute) === hgssSurfFieldMoveMetatileBehaviors.waterfall
}

export function isWhirlpoolMetatile(attribute: number | undefined): boolean {
  return getMetatileBehavior(attribute) === hgssSurfFieldMoveMetatileBehaviors.whirlpool
}

export function getLedgeDirection(attribute: number | undefined): PlayerDirection | undefined {
  const behavior = getMetatileBehavior(attribute)
  return behavior === undefined ? undefined : ledgeDirections[behavior]
}

export function getForcedSlideDirection(attribute: number | undefined): PlayerDirection | undefined {
  const behavior = getMetatileBehavior(attribute)
  return behavior === undefined ? undefined : forcedSlideDirections[behavior]
}

export function isIceMetatile(attribute: number | undefined): boolean {
  return getMetatileBehavior(attribute) === 32
}

export function isLadderMetatile(attribute: number | undefined): boolean {
  const behavior = getMetatileBehavior(attribute)
  return behavior === 60 || behavior === 61 || behavior === 62
}

export function getPlayerMovementDurationFrames(kind: PlayerMovementKind): number {
  switch (kind) {
    case 'turn': return 4
    case 'run':
    case 'cycle': return 4
    case 'ledge-jump': return 16
    case 'ladder': return 12
    default: return 8
  }
}

export function resolvePlayerMovementKind(
  locomotion: PlayerLocomotionMode,
  attribute: number | undefined,
  running: boolean,
  forced = false,
): PlayerMovementKind {
  if (getLedgeDirection(attribute)) return 'ledge-jump'
  if (isLadderMetatile(attribute)) return 'ladder'
  if (getForcedSlideDirection(attribute)) return 'forced-slide'
  if (isIceMetatile(attribute) && forced) return 'ice-slide'
  if (locomotion === 'cycling') return 'cycle'
  if (locomotion === 'surfing') return 'surf'
  return running ? 'run' : 'walk'
}

export function findPartyMemberWithFieldMove(party: readonly CanonicalPokemon[], move: HgssFieldMove): number | undefined {
  const moveId = hgssFieldMoveIds[move]
  const slot = party.findIndex((pokemon) => !pokemon.isEgg && pokemon.currentHp > 0 && pokemon.moves.some((entry) => entry.moveId === moveId))
  return slot < 0 ? undefined : slot
}

export type FieldMoveAvailability =
  | { available: true, partySlot: number }
  | { available: false, reason: 'badge' | 'party' }

export function getFieldMoveAvailability(
  move: HgssFieldMove,
  badges: ReadonlySet<number>,
  party: readonly CanonicalPokemon[],
): FieldMoveAvailability {
  const badge = hgssFieldMoveBadgeIndex[move]
  if (badge !== undefined && !badges.has(badge)) return { available: false, reason: 'badge' }
  const partySlot = findPartyMemberWithFieldMove(party, move)
  return partySlot === undefined ? { available: false, reason: 'party' } : { available: true, partySlot }
}

/** IDs MapObject de `PlayerAvatar_GetSpriteByStateAndGender`. */
export function getPlayerAvatarSpriteId(gender: 'male' | 'female', locomotion: PlayerLocomotionMode): number {
  if (locomotion === 'cycling') return gender === 'male' ? 21 : 98
  if (locomotion === 'surfing') return gender === 'male' ? 178 : 179
  return gender === 'male' ? 0 : 97
}
