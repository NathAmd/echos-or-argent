import type { OpeningMapPreview, PokemonCatalog } from '../../../ndsTypes'
import type { HgssEncounterSlot, HgssLandEncounterSlot, HgssWildEncounterData } from '../../../rom/encounters/wildEncounterData'
import type { MapEncounterLandmark } from '../../../rom/pokegear/mapEncounterLandmarks'
import type { FieldWildEncounterIdentityPort } from '../../encounters/fieldWildEncounterIdentityPort'
import { hgssLegendaryAndMythicalSpeciesIds, isHgssLegendaryOrMythicalSpecies } from '../../pokemon/hgssLegendarySpecies'
import { HGSS_SAFARI_MAP_ID } from '../../safari/hgssSafariMap'

export const hgssNationalDexSpeciesCount = 493 as const
export { hgssLegendaryAndMythicalSpeciesIds } from '../../pokemon/hgssLegendarySpecies'

export type AllPokemonEncounterMapSource = Readonly<{
  mapId: number
  mapSectionId: number
  encounterBankId: number
}>

export type AllPokemonPlacementMethod = 'land' | 'surfing' | 'fishing'
export type AllPokemonPlacementVariant = 'morning' | 'day' | 'night' | 'surfing' | 'oldRod' | 'goodRod' | 'superRod'
export type AllPokemonHabitat = 'aquatic' | 'cavern' | 'cold' | 'forest' | 'open-land' | 'urban' | 'volcanic'

export type AllPokemonOrdinaryPlacement = Readonly<{
  speciesId: number
  mapId: number
  mapSectionId: number
  encounterBankId: number
  method: AllPokemonPlacementMethod
  variant: AllPokemonPlacementVariant
  slotIndex: number
  replacedSpeciesId: number
  minimumLevel: number
  maximumLevel: number
  habitat: AllPokemonHabitat
}>

export type AllPokemonQuestRequirement =
  | Readonly<{ kind: 'money', amount: number }>
  | Readonly<{ kind: 'caught-type', typeId: number, count: number }>
  | Readonly<{ kind: 'battles-won', count: number }>

export type AllPokemonQuestDefinition = Readonly<{
  id: string
  speciesId: number
  category: 'legendary' | 'difficult'
  level: number
  requirement: AllPokemonQuestRequirement
}>

export type AllPokemonAccessibilityPlan = Readonly<{
  revision: 1
  nativeSpeciesIds: readonly number[]
  ordinaryPlacements: readonly AllPokemonOrdinaryPlacement[]
  quests: readonly AllPokemonQuestDefinition[]
  /** Toujours exactement 1..493 lorsque le plan a été créé avec succès. */
  coveredSpeciesIds: readonly number[]
}>

export type AllPokemonOneShotLandmark = Pick<
  MapEncounterLandmark,
  'speciesId' | 'isRomLegendary' | 'disappearanceFlagId'
>

export type AllPokemonTransitiveOneShotEvidence = Readonly<{
  gameCode: string
  landmarks: readonly AllPokemonOneShotLandmark[]
}>

export type AllPokemonAccessibilityPlannerOptions = Readonly<{
  /** Starters, cadeaux et rencontres scriptées déjà accessibles hors des tables sauvages. */
  knownAccessibleSpeciesIds?: readonly number[]
  /** Preuve ROM permettant de retirer une quête devenue accessible par dépendance. */
  transitiveOneShotEvidence?: AllPokemonTransitiveOneShotEvidence
  seed?: string
}>

type PlacementCandidate = Omit<AllPokemonOrdinaryPlacement, 'speciesId'> & Readonly<{
  stableKey: string
  nativeTypes: readonly number[]
}>

const waterTypeId = 11
const mysteryTypeId = 9
const legendarySpecies = new Set(hgssLegendaryAndMythicalSpeciesIds)

/**
 * Sources solo, terminales et réellement actives dans la version chargée.
 * Les scripts des deux versions résident dans chaque ROM : la présence brute
 * de Groudon, Kyogre ou Rayquaza ne suffit donc pas à les déclarer accessibles.
 */
