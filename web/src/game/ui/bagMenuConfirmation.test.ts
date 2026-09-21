import { describe, expect, it } from 'vitest'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import type { HgssItemCatalog } from '../../rom/items/itemData'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { getBagCommandConfirmation } from './bagMenuConfirmation'

describe('confirmations du Sac', () => {
  const itemCatalog = { items: Array.from({ length: 500 }), pocketNames: [] } as unknown as HgssItemCatalog
  itemCatalog.items[17] = { itemId: 17, name: 'POTION' } as HgssItemCatalog['items'][number]
  itemCatalog.items[328] = { itemId: 328, name: 'CT01' } as HgssItemCatalog['items'][number]
  const pokemonCatalog = createPokemonTestCatalog()
  pokemonCatalog.moveNames[33] = 'CHARGE'
  pokemonCatalog.moveNames[264] = 'MITRA-POING'
  const party = [{ speciesName: 'GERMIGNON', moves: [{ moveId: 33 }] }] as CanonicalPokemon[]
  const romMessages = {
    bag: { 61: 'Elle contient\n{106 0,0}.\rApprendre {106 0,0}\nà un Pokémon?' },
    party: {
      53: '{101 0,0} veut apprendre\n{106 1,0}.\rMais {101 0,0} connaît déjà\nquatre capacités.\rRemplacer une capacité\npar {106 1,0}?',
      56: 'Arrêter d’enseigner\n{106 1,0}?',
    },
  }

  it('nomme précisément l’objet et sa cible', () => {
    expect(getBagCommandConfirmation('bag-use:17:0', itemCatalog, pokemonCatalog, party)).toBe('Utiliser POTION sur GERMIGNON ?')
    expect(getBagCommandConfirmation('bag-give:17:0', itemCatalog, pokemonCatalog, party)).toBe('Donner POTION à GERMIGNON ?')
  })

  it('réutilise le nom ROM répété dans le prompt CT sans le décaler', () => {
    expect(getBagCommandConfirmation('bag-machine-target:328:0', itemCatalog, pokemonCatalog, party, romMessages)).toBe(
      'Elle contient\nMITRA-POING.\nApprendre MITRA-POING\nà un Pokémon?',
    )
  })

  it('emploie le prompt ROM à quatre capacités puis ne double-confirme pas le remplacement', () => {
    party[0]!.moves = [33, 33, 33, 33].map((moveId) => ({ moveId })) as CanonicalPokemon['moves']
    expect(getBagCommandConfirmation('bag-machine-target:328:0', itemCatalog, pokemonCatalog, party, romMessages)).toContain(
      'GERMIGNON veut apprendre\nMITRA-POING.',
    )
    expect(getBagCommandConfirmation('bag-machine-target:328:0', itemCatalog, pokemonCatalog, party, romMessages)).toContain(
      'Mais GERMIGNON connaît déjà',
    )
    expect(getBagCommandConfirmation('bag-machine-replace:328:0:0', itemCatalog, pokemonCatalog, party, romMessages)).toBeUndefined()
    expect(getBagCommandConfirmation('bag-machine-cancel:328:0', itemCatalog, pokemonCatalog, party, romMessages)).toBe(
      'Arrêter d’enseigner\nMITRA-POING?',
    )
  })
})
