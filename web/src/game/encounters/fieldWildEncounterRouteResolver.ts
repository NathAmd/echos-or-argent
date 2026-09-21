import type {
  PreparedSafariWildEncounter,
  PreparedWildEncounter,
} from './wildEncounterSelection'

export type PreparedStandardWildEncounter = Exclude<PreparedWildEncounter, PreparedSafariWildEncounter>

export type ResolvedFieldWildEncounterRoute =
  | { readonly engine: 'safari', readonly encounter: PreparedSafariWildEncounter }
  | { readonly engine: 'simple', readonly sessionKind: 'wild', readonly encounter: PreparedStandardWildEncounter }

export type FieldWildEncounterRouteResolver = (
  encounter: PreparedWildEncounter,
) => ResolvedFieldWildEncounterRoute

/** Reproduit strictement le dispatch HGSS actuel, sans relire l'etat mutable du terrain. */
export const resolveBaseFieldWildEncounterRoute: FieldWildEncounterRouteResolver = (encounter) => (
  encounter.method === 'safari'
    ? { engine: 'safari', encounter }
    : { engine: 'simple', sessionKind: 'wild', encounter }
)