export function resolveAllPokemonNativeOneShotSpeciesIds(
  gameCode: string,
  landmarks: readonly AllPokemonOneShotLandmark[],
): readonly number[] {
  const version = gameCode.slice(0, 3)
  if (!/^IP[KG][A-Z0-9]$/.test(gameCode) || (version !== 'IPK' && version !== 'IPG')) {
    throw new Error(`La version HGSS ${String(gameCode)} des sources Tous les Pokémon est invalide.`)
  }
  const provenStatic = new Set(landmarks.flatMap((landmark) => (
    landmark.isRomLegendary && landmark.disappearanceFlagId !== undefined
      && isHgssLegendaryOrMythicalSpecies(landmark.speciesId) ? [landmark.speciesId] : []
  )))
  const fixedStatic = [144, 145, 146, 150, 245, 249, 250]
  const versionStatic = version === 'IPK' ? 382 : 383
  const versionRoamer = version === 'IPK' ? 380 : 381
  return Object.freeze([
    ...fixedStatic.filter((speciesId) => provenStatic.has(speciesId)),
    243,
    244,
    versionRoamer,
    ...(provenStatic.has(versionStatic) ? [versionStatic] : []),
  ].sort((left, right) => left - right))
}

export type AllPokemonTransitiveCoverage = Readonly<{
  /** Sources que le plan traite déjà comme accessibles hors de ses propres placements/quêtes. */
  knownAccessibleSpeciesIds: readonly number[]
  /** Couverture produite par un premier plan complet du module. */
  moduleCoveredSpeciesIds: readonly number[]
}>

/** Retourne le drapeau unique qui retire l’objet Rayquaza, sinon aucune preuve exploitable. */
export function resolveAllPokemonRayquazaDisappearanceFlagId(
  landmarks: readonly AllPokemonOneShotLandmark[],
): number | undefined {
  const flags = new Set(landmarks.flatMap((landmark) => (
    landmark.speciesId === 384
    && landmark.isRomLegendary === true
    && Number.isSafeInteger(landmark.disappearanceFlagId)
    && landmark.disappearanceFlagId! > 0
    && landmark.disappearanceFlagId! <= 0xffff
      ? [landmark.disappearanceFlagId!]
      : []
  )))
  return flags.size === 1 ? flags.values().next().value : undefined
}

function requireEvidenceSpeciesSet(values: readonly number[], label: string): ReadonlySet<number> {
  if (!Array.isArray(values)) throw new Error(`${label} doit être une liste d’espèces HGSS.`)
  const species = new Set<number>()
  for (const speciesId of values) {
    if (!Number.isSafeInteger(speciesId) || speciesId < 1 || speciesId > hgssNationalDexSpeciesCount) {
      throw new Error(`${label} contient l’espèce invalide ${String(speciesId)}.`)
    }
    species.add(speciesId)
  }
  return species
}

/**
 * Rayquaza est un one-shot ROM conditionnel : son landmark ne suffit pas à le
 * déclarer natif, car il exige les deux légendaires météo. Il devient toutefois
 * accessible sans quête propre lorsque la version prouve son légendaire natif
 * et qu’un premier plan du module couvre aussi la contrepartie de l’autre jeu.
 *
 * Ce helper reste séparé de `resolveAllPokemonNativeOneShotSpeciesIds` afin que
 * « natif » ne signifie jamais « rendu accessible transitivement par le module ».
 */
