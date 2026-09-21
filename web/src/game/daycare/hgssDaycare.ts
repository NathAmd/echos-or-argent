import type { PokemonCatalog } from '../../ndsTypes'
import { getHgssTmHmMoveId } from '../../rom/items/itemData'
import { calculateLevelFromExperience, getExperienceForLevel } from '../../rom/pokemon/growthTable'
import { cloneCanonicalPokemon, createCanonicalPokemon, type CanonicalPokemon, type PokemonTrainerIdentity } from '../pokemon/canonicalPokemon'
import { calculatePokemonStats, isShinyPersonality, resolvePokemonPersonalData, type PokemonStatValues } from '../pokemon/pokemonFormulas'
import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import type { HgssMersenneTwister } from '../pokemon/hgssSessionRng'
import { addPokemonPartyMember, removePokemonPartyMember, type PokemonParty } from '../pokemon/pokemonParty'
import { basePokemonPartyHealingPolicy, healPokemonWithPolicy, type PokemonPartyHealingPolicy } from '../pokemon/pokemonPartyHealingPolicy'
import { assertPokemonPartyMutationAllowed, basePokemonTeamPolicy, type PokemonTeamPolicy } from '../pokemon/pokemonTeamPolicy'
import {
  basePokemonLevelPolicy,
  resolvePokemonLevelCap,
  type PokemonLevelPolicy,
} from '../pokemon/pokemonLevelPolicy'

export type HgssDaycareMon = {
  pokemon: CanonicalPokemon
  steps: number
}

export type HgssDaycareState = {
  mons: Array<HgssDaycareMon | undefined>
  eggPersonality: number
  eggCycleCounter: number
}

export function createHgssDaycareState(): HgssDaycareState {
  return { mons: [undefined, undefined], eggPersonality: 0, eggCycleCounter: 0 }
}

export function cloneHgssDaycareState(state: HgssDaycareState): HgssDaycareState {
  return {
    mons: state.mons.map((entry) => entry && ({ pokemon: cloneCanonicalPokemon(entry.pokemon), steps: entry.steps })),
    eggPersonality: state.eggPersonality,
    eggCycleCounter: state.eggCycleCounter,
  }
}

function requirePersonalData(catalog: PokemonCatalog, speciesId: number) {
  const personal = catalog.personalData[speciesId]
  if (!personal) throw new Error(`Les données personnelles ROM du pensionnaire ${speciesId} sont absentes.`)
  return personal
}

function resolveHgssDaycareGrowth(
  entry: HgssDaycareMon,
  catalog: PokemonCatalog,
  levelPolicy: PokemonLevelPolicy,
): Readonly<{ experience: number, level: number }> {
  const personal = requirePersonalData(catalog, entry.pokemon.speciesId)
  const growth = catalog.growthTables[personal.growthRate]
  if (!growth) throw new Error(`La courbe de croissance ROM ${personal.growthRate} est absente.`)
  const levelCap = resolvePokemonLevelCap(entry.pokemon, 'daycare', levelPolicy)
  const maximumExperience = getExperienceForLevel(growth, levelCap)
  const experience = entry.pokemon.level >= levelCap
    ? entry.pokemon.experience
    : Math.max(
        entry.pokemon.experience,
        Math.min(maximumExperience, 0xffffffff, entry.pokemon.experience + entry.steps),
      )
  const level = Math.max(
    entry.pokemon.level,
    Math.min(levelCap, calculateLevelFromExperience(growth, experience)),
  )
  return { experience, level }
}

export function getHgssDaycareUpdatedLevel(
  entry: HgssDaycareMon,
  catalog: PokemonCatalog,
  levelPolicy: PokemonLevelPolicy = basePokemonLevelPolicy,
): number {
  return resolveHgssDaycareGrowth(entry, catalog, levelPolicy).level
}

export function getHgssDaycareLevelGrowth(
  entry: HgssDaycareMon,
  catalog: PokemonCatalog,
  levelPolicy: PokemonLevelPolicy = basePokemonLevelPolicy,
): number {
  return getHgssDaycareUpdatedLevel(entry, catalog, levelPolicy) - entry.pokemon.level
}

export function getHgssDaycareWithdrawCost(
  entry: HgssDaycareMon,
  catalog: PokemonCatalog,
  levelPolicy: PokemonLevelPolicy = basePokemonLevelPolicy,
): number {
  return (getHgssDaycareLevelGrowth(entry, catalog, levelPolicy) + 1) * 100
}

