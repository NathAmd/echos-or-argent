import { describe, expect, it } from 'vitest'
import { createHgssSafariState, type HgssSafariObjectId } from '../safari/hgssSafariState'
import {
  createHgssLocalWirelessGateway,
  type HgssLocalWirelessChannel,
  type HgssLocalWirelessScheduler,
} from './hgssLocalWirelessGateway'
import { hgssLocalWirelessNamespace } from './hgssLocalWirelessProtocol'
import {
  createOfflineHgssMultiplayerResult,
  hgssMultiplayerProtocolVersion,
  type HgssMultiplayerGateway,
  type HgssMultiplayerPlayer,
  type HgssMultiplayerRequest,
} from './hgssMultiplayerGateway'

class FakeScheduler implements HgssLocalWirelessScheduler {
  private now = 0
  private serial = 0
  private readonly tasks = new Map<number, { at: number, callback: () => void }>()

  setTimeout(callback: () => void, delayMs: number): number {
    const id = ++this.serial
    this.tasks.set(id, { at: this.now + delayMs, callback })
    return id
  }

  clearTimeout(handle: unknown): void {
    this.tasks.delete(handle as number)
  }

  advance(delayMs: number): void {
    const target = this.now + delayMs
    while (true) {
      const next = [...this.tasks.entries()]
        .filter(([, task]) => task.at <= target)
        .sort((first, second) => first[1].at - second[1].at || first[0] - second[0])[0]
      if (!next) break
      this.tasks.delete(next[0])
      this.now = next[1].at
      next[1].callback()
    }
    this.now = target
  }

  get pendingCount(): number {
    return this.tasks.size
  }
}

class FakeBroadcastHub {
  readonly history: unknown[] = []
  private readonly channels = new Set<FakeBroadcastChannel>()

  create = (name: string): FakeBroadcastChannel => {
    const channel = new FakeBroadcastChannel(this, name)
    this.channels.add(channel)
    return channel
  }

  deliver(sender: FakeBroadcastChannel | undefined, name: string, value: unknown): void {
    const cloned = structuredClone(value)
    this.history.push(cloned)
    for (const channel of [...this.channels]) {
      if (channel !== sender && !channel.closed && channel.name === name) channel.deliver(structuredClone(cloned))
    }
  }

  remove(channel: FakeBroadcastChannel): void {
    this.channels.delete(channel)
  }

  get activeChannelCount(): number {
    return this.channels.size
  }

  get listenerCount(): number {
    return [...this.channels].reduce((count, channel) => count + channel.listenerCount, 0)
  }
}

class FakeBroadcastChannel implements HgssLocalWirelessChannel {
  readonly listeners = new Set<(event: { data: unknown }) => void>()
  readonly hub: FakeBroadcastHub
  readonly name: string
  closed = false

  constructor(hub: FakeBroadcastHub, name: string) {
    this.hub = hub
    this.name = name
  }

  postMessage(message: unknown): void {
    if (this.closed) throw new Error('Canal fermé.')
    this.hub.deliver(this, this.name, message)
  }

  addEventListener(_type: 'message', listener: (event: { data: unknown }) => void): void {
    this.listeners.add(listener)
  }

  removeEventListener(_type: 'message', listener: (event: { data: unknown }) => void): void {
    this.listeners.delete(listener)
  }

  deliver(data: unknown): void {
    for (const listener of [...this.listeners]) listener({ data })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.listeners.clear()
    this.hub.remove(this)
  }

  get listenerCount(): number {
    return this.listeners.size
  }
}

const alice = { trainerId: 11, name: 'ALICE', gender: 'female' } as const satisfies HgssMultiplayerPlayer
const bob = { trainerId: 22, name: 'BOB', gender: 'male' } as const satisfies HgssMultiplayerPlayer

