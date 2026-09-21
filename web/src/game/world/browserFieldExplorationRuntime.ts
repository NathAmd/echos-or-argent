import type { RomAudioRuntime } from '../../audio/romAudioRuntime'
import { playRomPresentationWithSoundEffect, startRomSoundEffect } from '../../audio/romAudioPresentation'
import type { Movement } from '../../input/movementInput'
import type { MapRuntime } from '../../mapRuntimeTypes'
import type { OpeningMapPreview, PlayerDirection, RomInventory } from '../../ndsTypes'
import { resolveDoorSoundSequence } from '../../rom/maps/doorTransition'
import { resolveMapFrameScripts, resolveMapInitScripts, type MapInitPhase } from '../../rom/scripts/fieldScripts'
import type { HgssFieldEncounterSession } from '../encounters/wildEncounterSelection'
import { decodeHgssPlayerDirection } from '../player/playerDirection'
import { getFieldMoveAvailability, hgssFieldMoveIds } from '../player/hgssPlayerMovement'
import { resolvePokemonFollowerSelection } from '../pokemon/followerSelection'
import { getVisitedPokegearFlypointFlags } from '../pokegear/pokegearNativeState'
import { playHgssFieldMusic } from '../pokegear/hgssRadio'
import { HGSS_SAFARI_MAP_ID } from '../safari/hgssSafariMap'
import { resolveHgssSafariMetatileInteractionScript } from '../safari/hgssSafariFieldCommands'
import {
  releaseFieldScriptExecutionState,
  setFieldScriptMapState,
  syncFieldScriptFollowerActivity,
  type FieldScriptRunner,
  type FieldScriptState,
} from '../scripts/fieldScriptRunner'
import { getAzaleaGymSpiderNodes, getAzaleaGymSwitchState, repairAzaleaGymData } from '../scripts/azaleaGymMechanism'
import { hgssVBlanksToMilliseconds } from '../time/hgssFrameTiming'
import type { BrowserFieldObjectMotionRuntime } from './browserFieldObjectMotionRuntime'
import { getMapOrigin } from './mapCoordinates'
import type { HgssWarpActivation } from './hgssWarpActivation'
import { playHgssWarpTransitionWithRuntime } from './hgssWarpTransitionCoordinator'
import type {
  AuthoritativePlayerTransitionResult,
  WorldMoveResult,
  WorldSession,
  WorldTransitionResult,
} from './worldSession'

export type BrowserFieldMapArrival = Readonly<{
  fromTileX: number
  fromTileZ: number
  door?: NonNullable<Extract<WorldTransitionResult, { kind: 'transitioned' }>['arrival']>['door']
}>

export type BrowserFieldPendingWarpTarget = Readonly<{
  header: number
  anchor: number
  activation: HgssWarpActivation
}>

export type BrowserAuthoritativeTransitionPresentation = Readonly<{
  kind: 'warp' | 'map-boundary'
  destinationArrival?: BrowserFieldMapArrival
}>

type BrowserFieldExplorationGymPort = Readonly<{
  sync: (map: OpeningMapPreview, state: FieldScriptState, inventory?: RomInventory) => void
  tryInteract: (state: FieldScriptState, world?: WorldSession) => boolean
}>

type BrowserFieldExplorationDynamicWorldPort = Readonly<{
  refresh: () => void
  syncCurrentMap: () => void
  tryInteract: (actorId: string) => boolean
}>

type BrowserFieldExplorationScriptPort = Readonly<{
  readActive: () => FieldScriptRunner | undefined
  writeActive: (runner: FieldScriptRunner | undefined) => void
  has: (map: OpeningMapPreview, scriptId: number) => boolean
  create: (map: OpeningMapPreview, scriptId: number, actorId?: number) => FieldScriptRunner
  sequence: (runners: readonly FieldScriptRunner[]) => FieldScriptRunner
  advance: () => void
}>

export type BrowserFieldSharedScriptRequest = Readonly<{
  map: OpeningMapPreview
  scriptId: number
  source:
    | Readonly<{ kind: 'object', objectId: number }>
    | Readonly<{ kind: 'coordinate', x: number, z: number }>
  actorId?: number
}>

