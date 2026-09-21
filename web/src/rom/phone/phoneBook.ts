import type { RomFile } from '../../ndsTypes'

export const hgssPhoneBookEntrySize = 20

/**
 * Correspondance native `sPhoneMessageGmm` de HGSS. L'identifiant d'un
 * contact stocke dans pmtel_book.dat indexe directement cette table.
 */
export const hgssPhoneMessageBanks = [
  664, 716, 666, 662, 663, 643, 661, 660, 641, 665,
  675, 712, 680, 684, 711, 642, 706, 644, 648, 704,
  685, 688, 713, 714, 667, 691, 645, 649, 646, 650,
  651, 647, 656, 657, 658, 655, 652, 653, 654, 659,
  674, 705, 677, 698, 696, 708, 672, 690, 671, 695,
  689, 700, 693, 694, 669, 676, 715, 703, 710, 670,
  692, 681, 697, 687, 702, 699, 707, 682, 673, 686,
  683, 679, 701, 709, 678,
] as const

export const hgssPhoneContactCount = hgssPhoneMessageBanks.length
export const hgssInitialPhoneContactId = 0

/** SavePokegear_PhonebookInit registers Mother in slot zero before gameplay. */
export function createHgssPhoneContacts(): Set<number> {
  return new Set([hgssInitialPhoneContactId])
}

/**
 * Mirrors SavePokegear_RegisterPhoneNumber: invalid ids are ignored, an
 * existing contact is not moved, and new contacts keep registration order.
 */
export function registerHgssPhoneContact(contacts: Set<number>, contactId: number): boolean {
  if (!Number.isInteger(contactId) || contactId < 0 || contactId >= hgssPhoneContactCount || contacts.has(contactId)) return false
  contacts.add(contactId)
  return true
}

export function isHgssPhoneContactRegistered(contacts: ReadonlySet<number>, contactId: number): boolean {
  return Number.isInteger(contactId) && contactId >= 0 && contactId < hgssPhoneContactCount && contacts.has(contactId)
}

/** Repairs old browser saves while preserving the native slot order. */
export function restoreHgssPhoneContacts(contactIds: Iterable<number>): Set<number> {
  const contacts = createHgssPhoneContacts()
  for (const contactId of contactIds) registerHgssPhoneContact(contacts, contactId)
  return contacts
}

/** The Phone app is the base Pokégear app; only Map and Radio are card bits. */
export function getHgssRegisteredPokegearApps(cardIds: Iterable<number>): number[] {
  const registered = new Set(cardIds)
  const apps = [0]
  if (registered.has(1)) apps.push(1)
  if (registered.has(2)) apps.push(2)
  return apps
}

export function registerHgssPokegearCard(cardIds: Set<number>, cardId: number): void {
  if (cardId !== 1 && cardId !== 2) {
    // GEARCARD_PHONE is encoded as zero registered extension cards.
    cardIds.clear()
    return
  }
  cardIds.add(cardId)
}

export function getHgssPhoneMessageBank(contactId: number): number | undefined {
  return hgssPhoneMessageBanks[contactId]
}

export type HgssPhoneBookEntry = {
  id: number
  type: number
  unknown2: number
  trainerClass: number
  trainerId: number
  mapId: number
  giftItemId: number
  localScriptId: number
  unknownC: number
  rematchWeekday: number
  rematchTimeOfDay: number
  unknownF: number
  sortParameters: readonly [number, number, number, number]
}

export function decodeHgssPhoneBook(rom: Uint8Array, file: RomFile | undefined): HgssPhoneBookEntry[] {
  if (!file) throw new Error('Le fichier ROM tel/pmtel_book.dat est absent.')
  if (file.offset < 0 || file.offset + file.size > rom.byteLength || file.size < 4) {
    throw new Error('Le fichier ROM tel/pmtel_book.dat est hors limites.')
  }
  const bytes = rom.subarray(file.offset, file.offset + file.size)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = view.getUint32(0, true)
  if (count > 0xffff || 4 + count * hgssPhoneBookEntrySize !== bytes.byteLength) {
    throw new Error(`Le répertoire téléphonique HGSS contient ${count} entrées pour ${bytes.byteLength} octets.`)
  }
  return Array.from({ length: count }, (_, index) => {
    const offset = 4 + index * hgssPhoneBookEntrySize
    return {
      id: bytes[offset]!,
      type: bytes[offset + 1]!,
      unknown2: bytes[offset + 2]!,
      trainerClass: bytes[offset + 3]!,
      trainerId: view.getUint16(offset + 4, true),
      mapId: view.getUint16(offset + 6, true),
      giftItemId: view.getUint16(offset + 8, true),
      localScriptId: view.getUint16(offset + 10, true),
      unknownC: bytes[offset + 12]!,
      rematchWeekday: bytes[offset + 13]!,
      rematchTimeOfDay: bytes[offset + 14]!,
      unknownF: bytes[offset + 15]!,
      sortParameters: [bytes[offset + 16]!, bytes[offset + 17]!, bytes[offset + 18]!, bytes[offset + 19]!],
    }
  })
}
