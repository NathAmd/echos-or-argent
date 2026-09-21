import { describe, expect, it } from 'vitest'
import type { RomFile } from '../../ndsTypes'
import { decodeHgssJohtoDexNumbers, decodeHgssPokedexCatalog, decodeHgssPokemonHeights, decodeHgssPokemonWeights } from './pokedexData'

function archive(size = 988): RomFile {
  return {
    id: 0,
    path: '/a/1/3/8',
    offset: 0,
    size,
    signature: 'NARC',
    archiveEntries: 1,
    archiveMembers: [{ index: 0, offset: 0, size, signature: '' }],
  }
}

describe('HGSS Pokedex ROM catalog', () => {
  it('decodes the 494-entry species-to-Johto-number LUT', () => {
    const rom = new Uint8Array(988)
    const view = new DataView(rom.buffer)
    view.setUint16(152 * 2, 1, true)
    view.setUint16(155 * 2, 4, true)
    expect(decodeHgssJohtoDexNumbers(rom, archive())).toMatchObject({ 152: 1, 155: 4 })
    expect(() => decodeHgssJohtoDexNumbers(rom.subarray(0, 986), archive(986))).toThrow('Johto')
  })

  it('uses the native type-label indirection from French message bank 802', () => {
    const messages = Object.fromEntries(Array.from({ length: 176 }, (_, index) => [index, `M${index}`]))
    const catalog = decodeHgssPokedexCatalog(new Uint8Array(988), archive(), messages, { 155: 'Description' }, undefined, {
      categoryNames: { 155: 'Pokémon Souris Feu' }, heightLabels: { 155: '0,5 m' }, weightLabels: { 155: '7,9 kg' },
    })
    expect(catalog.typeNames).toMatchObject({ 0: 'M58', 10: 'M61', 11: 'M62', 17: 'M47' })
    expect(catalog.heartGoldDescriptions[155]).toBe('Description')
    expect(catalog).toMatchObject({ categoryNames: { 155: 'Pokémon Souris Feu' }, heightLabels: { 155: '0,5 m' }, weightLabels: { 155: '7,9 kg' } })
  })

  it('décode les poids utilisés par la Masse Ball depuis zukan_data', () => {
    const rom = new Uint8Array(494 * 4)
    new DataView(rom.buffer).setUint32(155 * 4, 79, true)
    const weightsArchive = archive(rom.byteLength)
    weightsArchive.path = '/a/0/7/4'
    weightsArchive.archiveMembers = [weightsArchive.archiveMembers[0]!, { index: 1, offset: 0, size: rom.byteLength, signature: '' }]
    expect(decodeHgssPokemonWeights(rom, weightsArchive)[155]).toBe(79)
  })

  it('décode la table native des tailles située juste avant les poids', () => {
    const rom = new Uint8Array(494 * 4)
    new DataView(rom.buffer).setUint32(155 * 4, 5, true)
    const measurements = archive(rom.byteLength)
    measurements.path = '/a/0/7/4'
    expect(decodeHgssPokemonHeights(rom, measurements)[155]).toBe(5)
  })
})
