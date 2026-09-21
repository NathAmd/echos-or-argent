import { describe, expect, it, vi } from 'vitest'
import { cloneCanonicalPokemon, createCanonicalPokemon, type CanonicalPokemon, type PokemonTrainerIdentity } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import type { PokemonInstanceId } from '../pokemon/pokemonInstanceId'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { PokemonTeamPolicyVetoError, type PokemonTeamPolicy } from '../pokemon/pokemonTeamPolicy'
import { createFieldScriptState, type FieldPokemonRuntime, type FieldScriptState } from '../scripts/fieldScriptRunner'
import type { HgssP2pTradeCommitRequest, HgssP2pTradePrepareRequest } from './hgssP2pTradeCoordinator'
import { createHgssP2pTradeOfferPair } from './hgssP2pTradeProtocol'
import { snapshotCanonicalPokemonForP2pTrade } from './hgssP2pTradePokemonAdapter'
import type { HgssP2pTradeJournal } from './hgssP2pTradeJournal'
import {
  createHgssP2pTradeRuntimeEscrow,
  hgssInternetTradeAuxiliaryGameStatId,
  hgssInternetTradesGameStatId,
  hgssLinkTradeScoreIncrease,
} from './hgssP2pTradeRuntimeEscrow'

const sessionId = `${'S'.repeat(21)}A`
const transactionId = `${'T'.repeat(21)}Q`

function pokemonId(byte: string): PokemonInstanceId {
  return `pkm:v1:r:${byte.repeat(32)}` as PokemonInstanceId
}

function makePokemon(
  catalog: ReturnType<typeof createPokemonTestCatalog>,
  trainer: PokemonTrainerIdentity,
  speciesId: number,
  byte: string,
): CanonicalPokemon {
  return createCanonicalPokemon(catalog, {
    instanceId: pokemonId(byte),
    speciesId,
    level: 12,
    rng: createHgssLcrng(Number.parseInt(byte, 16) || 1),
    personality: { kind: 'fixed', value: (Number.parseInt(byte, 16) * 0x11111111) >>> 0 },
    individualValues: { kind: 'fixed', value: 12 },
    originalTrainer: { ...trainer },
    origin: { language: 3, gameVersion: 7, metLocation: 126, metLevel: 5, metTerrain: 12 },
    ballId: 4,
  })
}

type TestHarness = ReturnType<typeof harness>

function harness(options: Readonly<{
  teamPolicy?: PokemonTeamPolicy
  persist?: (next: FieldScriptState) => Promise<void> | void
}> = {}) {
  const catalog = createPokemonTestCatalog()
  const localTrainer: PokemonTrainerIdentity = {
    id: 0x11112222,
    name: 'ALICE',
    gender: 'female',
    nameSource: 'user-text',
    isPlayer: true,
  }
  const remoteTrainer: PokemonTrainerIdentity = {
    id: 0x33334444,
    name: 'BOB',
    gender: 'male',
    nameSource: 'user-text',
    isPlayer: true,
  }
  const outgoing = makePokemon(catalog, localTrainer, 152, '1')
  const incoming = makePokemon(catalog, remoteTrainer, 155, '2')
  const runtime: FieldPokemonRuntime = {
    catalog,
    rng: createHgssLcrng(123),
    trainer: localTrainer,
    language: 3,
    gameVersion: 7,
    now: () => new Date('2026-08-26T12:00:00.000Z'),
  }
  const holder = {
    current: createFieldScriptState('female', 'ALICE', { party: [outgoing], pokemonRuntime: runtime }),
  }
  const events: string[] = []
  const persistState = vi.fn(async (next: FieldScriptState) => {
    events.push('persist')
    await options.persist?.(next)
  })
  const publishState = vi.fn((next: FieldScriptState) => {
    events.push('publish')
    holder.current = next
  })
  const escrow = createHgssP2pTradeRuntimeEscrow({
    getState: () => holder.current,
    persistState,
    publishState,
    teamPolicy: options.teamPolicy,
  })
  const outgoingSnapshot = snapshotCanonicalPokemonForP2pTrade(outgoing, {
    catalog,
    trainer: localTrainer,
  })
  const incomingSnapshot = snapshotCanonicalPokemonForP2pTrade(incoming, {
    catalog,
    trainer: remoteTrainer,
  })
  const request: HgssP2pTradePrepareRequest = {
    sessionId,
    transactionId,
    pair: createHgssP2pTradeOfferPair(
      { participantId: 'alice', revision: 3, pokemonId: outgoing.instanceId },
      { participantId: 'bob', revision: 7, pokemonId: incoming.instanceId },
    ),
    outgoing: outgoingSnapshot,
    incoming: incomingSnapshot,
  }
  return {
    catalog,
    localTrainer,
    remoteTrainer,
    outgoing,
    incoming,
    holder,
    events,
    persistState,
    publishState,
    escrow,
    request,
  }
}

