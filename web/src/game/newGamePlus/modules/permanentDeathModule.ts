import { defineNewGamePlusModule } from '../newGamePlusTypes'

export const permanentDeathModuleId = 'permanent-death'

export type PermanentDeathConfig = Readonly<Record<string, never>>

export function decodePermanentDeathConfig(value: unknown): PermanentDeathConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).length !== 0) {
    throw new Error('Mort définitive attend un objet de configuration vide.')
  }
  return Object.freeze({})
}

/** Marqueur de profil ; les ports stateful sont créés séparément. */
export const permanentDeathModule = defineNewGamePlusModule<PermanentDeathConfig>({
  id: permanentDeathModuleId,
  revision: 1,
  title: 'Mort définitive',
  description: 'Tout Pokémon joueur mis K.O. ne peut plus combattre ni être soigné.',
  enabledByDefault: false,
  createDefaultConfig: () => Object.freeze({}),
  decodeConfig: decodePermanentDeathConfig,
  apply: () => undefined,
})
