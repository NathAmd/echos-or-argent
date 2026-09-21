import type { RomInventory } from '../../ndsTypes'
import { returnHeldMailItemToBag, storeHeldMailInMailbox, takeHeldItemFromPokemon } from '../items/heldItemTransfer'
import { hgssFieldMoveIds } from '../player/hgssPlayerMovement'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { hgssPokemonNicknameMaxLength } from '../pokemon/pokemonNickname'
import { reorderPokemonPartyMembers, type PokemonParty } from '../pokemon/pokemonParty'
import type { PokemonTeamPolicy } from '../pokemon/pokemonTeamPolicy'
import type { FieldTextEntryCoordinator } from '../ui/fieldTextEntryCoordinator'
import { formatHgssRomMessage } from '../ui/romMessageFormatting'
import { parseMainMenuCommand, type ParsedMainMenuCommand } from './mainMenuCommand'
import type { MainMenuController, MainMenuResult, MainMenuState } from './mainMenuController'

export type TeamMenuStatusTone = 'success' | 'warning'

export type TeamMenuCommandResources = Pick<
  RomInventory,
  'itemCatalog' | 'pokemonCatalog' | 'uiMessageBanks'
>

export type TeamMenuCommandInput = MainMenuResult | ParsedMainMenuCommand

export type TeamMenuCommandHostPorts = Readonly<{
  menu: Pick<MainMenuController, 'close' | 'refresh'> & Readonly<{
    render: (state: MainMenuState) => void
    syncTeamSelection: (state: MainMenuState) => void
    setHidden: (hidden: boolean) => void
  }>
  team: Readonly<{
    readParty: () => PokemonParty
    policy: PokemonTeamPolicy
    clearNotice: () => void
    selectPartySlot: (partySlot: number) => void
    openSummary: (partySlot: number, page: 'stats') => void
    syncFollower: (animate: boolean) => void
  }>
  bag: Readonly<{
    readInventory: () => Map<number, number>
  }>
  mailbox: Readonly<{
    read: () => Readonly<{
      identities: Array<CanonicalPokemon['mailIdentity']>
      messageCount: number
    }>
    writeMessageCount: (messageCount: number) => void
  }>
  confirmation: Readonly<{
    request: (message: string, onResolve: (confirmed: boolean) => void) => void
  }>
  resources: Readonly<{
    read: () => TeamMenuCommandResources | undefined
  }>
  fieldMoves: Readonly<{
    useSweetScent: () => boolean
    offerSurf: (preferredPartySlot: number) => boolean
  }>
  nickname: Readonly<{
    root: HTMLElement
    input: HTMLInputElement
    textEntry: Pick<FieldTextEntryCoordinator, 'setNicknameCancellable' | 'writeNickname' | 'openNickname'>
    setPendingPartySlot: (partySlot: number) => void
  }>
  persist: () => void
  setStatus: (text: string, tone: TeamMenuStatusTone) => void
  setFieldStatus: (text: string) => void
}>

export type TeamMenuCommandHost = Readonly<{
  handle: (input: TeamMenuCommandInput) => boolean
}>

function resolveCommand(input: TeamMenuCommandInput): ParsedMainMenuCommand | undefined {
  if (input.kind === 'ignored' || input.kind === 'state') return undefined
  return input.kind === 'command' ? parseMainMenuCommand(input.command) : input
}

