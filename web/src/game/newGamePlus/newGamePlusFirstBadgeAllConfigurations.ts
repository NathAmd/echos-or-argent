import type { PokemonCatalog } from '../../ndsTypes'
import { hasCompleteMonotypeStarterSpecies } from './modules/monotypeModule'
import {
  allBattlesInDuoModuleId,
  carryMoneyModuleId,
  carryPokedexModuleId,
  createBuiltInNewGamePlusRegistry,
  eeveeTeamModuleId,
  monotypeModuleId,
  soloRunModuleId,
} from './modules/index'
import {
  newGamePlusIndependentGameplayModuleIds,
  type NewGamePlusTeamFormatId,
} from './newGamePlusFirstBadgeFormatMatrix'
import type {
  NewGamePlusJsonValue,
  NewGamePlusProfileDraft,
  NewGamePlusProfileV1,
  NewGamePlusSource,
} from './newGamePlusTypes'

export const newGamePlusFirstBadgeAllConfigurationsExpectedCounts = Object.freeze({
  monotypeConfigurations: 17,
  soloConfigurations: 493,
  soloMonotypeConfigurations: 716,
  teamConfigurations: 2_456,
  independentGameplayVariants: 64,
  transferVariants: 4,
  gameplayProfiles: 157_184,
  completeProfiles: 628_736,
})

/**
 * Preuve factorisée du produit complet :
 *
 * - l'axe équipe couvre toutes les configurations qui changent l'équipe
 *   initiale ou son admissibilité (2 456 variantes IPKF) ;
 * - les six modules de gameplay indépendants forment 2^6 = 64 masques ;
 * - les deux transferts, sans port de combat, forment 2^2 = 4 masques ;
 * - les 628 736 coordonnées du produit sont énumérées dans un ordre mixte
 *   stable, sans exécuter 157 184 combats d'Albert redondants.
 */
export const newGamePlusFirstBadgeAllConfigurationsFactorization = Object.freeze({
  formula: '(2 456 équipes × 64 gameplays) × 4 transferts = 628 736 profils',
  teamAxisProof: 'Chaque configuration est créée, activée et reprise individuellement.',
  gameplayAxisProof: 'Les 64 masques sont composés avec un représentant de chacune des 10 familles d’équipe.',
  transferAxisProof: 'Les 4 masques sont validés séparément car ils ne contribuent aucun port de combat.',
  battleProof: 'Albert est exécuté seulement pour les classes matérielles simple, duo, duo à un participant, Randomizer, Monotype, Solo et Équipe Évoli.',
})

type NewGamePlusModuleDraft = NewGamePlusProfileDraft['modules'][number]

export type NewGamePlusFirstBadgeAllTeamConfiguration = Readonly<{
  id: string
  teamFormatId: NewGamePlusTeamFormatId
  moduleDrafts: readonly NewGamePlusModuleDraft[]
  allBattlesInDuo: boolean
  monotypeTypeId?: number
  soloSpeciesId?: number
  expectedInitialTeamSize: 1 | 2 | 6
}>

export type NewGamePlusFirstBadgeAllModuleVariant = Readonly<{
  mask: number
  moduleIds: readonly string[]
}>

export type NewGamePlusFirstBadgeAllConfigurationAxes = Readonly<{
  monotypeTypeIds: readonly number[]
  soloSpeciesIds: readonly number[]
  soloMonotypePairs: readonly Readonly<{ typeId: number, speciesId: number }>[]
  teamConfigurations: readonly NewGamePlusFirstBadgeAllTeamConfiguration[]
  independentGameplayVariants: readonly NewGamePlusFirstBadgeAllModuleVariant[]
  transferVariants: readonly NewGamePlusFirstBadgeAllModuleVariant[]
  gameplayProfileCount: number
  completeProfileCount: number
}>

export type NewGamePlusFirstBadgeAllProfileCoordinate = Readonly<{
  linearIndex: number
  teamConfigurationIndex: number
  independentGameplayMask: number
  transferMask: number
}>

