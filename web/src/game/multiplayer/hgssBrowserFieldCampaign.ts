import type { PlayerDirection, PlayerGender } from '../../ndsTypes'
import type { GameplayExtensionPortContribution } from '../extensions/composeGameplayExtensionPorts'
import { cloneFieldScriptState, type FieldScriptState } from '../scripts/fieldScriptRunner'
import {
  createDynamicWorldActorRegistry,
  dynamicWorldActorSnapshotVersion,
  type DynamicWorldActor,
  type DynamicWorldActorRegistry,
} from '../world/dynamicWorldActorRegistry'
import {
  createHgssFieldWorldSession,
  type HgssFieldWorldSessionInventory,
} from '../world/hgssFieldWorldSessionFactory'
import type {
  AuthoritativePlayerMoveResult,
  AuthoritativePlayerTransitionResult,
  PlayerTileInspection,
  SavedFollowerWorldState,
  WorldSession,
  WorldSessionExtensionPorts,
} from '../world/worldSession'
import type { BrowserMultiplayerCampaignPort } from './browserMultiplayerCampaignPort'
import type {
  HgssCampaignAuthoritativeService,
  HgssCampaignSharedEventAdmissionPort,
} from './hgssCampaignAuthoritativeService'
import {
  compareHgssSharedCampaignSaveProgression,
  createHgssSharedCampaignSaveExtension,
  type HgssSharedCampaignSaveExtensionV1,
} from '../save/hgssSharedCampaignSaveExtension'
import {
  createHgssBrowserCampaignCoordinator,
  type HgssBrowserCampaignCoordinator,
  type HgssBrowserCampaignState,
} from './hgssBrowserCampaignSession'
import {
  hgssCampaignProtocolVersion,
  type HgssCampaignFieldPosition,
  type HgssCampaignPlayerSnapshot,
  type HgssCampaignServerSnapshot,
  type HgssCampaignSharedProgression,
} from './hgssCampaignProtocol'
import type { HgssCampaignMovementCommand } from './hgssCampaignServerCore'
import type {
  HgssCampaignWorldMovementProbeFactory,
  HgssCampaignWorldTransitionPresentation,
} from './hgssCampaignWorldMovementPort'
import {
  createHgssSharedCampaignProgressionSync,
  type HgssSharedCampaignEventCommit,
} from './hgssSharedCampaignProgressionSync'
import {
  createHgssCampaignWorldMovementPort,
  resolveHgssCampaignWorldMovement,
} from './hgssCampaignWorldMovementPort'

export type HgssBrowserFieldCampaignContext = Readonly<{
  gameCode: string
  gameVersion: number
  language: number
  displayName: string
  gender: PlayerGender
  /** Sprite MapObject effectivement présenté (normal ou costume Rocket). */
  spriteId: number
  world: WorldSession
}>

export type HgssBrowserFieldCampaignMovement = Readonly<{
  deltaX: number
  deltaZ: number
  direction: PlayerDirection
  running: boolean
}>

export type HgssBrowserFieldCampaignOptions = Readonly<{
  readContext: () => HgssBrowserFieldCampaignContext | undefined
  createMovementProbe: HgssCampaignWorldMovementProbeFactory
  /** Autorité serveur partagée injectée par la composition navigateur publiée. */
  authoritativeService?: HgssCampaignAuthoritativeService
  /** Vérification ROM propriétaire des interactions scénario partagées. */
  sharedEventAdmission?: HgssCampaignSharedEventAdmissionPort
  progression?: Readonly<{
    readFieldState: () => FieldScriptState
    readSeed: () => HgssCampaignSharedProgression
    readSavedCampaign: () => HgssSharedCampaignSaveExtensionV1 | undefined
    persistState: (
      state: FieldScriptState,
      campaign: HgssSharedCampaignSaveExtensionV1,
    ) => Promise<void> | void
    publishState: (state: FieldScriptState) => void
  }>
  /** Inspecteur ROM jetable, requis pour admettre proprement une reconnexion inter-cartes. */
  inspectPlayerPosition?: (position: HgssCampaignFieldPosition) => PlayerTileInspection | undefined
  /** Checkpoint complet (position du WorldSession incluse), avant déverrouillage de la campagne. */
  persistAuthoritativePosition?: () => Promise<void> | void
  publishActors?: (actors: readonly DynamicWorldActor[]) => void
  onLocalTurn?: (direction: PlayerDirection) => void
  onLocalStep?: (result: AuthoritativePlayerMoveResult) => void
  onLocalTransition?: (
    result: AuthoritativePlayerTransitionResult,
    presentation: HgssCampaignWorldTransitionPresentation,
  ) => void
  onFieldLockChanged?: (locked: boolean) => void
  onMovementRejected?: (error: Error) => void
  onError?: (error: Error) => void
  bootstrapTimeoutMs?: number
}>

