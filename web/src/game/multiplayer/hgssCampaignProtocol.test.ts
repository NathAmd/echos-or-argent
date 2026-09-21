import { describe, expect, it } from 'vitest'
import {
  hgssCampaignMaximumPlayers,
  hgssCampaignProtocolVersion,
  parseHgssCampaignClientCommand,
  parseHgssCampaignServerSnapshot,
  type HgssCampaignClientCommand,
  type HgssCampaignServerSnapshot,
} from './hgssCampaignProtocol'
import {
  createPokemonInstanceId,
  deriveLegacyPokemonInstanceId,
} from '../pokemon/pokemonInstanceId'

const position = { mapId: 61, x: 8, z: 12, direction: 'south' as const }
const randomPokemonIds = [0x11, 0x22, 0x33, 0x44].map((byte) => (
  createPokemonInstanceId((byteLength) => new Uint8Array(byteLength).fill(byte))
))
const portableLegacyPokemonId = deriveLegacyPokemonInstanceId('hgss-7-00000001', 'party/0')
const arbitraryLegacyPokemonId = deriveLegacyPokemonInstanceId('n'.repeat(64), 'p'.repeat(192))

const commands: HgssCampaignClientCommand[] = [
  {
    protocolVersion: hgssCampaignProtocolVersion,
    commandId: 'shared-event:1',
    expectedRevision: 12,
    kind: 'shared-event',
    eventId: 'event:zephyr-badge',
    milestoneIds: ['story:zephyr-badge'],
    counters: [{ id: 'badges', expectedValue: 0, value: 1 }],
  },
  {
    protocolVersion: hgssCampaignProtocolVersion,
    commandId: 'movement:2',
    expectedRevision: 12,
    kind: 'movement',
    sequence: 4,
    from: position,
    to: { ...position, z: 13, direction: 'north' },
    mode: 'run',
  },
  {
    protocolVersion: hgssCampaignProtocolVersion,
    commandId: 'interaction:3',
    expectedRevision: 12,
    kind: 'interaction',
    direction: 'north',
    target: { kind: 'object', mapId: 61, objectId: 7 },
  },
  {
    protocolVersion: hgssCampaignProtocolVersion,
    commandId: 'battle:4',
    expectedRevision: 12,
    kind: 'double-battle-action',
    battleId: 'battle:johto:1',
    turn: 3,
    action: {
      kind: 'move',
      actor: { side: 'player', slot: 0 },
      moveIndex: 2,
      target: { side: 'opponent', slot: 1 },
    },
  },
  {
    protocolVersion: hgssCampaignProtocolVersion,
    commandId: 'ack:5',
    expectedRevision: 12,
    kind: 'event-ack',
    eventId: 'event:league-cleared',
    eventRevision: 12,
  },
]

const snapshot: HgssCampaignServerSnapshot = {
  protocolVersion: hgssCampaignProtocolVersion,
  sessionId: 'campaign:johto',
  revision: 12,
  players: [
    {
      playerId: 'player:1',
      displayName: 'LUCAS',
      gender: 'male',
      state: 'active',
      position,
      spriteId: 0,
      movementSequence: 4,
    },
    {
      playerId: 'player:2',
      displayName: 'LYRA',
      gender: 'female',
      state: 'away',
      position: { ...position, x: 9, direction: 'west' },
      spriteId: 1,
      movementSequence: 2,
    },
  ],
  sharedProgression: {
    milestoneIds: ['story:starter', 'story:zephyr-badge', 'event:badge:1'],
    counters: [{ id: 'badges', value: 1 }],
  },
  pendingEvents: [{
    eventId: 'event:badge:1',
    eventRevision: 11,
    pendingPlayerIds: ['player:1', 'player:2'],
  }],
  battle: {
    battleId: 'battle:johto:1',
    turn: 3,
    phase: 'command',
    participants: [
      {
        ownerId: 'owner:player-1',
        controllerPlayerId: 'player:1',
        position: { side: 'player', slot: 0 },
        partyIndex: 0,
        pokemon: { pokemonId: randomPokemonIds[0], speciesId: 155, form: 0, level: 12, currentHp: 31, maxHp: 35, status: 0 },
      },
      {
        ownerId: 'owner:player-2',
        controllerPlayerId: 'player:2',
        position: { side: 'player', slot: 1 },
        partyIndex: 0,
        pokemon: { pokemonId: portableLegacyPokemonId, speciesId: 152, form: 0, level: 12, currentHp: 34, maxHp: 34, status: 0 },
      },
      {
        ownerId: 'trainer:1',
        position: { side: 'opponent', slot: 0 },
        partyIndex: 0,
        pokemon: { pokemonId: randomPokemonIds[2], speciesId: 16, form: 0, level: 9, currentHp: 19, maxHp: 24, status: 0 },
      },
      {
        ownerId: 'trainer:1',
        position: { side: 'opponent', slot: 1 },
        partyIndex: 1,
        pokemon: { pokemonId: randomPokemonIds[3], speciesId: 19, form: 0, level: 9, currentHp: 20, maxHp: 22, status: 0 },
      },
    ],
    pendingCommandActors: [
      { side: 'player', slot: 0 },
      { side: 'player', slot: 1 },
    ],
  },
}