/** Owns every command emitted by the utility menu's Équipe screen. */
export function createTeamMenuCommandHost(
  ports: TeamMenuCommandHostPorts,
): TeamMenuCommandHost {
  const refreshMenu = (): void => ports.menu.render(ports.menu.refresh())

  return Object.freeze({
    handle(input): boolean {
      const command = resolveCommand(input)
      if (!command) return false

      if (command.kind === 'team-member') {
        ports.team.clearNotice()
        ports.team.selectPartySlot(command.partySlot)
        ports.menu.syncTeamSelection(ports.menu.refresh())
        return true
      }

      if (command.kind === 'team-summary') {
        ports.team.openSummary(command.partySlot, 'stats')
        refreshMenu()
        return true
      }

      if (command.kind === 'team-move-up' || command.kind === 'team-move-down') {
        const moveUp = command.kind === 'team-move-up'
        const targetSlot = command.sourceSlot + (moveUp ? -1 : 1)
        const party = ports.team.readParty()
        const reorder = reorderPokemonPartyMembers(
          party,
          command.sourceSlot,
          targetSlot,
          ports.team.policy,
        )
        if (reorder.kind === 'reordered') {
          ports.team.selectPartySlot(targetSlot)
          ports.team.syncFollower(true)
          ports.persist()
          const pokemon = party.members[targetSlot]!
          ports.setStatus(
            `${pokemon.nickname ?? pokemon.speciesName} occupe maintenant l’emplacement ${targetSlot + 1}.`,
            'success',
          )
        } else {
          ports.setStatus(reorder.reason, 'warning')
        }
        refreshMenu()
        return true
      }

      if (command.kind === 'team-take-item') {
        const pokemon = ports.team.readParty().members[command.partySlot]
        const resources = ports.resources.read()
        if (!pokemon || !resources) {
          ports.setStatus('Le Pokémon ou le catalogue ROM n’est plus disponible.', 'warning')
        } else {
          const previousItem = resources.itemCatalog.items[pokemon.heldItemId]
          if (previousItem?.fieldPocket === 5) {
            const message = (messageId: number, fallback: string): string => formatHgssRomMessage(
              resources.uiMessageBanks[300]?.[messageId] ?? fallback,
              [],
            )
            const finish = (text: string, success: boolean): void => {
              ports.setStatus(text, success ? 'success' : 'warning')
              if (success) ports.persist()
              refreshMenu()
            }
            ports.confirmation.request(
              message(44, 'Envoyer ce courrier dans la boîte aux lettres du PC ?'),
              (sendToMailbox) => {
                if (sendToMailbox) {
                  const mailbox = ports.mailbox.read()
                  const transfer = storeHeldMailInMailbox(
                    mailbox.identities,
                    mailbox.messageCount,
                    resources.itemCatalog,
                    pokemon,
                  )
                  if (transfer.kind === 'stored-mail') {
                    ports.mailbox.writeMessageCount(transfer.mailboxMessageCount)
                  }
                  finish(
                    transfer.kind === 'stored-mail'
                      ? message(47, 'Le courrier a été envoyé dans la boîte aux lettres du PC.')
                      : transfer.kind === 'mailbox-full'
                        ? message(51, transfer.reason)
                        : transfer.reason,
                    transfer.kind === 'stored-mail',
                  )
                  return
                }
                ports.confirmation.request(
                  message(48, 'Remettre le papier dans le Sac ? Son texte sera effacé.'),
                  (returnToBag) => {
                    if (!returnToBag) {
                      refreshMenu()
                      return
                    }
                    const transfer = returnHeldMailItemToBag(
                      ports.bag.readInventory(),
                      resources.itemCatalog,
                      pokemon,
                    )
                    finish(
                      transfer.kind === 'taken'
                        ? message(52, 'Le courrier a été remis dans le Sac.')
                        : transfer.kind === 'bag-full'
                          ? message(84, transfer.reason)
                          : transfer.reason,
                      transfer.kind === 'taken',
                    )
                  },
                )
              },
            )
            refreshMenu()
            return true
          }
          const transfer = takeHeldItemFromPokemon(
            ports.bag.readInventory(),
            resources.itemCatalog,
            pokemon,
            resources.pokemonCatalog,
          )
          ports.setStatus(
            transfer.kind === 'taken'
              ? `${pokemon.nickname ?? pokemon.speciesName} remet ${previousItem?.name ?? `l’objet ${transfer.itemId}`} dans le Sac.`
              : transfer.reason,
            transfer.kind === 'taken' ? 'success' : 'warning',
          )
          if (transfer.kind === 'taken') ports.persist()
        }
        refreshMenu()
        return true
      }

      if (command.kind === 'team-field-move') {
        if (command.moveId === hgssFieldMoveIds.sweetScent && ports.fieldMoves.useSweetScent()) return true
        ports.menu.render(ports.menu.close())
        if (command.moveId === hgssFieldMoveIds.surf && ports.fieldMoves.offerSurf(command.partySlot)) return true
        ports.setFieldStatus('Cette capacité ne peut pas être utilisée dans cette direction.')
        return true
      }

      if (command.kind === 'team-rename') {
        const pokemon = ports.team.readParty().members[command.partySlot]
        if (!pokemon || pokemon.isEgg) {
          ports.setStatus('Ce Pokémon ne peut pas être renommé.', 'warning')
          refreshMenu()
          return true
        }

        const currentName = pokemon.nickname ?? pokemon.speciesName
        ports.nickname.setPendingPartySlot(command.partySlot)
        ports.nickname.input.maxLength = hgssPokemonNicknameMaxLength
        ports.nickname.textEntry.writeNickname(currentName)
        const prompt = formatHgssRomMessage(
          ports.resources.read()?.uiMessageBanks[249]?.[1] ?? '',
          [currentName],
        )
        const label = ports.nickname.root.querySelector('label')
        if (label) label.textContent = prompt
        ports.nickname.input.setAttribute('aria-label', prompt)
        ports.nickname.textEntry.setNicknameCancellable(true)
        ports.menu.setHidden(true)
        ports.nickname.root.hidden = false
        ports.nickname.textEntry.openNickname()
        return true
      }

      return false
    },
  })
}
