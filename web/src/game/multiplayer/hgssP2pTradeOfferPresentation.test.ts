import { describe, expect, it, vi } from 'vitest'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { presentHgssP2pTradeOffer } from './hgssP2pTradeOfferPresentation'
import type { HgssP2pTradeOfferPreview } from './hgssP2pTradeProtocol'

const preview: HgssP2pTradeOfferPreview = {
  pokemonId: 'pkm:v1:r:00000000000000000000000000000001' as HgssP2pTradeOfferPreview['pokemonId'],
  speciesId: 155,
  nickname: 'FLAMME',
  nicknameSource: 'user-text',
  form: 0,
  level: 12,
  gender: 'male',
  shiny: true,
  isEgg: false,
  heldItemId: 0,
  currentHp: 28,
  maximumHp: 30,
  stats: { hp: 30, attack: 16, defense: 15, speed: 20, specialAttack: 18, specialDefense: 17 },
  moveIds: [33, 43],
}

describe("présentation locale d'une offre P2P", () => {
  it('résout les noms et les six statistiques exclusivement avec le catalogue local', () => {
    const catalog = createPokemonTestCatalog()
    const result = presentHgssP2pTradeOffer(preview, { pokemonCatalog: catalog })
    expect(result).toMatchObject({
      primaryLabel: 'FLAMME',
      secondaryLabel: `${catalog.speciesNames[155]} · Niv. 12`,
      details: [
        { label: 'PV', value: '28/30' },
        { label: 'Statistiques', value: 'Atk 16 · Déf 15 · Vit 20 · Atq.Spé 18 · Déf.Spé 17' },
        { label: 'Objet tenu', value: '—' },
        { label: 'Capacités', value: `${catalog.moveNames[33]} · ${catalog.moveNames[43]}` },
        { label: 'Chromatique', value: 'Oui' },
      ],
    })
  })

  it('ne crée le visuel local qu’au moment où la vue le demande', () => {
    const visual = {} as HTMLElement
    const createPokemonVisual = vi.fn(() => visual)
    const result = presentHgssP2pTradeOffer(preview, {
      pokemonCatalog: createPokemonTestCatalog(),
      createPokemonVisual,
    })
    expect(createPokemonVisual).not.toHaveBeenCalled()
    expect(result.createVisual?.()).toBe(visual)
    expect(createPokemonVisual).toHaveBeenCalledWith({
      speciesId: 155, form: 0, isEgg: false, shiny: true, gender: 'male',
    })
  })
})
