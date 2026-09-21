import type { RealtimeTestBotJourney } from './realtimeTestScript'
import type { RealtimeCampaignPresetId } from './realtimeNewGamePlusPresets'
import {
  createRealtimeJourneyCoordinator,
  type RealtimeJourneyHostCallbacks,
  type RealtimeJourneyGoal,
  type RealtimeJourneySnapshot,
} from './realtimeJourneyCoordinator'

export const realtimeZephyrJourneySeed = 5_489 as const

type RealtimeTerrainJourney = Exclude<RealtimeTestBotJourney, 'opening'>

export type RealtimeJourneyBridgeHost = Omit<RealtimeJourneyHostCallbacks, 'onStateChange' | 'startTerrain'> & Readonly<{
  startOpening: () => string
  startTerrain: (seed: number, preset: RealtimeCampaignPresetId, journey: RealtimeTerrainJourney) => void
  readJourneySnapshot: () => RealtimeJourneySnapshot
}>

export type RealtimeJourneyBridgeSnapshot = Readonly<{
  journey: ReturnType<ReturnType<typeof createRealtimeJourneyCoordinator>['getState']>['status']
  journeyCheckpoint?: string
  journeySeed?: number
  journeyError?: string
  saveReady: boolean
}>

/** Thin browser bridge: the campaign coordinator stays independent from DOM and main.ts. */
export function createRealtimeJourneyBridge(host: RealtimeJourneyBridgeHost): Readonly<{
  startBotJourney: (journey: RealtimeTestBotJourney, preset?: RealtimeCampaignPresetId) => string
  stop: () => void
  tick: () => void
  getSnapshot: () => RealtimeJourneyBridgeSnapshot
}> {
  let activePreset: RealtimeCampaignPresetId = 'normal'
  let activeTerrainJourney: RealtimeTerrainJourney = 'zephyr'
  const coordinator = createRealtimeJourneyCoordinator({
    ...host,
    startTerrain: (seed) => host.startTerrain(seed, activePreset, activeTerrainJourney),
  })
  return Object.freeze({
    startBotJourney(journey, preset = 'normal') {
      if (journey === 'opening') {
        coordinator.stop()
        return host.startOpening()
      }
      let goal: RealtimeJourneyGoal
      let label: string
      switch (journey) {
        case 'zephyr':
          goal = 'zephyr-badge'
          label = 'Badge Zéphyr'
          break
        case 'togepi':
          goal = 'togepi-egg'
          label = 'œuf de Togepi'
          break
        case 'hive':
          goal = 'hive-badge'
          label = 'Badge Essaim'
          break
        case 'plain':
          goal = 'plain-badge'
          label = 'Badge Plaine'
          break
        case 'fog':
          goal = 'fog-badge'
          label = 'Badge Brume'
          break
        default:
          throw new RangeError(`Campagne temps réel inconnue : ${String(journey)}.`)
      }
      activePreset = preset
      activeTerrainJourney = journey
      if (!coordinator.start({ seed: realtimeZephyrJourneySeed, goal })) {
        throw new Error('Une campagne temps réel est déjà active.')
      }
      return `Campagne temps réel ${preset} vers ${label} lancée (seed ${realtimeZephyrJourneySeed}).`
    },
    stop() { coordinator.stop() },
    tick() { coordinator.tick(host.readJourneySnapshot()) },
    getSnapshot() {
      const state = coordinator.getState()
      return Object.freeze({
        journey: state.status,
        journeyCheckpoint: state.checkpoint?.id,
        journeySeed: state.seed,
        journeyError: state.error?.message,
        saveReady: state.status === 'passed',
      })
    },
  })
}
