import type { MainMenuItem, MainMenuScreen } from './mainMenuController'

export type UtilityMenuSection = 'entries' | 'apps' | 'contacts' | 'pockets' | 'items' | 'actions' | 'settings' | 'system'

export function getUtilityMenuSection(screen: MainMenuScreen, item: MainMenuItem): UtilityMenuSection {
  if (screen === 'bag') {
    if (item.id.startsWith('bag-pocket:')) return 'pockets'
    if (item.id.startsWith('bag-item:')) return 'items'
    return 'actions'
  }
  if (screen === 'team') return item.id.startsWith('team-member:') ? 'entries' : 'actions'
  if (screen === 'pokegear') return 'apps'
  if (screen === 'options') return ['save', 'report-bug', 'emergency-unstick', 'new-game'].includes(item.id) ? 'system' : 'settings'
  return 'entries'
}

export function getUtilityMenuSectionLabel(
  screen: MainMenuScreen,
  section: UtilityMenuSection,
  context: { teamPokemonName?: string, nationalDexEnabled: boolean },
): string {
  if (section === 'pockets') return 'Poches'
  if (section === 'items') return 'Objets'
  if (section === 'actions') return screen === 'team'
    ? `Actions · ${context.teamPokemonName ?? 'Pokémon'}`
    : 'Actions disponibles'
  if (section === 'settings') return 'Préférences'
  if (section === 'apps') return 'Applications'
  if (section === 'contacts') return 'Contacts'
  if (section === 'system') return 'Partie et assistance'
  if (screen === 'pokedex') return context.nationalDexEnabled ? 'Pokédex national' : 'Pokédex de Johto'
  if (screen === 'team') return 'Équipe'
  if (screen === 'pokegear') return 'Fonctions'
  return 'Navigation'
}
