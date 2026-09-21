import type { RomFile } from '../../ndsTypes'
import { decodeHgssMessageBank, stripMessageControls } from '../messages/hgssMessageBank'
import { readArm9FromRom } from '../maps/mapHeaders'

export const hgssPhoneContactCount = 75

const messageBankSignature = [664, 716, 666, 662, 663, 643, 661, 660, 641, 665] as const

export function locatePhoneContactMessageBankTable(arm9: Uint8Array, messageBankCount: number): number {
  const tableSize = hgssPhoneContactCount * 2
  const view = new DataView(arm9.buffer, arm9.byteOffset, arm9.byteLength)
  const matches: number[] = []
  for (let offset = 0; offset + tableSize <= arm9.byteLength; offset += 2) {
    if (!messageBankSignature.every((value, index) => view.getUint16(offset + index * 2, true) === value)) continue
    let valid = true
    for (let contactId = 0; contactId < hgssPhoneContactCount; contactId += 1) {
      if (view.getUint16(offset + contactId * 2, true) >= messageBankCount) {
        valid = false
        break
      }
    }
    if (valid) matches.push(offset)
  }
  if (matches.length !== 1) {
    throw new Error(`La table ARM9 des messages de contacts Pokématos doit être unique; ${matches.length} candidate(s) trouvée(s).`)
  }
  return matches[0]!
}

export function decodePhoneContactMessageBankIds(
  arm9: Uint8Array,
  messageBankCount: number,
  tableOffset = locatePhoneContactMessageBankTable(arm9, messageBankCount),
): number[] {
  const tableSize = hgssPhoneContactCount * 2
  if (!Number.isInteger(tableOffset) || tableOffset < 0 || tableOffset + tableSize > arm9.byteLength) {
    throw new Error('La table ARM9 des messages de contacts Pokématos est hors limites.')
  }
  const view = new DataView(arm9.buffer, arm9.byteOffset + tableOffset, tableSize)
  return Array.from({ length: hgssPhoneContactCount }, (_, contactId) => view.getUint16(contactId * 2, true))
}

export function decodePhoneContactNames(rom: Uint8Array, messagesArchive: RomFile): string[] {
  const bankIds = decodePhoneContactMessageBankIds(readArm9FromRom(rom), messagesArchive.archiveMembers.length)
  return bankIds.map((bankId, contactId) => {
    const messages = decodeHgssMessageBank(rom, messagesArchive.archiveMembers[bankId])
    const name = stripMessageControls(messages?.[0] ?? '')
    if (!name) throw new Error(`Le nom ROM du contact Pokématos ${contactId}, banque ${bankId}, est absent.`)
    return name
  })
}
