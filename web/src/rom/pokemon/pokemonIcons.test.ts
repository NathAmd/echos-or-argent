import { describe, expect, it } from 'vitest'
import { decodePokemonIconPaletteIndexes, getPokemonIconMemberIndex, locatePokemonIconPaletteTable } from './pokemonIcons'

const signature = [
  0, 1, 1, 1, 0, 0, 0, 0, 2, 2, 1, 1, 0, 1, 2, 2,
  0, 0, 0, 2, 1, 0, 0, 2, 2, 2, 0, 2, 2, 2, 2, 2,
]

function createPaletteFixture(prefix = 19): Uint8Array {
  const bytes = new Uint8Array(prefix + 544 + 8)
  bytes.set(signature, prefix)
  bytes[prefix + 152] = 1
  bytes[prefix + 155] = 1
  bytes[prefix + 158] = 2
  bytes[prefix + 494] = 1
  bytes[prefix + 495] = 2
  bytes[prefix + 543] = 1
  return bytes
}

describe('HGSS Pokemon icons', () => {
  it('resolves base species, eggs, and native alternate forms', () => {
    expect(getPokemonIconMemberIndex(152)).toBe(159)
    expect(getPokemonIconMemberIndex(155)).toBe(162)
    expect(getPokemonIconMemberIndex(158)).toBe(165)
    expect(getPokemonIconMemberIndex(386, 3)).toBe(505)
    expect(getPokemonIconMemberIndex(201, 27)).toBe(533)
    expect(getPokemonIconMemberIndex(479, 5)).toBe(546)
    expect(getPokemonIconMemberIndex(1, 0, true)).toBe(501)
    expect(getPokemonIconMemberIndex(490, 0, true)).toBe(502)
  })

  it('locates and copies the native palette lookup table', () => {
    const arm9 = createPaletteFixture()
    expect(locatePokemonIconPaletteTable(arm9)).toBe(19)
    expect(decodePokemonIconPaletteIndexes(arm9)[158]).toBe(2)
  })

  it('rejects absent and duplicate palette lookup tables', () => {
    expect(() => locatePokemonIconPaletteTable(new Uint8Array(600))).toThrow('0 candidate')
    const fixture = createPaletteFixture()
    const duplicate = new Uint8Array(fixture.byteLength * 2)
    duplicate.set(fixture)
    duplicate.set(fixture, fixture.byteLength)
    expect(() => locatePokemonIconPaletteTable(duplicate)).toThrow('2 candidate')
  })
})
