import { describe, expect, it } from 'vitest'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { createPokemonParty } from '../pokemon/pokemonParty'
import { basePokemonPartyHealingPolicy } from '../pokemon/pokemonPartyHealingPolicy'
import type { PokemonLevelPolicy } from '../pokemon/pokemonLevelPolicy'
import { basePokemonTeamPolicy, PokemonTeamPolicyVetoError, type PokemonTeamPolicy } from '../pokemon/pokemonTeamPolicy'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import {
  cloneHgssDaycareState,
  createHgssDaycareState,
  advanceHgssDaycareStep,
  giveHgssDaycareEgg,
  getHgssDaycareCompatibilityChance,
  getHgssDaycareCompatibilityMessageIndex,
  getHgssDaycareSaveState,
  getHgssDaycareLevelGrowth,
  getHgssDaycareUpdatedLevel,
  getHgssDaycareWithdrawCost,
  putPokemonInHgssDaycare,
  retrievePokemonFromHgssDaycare,
} from './hgssDaycare'

function createPokemon(speciesId = 152, trainerId = 1) {
  const catalog = createPokemonTestCatalog()
  return createCanonicalPokemon(catalog, {
    speciesId,
    level: 5,
    rng: createHgssLcrng(speciesId + trainerId),
    personality: { kind: 'random' },
    individualValues: { kind: 'fixed', value: 12 },
    originalTrainer: { id: trainerId, name: `OT${trainerId}`, gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 126, metLevel: 5, metTerrain: 12 },
    ballId: 4,
  })
}