describe('contrat de commandes de campagne HGSS', () => {
  it('accepte chaque intention cliente après un aller-retour JSON', () => {
    for (const command of commands) {
      const decoded: unknown = JSON.parse(JSON.stringify(command))
      const parsed = parseHgssCampaignClientCommand(decoded)
      expect(parsed).toEqual(command)
      expect(Object.isFrozen(parsed)).toBe(true)
    }
  })

  it('accepte aussi les variantes sérialisables de cible, changement et objet', () => {
    const coordinateInteraction = {
      ...commands[2],
      target: { kind: 'coordinate', mapId: 61, x: 8, z: 11 },
    }
    const switchAction = {
      ...commands[3],
      commandId: 'battle:switch',
      action: { kind: 'switch', actor: { side: 'player', slot: 1 }, partyIndex: 4 },
    }
    const itemAction = {
      ...commands[3],
      commandId: 'battle:item',
      action: { kind: 'item', actor: { side: 'player', slot: 0 }, itemId: 17, targetPartyIndex: 2, moveIndex: 1 },
    }
    expect(parseHgssCampaignClientCommand(coordinateInteraction)).toEqual(coordinateInteraction)
    expect(parseHgssCampaignClientCommand(switchAction)).toEqual(switchAction)
    expect(parseHgssCampaignClientCommand(itemAction)).toEqual(itemAction)
  })

  it('encode une arrivée de warp distincte tout en gardant le pas source sur sa carte', () => {
    const source = commands[1] as Extract<HgssCampaignClientCommand, { kind: 'movement' }>
    const transition = {
      ...source,
      commandId: 'movement:warp',
      arrival: { mapId: 62, x: 3, z: 2, direction: 'south' },
    }

    expect(parseHgssCampaignClientCommand(JSON.parse(JSON.stringify(transition)))).toEqual(transition)
    expect(parseHgssCampaignClientCommand({ ...transition, arrival: transition.to })).toBeUndefined()
    expect(parseHgssCampaignClientCommand({ ...transition, arrival: { ...transition.arrival, mapId: -1 } })).toBeUndefined()
    expect(parseHgssCampaignClientCommand({ ...transition, arrival: { ...transition.arrival, token: 'forged' } })).toBeUndefined()
  })

  it('refuse les versions, identifiants, bornes et champs inconnus', () => {
    expect(parseHgssCampaignClientCommand({ ...commands[0], protocolVersion: 1 })).toBeUndefined()
    expect(parseHgssCampaignClientCommand({ ...commands[0], commandId: '' })).toBeUndefined()
    expect(parseHgssCampaignClientCommand({ ...commands[0], expectedRevision: Number.NaN })).toBeUndefined()
    expect(parseHgssCampaignClientCommand({ ...commands[0], token: 'secret' })).toBeUndefined()
    expect(parseHgssCampaignClientCommand({ ...commands[1], to: { ...position, mapId: 62 } })).toBeUndefined()
    expect(parseHgssCampaignClientCommand({ ...commands[1], mode: 'bike' })).toBeUndefined()
    expect(parseHgssCampaignClientCommand({ ...commands[1], mode: 'surf' })).toBeUndefined()
    expect(parseHgssCampaignClientCommand({ ...commands[4], eventRevision: 0 })).toBeUndefined()
  })

  it('borne les effets de progression et fige récursivement leurs valeurs CAS', () => {
    const campaignEvent = commands[0]
    const parsed = parseHgssCampaignClientCommand(JSON.parse(JSON.stringify(campaignEvent)))
    expect(parsed).toEqual(campaignEvent)
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed?.kind === 'shared-event' ? parsed.counters[0] : undefined)).toBe(true)
    expect(parseHgssCampaignClientCommand({
      ...campaignEvent,
      milestoneIds: ['story:zephyr-badge', 'story:zephyr-badge'],
    })).toBeUndefined()
    expect(parseHgssCampaignClientCommand({
      ...campaignEvent,
      counters: [
        { id: 'badges', expectedValue: 0, value: 1 },
        { id: 'badges', expectedValue: 1, value: 2 },
      ],
    })).toBeUndefined()
  })

  it('ne laisse pas le client commander un adversaire ni injecter un objet Dresseur', () => {
    expect(parseHgssCampaignClientCommand({
      ...commands[3],
      action: { kind: 'move', actor: { side: 'opponent', slot: 0 }, moveIndex: 0, target: { side: 'player', slot: 0 } },
    })).toBeUndefined()
    expect(parseHgssCampaignClientCommand({
      ...commands[3],
      action: { kind: 'trainerItem', actor: { side: 'player', slot: 0 }, itemId: 17, targetPartyIndex: 0 },
    })).toBeUndefined()
    expect(parseHgssCampaignClientCommand({
      ...commands[3],
      action: { kind: 'item', actor: { side: 'player', slot: 0 }, itemId: 17, targetPartyIndex: 0, moveIndex: 4 },
    })).toBeUndefined()
  })

  it('refuse les objets non JSON et ne lève pas face à un accesseur hostile', () => {
    expect(parseHgssCampaignClientCommand(new Date())).toBeUndefined()
    const hostile = Object.create(null) as Record<string, unknown>
    Object.defineProperty(hostile, 'protocolVersion', { enumerable: true, get: () => { throw new Error('hostile') } })
    expect(parseHgssCampaignClientCommand(hostile)).toBeUndefined()
  })
})

