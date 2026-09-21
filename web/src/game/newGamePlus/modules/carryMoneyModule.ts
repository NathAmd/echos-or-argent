import { defineNewGamePlusModule } from '../newGamePlusTypes'

export const carryMoneyModuleId = 'carry-money'
export const hgssMaximumMoney = 999_999

export type CarryMoneyConfig = Readonly<{
  /** Pourcentage entier de l'argent de la partie source, entre 0 et 100. */
  percentage: number
}>

export const defaultCarryMoneyConfig: CarryMoneyConfig = Object.freeze({ percentage: 100 })

function decodeCarryMoneyConfig(value: unknown): CarryMoneyConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('carry-money attend un objet de configuration.')
  }
  const config = value as Record<string, unknown>
  if (Object.keys(config).some((key) => key !== 'percentage')
    || !Number.isInteger(config.percentage)
    || (config.percentage as number) < 0
    || (config.percentage as number) > 100) {
    throw new Error('carry-money attend uniquement un pourcentage entier entre 0 et 100.')
  }
  return { percentage: config.percentage as number }
}

export const carryMoneyModule = defineNewGamePlusModule<CarryMoneyConfig>({
  id: carryMoneyModuleId,
  revision: 1,
  title: 'Conserver l’argent',
  description: 'Transfère l’argent de la partie terminée (100 % avec le réglage actuel).',
  enabledByDefault: false,
  createDefaultConfig: () => ({ ...defaultCarryMoneyConfig }),
  decodeConfig: decodeCarryMoneyConfig,
  apply: ({ source, destination }, config) => {
    const sourceMoney = Math.max(0, Math.min(hgssMaximumMoney, Math.trunc(source.money)))
    destination.money = Math.floor(sourceMoney * config.percentage / 100)
  },
})
