import type { OpeningMapPreview, PlayerDirection } from '../../ndsTypes'
import type { HgssBlackoutDestination } from '../../rom/overworld/blackoutSpawns'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { healPokemonPartyWithPolicy, type PokemonPartyHealingPolicy } from '../pokemon/pokemonPartyHealingPolicy'
import { basePokemonTeamPolicy, type PokemonTeamPolicy } from '../pokemon/pokemonTeamPolicy'
import { resolveBaseFieldBattleFormat, type FieldBattleFormatResolver } from '../battle/fieldBattleFormatResolver'
import { canStartHgssTrainerSightBattle } from '../battle/trainerSightEligibility'
import {
  createFieldScriptMapInitSequenceRunner,
  createFieldScriptRunner,
  createFieldScriptSequenceRunner,
  hasFieldScript,
  releaseFieldScriptExecutionState,
  setFieldScriptMapState,
  setFieldScriptPlayerState,
  syncFieldScriptFollowerActivity,
  type FieldScriptRunner,
  type FieldScriptState,
  type FieldScriptStep,
} from '../scripts/fieldScriptRunner'
import { initializeHgssGymmickState } from '../scripts/hgssGymmickFieldRuntime'
import { getMapOrigin } from '../world/mapCoordinates'
import { createWorldSession, hgssFollowerObjectId, type WorldMoveResult, type WorldSession } from '../world/worldSession'
import { resolveMapFrameScripts, type MapInitPhase } from '../../rom/scripts/fieldScripts'
import type { HgssWildEncounterData } from '../../rom/encounters/wildEncounterData'
import {
  createHgssFieldEncounterSession,
  type EncounterMovementMode,
  type EncounterRadioEffect,
  type PreparedWildEncounter,
  type WildEncounterRateRoll,
} from '../encounters/wildEncounterSelection'
import { createCanonicalWildPokemon, hasWildHeldItemCompoundEyesInfluence } from '../encounters/wildPokemonGeneration'
import { createOfflineHgssMultiplayerResult } from '../multiplayer/hgssMultiplayerGateway'
import {
  applyHgssRoamerBattleResult,
  createCanonicalHgssRoamerPokemon,
  selectHgssRoamerEncounter,
  updateHgssRoamersForMapTransition,
} from '../encounters/hgssRoamers'

export type FieldInput = 'up' | 'down' | 'left' | 'right' | 'confirm'
export type FieldWildBattleResult = 'won' | 'lost' | 'escaped' | 'captured'

export type FieldSimulationEvent =
  | FieldScriptStep
  | { kind: 'moved', mapId: number, tileX: number, tileZ: number }
  | { kind: 'blocked', reason: 'bounds' | 'terrain' | 'npc' | 'follower' | 'dynamic-actor', tileX: number, tileZ: number, attribute?: number }
  | { kind: 'choiceCursor', index: number }
  | { kind: 'wildEncounterPrepared', encounter: PreparedWildEncounter & { speciesName: string }, rateRoll: WildEncounterRateRoll, pokemon: CanonicalPokemon }
  | { kind: 'wildEncounterResolved', result: FieldWildBattleResult, method: PreparedWildEncounter['method'], speciesId: number }

export type FieldInputSimulatorOptions = {
  wildEncounterCatalog?: readonly HgssWildEncounterData[]
  movementMode?: EncounterMovementMode
  radioEffect?: EncounterRadioEffect
  healingPolicy?: PokemonPartyHealingPolicy
  teamPolicy?: PokemonTeamPolicy
  battleFormatResolver?: FieldBattleFormatResolver
  blackoutDestinationResolver?: (spawnId: number) => HgssBlackoutDestination
  blackoutSpawnForMapResolver?: (mapId: number) => number | undefined
}

