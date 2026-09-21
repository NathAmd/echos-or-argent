import { describe, expect, it, vi } from 'vitest'
import {
  createRealtimeJourneyCoordinator,
  type RealtimeJourneyHostCallbacks,
  type RealtimeJourneyPersistenceCallback,
  type RealtimeJourneySnapshot,
} from './realtimeJourneyCoordinator'

const terrainSnapshot: RealtimeJourneySnapshot = {
  battle: 'none',
  debugReady: false,
  script: false,
  zephyrBadge: false,
  falknerDefeated: false,
  togepiEggReceived: false,
  togepiReturnComplete: false,
  slowpokeWellCleared: false,
  hiveBadge: false,
  bugsyDefeated: false,
  hiveGymComplete: false,
  ilexForestCleared: false,
  cutLearned: false,
  radioQuizComplete: false,
  plainBadge: false,
  whitneyDefeated: false,
  plainGymComplete: false,
  squirtBottleReceived: false,
  sudowoodoCleared: false,
  legendaryBeastsReleased: false,
  fogBadge: false,
  mortyDefeated: false,
  fogGymComplete: false,
}

const completedSnapshot: RealtimeJourneySnapshot = {
  ...terrainSnapshot,
  zephyrBadge: true,
  falknerDefeated: true,
}

const completedTogepiSnapshot: RealtimeJourneySnapshot = {
  ...completedSnapshot,
  togepiEggReceived: true,
  togepiReturnComplete: true,
}

const completedHiveSnapshot: RealtimeJourneySnapshot = {
  ...completedTogepiSnapshot,
  slowpokeWellCleared: true,
  hiveBadge: true,
  bugsyDefeated: true,
  hiveGymComplete: true,
}

const completedPlainSnapshot: RealtimeJourneySnapshot = {
  ...completedHiveSnapshot,
  ilexForestCleared: true,
  cutLearned: true,
  radioQuizComplete: true,
  plainBadge: true,
  whitneyDefeated: true,
  plainGymComplete: true,
}

const completedFogSnapshot: RealtimeJourneySnapshot = {
  ...completedPlainSnapshot,
  squirtBottleReceived: true,
  sudowoodoCleared: true,
  legendaryBeastsReleased: true,
  fogBadge: true,
  mortyDefeated: true,
  fogGymComplete: true,
}

function createHost(overrides: Partial<RealtimeJourneyHostCallbacks> = {}): RealtimeJourneyHostCallbacks {
  return {
    startTerrain: vi.fn(),
    pauseTerrain: vi.fn(),
    resumeTerrain: vi.fn(),
    stopTerrain: vi.fn(),
    advanceBattle: vi.fn(),
    executeDebugCommand: vi.fn(),
    requestPersistence: vi.fn(),
    ...overrides,
  }
}

