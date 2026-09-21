import { describe, expect, it, vi } from 'vitest'
import {
  createHgssCampaignClientGateway as createGatewayWithIdentity,
  type HgssCampaignClientState,
  type HgssCampaignClientTransport,
  type HgssCampaignClientTransportHandlers,
} from './hgssCampaignClientGateway'
import {
  hgssCampaignProtocolVersion,
  type HgssCampaignServerSnapshot,
} from './hgssCampaignProtocol'

const position = { mapId: 61, x: 8, z: 12, direction: 'south' as const }
const localParticipantId = 'player:1'

function createHgssCampaignClientGateway(
  options: Omit<Parameters<typeof createGatewayWithIdentity>[0], 'localParticipantId'>,
) {
  return createGatewayWithIdentity({ ...options, localParticipantId })
}

function snapshot(revision: number, sessionId = 'campaign:johto'): HgssCampaignServerSnapshot {
  return {
    protocolVersion: hgssCampaignProtocolVersion,
    sessionId,
    revision,
    players: [{
      playerId: 'player:1',
      displayName: 'LUCAS',
      gender: 'male',
      state: 'active',
      position,
      spriteId: 0,
      movementSequence: revision,
    }],
    sharedProgression: {
      milestoneIds: revision > 0 ? ['story:starter'] : [],
      counters: [{ id: 'badges', value: 0 }],
    },
    pendingEvents: [],
  }
}

type Deferred<Value> = Readonly<{
  promise: Promise<Value>
  resolve: (value: Value) => void
  reject: (error: unknown) => void
}>

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function transportFixture(initialSnapshot: unknown): {
  transport: HgssCampaignClientTransport
  connect: ReturnType<typeof vi.fn<HgssCampaignClientTransport['connect']>>
  disconnect: ReturnType<typeof vi.fn<HgssCampaignClientTransport['disconnect']>>
  send: ReturnType<typeof vi.fn<HgssCampaignClientTransport['send']>>
  requestSnapshot: ReturnType<typeof vi.fn<HgssCampaignClientTransport['requestSnapshot']>>
  emit: (value: unknown) => void
  fail: (error: unknown) => void
  drop: () => void
} {
  let handlers: HgssCampaignClientTransportHandlers | undefined
  let currentSnapshot = initialSnapshot
  const connect = vi.fn<HgssCampaignClientTransport['connect']>((nextHandlers) => { handlers = nextHandlers })
  const disconnect = vi.fn<HgssCampaignClientTransport['disconnect']>()
  const send = vi.fn<HgssCampaignClientTransport['send']>(() => {
    const currentRevision = typeof currentSnapshot === 'object' && currentSnapshot !== null
      ? Number(Reflect.get(currentSnapshot, 'revision'))
      : 0
    const sessionId = typeof currentSnapshot === 'object' && currentSnapshot !== null
      ? String(Reflect.get(currentSnapshot, 'sessionId'))
      : 'campaign:johto'
    currentSnapshot = snapshot(currentRevision + 1, sessionId)
    return { appliedRevision: currentRevision + 1, replayed: false, snapshot: currentSnapshot }
  })
  const requestSnapshot = vi.fn<HgssCampaignClientTransport['requestSnapshot']>(() => initialSnapshot)
  return {
    transport: { transportKind: 'in-memory-test', connect, disconnect, send, requestSnapshot },
    connect,
    disconnect,
    send,
    requestSnapshot,
    emit(value) {
      currentSnapshot = value
      handlers?.onSnapshot(value)
    },
    fail(error) { handlers?.onError(error) },
    drop() { handlers?.onDisconnect() },
  }
}

