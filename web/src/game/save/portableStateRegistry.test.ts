import { describe, expect, it } from 'vitest'
import {
  createPortableStateRegistry,
  definePortableStateContributor,
  MAX_PORTABLE_STATE_CONTRIBUTORS,
  MAX_PORTABLE_STATE_KEY_LENGTH,
  PORTABLE_STATE_FORMAT,
  isPortableStateDocument,
} from './portableStateRegistry'
import type { JsonSaveValue } from './versionedSaveExtensions'

type ProjectContext = {
  counter?: number
  label?: string
  unregisteredSecret?: string
}

type HydrateContext = {
  counter: number
  label: string
  hydrated: string[]
}

type CounterValue = Readonly<{ count: number }>

function decodeCounter(value: JsonSaveValue): CounterValue {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.keys(value).length !== 1
    || !('count' in value)
    || !Number.isSafeInteger(value.count)
    || (value.count as number) < 0
  ) throw new Error('invalid counter')
  return { count: value.count as number }
}

function counterContributor(key = 'state.counter') {
  return definePortableStateContributor<ProjectContext, HydrateContext, CounterValue>({
    key,
    version: 1,
    project: (context) => context.counter === undefined ? undefined : { count: context.counter },
    decode: decodeCounter,
    hydrate: (context, value) => {
      context.counter = value.count
      context.hydrated.push(key)
    },
  })
}

function labelContributor(key = 'state.label') {
  return definePortableStateContributor<ProjectContext, HydrateContext, string>({
    key,
    version: 2,
    project: (context) => context.label,
    decode: (value) => {
      if (typeof value !== 'string' || value.length === 0) throw new Error('invalid label')
      return value
    },
    hydrate: (context, value) => {
      context.label = value
      context.hydrated.push(key)
    },
  })
}

