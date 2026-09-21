import type { OpeningMapPreview, RomInventory } from '../../ndsTypes'

export type FieldSpeakerCatalog = Pick<RomInventory, 'trainerCatalog' | 'trainerNames' | 'trainerClassNames'>

function trainerIdFromObjectScript(scriptId: number): number | undefined {
  if (scriptId >= 3000 && scriptId < 5000) return scriptId - 2999
  if (scriptId >= 5000 && scriptId < 7000) return scriptId - 4999
  return undefined
}

function isTrainerObjectType(type: number): boolean {
  return type === 1 || type === 2 || (type >= 4 && type <= 8)
}

/**
 * Résout l'identité affichable d'un interlocuteur sans fabriquer de nom propre.
 * Les objets et mécanismes ROM n'ont volontairement aucun libellé de locuteur.
 */
export function resolveFieldSpeakerName(
  map: OpeningMapPreview,
  objectId: number | undefined,
  rivalName: string,
  catalog?: FieldSpeakerCatalog,
): string | undefined {
  if (objectId === undefined) return undefined
  const object = map.events?.objects.find((candidate) => candidate.id === objectId)
  if (!object) return undefined

  if (object.spriteId === 366) return 'Prof. Chen'
  if (object.spriteId === 365) return 'Maman'
  if (object.spriteId === 99) return 'Prof. Orme'
  if (object.spriteId === 148) return rivalName || 'Rival'
  if (map.id === 139 && object.spriteId === 341) return 'Monsieur Pokémon'

  if (isTrainerObjectType(object.type)) {
    const trainerId = trainerIdFromObjectScript(object.scriptId)
    const trainer = trainerId === undefined ? undefined : catalog?.trainerCatalog[trainerId]
    const name = trainerId === undefined ? undefined : catalog?.trainerNames[trainerId]?.trim()
    const trainerClass = trainer && catalog?.trainerClassNames[trainer.trainerClass]?.trim()
    if (name) return trainerClass ? `${trainerClass} ${name}` : name
    return trainerClass || 'Dresseur'
  }

  // Les scripts locaux (< 3000) appartiennent aux PNJ de la carte. Les plages
  // supérieures sont réservées aux dresseurs, objets ramassables et mécanismes.
  return object.scriptId < 3000 ? 'Habitant' : undefined
}
