import { describe, expect, it, vi } from 'vitest'
import type { RomInventory } from '../../ndsTypes'
import type { MapRuntime } from '../../mapRuntime'
import type { WorldSession } from '../world/worldSession'
import { createFieldScriptExecutionState } from './fieldScriptExecutionState'
import { createFieldScriptWorldHost } from './fieldScriptWorldHost'
import type { FieldScriptRunner, FieldScriptState } from './fieldScriptRunner'

function createFixture() {
  const execution = createFieldScriptExecutionState<FieldScriptRunner>()
  const runtime = {
    applyMovement: vi.fn(async () => undefined),
    applyFollowerMovement: vi.fn(),
    isScriptMoving: vi.fn(() => false),
    isFollowerMoving: vi.fn(() => false),
    setPlayerPosition: vi.fn(),
    setPlayerDirection: vi.fn(),
    setActorPosition: vi.fn(),
    setActorDirection: vi.fn(),
    setActorVisibility: vi.fn(),
    syncEventVisibility: vi.fn(),
    setCameraTarget: vi.fn(),
    setFollowerMovementPaused: vi.fn(),
    setFollowerPosition: vi.fn(),
    refreshFollower: vi.fn(),
    syncMapProps: vi.fn(),
    syncDaycareObjects: vi.fn(),
  } as unknown as MapRuntime
  const world = {
    getState: vi.fn(() => ({
      map: {
        id: 1,
        matrix: { width: 1, height: 1, headers: [1], modelIds: [0], altitudes: [0], hasHeaders: true },
      },
      groundHeight: 3,
    })),
    applyObjectMovement: vi.fn(() => ({ followerActions: [{ kind: 'face', direction: 'north' }] })),
    setObjectState: vi.fn(),
    faceObjectAtPlayer: vi.fn(() => 'south'),
    configureFollower: vi.fn(() => ({ objectId: 254 })),
    faceFollowerAtPlayer: vi.fn(() => ({ objectId: 254 })),
    applyFollowerScriptMovement: vi.fn(() => ({ state: { objectId: 254 }, movement: [] })),
    syncDaycareObjects: vi.fn(),
  } as unknown as WorldSession
  const state = { followMonMovementPaused: false } as FieldScriptState
  const dismissAcknowledgedMessage = vi.fn()
  const waitForPresentation = vi.fn()
  const host = createFieldScriptWorldHost({
    execution,
    runtime,
    readWorldSession: () => world,
    readFieldState: () => state,
    readInventory: () => undefined,
    dismissAcknowledgedMessage,
    waitForPresentation,
  })
  return { execution, runtime, world, state, host, dismissAcknowledgedMessage, waitForPresentation }
}

