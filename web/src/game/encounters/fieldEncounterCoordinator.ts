import type { OpeningMapPreview, RomInventory } from '../../ndsTypes'
import type { DoubleBattleSession } from '../battle/doubleBattleSession'
import type { FieldBattleFormatResolver } from '../battle/fieldBattleFormatResolver'
import { canStartHgssTrainerSightBattle } from '../battle/trainerSightEligibility'
import type { ScriptedWildPokemonDefinition } from '../battle/fieldBattleRosterPolicy'
import { createFieldDoubleWildBattleSession } from '../battle/fieldDoubleWildBattle'
import { createFieldScriptedWildPokemon } from '../battle/fieldScriptedWildPokemon'
import { cloneCanonicalPokemon, type CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { getFirstUsablePokemonPartySlot, type PokemonParty } from '../pokemon/pokemonParty'
import type { PokemonTeamPolicy } from '../pokemon/pokemonTeamPolicy'
import { resolveHgssEncounterRadioEffect } from '../pokegear/hgssRadio'
import { HGSS_SAFARI_MAP_ID } from '../safari/hgssSafariMap'
import type { HgssWeather } from '../world/hgssWeather'
import { resolveHgssBattleWeather } from '../world/hgssWeather'
import type { TrainerEngagement, WorldSession } from '../world/worldSession'
import type { FieldWildEncounterIdentityPort } from './fieldWildEncounterIdentityPort'
import type { FieldWildEncounterRouteResolver } from './fieldWildEncounterRouteResolver'
import {
  materializeFieldWildPokemon,
  type FieldWildPokemonMaterializationRuntime,
} from './fieldWildPokemonMaterialization'
import { selectHgssRoamerEncounter, type HgssRoamerSaveState } from './hgssRoamers'
import type {
  EncounterMovementMode,
  HgssFieldEncounterSession,
  PreparedFieldWildEncounter,
  PreparedSafariWildEncounter,
} from './wildEncounterSelection'
import {
  noopWildEncounterStartedObserver,
  observeWildEncounterStarted,
  type WildEncounterStartedMethod,
  type WildEncounterStartedObserver,
} from './wildEncounterStartedObserver'

export type ActivePreparedFieldWildEncounter = PreparedFieldWildEncounter & Readonly<{
  speciesName: string
  pokemon: CanonicalPokemon
}>

export type FieldEncounterEngagedTrainer = Pick<
  TrainerEngagement,
  'objectId' | 'trainerId' | 'direction' | 'distance' | 'encounterType'
>

/** Etat terrain minimal lu ou écrit par le coordinateur. */
export type FieldEncounterState = {
  pokemonRuntime?: FieldWildPokemonMaterializationRuntime
  currentMapId?: number
  party: PokemonParty
  roamers: HgssRoamerSaveState
  inventory: Map<number, number>
  weather: HgssWeather
  radioMusicSequenceId: number
  friendGroups: readonly ({ readonly randomValue: number } | undefined)[]
  safariZone: Readonly<{ session: Readonly<{ active: boolean }> }>
  engagedTrainers: FieldEncounterEngagedTrainer[]
}

export type FieldEncounterQuestInteraction = Readonly<{
  mapId: number
  captureScopeSectionId: number
  battle: ScriptedWildPokemonDefinition
}>

type FieldEncounterInventory = Pick<RomInventory, 'pokemonCatalog' | 'itemCatalog'>
  & Partial<Pick<RomInventory, 'trainerCatalog'>>
type FieldEncounterWorldSession = Pick<
  WorldSession,
  'getState' | 'findEngagingTrainers' | 'setObjectState'
>

export type FieldEncounterCoordinatorPorts = Readonly<{
  context: Readonly<{
    readFieldState: () => FieldEncounterState
    readInventory: () => FieldEncounterInventory | undefined
    readWorldSession: () => FieldEncounterWorldSession | undefined
    readEncounterSession: () => Pick<HgssFieldEncounterSession, 'checkStep'> | undefined
    readVblankCounter: () => number
    readMovementMode: () => EncounterMovementMode
    isRepelProtected: () => boolean
  }>
  policies: Readonly<{
    fieldWildEncounterRouteResolver: FieldWildEncounterRouteResolver
    fieldWildEncounterIdentityPort: FieldWildEncounterIdentityPort
    wildEncounterStartedObserver: WildEncounterStartedObserver
    fieldBattleFormatResolver: FieldBattleFormatResolver
    pokemonTeamPolicy: PokemonTeamPolicy
  }>
  battle: Readonly<{
    isSimpleActive: () => boolean
    isDoubleActive: () => boolean
    startSimple: (kind: 'wild', opponents: readonly CanonicalPokemon[]) => void
    startDouble: (session: DoubleBattleSession) => void
  }>
  safari: Readonly<{
    prepareEncounter: (
      method: 'land' | 'surf',
      repelLeadLevel?: number,
    ) => PreparedSafariWildEncounter | undefined
    materializeEncounter: (encounter: PreparedSafariWildEncounter) => CanonicalPokemon
    start: (
      encounter: PreparedSafariWildEncounter,
      vblank: number,
      preparedOpponent?: CanonicalPokemon,
    ) => unknown
  }>
  script: Readonly<{
    isActive: () => boolean
    has: (map: OpeningMapPreview, scriptId: number) => boolean
    start: (map: OpeningMapPreview, scriptId: number, actorId?: number) => void
    setActorDirection: (objectId: number, direction: TrainerEngagement['direction']) => void
  }>
  state: Readonly<{
    setPreparedEncounter: (prepared: ActivePreparedFieldWildEncounter) => void
    setActiveSafariPokemon: (pokemon: CanonicalPokemon) => void
    setActiveBattleRoamerId: (roamerId: number | undefined) => void
    setPendingWildEncounterCheck: (pending: boolean) => void
  }>
  effects: Readonly<{
    resolveBattleTerrainId: () => number
    resetPhoneRing: () => void
    clearMovementInput: () => void
    isBotRunning: () => boolean
    suspendBotForBattle: () => void
    setStatus: (text: string) => void
  }>
}>

export type FieldEncounterCoordinator = Readonly<{
  materializePreparedWildEncounter: (
    prepared: PreparedFieldWildEncounter,
  ) => CanonicalPokemon | undefined
  observeStartedWildEncounter: (
    pokemon: CanonicalPokemon,
    method: WildEncounterStartedMethod,
    mapSectionIdOverride?: number,
  ) => void
  startCanonicalFieldWildBattle: (pokemon: CanonicalPokemon) => void
  startAllPokemonQuestWildEncounter: (interaction: FieldEncounterQuestInteraction) => boolean
  startPreparedWildEncounter: (
    prepared: PreparedFieldWildEncounter,
    materialized?: CanonicalPokemon,
  ) => boolean
  tryPrepareWildEncounter: (suppressOrdinaryEncounter?: boolean) => boolean
  tryStartTrainerSightEncounter: () => boolean
}>

/**
 * Coordonne la sélection terrain et les trois routes de démarrage sans posséder
 * les états UI globaux, les moteurs de combat ni l'exécution des scripts.
 */
export function createFieldEncounterCoordinator(
  ports: FieldEncounterCoordinatorPorts,
): FieldEncounterCoordinator {
  const materializePreparedWildEncounter = (
    prepared: PreparedFieldWildEncounter,
  ): CanonicalPokemon | undefined => {
    const fieldState = ports.context.readFieldState()
    return materializeFieldWildPokemon({
      prepared,
      routeResolver: ports.policies.fieldWildEncounterRouteResolver,
      pokemonRuntime: fieldState.pokemonRuntime,
      metLocation: fieldState.currentMapId ?? ports.context.readWorldSession()?.getState()?.map.id,
      resolveMetTerrain: ports.effects.resolveBattleTerrainId,
      party: fieldState.party,
      roamers: fieldState.roamers,
      materializeSafariEncounter: ports.safari.materializeEncounter,
    })
  }

  const observeStartedWildEncounter = (
    pokemon: CanonicalPokemon,
    method: WildEncounterStartedMethod,
    mapSectionIdOverride?: number,
  ): void => {
    const observer = ports.policies.wildEncounterStartedObserver
    if (observer === noopWildEncounterStartedObserver) return
    const world = ports.context.readWorldSession()?.getState()
    if (!world) throw new Error('La carte de la rencontre sauvage démarrée est absente.')
    observeWildEncounterStarted({
      mapId: world.map.id,
      mapSectionId: mapSectionIdOverride ?? world.map.header.mapSection,
      method,
      instanceId: pokemon.instanceId,
      speciesId: pokemon.speciesId,
      level: pokemon.level,
    }, observer)
  }

  const startCanonicalFieldWildBattle = (pokemon: CanonicalPokemon): void => {
    const inventory = ports.context.readInventory()
    const fieldState = ports.context.readFieldState()
    const pokemonRuntime = fieldState.pokemonRuntime
    if (!inventory || !pokemonRuntime) throw new Error('Le runtime du combat sauvage est absent.')
    const format = ports.policies.fieldBattleFormatResolver({ kind: 'wild' })
    if (format.engine === 'double' && format.sessionKind === 'double') {
      ports.battle.startDouble(createFieldDoubleWildBattleSession({
        playerParty: fieldState.party.members.map(cloneCanonicalPokemon),
        opponent: pokemon,
        catalog: inventory.pokemonCatalog,
        itemCatalog: inventory.itemCatalog,
        bagInventory: fieldState.inventory,
        rng: pokemonRuntime.rng,
        playerTeamPolicy: ports.policies.pokemonTeamPolicy,
        initialWeather: resolveHgssBattleWeather(fieldState.weather),
        initialTerrainId: ports.effects.resolveBattleTerrainId(),
      }))
    } else if (format.engine === 'simple' && format.sessionKind === 'wild') {
      ports.battle.startSimple('wild', [pokemon])
    } else {
      throw new Error(`Le moteur ${format.engine} ne prend pas en charge cette rencontre sauvage.`)
    }
  }

  const startAllPokemonQuestWildEncounter = (interaction: FieldEncounterQuestInteraction): boolean => {
    const inventory = ports.context.readInventory()
    const fieldState = ports.context.readFieldState()
    const pokemonRuntime = fieldState.pokemonRuntime
    const world = ports.context.readWorldSession()?.getState()
    if (!inventory || !pokemonRuntime || !world || world.map.id !== interaction.mapId
      || ports.battle.isSimpleActive() || ports.battle.isDoubleActive()) return false
    const pokemon = createFieldScriptedWildPokemon({
      definition: interaction.battle,
      catalog: inventory.pokemonCatalog,
      rng: pokemonRuntime.rng,
      originalTrainer: pokemonRuntime.trainer,
      language: pokemonRuntime.language,
      gameVersion: pokemonRuntime.gameVersion,
      metLocation: world.map.id,
      metTerrain: ports.effects.resolveBattleTerrainId(),
    })
    ports.effects.resetPhoneRing()
    ports.state.setActiveBattleRoamerId(undefined)
    ports.effects.clearMovementInput()
    startCanonicalFieldWildBattle(pokemon)
    observeStartedWildEncounter(pokemon, 'scripted', interaction.captureScopeSectionId)
    ports.effects.setStatus(`Quête Pokémon : ${pokemon.speciesName} Nv.${pokemon.level}.`)
    return true
  }

  const startPreparedWildEncounter = (
    prepared: PreparedFieldWildEncounter,
    materialized?: CanonicalPokemon,
  ): boolean => {
    const route = ports.policies.fieldWildEncounterRouteResolver(prepared.encounter)
    const pokemon = materialized ?? materializePreparedWildEncounter(prepared)
    if (!pokemon) return false
    ports.effects.resetPhoneRing()
    if (route.engine === 'safari') {
      ports.safari.start(route.encounter, ports.context.readVblankCounter(), pokemon)
      ports.state.setActiveSafariPokemon(pokemon)
      ports.state.setPreparedEncounter({ ...prepared, speciesName: pokemon.speciesName, pokemon })
      ports.state.setActiveBattleRoamerId(undefined)
      ports.effects.clearMovementInput()
      if (ports.effects.isBotRunning()) ports.effects.suspendBotForBattle()
      observeStartedWildEncounter(pokemon, route.encounter.method)
      return true
    }
    ports.state.setPreparedEncounter({ ...prepared, speciesName: pokemon.speciesName, pokemon })
    ports.state.setActiveBattleRoamerId(
      route.encounter.method === 'roamer' ? route.encounter.roamerId : undefined,
    )
    ports.effects.clearMovementInput()
    if (ports.effects.isBotRunning()) ports.effects.suspendBotForBattle()
    startCanonicalFieldWildBattle(pokemon)
    observeStartedWildEncounter(pokemon, route.encounter.method)
    ports.effects.setStatus(`${route.encounter.method === 'roamer'
      ? 'Pokémon fuyard'
      : route.encounter.method === 'fishing'
        ? 'Pokémon pêché'
        : 'Combat sauvage'} ROM : ${pokemon.speciesName} Nv.${route.encounter.level}.`)
    return true
  }

  const tryPrepareWildEncounter = (suppressOrdinaryEncounter = false): boolean => {
    const world = ports.context.readWorldSession()?.getState()
    const fieldState = ports.context.readFieldState()
    const encounterSession = ports.context.readEncounterSession()
    const pokemonRuntime = fieldState.pokemonRuntime
    if (!world || !encounterSession || !pokemonRuntime || !world.map.terrain) return false
    const repelLead = fieldState.party.members[getFirstUsablePokemonPartySlot(fieldState.party)]
    const terrainAttribute = world.map.terrain.attributes[
      world.tileZ * world.map.terrain.width + world.tileX
    ]
    const prepared = encounterSession.checkStep({
      mapId: world.map.id,
      bankId: world.map.header.wildEncounterBank,
      terrainAttribute,
      direction: world.direction,
      movementMode: ports.context.readMovementMode(),
      radioEffect: resolveHgssEncounterRadioEffect(fieldState.radioMusicSequenceId),
      rateContext: {
        lead: fieldState.party.members[0],
        weatherType: fieldState.weather,
        flutePlayed: fieldState.roamers.flutePlayed,
      },
      generationContext: {
        lead: fieldState.party.members[0],
        resolveSpeciesTypes: (speciesId) => pokemonRuntime.catalog.personalData[speciesId]?.types,
        massOutbreak: {
          active: fieldState.roamers.massOutbreaksEnabled,
          randomValue: fieldState.friendGroups[1]?.randomValue ?? 0,
        },
      },
      repelLeadLevel: ports.context.isRepelProtected() ? repelLead?.level : undefined,
      prepareSpecialEncounter: () => {
        const selected = selectHgssRoamerEncounter(
          fieldState.roamers,
          world.map.id,
          pokemonRuntime.rng,
        )
        return selected && {
          bankId: world.map.header.wildEncounterBank,
          slotIndex: selected.roamerId,
          method: 'roamer',
          speciesId: selected.roamer.speciesId,
          level: selected.roamer.level,
          roamerId: selected.roamerId,
        }
      },
      suppressOrdinaryEncounter,
      prepareContextEncounter: world.map.id === HGSS_SAFARI_MAP_ID
        && fieldState.safariZone.session.active
        ? (method) => ports.safari.prepareEncounter(
            method,
            ports.context.isRepelProtected() ? repelLead?.level : undefined,
          )
        : undefined,
    })
    if (!prepared) return false
    return startPreparedWildEncounter(ports.policies.fieldWildEncounterIdentityPort(
      prepared,
      { mapId: world.map.id, source: 'step' },
    ))
  }

  const tryStartTrainerSightEncounter = (): boolean => {
    const worldSession = ports.context.readWorldSession()
    const world = worldSession?.getState()
    if (!worldSession || !world || ports.script.isActive()) return false
    const engagements = worldSession.findEngagingTrainers()
    if (engagements.length === 0) return false
    const fieldState = ports.context.readFieldState()
    const inventory = ports.context.readInventory()
    if (!inventory || !canStartHgssTrainerSightBattle(
      inventory.trainerCatalog?.[engagements[0]!.trainerId],
      fieldState.party,
      ports.policies.pokemonTeamPolicy,
      ports.policies.fieldBattleFormatResolver,
      engagements.length > 1,
    )) return false
    if (!ports.script.has(world.map, 3739)) {
      throw new Error(`Le script standard d'approche des Dresseurs est absent de ${world.map.label}.`)
    }
    fieldState.engagedTrainers = engagements.map(({
      objectId,
      trainerId,
      direction,
      distance,
      encounterType,
    }) => ({ objectId, trainerId, direction, distance, encounterType }))
    for (const trainer of engagements) {
      worldSession.setObjectState(trainer.objectId, undefined, undefined, trainer.direction)
      ports.script.setActorDirection(trainer.objectId, trainer.direction)
    }
    ports.state.setPendingWildEncounterCheck(false)
    ports.script.start(world.map, 3739, engagements[0]!.objectId)
    return ports.script.isActive()
  }

  return Object.freeze({
    materializePreparedWildEncounter,
    observeStartedWildEncounter,
    startCanonicalFieldWildBattle,
    startAllPokemonQuestWildEncounter,
    startPreparedWildEncounter,
    tryPrepareWildEncounter,
    tryStartTrainerSightEncounter,
  })
}
