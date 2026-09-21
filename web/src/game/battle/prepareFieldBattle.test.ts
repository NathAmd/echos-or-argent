import { describe, expect, it } from 'vitest'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import type { HgssTrainer } from '../../rom/battle/trainerData'
import { createPokemonParty } from '../pokemon/pokemonParty'
import { formatPreparedFieldBattle, prepareFieldBattle } from './prepareFieldBattle'
import { cloneCanonicalPokemon, createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { cloneHgssTrainerHouseEntry, createHgssDefaultTrainerHouseEntry } from '../trainerHouse/hgssTrainerHouse'

const trainer: HgssTrainer = {
  trainerId: 495,
  trainerType: 0,
  trainerClass: 1,
  partySize: 1,
  items: [0, 0, 0, 0],
  aiFlags: 0,
  doubleBattle: false,
  party: [{ difficulty: 0, genderOverride: 0, abilityOverride: 0, level: 5, speciesId: 152, form: 0, capsule: 0 }],
}

function createTrainerHouseTestCatalog() {
  const catalog = createPokemonTestCatalog()
  const personalTemplate = catalog.personalData[152]!
  const moveTemplate = catalog.moves[33]!
  while (catalog.speciesNames.length <= 160) catalog.speciesNames.push(`ESPECE ${catalog.speciesNames.length}`)
  while (catalog.personalData.length <= 160) catalog.personalData.push({ ...personalTemplate, speciesId: catalog.personalData.length })
  while (catalog.levelUpLearnsets.length <= 160) catalog.levelUpLearnsets.push([])
  while (catalog.evolutions.length <= 160) catalog.evolutions.push([])
  while (catalog.moves.length <= 412) catalog.moves.push({ ...moveTemplate, moveId: catalog.moves.length })
  while (catalog.moveNames.length <= 412) catalog.moveNames.push(`CAPACITE ${catalog.moveNames.length}`)
  return catalog
}

describe('field battle preparation', () => {
  it('resolves a trainer trigger to its validated ROM roster', () => {
    const prepared = prepareFieldBattle(
      { kind: 'trainer', trainerId: 495, trainerParameter: 0, encounterType: 1, battleParameter: 0 },
      Array.from({ length: 496 }, (_, index) => index === 495 ? trainer : undefined) as HgssTrainer[],
      createPokemonTestCatalog(),
      { playerParty: createPokemonParty(), origin: { language: 3, gameVersion: 7 } },
    )

    expect(prepared).toMatchObject({
      kind: 'trainer',
      script: { trainerId: 495, encounterType: 1 },
      party: [{ speciesId: 152, speciesName: 'GERMIGNON', level: 5 }],
      createdParty: [{ pokemon: { speciesId: 152, level: 5 } }],
    })
    expect(formatPreparedFieldBattle(prepared)).toBe('Combat dresseur ROM 495 pret : GERMIGNON Nv.5')
  })

  it('rejects missing trainers and invalid wild levels explicitly', () => {
    const catalog = createPokemonTestCatalog()
    const context = { playerParty: createPokemonParty(), origin: { language: 3, gameVersion: 7 } }
    expect(() => prepareFieldBattle({ kind: 'trainer', trainerId: 12, trainerParameter: 0, encounterType: 0, battleParameter: 0 }, [], catalog, context)).toThrow('dresseur ROM 12')
    expect(() => prepareFieldBattle({ kind: 'wild', speciesId: 152, level: 0, battleParameter: 0 }, [], catalog, context)).toThrow('niveau ROM 0')
  })

  it('applique le meme overlay aux definitions presentees et materialisees', () => {
    const catalog = createPokemonTestCatalog()
    const prepared = prepareFieldBattle(
      { kind: 'trainer', trainerId: 495, trainerParameter: 0, encounterType: 1, battleParameter: 0 },
      Array.from({ length: 496 }, (_, index) => index === 495 ? trainer : undefined) as HgssTrainer[],
      catalog,
      {
        playerParty: createPokemonParty(),
        origin: { language: 3, gameVersion: 7 },
        rosterPolicy: {
          transformTrainerParty: (party) => [...party, { ...party[0]!, speciesId: 155, level: 8 }],
          transformTrainerHouseParty: (party) => party,
          transformScriptedWildPokemon: (pokemon) => pokemon,
        },
      },
    )

    expect(prepared).toMatchObject({
      kind: 'trainer',
      trainer: { partySize: 2 },
      party: [{ speciesId: 152, level: 5 }, { speciesId: 155, level: 8 }],
      createdParty: [{ pokemon: { speciesId: 152, level: 5 } }, { pokemon: { speciesId: 155, level: 8 } }],
    })
  })

  it('transforme aussi les rencontres sauvages lancees par script', () => {
    const prepared = prepareFieldBattle(
      { kind: 'wild', speciesId: 152, level: 5, battleParameter: 0 },
      [],
      createPokemonTestCatalog(),
      {
        playerParty: createPokemonParty(),
        origin: { language: 3, gameVersion: 7 },
        rosterPolicy: {
          transformTrainerParty: (party) => party,
          transformTrainerHouseParty: (party) => party,
          transformScriptedWildPokemon: (pokemon) => ({ ...pokemon, speciesId: 155, level: 9 }),
        },
      },
    )

    expect(prepared).toMatchObject({ kind: 'wild', party: [{ speciesId: 155, level: 9 }] })
  })

  it('prépare séparément l’allié et les deux équipes adverses d’un MultiBattle ROM', () => {
    const trainers = Array.from({ length: 503 }, () => undefined) as unknown as HgssTrainer[]
    trainers[500] = { ...trainer, trainerId: 500 }
    trainers[501] = { ...trainer, trainerId: 501 }
    trainers[502] = { ...trainer, trainerId: 502 }
    const prepared = prepareFieldBattle(
      { kind: 'multiTrainer', allyTrainerId: 500, opponentTrainerIds: [501, 502], battleParameter: 1 },
      trainers,
      createPokemonTestCatalog(),
      { playerParty: createPokemonParty(), origin: { language: 3, gameVersion: 7 } },
    )

    expect(prepared).toMatchObject({
      kind: 'multiTrainer',
      allyTrainer: { trainerId: 500 },
      opponentTrainers: [{ trainerId: 501 }, { trainerId: 502 }],
      createdAllyParty: [{ pokemon: { speciesId: 152 } }],
      createdOpponentParty: [{ pokemon: { speciesId: 152 } }, { pokemon: { speciesId: 152 } }],
    })
  })

  it('interprète le second opérande de TrainerBattle comme le second Dresseur du duo', () => {
    const trainers = Array.from({ length: 121 }, () => undefined) as unknown as HgssTrainer[]
    trainers[119] = { ...trainer, trainerId: 119 }
    trainers[120] = { ...trainer, trainerId: 120, party: [{ ...trainer.party[0]!, speciesId: 155 }] }
    const prepared = prepareFieldBattle(
      { kind: 'trainer', trainerId: 119, trainerParameter: 120, encounterType: 0, battleParameter: 0 },
      trainers,
      createPokemonTestCatalog(),
      { playerParty: createPokemonParty(), origin: { language: 3, gameVersion: 7 } },
    )

    expect(prepared).toMatchObject({
      kind: 'tagTrainer',
      opponentTrainers: [{ trainerId: 119 }, { trainerId: 120 }],
      createdOpponentParty: [{ pokemon: { speciesId: 152 } }, { pokemon: { speciesId: 155 } }],
    })
  })

  it('reconstruit l’équipe fixe exacte de la Maison des Dresseurs et plafonne temporairement le joueur', () => {
    const catalog = createTrainerHouseTestCatalog()
    const player = createCanonicalPokemon(catalog, {
      speciesId: 152,
      level: 70,
      rng: createHgssLcrng(1),
      personality: { kind: 'fixed', value: 1 },
      individualValues: { kind: 'fixed', value: 20 },
      originalTrainer: { id: 1, name: 'JO', gender: 'male' },
      origin: { language: 3, gameVersion: 7, metLocation: 1, metLevel: 70, metTerrain: 0 },
      ballId: 4,
    })
    const prepared = prepareFieldBattle(
      { kind: 'trainerHouse', trainerNumber: 10 },
      [],
      catalog,
      { playerParty: createPokemonParty([player]), origin: { language: 3, gameVersion: 7 }, trainerHouseDefaultName: 'HILBERT' },
    )

    expect(prepared).toMatchObject({
      kind: 'trainerHouse',
      trainer: { name: 'HILBERT', spriteId: 11 },
      party: [
        { speciesId: 154, level: 50, heldItemId: 158, moveIds: [73, 182, 412, 92] },
        { speciesId: 157, level: 50, heldItemId: 203, moveIds: [284, 164, 53, 411] },
        { speciesId: 160, level: 50, heldItemId: 157, moveIds: [349, 127, 8, 242] },
      ],
      playerParty: { members: [{ level: 50 }] },
    })
    expect(player.level).toBe(70)
  })

  it('applique l’overlay Maison des Dresseurs au roster réellement lancé sans muter l’entrée sauvegardée', () => {
    const catalog = createTrainerHouseTestCatalog()
    const source = createHgssDefaultTrainerHouseEntry(catalog, 'SOURCE', 3, 7)
    source.trainerId = 42
    const sourceSnapshot = cloneHgssTrainerHouseEntry(source)
    const entries = Array.from({ length: 10 }, (_, slot) => slot === 3 ? source : undefined)
    let receivedPokemon = source.party[0]
    let receivedContext: unknown

    const prepared = prepareFieldBattle(
      { kind: 'trainerHouse', trainerNumber: 3 },
      [],
      catalog,
      {
        playerParty: createPokemonParty(),
        origin: { language: 3, gameVersion: 7 },
        trainerHouseEntries: entries,
        rosterPolicy: {
          transformTrainerParty: (party) => party,
          transformTrainerHouseParty: (party, context) => {
            receivedPokemon = party[1]!
            receivedContext = context
            const replacement = cloneCanonicalPokemon(party[1]!)
            replacement.nickname = 'OVERLAY'
            return [replacement]
          },
          transformScriptedWildPokemon: (pokemon) => pokemon,
        },
      },
    )

    expect(receivedContext).toEqual({
      battleKind: 'trainer-house', role: 'opponent', trainerId: 42, trainerHouseSlot: 3,
    })
    expect(prepared).toMatchObject({
      kind: 'trainerHouse',
      trainer: { party: [{ speciesId: 157, nickname: 'OVERLAY' }] },
      party: [{ speciesId: 157, level: 50 }],
    })
    expect(receivedPokemon).not.toBe(source.party[1])
    if (prepared.kind !== 'trainerHouse') throw new Error('Le combat Maison des Dresseurs attendu est absent.')
    expect(prepared.trainer.party[0]).not.toBe(receivedPokemon)
    prepared.trainer.party[0]!.level = 49
    expect(source).toEqual(sourceSnapshot)
  })

  it('rejette un overlay Maison des Dresseurs vide, invalide ou contenant un œuf', () => {
    const catalog = createTrainerHouseTestCatalog()
    const context = {
      playerParty: createPokemonParty(),
      origin: { language: 3, gameVersion: 7 },
      trainerHouseDefaultName: 'HILBERT',
    }
    const battle = { kind: 'trainerHouse', trainerNumber: 10 } as const

    expect(() => prepareFieldBattle(battle, [], catalog, {
      ...context,
      rosterPolicy: {
        transformTrainerParty: (party) => party,
        transformTrainerHouseParty: () => [],
        transformScriptedWildPokemon: (pokemon) => pokemon,
      },
    })).toThrow('0 Pokemon au lieu de 1 a 6')

    expect(() => prepareFieldBattle(battle, [], catalog, {
      ...context,
      rosterPolicy: {
        transformTrainerParty: (party) => party,
        transformTrainerHouseParty: (party) => {
          const invalid = cloneCanonicalPokemon(party[0]!)
          invalid.moves[0] = {
            ...invalid.moves[0]!,
            moveId: catalog.moves.length,
            data: { ...invalid.moves[0]!.data, moveId: catalog.moves.length },
          }
          return [invalid]
        },
        transformScriptedWildPokemon: (pokemon) => pokemon,
      },
    })).toThrow(`capacite ROM ${catalog.moves.length}`)

    expect(() => prepareFieldBattle(battle, [], catalog, {
      ...context,
      rosterPolicy: {
        transformTrainerParty: (party) => party,
        transformTrainerHouseParty: (party) => [{ ...party[0]!, isEgg: true }],
        transformScriptedWildPokemon: (pokemon) => pokemon,
      },
    })).toThrow('est un oeuf')
  })
})
