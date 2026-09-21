import { describe, expect, it } from 'vitest'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import {
  assertNewGamePlusFirstBadgeAllConfigurationCounts,
  createNewGamePlusFirstBadgeAllConfigurationAxes,
  decodeNewGamePlusFirstBadgeAllProfileCoordinate,
  encodeNewGamePlusFirstBadgeAllProfileCoordinate,
  materializeNewGamePlusFirstBadgeAllProfile,
  newGamePlusFirstBadgeAllConfigurationsExpectedCounts,
  validateNewGamePlusFirstBadgeAllConfigurations,
} from './newGamePlusFirstBadgeAllConfigurations'
import {
  allBattlesInDuoModuleId,
  carryMoneyModuleId,
  carryPokedexModuleId,
  eeveeTeamModuleId,
  monotypeModuleId,
  soloRunModuleId,
} from './modules/index'
import type { NewGamePlusSource } from './newGamePlusTypes'

const source = Object.freeze({
  gameCode: 'IPKF',
  slot: 1,
  playerName: 'GATE',
  leagueCompletedAt: '2026-08-25T12:00:00.000Z',
}) satisfies NewGamePlusSource

/**
 * Reproduit les cardinalités utiles d'IPKF sans charger la ROM dans les tests
 * ordinaires : 493 types primaires et 223 seconds types distincts donnent
 * exactement 716 couples espèce/type, distribués sur 17 types valides.
 */
function createAllConfigurationsCatalog() {
  const catalog = createPokemonTestCatalog(493)
  for (let speciesId = 1; speciesId <= 493; speciesId += 1) {
    const primaryType = (speciesId - 1) % 17
    const secondaryType = speciesId <= 223 ? (primaryType + 1) % 17 : primaryType
    catalog.personalData[speciesId] = {
      ...catalog.personalData[speciesId]!,
      types: [primaryType, secondaryType],
    }
  }
  return catalog
}

