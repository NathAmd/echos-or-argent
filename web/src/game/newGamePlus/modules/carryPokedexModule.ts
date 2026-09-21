import { cloneHgssPokedex } from '../../pokedex/hgssPokedex'
import { defineNewGamePlusModule } from '../newGamePlusTypes'

export const carryPokedexModuleId = 'carry-pokedex'

export type CarryPokedexConfig = Readonly<{
  includeNationalDex: boolean
}>

export const defaultCarryPokedexConfig: CarryPokedexConfig = Object.freeze({ includeNationalDex: true })

function decodeCarryPokedexConfig(value: unknown): CarryPokedexConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('carry-pokedex attend un objet de configuration.')
  }
  const config = value as Record<string, unknown>
  if (Object.keys(config).some((key) => key !== 'includeNationalDex') || typeof config.includeNationalDex !== 'boolean') {
    throw new Error('carry-pokedex attend uniquement includeNationalDex (booléen).')
  }
  return { includeNationalDex: config.includeNationalDex }
}

export const carryPokedexModule = defineNewGamePlusModule<CarryPokedexConfig>({
  id: carryPokedexModuleId,
  revision: 1,
  title: 'Conserver le Pokédex',
  description: 'Recopie les espèces, formes et langues enregistrées dans la partie terminée.',
  enabledByDefault: false,
  createDefaultConfig: () => ({ ...defaultCarryPokedexConfig }),
  decodeConfig: decodeCarryPokedexConfig,
  apply: ({ source, destination }, config) => {
    destination.pokedex = cloneHgssPokedex(source.pokedex)
    if (!config.includeNationalDex) destination.pokedex.nationalDexEnabled = false
  },
})
