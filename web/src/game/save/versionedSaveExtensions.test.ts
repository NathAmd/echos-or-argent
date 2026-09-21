import { describe, expect, it } from 'vitest'
import {
  createVersionedSaveExtensionRegistry,
  defineVersionedSaveExtension,
  isJsonSaveValue,
  isVersionedSaveExtensionsEnvelope,
  type JsonSaveValue,
} from './versionedSaveExtensions'

type CounterValue = { count: number }
type SaveContext = { counter?: number, label?: string }
type LoadContext = { counter: number, label: string, loaded: string[] }

function isCounterValue(value: unknown): value is CounterValue {
  return !!value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === 1
    && 'count' in value
    && typeof value.count === 'number'
    && Number.isSafeInteger(value.count)
    && value.count >= 0
}

function createCounterContributor(key = 'campaign.counter') {
  return defineVersionedSaveExtension({
    key,
    version: 1,
    save: (context: SaveContext): CounterValue | undefined => (
      context.counter === undefined ? undefined : { count: context.counter }
    ),
    validate: isCounterValue,
    load: (context: LoadContext, value: CounterValue) => {
      context.counter = value.count
      context.loaded.push(key)
    },
  })
}

function createLabelContributor(key = 'campaign.label') {
  return defineVersionedSaveExtension({
    key,
    version: 2,
    save: (context: SaveContext): string | undefined => context.label,
    validate: (value: unknown): value is string => typeof value === 'string' && value.length > 0,
    load: (context: LoadContext, value: string) => {
      context.label = value
      context.loaded.push(key)
    },
  })
}

