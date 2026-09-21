import { defineNewGamePlusModule } from '../newGamePlusTypes'
import { isJsonSaveValue } from '../../save/versionedSaveExtensions'

export const hardcoreModuleId = 'hardcore'

/**
 * Une étape explicite de la campagne. `progression` est la valeur monotone que
 * le runtime hôte fournit. Le libellé d'UI est résolu localement depuis
 * `nextMajorBattleId`; il n'est jamais recopié dans la sauvegarde.
 */
export type HardcoreLevelCapStage = Readonly<{
  progression: number
  nextMajorBattleId?: number
  /** Entrée legacy acceptée uniquement par le décodeur puis supprimée. */
  nextMajorBattle?: string
  levelCap: number
}>

export type HardcoreConfig = Readonly<{
  levelCaps: readonly HardcoreLevelCapStage[]
}>

const configKeys = ['levelCaps'] as const
const stageKeys = ['levelCap', 'nextMajorBattleId', 'progression'] as const
const legacyStageKeys = ['levelCap', 'nextMajorBattle', 'progression'] as const

/** Progression HGSS par nombre de badges ; les embranchements gardent le cap sûr le plus haut. */
export const defaultHardcoreConfig: HardcoreConfig = Object.freeze({
  levelCaps: Object.freeze([
    [0, 0, 13], [1, 1, 17], [2, 2, 19], [3, 3, 25], [4, 4, 31], [5, 5, 35],
    [6, 6, 41], [8, 7, 50], [9, 8, 54], [11, 9, 56], [13, 10, 60], [16, 11, 88],
  ].map(([progression, nextMajorBattleId, levelCap]) => Object.freeze({
    progression: progression as number,
    nextMajorBattleId: nextMajorBattleId as number,
    levelCap: levelCap as number,
  }))),
})

function requirePlainRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} doit être un objet JSON.`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${path} doit être un objet JSON simple.`)
  }
  return value as Record<string, unknown>
}

function requireExactKeys(record: Record<string, unknown>, expected: readonly string[], path: string): void {
  const actual = Object.keys(record).sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${path} contient des champs inconnus ou manquants.`)
  }
}

function requireProgression(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${path} doit être un entier positif ou nul.`)
  }
  return value as number
}

function requireLevelCap(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 100) {
    throw new Error(`${path} doit être un entier compris entre 1 et 100.`)
  }
  return value as number
}

function requireMajorBattleLabel(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 160 || value.trim() !== value) {
    throw new Error(`${path} doit être un libellé non vide, sans espaces de bord (160 caractères maximum).`)
  }
  return value
}

function requireMajorBattleId(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 0xffff) {
    throw new Error(`${path} doit être un identifiant numérique local.`)
  }
  return value as number
}

function decodeStage(value: unknown, index: number): HardcoreLevelCapStage {
  const path = `La configuration Hardcore.levelCaps[${index}]`
  const stage = requirePlainRecord(value, path)
  const legacy = Object.hasOwn(stage, 'nextMajorBattle')
  requireExactKeys(stage, legacy ? legacyStageKeys : stageKeys, path)
  if (legacy) requireMajorBattleLabel(stage.nextMajorBattle, `${path}.nextMajorBattle`)
  return Object.freeze({
    progression: requireProgression(stage.progression, `${path}.progression`),
    nextMajorBattleId: legacy ? index : requireMajorBattleId(stage.nextMajorBattleId, `${path}.nextMajorBattleId`),
    levelCap: requireLevelCap(stage.levelCap, `${path}.levelCap`),
  })
}

/** Décode et fige profondément la configuration JSON possédée par le profil. */
export function decodeHardcoreConfig(value: unknown): HardcoreConfig {
  if (!isJsonSaveValue(value)) {
    throw new Error("La configuration Hardcore n'est pas une valeur JSON stricte.")
  }
  const config = requirePlainRecord(value, 'La configuration Hardcore')
  requireExactKeys(config, configKeys, 'La configuration Hardcore')
  if (!Array.isArray(config.levelCaps) || config.levelCaps.length === 0) {
    throw new Error('La configuration Hardcore.levelCaps doit contenir au moins une étape explicite.')
  }

  const levelCaps = config.levelCaps.map(decodeStage)
  if (levelCaps[0]!.progression !== 0) {
    throw new Error('La première étape Hardcore doit commencer à la progression 0.')
  }
  for (let index = 1; index < levelCaps.length; index += 1) {
    const previous = levelCaps[index - 1]!
    const current = levelCaps[index]!
    if (current.progression <= previous.progression) {
      throw new Error('Les étapes Hardcore doivent être classées par progression strictement croissante.')
    }
    if (current.levelCap < previous.levelCap) {
      throw new Error('Les plafonds Hardcore ne peuvent pas diminuer au fil de la progression.')
    }
  }
  return Object.freeze({ levelCaps: Object.freeze(levelCaps) })
}

/** Le registre stocke la table ; les ports runtime sont montés séparément. */
export const hardcoreModule = defineNewGamePlusModule<HardcoreConfig>({
  id: hardcoreModuleId,
  revision: 1,
  title: 'Hardcore',
  description: 'Plafond du prochain combat majeur, sans objet tactique du sac ni changement volontaire ; les Balls restent disponibles.',
  enabledByDefault: false,
  createDefaultConfig: () => ({
    levelCaps: defaultHardcoreConfig.levelCaps.map((stage) => ({ ...stage })),
  }),
  decodeConfig: decodeHardcoreConfig,
  apply: () => undefined,
})
