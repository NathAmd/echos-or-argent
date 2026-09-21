import { stripMessageControls } from '../messages/hgssMessageBank'

export type HgssEasyChatWord = {
  wordId: number
  messageId: number
  text: string
}

export type HgssEasyChatCategory = {
  id: number
  name: string
  messageBankId: number
  firstWordId: number
  wordCount: number
  words: HgssEasyChatWord[]
}

export type HgssEasyChatCatalog = {
  categories: HgssEasyChatCategory[]
  words: HgssEasyChatWord[]
}

/**
 * Ordre, banques et tailles de sNarcMsgBanks/sNarcMsgCounts dans easy_chat.c.
 * `categoryMessageId` pointe vers la banque 282 utilisée par l'interface HGSS ;
 * aucune traduction de catégorie n'est maintenue dans le runtime.
 */
export const hgssEasyChatCategoryDefinitions = [
  { categoryMessageId: 0, messageBankId: 237, wordCount: 496 },
  { categoryMessageId: 2, messageBankId: 751, wordCount: 468 },
  { categoryMessageId: 4, messageBankId: 735, wordCount: 18 },
  { categoryMessageId: 4, messageBankId: 721, wordCount: 124 },
  { categoryMessageId: 5, messageBankId: 285, wordCount: 38 },
  { categoryMessageId: 6, messageBankId: 286, wordCount: 38 },
  { categoryMessageId: 7, messageBankId: 287, wordCount: 107 },
  { categoryMessageId: 8, messageBankId: 288, wordCount: 104 },
  { categoryMessageId: 9, messageBankId: 289, wordCount: 47 },
  { categoryMessageId: 10, messageBankId: 290, wordCount: 32 },
  { categoryMessageId: 11, messageBankId: 291, wordCount: 23 },
] as const

export function decodeHgssEasyChatCatalog(
  readMessageBank: (bankId: number) => Record<number, string> | undefined,
): HgssEasyChatCatalog {
  let firstWordId = 0
  const categoryMessages = readMessageBank(282) ?? {}
  const categories = hgssEasyChatCategoryDefinitions.map((definition, id): HgssEasyChatCategory => {
    const messages = readMessageBank(definition.messageBankId) ?? {}
    const words = Array.from({ length: definition.wordCount }, (_, messageId): HgssEasyChatWord => ({
      wordId: firstWordId + messageId,
      messageId,
      text: stripMessageControls(messages[messageId] ?? ''),
    }))
    const category = {
      id,
      messageBankId: definition.messageBankId,
      wordCount: definition.wordCount,
      name: stripMessageControls(categoryMessages[definition.categoryMessageId] ?? ''),
      firstWordId,
      words,
    }
    firstWordId += definition.wordCount
    return category
  })
  return { categories, words: categories.flatMap((category) => category.words) }
}

export function getHgssEasyChatWord(catalog: HgssEasyChatCatalog, wordId: number): HgssEasyChatWord | undefined {
  return Number.isInteger(wordId) && wordId >= 0 && wordId < catalog.words.length
    ? catalog.words[wordId]
    : undefined
}
