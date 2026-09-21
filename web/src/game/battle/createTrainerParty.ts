import type { PokemonCatalog } from '../../ndsTypes'
import type { HgssTrainer, HgssTrainerPokemon } from '../../rom/battle/trainerData'
import { createCanonicalPokemon, type CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { getTrainerClassGender } from './trainerClassGender'

const pokeBallItemId = 4
const frustrationMoveId = 218

export type TrainerPartyOrigin = {
  language: number
  gameVersion: number
}

export type CreatedTrainerPartyMember = {
  pokemon: CanonicalPokemon
  capsule: number
}

function applyPersonalityOverrides(
  selector: number,
  entry: HgssTrainerPokemon,
  catalog: PokemonCatalog,
): number {
  let result = selector
  if (entry.genderOverride !== 0) {
    if (entry.form !== 0) {
      throw new Error(`Le ratio de genre de la forme ${entry.form} de l'espece ${entry.speciesId} n'est pas decode.`)
    }
    const personalData = catalog.personalData[entry.speciesId]
    if (!personalData) throw new Error(`L'espece Pokemon ${entry.speciesId} est absente du catalogue ROM.`)
    result = entry.genderOverride === 1
      ? personalData.genderRatio + 2
      : personalData.genderRatio - 2
  }
  if (entry.abilityOverride === 1) result &= ~1
  else if (entry.abilityOverride === 2) result |= 1
  return result >>> 0
}

export function createTrainerParty(
  trainer: HgssTrainer,
  catalog: PokemonCatalog,
  origin: TrainerPartyOrigin,
): CreatedTrainerPartyMember[] {
  let personalitySelector = getTrainerClassGender(trainer.trainerClass) === 'female' ? 0x78 : 0x88
  return trainer.party.map((entry): CreatedTrainerPartyMember => {
    personalitySelector = applyPersonalityOverrides(personalitySelector, entry, catalog)
    const seed = (entry.difficulty + entry.level + entry.speciesId + trainer.trainerId) >>> 0
    const rng = createHgssLcrng(seed)
    let personalityWord = seed
    for (let roll = 0; roll < trainer.trainerClass; roll += 1) personalityWord = rng.nextU16()
    const personality = ((personalityWord << 8) + personalitySelector) >>> 0
    const individualValue = Math.floor(entry.difficulty * 31 / 255)
    const pokemon = createCanonicalPokemon(catalog, {
      speciesId: entry.speciesId,
      level: entry.level,
      form: entry.form,
      rng,
      personality: { kind: 'fixed', value: personality },
      individualValues: { kind: 'fixed', value: individualValue },
      originalTrainer: { id: 0, name: '', gender: 'male' },
      originalTrainerId: { kind: 'randomNonShiny' },
      origin: {
        language: origin.language,
        gameVersion: origin.gameVersion,
        metLocation: 0,
        metLevel: entry.level,
        metTerrain: 0,
      },
      heldItemId: entry.heldItemId,
      moveIds: entry.moveIds,
      friendship: 255,
      ballId: pokeBallItemId,
    })
    if (pokemon.moves.some((move) => move.moveId === frustrationMoveId)) pokemon.friendship = 0
    return { pokemon, capsule: entry.capsule }
  })
}