export type HgssBrowserFieldCampaign = Readonly<{
  port: BrowserMultiplayerCampaignPort
  worldSessionExtensionPorts: WorldSessionExtensionPorts
  gameplayContribution: GameplayExtensionPortContribution
  registry: DynamicWorldActorRegistry
  getState: () => HgssBrowserCampaignState
  isFieldLocked: () => boolean
  /** Retourne true lorsque la Coop possède et a consommé cette entrée. */
  consumeMovement: (movement: HgssBrowserFieldCampaignMovement) => boolean
  commitSharedEvent: (
    eventId: string,
    before: FieldScriptState,
    after: FieldScriptState,
  ) => Promise<HgssSharedCampaignEventCommit | undefined>
  /** Draine la progression partagée, puis déverrouille et ferme avant la libération de page. */
  prepareForPageRelease: () => Promise<void>
  close: () => Promise<void>
}>

export type HgssCampaignFieldProbeContext = Readonly<{
  inventory: HgssFieldWorldSessionInventory
  fieldState: FieldScriptState
  playerGender: PlayerGender
  extensionPorts: WorldSessionExtensionPorts
}>

export type HgssCampaignFieldPositionInspector = (
  position: HgssCampaignFieldPosition,
) => PlayerTileInspection | undefined

const cardinalDelta: Readonly<Record<PlayerDirection, readonly [number, number]>> = Object.freeze({
  north: [0, -1],
  south: [0, 1],
  west: [-1, 0],
  east: [1, 0],
})

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error('Le déplacement Coop a échoué.')
}

function savedFollower(world: WorldSession): SavedFollowerWorldState | undefined {
  const follower = world.getFollowerState()
  return follower && {
    tileX: follower.tileX,
    tileZ: follower.tileZ,
    direction: follower.direction,
    ...(follower.movement !== undefined ? { movement: follower.movement } : {}),
  }
}

function remoteActors(
  snapshot: HgssCampaignServerSnapshot,
  localParticipantId: string,
): readonly DynamicWorldActor[] {
  return snapshot.players
    .filter((player) => player.playerId !== localParticipantId && player.state === 'active')
    .map((player) => Object.freeze({
      id: `campaign-player:${player.playerId}`,
      kind: 'remote-player' as const,
      displayName: player.displayName,
      spriteId: player.spriteId,
      mapId: player.position.mapId,
      tileX: player.position.x,
      tileZ: player.position.z,
      direction: player.position.direction,
      collision: 'blocking' as const,
      interaction: 'none' as const,
    }))
}

function localPlayer(
  snapshot: HgssCampaignServerSnapshot,
  localParticipantId: string,
): HgssCampaignPlayerSnapshot | undefined {
  return snapshot.players.find(({ playerId }) => playerId === localParticipantId)
}

/**
 * Produit un WorldSession jetable par commande. Le clone complet est
 * obligatoire : le factory conserve sinon les Set/Map du terrain vivant.
 */
