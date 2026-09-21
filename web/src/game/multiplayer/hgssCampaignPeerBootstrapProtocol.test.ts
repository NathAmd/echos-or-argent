import { describe, expect, it } from 'vitest'
import {
  createHgssCampaignPeerBootstrapEnvelope,
  decodeHgssCampaignPeerBootstrapFrame,
  encodeHgssCampaignPeerBootstrapFrame,
  parseHgssCampaignPeerBootstrapFrame,
  type HgssCampaignPeerBootstrapFrame,
} from './hgssCampaignPeerBootstrapProtocol'

const envelope = createHgssCampaignPeerBootstrapEnvelope({
  sessionId: 'rtc:campaign:bootstrap',
  senderId: 'bob',
  receiverId: 'alice',
})

const hello: HgssCampaignPeerBootstrapFrame = {
  ...envelope,
  kind: 'hello',
  gameCode: 'IPKF',
  gameVersion: 7,
  language: 3,
  player: {
    displayName: 'LUTH',
    gender: 'male',
    position: { mapId: 61, x: 8, z: 12, direction: 'south' },
    spriteId: 0,
    locomotion: 'walking',
  },
}

describe('bootstrap de campagne pair-à-pair', () => {
  it('reconstruit strictement ready, hello, accept et reject', () => {
    const frames: HgssCampaignPeerBootstrapFrame[] = [
      hello,
      { ...envelope, kind: 'ready' },
      { ...envelope, kind: 'accept' },
      { ...envelope, kind: 'reject', code: 'map-mismatch', message: 'Les joueurs ne sont pas sur la même carte.' },
    ]
    for (const frame of frames) {
      const decoded = decodeHgssCampaignPeerBootstrapFrame(encodeHgssCampaignPeerBootstrapFrame(frame))
      expect(decoded).toEqual(frame)
      expect(Object.isFrozen(decoded)).toBe(true)
      if (decoded?.kind === 'hello') {
        expect(Object.isFrozen(decoded.player)).toBe(true)
        expect(Object.isFrozen(decoded.player.position)).toBe(true)
      }
    }
  })

  it('rejette les identités, routes et enveloppes ambiguës', () => {
    expect(() => createHgssCampaignPeerBootstrapEnvelope({
      sessionId: 'rtc:campaign:bootstrap', senderId: 'alice', receiverId: 'alice',
    })).toThrowError(/enveloppe bootstrap/)
    expect(parseHgssCampaignPeerBootstrapFrame({ ...hello, senderId: 'bob interdit' })).toBeUndefined()
    expect(parseHgssCampaignPeerBootstrapFrame({ ...hello, sessionId: 'route interdite!' })).toBeUndefined()
    expect(parseHgssCampaignPeerBootstrapFrame({ ...hello, extra: true })).toBeUndefined()
    expect(decodeHgssCampaignPeerBootstrapFrame('{json cassé')).toBeUndefined()
  })

  it('ferme le contrat V1 aux ROM, profils et locomotions non canoniques', () => {
    expect(parseHgssCampaignPeerBootstrapFrame({ ...hello, gameCode: 'ipkf' })).toBeUndefined()
    expect(parseHgssCampaignPeerBootstrapFrame({ ...hello, gameVersion: 256 })).toBeUndefined()
    expect(parseHgssCampaignPeerBootstrapFrame({ ...hello, language: -1 })).toBeUndefined()
    expect(parseHgssCampaignPeerBootstrapFrame({ ...hello, player: { ...hello.player, displayName: 'TROP-LONG' } })).toBeUndefined()
    expect(parseHgssCampaignPeerBootstrapFrame({ ...hello, player: { ...hello.player, locomotion: 'surfing' } })).toBeUndefined()
    expect(parseHgssCampaignPeerBootstrapFrame({ ...hello, player: { ...hello.player, spriteId: -1 } })).toBeUndefined()
    expect(parseHgssCampaignPeerBootstrapFrame({
      ...hello,
      player: { ...hello.player, position: { ...hello.player.position, direction: 'diagonal' } },
    })).toBeUndefined()
  })

  it('rejette les décisions inconnues et les messages de contrôle', () => {
    expect(parseHgssCampaignPeerBootstrapFrame({
      ...envelope, kind: 'reject', code: 'unknown', message: 'Non.',
    })).toBeUndefined()
    expect(parseHgssCampaignPeerBootstrapFrame({
      ...envelope, kind: 'reject', code: 'campaign-unavailable', message: 'ligne\ninterdite',
    })).toBeUndefined()
    expect(parseHgssCampaignPeerBootstrapFrame({ ...envelope, kind: 'accept', message: 'extra' })).toBeUndefined()
  })

  it('n’exécute aucun accesseur hostile pendant la reconstruction', () => {
    const candidate = { ...hello }
    Object.defineProperty(candidate, 'gameCode', {
      enumerable: true,
      get: () => { throw new Error('hostile') },
    })
    expect(parseHgssCampaignPeerBootstrapFrame(candidate)).toBeUndefined()
  })
})
