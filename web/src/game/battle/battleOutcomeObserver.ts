import type { PokemonInstanceId } from '../pokemon/pokemonInstanceId'

export type BattleOutcomePokemonIdentity = Readonly<{
  instanceId: PokemonInstanceId
  side: 'player' | 'opponent'
  partyIndex: number
}>

export type DetailedBattleOutcomeEvent =
  | Readonly<{
    kind: 'pokemon-knocked-out'
    pokemon: BattleOutcomePokemonIdentity
  }>
  | Readonly<{
    kind: 'battle-finished'
    outcome: 'win' | 'loss' | 'flee'
  }>
  | Readonly<{
    kind: 'battle-finished'
    outcome: 'capture'
    capturedPokemon: BattleOutcomePokemonIdentity
  }>

export type DetailedBattleOutcomeObserver = Readonly<{
  observeBattleOutcome: (event: DetailedBattleOutcomeEvent) => void
}>

/** Observateur neutre du jeu de base. */
export const noopDetailedBattleOutcomeObserver: DetailedBattleOutcomeObserver = Object.freeze({
  observeBattleOutcome: () => undefined,
})

/** Notifie tous les observateurs dans l'ordre figé lors de la composition. */
export function composeDetailedBattleOutcomeObservers(
  observers: readonly DetailedBattleOutcomeObserver[],
): DetailedBattleOutcomeObserver {
  const orderedObservers = Object.freeze([...observers])
  return Object.freeze({
    observeBattleOutcome(event) {
      for (const observer of orderedObservers) observer.observeBattleOutcome(event)
    },
  })
}