export type NewGamePlusFirstBadgeAllMaterializedProfile = Readonly<{
  id: string
  coordinate: NewGamePlusFirstBadgeAllProfileCoordinate
  teamConfiguration: NewGamePlusFirstBadgeAllTeamConfiguration
  independentGameplayModuleIds: readonly string[]
  transferModuleIds: readonly string[]
  profile: NewGamePlusProfileV1
}>

export type NewGamePlusFirstBadgeAllConfigurationsValidationReport = Readonly<{
  monotypeConfigurationsValidated: number
  soloConfigurationsValidated: number
  soloMonotypeConfigurationsValidated: number
  teamConfigurationsValidated: number
  canonicalGameplayCompositionsValidated: number
  transferVariantsValidated: number
  gameplayCoordinatesValidated: number
  completeProfileCoordinatesValidated: number
  materializedAxisProfilesValidated: number
}>

const transferModuleIds = Object.freeze([carryPokedexModuleId, carryMoneyModuleId])
const teamRuleModuleIds = Object.freeze([
  allBattlesInDuoModuleId,
  monotypeModuleId,
  soloRunModuleId,
  eeveeTeamModuleId,
])
const builtInRegistry = createBuiltInNewGamePlusRegistry()

function includesBit(mask: number, index: number): boolean {
  return (mask & (1 << index)) !== 0
}

function freezeModuleDraft(
  id: string,
  config?: NewGamePlusJsonValue,
): NewGamePlusModuleDraft {
  return Object.freeze(config === undefined ? { id } : { id, config })
}

function freezeTeamConfiguration(
  value: NewGamePlusFirstBadgeAllTeamConfiguration,
): NewGamePlusFirstBadgeAllTeamConfiguration {
  return Object.freeze({
    ...value,
    moduleDrafts: Object.freeze([...value.moduleDrafts]),
  })
}

function createModuleVariants(moduleIds: readonly string[]): readonly NewGamePlusFirstBadgeAllModuleVariant[] {
  return Object.freeze(Array.from({ length: 2 ** moduleIds.length }, (_, mask) => Object.freeze({
    mask,
    moduleIds: Object.freeze(moduleIds.filter((_, index) => includesBit(mask, index))),
  })))
}

function isSoloSpeciesExposed(catalog: PokemonCatalog, speciesId: number): boolean {
  const personal = catalog.personalData[speciesId]
  return personal?.speciesId === speciesId && Boolean(catalog.speciesNames[speciesId])
}

