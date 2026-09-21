import type { PokemonCatalog } from '../../ndsTypes'
import type { HgssItemCatalog } from '../../rom/items/itemData'
import type { HgssNpcTrade } from '../../rom/pokemon/npcTradeData'
import { calculateLevelFromExperience, getExperienceForLevel } from '../../rom/pokemon/growthTable'
import type { CanonicalPokemon, PokemonTrainerIdentity } from '../pokemon/canonicalPokemon'
import {
  calculatePokemonStats,
  getAbilityFromPersonality,
  getGenderFromPersonality,
  getNatureFromPersonality,
  isShinyPersonality,
  resolvePokemonPersonalData,
  type PokemonStatValues,
} from '../pokemon/pokemonFormulas'
import {
  parseHgssP2pTradePokemonSnapshot,
  type HgssP2pTradePokemonSnapshot,
} from './hgssP2pTradeProtocol'

export type HgssP2pTradePokemonLocalContext = Readonly<{
  catalog: PokemonCatalog
  trainer: PokemonTrainerIdentity
  npcTradeCatalog?: readonly HgssNpcTrade[]
  itemCatalog?: HgssItemCatalog
  /** Libellé résolu localement; il ne traverse jamais le réseau. */
  eggDisplayName?: string
}>

function findLocalTradeForPokemon(
  pokemon: CanonicalPokemon,
  catalog: readonly HgssNpcTrade[] | undefined,
): HgssNpcTrade | undefined {
  const explicitId = pokemon.originalTrainer.localTradeId
  if (explicitId !== undefined) return catalog?.find(({ tradeId }) => tradeId === explicitId)
  return catalog?.find((trade) => (
    trade.givenSpeciesId === pokemon.speciesId
    && trade.originalTrainerId === pokemon.originalTrainer.id
    && trade.originalTrainerGender === pokemon.originalTrainer.gender
    && (trade.nickname === pokemon.nickname || trade.originalTrainerName === pokemon.originalTrainer.name)
  ))
}

function projectOriginalTrainer(
  pokemon: CanonicalPokemon,
  context: HgssP2pTradePokemonLocalContext,
): HgssP2pTradePokemonSnapshot['originalTrainer'] {
  const trainer = pokemon.originalTrainer
  const localTrade = findLocalTradeForPokemon(pokemon, context.npcTradeCatalog)
  if (trainer.nameSource === 'local-ref' || trainer.localTradeId !== undefined) {
    if (!localTrade) throw new Error("La reference locale de l'OT est absente de la ROM.")
    return { id: trainer.id, gender: trainer.gender, localTradeId: localTrade.tradeId }
  }
  const belongsToLocalPlayer = trainer.id === context.trainer.id
    && trainer.gender === context.trainer.gender
    && trainer.name === context.trainer.name
  if (trainer.nameSource !== 'user-text' && !belongsToLocalPlayer) {
    if (localTrade) return { id: trainer.id, gender: trainer.gender, localTradeId: localTrade.tradeId }
    throw new Error("Le nom de l'OT n'a pas de provenance utilisateur ou de reference ROM locale.")
  }
  return {
    id: trainer.id,
    gender: trainer.gender,
    name: trainer.name,
    nameSource: 'user-text',
  }
}

