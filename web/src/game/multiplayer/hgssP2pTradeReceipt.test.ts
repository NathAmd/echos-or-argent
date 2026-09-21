import { describe, expect, it } from 'vitest'
import {
  appendHgssP2pTradeReceipt,
  hgssP2pTradeReceiptLimit,
  parseHgssP2pTradeReceipt,
  parseHgssP2pTradeReceipts,
  type HgssP2pTradeReceipt,
} from './hgssP2pTradeReceipt'

const pokemonId = (suffix: string) => `pkm:v1:r:${suffix.padStart(32, '0')}`
const transactionId = (prefix: string) => `${prefix.padEnd(21, 'A')}A`

function receipt(index: number): HgssP2pTradeReceipt {
  return {
    transactionId: transactionId(index.toString(36)),
    sentPokemonInstanceId: pokemonId((index * 2 + 1).toString(16)) as HgssP2pTradeReceipt['sentPokemonInstanceId'],
    receivedPokemonInstanceId: pokemonId((index * 2 + 2).toString(16)) as HgssP2pTradeReceipt['receivedPokemonInstanceId'],
  }
}

describe('HGSS P2P trade receipts', () => {
  it('accepts only strict data-only receipts', () => {
    expect(parseHgssP2pTradeReceipt(receipt(1))).toEqual(receipt(1))
    expect(() => parseHgssP2pTradeReceipt({ ...receipt(1), speciesName: 'ROM TEXT' })).toThrow('invalide')
    expect(() => parseHgssP2pTradeReceipt({ ...receipt(1), transactionId: 'trade-1' })).toThrow('invalide')
    expect(() => parseHgssP2pTradeReceipt({
      ...receipt(1),
      receivedPokemonInstanceId: receipt(1).sentPokemonInstanceId,
    })).toThrow('meme Pokemon')
  })

  it('rejects duplicate transaction identities', () => {
    expect(() => parseHgssP2pTradeReceipts([receipt(1), receipt(1)])).toThrow('dupliquee')
  })

  it('appends idempotently, rejects conflicting results and keeps a bounded tail', () => {
    expect(appendHgssP2pTradeReceipt([receipt(1)], receipt(1))).toEqual([receipt(1)])
    expect(() => appendHgssP2pTradeReceipt([receipt(1)], {
      ...receipt(2), transactionId: receipt(1).transactionId,
    })).toThrow('autre resultat')

    const receipts = Array.from({ length: hgssP2pTradeReceiptLimit }, (_, index) => receipt(index))
    const appended = appendHgssP2pTradeReceipt(receipts, receipt(hgssP2pTradeReceiptLimit))
    expect(appended).toHaveLength(hgssP2pTradeReceiptLimit)
    expect(appended[0]).toEqual(receipt(1))
    expect(appended.at(-1)).toEqual(receipt(hgssP2pTradeReceiptLimit))
  })
})