function createTeamConfigurations(
  monotypeTypeIds: readonly number[],
  soloSpeciesIds: readonly number[],
  soloMonotypePairs: readonly Readonly<{ typeId: number, speciesId: number }>[],
): readonly NewGamePlusFirstBadgeAllTeamConfiguration[] {
  const duo = freezeModuleDraft(allBattlesInDuoModuleId)
  const eevee = freezeModuleDraft(eeveeTeamModuleId)
  const configurations: NewGamePlusFirstBadgeAllTeamConfiguration[] = [
    freezeTeamConfiguration({
      id: 'standard',
      teamFormatId: 'standard',
      moduleDrafts: [],
      allBattlesInDuo: false,
      expectedInitialTeamSize: 1,
    }),
    freezeTeamConfiguration({
      id: 'duo',
      teamFormatId: 'duo',
      moduleDrafts: [duo],
      allBattlesInDuo: true,
      expectedInitialTeamSize: 2,
    }),
  ]

  for (const typeId of monotypeTypeIds) {
    const monotype = freezeModuleDraft(monotypeModuleId, { typeId })
    configurations.push(
      freezeTeamConfiguration({
        id: `monotype:type=${typeId}`,
        teamFormatId: 'monotype',
        moduleDrafts: [monotype],
        allBattlesInDuo: false,
        monotypeTypeId: typeId,
        expectedInitialTeamSize: 1,
      }),
      freezeTeamConfiguration({
        id: `duo-monotype:type=${typeId}`,
        teamFormatId: 'duo-monotype',
        moduleDrafts: [duo, monotype],
        allBattlesInDuo: true,
        monotypeTypeId: typeId,
        expectedInitialTeamSize: 2,
      }),
    )
  }

  for (const speciesId of soloSpeciesIds) {
    const solo = freezeModuleDraft(soloRunModuleId, { speciesId, form: 0 })
    configurations.push(
      freezeTeamConfiguration({
        id: `solo:species=${speciesId}:form=0`,
        teamFormatId: 'solo',
        moduleDrafts: [solo],
        allBattlesInDuo: false,
        soloSpeciesId: speciesId,
        expectedInitialTeamSize: 1,
      }),
      freezeTeamConfiguration({
        id: `duo-solo:species=${speciesId}:form=0`,
        teamFormatId: 'duo-solo',
        moduleDrafts: [duo, solo],
        allBattlesInDuo: true,
        soloSpeciesId: speciesId,
        expectedInitialTeamSize: 1,
      }),
    )
  }

  for (const { typeId, speciesId } of soloMonotypePairs) {
    const monotype = freezeModuleDraft(monotypeModuleId, { typeId })
    const solo = freezeModuleDraft(soloRunModuleId, { speciesId, form: 0 })
    configurations.push(
      freezeTeamConfiguration({
        id: `solo-monotype:type=${typeId}:species=${speciesId}:form=0`,
        teamFormatId: 'solo-monotype',
        moduleDrafts: [monotype, solo],
        allBattlesInDuo: false,
        monotypeTypeId: typeId,
        soloSpeciesId: speciesId,
        expectedInitialTeamSize: 1,
      }),
      freezeTeamConfiguration({
        id: `duo-solo-monotype:type=${typeId}:species=${speciesId}:form=0`,
        teamFormatId: 'duo-solo-monotype',
        moduleDrafts: [duo, monotype, solo],
        allBattlesInDuo: true,
        monotypeTypeId: typeId,
        soloSpeciesId: speciesId,
        expectedInitialTeamSize: 1,
      }),
    )
  }

  configurations.push(
    freezeTeamConfiguration({
      id: 'eevee-team',
      teamFormatId: 'eevee-team',
      moduleDrafts: [eevee],
      allBattlesInDuo: false,
      expectedInitialTeamSize: 6,
    }),
    freezeTeamConfiguration({
      id: 'duo-eevee-team',
      teamFormatId: 'duo-eevee-team',
      moduleDrafts: [duo, eevee],
      allBattlesInDuo: true,
      expectedInitialTeamSize: 6,
    }),
  )
  return Object.freeze(configurations)
}

/** Construit les trois axes depuis le catalogue réellement exposé à l'UI NG+. */
export function createNewGamePlusFirstBadgeAllConfigurationAxes(
  catalog: PokemonCatalog,
): NewGamePlusFirstBadgeAllConfigurationAxes {
  const monotypeTypeIds = Object.freeze(Array.from({ length: 18 }, (_, typeId) => typeId)
    .filter((typeId) => hasCompleteMonotypeStarterSpecies(catalog, typeId)))
  const soloSpeciesIds = Object.freeze(Array.from({ length: 493 }, (_, index) => index + 1)
    .filter((speciesId) => isSoloSpeciesExposed(catalog, speciesId)))
  const monotypeTypeSet = new Set(monotypeTypeIds)
  const soloMonotypePairs = Object.freeze(soloSpeciesIds.flatMap((speciesId) => {
    const personal = catalog.personalData[speciesId]
    if (!personal) return []
    return [...new Set(personal.types)]
      .filter((typeId) => monotypeTypeSet.has(typeId))
      .map((typeId) => Object.freeze({ typeId, speciesId }))
  }).sort((left, right) => left.typeId - right.typeId || left.speciesId - right.speciesId))
  const teamConfigurations = createTeamConfigurations(monotypeTypeIds, soloSpeciesIds, soloMonotypePairs)
  const independentGameplayVariants = createModuleVariants(newGamePlusIndependentGameplayModuleIds)
  const transferVariants = createModuleVariants(transferModuleIds)
  return Object.freeze({
    monotypeTypeIds,
    soloSpeciesIds,
    soloMonotypePairs,
    teamConfigurations,
    independentGameplayVariants,
    transferVariants,
    gameplayProfileCount: teamConfigurations.length * independentGameplayVariants.length,
    completeProfileCount: teamConfigurations.length * independentGameplayVariants.length * transferVariants.length,
  })
}

