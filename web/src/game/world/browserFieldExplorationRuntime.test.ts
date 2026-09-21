import { describe, expect, it, vi } from 'vitest'
import type { MapRuntime } from '../../mapRuntimeTypes'
import type { OpeningMapPreview } from '../../ndsTypes'
import { createFieldScriptState, type FieldScriptRunner } from '../scripts/fieldScriptRunner'
import {
  createBrowserFieldExplorationRuntime,
  type BrowserFieldExplorationRuntimeOptions,
  type BrowserFieldSharedScriptRequest,
} from './browserFieldExplorationRuntime'
import type {
  AuthoritativePlayerTransitionResult,
  WorldInteractionResolution,
  WorldSession,
  WorldState,
} from './worldSession'

function createMap(id: number): OpeningMapPreview {
  return {
    id,
    label: `Carte ${id}`,
    header: {
      mapId: id,
      wildEncounterBank: 255,
      areaDataBank: 0,
      moveModelBank: 0,
      worldMapX: 0,
      worldMapY: 0,
      matrixId: id,
      scriptsBank: 0,
      scriptHeaderBank: 0,
      msgBank: 0,
      dayMusicId: 0,
      nightMusicId: 0,
      eventsBank: 0,
      mapSection: 0,
      areaIcon: 0,
      momCallIntroParam: 0,
      region: 0,
      weather: 0,
      mapType: 0,
      cameraType: 0,
      followMode: 0,
      battleBackground: 0,
      bikeAllowed: false,
      runningAllowed: true,
      escapeRopeAllowed: false,
      flyAllowed: false,
      outgoingCalls: false,
      incomingCalls: false,
      radioSignal: false,
    },
    fieldScripts: {
      bank: 0,
      bytes: new Uint8Array([0x13, 0xfd]),
      headerSize: 2,
      entryOffsets: [],
    },
    initScripts: [
      { type: 'onTransition', scriptId: 9 },
      { type: 'onLoad', scriptId: 6 },
      { type: 'onResume', scriptId: 12 },
    ],
    messages: {},
    matrix: {
      matrixIndex: id,
      name: `matrix-${id}`,
      width: 1,
      height: 1,
      headers: new Uint16Array([id]),
      altitudes: new Uint8Array([0]),
      modelIds: new Uint16Array([0]),
    },
    events: { backgroundEvents: 0, backgrounds: [], coordinateEvents: [], objects: [], warps: [] },
    terrain: { modelId: 0, width: 16, height: 16, attributes: new Uint16Array(16 * 16) },
  }
}

function transition(map: OpeningMapPreview, x: number): AuthoritativePlayerTransitionResult {
  return {
    kind: 'transitioned',
    movement: 'walk',
    state: { map, tileX: x, tileZ: 4, direction: 'east', locomotion: 'walking' },
  }
}

