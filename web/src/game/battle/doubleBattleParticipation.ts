import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'

export type DoubleBattleParticipationSide = 'player' | 'opponent'
export type DoubleBattleParticipationPosition = { side: DoubleBattleParticipationSide, slot: 0 | 1 }

export type DoubleBattleParticipationState = Map<string, Map<string, Set<number>>>

type ParticipationParticipant = {
  ownerId: string
  party: CanonicalPokemon[]
  activePartyIndex: number
}

export type DoubleBattleParticipationContext = {
  teams: Record<DoubleBattleParticipationSide, readonly ParticipationParticipant[]>
  experienceParticipation: DoubleBattleParticipationState
}

function activePokemon(participant: ParticipationParticipant): CanonicalPokemon | undefined {
  return participant.party[participant.activePartyIndex]
}

function pokemonIdentity(pokemon: CanonicalPokemon): string {
  return pokemon.instanceId
}

function targetIdentity(
  context: DoubleBattleParticipationContext,
  target: DoubleBattleParticipationPosition,
  pokemon: CanonicalPokemon,
): string {
  const participant = context.teams[target.side][target.slot]
  if (!participant) throw new Error(`Le slot ${target.side}:${target.slot} n'est pas occupé dans ce combat.`)
  return `${target.side}:${participant.ownerId}:${pokemonIdentity(pokemon)}`
}

/**
 * Enregistre les Pokémon simultanément présents face à face. L'historique est
 * indexé par adversaire concret afin qu'un retrait volontaire ne fasse pas
 * perdre le droit à l'EXP lorsque cet adversaire est finalement mis K.O.
 */
export function recordDoubleBattleActiveMatchups(context: DoubleBattleParticipationContext): void {
  for (const sourceSide of ['player', 'opponent'] as const) {
    const targetSide = sourceSide === 'player' ? 'opponent' : 'player'
    for (const source of context.teams[sourceSide]) {
      const sourcePokemon = activePokemon(source)
      if (!sourcePokemon || sourcePokemon.isEgg || sourcePokemon.currentHp <= 0) continue
      for (let targetSlot = 0; targetSlot < context.teams[targetSide].length; targetSlot += 1) {
        const target = context.teams[targetSide][targetSlot]!
        const targetPokemon = activePokemon(target)
        if (!targetPokemon || targetPokemon.isEgg || targetPokemon.currentHp <= 0) continue
        const key = targetIdentity(context, { side: targetSide, slot: targetSlot as 0 | 1 }, targetPokemon)
        const owners = context.experienceParticipation.get(key) ?? new Map<string, Set<number>>()
        const indexes = owners.get(source.ownerId) ?? new Set<number>()
        indexes.add(source.activePartyIndex)
        owners.set(source.ownerId, indexes)
        context.experienceParticipation.set(key, owners)
      }
    }
  }
}

export function getDoubleBattleExperienceParticipants(
  context: DoubleBattleParticipationContext,
  target: DoubleBattleParticipationPosition,
  defeated: CanonicalPokemon,
): ReadonlyMap<string, readonly number[]> {
  const owners = context.experienceParticipation.get(targetIdentity(context, target, defeated))
  if (!owners) return new Map()
  return new Map([...owners].map(([ownerId, indexes]) => [ownerId, [...indexes].sort((left, right) => left - right)]))
}

export function getDoubleBattleExperienceParticipantIndexes(
  context: DoubleBattleParticipationContext,
  target: DoubleBattleParticipationPosition,
  defeated: CanonicalPokemon,
  ownerId: string,
): readonly number[] {
  return getDoubleBattleExperienceParticipants(context, target, defeated).get(ownerId) ?? []
}

export function clearDoubleBattleExperienceParticipation(
  context: DoubleBattleParticipationContext,
  target: DoubleBattleParticipationPosition,
  defeated: CanonicalPokemon,
): void {
  context.experienceParticipation.delete(targetIdentity(context, target, defeated))
}
