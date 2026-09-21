import { parsePokemonInstanceId, type PokemonInstanceId } from '../pokemon/pokemonInstanceId'
import type { PreparedWildEncounter } from './wildEncounterSelection'

export type WildEncounterStartedMethod = PreparedWildEncounter['method'] | 'scripted'

export type WildEncounterStartedEvent = Readonly<{
  kind: 'wild-encounter-started'
  mapId: number
  mapSectionId: number
  method: WildEncounterStartedMethod
  instanceId: PokemonInstanceId
  speciesId: number
  level: number
}>

export type WildEncounterStartedDetails = Readonly<Omit<WildEncounterStartedEvent, 'kind'>>

export type WildEncounterStartedObserver = Readonly<{
  observeWildEncounterStarted: (event: WildEncounterStartedEvent) => void
}>

const methods = new Set<WildEncounterStartedMethod>([
  'land',
  'surfing',
  'fishing',
  'roamer',
  'safari',
  'scripted',
])

function requireUnsignedInteger(value: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${label} ${value} de la rencontre sauvage démarrée est invalide.`)
  }
  return value
}

/** Construit un instantané JSON immuable, sans exposer le Pokémon mutable. */
export function createWildEncounterStartedEvent(
  details: WildEncounterStartedDetails,
): WildEncounterStartedEvent {
  if (!methods.has(details.method)) {
    throw new Error(`La méthode ${String(details.method)} de la rencontre sauvage démarrée est invalide.`)
  }
  const speciesId = requireUnsignedInteger(details.speciesId, 493, 'L’espèce')
  if (speciesId === 0) throw new Error('L’espèce 0 de la rencontre sauvage démarrée est invalide.')
  const level = requireUnsignedInteger(details.level, 100, 'Le niveau')
  if (level === 0) throw new Error('Le niveau 0 de la rencontre sauvage démarrée est invalide.')
  return Object.freeze({
    kind: 'wild-encounter-started',
    mapId: requireUnsignedInteger(details.mapId, 0xffff, 'La carte'),
    mapSectionId: requireUnsignedInteger(details.mapSectionId, 0xffff, 'La section de carte'),
    method: details.method,
    instanceId: parsePokemonInstanceId(details.instanceId),
    speciesId,
    level,
  })
}

/** Observateur neutre du jeu de base. */
export const noopWildEncounterStartedObserver: WildEncounterStartedObserver = Object.freeze({
  observeWildEncounterStarted: () => undefined,
})

/**
 * Point d'émission à appeler uniquement après que le moteur de combat a
 * effectivement démarré. Le socle neutre évite même l'allocation de l'événement.
 */
export function observeWildEncounterStarted(
  details: WildEncounterStartedDetails,
  observer: WildEncounterStartedObserver = noopWildEncounterStartedObserver,
): void {
  if (observer === noopWildEncounterStartedObserver) return
  observer.observeWildEncounterStarted(createWildEncounterStartedEvent(details))
}

/** Notifie une copie figée des observateurs, dans leur ordre de déclaration. */
export function composeWildEncounterStartedObservers(
  observers: readonly WildEncounterStartedObserver[],
): WildEncounterStartedObserver {
  if (observers.length === 0) return noopWildEncounterStartedObserver
  const orderedObservers = Object.freeze([...observers])
  return Object.freeze({
    observeWildEncounterStarted(event) {
      for (const observer of orderedObservers) observer.observeWildEncounterStarted(event)
    },
  })
}
