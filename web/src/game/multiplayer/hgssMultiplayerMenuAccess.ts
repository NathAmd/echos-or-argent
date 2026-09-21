import type { MainMenuCommand, MainMenuState } from '../menu/mainMenuController'

export type HgssMultiplayerMenuAccessOptions = Readonly<{
  closeMenu: () => MainMenuState
  renderMenu: (state: MainMenuState) => void
  openMultiplayer: () => void
}>

/**
 * Ferme d'abord le burger afin que la coque multijoueur devienne l'unique
 * propriétaire des entrées. La connexion reste entièrement paresseuse : ce
 * module ne crée ni client réseau ni session tant que la commande n'est pas
 * effectivement activée.
 */
export function applyHgssMultiplayerMenuAccess(
  command: MainMenuCommand,
  options: HgssMultiplayerMenuAccessOptions,
): boolean {
  if (command !== 'multiplayer') return false
  options.renderMenu(options.closeMenu())
  options.openMultiplayer()
  return true
}
