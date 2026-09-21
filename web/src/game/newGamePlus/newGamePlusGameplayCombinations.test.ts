import { describe, expect, it } from 'vitest'
import type { PokemonCatalog } from '../../ndsTypes'
import type { HgssWildEncounterData } from '../../rom/encounters/wildEncounterData'
import type { PreparedFieldWildEncounter } from '../encounters/wildEncounterSelection'
import { resolvePokemonInitialTeam } from '../pokemon/pokemonInitialTeamResolver'
import { deriveLegacyPokemonInstanceId } from '../pokemon/pokemonInstanceId'
import {
  getPokemonBattleEligiblePartySlots,
  resolvePokemonPartyMutationDecision,
  type PokemonTeamMember,
} from '../pokemon/pokemonTeamPolicy'
import type { VersionedSaveExtensions } from '../save/versionedSaveExtensions'
import {
  createNewGamePlusGameplayRuntime,
  eeveeTeamSaveExtensionKey,
  monotypeSaveExtensionKey,
  soloRunSaveExtensionKey,
} from './newGamePlusGameplayRuntime'
import type { NewGamePlusModuleSelection, NewGamePlusProfileV1 } from './newGamePlusTypes'
import {
  defaultEeveeTeamConfig,
  eeveeSpeciesId,
  eeveeTeamModuleId,
} from './modules/eeveeTeamModule'
import { allBattlesInDuoModuleId } from './modules/allBattlesInDuoModule'
import { allPokemonAccessibleModuleId } from './modules/allPokemonAccessibleModule'
import type { AllPokemonQuestWorldCoordinator } from './modules/allPokemonQuestWorldCoordinator'
import { hardcoreModuleId } from './modules/hardcoreModule'
import { hardcoreSaveExtensionKey } from './modules/hardcoreRule'
import { monotypeModuleId } from './modules/monotypeModule'
import { nuzlockeModuleId } from './modules/nuzlockeModule'
import { nuzlockeSaveExtensionKey } from './modules/nuzlockeRule'
import { permanentDeathModuleId } from './modules/permanentDeathModule'
import { permanentDeathSaveExtensionKey } from './modules/permanentDeathRule'
import { randomizerModuleId } from './modules/randomizerModule'
import { soloRunModuleId } from './modules/soloRunModule'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'

const pokemonId = (value: number): string => `pkm:v1:r:${value.toString(16).padStart(32, '0')}`

function profile(modules: readonly NewGamePlusModuleSelection[]): NewGamePlusProfileV1 {
  return {
    format: 'pokemaster-hgss-new-game-plus',
    version: 1,
    source: {
      gameCode: 'IPKF',
      slot: 1,
      playerName: 'JO',
      leagueCompletedAt: '2026-08-24T12:00:00.000Z',
    },
    modules,
  }
}

function member(value: number, speciesId: number, currentHp = 20): PokemonTeamMember {
  return Object.freeze({
    instanceId: pokemonId(value),
    speciesId,
    isEgg: false,
    currentHp,
  })
}

function createTypedCatalog(): PokemonCatalog {
  const catalog = createPokemonTestCatalog(493)
  for (const speciesId of [25, 45, 152, 180]) {
    catalog.personalData[speciesId] = { ...catalog.personalData[speciesId]!, types: [12, 2] }
  }
  for (const [speciesId, typeId] of [
    [134, 11], [135, 13], [136, 10], [196, 14], [197, 17], [470, 12], [471, 15],
  ] as const) {
    catalog.personalData[speciesId] = { ...catalog.personalData[speciesId]!, types: [typeId, typeId] }
  }
  return catalog
}

function permutations<T>(values: readonly T[]): readonly (readonly T[])[] {
  if (values.length < 2) return [values]
  return values.flatMap((value, index) => permutations([
    ...values.slice(0, index),
    ...values.slice(index + 1),
  ]).map((tail) => [value, ...tail]))
}