function clubRequest(
  requestId: string,
  player: HgssMultiplayerPlayer,
  role: 'host' | 'join',
  overrides: Partial<Pick<Extract<HgssMultiplayerRequest, { kind: 'communication-club' }>, 'communicationType' | 'parameter1' | 'parameter2'>> = {},
): Extract<HgssMultiplayerRequest, { kind: 'communication-club' }> {
  return {
    protocolVersion: hgssMultiplayerProtocolVersion,
    requestId,
    romOpcode: role === 'host' ? 227 : 226,
    kind: 'communication-club',
    role,
    communicationType: overrides.communicationType ?? 39,
    parameter1: overrides.parameter1 ?? 0,
    parameter2: overrides.parameter2 ?? 0,
    player,
  }
}

function exchangeRequest(
  requestId: string,
  player: HgssMultiplayerPlayer,
  seed: number,
  language: number,
  gameVersion: number,
): Extract<HgssMultiplayerRequest, { kind: 'safari-area-exchange' }> {
  const areaSet = structuredClone(createHgssSafariState(seed).areaSets[0])
  areaSet.areas[0].placements.push({ objectId: seed % 24 as HgssSafariObjectId, x: 8 + seed, y: 0, z: 7 })
  areaSet.areaLevels[areaSet.areas[0].areaId] = seed
  return {
    protocolVersion: hgssMultiplayerProtocolVersion,
    requestId,
    romOpcode: 822,
    kind: 'safari-area-exchange',
    player,
    areaSet,
    language,
    gameVersion,
  }
}

function gatewayPair(timeoutMs = 1_000): {
  hub: FakeBroadcastHub
  scheduler: FakeScheduler
  host: HgssMultiplayerGateway
  join: HgssMultiplayerGateway
} {
  const hub = new FakeBroadcastHub()
  const scheduler = new FakeScheduler()
  const common = { channelFactory: hub.create, scheduler, timeoutMs }
  return {
    hub,
    scheduler,
    host: createHgssLocalWirelessGateway({ ...common, instanceId: 'host-tab' }),
    join: createHgssLocalWirelessGateway({ ...common, instanceId: 'join-tab' }),
  }
}

async function pairClub(host: HgssMultiplayerGateway, join: HgssMultiplayerGateway): Promise<void> {
  const joinResult = join.execute(clubRequest('join-club', bob, 'join'))
  const hostResult = host.execute(clubRequest('host-club', alice, 'host'))
  await expect(Promise.all([hostResult, joinResult])).resolves.toEqual([
    expect.objectContaining({ requestId: 'host-club', romResult: 2, status: 'completed' }),
    expect.objectContaining({ requestId: 'join-club', romResult: 2, status: 'completed' }),
  ])
}

