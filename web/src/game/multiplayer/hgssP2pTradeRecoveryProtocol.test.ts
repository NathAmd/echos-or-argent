import { describe, expect, it } from 'vitest'
import type { PokemonInstanceId } from '../pokemon/pokemonInstanceId'
import type { HgssP2pTradeJournal } from './hgssP2pTradeJournal'
import {
  createHgssP2pTradeOfferPair,
  parseHgssP2pTradePokemonSnapshot,
  type HgssP2pTradePokemonSnapshot,
} from './hgssP2pTradeProtocol'
import {
  classifyHgssP2pTradeRecoverySequence,
  decodeHgssP2pTradeRecoveryFrame,
  encodeHgssP2pTradeRecoveryFrame,
  hgssP2pTradeRecoveryMaximumWireBytes,
  hgssP2pTradeRecoveryProtocol,
  hgssP2pTradeRecoveryProtocolVersion,
  parseHgssP2pTradeRecoveryFrame,
  type HgssP2pTradeRecoveryFrame,
} from './hgssP2pTradeRecoveryProtocol'

const originalSessionId = `${'S'.repeat(21)}A`
const recoverySessionId = `${'R'.repeat(21)}Q`
const transactionId = 'A'.repeat(22)
const secondTransactionId = `${'C'.repeat(21)}g`

function pokemonId(byte: string): PokemonInstanceId {
  return `pkm:v1:r:${byte.repeat(32)}` as PokemonInstanceId
}

function pokemon(byte: string, speciesId: number): HgssP2pTradePokemonSnapshot {
  const parsed = parseHgssP2pTradePokemonSnapshot({
    instanceId: pokemonId(byte),
    speciesId,
    form: 0,
    personality: Number.parseInt(byte.repeat(8), 16) >>> 0,
    originalTrainer: { id: 1, gender: 'female', name: 'ALICE', nameSource: 'user-text' },
    origin: { language: 2, gameVersion: 7, metLocation: 1, metLevel: 20, metTerrain: 0 },
    level: 25,
    experience: 15_625,
    individualValues: { hp: 31, attack: 30, defense: 29, speed: 28, specialAttack: 27, specialDefense: 26 },
    effortValues: { hp: 0, attack: 0, defense: 0, speed: 0, specialAttack: 0, specialDefense: 0 },
    nature: 0,
    gender: 'female',
    abilityId: 1,
    shiny: false,
    friendship: 70,
    moves: [{ moveId: 33, pp: 35, maxPp: 35, ppUps: 0 }],
    stats: { hp: 60, attack: 41, defense: 42, speed: 43, specialAttack: 44, specialDefense: 45 },
    currentHp: 60,
    status: 0,
    heldItemId: 0,
    ballId: 4,
    isEgg: false,
    fatefulEncounter: false,
    shinyLeafMask: 0,
    contestValues: [0, 0, 0, 0, 0, 0],
    ribbonIds: [],
  })
  if (!parsed) throw new Error('Fixture Pokémon invalide.')
  return parsed
}

function journal(phase: 'prepared' | 'committed' = 'prepared'): HgssP2pTradeJournal {
  const outgoing = pokemon('1', 152)
  const incoming = pokemon('2', 155)
  const pair = createHgssP2pTradeOfferPair(
    { participantId: 'alice', revision: 1, pokemonId: outgoing.instanceId },
    { participantId: 'bob', revision: 1, pokemonId: incoming.instanceId },
  )
  return {
    schemaVersion: 1,
    sessionId: originalSessionId,
    transactionId,
    localParticipantId: 'alice',
    remoteParticipantId: 'bob',
    pair,
    outgoing,
    incoming,
    destination: { kind: 'party', slot: 0 },
    phase,
    ...(phase === 'committed' ? { result: { receivedSpeciesId: incoming.speciesId } } : {}),
  } as HgssP2pTradeJournal
}

function envelope(sequence: number) {
  return {
    protocol: hgssP2pTradeRecoveryProtocol,
    protocolVersion: hgssP2pTradeRecoveryProtocolVersion,
    recoverySessionId,
    senderId: 'alice',
    receiverId: 'bob',
    sequence,
  } as const
}

describe('protocole de réconciliation des échanges P2P', () => {
  it('encode et recopie défensivement inventaire, journal et confirmation', () => {
    const frames: HgssP2pTradeRecoveryFrame[] = [
      {
        ...envelope(1),
        kind: 'sync-start',
        journals: [
          { transactionId, phase: 'prepared' },
          { transactionId: secondTransactionId, phase: 'committed' },
        ],
      },
      { ...envelope(2), kind: 'journal', journal: journal('committed') },
      {
        ...envelope(3),
        kind: 'confirm',
        transactionId,
        disposition: 'confirmed-committed',
      },
    ]

    for (const frame of frames) {
      const decoded = decodeHgssP2pTradeRecoveryFrame(encodeHgssP2pTradeRecoveryFrame(frame))
      expect(decoded).toEqual(frame)
      expect(Object.isFrozen(decoded)).toBe(true)
    }
  })

  it('rejette les clés en trop, inventaires ambigus et journaux d’un autre pair', () => {
    const valid = {
      ...envelope(1),
      kind: 'sync-start',
      journals: [{ transactionId, phase: 'prepared' }],
    } as const
    expect(parseHgssP2pTradeRecoveryFrame({ ...valid, extra: true })).toBeUndefined()
    expect(parseHgssP2pTradeRecoveryFrame({
      ...valid,
      journals: [
        { transactionId: secondTransactionId, phase: 'committed' },
        { transactionId, phase: 'prepared' },
      ],
    })).toBeUndefined()
    expect(parseHgssP2pTradeRecoveryFrame({
      ...envelope(2),
      kind: 'journal',
      journal: { ...journal(), localParticipantId: 'mallory' },
    })).toBeUndefined()
    expect(decodeHgssP2pTradeRecoveryFrame('x'.repeat(hgssP2pTradeRecoveryMaximumWireBytes + 1)))
      .toBeUndefined()
  })

  it('classe strictement la prochaine séquence, les replays et les trous', () => {
    expect(classifyHgssP2pTradeRecoverySequence(0, 1)).toBe('next')
    expect(classifyHgssP2pTradeRecoverySequence(4, 4)).toBe('replay')
    expect(classifyHgssP2pTradeRecoverySequence(4, 2)).toBe('replay')
    expect(classifyHgssP2pTradeRecoverySequence(4, 6)).toBe('gap')
    expect(() => classifyHgssP2pTradeRecoverySequence(-1, 1)).toThrow('séquence')
  })
})
