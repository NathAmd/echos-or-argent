import type { PokemonCatalog } from '../../ndsTypes'
import { createCanonicalPokemon, cloneCanonicalPokemon, type CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { calculatePokemonStats, resolvePokemonPersonalData } from '../pokemon/pokemonFormulas'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'

export type HgssMailMessage = {
  /** Save MailMessage::msg_bank, translated to a ROM message bank at display time. */
  bank: number
  messageId: number
  fields: readonly [number, number]
}

export type HgssTrainerHouseEntry = {
  trainerId: number
  spriteId: number
  language: number
  gameVersion: number
  gender: 'male' | 'female'
  name: string
  /** Les entrées persistées viennent d'un profil joueur distant. */
  nameSource?: 'user-text'
  introMessage: HgssMailMessage
  winMessage: HgssMailMessage
  loseMessage: HgssMailMessage
  party: CanonicalPokemon[]
}

export const hgssTrainerHouseSlotCount = 10
export const hgssDefaultTrainerHouseSlot = hgssTrainerHouseSlotCount

/** Native MailMsgBank enum -> NARC_msgdata_msg member, from mail_message.c. */
export const hgssMailMessageBankIds = [294, 296, 292, 293, 295] as const

export function cloneHgssTrainerHouseEntry(entry: HgssTrainerHouseEntry): HgssTrainerHouseEntry {
  return {
    ...entry,
    introMessage: { ...entry.introMessage, fields: [...entry.introMessage.fields] as [number, number] },
    winMessage: { ...entry.winMessage, fields: [...entry.winMessage.fields] as [number, number] },
    loseMessage: { ...entry.loseMessage, fields: [...entry.loseMessage.fields] as [number, number] },
    party: entry.party.map(cloneCanonicalPokemon),
  }
}

type DefaultPokemonDefinition = {
  speciesId: number
  personality: number
  heldItemId: number
  moveIds: readonly [number, number, number, number]
  abilityId: number
  effortValues: Partial<CanonicalPokemon['effortValues']>
}

const defaultParty: readonly DefaultPokemonDefinition[] = [
  { speciesId: 154, personality: 0x101, heldItemId: 158, moveIds: [73, 182, 412, 92], abilityId: 65, effortValues: { hp: 255, specialDefense: 255 } },
  { speciesId: 157, personality: 0x1010, heldItemId: 203, moveIds: [284, 164, 53, 411], abilityId: 66, effortValues: { speed: 255, specialAttack: 255 } },
  { speciesId: 160, personality: 0x11, heldItemId: 157, moveIds: [349, 127, 8, 242], abilityId: 67, effortValues: { hp: 255, attack: 255 } },
]

/** Exact built-in TrainerHouse set from overlay_25.c, with localized ROM names. */
export function createHgssDefaultTrainerHouseEntry(
  catalog: PokemonCatalog,
  trainerName: string,
  language: number,
  gameVersion: number,
): HgssTrainerHouseEntry {
  const party = defaultParty.map((definition) => {
    const pokemon = createCanonicalPokemon(catalog, {
      speciesId: definition.speciesId,
      level: 50,
      rng: createHgssLcrng(0),
      personality: { kind: 'fixed', value: definition.personality },
      individualValues: { kind: 'fixed', value: 20 },
      originalTrainer: { id: 0x11111111, name: trainerName, gender: 'male' },
      originalTrainerId: { kind: 'fixed', value: 0x11111111 },
      origin: { language, gameVersion, metLocation: 0, metLevel: 50, metTerrain: 0 },
      heldItemId: definition.heldItemId,
      moveIds: definition.moveIds,
      friendship: 0,
      ballId: 4,
    })
    pokemon.effortValues = {
      hp: 0,
      attack: 0,
      defense: 0,
      speed: 0,
      specialAttack: 0,
      specialDefense: 0,
      ...definition.effortValues,
    }
    pokemon.abilityId = definition.abilityId
    pokemon.stats = calculatePokemonStats(
      resolvePokemonPersonalData(catalog, pokemon.speciesId, pokemon.form),
      pokemon.level,
      pokemon.individualValues,
      pokemon.effortValues,
      pokemon.nature,
    )
    pokemon.currentHp = pokemon.stats.hp
    return pokemon
  })
  return {
    trainerId: 0,
    spriteId: 11,
    language,
    gameVersion,
    gender: 'male',
    name: trainerName,
    introMessage: { bank: 0, messageId: 3, fields: [1119, 0xffff] },
    winMessage: { bank: 1, messageId: 7, fields: [1114, 0xffff] },
    loseMessage: { bank: 2, messageId: 9, fields: [1079, 0xffff] },
    party,
  }
}

export function getHgssTrainerHouseEntry(
  entries: readonly (HgssTrainerHouseEntry | undefined)[],
  trainerNumber: number,
  catalog: PokemonCatalog,
  trainerName: string,
  language: number,
  gameVersion: number,
): HgssTrainerHouseEntry | undefined {
  if (trainerNumber === hgssDefaultTrainerHouseSlot) {
    return createHgssDefaultTrainerHouseEntry(catalog, trainerName, language, gameVersion)
  }
  return entries[trainerNumber] && cloneHgssTrainerHouseEntry(entries[trainerNumber])
}
