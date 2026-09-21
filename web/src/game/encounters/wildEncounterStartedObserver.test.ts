import { describe, expect, it } from 'vitest'
import { deriveLegacyPokemonInstanceId } from '../pokemon/pokemonInstanceId'
import {
  composeWildEncounterStartedObservers,
  createWildEncounterStartedEvent,
  noopWildEncounterStartedObserver,
  observeWildEncounterStarted,
  type WildEncounterStartedEvent,
  type WildEncounterStartedObserver,
} from './wildEncounterStartedObserver'

const instanceId = deriveLegacyPokemonInstanceId('wild-encounter-observer', 'map/12/encounter/1')

const event = createWildEncounterStartedEvent({
  mapId: 12,
  mapSectionId: 42,
  method: 'land',
  instanceId,
  speciesId: 16,
  level: 3,
})

describe('observateur de rencontre sauvage démarrée', () => {
  it('produit un instantané immuable composé uniquement de données JSON', () => {
    expect(event).toEqual({
      kind: 'wild-encounter-started',
      mapId: 12,
      mapSectionId: 42,
      method: 'land',
      instanceId,
      speciesId: 16,
      level: 3,
    })
    expect(Object.isFrozen(event)).toBe(true)
    expect(JSON.parse(JSON.stringify(event))).toEqual(event)
  })

  it('reste neutre et accepte chaque méthode de rencontre du socle', () => {
    expect(() => {
      for (const method of ['land', 'surfing', 'fishing', 'roamer', 'safari', 'scripted'] as const) {
        noopWildEncounterStartedObserver.observeWildEncounterStarted(createWildEncounterStartedEvent({
          ...event,
          method,
        }))
      }
    }).not.toThrow()
  })

  it('projette les détails seulement lorsqu’un observateur actif est raccordé', () => {
    const observed: WildEncounterStartedEvent[] = []
    const details = { ...event, method: 'fishing' as const }

    observeWildEncounterStarted(details)
    observeWildEncounterStarted(details, {
      observeWildEncounterStarted: (started) => { observed.push(started) },
    })

    expect(observed).toEqual([{ ...event, method: 'fishing' }])
    expect(observed[0]).not.toBe(details)
    expect(Object.isFrozen(observed[0])).toBe(true)
  })

  it('ne valide ni n’alloue d’événement sur le chemin neutre du jeu de base', () => {
    expect(() => observeWildEncounterStarted({
      ...event,
      instanceId: 'non-canonique' as typeof instanceId,
    })).not.toThrow()
  })

  it('notifie les observateurs dans leur ordre déclaré et fige leur liste', () => {
    const calls: string[] = []
    const observers: WildEncounterStartedObserver[] = [
      { observeWildEncounterStarted: (observed) => calls.push(`first:${observed.instanceId}`) },
      { observeWildEncounterStarted: (observed) => calls.push(`second:${observed.instanceId}`) },
    ]
    const composite = composeWildEncounterStartedObservers(observers)
    observers.reverse()

    composite.observeWildEncounterStarted(event)

    expect(calls).toEqual([`first:${instanceId}`, `second:${instanceId}`])
    expect(composeWildEncounterStartedObservers([])).toBe(noopWildEncounterStartedObserver)
  })

  it('refuse les identités et coordonnées non canoniques avant observation', () => {
    expect(() => createWildEncounterStartedEvent({ ...event, mapId: -1 })).toThrow(/carte/)
    expect(() => createWildEncounterStartedEvent({ ...event, mapSectionId: Number.NaN })).toThrow(/section/)
    expect(() => createWildEncounterStartedEvent({ ...event, speciesId: 0 })).toThrow(/espèce/)
    expect(() => createWildEncounterStartedEvent({ ...event, level: 101 })).toThrow(/niveau/)
    expect(() => createWildEncounterStartedEvent({
      ...event,
      instanceId: 'identifiant-invalide' as typeof instanceId,
    })).toThrow(/identifiant persistant/)
  })
})
