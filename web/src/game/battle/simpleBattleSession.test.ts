import { describe, expect, it } from 'vitest'
import type { HgssItemCatalog, HgssItemPartyParameters } from '../../rom/items/itemData'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { canSwitchSimpleBattlePokemon, clonePersistentSimpleBattlePokemon, consumeSimpleBattleInitialEvents, createSimpleBattleSession, escapeSimpleBattleWithItem, executeSimpleBattleOpponentTurn, executeSimpleBattlePlayerSwitchTurn, executeSimpleBattleTurn, getSelectableSimpleBattleMoveIndexes, getUsableSimpleBattleMoveIndexes, switchSimpleBattlePokemon, tryRunFromSimpleBattle } from './simpleBattleSession'
import { classifyDoubleBattleMoveSupport, classifySimpleBattleMoveSupport } from './simpleBattleEffectSupport'
import { calculateHgssTypeMultiplier } from './hgssBattleRules'

function mon(speciesId: number, moveIds: number[]) {
  const catalog = createPokemonTestCatalog(Math.max(158, speciesId))
  return createCanonicalPokemon(catalog, {
    speciesId, level: 5, rng: createHgssLcrng(speciesId), personality: { kind: 'fixed', value: speciesId }, individualValues: { kind: 'fixed', value: 0 },
    originalTrainer: { id: 1, name: 'J', gender: 'male' }, origin: { language: 3, gameVersion: 7, metLocation: 0, metLevel: 5, metTerrain: 0 }, ballId: 4, moveIds,
  })
}

function heldItemCatalog(effect: number, parameter: number, partyParameters: Partial<HgssItemPartyParameters> = {}): HgssItemCatalog {
  return {
    pocketNames: [],
    items: [undefined, {
      itemId: 1, name: 'OBJET ROM', holdEffect: effect, holdEffectParameter: parameter,
      partyParameters: partyParameters as HgssItemPartyParameters,
    }] as unknown as HgssItemCatalog['items'],
  }
}

