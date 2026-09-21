import { describe, expect, it } from 'vitest'
import {
  createPokemonInstanceId,
  createShedinjaPokemonInstanceId,
  deriveLegacyPokemonInstanceId,
  isPokemonInstanceId,
  isPortablePokemonInstanceId,
  parsePokemonInstanceId,
  parsePortablePokemonInstanceId,
  pokemonInstanceIdMaxLength,
  type PokemonInstanceIdByteSource,
} from './pokemonInstanceId'

function fixedBytes(value: number): PokemonInstanceIdByteSource {
  return (byteLength) => new Uint8Array(byteLength).fill(value)
}

describe('persistent Pokemon instance IDs', () => {
  it('generates distinct versioned IDs from an injected byte source', () => {
    let nextValue = 0
    const source: PokemonInstanceIdByteSource = (byteLength) => {
      const bytes = new Uint8Array(byteLength)
      bytes[byteLength - 1] = nextValue
      nextValue += 1
      return bytes
    }

    const first = createPokemonInstanceId(source)
    const second = createPokemonInstanceId(source)

    expect(first).toBe('pkm:v1:r:00000000000000000000000000000000')
    expect(second).toBe('pkm:v1:r:00000000000000000000000000000001')
    expect(second).not.toBe(first)
    expect(isPokemonInstanceId(first)).toBe(true)
    expect(isPokemonInstanceId(second)).toBe(true)
  })

  it('requires exactly 128 bits from the injected source', () => {
    expect(() => createPokemonInstanceId(() => new Uint8Array(15))).toThrow('exactement 16 octets')
    expect(() => createPokemonInstanceId(() => new Uint8Array(17))).toThrow('exactement 16 octets')
    expect(() => createPokemonInstanceId((() => [1, 2, 3]) as unknown as PokemonInstanceIdByteSource))
      .toThrow('exactement 16 octets')
  })

  it('derives stable, injective legacy IDs from namespace and canonical path', () => {
    const first = deriveLegacyPokemonInstanceId('campaign-é', 'party/0')
    const same = deriveLegacyPokemonInstanceId('campaign-é', 'party/0')
    const otherPath = deriveLegacyPokemonInstanceId('campaign-é', 'party/1')
    const otherNamespace = deriveLegacyPokemonInstanceId('campaign-b', 'party/0')
    const ambiguousWithoutFramingA = deriveLegacyPokemonInstanceId('a', 'bc')
    const ambiguousWithoutFramingB = deriveLegacyPokemonInstanceId('ab', 'c')

    expect(same).toBe(first)
    expect(otherPath).not.toBe(first)
    expect(otherNamespace).not.toBe(first)
    expect(ambiguousWithoutFramingA).not.toBe(ambiguousWithoutFramingB)
    expect(isPokemonInstanceId(first)).toBe(true)
    expect(first.length).toBeLessThanOrEqual(pokemonInstanceIdMaxLength)
  })

  it('rejects non-canonical legacy inputs and bounded overflows', () => {
    expect(() => deriveLegacyPokemonInstanceId('', 'party/0')).toThrow('non vide')
    expect(() => deriveLegacyPokemonInstanceId(' campaign', 'party/0')).toThrow('espace')
    expect(() => deriveLegacyPokemonInstanceId('campaign', 'party/0\n')).toThrow('espace')
    expect(() => deriveLegacyPokemonInstanceId('cafe\u0301', 'party/0')).toThrow('NFC')
    expect(() => deriveLegacyPokemonInstanceId('campaign', `party/${'x'.repeat(193)}`)).toThrow('192 octets')
    expect(() => deriveLegacyPokemonInstanceId('campaign', '\ud800')).toThrow('Unicode invalide')
  })

  it('strictly validates serialized IDs', () => {
    const valid = deriveLegacyPokemonInstanceId('campaign', 'box/3/slot/12')

    expect(parsePokemonInstanceId(valid)).toBe(valid)
    expect(isPokemonInstanceId('pkm:v1:r:00112233445566778899aabbccddeeff')).toBe(true)
    expect(isPokemonInstanceId('pkm:v1:r:00112233445566778899AABBCCDDEEFF')).toBe(false)
    expect(isPokemonInstanceId('pkm:v2:r:00112233445566778899aabbccddeeff')).toBe(false)
    expect(isPokemonInstanceId('pkm:v1:l:61:')).toBe(false)
    expect(isPokemonInstanceId('pkm:v1:l:zz:62')).toBe(false)
    expect(isPokemonInstanceId('pkm:v1:l:c3:62')).toBe(false)
    expect(isPokemonInstanceId(null)).toBe(false)
    expect(() => parsePokemonInstanceId('pokemon-1')).toThrow('invalide')
  })

  it('limite la frontière portable aux IDs opaques et chemins machine HGSS bornés', () => {
    const portable = [
      createPokemonInstanceId(fixedBytes(0x11)),
      deriveLegacyPokemonInstanceId('hgss-7-12345678', 'party/0'),
      deriveLegacyPokemonInstanceId('hgss-8-ffffffff', 'storage/17/29'),
      deriveLegacyPokemonInstanceId('hgss-7-12345678:trainer-house', 'entry/9/5'),
    ]
    portable.forEach((instanceId) => {
      expect(isPortablePokemonInstanceId(instanceId)).toBe(true)
      expect(parsePortablePokemonInstanceId(instanceId)).toBe(instanceId)
    })

    const localOnly = [
      deriveLegacyPokemonInstanceId('campaign-é', 'party/0'),
      deriveLegacyPokemonInstanceId('hgss-7-12345678', 'party/6'),
      deriveLegacyPokemonInstanceId('hgss-7-12345678', 'storage/18/0'),
      deriveLegacyPokemonInstanceId('hgss-7-12345678:trainer-house', 'entry/10/0'),
    ]
    localOnly.forEach((instanceId) => {
      expect(isPokemonInstanceId(instanceId)).toBe(true)
      expect(isPortablePokemonInstanceId(instanceId)).toBe(false)
      expect(() => parsePortablePokemonInstanceId(instanceId)).toThrow('data-only')
    })
  })

  it('round-trips through JSON without losing its branded string value', () => {
    const instanceId = createPokemonInstanceId(fixedBytes(0xa5))
    const serialized = JSON.stringify({ instanceId })
    const restored = JSON.parse(serialized) as { instanceId: unknown }

    expect(serialized).toBe('{"instanceId":"pkm:v1:r:a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5"}')
    expect(parsePokemonInstanceId(restored.instanceId)).toBe(instanceId)
  })

  it('gives Shedinja a fresh ID even if the first source value collides', () => {
    const sourceId = createPokemonInstanceId(fixedBytes(0x2a))
    let calls = 0
    const source: PokemonInstanceIdByteSource = (byteLength) => {
      calls += 1
      return new Uint8Array(byteLength).fill(calls === 1 ? 0x2a : 0x2b)
    }

    const shedinjaId = createShedinjaPokemonInstanceId(sourceId, source)

    expect(calls).toBe(2)
    expect(shedinjaId).not.toBe(sourceId)
    expect(isPokemonInstanceId(shedinjaId)).toBe(true)
  })

  it('fails safely when a Shedinja byte source never produces a fresh ID', () => {
    const sourceId = createPokemonInstanceId(fixedBytes(0x2a))
    expect(() => createShedinjaPokemonInstanceId(sourceId, fixedBytes(0x2a))).toThrow('nouvel identifiant')
  })
})
