import type { RomInventory } from '../../ndsTypes'
import type { HgssFollowerReaction } from '../../rom/overworld/followerReactions'
import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import {
  calculateHgssPokeathlonStars,
  resolveHgssFollowerPokeathlonStatClass,
  resolveHgssPokeathlonBasePerformance,
} from '../../rom/pokemon/pokeathlonPerformance'
import {
  createHgssFollowerReactionContext,
  resolveHgssFollowerFacingClass,
  selectHgssFollowerReaction,
} from '../pokemon/followerReactionSelection'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { getPokemonPartyPokeathlonModifiers } from '../pokemon/pokemonParty'
import type { WorldSession } from '../world/worldSession'
import type { FieldScriptStepDisposition, FieldScriptStepHandler } from './fieldScriptHost'
import type { FieldScriptState, FieldScriptStep } from './fieldScriptRunner'

type FollowerInteractionStep = Extract<FieldScriptStep, { kind: 'followerInteraction' }>

export type FieldScriptFollowerInventory = Pick<RomInventory,
  'pokemonCatalog' | 'pokeathlonPerformanceCatalog' | 'followerReactionCatalog' | 'itemCatalog'
>

export type FieldScriptFollowerWorld = Pick<WorldSession, 'getFollowerInteractionEnvironment'>

export type FieldScriptFollowerHostPorts = Readonly<{
  readState: () => FieldScriptState
  readInventory: () => FieldScriptFollowerInventory | undefined
  readWorld: () => FieldScriptFollowerWorld | undefined
  readRng: () => HgssLcrng | undefined
  report: (message: string) => void
  startReaction: (pokemon: CanonicalPokemon, reaction: HgssFollowerReaction) => void
}>

export function createFieldScriptFollowerHost(ports: FieldScriptFollowerHostPorts): FieldScriptStepHandler {
  const handleFollowerInteraction = (step: FollowerInteractionStep): FieldScriptStepDisposition => {
    const state = ports.readState()
    const pokemon = state.party.members[step.slot]
    if (!pokemon || pokemon.speciesId !== step.speciesId) {
      throw new Error(`Le Pokémon follower du slot ${step.slot} a changé pendant FollowMonInteract.`)
    }

    const inventory = ports.readInventory()
    const environment = ports.readWorld()?.getFollowerInteractionEnvironment()
    const rng = ports.readRng()
    if (!inventory || !environment || !rng) {
      throw new Error('Le contexte ROM du follower est absent pendant FollowMonInteract.')
    }

    const personalData = inventory.pokemonCatalog.personalData[pokemon.speciesId]
    const speciesReactionClass = inventory.followerReactionCatalog.speciesReactionClasses[pokemon.speciesId - 1]
    if (!personalData || speciesReactionClass === undefined) {
      throw new Error(`Les conditions ROM du follower ${pokemon.speciesId} sont absentes.`)
    }

    const heldItemEffect = pokemon.heldItemId === 0
      ? 0
      : inventory.itemCatalog.items[pokemon.heldItemId]?.holdEffect
    if (heldItemEffect === undefined) {
      throw new Error(`L’effet de l’objet tenu ${pokemon.heldItemId} est absent de la ROM.`)
    }
    const now = state.pokemonRuntime?.now() ?? new Date()
    const pokeathlonStatClass = resolveHgssFollowerPokeathlonStatClass(calculateHgssPokeathlonStars(
      resolveHgssPokeathlonBasePerformance(inventory.pokeathlonPerformanceCatalog, pokemon.speciesId, pokemon.form),
      pokemon.personality,
      pokemon.nature,
      now,
      getPokemonPartyPokeathlonModifiers(state.party, step.slot),
    ))

    const context = createHgssFollowerReactionContext(
      pokemon,
      personalData,
      heldItemEffect,
      speciesReactionClass,
      pokemon.shinyLeafMask,
      {
        nearbyObjectCount: environment.nearbyObjectCount,
        hiddenItemCount: environment.hiddenItemCount,
        weather: state.weather,
        metatileBehavior: environment.metatileBehavior,
        mapId: environment.mapId,
        time: now,
        mood: state.followerMood,
        pokeathlonStatClass,
        facingClass: resolveHgssFollowerFacingClass(environment.facingDirection),
        hasFlag: (flagId) => state.flags.has(flagId),
      },
    )
    const selected = selectHgssFollowerReaction(
      inventory.followerReactionCatalog,
      environment.mapSection,
      context,
      rng,
    )
    ports.report(`${pokemon.nickname ?? pokemon.speciesName} déclenche la réaction ROM ${selected.reaction.reactionId}.`)
    ports.startReaction(pokemon, selected.reaction)
    return 'suspend'
  }

  return Object.freeze({
    handle: (step: FieldScriptStep): FieldScriptStepDisposition => (
      step.kind === 'followerInteraction' ? handleFollowerInteraction(step) : 'unhandled'
    ),
  })
}
