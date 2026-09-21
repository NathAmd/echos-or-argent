import { describe, expect, it } from 'vitest'
import { createShopNavigationMemory } from './shopNavigationMemory'

describe('mémoire de navigation de la boutique', () => {
  it('conserve indépendamment l’objet et le défilement de chaque mode', () => {
    const memory = createShopNavigationMemory()
    memory.rememberSelection('buy', 'browse', 17, 184)
    memory.rememberSelection('sell', 'browse', 42, 68)
    expect(memory.read('buy')).toEqual({ value: 17, scrollTop: 184 })
    expect(memory.read('sell')).toEqual({ value: 42, scrollTop: 68 })
  })

  it('permet de revenir de Oui/Non sans remplacer la sélection de navigation', () => {
    const memory = createShopNavigationMemory()
    memory.rememberSelection('buy', 'browse', 17, 184)
    memory.rememberSelection('buy', 'confirm', 0xfffb, 0)
    memory.rememberScroll('buy', 'confirm', 0)
    expect(memory.read('buy')).toEqual({ value: 17, scrollTop: 184 })
    memory.rememberScroll('buy', 'browse', 212)
    expect(memory.read('buy')).toEqual({ value: 17, scrollTop: 212 })
  })

  it('efface l’état seulement à la fermeture de la session complète', () => {
    const memory = createShopNavigationMemory()
    memory.rememberSelection('buy', 'browse', 17, 184)
    memory.clear()
    expect(memory.read('buy')).toEqual({ scrollTop: 0 })
  })
})
