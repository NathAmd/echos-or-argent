import { describe, expect, it } from 'vitest'
import type { OpeningMapPreview } from '../../ndsTypes'
import { createFieldScriptState } from '../scripts/fieldScriptRunner'
import { baseWorldSessionExtensionPorts } from '../world/worldSession'
import { hgssCampaignProtocolVersion, type HgssCampaignServerSnapshot } from './hgssCampaignProtocol'
import { createHgssSharedCampaignProgressionSeed } from './hgssSharedCampaignProgression'
import { createHgssSharedCampaignFieldEventId } from './hgssSharedCampaignEventIdentity'
import {
  createHgssSharedFieldEventAdmission,
  type HgssSharedFieldEventAdmissionContext,
  type HgssSharedFieldEventAdmissionInput,
} from './hgssSharedFieldEventAdmission'

const mapId = 64
const sessionId = 'campaign:semantic-admission'
const branchId = '0123456789abcdef0123456789abcdef'

function flagScript(): Uint8Array {
  const bytes = new Uint8Array(6)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, 30, true); view.setUint16(2, 0x123, true)
  view.setUint16(4, 2, true)
  return bytes
}

function moneyReadScript(): Uint8Array {
  const bytes = new Uint8Array(10)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, 112, true); view.setUint16(2, 0x4010, true)
  view.setUint32(4, 3_000, true); view.setUint16(8, 2, true)
  return bytes
}

function createMap(
  bytes = flagScript(),
  event: 'object' | 'background' | 'absent' = 'object',
): OpeningMapPreview {
  return {
    id: mapId,
    label: 'Admission',
    header: { mapId, msgBank: 1, mapSection: 1, followMode: 2 } as OpeningMapPreview['header'],
    fieldScripts: { bank: 1, bytes, headerSize: 0, entryOffsets: [0] },
    initScripts: [],
    messages: {},
    matrix: {
      matrixIndex: 0,
      name: 'Admission',
      width: 1,
      height: 1,
      headers: new Uint16Array([mapId]),
      altitudes: new Uint8Array([0]),
      modelIds: new Uint16Array([0]),
    },
    terrain: { modelId: 0, width: 4, height: 4, attributes: new Uint16Array(16) },
    events: {
      backgroundEvents: event === 'background' ? 1 : 0,
      backgrounds: event === 'background'
        ? [{ scriptId: 1, type: 0, x: 2, z: 1, y: 0, direction: 0 }]
        : [],
      coordinateEvents: [],
      objects: event === 'object'
        ? [{
            id: 7, spriteId: 10, movement: 0, type: 0, eventFlag: 0, scriptId: 1,
            facingDirection: 0, xRange: 0, zRange: 0, x: 2, z: 1,
          }]
        : [],
      warps: [],
    },
  }
}

function harness(map = createMap()) {
  const fieldState = createFieldScriptState('male', 'JO')
  const context: HgssSharedFieldEventAdmissionContext = {
    inventory: {
      metadata: { gameCode: 'IPKE' } as HgssSharedFieldEventAdmissionContext['inventory']['metadata'],
      resolvedMapCatalog: { startMapId: map.id, maps: [map] },
      mapPropAnimationMetadataResolver: undefined,
      mapVariantResolver: undefined,
    },
    fieldState,
    playerGender: 'male',
    gameVersion: 7,
    language: 2,
    extensionPorts: baseWorldSessionExtensionPorts,
  }
  const progression = createHgssSharedCampaignProgressionSeed(fieldState, branchId)
  const snapshot: HgssCampaignServerSnapshot = Object.freeze({
    protocolVersion: hgssCampaignProtocolVersion,
    sessionId,
    revision: 4,
    players: Object.freeze([Object.freeze({
      playerId: 'player:guest', displayName: 'GUEST', gender: 'male' as const,
      state: 'active' as const, position: Object.freeze({ mapId, x: 1, z: 1, direction: 'east' as const }),
      spriteId: 0, movementSequence: 0,
    })]),
    sharedProgression: progression,
    pendingEvents: Object.freeze([]),
  })
  const objectEventId = createHgssSharedCampaignFieldEventId({
    rom: { gameCode: 'IPKE', gameVersion: 7, language: 2 },
    mapId,
    source: { kind: 'object', objectId: 7 },
    scriptId: 1,
  })
  const coordinateEventId = createHgssSharedCampaignFieldEventId({
    rom: { gameCode: 'IPKE', gameVersion: 7, language: 2 },
    mapId,
    source: { kind: 'coordinate', x: 2, z: 1 },
    scriptId: 1,
  })
  const input = (eventId = objectEventId): HgssSharedFieldEventAdmissionInput => ({
    sessionId,
    playerId: 'player:guest',
    snapshot,
    command: {
      protocolVersion: hgssCampaignProtocolVersion,
      commandId: 'shared-event:guest:1',
      expectedRevision: snapshot.revision,
      kind: 'shared-event',
      eventId,
      milestoneIds: ['field.flag.0123'],
      counters: [{ id: 'field.progression-revision', expectedValue: 0, value: 1 }],
    },
  })
  return { context, fieldState, snapshot, objectEventId, coordinateEventId, input }
}