describe('transport local wireless HGSS par BroadcastChannel', () => {
  it('apparie lorsque rejoindre attend d’abord puis remet les données exactes du pair', async () => {
    const { hub, scheduler, host, join } = gatewayPair()
    await pairClub(host, join)
    expect(scheduler.pendingCount).toBe(0)

    const hostExchange = exchangeRequest('host-exchange', alice, 3, 3, 7)
    const joinExchange = exchangeRequest('join-exchange', bob, 8, 2, 8)
    const hostResult = host.execute(hostExchange)
    const joinResult = join.execute(joinExchange)
    await expect(hostResult).resolves.toMatchObject({
      requestId: 'host-exchange',
      status: 'completed',
      safariAreaSet: joinExchange.areaSet,
      safariPlayer: { ...bob, language: 2, gameVersion: 8 },
    })
    await expect(joinResult).resolves.toMatchObject({
      requestId: 'join-exchange',
      status: 'completed',
      safariAreaSet: hostExchange.areaSet,
      safariPlayer: { ...alice, language: 3, gameVersion: 7 },
    })
    expect(scheduler.pendingCount).toBe(0)

    host.destroy?.()
    join.destroy?.()
    expect(hub.activeChannelCount).toBe(0)
    expect(hub.listenerCount).toBe(0)
    expect(scheduler.pendingCount).toBe(0)
  })

  it('apparie aussi lorsque l’hôte commence à attendre avant le joueur qui rejoint', async () => {
    const { hub, host, join } = gatewayPair()
    const hostResult = host.execute(clubRequest('host-first', alice, 'host'))
    const joinResult = join.execute(clubRequest('join-second', bob, 'join'))
    await expect(Promise.all([hostResult, joinResult])).resolves.toEqual([
      expect.objectContaining({ requestId: 'host-first', romResult: 2, status: 'completed' }),
      expect.objectContaining({ requestId: 'join-second', romResult: 2, status: 'completed' }),
    ])
    host.destroy?.()
    join.destroy?.()
    expect(hub.activeChannelCount).toBe(0)
  })

  it('refuse rôles, type ou paramètres différents jusqu’au timeout natif hors ligne', async () => {
    const mismatches = [
      { hostRole: 'host' as const, joinRole: 'host' as const },
      { hostRole: 'host' as const, joinRole: 'join' as const, join: { communicationType: 40 } },
      { hostRole: 'host' as const, joinRole: 'join' as const, join: { parameter1: 1 } },
      { hostRole: 'host' as const, joinRole: 'join' as const, join: { parameter2: 1 } },
    ]
    for (const [index, mismatch] of mismatches.entries()) {
      const { scheduler, host, join } = gatewayPair()
      const hostResult = host.execute(clubRequest(`host-${index}`, alice, mismatch.hostRole))
      const joinResult = join.execute(clubRequest(`join-${index}`, bob, mismatch.joinRole, mismatch.join))
      scheduler.advance(1_000)
      await expect(Promise.all([hostResult, joinResult])).resolves.toEqual([
        expect.objectContaining({ romResult: 4, status: 'offline', errorCode: 'timeout' }),
        expect.objectContaining({ romResult: 4, status: 'offline', errorCode: 'timeout' }),
      ])
      expect(scheduler.pendingCount).toBe(0)
      host.destroy?.()
      join.destroy?.()
    }
  })

  it('ignore un protocole et une session injectés qui ne correspondent pas', async () => {
    const { hub, scheduler, host, join } = gatewayPair()
    const loneHost = host.execute(clubRequest('strict-protocol', alice, 'host'))
    hub.deliver(undefined, 'pokemaster-hgss-local-wireless-v1', {
      namespace: hgssLocalWirelessNamespace,
      protocolVersion: 99,
      from: 'intrus',
      type: 'club-advertise',
      operationId: 'intrus-op',
      role: 'join',
      match: { communicationType: 39, parameter1: 0, parameter2: 0 },
      player: bob,
    })
    scheduler.advance(1_000)
    await expect(loneHost).resolves.toMatchObject({ status: 'offline', romResult: 4 })

    await pairClub(host, join)
    const request = exchangeRequest('strict-session', alice, 2, 3, 7)
    const result = host.execute(request)
    hub.deliver(undefined, 'pokemaster-hgss-local-wireless-v1', {
      namespace: hgssLocalWirelessNamespace,
      protocolVersion: hgssMultiplayerProtocolVersion,
      from: 'join-tab',
      to: 'host-tab',
      type: 'safari-exchange',
      sessionId: 'ancienne-session',
      round: 0,
      requestId: 'intrus-exchange',
      payload: { areaSet: createHgssSafariState(1).areaSets[0], player: { ...bob, language: 2, gameVersion: 8 } },
    })
    scheduler.advance(1_000)
    await expect(result).resolves.toMatchObject({ status: 'offline', errorCode: 'timeout' })
    host.destroy?.()
    join.destroy?.()
  })

  it('annule une attente et détruit canal, listener et timer sans fuite', async () => {
    const { hub, scheduler, host, join } = gatewayPair()
    const cancelled = host.execute(clubRequest('cancel-club', alice, 'host'))
    host.cancel?.('cancel-club')
    await expect(cancelled).resolves.toMatchObject({ status: 'cancelled', romResult: 4 })
    expect(scheduler.pendingCount).toBe(0)

    const destroyed = join.execute(clubRequest('destroy-club', bob, 'join'))
    join.destroy?.()
    await expect(destroyed).resolves.toMatchObject({ status: 'cancelled', romResult: 4, errorCode: 'destroyed' })
    expect(hub.activeChannelCount).toBe(1)
    expect(hub.listenerCount).toBe(1)
    expect(scheduler.pendingCount).toBe(0)
    host.destroy?.()
    expect(hub.activeChannelCount).toBe(0)
    expect(hub.listenerCount).toBe(0)
  })

  it('ferme symétriquement une session annulée pendant l’échange', async () => {
    const { scheduler, host, join } = gatewayPair()
    await pairClub(host, join)
    const hostRequest = exchangeRequest('cancel-exchange', alice, 4, 3, 7)
    const pending = host.execute(hostRequest)
    host.cancel?.(hostRequest.requestId)
    await expect(pending).resolves.toMatchObject({ status: 'cancelled', romResult: 0 })
    await expect(join.execute(exchangeRequest('after-peer-cancel', bob, 5, 2, 8))).resolves.toMatchObject({ status: 'offline' })
    expect(scheduler.pendingCount).toBe(0)
    host.destroy?.()
    join.destroy?.()
  })

  it('réveille le pair et libère son timer quand l’autre onglet est détruit', async () => {
    const { hub, scheduler, host, join } = gatewayPair()
    await pairClub(host, join)
    const pending = host.execute(exchangeRequest('peer-destroy', alice, 4, 3, 7))
    join.destroy?.()
    await expect(pending).resolves.toMatchObject({
      status: 'offline',
      errorCode: 'session-destroyed',
    })
    expect(scheduler.pendingCount).toBe(0)
    expect(hub.activeChannelCount).toBe(1)
    host.destroy?.()
    expect(hub.activeChannelCount).toBe(0)
  })

  it('ne fabrique pas de payload lorsque le joueur actif ne correspond plus à la session', async () => {
    const { host, join } = gatewayPair()
    await pairClub(host, join)
    const mismatched = exchangeRequest('wrong-player', { ...alice, trainerId: 99 }, 1, 3, 7)
    await expect(host.execute(mismatched)).resolves.toMatchObject({
      status: 'error',
      errorCode: 'session-player-mismatch',
      safariAreaSet: undefined,
      safariPlayer: undefined,
    })
    host.destroy?.()
    join.destroy?.()
  })

  it('refuse un set local invalide au lieu de le transmettre au pair', async () => {
    const { host, join } = gatewayPair()
    await pairClub(host, join)
    const invalid = exchangeRequest('invalid-area-set', alice, 1, 3, 7)
    invalid.areaSet.areas[0].placements[0]!.x = 0x100
    await expect(host.execute(invalid)).resolves.toMatchObject({
      status: 'error',
      errorCode: 'invalid-local-payload',
      safariAreaSet: undefined,
    })
    host.destroy?.()
    join.destroy?.()
  })

  it('préserve l’injection, l’annulation et la destruction du transport de repli', async () => {
    const hub = new FakeBroadcastHub()
    const cancelled: Array<string | undefined> = []
    let destroyed = false
    const fallback: HgssMultiplayerGateway = {
      execute: async (request) => createOfflineHgssMultiplayerResult(request),
      cancel: (requestId) => { cancelled.push(requestId) },
      destroy: () => { destroyed = true },
    }
    const gateway = createHgssLocalWirelessGateway({
      instanceId: 'injected-tab',
      channelFactory: hub.create,
      fallbackGateway: fallback,
    })
    const request: HgssMultiplayerRequest = {
      protocolVersion: hgssMultiplayerProtocolVersion,
      requestId: 'injected-request',
      romOpcode: 745,
      kind: 'friend-roster-count',
      player: alice,
    }
    await expect(gateway.execute(request)).resolves.toMatchObject({
      requestId: request.requestId,
      status: 'offline',
      friendRosterCount: 0,
    })
    gateway.cancel?.(request.requestId)
    gateway.destroy?.()
    expect(cancelled).toEqual([request.requestId])
    expect(destroyed).toBe(true)
    expect(hub.activeChannelCount).toBe(0)
  })
})
