import { describe, expect, it } from 'vitest'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssSessionRng } from '../pokemon/hgssSessionRng'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { deriveLegacyPokemonInstanceId } from '../pokemon/pokemonInstanceId'
import {
  assertHgssMultiplayerResult,
  createDataChannelHgssMultiplayerGateway,
  createOfflineHgssMultiplayerGateway,
  createTransportHgssMultiplayerGateway,
  executeHgssMultiplayerWithOfflineFallback,
  hgssMultiplayerProtocolVersion,
  serializeHgssMultiplayerPokemon,
  type HgssMultiplayerDataChannelTransport,
  type HgssMultiplayerRequest,
} from './hgssMultiplayerGateway'

const request: HgssMultiplayerRequest = {
  protocolVersion: hgssMultiplayerProtocolVersion,
  requestId: 'map:1:opcode:269',
  romOpcode: 269,
  kind: 'union-wait-contact',
  player: { trainerId: 42, name: 'LUCAS', gender: 'male' },
}

describe('passerelle multijoueur HGSS', () => {
  it('résout immédiatement une attente Salle Union hors ligne avec le code ROM d’annulation', async () => {
    await expect(createOfflineHgssMultiplayerGateway().execute(request)).resolves.toMatchObject({
      requestId: request.requestId,
      kind: 'union-wait-contact',
      romResult: 2,
      status: 'offline',
    })
  })

  it('ferme le club de communication hors ligne avant de fabriquer un partenaire', async () => {
    const communicationRequest: HgssMultiplayerRequest = {
      protocolVersion: hgssMultiplayerProtocolVersion,
      requestId: 'map:173:opcode:226',
      romOpcode: 226,
      kind: 'communication-club',
      role: 'join',
      communicationType: 39,
      parameter1: 0,
      parameter2: 0,
      player: { trainerId: 42, name: 'LUCAS', gender: 'male' },
    }
    await expect(createOfflineHgssMultiplayerGateway().execute(communicationRequest)).resolves.toMatchObject({
      requestId: communicationRequest.requestId,
      kind: 'communication-club',
      romResult: 4,
      status: 'offline',
    })
  })

  it('refuse une réponse serveur appartenant à une autre requête', () => {
    expect(() => assertHgssMultiplayerResult(request, {
      protocolVersion: hgssMultiplayerProtocolVersion,
      requestId: 'autre-requete',
      kind: request.kind,
      romResult: 0,
      status: 'completed',
    })).toThrow(/désynchronisée/)
  })

  it('valide aussi les résultats fournis par un RTCDataChannel', async () => {
    const gateway = createTransportHgssMultiplayerGateway({
      transportKind: 'rtc-data-channel',
      execute: async (sent) => ({
        protocolVersion: hgssMultiplayerProtocolVersion,
        requestId: sent.requestId,
        kind: sent.kind,
        romResult: 3,
        status: 'completed',
      }),
    })
    await expect(gateway.execute(request)).resolves.toMatchObject({ romResult: 3 })
  })

  it('refuse explicitement un transport HTTP ou WebSocket déguisé', () => {
    expect(() => createDataChannelHgssMultiplayerGateway({
      transportKind: 'http',
      execute: async () => { throw new Error('ne doit pas partir') },
    } as unknown as HgssMultiplayerDataChannelTransport)).toThrow(/RTCDataChannel/)
  })

  it('ne sérialise que les surnoms dont la saisie joueur est prouvée', () => {
    const pokemon = createCanonicalPokemon(createPokemonTestCatalog(), {
      speciesId: 155,
      level: 5,
      rng: createHgssSessionRng(5489).lc,
      personality: { kind: 'random' },
      individualValues: { kind: 'random' },
      originalTrainer: { id: 1, name: 'JO', gender: 'male' },
      origin: { language: 3, gameVersion: 7, metLocation: 126, metLevel: 5, metTerrain: 12 },
      ballId: 4,
    })
    pokemon.nickname = 'NOM ROM'
    pokemon.nicknameSource = 'local-ref'
    expect(serializeHgssMultiplayerPokemon(pokemon)).not.toHaveProperty('nickname')

    pokemon.nicknameSource = undefined
    expect(serializeHgssMultiplayerPokemon(pokemon)).not.toHaveProperty('nickname')

    pokemon.nickname = 'FLAMME'
    pokemon.nicknameSource = 'user-text'
    expect(serializeHgssMultiplayerPokemon(pokemon)).toHaveProperty('nickname', 'FLAMME')

    Object.assign(pokemon, { instanceId: deriveLegacyPokemonInstanceId('texte-rom-local', 'party/0') })
    expect(() => serializeHgssMultiplayerPokemon(pokemon)).toThrow('data-only')
  })

  it('centralise la sortie native hors ligne si le transport échoue', async () => {
    const failure = new Error('canal indisponible')
    await expect(executeHgssMultiplayerWithOfflineFallback({
      execute: async () => { throw failure },
    }, request)).resolves.toEqual({
      result: expect.objectContaining({ requestId: request.requestId, romResult: 2, status: 'offline' }),
      error: failure,
    })
  })
})