describe('portable state registry', () => {
  it('projects only explicitly registered contributors, with no raw fallback API', () => {
    const registry = createPortableStateRegistry([counterContributor()])
    const wire = registry.project({ counter: 5, unregisteredSecret: 'must-stay-local' })

    expect(wire).toEqual({
      format: PORTABLE_STATE_FORMAT,
      version: 1,
      entries: {
        'state.counter': { version: 1, value: { count: 5 } },
      },
    })
    expect(JSON.stringify(wire)).not.toContain('unregisteredSecret')
    expect(JSON.stringify(wire)).not.toContain('must-stay-local')
    expect(isPortableStateDocument(wire)).toBe(true)
    expect(registry.owns(wire)).toBe(true)
    expect(createPortableStateRegistry([counterContributor()]).owns(wire)).toBe(false)
    expect(isPortableStateDocument(structuredClone(wire))).toBe(false)
    expect('projectUnknown' in registry).toBe(false)
    expect('projectRaw' in registry).toBe(false)
    expect('raw' in registry).toBe(false)
  })

  it('omits absent values and orders registered keys deterministically', () => {
    const registry = createPortableStateRegistry([
      labelContributor('zeta.label'),
      counterContributor('alpha.counter'),
    ])

    expect(registry.keys).toEqual(['alpha.counter', 'zeta.label'])
    expect(Object.keys(registry.project({ label: 'ready' }).entries)).toEqual(['zeta.label'])
    expect(Object.keys(registry.project({ counter: 2, label: 'ready' }).entries)).toEqual([
      'alpha.counter',
      'zeta.label',
    ])
  })

  it('copies and deeply freezes projections without freezing or mutating their source', () => {
    const sourceValue = { count: 3 }
    const source: ProjectContext = { counter: sourceValue.count }
    const contributor = definePortableStateContributor<ProjectContext, HydrateContext, CounterValue>({
      key: 'copy.counter',
      version: 1,
      project: () => sourceValue,
      decode: decodeCounter,
      hydrate: () => undefined,
    })
    const wire = createPortableStateRegistry([contributor]).project(source)
    const projected = wire.entries['copy.counter']!.value as { count: number }

    sourceValue.count = 8
    expect(projected.count).toBe(3)
    expect(Object.isFrozen(wire)).toBe(true)
    expect(Object.isFrozen(wire.entries)).toBe(true)
    expect(Object.isFrozen(wire.entries['copy.counter'])).toBe(true)
    expect(Object.isFrozen(projected)).toBe(true)
    expect(Object.isFrozen(sourceValue)).toBe(false)
    expect(source).toEqual({ counter: 3 })
  })

  it('decodes to an isolated frozen copy and never mutates the wire source', () => {
    const registry = createPortableStateRegistry([counterContributor()])
    const source = {
      format: 'portable-state',
      version: 1,
      entries: { 'state.counter': { version: 1, value: { count: 9 } } },
    }
    const before = structuredClone(source)
    const decoded = registry.decode(source)

    expect(decoded).toEqual(source)
    expect(decoded).not.toBe(source)
    expect(decoded.entries['state.counter']!.value).not.toBe(source.entries['state.counter'].value)
    expect(Object.isFrozen(decoded.entries['state.counter']!.value)).toBe(true)
    expect(isPortableStateDocument(source)).toBe(false)
    expect(isPortableStateDocument(decoded)).toBe(true)
    expect(registry.owns(decoded)).toBe(true)
    expect(source).toEqual(before)
  })

  it('refuses unknown keys, versions, extra fields and invalid JSON', () => {
    const registry = createPortableStateRegistry([counterContributor()])
    const valid = registry.project({ counter: 1 })
    const invalidValues: unknown[] = [
      null,
      [],
      { ...valid, extra: true },
      { ...valid, version: 2 },
      { ...valid, entries: { unknown: { version: 1, value: null } } },
      { ...valid, entries: { 'state.counter': { version: 2, value: { count: 1 } } } },
      { ...valid, entries: { 'state.counter': { version: 1, value: { count: 1 }, extra: true } } },
      { ...valid, entries: { 'state.counter': { version: 1, value: { count: 1, extra: true } } } },
      { ...valid, entries: { 'state.counter': { version: 1, value: { count: Number.NaN } } } },
      { ...valid, entries: { 'state.counter': { version: 1, value: { count: undefined } } } },
    ]

    for (const value of invalidValues) {
      expect(registry.validate(value)).toBe(false)
      expect(() => registry.decode(value)).toThrow()
    }
  })

  it('validates and decodes every entry before the first hydration', () => {
    const registry = createPortableStateRegistry([
      counterContributor('alpha.counter'),
      labelContributor('zeta.label'),
    ])
    const target: HydrateContext = { counter: 0, label: 'before', hydrated: [] }

    expect(() => registry.hydrateDraft(target, {
      format: PORTABLE_STATE_FORMAT,
      version: 1,
      entries: {
        'alpha.counter': { version: 1, value: { count: 7 } },
        'zeta.label': { version: 2, value: '' },
      },
    })).toThrow('zeta.label')
    expect(target).toEqual({ counter: 0, label: 'before', hydrated: [] })
    expect('hydrate' in registry).toBe(false)
  })

  it('hydrates an isolated draft in deterministic order', () => {
    const registry = createPortableStateRegistry([
      labelContributor('zeta.label'),
      counterContributor('alpha.counter'),
    ])
    const target: HydrateContext = { counter: 0, label: '', hydrated: [] }

    registry.hydrateDraft(target, {
      format: PORTABLE_STATE_FORMAT,
      version: 1,
      entries: {
        'zeta.label': { version: 2, value: 'ready' },
        'alpha.counter': { version: 1, value: { count: 4 } },
      },
    })
    expect(target).toEqual({ counter: 4, label: 'ready', hydrated: ['alpha.counter', 'zeta.label'] })
  })

  it('laisse le contexte actif intact si un hydrateur échoue sur le brouillon', () => {
    const failingContributor = definePortableStateContributor<ProjectContext, HydrateContext, true>({
      key: 'zeta.failure',
      version: 1,
      project: () => true,
      decode: (value) => {
        if (value !== true) throw new Error('invalid failure marker')
        return true
      },
      hydrate: () => {
        throw new Error('hydrate failed')
      },
    })
    const registry = createPortableStateRegistry([
      counterContributor('alpha.counter'),
      failingContributor,
    ])
    const active: HydrateContext = { counter: 0, label: 'active', hydrated: [] }
    const draft = structuredClone(active)

    expect(() => registry.hydrateDraft(draft, {
      format: PORTABLE_STATE_FORMAT,
      version: 1,
      entries: {
        'alpha.counter': { version: 1, value: { count: 8 } },
        'zeta.failure': { version: 1, value: true },
      },
    })).toThrow('hydrate failed')
    expect(active).toEqual({ counter: 0, label: 'active', hydrated: [] })
    expect(draft).toEqual({ counter: 8, label: 'active', hydrated: ['alpha.counter'] })
  })

  it('rejects duplicate, malformed and excessive contributor declarations', () => {
    const contributor = counterContributor()
    expect(() => createPortableStateRegistry([contributor, contributor])).toThrow('plusieurs fois')
    expect(() => counterContributor('Invalid Key')).toThrow('clé')
    expect(() => counterContributor(`a${'b'.repeat(MAX_PORTABLE_STATE_KEY_LENGTH)}`)).toThrow('clé')
    expect(() => definePortableStateContributor({
      key: 'state.invalid-version',
      version: 0,
      project: (): null => null,
      decode: (): null => null,
      hydrate: () => undefined,
    })).toThrow('version')

    const contributors = Array.from(
      { length: MAX_PORTABLE_STATE_CONTRIBUTORS + 1 },
      (_, index) => counterContributor(`state.slot-${String(index)}`),
    )
    expect(() => createPortableStateRegistry(contributors)).toThrow('maximum')
  })

  it('rejects a wire projection beyond the contributor limit before hydration', () => {
    const entries = Object.fromEntries(Array.from(
      { length: MAX_PORTABLE_STATE_CONTRIBUTORS + 1 },
      (_, index) => [`state.slot-${String(index)}`, { version: 1, value: null }],
    ))
    const registry = createPortableStateRegistry<ProjectContext, HydrateContext>([])
    const target: HydrateContext = { counter: 0, label: '', hydrated: [] }

    expect(() => registry.hydrateDraft(target, {
      format: PORTABLE_STATE_FORMAT,
      version: 1,
      entries,
    })).toThrow('trop')
    expect(target.hydrated).toEqual([])
  })
})
