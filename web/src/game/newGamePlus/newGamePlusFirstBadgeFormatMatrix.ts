import {
  allBattlesInDuoModuleId,
  allPokemonAccessibleModuleId,
  carryMoneyModuleId,
  carryPokedexModuleId,
  createBuiltInNewGamePlusRegistry,
  eeveeTeamModuleId,
  hardcoreModuleId,
  monotypeModuleId,
  nuzlockeModuleId,
  permanentDeathModuleId,
  randomizerModuleId,
  soloRunModuleId,
  visibleWildPokemonModuleId,
} from './modules/index'
import { assertNewGamePlusTeamRuleCompatibility } from './modules/teamRuleCompatibility'
import type { NewGamePlusProfileV1, NewGamePlusSource } from './newGamePlusTypes'

export const newGamePlusFirstBadgeGameplayFormatCount = 640 as const
export const newGamePlusFirstBadgeCompleteFormatCount = 2_560 as const

/** Options de transfert initial : elles ne changent pas les règles de gameplay. */
export const newGamePlusTransferModuleIds = Object.freeze([
  carryPokedexModuleId,
  carryMoneyModuleId,
])

/** Règles sans conflit d'activation avec une autre règle intégrée. */
export const newGamePlusIndependentGameplayModuleIds = Object.freeze([
  nuzlockeModuleId,
  hardcoreModuleId,
  permanentDeathModuleId,
  randomizerModuleId,
  allPokemonAccessibleModuleId,
  visibleWildPokemonModuleId,
])

const independentlySelectableModuleIds = Object.freeze([
  ...newGamePlusTransferModuleIds,
  ...newGamePlusIndependentGameplayModuleIds,
])

const teamRuleModuleIds = Object.freeze([
  allBattlesInDuoModuleId,
  monotypeModuleId,
  soloRunModuleId,
  eeveeTeamModuleId,
])

export type NewGamePlusTeamFormatId =
  | 'standard'
  | 'duo'
  | 'monotype'
  | 'duo-monotype'
  | 'solo'
  | 'duo-solo'
  | 'solo-monotype'
  | 'duo-solo-monotype'
  | 'eevee-team'
  | 'duo-eevee-team'

export type NewGamePlusTeamFormat = Readonly<{
  id: NewGamePlusTeamFormatId
  moduleIds: readonly string[]
}>

/**
 * Matrice finie des règles qui possèdent ou transforment l'équipe initiale.
 * Solo+Monotype emploie ici leurs configurations canoniques compatibles
 * (Germignon, type Plante). Les variantes de catalogue sont testées à part.
 */
export const newGamePlusTeamFormats: readonly NewGamePlusTeamFormat[] = Object.freeze([
  Object.freeze({ id: 'standard', moduleIds: Object.freeze([]) }),
  Object.freeze({ id: 'duo', moduleIds: Object.freeze([allBattlesInDuoModuleId]) }),
  Object.freeze({ id: 'monotype', moduleIds: Object.freeze([monotypeModuleId]) }),
  Object.freeze({ id: 'duo-monotype', moduleIds: Object.freeze([allBattlesInDuoModuleId, monotypeModuleId]) }),
  Object.freeze({ id: 'solo', moduleIds: Object.freeze([soloRunModuleId]) }),
  Object.freeze({ id: 'duo-solo', moduleIds: Object.freeze([allBattlesInDuoModuleId, soloRunModuleId]) }),
  Object.freeze({ id: 'solo-monotype', moduleIds: Object.freeze([monotypeModuleId, soloRunModuleId]) }),
  Object.freeze({ id: 'duo-solo-monotype', moduleIds: Object.freeze([allBattlesInDuoModuleId, monotypeModuleId, soloRunModuleId]) }),
  Object.freeze({ id: 'eevee-team', moduleIds: Object.freeze([eeveeTeamModuleId]) }),
  Object.freeze({ id: 'duo-eevee-team', moduleIds: Object.freeze([allBattlesInDuoModuleId, eeveeTeamModuleId]) }),
])

export type NewGamePlusFirstBadgeFormat = Readonly<{
  /** Identifiant stable de l'ensemble complet, transferts inclus. */
  label: string
  /** Identifiant partagé par les quatre variantes de transfert du même gameplay. */
  gameplayLabel: string
  teamFormatId: NewGamePlusTeamFormatId
  moduleIds: readonly string[]
  gameplayModuleIds: readonly string[]
  transferModuleIds: readonly string[]
  profile: NewGamePlusProfileV1
}>

