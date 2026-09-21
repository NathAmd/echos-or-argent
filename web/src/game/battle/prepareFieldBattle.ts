import type { PokemonCatalog } from '../../ndsTypes'
import type { HgssTrainer, HgssTrainerPokemon } from '../../rom/battle/trainerData'
import type { FieldScriptBattle } from '../scripts/fieldScriptRunner'
import { cloneCanonicalPokemon, type CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { clonePokemonParty, type PokemonParty } from '../pokemon/pokemonParty'
import { createTrainerParty, type CreatedTrainerPartyMember, type TrainerPartyOrigin } from './createTrainerParty'
import { getHgssTrainerHouseEntry, type HgssTrainerHouseEntry } from '../trainerHouse/hgssTrainerHouse'
import { calculatePokemonStats, resolvePokemonPersonalData } from '../pokemon/pokemonFormulas'
import { getExperienceForLevel } from '../../rom/pokemon/growthTable'
import { baseFieldBattleRosterPolicy, type FieldBattleRosterPolicy, type FieldTrainerRosterContext } from './fieldBattleRosterPolicy'

export type PreparedBattlePokemon = {
  speciesId: number
  speciesName: string
  level: number
  form: number
  heldItemId?: number
  moveIds?: readonly [number, number, number, number]
}

export type PreparedFieldBattle =
  | { kind: 'trainer', script: Extract<FieldScriptBattle, { kind: 'trainer' }>, trainer: HgssTrainer, playerParty: PokemonParty, party: PreparedBattlePokemon[], createdParty: CreatedTrainerPartyMember[] }
  | {
      kind: 'tagTrainer'
      script: Extract<FieldScriptBattle, { kind: 'trainer' }>
      opponentTrainers: readonly [HgssTrainer, HgssTrainer]
      playerParty: PokemonParty
      opponentParty: PreparedBattlePokemon[]
      createdOpponentParty: CreatedTrainerPartyMember[]
    }
  | {
      kind: 'multiTrainer'
      script: Extract<FieldScriptBattle, { kind: 'multiTrainer' }>
      allyTrainer: HgssTrainer
      opponentTrainers: readonly [HgssTrainer, HgssTrainer]
      playerParty: PokemonParty
      allyParty: PreparedBattlePokemon[]
      opponentParty: PreparedBattlePokemon[]
      createdAllyParty: CreatedTrainerPartyMember[]
      createdOpponentParty: CreatedTrainerPartyMember[]
    }
  | { kind: 'wild', script: Extract<FieldScriptBattle, { kind: 'wild' }>, playerParty: PokemonParty, battleParameter: number, party: readonly [PreparedBattlePokemon] }
  | { kind: 'tutorial', script: Extract<FieldScriptBattle, { kind: 'tutorial' }>, playerParty: PokemonParty, party: readonly [] }
  | { kind: 'trainerHouse', script: Extract<FieldScriptBattle, { kind: 'trainerHouse' }>, trainer: HgssTrainerHouseEntry, playerParty: PokemonParty, party: PreparedBattlePokemon[] }

export type FieldBattlePreparationContext = {
  playerParty: PokemonParty
  origin: TrainerPartyOrigin
  trainerHouseEntries?: readonly (HgssTrainerHouseEntry | undefined)[]
  trainerHouseDefaultName?: string
  rosterPolicy?: FieldBattleRosterPolicy
}

function resolveTrainerRoster(
  trainer: HgssTrainer,
  context: FieldTrainerRosterContext,
  policy: FieldBattleRosterPolicy,
): HgssTrainer {
  const party = policy.transformTrainerParty(trainer.party, context).map((pokemon): HgssTrainerPokemon => ({
    ...pokemon,
    moveIds: pokemon.moveIds && [...pokemon.moveIds] as [number, number, number, number],
  }))
  if (party.length < 1 || party.length > 6) {
    throw new Error(`La politique d'equipe du Dresseur ${trainer.trainerId} produit ${party.length} Pokemon au lieu de 1 a 6.`)
  }
  return { ...trainer, partySize: party.length, party }
}

function resolveTrainerHouseRoster(
  trainer: HgssTrainerHouseEntry,
  trainerHouseSlot: number,
  catalog: PokemonCatalog,
  policy: FieldBattleRosterPolicy,
): HgssTrainerHouseEntry {
  const input = trainer.party.map(cloneCanonicalPokemon)
  const transformed = policy.transformTrainerHouseParty(input, {
    battleKind: 'trainer-house',
    role: 'opponent',
    trainerId: trainer.trainerId,
    trainerHouseSlot,
  })
  if (transformed.length < 1 || transformed.length > 6) {
    throw new Error(`La politique d'equipe de la Maison des Dresseurs ${trainerHouseSlot} produit ${transformed.length} Pokemon au lieu de 1 a 6.`)
  }
  const party = transformed.map((pokemon) => cloneCanonicalPokemon(pokemon))
  const instanceIds = new Set<string>()
  for (const pokemon of party) {
    validateTrainerHousePokemon(pokemon, catalog)
    if (instanceIds.has(pokemon.instanceId)) {
      throw new Error(`La politique d'equipe de la Maison des Dresseurs ${trainerHouseSlot} duplique l'identifiant ${pokemon.instanceId}.`)
    }
    instanceIds.add(pokemon.instanceId)
  }
  return { ...trainer, party }
}

function clampTrainerHousePokemonLevel(pokemon: PokemonParty['members'][number], catalog: PokemonCatalog): void {
  if (pokemon.level <= 50) return
  const personalData = resolvePokemonPersonalData(catalog, pokemon.speciesId, pokemon.form)
  const growthTable = catalog.growthTables[personalData.growthRate]
  if (!growthTable) throw new Error(`La courbe de croissance ROM ${personalData.growthRate} est absente.`)
  const hpLost = pokemon.stats.hp - pokemon.currentHp
  pokemon.level = 50
  pokemon.experience = getExperienceForLevel(growthTable, 50)
  pokemon.stats = calculatePokemonStats(personalData, 50, pokemon.individualValues, pokemon.effortValues, pokemon.nature)
  pokemon.currentHp = Math.max(0, pokemon.stats.hp - hpLost)
}

function preparePokemon(
  pokemon: { speciesId: number, level: number, form?: number, heldItemId?: number, moveIds?: readonly [number, number, number, number] },
  catalog: PokemonCatalog,
): PreparedBattlePokemon {
  const speciesName = catalog.speciesNames[pokemon.speciesId]
  if (!speciesName || !catalog.personalData[pokemon.speciesId]) {
    throw new Error(`L'espece ROM ${pokemon.speciesId} de la rencontre est absente du catalogue Pokemon.`)
  }
  if (!Number.isInteger(pokemon.level) || pokemon.level < 1 || pokemon.level > 100) {
    throw new Error(`Le niveau ROM ${pokemon.level} de ${speciesName} est invalide.`)
  }
  for (const moveId of pokemon.moveIds ?? []) {
    if (moveId !== 0 && !catalog.moves[moveId]) throw new Error(`La capacite ROM ${moveId} de ${speciesName} est absente.`)
  }
  return {
    speciesId: pokemon.speciesId,
    speciesName,
    level: pokemon.level,
    form: pokemon.form ?? 0,
    heldItemId: pokemon.heldItemId,
    moveIds: pokemon.moveIds,
  }
}

function validateTrainerHousePokemon(pokemon: CanonicalPokemon, catalog: PokemonCatalog): void {
  const prepared = preparePokemon({
    speciesId: pokemon.speciesId,
    level: pokemon.level,
    form: pokemon.form,
    heldItemId: pokemon.heldItemId,
    moveIds: pokemon.moves.map(({ moveId }) => moveId) as [number, number, number, number],
  }, catalog)
  resolvePokemonPersonalData(catalog, prepared.speciesId, prepared.form)
  if (pokemon.speciesName !== prepared.speciesName) {
    throw new Error(`Le nom canonique ${pokemon.speciesName} ne correspond pas a l'espece ROM ${prepared.speciesId} (${prepared.speciesName}).`)
  }
  if (pokemon.isEgg) {
    throw new Error(`${pokemon.speciesName} est un oeuf et ne peut pas combattre a la Maison des Dresseurs.`)
  }
  if (pokemon.moves.length > 4) {
    throw new Error(`${pokemon.speciesName} possede ${pokemon.moves.length} capacites au lieu de 0 a 4.`)
  }
  for (const move of pokemon.moves) {
    if (move.moveId === 0 || move.data.moveId !== move.moveId) {
      throw new Error(`La capacite canonique ${move.moveId} de ${pokemon.speciesName} est incoherente avec ses donnees ROM.`)
    }
  }
}

export function prepareFieldBattle(
  battle: FieldScriptBattle,
  trainerCatalog: readonly HgssTrainer[],
  pokemonCatalog: PokemonCatalog,
  context: FieldBattlePreparationContext,
): PreparedFieldBattle {
  const playerParty = clonePokemonParty(context.playerParty)
  const rosterPolicy = context.rosterPolicy ?? baseFieldBattleRosterPolicy
  if (battle.kind === 'trainerHouse') {
    playerParty.members.forEach((pokemon) => clampTrainerHousePokemonLevel(pokemon, pokemonCatalog))
    const sourceTrainer = getHgssTrainerHouseEntry(
      context.trainerHouseEntries ?? [],
      battle.trainerNumber,
      pokemonCatalog,
      context.trainerHouseDefaultName ?? '',
      context.origin.language,
      context.origin.gameVersion,
    )
    if (!sourceTrainer || sourceTrainer.party.length === 0) {
      throw new Error(`L’emplacement Maison des Dresseurs HGSS ${battle.trainerNumber} est vide.`)
    }
    const trainer = resolveTrainerHouseRoster(sourceTrainer, battle.trainerNumber, pokemonCatalog, rosterPolicy)
    return {
      kind: 'trainerHouse',
      script: battle,
      trainer,
      playerParty,
      party: trainer.party.map((pokemon) => preparePokemon({
        ...pokemon,
        moveIds: pokemon.moves.map(({ moveId }) => moveId) as [number, number, number, number],
      }, pokemonCatalog)),
    }
  }
  if (battle.kind === 'tutorial') return { kind: 'tutorial', script: battle, playerParty, party: [] }
  if (battle.kind === 'wild') {
    const wild = rosterPolicy.transformScriptedWildPokemon(battle)
    return {
      kind: 'wild',
      script: battle,
      playerParty,
      battleParameter: battle.battleParameter,
      party: [preparePokemon(wild, pokemonCatalog)],
    }
  }
  if (battle.kind === 'multiTrainer') {
    const rawAllyTrainer = trainerCatalog[battle.allyTrainerId]
    const rawOpponentTrainers = battle.opponentTrainerIds.map((trainerId) => trainerCatalog[trainerId])
    if (!rawAllyTrainer) throw new Error(`Le dresseur allié ROM ${battle.allyTrainerId} est absent du catalogue.`)
    if (rawAllyTrainer.party.length === 0) throw new Error(`Le dresseur allié ROM ${battle.allyTrainerId} ne contient aucun Pokemon.`)
    if (!rawOpponentTrainers[0] || !rawOpponentTrainers[1]) {
      throw new Error(`Le duo de dresseurs ROM ${battle.opponentTrainerIds.join('/')} est incomplet.`)
    }
    if (rawOpponentTrainers.some((trainer) => trainer.party.length === 0)) {
      throw new Error(`Le duo de dresseurs ROM ${battle.opponentTrainerIds.join('/')} contient une équipe vide.`)
    }
    const allyTrainer = resolveTrainerRoster(rawAllyTrainer, { battleKind: 'multi-trainer', role: 'ally', trainerId: rawAllyTrainer.trainerId }, rosterPolicy)
    const opponentTrainers = rawOpponentTrainers.map((trainer) => resolveTrainerRoster(trainer, { battleKind: 'multi-trainer', role: 'opponent', trainerId: trainer.trainerId }, rosterPolicy))
    const createdAllyParty = createTrainerParty(allyTrainer, pokemonCatalog, context.origin)
    const createdOpponentParty = opponentTrainers.flatMap((trainer) => createTrainerParty(trainer, pokemonCatalog, context.origin))
    return {
      kind: 'multiTrainer',
      script: battle,
      allyTrainer,
      opponentTrainers: opponentTrainers as [HgssTrainer, HgssTrainer],
      playerParty,
      allyParty: allyTrainer.party.map((pokemon) => preparePokemon(pokemon, pokemonCatalog)),
      opponentParty: opponentTrainers.flatMap((trainer) => trainer.party.map((pokemon) => preparePokemon(pokemon, pokemonCatalog))),
      createdAllyParty,
      createdOpponentParty,
    }
  }
  if (battle.trainerParameter !== 0 && battle.trainerParameter !== battle.trainerId) {
    const rawOpponentTrainers = [trainerCatalog[battle.trainerId], trainerCatalog[battle.trainerParameter]] as const
    if (!rawOpponentTrainers[0] || !rawOpponentTrainers[1]) {
      throw new Error(`Le duo de Dresseurs ROM ${battle.trainerId}/${battle.trainerParameter} est incomplet.`)
    }
    if (rawOpponentTrainers.some((trainer) => trainer.party.length === 0)) {
      throw new Error(`Le duo de Dresseurs ROM ${battle.trainerId}/${battle.trainerParameter} contient une équipe vide.`)
    }
    const opponentTrainers = rawOpponentTrainers.map((trainer) => resolveTrainerRoster(trainer, { battleKind: 'tag-trainer', role: 'opponent', trainerId: trainer.trainerId }, rosterPolicy)) as [HgssTrainer, HgssTrainer]
    return {
      kind: 'tagTrainer',
      script: battle,
      opponentTrainers,
      playerParty,
      opponentParty: opponentTrainers.flatMap((trainer) => trainer.party.map((pokemon) => preparePokemon(pokemon, pokemonCatalog))),
      createdOpponentParty: opponentTrainers.flatMap((trainer) => createTrainerParty(trainer, pokemonCatalog, context.origin)),
    }
  }
  const rawTrainer = trainerCatalog[battle.trainerId]
  if (!rawTrainer) throw new Error(`Le dresseur ROM ${battle.trainerId} est absent du catalogue.`)
  if (rawTrainer.party.length === 0) throw new Error(`Le dresseur ROM ${battle.trainerId} ne contient aucun Pokemon.`)
  const trainer = resolveTrainerRoster(rawTrainer, { battleKind: 'trainer', role: 'opponent', trainerId: rawTrainer.trainerId }, rosterPolicy)
  return {
    kind: 'trainer',
    script: battle,
    trainer,
    playerParty,
    party: trainer.party.map((pokemon) => preparePokemon(pokemon, pokemonCatalog)),
    createdParty: createTrainerParty(trainer, pokemonCatalog, context.origin),
  }
}

export function formatPreparedFieldBattle(battle: PreparedFieldBattle): string {
  if (battle.kind === 'tutorial') return 'Combat tutoriel ROM pret'
  if (battle.kind === 'trainerHouse') {
    const roster = battle.party.map((pokemon) => `${pokemon.speciesName} Nv.${pokemon.level}`).join(', ')
    return `Combat Maison des Dresseurs ROM contre ${battle.trainer.name} prêt : ${roster}`
  }
  if (battle.kind === 'multiTrainer') {
    const roster = battle.opponentParty.map((pokemon) => `${pokemon.speciesName} Nv.${pokemon.level}`).join(', ')
    return `Combat multi ROM ${battle.opponentTrainers.map(({ trainerId }) => trainerId).join('/')} avec allié ${battle.allyTrainer.trainerId} prêt : ${roster}`
  }
  if (battle.kind === 'tagTrainer') {
    const roster = battle.opponentParty.map((pokemon) => `${pokemon.speciesName} Nv.${pokemon.level}`).join(', ')
    return `Combat duo ROM ${battle.opponentTrainers.map(({ trainerId }) => trainerId).join('/')} prêt : ${roster}`
  }
  const roster = battle.party.map((pokemon) => `${pokemon.speciesName} Nv.${pokemon.level}`).join(', ')
  return battle.kind === 'trainer'
    ? `Combat dresseur ROM ${battle.trainer.trainerId} pret : ${roster}`
    : `Combat sauvage ROM pret : ${roster}`
}