describe('createRealtimeJourneyCoordinator', () => {
  it('démarre une seule exécution avec une seed et un checkpoint copiés', () => {
    const host = createHost()
    const coordinator = createRealtimeJourneyCoordinator(host)
    const checkpoint = { id: 'route-29', label: 'Route 29' }

    expect(coordinator.getState()).toMatchObject({ status: 'idle' })
    expect(coordinator.start({ seed: 42, checkpoint })).toBe(true)
    checkpoint.label = 'modifié hors coordinateur'

    expect(coordinator.getState()).toMatchObject({
      status: 'running',
      seed: 42,
      checkpoint: { id: 'route-29', label: 'Route 29' },
    })
    expect(host.startTerrain).toHaveBeenCalledOnce()
    expect(host.startTerrain).toHaveBeenCalledWith(42)
    expect(coordinator.start({ seed: 99 })).toBe(false)
    expect(host.startTerrain).toHaveBeenCalledOnce()
    expect(() => createRealtimeJourneyCoordinator(createHost()).start({ seed: -1 })).toThrow('seed')
  })

  it('rejette explicitement un jalon inconnu sans démarrer le terrain', () => {
    const host = createHost()
    const coordinator = createRealtimeJourneyCoordinator(host)

    expect(() => coordinator.start({ seed: 42, goal: 'indigo-badge' as never })).toThrow('inconnu')
    expect(coordinator.getState().status).toBe('idle')
    expect(host.startTerrain).not.toHaveBeenCalled()
  })

  it('attend debugReady, prépare chaque combat une seule fois puis reprend le terrain', () => {
    const host = createHost()
    const coordinator = createRealtimeJourneyCoordinator(host)
    coordinator.start({ seed: 7 })

    coordinator.tick({ ...terrainSnapshot, battle: 'simple' })
    coordinator.tick({ ...terrainSnapshot, battle: 'simple' })
    expect(coordinator.getState().status).toBe('paused-for-battle')
    expect(host.pauseTerrain).toHaveBeenCalledOnce()
    expect(host.executeDebugCommand).not.toHaveBeenCalled()
    expect(host.advanceBattle).toHaveBeenCalledTimes(2)

    coordinator.tick({ ...terrainSnapshot, battle: 'simple', debugReady: true })
    coordinator.tick({ ...terrainSnapshot, battle: 'simple', debugReady: true })
    expect(host.executeDebugCommand).toHaveBeenCalledTimes(2)
    expect(host.executeDebugCommand).toHaveBeenNthCalledWith(1, { kind: 'godmode', enabled: true })
    expect(host.executeDebugCommand).toHaveBeenNthCalledWith(2, { kind: 'instant-kill' })
    expect(host.advanceBattle).toHaveBeenCalledTimes(2)

    coordinator.tick({ ...terrainSnapshot, battle: 'simple', debugReady: false })
    expect(host.advanceBattle).toHaveBeenCalledTimes(3)
    coordinator.tick({ ...terrainSnapshot, battle: 'simple', debugReady: true })
    expect(host.advanceBattle).toHaveBeenCalledTimes(3)

    coordinator.tick(terrainSnapshot)
    coordinator.tick(terrainSnapshot)
    expect(coordinator.getState().status).toBe('running')
    expect(host.resumeTerrain).toHaveBeenCalledOnce()

    coordinator.tick({ ...terrainSnapshot, battle: 'double', debugReady: true })
    expect(host.pauseTerrain).toHaveBeenCalledTimes(2)
    expect(host.executeDebugCommand).toHaveBeenCalledTimes(4)
  })

  it('refuse un combat Safari, impossible sur la route du premier badge', () => {
    const host = createHost()
    const coordinator = createRealtimeJourneyCoordinator(host)
    coordinator.start({ seed: 4 })

    coordinator.tick({ ...terrainSnapshot, battle: 'safari' })

    expect(coordinator.getState().status).toBe('failed')
    expect(coordinator.getState().error?.message).toContain('Safari')
    expect(host.stopTerrain).toHaveBeenCalledOnce()
  })

  it.each([
    ['le badge manque', { ...completedSnapshot, zephyrBadge: false }],
    ["la victoire contre Albert manque", { ...completedSnapshot, falknerDefeated: false }],
    ['un script tourne encore', { ...completedSnapshot, script: true }],
  ])('ne demande pas de sauvegarde lorsque %s', (_label, snapshot) => {
    const host = createHost()
    const coordinator = createRealtimeJourneyCoordinator(host)
    coordinator.start({ seed: 1 })

    coordinator.tick(snapshot)

    expect(coordinator.getState().status).toBe('running')
    expect(host.requestPersistence).not.toHaveBeenCalled()
  })

  it('ne finalise pas tant qu’un combat est actif', () => {
    const host = createHost()
    const coordinator = createRealtimeJourneyCoordinator(host)
    coordinator.start({ seed: 1 })

    coordinator.tick({ ...completedSnapshot, battle: 'simple' })

    expect(coordinator.getState().status).toBe('paused-for-battle')
    expect(host.requestPersistence).not.toHaveBeenCalled()
  })

  it('conserve Zéphyr par défaut et exige la preuve Togepi pour le jalon suivant', () => {
    const zephyrHost = createHost({ requestPersistence: (confirm) => { confirm({ saveReady: true }) } })
    const zephyr = createRealtimeJourneyCoordinator(zephyrHost)
    zephyr.start({ seed: 1 })
    zephyr.tick(completedSnapshot)
    expect(zephyr.getState().status).toBe('passed')

    const togepiHost = createHost({ requestPersistence: vi.fn((confirm) => { confirm({ saveReady: true }) }) })
    const togepi = createRealtimeJourneyCoordinator(togepiHost)
    togepi.start({ seed: 1, goal: 'togepi-egg' })
    togepi.tick({ ...completedSnapshot, togepiEggReceived: true })
    expect(togepi.getState().status).toBe('running')
    expect(togepiHost.requestPersistence).not.toHaveBeenCalled()

    togepi.tick(completedTogepiSnapshot)
    expect(togepi.getState().status).toBe('passed')
    expect(togepiHost.requestPersistence).toHaveBeenCalledOnce()
  })

  it('exige toutes les preuves indépendantes avant de valider le Badge Essaim', () => {
    const required = [
      'zephyrBadge',
      'falknerDefeated',
      'togepiEggReceived',
      'slowpokeWellCleared',
      'hiveBadge',
      'bugsyDefeated',
      'hiveGymComplete',
    ] as const
    for (const missing of required) {
      const host = createHost({ requestPersistence: vi.fn((confirm) => { confirm({ saveReady: true }) }) })
      const coordinator = createRealtimeJourneyCoordinator(host)
      coordinator.start({ seed: 1, goal: 'hive-badge' })
      coordinator.tick({ ...completedHiveSnapshot, [missing]: false })
      expect(coordinator.getState().status, missing).toBe('running')
      expect(host.requestPersistence, missing).not.toHaveBeenCalled()
    }

    const host = createHost({ requestPersistence: vi.fn((confirm) => { confirm({ saveReady: true }) }) })
    const coordinator = createRealtimeJourneyCoordinator(host)
    coordinator.start({ seed: 1, goal: 'hive-badge' })
    coordinator.tick(completedHiveSnapshot)
    expect(coordinator.getState()).toMatchObject({
      status: 'passed',
      checkpoint: { id: 'hive-badge-complete', label: 'Badge Essaim obtenu' },
    })
    expect(host.requestPersistence).toHaveBeenCalledOnce()
  })

  it('exige Coupe, le quiz Radio, Blanche et la scène finale pour le Badge Plaine', () => {
    const required = [
      'ilexForestCleared',
      'cutLearned',
      'radioQuizComplete',
      'plainBadge',
      'whitneyDefeated',
      'plainGymComplete',
    ] as const
    for (const missing of required) {
      const host = createHost({ requestPersistence: vi.fn((confirm) => { confirm({ saveReady: true }) }) })
      const coordinator = createRealtimeJourneyCoordinator(host)
      coordinator.start({ seed: 1, goal: 'plain-badge' })
      coordinator.tick({ ...completedPlainSnapshot, [missing]: false })
      expect(coordinator.getState().status, missing).toBe('running')
      expect(host.requestPersistence, missing).not.toHaveBeenCalled()
    }

    const host = createHost({ requestPersistence: vi.fn((confirm) => { confirm({ saveReady: true }) }) })
    const coordinator = createRealtimeJourneyCoordinator(host)
    coordinator.start({ seed: 1, goal: 'plain-badge' })
    coordinator.tick(completedPlainSnapshot)
    expect(coordinator.getState()).toMatchObject({
      status: 'passed',
      checkpoint: { id: 'plain-badge-complete', label: 'Badge Plaine obtenu' },
    })
  })

  it('exige le Carapuce à O, Simularbre, les fauves et Mortimer pour le Badge Brume', () => {
    const required = [
      'squirtBottleReceived',
      'sudowoodoCleared',
      'legendaryBeastsReleased',
      'fogBadge',
      'mortyDefeated',
      'fogGymComplete',
    ] as const
    for (const missing of required) {
      const host = createHost({ requestPersistence: vi.fn((confirm) => { confirm({ saveReady: true }) }) })
      const coordinator = createRealtimeJourneyCoordinator(host)
      coordinator.start({ seed: 1, goal: 'fog-badge' })
      coordinator.tick({ ...completedFogSnapshot, [missing]: false })
      expect(coordinator.getState().status, missing).toBe('running')
      expect(host.requestPersistence, missing).not.toHaveBeenCalled()
    }

    const host = createHost({ requestPersistence: vi.fn((confirm) => { confirm({ saveReady: true }) }) })
    const coordinator = createRealtimeJourneyCoordinator(host)
    coordinator.start({ seed: 1, goal: 'fog-badge' })
    coordinator.tick(completedFogSnapshot)
    expect(coordinator.getState()).toMatchObject({
      status: 'passed',
      checkpoint: { id: 'fog-badge-complete', label: 'Badge Brume obtenu' },
    })
  })

  it('finalise uniquement au repos puis passe après confirmation saveReady', () => {
    let confirmPersistence: RealtimeJourneyPersistenceCallback | undefined
    const host = createHost({
      requestPersistence: vi.fn((confirm) => { confirmPersistence = confirm }),
    })
    const coordinator = createRealtimeJourneyCoordinator(host)
    coordinator.start({ seed: 123 })
    coordinator.tick({ ...completedSnapshot, checkpoint: { id: 'zephyr-badge', label: 'Badge Zéphyr' } })

    expect(coordinator.getState()).toMatchObject({
      status: 'finalizing',
      seed: 123,
      checkpoint: { id: 'zephyr-badge' },
    })
    expect(host.stopTerrain).toHaveBeenCalledOnce()
    expect(host.requestPersistence).toHaveBeenCalledOnce()

    coordinator.tick(completedSnapshot)
    expect(host.requestPersistence).toHaveBeenCalledOnce()
    confirmPersistence?.({ saveReady: true })

    expect(coordinator.getState()).toMatchObject({ status: 'passed', seed: 123 })
    expect(coordinator.getState().error).toBeUndefined()
    expect(host.stopTerrain).toHaveBeenCalledOnce()
  })

  it('conserve le checkpoint final Essaim pendant une persistance asynchrone', () => {
    let confirmPersistence: RealtimeJourneyPersistenceCallback | undefined
    const coordinator = createRealtimeJourneyCoordinator(createHost({
      requestPersistence: (confirm) => { confirmPersistence = confirm },
    }))

    coordinator.start({ seed: 7, goal: 'hive-badge' })
    coordinator.tick({ ...completedHiveSnapshot, checkpoint: { id: 'hive-badge', label: 'Battre Hector' } })
    expect(coordinator.getState()).toMatchObject({ status: 'finalizing', checkpoint: { id: 'hive-badge-complete' } })

    coordinator.tick({ ...completedHiveSnapshot, checkpoint: { id: 'hive-badge', label: 'Battre Hector' } })
    confirmPersistence?.({ saveReady: true })
    expect(coordinator.getState()).toMatchObject({ status: 'passed', checkpoint: { id: 'hive-badge-complete' } })
  })

  it('échoue si la persistance ne confirme pas saveReady ou remonte une erreur', () => {
    let firstConfirmation: RealtimeJourneyPersistenceCallback | undefined
    const first = createRealtimeJourneyCoordinator(createHost({
      requestPersistence: (confirm) => { firstConfirmation = confirm },
    }))
    first.start({ seed: 1 })
    first.tick(completedSnapshot)
    firstConfirmation?.({ saveReady: false })
    expect(first.getState().status).toBe('failed')
    expect(first.getState().error?.message).toContain('pas prête')

    const persistenceError = new Error('quota indisponible')
    let secondConfirmation: RealtimeJourneyPersistenceCallback | undefined
    const second = createRealtimeJourneyCoordinator(createHost({
      requestPersistence: (confirm) => { secondConfirmation = confirm },
    }))
    second.start({ seed: 2 })
    second.tick(completedSnapshot)
    secondConfirmation?.({ saveReady: false, error: persistenceError })
    expect(second.getState()).toMatchObject({ status: 'failed', error: persistenceError })
  })

  it('annule une finalisation stoppée et ignore toute confirmation tardive', () => {
    let staleConfirmation: RealtimeJourneyPersistenceCallback | undefined
    const cancel = vi.fn()
    const requestPersistence = vi.fn((confirm: RealtimeJourneyPersistenceCallback) => {
      staleConfirmation = confirm
      return cancel
    })
    const host = createHost({
      requestPersistence,
    })
    const coordinator = createRealtimeJourneyCoordinator(host)
    coordinator.start({ seed: 10 })
    coordinator.tick(completedSnapshot)

    expect(coordinator.stop()).toBe(true)
    expect(coordinator.stop()).toBe(false)
    expect(cancel).toHaveBeenCalledOnce()
    expect(coordinator.getState().status).toBe('stopped')

    staleConfirmation?.({ saveReady: true })
    coordinator.tick(completedSnapshot)
    expect(coordinator.getState().status).toBe('stopped')
    expect(requestPersistence).toHaveBeenCalledOnce()
  })

  it('isole une nouvelle exécution des callbacks de sauvegarde de l’ancienne', () => {
    const confirmations: RealtimeJourneyPersistenceCallback[] = []
    const host = createHost({
      requestPersistence: (confirm) => { confirmations.push(confirm) },
    })
    const coordinator = createRealtimeJourneyCoordinator(host)
    coordinator.start({ seed: 11 })
    coordinator.tick(completedSnapshot)
    coordinator.stop()

    expect(coordinator.start({ seed: 12 })).toBe(true)
    confirmations[0]?.({ saveReady: true })
    expect(coordinator.getState()).toMatchObject({ status: 'running', seed: 12 })

    coordinator.tick(completedSnapshot)
    confirmations[1]?.({ saveReady: true })
    expect(coordinator.getState()).toMatchObject({ status: 'passed', seed: 12 })
  })

  it('échoue si le combat ou le script reprend pendant la sauvegarde', () => {
    let confirmation: RealtimeJourneyPersistenceCallback | undefined
    const cancel = vi.fn()
    const host = createHost({
      requestPersistence: (confirm) => {
        confirmation = confirm
        return cancel
      },
    })
    const coordinator = createRealtimeJourneyCoordinator(host)
    coordinator.start({ seed: 5 })
    coordinator.tick(completedSnapshot)
    coordinator.tick({ ...completedSnapshot, script: true })

    expect(coordinator.getState().status).toBe('failed')
    expect(cancel).toHaveBeenCalledOnce()
    confirmation?.({ saveReady: true })
    expect(coordinator.getState().status).toBe('failed')
  })

  it('convertit les erreurs terrain et hôte en échec terminal sans callback tardif', () => {
    const debugError = new Error('debug refusé')
    const host = createHost({
      executeDebugCommand: () => { throw debugError },
    })
    const coordinator = createRealtimeJourneyCoordinator(host)
    coordinator.start({ seed: 8 })
    coordinator.tick({ ...terrainSnapshot, battle: 'simple', debugReady: true })

    expect(coordinator.getState()).toMatchObject({ status: 'failed', seed: 8, error: debugError })
    expect(host.stopTerrain).toHaveBeenCalledOnce()
    coordinator.tick(terrainSnapshot)
    expect(host.resumeTerrain).not.toHaveBeenCalled()

    const terrainError = new Error('chemin impossible')
    const second = createRealtimeJourneyCoordinator(createHost())
    second.start({ seed: 9 })
    second.tick({ ...terrainSnapshot, error: terrainError })
    expect(second.getState()).toMatchObject({ status: 'failed', error: terrainError })
  })
})
