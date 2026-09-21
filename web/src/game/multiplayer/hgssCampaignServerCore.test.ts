import { describe, expect, it, vi } from 'vitest'
import { createPokemonInstanceId } from '../pokemon/pokemonInstanceId'
import {
  hgssCampaignProtocolVersion,
  parseHgssCampaignServerSnapshot,
  type HgssCampaignBattleSnapshot,
  type HgssCampaignClientCommand,
} from './hgssCampaignProtocol'
import {
  createHgssCampaignServerCore,
  hgssCampaignServerCommandCacheLimit,
  hgssCampaignServerMaximumPlayers,
  type HgssCampaignServerCore,
  type HgssCampaignServerMovementPort,
  type HgssCampaignServerPlayerInput,
} from './hgssCampaignServerCore'

const hostPosition = { mapId: 61, x: 8, z: 12, direction: 'south' as const }
const host: HgssCampaignServerPlayerInput = {
  playerId: 'player:host',
  displayName: 'ALICE',
  gender: 'female',
  position: hostPosition,
  spriteId: 1,
}
const guest: HgssCampaignServerPlayerInput = {
  playerId: 'player:guest',
  displayName: 'BOB',
  gender: 'male',
  position: { ...hostPosition, x: 9, direction: 'west' },
  spriteId: 2,
}

const acceptMovement: HgssCampaignServerMovementPort = () => ({ kind: 'accept' })

function createSession(core: HgssCampaignServerCore, sessionId = 'campaign:test') {
  const result = core.createSession({ sessionId, host })
  if (!result.ok) throw new Error(result.error.message)
  return result.snapshot
}

function movement(
  commandId: string,
  expectedRevision: number,
  sequence: number,
  overrides: Partial<Extract<HgssCampaignClientCommand, { kind: 'movement' }>> = {},
): Extract<HgssCampaignClientCommand, { kind: 'movement' }> {
  return {
    protocolVersion: hgssCampaignProtocolVersion,
    commandId,
    expectedRevision,
    kind: 'movement',
    sequence,
    from: hostPosition,
    to: { ...hostPosition, z: 13, direction: 'south' },
    mode: 'walk',
    ...overrides,
  }
}

function interaction(
  commandId: string,
  expectedRevision: number,
  objectId = 7,
): Extract<HgssCampaignClientCommand, { kind: 'interaction' }> {
  return {
    protocolVersion: hgssCampaignProtocolVersion,
    commandId,
    expectedRevision,
    kind: 'interaction',
    direction: 'north',
    target: { kind: 'object', mapId: 61, objectId },
  }
}

function battleAction(
  commandId: string,
  expectedRevision: number,
): Extract<HgssCampaignClientCommand, { kind: 'double-battle-action' }> {
  return {
    protocolVersion: hgssCampaignProtocolVersion,
    commandId,
    expectedRevision,
    kind: 'double-battle-action',
    battleId: 'battle:test',
    turn: 0,
    action: {
      kind: 'move',
      actor: { side: 'player', slot: 0 },
      moveIndex: 0,
      target: { side: 'opponent', slot: 0 },
    },
  }
}

function eventAcknowledgement(
  commandId: string,
  expectedRevision: number,
): Extract<HgssCampaignClientCommand, { kind: 'event-ack' }> {
  return {
    protocolVersion: hgssCampaignProtocolVersion,
    commandId,
    expectedRevision,
    kind: 'event-ack',
    eventId: 'event:test',
    eventRevision: Math.max(1, expectedRevision),
  }
}

function sharedEvent(
  commandId: string,
  expectedRevision: number,
): Extract<HgssCampaignClientCommand, { kind: 'shared-event' }> {
  return {
    protocolVersion: hgssCampaignProtocolVersion,
    commandId,
    expectedRevision,
    kind: 'shared-event',
    eventId: 'event:test',
    milestoneIds: ['story:test'],
    counters: [],
  }
}

function activeBattle(): HgssCampaignBattleSnapshot {
  return {
    battleId: 'battle:test',
    turn: 0,
    phase: 'command',
    participants: [{
      ownerId: 'owner:host',
      controllerPlayerId: host.playerId,
      position: { side: 'player', slot: 0 },
      partyIndex: 0,
      pokemon: {
        pokemonId: createPokemonInstanceId((length) => new Uint8Array(length).fill(0x42)),
        speciesId: 155,
        form: 0,
        level: 5,
        currentHp: 20,
        maxHp: 20,
        status: 0,
      },
    }],
    pendingCommandActors: [{ side: 'player', slot: 0 }],
  }
}