function assertExactCount(actual: number, expected: number, label: string): void {
  if (actual !== expected) {
    throw new Error(`La couverture NG+ complète contient ${actual} ${label} au lieu de ${expected}.`)
  }
}

/** Verrouille explicitement les invariants observés dans la ROM française IPKF. */
export function assertNewGamePlusFirstBadgeAllConfigurationCounts(
  axes: NewGamePlusFirstBadgeAllConfigurationAxes,
): void {
  const expected = newGamePlusFirstBadgeAllConfigurationsExpectedCounts
  assertExactCount(axes.monotypeTypeIds.length, expected.monotypeConfigurations, 'types Monotype')
  assertExactCount(axes.soloSpeciesIds.length, expected.soloConfigurations, 'espèces Solo')
  assertExactCount(axes.soloMonotypePairs.length, expected.soloMonotypeConfigurations, 'couples Solo+Monotype')
  assertExactCount(axes.teamConfigurations.length, expected.teamConfigurations, 'configurations d’équipe')
  assertExactCount(axes.independentGameplayVariants.length, expected.independentGameplayVariants, 'masques de gameplay')
  assertExactCount(axes.transferVariants.length, expected.transferVariants, 'masques de transfert')
  assertExactCount(axes.gameplayProfileCount, expected.gameplayProfiles, 'profils de gameplay')
  assertExactCount(axes.completeProfileCount, expected.completeProfiles, 'profils complets')
}

function requireIntegerInRange(value: number, maximumExclusive: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value >= maximumExclusive) {
    throw new Error(`${label} ${value} est hors de la couverture NG+ complète.`)
  }
  return value
}

export function encodeNewGamePlusFirstBadgeAllProfileCoordinate(
  axes: NewGamePlusFirstBadgeAllConfigurationAxes,
  coordinate: Omit<NewGamePlusFirstBadgeAllProfileCoordinate, 'linearIndex'>,
): number {
  const teamConfigurationIndex = requireIntegerInRange(
    coordinate.teamConfigurationIndex,
    axes.teamConfigurations.length,
    'La configuration d’équipe',
  )
  const independentGameplayMask = requireIntegerInRange(
    coordinate.independentGameplayMask,
    axes.independentGameplayVariants.length,
    'Le masque de gameplay',
  )
  const transferMask = requireIntegerInRange(
    coordinate.transferMask,
    axes.transferVariants.length,
    'Le masque de transfert',
  )
  return ((teamConfigurationIndex * axes.independentGameplayVariants.length) + independentGameplayMask)
    * axes.transferVariants.length + transferMask
}

export function decodeNewGamePlusFirstBadgeAllProfileCoordinate(
  axes: NewGamePlusFirstBadgeAllConfigurationAxes,
  linearIndex: number,
): NewGamePlusFirstBadgeAllProfileCoordinate {
  const index = requireIntegerInRange(linearIndex, axes.completeProfileCount, 'L’index de profil')
  const transferMask = index % axes.transferVariants.length
  const gameplayCoordinate = Math.floor(index / axes.transferVariants.length)
  const independentGameplayMask = gameplayCoordinate % axes.independentGameplayVariants.length
  const teamConfigurationIndex = Math.floor(gameplayCoordinate / axes.independentGameplayVariants.length)
  return Object.freeze({ linearIndex: index, teamConfigurationIndex, independentGameplayMask, transferMask })
}

/** Énumération paresseuse et exhaustive des 628 736 coordonnées de profil. */
export function* iterateNewGamePlusFirstBadgeAllProfileCoordinates(
  axes: NewGamePlusFirstBadgeAllConfigurationAxes,
): Generator<NewGamePlusFirstBadgeAllProfileCoordinate, void, undefined> {
  for (let linearIndex = 0; linearIndex < axes.completeProfileCount; linearIndex += 1) {
    yield decodeNewGamePlusFirstBadgeAllProfileCoordinate(axes, linearIndex)
  }
}