function projectNickname(
  pokemon: CanonicalPokemon,
  localTrade: HgssNpcTrade | undefined,
): Pick<HgssP2pTradePokemonSnapshot, 'nickname' | 'nicknameSource' | 'nicknameLocalRef'> {
  if (pokemon.nicknameSource === 'user-text') {
    if (!pokemon.nickname) throw new Error('Le surnom utilisateur du Pokemon est vide.')
    return { nickname: pokemon.nickname, nicknameSource: 'user-text' }
  }
  if (pokemon.nicknameSource === 'local-ref') {
    const nicknameLocalRef = pokemon.nicknameLocalRef
      ?? (pokemon.isEgg ? 0 : localTrade === undefined ? undefined : localTrade.tradeId + 1)
    if (nicknameLocalRef === undefined) throw new Error('La reference locale du surnom Pokemon est absente.')
    return { nicknameLocalRef }
  }
  if (pokemon.nickname === undefined || pokemon.nickname === pokemon.speciesName) return {}
  if (pokemon.isEgg) return { nicknameLocalRef: 0 }
  if (localTrade?.nickname === pokemon.nickname) return { nicknameLocalRef: localTrade.tradeId + 1 }
  throw new Error("Le surnom Pokemon n'a pas de provenance portable attestee.")
}

/** Projette le PK4 fonctionnel sans aucun nom, sprite ou ressource provenant de la ROM. */
export function snapshotCanonicalPokemonForP2pTrade(
  pokemon: CanonicalPokemon,
  context: HgssP2pTradePokemonLocalContext,
): HgssP2pTradePokemonSnapshot {
  const localTrade = findLocalTradeForPokemon(pokemon, context.npcTradeCatalog)
  const projected = {
    instanceId: pokemon.instanceId,
    speciesId: pokemon.speciesId,
    ...projectNickname(pokemon, localTrade),
    form: pokemon.form,
    personality: pokemon.personality,
    originalTrainer: projectOriginalTrainer(pokemon, context),
    origin: {
      language: pokemon.origin.language,
      gameVersion: pokemon.origin.gameVersion,
      metLocation: pokemon.origin.metLocation,
      metLevel: pokemon.origin.metLevel,
      metTerrain: pokemon.origin.metTerrain,
      ...(pokemon.origin.metDate ? { metDate: { ...pokemon.origin.metDate } } : {}),
      ...(pokemon.origin.eggLocation === undefined ? {} : { eggLocation: pokemon.origin.eggLocation }),
      ...(pokemon.origin.eggDate ? { eggDate: { ...pokemon.origin.eggDate } } : {}),
    },
    level: pokemon.level,
    experience: pokemon.experience,
    individualValues: { ...pokemon.individualValues },
    effortValues: { ...pokemon.effortValues },
    nature: pokemon.nature,
    gender: pokemon.gender,
    abilityId: pokemon.abilityId,
    shiny: pokemon.shiny,
    friendship: pokemon.friendship,
    moves: pokemon.moves.map(({ moveId, pp, maxPp, ppUps }) => ({ moveId, pp, maxPp, ppUps })),
    stats: { ...pokemon.stats },
    currentHp: pokemon.currentHp,
    status: pokemon.status,
    heldItemId: pokemon.heldItemId,
    ...(pokemon.mailIdentity === 'kenya' ? { mailIdentityCode: 1 } : {}),
    ballId: pokemon.ballId,
    isEgg: pokemon.isEgg,
    fatefulEncounter: pokemon.fatefulEncounter,
    shinyLeafMask: pokemon.shinyLeafMask,
    contestValues: [...(pokemon.contestValues ?? [0, 0, 0, 0, 0, 0])] as [number, number, number, number, number, number],
    ribbonIds: [...pokemon.ribbonIds],
  }
  const parsed = parseHgssP2pTradePokemonSnapshot(projected)
  if (!parsed) throw new Error("Le Pokemon local ne peut pas etre projete pour l'echange P2P.")
  return parsed
}

function statsEqual(left: PokemonStatValues, right: PokemonStatValues): boolean {
  return left.hp === right.hp
    && left.attack === right.attack
    && left.defense === right.defense
    && left.speed === right.speed
    && left.specialAttack === right.specialAttack
    && left.specialDefense === right.specialDefense
}

function requireLocalTrade(
  tradeId: number,
  context: HgssP2pTradePokemonLocalContext,
): HgssNpcTrade {
  const trade = context.npcTradeCatalog?.find((candidate) => candidate.tradeId === tradeId)
  if (!trade) throw new Error(`La reference d'echange local ${tradeId} est absente de la ROM.`)
  return trade
}

