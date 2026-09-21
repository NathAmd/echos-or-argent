import { describe, expect, it, vi } from 'vitest'
import type { PokemonCatalog } from '../../../ndsTypes'
import type { HgssWildEncounterData } from '../../../rom/encounters/wildEncounterData'
import type { PreparedFieldWildEncounter } from '../../encounters/wildEncounterSelection'
import { deriveLegacyPokemonInstanceId } from '../../pokemon/pokemonInstanceId'
import { createPokemonTestCatalog } from '../../pokemon/pokemonTestCatalog'
import { cloneFieldScriptState, createFieldScriptState } from '../../scripts/fieldScriptRunner'
import { runSessionRestoreTransaction } from '../../save/sessionRestoreTransaction'
import {
  createAllPokemonAccessibilityPlan,
  createAllPokemonAccessibleEncounterPort,
  createAllPokemonEncounterMapSources,
  hgssLegendaryAndMythicalSpeciesIds,
  hgssNationalDexSpeciesCount,
  resolveAllPokemonNativeOneShotSpeciesIds,
  resolveAllPokemonRayquazaDisappearanceFlagId,
  resolveAllPokemonTransitiveOneShotSpeciesIds,
  type AllPokemonEncounterMapSource,
} from './allPokemonAccessibilityPlanner'
import {
  allPokemonAccessibleModule,
  createAllPokemonAccessibleRuntime,
  decodeAllPokemonAccessibleConfig,
  isAllPokemonQuestRequirementMet,
  type AllPokemonSaveStatistics,
} from './allPokemonAccessibleModule'

function setTypes(catalog: PokemonCatalog, speciesId: number, types: readonly [number, number]): void {
  catalog.personalData[speciesId] = { ...catalog.personalData[speciesId]!, types }
}

function slots(speciesId: number, count: number, minimum = 5, maximum = minimum) {
  return Array.from({ length: count }, () => ({ speciesId, minLevel: minimum, maxLevel: maximum }))
}

function landSlots(speciesId: number, count = 12, level = 5) {
  return Array.from({ length: count }, () => ({ speciesId, level }))
}

function encounterBank(): HgssWildEncounterData {
  return {
    bankId: 0,
    rates: { walking: 20, surfing: 10, rockSmash: 10, oldRod: 10, goodRod: 10, superRod: 10 },
    land: { morning: landSlots(1), day: landSlots(11), night: landSlots(1) },
    hoennSoundSpecies: [5, 6],
    sinnohSoundSpecies: [7, 8],
    surfing: slots(2, 5, 10, 15),
    rockSmash: slots(4, 2, 8, 12),
    oldRod: slots(3, 5, 5, 10),
    goodRod: slots(3, 5, 10, 20),
    superRod: slots(3, 5, 20, 40),
    swarm: { landSpeciesId: 9, surfingSpeciesId: 10, nightFishingSpeciesId: 9, fishingSpeciesId: 10 },
  }
}

function mapSources(count = 10): AllPokemonEncounterMapSource[] {
  return Array.from({ length: count }, (_, index) => ({
    mapId: 100 + index,
    mapSectionId: 20 + Math.floor(index / 2),
    encounterBankId: 0,
  }))
}

function fullCatalog(): PokemonCatalog {
  const catalog = createPokemonTestCatalog(hgssNationalDexSpeciesCount)
  setTypes(catalog, 2, [11, 11])
  setTypes(catalog, 3, [11, 11])
  setTypes(catalog, 11, [10, 10])
  setTypes(catalog, 129, [11, 11])
  setTypes(catalog, 218, [10, 10])
  return catalog
}

const rateRoll = Object.freeze({ triggered: true, modifiedRate: 20, firstRoll: 4 })

