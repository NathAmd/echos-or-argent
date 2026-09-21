import type { OpeningMapPreview, PokemonCatalog } from '../../ndsTypes'
import type { HgssWildEncounterData } from '../../rom/encounters/wildEncounterData'
import type { HgssPokedexCatalog } from '../../rom/pokedex/pokedexData'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import type { PokemonGender } from '../pokemon/pokemonFormulas'
import type { HgssPokedexState } from './hgssPokedex'

export type HgssPokedexListEntry = {
  speciesId: number
  dexNumber: number
  speciesName: string
  seen: boolean
  caught: boolean
  shinyCaught?: true
}

export type HgssPokedexListFilter = 'all' | 'seen' | 'caught'
export type HgssPokedexListSort = 'number' | 'name'

export type HgssPokedexListQuery = {
  filter?: HgssPokedexListFilter
  sort?: HgssPokedexListSort
  search?: string
}

export type HgssPokedexEntry = HgssPokedexListEntry & {
  typeNames?: readonly [string, string]
  categoryName?: string
  heightLabel?: string
  weightLabel?: string
  description?: string
  forms: readonly number[]
  genders: readonly PokemonGender[]
}

export type HgssPokedexCryRequest = {
  speciesId: number
  form: number
}

export type HgssPokedexPreviewRequest = {
  speciesId: number
  form: number
  gender: PokemonGender
}

export type HgssPokedexAreaMethod =
  | 'morning'
  | 'day'
  | 'night'
  | 'surfing'
  | 'rockSmash'
  | 'oldRod'
  | 'goodRod'
  | 'superRod'
  | 'hoennSound'
  | 'sinnohSound'
  | 'swarm'

export type HgssPokedexAreaEntry = {
  mapSection: number
  label: string
  mapIds: readonly number[]
  methods: readonly HgssPokedexAreaMethod[]
}

const pokedexAreaMethodOrder: readonly HgssPokedexAreaMethod[] = [
  'morning', 'day', 'night', 'surfing', 'rockSmash', 'oldRod', 'goodRod', 'superRod', 'hoennSound', 'sinnohSound', 'swarm',
]

/**
 * Rebuilds the Pokédex area index exclusively from the encounter bank referenced
 * by each decoded map header. Maps sharing the same native map section are
 * grouped exactly once, while retaining every source map for diagnostics.
 */
export function createHgssPokedexAreaEntries(
  speciesId: number,
  maps: readonly OpeningMapPreview[],
  encounterCatalog: readonly HgssWildEncounterData[],
): HgssPokedexAreaEntry[] {
  if (!Number.isInteger(speciesId) || speciesId <= 0) return []
  const grouped = new Map<number, { label: string, mapIds: Set<number>, methods: Set<HgssPokedexAreaMethod> }>()
  const containsSpecies = (slots: readonly { speciesId: number }[]): boolean => slots.some((slot) => slot.speciesId === speciesId)
  for (const map of maps) {
    const bankId = map.header.wildEncounterBank
    if (bankId === 0xff) continue
    const encounters = encounterCatalog[bankId]
    if (!encounters) throw new Error(`La banque ROM de rencontres ${bankId} de la carte ${map.id} est absente.`)
    const methods = new Set<HgssPokedexAreaMethod>()
    if (encounters.rates.walking > 0) {
      if (containsSpecies(encounters.land.morning)) methods.add('morning')
      if (containsSpecies(encounters.land.day)) methods.add('day')
      if (containsSpecies(encounters.land.night)) methods.add('night')
      if (encounters.hoennSoundSpecies.includes(speciesId)) methods.add('hoennSound')
      if (encounters.sinnohSoundSpecies.includes(speciesId)) methods.add('sinnohSound')
      if (encounters.swarm.landSpeciesId === speciesId) methods.add('swarm')
    }
    if (encounters.rates.surfing > 0 && containsSpecies(encounters.surfing)) methods.add('surfing')
    if (encounters.rates.rockSmash > 0 && containsSpecies(encounters.rockSmash)) methods.add('rockSmash')
    if (encounters.rates.oldRod > 0 && containsSpecies(encounters.oldRod)) methods.add('oldRod')
    if (encounters.rates.goodRod > 0 && containsSpecies(encounters.goodRod)) methods.add('goodRod')
    if (encounters.rates.superRod > 0 && containsSpecies(encounters.superRod)) methods.add('superRod')
    if (encounters.swarm.nightFishingSpeciesId === speciesId) {
      if (encounters.rates.goodRod > 0) methods.add('goodRod')
      if (encounters.rates.superRod > 0) methods.add('superRod')
      if (encounters.rates.goodRod > 0 || encounters.rates.superRod > 0) methods.add('night')
    }
    if ((encounters.rates.surfing > 0 && encounters.swarm.surfingSpeciesId === speciesId)
      || ((encounters.rates.oldRod > 0 || encounters.rates.goodRod > 0 || encounters.rates.superRod > 0)
        && encounters.swarm.fishingSpeciesId === speciesId)) {
      methods.add('swarm')
    }
    if (methods.size === 0) continue
    const section = grouped.get(map.header.mapSection) ?? { label: map.label, mapIds: new Set<number>(), methods: new Set<HgssPokedexAreaMethod>() }
    section.mapIds.add(map.id)
    for (const method of methods) section.methods.add(method)
    grouped.set(map.header.mapSection, section)
  }
  return [...grouped.entries()]
    .map(([mapSection, entry]) => ({
      mapSection,
      label: entry.label,
      mapIds: [...entry.mapIds].sort((left, right) => left - right),
      methods: pokedexAreaMethodOrder.filter((method) => entry.methods.has(method)),
    }))
    .sort((left, right) => left.label.localeCompare(right.label, 'fr') || left.mapSection - right.mapSection)
}