function validateDerivedPokemonData(
  pokemon: HgssP2pTradePokemonSnapshot,
  context: HgssP2pTradePokemonLocalContext,
): void {
  const basePersonal = context.catalog.personalData[pokemon.speciesId]
  const speciesName = context.catalog.speciesNames[pokemon.speciesId]
  if (!basePersonal || !speciesName) throw new Error(`L'espece locale ${pokemon.speciesId} est absente de la ROM.`)
  const formPersonal = resolvePokemonPersonalData(context.catalog, pokemon.speciesId, pokemon.form)
  const growth = context.catalog.growthTables[basePersonal.growthRate]
  if (!growth) throw new Error(`La courbe de croissance locale ${basePersonal.growthRate} est absente de la ROM.`)
  if (
    getNatureFromPersonality(pokemon.personality) !== pokemon.nature
    || getGenderFromPersonality(basePersonal, pokemon.personality) !== pokemon.gender
    || getAbilityFromPersonality(formPersonal, pokemon.personality) !== pokemon.abilityId
    || isShinyPersonality(pokemon.originalTrainer.id, pokemon.personality) !== pokemon.shiny
    || calculateLevelFromExperience(growth, pokemon.experience) !== pokemon.level
    || pokemon.experience > getExperienceForLevel(growth, 100)
  ) throw new Error("Les donnees derivees du Pokemon distant sont incoherentes.")

  const expectedStats = calculatePokemonStats(
    formPersonal,
    pokemon.level,
    pokemon.individualValues,
    pokemon.effortValues,
    pokemon.nature,
  )
  if (!statsEqual(expectedStats, pokemon.stats)) {
    throw new Error('Les statistiques du Pokemon distant sont incoherentes avec la ROM locale.')
  }

  const moveIds = new Set<number>()
  for (const move of pokemon.moves) {
    const data = context.catalog.moves[move.moveId]
    if (!data || moveIds.has(move.moveId)) throw new Error(`La capacite distante ${move.moveId} est invalide.`)
    moveIds.add(move.moveId)
    if (data.pp < 5 && move.ppUps !== 0) throw new Error(`Les PP Up de la capacite ${move.moveId} sont invalides.`)
    const expectedMaximum = Math.floor(data.pp * (5 + move.ppUps) / 5)
    if (move.maxPp !== expectedMaximum) throw new Error(`Les PP maximum de la capacite ${move.moveId} sont invalides.`)
  }

  if (context.itemCatalog) {
    if (pokemon.heldItemId !== 0 && !context.itemCatalog.items[pokemon.heldItemId]) {
      throw new Error(`L'objet tenu distant ${pokemon.heldItemId} est absent de la ROM locale.`)
    }
    if (pokemon.ballId !== 0 && !context.itemCatalog.items[pokemon.ballId]) {
      throw new Error(`La Ball distante ${pokemon.ballId} est absente de la ROM locale.`)
    }
  }
}

/**
 * Recompose un Pokémon canonique avec les catalogues de la ROM du destinataire
 * et refuse les champs dérivés falsifiés avant toute mutation de sauvegarde.
 */
