import type { NarcMember } from '../../ndsTypes'
import { decodeHgssMessageBank, stripMessageControls } from '../messages/hgssMessageBank'

export type HgssPokemonSummaryNames = {
  natureNames: string[]
  abilityNames: string[]
}

function decodeExactNameBank(
  rom: Uint8Array,
  member: NarcMember | undefined,
  bankId: number,
  expectedCount: number,
): string[] {
  const messages = decodeHgssMessageBank(rom, member)
  if (!messages || Object.keys(messages).length !== expectedCount) {
    throw new Error(`La banque ROM ${bankId} contient ${messages ? Object.keys(messages).length : 0} noms au lieu de ${expectedCount}.`)
  }
  return Array.from({ length: expectedCount }, (_, id) => {
    const name = stripMessageControls(messages[id] ?? '')
    if (!name) throw new Error(`Le nom ${id} de la banque ROM ${bankId} est absent.`)
    return name
  })
}

/** Banques msgdata confirmées dans la ROM française HGSS. */
export function decodeHgssPokemonSummaryNames(
  rom: Uint8Array,
  messageMembers: readonly NarcMember[],
): HgssPokemonSummaryNames {
  return {
    natureNames: decodeExactNameBank(rom, messageMembers[34], 34, 25),
    abilityNames: decodeExactNameBank(rom, messageMembers[720], 720, 124),
  }
}
