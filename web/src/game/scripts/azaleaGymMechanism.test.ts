import { describe, expect, it } from 'vitest'
import {
  beginAzaleaGymRide,
  flipAzaleaGymSwitch,
  getAzaleaGymSpiderNodes,
  getAzaleaGymSwitchState,
  initializeAzaleaGymData,
  repairAzaleaGymData,
} from './azaleaGymMechanism'

function createData(): Uint8Array {
  const data = new Uint8Array(0x20)
  initializeAzaleaGymData(data)
  return data
}

describe("mécanisme Spinarak de l'Arène d'Écorcia", () => {
  it('initialise les quatre chariots et les deux interrupteurs comme Save_Gymmick', () => {
    const data = createData()
    expect(getAzaleaGymSpiderNodes(data)).toEqual([0, 1, 2, 7])
    expect(getAzaleaGymSwitchState(data)).toBe(0)
  })

  it('utilise les interrupteurs, et non le numéro du chariot, pour choisir la route', () => {
    const data = createData()
    expect(beginAzaleaGymRide(data, 7)?.destinationNode).toBe(9)
    expect(beginAzaleaGymRide(data, 9)?.destinationNode).toBe(7)

    initializeAzaleaGymData(data)
    flipAzaleaGymSwitch(data, 0)
    expect(beginAzaleaGymRide(data, 7)?.destinationNode).toBe(11)
    expect(beginAzaleaGymRide(data, 11)?.destinationNode).toBe(7)

    initializeAzaleaGymData(data)
    flipAzaleaGymSwitch(data, 1)
    expect(beginAzaleaGymRide(data, 7)?.destinationNode).toBe(10)
    expect(beginAzaleaGymRide(data, 10)?.destinationNode).toBe(7)
  })

  it('conserve tous les points intermédiaires et la vraie case de débarquement', () => {
    const data = createData()
    const forward = beginAzaleaGymRide(data, 0)
    expect(forward?.route).toEqual([
      { x: 3, z: 31 }, { x: 3, z: 29 }, { x: 9, z: 29 }, { x: 9, z: 27 },
      { x: 15, z: 28 }, { x: 15, z: 25 }, { x: 9, z: 25 }, { x: 9, z: 24 },
    ])
    expect(forward?.destination).toEqual({ x: 9, z: 23, direction: 'north' })
    expect(forward?.followerDestination).toEqual({ x: 9, z: 24, direction: 'north' })

    const reverse = beginAzaleaGymRide(data, 4)
    expect(reverse?.route[0]).toEqual({ x: 9, z: 24 })
    expect(reverse?.route.at(-1)).toEqual({ x: 3, z: 31 })
    expect(reverse?.destination).toEqual({ x: 3, z: 33, direction: 'south' })
  })

  it('préserve une sauvegarde native en cours et répare seulement les anciens états impossibles', () => {
    const data = createData()
    expect(beginAzaleaGymRide(data, 0)?.destinationNode).toBe(4)
    expect(repairAzaleaGymData(data)).toBe(false)
    expect(getAzaleaGymSpiderNodes(data)).toEqual([4, 1, 2, 7])

    data.set([4, 4, 2, 7])
    expect(repairAzaleaGymData(data)).toBe(true)
    expect(getAzaleaGymSpiderNodes(data)).toEqual([0, 1, 2, 7])
    expect(getAzaleaGymSwitchState(data)).toBe(0)
  })

  it('couvre les 48 combinaisons nœud/interrupteurs de la table overlay 04', () => {
    const destinations: readonly (readonly (number | undefined)[])[] = [
      [4, 4, 4, 4], [5, 5, 5, 5], [3, 3, 3, 3], [2, 2, 2, 2], [0, 0, 0, 0], [1, 1, 1, 1],
      [undefined, 9, undefined, 10], [9, 11, 10, 11], [undefined, undefined, undefined, undefined],
      [7, 6, undefined, undefined], [undefined, undefined, 7, 6], [undefined, 7, undefined, 7],
    ]
    for (let sourceNode = 0; sourceNode < destinations.length; sourceNode += 1) {
      for (let switchState = 0; switchState < 4; switchState += 1) {
        const data = createData()
        data[0] = sourceNode
        new DataView(data.buffer).setUint32(4, switchState, true)
        expect(beginAzaleaGymRide(data, sourceNode)?.destinationNode).toBe(destinations[sourceNode]![switchState])
      }
    }
  })
})