export function createHgssCampaignFieldWorldProbeFactory(
  readContext: () => HgssCampaignFieldProbeContext | undefined,
): HgssCampaignWorldMovementProbeFactory {
  return ({ command }) => {
    const source = readContext()
    if (!source || command.mode !== 'walk' && command.mode !== 'run') return undefined
    const fieldState = cloneFieldScriptState(source.fieldState)
    const probe = createHgssFieldWorldSession({
      inventory: source.inventory,
      readFieldState: () => fieldState,
      readPlayerGender: () => source.playerGender,
      extensionPorts: source.extensionPorts,
    })
    const loaded = probe.loadMap(
      command.from.mapId,
      command.from.x,
      command.from.z,
      command.from.direction,
      'walking',
    )
    if (!loaded) return undefined
    return Object.freeze({
      getState: probe.getState,
      tryMove: probe.tryMove,
      transitionTo: probe.transitionTo,
      isModeAllowed: (mode) => mode === 'walk' || mode === 'run',
    })
  }
}

/** Inspecte une position de bootstrap sur n'importe quelle carte ROM sans charger le monde vivant. */
export function createHgssCampaignFieldPositionInspector(
  readContext: () => HgssCampaignFieldProbeContext | undefined,
): HgssCampaignFieldPositionInspector {
  return (position) => {
    const source = readContext()
    if (!source) return undefined
    const fieldState = cloneFieldScriptState(source.fieldState)
    const probe = createHgssFieldWorldSession({
      inventory: source.inventory,
      readFieldState: () => fieldState,
      readPlayerGender: () => source.playerGender,
      extensionPorts: source.extensionPorts,
    })
    if (!probe.loadMap(position.mapId, position.x, position.z, position.direction, 'walking')) return undefined
    return probe.inspectPlayerTile(position.mapId, position.x, position.z, { locomotion: 'walking' })
  }
}

/**
 * Terrain Coop autoritaire : marche/course, transitions ROM attestées,
 * avatars distants et sortie propre. Scripts, combats, interactions et
 * progression restent volontairement hors de cette frontière.
 */
