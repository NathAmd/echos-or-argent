import { describe, expect, it } from 'vitest'
import {
  createHgssGymmickState,
  runHgssGymmickFieldCommand,
  type HgssGymmickCommandDependencies,
  type HgssGymmickCommandState,
} from './hgssGymmickFieldRuntime'

function createCommandState(): HgssGymmickCommandState {
  return {
    gymmick: createHgssGymmickState(),
    variables: new Map(),
    badges: new Set(),
    player: { x: 0, z: 0, direction: 'south' },
  }
}

function createDependencies(
  state: HgssGymmickCommandState,
  randomValues: number[] = [],
): HgssGymmickCommandDependencies {
  let randomIndex = 0
  return {
    readVariable: (variableId) => state.variables.get(variableId) ?? 0,
    nextRandomU16: () => randomValues[randomIndex++] ?? 0,
  }
}

describe('runtime Save_Gymmick HGSS', () => {
  it('éteint la chandelle pour les deux provenances natives de l’interaction', () => {
    const state = createCommandState()
    const dependencies = createDependencies(state)
    state.variables.set(0x800d, 3)

    expect(runHgssGymmickFieldCommand(314, state, new Uint8Array(), 0, dependencies)).toEqual({
      cursor: 0,
      step: { kind: 'gymMechanism', gymType: 1, action: 'init' },
    })
    expect(runHgssGymmickFieldCommand(315, state, new Uint8Array(), 0, dependencies).step).toEqual({
      kind: 'gymMechanism',
      gymType: 1,
      action: 'trackCandle',
      parameter: 3,
    })

    expect(runHgssGymmickFieldCommand(317, state, Uint8Array.of(0), 0, dependencies)).toEqual({
      cursor: 1,
      step: { kind: 'gymMechanism', gymType: 1, action: 'extinguishCandle', parameter: 3 },
    })
    expect(state.gymmick.data[1]).toBe(1)

    expect(runHgssGymmickFieldCommand(317, state, Uint8Array.of(1), 0, dependencies).step).toEqual({
      kind: 'gymMechanism',
      gymType: 1,
      action: 'extinguishCandle',
      parameter: 3,
    })
    expect(state.gymmick.data[1]).toBe(1)
  })

  it('place les interrupteurs de Carmin-sur-Mer et applique les deux portes', () => {
    const state = createCommandState()
    const dependencies = createDependencies(state, [4, 1])

    expect(runHgssGymmickFieldCommand(320, state, new Uint8Array(), 0, dependencies).step).toEqual({
      kind: 'gymMechanism',
      gymType: 3,
      action: 'init',
    })
    expect([...state.gymmick.data.subarray(0, 4)]).toEqual([4, 9, 0, 0])

    expect(runHgssGymmickFieldCommand(322, state, Uint8Array.of(4, 0x00, 0x40), 0, dependencies)).toEqual({ cursor: 3 })
    expect(state.variables.get(0x4000)).toBe(1)

    expect(runHgssGymmickFieldCommand(321, state, Uint8Array.of(0, 0), 0, dependencies).step).toEqual({
      kind: 'gymMechanism',
      gymType: 3,
      action: 'openGate',
      parameter: 0,
    })
    runHgssGymmickFieldCommand(322, state, Uint8Array.of(9, 0x01, 0x40), 0, dependencies)
    expect(state.variables.get(0x4001)).toBe(2)
  })

  it('encapsule le commutateur et le trajet Spinarak d’Écorcia', () => {
    const state = createCommandState()
    const dependencies = createDependencies(state)

    expect(runHgssGymmickFieldCommand(326, state, new Uint8Array(), 0, dependencies).step).toEqual({
      kind: 'gymMechanism',
      gymType: 5,
      action: 'init',
      spiderNodes: [0, 1, 2, 7],
      switchState: 0,
    })
    expect(runHgssGymmickFieldCommand(328, state, Uint8Array.of(1), 0, dependencies).step).toMatchObject({
      kind: 'gymMechanism',
      gymType: 5,
      action: 'flipSwitch',
      parameter: 1,
      switchState: 2,
    })
    expect(runHgssGymmickFieldCommand(327, state, Uint8Array.of(0), 0, dependencies).step).toMatchObject({
      kind: 'gymMechanism',
      gymType: 5,
      action: 'rideSpinarak',
      destination: { x: 9, z: 23, direction: 'north' },
      followerDestination: { x: 9, z: 24, direction: 'north' },
    })
    expect(state.player).toEqual({ x: 9, z: 23, direction: 'north' })
  })

  it('rejette un opérande tronqué avant toute mutation', () => {
    const state = createCommandState()

    expect(() => runHgssGymmickFieldCommand(
      321,
      state,
      Uint8Array.of(0),
      0,
      createDependencies(state),
    )).toThrow('La commande script 321 est tronquee a l’offset 0.')
    expect(state.gymmick).toEqual(createHgssGymmickState())
  })
})
