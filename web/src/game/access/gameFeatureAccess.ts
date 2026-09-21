export const gameAccessFeatures = ['multiplayer', 'new-game-plus'] as const

export type GameAccessFeature = typeof gameAccessFeatures[number]
export type GameAccessDenialReason = 'sign-in-required' | 'subscription-required'
export type GameAccessAuthentication = 'anonymous' | 'signed-in'
export type GameAccessSubscription = 'unknown' | 'inactive' | 'active'

/** État minimal injecté par une future couche de compte, sans donnée d'authentification sensible. */
export type GameAccessSubjectState = Readonly<{
  authentication: GameAccessAuthentication
  subscription: GameAccessSubscription
}>

export type GameAccessRequirement = Readonly<{
  requireSignIn: boolean
  requireSubscription: boolean
}>

export type GameAccessPolicy = Readonly<Record<GameAccessFeature, GameAccessRequirement>>

export type GameAccessDecision =
  | Readonly<{ allowed: true }>
  | Readonly<{ allowed: false, reason: GameAccessDenialReason }>

export type GameAccessGate = Readonly<{
  /** Lit l'état au moment de la décision afin de permettre un branchement futur réactif. */
  check: (feature: GameAccessFeature) => GameAccessDecision
  policy: GameAccessPolicy
}>

export type GameAccessPolicyOverrides = Readonly<Partial<Record<
  GameAccessFeature,
  Readonly<Partial<GameAccessRequirement>>
>>>

const openRequirement: GameAccessRequirement = Object.freeze({
  requireSignIn: false,
  requireSubscription: false,
})

export const defaultGameAccessSubjectState: GameAccessSubjectState = Object.freeze({
  authentication: 'anonymous',
  subscription: 'unknown',
})

/** Politique actuelle : les deux fonctionnalités restent accessibles sans abonnement. */
export const defaultGameAccessPolicy: GameAccessPolicy = Object.freeze({
  multiplayer: openRequirement,
  'new-game-plus': openRequirement,
})

function assertExactBooleanKeys(value: unknown, feature: GameAccessFeature): asserts value is Partial<GameAccessRequirement> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`La politique d'accès ${feature} est invalide.`)
  }
  const record = value as Record<string, unknown>
  if (Object.keys(record).some((key) => key !== 'requireSignIn' && key !== 'requireSubscription')) {
    throw new TypeError(`La politique d'accès ${feature} contient un champ inconnu.`)
  }
  for (const key of ['requireSignIn', 'requireSubscription'] as const) {
    if (record[key] !== undefined && typeof record[key] !== 'boolean') {
      throw new TypeError(`La politique d'accès ${feature}.${key} doit être booléenne.`)
    }
  }
}

function parseSubjectState(value: GameAccessSubjectState): GameAccessSubjectState {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== 2
    || !Object.hasOwn(value, 'authentication')
    || !Object.hasOwn(value, 'subscription')
    || value.authentication !== 'anonymous' && value.authentication !== 'signed-in'
    || value.subscription !== 'unknown' && value.subscription !== 'inactive' && value.subscription !== 'active') {
    throw new TypeError("L'état local d'accès aux fonctionnalités est invalide.")
  }
  return Object.freeze({
    authentication: value.authentication,
    subscription: value.subscription,
  })
}

/** Construit une politique complète; l'absence d'override conserve l'accès ouvert actuel. */
export function createGameAccessPolicy(overrides: GameAccessPolicyOverrides = {}): GameAccessPolicy {
  if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new TypeError("La configuration des accès aux fonctionnalités est invalide.")
  }
  const unknownFeature = Object.keys(overrides).find((key) => !gameAccessFeatures.includes(key as GameAccessFeature))
  if (unknownFeature) throw new TypeError(`La fonctionnalité d'accès ${unknownFeature} est inconnue.`)
  const policy = Object.fromEntries(gameAccessFeatures.map((feature) => {
    const override = overrides[feature]
    if (override === undefined) return [feature, openRequirement]
    assertExactBooleanKeys(override, feature)
    return [feature, Object.freeze({
      requireSignIn: override.requireSignIn ?? false,
      requireSubscription: override.requireSubscription ?? false,
    })]
  })) as Record<GameAccessFeature, GameAccessRequirement>
  return Object.freeze(policy)
}

/** Décision pure, stable et indépendante de toute implémentation de compte ou de paiement. */
export function evaluateGameFeatureAccess(
  feature: GameAccessFeature,
  state: GameAccessSubjectState = defaultGameAccessSubjectState,
  policy: GameAccessPolicy = defaultGameAccessPolicy,
): GameAccessDecision {
  if (!gameAccessFeatures.includes(feature)) throw new TypeError(`La fonctionnalité d'accès ${String(feature)} est inconnue.`)
  const subject = parseSubjectState(state)
  const requirement = policy[feature]
  if (!requirement || typeof requirement.requireSignIn !== 'boolean'
    || typeof requirement.requireSubscription !== 'boolean') {
    throw new TypeError(`La politique d'accès ${feature} est invalide.`)
  }
  if ((requirement.requireSignIn || requirement.requireSubscription)
    && subject.authentication !== 'signed-in') {
    return Object.freeze({ allowed: false, reason: 'sign-in-required' })
  }
  if (requirement.requireSubscription && subject.subscription !== 'active') {
    return Object.freeze({ allowed: false, reason: 'subscription-required' })
  }
  return Object.freeze({ allowed: true })
}

/** Adaptateur injectable : `readState` peut ultérieurement lire un store local de session. */
export function createGameAccessGate(options: Readonly<{
  policy?: GameAccessPolicy
  readState?: () => GameAccessSubjectState
}> = {}): GameAccessGate {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw new TypeError("Les options du contrôle d'accès sont invalides.")
  }
  const policy = options.policy ?? defaultGameAccessPolicy
  // Valider immédiatement les deux branches, même si elles ne sont pas encore consultées.
  for (const feature of gameAccessFeatures) {
    evaluateGameFeatureAccess(feature, defaultGameAccessSubjectState, policy)
  }
  const readState = options.readState ?? (() => defaultGameAccessSubjectState)
  if (typeof readState !== 'function') throw new TypeError("Le lecteur d'état d'accès est invalide.")
  return Object.freeze({
    policy,
    check: (feature) => evaluateGameFeatureAccess(feature, readState(), policy),
  })
}