/** Reproduit la sélection de forme de ov18_021EDE04 avant PlayCry. */
export function createHgssPokedexCryRequest(
  state: HgssPokedexState,
  speciesId: number,
): HgssPokedexCryRequest | undefined {
  if (!state.seenSpeciesIds.has(speciesId)) return undefined
  let form = state.seenForms.get(speciesId)?.[0] ?? 0
  // Le Pokédex stocke la forme spéciale de Pichu sous la sentinelle 2, puis la
  // reconvertit en forme audio 1 ; les formes mâle/femelle utilisent le cri 0.
  if (speciesId === 172) form = form === 2 ? 1 : 0
  return { speciesId, form }
}

function createHgssPokedexListEntry(
  state: HgssPokedexState,
  pokemonCatalog: PokemonCatalog,
  pokedexCatalog: HgssPokedexCatalog,
  speciesId: number,
): HgssPokedexListEntry | undefined {
  const dexNumber = state.nationalDexEnabled
    ? speciesId <= Math.min(493, pokemonCatalog.speciesNames.length - 1) ? speciesId : 0
    : pokedexCatalog.johtoDexNumbers[speciesId] ?? 0
  const speciesName = pokemonCatalog.speciesNames[speciesId]
  if (dexNumber === 0 || !speciesName) return undefined
  const caught = state.caughtSpeciesIds.has(speciesId)
  const seen = caught || state.seenSpeciesIds.has(speciesId)
  return { speciesId, dexNumber, speciesName: seen ? speciesName : '?????', seen, caught, ...(state.caughtShinySpeciesIds.has(speciesId) ? { shinyCaught: true as const } : {}) }
}

export function createHgssPokedexList(
  state: HgssPokedexState,
  pokemonCatalog: PokemonCatalog,
  pokedexCatalog: HgssPokedexCatalog,
): HgssPokedexListEntry[] {
  const speciesIds = state.nationalDexEnabled
    ? Array.from({ length: Math.min(493, pokemonCatalog.speciesNames.length - 1) }, (_, index) => index + 1)
    : pokedexCatalog.johtoDexNumbers.flatMap((dexNumber, speciesId) => dexNumber > 0 ? [speciesId] : [])
  return speciesIds
    .flatMap((speciesId) => createHgssPokedexListEntry(state, pokemonCatalog, pokedexCatalog, speciesId) ?? [])
    .sort((left, right) => left.dexNumber - right.dexNumber)
}

export function countHgssPokedexRegistrations(entries: readonly HgssPokedexListEntry[]): {
  seen: number
  caught: number
} {
  const seen = new Set<number>()
  const caught = new Set<number>()
  for (const entry of entries) {
    if (entry.caught) {
      caught.add(entry.speciesId)
      seen.add(entry.speciesId)
    } else if (entry.seen) seen.add(entry.speciesId)
  }
  return { seen: seen.size, caught: caught.size }
}

/** Applique les modes de recherche/tri de l'overlay 18 sans modifier l'état vu/pris. */
export function queryHgssPokedexList(
  entries: readonly HgssPokedexListEntry[],
  query: HgssPokedexListQuery = {},
): HgssPokedexListEntry[] {
  const filter = query.filter ?? 'all'
  const search = query.search?.trim().toLocaleUpperCase('fr') ?? ''
  const filtered = entries.filter((entry) => {
    if (filter === 'seen' && !entry.seen) return false
    if (filter === 'caught' && !entry.caught) return false
    if (!search) return true
    return entry.seen && (entry.speciesName.toLocaleUpperCase('fr').includes(search)
      || String(entry.dexNumber).padStart(3, '0').includes(search))
  })
  return [...filtered].sort(query.sort === 'name'
    ? (left, right) => left.speciesName.localeCompare(right.speciesName, 'fr') || left.dexNumber - right.dexNumber
    : (left, right) => left.dexNumber - right.dexNumber)
}

