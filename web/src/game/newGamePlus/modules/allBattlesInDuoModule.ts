import { defineNewGamePlusModule } from '../newGamePlusTypes'
import { requireStrictRecord } from './teamRuleSerialization'

export const allBattlesInDuoModuleId = 'all-battles-in-duo'

export type AllBattlesInDuoConfig = Readonly<Record<string, never>>

export function decodeAllBattlesInDuoConfig(value: unknown): AllBattlesInDuoConfig {
  requireStrictRecord(value, [], 'La configuration Tous les combats en duo')
  return Object.freeze({})
}

/**
 * Marqueur de profil sans réglage implicite. Le choix reste indépendant des
 * autres règles NG+ et les ports de combat sont montés séparément au runtime.
 */
export const allBattlesInDuoModule = defineNewGamePlusModule<AllBattlesInDuoConfig>({
  id: allBattlesInDuoModuleId,
  revision: 1,
  title: 'Tous les combats en duo',
  description: 'Deux Pokémon joueur combattent s’ils sont aptes ; sinon le seul disponible joue sans clone. Un légendaire adverse n’est jamais dupliqué.',
  enabledByDefault: false,
  createDefaultConfig: () => ({}),
  decodeConfig: decodeAllBattlesInDuoConfig,
  apply: () => undefined,
})
