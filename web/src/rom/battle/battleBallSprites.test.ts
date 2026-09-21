import { describe, expect, it } from 'vitest'
import {
  resolveHgssBallIdFromItemId,
  resolveHgssBattleBallSpriteMemberIds,
} from './battleBallSprites'

describe('ressources des Balls de combat HGSS', () => {
  it('reproduit ItemToBallId, y compris les huit Balls Fargas', () => {
    expect(resolveHgssBallIdFromItemId(1)).toBe(1)
    expect(resolveHgssBallIdFromItemId(5)).toBe(5)
    expect(resolveHgssBallIdFromItemId(16)).toBe(16)
    expect(resolveHgssBallIdFromItemId(492)).toBe(17)
    expect(resolveHgssBallIdFromItemId(496)).toBe(21)
    expect(resolveHgssBallIdFromItemId(499)).toBe(24)
    expect(resolveHgssBallIdFromItemId(500)).toBe(4)
    expect(resolveHgssBallIdFromItemId(0xffff)).toBe(4)
  })

  it('reproduit les colonnes NCGR/NCLR/NCER/NANR de ov07_022375BC', () => {
    expect(resolveHgssBattleBallSpriteMemberIds(1)).toEqual({
      characterMemberId: 261, paletteMemberId: 83, cellMemberId: 260, animationMemberId: 259,
    })
    expect(resolveHgssBattleBallSpriteMemberIds(4)).toEqual({
      characterMemberId: 270, paletteMemberId: 86, cellMemberId: 269, animationMemberId: 268,
    })
    expect(resolveHgssBattleBallSpriteMemberIds(5)).toEqual({
      characterMemberId: 273, paletteMemberId: 87, cellMemberId: 272, animationMemberId: 271,
    })
    expect(resolveHgssBattleBallSpriteMemberIds(17)).toEqual({
      characterMemberId: 309, paletteMemberId: 99, cellMemberId: 308, animationMemberId: 307,
    })
    expect(resolveHgssBattleBallSpriteMemberIds(24)).toEqual({
      characterMemberId: 330, paletteMemberId: 106, cellMemberId: 329, animationMemberId: 328,
    })
    expect(() => resolveHgssBattleBallSpriteMemberIds(25)).toThrow(/LUT native/)
  })
})