async function flushPresentation(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

type FixtureOverrides = Readonly<{
  campaignLocked?: boolean
  activeRunner?: FieldScriptRunner
  tryStartSharedScript?: (request: BrowserFieldSharedScriptRequest) => Promise<FieldScriptRunner | undefined>
}>

function createFixture(
  loadMapImplementation?: MapRuntime['loadMap'],
  overrides: FixtureOverrides = {},
) {
  const persistentState = createFieldScriptState('male', 'JOUEUR')
  const sourceMap = createMap(1)
  let campaignLocked = overrides.campaignLocked ?? false
  let interactionResolution: WorldInteractionResolution | undefined
  let worldState: WorldState = {
    map: sourceMap,
    tileX: 2,
    tileZ: 4,
    direction: 'east',
    locomotion: 'walking',
  }
  const loadMap = vi.fn(loadMapImplementation ?? (() => undefined))
  const runtime = {
    loadMap,
    setPlayerPosition: vi.fn(() => 'position'),
    setFollowerPosition: vi.fn(),
    setFollowerTexture: vi.fn(),
    setFollowerMovementPaused: vi.fn(),
    isFollowerMoving: vi.fn(() => false),
    isPlayerMoving: vi.fn(() => false),
    syncEventVisibility: vi.fn(),
    syncAzaleaGymMechanism: vi.fn(),
    renderFrame: vi.fn(),
  } as unknown as MapRuntime
  const resolveInteraction = vi.fn(() => interactionResolution)
  const world = {
    getState: () => worldState,
    setFollowerEnabled: vi.fn(),
    getFollowerState: vi.fn(() => undefined),
    findDynamicActorInteraction: vi.fn(() => undefined),
    resolveInteraction,
  } as unknown as WorldSession
  const createdScripts: number[] = []
  const activeRunners: Array<FieldScriptRunner | undefined> = overrides.activeRunner
    ? [overrides.activeRunner]
    : []
  const runner = {} as FieldScriptRunner
  const createScript = vi.fn((_map: OpeningMapPreview, scriptId: number) => {
    createdScripts.push(scriptId)
    return runner
  })
  const advanceScript = vi.fn()
  const tryStartSharedScript = vi.fn(overrides.tryStartSharedScript ?? (async () => undefined))
  const persist = vi.fn(() => true)
  const scheduleAutosave = vi.fn()
  const setPresentationMap = vi.fn()
  const onAuthoritativePresentationFailure = vi.fn()
  const recoverScriptFailure = vi.fn()
  const closeDialogue = vi.fn()
  const setStatus = vi.fn()
  const closeMenu = vi.fn()
  const refreshMenu = vi.fn()
  const options: BrowserFieldExplorationRuntimeOptions = {
    runtime,
    context: {
      readFieldState: () => persistentState,
      readInventory: () => undefined,
      readWorld: () => world,
      readAudio: () => undefined,
      readPlayerTextureStatus: () => 'joueur test',
    },
    campaign: { isLocked: () => campaignLocked, tryStartSharedScript },
    script: {
      readActive: () => activeRunners.at(-1),
      writeActive: (next) => { activeRunners.push(next) },
      has: () => true,
      create: createScript,
      sequence: () => runner,
      advance: advanceScript,
    },
    field: {
      applyPlayerSkin: vi.fn(),
      syncPlayerStateFromWorld: vi.fn(),
      resetScriptEffects: vi.fn(),
      discardPendingStep: vi.fn(),
      clearMovementInput: vi.fn(),
      startMovement: vi.fn(),
      closeDialogue,
      recoverScriptFailure,
      resetPcEntry: vi.fn(),
      resetPhoneRing: vi.fn(),
      setEncounterSession: vi.fn(),
      createEncounterSession: vi.fn(() => undefined),
      clearPreparedEncounter: vi.fn(),
      clearActiveBattleRoamer: vi.fn(),
      syncEnvironment: vi.fn(),
      setPresentationMap,
      onAuthoritativePresentationFailure,
      syncGym: vi.fn(),
      refreshDynamicActors: vi.fn(),
      syncDynamicWorld: vi.fn(),
      tryDynamicWorldInteraction: vi.fn(() => false),
      objectMotion: { invalidate: vi.fn(), reset: vi.fn() },
    },
    ui: {
      closeTransientApplications: vi.fn(),
      closeMenu,
      refreshMenu,
      requestConfirmation: vi.fn(),
      setStatus,
      setPositionStatus: vi.fn(),
      resetFade: vi.fn(),
      fadeScreen: vi.fn(),
    },
    lifecycle: { persist, scheduleAutosave },
    gym: { sync: vi.fn(), tryInteract: vi.fn(() => false) },
    timing: { wait: async () => undefined, waitForPlayerMovement: async () => undefined },
  }
  return {
    runtime: createBrowserFieldExplorationRuntime(options),
    persistentState,
    sourceMap,
    loadMap,
    persist,
    scheduleAutosave,
    setPresentationMap,
    onAuthoritativePresentationFailure,
    createdScripts,
    createScript,
    advanceScript,
    activeRunners,
    tryStartSharedScript,
    resolveInteraction,
    recoverScriptFailure,
    closeDialogue,
    setStatus,
    closeMenu,
    refreshMenu,
    setCampaignLocked: (locked: boolean) => { campaignLocked = locked },
    setInteractionResolution: (resolution: WorldInteractionResolution | undefined) => {
      interactionResolution = resolution
    },
    setWorldState: (next: WorldState) => { worldState = next },
  }
}

describe('browser field exploration authoritative presentation', () => {
  it('présente uniquement la dernière transition puis active une fois ses scripts et son checkpoint', async () => {
    const fixture = createFixture()
    const intermediateMap = createMap(2)
    const destinationMap = createMap(3)
    const intermediate = transition(intermediateMap, 5)
    const destination = transition(destinationMap, 8)

    fixture.setWorldState(intermediate.state)
    fixture.runtime.presentAuthoritativeTransition(intermediate, { kind: 'map-boundary' })
    fixture.setWorldState(destination.state)
    fixture.runtime.presentAuthoritativeTransition(destination, { kind: 'warp' })
    await flushPresentation()

    expect(fixture.loadMap).toHaveBeenCalledOnce()
    expect(fixture.loadMap).toHaveBeenLastCalledWith(
      destinationMap,
      expect.not.objectContaining({ currentMapId: fixture.persistentState.currentMapId }),
      undefined,
    )
    expect(fixture.createdScripts).toEqual([])
    expect(fixture.persist).not.toHaveBeenCalled()
    expect(fixture.scheduleAutosave).not.toHaveBeenCalled()
    expect(fixture.persistentState.currentMapId).toBeUndefined()

    await expect(fixture.runtime.activatePresentedMap()).resolves.toBe(true)

    expect(fixture.loadMap).toHaveBeenCalledTimes(2)
    expect(fixture.loadMap).toHaveBeenLastCalledWith(destinationMap, fixture.persistentState, undefined)
    expect(fixture.persistentState).toMatchObject({ currentMapId: 3, player: { direction: 'east' } })
    expect(fixture.createdScripts).toEqual([9, 6, 12])
    expect(fixture.activeRunners).toHaveLength(1)
    expect(fixture.persist).toHaveBeenCalledOnce()
    expect(fixture.scheduleAutosave).not.toHaveBeenCalled()
    expect(fixture.setPresentationMap).toHaveBeenLastCalledWith(undefined)
    await expect(fixture.runtime.activatePresentedMap()).resolves.toBe(false)
    expect(fixture.loadMap).toHaveBeenCalledTimes(2)
  })

  it('ferme la présentation défaillante et peut réactiver la dernière carte autoritaire', async () => {
    let attempt = 0
    const fixture = createFixture(() => {
      attempt += 1
      if (attempt === 1) throw new Error('scene ROM refusée')
    })
    const destination = transition(createMap(4), 9)
    fixture.setWorldState(destination.state)

    fixture.runtime.presentAuthoritativeTransition(destination, { kind: 'map-boundary' })
    await flushPresentation()

    expect(fixture.onAuthoritativePresentationFailure).toHaveBeenCalledOnce()
    expect(fixture.runtime.isTransitionActive()).toBe(false)
    expect(fixture.createdScripts).toEqual([])
    expect(fixture.persist).not.toHaveBeenCalled()

    await expect(fixture.runtime.activatePresentedMap()).resolves.toBe(true)
    expect(fixture.loadMap).toHaveBeenCalledTimes(2)
    expect(fixture.loadMap).toHaveBeenLastCalledWith(destination.state.map, fixture.persistentState, undefined)
    expect(fixture.persistentState.currentMapId).toBe(4)
    expect(fixture.persist).toHaveBeenCalledOnce()
  })

  it('matérialise la dernière carte avant un checkpoint de page sans double activation tardive', async () => {
    const fixture = createFixture()
    const destination = transition(createMap(5), 11)
    fixture.setWorldState(destination.state)
    fixture.runtime.presentAuthoritativeTransition(destination, { kind: 'map-boundary' })
    const delayedActivation = fixture.runtime.activatePresentedMap()

    expect(fixture.runtime.activatePresentedMapImmediately()).toBe(true)
    expect(fixture.loadMap).toHaveBeenCalledOnce()
    expect(fixture.loadMap).toHaveBeenLastCalledWith(destination.state.map, fixture.persistentState, undefined)
    expect(fixture.persistentState.currentMapId).toBe(5)
    expect(fixture.persist).not.toHaveBeenCalled()
    fixture.persist()
    expect(fixture.persist).toHaveBeenCalledOnce()

    await expect(delayedActivation).resolves.toBe(false)
    await flushPresentation()
    expect(fixture.loadMap).toHaveBeenCalledOnce()
    expect(fixture.persist).toHaveBeenCalledOnce()
  })
})

describe('browser field exploration shared interactions', () => {
  it('avance une présentation active avant le verrou de campagne', () => {
    const activeRunner = {} as FieldScriptRunner
    const fixture = createFixture(undefined, { campaignLocked: true, activeRunner })

    fixture.runtime.interact()

    expect(fixture.advanceScript).toHaveBeenCalledOnce()
    expect(fixture.resolveInteraction).not.toHaveBeenCalled()
    expect(fixture.tryStartSharedScript).not.toHaveBeenCalled()
  })

  it('envoie la cible PNJ exacte à la campagne sans créer de runner local', async () => {
    const sharedRunner = { kind: 'shared-presentation' } as unknown as FieldScriptRunner
    const targetMap = createMap(2)
    const fixture = createFixture(undefined, {
      campaignLocked: true,
      tryStartSharedScript: async () => sharedRunner,
    })
    fixture.setInteractionResolution({
      map: targetMap,
      worldX: 47,
      worldZ: -3,
      event: { kind: 'npc', id: 7, scriptId: 81 },
    })

    fixture.runtime.interact()
    await flushPresentation()

    expect(fixture.tryStartSharedScript).toHaveBeenCalledExactlyOnceWith({
      map: targetMap,
      scriptId: 81,
      source: { kind: 'object', objectId: 7 },
      actorId: 7,
    })
    expect(fixture.createScript).not.toHaveBeenCalled()
    expect(fixture.activeRunners.at(-1)).toBe(sharedRunner)
    expect(fixture.closeMenu).toHaveBeenCalledOnce()
    expect(fixture.refreshMenu).toHaveBeenCalledOnce()
    expect(fixture.advanceScript).toHaveBeenCalledOnce()
  })

  it.each([
    ['décor', { kind: 'background' as const, scriptId: 82, type: 1, direction: 0 }],
    ['métatile', { kind: 'metatile' as const, scriptId: 83, behavior: 0x80 }],
  ])('canonise les coordonnées monde d’un %s', async (_label, event) => {
    const targetMap = createMap(3)
    const fixture = createFixture(undefined, { campaignLocked: true })
    fixture.setInteractionResolution({ map: targetMap, worldX: -14, worldZ: 93, event })

    fixture.runtime.interact()
    await flushPresentation()

    expect(fixture.tryStartSharedScript).toHaveBeenCalledExactlyOnceWith({
      map: targetMap,
      scriptId: event.scriptId,
      source: { kind: 'coordinate', x: -14, z: 93 },
    })
    expect(fixture.createScript).not.toHaveBeenCalled()
  })

  it('ignore une deuxième entrée tant que la transaction partagée est en vol', async () => {
    let resolveRequest!: (runner: FieldScriptRunner | undefined) => void
    const pendingRequest = new Promise<FieldScriptRunner | undefined>((resolve) => {
      resolveRequest = resolve
    })
    const fixture = createFixture(undefined, {
      campaignLocked: true,
      tryStartSharedScript: () => pendingRequest,
    })
    fixture.setInteractionResolution({
      map: createMap(4),
      worldX: 8,
      worldZ: 9,
      event: { kind: 'npc', id: 2, scriptId: 84 },
    })

    fixture.runtime.interact()
    fixture.runtime.interact()
    await flushPresentation()

    expect(fixture.tryStartSharedScript).toHaveBeenCalledOnce()
    resolveRequest(undefined)
    await flushPresentation()
    fixture.runtime.interact()
    await flushPresentation()
    expect(fixture.tryStartSharedScript).toHaveBeenCalledTimes(2)
  })

  it('récupère proprement une transaction partagée refusée', async () => {
    const fixture = createFixture(undefined, {
      campaignLocked: true,
      tryStartSharedScript: async () => { throw new Error('Transaction partagée refusée.') },
    })
    fixture.setInteractionResolution({
      map: createMap(5),
      worldX: 1,
      worldZ: 2,
      event: { kind: 'metatile', scriptId: 85, behavior: 0x80 },
    })

    fixture.runtime.interact()
    await flushPresentation()

    expect(fixture.setStatus).toHaveBeenCalledExactlyOnceWith('Transaction partagée refusée.')
    expect(fixture.recoverScriptFailure).toHaveBeenCalledOnce()
    expect(fixture.closeDialogue).toHaveBeenCalledOnce()
    expect(fixture.activeRunners).toEqual([])
    expect(fixture.createScript).not.toHaveBeenCalled()
  })

  it('lance le script local avec la carte propriétaire de la cible adjacente', () => {
    const targetMap = createMap(6)
    const fixture = createFixture()
    fixture.setInteractionResolution({
      map: targetMap,
      worldX: 32,
      worldZ: 12,
      event: { kind: 'npc', id: 4, scriptId: 86 },
    })

    fixture.runtime.interact()

    expect(fixture.createScript).toHaveBeenCalledExactlyOnceWith(targetMap, 86, 4)
    expect(fixture.tryStartSharedScript).not.toHaveBeenCalled()
    expect(fixture.activeRunners.at(-1)).toBeDefined()
    expect(fixture.advanceScript).toHaveBeenCalledOnce()
  })
})