export function resolveAllPokemonTransitiveOneShotSpeciesIds(
  gameCode: string,
  landmarks: readonly AllPokemonOneShotLandmark[],
  coverage: AllPokemonTransitiveCoverage,
): readonly number[] {
  const nativeOneShots = new Set(resolveAllPokemonNativeOneShotSpeciesIds(gameCode, landmarks))
  const known = requireEvidenceSpeciesSet(
    coverage.knownAccessibleSpeciesIds,
    'Les sources connues de la couverture transitive Tous les Pokémon',
  )
  const moduleCovered = requireEvidenceSpeciesSet(
    coverage.moduleCoveredSpeciesIds,
    'La couverture transitive Tous les Pokémon',
  )
  const isHeartGold = gameCode.slice(0, 3) === 'IPK'
  const nativeWeatherSpeciesId = isHeartGold ? 382 : 383
  const oppositeWeatherSpeciesId = isHeartGold ? 383 : 382
  const rayquazaDisappearanceFlagId = resolveAllPokemonRayquazaDisappearanceFlagId(landmarks)
  return rayquazaDisappearanceFlagId !== undefined
    && nativeOneShots.has(nativeWeatherSpeciesId)
    && known.has(nativeWeatherSpeciesId)
    && moduleCovered.has(nativeWeatherSpeciesId)
    && moduleCovered.has(oppositeWeatherSpeciesId)
    ? Object.freeze([384])
    : Object.freeze([])
}