describe('combat simple HGSS', () => {
  it('corrèle seulement les dégâts directs à leur capacité de présentation', () => {
    const catalog = createPokemonTestCatalog()
    const player = mon(152, [33]); const opponent = mon(155, [33])
    player.abilityId = 94
    player.moves[0]!.data = { ...player.moves[0]!.data, power: 30, accuracy: 0, priority: 1 }
    opponent.moves[0]!.data = { ...opponent.moves[0]!.data, effect: 85, power: 0, range: 1 << 4, priority: -1 }
    const session = createSimpleBattleSession({ kind: 'trainer', player, opponent, catalog })
    session.weather = { kind: 'sun', turns: 5 }

    const events = executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(12))
    const move = events.find((event) => event.kind === 'move' && event.side === 'player')
    const directDamage = events.find((event) => event.kind === 'damage' && event.side === 'opponent')
    const abilityDamage = events.find((event) => event.kind === 'damage' && event.side === 'player')

    expect(move?.kind === 'move' && directDamage?.kind === 'damage' && directDamage.movePresentationId).toBe(move?.kind === 'move' ? move.presentationId : undefined)
    expect(events).toContainEqual(expect.objectContaining({ kind: 'condition', side: 'player', condition: 'ability:94' }))
    expect(abilityDamage?.kind === 'damage' ? abilityDamage.movePresentationId : -1).toBeUndefined()
  })

  it('branche Anti-Bruit et Suintement sur le résolveur commun des capacités', () => {
    const catalog = createPokemonTestCatalog()
    const singer = mon(152, [33]); const soundproof = mon(155, [33]); soundproof.abilityId = 43
    singer.moves[0]!.moveId = 304
    singer.moves[0]!.data = { ...singer.moves[0]!.data, moveId: 304, effect: 0, power: 90, accuracy: 0, priority: 1 }
    soundproof.moves[0]!.data = { ...soundproof.moves[0]!.data, effect: 85, power: 0, range: 1 << 4, priority: -1 }
    const blocked = createSimpleBattleSession({ kind: 'trainer', player: singer, opponent: soundproof, catalog })
    const hpBefore = blocked.opponent.pokemon.currentHp
    expect(executeSimpleBattleTurn(blocked, 0, catalog, createHgssLcrng(3))).toContainEqual(expect.objectContaining({ kind: 'noEffect', side: 'opponent' }))
    expect(blocked.opponent.pokemon.currentHp).toBe(hpBefore)

    const drainer = mon(152, [33]); const ooze = mon(155, [33]); ooze.abilityId = 64
    drainer.moves[0]!.data = { ...drainer.moves[0]!.data, effect: 3, power: 20, accuracy: 0, priority: 1 }
    ooze.moves[0]!.data = { ...ooze.moves[0]!.data, effect: 85, power: 0, range: 1 << 4, priority: -1 }
    const drained = createSimpleBattleSession({ kind: 'trainer', player: drainer, opponent: ooze, catalog })
    const attackerHp = drained.player.pokemon.currentHp
    const events = executeSimpleBattleTurn(drained, 0, catalog, createHgssLcrng(4))
    expect(events).toContainEqual(expect.objectContaining({ kind: 'condition', side: 'player', condition: 'ability:64' }))
    expect(drained.player.pokemon.currentHp).toBeLessThan(attackerHp)
  })

  it('répercute Synchro vers la source après un statut de capacité', () => {
    const catalog = createPokemonTestCatalog()
    const source = mon(152, [33]); const synchronizer = mon(158, [33]); synchronizer.abilityId = 28
    source.moves[0]!.data = { ...source.moves[0]!.data, moveId: 261, effect: 167, power: 0, accuracy: 0, priority: 1 }
    synchronizer.moves[0]!.data = { ...synchronizer.moves[0]!.data, effect: 85, power: 0, range: 1 << 4, priority: -1 }
    const session = createSimpleBattleSession({ kind: 'trainer', player: source, opponent: synchronizer, catalog })

    const events = executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(6))

    expect(events).toContainEqual(expect.objectContaining({ kind: 'status', side: 'opponent', status: 'burn', applied: true }))
    expect(events).toContainEqual(expect.objectContaining({ kind: 'status', side: 'player', status: 'burn', applied: true }))
    expect(session.player.pokemon.status).toBe(0x10)
  })

  it('fait coûter un PP supplémentaire à Possessif face à Pression malgré sa portée utilisateur', () => {
    const catalog = createPokemonTestCatalog()
    const player = mon(152, [33]); const opponent = mon(155, [33]); opponent.abilityId = 46
    player.moves[0]!.moveId = 286
    player.moves[0]!.data = { ...player.moves[0]!.data, moveId: 286, effect: 192, power: 0, range: 1 << 4, accuracy: 0, priority: 1 }
    opponent.moves[0]!.data = { ...opponent.moves[0]!.data, effect: 85, power: 0, range: 1 << 4, priority: -1 }
    const session = createSimpleBattleSession({ kind: 'trainer', player, opponent, catalog })
    const ppBefore = session.player.pokemon.moves[0]!.pp

    executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(7))

    expect(session.player.pokemon.moves[0]!.pp).toBe(ppBefore - 2)
  })

  it('fait agir Vive Griffe avant la Vitesse et consomme la Baie Chérim', () => {
    const catalog = createPokemonTestCatalog()
    const player = mon(152, [33]); const opponent = mon(155, [33])
    player.stats.speed = 1; opponent.stats.speed = 200; player.heldItemId = 1
    const quick = createSimpleBattleSession({ kind: 'trainer', player, opponent, catalog, itemCatalog: heldItemCatalog(52, 20) })
    const fixedRng = { getSeed: () => 0, nextU16: () => 5 }
    let events = executeSimpleBattleTurn(quick, 0, catalog, fixedRng)
    expect(events.find((event) => event.kind === 'move')).toMatchObject({ kind: 'move', side: 'player' })
    expect(events).toContainEqual(expect.objectContaining({ kind: 'condition', condition: 'itemPriority:52' }))

    const custapUser = mon(152, [33]); const faster = mon(155, [33])
    custapUser.stats.speed = 1; faster.stats.speed = 200; custapUser.currentHp = 1; custapUser.heldItemId = 1
    const custap = createSimpleBattleSession({ kind: 'trainer', player: custapUser, opponent: faster, catalog, itemCatalog: heldItemCatalog(45, 4) })
    events = executeSimpleBattleTurn(custap, 0, catalog, fixedRng)
    expect(events.find((event) => event.kind === 'move')).toMatchObject({ kind: 'move', side: 'player' })
    expect(custap.player.pokemon.heldItemId).toBe(0)
  })

  it('déclenche automatiquement les baies de soin depuis leur holdEffect ROM', () => {
    const catalog = createPokemonTestCatalog()
    const player = mon(152, [33]); player.currentHp = Math.floor(player.stats.hp / 2); player.heldItemId = 1
    const session = createSimpleBattleSession({ kind: 'trainer', player, opponent: mon(155, [33]), catalog, itemCatalog: heldItemCatalog(13, 25) })
    const hpBefore = session.player.pokemon.currentHp
    const events = executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(3))
    expect(events).toContainEqual(expect.objectContaining({ kind: 'heal', side: 'player' }))
    expect(session.player.pokemon.currentHp).toBeGreaterThan(hpBefore)
    expect(session.player.pokemon.heldItemId).toBe(0)
  })

  it('consomme l’Herbe Pouvoir pour supprimer globalement le tour de charge', () => {
    const catalog = createPokemonTestCatalog()
    const player = mon(152, [33]); player.heldItemId = 1
    player.moves[0]!.data = { ...player.moves[0]!.data, effect: 39, power: 80, accuracy: 0, priority: 1 }
    const opponent = mon(155, [33]); opponent.moves[0]!.data = { ...opponent.moves[0]!.data, effect: 85, power: 0, range: 1 << 4, priority: -1 }
    const session = createSimpleBattleSession({ kind: 'trainer', player, opponent, catalog, itemCatalog: heldItemCatalog(99, 0) })
    const hpBefore = session.opponent.pokemon.currentHp

    const events = executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(4))

    expect(events).toContainEqual(expect.objectContaining({ kind: 'condition', condition: 'powerHerb' }))
    expect(session.opponent.pokemon.currentHp).toBeLessThan(hpBefore)
    expect(session.player.pokemon.heldItemId).toBe(0)
  })

  it('fait réagir la Baie Jaboca tenue par la cible après une frappe physique', () => {
    const catalog = createPokemonTestCatalog()
    const player = mon(152, [33]); const opponent = mon(155, [33]); opponent.heldItemId = 1
    player.moves[0]!.data = { ...player.moves[0]!.data, power: 30, category: 0, accuracy: 0, priority: 1 }
    opponent.moves[0]!.data = { ...opponent.moves[0]!.data, effect: 85, power: 0, range: 1 << 4, priority: -1 }
    const session = createSimpleBattleSession({ kind: 'trainer', player, opponent, catalog, itemCatalog: heldItemCatalog(46, 8) })
    const hpBefore = session.player.pokemon.currentHp

    const events = executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(5))

    expect(events).toContainEqual(expect.objectContaining({ kind: 'recoil', side: 'player' }))
    expect(session.player.pokemon.currentHp).toBe(hpBefore - Math.max(1, Math.floor(session.player.pokemon.stats.hp / 8)))
    expect(session.opponent.pokemon.heldItemId).toBe(0)
  })

  it('augmente les dégâts à chaque répétition avec l’objet Métronome', () => {
    const catalog = createPokemonTestCatalog()
    const player = mon(152, [33]); player.heldItemId = 1; player.level = 50; player.stats.attack = 100
    const opponent = mon(155, [33]); opponent.currentHp = opponent.stats.hp = 500; opponent.stats.defense = 100
    player.moves[0]!.data = { ...player.moves[0]!.data, power: 80, category: 0, accuracy: 0, priority: 1 }
    opponent.moves[0]!.data = { ...opponent.moves[0]!.data, effect: 85, power: 0, range: 1 << 4, priority: -1 }
    const session = createSimpleBattleSession({ kind: 'trainer', player, opponent, catalog, itemCatalog: heldItemCatalog(105, 10) })
    const fixedRng = { getSeed: () => 0, nextU16: () => 0 }

    const first = executeSimpleBattleTurn(session, 0, catalog, fixedRng).find((event) => event.kind === 'damage' && event.side === 'opponent')
    const second = executeSimpleBattleTurn(session, 0, catalog, fixedRng).find((event) => event.kind === 'damage' && event.side === 'opponent')

    expect(first?.kind === 'damage' && second?.kind === 'damage' && second.damage).toBeGreaterThan(first?.kind === 'damage' ? first.damage : 0)
  })

  it('fait réciproquer l’attirance par le Nœud Destin tenu', () => {
    const catalog = createPokemonTestCatalog()
    const player = mon(152, [33]); const opponent = mon(155, [33]); player.gender = 'male'; opponent.gender = 'female'; opponent.heldItemId = 1
    player.moves[0]!.data = { ...player.moves[0]!.data, effect: 120, power: 0, accuracy: 0, priority: 1 }
    opponent.moves[0]!.data = { ...opponent.moves[0]!.data, effect: 85, power: 0, range: 1 << 4, priority: -1 }
    const session = createSimpleBattleSession({ kind: 'trainer', player, opponent, catalog, itemCatalog: heldItemCatalog(108, 0) })

    const events = executeSimpleBattleTurn(session, 0, catalog, { getSeed: () => 0, nextU16: () => 1 })

    expect(session.opponent.volatile.infatuated).toBe(true)
    expect(session.player.volatile.infatuated).toBe(true)
    expect(events).toContainEqual(expect.objectContaining({ kind: 'condition', side: 'player', condition: 'item:108' }))
  })

  it('sépare Regard Noir des dégâts de ligotage et étend ceux-ci par l’objet ROM', () => {
    const catalog = createPokemonTestCatalog()
    const blocker = mon(152, [33]), target = mon(155, [33])
    blocker.moves[0]!.data = { ...blocker.moves[0]!.data, effect: 106, power: 0, accuracy: 0, priority: 1 }
    target.moves[0]!.data = { ...target.moves[0]!.data, effect: 85, power: 0, range: 1 << 4, priority: -1 }
    const blocked = createSimpleBattleSession({ kind: 'trainer', player: blocker, opponent: target, catalog })
    const hpBefore = blocked.opponent.pokemon.currentHp
    const blockEvents = executeSimpleBattleTurn(blocked, 0, catalog, createHgssLcrng(6))
    expect(canSwitchSimpleBattlePokemon(blocked, 'opponent')).toBe(false)
    expect(blocked.opponent.pokemon.currentHp).toBe(hpBefore)
    expect(blockEvents).not.toContainEqual(expect.objectContaining({ kind: 'condition', condition: 'bindingDamage' }))

    const binder = mon(152, [33]); binder.heldItemId = 1; binder.moves[0]!.data = { ...binder.moves[0]!.data, effect: 42, power: 20, accuracy: 0, priority: 1 }
    const bound = createSimpleBattleSession({ kind: 'trainer', player: binder, opponent: target, catalog, itemCatalog: heldItemCatalog(114, 0) })
    executeSimpleBattleTurn(bound, 0, catalog, createHgssLcrng(7))
    expect(bound.opponent.volatile.trappedTurns).toBe(5)
  })

  it('empêche globalement le changement sous Marque Ombre et laisse Carapace Mue passer', () => {
    const catalog = createPokemonTestCatalog()
    const player = mon(152, [33]); const trapper = mon(155, [33]); trapper.abilityId = 23
    const session = createSimpleBattleSession({ kind: 'trainer', player, opponent: trapper, catalog })
    expect(canSwitchSimpleBattlePokemon(session, 'player')).toBe(false)
    session.player.pokemon.abilityId = 23
    expect(canSwitchSimpleBattlePokemon(session, 'player')).toBe(true)
    session.player.pokemon.abilityId = 0; session.player.pokemon.heldItemId = 1; session.itemCatalog = heldItemCatalog(123, 0)
    session.player.volatile.trappedTurns = 3
    expect(canSwitchSimpleBattlePokemon(session, 'player')).toBe(true)
  })

  it('applique Multi-Coups, Matinal, Absentéisme et Moiteur dans une session réelle', () => {
    const catalog = createPokemonTestCatalog()
    const linked = mon(152, [33]); linked.abilityId = 92; linked.moves[0]!.data = { ...linked.moves[0]!.data, effect: 29, power: 1, accuracy: 100 }
    const linkedSession = createSimpleBattleSession({ kind: 'trainer', player: linked, opponent: mon(155, [33]), catalog })
    expect(executeSimpleBattleTurn(linkedSession, 0, catalog, createHgssLcrng(4))).toContainEqual({ kind: 'multiHit', hits: 5 })

    const early = mon(152, [33]); early.abilityId = 48; early.status = 3
    const earlySession = createSimpleBattleSession({ kind: 'trainer', player: early, opponent: mon(155, [33]), catalog })
    expect(executeSimpleBattleTurn(earlySession, 0, catalog, createHgssLcrng(4))).toContainEqual(expect.objectContaining({ kind: 'cannotAct', side: 'player', reason: 'sleep' }))
    expect(earlySession.player.pokemon.status & 0x7).toBe(1)

    const truant = mon(152, [33]); truant.abilityId = 54
    const truantSession = createSimpleBattleSession({ kind: 'trainer', player: truant, opponent: mon(155, [33]), catalog })
    executeSimpleBattleTurn(truantSession, 0, catalog, createHgssLcrng(4))
    expect(executeSimpleBattleTurn(truantSession, 0, catalog, createHgssLcrng(4))).toContainEqual(expect.objectContaining({ kind: 'cannotAct', side: 'player', reason: 'truant' }))

    const explosive = mon(152, [33]); explosive.moves[0]!.data = { ...explosive.moves[0]!.data, effect: 7, power: 200 }
    const damp = mon(155, [33]); damp.abilityId = 6
    const dampSession = createSimpleBattleSession({ kind: 'trainer', player: explosive, opponent: damp, catalog })
    expect(executeSimpleBattleTurn(dampSession, 0, catalog, createHgssLcrng(4))).toContainEqual(expect.objectContaining({ kind: 'noEffect', side: 'player' }))
    expect(dampSession.player.pokemon.currentHp).toBeGreaterThan(0)
  })

  it('hérite de la météo du terrain avant les talents d’entrée', () => {
    const catalog = createPokemonTestCatalog()
    const session = createSimpleBattleSession({
      kind: 'wild', player: mon(152, [33]), opponent: mon(155, [33]), catalog, initialWeather: 'hail',
    })
    expect(session.weather).toEqual({ kind: 'hail', turns: 0 })
  })

  it('actualise la forme et le type de Morphéo sans les persister hors combat', () => {
    const catalog = createPokemonTestCatalog(351)
    const castform = mon(351, [33]); castform.abilityId = 59
    const session = createSimpleBattleSession({ kind: 'wild', player: castform, opponent: mon(155, [33]), catalog, initialWeather: 'hail' })

    expect(session.player.pokemon.form).toBe(3)
    expect(session.player.types).toEqual([15, 15])
    expect(session.initialEvents).toContainEqual(expect.objectContaining({ kind: 'formChange', side: 'player' }))
    expect(clonePersistentSimpleBattlePokemon(session.player).form).toBe(0)
  })

  it('Calque copie le talent adverse autorisé avant les autres talents d’entrée', () => {
    const catalog = createPokemonTestCatalog()
    const player = mon(152, [33]); player.abilityId = 36
    const opponent = mon(155, [33]); opponent.abilityId = 2
    const session = createSimpleBattleSession({ kind: 'trainer', player, opponent, catalog })
    expect(session.player.volatile.abilityOverrideId).toBe(2)
    expect(session.weather.kind).toBe('rain')
    expect(session.initialEvents).toContainEqual(expect.objectContaining({ kind: 'condition', side: 'player', condition: 'trace:2' }))
  })

  it('déclenche Anticipation, Prédiction et Fouille avec les données ROM adverses', () => {
    const catalog = createPokemonTestCatalog()
    const threat = mon(155, [33, 45])
    threat.moves[0]!.data = { ...threat.moves[0]!.data, type: 1, power: 40 }
    threat.moves[1]!.data = { ...threat.moves[1]!.data, power: 90 }
    threat.heldItemId = 1
    const anticipation = mon(152, [33]); anticipation.abilityId = 107
    const forewarn = mon(152, [33]); forewarn.abilityId = 108
    const frisk = mon(152, [33]); frisk.abilityId = 119

    expect(createSimpleBattleSession({ kind: 'trainer', player: anticipation, opponent: threat, catalog }).initialEvents)
      .toContainEqual(expect.objectContaining({ kind: 'abilityReveal', abilityId: 107 }))
    expect(createSimpleBattleSession({ kind: 'trainer', player: forewarn, opponent: threat, catalog, rng: createHgssLcrng(2) }).initialEvents)
      .toContainEqual(expect.objectContaining({ kind: 'abilityReveal', abilityId: 108, moveId: 45 }))
    expect(createSimpleBattleSession({ kind: 'trainer', player: frisk, opponent: threat, catalog }).initialEvents)
      .toContainEqual(expect.objectContaining({ kind: 'abilityReveal', abilityId: 119, itemId: 1 }))
  })

  it('respecte Tempo Perso et Benêt pour toutes les sources de confusion et d’amour', () => {
    const catalog = createPokemonTestCatalog()
    const confuser = mon(152, [33]); confuser.moves[0]!.data = { ...confuser.moves[0]!.data, effect: 49, power: 0, accuracy: 0, priority: 1 }
    const ownTempo = mon(155, [33]); ownTempo.abilityId = 20; ownTempo.moves[0]!.data = { ...ownTempo.moves[0]!.data, effect: 85, power: 0, range: 1 << 4, priority: -1 }
    const blocked = createSimpleBattleSession({ kind: 'trainer', player: confuser, opponent: ownTempo, catalog })
    executeSimpleBattleTurn(blocked, 0, catalog, createHgssLcrng(3))
    expect(blocked.opponent.volatile.confusionTurns).toBe(0)
    confuser.abilityId = 104
    const bypassed = createSimpleBattleSession({ kind: 'trainer', player: confuser, opponent: ownTempo, catalog })
    executeSimpleBattleTurn(bypassed, 0, catalog, createHgssLcrng(3))
    expect(bypassed.opponent.volatile.confusionTurns).toBeGreaterThan(0)
  })

  it('consomme les PP, ordonne les actions et conserve les PV', () => {
    const catalog = createPokemonTestCatalog()
    const session = createSimpleBattleSession({ kind: 'trainer', player: mon(152, [33]), opponent: mon(155, [33]), catalog })
    const pp = session.player.pokemon.moves[0]!.pp
    const events = executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(4))
    expect(session.player.pokemon.moves[0]!.pp).toBe(pp - 1)
    expect(events.filter((event) => event.kind === 'move')).toHaveLength(2)
    expect(session.turn).toBe(1)
  })

  it('laisse sélectionner toute capacité ROM dotée de PP, même si son effet avancé est un repli', () => {
    const catalog = createPokemonTestCatalog()
    const session = createSimpleBattleSession({ kind: 'trainer', player: mon(152, [33]), opponent: mon(155, [33]), catalog })
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, effect: 264, power: 0 }

    expect(classifySimpleBattleMoveSupport(session.player.pokemon.moves[0]!.data)).toBe('no-effect-fallback')
    expect(getUsableSimpleBattleMoveIndexes(session.player)).toEqual([0])
    expect(executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(4))).toContainEqual({
      kind: 'noEffect', side: 'player', pokemonName: session.player.pokemon.speciesName,
    })
  })

  it('distingue les effets complets des attaques dont seul le dégât est reconstruit', () => {
    const catalog = createPokemonTestCatalog()
    expect(classifySimpleBattleMoveSupport(catalog.moves[33]!)).toBe('implemented')
    expect(classifySimpleBattleMoveSupport({ ...catalog.moves[33]!, effect: 233, power: 70 })).toBe('implemented')
    expect(classifyDoubleBattleMoveSupport({ ...catalog.moves[33]!, effect: 173, power: 0 })).toBe('implemented')
    expect(classifyDoubleBattleMoveSupport({ ...catalog.moves[33]!, effect: 9, power: 0 })).toBe('implemented')
    expect(classifyDoubleBattleMoveSupport({ ...catalog.moves[33]!, effect: 264, power: 0 })).toBe('no-effect-fallback')
  })

  it('résout globalement les sacrifices de Vœu Soin et Danse-Lune au prochain envoi', () => {
    const catalog = createPokemonTestCatalog()
    const player = mon(152, [33])
    const replacement = mon(158, [33])
    const session = createSimpleBattleSession({ kind: 'trainer', player, opponent: mon(155, [33]), catalog, playerParty: [player, replacement] })
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, effect: 270, power: 0, range: 1 << 4, accuracy: 0 }
    session.opponent.pokemon.moves[0]!.data = { ...session.opponent.pokemon.moves[0]!.data, effect: 85, power: 0, range: 1 << 4 }

    expect(executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(12))).toContainEqual(expect.objectContaining({ kind: 'faint', side: 'player' }))
    replacement.currentHp = 1
    replacement.status = 0x10
    replacement.moves[0]!.pp = 1
    const events = switchSimpleBattlePokemon(session, 'player', replacement, catalog)

    expect(session.player.pokemon.currentHp).toBe(session.player.pokemon.stats.hp)
    expect(session.player.pokemon.status).toBe(0)
    expect(session.player.pokemon.moves[0]!.pp).toBe(session.player.pokemon.moves[0]!.maxPp)
    expect(events).toContainEqual(expect.objectContaining({ kind: 'condition', condition: 'lunar-dance', applied: true }))
  })

  it('fait suivre Prélèvement Destin et Rancune au K.O. direct', () => {
    const catalog = createPokemonTestCatalog()
    const destiny = createSimpleBattleSession({ kind: 'trainer', player: mon(152, [33]), opponent: mon(155, [33]), catalog })
    destiny.player.pokemon.moves[0]!.data = { ...destiny.player.pokemon.moves[0]!.data, effect: 98, power: 0, priority: 4, range: 1 << 4, accuracy: 0 }
    destiny.opponent.pokemon.moves[0]!.data = { ...destiny.opponent.pokemon.moves[0]!.data, power: 250, accuracy: 0 }
    const destinyEvents = executeSimpleBattleTurn(destiny, 0, catalog, createHgssLcrng(13))
    expect(destinyEvents).toContainEqual(expect.objectContaining({ kind: 'condition', condition: 'destinyBondFaint' }))
    expect(destiny.opponent.pokemon.currentHp).toBe(0)

    const grudge = createSimpleBattleSession({ kind: 'trainer', player: mon(152, [33]), opponent: mon(155, [33]), catalog })
    grudge.player.pokemon.moves[0]!.data = { ...grudge.player.pokemon.moves[0]!.data, effect: 194, power: 0, priority: 4, range: 1 << 4, accuracy: 0 }
    grudge.opponent.pokemon.moves[0]!.data = { ...grudge.opponent.pokemon.moves[0]!.data, power: 250, accuracy: 0 }
    expect(executeSimpleBattleTurn(grudge, 0, catalog, createHgssLcrng(14))).toContainEqual(expect.objectContaining({ kind: 'condition', condition: 'grudgePpDepleted' }))
    expect(grudge.opponent.pokemon.moves[0]!.pp).toBe(0)
  })

  it('réduit les PP du dernier mouvement avec Dépit sans toucher aux autres capacités', () => {
    const catalog = createPokemonTestCatalog()
    const session = createSimpleBattleSession({ kind: 'trainer', player: mon(152, [33]), opponent: mon(155, [33, 45]), catalog })
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, effect: 100, power: 0, priority: -1, range: 1 << 4, accuracy: 0 }
    const untouchedPp = session.opponent.pokemon.moves[1]!.pp
    executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(15))
    expect(session.opponent.pokemon.moves[0]!.pp).toBeLessThan(session.opponent.pokemon.moves[0]!.maxPp - 1)
    expect(session.opponent.pokemon.moves[1]!.pp).toBe(untouchedPp)
  })

  it('applique Conversion et Conversion 2 sur les types de combat uniquement', () => {
    const catalog = createPokemonTestCatalog()
    const conversion = createSimpleBattleSession({ kind: 'trainer', player: mon(152, [33]), opponent: mon(155, [33]), catalog })
    conversion.player.types = [12, 12]
    conversion.player.pokemon.moves[0]!.data = { ...conversion.player.pokemon.moves[0]!.data, effect: 30, power: 0, type: 10, range: 1 << 4, accuracy: 0 }
    executeSimpleBattleTurn(conversion, 0, catalog, createHgssLcrng(16))
    expect(conversion.player.types).toEqual([10, 10])

    const conversion2 = createSimpleBattleSession({ kind: 'trainer', player: mon(152, [33]), opponent: mon(155, [33]), catalog })
    conversion2.player.pokemon.moves[0]!.data = { ...conversion2.player.pokemon.moves[0]!.data, effect: 93, power: 0, priority: -1, range: 1 << 4, accuracy: 0 }
    executeSimpleBattleTurn(conversion2, 0, catalog, createHgssLcrng(17))
    const opponentMoveType = conversion2.opponent.pokemon.moves[0]!.data.type
    expect(calculateHgssTypeMultiplier(opponentMoveType, conversion2.player.types)).toBeLessThan(10)
  })

  it('fait réellement traverser l’immunité Spectre après Clairvoyance', () => {
    const catalog = createPokemonTestCatalog()
    const session = createSimpleBattleSession({ kind: 'trainer', player: mon(152, [33, 45]), opponent: mon(155, [33]), catalog })
    session.opponent.types = [7, 7]
    session.opponent.stages.evasion = 6
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, effect: 113, power: 0, priority: 1, range: 1 << 4, accuracy: 0 }
    session.player.pokemon.moves[1]!.data = { ...session.player.pokemon.moves[1]!.data, effect: 0, power: 80, type: 0, priority: 0, accuracy: 100 }
    session.opponent.pokemon.moves[0]!.data = { ...session.opponent.pokemon.moves[0]!.data, effect: 85, power: 0, range: 1 << 4 }
    executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(18))
    const hp = session.opponent.pokemon.currentHp

    const events = executeSimpleBattleTurn(session, 1, catalog, createHgssLcrng(19))

    expect(events).toContainEqual(expect.objectContaining({ kind: 'damage', side: 'opponent', typeMultiplier: 10 }))
    expect(session.opponent.pokemon.currentHp).toBeLessThan(hp)
  })

  it('remplace durablement Gribouille par la dernière capacité adverse valide', () => {
    const catalog = createPokemonTestCatalog()
    const session = createSimpleBattleSession({ kind: 'trainer', player: mon(152, [33]), opponent: mon(155, [45]), catalog })
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, effect: 95, power: 0, priority: -1, range: 1 << 4, accuracy: 0 }
    const copied = session.opponent.pokemon.moves[0]!

    const events = executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(20))

    expect(events).toContainEqual(expect.objectContaining({ kind: 'condition', condition: 'sketch', applied: true }))
    expect(session.player.pokemon.moves[0]).toMatchObject({ moveId: copied.moveId, pp: copied.data.pp, maxPp: copied.data.pp, ppUps: 0 })
  })

  it('emploie Lutte sans PP et applique son contrecoup natif', () => {
    const catalog = createPokemonTestCatalog()
    catalog.moves[165] = { ...catalog.moves[33]!, moveId: 165, effect: 254, power: 50, pp: 1 }
    catalog.moveNames[165] = 'Lutte'
    const session = createSimpleBattleSession({ kind: 'trainer', player: mon(152, [33]), opponent: mon(155, [33]), catalog })
    session.player.pokemon.moves[0]!.pp = 0
    session.opponent.pokemon.moves[0]!.pp = 0
    const hp = session.player.pokemon.currentHp

    const events = executeSimpleBattleTurn(session, -1, catalog, createHgssLcrng(4))

    expect(events).toContainEqual(expect.objectContaining({ kind: 'move', side: 'player', moveId: 165 }))
    expect(events).toContainEqual(expect.objectContaining({ kind: 'recoil', side: 'player' }))
    expect(session.player.pokemon.currentHp).toBeLessThan(hp)
  })

  it('interdit la fuite contre un Dresseur sans consommer le tour', () => {
    const catalog = createPokemonTestCatalog()
    const session = createSimpleBattleSession({ kind: 'trainer', player: mon(152, [33]), opponent: mon(155, [33]), catalog })
    expect(tryRunFromSimpleBattle(session, catalog, createHgssLcrng(0))).toEqual([{ kind: 'cannotRunTrainer' }])
    expect(session.turn).toBe(0)
  })

  it('fait fuir sans test grâce à une Poképoupée uniquement face à un sauvage', () => {
    const catalog = createPokemonTestCatalog()
    const wild = createSimpleBattleSession({ kind: 'wild', player: mon(152, [33]), opponent: mon(155, [33]), catalog })
    expect(escapeSimpleBattleWithItem(wild)).toContainEqual({ kind: 'escaped' })
    expect(wild.result).toBe('escaped')
    const trainer = createSimpleBattleSession({ kind: 'trainer', player: mon(152, [33]), opponent: mon(155, [33]), catalog })
    expect(escapeSimpleBattleWithItem(trainer)).toEqual([{ kind: 'cannotRunTrainer' }])
    expect(trainer.phase).toBe('command')
  })

  it('interdit de rouvrir un combat après son résultat terminal', () => {
    const catalog = createPokemonTestCatalog()
    const session = createSimpleBattleSession({ kind: 'trainer', player: mon(152, [33]), opponent: mon(155, [33]), catalog })
    session.player.stages.attack = 4
    session.player.pokemon.currentHp = 0
    session.phase = 'ended'
    session.result = 'lost'
    const replacement = mon(158, [33])

    expect(() => switchSimpleBattlePokemon(session, 'player', replacement, catalog)).toThrow('Le combat est terminé.')
    expect(session.phase).toBe('ended')
    expect(session.result).toBe('lost')
    expect(session.player.pokemon.speciesId).toBe(152)
    expect(session.player.stages.attack).toBe(4)
  })

  it('applique les pièges d’entrée ROM et conserve Vœu pour le remplaçant', () => {
    const catalog = createPokemonTestCatalog()
    const session = createSimpleBattleSession({ kind: 'trainer', player: mon(152, [33]), opponent: mon(155, [33]), catalog })
    session.player.screens.spikesLayers = 3
    session.player.screens.stealthRock = true
    session.player.screens.toxicSpikesLayers = 2
    session.player.volatile.wishTurns = 1
    session.player.volatile.wishAmount = 8
    const replacement = mon(158, [33])
    const hp = replacement.currentHp

    const events = switchSimpleBattlePokemon(session, 'player', replacement, catalog)

    expect(events).toContainEqual(expect.objectContaining({ kind: 'entryHazard', hazard: 'spikes' }))
    expect(events).toContainEqual(expect.objectContaining({ kind: 'entryHazard', hazard: 'stealthRock' }))
    expect(events).toContainEqual(expect.objectContaining({ kind: 'status', status: 'badPoison', applied: true }))
    expect(session.player.pokemon.currentHp).toBeLessThan(hp)
    expect(session.player.volatile.wishTurns).toBe(1)
    expect(session.player.volatile.wishAmount).toBe(8)
  })

  it('un Pokémon Poison au sol absorbe les Pics Toxik en entrant', () => {
    const catalog = createPokemonTestCatalog()
    catalog.personalData[158] = { ...catalog.personalData[158]!, types: [3, 3] }
    const session = createSimpleBattleSession({ kind: 'trainer', player: mon(152, [33]), opponent: mon(155, [33]), catalog })
    session.player.screens.toxicSpikesLayers = 2

    const events = switchSimpleBattlePokemon(session, 'player', mon(158, [33]), catalog)

    expect(events).toContainEqual(expect.objectContaining({ kind: 'toxicSpikesAbsorbed', side: 'player' }))
    expect(session.player.screens.toxicSpikesLayers).toBe(0)
    expect(session.player.pokemon.status).toBe(0)
  })

  it('Télécharge compare les Défenses effectives lors d’une entrée', () => {
    const catalog = createPokemonTestCatalog()
    const session = createSimpleBattleSession({ kind: 'trainer', player: mon(152, [33]), opponent: mon(155, [33]), catalog })
    session.opponent.pokemon.stats.defense = 120
    session.opponent.pokemon.stats.specialDefense = 100
    session.opponent.stages.defense = -1
    const replacement = mon(158, [33])
    replacement.abilityId = 88

    const events = switchSimpleBattlePokemon(session, 'player', replacement, catalog)

    expect(session.player.stages.attack).toBe(1)
    expect(session.player.stages.specialAttack).toBe(0)
    expect(events).toContainEqual(expect.objectContaining({ kind: 'stat', side: 'player', stat: 'attack', change: 1, applied: true }))
  })

  it('exécute les objets tenus ROM communs au lieu de les laisser décoratifs', () => {
    const catalog = createPokemonTestCatalog()
    const player = mon(155, [33, 45])
    player.heldItemId = 1
    const opponent = mon(158, [33])
    opponent.heldItemId = 1
    const choiceSession = createSimpleBattleSession({
      kind: 'trainer', player, opponent, catalog, itemCatalog: heldItemCatalog(55, 50),
    })
    choiceSession.opponent.pokemon.moves[0]!.data = { ...choiceSession.opponent.pokemon.moves[0]!.data, power: 0, effect: 85, range: 1 << 4 }
    executeSimpleBattleTurn(choiceSession, 0, catalog, createHgssLcrng(22))
    expect(choiceSession.player.volatile.choiceMoveId).toBe(choiceSession.player.pokemon.moves[0]!.moveId)
    expect(getUsableSimpleBattleMoveIndexes(choiceSession.player)).toEqual([0])

    const sashOpponent = mon(158, [33])
    sashOpponent.heldItemId = 1
    const sashSession = createSimpleBattleSession({
      kind: 'trainer', player: mon(155, [33]), opponent: sashOpponent, catalog, itemCatalog: heldItemCatalog(103, 0),
    })
    sashSession.player.pokemon.moves[0]!.data = { ...sashSession.player.pokemon.moves[0]!.data, power: 250, accuracy: 0 }
    sashSession.opponent.pokemon.moves[0]!.data = { ...sashSession.opponent.pokemon.moves[0]!.data, power: 0, effect: 85, range: 1 << 4 }
    const events = executeSimpleBattleTurn(sashSession, 0, catalog, createHgssLcrng(23))
    expect(sashSession.opponent.pokemon.currentHp).toBe(1)
    expect(sashSession.opponent.pokemon.heldItemId).toBe(0)
    expect(events).toContainEqual(expect.objectContaining({ kind: 'condition', condition: 'heldItemEndure' }))
  })

  it('fait primer la Balle Fer ROM sur Lévitation et Vol Magnétik', () => {
    const catalog = createPokemonTestCatalog()
    const player = mon(155, [33])
    const opponent = mon(158, [33])
    opponent.abilityId = 26
    opponent.heldItemId = 1
    const session = createSimpleBattleSession({
      kind: 'trainer', player, opponent, catalog, itemCatalog: heldItemCatalog(106, 0),
    })
    session.player.pokemon.moves[0]!.data = {
      ...session.player.pokemon.moves[0]!.data,
      type: 4,
      power: 40,
      accuracy: 0,
    }
    session.opponent.pokemon.moves[0]!.data = {
      ...session.opponent.pokemon.moves[0]!.data,
      power: 0,
      effect: 85,
      range: 1 << 4,
    }
    session.opponent.volatile.magnetRiseTurns = 5
    const hp = session.opponent.pokemon.currentHp

    const events = executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(23))

    expect(session.opponent.pokemon.currentHp).toBeLessThan(hp)
    expect(events).toContainEqual(expect.objectContaining({
      kind: 'damage', side: 'opponent', typeMultiplier: 10,
    }))
  })

  it('fait réellement utiliser les objets encodés dans la fiche du Dresseur', () => {
    const catalog = createPokemonTestCatalog()
    const session = createSimpleBattleSession({
      kind: 'trainer', player: mon(155, [33]), opponent: mon(158, [33]), catalog,
      trainerName: 'RIVAL', opponentItems: [1], itemCatalog: heldItemCatalog(0, 0, { hpRestore: true, hpRestoreParameter: 0xff }),
    })
    session.opponent.pokemon.currentHp = 1
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, power: 0, effect: 85, range: 1 << 4 }

    const events = executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(24))

    expect(events).toContainEqual(expect.objectContaining({ kind: 'trainerItem', trainerName: 'RIVAL', itemId: 1 }))
    expect(events).toContainEqual(expect.objectContaining({ kind: 'heal', side: 'opponent' }))
    expect(session.opponent.pokemon.currentHp).toBe(session.opponent.pokemon.stats.hp)
    expect(session.opponentItems).toEqual([])
  })

  it('active les talents d’entrée dans l’ordre du combat', () => {
    const catalog = createPokemonTestCatalog()
    const intimidator = mon(155, [33])
    intimidator.abilityId = 22
    const session = createSimpleBattleSession({ kind: 'trainer', player: intimidator, opponent: mon(158, [33]), catalog })

    expect(session.opponent.stages.attack).toBe(-1)
    expect(consumeSimpleBattleInitialEvents(session)).toContainEqual(expect.objectContaining({
      kind: 'stat', side: 'opponent', stat: 'attack', change: -1, applied: true,
    }))
    expect(consumeSimpleBattleInitialEvents(session)).toEqual([])

    const weatherSetter = mon(152, [33])
    weatherSetter.abilityId = 117
    session.player.pokemon.currentHp = 0
    const events = switchSimpleBattlePokemon(session, 'player', weatherSetter, catalog)
    expect(session.weather).toEqual({ kind: 'hail', turns: 0 })
    expect(events).toContainEqual({ kind: 'weather', weather: 'hail' })
  })

  it("fait jouer uniquement l'adversaire après une action Sac ou Équipe", () => {
    const catalog = createPokemonTestCatalog()
    const session = createSimpleBattleSession({ kind: 'trainer', player: mon(152, [33]), opponent: mon(155, [33]), catalog })
    const playerPp = session.player.pokemon.moves[0]!.pp
    const opponentPp = session.opponent.pokemon.moves[0]!.pp
    const events = executeSimpleBattleOpponentTurn(session, catalog, createHgssLcrng(4))
    expect(session.player.pokemon.moves[0]!.pp).toBe(playerPp)
    expect(session.opponent.pokemon.moves[0]!.pp).toBe(opponentPp - 1)
    expect(events.filter((event) => event.kind === 'move')).toHaveLength(1)
    expect(session.turn).toBe(1)
  })

  it('applique Abri avant une attaque et conserve un seul débit de PP', () => {
    const catalog = createPokemonTestCatalog()
    const session = createSimpleBattleSession({ kind: 'trainer', player: mon(155, [33]), opponent: mon(158, [33]), catalog })
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, effect: 111, power: 0, priority: 4, range: 1 << 4 }
    session.opponent.pokemon.moves[0]!.data = { ...session.opponent.pokemon.moves[0]!.data, effect: 0, power: 50 }
    const pp = session.player.pokemon.moves[0]!.pp

    const events = executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(12))

    expect(events).toContainEqual(expect.objectContaining({ kind: 'protected', side: 'player', applied: true }))
    expect(events).toContainEqual(expect.objectContaining({ kind: 'protected', side: 'player', applied: false }))
    expect(events.some((event) => event.kind === 'damage' && event.side === 'player')).toBe(false)
    expect(session.player.pokemon.moves[0]!.pp).toBe(pp - 1)
  })

  it('résout les attaques multi-coups comme une seule capacité ROM', () => {
    const catalog = createPokemonTestCatalog()
    const session = createSimpleBattleSession({ kind: 'trainer', player: mon(155, [33]), opponent: mon(158, [33]), catalog })
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, effect: 29, power: 5 }
    session.opponent.pokemon.moves[0]!.data = { ...session.opponent.pokemon.moves[0]!.data, power: 0, effect: 85 }
    const pp = session.player.pokemon.moves[0]!.pp

    const events = executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(23))
    const hitEvent = events.find((event) => event.kind === 'multiHit')

    expect(hitEvent).toEqual(expect.objectContaining({ hits: expect.any(Number) }))
    expect(hitEvent && hitEvent.kind === 'multiHit' ? hitEvent.hits : 0).toBeGreaterThanOrEqual(2)
    expect(session.player.pokemon.moves[0]!.pp).toBe(pp - 1)
  })

  it('conserve la météo et applique ses dégâts de fin de tour', () => {
    const catalog = createPokemonTestCatalog()
    const session = createSimpleBattleSession({ kind: 'trainer', player: mon(155, [33]), opponent: mon(158, [33]), catalog })
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, effect: 115, power: 0, range: 1 << 6 }
    session.opponent.pokemon.moves[0]!.data = { ...session.opponent.pokemon.moves[0]!.data, power: 0, effect: 85 }

    const events = executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(31))

    expect(events).toContainEqual({ kind: 'weather', weather: 'sandstorm' })
    expect(events.filter((event) => event.kind === 'weatherDamage')).toHaveLength(2)
    expect(session.weather).toEqual({ kind: 'sandstorm', turns: 4 })
  })

  it('reproduit Repos: soin complet puis deux tours complets de sommeil', () => {
    const catalog = createPokemonTestCatalog()
    const session = createSimpleBattleSession({ kind: 'trainer', player: mon(155, [33]), opponent: mon(158, [33]), catalog })
    session.player.pokemon.currentHp = 1
    session.player.pokemon.status = 0x10
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, effect: 37, power: 0, range: 1 << 4, accuracy: 0 }
    session.opponent.pokemon.moves[0]!.data = { ...session.opponent.pokemon.moves[0]!.data, effect: 85, power: 0, range: 1 << 4, accuracy: 0 }

    const events = executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(19))

    expect(session.player.pokemon.currentHp).toBe(session.player.pokemon.stats.hp)
    expect(session.player.pokemon.status & 0x7).toBe(3)
    expect(events).toContainEqual(expect.objectContaining({ kind: 'status', side: 'player', status: 'sleep', applied: true }))
  })

  it.each([
    { effect: 37, label: 'Repos' },
    { effect: 251, label: 'Anneau Hydro' },
  ])('Anti-Soin bloque $label avant tout changement d’état', ({ effect }) => {
    const catalog = createPokemonTestCatalog()
    const session = createSimpleBattleSession({ kind: 'trainer', player: mon(155, [33]), opponent: mon(158, [33]), catalog })
    session.player.pokemon.currentHp -= 5
    session.player.volatile.healBlockTurns = 2
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, effect, power: 0, range: 1 << 4, accuracy: 0 }
    session.opponent.pokemon.moves[0]!.data = { ...session.opponent.pokemon.moves[0]!.data, effect: 85, power: 0, range: 1 << 4, accuracy: 0 }
    const hpBefore = session.player.pokemon.currentHp
    const statusBefore = session.player.pokemon.status

    const events = executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(effect))

    expect(session.player.pokemon.currentHp).toBe(hpBefore)
    expect(session.player.pokemon.status).toBe(statusBefore)
    expect(session.player.volatile.aquaRing).toBe(false)
    expect(events).toContainEqual(expect.objectContaining({ kind: 'noEffect', side: 'player' }))
    expect(events).not.toContainEqual(expect.objectContaining({ kind: 'heal', side: 'player' }))
  })

  it('réinitialise le compteur progressif de Toxic à chaque entrée', () => {
    const catalog = createPokemonTestCatalog()
    const poisoned = mon(155, [33])
    poisoned.status = 0x80 | 0xe00
    const session = createSimpleBattleSession({ kind: 'trainer', player: poisoned, opponent: mon(158, [33]), catalog })
    expect(session.player.pokemon.status & 0xf00).toBe(0x100)
  })

  it('garde Force Ajoutée volatile et ne corrompt pas les statistiques sauvegardées', () => {
    const catalog = createPokemonTestCatalog()
    const player = mon(155, [33])
    const originalStats = { ...player.stats }
    const session = createSimpleBattleSession({ kind: 'trainer', player, opponent: mon(158, [33]), catalog })
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, effect: 238, power: 0, range: 1 << 4, accuracy: 0 }
    session.opponent.pokemon.moves[0]!.data = { ...session.opponent.pokemon.moves[0]!.data, power: 0, effect: 85, range: 1 << 4 }

    executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(18))

    expect(session.player.volatile.powerTrick).toBe(true)
    expect(session.player.pokemon.stats).toEqual(originalStats)
    expect(player.stats).toEqual(originalStats)
  })

  it('applique les absorptions de type des talents de quatrième génération', () => {
    const catalog = createPokemonTestCatalog()
    const session = createSimpleBattleSession({ kind: 'trainer', player: mon(155, [33]), opponent: mon(158, [33]), catalog })
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, type: 13, power: 60, accuracy: 0 }
    session.opponent.pokemon.abilityId = 10
    session.opponent.pokemon.currentHp -= 5
    session.opponent.pokemon.moves[0]!.data = { ...session.opponent.pokemon.moves[0]!.data, power: 0, effect: 85, range: 1 << 4 }
    const hp = session.opponent.pokemon.currentHp

    const events = executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(5))

    expect(session.opponent.pokemon.currentHp).toBeGreaterThan(hp)
    expect(events).toContainEqual(expect.objectContaining({ kind: 'abilityHeal', side: 'opponent', abilityId: 10 }))
  })

  it.each([
    { healBlocked: false, label: 'à PV pleins' },
    { healBlocked: true, label: 'sous Anti-Soin' },
  ])('absorbe sans produire de faux soin $label', ({ healBlocked }) => {
    const catalog = createPokemonTestCatalog()
    const session = createSimpleBattleSession({ kind: 'trainer', player: mon(155, [33]), opponent: mon(158, [33]), catalog })
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, type: 13, power: 60, accuracy: 0 }
    session.opponent.pokemon.abilityId = 10
    session.opponent.volatile.healBlockTurns = healBlocked ? 2 : 0
    if (healBlocked) session.opponent.pokemon.currentHp -= 5
    session.opponent.pokemon.moves[0]!.data = { ...session.opponent.pokemon.moves[0]!.data, power: 0, effect: 85, range: 1 << 4 }
    const hp = session.opponent.pokemon.currentHp

    const events = executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(10))

    expect(session.opponent.pokemon.currentHp).toBe(hp)
    expect(events).toContainEqual(expect.objectContaining({ kind: 'damage', side: 'opponent', damage: 0, typeMultiplier: 0 }))
    expect(events).toContainEqual(expect.objectContaining({ kind: 'condition', side: 'opponent', condition: 'ability:10', applied: true }))
    expect(events).not.toContainEqual(expect.objectContaining({ kind: 'abilityHeal', side: 'opponent' }))
  })

  it('annonce Motorisé en plus du gain de Vitesse', () => {
    const catalog = createPokemonTestCatalog()
    const session = createSimpleBattleSession({ kind: 'trainer', player: mon(155, [33]), opponent: mon(158, [33]), catalog })
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, type: 13, power: 60, accuracy: 0 }
    session.opponent.pokemon.abilityId = 78
    session.opponent.pokemon.moves[0]!.data = { ...session.opponent.pokemon.moves[0]!.data, power: 0, effect: 85, range: 1 << 4 }

    const events = executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(78))

    expect(events).toContainEqual(expect.objectContaining({ kind: 'condition', side: 'opponent', condition: 'ability:78', applied: true }))
    expect(events).toContainEqual(expect.objectContaining({ kind: 'stat', side: 'opponent', stat: 'speed', change: 1, applied: true }))
  })

  it('Brise Moule contourne les talents d’absorption', () => {
    const catalog = createPokemonTestCatalog()
    const player = mon(155, [33])
    player.abilityId = 104
    player.moves[0]!.data = { ...player.moves[0]!.data, type: 11, power: 60, accuracy: 0 }
    const opponent = mon(158, [33])
    opponent.abilityId = 11
    opponent.moves[0]!.data = { ...opponent.moves[0]!.data, power: 0, effect: 85, range: 1 << 4 }
    const session = createSimpleBattleSession({ kind: 'trainer', player, opponent, catalog })
    const hp = session.opponent.pokemon.currentHp

    const events = executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(104))

    expect(session.opponent.pokemon.currentHp).toBeLessThan(hp)
    expect(events).not.toContainEqual(expect.objectContaining({ kind: 'abilityHeal', side: 'opponent', abilityId: 11 }))
  })

  it("fait perdre l'utilisateur si Explosion met K.O. les deux derniers Pokémon", () => {
    const catalog = createPokemonTestCatalog()
    const session = createSimpleBattleSession({ kind: 'trainer', player: mon(155, [33]), opponent: mon(158, [33]), catalog })
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, effect: 7, power: 250, accuracy: 0 }
    session.opponent.pokemon.currentHp = 1
    session.opponent.pokemon.moves[0]!.data = { ...session.opponent.pokemon.moves[0]!.data, power: 0, effect: 85, range: 1 << 4 }

    const events = executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(6))

    expect(session.result).toBe('lost')
    expect(events).toContainEqual({ kind: 'result', result: 'lost' })
  })

  it('n’émet pas de victoire quand seul l’actif adverse tombe et qu’une réserve subsiste', () => {
    const catalog = createPokemonTestCatalog()
    const player = mon(152, [33])
    const opponent = mon(155, [33])
    const opponentReserve = mon(158, [33])
    const session = createSimpleBattleSession({ kind: 'trainer', player, opponent, catalog, opponentParty: [opponent, opponentReserve] })
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, power: 250, accuracy: 0, priority: 1 }
    session.opponent.pokemon.currentHp = 1
    session.opponent.pokemon.moves[0]!.data = { ...session.opponent.pokemon.moves[0]!.data, effect: 85, power: 0, accuracy: 0, range: 1 << 4 }

    const events = executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(0x70))

    expect(events).toContainEqual(expect.objectContaining({
      kind: 'faint', side: 'opponent', defeated: expect.objectContaining({ currentHp: 0, personality: opponent.personality }),
    }))
    expect(events.some((event) => event.kind === 'result')).toBe(false)
    expect(session.phase).toBe('command')
    expect(session.result).toBeUndefined()
    expect(() => switchSimpleBattlePokemon(session, 'opponent', opponentReserve, catalog)).not.toThrow()
  })

  it("distingue une réserve qui partage personnalité et dresseur d'origine avec l'actif", () => {
    const catalog = createPokemonTestCatalog()
    const player = mon(152, [33])
    const reserve = mon(158, [33])
    reserve.personality = player.personality
    const opponent = mon(155, [33])
    const session = createSimpleBattleSession({
      kind: 'trainer', player, opponent, catalog, playerParty: [player, reserve],
    })
    session.player.pokemon.currentHp = 1
    session.player.pokemon.moves[0]!.data = {
      ...session.player.pokemon.moves[0]!.data, effect: 85, power: 0, accuracy: 0, priority: -1, range: 1 << 4,
    }
    session.opponent.pokemon.moves[0]!.data = {
      ...session.opponent.pokemon.moves[0]!.data, effect: 0, power: 250, accuracy: 0, priority: 1,
    }

    const events = executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(0x74))

    expect(player.instanceId).not.toBe(reserve.instanceId)
    expect(events).toContainEqual(expect.objectContaining({ kind: 'faint', side: 'player' }))
    expect(events.some((event) => event.kind === 'result')).toBe(false)
    expect(session.result).toBeUndefined()
    expect(() => switchSimpleBattlePokemon(session, 'player', reserve, catalog)).not.toThrow()
  })

  it('résout les deux K.O. de statut avant d’émettre un unique résultat terminal', () => {
    const catalog = createPokemonTestCatalog()
    const player = mon(152, [33])
    const opponent = mon(155, [33])
    const session = createSimpleBattleSession({ kind: 'trainer', player, opponent, catalog })
    for (const side of ['player', 'opponent'] as const) {
      session[side].pokemon.currentHp = 1
      session[side].pokemon.status = 0x8
      session[side].pokemon.moves[0]!.data = { ...session[side].pokemon.moves[0]!.data, effect: 85, power: 0, accuracy: 0, range: 1 << 4 }
    }

    const events = executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(0x71))
    const faintEvents = events.filter((event) => event.kind === 'faint')
    const resultEvents = events.filter((event) => event.kind === 'result')

    expect(session.player.pokemon.currentHp).toBe(0)
    expect(session.opponent.pokemon.currentHp).toBe(0)
    expect(faintEvents.map((event) => event.side)).toEqual(['player', 'opponent'])
    expect(faintEvents.every((event) => event.defeated.currentHp === 0)).toBe(true)
    expect(resultEvents).toEqual([{ kind: 'result', result: 'lost' }])
    expect(events.at(-1)).toEqual({ kind: 'result', result: 'lost' })
  })

  it('garde le combat ouvert après des K.O. résiduels si chaque camp possède une réserve', () => {
    const catalog = createPokemonTestCatalog()
    const player = mon(152, [33])
    const playerReserve = mon(158, [33])
    const opponent = mon(155, [33])
    const opponentReserve = mon(153, [33])
    const session = createSimpleBattleSession({
      kind: 'trainer', player, opponent, catalog,
      playerParty: [player, playerReserve], opponentParty: [opponent, opponentReserve],
    })
    for (const side of ['player', 'opponent'] as const) {
      session[side].pokemon.currentHp = 1
      session[side].pokemon.status = 0x8
      session[side].pokemon.moves[0]!.data = { ...session[side].pokemon.moves[0]!.data, effect: 85, power: 0, accuracy: 0, range: 1 << 4 }
    }

    const events = executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(0x72))

    expect(events.filter((event) => event.kind === 'faint')).toHaveLength(2)
    expect(events.some((event) => event.kind === 'result')).toBe(false)
    expect(session.phase).toBe('command')
    expect(session.result).toBeUndefined()
    expect(() => switchSimpleBattlePokemon(session, 'opponent', opponentReserve, catalog)).not.toThrow()
    expect(() => switchSimpleBattlePokemon(session, 'player', playerReserve, catalog)).not.toThrow()
  })

  it('ne ranime pas un K.O. de malédiction et refuse tout remplacement après le résultat', () => {
    const catalog = createPokemonTestCatalog()
    const player = mon(152, [33])
    player.abilityId = 44
    const opponent = mon(155, [33])
    const session = createSimpleBattleSession({ kind: 'trainer', player, opponent, catalog, initialWeather: 'rain' })
    session.player.pokemon.currentHp = 1
    session.player.volatile.cursed = true
    for (const side of ['player', 'opponent'] as const) {
      session[side].pokemon.moves[0]!.data = { ...session[side].pokemon.moves[0]!.data, effect: 85, power: 0, accuracy: 0, range: 1 << 4 }
    }

    const events = executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(0x73))
    const faintIndex = events.findIndex((event) => event.kind === 'faint' && event.side === 'player')

    expect(faintIndex).toBeGreaterThanOrEqual(0)
    expect(events[faintIndex]).toMatchObject({ kind: 'faint', side: 'player', defeated: { currentHp: 0, personality: player.personality } })
    expect(events.slice(faintIndex + 1).some((event) => (
      (event.kind === 'heal' || event.kind === 'abilityHeal' || event.kind === 'statusCured' || event.kind === 'stat')
        && 'side' in event && event.side === 'player'
    ))).toBe(false)
    expect(session.player.pokemon.currentHp).toBe(0)
    expect(events.at(-1)).toEqual({ kind: 'result', result: 'lost' })
    expect(() => switchSimpleBattlePokemon(session, 'player', mon(158, [33]), catalog)).toThrow('Le combat est terminé.')
    expect(session.result).toBe('lost')
  })

  it('diffère le soin de Vœu jusqu’à la fin du tour suivant', () => {
    const catalog = createPokemonTestCatalog()
    const session = createSimpleBattleSession({ kind: 'trainer', player: mon(155, [33]), opponent: mon(158, [33]), catalog })
    session.player.pokemon.currentHp = 1
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, effect: 179, power: 0, range: 1 << 4, accuracy: 0 }
    session.opponent.pokemon.moves[0]!.data = { ...session.opponent.pokemon.moves[0]!.data, power: 0, effect: 85, range: 1 << 4, accuracy: 0 }

    executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(14))
    expect(session.player.pokemon.currentHp).toBe(1)
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, effect: 85 }
    const events = executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(15))

    expect(session.player.pokemon.currentHp).toBeGreaterThan(1)
    expect(events).toContainEqual(expect.objectContaining({ kind: 'condition', side: 'player', condition: 'wishGranted' }))
  })

  it('branche les drapeaux IA ROM sur le choix de type du Dresseur', () => {
    const catalog = createPokemonTestCatalog()
    const session = createSimpleBattleSession({
      kind: 'trainer', player: mon(155, [33]), opponent: mon(158, [33, 45]), catalog, opponentAiFlags: 1,
    })
    session.player.types = [12, 12]
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, power: 0, effect: 85, range: 1 << 4 }
    session.opponent.pokemon.moves[0]!.data = { ...session.opponent.pokemon.moves[0]!.data, type: 0, power: 40, accuracy: 0 }
    session.opponent.pokemon.moves[1]!.data = { ...session.opponent.pokemon.moves[1]!.data, type: 10, power: 40, accuracy: 0 }

    const events = executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(17))
    const opponentMove = events.find((event) => event.kind === 'move' && event.side === 'opponent')

    expect(opponentMove).toEqual(expect.objectContaining({ moveId: session.opponent.pokemon.moves[1]!.moveId }))
  })

  it('applique les contrecoups de statistiques au lanceur, pas à la cible', () => {
    const catalog = createPokemonTestCatalog()
    const session = createSimpleBattleSession({ kind: 'trainer', player: mon(152, [33]), opponent: mon(155, [45]), catalog })
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, effect: 218, power: 40, accuracy: 0 }
    session.opponent.pokemon.moves[0]!.data = { ...session.opponent.pokemon.moves[0]!.data, effect: 85, power: 0, range: 1 << 4, accuracy: 0 }

    executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(22))

    expect(session.player.stages.speed).toBe(-1)
    expect(session.opponent.stages.speed).toBe(0)
  })

  it('Stimulant guérit la paralysie de la cible après les dégâts', () => {
    const catalog = createPokemonTestCatalog()
    const session = createSimpleBattleSession({ kind: 'trainer', player: mon(152, [33]), opponent: mon(155, [45]), catalog })
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, effect: 171, power: 40, accuracy: 0 }
    session.opponent.pokemon.status = 0x40
    session.opponent.pokemon.moves[0]!.data = { ...session.opponent.pokemon.moves[0]!.data, effect: 85, power: 0, range: 1 << 4, accuracy: 0 }

    executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(23))

    expect(session.opponent.pokemon.status & 0x40).toBe(0)
  })

  it('mémorise les dégâts physiques du tour pour Riposte', () => {
    const catalog = createPokemonTestCatalog()
    const session = createSimpleBattleSession({ kind: 'trainer', player: mon(152, [33]), opponent: mon(155, [45]), catalog })
    session.player.pokemon.stats.speed = 1
    session.opponent.pokemon.stats.speed = 100
    session.player.pokemon.stats.hp = session.player.pokemon.currentHp = 200
    session.opponent.pokemon.stats.hp = session.opponent.pokemon.currentHp = 200
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, effect: 89, power: 1, type: 1, category: 0, accuracy: 0, priority: -5 }
    session.opponent.pokemon.moves[0]!.data = { ...session.opponent.pokemon.moves[0]!.data, effect: 0, power: 20, category: 0, accuracy: 0 }

    const damages = executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(24)).filter((event) => event.kind === 'damage')

    expect(damages).toHaveLength(2)
    expect(damages[1]!.damage).toBe(Math.min(200, damages[0]!.damage * 2))
  })

  it('Casse-Brique retire les écrans avant de calculer sa frappe', () => {
    const catalog = createPokemonTestCatalog()
    const session = createSimpleBattleSession({ kind: 'trainer', player: mon(152, [33]), opponent: mon(155, [45]), catalog })
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, effect: 186, power: 75, category: 0, accuracy: 0 }
    session.opponent.screens.reflectTurns = 5
    session.opponent.pokemon.moves[0]!.data = { ...session.opponent.pokemon.moves[0]!.data, effect: 85, power: 0, range: 1 << 4, accuracy: 0 }

    const events = executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(25))

    expect(session.opponent.screens.reflectTurns).toBe(0)
    expect(events).toContainEqual({ kind: 'condition', side: 'opponent', condition: 'screensBroken', applied: true })
  })

  it('partage une seule mécanique de charge pour Vol et force automatiquement le second tour', () => {
    const catalog = createPokemonTestCatalog()
    const session = createSimpleBattleSession({ kind: 'trainer', player: mon(152, [33, 45]), opponent: mon(155, [33]), catalog })
    session.player.pokemon.stats.speed = 100
    session.player.pokemon.stats.hp = session.player.pokemon.currentHp = 500
    session.opponent.pokemon.stats.hp = session.opponent.pokemon.currentHp = 500
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, effect: 155, power: 90, accuracy: 0 }
    session.opponent.pokemon.moves[0]!.data = { ...session.opponent.pokemon.moves[0]!.data, effect: 0, power: 40, accuracy: 0 }
    const pp = session.player.pokemon.moves[0]!.pp

    const charge = executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(30))
    expect(charge).toContainEqual({ kind: 'condition', side: 'player', condition: 'charge:fly', applied: true })
    expect(charge).toContainEqual(expect.objectContaining({ kind: 'miss', side: 'opponent' }))
    expect(session.opponent.pokemon.currentHp).toBe(500)
    expect(getUsableSimpleBattleMoveIndexes(session.player)).toEqual([0])

    const strike = executeSimpleBattleTurn(session, 1, catalog, createHgssLcrng(31))
    expect(strike).toContainEqual(expect.objectContaining({ kind: 'damage', side: 'opponent' }))
    expect(session.opponent.pokemon.currentHp).toBeLessThan(500)
    expect(session.player.pokemon.moves[0]!.pp).toBe(pp - 1)
    expect(session.player.volatile.semiInvulnerable).toBeUndefined()
  })

  it('enchaîne Roulade avec une puissance croissante sans redébiter les PP', () => {
    const catalog = createPokemonTestCatalog()
    const session = createSimpleBattleSession({ kind: 'trainer', player: mon(152, [33, 45]), opponent: mon(155, [33]), catalog })
    session.player.pokemon.stats.speed = 100
    session.opponent.pokemon.stats.hp = session.opponent.pokemon.currentHp = 1000
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, effect: 117, power: 30, accuracy: 0 }
    session.opponent.pokemon.moves[0]!.data = { ...session.opponent.pokemon.moves[0]!.data, effect: 85, power: 0, accuracy: 0, range: 1 << 4 }
    const pp = session.player.pokemon.moves[0]!.pp
    const first = executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(32))
    const second = executeSimpleBattleTurn(session, 1, catalog, createHgssLcrng(32))
    const damage = (events: ReturnType<typeof executeSimpleBattleTurn>) => {
      const event = events.find((candidate) => candidate.kind === 'damage' && candidate.side === 'opponent')
      return event?.kind === 'damage' ? event.damage : 0
    }

    expect(damage(second)).toBeGreaterThan(damage(first))
    expect(session.player.pokemon.moves[0]!.pp).toBe(pp - 1)
    expect(session.player.volatile.rolloutCount).toBe(2)
  })

  it('programme Prescience sur le côté adverse et frappe exactement au troisième bilan de tour', () => {
    const catalog = createPokemonTestCatalog()
    const session = createSimpleBattleSession({ kind: 'trainer', player: mon(152, [33]), opponent: mon(155, [33]), catalog })
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, effect: 148, power: 80, accuracy: 0, category: 1 }
    session.opponent.pokemon.moves[0]!.data = { ...session.opponent.pokemon.moves[0]!.data, effect: 85, power: 0, accuracy: 0, range: 1 << 4 }
    session.opponent.pokemon.stats.hp = session.opponent.pokemon.currentHp = 500

    expect(executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(33))).toContainEqual({ kind: 'condition', side: 'opponent', condition: 'futureSight', applied: true })
    const hp = session.opponent.pokemon.currentHp
    expect(executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(34)).some((event) => event.kind === 'residual' && event.status === 'futureSight')).toBe(false)
    const impact = executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(35))
    expect(impact).toContainEqual(expect.objectContaining({ kind: 'residual', side: 'opponent', status: 'futureSight' }))
    expect(session.opponent.pokemon.currentHp).toBeLessThan(hp)
  })

  it('autorise Ronflement uniquement pendant le sommeil et conserve son effet d’attaque', () => {
    const catalog = createPokemonTestCatalog()
    const session = createSimpleBattleSession({ kind: 'trainer', player: mon(152, [33]), opponent: mon(155, [33]), catalog })
    session.player.pokemon.status = 3
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, effect: 92, power: 40, accuracy: 0, effectChance: 100 }
    session.opponent.pokemon.moves[0]!.data = { ...session.opponent.pokemon.moves[0]!.data, effect: 85, power: 0, accuracy: 0, range: 1 << 4 }
    const hp = session.opponent.pokemon.currentHp

    expect(executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(36))).toContainEqual(expect.objectContaining({ kind: 'damage', side: 'opponent' }))
    expect(session.opponent.pokemon.currentHp).toBeLessThan(hp)
    session.player.pokemon.status = 0
    expect(executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(37))).toContainEqual(expect.objectContaining({ kind: 'noEffect', side: 'player' }))
  })

  it('consomme globalement les réserves de Stockage avec Relâche', () => {
    const catalog = createPokemonTestCatalog()
    const session = createSimpleBattleSession({ kind: 'trainer', player: mon(152, [33]), opponent: mon(155, [33]), catalog })
    session.player.volatile.stockpile = 2
    session.player.stages.defense = 2
    session.player.stages.specialDefense = 2
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, effect: 161, power: 1, accuracy: 0 }
    session.opponent.pokemon.moves[0]!.data = { ...session.opponent.pokemon.moves[0]!.data, effect: 85, power: 0, accuracy: 0, range: 1 << 4 }

    const events = executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(38))

    expect(events).toContainEqual({ kind: 'condition', side: 'player', condition: 'spitUp', applied: true })
    expect(session.player.volatile.stockpile).toBe(0)
    expect(session.player.stages).toMatchObject({ defense: 0, specialDefense: 0 })
  })

  it('annule Mitra-Poing lorsque le lanceur a déjà subi des dégâts dans le tour', () => {
    const catalog = createPokemonTestCatalog()
    const session = createSimpleBattleSession({ kind: 'trainer', player: mon(152, [33]), opponent: mon(155, [33]), catalog })
    session.player.pokemon.stats.speed = 1
    session.opponent.pokemon.stats.speed = 100
    session.player.pokemon.stats.hp = session.player.pokemon.currentHp = 500
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, effect: 170, power: 150, accuracy: 0, priority: -3 }
    session.opponent.pokemon.moves[0]!.data = { ...session.opponent.pokemon.moves[0]!.data, effect: 0, power: 20, accuracy: 0 }
    const hp = session.opponent.pokemon.currentHp

    const events = executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(39))

    expect(events).toContainEqual({ kind: 'condition', side: 'player', condition: 'focusPunchLost', applied: true })
    expect(session.opponent.pokemon.currentHp).toBe(hp)
  })

  it('applique les substitutions et suppressions de talent uniquement dans l’état de combat', () => {
    const catalog = createPokemonTestCatalog()
    const player = mon(152, [33])
    const opponent = mon(155, [33])
    player.abilityId = 65
    opponent.abilityId = 10
    const session = createSimpleBattleSession({ kind: 'trainer', player, opponent, catalog })
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, effect: 178, power: 0, accuracy: 0, range: 1 << 4 }
    session.opponent.pokemon.moves[0]!.data = { ...session.opponent.pokemon.moves[0]!.data, effect: 85, power: 0, accuracy: 0, range: 1 << 4 }

    expect(executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(40))).toContainEqual({ kind: 'condition', side: 'player', condition: 'rolePlay', applied: true })
    expect(session.player.volatile.abilityOverrideId).toBe(10)
    expect(session.player.pokemon.abilityId).toBe(65)
    expect(player.abilityId).toBe(65)

    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, effect: 239 }
    expect(executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(41))).toContainEqual({ kind: 'condition', side: 'opponent', condition: 'gastroAcid', applied: true })
    expect(session.opponent.volatile.abilitySuppressed).toBe(true)
    expect(session.opponent.pokemon.abilityId).toBe(10)
  })

  it('échange les objets tenus avec les restrictions globales de la ROM', () => {
    const catalog = createPokemonTestCatalog()
    const player = mon(152, [33])
    const opponent = mon(155, [33])
    player.heldItemId = 1
    opponent.heldItemId = 2
    const itemCatalog = {
      pocketNames: [],
      items: [undefined, { fieldPocket: 0 }, { fieldPocket: 0 }],
    } as unknown as HgssItemCatalog
    const session = createSimpleBattleSession({ kind: 'trainer', player, opponent, catalog, itemCatalog })
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, effect: 177, power: 0, accuracy: 0, range: 1 << 4 }
    session.opponent.pokemon.moves[0]!.data = { ...session.opponent.pokemon.moves[0]!.data, effect: 85, power: 0, accuracy: 0, range: 1 << 4 }

    expect(executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(42))).toContainEqual({ kind: 'condition', side: 'player', condition: 'heldItemsSwapped', applied: true })
    expect([session.player.pokemon.heldItemId, session.opponent.pokemon.heldItemId]).toEqual([2, 1])
  })

  it('invoque la capacité de Force-Nature depuis la table de terrain extraite de la ROM', () => {
    const catalog = createPokemonTestCatalog()
    catalog.moves[89] = { ...catalog.moves[33]!, moveId: 89, effect: 147, power: 100, type: 4, accuracy: 0 }
    catalog.moveNames[89] = 'SEISME ROM'
    const session = createSimpleBattleSession({ kind: 'trainer', player: mon(152, [33]), opponent: mon(155, [33]), catalog, initialTerrainId: 0 })
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, effect: 173, power: 0, accuracy: 0 }
    session.opponent.pokemon.moves[0]!.data = { ...session.opponent.pokemon.moves[0]!.data, effect: 85, power: 0, accuracy: 0, range: 1 << 4 }
    const pp = session.player.pokemon.moves[0]!.pp

    const events = executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(43))

    expect(events.filter((event) => event.kind === 'move' && event.side === 'player').map((event) => event.kind === 'move' ? event.moveId : 0)).toEqual([33, 89])
    expect(events).toContainEqual(expect.objectContaining({ kind: 'damage', side: 'opponent' }))
    expect(session.player.pokemon.moves[0]!.pp).toBe(pp - 1)
  })

  it('fait exécuter à Copie la dernière attaque adverse sans consommer ses PP', () => {
    const catalog = createPokemonTestCatalog()
    const session = createSimpleBattleSession({ kind: 'trainer', player: mon(152, [33]), opponent: mon(155, [45]), catalog })
    session.player.pokemon.stats.speed = 1
    session.opponent.pokemon.stats.speed = 100
    session.player.pokemon.stats.hp = session.player.pokemon.currentHp = 500
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, effect: 82, power: 0, accuracy: 0, priority: -1 }
    session.opponent.pokemon.moves[0]!.data = { ...session.opponent.pokemon.moves[0]!.data, effect: 0, power: 40, accuracy: 0 }
    const opponentPp = session.opponent.pokemon.moves[0]!.pp

    const events = executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(44))
    const playerMoves = events.filter((event) => event.kind === 'move' && event.side === 'player')

    expect(playerMoves.map((event) => event.kind === 'move' ? event.moveId : 0)).toEqual([33, 45])
    expect(session.opponent.pokemon.moves[0]!.pp).toBe(opponentPp - 1)
    expect(session.opponent.pokemon.currentHp).toBeLessThan(session.opponent.pokemon.stats.hp)
  })

  it('laisse Blabla Dodo invoquer une capacité connue pendant le sommeil', () => {
    const catalog = createPokemonTestCatalog()
    const session = createSimpleBattleSession({ kind: 'trainer', player: mon(152, [33, 45]), opponent: mon(155, [33]), catalog })
    session.player.pokemon.status = 3
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, effect: 97, power: 0, accuracy: 0 }
    session.player.pokemon.moves[1]!.data = { ...session.player.pokemon.moves[1]!.data, effect: 0, power: 50, accuracy: 0 }
    session.opponent.pokemon.moves[0]!.data = { ...session.opponent.pokemon.moves[0]!.data, effect: 85, power: 0, accuracy: 0, range: 1 << 4 }
    const calledPp = session.player.pokemon.moves[1]!.pp

    const events = executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(45))

    expect(events.filter((event) => event.kind === 'move' && event.side === 'player').map((event) => event.kind === 'move' ? event.moveId : 0)).toEqual([33, 45])
    expect(session.player.pokemon.moves[1]!.pp).toBe(calledPp)
  })

  it('restaure Mimique lors de la synchronisation persistante du Pokémon', () => {
    const catalog = createPokemonTestCatalog()
    const session = createSimpleBattleSession({ kind: 'trainer', player: mon(152, [33]), opponent: mon(155, [45]), catalog })
    session.player.pokemon.stats.speed = 1
    session.opponent.pokemon.stats.speed = 100
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, effect: 9, power: 0, accuracy: 0, priority: -1 }
    session.opponent.pokemon.moves[0]!.data = { ...session.opponent.pokemon.moves[0]!.data, effect: 85, power: 0, accuracy: 0, range: 1 << 4 }

    expect(executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(46))).toContainEqual({ kind: 'condition', side: 'player', condition: 'mimic', applied: true })
    expect(session.player.pokemon.moves[0]).toMatchObject({ moveId: 45, pp: 5, maxPp: 5 })
    expect(clonePersistentSimpleBattlePokemon(session.player).moves[0]).toMatchObject({ moveId: 33 })
  })

  it('résout Coup Bas et Moi d’Abord depuis les commandes réellement planifiées', () => {
    const catalog = createPokemonTestCatalog()
    const sucker = createSimpleBattleSession({ kind: 'trainer', player: mon(152, [33]), opponent: mon(155, [45]), catalog })
    sucker.player.pokemon.moves[0]!.data = { ...sucker.player.pokemon.moves[0]!.data, effect: 248, power: 80, priority: 1, accuracy: 0 }
    sucker.opponent.pokemon.moves[0]!.data = { ...sucker.opponent.pokemon.moves[0]!.data, effect: 0, power: 40, accuracy: 0 }
    expect(executeSimpleBattleTurn(sucker, 0, catalog, createHgssLcrng(47))).toContainEqual(expect.objectContaining({ kind: 'damage', side: 'opponent' }))

    const meFirst = createSimpleBattleSession({ kind: 'trainer', player: mon(152, [33]), opponent: mon(155, [45]), catalog })
    meFirst.player.pokemon.stats.speed = 100
    meFirst.opponent.pokemon.stats.speed = 1
    meFirst.player.pokemon.moves[0]!.data = { ...meFirst.player.pokemon.moves[0]!.data, effect: 241, power: 0, accuracy: 0 }
    meFirst.opponent.pokemon.moves[0]!.data = { ...meFirst.opponent.pokemon.moves[0]!.data, effect: 0, power: 40, accuracy: 0 }
    const events = executeSimpleBattleTurn(meFirst, 0, catalog, createHgssLcrng(48))
    expect(events.filter((event) => event.kind === 'move' && event.side === 'player')).toHaveLength(2)
    expect(events).toContainEqual(expect.objectContaining({ kind: 'damage', side: 'opponent' }))
  })

  it('lit puissance et type de Don Naturel dans la baie ROM puis la rend recyclable', () => {
    const catalog = createPokemonTestCatalog()
    const player = mon(152, [33])
    player.heldItemId = 1
    const itemCatalog = {
      pocketNames: [], items: [undefined, {
        itemId: 1, fieldPocket: 4, naturalGiftPower: 70, naturalGiftType: 12,
        holdEffect: 0, holdEffectParameter: 0,
      }],
    } as unknown as HgssItemCatalog
    const session = createSimpleBattleSession({ kind: 'trainer', player, opponent: mon(155, [33]), catalog, itemCatalog })
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, effect: 222, power: 1, accuracy: 0 }
    session.opponent.pokemon.moves[0]!.data = { ...session.opponent.pokemon.moves[0]!.data, effect: 85, power: 0, accuracy: 0, range: 1 << 4 }

    const events = executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(49))

    expect(events).toContainEqual({ kind: 'condition', side: 'player', condition: 'naturalGiftConsumed', applied: true })
    expect(session.player.pokemon.heldItemId).toBe(0)
    expect(session.player.volatile.recyclableItemId).toBe(1)
  })

  it('conserve la mémoire de Recyclage après un retrait et un retour sur le terrain', () => {
    const catalog = createPokemonTestCatalog()
    const player = mon(152, [33])
    player.heldItemId = 1
    const itemCatalog = {
      pocketNames: [], items: [undefined, { itemId: 1, fieldPocket: 4, naturalGiftPower: 60, naturalGiftType: 12, holdEffect: 0, holdEffectParameter: 0 }],
    } as unknown as HgssItemCatalog
    const session = createSimpleBattleSession({ kind: 'trainer', player, opponent: mon(155, [33]), catalog, itemCatalog })
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, effect: 222, power: 1, accuracy: 0 }
    session.opponent.pokemon.moves[0]!.data = { ...session.opponent.pokemon.moves[0]!.data, effect: 85, power: 0, accuracy: 0, range: 1 << 4 }
    executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(51))
    const returning = clonePersistentSimpleBattlePokemon(session.player)
    switchSimpleBattlePokemon(session, 'player', mon(158, [33]), catalog)
    switchSimpleBattlePokemon(session, 'player', returning, catalog)
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, effect: 184, power: 0, accuracy: 0, range: 1 << 4 }

    expect(executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(52))).toContainEqual({ kind: 'condition', side: 'player', condition: 'recycle', applied: true })
    expect(session.player.pokemon.heldItemId).toBe(1)
  })

  it('transfère globalement l’objet adverse avec Implore sans dupliquer l’objet', () => {
    const catalog = createPokemonTestCatalog()
    const opponent = mon(155, [33])
    opponent.heldItemId = 1
    const session = createSimpleBattleSession({ kind: 'trainer', player: mon(152, [33]), opponent, catalog, itemCatalog: heldItemCatalog(0, 0) })
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, effect: 105, power: 40, accuracy: 0 }
    session.opponent.pokemon.moves[0]!.data = { ...session.opponent.pokemon.moves[0]!.data, effect: 85, power: 0, accuracy: 0, range: 1 << 4 }

    expect(executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(50))).toContainEqual({ kind: 'condition', side: 'player', condition: 'heldItemStolen', applied: true })
    expect([session.player.pokemon.heldItemId, session.opponent.pokemon.heldItemId]).toEqual([1, 0])

    const protectedTarget = mon(155, [33]); protectedTarget.heldItemId = 1; protectedTarget.abilityId = 60
    const protectedSession = createSimpleBattleSession({ kind: 'trainer', player: mon(152, [33]), opponent: protectedTarget, catalog, itemCatalog: heldItemCatalog(0, 0) })
    protectedSession.player.pokemon.moves[0]!.data = { ...protectedSession.player.pokemon.moves[0]!.data, effect: 105, power: 40, accuracy: 0 }
    protectedSession.opponent.pokemon.moves[0]!.data = { ...protectedSession.opponent.pokemon.moves[0]!.data, effect: 85, power: 0, accuracy: 0, range: 1 << 4 }
    executeSimpleBattleTurn(protectedSession, 0, catalog, createHgssLcrng(51))
    expect([protectedSession.player.pokemon.heldItemId, protectedSession.opponent.pokemon.heldItemId]).toEqual([0, 1])
  })

  it('garde Morphing strictement dans la copie de combat et restaure l’identité persistante', () => {
    const catalog = createPokemonTestCatalog()
    const player = mon(152, [33])
    const session = createSimpleBattleSession({ kind: 'trainer', player, opponent: mon(155, [45]), catalog })
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, effect: 57, power: 0, accuracy: 0, range: 1 << 4 }
    session.opponent.pokemon.moves[0]!.data = { ...session.opponent.pokemon.moves[0]!.data, effect: 85, power: 0, accuracy: 0, range: 1 << 4 }

    expect(executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(53))).toContainEqual({ kind: 'condition', side: 'player', condition: 'transform', applied: true })
    expect(session.player.pokemon.speciesId).toBe(155)
    expect(session.player.pokemon.moves[0]).toMatchObject({ moveId: 45, pp: 5, maxPp: 5 })
    expect(clonePersistentSimpleBattlePokemon(session.player)).toMatchObject({ speciesId: 152, abilityId: player.abilityId })
    expect(player.speciesId).toBe(152)
  })

  it('fait lire Assistance dans les capacités des autres membres de la session', () => {
    const catalog = createPokemonTestCatalog()
    const player = mon(152, [33])
    const ally = mon(158, [45])
    ally.moves[0]!.data = { ...ally.moves[0]!.data, effect: 0, power: 50, accuracy: 0 }
    const session = createSimpleBattleSession({
      kind: 'trainer', player, opponent: mon(155, [33]), catalog, playerParty: [player, ally],
    })
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, effect: 180, power: 0, accuracy: 0 }
    session.opponent.pokemon.moves[0]!.data = { ...session.opponent.pokemon.moves[0]!.data, effect: 85, power: 0, accuracy: 0, range: 1 << 4 }

    const events = executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(54))
    expect(events.filter((event) => event.kind === 'move' && event.side === 'player').map((event) => event.kind === 'move' ? event.moveId : 0)).toEqual([33, 45])
  })

  it('calcule Baston avec chaque membre valide de l’équipe et ignore les statuts', () => {
    const catalog = createPokemonTestCatalog()
    const player = mon(152, [33])
    const ally = mon(158, [45])
    const excluded = mon(155, [45])
    excluded.status = 0x10
    const session = createSimpleBattleSession({
      kind: 'trainer', player, opponent: mon(155, [33]), catalog, playerParty: [player, ally, excluded],
    })
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, effect: 154, power: 10, accuracy: 0 }
    session.opponent.pokemon.stats.hp = session.opponent.pokemon.currentHp = 500
    session.opponent.pokemon.moves[0]!.data = { ...session.opponent.pokemon.moves[0]!.data, effect: 85, power: 0, accuracy: 0, range: 1 << 4 }

    expect(executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(55))).toContainEqual({ kind: 'multiHit', hits: 2 })
  })

  it('force Cyclone vers une vraie réserve de la session et conserve le suivi actif', () => {
    const catalog = createPokemonTestCatalog()
    const active = mon(155, [33])
    const reserve = mon(158, [45])
    const session = createSimpleBattleSession({
      kind: 'trainer', player: mon(152, [33]), opponent: active, catalog, opponentParty: [active, reserve],
    })
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, effect: 28, power: 0, accuracy: 0 }
    session.opponent.pokemon.moves[0]!.data = { ...session.opponent.pokemon.moves[0]!.data, effect: 85, power: 0, accuracy: 0, range: 1 << 4 }

    const events = executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(56))

    expect(events).toContainEqual(expect.objectContaining({ kind: 'switched', side: 'opponent', reason: 'forced' }))
    expect(session.opponent.pokemon.speciesId).toBe(158)
  })

  it('transmet les changements de stats et le clone avec Relais', () => {
    const catalog = createPokemonTestCatalog()
    const player = mon(152, [33])
    const reserve = mon(158, [45])
    const session = createSimpleBattleSession({
      kind: 'trainer', player, opponent: mon(155, [33]), catalog, playerParty: [player, reserve],
    })
    session.player.stages.attack = 3
    session.player.volatile.substituteHp = 5
    session.player.volatile.cannotSwitch = true
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, effect: 127, power: 0, accuracy: 0, range: 1 << 4 }
    session.opponent.pokemon.moves[0]!.data = { ...session.opponent.pokemon.moves[0]!.data, effect: 85, power: 0, accuracy: 0, range: 1 << 4 }

    expect(executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(57))).toContainEqual({ kind: 'switchRequest', side: 'player', reason: 'batonPass' })
    switchSimpleBattlePokemon(session, 'player', reserve, catalog)
    expect(session.player.stages.attack).toBe(3)
    expect(session.player.volatile.substituteHp).toBe(5)
    expect(session.player.volatile.cannotSwitch).toBe(true)
  })

  it('demande un remplacement joueur après les dégâts de Demi-Tour', () => {
    const catalog = createPokemonTestCatalog()
    const player = mon(152, [33])
    const reserve = mon(158, [45])
    const session = createSimpleBattleSession({
      kind: 'trainer', player, opponent: mon(155, [33]), catalog, playerParty: [player, reserve],
    })
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, effect: 228, power: 70, accuracy: 0 }
    session.opponent.pokemon.moves[0]!.data = { ...session.opponent.pokemon.moves[0]!.data, effect: 85, power: 0, accuracy: 0, range: 1 << 4 }

    expect(executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(58))).toContainEqual({ kind: 'switchRequest', side: 'player', reason: 'pivot' })
  })

  it('fait frapper Poursuite sur le sortant avant le changement volontaire', () => {
    const catalog = createPokemonTestCatalog()
    const player = mon(152, [33])
    const reserve = mon(158, [45])
    const opponent = mon(155, [33])
    opponent.moves[0]!.data = { ...opponent.moves[0]!.data, effect: 128, power: 40, accuracy: 0 }
    const session = createSimpleBattleSession({ kind: 'trainer', player, opponent, catalog, playerParty: [player, reserve] })
    session.player.pokemon.stats.hp = session.player.pokemon.currentHp = 500

    const events = executeSimpleBattlePlayerSwitchTurn(session, reserve, catalog, createHgssLcrng(59))

    expect(events.findIndex((event) => event.kind === 'damage')).toBeLessThan(events.findIndex((event) => event.kind === 'switched'))
    expect(session.player.pokemon.speciesId).toBe(158)
    expect(session.parties.player.find((member) => member.speciesId === 152)!.currentHp).toBeLessThan(500)
  })

  it('fait recevoir une attaque ordinaire par l’entrant après le changement volontaire', () => {
    const catalog = createPokemonTestCatalog()
    const player = mon(152, [33])
    const reserve = mon(158, [45])
    const opponent = mon(155, [33])
    opponent.moves[0]!.data = { ...opponent.moves[0]!.data, effect: 0, power: 40, accuracy: 0 }
    const session = createSimpleBattleSession({ kind: 'trainer', player, opponent, catalog, playerParty: [player, reserve] })
    const outgoingHp = session.player.pokemon.currentHp
    session.player.screens.spikesLayers = 1

    const events = executeSimpleBattlePlayerSwitchTurn(session, reserve, catalog, createHgssLcrng(60))

    expect(events.findIndex((event) => event.kind === 'switched')).toBeLessThan(events.findIndex((event) => event.kind === 'damage'))
    expect(events.find((event) => event.kind === 'switched')?.pokemon.currentHp).toBe(reserve.currentHp)
    expect(events).toContainEqual(expect.objectContaining({ kind: 'entryHazard', hazard: 'spikes' }))
    expect(session.player.pokemon.speciesId).toBe(158)
    expect(session.player.pokemon.currentHp).toBeLessThan(session.player.pokemon.stats.hp)
    expect(session.parties.player.find((member) => member.speciesId === 152)!.currentHp).toBe(outgoingHp)
  })

  it('applique Médic Nature depuis le moteur à chaque retrait', () => {
    const catalog = createPokemonTestCatalog()
    const player = mon(152, [33])
    const reserve = mon(158, [45])
    player.abilityId = 30
    player.status = 0x10
    const session = createSimpleBattleSession({ kind: 'trainer', player, opponent: mon(155, [33]), catalog, playerParty: [player, reserve] })

    switchSimpleBattlePokemon(session, 'player', reserve, catalog)

    expect(session.parties.player.find((member) => member.speciesId === 152)!.status).toBe(0)
  })

  it('consomme avec Picore la baie ROM de la cible et applique son effet au lanceur', () => {
    const catalog = createPokemonTestCatalog()
    const player = mon(152, [33])
    const opponent = mon(155, [33])
    player.currentHp = 1
    opponent.currentHp = opponent.stats.hp = 500
    opponent.heldItemId = 1
    player.moves[0]!.data = { ...player.moves[0]!.data, effect: 224, power: 40, accuracy: 0 }
    opponent.moves[0]!.data = { ...opponent.moves[0]!.data, effect: 85, power: 0, accuracy: 0, range: 1 << 4 }
    const itemCatalog = {
      pocketNames: [], items: [undefined, {
        itemId: 1, name: 'BAIE ROM', fieldPocket: 4, pluckEffect: 7, holdEffectParameter: 10,
        holdEffect: 0, flingEffect: 7, flingPower: 10, naturalGiftPower: 60, naturalGiftType: 12,
      }],
    } as unknown as HgssItemCatalog
    const session = createSimpleBattleSession({ kind: 'trainer', player, opponent, catalog, itemCatalog })

    const events = executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(61))

    expect(session.opponent.pokemon.heldItemId).toBe(0)
    expect(session.player.pokemon.currentHp).toBe(11)
    expect(events).toContainEqual({ kind: 'condition', side: 'player', condition: 'berryPlucked', applied: true })
  })

  it('applique avec Dégommage la puissance et l’effet ROM avant de recycler l’objet', () => {
    const catalog = createPokemonTestCatalog()
    const player = mon(152, [33])
    const opponent = mon(155, [33])
    player.heldItemId = 1
    opponent.currentHp = opponent.stats.hp = 500
    player.moves[0]!.data = { ...player.moves[0]!.data, effect: 233, power: 1, accuracy: 0 }
    opponent.moves[0]!.data = { ...opponent.moves[0]!.data, effect: 85, power: 0, accuracy: 0, range: 1 << 4 }
    const itemCatalog = {
      pocketNames: [], items: [undefined, {
        itemId: 1, name: 'ORB ROM', fieldPocket: 0, pluckEffect: 0, holdEffectParameter: 0,
        holdEffect: 0, flingEffect: 29, flingPower: 30, naturalGiftPower: 0, naturalGiftType: 0,
      }],
    } as unknown as HgssItemCatalog
    const session = createSimpleBattleSession({ kind: 'trainer', player, opponent, catalog, itemCatalog })

    const events = executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(62))

    expect(session.player.pokemon.heldItemId).toBe(0)
    expect(session.opponent.pokemon.status & 0x80).toBe(0x80)
    expect(events).toContainEqual(expect.objectContaining({ kind: 'status', side: 'opponent', status: 'badPoison', applied: true }))
  })

  it('résout Force Cachée depuis la table de terrain extraite de la ROM', () => {
    const catalog = createPokemonTestCatalog()
    const create = (terrainId: number) => {
      const player = mon(152, [33])
      const opponent = mon(155, [33])
      player.moves[0]!.data = { ...player.moves[0]!.data, effect: 197, power: 70, accuracy: 0, effectChance: 100 }
      opponent.moves[0]!.data = { ...opponent.moves[0]!.data, effect: 85, power: 0, accuracy: 0, range: 1 << 4 }
      opponent.currentHp = opponent.stats.hp = 500
      return createSimpleBattleSession({ kind: 'trainer', player, opponent, catalog, initialTerrainId: terrainId })
    }
    const sand = create(0)
    const grass = create(2)

    executeSimpleBattleTurn(sand, 0, catalog, createHgssLcrng(63))
    executeSimpleBattleTurn(grass, 0, catalog, createHgssLcrng(64))

    expect(sand.opponent.stages.accuracy).toBe(-1)
    expect(grass.opponent.pokemon.status & 0x7).toBeGreaterThan(0)
  })

  it('conserve les pièces de Jackpot et le multiplicateur d’un porteur ayant participé', () => {
    const catalog = createPokemonTestCatalog()
    const player = mon(152, [33])
    const reserve = mon(158, [33])
    const opponent = mon(155, [33])
    player.moves[0]!.data = { ...player.moves[0]!.data, effect: 34, power: 40, accuracy: 0 }
    opponent.moves[0]!.data = { ...opponent.moves[0]!.data, effect: 85, power: 0, accuracy: 0, range: 1 << 4 }
    opponent.currentHp = opponent.stats.hp = 500
    player.heldItemId = 1
    const session = createSimpleBattleSession({
      kind: 'trainer', player, opponent, catalog, playerParty: [player, reserve], itemCatalog: heldItemCatalog(58, 10),
    })

    const events = executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(65))
    switchSimpleBattlePokemon(session, 'player', reserve, catalog)

    expect(session.payDayCoins).toBe(player.level * 5)
    expect(session.prizeMoneyMultiplier).toBe(2)
    expect(events).toContainEqual({ kind: 'condition', side: 'player', condition: 'payDay', applied: true })
    expect(classifySimpleBattleMoveSupport(player.moves[0]!.data)).toBe('implemented')
  })

  it('accumule les dégâts de Patience pendant deux tours avant de les doubler', () => {
    const catalog = createPokemonTestCatalog()
    const player = mon(152, [33])
    const opponent = mon(155, [33])
    player.currentHp = player.stats.hp = 500
    opponent.currentHp = opponent.stats.hp = 500
    player.moves[0]!.data = { ...player.moves[0]!.data, effect: 26, power: 1, accuracy: 0, priority: 1 }
    opponent.moves[0]!.data = { ...opponent.moves[0]!.data, power: 20, accuracy: 0 }
    const session = createSimpleBattleSession({ kind: 'trainer', player, opponent, catalog })

    executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(66))
    const firstDamage = session.player.volatile.bideDamage
    executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(67))
    const storedDamage = session.player.volatile.bideDamage
    const opponentHp = session.opponent.pokemon.currentHp
    executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(68))

    expect(firstDamage).toBeGreaterThan(0)
    expect(storedDamage).toBeGreaterThan(firstDamage)
    expect(session.opponent.pokemon.currentHp).toBe(opponentHp - storedDamage * 2)
    expect(session.player.volatile.bideDamage).toBe(0)
  })

  it('intercepte avec Reflet Magik et Saisie selon les drapeaux de capacités ROM', () => {
    const catalog = createPokemonTestCatalog()
    const reflected = createSimpleBattleSession({ kind: 'trainer', player: mon(152, [33]), opponent: mon(155, [33]), catalog })
    reflected.player.pokemon.moves[0]!.data = { ...reflected.player.pokemon.moves[0]!.data, effect: 183, power: 0, priority: 4, range: 1 << 4 }
    reflected.opponent.pokemon.moves[0]!.data = { ...reflected.opponent.pokemon.moves[0]!.data, effect: 18, power: 0, flags: 4, accuracy: 0 }
    const reflectedEvents = executeSimpleBattleTurn(reflected, 0, catalog, createHgssLcrng(69))

    const snatched = createSimpleBattleSession({ kind: 'trainer', player: mon(152, [33]), opponent: mon(155, [33]), catalog })
    snatched.player.pokemon.moves[0]!.data = { ...snatched.player.pokemon.moves[0]!.data, effect: 195, power: 0, priority: 4, range: 1 << 4 }
    snatched.opponent.pokemon.moves[0]!.data = { ...snatched.opponent.pokemon.moves[0]!.data, effect: 50, power: 0, flags: 8, range: 1 << 4, accuracy: 0 }
    const snatchedEvents = executeSimpleBattleTurn(snatched, 0, catalog, createHgssLcrng(70))

    expect(reflected.opponent.stages.attack).toBe(-1)
    expect(reflectedEvents).toContainEqual(expect.objectContaining({ kind: 'condition', condition: 'magicCoatReflected' }))
    expect(snatched.player.stages.attack).toBe(2)
    expect(snatchedEvents).toContainEqual(expect.objectContaining({ kind: 'condition', condition: 'moveSnatched' }))
  })

  it('retire de la sélection les capacités partagées bloquées par Possessif', () => {
    const catalog = createPokemonTestCatalog()
    const player = mon(152, [33, 45])
    const opponent = mon(155, [33])
    player.moves[0]!.data = { ...player.moves[0]!.data, effect: 192, power: 0, priority: 4, range: 1 << 4 }
    opponent.moves[0]!.data = { ...opponent.moves[0]!.data, effect: 85, power: 0, range: 1 << 4 }
    const session = createSimpleBattleSession({ kind: 'trainer', player, opponent, catalog })

    executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(71))

    expect(session.player.volatile.imprison).toBe(true)
    expect(getSelectableSimpleBattleMoveIndexes(session, 'opponent')).toEqual([])
  })

  it('résout Atout, Jugement, Stratopercut et Revenant dans le moteur commun', () => {
    const catalog = createPokemonTestCatalog()
    const contextual = (effect: number) => {
      const player = mon(152, [33])
      const opponent = mon(155, [33])
      player.moves[0]!.data = { ...player.moves[0]!.data, effect, power: effect === 272 ? 120 : 1, accuracy: 0 }
      opponent.moves[0]!.data = { ...opponent.moves[0]!.data, effect: 85, power: 0, range: 1 << 4, accuracy: 0 }
      opponent.currentHp = opponent.stats.hp = 1000
      return createSimpleBattleSession({ kind: 'trainer', player, opponent, catalog })
    }
    const trump = contextual(235)
    trump.player.pokemon.moves[0]!.pp = 1
    const trumpDamage = executeSimpleBattleTurn(trump, 0, catalog, createHgssLcrng(72)).find((event) => event.kind === 'damage')
    const judgment = contextual(268)
    judgment.player.pokemon.heldItemId = 275
    judgment.opponent.types = [10, 10]
    const judgmentDamage = executeSimpleBattleTurn(judgment, 0, catalog, createHgssLcrng(73)).find((event) => event.kind === 'damage')
    const uppercut = contextual(207)
    uppercut.opponent.volatile.semiInvulnerable = 'fly'
    const uppercutEvents = executeSimpleBattleTurn(uppercut, 0, catalog, createHgssLcrng(74))
    const shadow = contextual(272)
    shadow.player.pokemon.stats.speed = 999
    const shadowEvents = executeSimpleBattleTurn(shadow, 0, catalog, createHgssLcrng(75))

    expect(trumpDamage).toEqual(expect.objectContaining({ kind: 'damage', damage: expect.any(Number) }))
    expect(trumpDamage?.kind === 'damage' && trumpDamage.damage).toBeGreaterThan(20)
    expect(judgmentDamage).toEqual(expect.objectContaining({ typeMultiplier: 5 }))
    expect(uppercutEvents.some((event) => event.kind === 'damage' && event.damage > 0)).toBe(true)
    expect(shadow.player.volatile.semiInvulnerable).toBe('shadow')
    expect(shadowEvents).toContainEqual(expect.objectContaining({ kind: 'miss', side: 'opponent' }))
  })

  it('applique la confusion native de Babil uniquement à un Pijako non transformé', () => {
    const catalog = createPokemonTestCatalog(441)
    let confused = false
    for (let seed = 1; seed <= 100 && !confused; seed += 1) {
      const player = mon(441, [33])
      const opponent = mon(155, [33])
      player.moves[0]!.data = { ...player.moves[0]!.data, effect: 267, power: 60, accuracy: 0 }
      opponent.moves[0]!.data = { ...opponent.moves[0]!.data, effect: 85, power: 0, range: 1 << 4, accuracy: 0 }
      opponent.currentHp = opponent.stats.hp = 500
      const session = createSimpleBattleSession({ kind: 'trainer', player, opponent, catalog })
      confused = executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(seed)).some((event) => event.kind === 'confusion' && event.side === 'opponent')
    }
    expect(confused).toBe(true)
  })

  it('partage la copie de travail explicite avec le runtime sans dupliquer les réserves', () => {
    const catalog = createPokemonTestCatalog()
    const player = mon(152, [33])
    const reserve = mon(155, [33])
    reserve.currentHp = 0
    const playerParty = [player, reserve]
    const session = createSimpleBattleSession({
      kind: 'trainer',
      player,
      opponent: mon(158, [33]),
      catalog,
      playerParty,
      sharePartyState: true,
    })

    reserve.currentHp = 1

    expect(session.parties.player).toBe(playerParty)
    expect(session.parties.player[1]!.currentHp).toBe(1)
  })

  it('protège avec Garde Magik contre tous les dégâts volatils indirects', () => {
    const catalog = createPokemonTestCatalog()
    const session = createSimpleBattleSession({ kind: 'trainer', player: mon(152, [33]), opponent: mon(155, [33]), catalog })
    session.player.pokemon.abilityId = 98
    session.player.pokemon.status = 2
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, effect: 85, power: 0, accuracy: 0 }
    session.opponent.pokemon.moves[0]!.data = { ...session.opponent.pokemon.moves[0]!.data, effect: 85, power: 0, accuracy: 0 }
    Object.assign(session.player.volatile, { nightmare: true, cursed: true, trappedTurns: 2, seeded: true })
    const hp = session.player.pokemon.currentHp

    executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(76))

    expect(session.player.pokemon.currentHp).toBe(hp)
    expect(session.player.volatile.trappedTurns).toBe(1)
  })

  it('cumule Racines et Anneau Hydro avec le bonus de Grosse Racine', () => {
    const catalog = createPokemonTestCatalog()
    const player = mon(152, [33])
    player.heldItemId = 1
    const session = createSimpleBattleSession({ kind: 'trainer', player, opponent: mon(155, [33]), catalog, itemCatalog: heldItemCatalog(124, 30) })
    session.player.pokemon.stats.hp = 160
    session.player.pokemon.currentHp = 50
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, effect: 85, power: 0, accuracy: 0 }
    session.opponent.pokemon.moves[0]!.data = { ...session.opponent.pokemon.moves[0]!.data, effect: 85, power: 0, accuracy: 0 }
    session.player.volatile.aquaRing = true
    session.player.volatile.ingrain = true

    executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(77))

    expect(session.player.pokemon.currentHp).toBe(76)
  })

  it('émet les fins de conditions au lieu de les retirer silencieusement', () => {
    const catalog = createPokemonTestCatalog()
    const session = createSimpleBattleSession({ kind: 'trainer', player: mon(152, [33]), opponent: mon(155, [33]), catalog })
    session.player.pokemon.moves[0]!.data = { ...session.player.pokemon.moves[0]!.data, effect: 85, power: 0, accuracy: 0 }
    session.opponent.pokemon.moves[0]!.data = { ...session.opponent.pokemon.moves[0]!.data, effect: 85, power: 0, accuracy: 0 }
    session.player.volatile.disableTurns = 1
    session.player.volatile.disabledMoveId = 33
    session.player.screens.reflectTurns = 1
    session.field.gravityTurns = 1

    const events = executeSimpleBattleTurn(session, 0, catalog, createHgssLcrng(78))

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'condition', side: 'player', condition: 'disableEnded' }),
      expect.objectContaining({ kind: 'condition', side: 'player', condition: 'reflectEnded' }),
      expect.objectContaining({ kind: 'condition', side: 'player', condition: 'gravityEnded' }),
    ]))
  })
})
