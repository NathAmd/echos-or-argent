import { describe, expect, it } from 'vitest'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { canSwitchDoubleBattleParticipant, consumeDoubleBattleInitialEvents, createDoubleBattleSession, executeDoubleBattleTurn, getRequiredDoubleBattleActors, getSelectableDoubleBattleMoveIndexes, syncDoubleBattleParties, validateDoubleBattleBagItem } from './doubleBattleSession'
import { decodeHgssItemData, hgssItemDataSize, type HgssItemData } from '../../rom/items/itemData'
import { applyDoubleBattleResidual } from './doubleBattleResidual'
import { replaceFaintedDoubleBattleParticipants } from './doubleBattleSwitching'
import type { PokemonPartyHealingPolicy } from '../pokemon/pokemonPartyHealingPolicy'

const catalog = createPokemonTestCatalog()
function mon(speciesId: number) {
  return createCanonicalPokemon(catalog, {
    speciesId, level: 5, rng: createHgssLcrng(speciesId), personality: { kind: 'fixed', value: speciesId }, individualValues: { kind: 'fixed', value: 0 },
    originalTrainer: { id: 1, name: 'J', gender: 'male' }, origin: { language: 3, gameVersion: 7, metLocation: 0, metLevel: 5, metTerrain: 0 }, ballId: 4, moveIds: [33],
  })
}

function battleItem(itemId: number, configure: (payload: Uint8Array) => void) {
  const payload = new Uint8Array(hgssItemDataSize)
  payload[0x0c] = 1
  configure(payload)
  return decodeHgssItemData(payload, itemId, `OBJET ${itemId}`, 'Description ROM')
}

function isolatedDoubleSession() {
  const session = createDoubleBattleSession({ kind: 'multi', catalog, player: [
    { ownerId: 'playerA', party: [mon(152)], activePartyIndex: 0, controlled: true },
    { ownerId: 'playerB', party: [mon(155)], activePartyIndex: 0, controlled: false },
  ], opponent: [
    { ownerId: 'opponentA', party: [mon(158)], activePartyIndex: 0, controlled: false },
    { ownerId: 'opponentB', party: [mon(152)], activePartyIndex: 0, controlled: false },
  ] })
  for (const participant of [session.teams.player[1], ...session.teams.opponent]) participant.party[0]!.moves[0]!.data = {
    ...participant.party[0]!.moves[0]!.data, effect: 85, power: 0, range: 1 << 4, priority: -2,
  }
  return session
}

