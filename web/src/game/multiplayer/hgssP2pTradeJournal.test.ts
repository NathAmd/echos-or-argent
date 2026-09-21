import { describe, expect, it } from 'vitest'
import type { PokemonInstanceId } from '../pokemon/pokemonInstanceId'
import {
  areHgssP2pTradeJournalsMirrored,
  hgssP2pTradeJournalLimit,
  parseHgssP2pTradeJournal,
  parseHgssP2pTradeJournals,
  upsertHgssP2pTradeJournal,
  type HgssP2pTradeJournal,
} from './hgssP2pTradeJournal'
import {
  createHgssP2pTradeOfferPair,
  hgssP2pTradeMaximumWireBytes,
  parseHgssP2pTradePokemonSnapshot,
  type HgssP2pTradePokemonSnapshot,
} from './hgssP2pTradeProtocol'

const sessionId = `${'S'.repeat(21)}A`

function opaqueId(index: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'
  return `${alphabet[index % alphabet.length]!.repeat(21)}A`
}

function pokemonId(index: number): PokemonInstanceId {
  return `pkm:v1:r:${index.toString(16).padStart(32, '0')}` as PokemonInstanceId
}

function pokemon(index: number, speciesId: number): HgssP2pTradePokemonSnapshot {
  const snapshot = parseHgssP2pTradePokemonSnapshot({
    instanceId: pokemonId(index),
    speciesId,
    form: 0,
    personality: index,
    originalTrainer: {
      id: index,
      gender: index % 2 === 0 ? 'female' : 'male',
      name: index % 2 === 0 ? 'ALICE' : 'BOB',
      nameSource: 'user-text',
    },
    origin: { language: 2, gameVersion: 7, metLocation: 1, metLevel: 20, metTerrain: 0 },
    level: 25,
    experience: 15_625,
    individualValues: { hp: 31, attack: 30, defense: 29, speed: 28, specialAttack: 27, specialDefense: 26 },
    effortValues: { hp: 0, attack: 0, defense: 0, speed: 0, specialAttack: 0, specialDefense: 0 },
    nature: 0,
    gender: index % 2 === 0 ? 'female' : 'male',
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
  if (!snapshot) throw new Error('Fixture Pokemon P2P invalide.')
  return snapshot
}

function journal(
  index = 1,
  phase: 'prepared' | 'committed' = 'prepared',
): HgssP2pTradeJournal {
  const outgoing = pokemon(index * 2, 152)
  const incoming = pokemon(index * 2 + 1, 155)
  const pair = createHgssP2pTradeOfferPair(
    { participantId: 'alice', revision: index, pokemonId: outgoing.instanceId },
    { participantId: 'bob', revision: index, pokemonId: incoming.instanceId },
  )
  const base = {
    schemaVersion: 1 as const,
    sessionId,
    transactionId: opaqueId(index),
    localParticipantId: 'alice',
    remoteParticipantId: 'bob',
    pair,
    outgoing,
    incoming,
    destination: index <= 6
      ? { kind: 'party' as const, slot: index - 1 }
      : { kind: 'storage' as const, box: 0, slot: index - 7 },
  }
  return phase === 'prepared'
    ? { ...base, phase }
    : { ...base, phase, result: { receivedSpeciesId: incoming.speciesId } }
}

function mirroredJournal(source: HgssP2pTradeJournal): HgssP2pTradeJournal {
  if (source.phase !== 'prepared') throw new Error('La fixture miroir attend un journal prepare.')
  return {
    schemaVersion: source.schemaVersion,
    sessionId: source.sessionId,
    transactionId: source.transactionId,
    localParticipantId: source.remoteParticipantId,
    remoteParticipantId: source.localParticipantId,
    pair: source.pair,
    outgoing: source.incoming,
    incoming: source.outgoing,
    destination: { kind: 'storage', box: 0, slot: 0 },
    phase: 'prepared',
  }
}

describe("journal durable d'echange P2P HGSS", () => {
  it('parse et recopie defensivement les phases prepared et committed', () => {
    const prepared = journal(1, 'prepared')
    const committed = {
      ...journal(2, 'prepared'),
      phase: 'committed' as const,
      result: {
        receivedSpeciesId: 156,
        evolution: {
          sourceSpeciesId: 155,
          targetSpeciesId: 156,
          learnedMoveIds: [45],
          skippedMoveIds: [46],
        },
      },
    }

    const parsedPrepared = parseHgssP2pTradeJournal(prepared)
    const parsedCommitted = parseHgssP2pTradeJournal(committed)

    expect(parsedPrepared).toEqual(prepared)
    expect(parsedCommitted).toEqual(committed)
    expect(parsedPrepared).not.toBe(prepared)
    expect(parsedPrepared.outgoing).not.toBe(prepared.outgoing)
    expect(Object.isFrozen(parsedPrepared)).toBe(true)
    expect(Object.isFrozen(parsedPrepared.outgoing.moves)).toBe(true)
    expect(Object.isFrozen(parsedCommitted.phase === 'committed' && parsedCommitted.result.evolution)).toBe(true)
  })

  it('autorise uniquement la transition monotone prepared vers committed', () => {
    const prepared = journal(1, 'prepared')
    const committed = journal(1, 'committed')
    const preparedState = upsertHgssP2pTradeJournal([], prepared)
    const committedState = upsertHgssP2pTradeJournal(preparedState, committed)

    expect(committedState).toEqual([committed])
    expect(() => upsertHgssP2pTradeJournal(committedState, prepared)).toThrow(/ne peut pas revenir/)

    const rewrittenResult: HgssP2pTradeJournal = {
      ...committed,
      phase: 'committed',
      result: {
        receivedSpeciesId: 156,
        evolution: {
          sourceSpeciesId: committed.incoming.speciesId,
          targetSpeciesId: 156,
          learnedMoveIds: [],
          skippedMoveIds: [],
        },
      },
    }
    expect(() => upsertHgssP2pTradeJournal(committedState, rewrittenResult)).toThrow(/autre contenu|commit/)
  })

  it('reconnait uniquement deux journaux miroirs de la meme transaction', () => {
    const local = journal(1, 'prepared')
    const remote = mirroredJournal(local)

    expect(areHgssP2pTradeJournalsMirrored(local, remote)).toBe(true)
    expect(areHgssP2pTradeJournalsMirrored(local, local)).toBe(false)
    expect(areHgssP2pTradeJournalsMirrored(local, {
      ...remote,
      sessionId: opaqueId(17),
    })).toBe(false)
  })

  it('rejette les cles inconnues et les charges surdimensionnees', () => {
    const valid = journal(1)
    expect(() => parseHgssP2pTradeJournal({ ...valid, schemaVersion: 2 })).toThrow(/invalide/)
    expect(() => parseHgssP2pTradeJournal({ ...valid, resolvedRomText: 'interdit' }))
      .toThrow(/invalide/)
    expect(() => parseHgssP2pTradeJournal({
      ...valid,
      destination: { ...valid.destination, extra: true },
    })).toThrow(/invalide/)

    const oversized = structuredClone(valid) as unknown as {
      outgoing: { nickname?: string, nicknameSource?: string }
    }
    oversized.outgoing.nickname = 'X'.repeat(hgssP2pTradeMaximumWireBytes)
    oversized.outgoing.nicknameSource = 'user-text'
    expect(new TextEncoder().encode(JSON.stringify(oversized)).byteLength)
      .toBeGreaterThan(hgssP2pTradeMaximumWireBytes)
    expect(() => parseHgssP2pTradeJournal(oversized)).toThrow(/invalide|taille|maximale/)
  })

  it('borne l historique a huit journaux et refuse toute identite Pokemon partagee', () => {
    const maximum = Array.from({ length: hgssP2pTradeJournalLimit }, (_, index) => journal(index + 1))
    expect(parseHgssP2pTradeJournals(maximum)).toHaveLength(hgssP2pTradeJournalLimit)
    expect(() => parseHgssP2pTradeJournals([...maximum, journal(hgssP2pTradeJournalLimit + 1)]))
      .toThrow(/historique/)

    const first = journal(1)
    const second = journal(2)
    const sharedOutgoing = first.outgoing
    const conflictingPair = createHgssP2pTradeOfferPair(
      { participantId: second.localParticipantId, revision: 9, pokemonId: sharedOutgoing.instanceId },
      { participantId: second.remoteParticipantId, revision: 9, pokemonId: second.incoming.instanceId },
    )
    const conflict: HgssP2pTradeJournal = {
      ...second,
      pair: conflictingPair,
      outgoing: sharedOutgoing,
    }
    expect(() => parseHgssP2pTradeJournals([first, conflict])).toThrow(/plusieurs transactions/)
  })
})
