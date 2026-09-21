import { describe, expect, it, vi } from 'vitest'
import type { HgssPhoneBookEntry } from '../../rom/phone/phoneBook'
import type { ChoicePopupController, ChoicePopupRequest } from '../ui/choicePopupController'
import type { MainMenuCommand, MainMenuResult, MainMenuState } from './mainMenuController'
import {
  createPokegearMenuCommandHost,
  type PokegearMenuCommandHostPorts,
  type PokegearMenuCommandResources,
} from './pokegearMenuCommandHost'

const menuState: MainMenuState = {
  open: true,
  screen: 'pokegear-phone',
  cursor: 0,
  items: [],
}

function commandResult(command: MainMenuCommand): MainMenuResult {
  return { kind: 'command', command, state: menuState }
}

function phoneBookEntry(id: number, alphabetOrder: number): HgssPhoneBookEntry {
  return {
    id,
    type: 0,
    unknown2: 0,
    trainerClass: 0,
    trainerId: 0,
    mapId: 0,
    giftItemId: 0,
    localScriptId: 0,
    unknownC: 0,
    rematchWeekday: 0,
    rematchTimeOfDay: 0,
    unknownF: 0,
    sortParameters: [0, alphabetOrder, 0, 0],
  }
}

function createResources(): PokegearMenuCommandResources {
  const contactNames: string[] = []
  contactNames[4] = 'Orme'
  const speciesNames: string[] = []
  speciesNames[384] = 'Rayquaza'
  return {
    contactNames,
    phoneMessages: {
      0: 'Appeler',
      1: 'Trier',
      2: 'Quitter',
      20: 'Que faire ?',
      30: 'Ligne indisponible.',
    },
    phoneBookEntries: [
      phoneBookEntry(1, 30),
      phoneBookEntry(2, 10),
      phoneBookEntry(3, 20),
    ],
    configureMessages: { 0: 'Appliquer', 1: 'Annuler' },
    speciesNames,
  }
}

function createFixture() {
  let resources: PokegearMenuCommandResources | undefined = createResources()
  let contacts: Iterable<number> = new Set([1, 2, 3])
  let callStarts = false
  const popupRequests: ChoicePopupRequest<unknown>[] = []
  const popupOpen = vi.fn((request: ChoicePopupRequest<unknown>) => {
    popupRequests.push(request)
  })
  const popup: ChoicePopupController = {
    isOpen: () => popupRequests.length > 0,
    open: popupOpen as ChoicePopupController['open'],
    close: vi.fn(),
    handle: vi.fn(() => false),
  }
  const refresh = vi.fn(() => menuState)
  const render = vi.fn()
  const setHidden = vi.fn()
  const selectContact = vi.fn()
  const selectRadioSlot = vi.fn()
  const startOutgoingCall = vi.fn(() => callStarts)
  const writeContacts = vi.fn((next: Set<number>) => { contacts = next })
  const writeSkin = vi.fn()
  const applySkin = vi.fn()
  const refreshPrompts = vi.fn()
  const persist = vi.fn()
  const setStatus = vi.fn()
  const ports: PokegearMenuCommandHostPorts = {
    menu: { refresh, render, setHidden },
    popup,
    ui: { selectContact, selectRadioSlot },
    outgoingCall: { start: startOutgoingCall },
    contacts: {
      read: () => contacts,
      write: writeContacts,
    },
    skin: { write: writeSkin, apply: applySkin },
    resources: { read: () => resources },
    prompts: { refresh: refreshPrompts },
    persist,
    setStatus,
  }
  const selectPopupValue = (value: unknown, requestIndex = popupRequests.length - 1): void => {
    popupRequests[requestIndex]!.onSelect(value)
  }
  return {
    host: createPokegearMenuCommandHost(ports),
    popupRequests,
    popupOpen,
    refresh,
    render,
    setHidden,
    selectContact,
    selectRadioSlot,
    startOutgoingCall,
    writeContacts,
    writeSkin,
    applySkin,
    refreshPrompts,
    persist,
    setStatus,
    selectPopupValue,
    setResources: (next: PokegearMenuCommandResources | undefined) => { resources = next },
    setCallStarts: (starts: boolean) => { callStarts = starts },
  }
}