function requireUnsignedInteger(value: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${label} ${value} du plan Tous les Pokémon est invalide.`)
  }
  return value
}

function requireSpecies(catalog: PokemonCatalog, speciesId: number, label: string): void {
  if (!Number.isInteger(speciesId)
    || speciesId < 1
    || speciesId > hgssNationalDexSpeciesCount
    || catalog.personalData[speciesId]?.speciesId !== speciesId
    || !catalog.speciesNames[speciesId]) {
    throw new Error(`${label} ${speciesId} est absente du catalogue national HGSS.`)
  }
}

function requireCompleteNationalCatalog(catalog: PokemonCatalog): readonly number[] {
  const speciesIds = Array.from({ length: hgssNationalDexSpeciesCount }, (_, index) => index + 1)
  for (const speciesId of speciesIds) requireSpecies(catalog, speciesId, 'L’espèce')
  return Object.freeze(speciesIds)
}

function stableHash32(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    hash = Math.imul(hash ^ (codeUnit & 0xff), 0x01000193)
    hash = Math.imul(hash ^ (codeUnit >>> 8), 0x01000193)
  }
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x85ebca6b)
  hash ^= hash >>> 13
  hash = Math.imul(hash, 0xc2b2ae35)
  return (hash ^ (hash >>> 16)) >>> 0
}

function speciesTypes(catalog: PokemonCatalog, speciesId: number): readonly number[] {
  const types = catalog.personalData[speciesId]!.types
  return Object.freeze(types[0] === types[1] ? [types[0]] : [types[0], types[1]])
}

function resolveHabitat(types: readonly number[], method: AllPokemonPlacementMethod): AllPokemonHabitat {
  if (method !== 'land' || types.includes(waterTypeId)) return 'aquatic'
  if (types.includes(10)) return 'volcanic'
  if (types.includes(15)) return 'cold'
  if (types.includes(5) || types.includes(4) || types.includes(7)) return 'cavern'
  if (types.includes(12) || types.includes(6)) return 'forest'
  if (types.includes(8) || types.includes(13) || types.includes(3)) return 'urban'
  return 'open-land'
}

function candidateScore(
  speciesId: number,
  types: readonly number[],
  habitat: AllPokemonHabitat,
  candidate: PlacementCandidate,
  seed: string,
): readonly [number, number] {
  const sharedTypeCount = types.filter((typeId) => candidate.nativeTypes.includes(typeId)).length
  const speciesIsAquatic = types.includes(waterTypeId)
  const methodAffinity = speciesIsAquatic
    ? candidate.method === 'land' ? -80 : 80
    : candidate.method === 'land' ? 35 : -35
  const habitatAffinity = candidate.habitat === habitat ? 45 : 0
  const score = sharedTypeCount * 120 + methodAffinity + habitatAffinity
  return [score, stableHash32(`${seed}|${speciesId}|${candidate.stableKey}`)]
}

function comparePlacement(left: AllPokemonOrdinaryPlacement, right: AllPokemonOrdinaryPlacement): number {
  return left.speciesId - right.speciesId
    || left.mapId - right.mapId
    || left.method.localeCompare(right.method)
    || left.variant.localeCompare(right.variant)
    || left.slotIndex - right.slotIndex
}

function normalizeMaps(maps: readonly AllPokemonEncounterMapSource[]): readonly AllPokemonEncounterMapSource[] {
  const byId = new Map<number, AllPokemonEncounterMapSource>()
  for (const source of maps) {
    const map = Object.freeze({
      mapId: requireUnsignedInteger(source.mapId, 0xffff, 'La carte'),
      mapSectionId: requireUnsignedInteger(source.mapSectionId, 0xffff, 'La section'),
      encounterBankId: requireUnsignedInteger(source.encounterBankId, 0xff, 'La banque de rencontres'),
    })
    const previous = byId.get(map.mapId)
    if (previous && (previous.mapSectionId !== map.mapSectionId
      || previous.encounterBankId !== map.encounterBankId)) {
      throw new Error(`La carte ${map.mapId} possède plusieurs sources de rencontres incompatibles.`)
    }
    byId.set(map.mapId, map)
  }
  return Object.freeze([...byId.values()].sort((left, right) => left.mapId - right.mapId))
}

/** Adaptateur sans état depuis le catalogue de cartes déjà décodé par le client. */
export function createAllPokemonEncounterMapSources(
  maps: readonly Pick<OpeningMapPreview, 'id' | 'header'>[],
): readonly AllPokemonEncounterMapSource[] {
  return normalizeMaps(maps
    // Le Parc Safari substitue sa propre table apres le jet de taux : ses
    // slots sauvages ordinaires ne sont jamais materialises pendant la session.
    .filter(({ id, header }) => id !== HGSS_SAFARI_MAP_ID && header.wildEncounterBank !== 0xff)
    .map(({ id, header }) => ({
      mapId: id,
      mapSectionId: header.mapSection,
      encounterBankId: header.wildEncounterBank,
    })))
}

function addNativeSpecies(
  catalog: PokemonCatalog,
  occurrences: Map<number, number>,
  speciesId: number,
): void {
  if (speciesId === 0) return
  requireSpecies(catalog, speciesId, 'L’espèce native')
  occurrences.set(speciesId, (occurrences.get(speciesId) ?? 0) + 1)
}

function createCandidate(
  catalog: PokemonCatalog,
  map: AllPokemonEncounterMapSource,
  method: AllPokemonPlacementMethod,
  variant: AllPokemonPlacementVariant,
  slotIndex: number,
  slot: HgssEncounterSlot | HgssLandEncounterSlot,
): PlacementCandidate {
  requireSpecies(catalog, slot.speciesId, 'L’espèce du slot')
  const minimumLevel = 'minLevel' in slot ? Math.min(slot.minLevel, slot.maxLevel) : slot.level
  const maximumLevel = 'maxLevel' in slot ? Math.max(slot.minLevel, slot.maxLevel) : slot.level
  if (!Number.isInteger(minimumLevel) || minimumLevel < 1 || maximumLevel > 100) {
    throw new Error(`Les niveaux du slot ${map.mapId}/${method}/${variant}/${slotIndex} sont invalides.`)
  }
  const nativeTypes = speciesTypes(catalog, slot.speciesId)
  return Object.freeze({
    mapId: map.mapId,
    mapSectionId: map.mapSectionId,
    encounterBankId: map.encounterBankId,
    method,
    variant,
    slotIndex,
    replacedSpeciesId: slot.speciesId,
    minimumLevel,
    maximumLevel,
    habitat: resolveHabitat(nativeTypes, method),
    nativeTypes,
    stableKey: `${map.mapId}:${method}:${variant}:${slotIndex}`,
  })
}

function collectCandidatesAndNativeSpecies(
  catalog: PokemonCatalog,
  maps: readonly AllPokemonEncounterMapSource[],
  encounterCatalog: readonly HgssWildEncounterData[],
): Readonly<{ candidates: readonly PlacementCandidate[], occurrences: ReadonlyMap<number, number> }> {
  const candidates: PlacementCandidate[] = []
  const occurrences = new Map<number, number>()
  const addSlots = (
    map: AllPokemonEncounterMapSource,
    method: AllPokemonPlacementMethod,
    variant: AllPokemonPlacementVariant,
    slots: readonly (HgssEncounterSlot | HgssLandEncounterSlot)[],
    replaceable: boolean,
  ): void => {
    slots.forEach((slot, slotIndex) => {
      addNativeSpecies(catalog, occurrences, slot.speciesId)
      if (replaceable) candidates.push(createCandidate(catalog, map, method, variant, slotIndex, slot))
    })
  }

  for (const map of maps) {
    const encounters = encounterCatalog[map.encounterBankId]
    if (!encounters || encounters.bankId !== map.encounterBankId) {
      throw new Error(`La banque ${map.encounterBankId} de la carte ${map.mapId} est absente du catalogue.`)
    }
    if (encounters.rates.walking > 0) {
      addSlots(map, 'land', 'morning', encounters.land.morning, true)
      addSlots(map, 'land', 'day', encounters.land.day, true)
      addSlots(map, 'land', 'night', encounters.land.night, true)
      encounters.hoennSoundSpecies.forEach((speciesId) => addNativeSpecies(catalog, occurrences, speciesId))
      encounters.sinnohSoundSpecies.forEach((speciesId) => addNativeSpecies(catalog, occurrences, speciesId))
      addNativeSpecies(catalog, occurrences, encounters.swarm.landSpeciesId)
    }
    if (encounters.rates.surfing > 0) addSlots(map, 'surfing', 'surfing', encounters.surfing, true)
    if (encounters.rates.rockSmash > 0) {
      addSlots(map, 'land', 'day', encounters.rockSmash, false)
    }
    const rods = [
      ['oldRod', encounters.rates.oldRod, encounters.oldRod],
      ['goodRod', encounters.rates.goodRod, encounters.goodRod],
      ['superRod', encounters.rates.superRod, encounters.superRod],
    ] as const
    for (const [variant, rate, slots] of rods) {
      if (rate > 0) addSlots(map, 'fishing', variant, slots, true)
    }
    if (encounters.rates.surfing > 0) addNativeSpecies(catalog, occurrences, encounters.swarm.surfingSpeciesId)
    if (encounters.rates.goodRod > 0 || encounters.rates.superRod > 0) {
      addNativeSpecies(catalog, occurrences, encounters.swarm.nightFishingSpeciesId)
      addNativeSpecies(catalog, occurrences, encounters.swarm.fishingSpeciesId)
    }
  }
  candidates.sort((left, right) => left.stableKey.localeCompare(right.stableKey))
  return Object.freeze({ candidates: Object.freeze(candidates), occurrences })
}

function createQuestDefinition(
  catalog: PokemonCatalog,
  speciesId: number,
  category: AllPokemonQuestDefinition['category'],
): AllPokemonQuestDefinition {
  const types = speciesTypes(catalog, speciesId).filter((typeId) => typeId !== mysteryTypeId)
  const branch = speciesId % 3
  const requirement: AllPokemonQuestRequirement = branch === 0
    ? Object.freeze({ kind: 'money', amount: Math.min(900_000, 100_000 * (1 + (speciesId % 9))) })
    : branch === 1
      ? Object.freeze({ kind: 'caught-type', typeId: types[0] ?? 0, count: 5 + (speciesId % 16) })
      : Object.freeze({ kind: 'battles-won', count: 25 + (speciesId % 8) * 10 })
  const baseStatTotal = Object.values(catalog.personalData[speciesId]!.baseStats)
    .reduce((sum, value) => sum + value, 0)
  return Object.freeze({
    id: `all-pokemon:quest:${speciesId}`,
    speciesId,
    category,
    level: Math.max(20, Math.min(70, Math.floor(baseStatTotal / 10))),
    requirement,
  })
}

/**
 * Classe les 493 espèces sans table manuelle de version : toute espèce absente
 * des rencontres/cadeaux déclarés devient soit un overlay ordinaire, soit une
 * quête. Les exclusivités de version et d’échange sont donc couvertes par la
 * même règle, sans modifier les données ROM ni retirer le dernier slot natif.
 */
function createAllPokemonAccessibilityPlanPass(
  catalog: PokemonCatalog,
  mapSources: readonly AllPokemonEncounterMapSource[],
  encounterCatalog: readonly HgssWildEncounterData[],
  options: AllPokemonAccessibilityPlannerOptions = {},
): AllPokemonAccessibilityPlan {
  const allSpeciesIds = requireCompleteNationalCatalog(catalog)
  const maps = normalizeMaps(mapSources)
  const seed = options.seed ?? 'pokemaster-hgss-all-pokemon-v1'
  if (typeof seed !== 'string' || seed.length < 1 || seed.length > 128 || seed.trim() !== seed) {
    throw new Error('Le seed du plan Tous les Pokémon est invalide.')
  }
  const { candidates, occurrences } = collectCandidatesAndNativeSpecies(catalog, maps, encounterCatalog)
  const known = new Set<number>()
  for (const speciesId of options.knownAccessibleSpeciesIds ?? []) {
    requireSpecies(catalog, speciesId, 'L’espèce déjà accessible')
    known.add(speciesId)
  }
  const native = new Set<number>([...known, ...occurrences.keys()])
  const remainingOccurrences = new Map(occurrences)
  const unusedCandidates = new Set(candidates)
  const placements: AllPokemonOrdinaryPlacement[] = []
  const difficultQuestSpecies: number[] = []
  // Chaque espece ordinaire qui n'est pas garantie par une source stable
  // hors tables recoit son propre ancrage final. C'est volontairement plus
  // strict que de ne placer que les absentes : un transformateur compose en
  // amont (Randomizer, par exemple) peut remplacer une espece pourtant native.
  // Le port Tous-les-Pokemon, applique sur cet ancrage, restaure alors la
  // couverture sans connaitre ni importer cet autre module.
  const ordinarySpeciesToAnchor = allSpeciesIds.filter((speciesId) => (
    !known.has(speciesId) && !legendarySpecies.has(speciesId)
  ))

  for (const speciesId of ordinarySpeciesToAnchor) {
    const types = speciesTypes(catalog, speciesId)
    const habitat = resolveHabitat(types, types.includes(waterTypeId) ? 'surfing' : 'land')
    let best: PlacementCandidate | undefined
    let bestScore: readonly [number, number] | undefined
    for (const candidate of unusedCandidates) {
      const nativeRemaining = remainingOccurrences.get(candidate.replacedSpeciesId) ?? 0
      if (!known.has(candidate.replacedSpeciesId) && nativeRemaining <= 1) continue
      const score = candidateScore(speciesId, types, habitat, candidate, seed)
      if (!bestScore || score[0] > bestScore[0] || (score[0] === bestScore[0] && score[1] > bestScore[1])) {
        best = candidate
        bestScore = score
      }
    }
    if (!best) {
      difficultQuestSpecies.push(speciesId)
      continue
    }
    unusedCandidates.delete(best)
    remainingOccurrences.set(best.replacedSpeciesId, (remainingOccurrences.get(best.replacedSpeciesId) ?? 1) - 1)
    placements.push(Object.freeze({
      speciesId,
      mapId: best.mapId,
      mapSectionId: best.mapSectionId,
      encounterBankId: best.encounterBankId,
      method: best.method,
      variant: best.variant,
      slotIndex: best.slotIndex,
      replacedSpeciesId: best.replacedSpeciesId,
      minimumLevel: best.minimumLevel,
      maximumLevel: best.maximumLevel,
      habitat: best.habitat,
    }))
  }

  // Les legendaires/fabuleux non declares par l'hote comme source stable ont
  // toujours une quete persistante. Une simple occurrence dans une table peut
  // elle aussi etre transformee par un overlay amont et ne suffit donc pas a
  // garantir l'accessibilite composee.
  const legendaryQuestSpecies = allSpeciesIds.filter((speciesId) => (
    legendarySpecies.has(speciesId) && !known.has(speciesId)
  ))
  const quests = [
    ...legendaryQuestSpecies.map((speciesId) => createQuestDefinition(catalog, speciesId, 'legendary')),
    ...difficultQuestSpecies.map((speciesId) => createQuestDefinition(catalog, speciesId, 'difficult')),
  ].sort((left, right) => left.speciesId - right.speciesId)
  const covered = new Set<number>([
    ...native,
    ...placements.map(({ speciesId }) => speciesId),
    ...quests.map(({ speciesId }) => speciesId),
  ])
  const uncovered = allSpeciesIds.filter((speciesId) => !covered.has(speciesId))
  if (uncovered.length > 0 || covered.size !== hgssNationalDexSpeciesCount) {
    throw new Error(`Le plan Tous les Pokémon ne couvre pas le Pokédex national : ${uncovered.join(', ')}.`)
  }
  return Object.freeze({
    revision: 1,
    nativeSpeciesIds: Object.freeze([...native].sort((left, right) => left - right)),
    ordinaryPlacements: Object.freeze(placements.sort(comparePlacement)),
    quests: Object.freeze(quests),
    coveredSpeciesIds: allSpeciesIds,
  })
}

/**
 * Construit d’abord la couverture autonome du module, puis retire uniquement
 * les quêtes dont cette même couverture rend un one-shot ROM conditionnel
 * réellement accessible. Le second passage ne peut donc pas inventer une
 * dépendance qui n’était pas couverte par le premier.
 */
export function createAllPokemonAccessibilityPlan(
  catalog: PokemonCatalog,
  mapSources: readonly AllPokemonEncounterMapSource[],
  encounterCatalog: readonly HgssWildEncounterData[],
  options: AllPokemonAccessibilityPlannerOptions = {},
): AllPokemonAccessibilityPlan {
  const basePlan = createAllPokemonAccessibilityPlanPass(catalog, mapSources, encounterCatalog, options)
  const evidence = options.transitiveOneShotEvidence
  if (!evidence) return basePlan
  const transitiveSpeciesIds = resolveAllPokemonTransitiveOneShotSpeciesIds(
    evidence.gameCode,
    evidence.landmarks,
    {
      knownAccessibleSpeciesIds: options.knownAccessibleSpeciesIds ?? [],
      moduleCoveredSpeciesIds: basePlan.coveredSpeciesIds,
    },
  )
  if (transitiveSpeciesIds.length === 0) return basePlan
  return createAllPokemonAccessibilityPlanPass(catalog, mapSources, encounterCatalog, {
    ...(options.seed === undefined ? {} : { seed: options.seed }),
    knownAccessibleSpeciesIds: Object.freeze([
      ...new Set([...(options.knownAccessibleSpeciesIds ?? []), ...transitiveSpeciesIds]),
    ].sort((left, right) => left - right)),
  })
}

function placementKeyFromEncounter(
  mapId: number,
  encounter: Parameters<FieldWildEncounterIdentityPort>[0]['encounter'],
): string | undefined {
  if (encounter.method === 'land') return `${mapId}:land:${encounter.time}:${encounter.slotIndex}`
  if (encounter.method === 'surfing') return `${mapId}:surfing:surfing:${encounter.slotIndex}`
  if (encounter.method === 'fishing') return `${mapId}:fishing:${encounter.rod}:${encounter.slotIndex}`
  return undefined
}

/** Overlay directement composable ; niveaux, taux, méthode et RNG restent natifs. */
export function createAllPokemonAccessibleEncounterPort(
  plan: AllPokemonAccessibilityPlan,
): FieldWildEncounterIdentityPort {
  const speciesByPlacement = new Map(plan.ordinaryPlacements.map((placement) => [
    `${placement.mapId}:${placement.method}:${placement.variant}:${placement.slotIndex}`,
    placement.speciesId,
  ]))
  return (prepared, context) => {
    const key = placementKeyFromEncounter(context.mapId, prepared.encounter)
    const speciesId = key === undefined ? undefined : speciesByPlacement.get(key)
    if (speciesId === undefined || speciesId === prepared.encounter.speciesId) return prepared
    return {
      ...prepared,
      encounter: { ...prepared.encounter, speciesId },
    } as typeof prepared
  }
}