export type BrowserFieldExplorationRuntimeOptions = Readonly<{
  runtime: MapRuntime
  context: Readonly<{
    readFieldState: () => FieldScriptState
    readInventory: () => RomInventory | undefined
    readWorld: () => WorldSession | undefined
    readAudio: () => RomAudioRuntime | undefined
    readPlayerTextureStatus: () => string
  }>
  campaign: Readonly<{
    isLocked: () => boolean
    tryStartSharedScript?: (request: BrowserFieldSharedScriptRequest) => Promise<FieldScriptRunner | undefined>
  }>
  script: BrowserFieldExplorationScriptPort
  field: Readonly<{
    applyPlayerSkin: () => void
    syncPlayerStateFromWorld: () => void
    resetScriptEffects: () => void
    discardPendingStep: () => void
    clearMovementInput: () => void
    startMovement: (movement: Movement) => void
    closeDialogue: () => void
    recoverScriptFailure: () => void
    resetPcEntry: () => void
    resetPhoneRing: () => void
    setEncounterSession: (session: HgssFieldEncounterSession | undefined) => void
    createEncounterSession: (
      inventory: RomInventory,
      state: FieldScriptState,
      direction: PlayerDirection,
    ) => HgssFieldEncounterSession | undefined
    clearPreparedEncounter: () => void
    clearActiveBattleRoamer: () => void
    syncEnvironment: (force?: boolean) => void
    setPresentationMap: (map: OpeningMapPreview | undefined) => void
    onAuthoritativePresentationFailure: (error: Error) => void
    syncGym: BrowserFieldExplorationGymPort['sync']
    refreshDynamicActors: () => void
    syncDynamicWorld: BrowserFieldExplorationDynamicWorldPort['syncCurrentMap']
    tryDynamicWorldInteraction: BrowserFieldExplorationDynamicWorldPort['tryInteract']
    objectMotion: Pick<BrowserFieldObjectMotionRuntime, 'invalidate' | 'reset'>
  }>
  ui: Readonly<{
    closeTransientApplications: () => void
    closeMenu: () => void
    refreshMenu: () => void
    requestConfirmation: (message: string, confirm: () => void) => void
    setStatus: (message: string) => void
    setPositionStatus: (message: string) => void
    resetFade: (reveal: boolean) => void
    fadeScreen: (phase: 'out' | 'in', frames: number, color: number) => void
  }>
  lifecycle: Readonly<{
    persist: (kind?: 'auto', explicitFieldSave?: boolean) => boolean
    scheduleAutosave: () => void
  }>
  gym: BrowserFieldExplorationGymPort
  timing?: Readonly<{
    wait: (milliseconds: number) => Promise<void>
    waitForPlayerMovement: () => Promise<void>
  }>
}>

export type BrowserFieldExplorationRuntime = Readonly<{
  loadMap: (
    map: OpeningMapPreview,
    initPhase?: MapInitPhase,
    arrival?: BrowserFieldMapArrival,
    preserveSavedFieldState?: boolean,
    interruptedScript?: FieldScriptRunner,
    createCheckpoint?: boolean,
  ) => void
  refreshSafariMapVariant: () => void
  placePlayer: (animate?: boolean, durationFrames?: number) => void
  syncFollowerPresentation: (
    animate?: boolean,
    preserveActiveMovement?: boolean,
    durationFrames?: number,
  ) => void
  tryOfferSurf: (preferredPartySlot?: number) => boolean
  interact: () => void
  startFieldScript: (map: OpeningMapPreview, scriptId: number, actorId?: number) => void
  tryStartMapFrameScript: () => boolean
  runDoorTransition: (
    door: NonNullable<Extract<WorldMoveResult, { kind: 'moved' }>['door']>,
    warp: NonNullable<Extract<WorldMoveResult, { kind: 'moved' }>['warp']>,
    activation: HgssWarpActivation,
  ) => Promise<void>
  runWarpTransition: (target: BrowserFieldPendingWarpTarget) => Promise<void>
  presentAuthoritativeTransition: (
    result: AuthoritativePlayerTransitionResult,
    presentation: BrowserAuthoritativeTransitionPresentation,
  ) => void
  activatePresentedMap: () => Promise<boolean>
  activatePresentedMapImmediately: () => boolean
  isTransitionActive: () => boolean
  cancelTransition: () => void
  getMapLoadRevision: () => number
  snapshotTransientState: () => Readonly<{ renderedSafariZone?: FieldScriptState['safariZone'] }>
  restoreTransientState: (snapshot: Readonly<{ renderedSafariZone?: FieldScriptState['safariZone'] }>) => void
}>

const ambientDirectionDelta: Readonly<Record<PlayerDirection, readonly [number, number]>> = {
  north: [0, -1],
  east: [1, 0],
  south: [0, 1],
  west: [-1, 0],
}

const defaultTiming = Object.freeze({
  wait: (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds)),
  waitForPlayerMovement: async () => {},
})

