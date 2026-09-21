import { describe, expect, it } from 'vitest'
import { baseBattleActionPolicy } from '../../battle/battleActionPolicy'
import { noopDetailedBattleOutcomeObserver } from '../../battle/battleOutcomeObserver'
import {
  createWildEncounterStartedEvent,
  noopWildEncounterStartedObserver,
  type WildEncounterStartedEvent,
} from '../../encounters/wildEncounterStartedObserver'
import { deriveLegacyPokemonInstanceId } from '../../pokemon/pokemonInstanceId'
import { createVersionedSaveExtensionRegistry } from '../../save/versionedSaveExtensions'
import { nuzlockeStateFormat } from './nuzlockeState'
import {
  createNuzlockeRuntime,
  nuzlockeSaveExtension,
  nuzlockeSaveExtensionKey,
} from './nuzlockeRule'

const normalCapture = { kind: 'bag', format: 'simple', itemId: 4, role: 'capture' } as const
const safariBall = { kind: 'safari', action: 'ball' } as const
const safariBait = { kind: 'safari', action: 'bait' } as const

function encounter(
  mapSectionId: number,
  path: string,
  method: WildEncounterStartedEvent['method'] = 'land',
): WildEncounterStartedEvent {
  return createWildEncounterStartedEvent({
    mapId: mapSectionId + 100,
    mapSectionId,
    method,
    instanceId: deriveLegacyPokemonInstanceId('nuzlocke-runtime', path),
    speciesId: method === 'safari' ? 113 : 16,
    level: method === 'safari' ? 17 : 3,
  })
}

