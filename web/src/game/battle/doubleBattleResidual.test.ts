import { describe, expect, it } from 'vitest'
import { decodeHgssItemData, hgssItemDataSize } from '../../rom/items/itemData'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { applyDoubleBattleResidual } from './doubleBattleResidual'
import { createDoubleBattleSession, type DoubleBattleEvent } from './doubleBattleSession'

const catalog = createPokemonTestCatalog()

function pokemon(speciesId: number, identity: number) {
  return createCanonicalPokemon(catalog, {
    speciesId,
    level: 10,
    rng: createHgssLcrng(identity),
    personality: { kind: 'fixed', value: identity },
    individualValues: { kind: 'fixed', value: 0 },
    originalTrainer: { id: identity, name: 'TEST', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 0, metLevel: 5, metTerrain: 0 },
    ballId: 4,
    moveIds: [33],
  })
}

function residualSession() {
  const session = createDoubleBattleSession({
    kind: 'multi',
    catalog,
    player: [
      { ownerId: 'player-a', party: [pokemon(152, 1)], activePartyIndex: 0, controlled: true },
      { ownerId: 'player-b', party: [pokemon(155, 2)], activePartyIndex: 0, controlled: true },
    ],
    opponent: [
      { ownerId: 'opponent-a', party: [pokemon(158, 3)], activePartyIndex: 0, controlled: false },
      { ownerId: 'opponent-b', party: [pokemon(152, 4)], activePartyIndex: 0, controlled: false },
    ],
  })
  for (const side of ['player', 'opponent'] as const) for (const participant of session.teams[side]) {
    participant.party[participant.activePartyIndex]!.abilityId = 0
  }
  return session
}

function bigRootCatalog() {
  const payload = new Uint8Array(hgssItemDataSize)
  payload[2] = 124
  payload[3] = 30
  const item = decodeHgssItemData(payload, 1, 'GROSSE RACINE', 'Renforce les soins absorbés.')
  return { pocketNames: [], items: Object.assign([], { 1: item }) }
}

function residualEvents(session: ReturnType<typeof residualSession>): DoubleBattleEvent[] {
  const events: DoubleBattleEvent[] = []
  applyDoubleBattleResidual(session, events, createHgssLcrng(50))
  return events
}

