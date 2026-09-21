import { describe, expect, it } from 'vitest'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { createFieldScriptState } from '../scripts/fieldScriptRunner'
import {
  createNewGamePlusGameplayRuntime,
} from './newGamePlusGameplayRuntime'
import {
  createNewGamePlusFirstBadgeFormatMatrix,
  createNewGamePlusFirstBadgeGameplayMatrix,
  newGamePlusFirstBadgeCompleteFormatCount,
  newGamePlusFirstBadgeGameplayFormatCount,
  newGamePlusIndependentGameplayModuleIds,
  newGamePlusTeamFormats,
  newGamePlusTransferModuleIds,
} from './newGamePlusFirstBadgeFormatMatrix'
import {
  allBattlesInDuoModuleId,
  allPokemonAccessibleModuleId,
  carryMoneyModuleId,
  carryPokedexModuleId,
  createBuiltInNewGamePlusRegistry,
  defaultEeveeTeamConfig,
  eeveeTeamModuleId,
  monotypeModuleId,
  soloRunModuleId,
} from './modules/index'
import {
  assertNewGamePlusTeamRuleCompatibility,
  resolveNewGamePlusTeamRuleCompatibility,
} from './modules/teamRuleCompatibility'
import type { NewGamePlusSource } from './newGamePlusTypes'

const source = Object.freeze({
  gameCode: 'IPKF',
  slot: 1,
  playerName: 'JO',
  leagueCompletedAt: '2026-08-25T12:00:00.000Z',
}) satisfies NewGamePlusSource

function createMatrixCatalog() {
  const catalog = createPokemonTestCatalog(493)
  catalog.personalData[152] = { ...catalog.personalData[152]!, types: [12, 2] }
  for (const { targetSpeciesId, typeId } of defaultEeveeTeamConfig.assignments) {
    catalog.personalData[targetSpeciesId] = {
      ...catalog.personalData[targetSpeciesId]!,
      types: [typeId, typeId],
    }
  }
  return catalog
}

const allSpeciesIds = Object.freeze(Array.from({ length: 493 }, (_, index) => index + 1))
const allPokemonHostOptions = Object.freeze({
  mapSources: Object.freeze([]),
  encounterCatalog: Object.freeze([]),
  knownAccessibleSpeciesIds: allSpeciesIds,
  readStatistics: () => ({ money: 0, battlesWon: 0, caughtSpeciesIds: allSpeciesIds }),
})
const allPokemonQuestLocations = Object.freeze([Object.freeze({
  mapId: 700,
  mapSectionId: 210,
  tileX: 5,
  tileZ: 4,
  direction: 'north' as const,
})])

function teamSelectionKey(moduleIds: ReadonlySet<string>): string {
  return [
    moduleIds.has(soloRunModuleId) ? 'S' : '-',
    moduleIds.has(allBattlesInDuoModuleId) ? 'D' : '-',
    moduleIds.has(eeveeTeamModuleId) ? 'E' : '-',
    moduleIds.has(monotypeModuleId) ? 'M' : '-',
  ].join('')
}

