import type { PlayerDirection } from '../../../ndsTypes'
import type { FieldScriptBattle } from '../../scripts/fieldScriptProtocol'
import {
  dynamicWorldActorLimits,
  type VisibleWildWorldActor,
} from '../../world/dynamicWorldActorRegistry'
import type { WorldSessionExtensionPorts } from '../../world/worldSession'
import type {
  AllPokemonAccessibleRuntime,
  AllPokemonQuestView,
} from './allPokemonAccessibleModule'

export type AllPokemonQuestWorldLocation = Readonly<{
  mapId: number
  mapSectionId: number
  tileX: number
  tileZ: number
  direction: PlayerDirection
}>

export type AllPokemonQuestWorldInteraction = Readonly<{
  actorId: string
  questId: string
  mapId: number
  mapSectionId: number
  /** Section virtuelle réservée au Nuzlocke, unique pour cette espèce. */
  captureScopeSectionId: number
  source: 'scripted'
  encounterMethod: 'scripted'
  identity: Readonly<{
    speciesId: number
    form: 0
    level: number
  }>
  /** Peut être fourni directement au chemin `prepareFieldBattle` existant. */
  battle: Extract<FieldScriptBattle, { kind: 'wild' }>
}>

export type AllPokemonQuestWorldCoordinator = Readonly<{
  worldSessionExtensionPorts: WorldSessionExtensionPorts
  listActors: () => readonly VisibleWildWorldActor[]
  getInteraction: (actorId: string) => AllPokemonQuestWorldInteraction | undefined
  /** Ne consomme rien : seul le démarrage réel observé retire temporairement l'acteur. */
  prepareInteraction: (actorId: string) => AllPokemonQuestWorldInteraction | undefined
  /**
   * Adaptateur transactionnel pratique. Le callback doit démarrer le chemin
   * sauvage/scripté normal, lequel émet déjà `WildEncounterStartedObserver`.
   */
  startInteraction: (
    actorId: string,
    start: (interaction: AllPokemonQuestWorldInteraction) => boolean,
  ) => AllPokemonQuestWorldInteraction | undefined
}>

const directions = new Set<PlayerDirection>(['north', 'south', 'west', 'east'])
const actorPrefix = 'ngp-all-pokemon-quest:'
export const allPokemonQuestCaptureScopeSectionBase = 0xf000
export const allPokemonQuestCaptureScopeSectionMaximum = 0xffff

/** Isole chaque quête du verrou « première rencontre de la section ». */
export function resolveAllPokemonQuestCaptureScopeSectionId(speciesId: number): number {
  const maximumSpeciesId = allPokemonQuestCaptureScopeSectionMaximum - allPokemonQuestCaptureScopeSectionBase
  if (!Number.isSafeInteger(speciesId) || speciesId < 1 || speciesId > maximumSpeciesId) {
    throw new Error("L'espèce de la section de capture Tous les Pokémon est invalide.")
  }
  return allPokemonQuestCaptureScopeSectionBase + speciesId
}