describe('résiduels du combat double', () => {
  it('cumule séparément Anneau Hydro et Racines avec Grosse Racine', () => {
    const session = residualSession()
    session.itemCatalog = bigRootCatalog()
    const participant = session.teams.player[0]
    const active = participant.party[0]!
    active.heldItemId = 1
    active.stats.hp = 160
    active.currentHp = 50
    participant.volatile.aquaRing = true
    participant.volatile.ingrain = true

    const events = residualEvents(session)

    expect(active.currentHp).toBe(76)
    expect(events.filter((event) => event.kind === 'heal'
      && event.target.side === 'player' && event.target.slot === 0))
      .toEqual([
        expect.objectContaining({ kind: 'heal', amount: 13 }),
        expect.objectContaining({ kind: 'heal', amount: 13 }),
      ])
  })

  it('maintient Anti-Soin pendant tout son dernier tour, y compris pour Vœu', () => {
    const session = residualSession()
    const participant = session.teams.player[0]
    const active = participant.party[0]!
    active.stats.hp = 160
    active.currentHp = 50
    Object.assign(participant.volatile, { aquaRing: true, ingrain: true, healBlockTurns: 1 })
    session.wishes.push({ turns: 1, target: { side: 'player', slot: 0 }, amount: 80 })

    const events = residualEvents(session)

    expect(active.currentHp).toBe(50)
    expect(session.wishes).toEqual([])
    expect(participant.volatile.healBlockTurns).toBe(0)
    expect(events).not.toContainEqual(expect.objectContaining({ kind: 'heal', target: { side: 'player', slot: 0 } }))
    expect(events).toContainEqual({
      kind: 'condition', target: { side: 'player', slot: 0 }, condition: 'healBlockEnded', applied: true,
    })
  })

  it('applique Grosse Racine, Suintement, Anti-Soin et Garde Magik à Vampigraine', () => {
    const liquidOoze = residualSession()
    liquidOoze.itemCatalog = bigRootCatalog()
    const seeded = liquidOoze.teams.player[0]
    const receiver = liquidOoze.teams.opponent[0]
    seeded.party[0]!.abilityId = 64
    seeded.party[0]!.stats.hp = seeded.party[0]!.currentHp = 160
    seeded.volatile.seededBy = { side: 'opponent', slot: 0 }
    receiver.party[0]!.heldItemId = 1
    receiver.party[0]!.stats.hp = 160
    receiver.party[0]!.currentHp = 100

    const oozeEvents = residualEvents(liquidOoze)

    expect(seeded.party[0]!.currentHp).toBe(140)
    expect(receiver.party[0]!.currentHp).toBe(74)
    expect(oozeEvents).toContainEqual(expect.objectContaining({
      kind: 'recoil', target: { side: 'opponent', slot: 0 }, damage: 26,
    }))

    const magicGuard = residualSession()
    magicGuard.itemCatalog = bigRootCatalog()
    const guardedSeeded = magicGuard.teams.player[0]
    const guardedReceiver = magicGuard.teams.opponent[0]
    guardedSeeded.party[0]!.abilityId = 64
    guardedSeeded.party[0]!.stats.hp = guardedSeeded.party[0]!.currentHp = 160
    guardedSeeded.volatile.seededBy = { side: 'opponent', slot: 0 }
    guardedReceiver.party[0]!.abilityId = 98
    guardedReceiver.party[0]!.heldItemId = 1
    guardedReceiver.party[0]!.stats.hp = 160
    guardedReceiver.party[0]!.currentHp = 100

    const guardedEvents = residualEvents(magicGuard)

    expect(guardedSeeded.party[0]!.currentHp).toBe(140)
    expect(guardedReceiver.party[0]!.currentHp).toBe(100)
    expect(guardedEvents).not.toContainEqual(expect.objectContaining({
      kind: 'recoil', target: { side: 'opponent', slot: 0 },
    }))

    const healBlocked = residualSession()
    const blockedSeeded = healBlocked.teams.player[0]
    const blockedReceiver = healBlocked.teams.opponent[0]
    blockedSeeded.party[0]!.stats.hp = blockedSeeded.party[0]!.currentHp = 160
    blockedSeeded.volatile.seededBy = { side: 'opponent', slot: 0 }
    blockedReceiver.party[0]!.stats.hp = 160
    blockedReceiver.party[0]!.currentHp = 100
    blockedReceiver.volatile.healBlockTurns = 1

    residualEvents(healBlocked)

    expect(blockedSeeded.party[0]!.currentHp).toBe(140)
    expect(blockedReceiver.party[0]!.currentHp).toBe(100)
  })

  it('fait expirer les compteurs avec leurs événements, même sous Garde Magik', () => {
    const session = residualSession()
    const participant = session.teams.player[0]
    const active = participant.party[0]!
    active.abilityId = 98
    const hpBefore = active.currentHp
    Object.assign(participant.volatile, {
      trappedTurns: 1,
      perishTurns: 2,
      disableTurns: 1,
      disabledMoveId: 33,
      encoreTurns: 1,
      encoreMoveIndex: 0,
      tauntTurns: 1,
      healBlockTurns: 1,
      embargoTurns: 1,
      magnetRiseTurns: 1,
    })
    Object.assign(session.sideConditions.player, {
      reflectTurns: 1,
      lightScreenTurns: 1,
      tailwindTurns: 1,
      luckyChantTurns: 1,
      mistTurns: 1,
      safeguardTurns: 1,
    })
    session.gravityTurns = 1
    session.trickRoomTurns = 1

    const events = residualEvents(session)
    const conditions = events.flatMap((event) => event.kind === 'condition' ? [event.condition] : [])

    expect(active.currentHp).toBe(hpBefore)
    expect(participant.volatile.trappedTurns).toBe(0)
    expect(participant.volatile.disabledMoveId).toBe(0)
    expect(participant.volatile.encoreMoveIndex).toBe(-1)
    expect(conditions).toEqual(expect.arrayContaining([
      'bindingEnded', 'perish:1', 'disableEnded', 'encoreEnded', 'tauntEnded',
      'healBlockEnded', 'embargoEnded', 'magnetRiseEnded', 'reflectEnded',
      'lightScreenEnded', 'tailwindEnded', 'luckyChantEnded', 'mistEnded',
      'safeguardEnded', 'gravityEnded', 'trickRoomEnded',
    ]))
  })
})