describe('matrice NG+ du gate premier badge', () => {
  const completeMatrix = createNewGamePlusFirstBadgeFormatMatrix(source)

  it('génère exactement 2 560 ensembles complets et 640 gameplays uniques', () => {
    const gameplayMatrix = createNewGamePlusFirstBadgeGameplayMatrix(source)
    expect(completeMatrix).toHaveLength(newGamePlusFirstBadgeCompleteFormatCount)
    expect(gameplayMatrix).toHaveLength(newGamePlusFirstBadgeGameplayFormatCount)
    expect(new Set(completeMatrix.map(({ label }) => label)).size).toBe(2_560)
    expect(new Set(completeMatrix.map(({ moduleIds }) => moduleIds.join('|'))).size).toBe(2_560)
    expect(new Set(gameplayMatrix.map(({ gameplayLabel }) => gameplayLabel)).size).toBe(640)
    expect(gameplayMatrix.every(({ transferModuleIds }) => transferModuleIds.length === 0)).toBe(true)

    const rowsByGameplay = new Map<string, typeof completeMatrix>()
    for (const row of completeMatrix) {
      rowsByGameplay.set(row.gameplayLabel, [...(rowsByGameplay.get(row.gameplayLabel) ?? []), row])
    }
    expect(rowsByGameplay.size).toBe(640)
    expect([...rowsByGameplay.values()].every((rows) => rows.length === 4)).toBe(true)
    expect([...rowsByGameplay.values()].every((rows) => new Set(
      rows.map(({ transferModuleIds }) => transferModuleIds.join('|')),
    ).size === 4)).toBe(true)
  })

  it('couvre exactement les dix formes d’équipe compatibles', () => {
    const generated = new Set(newGamePlusTeamFormats.map(({ moduleIds }) => teamSelectionKey(new Set(moduleIds))))
    const accepted = new Set<string>()
    for (let mask = 0; mask < 16; mask += 1) {
      const selection = {
        soloRun: (mask & 1) !== 0,
        allBattlesInDuo: (mask & 2) !== 0,
        eeveeTeam: (mask & 4) !== 0,
        monotype: (mask & 8) !== 0,
      }
      if (resolveNewGamePlusTeamRuleCompatibility(selection).length === 0) {
        accepted.add([
          selection.soloRun ? 'S' : '-',
          selection.allBattlesInDuo ? 'D' : '-',
          selection.eeveeTeam ? 'E' : '-',
          selection.monotype ? 'M' : '-',
        ].join(''))
      }
    }
    expect(generated).toEqual(accepted)
    expect(generated.size).toBe(10)

    for (const row of completeMatrix) {
      const ids = new Set(row.moduleIds)
      expect(() => assertNewGamePlusTeamRuleCompatibility({
        soloRun: ids.has(soloRunModuleId),
        allBattlesInDuo: ids.has(allBattlesInDuoModuleId),
        eeveeTeam: ids.has(eeveeTeamModuleId),
        monotype: ids.has(monotypeModuleId),
      })).not.toThrow()
    }
  })

  it('conserve l’ordre, les révisions et les configurations canoniques du registre', () => {
    const registry = createBuiltInNewGamePlusRegistry()
    const registered = registry.listModules()
    const order = new Map(registered.map(({ id }, index) => [id, index]))
    const defaults = new Map(registered.map(({ id, defaultConfig }) => [id, defaultConfig]))

    expect(newGamePlusTransferModuleIds).toEqual([carryPokedexModuleId, carryMoneyModuleId])
    expect(newGamePlusIndependentGameplayModuleIds).toHaveLength(6)
    expect(completeMatrix[0]).toMatchObject({
      label: 'ngp-first-badge-v1:base',
      gameplayLabel: 'ngp-first-badge-gameplay-v1:base',
      moduleIds: [],
    })

    for (const row of completeMatrix) {
      expect(row.profile.modules.map(({ id }) => id)).toEqual(row.moduleIds)
      expect(row.moduleIds.every((moduleId, index) => (
        index === 0 || order.get(row.moduleIds[index - 1]!)! < order.get(moduleId)!
      ))).toBe(true)
      for (const selection of row.profile.modules) {
        expect(selection.revision).toBe(1)
        expect(selection.config).toEqual(defaults.get(selection.id))
      }

      const recreated = registry.createProfile({
        source,
        modules: row.moduleIds.map((id) => ({ id })),
      })
      expect(row.profile).toEqual(recreated)
    }
  }, 15_000)

  it('applique les quatre variantes de transfert à chaque gameplay', () => {
    const registry = createBuiltInNewGamePlusRegistry()
    const transferFailures: string[] = []
    const sourceState = createFieldScriptState('male', 'JO')
    sourceState.money = 654_321
    sourceState.pokedex.enabled = true
    sourceState.pokedex.nationalDexEnabled = true
    sourceState.pokedex.seenSpeciesIds.add(25)
    sourceState.pokedex.caughtSpeciesIds.add(25)

    for (const row of completeMatrix) {
      const destination = createFieldScriptState('female', 'CELESTA')
      const result = registry.applyProfile(row.profile, sourceState, destination)
      const carriesMoney = row.moduleIds.includes(carryMoneyModuleId)
      const carriesPokedex = row.moduleIds.includes(carryPokedexModuleId)
      if (result.money !== (carriesMoney ? sourceState.money : destination.money)
        || result.pokedex.caughtSpeciesIds.has(25) !== carriesPokedex
        || result.pokedex.nationalDexEnabled !== carriesPokedex) {
        transferFailures.push(row.label)
      }
    }

    expect(transferFailures).toEqual([])
    expect(sourceState.money).toBe(654_321)
    expect(sourceState.pokedex.caughtSpeciesIds.has(25)).toBe(true)
  }, 30_000)

  it('active, photographie et reprend exhaustivement chaque profil au premier badge', () => {
    const catalog = createMatrixCatalog()
    const runtimeFailures: Array<{ label: string, error: unknown }> = []

    for (const row of completeMatrix) {
      try {
        const runtime = createNewGamePlusGameplayRuntime(row.profile, {
          catalog,
          activation: 'new',
          readProgression: () => 1,
          allPokemonAccessible: allPokemonHostOptions,
          allPokemonQuestLocations,
        })
        const extensions = runtime.snapshotExtensions()
        const resumed = createNewGamePlusGameplayRuntime(row.profile, {
          catalog,
          activation: 'resume',
          extensions,
          readProgression: () => 1,
          allPokemonAccessible: allPokemonHostOptions,
          allPokemonQuestLocations,
        })
        if (JSON.stringify(resumed.snapshotExtensions()) !== JSON.stringify(extensions)) {
          throw new Error('Le snapshot repris diffère du snapshot initial.')
        }
        if (row.moduleIds.includes(allPokemonAccessibleModuleId)
          && resumed.getModuleRuntime(allPokemonAccessibleModuleId) === undefined) {
          throw new Error('Le runtime Tous les Pokémon est absent.')
        }
      } catch (error) {
        runtimeFailures.push({ label: row.label, error })
      }
    }

    expect(runtimeFailures).toEqual([])
  }, 60_000)
})