describe('règle Nuzlocke par première rencontre', () => {
  it("reste exactement neutre lorsqu'elle n'est pas activée", () => {
    const runtime = createNuzlockeRuntime({ enabled: false })

    expect(runtime.enabled).toBe(false)
    expect(runtime.wildEncounterStartedObserver).toBe(noopWildEncounterStartedObserver)
    expect(runtime.detailedBattleOutcomeObserver).toBe(noopDetailedBattleOutcomeObserver)
    expect(runtime.battleActionPolicy).toBe(baseBattleActionPolicy)
    runtime.wildEncounterStartedObserver.observeWildEncounterStarted(encounter(4, 'disabled'))
    expect(runtime.battleActionPolicy.vetoPlayerAction(normalCapture)).toBeUndefined()
    expect(runtime.snapshotState()).toBeUndefined()
  })

  it('consomme la section au démarrage réel et autorise la première rencontre courante', () => {
    const runtime = createNuzlockeRuntime({ enabled: true })
    const first = encounter(7, 'first')

    expect(runtime.battleActionPolicy.vetoPlayerAction(normalCapture)?.code)
      .toBe('new-game-plus.nuzlocke.encounter-untracked')
    runtime.wildEncounterStartedObserver.observeWildEncounterStarted(first)

    expect(runtime.battleActionPolicy.vetoPlayerAction(normalCapture)).toBeUndefined()
    expect(runtime.battleActionPolicy.vetoPlayerAction(safariBait)).toBeUndefined()
    expect(runtime.snapshotState()).toEqual({
      format: nuzlockeStateFormat,
      version: 1,
      sections: [{
        mapSectionId: 7,
        instanceId: first.instanceId,
        method: 'land',
        speciesId: 16,
        level: 3,
        outcome: 'started',
      }],
    })
  })

  it('autorise plusieurs Balls pendant cette unique occasion de capture', () => {
    const runtime = createNuzlockeRuntime({ enabled: true })
    runtime.wildEncounterStartedObserver.observeWildEncounterStarted(encounter(7, 'breakout'))

    // Le port d'issue n'émet aucun événement lors d'une Ball cassée : la
    // règle Nuzlocke porte donc sur la rencontre, pas sur un lancer unique.
    expect(runtime.battleActionPolicy.vetoPlayerAction(normalCapture)).toBeUndefined()
    expect(runtime.battleActionPolicy.vetoPlayerAction(normalCapture)).toBeUndefined()
  })

  it('marque fuite, victoire ou défaite comme ratées puis bloque la rencontre suivante', () => {
    for (const outcome of ['flee', 'win', 'loss'] as const) {
      const runtime = createNuzlockeRuntime({ enabled: true })
      const first = encounter(20, `failed/${outcome}/first`)
      runtime.wildEncounterStartedObserver.observeWildEncounterStarted(first)
      runtime.detailedBattleOutcomeObserver.observeBattleOutcome({ kind: 'battle-finished', outcome })
      runtime.wildEncounterStartedObserver.observeWildEncounterStarted(encounter(20, `failed/${outcome}/second`))

      expect(runtime.snapshotState()?.sections).toEqual([{
        mapSectionId: 20,
        instanceId: first.instanceId,
        method: 'land',
        speciesId: 16,
        level: 3,
        outcome: 'missed',
      }])
      expect(runtime.battleActionPolicy.vetoPlayerAction(normalCapture)?.code)
        .toBe('new-game-plus.nuzlocke.section-consumed')
    }
  })

  it("corrèle une capture par instanceId et n'accepte pas une identité étrangère", () => {
    const runtime = createNuzlockeRuntime({ enabled: true })
    const first = encounter(31, 'capture/first')
    const foreign = encounter(32, 'capture/foreign')
    runtime.wildEncounterStartedObserver.observeWildEncounterStarted(first)

    runtime.detailedBattleOutcomeObserver.observeBattleOutcome({
      kind: 'pokemon-knocked-out',
      pokemon: { instanceId: foreign.instanceId, side: 'opponent', partyIndex: 0 },
    })
    expect(runtime.snapshotState()?.sections[0]?.outcome).toBe('started')
    runtime.detailedBattleOutcomeObserver.observeBattleOutcome({
      kind: 'battle-finished',
      outcome: 'capture',
      capturedPokemon: { instanceId: first.instanceId, side: 'opponent', partyIndex: 0 },
    })

    expect(runtime.snapshotState()?.sections[0]?.outcome).toBe('caught')
    runtime.wildEncounterStartedObserver.observeWildEncounterStarted(encounter(31, 'capture/second'))
    expect(runtime.battleActionPolicy.vetoPlayerAction(normalCapture)?.code)
      .toBe('new-game-plus.nuzlocke.section-consumed')
  })

  it('consomme aussi une première rencontre mise KO grâce à son instanceId', () => {
    const runtime = createNuzlockeRuntime({ enabled: true })
    const first = encounter(44, 'knock-out')
    runtime.wildEncounterStartedObserver.observeWildEncounterStarted(first)
    runtime.detailedBattleOutcomeObserver.observeBattleOutcome({
      kind: 'pokemon-knocked-out',
      pokemon: { instanceId: first.instanceId, side: 'opponent', partyIndex: 0 },
    })

    expect(runtime.snapshotState()?.sections[0]?.outcome).toBe('missed')
    expect(runtime.battleActionPolicy.vetoPlayerAction(normalCapture)?.code)
      .toBe('new-game-plus.nuzlocke.section-consumed')
  })

  it('applique la même restriction aux Safari Balls sans bloquer appât, boue ou fuite', () => {
    const runtime = createNuzlockeRuntime({ enabled: true })
    const first = encounter(55, 'safari/first', 'safari')
    runtime.wildEncounterStartedObserver.observeWildEncounterStarted(first)
    expect(runtime.battleActionPolicy.vetoPlayerAction(safariBall)).toBeUndefined()
    runtime.detailedBattleOutcomeObserver.observeBattleOutcome({ kind: 'battle-finished', outcome: 'flee' })

    runtime.wildEncounterStartedObserver.observeWildEncounterStarted(encounter(55, 'safari/second', 'safari'))
    expect(runtime.battleActionPolicy.vetoPlayerAction(safariBall)?.code)
      .toBe('new-game-plus.nuzlocke.section-consumed')
    expect(runtime.battleActionPolicy.vetoPlayerAction(safariBait)).toBeUndefined()
    expect(runtime.battleActionPolicy.vetoPlayerAction({ kind: 'safari', action: 'mud' })).toBeUndefined()
    expect(runtime.battleActionPolicy.vetoPlayerAction({ kind: 'safari', action: 'run' })).toBeUndefined()
  })

  it('tolère une notification de démarrage identique sans consommer deux rencontres', () => {
    const runtime = createNuzlockeRuntime({ enabled: true })
    const first = encounter(61, 'duplicate')

    runtime.wildEncounterStartedObserver.observeWildEncounterStarted(first)
    runtime.wildEncounterStartedObserver.observeWildEncounterStarted(first)

    expect(runtime.snapshotState()?.sections).toHaveLength(1)
    expect(runtime.snapshotState()?.sections[0]?.outcome).toBe('started')
    expect(runtime.battleActionPolicy.vetoPlayerAction(normalCapture)).toBeUndefined()
  })

  it('finalise une rencontre sans issue observée quand la suivante commence', () => {
    const runtime = createNuzlockeRuntime({ enabled: true })
    runtime.wildEncounterStartedObserver.observeWildEncounterStarted(encounter(70, 'implicit-finish/first'))
    runtime.wildEncounterStartedObserver.observeWildEncounterStarted(encounter(71, 'implicit-finish/second'))

    expect(runtime.snapshotState()?.sections.map(({ mapSectionId, outcome }) => ({ mapSectionId, outcome })))
      .toEqual([
        { mapSectionId: 70, outcome: 'missed' },
        { mapSectionId: 71, outcome: 'started' },
      ])
  })

  it("restaure transactionnellement l'état et oublie toute rencontre transitoire", () => {
    const runtime = createNuzlockeRuntime({ enabled: true })
    runtime.wildEncounterStartedObserver.observeWildEncounterStarted(encounter(80, 'restore/transient'))
    const persisted = {
      format: nuzlockeStateFormat,
      version: 1,
      sections: [{
        mapSectionId: 81,
        instanceId: encounter(81, 'restore/persisted').instanceId,
        method: 'fishing',
        speciesId: 129,
        level: 10,
        outcome: 'missed',
      }],
    }

    runtime.restoreState(persisted)
    expect(runtime.snapshotState()).toEqual(persisted)
    expect(runtime.battleActionPolicy.vetoPlayerAction(normalCapture)?.code)
      .toBe('new-game-plus.nuzlocke.encounter-untracked')
    expect(() => runtime.restoreState({ ...persisted, version: 99 })).toThrow(/format Nuzlocke/)
    expect(runtime.snapshotState()).toEqual(persisted)
  })

  it("s'intègre à l'enveloppe de sauvegarde versionnée existante", () => {
    const registry = createVersionedSaveExtensionRegistry([nuzlockeSaveExtension])
    const source = createNuzlockeRuntime({ enabled: true })
    source.wildEncounterStartedObserver.observeWildEncounterStarted(encounter(90, 'save/source'))
    const saved = registry.save(source)
    const restored = createNuzlockeRuntime({ enabled: true })

    expect(saved).toEqual({
      [nuzlockeSaveExtensionKey]: { version: 1, value: source.snapshotState() },
    })
    expect(registry.validate(JSON.parse(JSON.stringify(saved)))).toBe(true)
    registry.load(restored, JSON.parse(JSON.stringify(saved)))
    expect(restored.snapshotState()).toEqual(source.snapshotState())

    const disabled = createNuzlockeRuntime({ enabled: false })
    expect(registry.save(disabled)).toEqual({})
  })
})