export type FieldInputSimulator = {
  input: (input: FieldInput) => FieldSimulationEvent[]
  settle: () => FieldSimulationEvent[]
  getWorld: () => WorldSession
  getFieldState: () => FieldScriptState
  getChoiceIndex: () => number | undefined
  isWaitingForInput: () => boolean
  isWaitingForBattle: () => boolean
  submitBattleResult: (won: boolean) => FieldSimulationEvent[]
  submitWildEncounterResult: (result: FieldWildBattleResult) => FieldSimulationEvent[]
  hasActiveScript: () => boolean
  getPreparedWildEncounter: () => Extract<FieldSimulationEvent, { kind: 'wildEncounterPrepared' }> | undefined
  /** Victoires réellement rendues au simulateur, distinctes des TrainerFlags que les scripts ROM choisissent de poser. */
  hasWonTrainerBattle: (trainerId: number) => boolean
  getWonTrainerBattleIds: () => readonly number[]
  getHistory: () => readonly FieldSimulationEvent[]
}

const directionInputs: Record<Exclude<FieldInput, 'confirm'>, { x: number, z: number, direction: PlayerDirection }> = {
  up: { x: 0, z: -1, direction: 'north' },
  down: { x: 0, z: 1, direction: 'south' },
  left: { x: -1, z: 0, direction: 'west' },
  right: { x: 1, z: 0, direction: 'east' },
}

