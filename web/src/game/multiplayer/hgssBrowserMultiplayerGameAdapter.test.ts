import { describe, expect, it, vi } from 'vitest'
import type { PokemonCatalog } from '../../ndsTypes'
import { deriveLegacyPokemonInstanceId } from '../pokemon/pokemonInstanceId'
import type { FieldScriptState } from '../scripts/fieldScriptRunner'
import { basePokemonTeamPolicy } from '../pokemon/pokemonTeamPolicy'
import type { HgssP2pTradeCommitResult } from './hgssP2pTradeCoordinator'
import {
  createHgssBrowserMultiplayerGameAdapter,
  formatHgssP2pTradeCommitMessage,
} from './hgssBrowserMultiplayerGameAdapter'

const catalog = {
  speciesNames: Array.from({ length: 100 }, (_, speciesId) => `Espèce ${speciesId}`),
} as PokemonCatalog

function result(overrides: Partial<HgssP2pTradeCommitResult> = {}): HgssP2pTradeCommitResult {
  return {
    status: 'committed',
    receipt: {
      transactionId: 'AAAAAAAAAAAAAAAAAAAAAA',
      sentPokemonInstanceId: deriveLegacyPokemonInstanceId('trade-adapter-test', 'sent'),
      receivedPokemonInstanceId: deriveLegacyPokemonInstanceId('trade-adapter-test', 'received'),
    },
    outgoingPokemonId: deriveLegacyPokemonInstanceId('trade-adapter-test', 'sent'),
    incomingPokemonId: deriveLegacyPokemonInstanceId('trade-adapter-test', 'received'),
    receivedSpeciesId: 64,
    destination: { kind: 'party', slot: 1 },
    ...overrides,
  }
}

describe('adaptateur jeu du multijoueur navigateur', () => {
  it('présente localement la destination, la reprise et l’évolution', () => {
    expect(formatHgssP2pTradeCommitMessage(result(), catalog)).toContain('Espèce 64 reçu dans équipe · emplacement 2')
    expect(formatHgssP2pTradeCommitMessage(result({
      destination: { kind: 'storage', box: 2, slot: 4 },
      evolution: {
        sourceSpeciesId: 64,
        targetSpeciesId: 65,
        learnedMoveIds: [],
        skippedMoveIds: [],
      },
    }), catalog)).toContain('Espèce 64 a évolué en Espèce 65')
    expect(formatHgssP2pTradeCommitMessage(result({ status: 'already-committed' }), catalog)).toContain('déjà appliqué et vérifié')
  })

  it('relaie annulation et retrait sans sérialiser une créature', async () => {
    const state = { pokemonRuntime: {} } as FieldScriptState
    const choices = [{ kind: 'cancel' }, { kind: 'withdraw' }] as const
    let index = 0
    const adapter = createHgssBrowserMultiplayerGameAdapter({
      readContext: () => ({ state, pokemonCatalog: catalog, teamPolicy: basePokemonTeamPolicy }),
      choosePokemon: vi.fn(async () => choices[index++]!),
      persistState: vi.fn(),
      publishState: vi.fn(),
    })
    await expect(adapter.game.chooseLocalTradeOffer({})).resolves.toEqual({ kind: 'cancel' })
    await expect(adapter.game.chooseLocalTradeOffer({})).resolves.toEqual({ kind: 'withdraw' })
  })
})
