export const hgssStarterSpeciesIds = [152, 155, 158] as const

export function getHgssStarterSpeciesId(choice: number): number {
  const speciesId = hgssStarterSpeciesIds[choice]
  if (speciesId === undefined) throw new Error(`Le choix de starter HGSS ${choice} est invalide.`)
  return speciesId
}
