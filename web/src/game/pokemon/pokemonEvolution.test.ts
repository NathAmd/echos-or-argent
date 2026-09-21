import { describe, expect, it } from 'vitest'
import { createCanonicalPokemon } from './canonicalPokemon'
import { createHgssLcrng } from './hgssPokemonRng'
import { deriveLegacyPokemonInstanceId } from './pokemonInstanceId'
import { createPokemonTestCatalog } from './pokemonTestCatalog'
import { PokemonTeamPolicyVetoError, type PokemonTeamPolicy } from './pokemonTeamPolicy'
import {
  createPokemonEvolutionIdentity,
  evolveCanonicalPokemon,
  evolveCanonicalPokemonPartyMember,
  resolveItemUseEvolution,
  resolveLevelUpEvolution,
  resolveShedinjaEvolution,
  resolveTradeEvolution,
} from './pokemonEvolution'
import {
  evolveCanonicalPokemonPartyMemberAfterTrade,
  evolveCanonicalPokemonPartyMemberByRuleTransaction,
  resolvePokemonEvolutionMutationDecision,
  resolveShedinjaCreationEligibility,
} from './pokemonEvolutionTransaction'

describe('evolution Pokemon au niveau HGSS', () => {
  it('resout la methode ROM de niveau et applique les donnees personnelles de la cible', () => {
    const catalog = createPokemonTestCatalog()
    catalog.evolutions[152] = [{ method: 4, parameter: 16, targetSpeciesId: 153 }]
    catalog.speciesNames[153] = 'MACRONIUM'
    catalog.personalData[153] = {
      ...catalog.personalData[153]!,
      baseStats: { ...catalog.personalData[153]!.baseStats, hp: 60 },
    }
    const pokemon = createCanonicalPokemon(catalog, {
      speciesId: 152, level: 16, rng: createHgssLcrng(1), personality: { kind: 'fixed', value: 1 }, individualValues: { kind: 'fixed', value: 0 },
      originalTrainer: { id: 1, name: 'J', gender: 'male' }, origin: { language: 3, gameVersion: 7, metLocation: 0, metLevel: 5, metTerrain: 0 }, ballId: 4,
    })
    const hpDeficit = 2
    pokemon.currentHp -= hpDeficit
    const evolution = resolveLevelUpEvolution(pokemon, catalog, { timeOfDay: 1 })
    expect(evolution?.targetSpeciesId).toBe(153)
    evolveCanonicalPokemon(pokemon, evolution!.targetSpeciesId, catalog)
    expect(pokemon.speciesName).toBe('MACRONIUM')
    expect(pokemon.stats.hp - pokemon.currentHp).toBe(hpDeficit)
  })

  it('remplace le membre du slot sans laisser une copie de l ancienne espece', () => {
    const catalog = createPokemonTestCatalog()
    catalog.evolutions[152] = [{ method: 4, parameter: 16, targetSpeciesId: 153 }]
    catalog.speciesNames[153] = 'MACRONIUM'
    const original = monForEvolution(catalog, 152, 16, 42)
    const party = [original]

    const result = evolveCanonicalPokemonPartyMember(
      party,
      0,
      createPokemonEvolutionIdentity(original),
      153,
      catalog,
    )

    expect(result.partySlot).toBe(0)
    expect(result.pokemon).toBe(party[0])
    expect(party[0]).not.toBe(original)
    expect(party[0]?.instanceId).toBe(original.instanceId)
    expect(party[0]?.speciesId).toBe(153)
    expect(original.speciesId).toBe(152)
  })

  it('reproduit CalcMonStats pour une baisse de PV max, un KO et Munja', () => {
    const catalog = createPokemonTestCatalog()
    while (catalog.personalData.length <= 292) catalog.personalData.push({ ...catalog.personalData[152]!, speciesId: catalog.personalData.length })
    while (catalog.speciesNames.length <= 292) catalog.speciesNames.push(`MON-${catalog.speciesNames.length}`)
    while (catalog.levelUpLearnsets.length <= 292) catalog.levelUpLearnsets.push([])
    const pokemon = monForEvolution(catalog, 152, 20, 1)
    pokemon.stats.hp = 100
    pokemon.currentHp = 50
    catalog.personalData[153] = { ...catalog.personalData[153]!, baseStats: { ...catalog.personalData[153]!.baseStats, hp: 1 } }
    evolveCanonicalPokemon(pokemon, 153, catalog)
    expect(pokemon.currentHp).toBe(Math.min(50, pokemon.stats.hp))

    const knockedOut = monForEvolution(catalog, 152, 20, 2)
    knockedOut.currentHp = 0
    evolveCanonicalPokemon(knockedOut, 153, catalog)
    expect(knockedOut.currentHp).toBe(0)

    const shedinja = monForEvolution(catalog, 152, 20, 3)
    evolveCanonicalPokemon(shedinja, 292, catalog)
    expect(shedinja.stats.hp).toBe(1)
    expect(shedinja.currentHp).toBe(1)
  })

  it('preserve la forme stockee comme SetMonData dans la ROM', () => {
    const catalog = createPokemonTestCatalog()
    const pokemon = monForEvolution(catalog, 152, 20, 1)
    pokemon.form = 2
    evolveCanonicalPokemon(pokemon, 153, catalog)
    expect(pokemon.form).toBe(2)
  })

  it('utilise les 16 bits hauts de la personnalité pour la branche Wurmple', () => {
    const catalog = createPokemonTestCatalog()
    catalog.evolutions[152] = [
      { method: 11, parameter: 6, targetSpeciesId: 153 },
      { method: 12, parameter: 6, targetSpeciesId: 154 },
    ]
    const pokemon = createCanonicalPokemon(catalog, {
      speciesId: 152, level: 6, rng: createHgssLcrng(1), personality: { kind: 'fixed', value: 0x00010000 }, individualValues: { kind: 'fixed', value: 0 },
      originalTrainer: { id: 1, name: 'J', gender: 'male' }, origin: { language: 3, gameVersion: 7, metLocation: 0, metLevel: 5, metTerrain: 0 }, ballId: 4,
    })

    expect(resolveLevelUpEvolution(pokemon, catalog, { timeOfDay: 1 })?.targetSpeciesId).toBe(153)
  })

  it('respecte la Pierre Stase et les espèces requises dans l’équipe', () => {
    const catalog = createPokemonTestCatalog()
    catalog.evolutions[152] = [{ method: 21, parameter: 155, targetSpeciesId: 153 }]
    const pokemon = monForEvolution(catalog, 152, 20, 1)
    const partner = monForEvolution(catalog, 155, 5, 2)
    pokemon.heldItemId = 1
    const itemCatalog = { items: [undefined, { holdEffect: 64 }], pocketNames: [] } as unknown as Parameters<typeof resolveLevelUpEvolution>[2]['itemCatalog']

    expect(resolveLevelUpEvolution(pokemon, catalog, { timeOfDay: 1, party: [pokemon, partner], itemCatalog })).toBeUndefined()
    pokemon.heldItemId = 0
    expect(resolveLevelUpEvolution(pokemon, catalog, { timeOfDay: 1, party: [pokemon, partner], itemCatalog })?.targetSpeciesId).toBe(153)
  })

  it('résout exactement les pierres ROM, y compris les variantes selon le sexe', () => {
    const catalog = createPokemonTestCatalog()
    catalog.evolutions[152] = [
      { method: 7, parameter: 80, targetSpeciesId: 153 },
      { method: 16, parameter: 81, targetSpeciesId: 154 },
      { method: 17, parameter: 82, targetSpeciesId: 155 },
    ]
    const pokemon = monForEvolution(catalog, 152, 20, 1)
    pokemon.gender = 'male'

    expect(resolveItemUseEvolution(pokemon, catalog, 80)?.targetSpeciesId).toBe(153)
    expect(resolveItemUseEvolution(pokemon, catalog, 81)?.targetSpeciesId).toBe(154)
    expect(resolveItemUseEvolution(pokemon, catalog, 82)).toBeUndefined()
    pokemon.gender = 'female'
    expect(resolveItemUseEvolution(pokemon, catalog, 81)).toBeUndefined()
    expect(resolveItemUseEvolution(pokemon, catalog, 82)?.targetSpeciesId).toBe(155)
  })

  it('résout la Beauté de Barpau depuis les valeurs de concours canoniques', () => {
    const catalog = createPokemonTestCatalog()
    catalog.evolutions[152] = [{ method: 15, parameter: 170, targetSpeciesId: 153 }]
    const pokemon = monForEvolution(catalog, 152, 20, 1)
    pokemon.contestValues = [0, 169, 0, 0, 0, 0]

    expect(resolveLevelUpEvolution(pokemon, catalog, { timeOfDay: 1 })).toBeUndefined()
    pokemon.contestValues[1] = 170
    expect(resolveLevelUpEvolution(pokemon, catalog, { timeOfDay: 1 })?.targetSpeciesId).toBe(153)
  })

  it('recalcule le sexe et apprend les capacités propres à la cible au niveau courant', () => {
    const catalog = createPokemonTestCatalog()
    catalog.personalData[152] = { ...catalog.personalData[152]!, genderRatio: 191 }
    catalog.personalData[153] = { ...catalog.personalData[153]!, genderRatio: 127 }
    catalog.levelUpLearnsets[153] = [{ level: 20, moveId: 44 }]
    catalog.evolutions[152] = [{ method: 4, parameter: 20, targetSpeciesId: 153 }]
    const pokemon = monForEvolution(catalog, 152, 20, 150)
    expect(pokemon.gender).toBe('female')

    const result = evolveCanonicalPokemon(pokemon, 153, catalog)

    expect(pokemon.gender).toBe('male')
    expect(result.learnedMoveIds).toEqual([44])
    expect(result.skippedMoveIds).toEqual([])
    expect(pokemon.moves.at(-1)).toMatchObject({ moveId: 44, ppUps: 0 })
    expect(pokemon.moves.at(-1)?.pp).toBe(pokemon.moves.at(-1)?.maxPp)
  })

  it("consomme l'objet tenu des méthodes 18/19 uniquement au succès", () => {
    const catalog = createPokemonTestCatalog()
    for (const method of [18, 19]) {
      const rule = { method, parameter: 110, targetSpeciesId: 153 }
      catalog.evolutions[152] = [rule]
      const pokemon = monForEvolution(catalog, 152, 20, method)
      pokemon.heldItemId = 110

      const result = evolveCanonicalPokemon(pokemon, 153, catalog)

      expect(result.consumedHeldItemId).toBe(110)
      expect(pokemon.heldItemId).toBe(0)
    }
  })

  it("retourne le move propre à l'espèce évoluée quand les quatre slots sont occupés", () => {
    const catalog = createPokemonTestCatalog()
    catalog.levelUpLearnsets[153] = [{ level: 20, moveId: 44 }]
    catalog.evolutions[152] = [{ method: 4, parameter: 20, targetSpeciesId: 153 }]
    const pokemon = monForEvolution(catalog, 152, 20, 1)
    pokemon.moves = [10, 33, 43, 45].map((moveId) => {
      const data = catalog.moves[moveId]!
      return { moveId, pp: data.pp, maxPp: data.pp, ppUps: 0, data }
    })

    const result = evolveCanonicalPokemon(pokemon, 153, catalog)

    expect(result).toMatchObject({ learnedMoveIds: [], skippedMoveIds: [44] })
    expect(pokemon.moves.map((move) => move.moveId)).toEqual([10, 33, 43, 45])
  })

  it("rend la transaction idempotente quand une ancienne entrée d'évolution est rejouée", () => {
    const catalog = createPokemonTestCatalog()
    catalog.evolutions[152] = [{ method: 4, parameter: 16, targetSpeciesId: 153 }]
    const original = monForEvolution(catalog, 152, 16, 42)
    const identity = createPokemonEvolutionIdentity(original)
    const party = [original]

    const first = evolveCanonicalPokemonPartyMember(party, 0, identity, 153, catalog)
    const duplicate = evolveCanonicalPokemonPartyMember(party, 0, identity, 153, catalog)

    expect(first.alreadyApplied).toBe(false)
    expect(duplicate.alreadyApplied).toBe(true)
    expect(duplicate.pokemon).toBe(party[0])
    expect(party[0]?.speciesId).toBe(153)
  })

  it("cible l'instance exacte quand deux Pokemon partagent personnalité, espèce et dresseur", () => {
    const catalog = createPokemonTestCatalog()
    catalog.evolutions[152] = [{ method: 4, parameter: 16, targetSpeciesId: 153 }]
    const expected = monForEvolution(catalog, 152, 16, 42, 'expected')
    const lookalike = monForEvolution(catalog, 152, 16, 42, 'lookalike')
    const identity = createPokemonEvolutionIdentity(expected)
    const party = [lookalike, expected]

    const result = evolveCanonicalPokemonPartyMember(party, 0, identity, 153, catalog)

    expect(result.partySlot).toBe(1)
    expect(result.pokemon.instanceId).toBe(expected.instanceId)
    expect(party[0]).toBe(lookalike)
    expect(party[0]?.speciesId).toBe(152)
    expect(party[1]?.speciesId).toBe(153)
  })

  it("résout et applique transactionnellement les méthodes d'échange 5/6", () => {
    const catalog = createPokemonTestCatalog()
    catalog.evolutions[152] = [
      { method: 5, parameter: 0, targetSpeciesId: 153 },
      { method: 6, parameter: 99, targetSpeciesId: 154 },
    ]
    const ordinary = monForEvolution(catalog, 152, 20, 1)
    expect(resolveTradeEvolution(ordinary, catalog)?.method).toBe(5)

    const held = monForEvolution(catalog, 152, 20, 2)
    held.heldItemId = 99
    // Une espèce ROM n'a normalement pas les deux méthodes ; on isole ici la 6.
    catalog.evolutions[152] = [{ method: 6, parameter: 99, targetSpeciesId: 154 }]
    const party = [held]
    const identity = createPokemonEvolutionIdentity(held)
    const result = evolveCanonicalPokemonPartyMemberAfterTrade(
      party,
      0,
      identity,
      catalog,
    )

    expect(result?.primary.rule?.method).toBe(6)
    expect(result?.primary.consumedHeldItemId).toBe(99)
    expect(party[0]).toMatchObject({ speciesId: 154, heldItemId: 0 })
    expect(evolveCanonicalPokemonPartyMemberAfterTrade(party, 0, identity, catalog)?.primary.alreadyApplied).toBe(true)
  })

  it('respecte la Pierre Stase dans le résolveur d’échange', () => {
    const catalog = createPokemonTestCatalog()
    catalog.evolutions[152] = [{ method: 5, parameter: 0, targetSpeciesId: 153 }]
    const pokemon = monForEvolution(catalog, 152, 20, 1)
    pokemon.heldItemId = 1
    const itemCatalog = { items: [undefined, { holdEffect: 64 }], pocketNames: [] } as unknown as NonNullable<Parameters<typeof resolveTradeEvolution>[2]>['itemCatalog']

    expect(resolveTradeEvolution(pokemon, catalog, { itemCatalog })).toBeUndefined()

    catalog.evolutions[64] = [{ method: 5, parameter: 0, targetSpeciesId: 65 }]
    const kadabra = monForEvolution(catalog, 64, 20, 2)
    kadabra.heldItemId = 1
    expect(resolveTradeEvolution(kadabra, catalog, { itemCatalog })?.targetSpeciesId).toBe(65)
  })

  it('laisse inactives les méthodes de lieu héritées de Sinnoh dans HGSS', () => {
    const catalog = createPokemonTestCatalog()
    catalog.evolutions[152] = [24, 25, 26].map((method) => ({ method, parameter: 0, targetSpeciesId: 153 }))
    const pokemon = monForEvolution(catalog, 152, 20, 1)

    expect(resolveLevelUpEvolution(pokemon, catalog, { timeOfDay: 1 })).toBeUndefined()
  })

  it('crée Munja avec une place et une Poké Ball sans dupliquer objet ni courrier', () => {
    const catalog = createPokemonTestCatalog(292)
    const primaryRule = { method: 13, parameter: 20, targetSpeciesId: 291 }
    const shedinjaRule = { method: 14, parameter: 20, targetSpeciesId: 292 }
    catalog.evolutions[290] = [primaryRule, shedinjaRule]
    const nincada = monForEvolution(catalog, 290, 20, 42)
    nincada.heldItemId = 99
    nincada.mailIdentity = 'kenya'
    nincada.nickname = 'NIN'
    nincada.nicknameSource = 'user-text'
    nincada.status = 0x40
    nincada.shinyLeafMask = 0b11111
    nincada.ribbonIds = [1, 2]
    catalog.levelUpLearnsets[291] = [{ level: 20, moveId: 44 }]
    catalog.levelUpLearnsets[292] = [{ level: 20, moveId: 45 }]
    const party = [nincada]
    const inventory = new Map([[4, 2]])
    const context = { inventory }

    expect(resolveShedinjaEvolution(nincada, catalog)).toEqual(shedinjaRule)
    expect(resolveShedinjaCreationEligibility(nincada, catalog, party, context).kind).toBe('eligible')
    const result = evolveCanonicalPokemonPartyMemberByRuleTransaction(
      party,
      0,
      createPokemonEvolutionIdentity(nincada),
      primaryRule,
      catalog,
      context,
    )

    expect(result.primary.pokemon.speciesId).toBe(291)
    expect(result.primary.pokemon.instanceId).toBe(nincada.instanceId)
    expect(result.shedinja?.pokemon.instanceId).not.toBe(nincada.instanceId)
    expect(result.shedinja?.pokemon).toMatchObject({
      speciesId: 292,
      heldItemId: 0,
      ballId: 4,
      nickname: undefined,
      nicknameSource: undefined,
      mailIdentity: undefined,
      currentHp: 1,
      status: 0,
      shinyLeafMask: 0,
      ribbonIds: [],
    })
    expect(result.shedinja?.pokemon.moves.some((move) => move.moveId === 44)).toBe(true)
    expect(result.shedinja?.pokemon.moves.some((move) => move.moveId === 45)).toBe(false)
    expect(party).toHaveLength(2)
    expect(inventory.get(4)).toBe(1)

    const duplicate = evolveCanonicalPokemonPartyMemberByRuleTransaction(
      party,
      0,
      createPokemonEvolutionIdentity(nincada),
      primaryRule,
      catalog,
      context,
    )
    expect(duplicate.primary.alreadyApplied).toBe(true)
    expect(duplicate.shedinja).toBeUndefined()
    expect(party).toHaveLength(2)
    expect(inventory.get(4)).toBe(1)
  })

  it('traite la méthode Munja comme le marqueur secondaire natif, sans seuil autonome', () => {
    const catalog = createPokemonTestCatalog(292)
    const pokemon = monForEvolution(catalog, 290, 20, 1)
    const rule = { method: 14, parameter: 99, targetSpeciesId: 292 }
    catalog.evolutions[290] = [rule]

    expect(resolveShedinjaEvolution(pokemon, catalog)).toEqual(rule)
  })

  it('préflight la création de Munja avant de consommer la Poké Ball', () => {
    const catalog = createPokemonTestCatalog(292)
    const primaryRule = { method: 13, parameter: 20, targetSpeciesId: 291 }
    catalog.evolutions[290] = [primaryRule, { method: 14, parameter: 20, targetSpeciesId: 292 }]
    const nincada = monForEvolution(catalog, 290, 20, 43)
    const party = [nincada]
    const inventory = new Map([[4, 1]])

    const result = evolveCanonicalPokemonPartyMemberByRuleTransaction(
      party,
      0,
      createPokemonEvolutionIdentity(nincada),
      primaryRule,
      catalog,
      {
        inventory,
        teamPolicy: {
          vetoBattleEligibility: () => undefined,
          vetoPartyMutation: (intent) => intent.reason === 'shedinja'
            ? { code: 'shedinja-locked', reason: 'Munja est désactivé.' }
            : undefined,
        },
      },
    )

    expect(result.primary.pokemon.speciesId).toBe(291)
    expect(result.shedinja).toBeUndefined()
    expect(result.shedinjaBlocked).toEqual({ code: 'shedinja-locked', reason: 'Munja est désactivé.' })
    expect(party).toHaveLength(1)
    expect(inventory.get(4)).toBe(1)
  })

  it('préflight aussi l’évolution principale avant toute mutation', () => {
    const catalog = createPokemonTestCatalog(153)
    const primaryRule = { method: 4, parameter: 16, targetSpeciesId: 153 }
    const source = monForEvolution(catalog, 152, 16, 44)
    const party = [source]
    const before = structuredClone(party)

    const teamPolicy: PokemonTeamPolicy = {
      vetoBattleEligibility: () => undefined,
      vetoPartyMutation: (intent) => intent.reason === 'evolution'
        ? { code: 'evolution-locked', reason: 'Cette évolution est verrouillée.' }
        : undefined,
    }
    expect(resolvePokemonEvolutionMutationDecision(
      party, 0, createPokemonEvolutionIdentity(source), primaryRule, catalog, teamPolicy,
    )).toEqual({ kind: 'blocked', code: 'evolution-locked', reason: 'Cette évolution est verrouillée.' })
    expect(party).toEqual(before)
    expect(() => evolveCanonicalPokemonPartyMemberByRuleTransaction(
      party,
      0,
      createPokemonEvolutionIdentity(source),
      primaryRule,
      catalog,
      {
        inventory: new Map(),
        teamPolicy,
      },
    )).toThrow(PokemonTeamPolicyVetoError)
    expect(party).toEqual(before)
  })
})

function monForEvolution(
  catalog: ReturnType<typeof createPokemonTestCatalog>,
  speciesId: number,
  level: number,
  personality: number,
  instancePath?: string,
) {
  return createCanonicalPokemon(catalog, {
    ...(instancePath ? { instanceId: deriveLegacyPokemonInstanceId('pokemon-evolution-test', instancePath) } : {}),
    speciesId, level, rng: createHgssLcrng(personality), personality: { kind: 'fixed', value: personality }, individualValues: { kind: 'fixed', value: 0 },
    originalTrainer: { id: 1, name: 'J', gender: 'male' }, origin: { language: 3, gameVersion: 7, metLocation: 0, metLevel: level, metTerrain: 0 }, ballId: 4,
  })
}
