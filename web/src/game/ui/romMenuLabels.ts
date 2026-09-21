import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import type { MainMenuItem } from '../menu/mainMenuController'
import type { HgssGameOptions } from '../save/hgssGameOptions'
import { resolveMultiplayerRomLabels } from './multiplayerRomLabels'
import { formatHgssRomMessage } from './romMessageFormatting'

type RomUiBanks = Record<number, Record<number, string>>

export type RomMenuItemState = {
  value: string
  token: string
  pressed?: boolean
  position?: number
  size?: number
}

function member(item: MainMenuItem, party: readonly CanonicalPokemon[]): CanonicalPokemon | undefined {
  if (!item.id.startsWith('team-member:')) return undefined
  return party[Number.parseInt(item.id.slice('team-member:'.length), 10)]
}

/** Résout les libellés natifs par (banque, message), sans texte de secours. */
export function resolveRomMenuLabel(item: MainMenuItem, banks: RomUiBanks | undefined, party: readonly CanonicalPokemon[]): string {
  if (item.id === 'multiplayer') return resolveMultiplayerRomLabels(banks).multiplayer
  if (!banks) return ''
  const main = banks[196] ?? {}, storage = banks[24] ?? {}, partyUi = banks[6] ?? {}, options = banks[45] ?? {}, title = banks[442] ?? {}
  const pokemon = member(item, party)
  if (pokemon) return `${pokemon.nickname ?? pokemon.speciesName} · ${partyUi[23] ?? ''}${pokemon.level}`
  if (item.id.startsWith('team-summary:')) return storage[65] ?? ''
  if (item.id.startsWith('team-move-up:')) return `${storage[61] ?? ''} ↑`.trim()
  if (item.id.startsWith('team-move-down:')) return `${storage[61] ?? ''} ↓`.trim()
  if (item.id.startsWith('team-take-item:')) return storage[64] ?? ''
  if (item.id.startsWith('team-rename:')) return storage[27] ?? ''
  if (item.id.startsWith('bag-pocket:') || item.id.startsWith('bag-item:')) return item.label
  if (item.id.startsWith('bag-action-give:')) return storage[81] ?? ''
  if (item.id.startsWith('bag-action-cancel:') || item.id.startsWith('bag-machine-cancel:')) return storage[73] ?? ''
  if (item.id.startsWith('bag-action-use:') || item.id.startsWith('bag-bike:') || item.id.startsWith('bag-repel:') || item.id.startsWith('bag-fish:')) return banks[5]?.[31] ?? ''
  if (item.id.startsWith('bag-use-party:')) return storage[60] ?? ''
  if (item.id.startsWith('bag-use:') || item.id.startsWith('bag-give:') || item.id.startsWith('bag-use-move:') || item.id.startsWith('bag-machine-target:')) {
    const target = party[Number.parseInt(item.id.split(':')[2] ?? '', 10)]
    return target?.nickname ?? target?.speciesName ?? ''
  }
  if (item.id.startsWith('bag-machine-replace:')) {
    const forget = formatHgssRomMessage(banks[302]?.[193] ?? '', [])
    return `${forget} ${item.label}`.trim()
  }
  if (item.id.startsWith('team-field-move:') || item.id.startsWith('pokedex-') || item.id.startsWith('pokegear-')) return item.label
  const fixed: Partial<Record<MainMenuItem['id'], string>> = {
    pokedex: main[0], team: main[1], bag: main[2], pokegear: main[14], options: options[0], root: main[21], save: main[4], retire: main[8],
    'cycle-text-speed': options[1], 'toggle-battle-animations': options[2], 'toggle-local-weather': banks[720]?.[59],
    'toggle-fullscreen': options[6], 'report-bug': banks[191]?.[11], 'emergency-unstick': banks[191]?.[440], 'new-game': title[1],
  }
  return fixed[item.id] ?? ''
}

/** Résout uniquement des valeurs d'état présentes dans la banque Options native HGSS. */
export function resolveRomMenuItemState(
  id: MainMenuItem['id'],
  gameOptions: HgssGameOptions,
  fullscreen: boolean,
  banks: RomUiBanks | undefined,
): RomMenuItemState | undefined {
  const options = banks?.[45] ?? {}
  if (id === 'cycle-text-speed') {
    const position = gameOptions.textSpeed === 'slow' ? 1 : gameOptions.textSpeed === 'normal' ? 2 : 3
    return { value: options[position + 8] ?? '', token: gameOptions.textSpeed, position, size: 3 }
  }
  const pressed = id === 'toggle-battle-animations' ? gameOptions.battleAnimations
    : id === 'toggle-local-weather' ? gameOptions.localWeather
      : id === 'toggle-fullscreen' ? fullscreen : undefined
  return pressed === undefined ? undefined : { value: options[pressed ? 12 : 13] ?? '', token: String(pressed), pressed }
}