/** Converts the special Pichu form sentinels stored by the HGSS Pokédex. */
export function createHgssPokedexPreviewRequest(entry: HgssPokedexEntry): HgssPokedexPreviewRequest | undefined {
  if (!entry.seen) return undefined
  const storedForm = entry.forms[0] ?? 0
  if (entry.speciesId === 172) {
    if (storedForm === 2) return { speciesId: entry.speciesId, form: 1, gender: 'female' }
    return { speciesId: entry.speciesId, form: 0, gender: storedForm === 0 ? 'male' : 'female' }
  }
  return {
    speciesId: entry.speciesId,
    form: storedForm,
    gender: entry.genders[0] ?? 'genderless',
  }
}

export function createHgssPokedexEntry(
  state: HgssPokedexState,
  pokemonCatalog: PokemonCatalog,
  pokedexCatalog: HgssPokedexCatalog,
  speciesId: number,
): HgssPokedexEntry | undefined {
  const listEntry = createHgssPokedexListEntry(state, pokemonCatalog, pokedexCatalog, speciesId)
  if (!listEntry) return undefined
  if (!listEntry.seen) {
    return { ...listEntry, forms: [], genders: [] }
  }
  const personal = pokemonCatalog.personalData[speciesId]
  if (!personal) throw new Error(`Les donnees personnelles ROM de l'espece Pokedex ${speciesId} sont absentes.`)
  const type1 = pokedexCatalog.typeNames[personal.types[0]]
  const type2 = pokedexCatalog.typeNames[personal.types[1]]
  if (!type1 || !type2) throw new Error(`Le nom ROM d'un type de l'espece Pokedex ${speciesId} est absent.`)
  return {
    ...listEntry,
    typeNames: [type1, type2],
    categoryName: listEntry.caught ? pokedexCatalog.categoryNames[speciesId] : undefined,
    heightLabel: listEntry.caught ? pokedexCatalog.heightLabels[speciesId] : undefined,
    weightLabel: listEntry.caught ? pokedexCatalog.weightLabels[speciesId] : undefined,
    description: listEntry.caught ? pokedexCatalog.heartGoldDescriptions[speciesId] : undefined,
    forms: [...(state.seenForms.get(speciesId) ?? [0])],
    genders: [...(state.seenGenders.get(speciesId) ?? [])],
  }
}

/**
 * Données de l'overlay d'enregistrement ouvert après une première capture.
 * HGSS lui passe directement le Pokémon capturé et le mode Johto/National :
 * l'état Pokédex persistant n'est marqué comme pris qu'après sa fermeture.
 */
export function createHgssPokedexRegistrationEntry(
  pokemon: CanonicalPokemon,
  pokemonCatalog: PokemonCatalog,
  pokedexCatalog: HgssPokedexCatalog,
  nationalDexEnabled: boolean,
): HgssPokedexEntry {
  const speciesName = pokemonCatalog.speciesNames[pokemon.speciesId]
  const personal = pokemonCatalog.personalData[pokemon.speciesId]
  if (!speciesName || !personal) throw new Error(`Les données ROM de l'espèce Pokédex ${pokemon.speciesId} sont absentes.`)
  const type1 = pokedexCatalog.typeNames[personal.types[0]]
  const type2 = pokedexCatalog.typeNames[personal.types[1]]
  if (!type1 || !type2) throw new Error(`Le nom ROM d'un type de l'espèce Pokédex ${pokemon.speciesId} est absent.`)
  const dexNumber = nationalDexEnabled ? pokemon.speciesId : pokedexCatalog.johtoDexNumbers[pokemon.speciesId] ?? 0
  const storedForm = pokemon.speciesId === 172 && pokemon.form !== 0 ? 2 : pokemon.form
  return {
    speciesId: pokemon.speciesId,
    dexNumber,
    speciesName,
    seen: true,
    caught: true,
    ...(pokemon.shiny ? { shinyCaught: true as const } : {}),
    typeNames: [type1, type2],
    categoryName: pokedexCatalog.categoryNames[pokemon.speciesId],
    heightLabel: pokedexCatalog.heightLabels[pokemon.speciesId],
    weightLabel: pokedexCatalog.weightLabels[pokemon.speciesId],
    description: pokedexCatalog.heartGoldDescriptions[pokemon.speciesId],
    forms: [storedForm],
    genders: [pokemon.gender],
  }
}
