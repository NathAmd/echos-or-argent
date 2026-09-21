import { describe, expect, it, vi } from 'vitest'
import type { PreparedFieldWildEncounter } from '../encounters/wildEncounterSelection'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { deriveLegacyPokemonInstanceId } from '../pokemon/pokemonInstanceId'
import type { VersionedSaveExtensions } from '../save/versionedSaveExtensions'
import { createFieldScriptState } from '../scripts/fieldScriptRunner'
import {
  assertNewGamePlusRuntimeExtensionsMatchProfile,
  createNewGamePlusGameplayRuntime,
  soloRunSaveExtensionKey,
  type AllPokemonAccessibleGameplayRuntime,
} from './newGamePlusGameplayRuntime'
import type { NewGamePlusProfileV1 } from './newGamePlusTypes'
import { nuzlockeModuleId } from './modules/nuzlockeModule'
import { nuzlockeSaveExtensionKey } from './modules/nuzlockeRule'
import { hardcoreModuleId } from './modules/hardcoreModule'
import { hardcoreSaveExtensionKey } from './modules/hardcoreRule'
import { permanentDeathModuleId } from './modules/permanentDeathModule'
import { permanentDeathSaveExtensionKey } from './modules/permanentDeathRule'
import { soloRunModuleId } from './modules/soloRunModule'
import {
  allPokemonAccessibleModuleId,
  allPokemonAccessibleSaveExtensionKey,
} from './modules/allPokemonAccessibleModule'
import { visibleWildPokemonModuleId } from './modules/visibleWildPokemonModule'
import {
  visibleWildPokemonSaveExtensionKey,
  type VisibleWildPokemonRuntime,
} from './modules/visibleWildPokemonRule'

function profile(modules: NewGamePlusProfileV1['modules']): NewGamePlusProfileV1 {
  return {
    format: 'pokemaster-hgss-new-game-plus',
    version: 1,
    source: { gameCode: 'IPKF', slot: 1, playerName: 'JO', leagueCompletedAt: '2026-08-24T12:00:00.000Z' },
    modules,
  }
}