describe('pokegear menu command host', () => {
  it('ne consomme pas les autres domaines et sélectionne directement la radio', () => {
    const fixture = createFixture()

    expect(fixture.host.handle({ kind: 'state', state: menuState })).toBe(false)
    expect(fixture.host.handle(commandResult('save'))).toBe(false)
    expect(fixture.host.handle(commandResult('pokegear-radio:5'))).toBe(true)
    expect(fixture.selectRadioSlot).toHaveBeenCalledWith(5)
    expect(fixture.popupOpen).not.toHaveBeenCalled()
  })

  it('ouvre le contact et restaure le menu quand l’appel ne démarre pas', () => {
    const fixture = createFixture()

    expect(fixture.host.handle(commandResult('pokegear-contact:4'))).toBe(true)
    expect(fixture.selectContact).toHaveBeenCalledWith(4)
    expect(fixture.popupRequests[0]).toMatchObject({
      title: 'Orme',
      message: 'Que faire ?',
      cancelIndex: 2,
    })

    const changedResources = createResources()
    changedResources.phoneMessages[30] = 'Le contact a raccroché.'
    fixture.setResources(changedResources)
    fixture.selectPopupValue('call')

    expect(fixture.setHidden.mock.calls).toEqual([[true], [false]])
    expect(fixture.startOutgoingCall).toHaveBeenCalledWith(4)
    expect(fixture.setStatus).toHaveBeenCalledWith('Le contact a raccroché.', 'warning')
    expect(fixture.render).toHaveBeenCalledWith(menuState)
    expect(fixture.refreshPrompts).toHaveBeenCalledOnce()
  })

  it('garde le menu masqué lorsqu’un appel démarre', () => {
    const fixture = createFixture()
    fixture.setCallStarts(true)
    fixture.host.handle(commandResult('pokegear-contact:4'))

    fixture.selectPopupValue('call')

    expect(fixture.setHidden).toHaveBeenCalledExactlyOnceWith(true)
    expect(fixture.setStatus).not.toHaveBeenCalled()
    expect(fixture.render).not.toHaveBeenCalled()
    expect(fixture.refreshPrompts).toHaveBeenCalledOnce()
  })

  it('trie les contacts avec les données ROM courantes puis persiste', () => {
    const fixture = createFixture()
    fixture.host.handle(commandResult('pokegear-contact:4'))

    fixture.selectPopupValue('sort')
    expect(fixture.popupRequests).toHaveLength(2)
    const changedResources = createResources()
    fixture.setResources({
      ...changedResources,
      phoneBookEntries: [
        phoneBookEntry(1, 20),
        phoneBookEntry(2, 30),
        phoneBookEntry(3, 10),
      ],
    })
    fixture.selectPopupValue('alphabet')

    expect([...fixture.writeContacts.mock.calls[0]![0]]).toEqual([3, 1, 2])
    expect(fixture.persist).toHaveBeenCalledOnce()
    expect(fixture.render).toHaveBeenCalledWith(menuState)
  })

  it('résout le nom du thème et applique le skin seulement après confirmation', () => {
    const fixture = createFixture()

    expect(fixture.host.handle(commandResult('pokegear-skin:2'))).toBe(true)
    expect(fixture.popupRequests[0]).toMatchObject({
      title: 'Rayquaza',
      initialIndex: 1,
      cancelIndex: 1,
    })
    expect(fixture.writeSkin).not.toHaveBeenCalled()

    fixture.selectPopupValue('apply')
    expect(fixture.writeSkin).toHaveBeenCalledWith(2)
    expect(fixture.applySkin).toHaveBeenCalledWith(2)
    expect(fixture.persist).toHaveBeenCalledOnce()
    expect(fixture.render).toHaveBeenCalledWith(menuState)
    expect(fixture.writeSkin.mock.invocationCallOrder[0]).toBeLessThan(fixture.applySkin.mock.invocationCallOrder[0]!)
    expect(fixture.applySkin.mock.invocationCallOrder[0]).toBeLessThan(fixture.persist.mock.invocationCallOrder[0]!)
    expect(fixture.persist.mock.invocationCallOrder[0]).toBeLessThan(fixture.render.mock.invocationCallOrder[0]!)
  })
})