function allPokemonEncounterBank(): HgssWildEncounterData {
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

const randomizerSelection = Object.freeze({
  id: randomizerModuleId,
  revision: 1,
  config: Object.freeze({ seed: 'combinaisons-ng-plus' }),
})
const monotypeSelection = Object.freeze({
  id: monotypeModuleId,
  revision: 1,
  config: Object.freeze({ typeId: 12 }),
})

describe('combinaisons du runtime de gameplay New Game+', () => {
  it('compose Randomizer et Monotype dans les deux ordres avec le même starter autorisé après reprise', () => {
    const catalog = createTypedCatalog()
    const request = {
      choice: 1,
      baseDefinition: { speciesId: 155, level: 5, form: 0 },
    }
    const teams = [
      [randomizerSelection, monotypeSelection],
      [monotypeSelection, randomizerSelection],
    ].map((modules) => {
      const selected = profile(modules)
      const runtime = createNewGamePlusGameplayRuntime(selected, { catalog, activation: 'new' })
      const team = resolvePokemonInitialTeam(request, runtime.ports.pokemonInitialTeamResolver)
      const pokemon = member(1, team[0]!.speciesId)

      expect(catalog.personalData[pokemon.speciesId]?.types).toContain(12)
      expect(getPokemonBattleEligiblePartySlots([pokemon], {
        format: 'simple', phase: 'initial',
      }, runtime.ports.pokemonTeamPolicy)).toEqual([0])
      expect(runtime.snapshotExtensions()?.[monotypeSaveExtensionKey]?.value).toEqual({
        version: 1,
        typeId: 12,
      })

      const restored = createNewGamePlusGameplayRuntime(selected, {
        catalog,
        activation: 'resume',
        extensions: runtime.snapshotExtensions(),
      })
      expect(resolvePokemonInitialTeam(request, restored.ports.pokemonInitialTeamResolver)).toEqual(team)
      return team
    })

    expect(teams[0]).toEqual(teams[1])
  })

  it('laisse toujours Solo Run propriétaire du starter, même si son choix ressemble au starter natif', () => {
    const catalog = createTypedCatalog()
    const soloSelection = Object.freeze({
      id: soloRunModuleId,
      revision: 1,
      config: Object.freeze({ speciesId: 152, form: 0 }),
    })
    const request = {
      choice: 0,
      baseDefinition: { speciesId: 152, level: 5, form: 0 },
    }

    for (const modules of [
      [randomizerSelection, soloSelection],
      [soloSelection, randomizerSelection],
    ]) {
      const runtime = createNewGamePlusGameplayRuntime(profile(modules), { catalog, activation: 'new' })
      expect(resolvePokemonInitialTeam(request, runtime.ports.pokemonInitialTeamResolver)).toEqual([
        { speciesId: 152, level: 5, form: 0 },
      ])
    }
  })

  it('randomise avant de dupliquer le starter, quel que soit l’ordre Randomizer/duo du profil', () => {
    const catalog = createTypedCatalog()
    const duoSelection = Object.freeze({
      id: allBattlesInDuoModuleId,
      revision: 1,
      config: Object.freeze({}),
    })
    const request = {
      choice: 2,
      baseDefinition: { speciesId: 158, level: 5, form: 0 },
    }
    const teams = [
      [randomizerSelection, duoSelection],
      [duoSelection, randomizerSelection],
    ].map((modules) => {
      const runtime = createNewGamePlusGameplayRuntime(profile(modules), { catalog, activation: 'new' })
      return resolvePokemonInitialTeam(request, runtime.ports.pokemonInitialTeamResolver)
    })

    expect(teams[0]).toEqual(teams[1])
    expect(teams[0]).toHaveLength(2)
    expect(teams[0]![0]).toEqual(teams[0]![1])
    expect(teams[0]![0]?.speciesId).not.toBe(request.baseDefinition.speciesId)
  })

  it('compose Randomizer, duo et Monotype de façon identique dans leurs six permutations', () => {
    const catalog = createTypedCatalog()
    const duoSelection = Object.freeze({ id: allBattlesInDuoModuleId, revision: 1, config: Object.freeze({}) })
    const request = { choice: 1, baseDefinition: { speciesId: 155, level: 5, form: 0 } }
    const results = permutations([randomizerSelection, duoSelection, monotypeSelection]).map((modules) => {
      const runtime = createNewGamePlusGameplayRuntime(profile(modules), { catalog, activation: 'new' })
      return Object.freeze({
        team: resolvePokemonInitialTeam(request, runtime.ports.pokemonInitialTeamResolver),
        format: runtime.ports.fieldBattleFormatResolver({ kind: 'wild' }),
      })
    })

    expect(results.every((result) => JSON.stringify(result) === JSON.stringify(results[0]))).toBe(true)
    expect(results[0]?.team).toHaveLength(2)
    expect(results[0]?.team[0]).toEqual(results[0]?.team[1])
    expect(catalog.personalData[results[0]!.team[0]!.speciesId]?.types).toContain(12)
    expect(results[0]?.format).toEqual({ engine: 'double', sessionKind: 'double' })
  })

  it('laisse les challenges explicites propriétaires de l’équipe dans toutes les permutations compatibles', () => {
    const catalog = createTypedCatalog()
    const soloSelection = Object.freeze({
      id: soloRunModuleId,
      revision: 1,
      config: Object.freeze({ speciesId: 152, form: 0 }),
    })
    const duoSelection = Object.freeze({ id: allBattlesInDuoModuleId, revision: 1, config: Object.freeze({}) })
    const eeveeSelection = Object.freeze({
      id: eeveeTeamModuleId,
      revision: 1,
      config: Object.freeze({
        assignments: defaultEeveeTeamConfig.assignments.map((assignment) => ({ ...assignment })),
      }),
    })
    const request = { choice: 2, baseDefinition: { speciesId: 158, level: 5, form: 0 } }
    const soloResults = permutations([randomizerSelection, duoSelection, monotypeSelection, soloSelection]).map((modules) => {
      const runtime = createNewGamePlusGameplayRuntime(profile(modules), { catalog, activation: 'new' })
      return {
        team: resolvePokemonInitialTeam(request, runtime.ports.pokemonInitialTeamResolver),
        format: runtime.ports.fieldBattleFormatResolver({ kind: 'wild' }),
      }
    })
    const eeveeTeams = permutations([randomizerSelection, duoSelection, eeveeSelection]).map((modules) => (
      resolvePokemonInitialTeam(
        request,
        createNewGamePlusGameplayRuntime(profile(modules), { catalog, activation: 'new' })
          .ports.pokemonInitialTeamResolver,
      )
    ))

    expect(soloResults.every((result) => JSON.stringify(result) === JSON.stringify(soloResults[0]))).toBe(true)
    expect(soloResults[0]).toEqual({
      team: [{ speciesId: 152, level: 5, form: 0 }],
      format: { engine: 'double', sessionKind: 'double' },
    })
    expect(eeveeTeams.every((team) => JSON.stringify(team) === JSON.stringify(eeveeTeams[0]))).toBe(true)
    expect(eeveeTeams[0]).toEqual(Array.from({ length: 6 }, () => ({ speciesId: 133, level: 5, form: 0 })))
  })

  it('rejette immédiatement un Solo Run qui ne possède pas le type Monotype choisi', () => {
    const catalog = createTypedCatalog()
    expect(() => createNewGamePlusGameplayRuntime(profile([
      monotypeSelection,
      { id: soloRunModuleId, revision: 1, config: { speciesId: 155, form: 0 } },
    ]), { catalog, activation: 'new' })).toThrow(/Solo Run 155.*type Monotype 12/)
  })

  it('applique Tous les Pokémon après Randomizer dans les deux ordres du profil', () => {
    const catalog = createTypedCatalog()
    const missingSpeciesId = 23
    const allPokemonSelection = Object.freeze({
      id: allPokemonAccessibleModuleId,
      revision: 1,
      config: Object.freeze({ seed: 'combinaisons-tous-les-pokemon' }),
    })
    const runtimeOptions = {
      catalog,
      activation: 'new' as const,
      allPokemonAccessible: {
        mapSources: [{ mapId: 100, mapSectionId: 20, encounterBankId: 0 }],
        encounterCatalog: [allPokemonEncounterBank()],
        knownAccessibleSpeciesIds: Array.from({ length: 493 }, (_, index) => index + 1)
          .filter((speciesId) => speciesId !== missingSpeciesId),
        readStatistics: () => ({ money: 0, battlesWon: 0, caughtSpeciesIds: [] }),
      },
      allPokemonQuestLocations: [{ mapId: 700, mapSectionId: 210, tileX: 5, tileZ: 4, direction: 'north' as const }],
    }
    const species = [
      [randomizerSelection, allPokemonSelection],
      [allPokemonSelection, randomizerSelection],
    ].map((modules) => {
      const runtime = createNewGamePlusGameplayRuntime(profile(modules), runtimeOptions)
      const allPokemon = runtime.getModuleRuntime(allPokemonAccessibleModuleId) as {
        plan: { ordinaryPlacements: readonly Readonly<{
          speciesId: number
          mapId: number
          encounterBankId: number
          slotIndex: number
          variant: string
          replacedSpeciesId: number
          minimumLevel: number
        }>[] }
      }
      const placement = allPokemon.plan.ordinaryPlacements.find(({ speciesId }) => speciesId === missingSpeciesId)!
      const prepared: PreparedFieldWildEncounter = {
        rateRoll: { triggered: true, modifiedRate: 20, firstRoll: 0 },
        encounter: {
          bankId: placement.encounterBankId,
          slotIndex: placement.slotIndex,
          method: 'land',
          time: placement.variant as 'morning' | 'day' | 'night',
          speciesId: placement.replacedSpeciesId,
          level: placement.minimumLevel,
        },
      }
      return runtime.ports.fieldWildEncounterIdentityPort(prepared, {
        mapId: placement.mapId,
        source: 'step',
      }).encounter.speciesId
    })

    expect(species).toEqual([missingSpeciesId, missingSpeciesId])
  })

  it('garantit encore les 493 espèces quand Randomizer remplace aussi les espèces natives', () => {
    const catalog = createTypedCatalog()
    const allPokemonSelection = Object.freeze({
      id: allPokemonAccessibleModuleId,
      revision: 1,
      config: Object.freeze({ seed: 'couverture-composee-493' }),
    })
    const runtimeOptions = {
      catalog,
      activation: 'new' as const,
      allPokemonAccessible: {
        mapSources: Array.from({ length: 14 }, (_, index) => ({
          mapId: 100 + index,
          mapSectionId: 20 + index,
          encounterBankId: 0,
        })),
        encounterCatalog: [allPokemonEncounterBank()],
        readStatistics: () => ({ money: 0, battlesWon: 0, caughtSpeciesIds: [] }),
      },
      allPokemonQuestLocations: [{ mapId: 700, mapSectionId: 210, tileX: 5, tileZ: 4, direction: 'north' as const }],
    }

    for (const modules of [
      [randomizerSelection, allPokemonSelection],
      [allPokemonSelection, randomizerSelection],
    ]) {
      const runtime = createNewGamePlusGameplayRuntime(profile(modules), runtimeOptions)
      const allPokemon = runtime.getModuleRuntime(allPokemonAccessibleModuleId) as {
        plan: {
          ordinaryPlacements: readonly Readonly<{
            speciesId: number
            mapId: number
            encounterBankId: number
            slotIndex: number
            variant: 'morning' | 'day' | 'night'
            replacedSpeciesId: number
            minimumLevel: number
            method: 'land'
          }>[]
          quests: readonly Readonly<{ speciesId: number }>[]
        }
      }
      const finalSpeciesIds = new Set(allPokemon.plan.quests.map(({ speciesId }) => speciesId))
      for (const placement of allPokemon.plan.ordinaryPlacements) {
        const prepared: PreparedFieldWildEncounter = {
          rateRoll: { triggered: true, modifiedRate: 20, firstRoll: 0 },
          encounter: {
            bankId: placement.encounterBankId,
            slotIndex: placement.slotIndex,
            method: placement.method,
            time: placement.variant,
            speciesId: placement.replacedSpeciesId,
            level: placement.minimumLevel,
          },
        }
        finalSpeciesIds.add(runtime.ports.fieldWildEncounterIdentityPort(prepared, {
          mapId: placement.mapId,
          source: 'step',
        }).encounter.speciesId)
      }

      expect([...finalSpeciesIds].sort((left, right) => left - right))
        .toEqual(Array.from({ length: 493 }, (_, index) => index + 1))
    }
  })

  it('donne à chaque quête Tous-les-Pokémon une capture Nuzlocke+Hardcore distincte de la route physique', () => {
    const catalog = createTypedCatalog()
    const questSpecies = new Set([144, 145])
    const runtime = createNewGamePlusGameplayRuntime(profile([
      { id: nuzlockeModuleId, revision: 1, config: {} },
      { id: hardcoreModuleId, revision: 1, config: {
        levelCaps: [{ progression: 0, nextMajorBattle: 'Ligue', levelCap: 100 }],
      } },
      { id: allPokemonAccessibleModuleId, revision: 1, config: { seed: 'nuzlocke-quest-scopes' } },
    ]), {
      catalog,
      activation: 'new',
      readProgression: () => 0,
      allPokemonAccessible: {
        mapSources: [{ mapId: 100, mapSectionId: 20, encounterBankId: 0 }],
        encounterCatalog: [allPokemonEncounterBank()],
        knownAccessibleSpeciesIds: Array.from({ length: 493 }, (_, index) => index + 1)
          .filter((speciesId) => !questSpecies.has(speciesId)),
        readStatistics: () => ({
          money: 1_000_000,
          battlesWon: 1_000,
          caughtSpeciesIds: Array.from({ length: 493 }, (_, index) => index + 1),
        }),
      },
      allPokemonQuestLocations: [{ mapId: 100, mapSectionId: 20, tileX: 5, tileZ: 4, direction: 'north' }],
    })
    const observer = runtime.ports.wildEncounterStartedObserver
    const outcomes = runtime.ports.detailedBattleOutcomeObserver
    const physicalId = deriveLegacyPokemonInstanceId('nuzlocke-quests', 'physical-route-encounter')
    observer.observeWildEncounterStarted({
      kind: 'wild-encounter-started', mapId: 100, mapSectionId: 20, method: 'land',
      instanceId: physicalId, speciesId: 1, level: 5,
    })
    outcomes.observeBattleOutcome({ kind: 'battle-finished', outcome: 'flee' })

    const allPokemon = runtime.getModuleRuntime(allPokemonAccessibleModuleId) as {
      questWorldCoordinator: AllPokemonQuestWorldCoordinator
    }
    const observedScopes = new Set<number>()
    for (let questIndex = 0; questIndex < 2; questIndex += 1) {
      const actor = allPokemon.questWorldCoordinator.listActors()[0]!
      const interaction = allPokemon.questWorldCoordinator.getInteraction(actor.id)!
      const instanceId = deriveLegacyPokemonInstanceId('nuzlocke-quests', `quest-${questIndex}`)
      expect(interaction.mapSectionId).toBe(20)
      expect(interaction.captureScopeSectionId).not.toBe(20)
      expect(observedScopes.has(interaction.captureScopeSectionId)).toBe(false)
      observedScopes.add(interaction.captureScopeSectionId)
      observer.observeWildEncounterStarted({
        kind: 'wild-encounter-started', mapId: interaction.mapId,
        mapSectionId: interaction.captureScopeSectionId, method: interaction.encounterMethod,
        instanceId, speciesId: interaction.identity.speciesId, level: interaction.identity.level,
      })
      expect(runtime.ports.battleActionPolicy.vetoPlayerAction({
        kind: 'bag', format: 'simple', itemId: 4, role: 'capture',
      })).toBeUndefined()
      outcomes.observeBattleOutcome({
        kind: 'battle-finished', outcome: 'capture',
        capturedPokemon: { instanceId, side: 'opponent', partyIndex: 0 },
      })
    }
    expect(observedScopes.size).toBe(2)
  })

  it('reprend ensemble Nuzlocke, Hardcore, mort permanente, Randomizer et Monotype', () => {
    const catalog = createTypedCatalog()
    let progression = 2
    const selected = profile([
      { id: nuzlockeModuleId, revision: 1, config: {} },
      { id: hardcoreModuleId, revision: 1, config: {
        levelCaps: [
          { progression: 0, nextMajorBattle: 'Premier test', levelCap: 10 },
          { progression: 3, nextMajorBattle: 'Second test', levelCap: 20 },
        ],
      } },
      { id: permanentDeathModuleId, revision: 1, config: {} },
      randomizerSelection,
      monotypeSelection,
    ])
    const runtime = createNewGamePlusGameplayRuntime(selected, {
      catalog,
      activation: 'new',
      readProgression: () => progression,
    })
    const starterDefinition = resolvePokemonInitialTeam({
      choice: 2,
      baseDefinition: { speciesId: 158, level: 5, form: 0 },
    }, runtime.ports.pokemonInitialTeamResolver)[0]!
    const starter = member(10, starterDefinition.speciesId)
    const wildInstanceId = deriveLegacyPokemonInstanceId('ng-plus-combination', 'safari-first')

    runtime.ports.wildEncounterStartedObserver.observeWildEncounterStarted({
      kind: 'wild-encounter-started',
      mapId: 357,
      mapSectionId: 44,
      method: 'safari',
      instanceId: wildInstanceId,
      speciesId: 45,
      level: 17,
    })
    expect(runtime.ports.battleActionPolicy.vetoPlayerAction({ kind: 'safari', action: 'ball' })).toBeUndefined()
    runtime.ports.detailedBattleOutcomeObserver.observeBattleOutcome({
      kind: 'pokemon-knocked-out',
      pokemon: { instanceId: starter.instanceId as never, side: 'player', partyIndex: 0 },
    })
    runtime.ports.detailedBattleOutcomeObserver.observeBattleOutcome({ kind: 'battle-finished', outcome: 'flee' })
    progression = 4
    expect(runtime.ports.pokemonLevelPolicy.resolveLevelCap({} as never)).toBe(20)

    const foreign = {
      'photo.album': { version: 1, value: { page: 2 } },
    } satisfies VersionedSaveExtensions
    const extensions = runtime.snapshotExtensions(foreign)!
    expect(Object.keys(extensions).sort()).toEqual([
      hardcoreSaveExtensionKey,
      monotypeSaveExtensionKey,
      nuzlockeSaveExtensionKey,
      permanentDeathSaveExtensionKey,
      'photo.album',
    ].sort())

    const restored = createNewGamePlusGameplayRuntime(selected, {
      catalog,
      activation: 'resume',
      extensions,
      readProgression: () => 1,
    })
    restored.ports.wildEncounterStartedObserver.observeWildEncounterStarted({
      kind: 'wild-encounter-started',
      mapId: 358,
      mapSectionId: 44,
      method: 'safari',
      instanceId: deriveLegacyPokemonInstanceId('ng-plus-combination', 'safari-second'),
      speciesId: 152,
      level: 18,
    })

    expect(restored.ports.battleActionPolicy.vetoPlayerAction({ kind: 'safari', action: 'ball' }))
      .toMatchObject({ code: 'new-game-plus.nuzlocke.section-consumed' })
    expect(restored.ports.pokemonLevelPolicy.resolveLevelCap({} as never)).toBe(20)
    expect(restored.ports.pokemonTeamPolicy.vetoBattleEligibility({
      format: 'simple', phase: 'forced-replacement', partyIndex: 0, pokemon: starter,
    })).toMatchObject({ code: 'new-game-plus.permanent-death.battle-forbidden' })
    expect(restored.ports.pokemonPartyHealingPolicy.vetoFullHealRestoration({
      pokemon: starter as never,
      partyIndex: 0,
      restoration: 'hp',
      source: 'full-heal',
    })).toMatchObject({ code: 'new-game-plus.permanent-death.healing-forbidden' })
    expect(restored.snapshotExtensions()?.['photo.album']).toEqual(foreign['photo.album'])
  })

  it.each([
    ['mort puis Évoli', [permanentDeathModuleId, eeveeTeamModuleId]],
    ['Évoli puis mort', [eeveeTeamModuleId, permanentDeathModuleId]],
  ])('la combinaison %s continue à cinq sans permettre de remplacer le membre mort', (_label, moduleIds) => {
    const catalog = createTypedCatalog()
    const selectionById: Readonly<Record<string, NewGamePlusModuleSelection>> = {
      [permanentDeathModuleId]: { id: permanentDeathModuleId, revision: 1, config: {} },
      [eeveeTeamModuleId]: {
        id: eeveeTeamModuleId,
        revision: 1,
        config: { assignments: defaultEeveeTeamConfig.assignments.map((assignment) => ({ ...assignment })) },
      },
    }
    const selected = profile(moduleIds.map((moduleId) => selectionById[moduleId]!))
    const runtime = createNewGamePlusGameplayRuntime(selected, { catalog, activation: 'new' })
    const definitions = resolvePokemonInitialTeam({
      choice: 0,
      baseDefinition: { speciesId: 152, level: 5, form: 0 },
    }, runtime.ports.pokemonInitialTeamResolver)
    const party = definitions.map((definition, index) => member(index + 20, definition.speciesId))
    expect(resolvePokemonPartyMutationDecision(
      'starter', [], party, runtime.ports.pokemonTeamPolicy,
    )).toEqual({ kind: 'allowed' })
    runtime.ports.pokemonInitialTeamResolver.onInitialTeamCommitted?.(party)
    runtime.ports.detailedBattleOutcomeObserver.observeBattleOutcome({
      kind: 'pokemon-knocked-out',
      pokemon: { instanceId: party[0]!.instanceId as never, side: 'player', partyIndex: 0 },
    })

    expect(resolvePokemonPartyMutationDecision(
      'pc', party, party.slice(1), runtime.ports.pokemonTeamPolicy,
    )).toEqual({ kind: 'allowed' })
    expect(resolvePokemonPartyMutationDecision(
      'gift', party.slice(1), [...party.slice(1), member(99, eeveeSpeciesId)], runtime.ports.pokemonTeamPolicy,
    )).toMatchObject({ kind: 'blocked' })

    const extensions = runtime.snapshotExtensions()!
    expect(extensions[eeveeTeamSaveExtensionKey]).toBeDefined()
    expect(extensions[permanentDeathSaveExtensionKey]).toBeDefined()
    const restored = createNewGamePlusGameplayRuntime(selected, { catalog, activation: 'resume', extensions })
    expect(resolvePokemonPartyMutationDecision(
      'pc', party, party.slice(1), restored.ports.pokemonTeamPolicy,
    )).toEqual({ kind: 'allowed' })
    expect(restored.ports.pokemonTeamPolicy.vetoBattleEligibility({
      format: 'simple', phase: 'initial', partyIndex: 0, pokemon: party[0]!,
    })).toMatchObject({ code: 'new-game-plus.permanent-death.battle-forbidden' })
  })

  it('cumule mort permanente et Solo Run sans autoriser un remplaçant après le KO', () => {
    const catalog = createTypedCatalog()
    const selected = profile([
      { id: permanentDeathModuleId, revision: 1, config: {} },
      { id: soloRunModuleId, revision: 1, config: { speciesId: 155, form: 0 } },
    ])
    const runtime = createNewGamePlusGameplayRuntime(selected, { catalog, activation: 'new' })
    const chosen = member(40, 155)
    const companion = member(41, 152)
    runtime.ports.pokemonInitialTeamResolver.onInitialTeamCommitted?.([chosen])
    runtime.ports.detailedBattleOutcomeObserver.observeBattleOutcome({
      kind: 'pokemon-knocked-out',
      pokemon: { instanceId: chosen.instanceId as never, side: 'player', partyIndex: 0 },
    })

    expect(getPokemonBattleEligiblePartySlots([chosen, companion], {
      format: 'simple', phase: 'forced-replacement',
    }, runtime.ports.pokemonTeamPolicy)).toEqual([])
    expect(resolvePokemonPartyMutationDecision(
      'pc', [chosen, companion], [companion], runtime.ports.pokemonTeamPolicy,
    )).toMatchObject({ kind: 'blocked', code: 'solo-run-team-locked' })

    const extensions = runtime.snapshotExtensions()!
    expect(extensions[soloRunSaveExtensionKey]).toBeDefined()
    expect(extensions[permanentDeathSaveExtensionKey]).toBeDefined()
    const restored = createNewGamePlusGameplayRuntime(selected, { catalog, activation: 'resume', extensions })
    expect(restored.ports.pokemonPartyHealingPolicy.vetoFullHealRestoration({
      pokemon: chosen as never,
      partyIndex: 0,
      restoration: 'hp',
      source: 'full-heal',
    })).toMatchObject({ code: 'new-game-plus.permanent-death.healing-forbidden' })
  })
})
