import { describe, expect, it, vi } from 'vitest'
import { createRealtimeJourneyBridge, realtimeZephyrJourneySeed, type RealtimeJourneyBridgeHost } from './realtimeJourneyBridge'
import type { RealtimeJourneySnapshot } from './realtimeJourneyCoordinator'
import type { RealtimeTestBotJourney } from './realtimeTestScript'

const field: RealtimeJourneySnapshot = {
  battle: 'none', debugReady: false, script: false, zephyrBadge: false, falknerDefeated: false, togepiEggReceived: false,
  togepiReturnComplete: false, slowpokeWellCleared: false, hiveBadge: false, bugsyDefeated: false, hiveGymComplete: false,
  ilexForestCleared: false, cutLearned: false, radioQuizComplete: false, plainBadge: false, whitneyDefeated: false, plainGymComplete: false,
  squirtBottleReceived: false, sudowoodoCleared: false, legendaryBeastsReleased: false, fogBadge: false, mortyDefeated: false, fogGymComplete: false,
}

function createHost(readJourneySnapshot: () => RealtimeJourneySnapshot): RealtimeJourneyBridgeHost {
  return {
    startOpening: vi.fn(() => 'Ouverture lancée.'),
    readJourneySnapshot,
    startTerrain: vi.fn(), pauseTerrain: vi.fn(), resumeTerrain: vi.fn(), stopTerrain: vi.fn(),
    advanceBattle: vi.fn(), executeDebugCommand: vi.fn(),
    requestPersistence: (confirm) => { confirm({ saveReady: true }) },
  }
}

