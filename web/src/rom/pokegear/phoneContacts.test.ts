import { describe, expect, it } from 'vitest'
import { decodePhoneContactMessageBankIds, hgssPhoneContactCount, locatePhoneContactMessageBankTable } from './phoneContacts'

const signature = [664, 716, 666, 662, 663, 643, 661, 660, 641, 665]

function createTableFixture(prefix = 18): Uint8Array {
  const bytes = new Uint8Array(prefix + hgssPhoneContactCount * 2 + 8)
  const view = new DataView(bytes.buffer)
  for (let contactId = 0; contactId < hgssPhoneContactCount; contactId += 1) {
    view.setUint16(prefix + contactId * 2, signature[contactId] ?? 600 + contactId, true)
  }
  return bytes
}

describe('HGSS Pokegear phone contacts', () => {
  it('locates and decodes the native contact-to-message-bank table', () => {
    const arm9 = createTableFixture()
    expect(locatePhoneContactMessageBankTable(arm9, 800)).toBe(18)
    expect(decodePhoneContactMessageBankIds(arm9, 800).slice(0, 10)).toEqual(signature)
  })

  it('rejects missing, duplicate, truncated, and out-of-range tables', () => {
    expect(() => locatePhoneContactMessageBankTable(new Uint8Array(200), 800)).toThrow('0 candidate')
    const fixture = createTableFixture()
    const duplicate = new Uint8Array(fixture.byteLength * 2)
    duplicate.set(fixture)
    duplicate.set(fixture, fixture.byteLength)
    expect(() => locatePhoneContactMessageBankTable(duplicate, 800)).toThrow('2 candidate')
    expect(() => locatePhoneContactMessageBankTable(fixture, 700)).toThrow('0 candidate')
    expect(() => decodePhoneContactMessageBankIds(fixture, 800, fixture.byteLength)).toThrow('hors limites')
  })
})
