/** Légendaires et fabuleux du Pokédex national disponible dans HGSS. */
export const hgssLegendaryAndMythicalSpeciesIds: readonly number[] = Object.freeze([
  144, 145, 146, 150, 151,
  243, 244, 245, 249, 250, 251,
  377, 378, 379, 380, 381, 382, 383, 384, 385, 386,
  480, 481, 482, 483, 484, 485, 486, 487, 488, 489, 490, 491, 492, 493,
])

const legendaryAndMythicalSpecies = new Set(hgssLegendaryAndMythicalSpeciesIds)

export function isHgssLegendaryOrMythicalSpecies(speciesId: number): boolean {
  return legendaryAndMythicalSpecies.has(speciesId)
}
