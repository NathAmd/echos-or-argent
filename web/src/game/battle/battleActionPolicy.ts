export type BattleActionFormat = 'simple' | 'double'

export type BattleBagActionRole = 'capture' | 'escape' | 'battle-stat' | 'party-target'

/**
 * Intention minimale soumise par un joueur avant que la session applique ses
 * propres règles HGSS. Les remplacements forcés restent entièrement possédés
 * par les sessions ; le choix gratuit entre deux adversaires est distinct du
 * changement volontaire qui consomme un tour.
 */
export type PlayerBattleActionIntent =
  | Readonly<{
    kind: 'bag'
    format: BattleActionFormat
    itemId: number
    role: BattleBagActionRole
  }>
  | Readonly<{
    kind: 'switch'
    format: BattleActionFormat
    mode: 'voluntary' | 'free-between-opponents'
    partyIndex: number
  }>
  | Readonly<{
    kind: 'safari'
    action: 'ball' | 'bait' | 'mud' | 'run'
  }>

/** Valeur JSON sérialisable expliquant pourquoi une règle refuse l'action. */
export type BattleActionVeto = Readonly<{
  code: string
  reason: string
}>

/**
 * Une politique ne peut que restreindre une action. L'absence de veto ne rend
 * jamais valide une action que la session simple ou double aurait refusée.
 */
export type BattleActionPolicy = Readonly<{
  vetoPlayerAction: (intent: PlayerBattleActionIntent) => BattleActionVeto | undefined
}>

/** Politique neutre du jeu de base : elle n'ajoute aucune restriction. */
export const baseBattleActionPolicy: BattleActionPolicy = Object.freeze({
  vetoPlayerAction: () => undefined,
})

/**
 * Compose les politiques dans l'ordre fourni. Le premier veto gagne et les
 * politiques suivantes ne sont pas consultées pour cette action.
 */
export function composeBattleActionPolicies(
  policies: readonly BattleActionPolicy[],
): BattleActionPolicy {
  const orderedPolicies = Object.freeze([...policies])
  return Object.freeze({
    vetoPlayerAction(intent) {
      for (const policy of orderedPolicies) {
        const veto = policy.vetoPlayerAction(intent)
        if (veto !== undefined) return veto
      }
      return undefined
    },
  })
}
