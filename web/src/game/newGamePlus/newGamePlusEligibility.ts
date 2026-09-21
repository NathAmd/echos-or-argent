import { HGSS_GAME_CLEAR_SYSTEM_FLAG } from '../scripts/hgssFieldSystemFlags'

// Les anciennes versions du port exécutaient tout le script du Panthéon mais
// omettaient CallTask_GameClear. Ce témoin ROM, posé uniquement par cette scène,
// permet de récupérer ces sauvegardes sans leur inventer une progression.
export const HGSS_LEGACY_HALL_OF_FAME_EVIDENCE_FLAG = 0x97e

export function hasUnlockedNewGamePlusFromKantoLeague(flags: ReadonlySet<number>): boolean {
  return flags.has(HGSS_GAME_CLEAR_SYSTEM_FLAG)
    || flags.has(HGSS_LEGACY_HALL_OF_FAME_EVIDENCE_FLAG)
}
