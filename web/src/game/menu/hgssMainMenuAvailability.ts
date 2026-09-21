import type { FieldScriptState } from '../scripts/fieldScriptRunner'
import type { MainMenuAvailability } from './mainMenuController'

export type HgssMainMenuAvailabilityEnvironment = Readonly<{
  campaignLocked: boolean
  fullscreenSupported: boolean
  fullscreenInstalled: boolean
}>

/** Projette les déblocages HGSS et le verrou Coop vers la coque du menu. */
export function resolveHgssMainMenuAvailability(
  state: FieldScriptState,
  environment: HgssMainMenuAvailabilityEnvironment,
): MainMenuAvailability {
  const { campaignLocked } = environment
  const optionsUnlocked = state.flags.has(0x11e)
  const saveUnlocked = state.flags.has(0x11d)
  return {
    pokedex: !campaignLocked && state.pokedex.enabled,
    team: !campaignLocked && state.flags.has(0x6a) && state.party.members.length > 0,
    bag: !campaignLocked && state.flags.has(0x11b),
    pokegear: !campaignLocked && state.flags.has(0x9c),
    multiplayer: true,
    save: !campaignLocked && saveUnlocked && !state.safariZone.session.active,
    retire: state.safariZone.session.active,
    options: !campaignLocked && (optionsUnlocked || saveUnlocked),
    'cycle-text-speed': !campaignLocked && optionsUnlocked,
    'toggle-battle-animations': !campaignLocked && optionsUnlocked,
    'toggle-local-weather': !campaignLocked && optionsUnlocked,
    'toggle-fullscreen': !campaignLocked && environment.fullscreenSupported && !environment.fullscreenInstalled,
    'new-game': !campaignLocked && optionsUnlocked,
  }
}
