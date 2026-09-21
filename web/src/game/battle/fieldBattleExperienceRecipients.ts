import type { CanonicalPokemon, PokemonTrainerIdentity } from '../pokemon/canonicalPokemon'
import type { HgssBattleExperienceModifiers } from './battleProgression'

export type FieldBattleExperienceRecipient = Readonly<{
  partyIndex: number
  pokemon: CanonicalPokemon
  experienceDivisor: number
  modifiers: Readonly<HgssBattleExperienceModifiers>
}>

export type FieldBattleExperienceRecipientContext = Readonly<{
  party: readonly CanonicalPokemon[]
  participantPartyIndexes: ReadonlySet<number>
  player: PokemonTrainerIdentity
  nativeLanguage?: number
  currentLocationId?: number
  readHeldItem: (pokemon: CanonicalPokemon) => Readonly<{ effect: number, parameter: number }>
}>

/**
 * Projection commune simple/double des bénéficiaires. Elle ne calcule pas
 * l'EXP et ne mute ni l'équipe ni les objets.
 */
export function resolveFieldBattleExperienceRecipients(
  context: FieldBattleExperienceRecipientContext,
): FieldBattleExperienceRecipient[] {
  const participantIndexes = [...context.participantPartyIndexes].filter((partyIndex) => {
    const pokemon = context.party[partyIndex]
    return Boolean(pokemon && !pokemon.isEgg && pokemon.currentHp > 0)
  })
  const expShareIndexes = context.party.flatMap((pokemon, partyIndex) => (
    !pokemon.isEgg && pokemon.currentHp > 0 && context.readHeldItem(pokemon).effect === 51 ? [partyIndex] : []
  ))
  const participantCount = Math.max(1, participantIndexes.length)
  return [...new Set([...participantIndexes, ...expShareIndexes])].map((partyIndex) => {
    const pokemon = context.party[partyIndex]!
    const heldItem = context.readHeldItem(pokemon)
    const belongsToPlayer = pokemon.originalTrainer.isPlayer ?? (pokemon.originalTrainer.id === context.player.id
      && pokemon.originalTrainer.name === context.player.name
      && pokemon.originalTrainer.gender === context.player.gender)
    const traded = belongsToPlayer
      ? 'none'
      : pokemon.origin.language === context.nativeLanguage ? 'same-language' : 'foreign-language'
    return {
      partyIndex,
      pokemon,
      experienceDivisor: participantCount,
      modifiers: {
        participated: participantIndexes.includes(partyIndex),
        participantCount,
        hasExpShare: expShareIndexes.includes(partyIndex),
        expShareCount: expShareIndexes.length,
        holdEffect: heldItem.effect,
        holdEffectParameter: heldItem.parameter,
        traded,
        currentLocationId: context.currentLocationId,
      },
    }
  })
}
