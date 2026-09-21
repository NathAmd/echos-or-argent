import type { RomInventory } from '../../ndsTypes'
import type { PokemonEvolutionRule } from '../../rom/pokemon/evolutionData'
import type { HgssItemPocket } from '../../rom/items/itemData'
import type { BattleProgressionMessageEntry, CanonicalBattleProgressionPresenter } from '../battle/battleProgressionPresentation'
import { useHgssRepel } from '../encounters/hgssRepel'
import { formatFieldItemEffect } from '../items/formatFieldItemEffect'
import { giveHeldItemToPokemon } from '../items/heldItemTransfer'
import {
  getFieldItemEvolutionRule,
  useFieldItemOnParty,
  useFieldItemOnPokemon,
} from '../items/useFieldItem'
import { getHgssPokemonMachine, usePokemonMachine } from '../items/usePokemonMachine'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import type { PokemonPartySlotSource } from '../pokemon/canonicalPokemonPartyTarget'
import type { PokemonLevelPolicy } from '../pokemon/pokemonLevelPolicy'
import {
  formatMachineMoveLearningDeclined,
  formatMachineMoveLearningResult,
  requirePokemonMoveName,
} from '../pokemon/pokemonMoveLearningMessages'
import type { PokemonPartyHealingPolicy } from '../pokemon/pokemonPartyHealingPolicy'
import type { PokemonTeamPolicy } from '../pokemon/pokemonTeamPolicy'
import type { FieldScriptState } from '../scripts/fieldScriptRunner'
import type { HgssTimeOfDay } from '../time/hgssRtc'
import { getBagCommandConfirmation } from '../ui/bagMenuConfirmation'
import { getFirstBagActionIndex } from '../ui/bagMenuPresentation'
import type { WorldSession } from '../world/worldSession'
import { parseMainMenuCommand, type ParsedKnownMainMenuCommand } from './mainMenuCommand'
import type { MainMenuController, MainMenuResult, MainMenuState } from './mainMenuController'

type BagMenuCommandKind =
  | 'bag-pocket'
  | 'bag-item'
  | 'bag-action-use'
  | 'bag-action-give'
  | 'bag-action-cancel'
  | 'bag-machine-target'
  | 'bag-machine-replace'
  | 'bag-machine-cancel'
  | 'bag-give'
  | 'bag-bike'
  | 'bag-repel'
  | 'bag-fish'
  | 'bag-sweet-scent'
  | 'bag-use'
  | 'bag-use-move'
  | 'bag-use-party'

type BagMenuCommand = Extract<ParsedKnownMainMenuCommand, { kind: BagMenuCommandKind }>

export type BagMenuMachineTeaching = Readonly<{
  itemId: number
  partySlot: number
}>

export type BagMenuCommandSelection = Readonly<{
  pocket?: HgssItemPocket
  itemId?: number
  action?: 'use' | 'give'
  pendingMachineTeaching?: BagMenuMachineTeaching
  actionPopupOpen: boolean
}>

export type BagMenuCommandSelectionUpdate = Partial<BagMenuCommandSelection>

export type BagMenuCommandResources = Pick<
  RomInventory,
  'itemCatalog' | 'pokemonCatalog' | 'uiMessageBanks'
>

export type BagMenuCommandState = Pick<
  FieldScriptState,
  'inventory' | 'party' | 'roamers' | 'currentMapId'
>

export type BagMenuCommandWorld = Pick<WorldSession, 'getState' | 'setLocomotion'>

export type BagMenuCommandOperations = Readonly<{
  getMachine: typeof getHgssPokemonMachine
  useMachine: typeof usePokemonMachine
  giveHeldItem: typeof giveHeldItemToPokemon
  useRepel: typeof useHgssRepel
  useOnPokemon: typeof useFieldItemOnPokemon
  useOnParty: typeof useFieldItemOnParty
}>