function preparedFromPlacement(
  placement: ReturnType<typeof createAllPokemonAccessibilityPlan>['ordinaryPlacements'][number],
): PreparedFieldWildEncounter {
  if (placement.method === 'land') {
    return {
      rateRoll,
      encounter: {
        bankId: placement.encounterBankId,
        slotIndex: placement.slotIndex,
        method: 'land',
        time: placement.variant as 'morning' | 'day' | 'night',
        speciesId: placement.replacedSpeciesId,
        level: placement.minimumLevel,
      },
    }
  }
  if (placement.method === 'surfing') {
    return {
      rateRoll,
      encounter: {
        bankId: placement.encounterBankId,
        slotIndex: placement.slotIndex,
        method: 'surfing',
        speciesId: placement.replacedSpeciesId,
        minLevel: placement.minimumLevel,
        maxLevel: placement.maximumLevel,
        level: placement.minimumLevel,
      },
    }
  }
  return {
    rateRoll,
    encounter: {
      bankId: placement.encounterBankId,
      slotIndex: placement.slotIndex,
      method: 'fishing',
      rod: placement.variant as 'oldRod' | 'goodRod' | 'superRod',
      speciesId: placement.replacedSpeciesId,
      minLevel: placement.minimumLevel,
      maxLevel: placement.maximumLevel,
      level: placement.minimumLevel,
    },
  }
}

