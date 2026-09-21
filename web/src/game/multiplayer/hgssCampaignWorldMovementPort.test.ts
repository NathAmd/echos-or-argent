import { describe, expect, it, vi } from 'vitest'
import type { MapEventPreview, OpeningMapPreview } from '../../ndsTypes'
import type { PlayerLocomotionMode } from '../player/hgssPlayerMovement'
import {
  createWorldSession,
  type WorldMoveResult,
  type WorldSession,
  type WorldState,
} from '../world/worldSession'
import {
  hgssCampaignProtocolVersion,
  type HgssCampaignServerSnapshot,
} from './hgssCampaignProtocol'
import type {
  HgssCampaignMovementCommand,
  HgssCampaignServerPortContext,
} from './hgssCampaignServerCore'
import {
  createHgssCampaignWorldMovementPort,
  resolveHgssCampaignWorldMovement,
  type HgssCampaignWorldMovementProbe,
} from './hgssCampaignWorldMovementPort'

function createMap(
  id = 61,
  events?: MapEventPreview,
  attributes: Uint16Array = new Uint16Array(16),
): OpeningMapPreview {
  return {
    id,
    label: `Map ${id}`,
    header: {
      mapId: id,
      wildEncounterBank: 255,
      areaDataBank: 0,
      moveModelBank: 0,
      worldMapX: 0,
      worldMapY: 0,
      matrixId: id,
      scriptsBank: 0,
      scriptHeaderBank: 0,
      msgBank: 0,
      dayMusicId: 0,
      nightMusicId: 0,
      eventsBank: 0,
      mapSection: 0,
      areaIcon: 0,
      momCallIntroParam: 0,
      region: 0,
      weather: 0,
      mapType: 0,
      cameraType: 0,
      followMode: 0,
      battleBackground: 0,
      bikeAllowed: true,
      runningAllowed: true,
      escapeRopeAllowed: false,
      flyAllowed: false,
      outgoingCalls: false,
      incomingCalls: false,
      radioSignal: false,
    },
    fieldScripts: { bank: 0, bytes: new Uint8Array([0x13, 0xfd]), headerSize: 2, entryOffsets: [] },
    initScripts: [],
    messages: {},
    matrix: {
      matrixIndex: id,
      name: `matrix-${id}`,
      width: 1,
      height: 1,
      headers: new Uint16Array([id]),
      altitudes: new Uint8Array([0]),
      modelIds: new Uint16Array([0]),
    },
    events,
    terrain: { modelId: 0, width: 4, height: 4, attributes },
    model: {
      modelId: 0,
      vertexCount: 0,
      triangleCount: 0,
      quadCount: 0,
      materialCount: 0,
      pieceCount: 0,
      tileBounds: { minX: 0, maxX: 4, minZ: 0, maxZ: 4 },
    },
  }
}

function movement(
  mode: HgssCampaignMovementCommand['mode'] = 'walk',
  overrides: Partial<HgssCampaignMovementCommand> = {},
): HgssCampaignMovementCommand {
  return {
    protocolVersion: hgssCampaignProtocolVersion,
    commandId: `move:${mode}`,
    expectedRevision: 0,
    kind: 'movement',
    sequence: 1,
    from: { mapId: 61, x: 1, z: 1, direction: 'south' },
    to: { mapId: 61, x: 1, z: 2, direction: 'south' },
    mode,
    ...overrides,
  }
}

function context(
  command: HgssCampaignMovementCommand,
): HgssCampaignServerPortContext<HgssCampaignMovementCommand> {
  const snapshot: HgssCampaignServerSnapshot = {
    protocolVersion: hgssCampaignProtocolVersion,
    sessionId: 'campaign:world-port',
    revision: command.expectedRevision,
    players: [{
      playerId: 'player:host',
      displayName: 'ALICE',
      gender: 'female',
      state: 'active',
      position: command.from,
      spriteId: 1,
      movementSequence: command.sequence - 1,
    }],
    sharedProgression: { milestoneIds: [], counters: [] },
    pendingEvents: [],
  }
  return {
    sessionId: snapshot.sessionId,
    playerId: 'player:host',
    command,
    snapshot,
  }
}

function createLoadedProbe(
  map: OpeningMapPreview | readonly OpeningMapPreview[],
  command: HgssCampaignMovementCommand,
  locomotion: PlayerLocomotionMode,
  isModeAllowed = true,
  configure?: (session: WorldSession) => void,
): HgssCampaignWorldMovementProbe {
  const session = createWorldSession(Array.isArray(map) ? [...map] : [map])
  session.loadMap(
    command.from.mapId,
    command.from.x,
    command.from.z,
    command.from.direction,
    locomotion,
  )
  configure?.(session)
  return {
    getState: session.getState,
    tryMove: session.tryMove,
    transitionTo: session.transitionTo,
    isModeAllowed: () => isModeAllowed,
  }
}

function emptyEvents(overrides: Partial<MapEventPreview> = {}): MapEventPreview {
  return {
    backgroundEvents: 0,
    backgrounds: [],
    objects: [],
    warps: [],
    coordinateEvents: [],
    ...overrides,
  }
}