function createOrderedProfile(
  source: NewGamePlusSource,
  drafts: readonly NewGamePlusModuleDraft[],
): NewGamePlusProfileV1 {
  const draftById = new Map(drafts.map((draft) => [draft.id, draft]))
  if (draftById.size !== drafts.length) throw new Error('Un module est dupliqué dans le profil NG+ complet.')
  const modules = builtInRegistry.listModules().flatMap(({ id }) => {
    const draft = draftById.get(id)
    return draft ? [draft] : []
  })
  if (modules.length !== drafts.length) throw new Error('Un module du profil NG+ complet est absent du registre intégré.')
  return builtInRegistry.createProfile({ source, modules })
}

export function materializeNewGamePlusFirstBadgeAllProfile(
  source: NewGamePlusSource,
  axes: NewGamePlusFirstBadgeAllConfigurationAxes,
  coordinateValue: NewGamePlusFirstBadgeAllProfileCoordinate,
): NewGamePlusFirstBadgeAllMaterializedProfile {
  const coordinate = decodeNewGamePlusFirstBadgeAllProfileCoordinate(axes, coordinateValue.linearIndex)
  if (coordinate.teamConfigurationIndex !== coordinateValue.teamConfigurationIndex
    || coordinate.independentGameplayMask !== coordinateValue.independentGameplayMask
    || coordinate.transferMask !== coordinateValue.transferMask) {
    throw new Error('La coordonnée du profil NG+ complet n’est pas canonique.')
  }
  const teamConfiguration = axes.teamConfigurations[coordinate.teamConfigurationIndex]!
  const independentGameplayVariant = axes.independentGameplayVariants[coordinate.independentGameplayMask]!
  const transferVariant = axes.transferVariants[coordinate.transferMask]!
  const drafts = [
    ...teamConfiguration.moduleDrafts,
    ...independentGameplayVariant.moduleIds.map((id) => freezeModuleDraft(id)),
    ...transferVariant.moduleIds.map((id) => freezeModuleDraft(id)),
  ]
  const profile = createOrderedProfile(source, drafts)
  return Object.freeze({
    id: `ngp-first-badge-all-v1/${teamConfiguration.id}/g=${coordinate.independentGameplayMask}/t=${coordinate.transferMask}`,
    coordinate,
    teamConfiguration,
    independentGameplayModuleIds: independentGameplayVariant.moduleIds,
    transferModuleIds: transferVariant.moduleIds,
    profile,
  })
}

/**
 * Générateur paresseux des profils complets. Le gate emploie le validateur
 * factorisé ci-dessous ; cet itérateur reste disponible pour un export, un
 * audit ou un shard qui doit matérialiser tout ou partie des 628 736 profils.
 */
export function* iterateNewGamePlusFirstBadgeAllProfiles(
  source: NewGamePlusSource,
  axes: NewGamePlusFirstBadgeAllConfigurationAxes,
): Generator<NewGamePlusFirstBadgeAllMaterializedProfile, void, undefined> {
  for (const coordinate of iterateNewGamePlusFirstBadgeAllProfileCoordinates(axes)) {
    yield materializeNewGamePlusFirstBadgeAllProfile(source, axes, coordinate)
  }
}

function materializeAxisProfile(
  source: NewGamePlusSource,
  teamConfiguration: NewGamePlusFirstBadgeAllTeamConfiguration,
  gameplayVariant: NewGamePlusFirstBadgeAllModuleVariant,
  transferVariant: NewGamePlusFirstBadgeAllModuleVariant,
): NewGamePlusProfileV1 {
  return createOrderedProfile(source, [
    ...teamConfiguration.moduleDrafts,
    ...gameplayVariant.moduleIds.map((id) => freezeModuleDraft(id)),
    ...transferVariant.moduleIds.map((id) => freezeModuleDraft(id)),
  ])
}

