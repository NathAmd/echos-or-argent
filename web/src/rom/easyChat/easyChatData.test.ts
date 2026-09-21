import { describe, expect, it } from 'vitest'
import { decodeHgssEasyChatCatalog, getHgssEasyChatWord, hgssEasyChatCategoryDefinitions } from './easyChatData'

describe('Easy Chat HGSS', () => {
  it('reproduit les banques, tailles et identifiants cumulatifs de la ROM', () => {
    const categoryLabels: Record<number, string> = { 0: 'POKéMON', 2: 'CAPACITE', 4: 'STATUT', 5: 'DRESSEUR', 6: 'PERSONNES', 7: 'POLITESSES', 8: 'VIE QUOTID.', 9: 'EMOTIONS', 10: 'MOTS SAVANTS', 11: 'UNION' }
    const catalog = decodeHgssEasyChatCatalog((bank): Record<number, string> => bank === 282
      ? categoryLabels
      : { 0: `Banque ${bank}`, 1: 'Mot{WAIT_PRESS}' })

    expect(catalog.categories.map(({ messageBankId, firstWordId, wordCount }) => ({ messageBankId, firstWordId, wordCount }))).toEqual([
      { messageBankId: 237, firstWordId: 0, wordCount: 496 },
      { messageBankId: 751, firstWordId: 496, wordCount: 468 },
      { messageBankId: 735, firstWordId: 964, wordCount: 18 },
      { messageBankId: 721, firstWordId: 982, wordCount: 124 },
      { messageBankId: 285, firstWordId: 1106, wordCount: 38 },
      { messageBankId: 286, firstWordId: 1144, wordCount: 38 },
      { messageBankId: 287, firstWordId: 1182, wordCount: 107 },
      { messageBankId: 288, firstWordId: 1289, wordCount: 104 },
      { messageBankId: 289, firstWordId: 1393, wordCount: 47 },
      { messageBankId: 290, firstWordId: 1440, wordCount: 32 },
      { messageBankId: 291, firstWordId: 1472, wordCount: 23 },
    ])
    expect(catalog.words).toHaveLength(1495)
    expect(getHgssEasyChatWord(catalog, 496)?.text).toBe('Banque 751')
    expect(getHgssEasyChatWord(catalog, 497)?.text).toBe('Mot')
    expect(getHgssEasyChatWord(catalog, 1495)).toBeUndefined()
    expect(catalog.categories.map(({ name }) => name)).toEqual([
      'POKéMON', 'CAPACITE', 'STATUT', 'STATUT', 'DRESSEUR', 'PERSONNES',
      'POLITESSES', 'VIE QUOTID.', 'EMOTIONS', 'MOTS SAVANTS', 'UNION',
    ])
    expect(hgssEasyChatCategoryDefinitions).toHaveLength(11)
  })

  it('ne remplace jamais un libellé ROM absent par un texte inventé', () => {
    const catalog = decodeHgssEasyChatCatalog(() => undefined)
    expect(catalog.categories.every(({ name }) => name === '')).toBe(true)
  })
})