export function getHgssDaycareSaveState(state: HgssDaycareState): 0 | 1 | 2 | 3 {
  if (state.eggPersonality !== 0) return 1
  const count = state.mons.filter(Boolean).length
  return count === 0 ? 0 : count === 1 ? 2 : 3
}

export function putPokemonInHgssDaycare(
  state: HgssDaycareState,
  party: PokemonParty,
  partySlot: number,
  teamPolicy: PokemonTeamPolicy = basePokemonTeamPolicy,
): CanonicalPokemon {
  if (!Number.isInteger(partySlot) || partySlot < 0 || partySlot >= party.members.length) throw new Error(`Emplacement d’équipe ${partySlot} invalide pour la Pension HGSS.`)
  const daycareSlot = state.mons.findIndex((entry) => entry === undefined)
  if (daycareSlot < 0) throw new Error('Les deux emplacements de la Pension HGSS sont occupés.')
  const pokemon = party.members[partySlot]
  if (!pokemon) throw new Error(`Le Pokémon d’équipe ${partySlot} à déposer est absent.`)
  assertPokemonPartyMutationAllowed('daycare', party.members, party.members.filter((_, index) => index !== partySlot), teamPolicy)
  const removed = removePokemonPartyMember(party, partySlot)
  if (!removed) throw new Error(`Le Pokémon d’équipe ${partySlot} à déposer est absent.`)
  const deposited = cloneCanonicalPokemon(removed)
  if (deposited.speciesId === 492) deposited.form = 0
  state.mons[daycareSlot] = { pokemon: deposited, steps: 0 }
  return deposited
}

function createMove(catalog: PokemonCatalog, moveId: number) {
  const data = catalog.moves[moveId]
  if (!data) throw new Error(`La capacité ROM ${moveId} apprise à la Pension est absente.`)
  return { moveId, pp: data.pp, maxPp: data.pp, ppUps: 0, data }
}

function applyDaycareGrowth(
  entry: HgssDaycareMon,
  catalog: PokemonCatalog,
  levelPolicy: PokemonLevelPolicy,
): CanonicalPokemon {
  const pokemon = cloneCanonicalPokemon(entry.pokemon)
  const personal = requirePersonalData(catalog, pokemon.speciesId)
  const formPersonal = resolvePokemonPersonalData(catalog, pokemon.speciesId, pokemon.form)
  const growth = catalog.growthTables[personal.growthRate]
  if (!growth) throw new Error(`La courbe de croissance ROM ${personal.growthRate} est absente.`)
  const learnset = catalog.levelUpLearnsets[pokemon.speciesId] ?? []
  const growthResult = resolveHgssDaycareGrowth(entry, catalog, levelPolicy)
  pokemon.experience = growthResult.experience
  const targetLevel = growthResult.level
  while (pokemon.level < targetLevel) {
    pokemon.level += 1
    for (const learned of learnset.filter((candidate) => candidate.level === pokemon.level)) {
      if (pokemon.moves.some((move) => move.moveId === learned.moveId)) continue
      if (pokemon.moves.length >= 4) pokemon.moves.shift()
      pokemon.moves.push(createMove(catalog, learned.moveId))
    }
  }
  pokemon.stats = calculatePokemonStats(formPersonal, pokemon.level, pokemon.individualValues, pokemon.effortValues, pokemon.nature)
  return pokemon
}

export function retrievePokemonFromHgssDaycare(
  state: HgssDaycareState,
  party: PokemonParty,
  daycareSlot: number,
  catalog: PokemonCatalog,
  teamPolicy: PokemonTeamPolicy = basePokemonTeamPolicy,
  healingPolicy: PokemonPartyHealingPolicy = basePokemonPartyHealingPolicy,
  levelPolicy: PokemonLevelPolicy = basePokemonLevelPolicy,
): CanonicalPokemon {
  if (party.members.length >= 6) throw new Error('L’équipe HGSS est pleine : retrait de la Pension impossible.')
  const entry = state.mons[daycareSlot]
  if (!entry) throw new Error(`Le pensionnaire HGSS ${daycareSlot} est absent.`)
  const pokemon = applyDaycareGrowth(entry, catalog, levelPolicy)
  healPokemonWithPolicy(pokemon, party.members.length, healingPolicy, 'daycare')
  assertPokemonPartyMutationAllowed('daycare', party.members, [...party.members, pokemon], teamPolicy)
  if (!addPokemonPartyMember(party, pokemon)) throw new Error('L’équipe HGSS est pleine : retrait de la Pension impossible.')
  state.mons[daycareSlot] = undefined
  if (!state.mons[0] && state.mons[1]) {
    state.mons[0] = state.mons[1]
    state.mons[1] = undefined
  }
  return party.members.at(-1)!
}

