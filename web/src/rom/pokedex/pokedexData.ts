import type { RomFile } from '../../ndsTypes'
import { stripMessageControls } from '../messages/hgssMessageBank'

export type HgssPokedexCatalog = {
  johtoDexNumbers: number[]
  uiMessages: string[]
  heartGoldDescriptions: string[]
  typeNames: string[]
  categoryNames: string[]
  heightLabels: string[]
  weightLabels: string[]
  heightsDecimeters: number[]
  weightsTenthsKg: number[]
}

function decodeHgssPokemonMeasurements(rom: Uint8Array, archive: RomFile | undefined, memberIndex: 0 | 1, label: string): number[] {
  const member = archive?.archiveMembers[memberIndex]
  if (!member) return []
  if (member.size !== 494 * 4 || member.offset < 0 || member.offset + member.size > rom.byteLength) {
    throw new Error(`La table ROM ${label} des Pokémon ${archive!.path} est invalide.`)
  }
  const view = new DataView(rom.buffer, rom.byteOffset + member.offset, member.size)
  return Array.from({ length: 494 }, (_, speciesId) => view.getUint32(speciesId * 4, true))
}

export const decodeHgssPokemonHeights = (rom: Uint8Array, archive?: RomFile): number[] => decodeHgssPokemonMeasurements(rom, archive, 0, 'des tailles')
export const decodeHgssPokemonWeights = (rom: Uint8Array, archive?: RomFile): number[] => decodeHgssPokemonMeasurements(rom, archive, 1, 'des poids')

const typeMessageIds: Readonly<Record<number, number>> = {
  0: 58,
  1: 50,
  2: 60,
  3: 56,
  4: 54,
  5: 48,
  6: 63,
  7: 53,
  8: 59,
  9: 64,
  10: 61,
  11: 62,
  12: 51,
  13: 55,
  14: 49,
  15: 52,
  16: 57,
  17: 47,
}

function messageArray(messages: Record<number, string> | undefined, minimumCount: number, label: string): string[] {
  if (!messages) throw new Error(`La banque ROM ${label} du Pokedex est absente.`)
  const count = Math.max(minimumCount - 1, ...Object.keys(messages).map(Number)) + 1
  return Array.from({ length: count }, (_, index) => stripMessageControls(messages[index] ?? ''))
}

export function decodeHgssJohtoDexNumbers(rom: Uint8Array, archive: RomFile): number[] {
  const member = archive.archiveMembers[0]
  if (!member || member.size !== 988 || member.offset + member.size > rom.byteLength) {
    throw new Error(`La table ROM du Pokedex de Johto ${archive.path} est absente ou invalide.`)
  }
  const view = new DataView(rom.buffer, rom.byteOffset + member.offset, member.size)
  return Array.from({ length: member.size / 2 }, (_, speciesId) => view.getUint16(speciesId * 2, true))
}

export function decodeHgssPokedexCatalog(
  rom: Uint8Array,
  johtoDexArchive: RomFile,
  uiMessageBank: Record<number, string> | undefined,
  heartGoldDescriptionBank: Record<number, string> | undefined,
  speciesDataArchive?: RomFile,
  localizedDataBanks: { categoryNames?: Record<number, string>, heightLabels?: Record<number, string>, weightLabels?: Record<number, string> } = {},
): HgssPokedexCatalog {
  const uiMessages = messageArray(uiMessageBank, 176, '802')
  const heartGoldDescriptions = messageArray(heartGoldDescriptionBank, 494, '803')
  return {
    johtoDexNumbers: decodeHgssJohtoDexNumbers(rom, johtoDexArchive),
    uiMessages,
    heartGoldDescriptions,
    typeNames: Array.from({ length: 18 }, (_, typeId) => uiMessages[typeMessageIds[typeId]!] ?? ''),
    categoryNames: messageArray(localizedDataBanks.categoryNames ?? {}, 494, '816'),
    heightLabels: messageArray(localizedDataBanks.heightLabels ?? {}, 494, '814'),
    weightLabels: messageArray(localizedDataBanks.weightLabels ?? {}, 494, '812'),
    heightsDecimeters: decodeHgssPokemonHeights(rom, speciesDataArchive),
    weightsTenthsKg: decodeHgssPokemonWeights(rom, speciesDataArchive),
  }
}
