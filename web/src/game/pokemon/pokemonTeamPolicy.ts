export type PokemonTeamMember = Readonly<{
  instanceId: string
  speciesId: number
  isEgg: boolean
  currentHp: number
}>

export type PokemonBattleEligibilityIntent = Readonly<{
  format: 'simple' | 'double'
  phase: 'initial' | 'voluntary-switch' | 'forced-replacement'
  partyIndex: number
  pokemon: PokemonTeamMember
}>

export type PokemonPartyMutationReason =
  | 'starter'
  | 'capture'
  | 'gift'
  | 'npc-trade'
  | 'player-trade'
  | 'loan'
  | 'daycare'
  | 'pc'
  | 'shedinja'
  | 'evolution'
  | 'reorder'

export type PokemonPartyMutationIntent = Readonly<{
  reason: PokemonPartyMutationReason
  before: readonly PokemonTeamMember[]
  after: readonly PokemonTeamMember[]
}>

export type PokemonTeamVeto = Readonly<{ code: string, reason: string }>

export type PokemonPartyMutationDecision =
  | Readonly<{ kind: 'allowed' }>
  | Readonly<{ kind: 'blocked', code: string, reason: string }>

export type PokemonTeamPolicy = Readonly<{
  vetoBattleEligibility: (intent: PokemonBattleEligibilityIntent) => PokemonTeamVeto | undefined
  vetoPartyMutation: (intent: PokemonPartyMutationIntent) => PokemonTeamVeto | undefined
}>

export const basePokemonTeamPolicy: PokemonTeamPolicy = Object.freeze({
  vetoBattleEligibility: () => undefined,
  vetoPartyMutation: () => undefined,
})

/** Erreur métier présentable : son message est exactement la raison du veto. */
export class PokemonBattleEligibilityVetoError extends Error {
  readonly code: string
  readonly intent: PokemonBattleEligibilityIntent

  constructor(veto: PokemonTeamVeto, intent: PokemonBattleEligibilityIntent) {
    super(veto.reason)
    this.name = 'PokemonBattleEligibilityVetoError'
    this.code = veto.code
    this.intent = intent
  }
}

/** Les règles s'ajoutent au jeu de base ; le premier veto ordonné gagne. */
export function composePokemonTeamPolicies(policies: readonly PokemonTeamPolicy[]): PokemonTeamPolicy {
  const ordered = Object.freeze([...policies])
  const firstVeto = <Intent>(select: (policy: PokemonTeamPolicy) => (intent: Intent) => PokemonTeamVeto | undefined, intent: Intent) => {
    for (const policy of ordered) {
      const veto = select(policy)(intent)
      if (veto) return veto
    }
    return undefined
  }
  return Object.freeze({
    vetoBattleEligibility: (intent) => firstVeto((policy) => policy.vetoBattleEligibility, intent),
    vetoPartyMutation: (intent) => firstVeto((policy) => policy.vetoPartyMutation, intent),
  })
}

/** Applique d'abord les contraintes natives œuf/PV, puis les veto optionnels. */
export function getPokemonBattleEligiblePartySlots(
  party: readonly PokemonTeamMember[],
  context: Readonly<Pick<PokemonBattleEligibilityIntent, 'format' | 'phase'>>,
  policy: PokemonTeamPolicy = basePokemonTeamPolicy,
): number[] {
  return party.flatMap((pokemon, partyIndex) => (
    !pokemon.isEgg && pokemon.currentHp > 0
      && !getPokemonBattleEligibilityVeto(party, partyIndex, context, policy)
      ? [partyIndex]
      : []
  ))
}

/**
 * Ne consulte jamais une extension pour un œuf, un K.O. ou un index absent :
 * les règles natives restent propriétaires de ces refus.
 */
export function getPokemonBattleEligibilityVeto(
  party: readonly PokemonTeamMember[],
  partyIndex: number,
  context: Readonly<Pick<PokemonBattleEligibilityIntent, 'format' | 'phase'>>,
  policy: PokemonTeamPolicy = basePokemonTeamPolicy,
): PokemonTeamVeto | undefined {
  const pokemon = party[partyIndex]
  if (!pokemon || pokemon.isEgg || pokemon.currentHp <= 0) return undefined
  return policy.vetoBattleEligibility({ ...context, partyIndex, pokemon })
}

export function assertPokemonBattleEligibility(
  party: readonly PokemonTeamMember[],
  partyIndex: number,
  context: Readonly<Pick<PokemonBattleEligibilityIntent, 'format' | 'phase'>>,
  policy: PokemonTeamPolicy = basePokemonTeamPolicy,
): void {
  const pokemon = party[partyIndex]
  const veto = getPokemonBattleEligibilityVeto(party, partyIndex, context, policy)
  if (pokemon && veto) throw new PokemonBattleEligibilityVetoError(veto, { ...context, partyIndex, pokemon })
}

export function createPokemonPartyMutationIntent(
  reason: PokemonPartyMutationReason,
  before: readonly PokemonTeamMember[],
  after: readonly PokemonTeamMember[],
): PokemonPartyMutationIntent {
  return Object.freeze({ reason, before: Object.freeze([...before]), after: Object.freeze([...after]) })
}

/** Préflight sérialisable commun à toutes les transactions d'équipe. */
export function resolvePokemonPartyMutationDecision(
  reason: PokemonPartyMutationReason,
  before: readonly PokemonTeamMember[],
  after: readonly PokemonTeamMember[],
  policy: PokemonTeamPolicy = basePokemonTeamPolicy,
): PokemonPartyMutationDecision {
  const veto = policy.vetoPartyMutation(createPokemonPartyMutationIntent(reason, before, after))
  return veto ? Object.freeze({ kind: 'blocked', ...veto }) : Object.freeze({ kind: 'allowed' })
}

/**
 * Erreur structurée utilisée par les anciennes API impératives qui ne peuvent
 * pas encore renvoyer une union `blocked`. Elle est toujours levée avant la
 * première mutation de la transaction.
 */
export class PokemonTeamPolicyVetoError extends Error {
  readonly code: string
  readonly reason: string

  constructor(veto: PokemonTeamVeto) {
    super(veto.reason)
    this.name = 'PokemonTeamPolicyVetoError'
    this.code = veto.code
    this.reason = veto.reason
  }
}

export function assertPokemonPartyMutationAllowed(
  reason: PokemonPartyMutationReason,
  before: readonly PokemonTeamMember[],
  after: readonly PokemonTeamMember[],
  policy: PokemonTeamPolicy = basePokemonTeamPolicy,
): void {
  const decision = resolvePokemonPartyMutationDecision(reason, before, after, policy)
  if (decision.kind === 'blocked') throw new PokemonTeamPolicyVetoError(decision)
}
