import { describe, expect, it } from 'vitest'
import type { HgssTrainer } from '../../rom/battle/trainerData'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { createPokemonParty } from '../pokemon/pokemonParty'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { createInitialTrainerBattleState } from './initialTrainerBattleState'
import { prepareFieldBattle } from './prepareFieldBattle'

const catalog = createPokemonTestCatalog()

function createPokemon(speciesId: 152 | 155 | 158) {
  return createCanonicalPokemon(catalog, {
    speciesId,
    level: 5,
    rng: createHgssLcrng(speciesId),
    personality: { kind: 'random' },
    individualValues: { kind: 'random' },
    originalTrainer: { id: 1, name: 'JO', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 126, metLevel: 5, metTerrain: 12 },
    ballId: 4,
  })
}

function prepare(trainer: HgssTrainer, playerParty = createPokemonParty([createPokemon(155)])) {
  const prepared = prepareFieldBattle(
    { kind: 'trainer', trainerId: trainer.trainerId, trainerParameter: 0, encounterType: 1, battleParameter: 0 },
    Array.from({ length: trainer.trainerId + 1 }, (_, index) => index === trainer.trainerId ? trainer : undefined) as HgssTrainer[],
    catalog,
    { playerParty, origin: { language: 3, gameVersion: 7 } },
  )
  if (prepared.kind !== 'trainer') throw new Error('La fixture trainer est invalide.')
  return prepared
}

describe('initial trainer battle state', () => {
  it('creates an isolated single-battle setup from the first usable slots', () => {
    const fainted = createPokemon(152)
    fainted.currentHp = 0
    const trainer: HgssTrainer = {
      trainerId: 497,
      trainerType: 0,
      trainerClass: 23,
      partySize: 1,
      items: [0, 0, 0, 0],
      aiFlags: 7,
      doubleBattle: false,
      party: [{ difficulty: 0, genderOverride: 0, abilityOverride: 0, level: 5, speciesId: 158, form: 0, capsule: 0 }],
    }
    const prepared = prepare(trainer, createPokemonParty([fainted, createPokemon(155)]))
    const state = createInitialTrainerBattleState(prepared)

    expect(state).toMatchObject({
      kind: 'trainer',
      phase: 'setup',
      format: 'single',
      turn: 0,
      trainer: { trainerId: 497, aiFlags: 7 },
      player: { openingSlots: [1] },
      opponent: { openingSlots: [0], party: { members: [{ speciesId: 158 }] } },
    })
    state.player.party.members[1]!.currentHp = 0
    expect(prepared.playerParty.members[1]!.currentHp).toBeGreaterThan(0)
  })

  it('rejects a setup when either side lacks enough usable Pokemon', () => {
    const trainer: HgssTrainer = {
      trainerId: 1,
      trainerType: 0,
      trainerClass: 8,
      partySize: 1,
      items: [0, 0, 0, 0],
      aiFlags: 0,
      doubleBattle: true,
      party: [{ difficulty: 0, genderOverride: 0, abilityOverride: 0, level: 5, speciesId: 152, form: 0, capsule: 0 }],
    }
    expect(() => createInitialTrainerBattleState(prepare(trainer))).toThrow('2 Pokemon utilisables')
  })

  it('uses the player team policy for the initial presentation slots', () => {
    const trainer: HgssTrainer = {
      trainerId: 1,
      trainerType: 0,
      trainerClass: 8,
      partySize: 1,
      items: [0, 0, 0, 0],
      aiFlags: 0,
      doubleBattle: false,
      party: [{ difficulty: 0, genderOverride: 0, abilityOverride: 0, level: 5, speciesId: 152, form: 0, capsule: 0 }],
    }
    const blocked = createPokemon(152)
    const allowed = createPokemon(155)
    const state = createInitialTrainerBattleState(
      prepare(trainer, createPokemonParty([blocked, allowed])),
      undefined,
      {
        vetoBattleEligibility: ({ pokemon }) => pokemon.instanceId === blocked.instanceId
          ? { code: 'permadeath', reason: 'Ce Pokemon est definitivement K.O.' }
          : undefined,
        vetoPartyMutation: () => undefined,
      },
    )

    expect(state.player.openingSlots).toEqual([1])
  })
})
