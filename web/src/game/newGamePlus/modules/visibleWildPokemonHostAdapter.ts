import type { PreparedFieldWildEncounter } from '../../encounters/wildEncounterSelection'
import type {
  VisibleWildInteraction,
  VisibleWildPokemonRuntime,
} from './visibleWildPokemonRule'

export type VisibleWildPokemonEncounterHost = Readonly<{
  /** Résout la clé persistée vers la rencontre que le host avait préparée. */
  resolvePreparedEncounter: (interaction: VisibleWildInteraction) => PreparedFieldWildEncounter | undefined
  /** Doit appeler le chemin de combat sauvage existant et confirmer son démarrage effectif. */
  startPreparedEncounter: (
    prepared: PreparedFieldWildEncounter,
    interaction: VisibleWildInteraction,
  ) => boolean
}>

/**
 * Pont transactionnel sans moteur de combat propre : la même référence
 * préparée traverse jusqu'au starter hôte, puis l'acteur n'est retiré qu'après
 * son acquittement positif. Un refus ou une exception laisse le monde intact.
 */
export function tryStartVisibleWildPokemonInteraction(
  runtime: VisibleWildPokemonRuntime,
  actorId: string,
  host: VisibleWildPokemonEncounterHost,
): boolean {
  if (typeof host.resolvePreparedEncounter !== 'function'
    || typeof host.startPreparedEncounter !== 'function') {
    throw new Error("L'adaptateur hôte des Pokémon visibles est incomplet.")
  }
  const resolved = runtime.resolvePreparedInteraction(actorId, host.resolvePreparedEncounter)
  if (!resolved) return false
  if (!host.startPreparedEncounter(resolved.prepared, resolved)) return false
  runtime.commitEncounterStarted(actorId)
  return true
}