describe('fieldScriptWorldHost', () => {
  it('laisse les autres domaines au prochain host', () => {
    const { host } = createFixture()
    expect(host.handle({ kind: 'save' }, {} as FieldScriptRunner)).toBe('unhandled')
    expect(host.handle({ kind: 'waiting', waitFor: 'timer', frames: 1 }, {} as FieldScriptRunner)).toBe('unhandled')
  })

  it('met en file les mouvements joueur et follower puis les draine atomiquement', () => {
    const fixture = createFixture()
    expect(fixture.host.handle({ kind: 'movement', objectId: 255, actions: [] }, {} as FieldScriptRunner)).toBe('continue')
    expect(fixture.runtime.applyMovement).toHaveBeenCalledTimes(2)
    expect(fixture.execution.getPendingMovementTaskCount()).toBe(2)

    fixture.host.handle({ kind: 'movement', objectId: 7, actions: [] }, {} as FieldScriptRunner)
    expect(fixture.runtime.syncEventVisibility).toHaveBeenCalledWith(fixture.state)
    expect(fixture.runtime.applyMovement).toHaveBeenCalledWith(7, [])

    expect(fixture.host.handle({ kind: 'waiting', waitFor: 'movement' }, {} as FieldScriptRunner)).toBe('suspend')
    expect(fixture.execution.getPendingMovementTaskCount()).toBe(0)
    expect(fixture.waitForPresentation).toHaveBeenCalledWith('movement', expect.any(Promise), 'Le mouvement scripté ROM ne peut pas être terminé.')
  })

  it('attend les mouvements natifs encore actifs sans fabriquer de tâche', () => {
    const fixture = createFixture()
    vi.mocked(fixture.runtime.isScriptMoving).mockReturnValue(true)
    expect(fixture.host.handle({ kind: 'waiting', waitFor: 'movement' }, {} as FieldScriptRunner)).toBe('suspend')
    expect(fixture.execution.getWait()).toBe('movement')
    expect(fixture.dismissAcknowledgedMessage).toHaveBeenCalledOnce()
  })

  it('synchronise position et direction des objets avec la session monde', () => {
    const fixture = createFixture()
    expect(fixture.host.handle({ kind: 'objectState', objectId: 255, x: 4, z: 7, direction: 'east' }, {} as FieldScriptRunner)).toBe('continue')
    expect(fixture.world.setObjectState).toHaveBeenCalledWith(255, 4, 7, 'east')
    expect(fixture.runtime.setPlayerPosition).toHaveBeenCalledWith(4, 7, 'east', false, 3)

    fixture.host.handle({ kind: 'objectState', objectId: 9, x: 5, z: 8, direction: 'north' }, {} as FieldScriptRunner)
    expect(fixture.runtime.syncEventVisibility).toHaveBeenCalledWith(fixture.state)
    expect(fixture.runtime.setActorPosition).toHaveBeenCalledWith(9, 5, 8, 'north')

    fixture.host.handle({ kind: 'facePlayer', objectId: 9 }, {} as FieldScriptRunner)
    expect(fixture.runtime.setActorDirection).toHaveBeenCalledWith(9, 'south')
  })

  it('matérialise un objet scripté avant de modifier sa visibilité', () => {
    const fixture = createFixture()

    fixture.host.handle({ kind: 'objectVisibility', objectId: 7, visible: true }, {} as FieldScriptRunner)

    expect(fixture.runtime.syncEventVisibility).toHaveBeenCalledWith(fixture.state)
    expect(fixture.runtime.setActorVisibility).toHaveBeenCalledWith(7, true)
  })

  it('pilote les cinq commandes follower sans état local parallèle', () => {
    const fixture = createFixture()
    fixture.host.handle({ kind: 'followerMovement', action: 'pause', paused: true }, {} as FieldScriptRunner)
    fixture.host.handle({ kind: 'followerMovement', action: 'configure', parameters: [1, 2] }, {} as FieldScriptRunner)
    fixture.host.handle({ kind: 'followerMovement', action: 'facePlayer' }, {} as FieldScriptRunner)
    fixture.host.handle({ kind: 'followerMovement', action: 'movement', movement: 3 }, {} as FieldScriptRunner)
    fixture.host.handle({ kind: 'followerMovement', action: 'refresh' }, {} as FieldScriptRunner)
    expect(fixture.runtime.setFollowerMovementPaused).toHaveBeenCalledWith(true)
    expect(fixture.world.configureFollower).toHaveBeenCalledWith(1, 2)
    expect(fixture.runtime.setFollowerPosition).toHaveBeenCalledTimes(2)
    expect(fixture.runtime.applyFollowerMovement).toHaveBeenCalledOnce()
    expect(fixture.runtime.refreshFollower).toHaveBeenCalledOnce()
  })

  it('refuse un pensionnaire dont le modèle ROM est indisponible', () => {
    const fixture = createFixture()
    const inventory = {
      followerTextureResolver: () => undefined,
      pokemonCatalog: { followers: { modelIndexBySpecies: { 25: 7 } } },
    } as unknown as RomInventory
    const host = createFieldScriptWorldHost({
      execution: fixture.execution,
      runtime: fixture.runtime,
      readWorldSession: () => fixture.world,
      readFieldState: () => fixture.state,
      readInventory: () => inventory,
      dismissAcknowledgedMessage: fixture.dismissAcknowledgedMessage,
      waitForPresentation: fixture.waitForPresentation,
    })
    expect(() => host.handle({
      kind: 'daycareObjects',
      objects: [{ objectId: 250, x: 1, z: 2, pokemon: { speciesId: 25, shiny: false } as never }],
    }, {} as FieldScriptRunner)).toThrow('La texture follower ROM 7 du pensionnaire est absente.')
  })
})