describe('runtime de gameplay New Game+', () => {
  it('rejette un état NG+ injecté dans une partie normale', () => {
    expect(() => assertNewGamePlusRuntimeExtensionsMatchProfile(undefined, {
      [nuzlockeSaveExtensionKey]: { version: 1, value: { injected: true } },
    }, 'normal')).toThrow('n’est pas sélectionné')
  })

  it('sauvegarde puis restaure une première zone Nuzlocke consommée', () => {
    const selected = profile([{ id: nuzlockeModuleId, revision: 1, config: {} }])
    const runtime = createNewGamePlusGameplayRuntime(selected, {
      catalog: createPokemonTestCatalog(),
      activation: 'new',
    })
    runtime.ports.wildEncounterStartedObserver.observeWildEncounterStarted({
      kind: 'wild-encounter-started', mapId: 60, mapSectionId: 7, method: 'land',
      instanceId: deriveLegacyPokemonInstanceId('ng-plus-test', 'encounter-1'), speciesId: 152, level: 5,
    })
    runtime.ports.detailedBattleOutcomeObserver.observeBattleOutcome({ kind: 'battle-finished', outcome: 'flee' })
    const extensions = runtime.snapshotExtensions()
    expect(extensions?.[nuzlockeSaveExtensionKey]?.version).toBe(1)

    const restored = createNewGamePlusGameplayRuntime(selected, {
      catalog: createPokemonTestCatalog(),
      activation: 'resume',
      extensions,
    })
    restored.ports.wildEncounterStartedObserver.observeWildEncounterStarted({
      kind: 'wild-encounter-started', mapId: 61, mapSectionId: 7, method: 'safari',
      instanceId: deriveLegacyPokemonInstanceId('ng-plus-test', 'encounter-2'), speciesId: 155, level: 6,
    })
    expect(restored.ports.battleActionPolicy.vetoPlayerAction({ kind: 'safari', action: 'ball' }))
      .toMatchObject({ code: 'new-game-plus.nuzlocke.section-consumed' })
  })

  it('exige l’état des modules stateful lors d’une reprise', () => {
    expect(() => createNewGamePlusGameplayRuntime(profile([
      { id: soloRunModuleId, revision: 1, config: { speciesId: 152, form: 0 } },
    ]), { catalog: createPokemonTestCatalog(), activation: 'resume' })).toThrow('absent')
  })

  it('rejette une extension runtime inconnue et préserve les extensions étrangères', () => {
    const selected = profile([{ id: nuzlockeModuleId, revision: 1, config: {} }])
    expect(() => createNewGamePlusGameplayRuntime(selected, {
      catalog: createPokemonTestCatalog(), activation: 'new',
      extensions: { 'new-game-plus.future': { version: 1, value: null } },
    })).toThrow('inconnue')

    const foreign = { 'photo.album': { version: 1, value: { page: 2 } } } satisfies VersionedSaveExtensions
    const runtime = createNewGamePlusGameplayRuntime(selected, {
      catalog: createPokemonTestCatalog(), activation: 'new', extensions: foreign,
    })
    expect(runtime.snapshotExtensions()).toMatchObject(foreign)
  })

  it('rejette un état Solo lorsque le module correspondant est absent', () => {
    const extensions = {
      [soloRunSaveExtensionKey]: { version: 1, value: { version: 1, instanceId: null } },
    } satisfies VersionedSaveExtensions
    expect(() => createNewGamePlusGameplayRuntime(profile([]), {
      catalog: createPokemonTestCatalog(), activation: 'new', extensions,
    })).toThrow('n’est pas sélectionné')
  })

  it('compose Hardcore sans activer une autre règle et persiste sa progression', () => {
    const selected = profile([{ id: hardcoreModuleId, revision: 1, config: {
      levelCaps: [{ progression: 0, nextMajorBattle: 'Test majeur', levelCap: 12 }],
    } }])
    const runtime = createNewGamePlusGameplayRuntime(selected, {
      catalog: createPokemonTestCatalog(), activation: 'new', readProgression: () => 3,
    })

    expect(runtime.ports.pokemonLevelPolicy.resolveLevelCap({} as never)).toBe(12)
    expect(runtime.ports.battleActionPolicy.vetoPlayerAction({
      kind: 'bag', format: 'simple', itemId: 17, role: 'party-target',
    })).toMatchObject({ code: 'new-game-plus.hardcore.bag-forbidden' })
    expect(runtime.ports.battleActionPolicy.vetoPlayerAction({ kind: 'safari', action: 'ball' })).toBeUndefined()
    expect(runtime.snapshotExtensions()?.[hardcoreSaveExtensionKey]?.value).toMatchObject({ highestProgression: 3 })
  })

  it('restaure la mort définitive et bloque combat comme soins', () => {
    const selected = profile([{ id: permanentDeathModuleId, revision: 1, config: {} }])
    const instanceId = deriveLegacyPokemonInstanceId('ng-plus-test', 'permanent-death')
    const runtime = createNewGamePlusGameplayRuntime(selected, {
      catalog: createPokemonTestCatalog(), activation: 'new',
    })
    runtime.ports.detailedBattleOutcomeObserver.observeBattleOutcome({
      kind: 'pokemon-knocked-out', pokemon: { instanceId, side: 'player', partyIndex: 0 },
    })
    const extensions = runtime.snapshotExtensions()
    expect(extensions?.[permanentDeathSaveExtensionKey]?.value).toMatchObject({
      deadPokemonInstanceIds: [instanceId],
    })

    const restored = createNewGamePlusGameplayRuntime(selected, {
      catalog: createPokemonTestCatalog(), activation: 'resume', extensions,
    })
    const pokemon = { instanceId, speciesId: 152, isEgg: false, currentHp: 0 }
    expect(restored.ports.pokemonTeamPolicy.vetoBattleEligibility({
      format: 'simple', phase: 'forced-replacement', partyIndex: 0, pokemon,
    })).toMatchObject({ code: 'new-game-plus.permanent-death.battle-forbidden' })
    expect(restored.ports.pokemonPartyHealingPolicy.vetoFullHealRestoration({
      pokemon: pokemon as never, partyIndex: 0, restoration: 'hp', source: 'full-heal',
    })).toMatchObject({ code: 'new-game-plus.permanent-death.healing-forbidden' })
  })

  it('branche puis reprend l’état et les acteurs de quête Tous les Pokémon', () => {
    const catalog = createPokemonTestCatalog(493)
    const selected = profile([{
      id: allPokemonAccessibleModuleId,
      revision: 1,
      config: { seed: 'runtime-central-tous-les-pokemon' },
    }])
    const options = {
      catalog,
      allPokemonAccessible: {
        mapSources: [],
        encounterCatalog: [],
        knownAccessibleSpeciesIds: Array.from({ length: 492 }, (_, index) => index + 1),
        readStatistics: () => ({
          money: 999_999,
          battlesWon: 999,
          caughtSpeciesIds: Array.from({ length: 493 }, (_, index) => index + 1),
        }),
      },
      allPokemonQuestLocations: [{
        mapId: 700,
        mapSectionId: 210,
        tileX: 5,
        tileZ: 4,
        direction: 'north' as const,
      }],
    }
    const runtime = createNewGamePlusGameplayRuntime(selected, { ...options, activation: 'new' })
    const allPokemon = runtime.getModuleRuntime(allPokemonAccessibleModuleId) as AllPokemonAccessibleGameplayRuntime
    expect(allPokemon.plan.quests.map(({ speciesId }) => speciesId)).toEqual([493])
    const actor = allPokemon.questWorldCoordinator.listActors()[0]!
    expect(runtime.ports.worldSessionExtensionPorts.dynamicActors.getInteractableActorsAt(
      actor.mapId, actor.tileX, actor.tileZ,
    )).toEqual([actor])

    const instanceId = deriveLegacyPokemonInstanceId('ng-plus-runtime', 'all-pokemon-active')
    runtime.ports.wildEncounterStartedObserver.observeWildEncounterStarted({
      kind: 'wild-encounter-started',
      mapId: actor.mapId,
      mapSectionId: 210,
      method: 'scripted',
      instanceId,
      speciesId: actor.speciesId,
      level: actor.level,
    })
    expect(allPokemon.questWorldCoordinator.listActors()).toEqual([])
    const extensions = runtime.snapshotExtensions()
    expect(extensions?.[allPokemonAccessibleSaveExtensionKey]?.version).toBe(1)

    const restored = createNewGamePlusGameplayRuntime(selected, {
      ...options,
      activation: 'resume',
      extensions,
    })
    const restoredAllPokemon = restored.getModuleRuntime(allPokemonAccessibleModuleId) as AllPokemonAccessibleGameplayRuntime
    expect(restoredAllPokemon.questWorldCoordinator.listActors()).toEqual([])
    restored.ports.detailedBattleOutcomeObserver.observeBattleOutcome({ kind: 'battle-finished', outcome: 'flee' })
    expect(restoredAllPokemon.questWorldCoordinator.listActors()).toEqual([actor])
  })

  it('relaie la migration de terrain Rayquaza avant le commit d’une reprise', () => {
    const catalog = createPokemonTestCatalog(493)
    const selected = profile([{
      id: allPokemonAccessibleModuleId,
      revision: 1,
      config: { seed: 'runtime-central-rayquaza-v1' },
    }])
    const landmarks = [382, 384].map((speciesId) => ({
      speciesId,
      isRomLegendary: true as const,
      disappearanceFlagId: 0x200 + speciesId,
    }))
    const commonAllPokemonOptions = {
      mapSources: [],
      encounterCatalog: [],
      knownAccessibleSpeciesIds: [382],
      readStatistics: () => ({ money: 0, battlesWon: 0, caughtSpeciesIds: [] }),
    }
    const locations = Array.from({ length: 493 }, (_, index) => ({
      mapId: 700 + index,
      mapSectionId: 210 + index,
      tileX: 5,
      tileZ: 4,
      direction: 'north' as const,
    }))
    const legacy = createNewGamePlusGameplayRuntime(selected, {
      catalog,
      activation: 'new',
      allPokemonAccessible: commonAllPokemonOptions,
      allPokemonQuestLocations: locations,
    })
    const legacyExtensions = JSON.parse(JSON.stringify(legacy.snapshotExtensions())) as VersionedSaveExtensions
    const legacyState = legacyExtensions[allPokemonAccessibleSaveExtensionKey]!.value as unknown as {
      quests: Array<{ speciesId: number, status: string, encounterInstanceId: string | null }>
    }
    const rayquaza = legacyState.quests.find(({ speciesId }) => speciesId === 384)!
    rayquaza.status = 'captured'

    const restored = createNewGamePlusGameplayRuntime(selected, {
      catalog,
      activation: 'resume',
      extensions: legacyExtensions,
      allPokemonAccessible: {
        ...commonAllPokemonOptions,
        transitiveOneShotEvidence: { gameCode: 'IPKF', landmarks },
      },
      allPokemonQuestLocations: locations,
    })
    const field = createFieldScriptState('male', 'JO')
    restored.applyFieldStateMigrations(field)

    expect(field.flags.has(0x200 + 384)).toBe(true)
    expect(restored.snapshotExtensions()?.[allPokemonAccessibleSaveExtensionKey]?.value)
      .not.toMatchObject({ quests: expect.arrayContaining([expect.objectContaining({ speciesId: 384 })]) })
  })

  it('branche puis reprend acteurs actifs et rencontres retirées du monde visible', () => {
    const selected = profile([{
      id: visibleWildPokemonModuleId,
      revision: 1,
      config: { seed: 'runtime-central-visible', actorsPerMap: 1, includeSafari: true, movement: 'stationary' },
    }])
    const prepared: PreparedFieldWildEncounter = {
      rateRoll: { triggered: true, modifiedRate: 20, firstRoll: 0 },
      encounter: { bankId: 1, slotIndex: 0, method: 'land', time: 'day', speciesId: 25, level: 7 },
    }
    const preparation = {
      mapId: 7,
      spawnTiles: [{ tileX: 4, tileZ: 5 }],
      prepareEncounters: () => [{ encounterKey: 'runtime-central:land:0', prepared }],
    }
    const runtime = createNewGamePlusGameplayRuntime(selected, {
      catalog: createPokemonTestCatalog(493),
      activation: 'new',
    })
    const visible = runtime.getModuleRuntime(visibleWildPokemonModuleId) as VisibleWildPokemonRuntime
    const [actor] = visible.syncMap(preparation)
    expect(runtime.ports.worldSessionExtensionPorts.dynamicActors.getInteractableActorsAt(7, 4, 5)).toEqual([actor])
    const activeExtensions = runtime.snapshotExtensions()
    expect(activeExtensions?.[visibleWildPokemonSaveExtensionKey]?.version).toBe(1)

    const restored = createNewGamePlusGameplayRuntime(selected, {
      catalog: createPokemonTestCatalog(493),
      activation: 'resume',
      extensions: activeExtensions,
    })
    const restoredVisible = restored.getModuleRuntime(visibleWildPokemonModuleId) as VisibleWildPokemonRuntime
    const shouldNotPrepare = vi.fn(preparation.prepareEncounters)
    expect(restoredVisible.syncMap({ mapId: 7, spawnTiles: [], prepareEncounters: shouldNotPrepare })).toEqual([actor])
    expect(shouldNotPrepare).not.toHaveBeenCalled()
    expect(restored.ports.worldSessionExtensionPorts.dynamicActors.getBlockingActorsAt(7, 4, 5)).toEqual([actor])
    restoredVisible.commitEncounterStarted(actor!.id)

    const retiredExtensions = restored.snapshotExtensions()
    const retired = createNewGamePlusGameplayRuntime(selected, {
      catalog: createPokemonTestCatalog(493),
      activation: 'resume',
      extensions: retiredExtensions,
    })
    const retiredVisible = retired.getModuleRuntime(visibleWildPokemonModuleId) as VisibleWildPokemonRuntime
    expect(retiredVisible.syncMap(preparation)).toEqual([])
    expect(retired.ports.worldSessionExtensionPorts.dynamicActors.getInteractableActorsAt(7, 4, 5)).toEqual([])
  })

  it('fusionne les acteurs Tous les Pokémon et visibles dans un ordre stable pour les deux profils', () => {
    const catalog = createPokemonTestCatalog(493)
    const allPokemonSelection = {
      id: allPokemonAccessibleModuleId,
      revision: 1,
      config: { seed: 'runtime-central-monde-compose' },
    }
    const visibleSelection = {
      id: visibleWildPokemonModuleId,
      revision: 1,
      config: { seed: 'runtime-central-monde-compose', actorsPerMap: 1, includeSafari: true, movement: 'stationary' },
    }
    const options = {
      catalog,
      activation: 'new' as const,
      allPokemonAccessible: {
        mapSources: [],
        encounterCatalog: [],
        knownAccessibleSpeciesIds: Array.from({ length: 492 }, (_, index) => index + 1),
        readStatistics: () => ({
          money: 999_999,
          battlesWon: 999,
          caughtSpeciesIds: Array.from({ length: 493 }, (_, index) => index + 1),
        }),
      },
      allPokemonQuestLocations: [{
        mapId: 700,
        mapSectionId: 210,
        tileX: 5,
        tileZ: 4,
        direction: 'north' as const,
      }],
    }
    const prepared: PreparedFieldWildEncounter = {
      rateRoll: { triggered: true, modifiedRate: 20, firstRoll: 0 },
      encounter: { bankId: 1, slotIndex: 0, method: 'land', time: 'day', speciesId: 25, level: 7 },
    }
    const actorIds = [
      [allPokemonSelection, visibleSelection],
      [visibleSelection, allPokemonSelection],
    ].map((modules) => {
      const runtime = createNewGamePlusGameplayRuntime(profile(modules), options)
      const visible = runtime.getModuleRuntime(visibleWildPokemonModuleId) as VisibleWildPokemonRuntime
      visible.syncMap({
        mapId: 700,
        spawnTiles: [{ tileX: 5, tileZ: 4 }],
        prepareEncounters: () => [{ encounterKey: 'runtime-central:compose:0', prepared }],
      })
      return runtime.ports.worldSessionExtensionPorts.dynamicActors
        .getInteractableActorsAt(700, 5, 4)
        .map(({ id }) => id)
    })

    expect(actorIds[0]).toEqual(actorIds[1])
    expect(actorIds[0]).toHaveLength(2)
    expect(actorIds[0]?.[0]).toBe('ngp-all-pokemon-quest:493')
    expect(actorIds[0]?.[1]).toMatch(/^ngp-visible-wild:/)
  })
})