describe('plan Tous les Pokémon accessibles', () => {
  it('ne masque comme natifs que les légendaires solo réellement actifs dans la version', () => {
    const landmark = (speciesId: number, proven = true) => ({
      speciesId,
      isRomLegendary: true as const,
      ...(proven ? { disappearanceFlagId: 0x200 + speciesId } : {}),
    })
    const landmarks = [144, 145, 146, 150, 245, 249, 250, 382, 383, 384]
      .map((speciesId) => landmark(speciesId))
    expect(resolveAllPokemonNativeOneShotSpeciesIds('IPKF', landmarks)).toEqual([
      144, 145, 146, 150, 243, 244, 245, 249, 250, 380, 382,
    ])
    expect(resolveAllPokemonNativeOneShotSpeciesIds('IPGF', landmarks)).toEqual([
      144, 145, 146, 150, 243, 244, 245, 249, 250, 381, 383,
    ])
    expect(resolveAllPokemonNativeOneShotSpeciesIds('IPKF', [landmark(144, false)])).toEqual([
      243, 244, 380,
    ])
    expect(() => resolveAllPokemonNativeOneShotSpeciesIds('XXXX', landmarks)).toThrow('version HGSS')
  })

  it('classe Rayquaza comme accessible seulement après preuve native et couverture des deux légendaires météo', () => {
    const landmark = (speciesId: number, proven = true) => ({
      speciesId,
      isRomLegendary: true as const,
      ...(proven ? { disappearanceFlagId: 0x200 + speciesId } : {}),
    })
    const landmarks = [144, 145, 146, 150, 245, 249, 250, 382, 383, 384]
      .map((speciesId) => landmark(speciesId))
    const moduleCoverage = Array.from({ length: 493 }, (_, index) => index + 1)
    const heartGoldNative = resolveAllPokemonNativeOneShotSpeciesIds('IPKF', landmarks)
    const soulSilverNative = resolveAllPokemonNativeOneShotSpeciesIds('IPGF', landmarks)

    expect(resolveAllPokemonTransitiveOneShotSpeciesIds('IPKF', landmarks, {
      knownAccessibleSpeciesIds: heartGoldNative,
      moduleCoveredSpeciesIds: moduleCoverage,
    })).toEqual([384])
    expect(resolveAllPokemonTransitiveOneShotSpeciesIds('IPGF', landmarks, {
      knownAccessibleSpeciesIds: soulSilverNative,
      moduleCoveredSpeciesIds: moduleCoverage,
    })).toEqual([384])
    expect(resolveAllPokemonTransitiveOneShotSpeciesIds('IPKF', landmarks, {
      knownAccessibleSpeciesIds: heartGoldNative,
      moduleCoveredSpeciesIds: moduleCoverage.filter((speciesId) => speciesId !== 383),
    })).toEqual([])
    expect(resolveAllPokemonTransitiveOneShotSpeciesIds('IPKF', [
      ...landmarks.filter(({ speciesId }) => speciesId !== 384),
      landmark(384, false),
    ], {
      knownAccessibleSpeciesIds: heartGoldNative,
      moduleCoveredSpeciesIds: moduleCoverage,
    })).toEqual([])
    expect(resolveAllPokemonTransitiveOneShotSpeciesIds('IPKF', landmarks, {
      knownAccessibleSpeciesIds: heartGoldNative.filter((speciesId) => speciesId !== 382),
      moduleCoveredSpeciesIds: moduleCoverage,
    })).toEqual([])

    const duplicatedProof = [...landmarks, landmark(384)]
    expect(resolveAllPokemonRayquazaDisappearanceFlagId(duplicatedProof)).toBe(0x200 + 384)
    expect(resolveAllPokemonTransitiveOneShotSpeciesIds('IPKF', duplicatedProof, {
      knownAccessibleSpeciesIds: heartGoldNative,
      moduleCoveredSpeciesIds: moduleCoverage,
    })).toEqual([384])

    const ambiguousProof = [
      ...landmarks,
      { ...landmark(384), disappearanceFlagId: 0x999 },
    ]
    expect(resolveAllPokemonRayquazaDisappearanceFlagId(ambiguousProof)).toBeUndefined()
    expect(resolveAllPokemonTransitiveOneShotSpeciesIds('IPKF', ambiguousProof, {
      knownAccessibleSpeciesIds: heartGoldNative,
      moduleCoveredSpeciesIds: moduleCoverage,
    })).toEqual([])
  })

  it.each([
    ['IPKF', 383],
    ['IPGF', 382],
  ] as const)('retire la quête Rayquaza en %s sans retirer la contrepartie météo %i', (gameCode, oppositeWeatherSpeciesId) => {
    const landmarks = [144, 145, 146, 150, 245, 249, 250, 382, 383, 384].map((speciesId) => ({
      speciesId,
      isRomLegendary: true as const,
      disappearanceFlagId: 0x200 + speciesId,
    }))
    const knownAccessibleSpeciesIds = resolveAllPokemonNativeOneShotSpeciesIds(gameCode, landmarks)
    const plan = createAllPokemonAccessibilityPlan(fullCatalog(), mapSources(), [encounterBank()], {
      knownAccessibleSpeciesIds,
      transitiveOneShotEvidence: { gameCode, landmarks },
    })
    const questSpeciesIds = new Set(plan.quests.map(({ speciesId }) => speciesId))

    expect(plan.coveredSpeciesIds).toEqual(Array.from({ length: 493 }, (_, index) => index + 1))
    expect(questSpeciesIds.has(384)).toBe(false)
    expect(questSpeciesIds.has(oppositeWeatherSpeciesId)).toBe(true)
    expect(plan.nativeSpeciesIds).toContain(384)
  })

  it.each(['captured', 'defeated'] as const)(
    'migre une ancienne quête Rayquaza %s en son drapeau ROM sans toucher au rollback',
    (terminalStatus) => {
      const landmarks = [144, 145, 146, 150, 245, 249, 250, 382, 384].map((speciesId) => ({
        speciesId,
        isRomLegendary: true as const,
        disappearanceFlagId: 0x200 + speciesId,
      }))
      const knownAccessibleSpeciesIds = resolveAllPokemonNativeOneShotSpeciesIds('IPKF', landmarks)
      const common = {
        catalog: fullCatalog(),
        mapSources: mapSources(),
        encounterCatalog: [encounterBank()],
        knownAccessibleSpeciesIds,
        readStatistics: () => ({ money: 0, battlesWon: 0, caughtSpeciesIds: [] }),
      }
      const legacyRuntime = createAllPokemonAccessibleRuntime(common)
      expect(legacyRuntime.plan.quests.some(({ speciesId }) => speciesId === 384)).toBe(true)
      const legacyState = JSON.parse(JSON.stringify(legacyRuntime.snapshotState())) as {
        quests: Array<{ speciesId: number, status: string, encounterInstanceId: null }>
      }
      const rayquaza = legacyState.quests.find(({ speciesId }) => speciesId === 384)!
      rayquaza.status = terminalStatus

      const restored = createAllPokemonAccessibleRuntime({
        ...common,
        state: legacyState,
        transitiveOneShotEvidence: { gameCode: 'IPKF', landmarks },
      })

      expect(restored.plan.quests.some(({ speciesId }) => speciesId === 384)).toBe(false)
      expect(restored.snapshotState().quests.some(({ speciesId }) => speciesId === 384)).toBe(false)
      expect(restored.snapshotState().quests).toHaveLength(legacyState.quests.length - 1)
      const previousField = createFieldScriptState('male', 'JO')
      previousField.flags.add(77)
      const nextField = cloneFieldScriptState(previousField)
      restored.applyFieldStateMigrations(nextField)
      expect(nextField.flags.has(0x200 + 384)).toBe(true)
      expect(previousField.flags.has(0x200 + 384)).toBe(false)

      let activeField = previousField
      expect(() => runSessionRestoreTransaction({
        snapshot: () => activeField,
        restore: (snapshot) => { activeField = snapshot },
        attempt: () => {
          activeField = nextField
          throw new Error('loadMap failed')
        },
      })).toThrow('loadMap failed')
      expect(activeField).toBe(previousField)
      expect(activeField.flags).toEqual(new Set([77]))
    },
  )

  it.each(['locked', 'available'] as const)(
    'retire une ancienne quête Rayquaza %s sans inventer de drapeau ROM',
    (status) => {
      const landmarks = [382, 384].map((speciesId) => ({
        speciesId,
        isRomLegendary: true as const,
        disappearanceFlagId: 0x200 + speciesId,
      }))
      const common = {
        catalog: fullCatalog(),
        mapSources: mapSources(),
        encounterCatalog: [encounterBank()],
        knownAccessibleSpeciesIds: resolveAllPokemonNativeOneShotSpeciesIds('IPKF', landmarks),
        readStatistics: () => ({ money: 0, battlesWon: 0, caughtSpeciesIds: [] }),
      }
      const legacyRuntime = createAllPokemonAccessibleRuntime(common)
      const legacyState = JSON.parse(JSON.stringify(legacyRuntime.snapshotState())) as {
        quests: Array<{ speciesId: number, status: string, encounterInstanceId: string | null }>
      }
      const rayquaza = legacyState.quests.find(({ speciesId }) => speciesId === 384)!
      rayquaza.status = status
      rayquaza.encounterInstanceId = null

      const restored = createAllPokemonAccessibleRuntime({
        ...common,
        state: legacyState,
        transitiveOneShotEvidence: { gameCode: 'IPKF', landmarks },
      })
      const field = createFieldScriptState('male', 'JO')
      restored.applyFieldStateMigrations(field)

      expect(restored.snapshotState().quests.some(({ speciesId }) => speciesId === 384)).toBe(false)
      expect(field.flags.has(0x200 + 384)).toBe(false)
    },
  )

  it('refuse de migrer une ancienne quête Rayquaza avec un combat encore actif', () => {
    const landmarks = [382, 384].map((speciesId) => ({
      speciesId,
      isRomLegendary: true as const,
      disappearanceFlagId: 0x200 + speciesId,
    }))
    const common = {
      catalog: fullCatalog(),
      mapSources: mapSources(),
      encounterCatalog: [encounterBank()],
      knownAccessibleSpeciesIds: resolveAllPokemonNativeOneShotSpeciesIds('IPKF', landmarks),
      readStatistics: () => ({ money: 0, battlesWon: 0, caughtSpeciesIds: [] }),
    }
    const legacyRuntime = createAllPokemonAccessibleRuntime(common)
    const legacyState = JSON.parse(JSON.stringify(legacyRuntime.snapshotState())) as {
      quests: Array<{ speciesId: number, status: string, encounterInstanceId: string | null }>
    }
    const rayquaza = legacyState.quests.find(({ speciesId }) => speciesId === 384)!
    rayquaza.status = 'available'
    rayquaza.encounterInstanceId = deriveLegacyPokemonInstanceId('ng-plus-test', 'legacy-rayquaza-active')

    expect(() => createAllPokemonAccessibleRuntime({
      ...common,
      state: legacyState,
      transitiveOneShotEvidence: { gameCode: 'IPKF', landmarks },
    })).toThrow('ancienne quête Rayquaza encore active')
  })

  it('conserve la quête Rayquaza lorsque son landmark ou le one-shot météo natif est incomplet', () => {
    const proven = (speciesId: number) => ({
      speciesId,
      isRomLegendary: true as const,
      disappearanceFlagId: 0x200 + speciesId,
    })
    const completeLandmarks = [144, 145, 146, 150, 245, 249, 250, 382, 384].map(proven)
    for (const landmarks of [
      completeLandmarks.filter(({ speciesId }) => speciesId !== 382),
      completeLandmarks.map((landmark) => landmark.speciesId === 384
        ? { speciesId: 384, isRomLegendary: true as const }
        : landmark),
    ]) {
      const plan = createAllPokemonAccessibilityPlan(fullCatalog(), mapSources(), [encounterBank()], {
        knownAccessibleSpeciesIds: resolveAllPokemonNativeOneShotSpeciesIds('IPKF', landmarks),
        transitiveOneShotEvidence: { gameCode: 'IPKF', landmarks },
      })
      expect(plan.quests.some(({ speciesId }) => speciesId === 384)).toBe(true)
      expect(plan.coveredSpeciesIds).toHaveLength(493)
    }
  })

  it('n’utilise jamais les slots ordinaires substitués par le moteur Safari', () => {
    expect(createAllPokemonEncounterMapSources([
      { id: 357, header: { wildEncounterBank: 1, mapSection: 99 } as never },
      { id: 12, header: { wildEncounterBank: 2, mapSection: 7 } as never },
    ])).toEqual([{ mapId: 12, mapSectionId: 7, encounterBankId: 2 }])
  })

  it('couvre exactement les 493 espèces, y compris exclusivités de version, échanges et fabuleux', () => {
    const plan = createAllPokemonAccessibilityPlan(fullCatalog(), mapSources(), [encounterBank()])
    const placed = new Set(plan.ordinaryPlacements.map(({ speciesId }) => speciesId))
    const questSpecies = new Set(plan.quests.map(({ speciesId }) => speciesId))

    expect(plan.coveredSpeciesIds).toEqual(Array.from({ length: 493 }, (_, index) => index + 1))
    expect(new Set(plan.coveredSpeciesIds).size).toBe(493)
    expect(plan.nativeSpeciesIds).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(placed.has(65)).toBe(true) // évolution normalement obtenue par échange
    expect(placed.has(23)).toBe(true) // une espèce ordinaire absente de cette version/table
    expect(questSpecies.has(493)).toBe(true)
    expect(plan.quests.filter(({ category }) => category === 'legendary').map(({ speciesId }) => speciesId))
      .toEqual(hgssLegendaryAndMythicalSpeciesIds)
    expect(plan.quests.some(({ category }) => category === 'difficult')).toBe(false)
  })

  it('est déterministe malgré l’ordre des cartes et place les espèces aquatiques dans l’eau', () => {
    const catalog = fullCatalog()
    const maps = mapSources()
    const first = createAllPokemonAccessibilityPlan(catalog, maps, [encounterBank()], { seed: 'stable' })
    const restored = createAllPokemonAccessibilityPlan(catalog, [...maps].reverse(), [encounterBank()], { seed: 'stable' })
    const otherSeed = createAllPokemonAccessibilityPlan(catalog, maps, [encounterBank()], { seed: 'other' })

    expect(restored).toEqual(first)
    expect(otherSeed.ordinaryPlacements).not.toEqual(first.ordinaryPlacements)
    expect(first.ordinaryPlacements.find(({ speciesId }) => speciesId === 129))
      .toMatchObject({ habitat: 'aquatic' })
    expect(first.ordinaryPlacements.find(({ speciesId }) => speciesId === 129)?.method).not.toBe('land')
    expect(first.ordinaryPlacements.find(({ speciesId }) => speciesId === 218))
      .toMatchObject({ habitat: 'volcanic', method: 'land' })
  })

  it('remplace uniquement le slot planifié sans toucher au niveau, au taux ou aux données sources', () => {
    const plan = createAllPokemonAccessibilityPlan(fullCatalog(), mapSources(), [encounterBank()])
    const placement = plan.ordinaryPlacements[0]!
    const port = createAllPokemonAccessibleEncounterPort(plan)
    const prepared = preparedFromPlacement(placement)
    const transformed = port(prepared, { mapId: placement.mapId, source: 'step' })

    expect(transformed.encounter).toMatchObject({
      speciesId: placement.speciesId,
      level: placement.minimumLevel,
      method: placement.method,
      slotIndex: placement.slotIndex,
    })
    expect(transformed.rateRoll).toBe(rateRoll)
    expect(prepared.encounter.speciesId).toBe(placement.replacedSpeciesId)
    expect(port(prepared, { mapId: 99, source: 'forced' })).toBe(prepared)

    const roamer: PreparedFieldWildEncounter = {
      rateRoll,
      encounter: { bankId: 1, slotIndex: 0, method: 'roamer', speciesId: 243, level: 40, roamerId: 0 },
    }
    expect(port(roamer, { mapId: placement.mapId, source: 'step' })).toBe(roamer)
  })

  it('bascule les espèces ordinaires difficiles vers des quêtes sans laisser de trou', () => {
    const plan = createAllPokemonAccessibilityPlan(fullCatalog(), mapSources(1), [encounterBank()])
    expect(plan.ordinaryPlacements.length).toBeGreaterThan(0)
    expect(plan.quests.some(({ category }) => category === 'difficult')).toBe(true)
    expect(plan.coveredSpeciesIds).toHaveLength(493)
  })
})

