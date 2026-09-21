import type { RomFile } from '../../ndsTypes'

export type HgssTrainerMessageCatalog = ReadonlyMap<number, ReadonlyMap<number, string>>

/**
 * Décode la table native poketool/trmsg/trtbl. Chaque enregistrement associe
 * un Dresseur et un type de réplique au message de même index dans la banque
 * msg/0728.
 */
export function decodeHgssTrainerMessageCatalog(
  rom: Uint8Array,
  tableArchive: RomFile,
  messages: Readonly<Record<number, string>>,
): HgssTrainerMessageCatalog {
  const member = tableArchive.archiveMembers[0]
  if (!member || member.size % 4 !== 0 || member.offset < 0 || member.offset + member.size > rom.byteLength) {
    throw new Error('La table ROM HGSS des répliques de Dresseurs est invalide.')
  }
  const view = new DataView(rom.buffer, rom.byteOffset + member.offset, member.size)
  const byTrainer = new Map<number, Map<number, string>>()
  for (let index = 0; index < member.size / 4; index += 1) {
    const trainerId = view.getUint16(index * 4, true)
    const messageType = view.getUint16(index * 4 + 2, true)
    const text = messages[index]
    if (text === undefined) throw new Error(`La réplique ROM HGSS de Dresseur ${index} est absente de msg/0728.`)
    let trainerMessages = byTrainer.get(trainerId)
    if (!trainerMessages) {
      trainerMessages = new Map()
      byTrainer.set(trainerId, trainerMessages)
    }
    trainerMessages.set(messageType, text)
  }
  return byTrainer
}

export function getHgssTrainerMessage(catalog: HgssTrainerMessageCatalog, trainerId: number, messageType: number): string {
  // GetTrainerMessageByIdPair renvoie une chaîne vide si la paire n'existe pas.
  return catalog.get(trainerId)?.get(messageType) ?? ''
}
