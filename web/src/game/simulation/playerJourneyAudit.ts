import type { PlayerDirection } from '../../ndsTypes'
import type { FieldScriptState } from '../scripts/fieldScriptRunner'
import type { FieldInput, FieldInputSimulator, FieldSimulationEvent } from './fieldInputSimulator'

export type PlayerJourneyCheckpoint = {
  id: string
  label: string
}

export type PlayerJourneySnapshot = {
  checkpoint: PlayerJourneyCheckpoint
  lastInput?: FieldInput
  mapId: number
  tileX: number
  tileZ: number
  direction: PlayerDirection
  flags: number[]
  trainerFlags: number[]
  variables: [number, number][]
  partySpeciesIds: number[]
  timeline: string[]
}

export class PlayerJourneyBlocker extends Error {
  readonly snapshot: PlayerJourneySnapshot

  constructor(cause: unknown, snapshot: PlayerJourneySnapshot) {
    const message = cause instanceof Error ? cause.message : String(cause)
    super(`Blocage joueur à l’étape « ${snapshot.checkpoint.label} » (${snapshot.checkpoint.id})\n${JSON.stringify({
      dernièreEntrée: snapshot.lastInput,
      position: { mapId: snapshot.mapId, x: snapshot.tileX, z: snapshot.tileZ, direction: snapshot.direction },
      équipe: snapshot.partySpeciesIds,
      drapeaux: snapshot.flags,
      dresseursVaincus: snapshot.trainerFlags,
      variables: snapshot.variables,
      derniersÉvénements: snapshot.timeline,
      erreur: message,
    }, null, 2)}`)
    this.name = 'PlayerJourneyBlocker'
    this.snapshot = snapshot
  }
}

export type PlayerJourneyAudit = {
  checkpoint: (id: string, label: string) => void
  input: (input: FieldInput) => FieldSimulationEvent[]
  settle: () => FieldSimulationEvent[]
  battleResult: (won: boolean) => FieldSimulationEvent[]
  run: <T>(action: () => T) => T
  snapshot: () => PlayerJourneySnapshot
}

function formatEvent(event: FieldSimulationEvent): string {
  if (event.kind === 'moved') return `déplacement carte ${event.mapId} (${event.tileX}, ${event.tileZ})`
  if (event.kind === 'blocked') return `bloqué ${event.reason} (${event.tileX}, ${event.tileZ})`
  if (event.kind === 'message') return `dialogue ${event.messageId}`
  if (event.kind === 'battle') return `combat ${event.battle.kind}`
  if (event.kind === 'choiceCursor') return `choix ${event.index}`
  return event.kind
}

function getWorldPosition(simulator: FieldInputSimulator): { mapId: number, tileX: number, tileZ: number, direction: PlayerDirection } {
  const state = simulator.getWorld().getState()
  if (!state) throw new Error('Le simulateur ne contient aucune carte active.')
  return { mapId: state.map.id, tileX: state.tileX, tileZ: state.tileZ, direction: state.direction }
}

function getFieldSummary(state: FieldScriptState): Pick<PlayerJourneySnapshot, 'flags' | 'trainerFlags' | 'variables' | 'partySpeciesIds'> {
  return {
    flags: [...state.flags].sort((left, right) => left - right),
    trainerFlags: [...state.trainerFlags].sort((left, right) => left - right),
    variables: [...state.variables.entries()].sort(([left], [right]) => left - right),
    partySpeciesIds: state.party.members.map((pokemon) => pokemon.speciesId),
  }
}

export function createPlayerJourneyAudit(simulator: FieldInputSimulator, validateState?: () => void): PlayerJourneyAudit {
  let currentCheckpoint: PlayerJourneyCheckpoint = { id: 'new-game', label: 'Nouvelle partie' }
  let lastInput: FieldInput | undefined
  const timeline: string[] = []

  const record = (events: FieldSimulationEvent[]): FieldSimulationEvent[] => {
    for (const event of events) {
      timeline.push(formatEvent(event))
      if (timeline.length > 32) timeline.shift()
    }
    validateState?.()
    return events
  }

  const snapshot = (): PlayerJourneySnapshot => ({
    checkpoint: currentCheckpoint,
    lastInput,
    ...getWorldPosition(simulator),
    ...getFieldSummary(simulator.getFieldState()),
    timeline: [...timeline],
  })

  return {
    checkpoint(id, label) {
      currentCheckpoint = { id, label }
    },
    input(input) {
      lastInput = input
      return record(simulator.input(input))
    },
    settle() {
      return record(simulator.settle())
    },
    battleResult(won) {
      return record(simulator.submitBattleResult(won))
    },
    run(action) {
      try {
        return action()
      } catch (error) {
        if (error instanceof PlayerJourneyBlocker) throw error
        throw new PlayerJourneyBlocker(error, snapshot())
      }
    },
    snapshot,
  }
}