export function materializeCanonicalPokemonFromP2pTrade(
  value: unknown,
  context: HgssP2pTradePokemonLocalContext,
): CanonicalPokemon {
  const pokemon = parseHgssP2pTradePokemonSnapshot(value)
  if (!pokemon) throw new Error("Le Pokemon recu pour l'echange P2P est invalide.")
  validateDerivedPokemonData(pokemon, context)

  const speciesName = context.catalog.speciesNames[pokemon.speciesId]!
  const localTrade = pokemon.originalTrainer.localTradeId === undefined
    ? undefined
    : requireLocalTrade(pokemon.originalTrainer.localTradeId, context)
  if (localTrade && (
    localTrade.givenSpeciesId !== pokemon.speciesId
    || localTrade.originalTrainerId !== pokemon.originalTrainer.id
    || localTrade.originalTrainerGender !== pokemon.originalTrainer.gender
  )) throw new Error("La reference locale de l'OT ne correspond pas au Pokemon recu.")

  let nickname: string | undefined
  let nicknameSource: CanonicalPokemon['nicknameSource']
  if (pokemon.nicknameSource === 'user-text') {
    nickname = pokemon.nickname
    nicknameSource = 'user-text'
  } else if (pokemon.nicknameLocalRef === 0) {
    if (!pokemon.isEgg) throw new Error("La reference de surnom Oeuf vise un Pokemon qui n'est pas un oeuf.")
    nickname = context.eggDisplayName ?? 'ŒUF'
    nicknameSource = 'local-ref'
  } else if (pokemon.nicknameLocalRef !== undefined) {
    const nicknameTrade = requireLocalTrade(pokemon.nicknameLocalRef - 1, context)
    if (nicknameTrade.givenSpeciesId !== pokemon.speciesId) {
      throw new Error('La reference locale du surnom ne correspond pas au Pokemon recu.')
    }
    nickname = nicknameTrade.nickname
    nicknameSource = 'local-ref'
  }

  const originalTrainerName = localTrade?.originalTrainerName ?? pokemon.originalTrainer.name
  if (!originalTrainerName) throw new Error("Le nom de l'OT distant ne peut pas etre resolu localement.")
  const originalTrainerIsPlayer = !localTrade
    && pokemon.originalTrainer.id === context.trainer.id
    && pokemon.originalTrainer.gender === context.trainer.gender
    && originalTrainerName === context.trainer.name

  return {
    instanceId: pokemon.instanceId,
    speciesId: pokemon.speciesId,
    speciesName,
    ...(nickname === undefined ? {} : { nickname }),
    ...(nicknameSource === undefined ? {} : { nicknameSource }),
    ...(pokemon.nicknameLocalRef === undefined ? {} : { nicknameLocalRef: pokemon.nicknameLocalRef }),
    form: pokemon.form,
    personality: pokemon.personality,
    originalTrainer: {
      id: pokemon.originalTrainer.id,
      name: originalTrainerName,
      gender: pokemon.originalTrainer.gender,
      isPlayer: originalTrainerIsPlayer,
      nameSource: localTrade ? 'local-ref' : 'user-text',
      ...(localTrade ? { localTradeId: localTrade.tradeId } : {}),
    },
    origin: {
      ...pokemon.origin,
      ...(pokemon.origin.metDate ? { metDate: { ...pokemon.origin.metDate } } : {}),
      ...(pokemon.origin.eggDate ? { eggDate: { ...pokemon.origin.eggDate } } : {}),
    },
    level: pokemon.level,
    experience: pokemon.experience,
    individualValues: { ...pokemon.individualValues },
    effortValues: { ...pokemon.effortValues },
    nature: pokemon.nature,
    gender: pokemon.gender,
    abilityId: pokemon.abilityId,
    shiny: pokemon.shiny,
    friendship: pokemon.friendship,
    moves: pokemon.moves.map((move) => ({ ...move, data: context.catalog.moves[move.moveId]! })),
    stats: { ...pokemon.stats },
    currentHp: pokemon.currentHp,
    status: pokemon.status,
    heldItemId: pokemon.heldItemId,
    ...(pokemon.mailIdentityCode === 1 ? { mailIdentity: 'kenya' as const } : {}),
    ballId: pokemon.ballId,
    isEgg: pokemon.isEgg,
    fatefulEncounter: pokemon.fatefulEncounter,
    shinyLeafMask: pokemon.shinyLeafMask,
    contestValues: [...pokemon.contestValues],
    ribbonIds: [...pokemon.ribbonIds],
  }
}
