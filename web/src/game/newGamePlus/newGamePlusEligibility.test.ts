import { describe, expect, it } from 'vitest'
import { HGSS_GAME_CLEAR_SYSTEM_FLAG } from '../scripts/hgssFieldSystemFlags'
import { HGSS_LEGACY_HALL_OF_FAME_EVIDENCE_FLAG, hasUnlockedNewGamePlusFromKantoLeague } from './newGamePlusEligibility'

describe('hasUnlockedNewGamePlusFromKantoLeague', () => {
  it('accepte le flag natif et le témoin historique du Panthéon, rien d’autre', () => {
    expect(hasUnlockedNewGamePlusFromKantoLeague(new Set([HGSS_GAME_CLEAR_SYSTEM_FLAG]))).toBe(true)
    expect(hasUnlockedNewGamePlusFromKantoLeague(new Set([HGSS_LEGACY_HALL_OF_FAME_EVIDENCE_FLAG]))).toBe(true)
    expect(hasUnlockedNewGamePlusFromKantoLeague(new Set([0x250]))).toBe(false)
  })
})
