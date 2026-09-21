import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import type { PokemonGender } from '../pokemon/pokemonFormulas'

export const hgssPokedexMagic = 0xbeefcafe
export const hgssPokedexNativeSize = 0x340
export const hgssNationalDexSpeciesCount = 493

const species = {
  pichu: 172,
  unown: 201,
  spinda: 327,
  deoxys: 386,
  burmy: 412,
  wormadam: 413,
  shellos: 422,
  gastrodon: 423,
  rotom: 479,
  giratina: 487,
  shaymin: 492,
} as const

const twoFormSpecies = new Set<number>([species.shellos, species.gastrodon, species.shaymin, species.giratina])
const threeFormSpecies = new Set<number>([species.burmy, species.wormadam, species.pichu])
const supportedDexLanguages = new Set([1, 2, 3, 4, 5, 7])

export type HgssPokedexState = {
  magic: typeof hgssPokedexMagic
  seenSpeciesIds: Set<number>
  caughtSpeciesIds: Set<number>
  caughtShinySpeciesIds: Set<number>
  seenGenders: Map<number, PokemonGender[]>
  spindaPersonality: number
  seenForms: Map<number, number[]>
  caughtUnownForms: number[]
  caughtLanguages: Map<number, Set<number>>
  canDetectForms: boolean
  internationalViewEnabled: boolean
  enabled: boolean
  nationalDexEnabled: boolean
}

export type HgssPokedexSnapshot = {
  magic: number
  seenSpeciesIds: number[]
  caughtSpeciesIds: number[]
  caughtShinySpeciesIds?: number[]
  seenGenders: [number, PokemonGender[]][]
  spindaPersonality: number
  seenForms: [number, number[]][]
  caughtUnownForms: number[]
  caughtLanguages: [number, number[]][]
  canDetectForms: boolean
  internationalViewEnabled: boolean
  enabled: boolean
  nationalDexEnabled: boolean
}

function requireSpeciesId(speciesId: number): void {
  if (!Number.isInteger(speciesId) || speciesId < 1 || speciesId > hgssNationalDexSpeciesCount) {
    throw new Error(`L'espece Pokedex HGSS ${speciesId} est invalide.`)
  }
}

function appendUniqueBounded(values: number[], value: number, maximum: number): void {
  if (!values.includes(value) && values.length < maximum) values.push(value)
}

function appendGender(state: HgssPokedexState, speciesId: number, gender: PokemonGender): void {
  const genders = state.seenGenders.get(speciesId) ?? []
  if (!genders.includes(gender) && genders.length < 2) genders.push(gender)
  state.seenGenders.set(speciesId, genders)
}

function nativePichuForm(pokemon: CanonicalPokemon): number {
  if (pokemon.form !== 0) return 2
  return pokemon.gender === 'male' ? 0 : 1
}

function appendSeenForm(state: HgssPokedexState, pokemon: CanonicalPokemon): void {
  const { speciesId } = pokemon
  if (speciesId === species.unown) {
    const forms = state.seenForms.get(speciesId) ?? []
    appendUniqueBounded(forms, pokemon.form, 28)
    state.seenForms.set(speciesId, forms)
    return
  }
  if (twoFormSpecies.has(speciesId)) {
    const forms = state.seenForms.get(speciesId) ?? []
    appendUniqueBounded(forms, pokemon.form, 2)
    state.seenForms.set(speciesId, forms)
    return
  }
  if (threeFormSpecies.has(speciesId)) {
    const forms = state.seenForms.get(speciesId) ?? []
    appendUniqueBounded(forms, speciesId === species.pichu ? nativePichuForm(pokemon) : pokemon.form, 3)
    state.seenForms.set(speciesId, forms)
    return
  }
  if (speciesId === species.deoxys) {
    const forms = state.seenForms.get(speciesId) ?? []
    appendUniqueBounded(forms, pokemon.form, 4)
    state.seenForms.set(speciesId, forms)
    return
  }
  if (speciesId === species.rotom) {
    const forms = state.seenForms.get(speciesId) ?? []
    appendUniqueBounded(forms, pokemon.form, 6)
    state.seenForms.set(speciesId, forms)
  }
}

export function createHgssPokedex(options: {
  enabled?: boolean
  nationalDexEnabled?: boolean
  caughtSpeciesIds?: readonly number[]
} = {}): HgssPokedexState {
  const caughtSpeciesIds = new Set(options.caughtSpeciesIds ?? [])
  for (const speciesId of caughtSpeciesIds) requireSpeciesId(speciesId)
  return {
    magic: hgssPokedexMagic,
    seenSpeciesIds: new Set(caughtSpeciesIds),
    caughtSpeciesIds,
    caughtShinySpeciesIds: new Set(),
    seenGenders: new Map(),
    spindaPersonality: 0,
    seenForms: new Map(),
    caughtUnownForms: [],
    caughtLanguages: new Map(),
    canDetectForms: false,
    internationalViewEnabled: false,
    enabled: options.enabled ?? false,
    nationalDexEnabled: options.nationalDexEnabled ?? false,
  }
}