describe('noyau serveur autoritaire de campagne HGSS', () => {
  it('crée un snapshot canonique profondément immuable et refuse les états initiaux invalides', () => {
    const core = createHgssCampaignServerCore()
    const mutablePosition = { mapId: 61, x: 8, z: 12, direction: 'south' as const }
    const result = core.createSession({
      sessionId: 'campaign:immutable',
      host: { ...host, position: mutablePosition },
      sharedProgression: {
        milestoneIds: ['story:starter'],
        counters: [{ id: 'badges', value: 0 }],
      },
    })
    expect(result).toMatchObject({ ok: true, kind: 'created' })
    if (!result.ok) return

    const { snapshot } = result
    mutablePosition.x = 999
    expect(snapshot).toMatchObject({
      protocolVersion: hgssCampaignProtocolVersion,
      sessionId: 'campaign:immutable',
      revision: 0,
      players: [{ playerId: host.playerId, state: 'active', position: { x: 8 }, movementSequence: 0 }],
    })
    expect(parseHgssCampaignServerSnapshot(snapshot)).toEqual(snapshot)
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.players)).toBe(true)
    expect(Object.isFrozen(snapshot.players[0]?.position)).toBe(true)
    expect(Object.isFrozen(snapshot.sharedProgression.counters[0])).toBe(true)
    expect(Reflect.set(snapshot.players[0]!.position, 'x', 100)).toBe(false)
    expect(core.getSnapshot('campaign:immutable')).toBe(snapshot)

    expect(core.createSession({ sessionId: 'campaign:immutable', host })).toMatchObject({
      ok: false,
      error: { code: 'session-already-exists' },
    })
    expect(core.createSession({ sessionId: 'espace interdit', host })).toMatchObject({
      ok: false,
      error: { code: 'invalid-session' },
    })
    expect(core.createSession({
      sessionId: 'campaign:bad-player',
      host: { ...host, displayName: 'TROP-LONG' },
    })).toMatchObject({ ok: false, error: { code: 'invalid-player' } })
    expect(core.createSession({
      sessionId: 'campaign:bad-state',
      host,
      sharedProgression: { milestoneIds: ['duplicate', 'duplicate'], counters: [] },
    })).toMatchObject({ ok: false, error: { code: 'invalid-initial-state' } })
  })

  it('limite strictement une session à deux joueurs et révise chaque join/leave', () => {
    const core = createHgssCampaignServerCore()
    createSession(core)
    expect(hgssCampaignServerMaximumPlayers).toBe(2)
    const revisions: number[] = []
    const subscription = core.subscribe('campaign:test', (snapshot) => revisions.push(snapshot.revision))
    expect(subscription).toMatchObject({ ok: true, snapshot: { revision: 0 } })

    expect(core.joinSession('campaign:test', guest)).toMatchObject({
      ok: true,
      kind: 'joined',
      snapshot: { revision: 1, players: [{ playerId: host.playerId }, { playerId: guest.playerId }] },
    })
    expect(core.joinSession('campaign:test', guest)).toMatchObject({
      ok: false,
      error: { code: 'player-already-joined', playerId: guest.playerId },
    })
    expect(core.joinSession('campaign:test', {
      ...guest,
      playerId: 'player:third',
      displayName: 'CHARLIE',
    })).toMatchObject({ ok: false, error: { code: 'session-full' } })
    expect(core.leaveSession('campaign:test', guest.playerId)).toMatchObject({
      ok: true,
      kind: 'left',
      snapshot: { revision: 2, players: [{ playerId: host.playerId }] },
    })
    expect(core.leaveSession('campaign:test', guest.playerId)).toMatchObject({
      ok: false,
      error: { code: 'player-not-found' },
    })
    expect(revisions).toEqual([0, 1, 2])

    if (subscription.ok) subscription.unsubscribe()
    expect(core.joinSession('campaign:test', guest)).toMatchObject({ ok: true, snapshot: { revision: 3 } })
    expect(revisions).toEqual([0, 1, 2])
    expect(core.subscribe('campaign:missing', vi.fn())).toMatchObject({
      ok: false,
      error: { code: 'session-not-found' },
    })
    expect(core.joinSession('campaign:missing', guest)).toMatchObject({
      ok: false,
      error: { code: 'session-not-found' },
    })
  })

  it('exige expectedRevision exact et rend commandId idempotent', () => {
    const core = createHgssCampaignServerCore({
      ports: { interaction: () => ({ kind: 'accept' }) },
    })
    createSession(core)
    const received = vi.fn()
    core.subscribe('campaign:test', received)

    expect(core.submitCommand('campaign:test', host.playerId, interaction('interaction:stale', 4))).toMatchObject({
      ok: false,
      error: {
        code: 'revision-conflict',
        expectedRevision: 0,
        receivedRevision: 4,
        commandId: 'interaction:stale',
      },
    })
    expect(received).toHaveBeenCalledTimes(1)

    const command = interaction('interaction:first', 0, 7)
    expect(core.submitCommand('campaign:test', host.playerId, command)).toMatchObject({
      ok: true,
      kind: 'applied',
      appliedRevision: 1,
      snapshot: { revision: 1 },
    })
    expect(core.submitCommand('campaign:test', host.playerId, command)).toMatchObject({
      ok: true,
      kind: 'replayed',
      appliedRevision: 1,
      snapshot: { revision: 1 },
    })
    expect(received).toHaveBeenCalledTimes(2)

    expect(core.submitCommand('campaign:test', host.playerId, interaction('interaction:next', 1, 8))).toMatchObject({
      ok: true,
      kind: 'applied',
      appliedRevision: 2,
    })
    expect(core.submitCommand('campaign:test', host.playerId, command)).toMatchObject({
      ok: true,
      kind: 'replayed',
      appliedRevision: 1,
      snapshot: { revision: 2 },
    })
    expect(received).toHaveBeenCalledTimes(3)

    expect(core.submitCommand('campaign:test', host.playerId, {
      ...command,
      expectedRevision: 1,
      target: { kind: 'object', mapId: 61, objectId: 9 },
    })).toMatchObject({
      ok: false,
      error: { code: 'command-id-conflict', commandId: command.commandId },
    })
    expect(core.submitCommand('campaign:test', host.playerId, {
      ...command,
      target: { kind: 'object', mapId: 61, objectId: -1 },
    })).toMatchObject({
      ok: false,
      error: { code: 'invalid-command' },
    })
    expect(core.submitCommand('campaign:test', 'player:absent', interaction('interaction:absent', 1))).toMatchObject({
      ok: false,
      error: { code: 'player-not-found' },
    })
  })

  it('exige une séquence et une origine de mouvement exactement autoritaires', () => {
    const movementPort = vi.fn(acceptMovement)
    const core = createHgssCampaignServerCore({ ports: { movement: movementPort } })
    createSession(core)

    expect(core.submitCommand('campaign:test', host.playerId, movement('move:sequence', 0, 2))).toMatchObject({
      ok: false,
      error: { code: 'movement-sequence-conflict', expectedSequence: 1, receivedSequence: 2 },
    })
    expect(core.submitCommand('campaign:test', host.playerId, movement('move:origin', 0, 1, {
      from: { ...hostPosition, direction: 'north' },
    }))).toMatchObject({
      ok: false,
      error: {
        code: 'movement-origin-conflict',
        expectedFrom: hostPosition,
        receivedFrom: { ...hostPosition, direction: 'north' },
      },
    })
    expect(core.submitCommand('campaign:test', host.playerId, movement('move:jump', 0, 1, {
      to: { ...hostPosition, z: 14, direction: 'south' },
    }))).toMatchObject({ ok: false, error: { code: 'movement-step-conflict' } })
    expect(core.submitCommand('campaign:test', host.playerId, movement('move:wrong-direction', 0, 1, {
      to: { ...hostPosition, z: 13, direction: 'north' },
    }))).toMatchObject({ ok: false, error: { code: 'movement-step-conflict' } })

    const accepted = movement('move:accepted', 0, 1)
    expect(core.submitCommand('campaign:test', host.playerId, accepted)).toMatchObject({
      ok: true,
      kind: 'applied',
      snapshot: {
        revision: 1,
        players: [{ movementSequence: 1, position: accepted.to }],
      },
    })
    expect(core.submitCommand('campaign:test', host.playerId, accepted)).toMatchObject({
      ok: true,
      kind: 'replayed',
      appliedRevision: 1,
      snapshot: { revision: 1 },
    })
    expect(core.submitCommand('campaign:test', host.playerId, movement('move:duplicate-sequence', 1, 1, {
      from: accepted.to,
    }))).toMatchObject({
      ok: false,
      error: { code: 'movement-sequence-conflict', expectedSequence: 2 },
    })
    expect(core.submitCommand('campaign:test', host.playerId, movement('move:cross-map', 1, 2, {
      from: accepted.to,
      to: { ...accepted.to, mapId: 62 },
    }))).toMatchObject({ ok: false, error: { code: 'invalid-command' } })
    expect(core.getSnapshot('campaign:test')).toMatchObject({ revision: 1 })
    expect(movementPort).toHaveBeenCalledOnce()
  })

  it('refuse une destination occupée avant de consulter le port de mouvement', () => {
    const movementPort = vi.fn(acceptMovement)
    const core = createHgssCampaignServerCore({ ports: { movement: movementPort } })
    createSession(core)
    expect(core.joinSession('campaign:test', guest)).toMatchObject({ ok: true, snapshot: { revision: 1 } })

    const command = movement('move:occupied', 1, 1, {
      to: { ...guest.position, direction: 'east' },
    })
    expect(core.submitCommand('campaign:test', host.playerId, command)).toMatchObject({
      ok: false,
      error: {
        code: 'movement-destination-occupied',
        blockingPlayerId: guest.playerId,
      },
    })
    expect(movementPort).not.toHaveBeenCalled()
    expect(core.getSnapshot('campaign:test')).toMatchObject({
      revision: 1,
      players: [
        { playerId: host.playerId, position: hostPosition, movementSequence: 0 },
        { playerId: guest.playerId, position: guest.position, movementSequence: 0 },
      ],
    })
  })

  it('applique uniquement une arrivée de warp attestée exactement par le port ROM', () => {
    const arrival = { mapId: 62, x: 3, z: 2, direction: 'south' as const }
    const movementPort = vi.fn<HgssCampaignServerMovementPort>(() => ({
      kind: 'accept',
      authoritativePosition: arrival,
    }))
    const core = createHgssCampaignServerCore({ ports: { movement: movementPort } })
    createSession(core)
    const command = movement('move:warp', 0, 1, { arrival })

    expect(core.submitCommand('campaign:test', host.playerId, command)).toMatchObject({
      ok: true,
      kind: 'applied',
      appliedRevision: 1,
      snapshot: {
        revision: 1,
        players: [{ movementSequence: 1, position: arrival }],
      },
    })
    expect(movementPort).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.objectContaining({ to: command.to, arrival }),
    }))
  })

  it('refuse sans mutation une arrivée absente, divergente ou non canonique du port', () => {
    const announced = { mapId: 62, x: 3, z: 2, direction: 'south' as const }
    const attested = { ...announced, x: 4 }
    const divergent = createHgssCampaignServerCore({
      ports: { movement: () => ({ kind: 'accept', authoritativePosition: attested }) },
    })
    createSession(divergent)
    expect(divergent.submitCommand(
      'campaign:test', host.playerId, movement('move:arrival-divergent', 0, 1, { arrival: announced }),
    )).toMatchObject({ ok: false, error: { code: 'movement-arrival-conflict' } })
    expect(divergent.getSnapshot('campaign:test')).toMatchObject({
      revision: 0,
      players: [{ position: hostPosition, movementSequence: 0 }],
    })

    const missing = createHgssCampaignServerCore({
      ports: { movement: () => ({ kind: 'accept', authoritativePosition: announced }) },
    })
    createSession(missing)
    expect(missing.submitCommand(
      'campaign:test', host.playerId, movement('move:arrival-missing', 0, 1),
    )).toMatchObject({ ok: false, error: { code: 'movement-arrival-conflict' } })
    expect(missing.getSnapshot('campaign:test')).toMatchObject({ revision: 0 })

    const invalid = createHgssCampaignServerCore({
      ports: { movement: () => ({
        kind: 'accept', authoritativePosition: { ...announced, mapId: -1 },
      }) as never },
    })
    createSession(invalid)
    expect(invalid.submitCommand(
      'campaign:test', host.playerId, movement('move:arrival-invalid', 0, 1, { arrival: announced }),
    )).toMatchObject({ ok: false, error: { code: 'port-invalid-result' } })
    expect(invalid.getSnapshot('campaign:test')).toMatchObject({ revision: 0 })
  })

  it('contrôle aussi l’occupation de l’arrivée après l’attestation ROM', () => {
    const arrival = { mapId: 62, x: 3, z: 2, direction: 'south' as const }
    const movementPort = vi.fn<HgssCampaignServerMovementPort>(() => ({
      kind: 'accept', authoritativePosition: arrival,
    }))
    const core = createHgssCampaignServerCore({ ports: { movement: movementPort } })
    createSession(core)
    expect(core.joinSession('campaign:test', { ...guest, position: { ...arrival, direction: 'west' } }))
      .toMatchObject({ ok: true, snapshot: { revision: 1 } })

    expect(core.submitCommand(
      'campaign:test', host.playerId, movement('move:arrival-occupied', 1, 1, { arrival }),
    )).toMatchObject({
      ok: false,
      error: { code: 'movement-destination-occupied', blockingPlayerId: guest.playerId },
    })
    expect(movementPort).toHaveBeenCalledOnce()
    expect(core.getSnapshot('campaign:test')).toMatchObject({
      revision: 1,
      players: [{ position: hostPosition, movementSequence: 0 }, { position: { mapId: 62, x: 3, z: 2 } }],
    })
  })

  it('structure les refus du port de mouvement et ne lui délègue aucun patch', () => {
    const rejecting = vi.fn<HgssCampaignServerMovementPort>(() => ({
      kind: 'reject',
      code: 'world-terrain',
      message: 'La ROM bloque cette case.',
    }))
    const rejectedCore = createHgssCampaignServerCore({ ports: { movement: rejecting } })
    createSession(rejectedCore)
    expect(rejectedCore.submitCommand('campaign:test', host.playerId, movement('move:rejected', 0, 1))).toMatchObject({
      ok: false,
      error: { code: 'port-rejected', portCode: 'world-terrain', message: 'La ROM bloque cette case.' },
    })
    expect(rejecting).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'campaign:test',
      playerId: host.playerId,
      command: expect.objectContaining({ kind: 'movement' }),
      snapshot: expect.objectContaining({ revision: 0 }),
    }))
    expect(Object.isFrozen(rejecting.mock.calls[0]![0].command)).toBe(true)
    expect(Object.isFrozen(rejecting.mock.calls[0]![0].snapshot)).toBe(true)
    expect(rejectedCore.getSnapshot('campaign:test')).toMatchObject({ revision: 0, players: [{ movementSequence: 0 }] })

    const invalidCore = createHgssCampaignServerCore({
      ports: { movement: () => ({ kind: 'accept', patch: { players: [] } }) as never },
    })
    createSession(invalidCore)
    expect(invalidCore.submitCommand('campaign:test', host.playerId, movement('move:invalid-port', 0, 1)))
      .toMatchObject({ ok: false, error: { code: 'port-invalid-result' } })
    expect(invalidCore.getSnapshot('campaign:test')).toMatchObject({ revision: 0 })

    const throwingCore = createHgssCampaignServerCore({
      ports: { movement: () => { throw new Error('probe failure') } },
    })
    createSession(throwingCore)
    expect(throwingCore.submitCommand('campaign:test', host.playerId, movement('move:throwing-port', 0, 1)))
      .toMatchObject({ ok: false, error: { code: 'port-failed' } })
    expect(throwingCore.getSnapshot('campaign:test')).toMatchObject({ revision: 0 })
  })

  it('refuse le déplacement d’un joueur engagé dans un combat', () => {
    const battleCore = createHgssCampaignServerCore()
    expect(battleCore.createSession({ sessionId: 'campaign:battle-movement', host, battle: activeBattle() }))
      .toMatchObject({ ok: true })
    expect(battleCore.submitCommand('campaign:battle-movement', host.playerId, movement('movement:battle', 0, 1)))
      .toMatchObject({ ok: false, error: { code: 'movement-state-conflict' } })
  })

  it('refuse proprement mouvement, interaction, combat et événement sans port autoritaire', () => {
    const core = createHgssCampaignServerCore()
    createSession(core)
    const commands = [
      movement('movement:none', 0, 1),
      interaction('interaction:none', 0),
      sharedEvent('shared-event:none', 0),
      eventAcknowledgement('event:none', 0),
    ]
    for (const command of commands) {
      expect(core.submitCommand('campaign:test', host.playerId, command)).toMatchObject({
        ok: false,
        error: {
          code: 'unsupported-command',
          commandId: command.commandId,
          commandKind: command.kind,
        },
      })
    }
    expect(core.getSnapshot('campaign:test')).toMatchObject({ revision: 0 })

    const battleCore = createHgssCampaignServerCore()
    expect(battleCore.createSession({ sessionId: 'campaign:battle-port', host, battle: activeBattle() }))
      .toMatchObject({ ok: true })
    expect(battleCore.submitCommand('campaign:battle-port', host.playerId, battleAction('battle:none', 0))).toMatchObject({
      ok: false,
      error: { code: 'unsupported-command', commandKind: 'double-battle-action' },
    })
  })

  it('délègue aux ports explicites, valide leurs patches et structure leurs refus', () => {
    const interactionPort = vi.fn(({ command, snapshot }) => {
      expect(Object.isFrozen(command)).toBe(true)
      expect(Object.isFrozen(snapshot)).toBe(true)
      if (command.target.kind === 'object' && command.target.objectId === 7) {
        return { kind: 'reject' as const, code: 'object-locked', message: 'Cet objet est verrouillé.' }
      }
      return {
        kind: 'accept' as const,
        patch: {
          sharedProgression: {
            milestoneIds: ['story:talked', 'event:dialogue'],
            counters: [{ id: 'talks', value: 1 }],
          },
          pendingEvents: [{
            eventId: 'event:dialogue',
            eventRevision: 1,
            pendingPlayerIds: [host.playerId],
          }],
        },
      }
    })
    const battlePort = vi.fn(() => ({ kind: 'accept' as const }))
    const core = createHgssCampaignServerCore({
      ports: { interaction: interactionPort, doubleBattleAction: battlePort },
    })
    const created = core.createSession({ sessionId: 'campaign:test', host, battle: activeBattle() })
    if (!created.ok) throw new Error(created.error.message)

    expect(core.submitCommand('campaign:test', host.playerId, interaction('interaction:reject', 0, 7))).toMatchObject({
      ok: false,
      error: { code: 'port-rejected', portCode: 'object-locked', message: 'Cet objet est verrouillé.' },
    })
    expect(core.getSnapshot('campaign:test')).toMatchObject({ revision: 0 })

    expect(core.submitCommand('campaign:test', host.playerId, interaction('interaction:accept', 0, 8))).toMatchObject({
      ok: true,
      kind: 'applied',
      snapshot: {
        revision: 1,
        sharedProgression: {
          milestoneIds: ['story:talked', 'event:dialogue'],
          counters: [{ id: 'talks', value: 1 }],
        },
        pendingEvents: [{
          eventId: 'event:dialogue',
          eventRevision: 1,
          pendingPlayerIds: [host.playerId],
        }],
      },
    })
    expect(core.submitCommand('campaign:test', host.playerId, battleAction('battle:accept', 1))).toMatchObject({
      ok: true,
      kind: 'applied',
      snapshot: { revision: 2 },
    })
    expect(interactionPort).toHaveBeenCalledTimes(2)
    expect(battlePort).toHaveBeenCalledTimes(1)
  })

  it('vérifie le combat, le tour et le contrôleur avant le port métier', () => {
    const battlePort = vi.fn(() => ({ kind: 'accept' as const }))
    const core = createHgssCampaignServerCore({ ports: { doubleBattleAction: battlePort } })
    expect(core.createSession({ sessionId: 'campaign:battle-control', host, battle: activeBattle() }))
      .toMatchObject({ ok: true })

    expect(core.submitCommand('campaign:battle-control', host.playerId, {
      ...battleAction('battle:wrong-id', 0), battleId: 'battle:other',
    })).toMatchObject({ ok: false, error: { code: 'battle-state-conflict' } })
    expect(core.submitCommand('campaign:battle-control', host.playerId, {
      ...battleAction('battle:wrong-turn', 0), turn: 1,
    })).toMatchObject({ ok: false, error: { code: 'battle-state-conflict' } })
    expect(core.submitCommand('campaign:battle-control', host.playerId, {
      ...battleAction('battle:wrong-actor', 0),
      action: { ...battleAction('unused', 0).action, actor: { side: 'player', slot: 1 } },
    })).toMatchObject({ ok: false, error: { code: 'battle-control-conflict' } })
    expect(battlePort).not.toHaveBeenCalled()

    expect(core.submitCommand('campaign:battle-control', host.playerId, battleAction('battle:valid', 0)))
      .toMatchObject({ ok: true, kind: 'applied', snapshot: { revision: 1 } })
    expect(battlePort).toHaveBeenCalledOnce()
  })

  it('annule sans mutation un port qui lève ou produit un état non canonique', () => {
    const throwing = createHgssCampaignServerCore({
      ports: { interaction: () => { throw new Error('adapter down') } },
    })
    createSession(throwing)
    expect(throwing.submitCommand('campaign:test', host.playerId, interaction('interaction:throw', 0))).toMatchObject({
      ok: false,
      error: { code: 'port-failed' },
    })
    expect(throwing.getSnapshot('campaign:test')).toMatchObject({ revision: 0 })

    const invalidPatch = createHgssCampaignServerCore({
      ports: { interaction: () => ({ kind: 'accept', patch: { players: [] } }) },
    })
    createSession(invalidPatch)
    expect(invalidPatch.submitCommand('campaign:test', host.playerId, interaction('interaction:invalid', 0))).toMatchObject({
      ok: false,
      error: { code: 'port-invalid-result' },
    })
    expect(invalidPatch.getSnapshot('campaign:test')).toMatchObject({ revision: 0, players: [{ playerId: host.playerId }] })

    const hostileDecision = Object.create(null) as Record<string, unknown>
    Object.defineProperty(hostileDecision, 'kind', {
      enumerable: true,
      get: () => { throw new Error('hostile getter') },
    })
    const hostile = createHgssCampaignServerCore({
      ports: {
        interaction: () => hostileDecision as never,
      },
    })
    createSession(hostile)
    expect(hostile.submitCommand('campaign:test', host.playerId, interaction('interaction:hostile', 0))).toMatchObject({
      ok: false,
      error: { code: 'port-invalid-result' },
    })
    expect(hostile.getSnapshot('campaign:test')).toMatchObject({ revision: 0 })
  })

  it('bloque toute mutation réentrante pendant l’évaluation d’un port', () => {
    const port = vi.fn(() => {
      expect(core.joinSession('campaign:test', guest)).toMatchObject({
        ok: false, error: { code: 'session-mutation-in-progress' },
      })
      expect(core.leaveSession('campaign:test', host.playerId)).toMatchObject({
        ok: false, error: { code: 'session-mutation-in-progress' },
      })
      expect(core.submitCommand('campaign:test', host.playerId, interaction('interaction:nested', 0))).toMatchObject({
        ok: false, error: { code: 'session-mutation-in-progress' },
      })
      expect(core.destroySession('campaign:test')).toMatchObject({
        ok: false, error: { code: 'session-mutation-in-progress' },
      })
      return { kind: 'accept' as const }
    })
    const core = createHgssCampaignServerCore({ ports: { interaction: port } })
    createSession(core)
    expect(core.submitCommand('campaign:test', host.playerId, interaction('interaction:outer', 0, 8))).toMatchObject({
      ok: true, kind: 'applied', snapshot: { revision: 1 },
    })
    expect(port).toHaveBeenCalledOnce()
  })

  it('protège aussi le port de mouvement contre la réentrance', () => {
    const movementPort = vi.fn(() => {
      expect(core.joinSession('campaign:test', guest)).toMatchObject({
        ok: false, error: { code: 'session-mutation-in-progress' },
      })
      expect(core.submitCommand('campaign:test', host.playerId, movement('move:nested', 0, 1))).toMatchObject({
        ok: false, error: { code: 'session-mutation-in-progress' },
      })
      expect(core.destroySession('campaign:test')).toMatchObject({
        ok: false, error: { code: 'session-mutation-in-progress' },
      })
      return { kind: 'accept' as const }
    })
    const core = createHgssCampaignServerCore({ ports: { movement: movementPort } })
    createSession(core)

    expect(core.submitCommand('campaign:test', host.playerId, movement('move:outer', 0, 1))).toMatchObject({
      ok: true, kind: 'applied', snapshot: { revision: 1 },
    })
    expect(movementPort).toHaveBeenCalledOnce()
  })

  it('borne l’idempotence et détruit explicitement les ressources d’une session', () => {
    const core = createHgssCampaignServerCore({
      ports: { interaction: () => ({ kind: 'accept' }) },
    })
    createSession(core)
    for (let index = 0; index <= hgssCampaignServerCommandCacheLimit; index += 1) {
      const result = core.submitCommand(
        'campaign:test', host.playerId, interaction(`interaction:bounded:${index}`, index, index),
      )
      expect(result).toMatchObject({ ok: true, kind: 'applied', appliedRevision: index + 1 })
    }
    expect(core.submitCommand('campaign:test', host.playerId, interaction('interaction:bounded:0', 0, 0))).toMatchObject({
      ok: false, error: { code: 'revision-conflict' },
    })
    expect(core.submitCommand('campaign:test', host.playerId, interaction(
      `interaction:bounded:${hgssCampaignServerCommandCacheLimit}`,
      hgssCampaignServerCommandCacheLimit,
      hgssCampaignServerCommandCacheLimit,
    ))).toMatchObject({ ok: true, kind: 'replayed' })

    const destroyed = core.destroySession('campaign:test')
    expect(destroyed).toEqual({ ok: true, kind: 'destroyed', sessionId: 'campaign:test' })
    expect(Object.isFrozen(destroyed)).toBe(true)
    expect(core.getSnapshot('campaign:test')).toBeUndefined()
    expect(core.destroySession('campaign:test')).toMatchObject({ ok: false, error: { code: 'session-not-found' } })
  })

  it('diffuse les révisions dans l’ordre malgré un abonné fautif ou réentrant', () => {
    const core = createHgssCampaignServerCore({
      ports: { interaction: () => ({ kind: 'accept' }) },
    })
    createSession(core)
    const first: number[] = []
    const second: number[] = []
    let submitted = false
    core.subscribe('campaign:test', (snapshot) => {
      first.push(snapshot.revision)
      if (snapshot.revision === 1 && !submitted) {
        submitted = true
        expect(core.submitCommand('campaign:test', host.playerId, interaction('interaction:reentrant', 1))).toMatchObject({
          ok: true,
          snapshot: { revision: 2 },
        })
      }
    })
    core.subscribe('campaign:test', (snapshot) => {
      second.push(snapshot.revision)
      if (snapshot.revision === 1) throw new Error('listener failure')
    })

    expect(core.joinSession('campaign:test', guest)).toMatchObject({ ok: true, snapshot: { revision: 1 } })
    expect(first).toEqual([0, 1, 2])
    expect(second).toEqual([0, 1, 2])
    expect(core.getSnapshot('campaign:test')).toMatchObject({ revision: 2 })
  })

  it('empêche un joueur de partir tant qu’un snapshot de combat le référence', () => {
    const pokemonId = createPokemonInstanceId((length) => new Uint8Array(length).fill(0x42))
    const battle: HgssCampaignBattleSnapshot = {
      battleId: 'battle:leave-lock',
      turn: 0,
      phase: 'command',
      participants: [{
        ownerId: 'owner:host',
        controllerPlayerId: host.playerId,
        position: { side: 'player', slot: 0 },
        partyIndex: 0,
        pokemon: {
          pokemonId,
          speciesId: 155,
          form: 0,
          level: 5,
          currentHp: 20,
          maxHp: 20,
          status: 0,
        },
      }],
      pendingCommandActors: [{ side: 'player', slot: 0 }],
    }
    const core = createHgssCampaignServerCore()
    expect(core.createSession({ sessionId: 'campaign:battle', host, battle })).toMatchObject({ ok: true })
    expect(core.leaveSession('campaign:battle', host.playerId)).toMatchObject({
      ok: false,
      error: { code: 'player-in-battle', playerId: host.playerId },
    })
    expect(core.getSnapshot('campaign:battle')).toMatchObject({ revision: 0, players: [{ playerId: host.playerId }] })
  })
})
