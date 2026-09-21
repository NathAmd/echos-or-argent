import { describe, expect, it } from 'vitest'
import { getPokemonMachineDisplayName } from './pokemonMachineDisplayName'

describe('getPokemonMachineDisplayName', () => {
  it('associe une CT et une CS au nom de capacité fourni par la ROM', () => {
    const moveNames: string[] = []
    moveNames[264] = 'MITRA-POING'
    moveNames[15] = 'COUPE'

    expect(getPokemonMachineDisplayName({ itemId: 328, name: 'CT01' }, moveNames)).toBe('CT01 · MITRA-POING')
    expect(getPokemonMachineDisplayName({ itemId: 420, name: 'CS01' }, moveNames)).toBe('CS01 · COUPE')
  })

  it("ne modifie pas un objet ordinaire et n'invente rien si le texte ROM manque", () => {
    expect(getPokemonMachineDisplayName({ itemId: 17, name: 'POTION' }, [])).toBe('POTION')
    expect(getPokemonMachineDisplayName({ itemId: 328, name: 'CT01' }, [])).toBe('CT01')
  })
})
