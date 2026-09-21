import { describe, expect, it } from 'vitest'
import type { OpeningMapPreview } from '../../ndsTypes'
import { createDynamicWorldActorRegistry, type RemotePlayerWorldActor } from './dynamicWorldActorRegistry'
import {
  baseWorldSessionExtensionPorts,
  createWorldSession,
  emptyWorldDynamicActorProvider,
  type WorldSession,
  type WorldSessionExtensionPorts,
} from './worldSession'

const remotePlayer: RemotePlayerWorldActor = {
  id: 'remote:player-2',
  kind: 'remote-player',
  mapId: 1,
  tileX: 2,
  tileZ: 1,
  direction: 'west',
  collision: 'blocking',
  interaction: 'action',
  displayName: 'LYRA',
  spriteId: 1,
}

function createMap(): OpeningMapPreview {
  return {
    id: 1,
    label: 'Dynamic actor test map',
    header: {
      mapId: 1,
      wildEncounterBank: 255,
      areaDataBank: 0,
      moveModelBank: 0,
      worldMapX: 0,
      worldMapY: 0,
      matrixId: 1,
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
      bikeAllowed: false,
      runningAllowed: false,
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
      matrixIndex: 1,
      name: 'dynamic-actor-test',
      width: 1,
      height: 1,
      headers: new Uint16Array([1]),
      altitudes: new Uint8Array([0]),
      modelIds: new Uint16Array([0]),
    },
    terrain: { modelId: 0, width: 4, height: 4, attributes: new Uint16Array(16) },
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

function createSession(extensionPorts?: WorldSessionExtensionPorts): WorldSession {
  return createWorldSession(
    [createMap()],
    new Set(),
    new Set(),
    new Map(),
    undefined,
    new Set(),
    undefined,
    undefined,
    undefined,
    extensionPorts,
  )
}

function observeBaseSequence(session: WorldSession): unknown[] {
  return [
    session.loadMap(1, 1, 1, 'east'),
    session.findDynamicActorInteraction(),
    session.interact(),
    session.tryMove(1, 0, 'east'),
  ]
}

describe('WorldSession dynamic actor seam', () => {
  it('keeps the base world strictly identical with its default or explicit empty provider', () => {
    expect(observeBaseSequence(createSession({ dynamicActors: emptyWorldDynamicActorProvider })))
      .toEqual(observeBaseSequence(createSession()))
    expect(baseWorldSessionExtensionPorts.dynamicActors).toBe(emptyWorldDynamicActorProvider)
  })

  it('reads an action target and blocks only a blocking dynamic actor', () => {
    const registry = createDynamicWorldActorRegistry()
    registry.upsert(remotePlayer)
    const session = createSession({ dynamicActors: registry })
    session.loadMap(1, 1, 1, 'east')

    expect(session.findDynamicActorInteraction()).toEqual(remotePlayer)
    expect(session.interact()).toBeUndefined()
    expect(session.tryMove(1, 0, 'east')).toEqual({
      kind: 'blocked',
      reason: 'dynamic-actor',
      tileX: 2,
      tileZ: 1,
      dynamicActor: remotePlayer,
    })

    registry.upsert({ ...remotePlayer, collision: 'non-blocking' })
    expect(session.tryMove(1, 0, 'east')).toMatchObject({ kind: 'moved', state: { tileX: 2, tileZ: 1 } })
  })
})
