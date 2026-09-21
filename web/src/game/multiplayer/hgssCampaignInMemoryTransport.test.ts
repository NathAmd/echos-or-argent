import { describe, expect, it, vi } from 'vitest'
import {
  createHgssCampaignClientGateway,
  type HgssCampaignClientTransport,
  type HgssCampaignClientTransportHandlers,
} from './hgssCampaignClientGateway'
import {
  createHgssCampaignInMemoryTransport,
  HgssCampaignInMemoryTransportError,
} from './hgssCampaignInMemoryTransport'
import { createHgssCampaignServerCore, type HgssCampaignServerCore } from './hgssCampaignServerCore'

const sessionId = 'campaign:integration'
const hostPosition = { mapId: 61, x: 8, z: 12, direction: 'south' as const }
const guestPosition = { mapId: 61, x: 9, z: 12, direction: 'west' as const }
const host = {
  playerId: 'player:host',
  displayName: 'ALICE',
  gender: 'female' as const,
  position: hostPosition,
  spriteId: 1,
}
const guest = {
  playerId: 'player:guest',
  displayName: 'BOB',
  gender: 'male' as const,
  position: guestPosition,
  spriteId: 2,
}

function createJoinedServer(): HgssCampaignServerCore {
  const server = createHgssCampaignServerCore({
    // Le transport ne décide jamais de la collision : cette fixture injecte
    // explicitement l'autorité minimale requise par ses scénarios génériques.
    ports: { movement: () => ({ kind: 'accept' }) },
  })
  const created = server.createSession({ sessionId, host })
  if (!created.ok) throw new Error(created.error.message)
  const joined = server.joinSession(sessionId, guest)
  if (!joined.ok) throw new Error(joined.error.message)
  return server
}

function gatewayPair(
  server: HgssCampaignServerCore,
  guestTransportDecorator: (transport: HgssCampaignClientTransport) => HgssCampaignClientTransport
    = (transport) => transport,
) {
  const hostTransport = createHgssCampaignInMemoryTransport({
    server,
    sessionId,
    playerId: host.playerId,
  })
  const guestTransport = guestTransportDecorator(createHgssCampaignInMemoryTransport({
    server,
    sessionId,
    playerId: guest.playerId,
  }))
  return {
    hostGateway: createHgssCampaignClientGateway({
      transport: hostTransport,
      localParticipantId: host.playerId,
      commandIdFactory: (serial) => `host:command:${serial}`,
    }),
    guestGateway: createHgssCampaignClientGateway({
      transport: guestTransport,
      localParticipantId: guest.playerId,
      commandIdFactory: (serial) => `guest:command:${serial}`,
    }),
  }
}

function snapshotRevision(value: unknown): number | undefined {
  if (value === null || typeof value !== 'object' || !('revision' in value)) return undefined
  return typeof value.revision === 'number' ? value.revision : undefined
}

function dropBroadcastRevision(revision: number) {
  return (transport: HgssCampaignClientTransport): HgssCampaignClientTransport => ({
    ...transport,
    connect(handlers) {
      return transport.connect({
        ...handlers,
        onSnapshot(snapshot) {
          if (snapshotRevision(snapshot) !== revision) handlers.onSnapshot(snapshot)
        },
      })
    },
  })
}

const inertHandlers: HgssCampaignClientTransportHandlers = {
  onSnapshot: vi.fn(),
  onDisconnect: vi.fn(),
  onError: vi.fn(),
}

