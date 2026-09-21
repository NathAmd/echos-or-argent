import { describe, expect, it } from 'vitest'
import type { OpeningMapPreview, PlayerDirection } from '../../ndsTypes'
import {
  createHgssSafariDecoratorStep,
  getHgssSafariDecoratorEligibility,
  type HgssSafariDecoratorCandidate,
  type HgssSafariPlayerPosition,
} from './hgssSafariFieldCommands'
import {
  createHgssSafariState,
  placeHgssSafariObject,
  setHgssSafariObjectUnlockLevel,
} from './hgssSafariState'

const safariOrigin = 32

function safariMap(attribute = 0, heights: readonly number[] = [0], altitude = 0): OpeningMapPreview {
  const altitudes = new Uint8Array(20)
  altitudes[6] = altitude
  return {
    id: 357,
    label: 'SAFARI',
    header: { mapId: 357 } as OpeningMapPreview['header'],
    fieldScripts: { bank: 0, bytes: new Uint8Array(), headerSize: 0, entryOffsets: [] },
    initScripts: [],
    messages: {},
    matrix: {
      matrixIndex: 212,
      name: 'm_safari_',
      width: 5,
      height: 4,
      hasHeaders: true,
      headers: new Uint16Array([
        0, 0, 0, 0, 0,
        0, 357, 357, 357, 0,
        0, 357, 357, 357, 0,
        0, 0, 357, 0, 0,
      ]),
      altitudes,
      modelIds: new Uint16Array(20),
    },
    terrain: {
      modelId: 0,
      width: 96,
      height: 96,
      attributes: new Uint16Array(96 * 96).fill(attribute),
      collisionPlates: heights.map((distance) => ({
        minX: 0,
        maxX: 96,
        minZ: 0,
        maxZ: 96,
        normalX: 0,
        normalY: 1,
        normalZ: 0,
        distance,
      })),
    },
  }
}

function unlockedState() {
  const state = createHgssSafariState(0)
  state.objectUnlockLevel = 4
  return state
}

function player(direction: PlayerDirection, state = 0, groundHeight?: number): HgssSafariPlayerPosition {
  return { x: 40, z: 40, direction, state, groundHeight }
}

function candidate(
  map: OpeningMapPreview,
  direction: PlayerDirection,
  objectId: number,
  state = unlockedState(),
): HgssSafariDecoratorCandidate {
  const result = createHgssSafariDecoratorStep(map, state, player(direction), 0).candidates
    .find((entry) => entry.objectId === objectId)
  if (!result) throw new Error(`Le Bloc Safari ${objectId} manque au catalogue de test.`)
  return result
}

function blockWorldTile(map: OpeningMapPreview, worldX: number, worldZ: number): void {
  const terrain = map.terrain
  if (!terrain) throw new Error('Le terrain Safari de test est absent.')
  const tileX = worldX - safariOrigin
  const tileZ = worldZ - safariOrigin
  terrain.attributes[tileZ * terrain.width + tileX] = 0x8000
}

