import type { CanonicalPokemon } from './canonicalPokemon'
import type { PokemonParty } from './pokemonParty'

export type PokemonHealingRestoration = 'hp' | 'status' | 'move-pp'

export type PokemonHealingSource = 'full-heal' | 'daycare' | 'field-item' | 'battle-item'

/** Alias historique conservé pour les intégrations déjà branchées. */
export type PokemonFullHealRestoration = PokemonHealingRestoration

export type PokemonHealingContext = Readonly<{
  pokemon: CanonicalPokemon
  partyIndex: number
  restoration: PokemonHealingRestoration
  source: PokemonHealingSource
}>

/** Alias historique conservé pour les intégrations déjà branchées. */
export type PokemonFullHealContext = PokemonHealingContext

/** Motif JSON sérialisable refusant une restauration précise. */
export type PokemonFullHealVeto = Readonly<{
  code: string
  reason: string
}>

export type PokemonPartyHealingPolicy = Readonly<{
  vetoFullHealRestoration: (context: PokemonFullHealContext) => PokemonFullHealVeto | undefined
}>

/** Politique neutre : PV, statut et PP sont tous restaurés comme dans HGSS. */
export const basePokemonPartyHealingPolicy: PokemonPartyHealingPolicy = Object.freeze({
  vetoFullHealRestoration: () => undefined,
})

export function getPokemonHealingVeto(
  pokemon: CanonicalPokemon,
  partyIndex: number,
  restoration: PokemonHealingRestoration,
  source: PokemonHealingSource,
  policy: PokemonPartyHealingPolicy = basePokemonPartyHealingPolicy,
): PokemonFullHealVeto | undefined {
  return policy.vetoFullHealRestoration({ pokemon, partyIndex, restoration, source })
}

/**
 * Consulte les politiques dans l'ordre pour chaque restauration. Le premier
 * veto gagne et aucune politique ultérieure ne peut réautoriser cet aspect.
 */
export function composePokemonPartyHealingPolicies(
  policies: readonly PokemonPartyHealingPolicy[],
): PokemonPartyHealingPolicy {
  const orderedPolicies = Object.freeze([...policies])
  return Object.freeze({
    vetoFullHealRestoration(context) {
      for (const policy of orderedPolicies) {
        const veto = policy.vetoFullHealRestoration(context)
        if (veto !== undefined) return veto
      }
      return undefined
    },
  })
}

export type PokemonFullHealAppliedVeto = Readonly<PokemonFullHealVeto & {
  restoration: PokemonFullHealRestoration
}>

export type PokemonPartyHealMemberResult = Readonly<{
  partyIndex: number
  restored: readonly PokemonFullHealRestoration[]
  vetoes: readonly PokemonFullHealAppliedVeto[]
}>

export type PokemonPartyHealResult = Readonly<{
  members: readonly PokemonPartyHealMemberResult[]
}>

const fullHealRestorations: readonly PokemonFullHealRestoration[] = Object.freeze([
  'hp',
  'status',
  'move-pp',
])

/**
 * Applique le soin complet sans présentation. Le résultat détaille les aspects
 * restaurés ou refusés pour permettre à l'appelant de présenter son propre UI.
 */
export function healPokemonWithPolicy(
  pokemon: CanonicalPokemon,
  partyIndex: number,
  policy: PokemonPartyHealingPolicy = basePokemonPartyHealingPolicy,
  source: PokemonHealingSource = 'full-heal',
): PokemonPartyHealMemberResult {
  const restored: PokemonFullHealRestoration[] = []
  const vetoes: PokemonFullHealAppliedVeto[] = []
  for (const restoration of fullHealRestorations) {
    const veto = getPokemonHealingVeto(pokemon, partyIndex, restoration, source, policy)
    if (veto !== undefined) {
      vetoes.push({ restoration, ...veto })
      continue
    }
    restored.push(restoration)
    if (restoration === 'hp') pokemon.currentHp = pokemon.stats.hp
    else if (restoration === 'status') pokemon.status = 0
    else for (const move of pokemon.moves) move.pp = move.maxPp
  }
  return { partyIndex, restored, vetoes }
}

export function healPokemonPartyWithPolicy(
  party: PokemonParty,
  policy: PokemonPartyHealingPolicy = basePokemonPartyHealingPolicy,
  source: PokemonHealingSource = 'full-heal',
): PokemonPartyHealResult {
  const members = party.members.map((pokemon, partyIndex) => healPokemonWithPolicy(pokemon, partyIndex, policy, source))
  return { members }
}