function requireInteger(value: unknown, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label} du monde Tous les Pokémon est invalide.`)
  }
  return value as number
}

function normalizeLocations(
  locations: readonly AllPokemonQuestWorldLocation[],
): readonly AllPokemonQuestWorldLocation[] {
  if (!Array.isArray(locations)
    || Object.getPrototypeOf(locations) !== Array.prototype
    || locations.length < 1
    || locations.length > dynamicWorldActorLimits.maxActors) {
    throw new Error('Les emplacements de quêtes Tous les Pokémon sont invalides.')
  }
  const normalized: AllPokemonQuestWorldLocation[] = []
  const tiles = new Set<string>()
  const mapSections = new Map<number, number>()
  locations.forEach((location, index) => {
    if (!location || typeof location !== 'object' || Array.isArray(location)) {
      throw new Error(`L’emplacement de quête Tous les Pokémon ${index} est invalide.`)
    }
    const mapId = requireInteger(location.mapId, 0, dynamicWorldActorLimits.maxMapId, `La carte de l’emplacement ${index}`)
    const mapSectionId = requireInteger(location.mapSectionId, 0, 0xffff, `La section de l’emplacement ${index}`)
    const tileX = requireInteger(
      location.tileX,
      -dynamicWorldActorLimits.maxCoordinate,
      dynamicWorldActorLimits.maxCoordinate,
      `La coordonnée X de l’emplacement ${index}`,
    )
    const tileZ = requireInteger(
      location.tileZ,
      -dynamicWorldActorLimits.maxCoordinate,
      dynamicWorldActorLimits.maxCoordinate,
      `La coordonnée Z de l’emplacement ${index}`,
    )
    if (!directions.has(location.direction)) {
      throw new Error(`La direction de l’emplacement Tous les Pokémon ${index} est invalide.`)
    }
    const previousSection = mapSections.get(mapId)
    if (previousSection !== undefined && previousSection !== mapSectionId) {
      throw new Error(`La carte ${mapId} possède plusieurs sections de quête Tous les Pokémon.`)
    }
    mapSections.set(mapId, mapSectionId)
    const tileKey = `${mapId}:${tileX}:${tileZ}`
    if (tiles.has(tileKey)) throw new Error(`La tuile de quête Tous les Pokémon ${tileKey} est dupliquée.`)
    tiles.add(tileKey)
    normalized.push(Object.freeze({ mapId, mapSectionId, tileX, tileZ, direction: location.direction }))
  })
  return Object.freeze(normalized.sort((left, right) => (
    left.mapId - right.mapId
    || left.tileZ - right.tileZ
    || left.tileX - right.tileX
    || left.direction.localeCompare(right.direction)
  )))
}

function actorIdForSpecies(speciesId: number): string {
  return `${actorPrefix}${speciesId}`
}

function compareActors(left: VisibleWildWorldActor, right: VisibleWildWorldActor): number {
  return left.mapId - right.mapId
    || left.tileZ - right.tileZ
    || left.tileX - right.tileX
    || left.id.localeCompare(right.id)
}

function createActor(
  quest: AllPokemonQuestView,
  location: AllPokemonQuestWorldLocation,
): VisibleWildWorldActor {
  return Object.freeze({
    id: actorIdForSpecies(quest.speciesId),
    kind: 'visible-wild',
    mapId: location.mapId,
    tileX: location.tileX,
    tileZ: location.tileZ,
    direction: location.direction,
    collision: 'blocking',
    interaction: 'action',
    speciesId: quest.speciesId,
    form: 0,
    level: quest.level,
  })
}

function createInteraction(
  actor: VisibleWildWorldActor,
  quest: AllPokemonQuestView,
  location: AllPokemonQuestWorldLocation,
): AllPokemonQuestWorldInteraction {
  const battle = Object.freeze({
    kind: 'wild' as const,
    speciesId: quest.speciesId,
    level: quest.level,
    battleParameter: 0,
  })
  return Object.freeze({
    actorId: actor.id,
    questId: quest.id,
    mapId: location.mapId,
    mapSectionId: location.mapSectionId,
    captureScopeSectionId: resolveAllPokemonQuestCaptureScopeSectionId(quest.speciesId),
    source: 'scripted' as const,
    encounterMethod: 'scripted' as const,
    identity: Object.freeze({ speciesId: quest.speciesId, form: 0 as const, level: quest.level }),
    battle,
  })
}

/**
 * Projette les quêtes dans les acteurs dynamiques déjà compris par
 * `WorldSession`. Les quêtes sont réparties par index stable sur les
 * emplacements ; avec moins d'emplacements que de quêtes, la suivante apparaît
 * sur le même autel après la capture ou le KO terminal de la précédente.
 */
export function createAllPokemonQuestWorldCoordinator(
  runtime: AllPokemonAccessibleRuntime,
  locationValues: readonly AllPokemonQuestWorldLocation[],
): AllPokemonQuestWorldCoordinator {
  if (!runtime || typeof runtime !== 'object'
    || typeof runtime.listQuests !== 'function'
    || typeof runtime.prepareQuestEncounter !== 'function') {
    throw new Error('Le runtime Tous les Pokémon requis par le coordinateur de monde est invalide.')
  }
  const locations = normalizeLocations(locationValues)
  const questOrder = new Map(runtime.plan.quests.map((quest, index) => [quest.speciesId, index]))

  const listActorEntries = (): readonly Readonly<{
    actor: VisibleWildWorldActor
    quest: AllPokemonQuestView
    location: AllPokemonQuestWorldLocation
  }>[] => {
    const questViews = runtime.listQuests()
    // Un seul moteur de combat est actif à la fois. Pendant sa transition,
    // aucun autre autel ne doit proposer une deuxième quête concurrente.
    if (questViews.some(({ encounterInstanceId }) => encounterInstanceId !== null)) return Object.freeze([])
    const viewsBySpecies = new Map(questViews.map((quest) => [quest.speciesId, quest]))
    const entries: Array<Readonly<{
      actor: VisibleWildWorldActor
      quest: AllPokemonQuestView
      location: AllPokemonQuestWorldLocation
    }>> = []
    for (let locationIndex = 0; locationIndex < locations.length; locationIndex += 1) {
      const location = locations[locationIndex]!
      const quest = runtime.plan.quests
        .filter((_, questIndex) => questIndex % locations.length === locationIndex)
        .map(({ speciesId }) => viewsBySpecies.get(speciesId)!)
        .find((candidate) => candidate.status === 'available' && candidate.encounterInstanceId === null)
      if (!quest) continue
      entries.push(Object.freeze({ actor: createActor(quest, location), quest, location }))
    }
    return Object.freeze(entries.sort((left, right) => compareActors(left.actor, right.actor)))
  }

  const listActors = (): readonly VisibleWildWorldActor[] => Object.freeze(
    listActorEntries().map(({ actor }) => actor),
  )

  const getEntry = (actorId: string) => listActorEntries().find(({ actor }) => actor.id === actorId)

  const getInteraction = (actorId: string): AllPokemonQuestWorldInteraction | undefined => {
    if (typeof actorId !== 'string' || !actorId.startsWith(actorPrefix)) return undefined
    const entry = getEntry(actorId)
    return entry && createInteraction(entry.actor, entry.quest, entry.location)
  }

  const prepareInteraction = (actorId: string): AllPokemonQuestWorldInteraction | undefined => {
    const interaction = getInteraction(actorId)
    if (!interaction) return undefined
    const preparedQuest = runtime.prepareQuestEncounter(interaction.identity.speciesId)
    if (!preparedQuest
      || preparedQuest.id !== interaction.questId
      || preparedQuest.speciesId !== interaction.identity.speciesId
      || preparedQuest.level !== interaction.identity.level) return undefined
    return interaction
  }

  const startInteraction = (
    actorId: string,
    start: (interaction: AllPokemonQuestWorldInteraction) => boolean,
  ): AllPokemonQuestWorldInteraction | undefined => {
    if (typeof start !== 'function') throw new Error('Le démarreur de quête Tous les Pokémon est invalide.')
    const interaction = prepareInteraction(actorId)
    if (!interaction) return undefined
    return start(interaction) ? interaction : undefined
  }

  const actorsAt = (mapId: number, tileX: number, tileZ: number): readonly VisibleWildWorldActor[] => Object.freeze(
    listActors().filter((actor) => actor.mapId === mapId && actor.tileX === tileX && actor.tileZ === tileZ),
  )

  const worldSessionExtensionPorts: WorldSessionExtensionPorts = Object.freeze({
    dynamicActors: Object.freeze({
      getBlockingActorsAt(
        mapId: number,
        tileX: number,
        tileZ: number,
        excludedActorId?: string,
      ) {
        return Object.freeze(actorsAt(mapId, tileX, tileZ).filter((actor) => (
          actor.collision === 'blocking' && actor.id !== excludedActorId
        )))
      },
      getInteractableActorsAt(mapId: number, tileX: number, tileZ: number) {
        return Object.freeze(actorsAt(mapId, tileX, tileZ).filter((actor) => actor.interaction === 'action'))
      },
    }),
  })

  // La table rend explicite que l'ordre d'affectation dépend du plan complet,
  // pas de l'ordre d'arrivée des statistiques ni de la restauration.
  if (questOrder.size !== runtime.plan.quests.length) {
    throw new Error('Le plan Tous les Pokémon contient plusieurs quêtes pour une même espèce.')
  }
  return Object.freeze({
    worldSessionExtensionPorts,
    listActors,
    getInteraction,
    prepareInteraction,
    startInteraction,
  })
}