describe('snapshot serveur de campagne HGSS', () => {
  it('valide une projection publique minimale après un aller-retour JSON', () => {
    const decoded: unknown = JSON.parse(JSON.stringify(snapshot))
    const parsed = parseHgssCampaignServerSnapshot(decoded)
    expect(parsed).toEqual(snapshot)
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed?.players)).toBe(true)
    expect(Object.isFrozen(parsed?.pendingEvents[0]?.pendingPlayerIds)).toBe(true)
    expect(Object.isFrozen(parsed?.battle?.participants[0]?.pokemon)).toBe(true)
  })

  it('accepte les identités Pokémon opaques ou legacy machine, mais refuse un chemin legacy arbitraire', () => {
    expect(randomPokemonIds[0]).toMatch(/^pkm:v1:r:[0-9a-f]{32}$/)
    expect(parseHgssCampaignServerSnapshot(snapshot)).toEqual(snapshot)

    const arbitraryLegacy = snapshot.battle!.participants.map((participant, index) => (
      index === 0
        ? { ...participant, pokemon: { ...participant.pokemon, pokemonId: arbitraryLegacyPokemonId } }
        : participant
    ))
    expect(parseHgssCampaignServerSnapshot({
      ...snapshot,
      battle: { ...snapshot.battle!, participants: arbitraryLegacy },
    })).toBeUndefined()

    const participants = snapshot.battle!.participants.map((participant, index) => (
      index === 0
        ? { ...participant, pokemon: { ...participant.pokemon, pokemonId: 'pokemon:1' } }
        : participant
    ))
    expect(parseHgssCampaignServerSnapshot({
      ...snapshot,
      battle: { ...snapshot.battle!, participants },
    })).toBeUndefined()
  })

  it('accepte un combat terminé uniquement avec son résultat', () => {
    const ended = {
      ...snapshot,
      battle: {
        ...snapshot.battle!,
        phase: 'ended',
        pendingCommandActors: [],
        result: 'player-won',
      },
    }
    expect(parseHgssCampaignServerSnapshot(ended)).toEqual(ended)
    expect(parseHgssCampaignServerSnapshot({ ...ended, battle: { ...ended.battle, result: undefined } })).toBeUndefined()
    expect(parseHgssCampaignServerSnapshot({ ...snapshot, battle: { ...snapshot.battle!, result: 'draw' } })).toBeUndefined()
  })

  it('refuse les doublons et les références qui ne font pas partie du snapshot', () => {
    expect(parseHgssCampaignServerSnapshot({ ...snapshot, players: [snapshot.players[0], snapshot.players[0]] })).toBeUndefined()
    expect(parseHgssCampaignServerSnapshot({
      ...snapshot,
      sharedProgression: { ...snapshot.sharedProgression, milestoneIds: ['story:starter', 'story:starter'] },
    })).toBeUndefined()
    expect(parseHgssCampaignServerSnapshot({
      ...snapshot,
      pendingEvents: [snapshot.pendingEvents[0], snapshot.pendingEvents[0]],
    })).toBeUndefined()
    expect(parseHgssCampaignServerSnapshot({
      ...snapshot,
      pendingEvents: [{ ...snapshot.pendingEvents[0]!, pendingPlayerIds: ['player:absent'] }],
    })).toBeUndefined()
    expect(parseHgssCampaignServerSnapshot({
      ...snapshot,
      pendingEvents: [{ ...snapshot.pendingEvents[0]!, eventRevision: snapshot.revision + 1 }],
    })).toBeUndefined()
    expect(parseHgssCampaignServerSnapshot({
      ...snapshot,
      pendingEvents: [{ ...snapshot.pendingEvents[0]!, eventRevision: 0 }],
    })).toBeUndefined()
    expect(parseHgssCampaignServerSnapshot({
      ...snapshot,
      sharedProgression: {
        ...snapshot.sharedProgression,
        milestoneIds: snapshot.sharedProgression.milestoneIds.filter((id) => id !== 'event:badge:1'),
      },
    })).toBeUndefined()
    expect(parseHgssCampaignServerSnapshot({
      ...snapshot,
      sharedProgression: {
        ...snapshot.sharedProgression,
        milestoneIds: [...snapshot.sharedProgression.milestoneIds, 'event:badge:2'],
      },
      pendingEvents: [
        snapshot.pendingEvents[0],
        {
          eventId: 'event:badge:2',
          eventRevision: snapshot.pendingEvents[0]!.eventRevision,
          pendingPlayerIds: ['player:1'],
        },
      ],
    })).toBeUndefined()
    const participants = snapshot.battle!.participants.map((participant, index) => (
      index === 0 ? { ...participant, controllerPlayerId: 'player:absent' } : participant
    ))
    expect(parseHgssCampaignServerSnapshot({ ...snapshot, battle: { ...snapshot.battle!, participants } })).toBeUndefined()
  })

  it('limite le contrat coopératif à deux joueurs', () => {
    expect(hgssCampaignMaximumPlayers).toBe(2)
    expect(parseHgssCampaignServerSnapshot({
      ...snapshot,
      players: [...snapshot.players, {
        ...snapshot.players[0]!,
        playerId: 'player:3',
        displayName: 'KRIS',
      }],
    })).toBeUndefined()
  })

  it('refuse un état de combat incohérent ou trop détaillé', () => {
    const participants = snapshot.battle!.participants.map((participant, index) => (
      index === 0
        ? { ...participant, pokemon: { ...participant.pokemon, currentHp: participant.pokemon.maxHp + 1 } }
        : participant
    ))
    expect(parseHgssCampaignServerSnapshot({ ...snapshot, battle: { ...snapshot.battle!, participants } })).toBeUndefined()
    expect(parseHgssCampaignServerSnapshot({
      ...snapshot,
      battle: { ...snapshot.battle!, pendingCommandActors: [{ side: 'opponent', slot: 0 }] },
    })).toBeUndefined()
    const opponentControlled = snapshot.battle!.participants.map((participant, index) => (
      index === 2 ? { ...participant, controllerPlayerId: 'player:1' } : participant
    ))
    expect(parseHgssCampaignServerSnapshot({
      ...snapshot,
      battle: { ...snapshot.battle!, participants: opponentControlled },
    })).toBeUndefined()
    const uncontrolledPlayer = snapshot.battle!.participants.map((participant, index) => (
      index === 0 ? { ownerId: participant.ownerId, position: participant.position, partyIndex: participant.partyIndex, pokemon: participant.pokemon } : participant
    ))
    expect(parseHgssCampaignServerSnapshot({
      ...snapshot,
      battle: { ...snapshot.battle!, participants: uncontrolledPlayer },
    })).toBeUndefined()
    const canonicalLeak = snapshot.battle!.participants.map((participant, index) => (
      index === 0 ? { ...participant, pokemon: { ...participant.pokemon, moves: [] } } : participant
    ))
    expect(parseHgssCampaignServerSnapshot({ ...snapshot, battle: { ...snapshot.battle!, participants: canonicalLeak } })).toBeUndefined()
  })

  it('refuse les tableaux creux ou enrichis de propriétés non JSON', () => {
    const sparsePlayers = new Array(2)
    sparsePlayers[0] = snapshot.players[0]
    expect(parseHgssCampaignServerSnapshot({ ...snapshot, players: sparsePlayers })).toBeUndefined()
    const pendingEvents = [...snapshot.pendingEvents] as typeof snapshot.pendingEvents & { token?: string }
    pendingEvents.token = 'secret'
    expect(parseHgssCampaignServerSnapshot({ ...snapshot, pendingEvents })).toBeUndefined()
  })
})
