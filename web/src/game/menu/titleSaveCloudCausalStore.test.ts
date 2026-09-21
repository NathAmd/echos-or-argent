import { describe, expect, it } from 'vitest'
import { createTitleSaveCloudCausalStore } from './titleSaveCloudCausalStore'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
}

const context = Object.freeze({
  serverUrl: 'https://online.example.com',
  accountId: 'alice',
  gameCode: 'IPKF',
  romIdentity: Object.freeze({ gameVersion: 7, language: 3 }),
})
const anchor = Object.freeze({
  localState: Object.freeze({ storageHash: 'A'.repeat(43), tombstoneChangedAt: null }),
  remoteEtag: `"r-${'1'.repeat(32)}"` as never,
  remoteMutation: `m-${'2'.repeat(32)}` as never,
})

describe('journal causal local du coffre cloud', () => {
  it('persiste une preuve minimale isolée par serveur, compte, ROM et slot', () => {
    const storage = memoryStorage()
    const store = createTitleSaveCloudCausalStore(storage)
    store.write(context, 2, anchor)

    expect(store.read(context)).toEqual(new Map([[2, anchor]]))
    expect(store.read({ ...context, accountId: 'bob' })).toEqual(new Map())
    expect([...storage.values.values()].join('')).not.toContain('savedAt')

    store.clear(context, 2)
    expect(store.read(context)).toEqual(new Map())
  })

  it('refuse une horloge, une révision ou une empreinte non canonique', () => {
    const storage = memoryStorage()
    const store = createTitleSaveCloudCausalStore(storage)
    store.write(context, 1, anchor)
    const key = [...storage.values.keys()][0]!
    storage.values.set(key, JSON.stringify({
      revision: 1,
      localState: { storageHash: 'court', tombstoneChangedAt: null },
      remoteEtag: anchor.remoteEtag,
      remoteMutation: 'm-libre',
    }))

    expect(() => store.read(context)).toThrow('journal causal cloud est corrompu')
  })
})