export function createHgssBrowserFieldCampaign(
  options: HgssBrowserFieldCampaignOptions,
): HgssBrowserFieldCampaign {
  if (typeof options.readContext !== 'function' || typeof options.createMovementProbe !== 'function') {
    throw new TypeError('Les ports terrain de la campagne HGSS sont incomplets.')
  }
  const registry = createDynamicWorldActorRegistry()
  const worldSessionExtensionPorts: WorldSessionExtensionPorts = Object.freeze({ dynamicActors: registry })
  const gameplayContribution: GameplayExtensionPortContribution = Object.freeze({ worldSessionExtensionPorts })
  let lifecycle: Readonly<{
    world: WorldSession
    follower?: SavedFollowerWorldState
    player?: Readonly<{ mapId: number, tileX: number, tileZ: number }>
    authoritativePositionChanged: boolean
  }> | undefined
  let fieldLocked = false
  let movementInFlight = false
  let movementOperation: Promise<void> | undefined
  let movementGeneration = 0
  let appliedSnapshotRevision = -1
  let pageReleaseRequested = false
  let pageReleaseOperation: Promise<void> | undefined
  const snapshotWaiters = new Set<Readonly<{
    revision: number
    resolve: () => void
    reject: (error: Error) => void
  }>>()
  const progressionSync = options.progression && createHgssSharedCampaignProgressionSync({
    readState: options.progression.readFieldState,
    readGateway: () => coordinator.getGateway(),
    readSavedCampaign: options.progression.readSavedCampaign,
    persistState: options.progression.persistState,
    publishState: options.progression.publishState,
  })

  const publishActors = (): void => { options.publishActors?.(registry.list()) }
  const validateInitialCampaignBranch = (
    snapshot: HgssCampaignServerSnapshot,
    localParticipantId: string,
  ): void => {
    if (appliedSnapshotRevision >= 0) return
    const previous = options.progression?.readSavedCampaign()
    if (!previous) return
    const candidate = createHgssSharedCampaignSaveExtension(
      snapshot.sharedProgression,
      snapshot.sessionId,
      snapshot.pendingEvents,
      localParticipantId,
    )
    const order = compareHgssSharedCampaignSaveProgression(candidate, previous)
    if (order === 'different-branch') throw new Error('La salle Coop appartient à une autre branche de campagne.')
    if (order === 'right-ahead') throw new Error('La salle Coop est plus ancienne que la sauvegarde locale.')
    if (order === 'divergent') throw new Error('La salle Coop diverge de la sauvegarde locale.')
  }
  const reconcileInitialAuthoritativePosition = async (
    snapshot: HgssCampaignServerSnapshot,
    localParticipantId: string,
  ): Promise<void> => {
    if (appliedSnapshotRevision >= 0) return
    const context = options.readContext()
    const current = context?.world.getState()
    const player = localPlayer(snapshot, localParticipantId)
    if (!context || !current || !player) {
      throw new Error('La position locale autoritaire est indisponible.')
    }
    const target = player.position
    if (current.map.id === target.mapId
      && current.tileX === target.x
      && current.tileZ === target.z
      && current.direction === target.direction) return
    const inspection = options.inspectPlayerPosition?.(target)
      ?? context.world.inspectPlayerTile(target.mapId, target.x, target.z, { locomotion: 'walking' })
    if (!inspection || !inspection.insideBounds || inspection.blocked) {
      throw new Error('La position autoritaire ne peut pas être chargée dans le monde local.')
    }
    if (!options.persistAuthoritativePosition) {
      throw new Error('Le checkpoint de position autoritaire est indisponible.')
    }
    const previous = Object.freeze({
      mapId: current.map.id,
      x: current.tileX,
      z: current.tileZ,
      direction: current.direction,
      locomotion: current.locomotion,
    })
    const loaded = context.world.loadMap(
      target.mapId,
      target.x,
      target.z,
      target.direction,
      'walking',
    )
    if (!loaded) throw new Error('La position autoritaire ne peut pas être appliquée au monde local.')
    try {
      await options.persistAuthoritativePosition()
    } catch (error) {
      context.world.loadMap(
        previous.mapId,
        previous.x,
        previous.z,
        previous.direction,
        previous.locomotion,
      )
      throw error
    }
    if (lifecycle?.world === context.world) {
      lifecycle = Object.freeze({ ...lifecycle, authoritativePositionChanged: true })
    }
  }
  const settleSnapshotWaiters = (error?: Error): void => {
    for (const waiter of [...snapshotWaiters]) {
      if (!error && waiter.revision > appliedSnapshotRevision) continue
      snapshotWaiters.delete(waiter)
      if (error) waiter.reject(error)
      else waiter.resolve()
    }
  }
  const waitForAppliedSnapshot = (revision: number): Promise<void> => {
    if (revision <= appliedSnapshotRevision) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      snapshotWaiters.add(Object.freeze({ revision, resolve, reject }))
    })
  }
  const waitForCurrentSnapshotApplication = async (): Promise<void> => {
    while (true) {
      const snapshot = coordinator.getGateway()?.getState().snapshot
      if (!snapshot || snapshot.revision <= appliedSnapshotRevision) return
      await waitForAppliedSnapshot(snapshot.revision)
    }
  }
  const clearActors = (): void => {
    registry.clear()
    publishActors()
  }
  const beginLifecycle = (): void => {
    if (fieldLocked) return
    fieldLocked = true
    movementGeneration += 1
    const context = options.readContext()
    if (context) {
      const follower = savedFollower(context.world)
      const player = context.world.getState()
      lifecycle = Object.freeze({
        world: context.world,
        authoritativePositionChanged: false,
        ...(follower ? { follower } : {}),
        ...(player ? { player: { mapId: player.map.id, tileX: player.tileX, tileZ: player.tileZ } } : {}),
      })
      context.world.setFollowerEnabled(false)
    }
    try { options.onFieldLockChanged?.(true) } catch { /* La présentation ne pilote pas la session. */ }
  }
  const endLifecycle = (): void => {
    if (!fieldLocked && !lifecycle && registry.size() === 0) return
    fieldLocked = false
    movementGeneration += 1
    movementInFlight = false
    const previous = lifecycle
    lifecycle = undefined
    if (previous?.follower) {
      const player = previous.world.getState()
      if (!previous.authoritativePositionChanged && player && previous.player?.mapId === player.map.id
        && previous.player.tileX === player.tileX && previous.player.tileZ === player.tileZ) {
        previous.world.restoreFollowerState(previous.follower)
      } else previous.world.setFollowerEnabled(true)
    }
    clearActors()
    try { options.onFieldLockChanged?.(false) } catch { /* La présentation ne pilote pas la session. */ }
  }

  const coordinator: HgssBrowserCampaignCoordinator = createHgssBrowserCampaignCoordinator({
    readLocalPlayer: () => {
      const context = options.readContext()
      const state = context?.world.getState()
      if (!context || !state || state.locomotion !== 'walking') return undefined
      return Object.freeze({
        gameCode: context.gameCode,
        gameVersion: context.gameVersion,
        language: context.language,
        player: Object.freeze({
          displayName: context.displayName,
          gender: context.gender,
          position: Object.freeze({
            mapId: state.map.id,
            x: state.tileX,
            z: state.tileZ,
            direction: state.direction,
          }),
          spriteId: context.spriteId,
          locomotion: 'walking' as const,
        }),
        ...(options.progression ? { sharedProgression: options.progression.readSeed() } : {}),
      })
    },
    movement: createHgssCampaignWorldMovementPort({ createProbe: options.createMovementProbe }),
    ...(options.sharedEventAdmission ? { sharedEventAdmission: options.sharedEventAdmission } : {}),
    ...(options.authoritativeService ? { authoritativeService: options.authoritativeService } : {}),
    authorizeGuestJoin: ({ guest }) => {
      const context = options.readContext()
      const position = guest.player.position
      const inspection = options.inspectPlayerPosition
        ? options.inspectPlayerPosition(position)
        : context?.world.inspectPlayerTile(position.mapId, position.x, position.z, { locomotion: 'walking' })
      return inspection && inspection.insideBounds && !inspection.blocked
        ? Object.freeze({ kind: 'accept' as const })
        : Object.freeze({
          kind: 'reject' as const,
          code: 'position-invalid' as const,
          message: "La case de départ de l'invité n'est pas praticable dans le monde hôte.",
        })
    },
    ...(options.bootstrapTimeoutMs !== undefined ? { bootstrapTimeoutMs: options.bootstrapTimeoutMs } : {}),
    onSnapshot: async (snapshot, localParticipantId) => {
      validateInitialCampaignBranch(snapshot, localParticipantId)
      await reconcileInitialAuthoritativePosition(snapshot, localParticipantId)
      await progressionSync?.observe(snapshot, localParticipantId)
      registry.restore({
        version: dynamicWorldActorSnapshotVersion,
        actors: remoteActors(snapshot, localParticipantId),
      })
      publishActors()
      appliedSnapshotRevision = Math.max(appliedSnapshotRevision, snapshot.revision)
      settleSnapshotWaiters()
    },
    onError: options.onError,
  })

  coordinator.subscribe((state) => {
    if (state.status === 'connecting' || state.status === 'connected') {
      if (state.status === 'connecting') {
        pageReleaseRequested = false
        pageReleaseOperation = undefined
        movementOperation = undefined
      }
      beginLifecycle()
    }
    else {
      progressionSync?.reset()
      appliedSnapshotRevision = -1
      settleSnapshotWaiters(new Error('La campagne a été fermée avant l’application du snapshot.'))
      endLifecycle()
    }
  })

  const consumeMovement = (movement: HgssBrowserFieldCampaignMovement): boolean => {
    const campaignState = coordinator!.getState()
    if (campaignState.status === 'idle' || campaignState.status === 'failed') return false
    if (pageReleaseRequested) return true
    if (campaignState.status !== 'connected' || movementInFlight) return true
    const context = options.readContext()
    const worldState = context?.world.getState()
    const gateway = coordinator!.getGateway()
    const snapshot = gateway?.getState().snapshot
    const player = snapshot?.players.find(({ playerId }) => playerId !== campaignState.remoteParticipantId)
    if (!context || !worldState || !gateway || !snapshot || !player || worldState.locomotion !== 'walking') return true

    if (worldState.direction !== movement.direction) {
      context.world.setDirection(movement.direction)
      try { options.onLocalTurn?.(movement.direction) } catch { /* La présentation ne pilote pas le monde. */ }
      return true
    }

    const expected = cardinalDelta[movement.direction]
    if (movement.deltaX !== expected[0] || movement.deltaZ !== expected[1]
      || player.state !== 'active'
      || player.position.mapId !== worldState.map.id
      || player.position.x !== worldState.tileX
      || player.position.z !== worldState.tileZ
      || player.movementSequence === Number.MAX_SAFE_INTEGER) return true

    const from = Object.freeze({ ...player.position })
    const liveFrom = Object.freeze({
      mapId: worldState.map.id,
      x: worldState.tileX,
      z: worldState.tileZ,
      direction: worldState.direction,
    })
    const to = Object.freeze({
      mapId: worldState.map.id,
      x: worldState.tileX + movement.deltaX,
      z: worldState.tileZ + movement.deltaZ,
      direction: movement.direction,
    })
    const sequence = player.movementSequence + 1
    const probeCommand: HgssCampaignMovementCommand = Object.freeze({
      protocolVersion: hgssCampaignProtocolVersion,
      commandId: `local-probe:${sequence}`,
      expectedRevision: snapshot.revision,
      kind: 'movement',
      sequence,
      from,
      to,
      mode: movement.running ? 'run' : 'walk',
    })
    const localResolution = resolveHgssCampaignWorldMovement(
      { createProbe: options.createMovementProbe },
      Object.freeze({
        sessionId: snapshot.sessionId,
        playerId: player.playerId,
        command: probeCommand,
        snapshot,
      }),
    )
    const localTransition = localResolution.kind === 'accept' && localResolution.movement === 'transition'
      ? localResolution
      : undefined
    const generation = movementGeneration
    let authorityApplied = false
    const expectedPosition = localTransition?.authoritativePosition ?? to
    const readConfirmedPlayer = (): HgssCampaignPlayerSnapshot | undefined => {
      if (generation !== movementGeneration || coordinator!.getState().status !== 'connected') return undefined
      const applied = gateway.getState().snapshot
      const appliedPlayer = applied && localPlayer(applied, player.playerId)
      return appliedPlayer
        && appliedPlayer.movementSequence === sequence
        && appliedPlayer.position.mapId === expectedPosition.mapId
        && appliedPlayer.position.x === expectedPosition.x
        && appliedPlayer.position.z === expectedPosition.z
        && appliedPlayer.position.direction === expectedPosition.direction
        ? appliedPlayer
        : undefined
    }
    const commitConfirmedMovement = (): void => {
      if (localTransition) {
        const transitioned = context.world.applyAuthoritativePlayerTransition({
          from: liveFrom,
          to: expectedPosition,
          movement: movement.running ? 'run' : 'walk',
        })
        if (!transitioned) throw new Error("Le monde local n'a pas pu appliquer la transition autoritaire.")
        if (lifecycle?.world === context.world) {
          lifecycle = Object.freeze({ ...lifecycle, authoritativePositionChanged: true })
        }
        publishActors()
        options.onLocalTransition?.(transitioned, localTransition.presentation)
        return
      }
      const result = context.world.applyAuthoritativePlayerStep({
        from: liveFrom,
        to,
        movement: movement.running ? 'run' : 'walk',
      })
      if (!result) throw new Error("Le monde local n'a pas pu appliquer le pas autoritaire.")
      if (lifecycle?.world === context.world) {
        lifecycle = Object.freeze({ ...lifecycle, authoritativePositionChanged: true })
      }
      options.onLocalStep?.(result)
    }
    movementInFlight = true
    const operation = gateway.send({
      kind: 'movement',
      sequence,
      from,
      to,
      ...(localTransition ? { arrival: localTransition.authoritativePosition } : {}),
      mode: movement.running ? 'run' : 'walk',
    }).then(async () => {
      authorityApplied = true
      if (generation !== movementGeneration || coordinator!.getState().status !== 'connected') return
      const confirmedSnapshot = gateway.getState().snapshot
      if (!confirmedSnapshot) throw new Error('Le snapshot autoritaire du pas local est absent.')
      await waitForAppliedSnapshot(confirmedSnapshot.revision)
      if (generation !== movementGeneration || coordinator!.getState().status !== 'connected') return
      if (!readConfirmedPlayer()) {
        throw new Error("Le snapshot autoritaire n'a pas confirmé le pas local.")
      }
      commitConfirmedMovement()
    }).catch(async (value: unknown) => {
      const error = asError(value)
      if (generation !== movementGeneration) return
      const recoveredSnapshot = gateway.getState().snapshot
      if (recoveredSnapshot) {
        await waitForAppliedSnapshot(recoveredSnapshot.revision)
        if (generation !== movementGeneration) return
      }
      if (!authorityApplied && readConfirmedPlayer()) {
        authorityApplied = true
        try { commitConfirmedMovement() }
        catch (commitError) {
          try { options.onError?.(asError(commitError)) } finally { void coordinator!.close() }
        }
        return
      }
      if (authorityApplied) {
        try { options.onError?.(error) } finally { void coordinator!.close() }
        return
      }
      const status = gateway.getState().status
      if (status === 'connected' || status === 'resyncing') options.onMovementRejected?.(error)
      else options.onError?.(error)
    }).finally(() => {
      if (generation === movementGeneration) movementInFlight = false
    })
    movementOperation = operation
    void operation.then(
      () => { if (movementOperation === operation) movementOperation = undefined },
      () => { if (movementOperation === operation) movementOperation = undefined },
    )
    return true
  }

  const prepareForPageRelease = (): Promise<void> => {
    if (pageReleaseOperation) return pageReleaseOperation
    pageReleaseRequested = true
    const operation = (async (): Promise<void> => {
      try {
        await movementOperation
        await waitForCurrentSnapshotApplication()
        await progressionSync?.flush()
        await waitForCurrentSnapshotApplication()
        await progressionSync?.flush()
        await waitForCurrentSnapshotApplication()
      } finally {
        progressionSync?.reset()
        endLifecycle()
        await coordinator!.close()
      }
    })()
    pageReleaseOperation = operation
    return operation
  }

  return Object.freeze({
    port: coordinator.port,
    worldSessionExtensionPorts,
    gameplayContribution,
    registry,
    getState: coordinator.getState,
    isFieldLocked: () => fieldLocked,
    consumeMovement,
    commitSharedEvent: (eventId, before, after) => {
      if (!progressionSync) {
        return Promise.reject(new Error('La progression partagée HGSS n’est pas configurée.'))
      }
      if (pageReleaseRequested) {
        return Promise.reject(new Error('La campagne Coop est en cours de fermeture.'))
      }
      return progressionSync.commit(eventId, before, after)
    },
    prepareForPageRelease,
    // Toute fermeture est une libération de page du point de vue de la
    // durabilité : aucun appelant ne peut contourner le drain progression/ACK.
    close: prepareForPageRelease,
  })
}
