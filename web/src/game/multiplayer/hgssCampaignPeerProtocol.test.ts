import { describe, expect, it } from 'vitest'
import {
  createHgssCampaignPeerEnvelope,
  decodeHgssCampaignPeerFrame,
  encodeHgssCampaignPeerFrame,
  parseHgssCampaignPeerFrame,
} from './hgssCampaignPeerProtocol'
import { hgssCampaignProtocolVersion } from './hgssCampaignProtocol'

const snapshot = {
  protocolVersion: hgssCampaignProtocolVersion,
  sessionId: 'campaign:peer',
  revision: 0,
  players: [{
    playerId: 'player:guest', displayName: 'BOB', gender: 'male' as const, state: 'active' as const,
    position: { mapId: 61, x: 8, z: 12, direction: 'south' as const }, spriteId: 1, movementSequence: 0,
  }],
  sharedProgression: { milestoneIds: [], counters: [] },
  pendingEvents: [],
}

describe('protocole de campagne pair-à-pair', () => {
  it('reconstruit strictement requêtes, réponses et snapshots', () => {
    const envelope = createHgssCampaignPeerEnvelope()
    const frames = [
      { ...envelope, kind: 'request' as const, requestId: 'request:ready', operation: 'ready' as const },
      { ...envelope, kind: 'response' as const, requestId: 'request:ready', operation: 'ready' as const, ok: true as const },
      { ...envelope, kind: 'request' as const, requestId: 'request:1', operation: 'snapshot' as const },
      { ...envelope, kind: 'response' as const, requestId: 'request:1', operation: 'snapshot' as const, ok: true as const, snapshot },
      { ...envelope, kind: 'snapshot' as const, snapshot },
      { ...envelope, kind: 'response' as const, requestId: 'request:command', operation: 'command' as const,
        ok: true as const, appliedRevision: 0, replayed: false, snapshot },
      { ...envelope, kind: 'response' as const, requestId: 'request:2', operation: 'command' as const, ok: false as const,
        error: { code: 'revision-conflict', message: 'Révision périmée.' } },
    ]
    for (const frame of frames) {
      const encoded = encodeHgssCampaignPeerFrame(frame)
      expect(decodeHgssCampaignPeerFrame(encoded)).toEqual(frame)
      expect(Object.isFrozen(decodeHgssCampaignPeerFrame(encoded))).toBe(true)
    }
  })

  it('rejette versions, clés et charges applicatives inconnues', () => {
    const envelope = createHgssCampaignPeerEnvelope()
    expect(parseHgssCampaignPeerFrame({ ...envelope, kind: 'request', requestId: 'request:1', operation: 'snapshot', extra: true })).toBeUndefined()
    expect(parseHgssCampaignPeerFrame({ ...envelope, protocolVersion: 1, kind: 'request', requestId: 'request:1', operation: 'snapshot' })).toBeUndefined()
    expect(parseHgssCampaignPeerFrame({ ...envelope, kind: 'snapshot', snapshot: { ...snapshot, revision: -1 } })).toBeUndefined()
    expect(parseHgssCampaignPeerFrame({ ...envelope, kind: 'response', requestId: 'request:1', operation: 'command', ok: false,
      error: { code: 'INVALID', message: 'non' } })).toBeUndefined()
    expect(decodeHgssCampaignPeerFrame('{json cassé')).toBeUndefined()

    const accessor = { ...envelope, kind: 'request', requestId: 'request:1', operation: 'snapshot' }
    Object.defineProperty(accessor, 'operation', { enumerable: true, get: () => 'snapshot' })
    expect(parseHgssCampaignPeerFrame(accessor)).toBeUndefined()
  })
})
