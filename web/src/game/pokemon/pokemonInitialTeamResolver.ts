export type PokemonInitialTeamMemberDefinition = Readonly<{
  speciesId: number
  level: number
  form: number
}>

export type PokemonInitialTeamRequest = Readonly<{
  choice: number
  baseDefinition: PokemonInitialTeamMemberDefinition
}>

export type PokemonInitialTeamCommittedMember = Readonly<{
  instanceId: string
  speciesId: number
  isEgg: boolean
  currentHp: number
}>

/**
 * Chaque resolver reçoit le résultat validé du resolver précédent. Le premier
 * reçoit une équipe vide ; la composition explicite donc toujours sa priorité.
 */
export type PokemonInitialTeamResolver = ((
  request: PokemonInitialTeamRequest,
  currentTeam: readonly PokemonInitialTeamMemberDefinition[],
) => readonly PokemonInitialTeamMemberDefinition[]) & Readonly<{
  /** Notification post-commit réservée à la liaison d'identités persistantes. */
  onInitialTeamCommitted?: (party: readonly PokemonInitialTeamCommittedMember[]) => void
}>

const emptyInitialTeam = Object.freeze([]) as readonly PokemonInitialTeamMemberDefinition[]

function requireMemberDefinition(
  value: unknown,
  label: string,
): PokemonInitialTeamMemberDefinition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} doit être une définition de Pokémon initial.`)
  }
  const definition = value as Partial<PokemonInitialTeamMemberDefinition>
  if (!Number.isInteger(definition.speciesId) || definition.speciesId! < 1 || definition.speciesId! > 493) {
    throw new Error(`${label} contient l’espèce HGSS ${String(definition.speciesId)}, qui est invalide.`)
  }
  if (!Number.isInteger(definition.level) || definition.level! < 1 || definition.level! > 100) {
    throw new Error(`${label} contient le niveau ${String(definition.level)}, qui est invalide.`)
  }
  if (!Number.isInteger(definition.form) || definition.form! < 0 || definition.form! > 0xff) {
    throw new Error(`${label} contient la forme ${String(definition.form)}, qui est invalide.`)
  }
  return Object.freeze({
    speciesId: definition.speciesId!,
    level: definition.level!,
    form: definition.form!,
  })
}

function requireRequest(request: PokemonInitialTeamRequest): PokemonInitialTeamRequest {
  if (!request || typeof request !== 'object') throw new Error('La requête d’équipe initiale est invalide.')
  if (!Number.isInteger(request.choice) || request.choice < 0 || request.choice > 2) {
    throw new Error(`Le choix initial HGSS ${request.choice} est invalide.`)
  }
  return Object.freeze({
    choice: request.choice,
    baseDefinition: requireMemberDefinition(request.baseDefinition, 'La définition HGSS de base'),
  })
}

function requireTeam(
  value: unknown,
  label: string,
  allowEmpty = false,
): readonly PokemonInitialTeamMemberDefinition[] {
  if (!Array.isArray(value)) throw new Error(`${label} doit produire une équipe initiale.`)
  if (value.length > 6 || (!allowEmpty && value.length < 1)) {
    throw new Error(`${label} doit contenir entre 1 et 6 Pokémon.`)
  }
  return Object.freeze(value.map((definition, index) => (
    requireMemberDefinition(definition, `${label}, membre ${index + 1}`)
  )))
}

/** Résolution HGSS native : le starter choisi, niveau 5, forme 0. */
export const basePokemonInitialTeamResolver: PokemonInitialTeamResolver = (request) => {
  const normalized = requireRequest(request)
  return Object.freeze([normalized.baseDefinition])
}

/** Compose et valide chaque transformation dans l’ordre déclaré. */
export function composePokemonInitialTeamResolvers(
  resolvers: readonly PokemonInitialTeamResolver[],
): PokemonInitialTeamResolver {
  if (resolvers.length === 0) return basePokemonInitialTeamResolver
  for (const resolver of resolvers) {
    if (typeof resolver !== 'function') throw new Error('Un resolver d’équipe initiale est invalide.')
  }
  const orderedResolvers = Object.freeze([...resolvers])
  const composed: PokemonInitialTeamResolver = (request, currentTeam) => {
    const normalizedRequest = requireRequest(request)
    let resolved = requireTeam(currentTeam, 'L’équipe initiale courante', true)
    for (const [index, resolver] of orderedResolvers.entries()) {
      resolved = requireTeam(
        resolver(normalizedRequest, resolved),
        `Le resolver d’équipe initiale ${index + 1}`,
      )
    }
    return resolved
  }
  const committedObservers = orderedResolvers.flatMap((resolver) => (
    resolver.onInitialTeamCommitted ? [resolver.onInitialTeamCommitted] : []
  ))
  if (committedObservers.length > 0) {
    Object.defineProperty(composed, 'onInitialTeamCommitted', {
      value: (party: readonly PokemonInitialTeamCommittedMember[]) => {
        for (const observer of committedObservers) observer(party)
      },
      enumerable: true,
    })
  }
  return Object.freeze(composed)
}

/** Point d’appel commun : aucun resolver ne peut publier une équipe invalide. */
export function resolvePokemonInitialTeam(
  request: PokemonInitialTeamRequest,
  resolver: PokemonInitialTeamResolver = basePokemonInitialTeamResolver,
): readonly PokemonInitialTeamMemberDefinition[] {
  if (typeof resolver !== 'function') throw new Error('Le resolver d’équipe initiale est invalide.')
  const normalizedRequest = requireRequest(request)
  return requireTeam(
    resolver(normalizedRequest, emptyInitialTeam),
    'Le resolver d’équipe initiale',
  )
}
