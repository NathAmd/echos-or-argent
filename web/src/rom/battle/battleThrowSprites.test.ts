import { describe, expect, it } from 'vitest'
import { resolveHgssBattleThrowSpriteMemberIds } from './battleThrowSprites'

describe('HGSS battle throw sprite resources', () => {
  it('reproduit les entrées 0x401/0x402 de la LUT native', () => {
    expect(resolveHgssBattleThrowSpriteMemberIds('safari-rock')).toEqual({
      characterMemberId: 336,
      paletteMemberId: 108,
      cellMemberId: 335,
      animationMemberId: 334,
    })
    expect(resolveHgssBattleThrowSpriteMemberIds('safari-bait')).toEqual({
      characterMemberId: 339,
      paletteMemberId: 109,
      cellMemberId: 338,
      animationMemberId: 337,
    })
  })
})
