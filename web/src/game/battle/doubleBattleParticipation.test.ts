import { describe, expect, it } from 'vitest'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { deriveLegacyPokemonInstanceId } from '../pokemon/pokemonInstanceId'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import {
  clearDoubleBattleExperienceParticipation,
  getDoubleBattleExperienceParticipantIndexes,
  recordDoubleBattleActiveMatchups,
  type DoubleBattleParticipationContext,
} from './doubleBattleParticipation'

describe('double battle participation identity', () => {
  it("sépare deux adversaires qui partagent personnalité et dresseur d'origine", () => {
    const catalog = createPokemonTestCatalog()
    const firstPlayer = participant('player-a', [pokemon(catalog, 152, 42, 'player-a-0'), pokemon(catalog, 153, 42, 'player-a-1')])
    const secondPlayer = participant('player-b', [pokemon(catalog, 154, 43, 'player-b')])
    const firstTarget = pokemon(catalog, 155, 99, 'target-a')
    const secondTarget = pokemon(catalog, 155, 99, 'target-b')
    const firstOpponent = participant('opponent-a', [firstTarget, secondTarget])
    const secondOpponent = participant('opponent-b', [pokemon(catalog, 158, 100, 'opponent-b')])
    const context: DoubleBattleParticipationContext = {
      teams: {
        player: [firstPlayer, secondPlayer],
        opponent: [firstOpponent, secondOpponent],
      },
      experienceParticipation: new Map(),
    }
    const target = { side: 'opponent' as const, slot: 0 as const }

    recordDoubleBattleActiveMatchups(context)
    firstPlayer.activePartyIndex = 1
    firstOpponent.activePartyIndex = 1
    recordDoubleBattleActiveMatchups(context)

    expect(firstTarget.instanceId).not.toBe(secondTarget.instanceId)
    expect(getDoubleBattleExperienceParticipantIndexes(context, target, firstTarget, 'player-a')).toEqual([0])
    expect(getDoubleBattleExperienceParticipantIndexes(context, target, secondTarget, 'player-a')).toEqual([1])

    clearDoubleBattleExperienceParticipation(context, target, secondTarget)
    expect(getDoubleBattleExperienceParticipantIndexes(context, target, firstTarget, 'player-a')).toEqual([0])
    expect(getDoubleBattleExperienceParticipantIndexes(context, target, secondTarget, 'player-a')).toEqual([])
  })
})

function participant(ownerId: string, party: ReturnType<typeof pokemon>[]) {
  return { ownerId, party, activePartyIndex: 0 }
}

function pokemon(
  catalog: ReturnType<typeof createPokemonTestCatalog>,
  speciesId: number,
  personality: number,
  instancePath: string,
) {
  return createCanonicalPokemon(catalog, {
    instanceId: deriveLegacyPokemonInstanceId('double-participation-test', instancePath),
    speciesId,
    level: 10,
    rng: createHgssLcrng(personality),
    personality: { kind: 'fixed', value: personality },
    individualValues: { kind: 'fixed', value: 0 },
    originalTrainer: { id: 7, name: 'JO', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 1, metLevel: 10, metTerrain: 0 },
    ballId: 4,
  })
}