export function createFieldInputSimulator(
  maps: OpeningMapPreview[],
  state: FieldScriptState,
  start: { mapId: number, tileX: number, tileZ: number, direction?: PlayerDirection },
  options: FieldInputSimulatorOptions = {},
): FieldInputSimulator {
  const world = createWorldSession(maps, state.flags, state.hiddenObjectIds, state.variables, undefined, state.trainerFlags, () => state.dynamicWarp)
  const initial = world.loadMap(start.mapId, start.tileX, start.tileZ, start.direction)
  if (!initial) throw new Error(`Carte ROM ${start.mapId} absente du simulateur d'inputs.`)

  const readFollowerMapObjectSignal = () => {
    const present = world.getFollowerState() !== undefined
    return { present, visible: present }
  }
  const fieldScriptRuntimeParameters = [
    options.healingPolicy,
    options.teamPolicy,
    undefined,
    undefined,
    options.battleFormatResolver,
    readFollowerMapObjectSignal,
  ] as const

  const history: FieldSimulationEvent[] = []
  let activeRunner: FieldScriptRunner | undefined
  let pendingChoice: Extract<FieldScriptStep, { kind: 'choice' }> | undefined
  let choiceIndex = 0
  let waitingForInput = false
  let waitingForBattle = false
  let pendingMapFrameCheck = false
  let preparedWildEncounter: Extract<FieldSimulationEvent, { kind: 'wildEncounterPrepared' }> | undefined
  let pendingTrainerBattleIds: number[] = []
  const wonTrainerBattleIds = new Set<number>()
  const encounterSession = options.wildEncounterCatalog && state.pokemonRuntime
    ? createHgssFieldEncounterSession(options.wildEncounterCatalog, state.pokemonRuntime.rng, state.pokemonRuntime.now, initial.direction)
    : undefined

  const append = (events: FieldSimulationEvent[], event: FieldSimulationEvent): void => {
    events.push(event)
    history.push(event)
  }

  const syncScriptPosition = (): void => {
    const worldState = world.getState()
    if (!worldState) return
    const origin = getMapOrigin(worldState.map)
    setFieldScriptPlayerState(state, origin.x + worldState.tileX, origin.z + worldState.tileZ, worldState.direction, worldState.groundHeight)
  }

  const syncObjectMovements = (result: WorldMoveResult): void => {
    for (const movement of result.objectMovements ?? []) {
      const actor = state.objects.get(movement.objectId)
      if (!actor) continue
      actor.x = movement.worldX
      actor.z = movement.worldZ
      actor.direction = movement.finalDirection
    }
  }

  const syncFollowerRuntime = (map: OpeningMapPreview): void => {
    syncFieldScriptFollowerActivity(state, map)
    world.setFollowerEnabled(state.followMonActive && world.getState()?.locomotion === 'walking')
  }

  const activateMap = (map: OpeningMapPreview, phase: MapInitPhase, interruptedRunner?: FieldScriptRunner): void => {
    const worldState = world.getState()
    if (!worldState) return
    if (!interruptedRunner) releaseFieldScriptExecutionState(state)
    state.hiddenObjectIds.clear()
    state.invisibleObjectIds.clear()
    const origin = getMapOrigin(map)
    setFieldScriptMapState(state, map, origin.x + worldState.tileX, origin.z + worldState.tileZ, worldState.direction)
    const blackoutSpawn = options.blackoutSpawnForMapResolver?.(map.id)
    if (blackoutSpawn !== undefined) state.blackoutSpawn = blackoutSpawn
    syncFollowerRuntime(map)
    pendingMapFrameCheck = true
    activeRunner = createFieldScriptMapInitSequenceRunner(map, state, phase, interruptedRunner, ...fieldScriptRuntimeParameters)
    if (activeRunner) {
      waitingForBattle = false
    }
  }

  const runMapFrameScripts = (events: FieldSimulationEvent[]): boolean => {
    if (activeRunner) return false
    const map = world.getState()?.map
    if (!map) return false
    const scriptIds = resolveMapFrameScripts(map.initScripts, (variable) => state.variables.get(variable) ?? 0)
    if (scriptIds.length === 0) return false
    const before = world.getState()
    syncFollowerRuntime(map)
    activeRunner = createFieldScriptSequenceRunner(scriptIds.map((scriptId) => createFieldScriptRunner(map, scriptId, state, undefined, ...fieldScriptRuntimeParameters)))
    advance(events, true)
    const after = world.getState()
    return activeRunner !== undefined
      || before?.map.id !== after?.map.id
      || before?.tileX !== after?.tileX
      || before?.tileZ !== after?.tileZ
  }

  const runPendingMapFrameScripts = (events: FieldSimulationEvent[]): boolean => {
    if (!pendingMapFrameCheck || activeRunner) return false
    pendingMapFrameCheck = false
    return runMapFrameScripts(events)
  }

  const startScript = (map: OpeningMapPreview, scriptId: number, actorId?: number): void => {
    if (!hasFieldScript(map, scriptId)) throw new Error(`Le script ROM ${scriptId} n'est pas decode pour la carte ${map.id}.`)
    syncScriptPosition()
    syncFollowerRuntime(map)
    waitingForBattle = false
    activeRunner = createFieldScriptRunner(map, scriptId, state, actorId, ...fieldScriptRuntimeParameters)
  }

  const transition = (mapId: number, phase: MapInitPhase, events: FieldSimulationEvent[], anchor?: number, direction?: PlayerDirection): boolean => {
    const result = world.transitionTo(mapId, anchor, direction)
    if (result.kind === 'missing-map') throw new Error(`Transition ROM vers la carte ${mapId} absente du catalogue.`)
    if (result.kind === 'missing-anchor') throw new Error(`Transition ROM vers la carte ${mapId} sans ancre d’entrée valide.`)
    if (state.pokemonRuntime) updateHgssRoamersForMapTransition(state.roamers, result.state.map.id, state.pokemonRuntime.rng)
    encounterSession?.reset(result.state.direction)
    append(events, { kind: 'moved', mapId: result.state.map.id, tileX: result.state.tileX, tileZ: result.state.tileZ })
    activateMap(result.state.map, phase)
    return true
  }

  const checkWildEncounter = (events: FieldSimulationEvent[]): boolean => {
    if (!options.wildEncounterCatalog) return false
    if (!state.pokemonRuntime || !encounterSession) throw new Error('Le runtime Pokemon HGSS requis par les rencontres sauvages n’est pas initialise.')
    const worldState = world.getState()
    if (!worldState?.map.terrain) return false
    const attribute = worldState.map.terrain.attributes[worldState.tileZ * worldState.map.terrain.width + worldState.tileX]
    const bankId = worldState.map.header.wildEncounterBank
    const prepared = encounterSession.checkStep({
      mapId: worldState.map.id,
      bankId,
      terrainAttribute: attribute,
      direction: worldState.direction,
      movementMode: options.movementMode,
      radioEffect: options.radioEffect,
      generationContext: { lead: state.party.members[0], resolveSpeciesTypes: (speciesId) => state.pokemonRuntime!.catalog.personalData[speciesId]?.types, massOutbreak: { active: state.roamers.massOutbreaksEnabled, randomValue: state.friendGroups[1]?.randomValue ?? 0 } },
      repelLeadLevel: state.roamers.repelSteps > 0 ? state.party.members.find((pokemon) => !pokemon.isEgg && pokemon.currentHp > 0)?.level : undefined,
      prepareSpecialEncounter: () => {
        const selected = selectHgssRoamerEncounter(state.roamers, worldState.map.id, state.pokemonRuntime!.rng)
        return selected && {
          bankId: worldState.map.header.wildEncounterBank,
          slotIndex: selected.roamerId,
          method: 'roamer',
          speciesId: selected.roamer.speciesId,
          level: selected.roamer.level,
          roamerId: selected.roamerId,
        }
      },
    })
    if (!prepared) return false
    const { encounter, rateRoll } = prepared
    const runtime = state.pokemonRuntime
    const roamer = encounter.method === 'roamer' ? state.roamers.roamers[encounter.roamerId] : undefined
    const pokemon = roamer ? createCanonicalHgssRoamerPokemon(
      roamer,
      runtime.catalog,
      runtime.rng,
      runtime.trainer,
      runtime.language,
      runtime.gameVersion,
    ) : createCanonicalWildPokemon({
      speciesId: encounter.speciesId,
      level: encounter.level,
      catalog: runtime.catalog,
      rng: runtime.rng,
      originalTrainer: runtime.trainer,
      origin: {
        language: runtime.language,
        gameVersion: runtime.gameVersion,
        metLocation: 0,
        metLevel: encounter.level,
        metTerrain: 0,
      },
      compoundEyes: hasWildHeldItemCompoundEyesInfluence(state.party.members[0]),
      leadPokemon: state.party.members[0],
    })
    preparedWildEncounter = {
      kind: 'wildEncounterPrepared',
      encounter: { ...encounter, speciesName: pokemon.speciesName },
      rateRoll,
      pokemon,
    }
    append(events, preparedWildEncounter)
    return true
  }

  const startTrainerSightEncounter = (events: FieldSimulationEvent[]): boolean => {
    const worldState = world.getState()
    if (!worldState) return false
    const engagements = world.findEngagingTrainers()
    if (engagements.length === 0) return false
    if (!canStartHgssTrainerSightBattle(
      state.pokemonRuntime?.trainerCatalog?.[engagements[0]!.trainerId],
      state.party,
      options.teamPolicy ?? basePokemonTeamPolicy,
      options.battleFormatResolver ?? resolveBaseFieldBattleFormat,
      engagements.length > 1,
    )) return false
    if (!hasFieldScript(worldState.map, 3739)) {
      throw new Error(`Le script standard d'approche des Dresseurs est absent de ${worldState.map.label}.`)
    }
    state.engagedTrainers = engagements.map(({ objectId, trainerId, direction, distance, encounterType }) => ({
      objectId,
      trainerId,
      direction,
      distance,
      encounterType,
    }))
    for (const trainer of engagements) world.setObjectState(trainer.objectId, undefined, undefined, trainer.direction)
    startScript(worldState.map, 3739, engagements[0]!.objectId)
    advance(events, true)
    return true
  }

  const advance = (events: FieldSimulationEvent[], settleTimers: boolean): void => {
    for (let steps = 0; activeRunner && steps < 1024; steps += 1) {
      const step = activeRunner.resume()
      append(events, step)
      if (step.kind === 'ended') {
        activeRunner = undefined
        waitingForInput = false
        waitingForBattle = false
        pendingChoice = undefined
        releaseFieldScriptExecutionState(state)
        runPendingMapFrameScripts(events)
        return
      }
      if (step.kind === 'choice') {
        pendingChoice = step
        choiceIndex = 0
        return
      }
      if (step.kind === 'message') {
        waitingForInput = true
        return
      }
      if (step.kind === 'phoneCall') {
        waitingForInput = true
        return
      }
      if (step.kind === 'inputWait') {
        if (settleTimers && step.frames !== undefined) continue
        waitingForInput = true
        return
      }
      if (step.kind === 'nickname') {
        // Le nom du rival est obligatoire dans la ROM : l'annuler remet le
        // script sur le même écran. Les surnoms de Pokémon et noms de groupe
        // restent, eux, réellement annulables.
        activeRunner.enterNickname(step.cancellable ? undefined : step.currentName)
        continue
      }
      if (step.kind === 'eggHatch') {
        activeRunner.finishEggHatch(undefined)
        continue
      }
      if (step.kind === 'waiting') {
        if (!settleTimers) return
        continue
      }
      if (step.kind === 'warp') {
        const interruptedRunner = activeRunner
        const result = world.scriptWarpTo(step.mapId, step.x, step.z, step.direction)
        if (result.kind === 'missing-map') throw new Error(`Warp script ROM vers la carte ${step.mapId} absente du catalogue.`)
        if (result.kind === 'missing-anchor') throw new Error(`Warp script ROM vers la carte ${step.mapId} sans ancre d’entrée valide.`)
        if (state.pokemonRuntime) updateHgssRoamersForMapTransition(state.roamers, result.state.map.id, state.pokemonRuntime.rng)
        append(events, { kind: 'moved', mapId: result.state.map.id, tileX: result.state.tileX, tileZ: result.state.tileZ })
        activateMap(result.state.map, 'transition', interruptedRunner)
        // ScrCmd_Warp suspend son contexte pendant la tâche de transition,
        // puis le reprend sans attendre une nouvelle entrée du joueur.
        continue
      }
      if (step.kind === 'blackout') {
        const resolveDestination = options.blackoutDestinationResolver
        if (!resolveDestination) {
          throw new Error('Le resolver ROM requis par le blackout du simulateur d’inputs est absent.')
        }
        const interruptedRunner = activeRunner
        const destination = resolveDestination(state.blackoutSpawn)
        state.followMonActive = false
        state.followMonMovementPaused = false
        initializeHgssGymmickState(state, 0)
        world.setFollowerEnabled(false)
        healPokemonPartyWithPolicy(state.party, options.healingPolicy)
        const result = world.scriptWarpTo(destination.mapId, destination.x, destination.z, destination.direction)
        if (result.kind === 'missing-map') {
          throw new Error(`Blackout ROM vers la carte ${destination.mapId} absente du catalogue.`)
        }
        if (result.kind === 'missing-anchor') {
          throw new Error(`Blackout ROM vers la carte ${destination.mapId} sans ancre d’entrée valide.`)
        }
        encounterSession?.reset(result.state.direction)
        append(events, { kind: 'moved', mapId: result.state.map.id, tileX: result.state.tileX, tileZ: result.state.tileZ })
        activateMap(result.state.map, 'transition')
        const destinationInitRunner = activeRunner
        const followupScriptId = destination.followup === 'mom' ? 2012 : 2013
        const runners = [
          destinationInitRunner,
          createFieldScriptRunner(result.state.map, followupScriptId, state, undefined, ...fieldScriptRuntimeParameters),
          interruptedRunner,
        ].filter((runner): runner is FieldScriptRunner => Boolean(runner))
        activeRunner = runners.length === 1 ? runners[0] : createFieldScriptSequenceRunner(runners)
        continue
      }
      if (step.kind === 'movement') {
        world.applyObjectMovement(step.objectId, step.actions, !state.followMonMovementPaused)
        continue
      }
      if (step.kind === 'objectState') {
        world.setObjectState(step.objectId, step.x, step.z, step.direction)
        continue
      }
      if (step.kind === 'gymMechanism') {
        if (step.destination) world.setObjectState(255, step.destination.x, step.destination.z, step.destination.direction)
        if (step.followerDestination) world.setObjectState(hgssFollowerObjectId, step.followerDestination.x, step.followerDestination.z, step.followerDestination.direction)
        continue
      }
      if (step.kind === 'fieldMoveEffect') {
        // Le host visuel publie 1 quand l'animation ScrCmd_560 est terminée.
        // Le simulateur headless n'a aucune frame à rendre : il acquitte donc
        // immédiatement le même contrat avant de reprendre le script ROM.
        state.variables.set(step.completionVariable, 1)
        continue
      }
      if (step.kind === 'facePlayer') {
        if (step.objectId !== undefined) world.faceObjectAtPlayer(step.objectId)
        continue
      }
      if (step.kind === 'battle') {
        pendingTrainerBattleIds = step.battle.kind === 'trainer'
          ? [step.battle.trainerId, ...(step.battle.trainerParameter !== 0 ? [step.battle.trainerParameter] : [])]
          : step.battle.kind === 'multiTrainer'
            ? [...step.battle.opponentTrainerIds]
            : []
        waitingForBattle = true
        return
      }
      if (step.kind === 'multiplayer') {
        activeRunner.submitMultiplayerResult(createOfflineHgssMultiplayerResult(step.request))
        continue
      }
      if (step.kind === 'easyChat') {
        activeRunner.submitEasyChat(undefined)
        continue
      }
      if (step.kind === 'pcBox') {
        activeRunner.closePcBox()
        continue
      }
      if (step.kind === 'pokeathlonApp') {
        activeRunner.closePokeathlonApp()
        continue
      }
      if (step.kind === 'frontierRecordsApp') {
        activeRunner.closeFrontierRecordsApp()
        continue
      }
      if (step.kind === 'gameClear') {
        activeRunner.closeGameClear()
        continue
      }
      if (step.kind === 'alphPuzzle') {
        activeRunner.finishAlphPuzzle(true)
        continue
      }
      if (step.kind === 'alphHiddenRoom') {
        activeRunner.closeAlphHiddenRoom()
        continue
      }
      if (step.kind === 'cameraTarget') continue
      if (step.kind === 'screenShake') continue
      if (step.kind === 'number' || step.kind === 'music' || step.kind === 'soundEffect' || step.kind === 'cry' || step.kind === 'fanfare' || step.kind === 'followerInteraction' || step.kind === 'screenFade') return
    }
    if (activeRunner) throw new Error('Le simulateur d’inputs a depasse 1024 etapes pour un seul input.')
  }

  const handleMove = (input: Exclude<FieldInput, 'confirm'>, events: FieldSimulationEvent[]): void => {
    if (activeRunner || preparedWildEncounter) return
    if (runMapFrameScripts(events)) return
    if (startTrainerSightEncounter(events)) return
    const movement = directionInputs[input]
    const previousMapId = world.getState()?.map.id
    const result: WorldMoveResult | undefined = world.tryMove(movement.x, movement.z, movement.direction)
    if (!result) return
    syncObjectMovements(result)
    if (result.kind === 'blocked') {
      append(events, { kind: 'blocked', reason: result.reason, tileX: result.tileX, tileZ: result.tileZ, attribute: result.attribute })
      return
    }
    const activation = result.warpActivation
    if (result.warp && activation && (activation.trigger === 'facing-door' || activation.trigger === 'current-held')) {
      transition(result.warp.header, 'transition', events, result.warp.anchor, activation.direction)
    } else {
      append(events, { kind: 'moved', mapId: result.state.map.id, tileX: result.state.tileX, tileZ: result.state.tileZ })
      if (result.state.map.id !== previousMapId) {
        if (state.pokemonRuntime) updateHgssRoamersForMapTransition(state.roamers, result.state.map.id, state.pokemonRuntime.rng)
        encounterSession?.reset(result.state.direction)
        activateMap(result.state.map, 'transition')
      } else if (runMapFrameScripts(events) || startTrainerSightEncounter(events)) return
      if (result.coordinate) startScript(result.state.map, result.coordinate.scriptId)
      else if (result.warp && activation?.trigger === 'completed-step') {
        transition(result.warp.header, 'transition', events, result.warp.anchor, activation.direction)
      } else if (!activeRunner && result.state.map.id === previousMapId) {
        if (checkWildEncounter(events)) return
        if (result.warp && activation?.trigger === 'completed-step-held') {
          transition(result.warp.header, 'transition', events, result.warp.anchor, activation.direction)
        }
      }
    }
    if (activeRunner) advance(events, true)
    runPendingMapFrameScripts(events)
  }

  const bootEvents: FieldSimulationEvent[] = []
  activateMap(initial.map, 'load')
  if (activeRunner) advance(bootEvents, true)
  runPendingMapFrameScripts(bootEvents)

  return {
    input(input): FieldSimulationEvent[] {
      const events: FieldSimulationEvent[] = []
      if (input !== 'confirm') {
        if (pendingChoice) {
          const delta = input === 'up' || input === 'left' ? -1 : 1
          choiceIndex = (choiceIndex + delta + pendingChoice.options.length) % pendingChoice.options.length
          append(events, { kind: 'choiceCursor', index: choiceIndex })
          return events
        }
        handleMove(input, events)
        return events
      }
      if (pendingChoice && activeRunner) {
        const choice = pendingChoice.options[choiceIndex]
        if (!choice) throw new Error('Choix ROM vide dans le simulateur d’inputs.')
        activeRunner.choose(choice.value)
        pendingChoice = undefined
        advance(events, true)
        return events
      }
      if (waitingForInput) {
        waitingForInput = false
        advance(events, true)
        return events
      }
      if (activeRunner) return events
      if (runMapFrameScripts(events)) return events
      const target = world.interact()
      if (!target || target.kind === 'follower') return events
      const map = world.getState()?.map
      if (!map) return events
      startScript(map, target.scriptId, target.kind === 'npc' ? target.id : undefined)
      advance(events, true)
      return events
    },
    settle(): FieldSimulationEvent[] {
      const events: FieldSimulationEvent[] = []
      if (activeRunner && !waitingForInput && !waitingForBattle && !pendingChoice) advance(events, true)
      return events
    },
    getWorld: () => world,
    getFieldState: () => state,
    getChoiceIndex: () => pendingChoice ? choiceIndex : undefined,
    isWaitingForInput: () => waitingForInput,
    isWaitingForBattle: () => waitingForBattle || preparedWildEncounter !== undefined,
    submitBattleResult(won): FieldSimulationEvent[] {
      if (!activeRunner || !waitingForBattle) throw new Error('Aucun combat de script HGSS n’attend de résultat.')
      const resumedRunner = activeRunner
      resumedRunner.submitBattleResult(won)
      if (won) for (const trainerId of pendingTrainerBattleIds) wonTrainerBattleIds.add(trainerId)
      pendingTrainerBattleIds = []
      waitingForBattle = false
      const map = world.getState()?.map
      activeRunner = map
        ? createFieldScriptMapInitSequenceRunner(map, state, 'load', resumedRunner, ...fieldScriptRuntimeParameters) ?? resumedRunner
        : resumedRunner
      const events: FieldSimulationEvent[] = []
      advance(events, true)
      return events
    },
    submitWildEncounterResult(result): FieldSimulationEvent[] {
      const prepared = preparedWildEncounter
      if (!prepared) throw new Error('Aucune rencontre sauvage HGSS n’attend de résultat.')
      const worldState = world.getState()
      const runtime = state.pokemonRuntime
      if (prepared.encounter.method === 'roamer') {
        if (!worldState || !runtime) throw new Error('Le contexte terrain du Pokémon fuyard HGSS est absent.')
        applyHgssRoamerBattleResult(
          state.roamers,
          prepared.encounter.roamerId,
          prepared.pokemon,
          result,
          worldState.map.id,
          runtime.rng,
        )
      }
      preparedWildEncounter = undefined
      if (worldState) encounterSession?.reset(worldState.direction)
      const events: FieldSimulationEvent[] = []
      append(events, {
        kind: 'wildEncounterResolved',
        result,
        method: prepared.encounter.method,
        speciesId: prepared.encounter.speciesId,
      })
      return events
    },
    hasActiveScript: () => activeRunner !== undefined,
    getPreparedWildEncounter: () => preparedWildEncounter,
    hasWonTrainerBattle: (trainerId) => wonTrainerBattleIds.has(trainerId),
    getWonTrainerBattleIds: () => [...wonTrainerBattleIds].sort((left, right) => left - right),
    getHistory: () => history,
  }
}
