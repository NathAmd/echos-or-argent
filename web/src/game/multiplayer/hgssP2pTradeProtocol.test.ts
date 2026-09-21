import { describe, expect, it, vi } from 'vitest'
import { deriveLegacyPokemonInstanceId, type PokemonInstanceId } from '../pokemon/pokemonInstanceId'
import {
  createHgssP2pTradeOfferPair,
  decodeHgssP2pTradeFrame,
  encodeHgssP2pTradeFrame,
  getHgssP2pTradeOfferPairKey,
  hgssP2pTradeMaximumWireBytes,
  hgssP2pTradeProtocol,
  hgssP2pTradeProtocolVersion,
  parseHgssP2pTradeFrame,
  parseHgssP2pTradePokemonSnapshot,
  projectHgssP2pTradeOfferPreview,
  type HgssP2pTradePokemonSnapshot,
} from './hgssP2pTradeProtocol'

const sessionId = 'A'.repeat(22)
const transactionId = `${'B'.repeat(21)}A`

function pokemonId(byte: string): PokemonInstanceId {
  return `pkm:v1:r:${byte.repeat(32)}` as PokemonInstanceId
}

function rawPokemon(byte = '1'): Record<string, unknown> {
  return {
    instanceId: pokemonId(byte),
    speciesId: 64,
    nickname: 'PSY',
    nicknameSource: 'user-text',
    form: 0,
    personality: 0x12345678,
    originalTrainer: { id: 0x87654321, gender: 'female', name: 'ALICE', nameSource: 'user-text' },
    origin: {
      language: 2,
      gameVersion: 7,
      metLocation: 42,
      metLevel: 18,
      metTerrain: 3,
      metDate: { year: 2026, month: 8, day: 26 },
      eggLocation: 12,
      eggDate: { year: 2026, month: 8, day: 20 },
    },
    level: 25,
    experience: 15_625,
    individualValues: { hp: 31, attack: 30, defense: 29, speed: 28, specialAttack: 27, specialDefense: 26 },
    effortValues: { hp: 1, attack: 2, defense: 3, speed: 4, specialAttack: 5, specialDefense: 6 },
    nature: 7,
    gender: 'male',
    abilityId: 28,
    shiny: true,
    friendship: 111,
    moves: [
      { moveId: 93, pp: 20, maxPp: 25, ppUps: 1 },
      { moveId: 94, pp: 10, maxPp: 10, ppUps: 0 },
    ],
    stats: { hp: 70, attack: 40, defense: 38, speed: 61, specialAttack: 72, specialDefense: 44 },
    currentHp: 55,
    status: 0,
    heldItemId: 110,
    mailIdentityCode: 1,
    ballId: 4,
    isEgg: false,
    fatefulEncounter: false,
    shinyLeafMask: 3,
    contestValues: [1, 2, 3, 4, 5, 6],
    ribbonIds: [1, 7, 12],
  }
}

function pokemon(byte = '1'): HgssP2pTradePokemonSnapshot {
  const parsed = parseHgssP2pTradePokemonSnapshot(rawPokemon(byte))
  if (!parsed) throw new Error('Fixture Pokémon invalide.')
  return parsed
}

function offerFrame(offered: unknown = pokemon()) {
  return {
    protocol: hgssP2pTradeProtocol,
    protocolVersion: hgssP2pTradeProtocolVersion,
    sessionId,
    transactionId,
    senderId: 'alice',
    kind: 'offer',
    revision: 1,
    pokemon: offered,
  }
}

