import {
  baseBattleActionPolicy,
  type BattleActionPolicy,
  type BattleActionVeto,
  type PlayerBattleActionIntent,
} from '../../battle/battleActionPolicy'
import {
  noopDetailedBattleOutcomeObserver,
  type DetailedBattleOutcomeEvent,
  type DetailedBattleOutcomeObserver,
} from '../../battle/battleOutcomeObserver'
import {
  noopWildEncounterStartedObserver,
  type WildEncounterStartedEvent,
  type WildEncounterStartedObserver,
} from '../../encounters/wildEncounterStartedObserver'
import type { PokemonInstanceId } from '../../pokemon/pokemonInstanceId'
import {
  defineVersionedSaveExtension,
  type VersionedSaveExtensionContributor,
} from '../../save/versionedSaveExtensions'
import {
  createEmptyNuzlockeState,
  createNuzlockeSectionEncounter,
  isNuzlockeStateV1,
  parseNuzlockeStateV1,
  type NuzlockeSectionEncounterV1,
  type NuzlockeStateV1,
} from './nuzlockeState'

export const nuzlockeSaveExtensionKey = 'new-game-plus.nuzlocke'
export const nuzlockeSaveExtensionVersion = 1

export type NuzlockeRuntimeOptions = Readonly<{
  /** L'appelant doit lier cette valeur à la présence du module dans le profil. */
  enabled: boolean
  state?: unknown
}>

export type NuzlockeRuntime = Readonly<{
  enabled: boolean
  wildEncounterStartedObserver: WildEncounterStartedObserver
  detailedBattleOutcomeObserver: DetailedBattleOutcomeObserver
  battleActionPolicy: BattleActionPolicy
  snapshotState: () => NuzlockeStateV1 | undefined
  restoreState: (value: unknown) => void
}>

type ActiveEncounter = Readonly<{
  mapSectionId: number
  instanceId: PokemonInstanceId
  isFirstEncounter: boolean
}>

const consumedVeto: BattleActionVeto = Object.freeze({
  code: 'new-game-plus.nuzlocke.section-consumed',
  reason: 'La première rencontre de cette zone a déjà été consommée.',
})
const untrackedVeto: BattleActionVeto = Object.freeze({
  code: 'new-game-plus.nuzlocke.encounter-untracked',
  reason: "Cette rencontre n'a pas été enregistrée par la règle Nuzlocke.",
})

function isCaptureIntent(intent: PlayerBattleActionIntent): boolean {
  return (intent.kind === 'bag' && intent.role === 'capture')
    || (intent.kind === 'safari' && intent.action === 'ball')
}

function replaceEncounterOutcome(
  encounters: Map<number, NuzlockeSectionEncounterV1>,
  sectionId: number,
  outcome: NuzlockeSectionEncounterV1['outcome'],
): void {
  const current = encounters.get(sectionId)
  if (!current || current.outcome === outcome) return
  encounters.set(sectionId, Object.freeze({ ...current, outcome }))
}

function snapshot(encounters: ReadonlyMap<number, NuzlockeSectionEncounterV1>): NuzlockeStateV1 {
  return parseNuzlockeStateV1({
    ...createEmptyNuzlockeState(),
    sections: [...encounters.values()].sort((left, right) => left.mapSectionId - right.mapSectionId),
  })
}

/**
 * Agrège les trois ports nécessaires sans dépendre de l'UI ou du moteur de
 * capture. Une section est consommée au démarrage réel de sa première
 * rencontre ; les Balls restent utilisables pendant cette même rencontre.
 */
export function createNuzlockeRuntime(options: NuzlockeRuntimeOptions): NuzlockeRuntime {
  const initialState = options.state === undefined ? createEmptyNuzlockeState() : parseNuzlockeStateV1(options.state)
  let encounters = new Map(initialState.sections.map((section) => [section.mapSectionId, section]))
  let activeEncounter: ActiveEncounter | undefined

  const restoreState = (value: unknown): void => {
    const parsed = parseNuzlockeStateV1(value)
    encounters = new Map(parsed.sections.map((section) => [section.mapSectionId, section]))
    activeEncounter = undefined
  }

  if (!options.enabled) {
    return Object.freeze({
      enabled: false,
      wildEncounterStartedObserver: noopWildEncounterStartedObserver,
      detailedBattleOutcomeObserver: noopDetailedBattleOutcomeObserver,
      battleActionPolicy: baseBattleActionPolicy,
      snapshotState: () => undefined,
      restoreState,
    })
  }

  const wildEncounterStartedObserver: WildEncounterStartedObserver = Object.freeze({
    observeWildEncounterStarted(event: WildEncounterStartedEvent) {
      const started = createNuzlockeSectionEncounter(event)
      if (activeEncounter?.instanceId === started.instanceId
        && activeEncounter.mapSectionId === started.mapSectionId) return

      if (activeEncounter?.isFirstEncounter) {
        replaceEncounterOutcome(encounters, activeEncounter.mapSectionId, 'missed')
      }
      const previous = encounters.get(started.mapSectionId)
      if (!previous) encounters.set(started.mapSectionId, started)
      activeEncounter = Object.freeze({
        mapSectionId: started.mapSectionId,
        instanceId: started.instanceId,
        isFirstEncounter: previous === undefined,
      })
    },
  })

  const detailedBattleOutcomeObserver: DetailedBattleOutcomeObserver = Object.freeze({
    observeBattleOutcome(event: DetailedBattleOutcomeEvent) {
      if (!activeEncounter) return
      if (event.kind === 'pokemon-knocked-out') {
        if (activeEncounter.isFirstEncounter
          && event.pokemon.side === 'opponent'
          && event.pokemon.instanceId === activeEncounter.instanceId) {
          replaceEncounterOutcome(encounters, activeEncounter.mapSectionId, 'missed')
        }
        return
      }

      if (event.outcome === 'capture') {
        if (activeEncounter.isFirstEncounter
          && event.capturedPokemon.side === 'opponent'
          && event.capturedPokemon.instanceId === activeEncounter.instanceId) {
          replaceEncounterOutcome(encounters, activeEncounter.mapSectionId, 'caught')
        }
      } else if (activeEncounter.isFirstEncounter) {
        replaceEncounterOutcome(encounters, activeEncounter.mapSectionId, 'missed')
      }
      activeEncounter = undefined
    },
  })

  const battleActionPolicy: BattleActionPolicy = Object.freeze({
    vetoPlayerAction(intent) {
      if (!isCaptureIntent(intent)) return undefined
      if (!activeEncounter) return untrackedVeto
      const first = encounters.get(activeEncounter.mapSectionId)
      return activeEncounter.isFirstEncounter
        && first?.instanceId === activeEncounter.instanceId
        && first.outcome === 'started'
        ? undefined
        : consumedVeto
    },
  })

  return Object.freeze({
    enabled: true,
    wildEncounterStartedObserver,
    detailedBattleOutcomeObserver,
    battleActionPolicy,
    snapshotState: () => snapshot(encounters),
    restoreState,
  })
}

/** Contributeur autonome ; le registre d'application décide s'il est monté. */
export const nuzlockeSaveExtension: VersionedSaveExtensionContributor<NuzlockeRuntime, NuzlockeRuntime> =
  defineVersionedSaveExtension<NuzlockeRuntime, NuzlockeRuntime, NuzlockeStateV1>({
    key: nuzlockeSaveExtensionKey,
    version: nuzlockeSaveExtensionVersion,
    save: (runtime) => runtime.snapshotState(),
    validate: isNuzlockeStateV1,
    load: (runtime, value) => runtime.restoreState(value),
  })
