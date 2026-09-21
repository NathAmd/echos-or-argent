import { describe, expect, it, vi } from 'vitest'
import {
  baseFieldWildEncounterIdentityPort,
  composeFieldWildEncounterIdentityTransformers,
  createFieldWildEncounterIdentityPort,
  type FieldWildEncounterIdentityContext,
} from './fieldWildEncounterIdentityPort'
import type { PreparedFieldWildEncounter } from './wildEncounterSelection'

const rateRoll = Object.freeze({ triggered: true, modifiedRate: 20, firstRoll: 4 })
const context = Object.freeze({ mapId: 357, source: 'step' }) satisfies FieldWildEncounterIdentityContext

const preparedEncounters = [
  {
    rateRoll,
    encounter: { bankId: 1, slotIndex: 2, method: 'land', time: 'day', speciesId: 16, level: 4 },
  },
  {
    rateRoll,
    encounter: { bankId: 2, slotIndex: 1, method: 'surfing', speciesId: 60, minLevel: 10, maxLevel: 15, level: 12 },
  },
  {
    rateRoll,
    encounter: { bankId: 3, slotIndex: 4, method: 'fishing', rod: 'superRod', speciesId: 129, minLevel: 20, maxLevel: 40, level: 33 },
  },
  {
    rateRoll,
    encounter: { bankId: 4, slotIndex: 0, method: 'roamer', speciesId: 243, level: 40, roamerId: 1 },
  },
  {
    rateRoll,
    encounter: { areaId: 0, areaSlot: 2, method: 'safari', safariMethod: 'goodRod', time: 'night', slotIndex: 6, speciesId: 118, level: 17 },
  },
] as const satisfies readonly PreparedFieldWildEncounter[]

describe('field wild encounter identity port', () => {
  it.each(preparedEncounters)('preserves a prepared $encounter.method encounter by reference in the base game', (prepared) => {
    expect(baseFieldWildEncounterIdentityPort(prepared, context)).toBe(prepared)
  })

  it.each(preparedEncounters)('changes only identity for a prepared $encounter.method encounter', (prepared) => {
    const port = createFieldWildEncounterIdentityPort(() => ({ speciesId: 25, level: 50 }))
    const transformed = port(prepared, {
      mapId: 357,
      source: prepared.encounter.method === 'fishing' ? 'fishing' : 'forced',
    })

    expect(transformed).not.toBe(prepared)
    expect(transformed.encounter).toEqual({ ...prepared.encounter, speciesId: 25, level: 50 })
    expect(transformed.rateRoll).toBe(prepared.rateRoll)
    expect(prepared.encounter.speciesId).not.toBe(25)
  })

  it('composes transformers in declaration order with a serializable context', () => {
    const calls: string[] = []
    const first = vi.fn((identity: { speciesId: number, level: number }, receivedContext: FieldWildEncounterIdentityContext) => {
      calls.push(`first:${receivedContext.mapId}:${receivedContext.source}`)
      return { speciesId: identity.speciesId + 1, level: identity.level + 2 }
    })
    const second = vi.fn((identity: { speciesId: number, level: number }, receivedContext: FieldWildEncounterIdentityContext) => {
      calls.push(`second:${identity.speciesId}:${identity.level}`)
      return { speciesId: identity.speciesId * 2, level: identity.level + receivedContext.mapId % 10 }
    })
    const port = createFieldWildEncounterIdentityPort(
      composeFieldWildEncounterIdentityTransformers(first, second),
    )

    const transformed = port(preparedEncounters[0], { mapId: 357, source: 'visible-world' })

    expect(transformed.encounter).toMatchObject({ speciesId: 34, level: 13 })
    expect(calls).toEqual(['first:357:visible-world', 'second:17:6'])
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('keeps the prepared reference when a custom composition leaves identity unchanged', () => {
    const port = createFieldWildEncounterIdentityPort(
      composeFieldWildEncounterIdentityTransformers((identity) => ({ ...identity })),
    )

    expect(port(preparedEncounters[3], { mapId: 1, source: 'visible-world' })).toBe(preparedEncounters[3])
  })

  it('ignores fields outside the identity surface even from untyped callers', () => {
    const port = createFieldWildEncounterIdentityPort(() => ({
      speciesId: 151,
      level: 30,
      method: 'roamer',
      roamerId: 99,
      slotIndex: 99,
    }))

    const transformed = port(preparedEncounters[4], { mapId: 1, source: 'visible-world' })

    expect(transformed.encounter).toEqual({
      ...preparedEncounters[4].encounter,
      speciesId: 151,
      level: 30,
    })
  })

  it.each([
    { speciesId: 0, level: 5 },
    { speciesId: 494, level: 5 },
    { speciesId: 25.5, level: 5 },
    { speciesId: 25, level: 0 },
    { speciesId: 25, level: 101 },
    { speciesId: 25, level: Number.NaN },
    null,
  ])('rejects an invalid transformed identity %#', (identity) => {
    const port = createFieldWildEncounterIdentityPort(() => identity as never)
    expect(() => port(preparedEncounters[0], context)).toThrow()
  })

  it('rejects an invalid intermediate result before a later transformer can repair it', () => {
    const repair = vi.fn(() => ({ speciesId: 25, level: 5 }))
    const port = createFieldWildEncounterIdentityPort(composeFieldWildEncounterIdentityTransformers(
      () => ({ speciesId: 0, level: 5 }),
      repair,
    ))

    expect(() => port(preparedEncounters[0], context)).toThrow()
    expect(repair).not.toHaveBeenCalled()
  })

  it.each([
    { mapId: -1, source: 'step' },
    { mapId: 0x10000, source: 'step' },
    { mapId: 1.5, source: 'step' },
    { mapId: 1, source: 'script' },
  ])('rejects an invalid serializable context %#', (invalidContext) => {
    const port = createFieldWildEncounterIdentityPort((identity) => identity)
    expect(() => port(preparedEncounters[0], invalidContext as FieldWildEncounterIdentityContext)).toThrow()
  })
})