function formatLabel(prefix: string, moduleIds: readonly string[]): string {
  return `${prefix}:${moduleIds.length > 0 ? moduleIds.join('+') : 'base'}`
}

function includesBit(mask: number, index: number): boolean {
  return (mask & (1 << index)) !== 0
}

function assertTeamFormatCompatibility(moduleIds: ReadonlySet<string>): void {
  assertNewGamePlusTeamRuleCompatibility({
    soloRun: moduleIds.has(soloRunModuleId),
    allBattlesInDuo: moduleIds.has(allBattlesInDuoModuleId),
    eeveeTeam: moduleIds.has(eeveeTeamModuleId),
    monotype: moduleIds.has(monotypeModuleId),
  })
}

function assertEveryBuiltInModuleIsClassified(canonicalModuleIds: readonly string[]): void {
  const classifiedIds = [...independentlySelectableModuleIds, ...teamRuleModuleIds]
  const classifiedSet = new Set(classifiedIds)
  const canonicalSet = new Set(canonicalModuleIds)
  if (classifiedSet.size !== classifiedIds.length
    || canonicalSet.size !== canonicalModuleIds.length
    || classifiedSet.size !== canonicalSet.size
    || classifiedIds.some((moduleId) => !canonicalSet.has(moduleId))) {
    throw new Error('La partition des modules intégrés de la matrice NG+ premier badge est obsolète.')
  }
}

/**
 * Produit les 10 formats d'équipe multipliés par les 2^8 sélections
 * indépendantes. L'ordre et les configurations proviennent exclusivement du
 * registre intégré afin que la matrice suive sa frontière de validation.
 */
export function createNewGamePlusFirstBadgeFormatMatrix(
  source: NewGamePlusSource,
): readonly NewGamePlusFirstBadgeFormat[] {
  const registry = createBuiltInNewGamePlusRegistry()
  const canonicalModuleIds = registry.listModules().map(({ id }) => id)
  assertEveryBuiltInModuleIsClassified(canonicalModuleIds)
  const transferIds = new Set<string>(newGamePlusTransferModuleIds)
  const formats: NewGamePlusFirstBadgeFormat[] = []

  for (const teamFormat of newGamePlusTeamFormats) {
    for (let mask = 0; mask < 2 ** independentlySelectableModuleIds.length; mask += 1) {
      const selectedIds = new Set<string>(teamFormat.moduleIds)
      independentlySelectableModuleIds.forEach((moduleId, index) => {
        if (includesBit(mask, index)) selectedIds.add(moduleId)
      })
      assertTeamFormatCompatibility(selectedIds)

      const moduleIds = Object.freeze(canonicalModuleIds.filter((moduleId) => selectedIds.has(moduleId)))
      const gameplayModuleIds = Object.freeze(moduleIds.filter((moduleId) => !transferIds.has(moduleId)))
      const transferModuleIds = Object.freeze(moduleIds.filter((moduleId) => transferIds.has(moduleId)))
      const profile = registry.createProfile({
        source,
        modules: moduleIds.map((id) => ({ id })),
      })
      formats.push(Object.freeze({
        label: formatLabel('ngp-first-badge-v1', moduleIds),
        gameplayLabel: formatLabel('ngp-first-badge-gameplay-v1', gameplayModuleIds),
        teamFormatId: teamFormat.id,
        moduleIds,
        gameplayModuleIds,
        transferModuleIds,
        profile,
      }))
    }
  }

  if (formats.length !== newGamePlusFirstBadgeCompleteFormatCount) {
    throw new Error(`La matrice NG+ premier badge contient ${formats.length} formats au lieu de ${newGamePlusFirstBadgeCompleteFormatCount}.`)
  }
  return Object.freeze(formats)
}

/** Une ligne canonique sans transfert pour chacun des 640 gameplays distincts. */
export function createNewGamePlusFirstBadgeGameplayMatrix(
  source: NewGamePlusSource,
): readonly NewGamePlusFirstBadgeFormat[] {
  const gameplayFormats = createNewGamePlusFirstBadgeFormatMatrix(source)
    .filter(({ transferModuleIds }) => transferModuleIds.length === 0)
  if (gameplayFormats.length !== newGamePlusFirstBadgeGameplayFormatCount) {
    throw new Error(`La matrice de gameplay NG+ contient ${gameplayFormats.length} formats au lieu de ${newGamePlusFirstBadgeGameplayFormatCount}.`)
  }
  return Object.freeze(gameplayFormats)
}