export function cloneHgssPokedex(state: HgssPokedexState): HgssPokedexState {
  return {
    ...state,
    seenSpeciesIds: new Set(state.seenSpeciesIds),
    caughtSpeciesIds: new Set(state.caughtSpeciesIds),
    caughtShinySpeciesIds: new Set(state.caughtShinySpeciesIds),
    seenGenders: new Map([...state.seenGenders].map(([speciesId, genders]) => [speciesId, [...genders]])),
    seenForms: new Map([...state.seenForms].map(([speciesId, forms]) => [speciesId, [...forms]])),
    caughtUnownForms: [...state.caughtUnownForms],
    caughtLanguages: new Map([...state.caughtLanguages].map(([speciesId, languages]) => [speciesId, new Set(languages)])),
  }
}

export function markPokemonSeen(state: HgssPokedexState, pokemon: CanonicalPokemon): void {
  requireSpeciesId(pokemon.speciesId)
  if (pokemon.isEgg) return
  if (!state.seenSpeciesIds.has(pokemon.speciesId) && pokemon.speciesId === species.spinda) {
    state.spindaPersonality = pokemon.personality >>> 0
  }
  appendGender(state, pokemon.speciesId, pokemon.gender)
  appendSeenForm(state, pokemon)
  state.seenSpeciesIds.add(pokemon.speciesId)
}

export function markPokemonCaught(
  state: HgssPokedexState,
  pokemon: CanonicalPokemon,
  nativeGameLanguage = 3,
): void {
  if (pokemon.isEgg) return
  markPokemonSeen(state, pokemon)
  if (pokemon.speciesId === species.unown) appendUniqueBounded(state.caughtUnownForms, pokemon.form, 28)
  const language = pokemon.origin.language
  if (supportedDexLanguages.has(language)) {
    const languages = state.caughtLanguages.get(pokemon.speciesId) ?? new Set<number>()
    languages.add(language)
    state.caughtLanguages.set(pokemon.speciesId, languages)
  }
  if (language !== nativeGameLanguage) state.internationalViewEnabled = true
  state.caughtSpeciesIds.add(pokemon.speciesId)
  if (pokemon.shiny) state.caughtShinySpeciesIds.add(pokemon.speciesId)
}

export function enableHgssPokedex(state: HgssPokedexState): void {
  state.enabled = true
}

export function enableHgssNationalDex(state: HgssPokedexState): void {
  state.nationalDexEnabled = true
}

export function enableHgssPokedexFormDetection(state: HgssPokedexState): void {
  state.canDetectForms = true
}

export function snapshotHgssPokedex(state: HgssPokedexState): HgssPokedexSnapshot {
  return {
    magic: state.magic,
    seenSpeciesIds: [...state.seenSpeciesIds],
    caughtSpeciesIds: [...state.caughtSpeciesIds],
    caughtShinySpeciesIds: [...state.caughtShinySpeciesIds],
    seenGenders: [...state.seenGenders].map(([speciesId, genders]) => [speciesId, [...genders]]),
    spindaPersonality: state.spindaPersonality,
    seenForms: [...state.seenForms].map(([speciesId, forms]) => [speciesId, [...forms]]),
    caughtUnownForms: [...state.caughtUnownForms],
    caughtLanguages: [...state.caughtLanguages].map(([speciesId, languages]) => [speciesId, [...languages]]),
    canDetectForms: state.canDetectForms,
    internationalViewEnabled: state.internationalViewEnabled,
    enabled: state.enabled,
    nationalDexEnabled: state.nationalDexEnabled,
  }
}

export function restoreHgssPokedex(snapshot: HgssPokedexSnapshot): HgssPokedexState {
  if (snapshot.magic !== hgssPokedexMagic) throw new Error('La magie de la sauvegarde Pokedex HGSS est invalide.')
  const state = createHgssPokedex({
    enabled: snapshot.enabled,
    nationalDexEnabled: snapshot.nationalDexEnabled,
  })
  for (const speciesId of snapshot.seenSpeciesIds) {
    requireSpeciesId(speciesId)
    state.seenSpeciesIds.add(speciesId)
  }
  for (const speciesId of snapshot.caughtSpeciesIds) {
    requireSpeciesId(speciesId)
    state.caughtSpeciesIds.add(speciesId)
    state.seenSpeciesIds.add(speciesId)
  }
  for (const speciesId of snapshot.caughtShinySpeciesIds ?? []) {
    requireSpeciesId(speciesId)
    state.caughtShinySpeciesIds.add(speciesId)
    state.caughtSpeciesIds.add(speciesId)
    state.seenSpeciesIds.add(speciesId)
  }
  state.seenGenders = new Map(snapshot.seenGenders.map(([speciesId, genders]) => [speciesId, [...genders]]))
  state.spindaPersonality = snapshot.spindaPersonality >>> 0
  state.seenForms = new Map(snapshot.seenForms.map(([speciesId, forms]) => [speciesId, [...forms]]))
  state.caughtUnownForms = [...snapshot.caughtUnownForms]
  state.caughtLanguages = new Map(snapshot.caughtLanguages.map(([speciesId, languages]) => [speciesId, new Set(languages)]))
  state.canDetectForms = snapshot.canDetectForms
  state.internationalViewEnabled = snapshot.internationalViewEnabled
  return state
}

export function countSeenPokemon(state: HgssPokedexState): number {
  return state.seenSpeciesIds.size
}

export function countCaughtPokemon(state: HgssPokedexState): number {
  return state.caughtSpeciesIds.size
}
