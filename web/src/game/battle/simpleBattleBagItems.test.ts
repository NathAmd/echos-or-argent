import { describe, expect, it } from 'vitest'
import type { HgssItemCatalog, HgssItemData, HgssItemPartyParameters } from '../../rom/items/itemData'
import { createCanonicalPokemon, cloneCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import type { PokemonPartyHealingPolicy } from '../pokemon/pokemonPartyHealingPolicy'
import {
  applySimpleBattleEscapeItem,
  applySimpleBattlePartyItem,
  applySimpleBattleStatItem,
  type SimpleBattleStatItemSource,
  type SimpleBattleStatItemState,
} from './simpleBattleBagItems'
import { createSimpleBattleSession } from './simpleBattleSession'

const neutralParameters = {
  guardSpec: false,
  attackStages: 0,
  defenseStages: 0,
  specialAttackStages: 0,
  specialDefenseStages: 0,
  speedStages: 0,
  accuracyStages: 0,
  criticalRateStages: 0,
} as const

function item(parameters: Partial<SimpleBattleStatItemSource['partyParameters']>): SimpleBattleStatItemSource {
  return {
    itemId: 57,
    name: 'ATTAQUE +',
    partyParameters: { ...neutralParameters, ...parameters },
  }
}

function state(): SimpleBattleStatItemState & { turn: number } {
  return {
    turn: 7,
    player: {
      stages: {
        attack: 0,
        defense: 0,
        specialAttack: 0,
        specialDefense: 0,
        speed: 0,
        accuracy: 0,
      },
      screens: { mistTurns: 0 },
      volatile: { focusEnergy: false },
    },
  }
}

const neutralPartyParameters = {
  sleepHeal: false, poisonHeal: false, burnHeal: false, freezeHeal: false, paralysisHeal: false,
  confusionHeal: false, infatuationHeal: false, guardSpec: false, revive: false, reviveAll: false,
  levelUp: false, evolve: false, attackStages: 0, defenseStages: 0, specialAttackStages: 0,
  specialDefenseStages: 0, speedStages: 0, accuracyStages: 0, criticalRateStages: 0,
  ppUp: false, ppMax: false, ppRestore: false, ppRestoreAll: false, hpRestore: false,
  hpEvUp: false, attackEvUp: false, defenseEvUp: false, speedEvUp: false, specialAttackEvUp: false,
  specialDefenseEvUp: false, friendshipLow: false, friendshipMedium: false, friendshipHigh: false,
  hpEvParameter: 0, attackEvParameter: 0, defenseEvParameter: 0, speedEvParameter: 0,
  specialAttackEvParameter: 0, specialDefenseEvParameter: 0, hpRestoreParameter: 0,
  ppRestoreParameter: 0, friendshipLowParameter: 0, friendshipMediumParameter: 0,
  friendshipHighParameter: 0,
} as const satisfies HgssItemPartyParameters

function partyItem(parameters: Partial<HgssItemPartyParameters>, options: { itemId?: number, battleUseFunction?: number } = {}): HgssItemData {
  return {
    itemId: options.itemId ?? 17,
    name: 'POTION',
    partyUse: 1,
    battleUseFunction: options.battleUseFunction ?? 0,
    partyParameters: { ...neutralPartyParameters, ...parameters },
  } as HgssItemData
}

function pokemon(speciesId: number) {
  const catalog = createPokemonTestCatalog(Math.max(158, speciesId))
  return createCanonicalPokemon(catalog, {
    speciesId,
    level: 5,
    rng: createHgssLcrng(speciesId),
    personality: { kind: 'fixed', value: speciesId },
    individualValues: { kind: 'fixed', value: 0 },
    originalTrainer: { id: 1, name: 'JO', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 1, metLevel: 5, metTerrain: 0 },
    ballId: 4,
    moveIds: [33],
  })
}

function itemCatalogWith(item: HgssItemData): HgssItemCatalog {
  const items: HgssItemData[] = []
  items[item.itemId] = item
  return { items, pocketNames: [] }
}

describe('simple battle bag stat items', () => {
  it('applies only non-capped stages and consumes one item', () => {
    const battle = state()
    battle.player.stages.attack = 6
    battle.player.stages.defense = 4
    const inventory = new Map([[57, 2]])

    expect(applySimpleBattleStatItem(battle, inventory, item({ attackStages: 2, defenseStages: 1 }))).toEqual({ kind: 'used' })
    expect(battle.player.stages).toMatchObject({ attack: 6, defense: 5 })
    expect(inventory.get(57)).toBe(1)
    expect(battle.turn).toBe(7)
  })

  it('activates Mist and the critical-rate focus state', () => {
    const battle = state()
    const inventory = new Map([[57, 1]])

    expect(applySimpleBattleStatItem(battle, inventory, item({ guardSpec: true, criticalRateStages: 1 }))).toEqual({ kind: 'used' })
    expect(battle.player.screens.mistTurns).toBe(5)
    expect(battle.player.volatile.focusEnergy).toBe(true)
    expect(inventory.has(57)).toBe(false)
  })

  it('does not consume an item when every requested effect is already active', () => {
    const battle = state()
    battle.player.stages.attack = 6
    battle.player.screens.mistTurns = 3
    battle.player.volatile.focusEnergy = true
    const inventory = new Map([[57, 1]])

    expect(applySimpleBattleStatItem(battle, inventory, item({ attackStages: 1, guardSpec: true, criticalRateStages: 1 }))).toEqual({
      kind: 'no-effect',
      reason: 'ATTAQUE + n’aurait aucun effet.',
    })
    expect(inventory.get(57)).toBe(1)
  })

  it('rejects an item without a battle-stat effect', () => {
    const battle = state()
    const inventory = new Map([[57, 1]])

    expect(applySimpleBattleStatItem(battle, inventory, item({}))).toEqual({ kind: 'not-stat-item' })
    expect(battle).toEqual(state())
    expect(inventory.get(57)).toBe(1)
  })

  it('preserves the historical mutation order when the item disappeared', () => {
    const battle = state()

    expect(() => applySimpleBattleStatItem(battle, new Map(), item({ attackStages: 1 })))
      .toThrow('ATTAQUE + a disparu du Sac avant son utilisation.')
    expect(battle.player.stages.attack).toBe(1)
  })
})

describe('simple battle party bag items', () => {
  it('requests a move before applying a PP item', () => {
    const catalog = createPokemonTestCatalog()
    const active = pokemon(152)
    const ether = partyItem({ ppRestore: true, ppRestoreParameter: 10 }, { itemId: 40 })
    const inventory = new Map([[ether.itemId, 1]])

    expect(applySimpleBattlePartyItem({
      state: { player: { pokemon: cloneCanonicalPokemon(active) } },
      inventory,
      item: ether,
      playerParty: [active],
      activePartyIndex: 0,
      targetPartyIndex: 0,
      pokemonCatalog: catalog,
      itemCatalog: itemCatalogWith(ether),
    })).toMatchObject({ kind: 'move-required', target: active, restoreOnly: true })
    expect(inventory.get(ether.itemId)).toBe(1)
  })

  it('heals and synchronizes the active Pokemon transactionally', () => {
    const catalog = createPokemonTestCatalog()
    const active = pokemon(152)
    active.currentHp -= 10
    const sessionState = { player: { pokemon: cloneCanonicalPokemon(active) } }
    const potion = partyItem({ hpRestore: true, hpRestoreParameter: 20 })
    const inventory = new Map([[potion.itemId, 1]])

    expect(applySimpleBattlePartyItem({
      state: sessionState,
      inventory,
      item: potion,
      playerParty: [active],
      activePartyIndex: 0,
      targetPartyIndex: 0,
      pokemonCatalog: catalog,
      itemCatalog: itemCatalogWith(potion),
      currentLocationId: 1,
    })).toMatchObject({ kind: 'used', activeTarget: true, hpGained: 10, statusChanged: false })
    expect(sessionState.player.pokemon.currentHp).toBe(active.currentHp)
    expect(inventory.has(potion.itemId)).toBe(false)
  })

  it('heals a reserve without replacing the active battle Pokemon', () => {
    const catalog = createPokemonTestCatalog()
    const active = pokemon(152)
    const reserve = pokemon(155)
    reserve.currentHp -= 5
    const battlePokemon = cloneCanonicalPokemon(active)
    const sessionState = { player: { pokemon: battlePokemon } }
    const potion = partyItem({ hpRestore: true, hpRestoreParameter: 20 })

    expect(applySimpleBattlePartyItem({
      state: sessionState,
      inventory: new Map([[potion.itemId, 1]]),
      item: potion,
      playerParty: [active, reserve],
      activePartyIndex: 0,
      targetPartyIndex: 1,
      pokemonCatalog: catalog,
      itemCatalog: itemCatalogWith(potion),
    })).toMatchObject({ kind: 'used', activeTarget: false, hpGained: 5 })
    expect(sessionState.player.pokemon).toBe(battlePokemon)
  })

  it('refuse une réanimation de combat sans muter la cible ni consommer l’objet', () => {
    const catalog = createPokemonTestCatalog()
    const active = pokemon(152)
    active.currentHp = 0
    const before = cloneCanonicalPokemon(active)
    const revive = partyItem({ revive: true, hpRestore: true, hpRestoreParameter: 0xfe }, { itemId: 28 })
    const inventory = new Map([[revive.itemId, 1]])
    const contexts: unknown[] = []
    const healingPolicy: PokemonPartyHealingPolicy = {
      vetoFullHealRestoration: (context) => {
        contexts.push(context)
        return context.restoration === 'hp'
          ? { code: 'challenge.permanent-knockout', reason: 'Réanimation interdite en combat.' }
          : undefined
      },
    }

    expect(applySimpleBattlePartyItem({
      state: { player: { pokemon: cloneCanonicalPokemon(active) } },
      inventory,
      item: revive,
      playerParty: [active],
      activePartyIndex: 0,
      targetPartyIndex: 0,
      pokemonCatalog: catalog,
      itemCatalog: itemCatalogWith(revive),
      healingPolicy,
    })).toEqual({ kind: 'rejected', reason: 'Réanimation interdite en combat.' })
    expect(active).toEqual(before)
    expect(inventory.get(revive.itemId)).toBe(1)
    expect(contexts).toEqual([expect.objectContaining({ partyIndex: 0, restoration: 'hp', source: 'battle-item' })])
  })

  it('rejects a useless item without consuming it', () => {
    const catalog = createPokemonTestCatalog()
    const active = pokemon(152)
    const potion = partyItem({ hpRestore: true, hpRestoreParameter: 20 })
    const inventory = new Map([[potion.itemId, 1]])

    expect(applySimpleBattlePartyItem({
      state: { player: { pokemon: cloneCanonicalPokemon(active) } },
      inventory,
      item: potion,
      playerParty: [active],
      activePartyIndex: 0,
      targetPartyIndex: 0,
      pokemonCatalog: catalog,
      itemCatalog: itemCatalogWith(potion),
    })).toEqual({ kind: 'rejected', reason: 'Cet objet n’aurait aucun effet.' })
    expect(inventory.get(potion.itemId)).toBe(1)
  })
})

describe('simple battle escape bag items', () => {
  it('blocks a trainer escape without consuming the item', () => {
    const catalog = createPokemonTestCatalog()
    const escapeItem = partyItem({}, { itemId: 80, battleUseFunction: 3 })
    const session = createSimpleBattleSession({ kind: 'trainer', player: pokemon(152), opponent: pokemon(155), catalog })
    const inventory = new Map([[escapeItem.itemId, 1]])

    expect(applySimpleBattleEscapeItem(session, inventory, escapeItem)).toEqual({
      kind: 'trainer-blocked',
      events: [{ kind: 'cannotRunTrainer' }],
    })
    expect(inventory.get(escapeItem.itemId)).toBe(1)
    expect(session.phase).toBe('command')
  })

  it('consumes the item and ends a wild battle without RNG', () => {
    const catalog = createPokemonTestCatalog()
    const escapeItem = partyItem({}, { itemId: 80, battleUseFunction: 3 })
    const session = createSimpleBattleSession({ kind: 'wild', player: pokemon(152), opponent: pokemon(155), catalog })
    const inventory = new Map([[escapeItem.itemId, 1]])

    expect(applySimpleBattleEscapeItem(session, inventory, escapeItem)).toEqual({
      kind: 'used',
      events: [{ kind: 'escaped' }, { kind: 'result', result: 'escaped' }],
    })
    expect(inventory.has(escapeItem.itemId)).toBe(false)
    expect(session).toMatchObject({ phase: 'ended', result: 'escaped' })
  })
})