describe('realtime journey bridge', () => {
  it('conserve le bot d’ouverture et expose la campagne Zéphyr au panneau TXT', () => {
    let snapshot = field
    const host = createHost(() => snapshot)
    const bridge = createRealtimeJourneyBridge(host)

    expect(bridge.startBotJourney('opening')).toBe('Ouverture lancée.')
    expect(host.startOpening).toHaveBeenCalledOnce()
    expect(bridge.startBotJourney('zephyr')).toContain(String(realtimeZephyrJourneySeed))
    expect(host.startTerrain).toHaveBeenCalledWith(realtimeZephyrJourneySeed, 'normal', 'zephyr')

    snapshot = { ...field, zephyrBadge: true, falknerDefeated: true, checkpoint: { id: 'zephyr-badge', label: 'Badge Zéphyr' } }
    bridge.tick()
    expect(bridge.getSnapshot()).toMatchObject({
      journey: 'passed', journeyCheckpoint: 'zephyr-badge', saveReady: true,
    })
  })

  it('transmet le preset NG+ au démarrage terrain sans modifier le coordinateur de combat', () => {
    const host = createHost(() => field)
    const bridge = createRealtimeJourneyBridge(host)
    expect(bridge.startBotJourney('zephyr', 'ngp-duo-eevee')).toContain('ngp-duo-eevee')
    expect(host.startTerrain).toHaveBeenCalledWith(realtimeZephyrJourneySeed, 'ngp-duo-eevee', 'zephyr')
  })

  it('route Togepi vers son jalon dédié et attend sa preuve avant de réussir', () => {
    let snapshot = { ...field, zephyrBadge: true, falknerDefeated: true }
    const host = createHost(() => snapshot)
    const bridge = createRealtimeJourneyBridge(host)

    expect(bridge.startBotJourney('togepi')).toContain('Togepi')
    expect(host.startTerrain).toHaveBeenCalledWith(realtimeZephyrJourneySeed, 'normal', 'togepi')
    bridge.tick()
    expect(bridge.getSnapshot()).toMatchObject({ journey: 'running', saveReady: false })

    snapshot = {
      ...snapshot,
      togepiEggReceived: true,
      togepiReturnComplete: true,
      checkpoint: { id: 'togepi-egg', label: 'Œuf de Togepi' },
    }
    bridge.tick()
    expect(bridge.getSnapshot()).toMatchObject({
      journey: 'passed', journeyCheckpoint: 'togepi-egg', saveReady: true,
    })
  })

  it('route le Badge Essaim et attend les preuves du Puits, du badge et d’Hector', () => {
    let snapshot = { ...field, zephyrBadge: true, falknerDefeated: true, togepiEggReceived: true }
    const host = createHost(() => snapshot)
    const bridge = createRealtimeJourneyBridge(host)

    expect(bridge.startBotJourney('hive')).toContain('Badge Essaim')
    expect(host.startTerrain).toHaveBeenCalledWith(realtimeZephyrJourneySeed, 'normal', 'hive')
    bridge.tick()
    expect(bridge.getSnapshot()).toMatchObject({ journey: 'running', saveReady: false })

    snapshot = {
      ...snapshot,
      slowpokeWellCleared: true,
      hiveBadge: true,
      bugsyDefeated: true,
      hiveGymComplete: true,
      checkpoint: { id: 'hive-badge-complete', label: 'Badge Essaim obtenu' },
    }
    bridge.tick()
    expect(bridge.getSnapshot()).toMatchObject({
      journey: 'passed', journeyCheckpoint: 'hive-badge-complete', saveReady: true,
    })
  })

  it('route le Badge Plaine et attend les preuves du Bois, de la Radio et de Blanche', () => {
    let snapshot = {
      ...field,
      zephyrBadge: true,
      falknerDefeated: true,
      togepiEggReceived: true,
      slowpokeWellCleared: true,
      hiveBadge: true,
      bugsyDefeated: true,
      hiveGymComplete: true,
    }
    const host = createHost(() => snapshot)
    const bridge = createRealtimeJourneyBridge(host)

    expect(bridge.startBotJourney('plain')).toContain('Badge Plaine')
    expect(host.startTerrain).toHaveBeenCalledWith(realtimeZephyrJourneySeed, 'normal', 'plain')
    bridge.tick()
    expect(bridge.getSnapshot()).toMatchObject({ journey: 'running', saveReady: false })

    snapshot = {
      ...snapshot,
      ilexForestCleared: true,
      cutLearned: true,
      radioQuizComplete: true,
      plainBadge: true,
      whitneyDefeated: true,
      plainGymComplete: true,
    }
    bridge.tick()
    expect(bridge.getSnapshot()).toMatchObject({
      journey: 'passed', journeyCheckpoint: 'plain-badge-complete', saveReady: true,
    })
  })

  it('route le Badge Brume et attend Simularbre, les fauves et Mortimer', () => {
    let snapshot = {
      ...field,
      zephyrBadge: true, falknerDefeated: true, togepiEggReceived: true,
      slowpokeWellCleared: true, hiveBadge: true, bugsyDefeated: true,
      ilexForestCleared: true, cutLearned: true, radioQuizComplete: true,
      plainBadge: true, whitneyDefeated: true,
    }
    const host = createHost(() => snapshot)
    const bridge = createRealtimeJourneyBridge(host)

    expect(bridge.startBotJourney('fog')).toContain('Badge Brume')
    expect(host.startTerrain).toHaveBeenCalledWith(realtimeZephyrJourneySeed, 'normal', 'fog')
    bridge.tick()
    expect(bridge.getSnapshot()).toMatchObject({ journey: 'running', saveReady: false })

    snapshot = {
      ...snapshot,
      squirtBottleReceived: true, sudowoodoCleared: true, legendaryBeastsReleased: true,
      fogBadge: true, mortyDefeated: true, fogGymComplete: true,
    }
    bridge.tick()
    expect(bridge.getSnapshot()).toMatchObject({
      journey: 'passed', journeyCheckpoint: 'fog-badge-complete', saveReady: true,
    })
  })

  it('rejette un journey inconnu sans le rabattre sur Zéphyr', () => {
    const host = createHost(() => field)
    const bridge = createRealtimeJourneyBridge(host)

    expect(() => bridge.startBotJourney('indigo' as RealtimeTestBotJourney)).toThrow('inconnue')
    expect(host.startTerrain).not.toHaveBeenCalled()
    expect(host.startOpening).not.toHaveBeenCalled()
  })

  it('arrête une campagne active sans transformer l’arrêt en réussite', () => {
    const host = createHost(() => field)
    const bridge = createRealtimeJourneyBridge(host)
    bridge.startBotJourney('zephyr')
    bridge.stop()
    expect(bridge.getSnapshot()).toMatchObject({ journey: 'stopped', saveReady: false })
    expect(host.stopTerrain).toHaveBeenCalledOnce()
  })
})