describe("admission ROM hôte d'un événement terrain partagé", () => {
  it('reproduit exactement une interaction objet sans toucher au terrain vivant', () => {
    const runtime = harness()
    const beforeFlags = [...runtime.fieldState.flags]
    const beforeVariables = [...runtime.fieldState.variables]
    const admit = createHgssSharedFieldEventAdmission(() => runtime.context)

    expect(admit(runtime.input())).toEqual({ kind: 'accept' })
    expect([...runtime.fieldState.flags]).toEqual(beforeFlags)
    expect([...runtime.fieldState.variables]).toEqual(beforeVariables)
  })

  it('admet aussi un décor uniquement avec ses coordonnées monde exactes', () => {
    const runtime = harness(createMap(flagScript(), 'background'))
    const admit = createHgssSharedFieldEventAdmission(() => runtime.context)

    expect(admit(runtime.input(runtime.coordinateEventId))).toEqual({ kind: 'accept' })
    expect(admit(runtime.input(runtime.objectEventId))).toMatchObject({
      kind: 'reject', code: 'shared-event-source-mismatch',
    })
  })

  it('refuse source, script, carte et position usurpés', () => {
    const runtime = harness()
    const admit = createHgssSharedFieldEventAdmission(() => runtime.context)
    const spoofedIds = [
      createHgssSharedCampaignFieldEventId({
        rom: { gameCode: 'IPKE', gameVersion: 7, language: 2 }, mapId,
        source: { kind: 'object', objectId: 8 }, scriptId: 1,
      }),
      createHgssSharedCampaignFieldEventId({
        rom: { gameCode: 'IPKE', gameVersion: 7, language: 2 }, mapId,
        source: { kind: 'object', objectId: 7 }, scriptId: 2,
      }),
      createHgssSharedCampaignFieldEventId({
        rom: { gameCode: 'IPKE', gameVersion: 7, language: 2 }, mapId: 65,
        source: { kind: 'object', objectId: 7 }, scriptId: 1,
      }),
    ]
    for (const eventId of spoofedIds) {
      expect(admit(runtime.input(eventId))).toMatchObject({ kind: 'reject' })
    }
    const notFacing = runtime.input()
    expect(admit({
      ...notFacing,
      snapshot: {
        ...notFacing.snapshot,
        players: [{ ...notFacing.snapshot.players[0]!, position: { mapId, x: 1, z: 1, direction: 'west' } }],
      },
    })).toMatchObject({ kind: 'reject', code: 'shared-event-source-mismatch' })
  })

  it('refuse tout effet ajouté, retiré, réordonné ou falsifié par le demandeur', () => {
    const runtime = harness()
    const admit = createHgssSharedFieldEventAdmission(() => runtime.context)
    const valid = runtime.input()

    expect(admit({
      ...valid,
      command: { ...valid.command, milestoneIds: ['field.flag.0124'] },
    })).toMatchObject({ kind: 'reject', code: 'shared-event-effects-mismatch' })
    expect(admit({
      ...valid,
      command: {
        ...valid.command,
        counters: [{ id: 'field.progression-revision', expectedValue: 0, value: 2 }],
      },
    })).toMatchObject({ kind: 'reject', code: 'shared-event-effects-mismatch' })
  })

  it('refuse snapshot périmé, contexte absent et script dépendant de données personnelles', () => {
    const runtime = harness(createMap(moneyReadScript()))
    const admit = createHgssSharedFieldEventAdmission(() => runtime.context)
    const valid = runtime.input()

    expect(admit({
      ...valid, command: { ...valid.command, expectedRevision: valid.snapshot.revision - 1 },
    })).toMatchObject({ kind: 'reject', code: 'shared-event-state-conflict' })
    expect(admit(valid)).toMatchObject({ kind: 'reject', code: 'shared-event-script-unsafe' })
    expect(createHgssSharedFieldEventAdmission(() => undefined)(valid)).toMatchObject({
      kind: 'reject', code: 'shared-event-context-unavailable',
    })
  })
})
