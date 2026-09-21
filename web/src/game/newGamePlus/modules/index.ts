import { createNewGamePlusRegistry } from '../newGamePlusRegistry'
import { allBattlesInDuoModule } from './allBattlesInDuoModule'
import { allPokemonAccessibleModule } from './allPokemonAccessibleModule'
import { carryMoneyModule } from './carryMoneyModule'
import { carryPokedexModule } from './carryPokedexModule'
import { eeveeTeamModule } from './eeveeTeamModule'
import { hardcoreModule } from './hardcoreModule'
import { monotypeModule } from './monotypeModule'
import { nuzlockeModule } from './nuzlockeModule'
import { permanentDeathModule } from './permanentDeathModule'
import { randomizerModule } from './randomizerModule'
import { soloRunModule } from './soloRunModule'
import { visibleWildPokemonModule } from './visibleWildPokemonModule'

export { allBattlesInDuoModule, allBattlesInDuoModuleId, type AllBattlesInDuoConfig } from './allBattlesInDuoModule'
export { allPokemonAccessibleModule, allPokemonAccessibleModuleId, defaultAllPokemonAccessibleConfig, type AllPokemonAccessibleConfig } from './allPokemonAccessibleModule'
export { carryMoneyModule, carryMoneyModuleId, defaultCarryMoneyConfig, hgssMaximumMoney, type CarryMoneyConfig } from './carryMoneyModule'
export { carryPokedexModule, carryPokedexModuleId, defaultCarryPokedexConfig, type CarryPokedexConfig } from './carryPokedexModule'
export { eeveeTeamModule, eeveeTeamModuleId, defaultEeveeTeamConfig, type EeveeTeamConfig } from './eeveeTeamModule'
export { hardcoreModule, hardcoreModuleId, defaultHardcoreConfig, type HardcoreConfig } from './hardcoreModule'
export { monotypeModule, monotypeModuleId, defaultMonotypeConfig, type MonotypeConfig } from './monotypeModule'
export { nuzlockeModule, nuzlockeModuleId, type NuzlockeConfig } from './nuzlockeModule'
export { permanentDeathModule, permanentDeathModuleId, type PermanentDeathConfig } from './permanentDeathModule'
export { randomizerModule, randomizerModuleId, defaultRandomizerConfig, type RandomizerConfig } from './randomizerModule'
export { soloRunModule, soloRunModuleId, defaultSoloRunConfig, type SoloRunConfig } from './soloRunModule'
export { visibleWildPokemonModule, visibleWildPokemonModuleId, defaultVisibleWildPokemonConfig, type VisibleWildPokemonConfig } from './visibleWildPokemonModule'

export const builtInNewGamePlusModules = Object.freeze([
  carryPokedexModule,
  carryMoneyModule,
  nuzlockeModule,
  hardcoreModule,
  permanentDeathModule,
  randomizerModule,
  allPokemonAccessibleModule,
  visibleWildPokemonModule,
  allBattlesInDuoModule,
  monotypeModule,
  soloRunModule,
  eeveeTeamModule,
])

export function createBuiltInNewGamePlusRegistry() {
  return createNewGamePlusRegistry(builtInNewGamePlusModules)
}