/**
 * Frontière navigateur du terrain local. Le mode de présentation autoritaire
 * charge uniquement la scène et ses acteurs visuels : l'état persistant, les
 * scripts init, les checkpoints et la progression restent intacts jusqu'à la
 * libération du verrou Coop.
 */
export function createBrowserFieldExplorationRuntime(
  options: BrowserFieldExplorationRuntimeOptions,
): BrowserFieldExplorationRuntime {
  const timing = options.timing ?? {
    ...defaultTiming,
    waitForPlayerMovement: async () => {
      while (options.runtime.isPlayerMoving()) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      }
    },
  }
  let renderedSafariZone: FieldScriptState['safariZone'] | undefined
  let mapLoadRevision = 0
  let transitionActive = false
  let transitionGeneration = 0
  let sharedScriptRequestInFlight = false
  let pendingAuthoritativePresentation: Readonly<{
    generation: number
    map: OpeningMapPreview
    task: Promise<void>
  }> | undefined

  const readState = (): FieldScriptState => options.context.readFieldState()
  const readWorld = (): WorldSession | undefined => options.context.readWorld()

  const mapSceneResources = (inventory: RomInventory | undefined) => inventory && ({
    eventTexturePreviews: inventory.eventTexturePreviews,
    eventTextureFrames: inventory.eventTextureFrames,
    fieldTextureAnimations: inventory.fieldTextureAnimations,
    fieldCameraParams: inventory.fieldCameraParams,
    eventTextureResolver: inventory.eventTextureResolver,
    mapPropModelResolver: inventory.mapPropModelResolver,
    grassEffectResolver: inventory.grassEffectResolver,
    mapPropAnimationResolver: inventory.mapPropAnimationResolver,
    mapPropAnimationMetadataResolver: inventory.mapPropAnimationMetadataResolver,
  })

  const renderWorldMap = (map: OpeningMapPreview, state = readState()): void => {
    const inventory = options.context.readInventory()
    options.runtime.loadMap(map, state, mapSceneResources(inventory))
    mapLoadRevision += 1
    options.field.refreshDynamicActors()
  }

  const syncMapStateFromWorld = (): void => {
    const world = readWorld()?.getState()
    if (!world) return
    const origin = getMapOrigin(world.map)
    setFieldScriptMapState(
      readState(),
      world.map,
      origin.x + world.tileX,
      origin.z + world.tileZ,
      world.direction,
    )
  }

  const syncFollowerPresentation = (
    animate = false,
    preserveActiveMovement = false,
    durationFrames = 8,
  ): void => {
    const world = readWorld()?.getState()
    const session = readWorld()
    const inventory = options.context.readInventory()
    if (!world || !session || !inventory) {
      options.runtime.setFollowerTexture(undefined)
      options.runtime.setFollowerPosition(undefined)
      return
    }
    const state = readState()
    syncFieldScriptFollowerActivity(state, world.map)
    const selection = resolvePokemonFollowerSelection(
      state.party,
      { id: world.map.id, followMode: world.map.header.followMode },
      inventory.pokemonCatalog.followers,
    )
    const visible = state.followMonActive && selection?.visible === true && world.locomotion === 'walking'
    session.setFollowerEnabled(visible)
    const resource = visible
      ? inventory.followerTextureResolver?.(selection.parameterIndex, selection.pokemon.shiny)
      : undefined
    options.runtime.setFollowerTexture(resource)
    if (!visible || !preserveActiveMovement || !options.runtime.isFollowerMoving()) {
      options.runtime.setFollowerPosition(session.getFollowerState(), animate, durationFrames)
    }
    options.runtime.setFollowerMovementPaused(state.followMonMovementPaused)
  }

  const placePlayer = (animate = false, durationFrames = 8): void => {
    const state = readWorld()?.getState()
    if (!state) return
    options.ui.setPositionStatus(options.runtime.setPlayerPosition(
      state.tileX,
      state.tileZ,
      state.direction,
      animate,
      state.groundHeight,
      durationFrames,
    ))
    syncFollowerPresentation(animate, false, durationFrames)
  }

  const cancelAuthoritativePresentation = (): void => {
    transitionGeneration += 1
    pendingAuthoritativePresentation = undefined
    options.field.setPresentationMap(undefined)
  }

  const loadMapInternal = (
    map: OpeningMapPreview,
    initPhase: MapInitPhase = 'load',
    arrival?: BrowserFieldMapArrival,
    preserveSavedFieldState = false,
    interruptedScript?: FieldScriptRunner,
    createCheckpoint = true,
  ): void => {
    options.ui.closeTransientApplications()
    const state = readState()
    const inventory = options.context.readInventory()
    if (!state.pokegear.visitedMapIds.includes(map.id)) state.pokegear.visitedMapIds.push(map.id)
    if (inventory) {
      for (const flag of getVisitedPokegearFlypointFlags(
        map,
        inventory.resolvedMapCatalog.maps,
        inventory.pokegearMapData.flypoints,
      )) state.flags.add(flag)
    }
    if (initPhase === 'transition') state.radioMusicSequenceId = 0
    if (!interruptedScript) {
      releaseFieldScriptExecutionState(state)
      options.runtime.setFollowerMovementPaused(false)
    }
    options.field.closeDialogue()
    options.field.applyPlayerSkin()
    options.field.resetScriptEffects()
    options.field.discardPendingStep()
    options.field.objectMotion.invalidate()
    options.field.clearPreparedEncounter()
    options.field.clearActiveBattleRoamer()
    if (!preserveSavedFieldState) syncMapStateFromWorld()
    if (!preserveSavedFieldState) {
      const blackoutSpawn = inventory?.blackoutSpawnForMapResolver(map.id)
      if (blackoutSpawn !== undefined) state.blackoutSpawn = blackoutSpawn
      state.hiddenObjectIds.clear()
      state.invisibleObjectIds.clear()
    }
    const pokemonRuntime = state.pokemonRuntime
    const worldState = readWorld()?.getState()
    options.field.setEncounterSession(inventory && pokemonRuntime && worldState
      ? options.field.createEncounterSession(inventory, state, worldState.direction)
      : undefined)

    const phases: MapInitPhase[] = initPhase === 'transition'
      ? ['transition', 'load', 'resume']
      : initPhase === 'load' ? ['load', 'resume'] : ['resume']
    const initScriptIds = phases.flatMap((phase) => resolveMapInitScripts(map.initScripts, phase))
    const initRunner = initScriptIds.length > 0
      ? options.script.sequence(initScriptIds.map((scriptId) => options.script.create(map, scriptId)))
      : undefined

    renderWorldMap(map)
    renderedSafariZone = map.id === HGSS_SAFARI_MAP_ID ? state.safariZone : undefined
    options.field.objectMotion.reset()
    options.field.syncEnvironment(true)
    if (arrival) {
      options.runtime.setPlayerPosition(arrival.fromTileX, arrival.fromTileZ, 'south', false)
      if (arrival.door) options.runtime.setFollowerPosition(undefined)
      else placePlayer(true)
    } else placePlayer()
    options.gym.sync(map, state, inventory)
    options.field.syncDynamicWorld()
    if (map.id === 180
      && state.gymmick.type === 5
      && inventory?.mapPropModelResolver
      && inventory.mapPropAnimationResolver
      && inventory.mapPropAnimationMetadataResolver) {
      repairAzaleaGymData(state.gymmick.data)
      options.runtime.syncAzaleaGymMechanism(
        getAzaleaGymSpiderNodes(state.gymmick.data),
        getAzaleaGymSwitchState(state.gymmick.data),
        inventory.mapPropModelResolver,
        inventory.mapPropAnimationResolver,
        inventory.mapPropAnimationMetadataResolver,
      )
    }
    options.runtime.renderFrame()
    options.ui.resetFade(!interruptedScript)
    const runners = [initRunner, interruptedScript]
      .filter((runner): runner is FieldScriptRunner => Boolean(runner))
    if (createCheckpoint && !interruptedScript) options.lifecycle.persist('auto')
    void playHgssFieldMusic(options.context.readAudio(), map, state.radioMusicSequenceId)?.catch(() => undefined)
    if (runners.length > 0) {
      options.ui.closeMenu()
      options.script.writeActive(runners.length === 1 ? runners[0] : options.script.sequence(runners))
      options.ui.refreshMenu()
      options.script.advance()
    } else if (createCheckpoint) options.lifecycle.scheduleAutosave()

    const hasRenderableRomScene = Boolean(map.model?.positions?.length)
    const hasDirectRomTextures = Boolean(
      map.model?.textures?.length
      && map.model?.surfaces?.some((surface) => surface.textureId && surface.uvs && surface.uvs.length > 0),
    )
    const sceneStatus = !hasRenderableRomScene
      ? `${map.label} : aucune scene ROM affichable`
      : hasDirectRomTextures
        ? `${map.label} : rendu ROM texture direct`
        : `${map.label} : geometrie ROM directe`
    options.ui.setStatus(`${sceneStatus} - ${options.context.readPlayerTextureStatus()}`)
  }

  const loadMap: BrowserFieldExplorationRuntime['loadMap'] = (...parameters): void => {
    cancelAuthoritativePresentation()
    loadMapInternal(...parameters)
  }

  const refreshSafariMapVariant = (): void => {
    const world = readWorld()?.getState()
    const state = readState()
    if (!world || world.map.id !== HGSS_SAFARI_MAP_ID || renderedSafariZone === state.safariZone) return
    const refreshed = readWorld()?.refreshMapVariant()
    if (!refreshed) return
    renderedSafariZone = state.safariZone
    renderWorldMap(refreshed.map)
    options.runtime.syncEventVisibility(state)
    placePlayer()
    options.field.syncEnvironment(true)
    options.runtime.renderFrame()
  }

  const startFieldScript = (map: OpeningMapPreview, scriptId: number, actorId?: number): void => {
    if (options.campaign.isLocked()) return
    if (!options.script.has(map, scriptId)) return
    options.field.resetPhoneRing()
    options.field.resetPcEntry()
    try {
      options.field.syncPlayerStateFromWorld()
      const runner = options.script.create(map, scriptId, actorId)
      options.ui.closeMenu()
      options.script.writeActive(runner)
      options.ui.refreshMenu()
      options.script.advance()
    } catch (error) {
      options.ui.setStatus(error instanceof Error ? error.message : 'Le script ROM ne peut pas etre execute.')
      options.field.recoverScriptFailure()
      options.field.closeDialogue()
    }
  }

  const tryStartMapFrameScript = (): boolean => {
    if (options.campaign.isLocked() || options.script.readActive()) return false
    const map = readWorld()?.getState()?.map
    if (!map) return false
    const state = readState()
    const scriptIds = resolveMapFrameScripts(map.initScripts, (variable) => state.variables.get(variable) ?? 0)
    if (scriptIds.length === 0) return false
    options.field.resetPhoneRing()
    const before = readWorld()?.getState()
    options.script.writeActive(options.script.sequence(
      scriptIds.map((scriptId) => options.script.create(map, scriptId)),
    ))
    options.script.advance()
    const after = readWorld()?.getState()
    return options.script.readActive() !== undefined
      || before?.map.id !== after?.map.id
      || before?.tileX !== after?.tileX
      || before?.tileZ !== after?.tileZ
  }

  const tryOfferSurf = (preferredPartySlot?: number): boolean => {
    const world = readWorld()?.getState()
    const session = readWorld()
    const state = readState()
    if (!world || !session || world.locomotion !== 'walking' || !session.isFacingSurfableSurface()) return false
    const availability = getFieldMoveAvailability('surf', state.badges, state.party.members)
    if (!availability.available) {
      options.ui.setStatus(availability.reason === 'badge'
        ? 'Le Badge Brume est requis pour utiliser Surf hors combat.'
        : 'Aucun Pokémon apte à utiliser Surf ne se trouve dans l’équipe.')
      return true
    }
    const partySlot = preferredPartySlot !== undefined
      && state.party.members[preferredPartySlot]?.moves.some((move) => move.moveId === hgssFieldMoveIds.surf)
      ? preferredPartySlot
      : availability.partySlot
    const messages = world.map.standardScriptBanks?.find((bank) => bank.baseScriptId === 10000)?.messages
    const prompt = messages?.[14]?.replace(/\{[^}]*\}/g, '').trim()
    if (!prompt) throw new Error('Le message ROM français de confirmation de Surf est absent.')
    options.field.resetPhoneRing()
    options.ui.requestConfirmation(prompt, () => {
      const current = readWorld()?.getState()
      const pokemon = readState().party.members[partySlot]
      const currentSession = readWorld()
      if (!current || !pokemon || !currentSession) return
      currentSession.setLocomotion('surfing')
      options.field.applyPlayerSkin()
      syncFollowerPresentation(false)
      const delta = ambientDirectionDelta[current.direction]
      options.ui.setStatus((messages?.[15] ?? '')
        .replace(/\{[^}]*\}/g, pokemon.nickname ?? pokemon.speciesName)
        .trim())
      options.field.startMovement({ x: delta[0], z: delta[1], direction: current.direction })
    })
    return true
  }

  const interact = (): void => {
    if (options.script.readActive()) {
      options.script.advance()
      return
    }
    if (options.campaign.isLocked()) {
      const tryStartSharedScript = options.campaign.tryStartSharedScript
      if (!tryStartSharedScript || sharedScriptRequestInFlight) return
      const resolution = readWorld()?.resolveInteraction()
      const target = resolution?.event
      if (!resolution || (target?.kind !== 'npc' && target?.kind !== 'background' && target?.kind !== 'metatile')) return
      const request: BrowserFieldSharedScriptRequest = Object.freeze({
        map: resolution.map,
        scriptId: target.scriptId,
        source: target.kind === 'npc'
          ? Object.freeze({ kind: 'object' as const, objectId: target.id })
          : Object.freeze({ kind: 'coordinate' as const, x: resolution.worldX, z: resolution.worldZ }),
        ...(target.kind === 'npc' ? { actorId: target.id } : {}),
      })
      sharedScriptRequestInFlight = true
      void Promise.resolve()
        .then(() => tryStartSharedScript(request))
        .then((runner) => {
          if (!runner || !options.campaign.isLocked() || options.script.readActive()) return
          options.field.resetPhoneRing()
          options.field.resetPcEntry()
          options.ui.closeMenu()
          options.script.writeActive(runner)
          options.ui.refreshMenu()
          options.script.advance()
        })
        .catch((error: unknown) => {
          options.ui.setStatus(error instanceof Error
            ? error.message
            : 'Le script partagé ne peut pas être exécuté.')
          options.field.recoverScriptFailure()
          options.field.closeDialogue()
        })
        .finally(() => { sharedScriptRequestInFlight = false })
      return
    }
    if (tryStartMapFrameScript()) return
    const state = readState()
    const session = readWorld()
    if (options.gym.tryInteract(state, session)) {
      options.field.resetPhoneRing()
      return
    }
    const dynamicActor = session?.findDynamicActorInteraction()
    if (dynamicActor && options.field.tryDynamicWorldInteraction(dynamicActor.id)) return
    const resolution = session?.resolveInteraction()
    const target = resolution?.event
    if (target?.kind === 'follower') {
      const map = resolution?.map
      if (map) startFieldScript(map, 9700)
      return
    }
    if (!target && tryOfferSurf()) return
    if (!target) {
      const world = session?.getState()
      if (world) {
        const origin = getMapOrigin(world.map)
        const scriptId = resolveHgssSafariMetatileInteractionScript(
          world.map,
          state.safariZone,
          {
            x: origin.x + world.tileX,
            z: origin.z + world.tileZ,
            direction: world.direction,
            groundHeight: world.groundHeight,
            state: world.locomotion === 'surfing' ? 2 : world.locomotion === 'cycling' ? 1 : 0,
          },
        )
        if (scriptId !== undefined) {
          startFieldScript(world.map, scriptId)
          return
        }
      }
    }
    if (target?.kind !== 'npc' && target?.kind !== 'background' && target?.kind !== 'metatile') {
      options.ui.setStatus('Aucun événement source à proximité.')
      return
    }
    const map = resolution?.map
    if (map) startFieldScript(map, target.scriptId, target.kind === 'npc' ? target.id : undefined)
  }

  const transitionTo = async (mapId: number, anchor?: number, direction?: PlayerDirection): Promise<boolean> => {
    if (options.campaign.isLocked()) return false
    const result = readWorld()?.transitionTo(mapId, anchor, direction)
    if (!result || result.kind === 'missing-map') {
      options.ui.setStatus(`Warp source détecté : destination carte ${mapId}. Cette zone n’est pas encore chargée.`)
      return false
    }
    if (result.kind === 'missing-anchor') {
      options.ui.setStatus(`Transition vers ${result.map.label} détectée, mais son ancre d’entrée n’est pas validée.`)
      return false
    }
    options.field.resetPhoneRing()
    options.field.clearMovementInput()
    loadMap(result.state.map, 'transition', result.arrival)
    if (!result.arrival?.door) return false
    try {
      await runDoorArrival(result.arrival)
    } catch (error) {
      placePlayer()
      options.ui.setStatus(error instanceof Error
        ? `Sortie de porte interrompue : ${error.message}`
        : 'Sortie de porte ROM interrompue.')
    }
    return true
  }

  const runDoorTransition: BrowserFieldExplorationRuntime['runDoorTransition'] = async (
    door,
    warp,
    activation,
  ): Promise<void> => {
    if (options.campaign.isLocked()) return
    const resolver = options.context.readInventory()?.mapPropAnimationResolver
    const state = readWorld()?.getState()
    if (!resolver || !state) throw new Error('Ressources ROM de transition de porte indisponibles.')
    transitionActive = true
    options.field.clearMovementInput()
    options.runtime.setFollowerPosition(undefined)
    options.ui.closeMenu()
    try {
      await playRomPresentationWithSoundEffect(
        () => options.runtime.playDoorAnimation(door, 0, resolver),
        options.context.readAudio(),
        resolveDoorSoundSequence(door.classId, true),
      )
      options.ui.setPositionStatus(options.runtime.setPlayerPosition(
        state.tileX,
        state.tileZ - 1,
        'north',
        true,
        state.groundHeight,
      ))
      await timing.waitForPlayerMovement()
      await playRomPresentationWithSoundEffect(
        () => options.runtime.playDoorAnimation(door, 1, resolver),
        options.context.readAudio(),
        resolveDoorSoundSequence(door.classId, false),
      )
      await transitionTo(warp.header, warp.anchor, activation.direction)
    } finally {
      transitionActive = false
      options.ui.refreshMenu()
    }
  }

  async function runDoorArrival(arrival: BrowserFieldMapArrival): Promise<void> {
    if (options.campaign.isLocked()) return
    const resolver = options.context.readInventory()?.mapPropAnimationResolver
    const state = readWorld()?.getState()
    const door = arrival.door
    if (!resolver || !state || !door) throw new Error('Ressources ROM de sortie de porte indisponibles.')
    const ownsTransitionLock = !transitionActive
    transitionActive = true
    options.field.clearMovementInput()
    options.ui.closeMenu()
    try {
      await playRomPresentationWithSoundEffect(
        () => options.runtime.playDoorAnimation(door, 0, resolver),
        options.context.readAudio(),
        resolveDoorSoundSequence(door.classId, true),
      )
      options.ui.setPositionStatus(options.runtime.setPlayerPosition(
        state.tileX,
        state.tileZ,
        state.direction,
        true,
        state.groundHeight,
      ))
      await timing.waitForPlayerMovement()
      readWorld()?.completeDoorArrival()
      syncFollowerPresentation(false)
      await playRomPresentationWithSoundEffect(
        () => options.runtime.playDoorAnimation(door, 1, resolver),
        options.context.readAudio(),
        resolveDoorSoundSequence(door.classId, false),
      )
      options.lifecycle.persist()
    } finally {
      if (ownsTransitionLock) transitionActive = false
      options.ui.refreshMenu()
    }
  }

  const runWarpTransition = async (target: BrowserFieldPendingWarpTarget): Promise<void> => {
    if (options.campaign.isLocked()) return
    const world = readWorld()
    const state = world?.getState()
    if (!state || !world) return
    transitionActive = true
    options.field.clearMovementInput()
    options.runtime.setFollowerPosition(undefined)
    options.ui.closeMenu()
    try {
      await playHgssWarpTransitionWithRuntime({
        activation: target.activation,
        anchor: target.anchor,
        source: state,
        runtime: options.runtime,
        world,
        destination: options.context.readInventory()?.resolvedMapCatalog.maps
          .find((map) => map.id === target.header),
        getMapLoadRevision: () => mapLoadRevision,
        playSoundEffect: (sequenceId) => { startRomSoundEffect(options.context.readAudio(), sequenceId) },
        stopSoundEffect: (sequenceId) => { options.context.readAudio()?.stopSoundEffect(sequenceId) },
        fadeScreen: (phase, frames, color) => { options.ui.fadeScreen(phase, frames, color) },
        transition: () => transitionTo(target.header, target.anchor, target.activation.direction),
      })
    } catch (error) {
      options.ui.setStatus(error instanceof Error
        ? `Transition ROM interrompue : ${error.message}`
        : 'Transition ROM interrompue.')
    } finally {
      transitionActive = false
      syncFollowerPresentation(false)
      options.ui.refreshMenu()
    }
  }

  const createPresentationState = (map: OpeningMapPreview): FieldScriptState => {
    const state = readState()
    const world = readWorld()?.getState()
    const origin = getMapOrigin(map)
    return {
      ...state,
      previousMapId: state.currentMapId,
      currentMapId: map.id,
      hiddenObjectIds: new Set(),
      invisibleObjectIds: new Set(),
      player: {
        x: origin.x + (world?.tileX ?? 0),
        z: origin.z + (world?.tileZ ?? 0),
        direction: world?.direction ?? 'south',
        groundHeight: world?.groundHeight,
      },
      objects: new Map((map.events?.objects ?? []).map((object) => [object.id, {
        x: object.x,
        z: object.z,
        direction: decodeHgssPlayerDirection(object.facingDirection),
        movement: object.movement,
      }])),
      mapProps: [],
    }
  }

  const presentAuthoritativeTransition: BrowserFieldExplorationRuntime['presentAuthoritativeTransition'] = (
    result,
    presentation,
  ): void => {
    const generation = ++transitionGeneration
    const map = result.state.map
    transitionActive = true
    options.field.setPresentationMap(map)
    options.field.discardPendingStep()
    const task = (async (): Promise<void> => {
      try {
        options.ui.fadeScreen('out', 4, 0)
        await timing.wait(hgssVBlanksToMilliseconds(4))
        if (generation !== transitionGeneration) return
        renderWorldMap(map, createPresentationState(map))
        options.field.applyPlayerSkin()
        const arrival = presentation.destinationArrival
        if (arrival?.door) {
          options.runtime.setPlayerPosition(arrival.fromTileX, arrival.fromTileZ, 'south', false)
          options.runtime.setFollowerPosition(undefined)
          const resolver = options.context.readInventory()?.mapPropAnimationResolver
          if (resolver) {
            await playRomPresentationWithSoundEffect(
              () => options.runtime.playDoorAnimation(arrival.door!, 0, resolver),
              options.context.readAudio(),
              resolveDoorSoundSequence(arrival.door.classId, true),
            )
          }
        } else {
          options.runtime.setPlayerPosition(
            result.state.tileX,
            result.state.tileZ,
            result.state.direction,
            false,
            result.state.groundHeight,
          )
        }
        if (generation !== transitionGeneration) return
        options.field.syncEnvironment(true)
        void playHgssFieldMusic(
          options.context.readAudio(),
          map,
          readState().radioMusicSequenceId,
        )?.catch(() => undefined)
        options.runtime.renderFrame()
        options.ui.fadeScreen('in', 4, 0)
        if (arrival?.door) {
          options.ui.setPositionStatus(options.runtime.setPlayerPosition(
            result.state.tileX,
            result.state.tileZ,
            result.state.direction,
            true,
            result.state.groundHeight,
          ))
          await timing.waitForPlayerMovement()
          if (generation !== transitionGeneration) return
          const resolver = options.context.readInventory()?.mapPropAnimationResolver
          if (resolver) {
            await playRomPresentationWithSoundEffect(
              () => options.runtime.playDoorAnimation(arrival.door!, 1, resolver),
              options.context.readAudio(),
              resolveDoorSoundSequence(arrival.door.classId, false),
            )
          }
        } else await timing.wait(hgssVBlanksToMilliseconds(4))
      } catch (error) {
        const failure = error instanceof Error ? error : new Error('Présentation Coop interrompue.')
        options.ui.setStatus(`Présentation Coop interrompue : ${failure.message}`)
        if (generation === transitionGeneration) options.field.onAuthoritativePresentationFailure(failure)
      } finally {
        if (generation === transitionGeneration) transitionActive = false
      }
    })()
    pendingAuthoritativePresentation = Object.freeze({ generation, map, task })
  }

  const activatePresentedMap = async (): Promise<boolean> => {
    const pending = pendingAuthoritativePresentation
    if (!pending) return false
    await pending.task
    if (pendingAuthoritativePresentation !== pending || pending.generation !== transitionGeneration) return false
    loadMapInternal(pending.map, 'transition')
    pendingAuthoritativePresentation = undefined
    options.field.setPresentationMap(undefined)
    options.field.syncEnvironment(true)
    return true
  }

  const activatePresentedMapImmediately = (): boolean => {
    const pending = pendingAuthoritativePresentation
    if (!pending) return false
    transitionGeneration += 1
    transitionActive = false
    loadMapInternal(pending.map, 'transition', undefined, false, undefined, false)
    pendingAuthoritativePresentation = undefined
    options.field.setPresentationMap(undefined)
    options.field.syncEnvironment(true)
    return true
  }

  return Object.freeze({
    loadMap,
    refreshSafariMapVariant,
    placePlayer,
    syncFollowerPresentation,
    tryOfferSurf,
    interact,
    startFieldScript,
    tryStartMapFrameScript,
    runDoorTransition,
    runWarpTransition,
    presentAuthoritativeTransition,
    activatePresentedMap,
    activatePresentedMapImmediately,
    isTransitionActive: () => transitionActive,
    cancelTransition: () => {
      transitionGeneration += 1
      transitionActive = false
      pendingAuthoritativePresentation = undefined
      options.field.setPresentationMap(undefined)
    },
    getMapLoadRevision: () => mapLoadRevision,
    snapshotTransientState: () => Object.freeze({
      ...(renderedSafariZone ? { renderedSafariZone } : {}),
    }),
    restoreTransientState: (snapshot) => { renderedSafariZone = snapshot.renderedSafariZone },
  })
}