describe('snapshot data-only des échanges P2P HGSS', () => {
  it("conserve toute l'instance fonctionnelle sans aucune donnée de présentation ROM", () => {
    const parsed = pokemon()
    expect(parsed).toMatchObject({
      speciesId: 64,
      originalTrainer: { id: 0x87654321, name: 'ALICE', nameSource: 'user-text' },
      origin: { language: 2, gameVersion: 7, metLocation: 42 },
      friendship: 111,
      nature: 7,
      ballId: 4,
      ribbonIds: [1, 7, 12],
    })
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.moves)).toBe(true)
    const wire = encodeHgssP2pTradeFrame(offerFrame(parsed) as never)
    expect(wire).not.toMatch(/speciesName|moveName|description|sprite|texture|ROM_CANARY/)
    expect(decodeHgssP2pTradeFrame(wire)).toEqual(offerFrame(parsed))
  })

  it("produit l'aperçu depuis la capsule exacte, avec seulement IDs, nombres et textes joueur attestés", () => {
    expect(projectHgssP2pTradeOfferPreview(pokemon())).toEqual({
      pokemonId: pokemonId('1'),
      speciesId: 64,
      nickname: 'PSY',
      nicknameSource: 'user-text',
      form: 0,
      level: 25,
      gender: 'male',
      shiny: true,
      isEgg: false,
      heldItemId: 110,
      currentHp: 55,
      maximumHp: 70,
      stats: { hp: 70, attack: 40, defense: 38, speed: 61, specialAttack: 72, specialDefense: 44 },
      moveIds: [93, 94],
    })
  })

  it.each([
    ['nom d’espèce', (value: Record<string, unknown>) => { value.speciesName = 'ROM_CANARY' }],
    ['données de capacité', (value: Record<string, unknown>) => { (value.moves as Record<string, unknown>[])[0]!.data = { name: 'ROM_CANARY' } }],
    ['asset', (value: Record<string, unknown>) => { value.sprite = new Uint8Array([1, 2]) }],
    ['texte OT sans provenance', (value: Record<string, unknown>) => { delete (value.originalTrainer as Record<string, unknown>).nameSource }],
    ['surnom sans provenance', (value: Record<string, unknown>) => { delete value.nicknameSource }],
    ['fausse provenance locale', (value: Record<string, unknown>) => { value.nicknameSource = 'local-ref' }],
    ['texte et référence simultanés', (value: Record<string, unknown>) => { value.nicknameLocalRef = 1 }],
  ])('refuse %s', (_label, poison) => {
    const value = rawPokemon()
    poison(value)
    expect(parseHgssP2pTradePokemonSnapshot(value)).toBeUndefined()
  })

  it('accepte les références locales numériques sans recopier leurs libellés', () => {
    const value = rawPokemon()
    delete value.nickname
    delete value.nicknameSource
    value.nicknameLocalRef = 3
    value.originalTrainer = { id: 42, gender: 'male', localTradeId: 2 }
    expect(parseHgssP2pTradePokemonSnapshot(value)).toMatchObject({
      nicknameLocalRef: 3,
      originalTrainer: { id: 42, gender: 'male', localTradeId: 2 },
    })
  })

  it('refuse un identifiant legacy qui pourrait encoder du texte local', () => {
    const value = rawPokemon()
    value.instanceId = deriveLegacyPokemonInstanceId('ROM_CANARY', 'party/0')
    expect(parseHgssP2pTradePokemonSnapshot(value)).toBeUndefined()
  })

  it('refuse les objets exotiques, accesseurs et tableaux clairsemés sans exécuter le getter', () => {
    expect(parseHgssP2pTradePokemonSnapshot(Object.assign(Object.create({}), rawPokemon()))).toBeUndefined()
    const getter = vi.fn(() => pokemonId('1'))
    const withGetter = rawPokemon()
    Object.defineProperty(withGetter, 'instanceId', { enumerable: true, get: getter })
    expect(parseHgssP2pTradePokemonSnapshot(withGetter)).toBeUndefined()
    expect(getter).not.toHaveBeenCalled()
    const sparse = rawPokemon()
    const moves = new Array(2)
    moves[1] = { moveId: 94, pp: 10, maxPp: 10, ppUps: 0 }
    sparse.moves = moves
    expect(parseHgssP2pTradePokemonSnapshot(sparse)).toBeUndefined()
  })

  it('refuse les incohérences numériques et booléennes', () => {
    for (const poison of [
      (value: Record<string, unknown>) => { value.level = '25' },
      (value: Record<string, unknown>) => { value.isEgg = 0 },
      (value: Record<string, unknown>) => { value.currentHp = 71 },
      (value: Record<string, unknown>) => { (value.moves as Record<string, unknown>[])[0]!.pp = 26 },
      (value: Record<string, unknown>) => { value.contestValues = [1, 2, 3] },
      (value: Record<string, unknown>) => { value.ribbonIds = [7, 7] },
      (value: Record<string, unknown>) => { (value.origin as Record<string, unknown>).metDate = { year: 2026, month: 2, day: 30 } },
    ]) {
      const value = rawPokemon()
      poison(value)
      expect(parseHgssP2pTradePokemonSnapshot(value)).toBeUndefined()
    }
  })
})

describe('trames transactionnelles des échanges P2P HGSS', () => {
  it('exige des IDs opaques 128 bits pour la session et la transaction', () => {
    expect(parseHgssP2pTradeFrame(offerFrame())).toBeDefined()
    expect(parseHgssP2pTradeFrame({ ...offerFrame(), sessionId: 'session-readable' })).toBeUndefined()
    expect(parseHgssP2pTradeFrame({ ...offerFrame(), transactionId: 'trade-64-65' })).toBeUndefined()
    expect(parseHgssP2pTradeFrame({ ...offerFrame(), transactionId: `${'B'.repeat(21)}B` })).toBeUndefined()
  })

  it('canonise la paire par participant et lie chaque acceptation à une révision et une instance', () => {
    const pair = createHgssP2pTradeOfferPair(
      { participantId: 'bob', revision: 4, pokemonId: pokemonId('2') },
      { participantId: 'alice', revision: 2, pokemonId: pokemonId('1') },
    )
    expect(pair.map(({ participantId }) => participantId)).toEqual(['alice', 'bob'])
    expect(getHgssP2pTradeOfferPairKey(pair)).toBe(JSON.stringify(pair))
    expect(() => createHgssP2pTradeOfferPair(
      { participantId: 'alice', revision: 1, pokemonId: pokemonId('1') },
      { participantId: 'bob', revision: 1, pokemonId: pokemonId('1') },
    )).toThrow('invalide')
  })

  it('refuse toute clé supplémentaire à chaque variante', () => {
    expect(parseHgssP2pTradeFrame({ ...offerFrame(), speciesName: 'ROM_CANARY' })).toBeUndefined()
    const pair = createHgssP2pTradeOfferPair(
      { participantId: 'alice', revision: 1, pokemonId: pokemonId('1') },
      { participantId: 'bob', revision: 1, pokemonId: pokemonId('2') },
    )
    expect(parseHgssP2pTradeFrame({
      protocol: hgssP2pTradeProtocol,
      protocolVersion: hgssP2pTradeProtocolVersion,
      sessionId,
      transactionId,
      senderId: 'alice',
      kind: 'accept',
      pair,
      accepted: true,
    })).toBeUndefined()
  })

  it('borne le JSON avant parsing', () => {
    expect(decodeHgssP2pTradeFrame('x'.repeat(hgssP2pTradeMaximumWireBytes + 1))).toBeUndefined()
  })
})