describe('passerelle cliente de campagne HGSS', () => {
  it('refuse toute voie applicative HTTP ou WebSocket', () => {
    const fixture = transportFixture(snapshot(0))
    expect(() => createHgssCampaignClientGateway({
      transport: {
        ...fixture.transport,
        transportKind: 'websocket',
      } as unknown as HgssCampaignClientTransport,
    })).toThrow(/transport autoritaire reconnu/)
  })

  it('reste sans autorité en idle puis amorce sa projection avec le snapshot du transport', async () => {
    const fixture = transportFixture(JSON.parse(JSON.stringify(snapshot(7))))
    const gateway = createHgssCampaignClientGateway({ transport: fixture.transport })
    const statuses: string[] = []
    const unsubscribe = gateway.subscribe((state) => { statuses.push(state.status) })

    expect(gateway.getState()).toEqual({ status: 'idle' })
    await gateway.connect()

    expect(fixture.connect).toHaveBeenCalledOnce()
    expect(fixture.requestSnapshot).toHaveBeenCalledOnce()
    expect(gateway.getState()).toEqual({ status: 'connected', snapshot: snapshot(7) })
    expect(statuses).toEqual(['idle', 'connecting', 'connected'])

    unsubscribe()
    fixture.emit(snapshot(8))
    expect(statuses).toHaveLength(3)
    expect(gateway.getState().snapshot?.revision).toBe(8)
  })

  it('applique le premier snapshot avant ready et connected, sans acquitter si l\'application échoue', async () => {
    const fixture = transportFixture(snapshot(7))
    const journal: string[] = []
    const confirmReady = vi.fn(async () => { journal.push('ready') })
    const gateway = createHgssCampaignClientGateway({
      transport: { ...fixture.transport, confirmReady },
      applyInitialSnapshot: () => { journal.push('applied') },
    })
    gateway.subscribe(({ status }) => { if (status === 'connected') journal.push('connected') })

    await gateway.connect()

    expect(journal).toEqual(['applied', 'ready', 'connected'])
    expect(confirmReady).toHaveBeenCalledOnce()

    const rejectedFixture = transportFixture(snapshot(8))
    const rejectedReady = vi.fn()
    const rejected = createHgssCampaignClientGateway({
      transport: { ...rejectedFixture.transport, confirmReady: rejectedReady },
      applyInitialSnapshot: () => { throw new Error('live-apply-failed') },
    })
    await expect(rejected.connect()).rejects.toThrow('live-apply-failed')
    expect(rejectedReady).not.toHaveBeenCalled()
    expect(rejected.getState().status).toBe('failed')
  })

  it('génère une enveloppe stricte avec commandId et la révision autoritaire courante', async () => {
    const fixture = transportFixture(snapshot(12))
    const gateway = createHgssCampaignClientGateway({
      transport: fixture.transport,
      commandIdFactory: (serial) => `client:test:${serial}`,
    })

    await expect(gateway.send({
      kind: 'shared-event',
      eventId: 'event:starter',
      milestoneIds: ['story:starter'],
      counters: [],
    })).rejects.toThrow(/synchronisée/)

    await gateway.connect()
    const first = await gateway.send({
      kind: 'shared-event',
      eventId: 'event:starter',
      milestoneIds: ['story:starter'],
      counters: [{ id: 'badges', expectedValue: 0, value: 1 }],
    })
    fixture.emit(snapshot(13))
    fixture.send.mockReturnValueOnce({ appliedRevision: 14, replayed: false, snapshot: snapshot(14) })
    const second = await gateway.send({
      kind: 'movement',
      sequence: 1,
      from: position,
      to: { ...position, z: 13 },
      mode: 'walk',
    })

    expect(first).toMatchObject({
      protocolVersion: hgssCampaignProtocolVersion,
      commandId: 'client:test:1',
      expectedRevision: 12,
      kind: 'shared-event',
    })
    expect(second).toMatchObject({ commandId: 'client:test:2', expectedRevision: 13, kind: 'movement' })
    expect(fixture.send).toHaveBeenNthCalledWith(1, first)
    expect(fixture.send).toHaveBeenNthCalledWith(2, second)
    expect(Object.isFrozen(first)).toBe(true)
    if (first.kind !== 'shared-event') throw new Error('Commande de progression attendue.')
    expect(Object.isFrozen(first.counters)).toBe(true)
    expect(Object.isFrozen(first.counters[0])).toBe(true)
    expect(() => {
      (first.counters[0] as unknown as { value: number }).value = 999
    }).toThrow(TypeError)
  })

  it('rejette explicitement une deuxième commande tant que le transport traite la première', async () => {
    const fixture = transportFixture(snapshot(12))
    const pendingSend = deferred<unknown>()
    fixture.send.mockReturnValueOnce(pendingSend.promise)
    const gateway = createHgssCampaignClientGateway({
      transport: fixture.transport,
      commandIdFactory: (serial) => `client:serial:${serial}`,
    })
    await gateway.connect()

    const firstSend = gateway.send({
      kind: 'shared-event',
      eventId: 'event:starter',
      milestoneIds: ['story:starter'],
      counters: [],
    })
    await vi.waitFor(() => { expect(fixture.send).toHaveBeenCalledOnce() })
    await expect(gateway.send({
      kind: 'interaction',
      direction: 'north',
      target: { kind: 'object', mapId: 61, objectId: 2 },
    })).rejects.toThrow(/command-in-flight/)
    expect(fixture.send).toHaveBeenCalledOnce()

    pendingSend.resolve({ appliedRevision: 13, replayed: false, snapshot: snapshot(13) })
    await firstSend
    fixture.emit(snapshot(13))
    await expect(gateway.send({
      kind: 'interaction',
      direction: 'north',
      target: { kind: 'object', mapId: 61, objectId: 2 },
    })).resolves.toMatchObject({ commandId: 'client:serial:2', expectedRevision: 13 })
  })

  it('refuse un ACK movement sans révision avancée puis libère immédiatement la commande suivante après un ACK valide', async () => {
    const rejectedFixture = transportFixture(snapshot(12))
    rejectedFixture.send.mockResolvedValueOnce({ appliedRevision: 12, replayed: false, snapshot: snapshot(12) })
    const rejected = createHgssCampaignClientGateway({ transport: rejectedFixture.transport })
    await rejected.connect()

    await expect(rejected.send({
      kind: 'movement',
      sequence: 13,
      from: position,
      to: { ...position, x: 9, direction: 'east' },
      mode: 'walk',
    })).rejects.toThrow(/acquitté/)
    expect(rejected.getState().status).toBe('failed')

    const fixture = transportFixture(snapshot(20))
    fixture.send
      .mockResolvedValueOnce({ appliedRevision: 21, replayed: false, snapshot: snapshot(21) })
      .mockResolvedValueOnce({ appliedRevision: 22, replayed: false, snapshot: snapshot(22) })
    const gateway = createHgssCampaignClientGateway({ transport: fixture.transport })
    await gateway.connect()
    const first = await gateway.send({
      kind: 'movement', sequence: 21, from: position,
      to: { ...position, x: 9, direction: 'east' }, mode: 'walk',
    })
    const second = await gateway.send({
      kind: 'movement', sequence: 22, from: { ...position, x: 9, direction: 'east' },
      to: { ...position, x: 10, direction: 'east' }, mode: 'walk',
    })
    expect(first.expectedRevision).toBe(20)
    expect(second.expectedRevision).toBe(21)
    expect(gateway.getState()).toMatchObject({ status: 'connected', snapshot: { revision: 22 } })
  })

  it("résout un ACK perdu par l'état final autoritaire sans jamais rejouer la commande", async () => {
    const initial = snapshot(12)
    const committed: HgssCampaignServerSnapshot = {
      ...snapshot(13),
      sharedProgression: {
        milestoneIds: ['story:starter', 'event:zephyr-badge', 'story:zephyr-badge'],
        counters: [{ id: 'badges', value: 1 }],
      },
    }
    const fixture = transportFixture(initial)
    fixture.requestSnapshot
      .mockReturnValueOnce(initial)
      .mockReturnValueOnce(committed)
    fixture.send.mockRejectedValueOnce(Object.assign(new Error('ACK perdu'), {
      code: 'command-outcome-uncertain',
    }))
    const gateway = createHgssCampaignClientGateway({ transport: fixture.transport })
    await gateway.connect()

    await expect(gateway.send({
      kind: 'shared-event',
      eventId: 'event:zephyr-badge',
      milestoneIds: ['story:zephyr-badge'],
      counters: [{ id: 'badges', expectedValue: 0, value: 1 }],
    })).resolves.toMatchObject({ kind: 'shared-event', expectedRevision: 12 })

    expect(fixture.send).toHaveBeenCalledOnce()
    expect(fixture.requestSnapshot).toHaveBeenCalledTimes(2)
    expect(gateway.getState()).toMatchObject({ status: 'connected', snapshot: { revision: 13 } })
  })

  it("résout un ACK movement perdu seulement si la séquence et l'arrivée sont exactes", async () => {
    const initial = snapshot(12)
    const destination = { ...position, x: 9, direction: 'east' as const }
    const committed: HgssCampaignServerSnapshot = {
      ...snapshot(13),
      players: [{
        ...snapshot(13).players[0]!,
        position: destination,
        movementSequence: 13,
      }],
    }
    const fixture = transportFixture(initial)
    fixture.requestSnapshot
      .mockReturnValueOnce(initial)
      .mockReturnValueOnce(committed)
    fixture.send.mockRejectedValueOnce(Object.assign(new Error('ACK perdu'), {
      code: 'request-timeout',
    }))
    const gateway = createHgssCampaignClientGateway({ transport: fixture.transport })
    await gateway.connect()

    await expect(gateway.send({
      kind: 'movement',
      sequence: 13,
      from: position,
      to: destination,
      mode: 'walk',
    })).resolves.toMatchObject({ kind: 'movement', expectedRevision: 12 })

    expect(fixture.send).toHaveBeenCalledOnce()
    expect(fixture.requestSnapshot).toHaveBeenCalledTimes(2)
    expect(gateway.getState()).toMatchObject({
      status: 'connected',
      snapshot: { revision: 13, players: [{ movementSequence: 13, position: destination }] },
    })
  })

  it('prouve un event-ack perdu quand le joueur local a disparu du pending, y compris si l’événement est retiré', async () => {
    const pending: HgssCampaignServerSnapshot = {
      ...snapshot(12),
      sharedProgression: {
        ...snapshot(12).sharedProgression,
        milestoneIds: ['story:starter', 'event:starter'],
      },
      pendingEvents: [{
        eventId: 'event:starter',
        eventRevision: 11,
        pendingPlayerIds: [localParticipantId],
      }],
    }
    const acknowledged = {
      ...snapshot(13),
      sharedProgression: pending.sharedProgression,
      pendingEvents: [],
    }
    const fixture = transportFixture(pending)
    fixture.requestSnapshot
      .mockReturnValueOnce(pending)
      .mockReturnValueOnce(acknowledged)
    fixture.send.mockRejectedValueOnce(Object.assign(new Error('ACK perdu'), {
      code: 'request-timeout',
    }))
    const gateway = createHgssCampaignClientGateway({ transport: fixture.transport })
    await gateway.connect()

    await expect(gateway.send({
      kind: 'event-ack',
      eventId: 'event:starter',
      eventRevision: 11,
    })).resolves.toMatchObject({ kind: 'event-ack', expectedRevision: 12 })
    expect(fixture.send).toHaveBeenCalledOnce()
  })

  it('accepte un replay serveur ancien seulement lorsque le snapshot courant prouve exactement son effet', async () => {
    const initial = snapshot(20)
    const fixture = transportFixture(initial)
    fixture.send.mockResolvedValueOnce({
      appliedRevision: 2,
      replayed: true,
      snapshot: initial,
    })
    const gateway = createHgssCampaignClientGateway({ transport: fixture.transport })
    await gateway.connect()

    await expect(gateway.send({
      kind: 'shared-event',
      eventId: 'story:starter',
      milestoneIds: [],
      counters: [],
    })).resolves.toMatchObject({ kind: 'shared-event', expectedRevision: 20 })
    expect(fixture.send).toHaveBeenCalledOnce()
  })

  it("rejette terminalement un replay serveur dont le snapshot ne prouve pas l'effet", async () => {
    const initial = snapshot(20)
    const fixture = transportFixture(initial)
    fixture.send.mockResolvedValueOnce({
      appliedRevision: 2,
      replayed: true,
      snapshot: initial,
    })
    const gateway = createHgssCampaignClientGateway({ transport: fixture.transport })
    await gateway.connect()

    await expect(gateway.send({
      kind: 'shared-event',
      eventId: 'event:unknown',
      milestoneIds: ['story:unknown'],
      counters: [],
    })).rejects.toThrow(/ne prouve pas/)
    expect(fixture.send).toHaveBeenCalledOnce()
    expect(gateway.getState()).toMatchObject({ status: 'failed', error: expect.any(Error) })
  })

  it("échoue terminalement si une issue incertaine reste ambiguë après resynchronisation", async () => {
    const initial = snapshot(12)
    const ambiguous = snapshot(13)
    const fixture = transportFixture(initial)
    fixture.requestSnapshot
      .mockReturnValueOnce(initial)
      .mockReturnValueOnce(ambiguous)
    const uncertainty = Object.assign(new Error('issue inconnue'), {
      code: 'peer-request-timeout',
    })
    fixture.send.mockRejectedValueOnce(uncertainty)
    const gateway = createHgssCampaignClientGateway({ transport: fixture.transport })
    await gateway.connect()

    await expect(gateway.send({
      kind: 'movement',
      sequence: 13,
      from: position,
      to: { ...position, x: 9, direction: 'east' },
      mode: 'walk',
    })).rejects.toBe(uncertainty)
    expect(fixture.send).toHaveBeenCalledOnce()
    expect(gateway.getState()).toMatchObject({ status: 'failed', error: uncertainty })
  })

  it('expose un état et un snapshot profondément immuables', async () => {
    const fixture = transportFixture(snapshot(12))
    const gateway = createHgssCampaignClientGateway({ transport: fixture.transport })
    await gateway.connect()
    const publishedState = gateway.getState()
    const publishedSnapshot = publishedState.snapshot!

    expect(Object.isFrozen(publishedState)).toBe(true)
    expect(Object.isFrozen(publishedSnapshot)).toBe(true)
    expect(Object.isFrozen(publishedSnapshot.players)).toBe(true)
    expect(Object.isFrozen(publishedSnapshot.players[0])).toBe(true)
    expect(Object.isFrozen(publishedSnapshot.players[0].position)).toBe(true)
    expect(Object.isFrozen(publishedSnapshot.sharedProgression.counters)).toBe(true)
    expect(() => {
      (publishedSnapshot as unknown as { revision: number }).revision = 99
    }).toThrow(TypeError)
    expect(() => {
      (publishedSnapshot.players as unknown as unknown[]).length = 0
    }).toThrow(TypeError)
    expect(() => {
      (publishedSnapshot.players[0].position as unknown as { x: number }).x = 999
    }).toThrow(TypeError)
    expect(gateway.getState().snapshot?.revision).toBe(12)
    expect(gateway.getState().snapshot?.players[0].position.x).toBe(position.x)
  })

  it('ignore les snapshots dupliqués et périmés sans republier sa projection', async () => {
    const fixture = transportFixture(snapshot(10))
    const gateway = createHgssCampaignClientGateway({ transport: fixture.transport })
    const states: HgssCampaignClientState[] = []
    gateway.subscribe((state) => { states.push(state) })
    await gateway.connect()
    const publishedCount = states.length

    fixture.emit(snapshot(10))
    fixture.emit(snapshot(9))

    expect(gateway.getState().snapshot?.revision).toBe(10)
    expect(states).toHaveLength(publishedCount)
    expect(fixture.requestSnapshot).toHaveBeenCalledOnce()
  })

  it('conserve le gap et les pushes récents si requestSnapshot répond avec une ancienne révision', async () => {
    const fixture = transportFixture(snapshot(5))
    const resynchronization = deferred<unknown>()
    fixture.requestSnapshot
      .mockReturnValueOnce(snapshot(5))
      .mockReturnValueOnce(resynchronization.promise)
    const gateway = createHgssCampaignClientGateway({ transport: fixture.transport })
    await gateway.connect()

    fixture.emit(snapshot(8))
    fixture.emit(snapshot(9))

    expect(gateway.getState()).toMatchObject({ status: 'resyncing', snapshot: { revision: 5 } })
    expect(fixture.requestSnapshot).toHaveBeenCalledTimes(2)
    await expect(gateway.send({
      kind: 'interaction',
      direction: 'north',
      target: { kind: 'object', mapId: 61, objectId: 2 },
    })).rejects.toThrow(/synchronisée/)

    resynchronization.resolve(snapshot(5))
    await resynchronization.promise
    await vi.waitFor(() => {
      expect(gateway.getState()).toMatchObject({ status: 'connected', snapshot: { revision: 9 } })
    })
    expect(fixture.requestSnapshot).toHaveBeenCalledTimes(2)
  })

  it('retient le push le plus récent arrivé pendant la resynchronisation', async () => {
    const fixture = transportFixture(snapshot(5))
    const resynchronization = deferred<unknown>()
    fixture.requestSnapshot
      .mockReturnValueOnce(snapshot(5))
      .mockReturnValueOnce(resynchronization.promise)
    const gateway = createHgssCampaignClientGateway({ transport: fixture.transport })
    await gateway.connect()

    fixture.emit(snapshot(8))
    fixture.emit(snapshot(12))
    resynchronization.resolve(snapshot(10))
    await resynchronization.promise

    await vi.waitFor(() => {
      expect(gateway.getState()).toMatchObject({ status: 'connected', snapshot: { revision: 12 } })
    })
    expect(fixture.requestSnapshot).toHaveBeenCalledTimes(2)
  })

  it('échoue explicitement si requestSnapshot rejette malgré le candidat gap conservé', async () => {
    const fixture = transportFixture(snapshot(5))
    const resynchronization = deferred<unknown>()
    fixture.requestSnapshot
      .mockReturnValueOnce(snapshot(5))
      .mockReturnValueOnce(resynchronization.promise)
    const gateway = createHgssCampaignClientGateway({ transport: fixture.transport })
    await gateway.connect()

    fixture.emit(snapshot(8))
    resynchronization.reject(new Error('snapshot indisponible'))
    await expect(resynchronization.promise).rejects.toThrow(/indisponible/)

    await vi.waitFor(() => {
      expect(gateway.getState()).toMatchObject({ status: 'failed', snapshot: { revision: 5 } })
    })
    expect(fixture.requestSnapshot).toHaveBeenCalledTimes(2)
  })

  it('isole une ancienne resynchronisation pendant une reconnexion', async () => {
    const fixture = transportFixture(snapshot(5))
    const resynchronization = deferred<unknown>()
    fixture.requestSnapshot
      .mockReturnValueOnce(snapshot(5))
      .mockReturnValueOnce(resynchronization.promise)
      .mockReturnValueOnce(snapshot(20))
    const gateway = createHgssCampaignClientGateway({ transport: fixture.transport })
    await gateway.connect()

    fixture.emit(snapshot(8))
    await gateway.disconnect()
    await gateway.connect()
    resynchronization.resolve(snapshot(12))
    await resynchronization.promise
    await Promise.resolve()

    expect(gateway.getState()).toMatchObject({ status: 'connected', snapshot: { revision: 20 } })
    expect(fixture.requestSnapshot).toHaveBeenCalledTimes(3)
  })

  it('conserve un push initial plus récent que la réponse requestSnapshot', async () => {
    const initialRequest = deferred<unknown>()
    const fixture = transportFixture(initialRequest.promise)
    const gateway = createHgssCampaignClientGateway({ transport: fixture.transport })

    const connection = gateway.connect()
    await vi.waitFor(() => { expect(fixture.requestSnapshot).toHaveBeenCalledOnce() })
    fixture.emit(snapshot(8))
    initialRequest.resolve(snapshot(5))
    await connection

    expect(gateway.getState()).toMatchObject({ status: 'connected', snapshot: { revision: 8 } })
  })

  it('autorise une reconnexion pendant que l’ancienne requête initiale reste en attente', async () => {
    const initialRequest = deferred<unknown>()
    const fixture = transportFixture(initialRequest.promise)
    fixture.requestSnapshot
      .mockReturnValueOnce(initialRequest.promise)
      .mockReturnValueOnce(snapshot(12))
    const gateway = createHgssCampaignClientGateway({ transport: fixture.transport })

    const obsoleteConnection = gateway.connect()
    await vi.waitFor(() => { expect(fixture.requestSnapshot).toHaveBeenCalledOnce() })
    await gateway.disconnect()
    const currentConnection = gateway.connect()
    await expect(currentConnection).resolves.toBeUndefined()
    initialRequest.resolve(snapshot(8))
    await expect(obsoleteConnection).resolves.toBeUndefined()

    expect(fixture.connect).toHaveBeenCalledTimes(2)
    expect(fixture.requestSnapshot).toHaveBeenCalledTimes(2)
    expect(gateway.getState()).toMatchObject({ status: 'connected', snapshot: { revision: 12 } })
  })

  it('protège subscribe si le rappel initial lève une exception', async () => {
    const fixture = transportFixture(snapshot(1))
    const gateway = createHgssCampaignClientGateway({ transport: fixture.transport })
    const listener = vi.fn(() => { throw new Error('vue détruite') })

    expect(() => gateway.subscribe(listener)).not.toThrow()
    await expect(gateway.connect()).resolves.toBeUndefined()
    expect(gateway.getState().status).toBe('connected')
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('échoue fermé face à un snapshot malformé ou provenant d’une autre session', async () => {
    const fixture = transportFixture(snapshot(2))
    const gateway = createHgssCampaignClientGateway({ transport: fixture.transport })
    await gateway.connect()

    fixture.emit({ ...snapshot(3), players: [{ injected: true }] })
    expect(gateway.getState()).toMatchObject({ status: 'failed', error: expect.any(Error) })
    await expect(gateway.send({
      kind: 'event-ack',
      eventId: 'event:starter',
      eventRevision: 2,
    })).rejects.toThrow(/synchronisée/)

    const otherFixture = transportFixture(snapshot(2))
    const otherGateway = createHgssCampaignClientGateway({ transport: otherFixture.transport })
    await otherGateway.connect()
    otherFixture.emit(snapshot(3, 'campaign:kanto'))
    expect(otherGateway.getState()).toMatchObject({ status: 'failed', error: expect.any(Error) })
  })

  it('propage les échecs du transport et distingue déconnexion locale et distante', async () => {
    const fixture = transportFixture(snapshot(1))
    const gateway = createHgssCampaignClientGateway({ transport: fixture.transport })
    await gateway.connect()
    fixture.drop()
    expect(gateway.getState()).toEqual({ status: 'disconnected' })

    await gateway.connect()
    const failure = new Error('canal fermé')
    fixture.fail(failure)
    expect(gateway.getState()).toEqual({ status: 'failed', snapshot: snapshot(1), error: failure })

    await gateway.disconnect()
    expect(fixture.disconnect).toHaveBeenCalledOnce()
    expect(gateway.getState()).toEqual({ status: 'disconnected' })
  })

  it('refuse un snapshot initial invalide au lieu de fabriquer un état hors ligne', async () => {
    const fixture = transportFixture({ protocolVersion: hgssCampaignProtocolVersion, revision: 0 })
    const gateway = createHgssCampaignClientGateway({ transport: fixture.transport })

    await expect(gateway.connect()).rejects.toThrow(/Snapshot/)
    expect(gateway.getState()).toMatchObject({ status: 'failed', error: expect.any(Error) })
    expect(fixture.send).not.toHaveBeenCalled()
  })
})