describe('combat double HGSS', () => {
  it('partage l’identité de présentation des dégâts de zone sans absorber les dégâts résiduels', () => {
    const session = isolatedDoubleSession()
    const actor = session.teams.player[0].party[0]!
    actor.abilityId = 94
    actor.moves[0]!.data = { ...actor.moves[0]!.data, power: 30, accuracy: 0, range: 1 << 2, priority: 1 }
    session.weather = { kind: 'sun', turns: 5 }

    const events = executeDoubleBattleTurn(session, [
      { actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } },
    ], catalog, createHgssLcrng(12))
    const move = events.find((event) => event.kind === 'move' && event.actor.side === 'player')
    const directDamages = events.filter((event) => event.kind === 'damage' && event.target.side === 'opponent')
    const abilityDamage = events.find((event) => event.kind === 'damage' && event.target.side === 'player' && event.movePresentationId === undefined)

    expect(move?.kind).toBe('move')
    expect(directDamages.map((event) => event.kind === 'damage' && event.target.slot)).toEqual([0, 1])
    expect(directDamages.every((event) => event.kind === 'damage' && event.movePresentationId === (move?.kind === 'move' ? move.presentationId : -1))).toBe(true)
    expect(events).toContainEqual(expect.objectContaining({ kind: 'condition', target: { side: 'player', slot: 0 }, condition: 'ability:94' }))
    expect(abilityDamage).toBeDefined()
  })

  it('applique Anti-Bruit à chaque cible avec la table commune de l’overlay', () => {
    const session = isolatedDoubleSession()
    const move = session.teams.player[0].party[0]!.moves[0]!
    move.moveId = 304
    move.data = { ...move.data, moveId: 304, effect: 0, power: 90, accuracy: 0, priority: 1 }
    const target = session.teams.opponent[0].party[0]!
    target.abilityId = 43
    const hpBefore = target.currentHp

    const events = executeDoubleBattleTurn(session, [
      { actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } },
    ], catalog, createHgssLcrng(5))

    expect(events).toContainEqual(expect.objectContaining({ kind: 'noEffect', pokemonName: target.speciesName }))
    expect(target.currentHp).toBe(hpBefore)
  })

  it.each([
    { abilityId: 10, moveType: 13 },
    { abilityId: 11, moveType: 11 },
    { abilityId: 87, moveType: 11 },
  ])('absorbe le type $moveType avec le talent $abilityId et soigne un quart des PV', ({ abilityId, moveType }) => {
    const session = isolatedDoubleSession()
    const actor = session.teams.player[0].party[0]!
    actor.moves[0]!.data = { ...actor.moves[0]!.data, type: moveType, power: 40, accuracy: 0, priority: 1 }
    const target = session.teams.opponent[0].party[0]!
    target.abilityId = abilityId
    target.currentHp = Math.floor(target.stats.hp / 2)
    const hpBefore = target.currentHp

    const events = executeDoubleBattleTurn(session, [
      { actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } },
    ], catalog, createHgssLcrng(abilityId))

    const expectedHeal = Math.min(target.stats.hp - hpBefore, Math.max(1, Math.floor(target.stats.hp / 4)))
    expect(target.currentHp).toBe(hpBefore + expectedHeal)
    expect(events).toContainEqual(expect.objectContaining({ kind: 'damage', target: { side: 'opponent', slot: 0 }, damage: 0, typeMultiplier: 0 }))
    expect(events).toContainEqual(expect.objectContaining({ kind: 'condition', condition: `ability:${abilityId}`, applied: true }))
    expect(events).toContainEqual(expect.objectContaining({ kind: 'heal', amount: expectedHeal }))
  })

  it.each([
    { healBlocked: false, label: 'à PV pleins' },
    { healBlocked: true, label: 'sous Anti-Soin' },
  ])('absorbe en double sans produire de faux soin $label', ({ healBlocked }) => {
    const session = isolatedDoubleSession()
    const actor = session.teams.player[0].party[0]!
    actor.moves[0]!.data = { ...actor.moves[0]!.data, type: 11, power: 40, accuracy: 0, priority: 1 }
    const target = session.teams.opponent[0]
    target.party[0]!.abilityId = 11
    target.volatile.healBlockTurns = healBlocked ? 2 : 0
    if (healBlocked) target.party[0]!.currentHp -= 5
    const hpBefore = target.party[0]!.currentHp

    const events = executeDoubleBattleTurn(session, [
      { actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } },
    ], catalog, createHgssLcrng(11))

    expect(target.party[0]!.currentHp).toBe(hpBefore)
    expect(events).toContainEqual(expect.objectContaining({ kind: 'damage', target: { side: 'opponent', slot: 0 }, damage: 0, typeMultiplier: 0 }))
    expect(events).toContainEqual(expect.objectContaining({ kind: 'condition', condition: 'ability:11', applied: true }))
    expect(events).not.toContainEqual(expect.objectContaining({ kind: 'heal', target: { side: 'opponent', slot: 0 } }))
  })

  it('Motorisé absorbe l’attaque électrique et augmente la Vitesse', () => {
    const session = isolatedDoubleSession()
    const actor = session.teams.player[0].party[0]!
    actor.moves[0]!.data = { ...actor.moves[0]!.data, type: 13, power: 40, accuracy: 0, priority: 1 }
    const target = session.teams.opponent[0]
    target.party[0]!.abilityId = 78
    const hpBefore = target.party[0]!.currentHp

    const events = executeDoubleBattleTurn(session, [
      { actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } },
    ], catalog, createHgssLcrng(78))

    expect(target.party[0]!.currentHp).toBe(hpBefore)
    expect(target.stages.speed).toBe(1)
    expect(events).toContainEqual(expect.objectContaining({ kind: 'stat', stat: 'speed', change: 1, applied: true }))
  })

  it('Torche absorbe le Feu puis renforce les attaques Feu du porteur', () => {
    const absorbed = isolatedDoubleSession()
    const attacker = absorbed.teams.player[0].party[0]!
    attacker.moves[0]!.data = { ...attacker.moves[0]!.data, type: 10, power: 40, accuracy: 0, priority: 1 }
    const torch = absorbed.teams.opponent[0]
    torch.party[0]!.abilityId = 18
    const hpBefore = torch.party[0]!.currentHp

    executeDoubleBattleTurn(absorbed, [
      { actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } },
    ], catalog, createHgssLcrng(18))
    expect(torch.party[0]!.currentHp).toBe(hpBefore)
    expect(torch.volatile.flashFire).toBe(true)

    const damageWith = (flashFire: boolean) => {
      const session = isolatedDoubleSession()
      const actor = session.teams.player[0]
      actor.volatile.flashFire = flashFire
      actor.party[0]!.moves[0]!.data = { ...actor.party[0]!.moves[0]!.data, type: 10, power: 40, accuracy: 0, priority: 1 }
      const target = session.teams.opponent[0].party[0]!
      const before = target.currentHp
      executeDoubleBattleTurn(session, [
        { actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } },
      ], catalog, createHgssLcrng(19))
      return before - target.currentHp
    }
    expect(damageWith(true)).toBeGreaterThan(damageWith(false))
  })

  it('Brise Moule contourne les talents d’absorption en double', () => {
    const session = isolatedDoubleSession()
    const actor = session.teams.player[0].party[0]!
    actor.abilityId = 104
    actor.moves[0]!.data = { ...actor.moves[0]!.data, type: 11, power: 40, accuracy: 0, priority: 1 }
    const target = session.teams.opponent[0].party[0]!
    target.abilityId = 11
    const hpBefore = target.currentHp

    executeDoubleBattleTurn(session, [
      { actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } },
    ], catalog, createHgssLcrng(104))

    expect(target.currentHp).toBeLessThan(hpBefore)
  })

  it('redirige une capacité électrique vers le premier Paratonnerre de l’ordre réel du tour', () => {
    const session = isolatedDoubleSession()
    const move = session.teams.player[0].party[0]!.moves[0]!
    move.data = { ...move.data, type: 13, power: 30, accuracy: 0, range: 0, priority: 1 }
    const chosen = session.teams.opponent[0].party[0]!
    const redirector = session.teams.opponent[1].party[0]!
    redirector.abilityId = 31
    const chosenHp = chosen.currentHp
    const redirectorHp = redirector.currentHp

    executeDoubleBattleTurn(session, [
      { actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } },
    ], catalog, createHgssLcrng(0x31))

    expect(chosen.currentHp).toBe(chosenHp)
    expect(redirector.currentHp).toBeLessThan(redirectorHp)
  })

  it('cumule Pression pour chaque adversaire touché par une capacité de zone', () => {
    const session = isolatedDoubleSession()
    const move = session.teams.player[0].party[0]!.moves[0]!
    move.data = { ...move.data, power: 20, accuracy: 0, range: 1 << 2, priority: 1 }
    for (const opponent of session.teams.opponent) opponent.party[0]!.abilityId = 46
    const ppBefore = move.pp

    executeDoubleBattleTurn(session, [
      { actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } },
    ], catalog, createHgssLcrng(6))

    expect(move.pp).toBe(ppBefore - 3)
  })

  it('prépare une seule activation Vive Griffe par combattant avant le tri double', () => {
    const session = isolatedDoubleSession()
    const quickClaw = battleItem(217, (payload) => { payload[2] = 52; payload[3] = 20 })
    session.itemCatalog = { pocketNames: [], items: Object.assign([], { 217: quickClaw }) }
    const actor = session.teams.player[0].party[0]!
    actor.heldItemId = 217
    actor.stats.speed = 1
    actor.moves[0]!.data = { ...actor.moves[0]!.data, priority: 0 }
    for (const participant of [session.teams.player[1], ...session.teams.opponent]) participant.party[0]!.stats.speed = 200
    const fixedRng = { getSeed: () => 0, nextU16: () => 5 }

    const events = executeDoubleBattleTurn(session, [
      { actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } },
    ], catalog, fixedRng)

    expect(events.find((event) => event.kind === 'move')).toMatchObject({ kind: 'move', actor: { side: 'player', slot: 0 } })
    expect(events).toContainEqual(expect.objectContaining({ kind: 'condition', target: { side: 'player', slot: 0 }, condition: 'itemPriority:52' }))
  })

  it('applique globalement Orbe Vie et Ceinture Force dans le moteur double', () => {
    const lifeOrbSession = isolatedDoubleSession()
    const lifeOrb = battleItem(270, (payload) => { payload[2] = 98; payload[3] = 30 })
    lifeOrbSession.itemCatalog = { pocketNames: [], items: Object.assign([], { 270: lifeOrb }) }
    const attacker = lifeOrbSession.teams.player[0].party[0]!
    attacker.heldItemId = 270
    attacker.moves[0]!.data = { ...attacker.moves[0]!.data, power: 30, accuracy: 0, priority: 1 }
    const attackerHp = attacker.currentHp
    const orbEvents = executeDoubleBattleTurn(lifeOrbSession, [{ actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } }], catalog, createHgssLcrng(8))
    expect(attacker.currentHp).toBe(attackerHp - Math.max(1, Math.floor(attacker.stats.hp / 10)))
    expect(orbEvents).toContainEqual(expect.objectContaining({ kind: 'recoil', target: { side: 'player', slot: 0 } }))

    const sashSession = isolatedDoubleSession()
    const sash = battleItem(275, (payload) => { payload[2] = 103 })
    sashSession.itemCatalog = { pocketNames: [], items: Object.assign([], { 275: sash }) }
    const target = sashSession.teams.opponent[0].party[0]!
    target.heldItemId = 275
    sashSession.teams.player[0].party[0]!.moves[0]!.data = { ...sashSession.teams.player[0].party[0]!.moves[0]!.data, power: 250, accuracy: 0, priority: 1 }
    executeDoubleBattleTurn(sashSession, [{ actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } }], catalog, createHgssLcrng(9))
    expect(target.currentHp).toBe(1)
    expect(target.heldItemId).toBe(0)
  })

  it('verrouille les Bandeaux/Lunettes/Mouchoir Choix via le sélecteur commun double', () => {
    const session = isolatedDoubleSession()
    const choiceBand = battleItem(220, (payload) => { payload[2] = 55 })
    session.itemCatalog = { pocketNames: [], items: Object.assign([], { 220: choiceBand }) }
    const actor = session.teams.player[0].party[0]!
    actor.heldItemId = 220
    actor.moves.push({ moveId: 45, pp: 40, maxPp: 40, ppUps: 0, data: { ...actor.moves[0]!.data, moveId: 45 } })
    executeDoubleBattleTurn(session, [{ actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } }], catalog, createHgssLcrng(10))
    expect(getSelectableDoubleBattleMoveIndexes(session, { side: 'player', slot: 0 })).toEqual([0])
  })

  it('déclenche les baies automatiques dans la même table que le combat simple', () => {
    const session = isolatedDoubleSession()
    const sitrus = battleItem(158, (payload) => { payload[2] = 13; payload[3] = 25 })
    session.itemCatalog = { pocketNames: [], items: Object.assign([], { 158: sitrus }) }
    const actor = session.teams.player[0].party[0]!
    actor.heldItemId = 158; actor.currentHp = Math.floor(actor.stats.hp / 2)
    const hpBefore = actor.currentHp
    const events = executeDoubleBattleTurn(session, [{ actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } }], catalog, createHgssLcrng(11))
    expect(events).toContainEqual(expect.objectContaining({ kind: 'heal', target: { side: 'player', slot: 0 } }))
    expect(actor.currentHp).toBeGreaterThan(hpBefore)
    expect(actor.heldItemId).toBe(0)
  })

  it('partage la suppression du tour de charge par Herbe Pouvoir en double', () => {
    const session = isolatedDoubleSession()
    session.itemCatalog = { pocketNames: [], items: Object.assign([], { 271: battleItem(271, (payload) => { payload[2] = 99 }) }) }
    const actor = session.teams.player[0].party[0]!; actor.heldItemId = 271
    actor.moves[0]!.data = { ...actor.moves[0]!.data, effect: 39, power: 80, accuracy: 0, priority: 1 }
    const target = session.teams.opponent[0].party[0]!, hpBefore = target.currentHp

    const events = executeDoubleBattleTurn(session, [{ actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } }], catalog, createHgssLcrng(12))

    expect(events).toContainEqual(expect.objectContaining({ kind: 'condition', condition: 'powerHerb' }))
    expect(target.currentHp).toBeLessThan(hpBefore)
    expect(actor.heldItemId).toBe(0)
  })

  it('transfère globalement l’objet collant après une capacité de contact', () => {
    const session = isolatedDoubleSession()
    session.itemCatalog = { pocketNames: [], items: Object.assign([], { 288: battleItem(288, (payload) => { payload[2] = 116; payload[3] = 8 }) }) }
    const actor = session.teams.player[0].party[0]!, target = session.teams.opponent[0].party[0]!
    target.heldItemId = 288; actor.moves[0]!.data = { ...actor.moves[0]!.data, power: 30, flags: 1, accuracy: 0, priority: 1 }

    const events = executeDoubleBattleTurn(session, [{ actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } }], catalog, createHgssLcrng(13))

    expect(events).toContainEqual(expect.objectContaining({ kind: 'condition', condition: 'stickyBarbTransfer' }))
    expect(actor.heldItemId).toBe(288)
    expect(target.heldItemId).toBe(0)
  })

  it('partage le compteur de répétition de Métronome en combat double', () => {
    const session = isolatedDoubleSession()
    session.itemCatalog = { pocketNames: [], items: Object.assign([], { 277: battleItem(277, (payload) => { payload[2] = 105; payload[3] = 10 }) }) }
    const actor = session.teams.player[0].party[0]!, target = session.teams.opponent[0].party[0]!
    actor.heldItemId = 277; actor.level = 50; actor.stats.attack = 100; target.currentHp = target.stats.hp = 500; target.stats.defense = 100
    actor.moves[0]!.data = { ...actor.moves[0]!.data, power: 80, category: 0, accuracy: 0, priority: 1 }
    const action = [{ actor: { side: 'player' as const, slot: 0 as const }, moveIndex: 0, target: { side: 'opponent' as const, slot: 0 as const } }]
    const fixedRng = { getSeed: () => 0, nextU16: () => 0 }

    const first = executeDoubleBattleTurn(session, action, catalog, fixedRng).find((event) => event.kind === 'damage' && event.target.side === 'opponent' && event.target.slot === 0)
    const second = executeDoubleBattleTurn(session, action, catalog, fixedRng).find((event) => event.kind === 'damage' && event.target.side === 'opponent' && event.target.slot === 0)

    expect(first?.kind === 'damage' && second?.kind === 'damage' && second.damage).toBeGreaterThan(first?.kind === 'damage' ? first.damage : 0)
  })

  it('fait bloquer le remplacement forcé par Ventouse en double', () => {
    const target = mon(158); target.abilityId = 21
    const reserve = mon(155)
    const session = createDoubleBattleSession({ kind: 'multi', catalog, player: [
      { ownerId: 'playerA', party: [mon(152)], activePartyIndex: 0, controlled: true },
      { ownerId: 'playerB', party: [mon(155)], activePartyIndex: 0, controlled: false },
    ], opponent: [
      { ownerId: 'opponentA', party: [target, reserve], activePartyIndex: 0, controlled: false },
      { ownerId: 'opponentB', party: [mon(152)], activePartyIndex: 0, controlled: false },
    ] })
    session.teams.player[0].party[0]!.moves[0]!.data = { ...session.teams.player[0].party[0]!.moves[0]!.data, effect: 28, power: 0, accuracy: 0, priority: 1 }
    for (const participant of [session.teams.player[1], ...session.teams.opponent]) participant.party[participant.activePartyIndex]!.moves[0]!.data = { ...participant.party[participant.activePartyIndex]!.moves[0]!.data, effect: 85, power: 0, range: 1 << 4, priority: -1 }

    const events = executeDoubleBattleTurn(session, [{ actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } }], catalog, createHgssLcrng(14))

    expect(events).toContainEqual(expect.objectContaining({ kind: 'noEffect', actor: { side: 'player', slot: 0 } }))
    expect(session.teams.opponent[0].activePartyIndex).toBe(0)
  })

  it('expose les talents de piège au contrôleur de changement double', () => {
    const session = isolatedDoubleSession()
    session.teams.opponent[0].party[0]!.abilityId = 23
    expect(canSwitchDoubleBattleParticipant(session, { side: 'player', slot: 0 })).toBe(false)
    session.teams.player[0].party[0]!.abilityId = 23
    expect(canSwitchDoubleBattleParticipant(session, { side: 'player', slot: 0 })).toBe(true)
  })

  it('Calque choisit avec le RNG ROM parmi les talents adverses autorisés', () => {
    const tracer = mon(152); tracer.abilityId = 36
    const ally = mon(155)
    const opponentA = mon(158); opponentA.abilityId = 37
    const opponentB = mon(152); opponentB.abilityId = 74
    const session = createDoubleBattleSession({ kind: 'multi', catalog, rng: createHgssLcrng(7), player: [
      { ownerId: 'playerA', party: [tracer], activePartyIndex: 0, controlled: true },
      { ownerId: 'playerB', party: [ally], activePartyIndex: 0, controlled: false },
    ], opponent: [
      { ownerId: 'opponentA', party: [opponentA], activePartyIndex: 0, controlled: false },
      { ownerId: 'opponentB', party: [opponentB], activePartyIndex: 0, controlled: false },
    ] })
    expect([37, 74]).toContain(session.teams.player[0].volatile.abilityOverrideId)
    expect(session.initialEvents).toContainEqual(expect.objectContaining({ kind: 'condition', target: { side: 'player', slot: 0 }, applied: true }))
  })

  it('demande les commandes des deux slots joueur et ordonne quatre acteurs', () => {
    const playerParty = [mon(152), mon(155)]
    const opponentParty = [mon(158), mon(152)]
    const session = createDoubleBattleSession({ kind: 'double', catalog, player: [
      { ownerId: 'player', party: playerParty, activePartyIndex: 0, controlled: true },
      { ownerId: 'player', party: playerParty, activePartyIndex: 1, controlled: true },
    ], opponent: [
      { ownerId: 'opponent', party: opponentParty, activePartyIndex: 0, controlled: false },
      { ownerId: 'opponent', party: opponentParty, activePartyIndex: 1, controlled: false },
    ] })
    expect(getRequiredDoubleBattleActors(session)).toHaveLength(2)
    const events = executeDoubleBattleTurn(session, [
      { actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } },
      { actor: { side: 'player', slot: 1 }, moveIndex: 0, target: { side: 'opponent', slot: 1 } },
    ], catalog, createHgssLcrng(8))
    expect(events.filter((event) => event.kind === 'move')).toHaveLength(4)
    expect(session.turn).toBe(1)
  })

  it("laisse l'allié du multi à l'IA et partage le ciblage adverse", () => {
    const session = createDoubleBattleSession({ kind: 'multi', catalog, player: [
      { ownerId: 'player', party: [mon(152)], activePartyIndex: 0, controlled: true },
      { ownerId: 'ally', party: [mon(155)], activePartyIndex: 0, controlled: false },
    ], opponent: [
      { ownerId: 'opponentA', party: [mon(158)], activePartyIndex: 0, controlled: false },
      { ownerId: 'opponentB', party: [mon(152)], activePartyIndex: 0, controlled: false },
    ] })
    expect(getRequiredDoubleBattleActors(session)).toEqual([{ side: 'player', slot: 0 }])
    const events = executeDoubleBattleTurn(session, [
      { actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 1 } },
    ], catalog, createHgssLcrng(2))
    expect(events.filter((event) => event.kind === 'move')).toHaveLength(4)
  })

  it('ordonne et exécute Lutte lorsque tous les PP sont épuisés', () => {
    catalog.moves[165] = { ...catalog.moves[33]!, moveId: 165, effect: 254, power: 50, pp: 1 }
    catalog.moveNames[165] = 'Lutte'
    const session = createDoubleBattleSession({ kind: 'double', catalog, player: [
      { ownerId: 'playerA', party: [mon(152)], activePartyIndex: 0, controlled: true },
      { ownerId: 'playerB', party: [mon(155)], activePartyIndex: 0, controlled: true },
    ], opponent: [
      { ownerId: 'opponentA', party: [mon(158)], activePartyIndex: 0, controlled: false },
      { ownerId: 'opponentB', party: [mon(152)], activePartyIndex: 0, controlled: false },
    ] })
    for (const side of ['player', 'opponent'] as const) {
      for (const participant of session.teams[side]) participant.party[0]!.moves[0]!.pp = 0
    }

    const events = executeDoubleBattleTurn(session, [
      { actor: { side: 'player', slot: 0 }, moveIndex: -1, target: { side: 'opponent', slot: 0 } },
      { actor: { side: 'player', slot: 1 }, moveIndex: -1, target: { side: 'opponent', slot: 1 } },
    ], catalog, createHgssLcrng(9))

    expect(events.filter((event) => event.kind === 'move' && event.moveId === 165)).toHaveLength(4)
    expect(events.filter((event) => event.kind === 'recoil')).toHaveLength(4)
  })

  it('applique une capacité de zone aux deux adversaires avec un seul PP', () => {
    const session = createDoubleBattleSession({ kind: 'double', catalog, player: [
      { ownerId: 'playerA', party: [mon(152)], activePartyIndex: 0, controlled: true },
      { ownerId: 'playerB', party: [mon(155)], activePartyIndex: 0, controlled: true },
    ], opponent: [
      { ownerId: 'opponentA', party: [mon(158)], activePartyIndex: 0, controlled: false },
      { ownerId: 'opponentB', party: [mon(152)], activePartyIndex: 0, controlled: false },
    ] })
    const spreadMove = session.teams.player[0].party[0]!.moves[0]!
    spreadMove.data = { ...spreadMove.data, power: 40, accuracy: 0, range: 1 << 2 }
    for (const participant of [session.teams.player[1], ...session.teams.opponent]) {
      const move = participant.party[participant.activePartyIndex]!.moves[0]!
      move.data = { ...move.data, power: 0, effect: 85, range: 1 << 4 }
    }
    const ppBefore = spreadMove.pp

    const events = executeDoubleBattleTurn(session, [
      { actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } },
      { actor: { side: 'player', slot: 1 }, moveIndex: 0, target: { side: 'player', slot: 1 } },
    ], catalog, createHgssLcrng(12))

    expect(events.filter((event) => event.kind === 'damage' && event.target.side === 'opponent')).toHaveLength(2)
    expect(spreadMove.pp).toBe(ppBefore - 1)
  })

  it('conserve globalement météo, écrans et Distorsion entre les quatre actions', () => {
    const playerParty = [mon(152), mon(155)]
    const opponentParty = [mon(158), mon(152)]
    const session = createDoubleBattleSession({ kind: 'double', catalog, initialWeather: 'hail', player: [
      { ownerId: 'player', party: playerParty, activePartyIndex: 0, controlled: true },
      { ownerId: 'player', party: playerParty, activePartyIndex: 1, controlled: true },
    ], opponent: [
      { ownerId: 'opponent', party: opponentParty, activePartyIndex: 0, controlled: false },
      { ownerId: 'opponent', party: opponentParty, activePartyIndex: 1, controlled: false },
    ] })
    const reflect = session.teams.player[0].party[0]!.moves[0]!
    reflect.data = { ...reflect.data, effect: 65, power: 0, range: 1 << 4, accuracy: 0 }
    const trickRoom = session.teams.player[1].party[1]!.moves[0]!
    trickRoom.data = { ...trickRoom.data, effect: 259, power: 0, range: 1 << 4, accuracy: 0 }
    for (const participant of session.teams.opponent) {
      participant.party[participant.activePartyIndex]!.moves[0]!.data = {
        ...participant.party[participant.activePartyIndex]!.moves[0]!.data, effect: 85, power: 0, range: 1 << 4,
      }
    }

    executeDoubleBattleTurn(session, [
      { actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'player', slot: 0 } },
      { actor: { side: 'player', slot: 1 }, moveIndex: 0, target: { side: 'player', slot: 1 } },
    ], catalog, createHgssLcrng(13))

    expect(session.weather).toEqual({ kind: 'hail', turns: 0 })
    expect(session.sideConditions.player.reflectTurns).toBe(4)
    expect(session.trickRoomTurns).toBe(4)
  })

  it('fait agir Abri avant les frappes doubles et Ténacité avant un coup fatal', () => {
    const playerParty = [mon(152), mon(155)]
    const opponentParty = [mon(158), mon(152)]
    const session = createDoubleBattleSession({ kind: 'double', catalog, player: [
      { ownerId: 'player', party: playerParty, activePartyIndex: 0, controlled: true },
      { ownerId: 'player', party: playerParty, activePartyIndex: 1, controlled: true },
    ], opponent: [
      { ownerId: 'opponent', party: opponentParty, activePartyIndex: 0, controlled: false },
      { ownerId: 'opponent', party: opponentParty, activePartyIndex: 1, controlled: false },
    ] })
    const protect = session.teams.player[0].party[0]!.moves[0]!
    protect.data = { ...protect.data, effect: 111, power: 0, priority: 4, range: 1 << 4, accuracy: 0 }
    const endure = session.teams.player[1].party[1]!.moves[0]!
    endure.data = { ...endure.data, effect: 116, power: 0, priority: 4, range: 1 << 4, accuracy: 0 }
    for (const participant of session.teams.opponent) {
      participant.party[participant.activePartyIndex]!.moves[0]!.data = {
        ...participant.party[participant.activePartyIndex]!.moves[0]!.data, effect: 0, power: 250, accuracy: 0,
      }
    }
    const protectedHp = session.teams.player[0].party[0]!.currentHp

    executeDoubleBattleTurn(session, [
      { actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'player', slot: 0 } },
      { actor: { side: 'player', slot: 1 }, moveIndex: 0, target: { side: 'player', slot: 1 } },
    ], catalog, createHgssLcrng(14))

    expect(session.teams.player[0].party[0]!.currentHp).toBe(protectedHp)
    expect(session.teams.player[1].party[1]!.currentHp).toBe(1)
  })

  it('conserve confusion et attraction sur leur combattant double ciblé', () => {
    const playerParty = [mon(152), mon(155)]
    const opponentParty = [mon(158), mon(152)]
    const session = createDoubleBattleSession({ kind: 'double', catalog, player: [
      { ownerId: 'player', party: playerParty, activePartyIndex: 0, controlled: true },
      { ownerId: 'player', party: playerParty, activePartyIndex: 1, controlled: true },
    ], opponent: [
      { ownerId: 'opponent', party: opponentParty, activePartyIndex: 0, controlled: false },
      { ownerId: 'opponent', party: opponentParty, activePartyIndex: 1, controlled: false },
    ] })
    session.teams.player[0].party[0]!.moves[0]!.data = { ...session.teams.player[0].party[0]!.moves[0]!.data, effect: 49, power: 0, range: 0, accuracy: 0 }
    session.teams.player[1].party[1]!.moves[0]!.data = { ...session.teams.player[1].party[1]!.moves[0]!.data, effect: 120, power: 0, range: 0, accuracy: 0 }
    session.teams.player[1].party[1]!.gender = 'male'
    session.teams.opponent[1].party[1]!.gender = 'female'
    for (const participant of session.teams.opponent) participant.party[participant.activePartyIndex]!.moves[0]!.data = {
      ...participant.party[participant.activePartyIndex]!.moves[0]!.data, effect: 85, power: 0, range: 1 << 4,
    }

    executeDoubleBattleTurn(session, [
      { actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } },
      { actor: { side: 'player', slot: 1 }, moveIndex: 0, target: { side: 'opponent', slot: 1 } },
    ], catalog, createHgssLcrng(15))

    expect(session.teams.opponent[0].volatile.confusionTurns).toBeGreaterThan(0)
    expect(session.teams.opponent[1].volatile.infatuated).toBe(true)
  })

  it('copie temporairement le talent avec Imitation sans corrompre le Pokémon sauvegardable', () => {
    const playerParty = [mon(152), mon(155)]
    const opponentParty = [mon(158), mon(152)]
    const session = createDoubleBattleSession({ kind: 'double', catalog, player: [
      { ownerId: 'player', party: playerParty, activePartyIndex: 0, controlled: true },
      { ownerId: 'player', party: playerParty, activePartyIndex: 1, controlled: true },
    ], opponent: [
      { ownerId: 'opponent', party: opponentParty, activePartyIndex: 0, controlled: false },
      { ownerId: 'opponent', party: opponentParty, activePartyIndex: 1, controlled: false },
    ] })
    const actor = session.teams.player[0]
    const originalAbility = actor.party[0]!.abilityId
    session.teams.opponent[0].party[0]!.abilityId = 10
    actor.party[0]!.moves[0]!.data = { ...actor.party[0]!.moves[0]!.data, effect: 178, power: 0, range: 0, accuracy: 0 }
    for (const participant of [session.teams.player[1], ...session.teams.opponent]) participant.party[participant.activePartyIndex]!.moves[0]!.data = {
      ...participant.party[participant.activePartyIndex]!.moves[0]!.data, effect: 85, power: 0, range: 1 << 4,
    }

    executeDoubleBattleTurn(session, [
      { actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } },
      { actor: { side: 'player', slot: 1 }, moveIndex: 0, target: { side: 'player', slot: 1 } },
    ], catalog, createHgssLcrng(16))

    expect(actor.volatile.abilityOverrideId).toBe(10)
    expect(actor.party[0]!.abilityId).toBe(originalAbility)
  })

  it('invoque Photocopie sans consommer les PP de la capacité copiée', () => {
    const playerParty = [mon(152), mon(155)]
    const opponentParty = [mon(158), mon(152)]
    const session = createDoubleBattleSession({ kind: 'double', catalog, player: [
      { ownerId: 'player', party: playerParty, activePartyIndex: 0, controlled: true },
      { ownerId: 'player', party: playerParty, activePartyIndex: 1, controlled: true },
    ], opponent: [
      { ownerId: 'opponent', party: opponentParty, activePartyIndex: 0, controlled: false },
      { ownerId: 'opponent', party: opponentParty, activePartyIndex: 1, controlled: false },
    ] })
    const mirror = session.teams.player[0].party[0]!
    mirror.stats.speed = 1
    mirror.moves[0]!.data = { ...mirror.moves[0]!.data, effect: 242, power: 0, priority: -1, range: 0, accuracy: 0 }
    session.teams.player[1].party[1]!.moves[0]!.data = { ...session.teams.player[1].party[1]!.moves[0]!.data, effect: 85, power: 0, range: 1 << 4 }
    const copied = session.teams.opponent[0].party[0]!.moves[0]!
    copied.data = { ...copied.data, effect: 0, power: 40, accuracy: 0 }
    const copiedPp = copied.pp
    session.teams.opponent[1].party[1]!.moves[0]!.data = { ...session.teams.opponent[1].party[1]!.moves[0]!.data, effect: 85, power: 0, range: 1 << 4 }

    const events = executeDoubleBattleTurn(session, [
      { actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } },
      { actor: { side: 'player', slot: 1 }, moveIndex: 0, target: { side: 'player', slot: 1 } },
    ], catalog, createHgssLcrng(17))

    expect(events.filter((event) => event.kind === 'move' && event.actor.side === 'player' && event.actor.slot === 0)).toHaveLength(2)
    expect(copied.pp).toBe(copiedPp - 1)
  })

  it('résout les effets offensifs communs une fois par combattant, même en multi-coup', () => {
    const playerParty = [mon(152), mon(155)]
    const opponentParty = [mon(158), mon(152)]
    const session = createDoubleBattleSession({ kind: 'double', catalog, player: [
      { ownerId: 'player', party: playerParty, activePartyIndex: 0, controlled: true },
      { ownerId: 'player', party: playerParty, activePartyIndex: 1, controlled: true },
    ], opponent: [
      { ownerId: 'opponent', party: opponentParty, activePartyIndex: 0, controlled: false },
      { ownerId: 'opponent', party: opponentParty, activePartyIndex: 1, controlled: false },
    ] })
    const multiHit = session.teams.player[0].party[0]!.moves[0]!
    multiHit.data = { ...multiHit.data, effect: 29, power: 5, priority: 2, range: 0, accuracy: 0 }
    const flinch = session.teams.player[1].party[1]!.moves[0]!
    flinch.data = { ...flinch.data, effect: 31, effectChance: 100, power: 5, priority: 2, range: 0, accuracy: 0 }
    const target = session.teams.opponent[0].party[0]!
    target.stats.hp = 200
    target.currentHp = 200
    session.teams.opponent[1].party[1]!.moves[0]!.data = { ...session.teams.opponent[1].party[1]!.moves[0]!.data, effect: 85, power: 0, range: 1 << 4 }

    const events = executeDoubleBattleTurn(session, [
      { actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 1 } },
      { actor: { side: 'player', slot: 1 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } },
    ], catalog, createHgssLcrng(18))

    expect(events.find((event) => event.kind === 'multiHit')).toMatchObject({ kind: 'multiHit' })
    expect(events).toContainEqual(expect.objectContaining({ kind: 'cannotAct', actor: { side: 'opponent', slot: 0 }, reason: 'flinch' }))
  })

  it('applique drain, statut de Triplattaque et contrecoups de stats depuis les données de capacité', () => {
    const session = createDoubleBattleSession({ kind: 'multi', catalog, player: [
      { ownerId: 'playerA', party: [mon(152)], activePartyIndex: 0, controlled: true },
      { ownerId: 'playerB', party: [mon(155)], activePartyIndex: 0, controlled: true },
    ], opponent: [
      { ownerId: 'opponentA', party: [mon(158)], activePartyIndex: 0, controlled: false },
      { ownerId: 'opponentB', party: [mon(152)], activePartyIndex: 0, controlled: false },
    ] })
    const drain = session.teams.player[0].party[0]!
    drain.currentHp = Math.max(1, drain.currentHp - 10)
    drain.moves[0]!.data = { ...drain.moves[0]!.data, effect: 3, power: 40, priority: 2, range: 0, accuracy: 0 }
    const overheat = session.teams.player[1].party[0]!
    overheat.moves[0]!.data = { ...overheat.moves[0]!.data, effect: 182, power: 40, priority: 2, range: 0, accuracy: 0 }
    for (const participant of session.teams.opponent) participant.party[0]!.moves[0]!.data = { ...participant.party[0]!.moves[0]!.data, effect: 85, power: 0, range: 1 << 4 }

    const events = executeDoubleBattleTurn(session, [
      { actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } },
      { actor: { side: 'player', slot: 1 }, moveIndex: 0, target: { side: 'opponent', slot: 1 } },
    ], catalog, createHgssLcrng(19))

    expect(events).toContainEqual(expect.objectContaining({ kind: 'heal', target: { side: 'player', slot: 0 } }))
    expect(session.teams.player[1].stages).toMatchObject({ attack: -1, defense: -1 })
  })

  it('fait toucher Fatal-Foudre sous la pluie et maintient le piège résiduel de Danseflamme', () => {
    const session = createDoubleBattleSession({ kind: 'multi', catalog, initialWeather: 'rain', player: [
      { ownerId: 'playerA', party: [mon(152)], activePartyIndex: 0, controlled: true },
      { ownerId: 'playerB', party: [mon(155)], activePartyIndex: 0, controlled: true },
    ], opponent: [
      { ownerId: 'opponentA', party: [mon(158)], activePartyIndex: 0, controlled: false },
      { ownerId: 'opponentB', party: [mon(152)], activePartyIndex: 0, controlled: false },
    ] })
    session.teams.player[0].party[0]!.moves[0]!.data = { ...session.teams.player[0].party[0]!.moves[0]!.data, effect: 152, power: 20, accuracy: 1, priority: 2, range: 0 }
    session.teams.player[1].party[0]!.moves[0]!.data = { ...session.teams.player[1].party[0]!.moves[0]!.data, effect: 42, power: 5, accuracy: 0, priority: 2, range: 0 }
    for (const participant of session.teams.opponent) {
      participant.party[0]!.stats.hp = 200
      participant.party[0]!.currentHp = 200
      participant.party[0]!.moves[0]!.data = { ...participant.party[0]!.moves[0]!.data, effect: 85, power: 0, range: 1 << 4 }
    }

    const events = executeDoubleBattleTurn(session, [
      { actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } },
      { actor: { side: 'player', slot: 1 }, moveIndex: 0, target: { side: 'opponent', slot: 1 } },
    ], catalog, createHgssLcrng(20))

    expect(events).not.toContainEqual(expect.objectContaining({ kind: 'miss', actor: { side: 'player', slot: 0 } }))
    expect(events).toContainEqual(expect.objectContaining({ kind: 'residual', target: { side: 'opponent', slot: 1 }, status: 'trap' }))
    expect(session.teams.opponent[1].volatile.trappedTurns).toBeGreaterThan(0)
  })

  it('autorise Dernierecour seulement après les autres capacités réellement utilisées', () => {
    const session = createDoubleBattleSession({ kind: 'multi', catalog, player: [
      { ownerId: 'playerA', party: [mon(152)], activePartyIndex: 0, controlled: true },
      { ownerId: 'playerB', party: [mon(155)], activePartyIndex: 0, controlled: true },
    ], opponent: [
      { ownerId: 'opponentA', party: [mon(158)], activePartyIndex: 0, controlled: false },
      { ownerId: 'opponentB', party: [mon(152)], activePartyIndex: 0, controlled: false },
    ] })
    const actor = session.teams.player[0].party[0]!
    actor.moves[0]!.data = { ...actor.moves[0]!.data, power: 5, priority: 2, accuracy: 0 }
    actor.moves.push({ ...actor.moves[0]!, moveId: 387, data: { ...actor.moves[0]!.data, moveId: 387, effect: 246, power: 20 } })
    session.teams.player[1].party[0]!.moves[0]!.data = { ...session.teams.player[1].party[0]!.moves[0]!.data, effect: 85, power: 0, range: 1 << 4 }
    for (const participant of session.teams.opponent) {
      participant.party[0]!.stats.hp = 500
      participant.party[0]!.currentHp = 500
      participant.party[0]!.moves[0]!.data = { ...participant.party[0]!.moves[0]!.data, effect: 85, power: 0, range: 1 << 4 }
    }
    const actions = (moveIndex: number) => [
      { actor: { side: 'player' as const, slot: 0 as const }, moveIndex, target: { side: 'opponent' as const, slot: 0 as const } },
      { actor: { side: 'player' as const, slot: 1 as const }, moveIndex: 0, target: { side: 'player' as const, slot: 1 as const } },
    ]

    const failed = executeDoubleBattleTurn(session, actions(1), catalog, createHgssLcrng(21))
    expect(failed).toContainEqual(expect.objectContaining({ kind: 'noEffect', actor: { side: 'player', slot: 0 } }))
    executeDoubleBattleTurn(session, actions(0), catalog, createHgssLcrng(22))
    const hpBefore = session.teams.opponent[0].party[0]!.currentHp
    const succeeded = executeDoubleBattleTurn(session, actions(1), catalog, createHgssLcrng(23))
    expect(succeeded).not.toContainEqual(expect.objectContaining({ kind: 'noEffect', actor: { side: 'player', slot: 0 } }))
    expect(session.teams.opponent[0].party[0]!.currentHp).toBeLessThan(hpBefore)
  })

  it('enchaîne automatiquement les tours de charge et l’état semi-invulnérable', () => {
    const session = createDoubleBattleSession({ kind: 'multi', catalog, player: [
      { ownerId: 'playerA', party: [mon(152)], activePartyIndex: 0, controlled: true },
      { ownerId: 'playerB', party: [mon(155)], activePartyIndex: 0, controlled: true },
    ], opponent: [
      { ownerId: 'opponentA', party: [mon(158)], activePartyIndex: 0, controlled: false },
      { ownerId: 'opponentB', party: [mon(152)], activePartyIndex: 0, controlled: false },
    ] })
    session.teams.player[0].party[0]!.moves[0]!.data = { ...session.teams.player[0].party[0]!.moves[0]!.data, effect: 151, power: 20, priority: 2, accuracy: 0 }
    session.teams.player[1].party[0]!.moves[0]!.data = { ...session.teams.player[1].party[0]!.moves[0]!.data, effect: 256, power: 20, priority: 2, accuracy: 0 }
    for (const participant of session.teams.opponent) {
      participant.party[0]!.stats.hp = 500
      participant.party[0]!.currentHp = 500
      participant.party[0]!.moves[0]!.data = { ...participant.party[0]!.moves[0]!.data, effect: 85, power: 0, range: 1 << 4 }
    }

    executeDoubleBattleTurn(session, [
      { actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } },
      { actor: { side: 'player', slot: 1 }, moveIndex: 0, target: { side: 'opponent', slot: 1 } },
    ], catalog, createHgssLcrng(24))
    expect(getRequiredDoubleBattleActors(session)).toEqual([])
    expect(session.teams.player[1].volatile.semiInvulnerable).toBe('dig')
    const hpBefore = session.teams.opponent.map((participant) => participant.party[0]!.currentHp)

    executeDoubleBattleTurn(session, [], catalog, createHgssLcrng(25))

    expect(session.teams.player.every((participant) => participant.volatile.chargingMove === undefined)).toBe(true)
    expect(session.teams.opponent.map((participant) => participant.party[0]!.currentHp)).not.toEqual(hpBefore)
  })

  it('verrouille les cinq tours de Roulade avec un seul PP et sa puissance cumulative', () => {
    const session = createDoubleBattleSession({ kind: 'multi', catalog, player: [
      { ownerId: 'playerA', party: [mon(152)], activePartyIndex: 0, controlled: true },
      { ownerId: 'playerB', party: [mon(155)], activePartyIndex: 0, controlled: false },
    ], opponent: [
      { ownerId: 'opponentA', party: [mon(158)], activePartyIndex: 0, controlled: false },
      { ownerId: 'opponentB', party: [mon(152)], activePartyIndex: 0, controlled: false },
    ] })
    const rollout = session.teams.player[0].party[0]!.moves[0]!
    rollout.data = { ...rollout.data, effect: 117, power: 5, priority: 2, accuracy: 0 }
    const ppBefore = rollout.pp
    session.teams.player[1].party[0]!.moves[0]!.data = { ...session.teams.player[1].party[0]!.moves[0]!.data, effect: 85, power: 0, range: 1 << 4 }
    for (const participant of session.teams.opponent) {
      participant.party[0]!.stats.hp = 5000
      participant.party[0]!.currentHp = 5000
      participant.party[0]!.moves[0]!.data = { ...participant.party[0]!.moves[0]!.data, effect: 85, power: 0, range: 1 << 4 }
    }
    const moveCounts: number[] = []
    let events = executeDoubleBattleTurn(session, [{ actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } }], catalog, createHgssLcrng(26))
    moveCounts.push(events.filter((event) => event.kind === 'move' && event.actor.side === 'player' && event.actor.slot === 0).length)
    for (let turn = 0; turn < 4; turn += 1) {
      events = executeDoubleBattleTurn(session, [], catalog, createHgssLcrng(27 + turn))
      moveCounts.push(events.filter((event) => event.kind === 'move' && event.actor.side === 'player' && event.actor.slot === 0).length)
    }

    expect(moveCounts).toEqual([1, 1, 1, 1, 1])
    expect(rollout.pp).toBe(ppBefore - 1)
    expect(session.teams.player[0].volatile).toMatchObject({ rolloutCount: 0, chargingMove: undefined })
  })

  it('calcule Prescience à la sélection puis frappe le slot deux tours plus tard', () => {
    const session = createDoubleBattleSession({ kind: 'multi', catalog, player: [
      { ownerId: 'playerA', party: [mon(152)], activePartyIndex: 0, controlled: true },
      { ownerId: 'playerB', party: [mon(155)], activePartyIndex: 0, controlled: true },
    ], opponent: [
      { ownerId: 'opponentA', party: [mon(158)], activePartyIndex: 0, controlled: false },
      { ownerId: 'opponentB', party: [mon(152)], activePartyIndex: 0, controlled: false },
    ] })
    const futureSight = session.teams.player[0].party[0]!.moves[0]!
    futureSight.data = { ...futureSight.data, effect: 148, category: 1, power: 80, accuracy: 0, priority: 2 }
    for (const participant of [session.teams.player[1], ...session.teams.opponent]) participant.party[0]!.moves[0]!.data = { ...participant.party[0]!.moves[0]!.data, effect: 85, power: 0, range: 1 << 4 }
    const target = session.teams.opponent[0].party[0]!
    target.stats.hp = 500
    target.currentHp = 500
    const actions = [
      { actor: { side: 'player' as const, slot: 0 as const }, moveIndex: 0, target: { side: 'opponent' as const, slot: 0 as const } },
      { actor: { side: 'player' as const, slot: 1 as const }, moveIndex: 0, target: { side: 'player' as const, slot: 1 as const } },
    ]

    executeDoubleBattleTurn(session, actions, catalog, createHgssLcrng(31))
    expect(target.currentHp).toBe(500)
    futureSight.data = { ...futureSight.data, effect: 85, power: 0, range: 1 << 4 }
    executeDoubleBattleTurn(session, actions, catalog, createHgssLcrng(32))
    expect(target.currentHp).toBe(500)
    const events = executeDoubleBattleTurn(session, actions, catalog, createHgssLcrng(33))

    expect(target.currentHp).toBeLessThan(500)
    expect(events).toContainEqual(expect.objectContaining({ kind: 'residual', target: { side: 'opponent', slot: 0 }, status: 'futureSight' }))
    expect(session.futureAttacks).toEqual([])
  })

  it('invoque la capacité Force-Nature extraite pour le terrain de la carte ROM', () => {
    const natureCatalog = { ...catalog, moves: [...catalog.moves], naturePowerMoveIds: Array.from({ length: 13 }, () => 33) }
    natureCatalog.moves[33] = { ...natureCatalog.moves[33]!, power: 40, accuracy: 0 }
    const session = createDoubleBattleSession({ kind: 'multi', catalog: natureCatalog, initialTerrainId: 7, player: [
      { ownerId: 'playerA', party: [mon(152)], activePartyIndex: 0, controlled: true },
      { ownerId: 'playerB', party: [mon(155)], activePartyIndex: 0, controlled: true },
    ], opponent: [
      { ownerId: 'opponentA', party: [mon(158)], activePartyIndex: 0, controlled: false },
      { ownerId: 'opponentB', party: [mon(152)], activePartyIndex: 0, controlled: false },
    ] })
    const naturePower = session.teams.player[0].party[0]!.moves[0]!
    naturePower.data = { ...naturePower.data, effect: 173, power: 0, priority: 2, accuracy: 0 }
    session.teams.player[1].party[0]!.moves[0]!.data = { ...session.teams.player[1].party[0]!.moves[0]!.data, effect: 85, power: 0, range: 1 << 4 }
    for (const participant of session.teams.opponent) participant.party[0]!.moves[0]!.data = { ...participant.party[0]!.moves[0]!.data, effect: 85, power: 0, range: 1 << 4 }
    const ppBefore = naturePower.pp

    const events = executeDoubleBattleTurn(session, [
      { actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } },
      { actor: { side: 'player', slot: 1 }, moveIndex: 0, target: { side: 'player', slot: 1 } },
    ], natureCatalog, createHgssLcrng(34))

    expect(events.filter((event) => event.kind === 'move' && event.actor.side === 'player' && event.actor.slot === 0)).toHaveLength(2)
    expect(events).toContainEqual(expect.objectContaining({ kind: 'damage', target: { side: 'opponent', slot: 0 } }))
    expect(naturePower.pp).toBe(ppBefore - 1)
  })

  it('résout globalement dégâts fixes, doubles frappes et type dynamique depuis les données ROM', () => {
    const session = isolatedDoubleSession()
    const actor = session.teams.player[0].party[0]!
    const target = session.teams.opponent[0].party[0]!
    target.stats.hp = 400
    target.currentHp = 400
    actor.heldItemId = 275
    actor.moves[0]!.data = { ...actor.moves[0]!.data, effect: 268, type: 0, power: 20, accuracy: 0, priority: 2 }
    let events = executeDoubleBattleTurn(session, [{ actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } }], catalog, createHgssLcrng(40))
    expect(events).toContainEqual(expect.objectContaining({ kind: 'move', actor: { side: 'player', slot: 0 }, moveType: 10 }))

    actor.moves[0]!.data = { ...actor.moves[0]!.data, effect: 40, type: 0, power: 1 }
    const beforeFixed = target.currentHp
    events = executeDoubleBattleTurn(session, [{ actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } }], catalog, createHgssLcrng(41))
    expect(events).toContainEqual(expect.objectContaining({ kind: 'damage', target: { side: 'opponent', slot: 0 }, damage: Math.floor(beforeFixed / 2) }))

    target.currentHp = 400
    actor.moves[0]!.data = { ...actor.moves[0]!.data, effect: 44, power: 5 }
    events = executeDoubleBattleTurn(session, [{ actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } }], catalog, createHgssLcrng(42))
    expect(events).toContainEqual({ kind: 'multiHit', hits: 2 })
  })

  it('partage les états temporels pour Lilliput, Écrasement et Furie', () => {
    const session = isolatedDoubleSession()
    const actor = session.teams.player[0].party[0]!
    const target = session.teams.opponent[0]
    target.party[0]!.stats.hp = 1000
    target.party[0]!.currentHp = 1000
    target.volatile.minimized = true
    actor.moves[0]!.data = { ...actor.moves[0]!.data, effect: 150, power: 20, accuracy: 0, priority: 2 }
    const before = target.party[0]!.currentHp
    executeDoubleBattleTurn(session, [{ actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } }], catalog, createHgssLcrng(43))
    const stompDamage = before - target.party[0]!.currentHp

    target.party[0]!.currentHp = 1000
    target.volatile.minimized = false
    executeDoubleBattleTurn(session, [{ actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } }], catalog, createHgssLcrng(43))
    expect(stompDamage).toBeGreaterThan(1000 - target.party[0]!.currentHp)

    actor.moves[0]!.data = { ...actor.moves[0]!.data, effect: 119, power: 10 }
    executeDoubleBattleTurn(session, [{ actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } }], catalog, createHgssLcrng(44))
    expect(session.teams.player[0].volatile.furyCutterCount).toBe(1)
  })

  it('charge Revenant hors de portée puis traverse Abri au tour de frappe', () => {
    const session = isolatedDoubleSession()
    const actor = session.teams.player[0].party[0]!
    const target = session.teams.opponent[0]
    actor.moves[0]!.data = { ...actor.moves[0]!.data, effect: 272, power: 40, accuracy: 0, priority: 0 }
    target.party[0]!.moves[0]!.data = { ...target.party[0]!.moves[0]!.data, effect: 111, power: 0, range: 1 << 4, priority: 4 }
    const hpBefore = target.party[0]!.currentHp
    executeDoubleBattleTurn(session, [{ actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } }], catalog, createHgssLcrng(45))
    expect(session.teams.player[0].volatile.semiInvulnerable).toBe('shadow')
    expect(target.party[0]!.currentHp).toBe(hpBefore)
    const events = executeDoubleBattleTurn(session, [], catalog, createHgssLcrng(46))
    expect(events).toContainEqual(expect.objectContaining({ kind: 'damage', target: { side: 'opponent', slot: 0 } }))
    expect(target.party[0]!.currentHp).toBeLessThan(hpBefore)
  })

  it('applique les soins natifs de Dévorêve et Repos au bon combattant', () => {
    const session = isolatedDoubleSession()
    const actor = session.teams.player[0].party[0]!
    const target = session.teams.opponent[0].party[0]!
    actor.stats.hp = 200
    actor.currentHp = 100
    target.stats.hp = 300
    target.currentHp = 300
    target.status = 2
    actor.moves[0]!.data = { ...actor.moves[0]!.data, effect: 8, power: 40, accuracy: 0, priority: 2 }
    const dreamEvents = executeDoubleBattleTurn(session, [{ actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } }], catalog, createHgssLcrng(47))
    expect(dreamEvents).toContainEqual(expect.objectContaining({ kind: 'heal', target: { side: 'player', slot: 0 } }))

    actor.currentHp = 80
    actor.status = 0x8
    actor.moves[0]!.data = { ...actor.moves[0]!.data, effect: 37, power: 0, range: 1 << 4 }
    executeDoubleBattleTurn(session, [{ actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'player', slot: 0 } }], catalog, createHgssLcrng(48))
    expect(actor.currentHp).toBe(actor.stats.hp)
    expect(actor.status & 0x7).toBeGreaterThan(0)
  })

  it('applique les combinaisons de statistiques par une règle bornée commune', () => {
    const session = isolatedDoubleSession()
    const actor = session.teams.player[0].party[0]!
    actor.moves[0]!.data = { ...actor.moves[0]!.data, effect: 208, power: 0, range: 1 << 4, priority: 2 }
    executeDoubleBattleTurn(session, [{ actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'player', slot: 0 } }], catalog, createHgssLcrng(49))
    expect(session.teams.player[0].stages).toMatchObject({ attack: 1, defense: 1 })

    actor.moves[0]!.data = { ...actor.moves[0]!.data, effect: 229, power: 20, range: 0 }
    executeDoubleBattleTurn(session, [{ actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } }], catalog, createHgssLcrng(50))
    expect(session.teams.player[0].stages).toMatchObject({ defense: 0, specialDefense: -1 })
  })

  it('redirige une frappe simple avec Par Ici et amplifie réellement Coup d’Main', () => {
    const redirected = isolatedDoubleSession()
    redirected.teams.opponent[0].controlled = true
    redirected.teams.player[0].party[0]!.moves[0]!.data = { ...redirected.teams.player[0].party[0]!.moves[0]!.data, effect: 172, power: 0, range: 1 << 4, priority: 4 }
    redirected.teams.opponent[0].party[0]!.moves[0]!.data = { ...redirected.teams.opponent[0].party[0]!.moves[0]!.data, effect: 0, power: 30, range: 0, accuracy: 0 }
    const protectedAllyHp = redirected.teams.player[1].party[0]!.currentHp
    const redirectorHp = redirected.teams.player[0].party[0]!.currentHp
    executeDoubleBattleTurn(redirected, [
      { actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'player', slot: 0 } },
      { actor: { side: 'opponent', slot: 0 }, moveIndex: 0, target: { side: 'player', slot: 1 } },
    ], catalog, createHgssLcrng(51))
    expect(redirected.teams.player[1].party[0]!.currentHp).toBe(protectedAllyHp)
    expect(redirected.teams.player[0].party[0]!.currentHp).toBeLessThan(redirectorHp)

    const runHelpingHand = (enabled: boolean) => {
      const session = isolatedDoubleSession()
      const helper = session.teams.player[0].party[0]!
      const ally = session.teams.player[1].party[0]!
      helper.moves[0]!.data = { ...helper.moves[0]!.data, effect: enabled ? 176 : 85, power: 0, range: enabled ? 1 << 8 : 1 << 4, priority: 5 }
      ally.moves[0]!.data = { ...ally.moves[0]!.data, effect: 0, power: 30, range: 0, accuracy: 0 }
      const target = session.teams.opponent[0].party[0]!
      target.stats.hp = 500
      target.currentHp = 500
      executeDoubleBattleTurn(session, [{ actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'player', slot: 1 } }], catalog, createHgssLcrng(52))
      return target.currentHp
    }
    expect(runHelpingHand(true)).toBeLessThan(runHelpingHand(false))
  })

  it('conserve Jackpot et applique globalement contrecoup puis recharge', () => {
    const session = isolatedDoubleSession()
    const actor = session.teams.player[0].party[0]!
    const target = session.teams.opponent[0].party[0]!
    target.stats.hp = 1000
    target.currentHp = 1000
    actor.moves[0]!.data = { ...actor.moves[0]!.data, effect: 34, power: 20, accuracy: 0, priority: 2 }
    executeDoubleBattleTurn(session, [{ actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } }], catalog, createHgssLcrng(53))
    expect(session.payDayCoins).toBe(actor.level * 5)

    actor.currentHp = actor.stats.hp
    actor.moves[0]!.data = { ...actor.moves[0]!.data, effect: 198, power: 30 }
    const recoilEvents = executeDoubleBattleTurn(session, [{ actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } }], catalog, createHgssLcrng(54))
    expect(recoilEvents).toContainEqual(expect.objectContaining({ kind: 'recoil', target: { side: 'player', slot: 0 } }))

    actor.moves[0]!.data = { ...actor.moves[0]!.data, effect: 80, power: 20 }
    executeDoubleBattleTurn(session, [{ actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } }], catalog, createHgssLcrng(55))
    const rechargeEvents = executeDoubleBattleTurn(session, [{ actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } }], catalog, createHgssLcrng(56))
    expect(rechargeEvents).toContainEqual(expect.objectContaining({ kind: 'cannotAct', actor: { side: 'player', slot: 0 }, reason: 'recharge' }))
  })

  it('raccorde Gravité, Vol Magnétik et Anneau Hydro au calcul et aux résiduels', () => {
    const session = isolatedDoubleSession()
    const actor = session.teams.player[0].party[0]!
    const target = session.teams.opponent[0]
    target.party[0]!.stats.hp = 500
    target.party[0]!.currentHp = 500
    target.volatile.magnetRiseTurns = 3
    actor.moves[0]!.data = { ...actor.moves[0]!.data, effect: 0, type: 4, power: 30, accuracy: 0, priority: 2 }
    let events = executeDoubleBattleTurn(session, [{ actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } }], catalog, createHgssLcrng(57))
    expect(events).toContainEqual(expect.objectContaining({ kind: 'damage', target: { side: 'opponent', slot: 0 }, damage: 0 }))

    session.gravityTurns = 2
    events = executeDoubleBattleTurn(session, [{ actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } }], catalog, createHgssLcrng(57))
    expect(events.find((event) => event.kind === 'damage' && event.target.side === 'opponent' && event.target.slot === 0)).toMatchObject({ kind: 'damage', damage: expect.any(Number) })
    expect(target.party[0]!.currentHp).toBeLessThan(500)

    actor.currentHp = Math.max(1, actor.stats.hp - 20)
    session.teams.player[0].volatile.aquaRing = true
    const beforeHeal = actor.currentHp
    executeDoubleBattleTurn(session, [{ actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } }], catalog, createHgssLcrng(58))
    expect(actor.currentHp).toBeGreaterThan(beforeHeal)
  })

  it('consomme et recycle Don Naturel depuis le catalogue d’objets ROM', () => {
    const session = isolatedDoubleSession()
    const berry = { itemId: 149, fieldPocket: 4, naturalGiftPower: 80, naturalGiftType: 10, holdEffect: 0 } as HgssItemData
    const items: HgssItemData[] = []
    items[149] = berry
    session.itemCatalog = { items, pocketNames: [] }
    const actor = session.teams.player[0].party[0]!
    actor.heldItemId = 149
    actor.moves[0]!.data = { ...actor.moves[0]!.data, effect: 222, power: 1, type: 0, accuracy: 0, priority: 2 }
    const giftEvents = executeDoubleBattleTurn(session, [{ actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } }], catalog, createHgssLcrng(59))
    expect(giftEvents).toContainEqual(expect.objectContaining({ kind: 'move', moveType: 10 }))
    expect(actor.heldItemId).toBe(0)
    expect(session.teams.player[0].volatile.recyclableItemId).toBe(149)

    actor.moves[0]!.data = { ...actor.moves[0]!.data, effect: 184, power: 0, range: 1 << 4 }
    executeDoubleBattleTurn(session, [{ actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'player', slot: 0 } }], catalog, createHgssLcrng(60))
    expect(actor.heldItemId).toBe(149)
    expect(session.teams.player[0].volatile.recyclableItemId).toBe(0)
  })

  it('partage Entrave, Encore, Tourmente et Possessif avec la sélection et le tour en cours', () => {
    const session = isolatedDoubleSession()
    const actorState = session.teams.player[0]
    const actor = actorState.party[0]!
    actor.moves.push({ ...actor.moves[0]!, moveId: 45, data: { ...actor.moves[0]!.data, moveId: 45 } })
    actorState.volatile.disabledMoveId = actor.moves[0]!.moveId
    actorState.volatile.disableTurns = 2
    expect(getSelectableDoubleBattleMoveIndexes(session, { side: 'player', slot: 0 })).toEqual([1])
    actorState.volatile.disabledMoveId = 0
    actorState.volatile.disableTurns = 0
    actorState.volatile.encoreMoveIndex = 1
    actorState.volatile.encoreTurns = 2
    expect(getSelectableDoubleBattleMoveIndexes(session, { side: 'player', slot: 0 })).toEqual([1])

    actorState.volatile.encoreTurns = 0
    actorState.volatile.lastMoveId = actor.moves[0]!.moveId
    session.teams.opponent[0].controlled = true
    session.teams.opponent[0].party[0]!.moves[0]!.data = { ...session.teams.opponent[0].party[0]!.moves[0]!.data, effect: 86, power: 0, range: 0, priority: 5, accuracy: 0 }
    const events = executeDoubleBattleTurn(session, [
      { actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } },
      { actor: { side: 'opponent', slot: 0 }, moveIndex: 0, target: { side: 'player', slot: 0 } },
    ], catalog, createHgssLcrng(61))
    expect(events).toContainEqual(expect.objectContaining({ kind: 'condition', target: { side: 'player', slot: 0 }, condition: 'disable', applied: true }))
    expect(events).toContainEqual(expect.objectContaining({ kind: 'noEffect', actor: { side: 'player', slot: 0 } }))
  })

  it('applique les pièges d’équipe à chaque remplacement sans bloquer la relève suivante', () => {
    const opponentParty = [mon(158), mon(152), mon(155)]
    const session = createDoubleBattleSession({ kind: 'double', catalog, player: [
      { ownerId: 'playerA', party: [mon(152)], activePartyIndex: 0, controlled: true },
      { ownerId: 'playerB', party: [mon(155)], activePartyIndex: 0, controlled: false },
    ], opponent: [
      { ownerId: 'opponent', party: opponentParty, activePartyIndex: 0, controlled: false },
      { ownerId: 'opponent', party: opponentParty, activePartyIndex: 1, controlled: false },
    ] })
    session.sideConditions.opponent.spikesLayers = 1
    session.sideConditions.opponent.stealthRock = true
    session.teams.opponent[0].party[0]!.currentHp = 1
    session.teams.player[0].party[0]!.moves[0]!.data = { ...session.teams.player[0].party[0]!.moves[0]!.data, power: 100, accuracy: 0, priority: 5 }
    for (const participant of [session.teams.player[1], ...session.teams.opponent]) participant.party[participant.activePartyIndex]!.moves[0]!.data = { ...participant.party[participant.activePartyIndex]!.moves[0]!.data, effect: 85, power: 0, range: 1 << 4 }
    const events = executeDoubleBattleTurn(session, [{ actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } }], catalog, createHgssLcrng(62))
    expect(session.teams.opponent[0].activePartyIndex).toBe(2)
    expect(session.teams.opponent[0].party[2]!.currentHp).toBeLessThan(session.teams.opponent[0].party[2]!.stats.hp)
    expect(events).toContainEqual(expect.objectContaining({ kind: 'sendOut', target: { side: 'opponent', slot: 0 }, partyIndex: 2 }))
  })

  it('intercepte un changement manuel avec Poursuite avant l’envoi de la réserve', () => {
    const switchingParty = [mon(152), mon(155)]
    switchingParty[0]!.stats.hp = switchingParty[0]!.currentHp = 300
    const session = createDoubleBattleSession({ kind: 'multi', catalog, player: [
      { ownerId: 'playerA', party: switchingParty, activePartyIndex: 0, controlled: true },
      { ownerId: 'playerB', party: [mon(158)], activePartyIndex: 0, controlled: false },
    ], opponent: [
      { ownerId: 'opponentA', party: [mon(155)], activePartyIndex: 0, controlled: true },
      { ownerId: 'opponentB', party: [mon(152)], activePartyIndex: 0, controlled: false },
    ] })
    for (const participant of [session.teams.player[1], session.teams.opponent[1]]) participant.party[0]!.moves[0]!.data = { ...participant.party[0]!.moves[0]!.data, effect: 85, power: 0, range: 1 << 4 }
    session.teams.opponent[0].party[0]!.moves[0]!.data = { ...session.teams.opponent[0].party[0]!.moves[0]!.data, effect: 128, power: 40, accuracy: 0 }

    const events = executeDoubleBattleTurn(session, [
      { kind: 'switch', actor: { side: 'player', slot: 0 }, partyIndex: 1 },
      { actor: { side: 'opponent', slot: 0 }, moveIndex: 0, target: { side: 'player', slot: 0 } },
    ], catalog, createHgssLcrng(63))

    expect(events.findIndex((event) => event.kind === 'damage')).toBeLessThan(events.findIndex((event) => event.kind === 'sendOut'))
    expect(session.teams.player[0].party[0]!.currentHp).toBeLessThan(300)
    expect(session.teams.player[0].activePartyIndex).toBe(1)
  })

  it('fige l’état d’envoi avant les dégâts suivants pour animer les PV dans l’ordre', () => {
    const session = createDoubleBattleSession({ kind: 'multi', catalog, player: [
      { ownerId: 'playerA', party: [mon(152), mon(155)], activePartyIndex: 0, controlled: true },
      { ownerId: 'playerB', party: [mon(158)], activePartyIndex: 0, controlled: false },
    ], opponent: [
      { ownerId: 'opponentA', party: [mon(155)], activePartyIndex: 0, controlled: true },
      { ownerId: 'opponentB', party: [mon(152)], activePartyIndex: 0, controlled: false },
    ] })
    for (const participant of [session.teams.player[1], session.teams.opponent[1]]) participant.party[0]!.moves[0]!.data = { ...participant.party[0]!.moves[0]!.data, effect: 85, power: 0, range: 1 << 4 }
    session.teams.opponent[0].party[0]!.moves[0]!.data = { ...session.teams.opponent[0].party[0]!.moves[0]!.data, effect: 0, power: 40, accuracy: 0 }
    const reserveHp = session.teams.player[0].party[1]!.currentHp

    const events = executeDoubleBattleTurn(session, [
      { kind: 'switch', actor: { side: 'player', slot: 0 }, partyIndex: 1 },
      { actor: { side: 'opponent', slot: 0 }, moveIndex: 0, target: { side: 'player', slot: 0 } },
    ], catalog, createHgssLcrng(72))
    const sendOut = events.find((event) => event.kind === 'sendOut')
    expect(sendOut).toMatchObject({ kind: 'sendOut', pokemon: { currentHp: reserveHp } })
    expect(session.teams.player[0].party[1]!.currentHp).toBeLessThan(reserveHp)
  })

  it('restaure Morphing avant la synchronisation de la sauvegarde', () => {
    const session = isolatedDoubleSession()
    const actor = session.teams.player[0]
    const originalStats = { ...actor.party[0]!.stats }
    const originalMoveId = actor.party[0]!.moves[0]!.moveId
    actor.party[0]!.moves[0]!.data = { ...actor.party[0]!.moves[0]!.data, effect: 57, power: 0, accuracy: 0, priority: 2 }

    executeDoubleBattleTurn(session, [{ actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } }], catalog, createHgssLcrng(64))
    expect(actor.volatile.transformOriginal).toBeDefined()
    const persisted = syncDoubleBattleParties(session).get('playerA')![0]!
    expect(persisted.stats).toEqual(originalStats)
    expect(persisted.moves[0]!.moveId).toBe(originalMoveId)
    expect(actor.party[0]!.stats).toEqual(originalStats)
  })

  it('restaure tous les actifs d’un même propriétaire avant de cloner son équipe', () => {
    const playerParty = [mon(152), mon(155)]
    const session = createDoubleBattleSession({ kind: 'double', catalog, player: [
      { ownerId: 'player', party: playerParty, activePartyIndex: 0, controlled: true },
      { ownerId: 'player', party: playerParty, activePartyIndex: 1, controlled: true },
    ], opponent: [
      { ownerId: 'opponentA', party: [mon(158)], activePartyIndex: 0, controlled: false },
      { ownerId: 'opponentB', party: [mon(152)], activePartyIndex: 0, controlled: false },
    ] })
    const second = session.teams.player[1]
    const pokemon = second.party[second.activePartyIndex]!
    const originalStats = { ...pokemon.stats }
    const originalMoves = pokemon.moves.map((move) => ({ ...move, data: { ...move.data } }))
    const originalForm = pokemon.form
    const originalTypes = second.types
    second.volatile.transformOriginal = { types: originalTypes, stats: originalStats, moves: originalMoves }
    second.volatile.battleFormOriginal = { form: originalForm, types: originalTypes }
    pokemon.stats = { ...pokemon.stats, attack: pokemon.stats.attack + 100 }
    pokemon.moves[0] = { ...pokemon.moves[0]!, moveId: 45, data: { ...pokemon.moves[0]!.data, moveId: 45 } }
    pokemon.form = originalForm + 1

    const persisted = syncDoubleBattleParties(session).get('player')![1]!

    expect(persisted.stats).toEqual(originalStats)
    expect(persisted.moves).toEqual(originalMoves)
    expect(persisted.form).toBe(originalForm)
  })

  it('restaure aussi Mimique sur le second actif d’une équipe partagée', () => {
    const playerParty = [mon(152), mon(155)]
    const session = createDoubleBattleSession({ kind: 'double', catalog, player: [
      { ownerId: 'player', party: playerParty, activePartyIndex: 0, controlled: true },
      { ownerId: 'player', party: playerParty, activePartyIndex: 1, controlled: true },
    ], opponent: [
      { ownerId: 'opponentA', party: [mon(158)], activePartyIndex: 0, controlled: false },
      { ownerId: 'opponentB', party: [mon(152)], activePartyIndex: 0, controlled: false },
    ] })
    const second = session.teams.player[1]
    const pokemon = second.party[second.activePartyIndex]!
    const originalMove = { ...pokemon.moves[0]!, data: { ...pokemon.moves[0]!.data } }
    second.volatile.mimicOriginalMoves.set(0, originalMove)
    pokemon.moves[0] = { ...pokemon.moves[0]!, moveId: 45, data: { ...pokemon.moves[0]!.data, moveId: 45 } }

    const persisted = syncDoubleBattleParties(session).get('player')![1]!

    expect(persisted.moves[0]).toEqual(originalMove)
  })

  it('émet un unique K.O. résiduel avant la relève et interdit toute résurrection de fin de tour', () => {
    for (const condition of ['nightmare', 'leechSeed', 'curse'] as const) {
      const opponentParty = [mon(158), mon(155)]
      const session = createDoubleBattleSession({ kind: 'multi', catalog, player: [
        { ownerId: 'playerA', party: [mon(152)], activePartyIndex: 0, controlled: true },
        { ownerId: 'playerB', party: [mon(155)], activePartyIndex: 0, controlled: false },
      ], opponent: [
        { ownerId: 'opponentA', party: opponentParty, activePartyIndex: 0, controlled: false },
        { ownerId: 'opponentB', party: [mon(152)], activePartyIndex: 0, controlled: false },
      ] })
      const participant = session.teams.opponent[0]
      const defeated = participant.party[0]!
      defeated.currentHp = 1
      defeated.abilityId = 44
      session.weather = { kind: 'rain', turns: 0 }
      if (condition === 'nightmare') {
        defeated.status = 1
        participant.volatile.nightmare = true
      } else if (condition === 'leechSeed') {
        participant.volatile.seededBy = { side: 'player', slot: 0 }
      } else participant.volatile.cursed = true
      const events: Parameters<typeof applyDoubleBattleResidual>[1] = []
      const rng = createHgssLcrng(0x70)

      applyDoubleBattleResidual(session, events, rng)
      replaceFaintedDoubleBattleParticipants(session, catalog, rng, events)

      const target = { side: 'opponent', slot: 0 } as const
      const faintEvents = events.filter((event) => event.kind === 'faint' && event.target.side === target.side && event.target.slot === target.slot)
      const faintIndex = events.findIndex((event) => event.kind === 'faint' && event.target.side === target.side && event.target.slot === target.slot)
      const sendOutIndex = events.findIndex((event) => event.kind === 'sendOut' && event.target.side === target.side && event.target.slot === target.slot)
      expect(faintEvents, condition).toHaveLength(1)
      expect(faintEvents[0], condition).toMatchObject({ defeated: { currentHp: 0, personality: defeated.personality } })
      expect(faintIndex, condition).toBeGreaterThanOrEqual(0)
      expect(sendOutIndex, condition).toBeGreaterThan(faintIndex)
      expect(events.slice(faintIndex + 1, sendOutIndex).some((event) => (
        (event.kind === 'heal' || event.kind === 'statusCured' || event.kind === 'stat')
          && event.target.side === target.side && event.target.slot === target.slot
      )), condition).toBe(false)
      expect(defeated.currentHp, condition).toBe(0)
      expect(participant.activePartyIndex, condition).toBe(1)
    }
  })

  it('fait lire Assistance uniquement dans les capacités des autres membres', () => {
    const session = isolatedDoubleSession()
    const actor = session.teams.player[0]
    const reserve = mon(158)
    reserve.moves[0] = { ...reserve.moves[0]!, moveId: 45, data: { ...reserve.moves[0]!.data, moveId: 45, effect: 0, power: 50, accuracy: 0 } }
    actor.party.push(reserve)
    actor.party[0]!.moves[0]!.data = { ...actor.party[0]!.moves[0]!.data, effect: 180, power: 0, accuracy: 0, priority: 2 }

    const events = executeDoubleBattleTurn(session, [{ actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } }], catalog, createHgssLcrng(65))
    expect(events.filter((event) => event.kind === 'move' && event.actor.side === 'player' && event.actor.slot === 0).map((event) => event.kind === 'move' ? event.moveId : 0)).toEqual([33, 45])
  })

  it('calcule Baston avec chaque membre valide de l’équipe double', () => {
    const session = isolatedDoubleSession()
    const actor = session.teams.player[0]
    actor.party.push(mon(158), mon(155))
    actor.party[2]!.status = 0x10
    actor.party[0]!.moves[0]!.data = { ...actor.party[0]!.moves[0]!.data, effect: 154, power: 10, accuracy: 0, priority: 2 }
    session.teams.opponent[0].party[0]!.stats.hp = session.teams.opponent[0].party[0]!.currentHp = 500

    const events = executeDoubleBattleTurn(session, [{ actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } }], catalog, createHgssLcrng(66))
    expect(events).toContainEqual({ kind: 'multiHit', hits: 2 })
  })

  it('consomme la baie adverse avec Picore et applique son effet ROM au lanceur', () => {
    const session = isolatedDoubleSession()
    const berry = { itemId: 149, fieldPocket: 4, pluckEffect: 10, holdEffectParameter: 50 } as HgssItemData
    const items: HgssItemData[] = []
    items[149] = berry
    session.itemCatalog = { items, pocketNames: [] }
    const actor = session.teams.player[0].party[0]!
    const target = session.teams.opponent[0].party[0]!
    actor.currentHp = 1
    target.stats.hp = target.currentHp = 500
    target.heldItemId = 149
    actor.moves[0]!.data = { ...actor.moves[0]!.data, effect: 224, power: 30, accuracy: 0, priority: 2 }

    const events = executeDoubleBattleTurn(session, [{ actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } }], catalog, createHgssLcrng(67))
    expect(target.heldItemId).toBe(0)
    expect(actor.currentHp).toBeGreaterThan(1)
    expect(events).toContainEqual(expect.objectContaining({ kind: 'heal', target: { side: 'player', slot: 0 } }))
  })

  it('transmet globalement les états natifs avec Relais', () => {
    const session = isolatedDoubleSession()
    const participant = session.teams.player[0]
    participant.party.push(mon(158))
    participant.stages.attack = 3
    Object.assign(participant.volatile, { substituteHp: 12, focusEnergy: true, aquaRing: true, ingrain: true, perishTurns: 2 })
    participant.party[0]!.moves[0]!.data = { ...participant.party[0]!.moves[0]!.data, effect: 127, power: 0, accuracy: 0, priority: 2, range: 1 << 4 }

    const events = executeDoubleBattleTurn(session, [{ actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'player', slot: 0 }, switchPartyIndex: 1 }], catalog, createHgssLcrng(68))
    expect(events).toContainEqual(expect.objectContaining({ kind: 'sendOut', target: { side: 'player', slot: 0 }, partyIndex: 1 }))
    expect(participant.stages.attack).toBe(3)
    expect(participant.volatile).toMatchObject({ substituteHp: 12, focusEnergy: true, aquaRing: true, ingrain: true, perishTurns: 1 })
  })

  it('ordonne et consomme un soin du Sac avant les capacités doubles', () => {
    const session = isolatedDoubleSession()
    const potion = battleItem(17, (payload) => { payload[0x13] = 0x04; payload[0x1b] = 20 })
    const items: HgssItemData[] = []; items[17] = potion
    session.itemCatalog = { items, pocketNames: [] }
    session.bagInventory = new Map([[17, 2]])
    session.teams.player[0].party[0]!.currentHp = 1

    const events = executeDoubleBattleTurn(session, [{ kind: 'item', actor: { side: 'player', slot: 0 }, itemId: 17, targetPartyIndex: 0 }], catalog, createHgssLcrng(69))
    expect(events[0]).toMatchObject({ kind: 'item', itemId: 17, applied: true })
    expect(events).toContainEqual(expect.objectContaining({ kind: 'heal', target: { side: 'player', slot: 0 }, amount: session.teams.player[0].party[0]!.stats.hp - 1 }))
    expect(session.bagInventory.get(17)).toBe(1)
  })

  it('refuse une réanimation double avant mutation et consommation, en validation comme en exécution', () => {
    const session = isolatedDoubleSession()
    const revive = battleItem(28, (payload) => { payload[0x0f] = 0x01; payload[0x13] = 0x04; payload[0x1b] = 0xfe })
    const items: HgssItemData[] = []; items[28] = revive
    session.itemCatalog = { items, pocketNames: [] }
    session.bagInventory = new Map([[28, 1]])
    const reserve = mon(158)
    reserve.currentHp = 0
    session.teams.player[0].party.push(reserve)
    const before = structuredClone(reserve)
    const action = { kind: 'item', actor: { side: 'player', slot: 0 }, itemId: 28, targetPartyIndex: 1 } as const
    const healingPolicy: PokemonPartyHealingPolicy = {
      vetoFullHealRestoration: ({ restoration, source, partyIndex }) => restoration === 'hp' && source === 'battle-item' && partyIndex === 1
        ? { code: 'challenge.permanent-knockout', reason: 'Réanimation double interdite.' }
        : undefined,
    }

    expect(validateDoubleBattleBagItem(session, action, catalog, healingPolicy)).toBe('Réanimation double interdite.')
    const events = executeDoubleBattleTurn(session, [action], catalog, createHgssLcrng(169), undefined, healingPolicy)

    expect(events).toContainEqual(expect.objectContaining({ kind: 'item', itemId: 28, applied: false, reason: 'Réanimation double interdite.' }))
    expect(reserve).toEqual(before)
    expect(session.bagInventory.get(28)).toBe(1)
  })

  it('applique les objets de statistiques au bon combattant double', () => {
    const session = isolatedDoubleSession()
    const attack = battleItem(57, (payload) => { payload[0x0f] = 0x10 })
    const items: HgssItemData[] = []; items[57] = attack
    session.itemCatalog = { items, pocketNames: [] }
    session.bagInventory = new Map([[57, 1]])

    const events = executeDoubleBattleTurn(session, [{ kind: 'item', actor: { side: 'player', slot: 0 }, itemId: 57, targetPartyIndex: 0 }], catalog, createHgssLcrng(70))
    expect(events[0]).toMatchObject({ kind: 'item', itemId: 57, applied: true })
    expect(session.teams.player[0].stages.attack).toBe(1)
    expect(session.bagInventory.has(57)).toBe(false)
  })

  it('ne conserve aucun bonus de combat quand l’objet a disparu du Sac', () => {
    const session = isolatedDoubleSession()
    const attack = battleItem(57, (payload) => { payload[0x0f] = 0x10 })
    const items: HgssItemData[] = []; items[57] = attack
    session.itemCatalog = { items, pocketNames: [] }
    session.bagInventory = new Map()

    const events = executeDoubleBattleTurn(session, [{ kind: 'item', actor: { side: 'player', slot: 0 }, itemId: 57, targetPartyIndex: 0 }], catalog, createHgssLcrng(70))

    expect(events[0]).toMatchObject({ kind: 'item', itemId: 57, applied: false })
    expect(session.teams.player[0].stages.attack).toBe(0)
  })

  it('refuse transactionnellement un objet double sans effet avant de consommer le tour', () => {
    const session = isolatedDoubleSession()
    const potion = battleItem(17, (payload) => { payload[0x13] = 0x04; payload[0x1b] = 20 })
    const items: HgssItemData[] = []; items[17] = potion
    session.itemCatalog = { items, pocketNames: [] }
    session.bagInventory = new Map([[17, 1]])
    const action = { kind: 'item', actor: { side: 'player', slot: 0 }, itemId: 17, targetPartyIndex: 0 } as const

    expect(validateDoubleBattleBagItem(session, action, catalog)).toContain('aucun effet')
    expect(session.bagInventory.get(17)).toBe(1)
    expect(session.turn).toBe(0)
  })

  it('soigne les états volatils de combat indiqués par les bits ROM de l’objet', () => {
    const session = isolatedDoubleSession()
    const cure = battleItem(23, (payload) => { payload[0x0e] = 0x60 })
    const items: HgssItemData[] = []; items[23] = cure
    session.itemCatalog = { items, pocketNames: [] }
    session.bagInventory = new Map([[23, 1]])
    Object.assign(session.teams.player[0].volatile, { confusionTurns: 3, infatuated: true })
    const action = { kind: 'item', actor: { side: 'player', slot: 0 }, itemId: 23, targetPartyIndex: 0 } as const

    expect(validateDoubleBattleBagItem(session, action, catalog)).toBeUndefined()
    const events = executeDoubleBattleTurn(session, [action], catalog, createHgssLcrng(71))
    expect(events).toContainEqual(expect.objectContaining({ kind: 'statusCured', target: { side: 'player', slot: 0 }, applied: true }))
    expect(session.teams.player[0].volatile).toMatchObject({ confusionTurns: 0, infatuated: false })
    expect(session.bagInventory.has(23)).toBe(false)
  })

  it('soumet aussi les guérisons volatiles doubles au veto de statut joueur', () => {
    const session = isolatedDoubleSession()
    const cure = battleItem(23, (payload) => { payload[0x0e] = 0x60 })
    const items: HgssItemData[] = []; items[23] = cure
    session.itemCatalog = { items, pocketNames: [] }
    session.bagInventory = new Map([[23, 1]])
    Object.assign(session.teams.player[0].volatile, { confusionTurns: 3, infatuated: true })
    const action = { kind: 'item', actor: { side: 'player', slot: 0 }, itemId: 23, targetPartyIndex: 0 } as const
    const healingPolicy: PokemonPartyHealingPolicy = {
      vetoFullHealRestoration: ({ restoration }) => restoration === 'status'
        ? { code: 'challenge.status-lock', reason: 'Guérison de statut interdite.' }
        : undefined,
    }

    expect(validateDoubleBattleBagItem(session, action, catalog, healingPolicy)).toBe('Guérison de statut interdite.')
    const events = executeDoubleBattleTurn(session, [action], catalog, createHgssLcrng(171), undefined, healingPolicy)

    expect(events).toContainEqual(expect.objectContaining({ kind: 'item', itemId: 23, applied: false, reason: 'Guérison de statut interdite.' }))
    expect(session.teams.player[0].volatile).toMatchObject({ confusionTurns: 3, infatuated: true })
    expect(session.bagInventory.get(23)).toBe(1)
  })

  it('active globalement météo, Intimidation et Télécharge aux quatre entrées', () => {
    const intimidator = mon(152); intimidator.abilityId = 22; intimidator.stats.speed = 400
    const downloader = mon(155); downloader.abilityId = 88; downloader.stats.speed = 300
    const rain = mon(158); rain.abilityId = 2; rain.stats.speed = 200
    const target = mon(152); target.abilityId = 0; target.stats.speed = 100
    target.stats.defense = 120; target.stats.specialDefense = 60
    const session = createDoubleBattleSession({ kind: 'multi', catalog, player: [
      { ownerId: 'playerA', party: [intimidator], activePartyIndex: 0, controlled: true },
      { ownerId: 'playerB', party: [downloader], activePartyIndex: 0, controlled: false },
    ], opponent: [
      { ownerId: 'opponentA', party: [rain], activePartyIndex: 0, controlled: false },
      { ownerId: 'opponentB', party: [target], activePartyIndex: 0, controlled: false },
    ] })

    const events = consumeDoubleBattleInitialEvents(session)
    expect(session.teams.opponent.map(({ stages }) => stages.attack)).toEqual([-1, -1])
    expect(session.teams.player[1].stages.specialAttack).toBe(1)
    expect(session.weather.kind).toBe('rain')
    expect(events.filter(({ kind }) => kind === 'stat')).toHaveLength(3)
    expect(consumeDoubleBattleInitialEvents(session)).toEqual([])
  })

  it('fait choisir à Fouille un objet adverse selon le RNG natif en combat double', () => {
    const frisk = mon(152); frisk.abilityId = 119
    const opponentA = mon(158); opponentA.heldItemId = 10
    const opponentB = mon(152); opponentB.heldItemId = 20
    const fixedRng = { getSeed: () => 0, nextU16: () => 1 }
    const session = createDoubleBattleSession({ kind: 'multi', catalog, rng: fixedRng, player: [
      { ownerId: 'playerA', party: [frisk], activePartyIndex: 0, controlled: true },
      { ownerId: 'playerB', party: [mon(155)], activePartyIndex: 0, controlled: false },
    ], opponent: [
      { ownerId: 'opponentA', party: [opponentA], activePartyIndex: 0, controlled: false },
      { ownerId: 'opponentB', party: [opponentB], activePartyIndex: 0, controlled: false },
    ] })

    expect(session.initialEvents).toContainEqual(expect.objectContaining({ kind: 'abilityReveal', abilityId: 119, itemId: 20 }))
  })

  it('partage Médic Nature et la protection de Garde Magik lors des changements doubles', () => {
    const session = isolatedDoubleSession()
    const outgoing = session.teams.player[0].party[0]!
    outgoing.abilityId = 30; outgoing.status = 0x10
    const reserve = mon(158); reserve.abilityId = 98
    session.teams.player[0].party.push(reserve)
    Object.assign(session.sideConditions.player, { spikesLayers: 3, toxicSpikesLayers: 2, stealthRock: true })

    const events = executeDoubleBattleTurn(session, [{ kind: 'switch', actor: { side: 'player', slot: 0 }, partyIndex: 1 }], catalog, createHgssLcrng(72))
    expect(outgoing.status).toBe(0)
    expect(session.teams.player[0].party[1]!.currentHp).toBe(reserve.stats.hp)
    expect(session.teams.player[0].party[1]!.status).toBe(0)
    expect(events.some((event) => event.kind === 'residual' && event.target.side === 'player' && event.target.slot === 0)).toBe(false)
  })
})