describe('versioned save extensions', () => {
  it('is neutral by default and accepts an absent extension block', () => {
    const registry = createVersionedSaveExtensionRegistry<SaveContext, LoadContext>([])
    const target: LoadContext = { counter: 0, label: '', loaded: [] }

    expect(registry.keys).toEqual([])
    expect(registry.save({})).toEqual({})
    expect(registry.validate(undefined)).toBe(true)
    expect(registry.validate({})).toBe(true)
    expect(() => registry.load(target, undefined)).not.toThrow()
    expect(() => registry.load(target, {})).not.toThrow()
    expect(target.loaded).toEqual([])
  })

  it('saves, validates and restores a typed contributor value', () => {
    const registry = createVersionedSaveExtensionRegistry([createCounterContributor()])
    const saved = registry.save({ counter: 7 })
    const target: LoadContext = { counter: 0, label: '', loaded: [] }

    expect(saved).toEqual({
      'campaign.counter': { version: 1, value: { count: 7 } },
    })
    expect(registry.validate(saved)).toBe(true)
    registry.load(target, saved)
    expect(target).toEqual({ counter: 7, label: '', loaded: ['campaign.counter'] })
  })

  it('omits absent contributor entries and leaves them untouched while loading', () => {
    const registry = createVersionedSaveExtensionRegistry([
      createCounterContributor(),
      createLabelContributor(),
    ])
    const target: LoadContext = { counter: 4, label: 'Avant', loaded: [] }
    const saved = registry.save({ label: 'Après' })

    expect(saved).toEqual({
      'campaign.label': { version: 2, value: 'Après' },
    })
    registry.load(target, saved)
    expect(target).toEqual({ counter: 4, label: 'Après', loaded: ['campaign.label'] })
  })

  it('composes keys and load operations deterministically regardless of registration order', () => {
    const registry = createVersionedSaveExtensionRegistry([
      createLabelContributor('zeta.label'),
      createCounterContributor('alpha.counter'),
    ])
    const saved = registry.save({ counter: 3, label: 'Johto' })
    const target: LoadContext = { counter: 0, label: '', loaded: [] }

    expect(registry.keys).toEqual(['alpha.counter', 'zeta.label'])
    expect(Object.keys(saved)).toEqual(['alpha.counter', 'zeta.label'])
    registry.load(target, {
      'zeta.label': saved['zeta.label'],
      'alpha.counter': saved['alpha.counter'],
    })
    expect(target.loaded).toEqual(['alpha.counter', 'zeta.label'])
  })

  it('rejects duplicate, malformed and invalid contributor identities', () => {
    const duplicate = createCounterContributor()
    expect(() => createVersionedSaveExtensionRegistry([duplicate, duplicate])).toThrow('plusieurs fois')

    expect(() => defineVersionedSaveExtension({
      key: 'Invalid Key',
      version: 1,
      save: (): null => null,
      validate: (value: unknown): value is null => value === null,
      load: () => undefined,
    })).toThrow('clé')

    expect(() => defineVersionedSaveExtension({
      key: 'campaign.invalid-version',
      version: 0,
      save: (): null => null,
      validate: (value: unknown): value is null => value === null,
      load: () => undefined,
    })).toThrow('version')
  })

  it('refuses unknown keys, unknown versions and malformed envelopes', () => {
    const registry = createVersionedSaveExtensionRegistry([createCounterContributor()])
    const target: LoadContext = { counter: 0, label: '', loaded: [] }
    const invalidValues: unknown[] = [
      null,
      [],
      { 'unknown.module': { version: 1, value: null } },
      { 'campaign.counter': { version: 99, value: { count: 1 } } },
      { 'campaign.counter': { version: 1 } },
      { 'campaign.counter': { version: 1, value: { count: 1 }, extra: true } },
      { 'campaign.counter': { version: 1, value: { count: -1 } } },
    ]

    for (const value of invalidValues) {
      expect(registry.validate(value)).toBe(false)
      expect(() => registry.load(target, value)).toThrow()
    }
    expect(target.loaded).toEqual([])
  })

  it('validates every entry before invoking any load operation', () => {
    const registry = createVersionedSaveExtensionRegistry([
      createCounterContributor('alpha.counter'),
      createLabelContributor('zeta.label'),
    ])
    const target: LoadContext = { counter: 0, label: 'Avant', loaded: [] }

    expect(() => registry.load(target, {
      'alpha.counter': { version: 1, value: { count: 8 } },
      'zeta.label': { version: 2, value: '' },
    })).toThrow('zeta.label')
    expect(target).toEqual({ counter: 0, label: 'Avant', loaded: [] })
  })

  it('refuses non-JSON or contributor-invalid values produced while saving', () => {
    const invalidJsonContributor = defineVersionedSaveExtension({
      key: 'invalid.json',
      version: 1,
      save: () => ({ missing: undefined } as unknown as JsonSaveValue),
      validate: (value: unknown): value is JsonSaveValue => value !== undefined,
      load: () => undefined,
    })
    const invalidDomainContributor = defineVersionedSaveExtension({
      key: 'invalid.domain',
      version: 1,
      save: (): CounterValue => ({ count: -1 }),
      validate: isCounterValue,
      load: () => undefined,
    })

    expect(() => createVersionedSaveExtensionRegistry([invalidJsonContributor]).save({})).toThrow('invalid.json')
    expect(() => createVersionedSaveExtensionRegistry([invalidDomainContributor]).save({})).toThrow('invalid.domain')
  })
})

describe('JSON save values', () => {
  it('accepts nested finite JSON values and repeated non-cyclic references', () => {
    const shared = { region: 'Johto' }
    expect(isJsonSaveValue({ enabled: true, count: 2, empty: null, list: [shared, shared] })).toBe(true)
  })

  it('rejects lossy primitives, sparse arrays, class instances, symbols and cycles', () => {
    const sparse: unknown[] = []
    sparse.length = 1
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic
    const symbolProperty = { valid: true }
    Object.defineProperty(symbolProperty, Symbol('hidden'), { value: true, enumerable: true })

    for (const value of [
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1n,
      () => undefined,
      new Date('2026-08-25T00:00:00.000Z'),
      sparse,
      cyclic,
      symbolProperty,
    ]) expect(isJsonSaveValue(value)).toBe(false)
  })

  it('valide une enveloppe versionnée sans connaître les modules installés', () => {
    expect(isVersionedSaveExtensionsEnvelope({
      'challenge.state': { version: 1, value: { defeated: ['pokemon-1'] } },
    })).toBe(true)
    expect(isVersionedSaveExtensionsEnvelope({ challenge: { version: 0, value: null } })).toBe(false)
    expect(isVersionedSaveExtensionsEnvelope({ challenge: { version: 1, value: null, extra: true } })).toBe(false)
  })
})