describe('couverture factorisée de toutes les configurations NG+ au premier badge', () => {
  const axes = createNewGamePlusFirstBadgeAllConfigurationAxes(createAllConfigurationsCatalog())

  it('reproduit exactement les cardinalités IPKF et les dix familles d’équipe', () => {
    expect(() => assertNewGamePlusFirstBadgeAllConfigurationCounts(axes)).not.toThrow()
    expect({
      monotypes: axes.monotypeTypeIds.length,
      solo: axes.soloSpeciesIds.length,
      soloMonotype: axes.soloMonotypePairs.length,
      teams: axes.teamConfigurations.length,
      gameplay: axes.gameplayProfileCount,
      complete: axes.completeProfileCount,
    }).toEqual({
      monotypes: 17,
      solo: 493,
      soloMonotype: 716,
      teams: 2_456,
      gameplay: 157_184,
      complete: 628_736,
    })

    const countsByFamily = Object.fromEntries([...new Set(axes.teamConfigurations.map(({ teamFormatId }) => teamFormatId))]
      .map((teamFormatId) => [teamFormatId, axes.teamConfigurations.filter((configuration) => (
        configuration.teamFormatId === teamFormatId
      )).length]))
    expect(countsByFamily).toEqual({
      standard: 1,
      duo: 1,
      monotype: 17,
      'duo-monotype': 17,
      solo: 493,
      'duo-solo': 493,
      'solo-monotype': 716,
      'duo-solo-monotype': 716,
      'eevee-team': 1,
      'duo-eevee-team': 1,
    })
    expect(new Set(axes.teamConfigurations.map(({ id }) => id)).size).toBe(2_456)
  })

  it('ne crée que des couples Solo+Monotype réellement compatibles', () => {
    const catalog = createAllConfigurationsCatalog()
    expect(axes.soloMonotypePairs.every(({ typeId, speciesId }) => (
      catalog.personalData[speciesId]?.types.includes(typeId)
    ))).toBe(true)
    expect(new Set(axes.soloMonotypePairs.map(({ typeId, speciesId }) => `${typeId}:${speciesId}`)).size).toBe(716)

    for (const configuration of axes.teamConfigurations) {
      if (configuration.soloSpeciesId !== undefined) {
        const solo = configuration.moduleDrafts.find(({ id }) => id === soloRunModuleId)
        expect(solo?.config).toEqual({ speciesId: configuration.soloSpeciesId, form: 0 })
      }
      if (configuration.monotypeTypeId !== undefined) {
        const monotype = configuration.moduleDrafts.find(({ id }) => id === monotypeModuleId)
        expect(monotype?.config).toEqual({ typeId: configuration.monotypeTypeId })
      }
    }
  })

  it('énumère bijectivement les 628 736 profils et valide chaque valeur d’axe', () => {
    const report = validateNewGamePlusFirstBadgeAllConfigurations(source, axes)
    expect(report).toEqual({
      monotypeConfigurationsValidated: 17,
      soloConfigurationsValidated: 493,
      soloMonotypeConfigurationsValidated: 716,
      teamConfigurationsValidated: 2_456,
      canonicalGameplayCompositionsValidated: 640,
      transferVariantsValidated: 4,
      gameplayCoordinatesValidated: 157_184,
      completeProfileCoordinatesValidated: 628_736,
      materializedAxisProfilesValidated: 3_100,
    })

    const last = decodeNewGamePlusFirstBadgeAllProfileCoordinate(
      axes,
      newGamePlusFirstBadgeAllConfigurationsExpectedCounts.completeProfiles - 1,
    )
    expect(last).toEqual({
      linearIndex: 628_735,
      teamConfigurationIndex: 2_455,
      independentGameplayMask: 63,
      transferMask: 3,
    })
    expect(encodeNewGamePlusFirstBadgeAllProfileCoordinate(axes, last)).toBe(628_735)
  }, 30_000)

  it('matérialise les coordonnées extrêmes avec ordre, configs et transferts canoniques', () => {
    const firstCoordinate = decodeNewGamePlusFirstBadgeAllProfileCoordinate(axes, 0)
    const first = materializeNewGamePlusFirstBadgeAllProfile(source, axes, firstCoordinate)
    expect(first).toMatchObject({
      id: 'ngp-first-badge-all-v1/standard/g=0/t=0',
      profile: { modules: [] },
    })

    const lastCoordinate = decodeNewGamePlusFirstBadgeAllProfileCoordinate(axes, axes.completeProfileCount - 1)
    const last = materializeNewGamePlusFirstBadgeAllProfile(source, axes, lastCoordinate)
    expect(last.teamConfiguration.teamFormatId).toBe('duo-eevee-team')
    expect(last.profile.modules.map(({ id }) => id)).toEqual([
      carryPokedexModuleId,
      carryMoneyModuleId,
      'nuzlocke',
      'hardcore',
      'permanent-death',
      'randomizer',
      'all-pokemon-accessible',
      'visible-wild-pokemon',
      allBattlesInDuoModuleId,
      eeveeTeamModuleId,
    ])

    const configuredIndex = axes.teamConfigurations.findIndex(({ teamFormatId, monotypeTypeId, soloSpeciesId }) => (
      teamFormatId === 'duo-solo-monotype' && monotypeTypeId === 3 && soloSpeciesId !== undefined
    ))
    expect(configuredIndex).toBeGreaterThanOrEqual(0)
    const configuredCoordinate = decodeNewGamePlusFirstBadgeAllProfileCoordinate(
      axes,
      encodeNewGamePlusFirstBadgeAllProfileCoordinate(axes, {
        teamConfigurationIndex: configuredIndex,
        independentGameplayMask: 0,
        transferMask: 0,
      }),
    )
    const configured = materializeNewGamePlusFirstBadgeAllProfile(source, axes, configuredCoordinate)
    expect(configured.profile.modules).toMatchObject([
      { id: allBattlesInDuoModuleId },
      { id: monotypeModuleId, config: { typeId: 3 } },
      { id: soloRunModuleId, config: { speciesId: configured.teamConfiguration.soloSpeciesId, form: 0 } },
    ])
  })

  it('rejette immédiatement une cardinalité qui ne correspond plus à IPKF', () => {
    expect(() => assertNewGamePlusFirstBadgeAllConfigurationCounts({
      ...axes,
      soloMonotypePairs: axes.soloMonotypePairs.slice(1),
    })).toThrow('715 couples Solo+Monotype au lieu de 716')
  })
})