const eggGroupUndiscovered = 15
const eggGroupDitto = 13

export function getHgssDaycareCompatibilityChance(state: HgssDaycareState, catalog: PokemonCatalog): 0 | 20 | 50 | 70 {
  const first = state.mons[0]?.pokemon
  const second = state.mons[1]?.pokemon
  if (!first || !second) return 0
  const firstData = requirePersonalData(catalog, first.speciesId)
  const secondData = requirePersonalData(catalog, second.speciesId)
  if (firstData.eggGroups[0] === eggGroupUndiscovered || secondData.eggGroups[0] === eggGroupUndiscovered) return 0
  const firstDitto = firstData.eggGroups[0] === eggGroupDitto
  const secondDitto = secondData.eggGroups[0] === eggGroupDitto
  const differentOt = first.originalTrainer.id !== second.originalTrainer.id
  if (firstDitto && secondDitto) return 0
  if (firstDitto || secondDitto) return differentOt ? 50 : 20
  if (first.gender === second.gender || first.gender === 'genderless' || second.gender === 'genderless') return 0
  const matchingGroup = firstData.eggGroups.some((group) => secondData.eggGroups.includes(group))
  if (!matchingGroup) return 0
  if (first.speciesId === second.speciesId) return differentOt ? 70 : 50
  return differentOt ? 50 : 20
}

export function getHgssDaycareCompatibilityMessageIndex(state: HgssDaycareState, catalog: PokemonCatalog): 0 | 1 | 2 | 3 {
  const chance = getHgssDaycareCompatibilityChance(state, catalog)
  return chance === 70 ? 0 : chance === 50 ? 1 : chance === 20 ? 2 : 3
}

function nextPersonality(rng: HgssLcrng): number {
  const value = (rng.nextU16() | rng.nextU16() << 16) >>> 0
  return value === 0 ? 1 : value
}

function generateEggPersonality(state: HgssDaycareState, rng: HgssLcrng, mt?: HgssMersenneTwister): number {
  const everstoneSlots = state.mons.flatMap((entry, slot) => entry?.pokemon.heldItemId === 229 ? [slot] : [])
  let natureSlot: number | undefined
  if (everstoneSlots.length === 2) natureSlot = everstoneSlots[rng.nextU16() % 2]
  else natureSlot = everstoneSlots[0]
  if (natureSlot !== undefined && rng.nextU16() >= 0x7fff) natureSlot = undefined
  const randomPersonality = (): number => mt?.nextU32() ?? nextPersonality(rng)
  if (natureSlot === undefined) {
    const personality = randomPersonality()
    return personality === 0 ? 1 : personality
  }
  const nature = state.mons[natureSlot]!.pokemon.personality % 25
  let personality = 0
  for (let attempt = 0; attempt <= 2400; attempt += 1) {
    personality = randomPersonality()
    if (personality !== 0 && personality % 25 === nature) break
  }
  return personality === 0 ? 1 : personality
}

const eggCycleSpecialDates = new Set([112, 214, 303, 401, 501, 611, 707, 821, 907, 928, 1031, 1121, 1214, 1224, 1225])

export function advanceHgssDaycareStep(
  state: HgssDaycareState,
  catalog: PokemonCatalog,
  rng: HgssLcrng,
  party?: PokemonParty,
  now?: Date,
  mt?: HgssMersenneTwister,
  rtcPenalty = false,
): boolean {
  for (const entry of state.mons) {
    if (entry) entry.steps = Math.min(0xffffffff, entry.steps + 1)
  }
  if (state.eggPersonality === 0 && state.mons[0] && state.mons[1] && (state.mons[1].steps & 0xff) === 0xff) {
    const chance = getHgssDaycareCompatibilityChance(state, catalog)
    if (chance > Math.floor(rng.nextU16() * 100 / 0xffff)) state.eggPersonality = generateEggPersonality(state, rng, mt)
  }
  const cycleLength = now && !rtcPenalty && eggCycleSpecialDates.has((now.getMonth() + 1) * 100 + now.getDate()) ? 230 : 255
  state.eggCycleCounter = (state.eggCycleCounter + 1) & 0xff
  let hatchReady = false
  if (state.eggCycleCounter === cycleLength) {
    state.eggCycleCounter = 0
    if (party) {
      const accelerated = party.members.some((pokemon) => !pokemon.isEgg && (pokemon.abilityId === 40 || pokemon.abilityId === 49))
      const decrement = accelerated ? 2 : 1
      for (const pokemon of party.members) {
        if (!pokemon.isEgg) continue
        // HandleDaycareStep ne lance l'éclosion que lorsqu'un cycle trouve
        // l'Œuf déjà à zéro. Le cycle qui le fait passer à zéro ne suffit pas.
        if (pokemon.friendship === 0) {
          hatchReady = true
          break
        }
        pokemon.friendship = pokemon.friendship >= decrement ? pokemon.friendship - decrement : pokemon.friendship - 1
      }
    }
  }
  return hatchReady
}

