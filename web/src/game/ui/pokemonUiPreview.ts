import type { NitroGraphic, RomInventory } from '../../ndsTypes'
import type { BattlePokemonAnimationCommand } from '../../rom/pokemon/battlePokemonSprites'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'

type PokemonUiPreviewInventory = Pick<RomInventory, 'battlePokemonSpriteResolver' | 'pokemonIconResolver'>
type PokemonUiPreviewIdentity = Pick<CanonicalPokemon, 'speciesId' | 'form' | 'gender' | 'shiny' | 'isEgg'>

export type PokemonUiPreview = {
  frames: readonly NitroGraphic[]
  source: 'battle' | 'icon'
  animationScript?: readonly BattlePokemonAnimationCommand[]
}

/**
 * Frontière graphique commune des menus. Un sprite de combat de forme/genre
 * absent ne doit jamais interrompre le rendu des autres Pokémon du PC :
 * l'icône native de la ROM reste le repli, sans asset inventé.
 */
export function resolvePokemonUiPreview(
  inventory: PokemonUiPreviewInventory,
  pokemon: PokemonUiPreviewIdentity,
  preferredSource: 'battle' | 'icon' = pokemon.shiny ? 'battle' : 'icon',
): PokemonUiPreview | undefined {
  const resolvers = pokemon.isEgg || preferredSource === 'icon'
    ? (['icon', 'battle'] as const)
    : (['battle', 'icon'] as const)

  for (const source of resolvers) {
    if (source === 'battle' && pokemon.isEgg) continue
    try {
      if (source === 'battle') {
        const sprite = inventory.battlePokemonSpriteResolver({
            speciesId: pokemon.speciesId,
            form: pokemon.form,
            gender: pokemon.gender,
            facing: 'front',
            shiny: pokemon.shiny,
          })
        if (sprite.frames.length > 0) return { frames: sprite.frames, source, animationScript: sprite.animationScript }
      } else {
        const frames = inventory.pokemonIconResolver(pokemon.speciesId, pokemon.form, pokemon.isEgg).frames
        if (frames.length > 0) return { frames, source }
      }
    } catch {
      // Le second resolver est toujours une autre ressource native de la ROM.
    }
  }
  return undefined
}