describe('audit pur des ancres de SafariDecoration_CreateArgs', () => {
  it.each([
    ['north', 0, 8, 7], ['south', 0, 8, 9], ['west', 0, 7, 8], ['east', 0, 9, 8],
    ['north', 16, 8, 7], ['south', 16, 8, 10], ['west', 16, 7, 8], ['east', 16, 9, 8],
    ['north', 12, 8, 7], ['south', 12, 8, 9], ['west', 12, 6, 8], ['east', 12, 9, 8],
    ['north', 3, 8, 7], ['south', 3, 8, 10], ['west', 3, 6, 8], ['east', 3, 9, 8],
  ] as const)(
    'reproduit la première ancre %s de l’objet %i',
    (direction, objectId, x, z) => {
      expect(candidate(safariMap(), direction, objectId)).toEqual({
        objectId,
        placement: { objectId, x, y: 0, z },
      })
    },
  )

  it.each([
    ['west', 16, 39, 39, 7, 9],
    ['east', 16, 41, 39, 9, 9],
    ['north', 12, 41, 39, 7, 7],
    ['south', 12, 41, 41, 7, 9],
    ['north', 3, 41, 39, 7, 7],
    ['south', 3, 41, 42, 7, 10],
    ['west', 3, 38, 39, 6, 9],
    ['east', 3, 41, 39, 9, 9],
  ] as const)(
    'essaie la seconde ancre native %s de l’objet %i après un obstacle',
    (direction, objectId, blockedX, blockedZ, x, z) => {
      const map = safariMap()
      blockWorldTile(map, blockedX, blockedZ)
      expect(candidate(map, direction, objectId).placement).toEqual({ objectId, x, y: 0, z })
    },
  )

  it('refuse l’overlap, les bords de parcelle et les attributs de collision', () => {
    let state = unlockedState()
    state = placeHgssSafariObject(state, 0, 0, { objectId: 0, x: 8, y: 0, z: 7 })
    expect(candidate(safariMap(), 'north', 0, state)).toEqual({ objectId: 0, unavailableReason: 1 })

    const edgePlayer = { x: 32, z: 40, direction: 'west' as const, state: 0 }
    const edge = createHgssSafariDecoratorStep(safariMap(), unlockedState(), edgePlayer, 0)
    expect(edge.candidates.find(({ objectId }) => objectId === 0)).toEqual({ objectId: 0, unavailableReason: 1 })

    expect(candidate(safariMap(0x8000), 'north', 0)).toEqual({ objectId: 0, unavailableReason: 1 })
  })

  it.each([0, 33, 164])('accepte le comportement terrestre ROM %i', (behavior) => {
    expect(candidate(safariMap(behavior), 'north', 0).placement).toBeDefined()
  })

  it('applique la priorité native capacité, surface puis empreinte', () => {
    const blockedLand = safariMap(0x8000)
    expect(candidate(blockedLand, 'north', 10)).toEqual({ objectId: 10, unavailableReason: 2 })

    const surfPlayer = { ...player('north'), state: 2 }
    const surfStep = createHgssSafariDecoratorStep(safariMap(0x8010), unlockedState(), surfPlayer, 0)
    expect(surfStep.candidates.find(({ objectId }) => objectId === 0)).toEqual({ objectId: 0, unavailableReason: 3 })
    expect(surfStep.candidates.find(({ objectId }) => objectId === 10)).toEqual({ objectId: 10, unavailableReason: 1 })

    let full = unlockedState()
    for (let index = 0; index < 30; index += 1) {
      full = placeHgssSafariObject(full, 0, 0, { objectId: 0, x: index, y: 0, z: 31 })
    }
    const fullStep = createHgssSafariDecoratorStep(blockedLand, full, surfPlayer, 0)
    expect(fullStep.candidates.every(({ unavailableReason }) => unavailableReason === 4)).toBe(true)
  })

  it('conserve la couche réelle du joueur et inverse les unités du renderer Safari', () => {
    const layered = safariMap(0, [0, 2])
    const atTwo = createHgssSafariDecoratorStep(layered, unlockedState(), player('north', 0, 2), 0)
    expect(atTwo.candidates.find(({ objectId }) => objectId === 0)?.placement?.y).toBe(32)

    const halfLevel = safariMap(0, [0.5])
    const atHalf = createHgssSafariDecoratorStep(halfLevel, unlockedState(), player('north', 0, 0.5), 0)
    expect(atHalf.candidates.find(({ objectId }) => objectId === 0)?.placement?.y).toBe(8)

    const elevatedCell = safariMap(0, [8], 1)
    const atCellFloor = createHgssSafariDecoratorStep(elevatedCell, unlockedState(), player('north', 0, 8), 0)
    expect(atCellFloor.candidates.find(({ objectId }) => objectId === 0)?.placement?.y).toBe(0)

    const wrongLayer = createHgssSafariDecoratorStep(safariMap(0, [0]), unlockedState(), player('north', 0, 2), 0)
    expect(wrongLayer.candidates.find(({ objectId }) => objectId === 0)).toEqual({ objectId: 0, unavailableReason: 1 })
  })

  it.each([
    [0, 4], [1, 4], [2, 4],
    [3, 3], [4, 3], [5, 3],
    [6, 2], [7, 2],
    [8, 1], [9, 1],
  ] as const)('reproduit le seuil Surf de ov02_0224E640 pour le dernier chiffre %i', (digit, threshold) => {
    let state = unlockedState()
    const surfing = player('north', 2)
    state = setHgssSafariObjectUnlockLevel(state, threshold - 1)
    expect(getHgssSafariDecoratorEligibility(safariMap(16), state, surfing, digit)).toBe(2)
    state = setHgssSafariObjectUnlockLevel(state, threshold)
    expect(getHgssSafariDecoratorEligibility(safariMap(16), state, surfing, digit)).toBe(0)
  })
})
