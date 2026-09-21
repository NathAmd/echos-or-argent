import { describe, expect, it } from 'vitest'
import {
  classifyP2pSessionIntentSequence,
  decodeP2pSessionIntentFrame,
  encodeP2pSessionIntentFrame,
  p2pSessionIntentMaximumWireBytes,
  p2pSessionIntentProtocol,
  p2pSessionIntentProtocolVersion,
  parseP2pSessionIntentFrame,
  type P2pSessionIntentFrame,
} from './p2pSessionIntentProtocol'

const sessionId = `${'S'.repeat(21)}A`

function frame(kind: 'offer' | 'accept', intent: 'trade' | 'pvp' | 'coop'): P2pSessionIntentFrame {
  return {
    protocol: p2pSessionIntentProtocol,
    protocolVersion: p2pSessionIntentProtocolVersion,
    sessionId,
    senderId: kind === 'offer' ? 'alice' : 'bob',
    receiverId: kind === 'offer' ? 'bob' : 'alice',
    sequence: 1,
    kind,
    intent,
  }
}

describe("protocole d'intention de session P2P", () => {
  it('encode les trois intentions et la décision de refus sans libellé métier', () => {
    const frames: P2pSessionIntentFrame[] = [
      frame('offer', 'trade'),
      frame('accept', 'pvp'),
      frame('offer', 'coop'),
      {
        ...frame('accept', 'pvp'),
        kind: 'reject',
        reason: 'intent-mismatch',
      },
      {
        ...frame('accept', 'coop'),
        kind: 'reject',
        reason: 'user-declined',
      },
    ]
    for (const value of frames) {
      const decoded = decodeP2pSessionIntentFrame(encodeP2pSessionIntentFrame(value))
      expect(decoded).toEqual(value)
      expect(Object.isFrozen(decoded)).toBe(true)
    }
  })

  it('rejette les clés inconnues, identités inverses, séquences et tailles invalides', () => {
    const valid = frame('offer', 'trade')
    expect(parseP2pSessionIntentFrame({ ...valid, extra: true })).toBeUndefined()
    expect(parseP2pSessionIntentFrame({ ...valid, receiverId: 'alice' })).toBeUndefined()
    expect(parseP2pSessionIntentFrame({ ...valid, sequence: 2 })).toBeUndefined()
    expect(parseP2pSessionIntentFrame({ ...valid, intent: 'legacy-trade' })).toBeUndefined()
    expect(parseP2pSessionIntentFrame({
      ...valid,
      kind: 'reject',
      reason: 'unknown-reason',
    })).toBeUndefined()
    expect(decodeP2pSessionIntentFrame('x'.repeat(p2pSessionIntentMaximumWireBytes + 1)))
      .toBeUndefined()
  })

  it('classe la première décision et son replay exact', () => {
    expect(classifyP2pSessionIntentSequence(0, 1)).toBe('next')
    expect(classifyP2pSessionIntentSequence(1, 1)).toBe('replay')
    expect(() => classifyP2pSessionIntentSequence(0, 2)).toThrow('séquence')
  })
})
