import type { HgssPhoneBookEntry } from '../../rom/phone/phoneBook'
import {
  sortPokegearPhoneContacts,
  type PokegearPhoneSort,
} from '../pokegear/pokegearNativeState'
import {
  openPokegearContactPopup,
  openPokegearSkinConfirmation,
} from '../pokegear/pokegearMenuPopups'
import type { ChoicePopupController } from '../ui/choicePopupController'
import { resolveHgssUiThemeNames } from '../ui/hgssUiThemes'
import { parseMainMenuCommand } from './mainMenuCommand'
import type { MainMenuController, MainMenuResult, MainMenuState } from './mainMenuController'

export type PokegearMenuCommandResources = Readonly<{
  contactNames: readonly string[]
  phoneMessages: Record<number, string>
  phoneBookEntries: readonly HgssPhoneBookEntry[]
  configureMessages: Record<number, string>
  speciesNames: readonly string[]
}>

export type PokegearMenuCommandHostPorts = Readonly<{
  menu: Pick<MainMenuController, 'refresh'> & Readonly<{
    render: (state: MainMenuState) => void
    setHidden: (hidden: boolean) => void
  }>
  popup: ChoicePopupController
  ui: Readonly<{
    selectContact: (contactId: number) => void
    selectRadioSlot: (slot: number) => void
  }>
  outgoingCall: Readonly<{
    start: (contactId: number) => boolean
  }>
  contacts: Readonly<{
    read: () => Iterable<number>
    write: (contactIds: Set<number>) => void
  }>
  skin: Readonly<{
    write: (skin: number) => void
    apply: (skin: number) => void
  }>
  resources: Readonly<{
    read: () => PokegearMenuCommandResources | undefined
  }>
  prompts: Readonly<{
    refresh: () => void
  }>
  persist: () => void
  setStatus: (text: string, tone: 'warning') => void
}>

export type PokegearMenuCommandHost = Readonly<{
  handle: (result: MainMenuResult) => boolean
}>

/** Owns commands emitted by the phone, radio and skin Pokégear screens. */
export function createPokegearMenuCommandHost(
  ports: PokegearMenuCommandHostPorts,
): PokegearMenuCommandHost {
  const refreshMenu = (): void => ports.menu.render(ports.menu.refresh())

  const sortContacts = (sort: PokegearPhoneSort): void => {
    const entries = ports.resources.read()?.phoneBookEntries ?? []
    ports.contacts.write(new Set(sortPokegearPhoneContacts(ports.contacts.read(), entries, sort)))
    ports.persist()
    refreshMenu()
  }

  return Object.freeze({
    handle(result): boolean {
      if (result.kind !== 'command') return false
      const command = parseMainMenuCommand(result.command)

      if (command.kind === 'pokegear-contact') {
        const { contactId } = command
        ports.ui.selectContact(contactId)
        const resources = ports.resources.read()
        openPokegearContactPopup({
          popup: ports.popup,
          contactName: resources?.contactNames[contactId] ?? String(contactId),
          phoneMessages: resources?.phoneMessages ?? {},
          onCall: () => {
            ports.menu.setHidden(true)
            if (!ports.outgoingCall.start(contactId)) {
              ports.menu.setHidden(false)
              ports.setStatus(ports.resources.read()?.phoneMessages[30] ?? '', 'warning')
              refreshMenu()
            }
            ports.prompts.refresh()
          },
          onSort: sortContacts,
        })
        return true
      }
      if (command.kind === 'pokegear-radio') {
        ports.ui.selectRadioSlot(command.slot)
        return true
      }
      if (command.kind === 'pokegear-skin') {
        const { skin } = command
        const resources = ports.resources.read()
        const themeName = resources
          ? resolveHgssUiThemeNames(resources.speciesNames)[skin] ?? ''
          : ''
        openPokegearSkinConfirmation(ports.popup, themeName, () => {
          ports.skin.write(skin)
          ports.skin.apply(skin)
          ports.persist()
          refreshMenu()
        }, resources?.configureMessages ?? {})
        return true
      }
      return false
    },
  })
}