export type BagMenuCommandHostPorts = Readonly<{
  menu: Pick<MainMenuController, 'getState' | 'close' | 'refresh' | 'focus'> & Readonly<{
    render: (state: MainMenuState) => void
    syncPocket: (state: MainMenuState) => void
    syncCursor: (state: MainMenuState) => void
  }>
  selection: Readonly<{
    read: () => BagMenuCommandSelection
    update: (update: BagMenuCommandSelectionUpdate) => void
  }>
  resources: Readonly<{
    read: () => BagMenuCommandResources | undefined
  }>
  state: Readonly<{
    read: () => BagMenuCommandState
  }>
  confirmation: Readonly<{
    request: (message: string, onResolve: (confirmed: boolean) => void) => void
  }>
  policies: Readonly<{
    level: PokemonLevelPolicy
    healing: PokemonPartyHealingPolicy
    team: PokemonTeamPolicy
  }>
  world: Readonly<{
    read: () => BagMenuCommandWorld | undefined
    applyPlayerSkin: () => void
    syncFollower: (forceTexture: boolean) => void
  }>
  encounters: Readonly<{
    startFishing: (itemId: number) => void
    useSweetScent: (source: 'honey') => void
  }>
  progression: Readonly<{
    moveLearning: Pick<CanonicalBattleProgressionPresenter, 'createMoveLearningEntries'>
    createEvolutionEntry: (
      pokemon: CanonicalPokemon,
      source: PokemonPartySlotSource,
      explicitEvolution?: { targetSpeciesId: number, rule?: PokemonEvolutionRule },
    ) => BattleProgressionMessageEntry
    startPresentation: (entries: readonly BattleProgressionMessageEntry[]) => void
    startEvolution: (
      pokemon: CanonicalPokemon,
      targetSpeciesId: number,
      source: PokemonPartySlotSource,
      rule?: PokemonEvolutionRule,
    ) => unknown
  }>
  currentTimeOfDay: () => HgssTimeOfDay
  clearNotice: () => void
  setStatus: (text: string, tone: 'info' | 'success' | 'warning') => void
  setFieldStatus: (text: string) => void
  persist: () => void
}>

export type BagMenuCommandHost = Readonly<{
  handle: (result: MainMenuResult) => boolean
  closeActionPopup: () => void
  clearPendingMachineTeaching: () => void
  reset: () => void
}>

const baseBagMenuCommandOperations: BagMenuCommandOperations = Object.freeze({
  getMachine: getHgssPokemonMachine,
  useMachine: usePokemonMachine,
  giveHeldItem: giveHeldItemToPokemon,
  useRepel: useHgssRepel,
  useOnPokemon: useFieldItemOnPokemon,
  useOnParty: useFieldItemOnParty,
})

const bagMenuCommandKinds = new Set<BagMenuCommandKind>([
  'bag-pocket',
  'bag-item',
  'bag-action-use',
  'bag-action-give',
  'bag-action-cancel',
  'bag-machine-target',
  'bag-machine-replace',
  'bag-machine-cancel',
  'bag-give',
  'bag-bike',
  'bag-repel',
  'bag-fish',
  'bag-sweet-scent',
  'bag-use',
  'bag-use-move',
  'bag-use-party',
])

function isBagMenuCommand(command: ParsedKnownMainMenuCommand): command is BagMenuCommand {
  return bagMenuCommandKinds.has(command.kind as BagMenuCommandKind)
}

/**
 * Owns every command emitted by the field Bag. Domain operations stay free of
 * browser state; only selection, presentation and deferred progression cross
 * the explicit ports below.
 */
