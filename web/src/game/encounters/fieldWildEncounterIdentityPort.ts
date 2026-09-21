import type { PreparedFieldWildEncounter } from './wildEncounterSelection'

export const fieldWildEncounterIdentitySources = [
  'step',
  'forced',
  'fishing',
  'visible-world',
] as const

export type FieldWildEncounterIdentitySource = typeof fieldWildEncounterIdentitySources[number]

/** Donnees stables pouvant traverser une sauvegarde ou une future frontiere reseau. */
export type FieldWildEncounterIdentityContext = Readonly<{
  mapId: number
  source: FieldWildEncounterIdentitySource
}>

/** Seule surface volontairement modifiable d'une rencontre deja preparee. */
export type FieldWildEncounterIdentity = Readonly<{
  speciesId: number
  level: number
}>

export type FieldWildEncounterIdentityTransformer = (
  identity: FieldWildEncounterIdentity,
  context: FieldWildEncounterIdentityContext,
) => FieldWildEncounterIdentity

export type FieldWildEncounterIdentityPort = (
  prepared: PreparedFieldWildEncounter,
  context: FieldWildEncounterIdentityContext,
) => PreparedFieldWildEncounter

const sourceSet = new Set<string>(fieldWildEncounterIdentitySources)

function requireContext(context: FieldWildEncounterIdentityContext): FieldWildEncounterIdentityContext {
  if (!Number.isInteger(context.mapId) || context.mapId < 0 || context.mapId > 0xffff) {
    throw new Error(`La carte de transformation de rencontre ${context.mapId} est invalide.`)
  }
  if (!sourceSet.has(context.source)) {
    throw new Error(`La source de transformation de rencontre ${String(context.source)} est invalide.`)
  }
  return Object.freeze({ mapId: context.mapId, source: context.source })
}

function requireIdentity(value: FieldWildEncounterIdentity, label: string): FieldWildEncounterIdentity {
  if (!value || typeof value !== 'object') {
    throw new Error(`${label} doit produire une identite de rencontre.`)
  }
  if (!Number.isInteger(value.speciesId) || value.speciesId < 1 || value.speciesId > 493) {
    throw new Error(`${label} a produit l'espece ${value.speciesId}, qui est invalide en HGSS.`)
  }
  if (!Number.isInteger(value.level) || value.level < 1 || value.level > 100) {
    throw new Error(`${label} a produit le niveau ${value.level}, qui est invalide.`)
  }
  return Object.freeze({ speciesId: value.speciesId, level: value.level })
}

/** Transformateur neutre reutilisable dans une composition. */
export const preserveFieldWildEncounterIdentity: FieldWildEncounterIdentityTransformer = (identity) => identity

/**
 * Compose les regles dans l'ordre declare et valide chaque resultat intermediaire.
 * Un transformateur ne recoit jamais les metadonnees de methode, de Safari,
 * de roamer ou de tirage de taux : elles restent donc hors de sa surface d'ecriture.
 */
export function composeFieldWildEncounterIdentityTransformers(
  ...transformers: readonly FieldWildEncounterIdentityTransformer[]
): FieldWildEncounterIdentityTransformer {
  if (transformers.length === 0) return preserveFieldWildEncounterIdentity
  for (const transformer of transformers) {
    if (typeof transformer !== 'function') throw new Error('Un transformateur d’identite de rencontre est invalide.')
  }
  return (identity, context) => transformers.reduce(
    (current, transformer, index) => requireIdentity(
      transformer(current, context),
      `Le transformateur de rencontre ${index + 1}`,
    ),
    requireIdentity(identity, 'L’identite initiale de rencontre'),
  )
}

/** Cree un port qui ne remplace que speciesId/level dans la rencontre preparee. */
export function createFieldWildEncounterIdentityPort(
  transformer: FieldWildEncounterIdentityTransformer,
): FieldWildEncounterIdentityPort {
  if (typeof transformer !== 'function') throw new Error('Le transformateur d’identite de rencontre est invalide.')
  return (prepared, context) => {
    const normalizedContext = requireContext(context)
    const initialIdentity = requireIdentity({
      speciesId: prepared.encounter.speciesId,
      level: prepared.encounter.level,
    }, 'L’identite preparee de rencontre')
    const transformed = requireIdentity(
      transformer(initialIdentity, normalizedContext),
      'Le transformateur de rencontre',
    )
    if (transformed.speciesId === initialIdentity.speciesId && transformed.level === initialIdentity.level) {
      return prepared
    }
    return {
      ...prepared,
      encounter: {
        ...prepared.encounter,
        speciesId: transformed.speciesId,
        level: transformed.level,
      },
    } as PreparedFieldWildEncounter
  }
}

/** Politique du jeu de base : aucune allocation et reference strictement preservee. */
export const baseFieldWildEncounterIdentityPort: FieldWildEncounterIdentityPort = (prepared) => prepared
