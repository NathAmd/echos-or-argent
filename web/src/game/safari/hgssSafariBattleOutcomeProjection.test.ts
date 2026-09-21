import { describe, expect, it } from 'vitest'
import { deriveLegacyPokemonInstanceId } from '../pokemon/pokemonInstanceId'
import { projectHgssSafariBattleFinishOutcome } from './hgssSafariBattleOutcomeProjection'
import type { HgssSafariBattleOutcome } from './hgssSafariBattle'

const opponent = { instanceId: deriveLegacyPokemonInstanceId('safari-test', 'opponent') }

describe('projection de la fin de combat Safari', () => {
  it('conserve exactement l’identité du Pokémon capturé', () => {
    expect(projectHgssSafariBattleFinishOutcome({ outcome: 'caught', opponent })).toEqual({
      kind: 'battle-finished',
      outcome: 'capture',
      capturedPokemon: {
        instanceId: opponent.instanceId,
        side: 'opponent',
        partyIndex: 0,
      },
    })
  })

  it.each([
    'player-ran',
    'opponent-fled',
    'balls-out',
    'storage-full',
  ] satisfies readonly HgssSafariBattleOutcome[])('termine %s comme une fuite pour les modules NG+', (outcome) => {
    expect(projectHgssSafariBattleFinishOutcome({ outcome, opponent })).toEqual({
      kind: 'battle-finished',
      outcome: 'flee',
    })
  })

  it('refuse de publier la fin d’un combat encore actif', () => {
    expect(() => projectHgssSafariBattleFinishOutcome({ outcome: 'active', opponent })).toThrow(
      'Un combat Safari encore actif ne peut pas être finalisé.',
    )
  })
})
