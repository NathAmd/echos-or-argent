import { describe, expect, it, vi } from 'vitest'
import type { PokemonCatalog } from '../../../ndsTypes'
import type { HgssWildEncounterData } from '../../../rom/encounters/wildEncounterData'
import { deriveLegacyPokemonInstanceId } from '../../pokemon/pokemonInstanceId'
import { createPokemonTestCatalog } from '../../pokemon/pokemonTestCatalog'
import {
  createAllPokemonAccessibleRuntime,
  type AllPokemonAccessibleRuntime,
  type AllPokemonSaveStatistics,
} from './allPokemonAccessibleModule'
import {
  allPokemonQuestCaptureScopeSectionBase,
  allPokemonQuestCaptureScopeSectionMaximum,
  createAllPokemonQuestWorldCoordinator,
  resolveAllPokemonQuestCaptureScopeSectionId,
  type AllPokemonQuestWorldInteraction,
  type AllPokemonQuestWorldLocation,
} from './allPokemonQuestWorldCoordinator'

function catalog(): PokemonCatalog {
  return createPokemonTestCatalog(493)
}

function encounterBank(): HgssWildEncounterData {
  const land = Array.from({ length: 12 }, () => ({ speciesId: 1, level: 5 }))
  return {
    bankId: 0,
    rates: { walking: 20, surfing: 0, rockSmash: 0, oldRod: 0, goodRod: 0, superRod: 0 },
    land: { morning: land, day: land, night: land },
    hoennSoundSpecies: [0, 0],
    sinnohSoundSpecies: [0, 0],
    surfing: [],
    rockSmash: [],
    oldRod: [],
    goodRod: [],
    superRod: [],
    swarm: { landSpeciesId: 0, surfingSpeciesId: 0, nightFishingSpeciesId: 0, fishingSpeciesId: 0 },
  }
}

const unlockedStatistics: AllPokemonSaveStatistics = Object.freeze({
  money: 999_999,
  battlesWon: 999,
  caughtSpeciesIds: Object.freeze(Array.from({ length: 493 }, (_, index) => index + 1)),
})

const locations: readonly AllPokemonQuestWorldLocation[] = Object.freeze([
  Object.freeze({ mapId: 700, mapSectionId: 210, tileX: 9, tileZ: 4, direction: 'south' }),
  Object.freeze({ mapId: 700, mapSectionId: 210, tileX: 5, tileZ: 4, direction: 'north' }),
])

function createRuntime(
  statistics: () => AllPokemonSaveStatistics,
  state?: unknown,
): AllPokemonAccessibleRuntime {
  return createAllPokemonAccessibleRuntime({
    catalog: catalog(),
    mapSources: [{ mapId: 10, mapSectionId: 20, encounterBankId: 0 }],
    encounterCatalog: [encounterBank()],
    readStatistics: statistics,
    ...(state === undefined ? {} : { state }),
  })
}

function startedEvent(
  interaction: AllPokemonQuestWorldInteraction,
  instanceId: ReturnType<typeof deriveLegacyPokemonInstanceId>,
) {
  return {
    kind: 'wild-encounter-started' as const,
    mapId: interaction.mapId,
    mapSectionId: interaction.mapSectionId,
    method: 'scripted' as const,
    instanceId,
    speciesId: interaction.identity.speciesId,
    level: interaction.identity.level,
  }
}