describe('port autoritaire de mouvement WorldSession', () => {
  it.each([
    ['walk', 0],
    ['run', 0],
  ] as const)('accepte un pas ROM ordinaire en mode %s', (mode, terrainAttribute) => {
    const command = movement(mode)
    const map = createMap(61, undefined, new Uint16Array(16).fill(terrainAttribute))
    const createProbe = vi.fn(() => createLoadedProbe(map, command, 'walking'))
    const port = createHgssCampaignWorldMovementPort({ createProbe })

    expect(port(context(command))).toEqual({ kind: 'accept' })
    expect(createProbe).toHaveBeenCalledOnce()
  })

  it.each([
    ['terrain', () => {
      const attributes = new Uint16Array(16)
      attributes[2 * 4 + 1] = 0x8000
      return { map: createMap(61, undefined, attributes), command: movement() }
    }],
    ['bounds', () => ({
      map: createMap(),
      command: movement('walk', {
        from: { mapId: 61, x: 0, z: 1, direction: 'west' },
        to: { mapId: 61, x: -1, z: 1, direction: 'west' },
      }),
    })],
    ['npc', () => ({
      map: createMap(61, emptyEvents({
        objects: [{
          id: 7,
          spriteId: 1,
          movement: 0,
          type: 0,
          eventFlag: 0,
          scriptId: 10,
          facingDirection: 0,
          xRange: 0,
          zRange: 0,
          x: 1,
          z: 2,
        }],
      })),
      command: movement(),
    })],
  ] as const)('convertit un blocage ROM %s en code stable', (reason, buildFixture) => {
    const { map, command } = buildFixture()
    const port = createHgssCampaignWorldMovementPort({
      createProbe: () => createLoadedProbe(map, command, 'walking'),
    })

    expect(port(context(command))).toMatchObject({ kind: 'reject', code: `world-${reason}` })
  })

  it('convertit aussi les collisions suiveur et acteur dynamique en refus fermés', () => {
    const followerCommand = movement('walk', {
      from: { mapId: 61, x: 2, z: 1, direction: 'east' },
      to: { mapId: 61, x: 1, z: 1, direction: 'west' },
    })
    const followerPort = createHgssCampaignWorldMovementPort({
      createProbe: () => createLoadedProbe(createMap(), followerCommand, 'walking', true, (session) => {
        session.setFollowerEnabled(true)
      }),
    })
    expect(followerPort(context(followerCommand))).toMatchObject({ kind: 'reject', code: 'world-follower' })

    const command = movement()
    const map = createMap()
    const state = createLoadedProbe(map, command, 'walking').getState()!
    const dynamicResult: WorldMoveResult = {
      kind: 'blocked',
      reason: 'dynamic-actor',
      tileX: command.to.x,
      tileZ: command.to.z,
    }
    const dynamicPort = createHgssCampaignWorldMovementPort({
      createProbe: () => ({
        getState: () => state,
        tryMove: () => dynamicResult,
        isModeAllowed: () => true,
      }),
    })
    expect(dynamicPort(context(command))).toMatchObject({ kind: 'reject', code: 'world-dynamic-actor' })
  })

  it('échoue fermé si le probe manque, est déchargé ou part d’une autre origine', () => {
    const command = movement()
    expect(createHgssCampaignWorldMovementPort({ createProbe: () => undefined })(context(command)))
      .toMatchObject({ kind: 'reject', code: 'world-probe-unavailable' })
    expect(createHgssCampaignWorldMovementPort({
      createProbe: () => ({ getState: () => undefined, tryMove: () => undefined, isModeAllowed: () => true }),
    })(context(command))).toMatchObject({ kind: 'reject', code: 'world-probe-unloaded' })

    const wrongOriginProbe = createLoadedProbe(createMap(), command, 'walking')
    const wrongOrigin = wrongOriginProbe.getState()!
    const port = createHgssCampaignWorldMovementPort({
      createProbe: () => ({
        ...wrongOriginProbe,
        getState: () => ({ ...wrongOrigin, tileX: wrongOrigin.tileX + 1 }),
      }),
    })
    expect(port(context(command))).toMatchObject({ kind: 'reject', code: 'world-origin-conflict' })
  })

  it('refuse un mode absent de l’état fiable de l’hôte', () => {
    const walk = movement('walk')
    const wrongLocomotion = createHgssCampaignWorldMovementPort({
      createProbe: () => createLoadedProbe(createMap(), walk, 'cycling'),
    })
    expect(wrongLocomotion(context(walk))).toMatchObject({ kind: 'reject', code: 'world-mode-conflict' })

    const run = movement('run')
    const unauthorized = createHgssCampaignWorldMovementPort({
      createProbe: () => createLoadedProbe(createMap(), run, 'walking', false),
    })
    expect(unauthorized(context(run))).toMatchObject({ kind: 'reject', code: 'world-mode-conflict' })
  })

  it('refuse les événements de coordonnées et les continuations forcées', () => {
    const command = movement()
    const coordinateMap = createMap(61, emptyEvents({
      coordinateEvents: [{
        scriptId: 12,
        x: command.to.x,
        z: command.to.z,
        width: 1,
        height: 1,
        y: 0,
        expectedValue: 0,
        variableId: 1,
      }],
    }))
    const coordinatePort = createHgssCampaignWorldMovementPort({
      createProbe: () => createLoadedProbe(coordinateMap, command, 'walking'),
    })
    expect(coordinatePort(context(command))).toMatchObject({ kind: 'reject', code: 'world-event-required' })

    const iceAttributes = new Uint16Array(16)
    iceAttributes[2 * 4 + 1] = 32
    const icePort = createHgssCampaignWorldMovementPort({
      createProbe: () => createLoadedProbe(createMap(61, undefined, iceAttributes), command, 'walking'),
    })
    expect(icePort(context(command))).toMatchObject({ kind: 'reject', code: 'world-special-movement-required' })
  })

  it('refuse un warp incomplet, un changement de locomotion, les mouvements d’objet et une destination divergente', () => {
    const command = movement()
    const initial = createLoadedProbe(createMap(), command, 'walking').getState()!
    const movedState: WorldState = { ...initial, tileZ: command.to.z }
    const evaluate = (result: WorldMoveResult) => createHgssCampaignWorldMovementPort({
      createProbe: () => ({
        getState: () => initial,
        tryMove: () => result,
        isModeAllowed: () => true,
      }),
    })(context(command))

    expect(evaluate({
      kind: 'moved',
      state: movedState,
      movement: 'walk',
      warp: { kind: 'warp', header: 62, anchor: 0 },
    })).toMatchObject({ kind: 'reject', code: 'world-transition-required' })
    expect(evaluate({
      kind: 'moved',
      state: { ...movedState, locomotion: 'surfing' },
      movement: 'walk',
    })).toMatchObject({ kind: 'reject', code: 'world-transition-required' })
    expect(evaluate({
      kind: 'blocked',
      reason: 'npc',
      tileX: command.to.x,
      tileZ: command.to.z,
      objectMovements: [],
    })).toMatchObject({ kind: 'reject', code: 'world-side-effect-required' })
    expect(evaluate({
      kind: 'moved',
      state: { ...movedState, tileZ: movedState.tileZ + 1 },
      movement: 'walk',
    })).toMatchObject({ kind: 'reject', code: 'world-destination-conflict' })
  })

  it('résout un warp ROM en conservant le pas déclencheur et exige son arrivée exacte', () => {
    const command = movement()
    const sourceAttributes = new Uint16Array(16)
    sourceAttributes[2 * 4 + 1] = 103
    const source = createMap(61, emptyEvents({
      warps: [{ x: 1, z: 2, header: 62, anchor: 0 }],
    }), sourceAttributes)
    const destination = createMap(62, emptyEvents({
      warps: [{ x: 3, z: 2, header: 61, anchor: 0 }],
    }))
    const options = {
      createProbe: () => createLoadedProbe([source, destination], command, 'walking'),
    }
    const expectedArrival = { mapId: 62, x: 3, z: 2, direction: 'south' as const }

    expect(resolveHgssCampaignWorldMovement(options, context(command))).toMatchObject({
      kind: 'accept',
      movement: 'transition',
      to: command.to,
      authoritativePosition: expectedArrival,
      presentation: {
        kind: 'warp',
        triggerPosition: command.to,
        authoritativePosition: expectedArrival,
        activation: { trigger: 'completed-step', transition: 'panel' },
      },
    })

    const port = createHgssCampaignWorldMovementPort(options)
    expect(port(context(command))).toMatchObject({ kind: 'reject', code: 'world-arrival-conflict' })
    const attested = movement('walk', { arrival: expectedArrival })
    expect(port(context(attested))).toEqual({
      kind: 'accept', authoritativePosition: expectedArrival,
    })
    const forged = movement('walk', { arrival: { ...expectedArrival, x: 2 } })
    expect(port(context(forged))).toMatchObject({ kind: 'reject', code: 'world-arrival-conflict' })
  })

  it('consomme un probe jetable par validation sans muter une session canonique partagée', () => {
    const command = movement()
    const canonical = createWorldSession([createMap()])
    canonical.loadMap(61, command.from.x, command.from.z, command.from.direction, 'walking')
    const createdSessions: WorldSession[] = []
    const port = createHgssCampaignWorldMovementPort({
      createProbe: () => {
        const session = createWorldSession([createMap()])
        session.loadMap(61, command.from.x, command.from.z, command.from.direction, 'walking')
        createdSessions.push(session)
        return {
          getState: session.getState,
          tryMove: session.tryMove,
          isModeAllowed: () => true,
        }
      },
    })

    expect(port(context(command))).toEqual({ kind: 'accept' })
    expect(port(context(command))).toEqual({ kind: 'accept' })
    expect(createdSessions).toHaveLength(2)
    expect(createdSessions[0]).not.toBe(createdSessions[1])
    expect(canonical.getState()).toMatchObject({ tileX: command.from.x, tileZ: command.from.z })
    expect(createdSessions[0]!.getState()).toMatchObject({ tileX: command.to.x, tileZ: command.to.z })
  })
})
