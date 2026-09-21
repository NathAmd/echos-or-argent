import { describe, expect, it } from 'vitest'
import {
  OPAQUE_JSON_LIMITS,
  createOpaqueVaultContext,
  exportOpaqueVaultKey,
  freezeOpaqueJsonData,
  generateOpaqueVaultKey,
  importOpaqueVaultKey,
  isSealedOpaqueVaultEnvelopeFor,
  openOpaqueJson,
  parseOpaqueVaultEnvelope,
  sealOpaqueJson,
  type OpaqueJsonObject,
  type OpaqueVaultEnvelope,
  type OpaqueVaultContext,
} from './opaqueJsonVault'

const primaryObjectId = 'AAAAAAAAAAAAAAAAAAAAAA'
const secondaryObjectId = `${'A'.repeat(21)}Q`

function vaultContext(ownerId = 'alice', objectId = primaryObjectId) {
  return createOpaqueVaultContext(ownerId, objectId)
}

function changeFirstCharacter(value: string): string {
  return `${value[0] === 'A' ? 'B' : 'A'}${value.slice(1)}`
}

describe('coffre JSON opaque côté client', () => {
  it('génère, exporte et importe une clé aléatoire de 256 bits', async () => {
    const generated = await generateOpaqueVaultKey()
    const encoded = await exportOpaqueVaultKey(generated)
    const imported = await importOpaqueVaultKey(encoded)

    expect(encoded).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(generated).toMatchObject({ type: 'secret', extractable: true, usages: ['encrypt', 'decrypt'] })
    expect(generated.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 })
    expect(await exportOpaqueVaultKey(imported)).toBe(encoded)

    const context = vaultContext()
    const envelope = await sealOpaqueJson(imported, { counter: 7 }, context)
    await expect(openOpaqueJson(generated, envelope, context)).resolves.toEqual({ counter: 7 })
  })

  it.each([
    '',
    'A'.repeat(42),
    'A'.repeat(44),
    `${'A'.repeat(43)}=`,
    '*'.repeat(43),
  ])('refuse une clé exportée non canonique (%s)', async (encoded) => {
    await expect(importOpaqueVaultKey(encoded)).rejects.toMatchObject({ code: 'invalid-key' })
  })

  it('scelle avec AES-GCM, un IV neuf et une enveloppe wire exacte gelée', async () => {
    const key = await generateOpaqueVaultKey()
    const context = vaultContext()
    const first = await sealOpaqueJson(key, { active: true, count: 3 }, context)
    const second = await sealOpaqueJson(key, { active: true, count: 3 }, context)

    expect(first).toEqual({
      version: 1,
      algorithm: 'A256GCM',
      iv: expect.stringMatching(/^[A-Za-z0-9_-]{16}$/),
      ciphertext: expect.stringMatching(/^[A-Za-z0-9_-]+$/),
    })
    expect(Reflect.ownKeys(first).sort()).toEqual(['algorithm', 'ciphertext', 'iv', 'version'])
    expect(Object.isFrozen(first)).toBe(true)
    expect(second.iv).not.toBe(first.iv)
    expect(second.ciphertext).not.toBe(first.ciphertext)
    await expect(openOpaqueJson(key, first, context)).resolves.toEqual({ active: true, count: 3 })
  })

  it('authentifie le contexte et refuse une autre clé ou toute altération', async () => {
    const key = await generateOpaqueVaultKey()
    const otherKey = await generateOpaqueVaultKey()
    const context = vaultContext('owner-1')
    const otherOwnerContext = vaultContext('owner-2')
    const otherObjectContext = vaultContext('owner-1', secondaryObjectId)
    const envelope = await sealOpaqueJson(key, { value: 'opaque' }, context)
    const changedIv = { ...envelope, iv: changeFirstCharacter(envelope.iv) }
    const changedCiphertext = { ...envelope, ciphertext: changeFirstCharacter(envelope.ciphertext) }

    await expect(openOpaqueJson(key, envelope, otherOwnerContext)).rejects.toMatchObject({ code: 'open-failed' })
    await expect(openOpaqueJson(key, envelope, otherObjectContext)).rejects.toMatchObject({ code: 'open-failed' })
    await expect(openOpaqueJson(otherKey, envelope, context)).rejects.toMatchObject({ code: 'open-failed' })
    await expect(openOpaqueJson(key, changedIv, context)).rejects.toThrow()
    await expect(openOpaqueJson(key, changedCiphertext, context)).rejects.toThrow()
  })

  it('rend toute la donnée ouverte récursivement immuable', async () => {
    const key = await generateOpaqueVaultKey()
    const context = vaultContext()
    const envelope = await sealOpaqueJson(key, { nested: { list: [1, { enabled: true }] } }, context)
    const opened = await openOpaqueJson(key, envelope, context) as OpaqueJsonObject
    const nested = opened.nested as OpaqueJsonObject
    const list = nested.list as readonly unknown[]

    expect(opened).toEqual({ nested: { list: [1, { enabled: true }] } })
    expect(Object.isFrozen(opened)).toBe(true)
    expect(Object.isFrozen(nested)).toBe(true)
    expect(Object.isFrozen(list)).toBe(true)
    expect(Object.isFrozen(list[1])).toBe(true)
  })

  it('accepte uniquement des primitives, tableaux et objets JSON ordinaires', () => {
    class CustomValue {
      readonly value = 1
    }
    const nullPrototype = Object.create(null) as Record<string, unknown>
    nullPrototype.value = 1
    const sparse = new Array<unknown>(2)
    sparse[1] = 'present'
    const withGetter = Object.defineProperty({}, 'value', { enumerable: true, get: () => 1 })
    const withHidden = Object.defineProperty({ visible: true }, 'hidden', { value: true })
    const withSymbol = { value: 1, [Symbol('extra')]: 2 }
    const arrayWithProperty = Object.assign([1], { extra: 2 })

    const rejected: unknown[] = [
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1n,
      Symbol('value'),
      () => undefined,
      new Date(),
      new CustomValue(),
      nullPrototype,
      new ArrayBuffer(4),
      new Uint8Array(4),
      new Blob(['value']),
      sparse,
      withGetter,
      withHidden,
      withSymbol,
      arrayWithProperty,
    ]
    for (const value of rejected) expect(() => freezeOpaqueJsonData(value)).toThrow()
  })

  it('refuse les cycles et les références partagées au lieu de sérialiser un graphe ambigu', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    const shared = { value: 1 }

    expect(() => freezeOpaqueJsonData(cyclic)).toThrow()
    expect(() => freezeOpaqueJsonData({ first: shared, second: shared })).toThrow()
  })

  it('copie sans pollution les clés JSON qui ressemblent à des propriétés de prototype', () => {
    const source = JSON.parse('{"__proto__":{"safe":true},"constructor":"data"}') as unknown
    const frozen = freezeOpaqueJsonData(source) as OpaqueJsonObject

    expect(Object.getPrototypeOf(frozen)).toBe(Object.prototype)
    expect(Object.hasOwn(frozen, '__proto__')).toBe(true)
    expect(frozen.__proto__).toEqual({ safe: true })
    expect(frozen.constructor).toBe('data')
    expect(({} as { safe?: boolean }).safe).toBeUndefined()
  })

  it('applique les plafonds de profondeur et de nombre de nœuds', () => {
    let tooDeep: unknown = null
    for (let depth = 0; depth <= OPAQUE_JSON_LIMITS.depth; depth += 1) tooDeep = { child: tooDeep }
    const tooMany = new Array(OPAQUE_JSON_LIMITS.nodes).fill(0)

    expect(() => freezeOpaqueJsonData(tooDeep)).toThrow()
    expect(() => freezeOpaqueJsonData(tooMany)).toThrow()
  })

  it('accepte exactement 1 Mio de JSON puis refuse un octet supplémentaire', async () => {
    const key = await generateOpaqueVaultKey()
    const exact = 'a'.repeat(OPAQUE_JSON_LIMITS.plaintextBytes - 2)
    const oversized = `${exact}a`

    const context = vaultContext()
    const envelope = await sealOpaqueJson(key, exact, context)
    expect(envelope.ciphertext.length).toBeLessThanOrEqual(Math.ceil(OPAQUE_JSON_LIMITS.ciphertextBytes * 4 / 3))
    await expect(openOpaqueJson(key, envelope, context)).resolves.toBe(exact)
    await expect(sealOpaqueJson(key, oversized, context)).rejects.toMatchObject({ code: 'limit-exceeded' })
  })

  it('exige un contexte canonique lie au protocole, au compte et a l’objet', async () => {
    const key = await generateOpaqueVaultKey()
    const context = vaultContext()

    expect(context).toEqual({ protocol: 'opaque-json-vault.v1', ownerId: 'alice', objectId: primaryObjectId })
    expect(Object.isFrozen(context)).toBe(true)
    expect(() => createOpaqueVaultContext('owner:invalid', primaryObjectId)).toThrow()
    expect(() => createOpaqueVaultContext('alice', 'primary')).toThrow()
    await expect(sealOpaqueJson(key, null, undefined as never)).rejects.toMatchObject({ code: 'invalid-context' })
    await expect(sealOpaqueJson(key, null, {
      ...context,
      objectId: secondaryObjectId,
      extra: true,
    } as never)).rejects.toMatchObject({ code: 'invalid-context' })
  })

  it('mémorise une copie canonique du contexte même si l’appelant fournit un objet mutable', async () => {
    const key = await generateOpaqueVaultKey()
    const mutableContext = { ...vaultContext() } as OpaqueVaultContext
    const envelope = await sealOpaqueJson(key, { value: 1 }, mutableContext)

    Object.assign(mutableContext, { ownerId: 'bob', objectId: secondaryObjectId })

    expect(isSealedOpaqueVaultEnvelopeFor(envelope, 'alice', primaryObjectId)).toBe(true)
    expect(isSealedOpaqueVaultEnvelopeFor(envelope, 'bob', secondaryObjectId)).toBe(false)
    await expect(openOpaqueJson(key, envelope, vaultContext())).resolves.toEqual({ value: 1 })
  })

  it.each([
    null,
    {},
    { version: 1, algorithm: 'A256GCM', iv: 'A'.repeat(16), ciphertext: 'A'.repeat(22), extra: true },
    { version: 2, algorithm: 'A256GCM', iv: 'A'.repeat(16), ciphertext: 'A'.repeat(22) },
    { version: 1, algorithm: 'AES-GCM', iv: 'A'.repeat(16), ciphertext: 'A'.repeat(22) },
    { version: 1, algorithm: 'A256GCM', iv: `${'A'.repeat(16)}=`, ciphertext: 'A'.repeat(22) },
    { version: 1, algorithm: 'A256GCM', iv: 'A'.repeat(16), ciphertext: 'A'.repeat(1_400_000) },
    Object.assign(Object.create(null) as object, {
      version: 1, algorithm: 'A256GCM', iv: 'A'.repeat(16), ciphertext: 'A'.repeat(22),
    }),
  ])('refuse une enveloppe non exacte ou non bornée', (value) => {
    expect(parseOpaqueVaultEnvelope(value)).toBeUndefined()
  })

  it('retourne une nouvelle enveloppe validée et gelée', async () => {
    const key = await generateOpaqueVaultKey()
    const envelope = await sealOpaqueJson(key, true, vaultContext())
    const mutable: OpaqueVaultEnvelope = { ...envelope }
    const parsed = parseOpaqueVaultEnvelope(mutable)

    expect(parsed).toEqual(envelope)
    expect(parsed).not.toBe(mutable)
    expect(Object.isFrozen(parsed)).toBe(true)
  })
})
