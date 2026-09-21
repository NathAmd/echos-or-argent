import { defineNewGamePlusModule } from '../newGamePlusTypes'

export const nuzlockeModuleId = 'nuzlocke'

export type NuzlockeConfig = Readonly<Record<string, never>>

function decodeNuzlockeConfig(value: unknown): NuzlockeConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).length !== 0) {
    throw new Error('nuzlocke attend un objet de configuration vide.')
  }
  return Object.freeze({})
}

/**
 * Marqueur de profil. Les ports de gameplay sont montés séparément par
 * createNuzlockeRuntime afin que l'application d'un profil reste atomique.
 */
export const nuzlockeModule = defineNewGamePlusModule<NuzlockeConfig>({
  id: nuzlockeModuleId,
  revision: 1,
  title: 'Nuzlocke',
  description: 'Une seule première rencontre capturable par zone.',
  enabledByDefault: false,
  createDefaultConfig: () => Object.freeze({}),
  decodeConfig: decodeNuzlockeConfig,
  apply: () => undefined,
})