describe('transport de campagne HGSS en mémoire', () => {
  it('synchronise deux passerelles sur le même snapshot autoritaire', async () => {
    const server = createJoinedServer()
    const { hostGateway, guestGateway } = gatewayPair(server)

    await Promise.all([hostGateway.connect(), guestGateway.connect()])

    expect(hostGateway.getState()).toMatchObject({ status: 'connected', snapshot: { revision: 1 } })
    expect(guestGateway.getState()).toMatchObject({ status: 'connected', snapshot: { revision: 1 } })
    expect(hostGateway.getState().snapshot).toEqual(server.getSnapshot(sessionId))
    expect(guestGateway.getState().snapshot).toEqual(hostGateway.getState().snapshot)
  })

  it('propage un mouvement, sa révision et sa séquence aux deux clients', async () => {
    const server = createJoinedServer()
    const { hostGateway, guestGateway } = gatewayPair(server)
    await Promise.all([hostGateway.connect(), guestGateway.connect()])
    const destination = { ...hostPosition, z: 13, direction: 'south' as const }

    const command = await hostGateway.send({
      kind: 'movement',
      sequence: 1,
      from: hostPosition,
      to: destination,
      mode: 'walk',
    })

    expect(command).toMatchObject({ expectedRevision: 1, sequence: 1 })
    for (const snapshot of [
      server.getSnapshot(sessionId),
      hostGateway.getState().snapshot,
      guestGateway.getState().snapshot,
    ]) {
      expect(snapshot?.revision).toBe(2)
      expect(snapshot?.players.find((player) => player.playerId === host.playerId)).toMatchObject({
        movementSequence: 1,
        position: destination,
      })
    }
  })

  it('refuse une commande concurrente périmée avec son code puis permet une resynchronisation', async () => {
    const server = createJoinedServer()
    const { hostGateway, guestGateway } = gatewayPair(server, dropBroadcastRevision(2))
    await Promise.all([hostGateway.connect(), guestGateway.connect()])

    const hostOperation = hostGateway.send({
      kind: 'movement',
      sequence: 1,
      from: hostPosition,
      to: { ...hostPosition, z: 13, direction: 'south' },
      mode: 'walk',
    })
    const staleGuestOperation = guestGateway.send({
      kind: 'movement',
      sequence: 1,
      from: guestPosition,
      to: { ...guestPosition, x: 10, direction: 'east' },
      mode: 'walk',
    })
    await expect(hostOperation).resolves.toMatchObject({ expectedRevision: 1 })
    await expect(staleGuestOperation).rejects.toMatchObject({
      name: 'HgssCampaignInMemoryTransportError',
      code: 'revision-conflict',
      serverError: {
        code: 'revision-conflict',
        expectedRevision: 2,
        receivedRevision: 1,
        playerId: guest.playerId,
      },
    })
    expect(guestGateway.getState()).toMatchObject({ status: 'connected', snapshot: { revision: 2 } })

    expect(guestGateway.getState()).toMatchObject({ status: 'connected', snapshot: { revision: 2 } })
    await expect(guestGateway.send({
      kind: 'movement',
      sequence: 1,
      from: guestPosition,
      to: { ...guestPosition, x: 10, direction: 'east' },
      mode: 'walk',
    })).resolves.toMatchObject({ expectedRevision: 2 })
    expect(server.getSnapshot(sessionId)).toMatchObject({ revision: 3 })
  })

  it('refuse les snapshots absents et les connexions invalides de façon structurée', () => {
    const emptyServer = createHgssCampaignServerCore()
    const missingSessionTransport = createHgssCampaignInMemoryTransport({
      server: emptyServer,
      sessionId,
      playerId: host.playerId,
    })
    expect(() => missingSessionTransport.connect(inertHandlers)).toThrowError(expect.objectContaining({
      code: 'session-not-found',
      serverError: expect.objectContaining({ code: 'session-not-found', sessionId }),
    }))
    expect(() => missingSessionTransport.requestSnapshot()).toThrowError(expect.objectContaining({
      code: 'transport-not-connected',
    }))

    const hostOnlyServer = createHgssCampaignServerCore()
    const created = hostOnlyServer.createSession({ sessionId, host })
    if (!created.ok) throw new Error(created.error.message)
    const absentPlayerTransport = createHgssCampaignInMemoryTransport({
      server: hostOnlyServer,
      sessionId,
      playerId: guest.playerId,
    })
    expect(() => absentPlayerTransport.connect(inertHandlers)).toThrowError(expect.objectContaining({
      code: 'player-not-found',
      serverError: expect.objectContaining({ code: 'player-not-found', playerId: guest.playerId }),
    }))

    const validTransport = createHgssCampaignInMemoryTransport({
      server: hostOnlyServer,
      sessionId,
      playerId: host.playerId,
    })
    validTransport.connect(inertHandlers)
    expect(() => validTransport.connect(inertHandlers)).toThrowError(expect.objectContaining({
      code: 'transport-already-connected',
    }))
  })

  it('déconnecte seulement le client local sans retirer le joueur ni gêner son partenaire', async () => {
    const server = createJoinedServer()
    const { hostGateway, guestGateway } = gatewayPair(server)
    await Promise.all([hostGateway.connect(), guestGateway.connect()])

    await guestGateway.disconnect()
    await hostGateway.send({
      kind: 'movement',
      sequence: 1,
      from: hostPosition,
      to: { ...hostPosition, z: 13, direction: 'south' },
      mode: 'walk',
    })

    expect(guestGateway.getState()).toEqual({ status: 'disconnected' })
    expect(hostGateway.getState()).toMatchObject({ status: 'connected', snapshot: { revision: 2 } })
    expect(server.getSnapshot(sessionId)).toMatchObject({
      revision: 2,
      players: [{ playerId: host.playerId }, { playerId: guest.playerId }],
    })
  })

  it('détecte un trou de diffusion et se resynchronise sans hook de production', async () => {
    const server = createJoinedServer()
    const { hostGateway, guestGateway } = gatewayPair(server, dropBroadcastRevision(2))
    const guestStatuses: string[] = []
    guestGateway.subscribe((state) => { guestStatuses.push(state.status) })
    await Promise.all([hostGateway.connect(), guestGateway.connect()])

    const firstDestination = { ...hostPosition, z: 13, direction: 'south' as const }
    await hostGateway.send({
      kind: 'movement',
      sequence: 1,
      from: hostPosition,
      to: firstDestination,
      mode: 'walk',
    })
    expect(guestGateway.getState()).toMatchObject({ status: 'connected', snapshot: { revision: 1 } })

    const secondDestination = { ...firstDestination, z: 14 }
    await hostGateway.send({
      kind: 'movement',
      sequence: 2,
      from: firstDestination,
      to: secondDestination,
      mode: 'run',
    })

    await vi.waitFor(() => {
      expect(guestGateway.getState()).toMatchObject({ status: 'connected', snapshot: { revision: 3 } })
    })
    expect(guestStatuses).toContain('resyncing')
    expect(guestGateway.getState().snapshot).toEqual(server.getSnapshot(sessionId))
  })

  it('expose une classe d’erreur identifiable sans perdre son code', () => {
    const error = new HgssCampaignInMemoryTransportError('transport-not-connected', 'déconnecté')
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({
      name: 'HgssCampaignInMemoryTransportError',
      code: 'transport-not-connected',
      message: 'déconnecté',
    })
  })
})
