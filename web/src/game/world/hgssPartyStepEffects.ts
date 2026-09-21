import type { HgssItemCatalog } from '../../rom/items/itemData'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { isHgssFieldPoisoned, surviveHgssFieldPoisoning } from '../pokemon/hgssFieldPoison'
import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import type { FieldScriptState } from '../scripts/fieldScriptRunner'

export const hgssFieldPoisonStepInterval = 4
export const hgssWalkingFriendshipStepInterval = 128

const hgssLuxuryBallId = 11
const hgssFriendshipUpHoldEffect = 53

export type HgssFieldPoisonSurvivor = {
  slot: number
  friendshipBefore: number
  friendshipAfter: number
}

export type HgssFieldPoisonStepResult = {
  /** Vrai uniquement lorsque le compteur natif atteint son quatrième pas. */
  triggered: boolean
  effect: 'none' | 'damage' | 'survive'
  affectedSlots: number[]
  survivors: HgssFieldPoisonSurvivor[]
}

export type HgssWalkingFriendshipGain = {
  slot: number
  friendshipBefore: number
  friendshipAfter: number
}

export type HgssWalkingFriendshipStepResult = {
  /** Vrai uniquement lorsque le compteur SaveVarsFlags atteint 128 pas. */
  triggered: boolean
  gains: HgssWalkingFriendshipGain[]
}

function applyFieldPoisonSurvivalFriendship(pokemon: CanonicalPokemon): Omit<HgssFieldPoisonSurvivor, 'slot'> {
  const friendshipBefore = pokemon.friendship
  const loss = friendshipBefore >= 200 ? 10 : 5
  pokemon.friendship = Math.max(0, friendshipBefore - loss)
  return { friendshipBefore, friendshipAfter: pokemon.friendship }
}

/**
 * Porte FieldSystem_UpdatePoison/ApplyPoisonStep : le compteur avance à chaque
 * pas terrain processable et les dégâts ne peuvent jamais mettre un Pokémon K.O.
 * La guérison des survivants reste une phase séparée, comme le script standard
 * `std_survive_poisoning` de la ROM.
 */
export function advanceHgssFieldPoisonStep(state: FieldScriptState): HgssFieldPoisonStepResult {
  state.poisonStepCounter = (state.poisonStepCounter + 1) % hgssFieldPoisonStepInterval
  if (state.poisonStepCounter !== 0) {
    return { triggered: false, effect: 'none', affectedSlots: [], survivors: [] }
  }

  const affectedSlots: number[] = []
  const survivors: HgssFieldPoisonSurvivor[] = []
  state.party.members.forEach((pokemon, slot) => {
    if (pokemon.isEgg || pokemon.currentHp <= 0 || !isHgssFieldPoisoned(pokemon)) return
    affectedSlots.push(slot)
    if (pokemon.currentHp > 1) pokemon.currentHp -= 1
    if (pokemon.currentHp !== 1) return
    survivors.push({ ...applyFieldPoisonSurvivalFriendship(pokemon), slot })
  })

  return {
    triggered: true,
    effect: survivors.length > 0 ? 'survive' : affectedSlots.length > 0 ? 'damage' : 'none',
    affectedSlots,
    survivors,
  }
}

/**
 * Porte ScrCmd_SurvivePoisoning. Le script ROM parcourt de nouveau toute
 * l'équipe et remet à zéro le statut de chaque Pokémon empoisonné resté à 1 PV.
 */
export function cureHgssFieldPoisonSurvivors(state: FieldScriptState): number[] {
  const curedSlots: number[] = []
  state.party.members.forEach((pokemon, slot) => {
    if (!surviveHgssFieldPoisoning(pokemon)) return
    curedSlots.push(slot)
  })
  return curedSlots
}

/**
 * Porte FieldSystem_UpdateFriendship/FieldSystem_CalculateFriendship. À
 * l'échéance, LCRandom est consommé une fois par slot avant même le test Œuf,
 * puis le gain natif est appliqué indépendamment avec une chance sur deux.
 */
export function advanceHgssWalkingFriendshipStep(options: {
  state: FieldScriptState
  mapSectionId: number
  rng: HgssLcrng
  itemCatalog?: HgssItemCatalog
}): HgssWalkingFriendshipStepResult {
  const { state, mapSectionId, rng, itemCatalog } = options
  if (!Number.isInteger(mapSectionId) || mapSectionId < 0 || mapSectionId > 0xffff) {
    throw new Error(`La section de carte HGSS ${mapSectionId} est invalide.`)
  }

  state.friendshipStepCounter += 1
  if (state.friendshipStepCounter < hgssWalkingFriendshipStepInterval) {
    return { triggered: false, gains: [] }
  }
  state.friendshipStepCounter = 0

  const gains: HgssWalkingFriendshipGain[] = []
  state.party.members.forEach((pokemon, slot) => {
    if ((rng.nextU16() & 1) !== 0 || pokemon.isEgg || pokemon.speciesId === 0) return

    const friendshipBefore = pokemon.friendship
    let gain = 1
    if (pokemon.ballId === hgssLuxuryBallId) gain += 1
    // La ROM consulte MON_DATA_EGG_LOCATION, y compris pour cet événement de marche.
    if ((pokemon.origin.eggLocation ?? 0) === mapSectionId) gain += 1
    if (itemCatalog?.items[pokemon.heldItemId]?.holdEffect === hgssFriendshipUpHoldEffect) {
      gain = Math.floor(gain * 150 / 100)
    }
    pokemon.friendship = Math.min(255, friendshipBefore + gain)
    if (pokemon.friendship !== friendshipBefore) {
      gains.push({ slot, friendshipBefore, friendshipAfter: pokemon.friendship })
    }
  })
  return { triggered: true, gains }
}