function resolveEggParents(state: HgssDaycareState, catalog: PokemonCatalog): {
  parents: readonly [CanonicalPokemon, CanonicalPokemon]
  speciesParent: CanonicalPokemon
  mother: CanonicalPokemon
  father: CanonicalPokemon
} {
  const first = state.mons[0]?.pokemon
  const second = state.mons[1]?.pokemon
  if (!first || !second) throw new Error('Les deux parents HGSS sont requis pour générer un œuf.')
  const parents = [first, second] as const
  let motherIndex = 0
  let fatherIndex = 1
  for (const index of [0, 1] as const) {
    const pokemon = parents[index]
    const isDitto = requirePersonalData(catalog, pokemon.speciesId).eggGroups[0] === eggGroupDitto
    if (isDitto) {
      motherIndex = index ^ 1
      fatherIndex = index
    } else if (pokemon.gender === 'female') {
      motherIndex = index
      fatherIndex = index ^ 1
    }
  }
  const speciesParent = parents[motherIndex]!
  const fatherIsDitto = requirePersonalData(catalog, parents[fatherIndex]!.speciesId).eggGroups[0] === eggGroupDitto
  if (fatherIsDitto && parents[motherIndex]!.gender !== 'female') {
    ;[motherIndex, fatherIndex] = [fatherIndex, motherIndex]
  }
  return { parents, speciesParent, mother: parents[motherIndex]!, father: parents[fatherIndex]! }
}

const incenseBreedingRows = [
  [360, 255, 202], [298, 254, 183], [439, 314, 122],
  [438, 315, 185], [446, 316, 143], [458, 317, 226],
  [406, 318, 315], [440, 319, 113], [433, 320, 358],
] as const

function resolveEggSpecies(state: HgssDaycareState, catalog: PokemonCatalog, personality: number, speciesParent: CanonicalPokemon): number {
  let speciesId = catalog.babySpecies?.[speciesParent.speciesId] ?? speciesParent.speciesId
  if (speciesId === 29) speciesId = personality & 0x8000 ? 32 : 29
  if (speciesId === 314) speciesId = personality & 0x8000 ? 313 : 314
  if (speciesId === 490) speciesId = 489
  const incenseRow = incenseBreedingRows.find(([baby]) => baby === speciesId)
  if (incenseRow) {
    const [, requiredItem, parentSpecies] = incenseRow
    const hasIncense = state.mons.some((entry) => entry?.pokemon.heldItemId === requiredItem)
    if (!hasIncense) speciesId = parentSpecies
  }
  return speciesId
}

const ivKeys = ['hp', 'attack', 'defense', 'speed', 'specialAttack', 'specialDefense'] as const satisfies readonly (keyof PokemonStatValues)[]
const powerItemStat = new Map<number, keyof PokemonStatValues>([
  [294, 'hp'], [289, 'attack'], [290, 'defense'], [293, 'speed'], [291, 'specialAttack'], [292, 'specialDefense'],
])

function inheritEggIvs(egg: CanonicalPokemon, parents: readonly [CanonicalPokemon, CanonicalPokemon], rng: HgssLcrng): void {
  const available = [...ivKeys]
  const inherited: Array<{ stat: keyof PokemonStatValues, parent: 0 | 1 }> = []
  const forced = parents.flatMap((parent, index) => {
    const stat = powerItemStat.get(parent.heldItemId)
    return stat ? [{ stat, parent: index as 0 | 1 }] : []
  })
  if (forced.length > 0) {
    const selected = forced.length === 2 ? forced[rng.nextU16() % 2]! : forced[0]!
    inherited.push(selected)
    available.splice(available.indexOf(selected.stat), 1)
  }
  while (inherited.length < 3) {
    const stat = available.splice(rng.nextU16() % available.length, 1)[0]!
    inherited.push({ stat, parent: (rng.nextU16() % 2) as 0 | 1 })
  }
  for (const { stat, parent } of inherited) egg.individualValues[stat] = parents[parent].individualValues[stat]
}