export function createBagMenuCommandHost(
  ports: BagMenuCommandHostPorts,
  operations: BagMenuCommandOperations = baseBagMenuCommandOperations,
): BagMenuCommandHost {
  let confirmedCommand: string | undefined

  const renderRefreshedMenu = (): void => {
    ports.menu.render(ports.menu.refresh())
  }

  const closeActionPopup = (): void => {
    const selection = ports.selection.read()
    if (selection.action || selection.pendingMachineTeaching) {
      ports.selection.update({ action: undefined, pendingMachineTeaching: undefined })
      const refreshed = ports.menu.refresh()
      const actionIndex = getFirstBagActionIndex(refreshed)
      ports.menu.render(actionIndex === undefined ? refreshed : ports.menu.focus(actionIndex))
      return
    }
    ports.selection.update({ actionPopupOpen: false })
    const refreshed = ports.menu.refresh()
    const itemIndex = refreshed.items.findIndex(({ id }) => id === `bag-item:${selection.itemId}`)
    ports.menu.render(itemIndex < 0 ? refreshed : ports.menu.focus(itemIndex))
  }

  const handlePocket = (command: Extract<BagMenuCommand, { kind: 'bag-pocket' }>): void => {
    ports.clearNotice()
    ports.selection.update({
      pendingMachineTeaching: undefined,
      action: undefined,
      actionPopupOpen: false,
    })
    const resources = ports.resources.read()
    if (command.pocket >= 0 && command.pocket < (resources?.itemCatalog.pocketNames.length ?? 0)) {
      ports.selection.update({ pocket: command.pocket, itemId: undefined })
    }
    const refreshed = ports.menu.refresh()
    const itemIndex = refreshed.items.findIndex(({ id }) => id.startsWith('bag-item:'))
    const focused = itemIndex < 0 ? refreshed : ports.menu.focus(itemIndex)
    ports.menu.syncPocket(focused)
    ports.menu.syncCursor(focused)
  }

  const handleItem = (command: Extract<BagMenuCommand, { kind: 'bag-item' }>): void => {
    ports.clearNotice()
    ports.selection.update({
      pendingMachineTeaching: undefined,
      action: undefined,
      itemId: command.itemId,
    })
    const refreshed = ports.menu.refresh()
    const actionIndex = getFirstBagActionIndex(refreshed)
    ports.selection.update({ actionPopupOpen: actionIndex !== undefined })
    if (actionIndex === undefined) {
      ports.setStatus('Cet objet ne peut pas être utilisé depuis le terrain.', 'info')
    }
    ports.menu.render(actionIndex === undefined ? refreshed : ports.menu.focus(actionIndex))
  }

  const handleActionChoice = (
    command: Extract<BagMenuCommand, { kind: 'bag-action-use' | 'bag-action-give' }>,
  ): void => {
    ports.selection.update({ action: command.kind === 'bag-action-use' ? 'use' : 'give' })
    const refreshed = ports.menu.refresh()
    const actionIndex = getFirstBagActionIndex(refreshed)
    ports.selection.update({ actionPopupOpen: actionIndex !== undefined })
    ports.menu.render(actionIndex === undefined ? refreshed : ports.menu.focus(actionIndex))
  }

  const handleMachineTarget = (
    command: Extract<BagMenuCommand, { kind: 'bag-machine-target' }>,
    resources: BagMenuCommandResources | undefined,
  ): void => {
    const state = ports.state.read()
    const pokemon = state.party.members[command.partySlot]
    const machine = operations.getMachine(command.itemId)
    if (!pokemon || !machine || !resources) {
      ports.setStatus('La CT/CS ou le Pokémon sélectionné n’est plus disponible.', 'warning')
    } else {
      const result = operations.useMachine(
        state.inventory,
        command.itemId,
        pokemon,
        resources.pokemonCatalog,
      )
      const moveName = requirePokemonMoveName(resources.pokemonCatalog.moveNames, machine.moveId)
      if (result.kind === 'replacement-required') {
        ports.selection.update({
          pendingMachineTeaching: { itemId: command.itemId, partySlot: command.partySlot },
        })
        ports.setStatus(resources.uiMessageBanks[300]?.[60] ?? '', 'info')
        ports.selection.update({ actionPopupOpen: true })
      } else if (result.kind === 'learned') {
        ports.selection.update({ pendingMachineTeaching: undefined })
        ports.setStatus(formatMachineMoveLearningResult(
          resources.uiMessageBanks[300] ?? {},
          pokemon.nickname ?? pokemon.speciesName,
          moveName,
        ), 'success')
        ports.persist()
      } else {
        ports.setStatus(result.reason, 'warning')
      }
    }
    const refreshed = ports.menu.refresh()
    const actionIndex = ports.selection.read().actionPopupOpen
      ? getFirstBagActionIndex(refreshed)
      : undefined
    ports.menu.render(actionIndex === undefined ? refreshed : ports.menu.focus(actionIndex))
  }

  const handleMachineReplacement = (
    command: Extract<BagMenuCommand, { kind: 'bag-machine-replace' }>,
    resources: BagMenuCommandResources | undefined,
  ): void => {
    const state = ports.state.read()
    const pokemon = state.party.members[command.partySlot]
    const machine = operations.getMachine(command.itemId)
    const pending = ports.selection.read().pendingMachineTeaching
    if (!pokemon || !machine || !resources
      || pending?.itemId !== command.itemId
      || pending.partySlot !== command.partySlot) {
      ports.setStatus('Le choix d’apprentissage a expiré sans modifier les capacités.', 'warning')
    } else {
      const result = operations.useMachine(
        state.inventory,
        command.itemId,
        pokemon,
        resources.pokemonCatalog,
        command.moveIndex,
      )
      if (result.kind === 'learned') {
        const learnedName = requirePokemonMoveName(resources.pokemonCatalog.moveNames, result.learned.moveId)
        const forgottenName = result.forgotten
          ? requirePokemonMoveName(resources.pokemonCatalog.moveNames, result.forgotten.moveId)
          : undefined
        if (!forgottenName) {
          throw new Error('La capacité ROM à oublier est absente du résultat de remplacement.')
        }
        ports.selection.update({ pendingMachineTeaching: undefined })
        ports.setStatus(formatMachineMoveLearningResult(
          resources.uiMessageBanks[300] ?? {},
          pokemon.nickname ?? pokemon.speciesName,
          learnedName,
          forgottenName,
        ), 'success')
        ports.persist()
      } else {
        ports.setStatus(
          result.kind === 'unavailable' ? result.reason : resources.uiMessageBanks[300]?.[60] ?? '',
          'warning',
        )
      }
    }
    renderRefreshedMenu()
  }

  const handleMachineCancellation = (
    command: Extract<BagMenuCommand, { kind: 'bag-machine-cancel' }>,
    resources: BagMenuCommandResources | undefined,
  ): void => {
    const pokemon = ports.state.read().party.members[command.partySlot]
    const machine = operations.getMachine(command.itemId)
    const moveName = machine && resources?.pokemonCatalog.moveNames[machine.moveId]
    ports.selection.update({ pendingMachineTeaching: undefined })
    ports.setStatus(
      pokemon && moveName
        ? formatMachineMoveLearningDeclined(
            resources?.uiMessageBanks[300] ?? {},
            pokemon.nickname ?? pokemon.speciesName,
            moveName,
          )
        : '',
      'info',
    )
    renderRefreshedMenu()
  }

  const handleGive = (
    command: Extract<BagMenuCommand, { kind: 'bag-give' }>,
    resources: BagMenuCommandResources | undefined,
  ): void => {
    const state = ports.state.read()
    const item = resources?.itemCatalog.items[command.itemId]
    const pokemon = state.party.members[command.partySlot]
    if (!item || !pokemon || !resources) {
      ports.setStatus('La cible ou l’objet du Sac n’est plus disponible.', 'warning')
    } else {
      const oldItem = resources.itemCatalog.items[pokemon.heldItemId]
      const transfer = operations.giveHeldItem(
        state.inventory,
        resources.itemCatalog,
        item,
        pokemon,
        resources.pokemonCatalog,
      )
      ports.setStatus(
        transfer.kind === 'given'
          ? transfer.previousItemId === 0
            ? `${pokemon.nickname ?? pokemon.speciesName} tient maintenant ${item.name}.`
            : `${pokemon.nickname ?? pokemon.speciesName} échange ${oldItem?.name ?? `l’objet ${transfer.previousItemId}`} contre ${item.name}.`
          : transfer.reason,
        transfer.kind === 'given' ? 'success' : 'warning',
      )
      if (transfer.kind === 'given') ports.persist()
    }
    renderRefreshedMenu()
  }

  const handleBike = (): void => {
    const state = ports.state.read()
    const worldSession = ports.world.read()
    const world = worldSession?.getState()
    if (!world || !worldSession || !state.inventory.has(450)) {
      ports.setStatus('La Bicyclette ROM n’est pas disponible.', 'warning')
    } else if (world.locomotion === 'surfing') {
      ports.setStatus('Impossible d’utiliser la Bicyclette sur l’eau.', 'warning')
    } else if (world.locomotion !== 'cycling' && !world.map.header.bikeAllowed) {
      ports.setStatus('La Bicyclette ne peut pas être utilisée ici.', 'warning')
    } else {
      const locomotion = world.locomotion === 'cycling' ? 'walking' : 'cycling'
      worldSession.setLocomotion(locomotion)
      ports.world.applyPlayerSkin()
      ports.world.syncFollower(false)
      ports.setFieldStatus(locomotion === 'cycling' ? 'Bicyclette utilisée.' : 'Bicyclette rangée.')
      ports.persist()
      ports.menu.render(ports.menu.close())
      return
    }
    renderRefreshedMenu()
  }

  const handleRepel = (
    command: Extract<BagMenuCommand, { kind: 'bag-repel' }>,
    resources: BagMenuCommandResources | undefined,
  ): void => {
    const state = ports.state.read()
    const item = resources?.itemCatalog.items[command.itemId]
    if (!item) {
      ports.setStatus('Ce Repousse du Sac n’est plus disponible.', 'warning')
    } else {
      const result = operations.useRepel(state.inventory, item, state.roamers)
      ports.setStatus(
        result.kind === 'used'
          ? `${item.name} utilisé : effet actif pendant ${result.steps} pas.`
          : result.reason,
        result.kind === 'used' ? 'success' : 'warning',
      )
      if (result.kind === 'used') ports.persist()
    }
    renderRefreshedMenu()
  }

  const handleFishing = (command: Extract<BagMenuCommand, { kind: 'bag-fish' }>): void => {
    if (!ports.state.read().inventory.has(command.itemId)) {
      ports.setStatus('Cette canne n’est plus dans le Sac.', 'warning')
      renderRefreshedMenu()
      return
    }
    ports.menu.render(ports.menu.close())
    ports.encounters.startFishing(command.itemId)
  }

  const handlePokemonItem = (
    command: Extract<BagMenuCommand, { kind: 'bag-use' | 'bag-use-move' }>,
    resources: BagMenuCommandResources | undefined,
  ): void => {
    const state = ports.state.read()
    const moveIndex = command.kind === 'bag-use-move' ? command.moveIndex : undefined
    const item = resources?.itemCatalog.items[command.itemId]
    const pokemon = state.party.members[command.partySlot]
    if (!item || !pokemon) {
      ports.setStatus('La cible ou l’objet du Sac n’est plus disponible.', 'warning')
    } else {
      const result = operations.useOnPokemon(
        state.inventory,
        item,
        pokemon,
        moveIndex,
        {
          pokemonCatalog: resources?.pokemonCatalog,
          itemCatalog: resources?.itemCatalog,
          levelPolicy: ports.policies.level,
          healingPolicy: ports.policies.healing,
          partyIndex: command.partySlot,
          healingSource: 'field-item',
          currentLocationId: state.currentMapId,
          timeOfDay: ports.currentTimeOfDay(),
          party: state.party.members,
          teamPolicy: ports.policies.team,
          deferEvolution: true,
        },
      )
      if (result.kind === 'used') {
        const source = {
          kind: 'field',
          partySlot: Number(command.partySlot),
          cancellable: result.effect.evolutionContext === 'level-up' || result.effect.levelsGained > 0,
        } as const
        const learningEntries = ports.progression.moveLearning.createMoveLearningEntries(
          pokemon,
          source,
          result.effect.learnedMoveIds,
          result.effect.skippedMoveIds,
        )
        const hasLevelProgression = result.effect.levelsGained > 0
        if (hasLevelProgression || learningEntries.length > 0) {
          const entries: BattleProgressionMessageEntry[] = [
            formatFieldItemEffect(item.name, pokemon.nickname ?? pokemon.speciesName, result.effect),
            ...learningEntries,
          ]
          if (hasLevelProgression) {
            entries.push(ports.progression.createEvolutionEntry(pokemon, source))
          } else if (result.effect.evolvedToSpeciesId !== undefined) {
            entries.push(ports.progression.createEvolutionEntry(pokemon, source, {
              targetSpeciesId: result.effect.evolvedToSpeciesId,
              rule: getFieldItemEvolutionRule(result.effect),
            }))
          }
          ports.clearNotice()
          ports.menu.render(ports.menu.close())
          ports.progression.startPresentation(entries)
          return
        }
        if (result.effect.evolvedToSpeciesId !== undefined) {
          ports.clearNotice()
          ports.menu.render(ports.menu.close())
          ports.progression.startEvolution(
            pokemon,
            result.effect.evolvedToSpeciesId,
            source,
            getFieldItemEvolutionRule(result.effect),
          )
          return
        }
      }
      ports.setStatus(
        result.kind === 'used'
          ? formatFieldItemEffect(item.name, pokemon.nickname ?? pokemon.speciesName, result.effect)
          : result.reason,
        result.kind === 'used' ? 'success' : 'warning',
      )
      if (result.kind === 'used') ports.persist()
    }
    renderRefreshedMenu()
  }

  const handlePartyItem = (
    command: Extract<BagMenuCommand, { kind: 'bag-use-party' }>,
    resources: BagMenuCommandResources | undefined,
  ): void => {
    const state = ports.state.read()
    const item = resources?.itemCatalog.items[command.itemId]
    if (!item) {
      ports.setStatus('Cet objet du Sac n’est plus disponible.', 'warning')
    } else {
      const result = operations.useOnParty(
        state.inventory,
        item,
        state.party.members,
        { healingPolicy: ports.policies.healing },
      )
      ports.setStatus(
        result.kind === 'used'
          ? `${item.name} réanime ${result.effects.length} Pokémon de l’Équipe.`
          : result.reason,
        result.kind === 'used' ? 'success' : 'warning',
      )
      if (result.kind === 'used') {
        ports.world.syncFollower(true)
        ports.persist()
      }
    }
    renderRefreshedMenu()
  }

  const executeCommand = (
    command: Exclude<BagMenuCommand, {
      kind: 'bag-pocket' | 'bag-item' | 'bag-action-use' | 'bag-action-give' | 'bag-action-cancel'
    }>,
    resources: BagMenuCommandResources | undefined,
  ): void => {
    if (command.kind === 'bag-machine-target') handleMachineTarget(command, resources)
    else if (command.kind === 'bag-machine-replace') handleMachineReplacement(command, resources)
    else if (command.kind === 'bag-machine-cancel') handleMachineCancellation(command, resources)
    else if (command.kind === 'bag-give') handleGive(command, resources)
    else if (command.kind === 'bag-bike') handleBike()
    else if (command.kind === 'bag-repel') handleRepel(command, resources)
    else if (command.kind === 'bag-fish') handleFishing(command)
    else if (command.kind === 'bag-sweet-scent') ports.encounters.useSweetScent('honey')
    else if (command.kind === 'bag-use' || command.kind === 'bag-use-move') handlePokemonItem(command, resources)
    else handlePartyItem(command, resources)
  }

  const handle = (result: MainMenuResult): boolean => {
    if (result.kind !== 'command') return false
    const parsed = parseMainMenuCommand(result.command)
    if (parsed.kind === 'unknown' || !isBagMenuCommand(parsed)) return false

    if (parsed.kind === 'bag-pocket') {
      handlePocket(parsed)
      return true
    }
    if (parsed.kind === 'bag-item') {
      handleItem(parsed)
      return true
    }
    if (parsed.kind === 'bag-action-cancel') {
      closeActionPopup()
      return true
    }
    if (parsed.kind === 'bag-action-use' || parsed.kind === 'bag-action-give') {
      handleActionChoice(parsed)
      return true
    }

    const resources = ports.resources.read()
    if (resources) {
      const state = ports.state.read()
      const confirmation = getBagCommandConfirmation(
        result.command,
        resources.itemCatalog,
        resources.pokemonCatalog,
        state.party.members,
        {
          bag: resources.uiMessageBanks[10] ?? {},
          party: resources.uiMessageBanks[300] ?? {},
        },
      )
      if (confirmation && confirmedCommand !== result.command) {
        ports.confirmation.request(confirmation, (confirmed) => {
          if (confirmed) {
            confirmedCommand = result.command
            handle(result)
          } else {
            ports.menu.render(ports.menu.getState())
          }
        })
        return true
      }
      confirmedCommand = undefined
      ports.selection.update({ action: undefined, actionPopupOpen: false })
    }

    executeCommand(parsed, resources)
    return true
  }

  return Object.freeze({
    handle,
    closeActionPopup,
    clearPendingMachineTeaching: () => {
      ports.selection.update({ pendingMachineTeaching: undefined })
    },
    reset: () => {
      confirmedCommand = undefined
      ports.selection.update({
        pendingMachineTeaching: undefined,
        action: undefined,
        actionPopupOpen: false,
      })
    },
  })
}