describe('quêtes Tous les Pokémon accessibles', () => {
  it('évalue uniquement argent, victoires et captures typées explicitement fournis', () => {
    const catalog = fullCatalog()
    setTypes(catalog, 4, [10, 10])
    setTypes(catalog, 5, [10, 2])
    const statistics: AllPokemonSaveStatistics = {
      money: 499_999,
      battlesWon: 24,
      caughtSpeciesIds: [4, 5, 5],
    }

    expect(isAllPokemonQuestRequirementMet({ kind: 'money', amount: 500_000 }, statistics, catalog)).toBe(false)
    expect(isAllPokemonQuestRequirementMet({ kind: 'battles-won', count: 24 }, statistics, catalog)).toBe(true)
    expect(isAllPokemonQuestRequirementMet({ kind: 'caught-type', typeId: 10, count: 2 }, statistics, catalog)).toBe(true)
    expect(isAllPokemonQuestRequirementMet({ kind: 'caught-type', typeId: 10, count: 3 }, statistics, catalog)).toBe(false)
  })

  it('déverrouille, conserve une fuite et rend un légendaire K.O. définitivement indisponible après reprise', () => {
    const catalog = fullCatalog()
    let statistics: AllPokemonSaveStatistics = { money: 0, battlesWon: 0, caughtSpeciesIds: [] }
    const create = (state?: unknown) => createAllPokemonAccessibleRuntime({
      catalog,
      mapSources: mapSources(),
      encounterCatalog: [encounterBank()],
      readStatistics: () => statistics,
      ...(state === undefined ? {} : { state }),
    })
    const runtime = create()
    const moneyQuest = runtime.plan.quests.find(({ requirement }) => requirement.kind === 'money')!
    const instanceId = deriveLegacyPokemonInstanceId('all-pokemon-test', 'legendary-ko')

    expect(runtime.prepareQuestEncounter(moneyQuest.speciesId)).toBeUndefined()
    statistics = { ...statistics, money: (moneyQuest.requirement as { amount: number }).amount }
    expect(runtime.prepareQuestEncounter(moneyQuest.speciesId)).toEqual(moneyQuest)
    runtime.wildEncounterStartedObserver.observeWildEncounterStarted({
      kind: 'wild-encounter-started', mapId: 500, mapSectionId: 200, method: 'scripted',
      instanceId, speciesId: moneyQuest.speciesId, level: moneyQuest.level,
    })
    runtime.detailedBattleOutcomeObserver.observeBattleOutcome({ kind: 'battle-finished', outcome: 'flee' })
    expect(runtime.canStartQuestEncounter(moneyQuest.speciesId)).toBe(true)

    runtime.wildEncounterStartedObserver.observeWildEncounterStarted({
      kind: 'wild-encounter-started', mapId: 500, mapSectionId: 200, method: 'scripted',
      instanceId, speciesId: moneyQuest.speciesId, level: moneyQuest.level,
    })
    const duringBattle = JSON.parse(JSON.stringify(runtime.snapshotState()))
    const restoredDuringBattle = create(duringBattle)
    restoredDuringBattle.detailedBattleOutcomeObserver.observeBattleOutcome({
      kind: 'pokemon-knocked-out',
      pokemon: { instanceId, side: 'opponent', partyIndex: 0 },
    })
    const defeated = JSON.parse(JSON.stringify(restoredDuringBattle.snapshotState()))
    const restoredDefeated = create(defeated)

    expect(restoredDefeated.listQuests().find(({ speciesId }) => speciesId === moneyQuest.speciesId))
      .toMatchObject({ status: 'defeated', encounterInstanceId: null })
    expect(restoredDefeated.prepareQuestEncounter(moneyQuest.speciesId)).toBeUndefined()
  })

  it('marque une capture avec son instance exacte et ne confond pas un autre adversaire', () => {
    const catalog = fullCatalog()
    const statistics: AllPokemonSaveStatistics = {
      money: 999_999,
      battlesWon: 999,
      caughtSpeciesIds: Array.from({ length: 493 }, (_, index) => index + 1),
    }
    const runtime = createAllPokemonAccessibleRuntime({
      catalog,
      mapSources: mapSources(),
      encounterCatalog: [encounterBank()],
      readStatistics: () => statistics,
    })
    const quest = runtime.plan.quests[0]!
    const instanceId = deriveLegacyPokemonInstanceId('all-pokemon-test', 'legendary-capture')
    const otherId = deriveLegacyPokemonInstanceId('all-pokemon-test', 'other-opponent')
    runtime.wildEncounterStartedObserver.observeWildEncounterStarted({
      kind: 'wild-encounter-started', mapId: 500, mapSectionId: 200, method: 'scripted',
      instanceId, speciesId: quest.speciesId, level: quest.level,
    })
    runtime.detailedBattleOutcomeObserver.observeBattleOutcome({
      kind: 'pokemon-knocked-out', pokemon: { instanceId: otherId, side: 'opponent', partyIndex: 1 },
    })
    expect(runtime.listQuests().find(({ speciesId }) => speciesId === quest.speciesId)?.status).toBe('available')

    runtime.detailedBattleOutcomeObserver.observeBattleOutcome({
      kind: 'battle-finished', outcome: 'capture',
      capturedPokemon: { instanceId, side: 'opponent', partyIndex: 0 },
    })
    expect(runtime.listQuests().find(({ speciesId }) => speciesId === quest.speciesId))
      .toMatchObject({ status: 'captured', encounterInstanceId: null })
    expect(runtime.canStartQuestEncounter(quest.speciesId)).toBe(false)
  })

  it('valide strictement la configuration et ne lit aucun getter hostile', () => {
    expect(allPokemonAccessibleModule.enabledByDefault).toBe(false)
    expect(decodeAllPokemonAccessibleConfig({ seed: 'Johto-493' })).toEqual({
      seed: 'Johto-493', seedSource: 'config-text',
    })
    expect(decodeAllPokemonAccessibleConfig({
      seed: 'ROM_RESOLVED_TEXT_CANARY', seedSource: 'config-text',
    })).toEqual({ seed: 'ROM_RESOLVED_TEXT_CANARY', seedSource: 'config-text' })
    const getter = vi.fn(() => 'secret')
    const hostile = Object.defineProperty({}, 'seed', { enumerable: true, get: getter })
    for (const invalid of [
      {}, { seed: '' }, { seed: ' bad' }, { seed: 'bad\n' }, { seed: 3 },
      { seed: 'ok', seedSource: 'rom-text' }, { seed: 'ok', extra: true },
      Object.create({ seed: 'prototype' }), hostile,
    ]) expect(() => decodeAllPokemonAccessibleConfig(invalid)).toThrow()
    expect(getter).not.toHaveBeenCalled()
  })
})