function appendInheritedMove(pokemon: CanonicalPokemon, catalog: PokemonCatalog, moveId: number): void {
  if (moveId === 0 || pokemon.moves.some((move) => move.moveId === moveId)) return
  if (pokemon.moves.length >= 4) pokemon.moves.shift()
  pokemon.moves.push(createMove(catalog, moveId))
}

function canLearnTmHm(catalog: PokemonCatalog, speciesId: number, form: number, tmHmIndex: number): boolean {
  const personal = resolvePokemonPersonalData(catalog, speciesId, form)
  return (personal.tmHmCompatibility[Math.floor(tmHmIndex / 32)]! & (1 << (tmHmIndex % 32))) !== 0
}

function inheritEggMoves(egg: CanonicalPokemon, father: CanonicalPokemon, mother: CanonicalPokemon, catalog: PokemonCatalog): void {
  const eggMoves = new Set(catalog.eggMoves?.[egg.speciesId] ?? [])
  for (const move of father.moves) {
    if (eggMoves.has(move.moveId)) appendInheritedMove(egg, catalog, move.moveId)
  }
  for (const move of father.moves) {
    for (let tmHmIndex = 0; tmHmIndex < 100; tmHmIndex += 1) {
      if (getHgssTmHmMoveId(328 + tmHmIndex) === move.moveId && canLearnTmHm(catalog, egg.speciesId, egg.form, tmHmIndex)) {
        appendInheritedMove(egg, catalog, move.moveId)
      }
    }
  }
  const motherMoves = new Set(mother.moves.map((move) => move.moveId))
  const levelUpMoves = new Set((catalog.levelUpLearnsets[egg.speciesId] ?? []).map((move) => move.moveId))
  for (const move of father.moves) {
    if (motherMoves.has(move.moveId) && levelUpMoves.has(move.moveId)) appendInheritedMove(egg, catalog, move.moveId)
  }
  if (egg.speciesId === 172 && (father.heldItemId === 236 || mother.heldItemId === 236)) {
    appendInheritedMove(egg, catalog, 344)
  }
}

export function giveHgssDaycareEgg(
  state: HgssDaycareState,
  party: PokemonParty,
  catalog: PokemonCatalog,
  rng: HgssLcrng,
  trainer: PokemonTrainerIdentity,
  language: number,
  gameVersion: number,
  teamPolicy: PokemonTeamPolicy = basePokemonTeamPolicy,
): CanonicalPokemon {
  if (state.eggPersonality === 0) throw new Error('Aucun œuf HGSS n’attend à la Pension.')
  if (party.members.length >= 6) throw new Error('L’équipe HGSS est pleine : réception de l’œuf impossible.')
  const resolvedParents = resolveEggParents(state, catalog)
  let personality = state.eggPersonality
  if (resolvedParents.parents[0].origin.language !== resolvedParents.parents[1].origin.language
    && !isShinyPersonality(trainer.id, personality)) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      personality = (Math.imul(personality, 1812433253) + 1) >>> 0
      if (isShinyPersonality(trainer.id, personality)) break
    }
  }
  const speciesId = resolveEggSpecies(state, catalog, personality, resolvedParents.speciesParent)
  const egg = createCanonicalPokemon(catalog, {
    speciesId,
    level: 1,
    rng,
    personality: { kind: 'fixed', value: personality },
    individualValues: { kind: 'random' },
    originalTrainer: trainer,
    origin: { language, gameVersion, metLocation: 2000, metLevel: 0, metTerrain: 0 },
    form: resolvedParents.mother.form,
    ballId: 4,
    friendship: requirePersonalData(catalog, speciesId).eggCycles,
  })
  egg.isEgg = true
  egg.nickname = 'ŒUF'
  egg.nicknameSource = 'local-ref'
  egg.nicknameLocalRef = 0
  inheritEggIvs(egg, resolvedParents.parents, rng)
  inheritEggMoves(egg, resolvedParents.father, resolvedParents.mother, catalog)
  egg.stats = calculatePokemonStats(resolvePokemonPersonalData(catalog, egg.speciesId, egg.form), egg.level, egg.individualValues, egg.effortValues, egg.nature)
  egg.currentHp = egg.stats.hp
  assertPokemonPartyMutationAllowed('daycare', party.members, [...party.members, egg], teamPolicy)
  if (!addPokemonPartyMember(party, egg)) throw new Error('L’équipe HGSS est pleine : réception de l’œuf impossible.')
  state.eggPersonality = 0
  state.eggCycleCounter = 0
  return party.members.at(-1)!
}
