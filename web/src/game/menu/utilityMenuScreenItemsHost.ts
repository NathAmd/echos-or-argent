import type { RomInventory } from '../../ndsTypes'
import { getHgssRegisteredPokegearApps } from '../../rom/phone/phoneBook'
import type { HgssItemPocket } from '../../rom/items/itemData'
import { canSelectHgssSweetScentFieldMove } from '../encounters/hgssSweetScentEncounter'
import { createHgssPokedexList } from '../pokedex/pokedexMenuModel'
import { hgssFieldMoveIds } from '../player/hgssPlayerMovement'
import type { FieldScriptState } from '../scripts/fieldScriptRunner'
import { createBagMenuModel } from './bagMenuModel'
import {
  getPokegearAppCard,
  getPokegearAppScreen,
  isPokegearAppScreen,
  type MainMenuItem,
  type MainMenuScreen,
} from './mainMenuController'

export type UtilityMenuScreenItemsSelection = Readonly<{
  team: Readonly<{
    readSlot: () => number
    writeSlot: (slot: number) => void
  }>
  pokedex: Readonly<{
    readSpeciesId: () => number | undefined
    writeSpeciesId: (speciesId: number | undefined) => void
  }>
  bag: Readonly<{
    read: () => Readonly<{
      itemId: number | undefined
      pocket: HgssItemPocket | undefined
      action: 'use' | 'give' | undefined
      pendingMachineTeaching: Readonly<{ itemId: number, partySlot: number }> | undefined
    }>
    write: (selection: Readonly<{
      itemId: number | undefined
      pocket: HgssItemPocket | undefined
    }>) => void
  }>
}>

export type UtilityMenuScreenItemsHostPorts = Readonly<{
  readContext: () => Readonly<{
    inventory: RomInventory | undefined
    fieldState: FieldScriptState
    mapId: number | undefined
  }>
  selection: UtilityMenuScreenItemsSelection
  pokegear: Readonly<{
    selectCard: (card: number) => void
    getMenuItems: () => readonly MainMenuItem[]
  }>
}>

export type UtilityMenuScreenItemsHost = Readonly<{
  getItems: (
    screen: Exclude<MainMenuScreen, 'root'>,
  ) => readonly MainMenuItem[] | undefined
}>

export function getUtilityPokegearAppLabels(inventory: RomInventory | undefined): readonly string[] {
  return [
    inventory?.uiMessageBanks[271]?.[0] ?? '',
    'Carte',
    inventory?.radioProgramMessages[0]?.[0] ?? '',
    inventory?.uiMessageBanks[270]?.[0] ?? '',
  ]
}

/** Construit les commandes dynamiques de chaque application du menu HGSS. */
export function createUtilityMenuScreenItemsHost(
  ports: UtilityMenuScreenItemsHostPorts,
): UtilityMenuScreenItemsHost {
  const getPokedexItems = (): readonly MainMenuItem[] => {
    const { inventory, fieldState } = ports.readContext()
    if (!inventory) return []
    const entries = createHgssPokedexList(
      fieldState.pokedex,
      inventory.pokemonCatalog,
      inventory.pokedexCatalog,
    )
    if (!entries.some(({ speciesId }) => speciesId === ports.selection.pokedex.readSpeciesId())) {
      ports.selection.pokedex.writeSpeciesId(entries[0]?.speciesId)
    }
    return entries.map((entry): MainMenuItem => ({
      id: `pokedex-species:${entry.speciesId}`,
      label: entry.seen
        ? `${String(entry.dexNumber).padStart(3, '0')} ${entry.speciesName}`
        : String(entry.dexNumber).padStart(3, '0'),
      kind: 'command',
    }))
  }

  const getTeamItems = (): readonly MainMenuItem[] => {
    const { inventory, fieldState, mapId } = ports.readContext()
    const members = fieldState.party.members
    const selectedSlot = Math.min(
      ports.selection.team.readSlot(),
      Math.max(0, members.length - 1),
    )
    ports.selection.team.writeSlot(selectedSlot)
    const memberButtons: MainMenuItem[] = members.map((pokemon, slot) => ({
      id: `team-member:${slot}`,
      label: `${pokemon.nickname ?? pokemon.speciesName} · Nv.${pokemon.level}`,
      kind: 'command',
    }))
    const actionButtons: MainMenuItem[] = []
    const selected = members[selectedSlot]
    if (selected) actionButtons.push({ id: `team-summary:${selectedSlot}`, label: 'Résumé', kind: 'command' })
    if (selectedSlot > 0) actionButtons.push({ id: `team-move-up:${selectedSlot}`, label: 'Monter dans l’équipe', kind: 'command' })
    if (selectedSlot + 1 < members.length) actionButtons.push({ id: `team-move-down:${selectedSlot}`, label: 'Descendre dans l’équipe', kind: 'command' })
    if (selected?.heldItemId) actionButtons.push({ id: `team-take-item:${selectedSlot}`, label: 'Reprendre l’objet tenu', kind: 'command' })
    if (selected && !selected.isEgg) actionButtons.push({ id: `team-rename:${selectedSlot}`, label: 'Changer le surnom', kind: 'command' })

    const fieldMoves = [hgssFieldMoveIds.surf, hgssFieldMoveIds.sweetScent]
      .filter((moveId) => selected?.moves.some((move) => move.moveId === moveId))
    for (const moveId of fieldMoves) {
      if (moveId === hgssFieldMoveIds.sweetScent
        && !canSelectHgssSweetScentFieldMove(mapId ?? -1, fieldState.flags)) continue
      actionButtons.push({
        id: `team-field-move:${selectedSlot}:${moveId}`,
        label: inventory?.pokemonCatalog.moveNames[moveId] ?? '',
        kind: 'command',
      })
    }
    return [...memberButtons, ...actionButtons]
  }

  const getBagItems = (): readonly MainMenuItem[] => {
    const { inventory, fieldState } = ports.readContext()
    if (!inventory) return []
    const selection = ports.selection.bag.read()
    const pending = selection.pendingMachineTeaching
    const model = createBagMenuModel(
      fieldState.inventory,
      inventory.itemCatalog,
      fieldState.party.members,
      inventory.pokemonCatalog,
      {
        pocket: selection.pocket,
        itemId: selection.itemId,
        action: selection.action,
        machinePartySlot: pending && pending.itemId === selection.itemId
          ? pending.partySlot
          : undefined,
      },
    )
    ports.selection.bag.write({
      pocket: model.selectedPocket,
      itemId: model.selectedItemId,
    })
    return model.items
  }

  const getItems = (
    screen: Exclude<MainMenuScreen, 'root'>,
  ): readonly MainMenuItem[] | undefined => {
    if (screen === 'pokedex') return getPokedexItems()
    if (screen === 'team') return getTeamItems()
    if (screen === 'bag') return getBagItems()
    const { inventory, fieldState } = ports.readContext()
    if (screen === 'pokegear') {
      const labels = getUtilityPokegearAppLabels(inventory)
      return [...getHgssRegisteredPokegearApps(fieldState.pokegearCards), 3]
        .flatMap((card): MainMenuItem[] => {
          const appScreen = getPokegearAppScreen(card)
          return appScreen
            ? [{ id: appScreen, label: labels[card] ?? '', kind: 'screen' }]
            : []
        })
    }
    if (isPokegearAppScreen(screen)) {
      const card = getPokegearAppCard(screen)
      if (card !== undefined) ports.pokegear.selectCard(card)
      return ports.pokegear.getMenuItems()
    }
    return undefined
  }

  return Object.freeze({ getItems })
}
