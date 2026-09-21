import { describe, expect, it } from 'vitest'
import {
  createHgssPhoneContacts,
  getHgssRegisteredPokegearApps,
  isHgssPhoneContactRegistered,
  registerHgssPhoneContact,
  registerHgssPokegearCard,
  restoreHgssPhoneContacts,
} from './phoneBook'

describe('native HGSS Pokegear save rules', () => {
  it('starts the phonebook with Mother in the first slot', () => {
    expect([...createHgssPhoneContacts()]).toEqual([0])
  })

  it('keeps registration order and ignores duplicates or invalid contact ids', () => {
    const contacts = createHgssPhoneContacts()
    expect(registerHgssPhoneContact(contacts, 12)).toBe(true)
    expect(registerHgssPhoneContact(contacts, 2)).toBe(true)
    expect(registerHgssPhoneContact(contacts, 12)).toBe(false)
    expect(registerHgssPhoneContact(contacts, 75)).toBe(false)
    expect([...contacts]).toEqual([0, 12, 2])
    expect(isHgssPhoneContactRegistered(contacts, 12)).toBe(true)
    expect(isHgssPhoneContactRegistered(contacts, 75)).toBe(false)
  })

  it('repairs legacy browser saves without reordering their valid contacts', () => {
    expect([...restoreHgssPhoneContacts([1, 2, 1, 99])]).toEqual([0, 1, 2])
  })

  it('always exposes Phone and mirrors the native Map/Radio card bits', () => {
    const cards = new Set<number>()
    expect(getHgssRegisteredPokegearApps(cards)).toEqual([0])
    registerHgssPokegearCard(cards, 2)
    registerHgssPokegearCard(cards, 1)
    expect(getHgssRegisteredPokegearApps(cards)).toEqual([0, 1, 2])
    registerHgssPokegearCard(cards, 0)
    expect(getHgssRegisteredPokegearApps(cards)).toEqual([0])
  })
})
