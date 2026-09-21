import { describe, expect, it, vi } from 'vitest'
import type { NitroGraphic, RomInventory } from '../../ndsTypes'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { resolvePokemonUiPreview } from './pokemonUiPreview'

const graphic = (offset: number): NitroGraphic => ({
  width: 1,
  height: 1,
  pixels: new Uint8ClampedArray(4),
  graphicsOffset: offset,
  paletteOffset: 0,
  colorDepth: 4,
})

const pokemon: Pick<CanonicalPokemon, 'speciesId' | 'form' | 'gender' | 'shiny' | 'isEgg'> = {
  speciesId: 201,
  form: 12,
  gender: 'genderless',
  shiny: true,
  isEgg: false,
}

function inventory(battle: () => NitroGraphic[], icon: () => NitroGraphic[]) {
  return {
    battlePokemonSpriteResolver: vi.fn(() => ({ frames: battle(), animationScript: [{ next: 0, duration: 2, xOffset: 0 }] })),
    pokemonIconResolver: vi.fn(() => ({ frames: icon() })),
  } as unknown as Pick<RomInventory, 'battlePokemonSpriteResolver' | 'pokemonIconResolver'>
}

describe('aperçu Pokémon commun des UI', () => {
  it('préserve le sprite shiny ROM lorsqu’il est disponible', () => {
    const source = inventory(() => [graphic(1)], () => [graphic(2)])
    expect(resolvePokemonUiPreview(source, pokemon, 'battle')).toMatchObject({ source: 'battle', animationScript: [{ next: 0, duration: 2, xOffset: 0 }] })
    expect(source.pokemonIconResolver).not.toHaveBeenCalled()
  })

  it('retombe sur l’icône ROM sans interrompre les cases suivantes', () => {
    const source = inventory(() => { throw new Error('forme absente') }, () => [graphic(2)])
    expect(resolvePokemonUiPreview(source, pokemon, 'battle')).toEqual({ source: 'icon', frames: [graphic(2)] })
  })

  it('ne demande jamais de sprite de combat pour un Œuf', () => {
    const source = inventory(() => { throw new Error('interdit') }, () => [graphic(3)])
    expect(resolvePokemonUiPreview(source, { ...pokemon, isEgg: true }, 'battle')).toMatchObject({ source: 'icon' })
    expect(source.battlePokemonSpriteResolver).not.toHaveBeenCalled()
  })

  it('rend une absence locale au lieu de faire échouer tout le menu', () => {
    const source = inventory(() => { throw new Error('absent') }, () => { throw new Error('absent') })
    expect(resolvePokemonUiPreview(source, pokemon, 'battle')).toBeUndefined()
  })
})