function assertEveryModuleClassified(): void {
  const registryIds = builtInRegistry.listModules().map(({ id }) => id)
  const classifiedIds = [...transferModuleIds, ...newGamePlusIndependentGameplayModuleIds, ...teamRuleModuleIds]
  if (new Set(classifiedIds).size !== classifiedIds.length
    || registryIds.length !== classifiedIds.length
    || classifiedIds.some((id) => !registryIds.includes(id))) {
    throw new Error('La factorisation de toutes les configurations NG+ ne classe plus exactement le registre intégré.')
  }
}

/**
 * Valide le produit complet par bijection et matérialise exhaustivement chaque
 * valeur d'axe. Les interactions sont couvertes par 10 × 64 compositions
 * canoniques ; les tests ROM exécutent ensuite seulement les classes de combat
 * matériellement différentes.
 */
export function validateNewGamePlusFirstBadgeAllConfigurations(
  source: NewGamePlusSource,
  axes: NewGamePlusFirstBadgeAllConfigurationAxes,
): NewGamePlusFirstBadgeAllConfigurationsValidationReport {
  assertNewGamePlusFirstBadgeAllConfigurationCounts(axes)
  assertEveryModuleClassified()
  const emptyGameplay = axes.independentGameplayVariants[0]!
  const emptyTransfer = axes.transferVariants[0]!
  let materializedAxisProfilesValidated = 0

  for (const teamConfiguration of axes.teamConfigurations) {
    materializeAxisProfile(source, teamConfiguration, emptyGameplay, emptyTransfer)
    materializedAxisProfilesValidated += 1
  }

  const familyRepresentatives = new Map<NewGamePlusTeamFormatId, NewGamePlusFirstBadgeAllTeamConfiguration>()
  for (const teamConfiguration of axes.teamConfigurations) {
    if (!familyRepresentatives.has(teamConfiguration.teamFormatId)) {
      familyRepresentatives.set(teamConfiguration.teamFormatId, teamConfiguration)
    }
  }
  for (const teamConfiguration of familyRepresentatives.values()) {
    for (const gameplayVariant of axes.independentGameplayVariants) {
      materializeAxisProfile(source, teamConfiguration, gameplayVariant, emptyTransfer)
      materializedAxisProfilesValidated += 1
    }
  }
  const standard = familyRepresentatives.get('standard')
  if (!standard || familyRepresentatives.size !== 10) {
    throw new Error(`La couverture NG+ complète possède ${familyRepresentatives.size} familles d’équipe au lieu de 10.`)
  }
  for (const transferVariant of axes.transferVariants) {
    materializeAxisProfile(source, standard, emptyGameplay, transferVariant)
    materializedAxisProfilesValidated += 1
  }

  let completeProfileCoordinatesValidated = 0
  let gameplayCoordinatesValidated = 0
  for (const coordinate of iterateNewGamePlusFirstBadgeAllProfileCoordinates(axes)) {
    const encoded = encodeNewGamePlusFirstBadgeAllProfileCoordinate(axes, coordinate)
    if (encoded !== coordinate.linearIndex) throw new Error(`La coordonnée NG+ ${coordinate.linearIndex} n’est pas bijective.`)
    completeProfileCoordinatesValidated += 1
    if (coordinate.transferMask === 0) gameplayCoordinatesValidated += 1
  }
  assertExactCount(completeProfileCoordinatesValidated, axes.completeProfileCount, 'coordonnées complètes validées')
  assertExactCount(gameplayCoordinatesValidated, axes.gameplayProfileCount, 'coordonnées de gameplay validées')

  return Object.freeze({
    monotypeConfigurationsValidated: axes.monotypeTypeIds.length,
    soloConfigurationsValidated: axes.soloSpeciesIds.length,
    soloMonotypeConfigurationsValidated: axes.soloMonotypePairs.length,
    teamConfigurationsValidated: axes.teamConfigurations.length,
    canonicalGameplayCompositionsValidated: familyRepresentatives.size * axes.independentGameplayVariants.length,
    transferVariantsValidated: axes.transferVariants.length,
    gameplayCoordinatesValidated,
    completeProfileCoordinatesValidated,
    materializedAxisProfilesValidated,
  })
}
