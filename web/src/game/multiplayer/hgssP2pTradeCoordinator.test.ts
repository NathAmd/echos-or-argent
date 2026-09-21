import { describe, expect, it } from 'vitest'
import type { PokemonInstanceId } from '../pokemon/pokemonInstanceId'
import {
  createHgssP2pTradeCoordinator,
  type HgssP2pTradeCommitRequest,
  type HgssP2pTradeCommitResult,
  type HgssP2pTradeEscrowPort,
  type HgssP2pTradePrepareRequest,
  type HgssP2pTradeRollbackReason,
} from './hgssP2pTradeCoordinator'
import {
  hgssP2pTradeProtocol,
  hgssP2pTradeProtocolVersion,
  parseHgssP2pTradePokemonSnapshot,
  type HgssP2pTradeFrame,
  type HgssP2pTradePokemonSnapshot,
} from './hgssP2pTradeProtocol'

const sessionId = 'A'.repeat(22)
const transactionId = `${'B'.repeat(21)}A`

function pokemonId(byte: string): PokemonInstanceId {
  return `pkm:v1:r:${byte.repeat(32)}` as PokemonInstanceId
}

function pokemon(byte: string, speciesId: number): HgssP2pTradePokemonSnapshot {
  const parsed = parseHgssP2pTradePokemonSnapshot({
    instanceId: pokemonId(byte),
    speciesId,
    form: 0,
    personality: Number.parseInt(byte.repeat(8), 16) >>> 0,
    originalTrainer: { id: Number.parseInt(byte.repeat(8), 16) >>> 0, gender: 'male', name: `OT${byte}`, nameSource: 'user-text' },
    origin: { language: 2, gameVersion: 7, metLocation: 1, metLevel: 20, metTerrain: 0 },
    level: 25,
    experience: 15_625,
    individualValues: { hp: 31, attack: 30, defense: 29, speed: 28, specialAttack: 27, specialDefense: 26 },
    effortValues: { hp: 0, attack: 0, defense: 0, speed: 0, specialAttack: 0, specialDefense: 0 },
    nature: 0,
    gender: 'male',
    abilityId: 1,
    shiny: false,
    friendship: 70,
    moves: [{ moveId: 1, pp: 35, maxPp: 35, ppUps: 0 }],
    stats: { hp: 60, attack: 40, defense: 40, speed: 40, specialAttack: 40, specialDefense: 40 },
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

class TestEscrow implements HgssP2pTradeEscrowPort {
  readonly preparations: HgssP2pTradePrepareRequest[] = []
  readonly commits: HgssP2pTradeCommitRequest[] = []
  readonly rollbacks: Array<{ request: HgssP2pTradePrepareRequest, reason: HgssP2pTradeRollbackReason }> = []
  readonly committedTransactions = new Set<string>()
  failPrepare = false
  failCommitCount = 0
  private readonly participantId: string

  constructor(participantId: string) {
    this.participantId = participantId
  }

  prepare = (request: HgssP2pTradePrepareRequest) => {
    this.preparations.push(request)
    if (this.failPrepare) throw new Error('escrow-refused')
    return { reservationId: `${this.participantId}:reservation` }
  }

  commit = (request: HgssP2pTradeCommitRequest): HgssP2pTradeCommitResult => {
    this.commits.push(request)
    if (this.failCommitCount > 0) {
      this.failCommitCount -= 1
      throw new Error('commit-storage-failure')
    }
    const alreadyCommitted = this.committedTransactions.has(request.transactionId)
    this.committedTransactions.add(request.transactionId)
    const evolves = request.incoming.speciesId === 64
    return {
      status: alreadyCommitted ? 'already-committed' : 'committed',
      receipt: {
        transactionId: request.transactionId,
        sentPokemonInstanceId: request.outgoing.instanceId,
        receivedPokemonInstanceId: request.incoming.instanceId,
      },
      outgoingPokemonId: request.outgoing.instanceId,
      incomingPokemonId: request.incoming.instanceId,
      receivedSpeciesId: evolves ? 65 : request.incoming.speciesId,
      destination: { kind: 'party', slot: 0 },
      ...(evolves ? {
        evolution: {
          sourceSpeciesId: 64,
          targetSpeciesId: 65,
          learnedMoveIds: [100],
          skippedMoveIds: [],
        },
      } : {}),
    }
  }

  rollback = (
    request: HgssP2pTradePrepareRequest,
    _reservation: { reservationId: string },
    reason: HgssP2pTradeRollbackReason,
  ) => {
    this.rollbacks.push({ request, reason })
  }
}

function harness() {
  const aliceOutbound: HgssP2pTradeFrame[] = []
  const bobOutbound: HgssP2pTradeFrame[] = []
  const aliceEscrow = new TestEscrow('alice')
  const bobEscrow = new TestEscrow('bob')
  let clock = 1_000
  const common = { sessionId, transactionId, timeoutMs: 500, now: () => clock }
  const alice = createHgssP2pTradeCoordinator({
    ...common,
    localParticipantId: 'alice',
    remoteParticipantId: 'bob',
    escrow: aliceEscrow,
    send: (frame) => { aliceOutbound.push(frame) },
  })
  const bob = createHgssP2pTradeCoordinator({
    ...common,
    localParticipantId: 'bob',
    remoteParticipantId: 'alice',
    escrow: bobEscrow,
    send: (frame) => { bobOutbound.push(frame) },
  })

  const deliverAlice = async () => {
    const frame = aliceOutbound.shift()
    if (frame) await bob.receive(frame)
    return Boolean(frame)
  }
  const deliverBob = async () => {
    const frame = bobOutbound.shift()
    if (frame) await alice.receive(frame)
    return Boolean(frame)
  }
  const settle = async () => {
    for (let turn = 0; turn < 100; turn += 1) {
      const progressed = await deliverAlice() || await deliverBob()
      if (!progressed) return
    }
    throw new Error('Boucle de livraison P2P non stabilisée.')
  }
  const exchangeOffers = async () => {
    await alice.offer(pokemon('1', 64))
    await bob.offer(pokemon('2', 67))
    await settle()
  }
  const prepareWithoutCrossDelivery = async () => {
    await exchangeOffers()
    await alice.accept()
    await deliverAlice()
    await bob.accept()
    await deliverBob() // accept bob -> alice; les deux escrows sont prêts
    expect(alice.getSnapshot().localPrepared).toBe(true)
    expect(bob.getSnapshot().localPrepared).toBe(true)
  }
  return {
    alice, bob, aliceEscrow, bobEscrow, aliceOutbound, bobOutbound,
    settle, deliverAlice, deliverBob, exchangeOffers, prepareWithoutCrossDelivery,
    advance: (milliseconds: number) => { clock += milliseconds },
  }
}

describe("coordinateur transactionnel d'échange P2P HGSS", () => {
  it("reste en négociation à l'état initial et tant qu'une seule offre est connue", async () => {
    const test = harness()

    expect(test.alice.getSnapshot()).toMatchObject({
      status: 'negotiating',
      localAccepted: false,
      remoteAccepted: false,
      localPrepared: false,
      remotePrepared: false,
    })
    expect(test.bob.getSnapshot().status).toBe('negotiating')

    await test.alice.offer(pokemon('1', 64))
    const localOfferOnly = test.alice.getSnapshot()
    expect(localOfferOnly).toMatchObject({
      status: 'negotiating',
      localOffer: { revision: 1 },
    })
    expect(localOfferOnly.remoteOffer).toBeUndefined()

    await test.deliverAlice()
    const remoteOfferOnly = test.bob.getSnapshot()
    expect(remoteOfferOnly).toMatchObject({
      status: 'negotiating',
      remoteOffer: { revision: 1 },
      localPrepared: false,
      remotePrepared: false,
    })
    expect(remoteOfferOnly.localOffer).toBeUndefined()
  })

  it('attend deux acceptations explicites de la même paire avant tout escrow ou commit', async () => {
    const test = harness()
    await test.exchangeOffers()
    expect(test.alice.getSnapshot()).toMatchObject({
      status: 'negotiating',
      localOffer: { revision: 1, preview: { speciesId: 64 } },
      remoteOffer: { revision: 1, preview: { speciesId: 67 } },
      localAccepted: false,
      remoteAccepted: false,
    })
    await test.alice.accept()
    await test.settle()
    expect(test.alice.getSnapshot()).toMatchObject({ localAccepted: true, remoteAccepted: false })
    expect(test.bob.getSnapshot()).toMatchObject({ localAccepted: false, remoteAccepted: true })
    expect(test.aliceEscrow.preparations).toHaveLength(0)
    expect(test.bobEscrow.preparations).toHaveLength(0)

    await test.bob.accept()
    await test.settle()
    expect(test.alice.getSnapshot()).toMatchObject({ status: 'committed', authorityId: 'alice' })
    expect(test.bob.getSnapshot()).toMatchObject({ status: 'committed', authorityId: 'alice' })
    expect(test.aliceEscrow.commits).toHaveLength(1)
    expect(test.bobEscrow.commits).toHaveLength(1)
    expect(test.bob.getSnapshot().commitResult).toMatchObject({
      receivedSpeciesId: 65,
      evolution: { sourceSpeciesId: 64, targetSpeciesId: 65 },
    })
  })

  it("révoque les deux acceptations dès qu'une offre change et ignore l'ancienne acceptation rejouée", async () => {
    const test = harness()
    await test.exchangeOffers()
    const stalePair = test.alice.getSnapshot().pair!
    await test.alice.accept()
    await test.settle()
    await test.alice.offer(pokemon('3', 92))
    await test.settle()
    expect(test.alice.getSnapshot()).toMatchObject({ localAccepted: false, remoteAccepted: false })
    expect(test.bob.getSnapshot()).toMatchObject({ localAccepted: false, remoteAccepted: false })
    expect(await test.alice.receive({
      protocol: hgssP2pTradeProtocol,
      protocolVersion: hgssP2pTradeProtocolVersion,
      sessionId,
      transactionId,
      senderId: 'bob',
      kind: 'accept',
      pair: stalePair,
    })).toMatchObject({ kind: 'stale', reason: 'stale-pair' })
    expect(test.aliceEscrow.commits).toHaveLength(0)
  })

  it('libère les deux escrows si une offre préparée est modifiée avant la décision de commit', async () => {
    const test = harness()
    await test.prepareWithoutCrossDelivery()
    await test.alice.offer(pokemon('3', 92))
    expect(test.aliceEscrow.rollbacks.map(({ reason }) => reason)).toEqual(['offer-changed'])
    await test.settle()
    expect(test.bobEscrow.rollbacks.map(({ reason }) => reason)).toEqual(['offer-changed'])
    expect(test.alice.getSnapshot()).toMatchObject({ status: 'negotiating', localAccepted: false, remoteAccepted: false })
    expect(test.bob.getSnapshot()).toMatchObject({ status: 'negotiating', localAccepted: false, remoteAccepted: false })
  })

  it('annule et libère les escrows des deux côtés avant commit', async () => {
    const test = harness()
    await test.prepareWithoutCrossDelivery()
    expect(await test.alice.cancel()).toBe(true)
    await test.settle()
    expect(test.alice.getSnapshot()).toMatchObject({ status: 'cancelled', cancelReason: 'user' })
    expect(test.bob.getSnapshot()).toMatchObject({ status: 'cancelled', cancelReason: 'user' })
    expect(test.aliceEscrow.rollbacks).toHaveLength(1)
    expect(test.bobEscrow.rollbacks).toHaveLength(1)
    expect(test.aliceEscrow.commits).toHaveLength(0)
    expect(test.bobEscrow.commits).toHaveLength(0)
  })

  it('expire sans mutation et rend la déconnexion pré-commit sûre', async () => {
    const timeout = harness()
    await timeout.prepareWithoutCrossDelivery()
    timeout.advance(501)
    expect(await timeout.alice.tick()).toBe(true)
    await timeout.settle()
    expect(timeout.alice.getSnapshot()).toMatchObject({ status: 'cancelled', cancelReason: 'timeout' })
    expect(timeout.aliceEscrow.rollbacks[0]?.reason).toBe('timeout')
    expect(timeout.bobEscrow.commits).toHaveLength(0)

    const disconnected = harness()
    await disconnected.prepareWithoutCrossDelivery()
    await disconnected.alice.disconnect()
    expect(disconnected.alice.getSnapshot()).toMatchObject({ status: 'cancelled', cancelReason: 'disconnect' })
    expect(disconnected.aliceEscrow.rollbacks[0]?.reason).toBe('disconnect')
  })

  it('refuse un conflit sur une même révision et rollback l’escrow au lieu de continuer', async () => {
    const test = harness()
    await test.prepareWithoutCrossDelivery()
    const decision = await test.alice.receive({
      protocol: hgssP2pTradeProtocol,
      protocolVersion: hgssP2pTradeProtocolVersion,
      sessionId,
      transactionId,
      senderId: 'bob',
      kind: 'offer',
      revision: 1,
      pokemon: pokemon('4', 74),
    })
    expect(decision.kind).toBe('applied')
    expect(test.alice.getSnapshot()).toMatchObject({ status: 'cancelled', cancelReason: 'protocol-error' })
    expect(test.aliceEscrow.rollbacks[0]?.reason).toBe('protocol-error')
    expect(test.aliceEscrow.commits).toHaveLength(0)
  })

  it('rend le commit et son accusé idempotents face aux duplications réseau', async () => {
    const test = harness()
    await test.prepareWithoutCrossDelivery()
    await test.deliverBob() // prepared bob -> autorité alice, qui commit et émet commit
    expect(test.alice.getSnapshot()).toMatchObject({ status: 'commit-pending', needsRecovery: true })
    expect(await test.alice.cancel()).toBe(false)
    await test.alice.disconnect()
    expect(test.aliceEscrow.rollbacks).toHaveLength(0)
    await test.alice.resume() // réémet le commit sans remuter localement
    await test.settle()
    expect(test.alice.getSnapshot().status).toBe('committed')
    expect(test.bob.getSnapshot().status).toBe('committed')
    expect(test.aliceEscrow.commits).toHaveLength(1)
    expect(test.bobEscrow.commits).toHaveLength(1)
    expect(test.aliceEscrow.rollbacks).toHaveLength(0)
    expect(test.bobEscrow.rollbacks).toHaveLength(0)
  })

  it('reste en reprise si le stockage échoue après décision, puis termine sans rollback', async () => {
    const test = harness()
    test.aliceEscrow.failCommitCount = 1
    await test.prepareWithoutCrossDelivery()
    await expect(test.deliverBob()).rejects.toThrow('commit-storage-failure')
    expect(test.alice.getSnapshot()).toMatchObject({ status: 'commit-pending', needsRecovery: true })
    expect(test.aliceEscrow.rollbacks).toHaveLength(0)
    await test.alice.resume()
    await test.settle()
    expect(test.alice.getSnapshot().status).toBe('committed')
    expect(test.bob.getSnapshot().status).toBe('committed')
    expect(test.aliceEscrow.commits).toHaveLength(2)
    expect(test.aliceEscrow.committedTransactions.size).toBe(1)
  })

  it('annule proprement si le port local refuse la préparation', async () => {
    const test = harness()
    test.bobEscrow.failPrepare = true
    await test.exchangeOffers()
    await test.alice.accept()
    await test.deliverAlice()
    await expect(test.bob.accept()).rejects.toThrow('escrow-refused')
    await test.settle()
    expect(test.bob.getSnapshot()).toMatchObject({ status: 'cancelled', cancelReason: 'local-rejected' })
    expect(test.alice.getSnapshot()).toMatchObject({ status: 'cancelled', cancelReason: 'local-rejected' })
    expect(test.aliceEscrow.commits).toHaveLength(0)
  })

  it('ignore les trames invalides, étrangères et usurpées sans toucher aux offres', async () => {
    const test = harness()
    await test.exchangeOffers()
    const before = test.alice.getSnapshot()
    expect(await test.alice.receive({ nope: true })).toEqual({ kind: 'ignored', reason: 'invalid-frame' })
    expect(await test.alice.receive({
      protocol: hgssP2pTradeProtocol,
      protocolVersion: hgssP2pTradeProtocolVersion,
      sessionId: `${'C'.repeat(21)}A`,
      transactionId,
      senderId: 'bob',
      kind: 'offer',
      revision: 2,
      pokemon: pokemon('3', 92),
    })).toEqual({ kind: 'ignored', reason: 'foreign-transaction' })
    expect(await test.alice.receive({
      protocol: hgssP2pTradeProtocol,
      protocolVersion: hgssP2pTradeProtocolVersion,
      sessionId,
      transactionId,
      senderId: 'mallory',
      kind: 'offer',
      revision: 2,
      pokemon: pokemon('3', 92),
    })).toEqual({ kind: 'ignored', reason: 'unexpected-sender' })
    expect(test.alice.getSnapshot()).toEqual(before)
    expect(Object.isFrozen(before)).toBe(true)
  })
})