describe('HGSS daycare', () => {
  it('dépose, compacte et restitue le Pokémon avec l’expérience et les capacités natives', () => {
    const catalog = createPokemonTestCatalog()
    const party = createPokemonParty([createPokemon(152), createPokemon(155)])
    const daycare = createHgssDaycareState()

    putPokemonInHgssDaycare(daycare, party, 0)
    expect(getHgssDaycareSaveState(daycare)).toBe(2)
    expect(party.members.map((pokemon) => pokemon.speciesId)).toEqual([155])
    daycare.mons[0]!.steps = 91
    expect(getHgssDaycareWithdrawCost(daycare.mons[0]!, catalog)).toBe(200)

    const returned = retrievePokemonFromHgssDaycare(daycare, party, 0, catalog)
    expect(returned).toMatchObject({ speciesId: 152, level: 6, experience: 216 })
    expect(returned.currentHp).toBe(returned.stats.hp)
    expect(getHgssDaycareSaveState(daycare)).toBe(0)
  })

  it('aligne aperçu, prix et retrait sur le plafond exact de la Pension', () => {
    const catalog = createPokemonTestCatalog()
    const daycare = createHgssDaycareState()
    const stored = createPokemon(152)
    daycare.mons[0] = { pokemon: stored, steps: 100_000 }
    const party = createPokemonParty()
    const levelPolicy: PokemonLevelPolicy = { resolveLevelCap: () => 6 }
    const growth = catalog.growthTables[catalog.personalData[152]!.growthRate]!

    expect(getHgssDaycareUpdatedLevel(daycare.mons[0]!, catalog, levelPolicy)).toBe(6)
    expect(getHgssDaycareLevelGrowth(daycare.mons[0]!, catalog, levelPolicy)).toBe(1)
    expect(getHgssDaycareWithdrawCost(daycare.mons[0]!, catalog, levelPolicy)).toBe(200)

    const returned = retrievePokemonFromHgssDaycare(
      daycare,
      party,
      0,
      catalog,
      basePokemonTeamPolicy,
      basePokemonPartyHealingPolicy,
      levelPolicy,
    )
    expect(returned.level).toBe(6)
    expect(returned.experience).toBe(growth.experienceByLevel[6])
  })

  it('reproduit les quatre classes de compatibilité depuis groupes, sexes, espèce et OT', () => {
    const catalog = createPokemonTestCatalog()
    const daycare = createHgssDaycareState()
    const first = createPokemon(152, 1)
    const second = createPokemon(152, 2)
    first.gender = 'female'
    second.gender = 'male'
    daycare.mons = [{ pokemon: first, steps: 0 }, { pokemon: second, steps: 0 }]

    expect(getHgssDaycareCompatibilityChance(daycare, catalog)).toBe(70)
    expect(getHgssDaycareCompatibilityMessageIndex(daycare, catalog)).toBe(0)
    second.originalTrainer.id = 1
    expect(getHgssDaycareCompatibilityChance(daycare, catalog)).toBe(50)
    second.speciesId = 155
    expect(getHgssDaycareCompatibilityChance(daycare, catalog)).toBe(20)
    second.gender = 'female'
    expect(getHgssDaycareCompatibilityChance(daycare, catalog)).toBe(0)
    expect(getHgssDaycareCompatibilityMessageIndex(daycare, catalog)).toBe(3)
  })

  it('clone les deux pensionnaires et l’œuf sans partager leurs objets mutables', () => {
    const daycare = createHgssDaycareState()
    daycare.mons[0] = { pokemon: createPokemon(), steps: 255 }
    daycare.eggPersonality = 0x12345678
    const cloned = cloneHgssDaycareState(daycare)

    cloned.mons[0]!.pokemon.friendship = 1
    expect(daycare.mons[0]!.pokemon.friendship).not.toBe(1)
    expect(cloned).toMatchObject({ eggPersonality: 0x12345678, eggCycleCounter: 0 })
  })

  it('hérite des IV et capacités du père selon les tables HGSS', () => {
    const catalog = createPokemonTestCatalog()
    catalog.eggMoves![152] = [43]
    const mother = createPokemon(152, 1)
    const father = createPokemon(152, 2)
    mother.gender = 'female'
    father.gender = 'male'
    mother.heldItemId = 294
    mother.individualValues.hp = 31
    father.moves.push({ moveId: 43, pp: 30, maxPp: 30, ppUps: 0, data: catalog.moves[43]! })
    const daycare = createHgssDaycareState()
    daycare.mons = [{ pokemon: mother, steps: 0 }, { pokemon: father, steps: 0 }]
    daycare.eggPersonality = 0x12345678
    const party = createPokemonParty()

    const egg = giveHgssDaycareEgg(daycare, party, catalog, createHgssLcrng(1), { id: 5, name: 'JO', gender: 'male' }, 3, 7)

    expect(egg).toMatchObject({ speciesId: 152, isEgg: true, nickname: 'ŒUF', nicknameSource: 'local-ref' })
    expect(egg.individualValues.hp).toBe(31)
    expect(egg.moves.map((move) => move.moveId)).toContain(43)
  })

  it('préflight dépôt, retrait et œuf avant de publier les états Pension/équipe', () => {
    const catalog = createPokemonTestCatalog()
    const first = createPokemon(152, 1)
    const second = createPokemon(155, 2)
    const party = createPokemonParty([first, second])
    const daycare = createHgssDaycareState()
    const policy: PokemonTeamPolicy = {
      vetoBattleEligibility: () => undefined,
      vetoPartyMutation: () => ({ code: 'daycare-locked', reason: 'Pension verrouillée.' }),
    }
    const beforeDeposit = JSON.stringify({ party, daycare })

    expect(() => putPokemonInHgssDaycare(daycare, party, 0, policy)).toThrow(PokemonTeamPolicyVetoError)
    expect(JSON.stringify({ party, daycare })).toBe(beforeDeposit)

    daycare.mons[0] = { pokemon: first, steps: 0 }
    const beforeRetrieve = JSON.stringify({ party, daycare })
    expect(() => retrievePokemonFromHgssDaycare(daycare, party, 0, catalog, policy)).toThrow(PokemonTeamPolicyVetoError)
    expect(JSON.stringify({ party, daycare })).toBe(beforeRetrieve)

    first.gender = 'female'; second.gender = 'male'
    daycare.mons = [{ pokemon: first, steps: 0 }, { pokemon: second, steps: 0 }]
    daycare.eggPersonality = 0x12345678
    const beforeEgg = JSON.stringify({ party, daycare })
    expect(() => giveHgssDaycareEgg(
      daycare, party, catalog, createHgssLcrng(1),
      { id: 5, name: 'JO', gender: 'male' }, 3, 7, policy,
    )).toThrow(PokemonTeamPolicyVetoError)
    expect(JSON.stringify({ party, daycare })).toBe(beforeEgg)
  })

  it('restaure séparément PV, statut et PP au retrait selon la politique de soin', () => {
    const catalog = createPokemonTestCatalog()
    const stored = createPokemon(152)
    stored.currentHp = 1
    stored.status = 7
    stored.moves[0]!.pp = 0
    const daycare = createHgssDaycareState()
    daycare.mons[0] = { pokemon: stored, steps: 0 }
    const party = createPokemonParty()

    const returned = retrievePokemonFromHgssDaycare(
      daycare,
      party,
      0,
      catalog,
      basePokemonTeamPolicy,
      {
        vetoFullHealRestoration: ({ restoration }) => restoration === 'status'
          ? { code: 'status-locked', reason: 'Statut conservé.' }
          : undefined,
      },
    )

    expect(returned.currentHp).toBe(returned.stats.hp)
    expect(returned.status).toBe(7)
    expect(returned.moves[0]?.pp).toBe(returned.moves[0]?.maxPp)
  })

  it('décrémente les cycles des œufs tous les 255 pas, avec Corps Ardent', () => {
    const catalog = createPokemonTestCatalog()
    const egg = createPokemon(152)
    egg.isEgg = true
    egg.friendship = 2
    const accelerator = createPokemon(155)
    accelerator.abilityId = 49
    const party = createPokemonParty([egg, accelerator])
    const daycare = createHgssDaycareState()
    daycare.eggCycleCounter = 254

    expect(advanceHgssDaycareStep(daycare, catalog, createHgssLcrng(1), party, new Date(2026, 7, 14))).toBe(false)
    expect(party.members[0]?.friendship).toBe(0)
    expect(daycare.eggCycleCounter).toBe(0)
    daycare.eggCycleCounter = 254
    expect(advanceHgssDaycareStep(daycare, catalog, createHgssLcrng(1), party, new Date(2026, 7, 14))).toBe(true)
  })

  it('désactive le cycle spécial de 230 pas tant que FieldSystem_HasPenalty est actif', () => {
    const catalog = createPokemonTestCatalog()
    const regular = createHgssDaycareState()
    regular.eggCycleCounter = 229
    advanceHgssDaycareStep(regular, catalog, createHgssLcrng(1), undefined, new Date(2026, 0, 12))
    expect(regular.eggCycleCounter).toBe(0)

    const penalized = createHgssDaycareState()
    penalized.eggCycleCounter = 229
    advanceHgssDaycareStep(penalized, catalog, createHgssLcrng(1), undefined, new Date(2026, 0, 12), undefined, true)
    expect(penalized.eggCycleCounter).toBe(230)
  })

  it('utilise la LCRNG pour la Pierre Stase puis le MTRNG pour le PID', () => {
    const catalog = createPokemonTestCatalog()
    const mother = createPokemon(152, 1)
    const father = createPokemon(152, 2)
    mother.gender = 'female'
    father.gender = 'male'
    mother.heldItemId = 229
    const daycare = createHgssDaycareState()
    daycare.mons = [{ pokemon: mother, steps: 0 }, { pokemon: father, steps: 254 }]
    const expectedPersonality = mother.nature + 25
    const lcValues = [0, 0]

    advanceHgssDaycareStep(
      daycare,
      catalog,
      { getSeed: () => 0, nextU16: () => lcValues.shift() ?? 0 },
      undefined,
      undefined,
      { nextU32: () => expectedPersonality, snapshot: () => ({ state: Array(624).fill(0), cycle: 0 }) },
    )

    expect(daycare.eggPersonality).toBe(expectedPersonality)
    expect(daycare.eggPersonality % 25).toBe(mother.nature)
  })
})
