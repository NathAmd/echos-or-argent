import type { FieldItemEffect } from './useFieldItem'

export function formatFieldItemEffect(itemName: string, pokemonName: string, effect: FieldItemEffect): string {
  const details: string[] = []
  if (effect.revived) details.push('réanimé')
  if (effect.hpRestored > 0) details.push(`${effect.hpRestored} PV récupérés`)
  if (effect.statusHealed) details.push('statut soigné')
  if (effect.ppRestored > 0) details.push(`${effect.ppRestored} PP récupérés`)
  if (effect.ppUpsAdded > 0) details.push(`PP max augmentés (${effect.ppUpsAdded})`)
  if (effect.evolvedToSpeciesId !== undefined) details.push('évolution déclenchée')
  if (effect.levelsGained > 0) details.push(`niveau +${effect.levelsGained}`)
  if (effect.effortValueChange !== 0) details.push(`EV ${effect.effortValueChange > 0 ? '+' : ''}${effect.effortValueChange}`)
  if (effect.friendshipChange !== 0) details.push(`amitié ${effect.friendshipChange > 0 ? '+' : ''}${effect.friendshipChange}`)
  return `${itemName} utilisé sur ${pokemonName} : ${details.join(', ')}.`
}