async function prepareCommit(test: TestHarness): Promise<{ reservationId: string }> {
  return test.escrow.prepare(test.request)
}

function commitRequest(
  test: TestHarness,
  reservation: { reservationId: string },
): HgssP2pTradeCommitRequest {
  return { ...test.request, reservation }
}

function mirrorCommittedJournal(local: HgssP2pTradeJournal): HgssP2pTradeJournal {
  return {
    schemaVersion: local.schemaVersion,
    sessionId: local.sessionId,
    transactionId: local.transactionId,
    localParticipantId: local.remoteParticipantId,
    remoteParticipantId: local.localParticipantId,
    pair: local.pair,
    outgoing: local.incoming,
    incoming: local.outgoing,
    destination: { kind: 'party', slot: 0 },
    phase: 'committed',
    result: { receivedSpeciesId: local.outgoing.speciesId },
  }
}

describe("escrow runtime de l'échange P2P HGSS", () => {
  it('prépare sans mutation puis persiste avant de publier un remplacement complet', async () => {
    const test = harness()
    const originalState = test.holder.current
    const reservation = await prepareCommit(test)

    expect(test.holder.current).not.toBe(originalState)
    expect(test.holder.current.party.members[0]?.instanceId).toBe(test.outgoing.instanceId)
    expect(test.holder.current.p2pTradeJournals).toMatchObject([{
      transactionId,
      phase: 'prepared',
    }])
    expect(test.escrow.isPokemonReserved(test.outgoing.instanceId)).toBe(true)
    expect(test.escrow.isPokemonReserved(test.incoming.instanceId)).toBe(true)
    expect(test.events).toEqual(['persist', 'publish'])

    const result = await test.escrow.commit(commitRequest(test, reservation))

    expect(result).toMatchObject({
      status: 'committed',
      outgoingPokemonId: test.outgoing.instanceId,
      incomingPokemonId: test.incoming.instanceId,
      receivedSpeciesId: 155,
      destination: { kind: 'party', slot: 0 },
    })
    expect(test.events).toEqual(['persist', 'publish', 'persist', 'publish'])
    expect(test.persistState).toHaveBeenCalledWith(test.holder.current)
    expect(test.holder.current).not.toBe(originalState)
    expect(originalState.party.members[0]?.instanceId).toBe(test.outgoing.instanceId)
    expect(test.holder.current.party.members[0]).toMatchObject({
      instanceId: test.incoming.instanceId,
      speciesId: 155,
      originalTrainer: { id: test.remoteTrainer.id, isPlayer: false },
    })
    expect(test.holder.current.pokedex.caughtSpeciesIds.has(155)).toBe(true)
    expect(test.holder.current.gameStats.get(hgssInternetTradesGameStatId)).toBe(1)
    expect(test.holder.current.gameStats.get(hgssInternetTradeAuxiliaryGameStatId)).toBe(1)
    expect(test.holder.current.gameScore).toBe(hgssLinkTradeScoreIncrease)
    expect(test.holder.current.p2pTradeReceipts).toEqual([{
      transactionId,
      sentPokemonInstanceId: test.outgoing.instanceId,
      receivedPokemonInstanceId: test.incoming.instanceId,
    }])
    expect(test.holder.current.p2pTradeJournals[0]).toMatchObject({ phase: 'committed' })
    expect(test.escrow.isPokemonReserved(test.incoming.instanceId)).toBe(true)
  })

  it('rend le double commit idempotent sans deuxième sauvegarde ni deuxième compteur', async () => {
    const test = harness()
    const reservation = await prepareCommit(test)
    const request = commitRequest(test, reservation)

    const first = await test.escrow.commit(request)
    const duplicate = await test.escrow.commit(request)

    expect(first.status).toBe('committed')
    expect(duplicate).toMatchObject({
      status: 'already-committed',
      receipt: first.receipt,
      receivedSpeciesId: first.receivedSpeciesId,
      destination: first.destination,
    })
    expect(test.persistState).toHaveBeenCalledTimes(2)
    expect(test.publishState).toHaveBeenCalledTimes(2)
    expect(test.holder.current.gameStats.get(hgssInternetTradesGameStatId)).toBe(1)
    expect(test.holder.current.gameScore).toBe(10)
  })

  it('reprend idempotemment depuis le reçu persisté après recréation complète de l escrow', async () => {
    const test = harness()
    const firstReservation = await prepareCommit(test)
    await test.escrow.commit(commitRequest(test, firstReservation))
    const persistedState = test.holder.current
    const resumedPersist = vi.fn()
    const resumedPublish = vi.fn()
    const resumed = createHgssP2pTradeRuntimeEscrow({
      getState: () => persistedState,
      persistState: resumedPersist,
      publishState: resumedPublish,
    })

    const recoveredReservation = await resumed.prepare(test.request)
    const result = await resumed.commit({ ...test.request, reservation: recoveredReservation })

    expect(result).toMatchObject({
      status: 'already-committed',
      receivedSpeciesId: 155,
      destination: { kind: 'party', slot: 0 },
    })
    expect(resumedPersist).not.toHaveBeenCalled()
    expect(resumedPublish).not.toHaveBeenCalled()
    expect(persistedState.p2pTradeReceipts).toHaveLength(1)
    expect(persistedState.gameStats.get(hgssInternetTradesGameStatId)).toBe(1)
  })

  it('réutilise le même escrow pour un deuxième échange et cumule reçus, stats et score une seule fois', async () => {
    const test = harness()
    const firstReservation = await prepareCommit(test)
    await test.escrow.commit(commitRequest(test, firstReservation))
    await expect(test.escrow.finalizeRecovery(transactionId, 'bob', 'confirmed-committed')).resolves.toBe(true)

    const secondIncoming = makePokemon(test.catalog, test.remoteTrainer, 158, '3')
    const secondTransactionId = `${'U'.repeat(21)}A`
    const secondOutgoing = test.holder.current.party.members[0]!
    const secondRequest: HgssP2pTradePrepareRequest = {
      sessionId,
      transactionId: secondTransactionId,
      pair: createHgssP2pTradeOfferPair(
        { participantId: 'alice', revision: 1, pokemonId: secondOutgoing.instanceId },
        { participantId: 'bob', revision: 1, pokemonId: secondIncoming.instanceId },
      ),
      outgoing: snapshotCanonicalPokemonForP2pTrade(secondOutgoing, {
        catalog: test.catalog,
        trainer: test.localTrainer,
      }),
      incoming: snapshotCanonicalPokemonForP2pTrade(secondIncoming, {
        catalog: test.catalog,
        trainer: test.remoteTrainer,
      }),
    }

    const secondReservation = await test.escrow.prepare(secondRequest)
    const secondResult = await test.escrow.commit({ ...secondRequest, reservation: secondReservation })

    expect(secondResult).toMatchObject({
      status: 'committed',
      outgoingPokemonId: test.incoming.instanceId,
      incomingPokemonId: secondIncoming.instanceId,
      receivedSpeciesId: 158,
    })
    expect(test.holder.current.party.members[0]?.instanceId).toBe(secondIncoming.instanceId)
    expect(test.holder.current.p2pTradeReceipts.map(({ transactionId }) => transactionId))
      .toEqual([transactionId, secondTransactionId])
    expect(test.holder.current.gameStats.get(hgssInternetTradesGameStatId)).toBe(2)
    expect(test.holder.current.gameStats.get(hgssInternetTradeAuxiliaryGameStatId)).toBe(2)
    expect(test.holder.current.gameScore).toBe(20)
    expect(test.persistState).toHaveBeenCalledTimes(5)
    expect(test.publishState).toHaveBeenCalledTimes(5)
  })

  it("respecte un veto NG+ player-trade avant la moindre réservation ou mutation", async () => {
    const policy: PokemonTeamPolicy = {
      vetoBattleEligibility: () => undefined,
      vetoPartyMutation: (intent) => intent.reason === 'player-trade'
        ? { code: 'ng-plus-locked', reason: 'Cette équipe NG+ ne peut pas être échangée.' }
        : undefined,
    }
    const test = harness({ teamPolicy: policy })
    const original = test.holder.current

    await expect(prepareCommit(test)).rejects.toThrow(PokemonTeamPolicyVetoError)
    expect(test.holder.current).toBe(original)
    expect(test.escrow.isPokemonReserved(test.outgoing.instanceId)).toBe(false)
    expect(test.persistState).not.toHaveBeenCalled()
  })

  it.each([
    ['équipe', (state: FieldScriptState, incoming: CanonicalPokemon) => { state.party.members.push(cloneCanonicalPokemon(incoming)) }],
    ['PC', (state: FieldScriptState, incoming: CanonicalPokemon) => { state.pokemonStorage.boxes[0]![0] = cloneCanonicalPokemon(incoming) }],
    ['Pension', (state: FieldScriptState, incoming: CanonicalPokemon) => { state.daycare.mons[0] = { pokemon: cloneCanonicalPokemon(incoming), steps: 0 } }],
    ['Parc des Amis', (state: FieldScriptState, incoming: CanonicalPokemon) => { state.palPark.migratedPokemon.push(cloneCanonicalPokemon(incoming)) }],
    ['Concours Insecte', (state: FieldScriptState, incoming: CanonicalPokemon) => {
      state.bugContest = { weekday: 2, registeredContestants: [], elapsedMinutes: 0, caughtPokemon: cloneCanonicalPokemon(incoming) }
    }],
    ['fuyards', (state: FieldScriptState, incoming: CanonicalPokemon) => {
      state.roamers.roamers[0] = {
        instanceId: incoming.instanceId,
        metLocation: 1,
        locationIndex: 0,
        individualValues: { ...incoming.individualValues },
        personality: incoming.personality,
        speciesId: incoming.speciesId,
        currentHp: incoming.currentHp,
        level: incoming.level,
        status: incoming.status,
        active: true,
      }
    }],
  ] as const)('refuse une identité reçue déjà présente dans %s', async (_label, installDuplicate) => {
    const test = harness()
    installDuplicate(test.holder.current, test.incoming)

    await expect(prepareCommit(test)).rejects.toThrow('existe déjà')
    expect(test.persistState).not.toHaveBeenCalled()
    expect(test.escrow.isPokemonReserved(test.outgoing.instanceId)).toBe(false)
  })

  it("applique l'évolution d'échange avec objet, stats, capacités et Pokédex détaillés", async () => {
    const test = harness()
    test.catalog.evolutions[155] = [{ method: 6, parameter: 99, targetSpeciesId: 156 }]
    test.catalog.personalData[156] = {
      ...test.catalog.personalData[156]!,
      baseStats: { hp: 80, attack: 90, defense: 70, speed: 60, specialAttack: 95, specialDefense: 75 },
    }
    test.catalog.speciesNames[156] = 'EVOLUTION'
    test.catalog.levelUpLearnsets[156] = [{ level: 12, moveId: 44 }]
    test.incoming.heldItemId = 99
    test.request = {
      ...test.request,
      incoming: snapshotCanonicalPokemonForP2pTrade(test.incoming, {
        catalog: test.catalog,
        trainer: test.remoteTrainer,
      }),
    }
    const reservation = await prepareCommit(test)

    const result = await test.escrow.commit(commitRequest(test, reservation))

    expect(result).toMatchObject({
      receivedSpeciesId: 156,
      evolution: {
        sourceSpeciesId: 155,
        targetSpeciesId: 156,
        consumedHeldItemId: 99,
        learnedMoveIds: [44],
        skippedMoveIds: [],
      },
    })
    expect(test.holder.current.party.members[0]).toMatchObject({ speciesId: 156, heldItemId: 0 })
    expect(test.holder.current.party.members[0]?.moves.map(({ moveId }) => moveId)).toContain(44)
    expect(test.holder.current.pokedex.caughtSpeciesIds.has(155)).toBe(true)
    expect(test.holder.current.pokedex.caughtSpeciesIds.has(156)).toBe(true)
  })

  it("soumet séparément l'évolution d'échange à la politique evolution avant toute publication", async () => {
    const reasons: string[] = []
    const policy: PokemonTeamPolicy = {
      vetoBattleEligibility: () => undefined,
      vetoPartyMutation: (intent) => {
        reasons.push(intent.reason)
        return intent.reason === 'evolution'
          ? { code: 'ng-plus-evolution-locked', reason: 'Cette évolution est interdite par le mode NG+.' }
          : undefined
      },
    }
    const test = harness({ teamPolicy: policy })
    test.catalog.evolutions[155] = [{ method: 5, parameter: 0, targetSpeciesId: 156 }]
    const original = test.holder.current

    await expect(prepareCommit(test)).rejects.toThrow(PokemonTeamPolicyVetoError)
    expect(reasons).toContain('evolution')
    expect(test.holder.current).toBe(original)
    expect(test.holder.current.party.members[0]).toMatchObject({
      instanceId: test.outgoing.instanceId,
      speciesId: 152,
    })
    expect(test.holder.current.pokedex.caughtSpeciesIds.has(155)).toBe(false)
    expect(test.holder.current.pokedex.caughtSpeciesIds.has(156)).toBe(false)
    expect(test.escrow.isPokemonReserved(test.outgoing.instanceId)).toBe(false)
    expect(test.persistState).not.toHaveBeenCalled()
    expect(test.publishState).not.toHaveBeenCalled()
  })

  it('refuse les données distantes falsifiées et détecte une offre locale modifiée après prepare', async () => {
    const remoteTampering = harness()
    remoteTampering.request = {
      ...remoteTampering.request,
      incoming: {
        ...remoteTampering.request.incoming,
        stats: {
          ...remoteTampering.request.incoming.stats,
          attack: remoteTampering.request.incoming.stats.attack + 1,
        },
      },
    }
    await expect(prepareCommit(remoteTampering)).rejects.toThrow('statistiques')
    expect(remoteTampering.persistState).not.toHaveBeenCalled()

    const localTampering = harness()
    const reservation = await prepareCommit(localTampering)
    localTampering.holder.current.party.members[0]!.friendship += 1
    await expect(localTampering.escrow.commit(commitRequest(localTampering, reservation)))
      .rejects.toThrow("a changé depuis l'acceptation")
    expect(localTampering.persistState).toHaveBeenCalledTimes(1)
    expect(localTampering.publishState).toHaveBeenCalledTimes(1)
    expect(localTampering.holder.current.party.members[0]?.instanceId).toBe(localTampering.outgoing.instanceId)
  })

  it("ne publie rien si la persistance échoue et permet de reprendre le même commit", async () => {
    let mustFail = false
    const test = harness({
      persist: async () => {
        if (mustFail) throw new Error('disk-full')
      },
    })
    const reservation = await prepareCommit(test)
    const preparedState = test.holder.current
    const request = commitRequest(test, reservation)
    mustFail = true

    await expect(test.escrow.commit(request)).rejects.toThrow('disk-full')
    expect(test.holder.current).toBe(preparedState)
    expect(test.holder.current.p2pTradeReceipts).toEqual([])
    expect(test.holder.current.gameStats.has(hgssInternetTradesGameStatId)).toBe(false)
    expect(test.publishState).toHaveBeenCalledTimes(1)
    expect(test.escrow.isPokemonReserved(test.outgoing.instanceId)).toBe(true)

    mustFail = false
    await expect(test.escrow.commit(request)).resolves.toMatchObject({ status: 'committed' })
    expect(test.persistState).toHaveBeenCalledTimes(3)
    expect(test.publishState).toHaveBeenCalledTimes(2)
  })

  it("ne publie ni journal ni verrou mémoire si la persistance du prepare échoue", async () => {
    const test = harness({ persist: () => { throw new Error('disk-full-prepare') } })
    const original = test.holder.current

    await expect(prepareCommit(test)).rejects.toThrow('disk-full-prepare')

    expect(test.holder.current).toBe(original)
    expect(test.holder.current.p2pTradeJournals).toEqual([])
    expect(test.publishState).not.toHaveBeenCalled()
    expect(test.escrow.isPokemonReserved(test.outgoing.instanceId)).toBe(false)
    expect(test.escrow.isPokemonReserved(test.incoming.instanceId)).toBe(false)
  })

  it('libère exactement la réservation demandée lors du rollback', async () => {
    const test = harness()
    const reservation = await prepareCommit(test)

    await test.escrow.rollback(test.request, reservation, 'cancelled')

    expect(test.escrow.isPokemonReserved(test.outgoing.instanceId)).toBe(false)
    expect(test.escrow.isPokemonReserved(test.incoming.instanceId)).toBe(false)
    expect(test.holder.current.party.members[0]?.instanceId).toBe(test.outgoing.instanceId)
  })

  it('garde le prepared durable après coupure puis adopte exactement une fois le commit du pair après reload', async () => {
    const test = harness()
    const reservation = await prepareCommit(test)
    const prepared = test.holder.current.p2pTradeJournals[0]!

    await test.escrow.rollback(test.request, reservation, 'disconnect')

    expect(test.holder.current.p2pTradeJournals).toHaveLength(1)
    expect(test.escrow.isPokemonReserved(test.outgoing.instanceId)).toBe(true)
    const resumedPersist = vi.fn()
    const resumedPublish = vi.fn((next: FieldScriptState) => { test.holder.current = next })
    const resumed = createHgssP2pTradeRuntimeEscrow({
      getState: () => test.holder.current,
      persistState: resumedPersist,
      publishState: resumedPublish,
    })
    const remoteCommitted = mirrorCommittedJournal(prepared)

    const first = await resumed.reconcileRecovery(remoteCommitted, 'alice', 'bob')
    const replay = await resumed.reconcileRecovery(remoteCommitted, 'alice', 'bob')

    expect(first).toMatchObject({ kind: 'committed', commitResult: { status: 'committed' } })
    expect(replay).toMatchObject({ kind: 'committed', commitResult: { status: 'already-committed' } })
    expect(test.holder.current.party.members[0]?.instanceId).toBe(test.incoming.instanceId)
    expect(test.holder.current.p2pTradeReceipts).toHaveLength(1)
    expect(test.holder.current.gameStats.get(hgssInternetTradesGameStatId)).toBe(1)
    expect(test.holder.current.gameScore).toBe(10)
    expect(resumedPersist).toHaveBeenCalledTimes(1)
    expect(resumedPublish).toHaveBeenCalledTimes(1)
    expect(resumed.listRecoveryJournals('bob')).toMatchObject([{ phase: 'committed' }])
  })

  it('répond committed avec le reçu seul si la confirmation distante arrive après nettoyage local', async () => {
    const test = harness()
    const reservation = await prepareCommit(test)
    await test.escrow.commit(commitRequest(test, reservation))
    const localCommitted = test.holder.current.p2pTradeJournals[0]!
    const remoteCommitted = mirrorCommittedJournal(localCommitted)
    await expect(test.escrow.finalizeRecovery(transactionId, 'bob', 'confirmed-committed')).resolves.toBe(true)
    const persistCount = test.persistState.mock.calls.length
    const publishCount = test.publishState.mock.calls.length

    const result = await test.escrow.reconcileRecovery(remoteCommitted, 'alice', 'bob')

    expect(result).toMatchObject({ kind: 'committed', commitResult: { status: 'already-committed' } })
    expect(test.persistState).toHaveBeenCalledTimes(persistCount)
    expect(test.publishState).toHaveBeenCalledTimes(publishCount)
    expect(test.holder.current.gameStats.get(hgssInternetTradesGameStatId)).toBe(1)
    expect(test.holder.current.p2pTradeJournals).toEqual([])
  })

  it("refuse qu'un journal committed distant seul force un échange jamais préparé localement", async () => {
    const victim = harness()
    const source = harness()
    await prepareCommit(source)
    const forgedRemoteCommit = mirrorCommittedJournal(source.holder.current.p2pTradeJournals[0]!)

    const result = await victim.escrow.reconcileRecovery(forgedRemoteCommit, 'alice', 'bob')

    expect(result).toEqual({ kind: 'missing' })
    expect(victim.persistState).not.toHaveBeenCalled()
    expect(victim.publishState).not.toHaveBeenCalled()
    expect(victim.holder.current.party.members[0]?.instanceId).toBe(victim.outgoing.instanceId)
    expect(victim.holder.current.p2pTradeReceipts).toEqual([])
    expect(victim.holder.current.gameStats.has(hgssInternetTradesGameStatId)).toBe(false)
  })
})