describe('coordinateur monde des quêtes Tous les Pokémon', () => {
  it('expose des acteurs déterministes indépendamment de l’ordre des emplacements', () => {
    const first = createAllPokemonQuestWorldCoordinator(createRuntime(() => unlockedStatistics), locations)
    const second = createAllPokemonQuestWorldCoordinator(createRuntime(() => unlockedStatistics), [...locations].reverse())

    expect(first.listActors()).toEqual(second.listActors())
    expect(first.listActors()).toHaveLength(2)
    expect(first.listActors().every((actor) => (
      actor.kind === 'visible-wild'
      && actor.collision === 'blocking'
      && actor.interaction === 'action'
      && actor.id === `ngp-all-pokemon-quest:${actor.speciesId}`
    ))).toBe(true)
  })

  it('branche collision/action WorldSession et prépare exactement le combat sauvage scripté prévu', () => {
    const runtime = createRuntime(() => unlockedStatistics)
    const coordinator = createAllPokemonQuestWorldCoordinator(runtime, locations)
    const actor = coordinator.listActors()[0]!
    const interaction = coordinator.prepareInteraction(actor.id)!

    expect(coordinator.worldSessionExtensionPorts.dynamicActors.getBlockingActorsAt(
      actor.mapId, actor.tileX, actor.tileZ,
    )).toEqual([actor])
    expect(coordinator.worldSessionExtensionPorts.dynamicActors.getBlockingActorsAt(
      actor.mapId, actor.tileX, actor.tileZ, actor.id,
    )).toEqual([])
    expect(coordinator.worldSessionExtensionPorts.dynamicActors.getInteractableActorsAt(
      actor.mapId, actor.tileX, actor.tileZ,
    )).toEqual([actor])
    expect(interaction).toMatchObject({
      actorId: actor.id,
      mapId: actor.mapId,
      mapSectionId: 210,
      captureScopeSectionId: allPokemonQuestCaptureScopeSectionBase + actor.speciesId,
      source: 'scripted',
      encounterMethod: 'scripted',
      identity: { speciesId: actor.speciesId, form: 0, level: actor.level },
      battle: { kind: 'wild', speciesId: actor.speciesId, level: actor.level, battleParameter: 0 },
    })
    expect(coordinator.prepareInteraction('ngp-all-pokemon-quest:999')).toBeUndefined()
  })

  it('réserve une section de capture Nuzlocke unique et bornée à chaque quête', () => {
    const runtime = createRuntime(() => unlockedStatistics)
    const sectionIds = runtime.plan.quests.map(({ speciesId }) => (
      resolveAllPokemonQuestCaptureScopeSectionId(speciesId)
    ))

    expect(new Set(sectionIds).size).toBe(runtime.plan.quests.length)
    expect(sectionIds.every((sectionId) => (
      sectionId > allPokemonQuestCaptureScopeSectionBase
      && sectionId <= allPokemonQuestCaptureScopeSectionMaximum
    ))).toBe(true)
    expect(() => resolveAllPokemonQuestCaptureScopeSectionId(0)).toThrow(/espèce/)
    expect(() => resolveAllPokemonQuestCaptureScopeSectionId(0x1000)).toThrow(/espèce/)
  })

  it('ne consomme pas un acteur si le moteur refuse et le masque seulement après le vrai démarrage', () => {
    const runtime = createRuntime(() => unlockedStatistics)
    const coordinator = createAllPokemonQuestWorldCoordinator(runtime, [locations[0]!])
    const actor = coordinator.listActors()[0]!
    const rejected = vi.fn(() => false)

    expect(coordinator.startInteraction(actor.id, rejected)).toBeUndefined()
    expect(rejected).toHaveBeenCalledOnce()
    expect(coordinator.getInteraction(actor.id)).toBeDefined()

    const instanceId = deriveLegacyPokemonInstanceId('all-pokemon-world', 'started')
    const accepted = coordinator.startInteraction(actor.id, (interaction) => {
      runtime.wildEncounterStartedObserver.observeWildEncounterStarted(startedEvent(interaction, instanceId))
      return true
    })
    expect(accepted?.actorId).toBe(actor.id)
    expect(coordinator.listActors()).toEqual([])

    runtime.detailedBattleOutcomeObserver.observeBattleOutcome({ kind: 'battle-finished', outcome: 'flee' })
    expect(coordinator.listActors()[0]).toEqual(actor)
  })

  it('restaure un combat actif, puis retire définitivement le légendaire après son KO', () => {
    const source = createRuntime(() => unlockedStatistics)
    const sourceCoordinator = createAllPokemonQuestWorldCoordinator(source, [locations[0]!])
    const interaction = sourceCoordinator.prepareInteraction(sourceCoordinator.listActors()[0]!.id)!
    const instanceId = deriveLegacyPokemonInstanceId('all-pokemon-world', 'resume-ko')
    source.wildEncounterStartedObserver.observeWildEncounterStarted(startedEvent(interaction, instanceId))
    const saved = JSON.parse(JSON.stringify(source.snapshotState()))

    const restored = createRuntime(() => unlockedStatistics, saved)
    const restoredCoordinator = createAllPokemonQuestWorldCoordinator(restored, [locations[0]!])
    expect(restoredCoordinator.listActors()).toEqual([])
    restored.detailedBattleOutcomeObserver.observeBattleOutcome({
      kind: 'pokemon-knocked-out',
      pokemon: { instanceId, side: 'opponent', partyIndex: 0 },
    })

    const terminal = restored.listQuests().find(({ speciesId }) => speciesId === interaction.identity.speciesId)
    expect(terminal).toMatchObject({ status: 'defeated', encounterInstanceId: null })
    expect(restoredCoordinator.listActors()[0]?.speciesId).not.toBe(interaction.identity.speciesId)
    const reloaded = createRuntime(() => unlockedStatistics, JSON.parse(JSON.stringify(restored.snapshotState())))
    expect(reloaded.prepareQuestEncounter(interaction.identity.speciesId)).toBeUndefined()
  })

  it('retire une capture mais remet la même quête après une fuite', () => {
    const runtime = createRuntime(() => unlockedStatistics)
    const coordinator = createAllPokemonQuestWorldCoordinator(runtime, [locations[0]!])
    const first = coordinator.prepareInteraction(coordinator.listActors()[0]!.id)!
    const firstId = deriveLegacyPokemonInstanceId('all-pokemon-world', 'flee')
    runtime.wildEncounterStartedObserver.observeWildEncounterStarted(startedEvent(first, firstId))
    runtime.detailedBattleOutcomeObserver.observeBattleOutcome({ kind: 'battle-finished', outcome: 'flee' })
    expect(coordinator.prepareInteraction(first.actorId)).toEqual(first)

    const capturedId = deriveLegacyPokemonInstanceId('all-pokemon-world', 'capture')
    runtime.wildEncounterStartedObserver.observeWildEncounterStarted(startedEvent(first, capturedId))
    runtime.detailedBattleOutcomeObserver.observeBattleOutcome({
      kind: 'battle-finished',
      outcome: 'capture',
      capturedPokemon: { instanceId: capturedId, side: 'opponent', partyIndex: 0 },
    })
    expect(runtime.listQuests().find(({ speciesId }) => speciesId === first.identity.speciesId)?.status)
      .toBe('captured')
    expect(coordinator.listActors()[0]?.speciesId).not.toBe(first.identity.speciesId)
  })

  it('laisse jouer une rencontre native d’une quête verrouillée sans exception', () => {
    const lockedStatistics: AllPokemonSaveStatistics = { money: 0, battlesWon: 0, caughtSpeciesIds: [] }
    const runtime = createRuntime(() => lockedStatistics)
    const quest = runtime.plan.quests[0]!
    const instanceId = deriveLegacyPokemonInstanceId('all-pokemon-world', 'native-locked')
    const event = {
      kind: 'wild-encounter-started' as const,
      mapId: 42,
      mapSectionId: 7,
      method: 'scripted' as const,
      instanceId,
      speciesId: quest.speciesId,
      level: quest.level,
    }

    expect(() => runtime.wildEncounterStartedObserver.observeWildEncounterStarted(event)).not.toThrow()
    expect(runtime.listQuests().find(({ speciesId }) => speciesId === quest.speciesId))
      .toMatchObject({ status: 'available', encounterInstanceId: instanceId })
    runtime.detailedBattleOutcomeObserver.observeBattleOutcome({ kind: 'battle-finished', outcome: 'flee' })
    expect(runtime.canStartQuestEncounter(quest.speciesId)).toBe(true)

    runtime.wildEncounterStartedObserver.observeWildEncounterStarted(event)
    runtime.detailedBattleOutcomeObserver.observeBattleOutcome({
      kind: 'pokemon-knocked-out', pokemon: { instanceId, side: 'opponent', partyIndex: 0 },
    })
    expect(() => runtime.wildEncounterStartedObserver.observeWildEncounterStarted(event)).not.toThrow()
  })

  it('rejette des emplacements ambigus avant d’exposer le moindre acteur', () => {
    const runtime = createRuntime(() => unlockedStatistics)
    expect(() => createAllPokemonQuestWorldCoordinator(runtime, [])).toThrow('emplacements')
    expect(() => createAllPokemonQuestWorldCoordinator(runtime, [locations[0]!, locations[0]!])).toThrow('dupliquée')
    expect(() => createAllPokemonQuestWorldCoordinator(runtime, [
      locations[0]!, { ...locations[1]!, mapSectionId: 211 },
    ])).toThrow('plusieurs sections')
  })
})
