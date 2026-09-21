import { describe, expect, it } from 'vitest'
import { decodePokemonEvolutionData, hgssEvolutionDataSize } from './evolutionData'

describe('evolutions Pokemon HGSS', () => {
  it('decode les sept triplets methode, parametre et espece cible', () => {
    const payload = new Uint8Array(hgssEvolutionDataSize)
    const view = new DataView(payload.buffer)
    view.setUint16(0, 4, true)
    view.setUint16(2, 16, true)
    view.setUint16(4, 153, true)
    expect(decodePokemonEvolutionData(payload, 152)).toEqual([{ method: 4, parameter: 16, targetSpeciesId: 153 }])
  })
})