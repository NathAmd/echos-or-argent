import { describe, expect, it } from 'vitest'
import type { OpeningMapPreview } from '../../ndsTypes'
import {
  applyHgssSafariCustomizerChange,
  applyHgssSafariDecoratorSelection,
  createHgssSafariCustomizerStep,
  createHgssSafariDecoratorStep,
  findHgssSafariObjectInFront,
  getHgssSafariDecoratorEligibility,
  HGSS_SAFARI_PLACE_OBJECT_SCRIPT_ID,
  HGSS_SAFARI_REMOVE_OBJECT_SCRIPT_ID,
  removeHgssSafariObjectInFrontByIndex,
  resolveHgssSafariMetatileInteractionScript,
  type HgssSafariCustomizerChange,
} from './hgssSafariFieldCommands'
import {
  createHgssSafariState,
  deactivateHgssSafariLinkIfExpired,
  placeHgssSafariObject,
  receiveHgssSafariLinkedAreaSet,
  type HgssSafariObjectPlacement,
} from './hgssSafariState'

function safariMap(attribute = 0): OpeningMapPreview {
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
      altitudes: new Uint8Array(20),
      modelIds: new Uint16Array(20),
    },
    terrain: {
      modelId: 0,
      width: 96,
      height: 96,
      attributes: new Uint16Array(96 * 96).fill(attribute),
      collisionPlates: [{ minX: 0, maxX: 96, minZ: 0, maxZ: 96, normalX: 0, normalY: 1, normalZ: 0, distance: 0 }],
    },
  }
}

const walkingNorth = { x: 40, z: 40, direction: 'north' as const, state: 0 }

describe('commandes de terrain Safari HGSS', () => {
  it('synthétise les scripts standards de pose et retrait depuis le terrain comme Field Control', () => {
    const map = safariMap()
    const state = createHgssSafariState(0)
    state.session.active = true
    state.objectUnlockLevel = 1
    expect(resolveHgssSafariMetatileInteractionScript(map, state, walkingNorth))
      .toBe(HGSS_SAFARI_PLACE_OBJECT_SCRIPT_ID)

    map.terrain!.attributes[7 * 96 + 8] = 33
    expect(resolveHgssSafariMetatileInteractionScript(map, state, walkingNorth))
      .toBe(HGSS_SAFARI_PLACE_OBJECT_SCRIPT_ID)
    map.terrain!.attributes[7 * 96 + 8] = 164
    expect(resolveHgssSafariMetatileInteractionScript(map, state, walkingNorth))
      .toBe(HGSS_SAFARI_PLACE_OBJECT_SCRIPT_ID)

    map.terrain!.attributes[7 * 96 + 8] = 16
    expect(resolveHgssSafariMetatileInteractionScript(map, state, { ...walkingNorth, state: 2 }))
      .toBe(HGSS_SAFARI_PLACE_OBJECT_SCRIPT_ID)

    map.terrain!.attributes[7 * 96 + 8] = 0x8023
    state.objectUnlockLevel = 0
    expect(resolveHgssSafariMetatileInteractionScript(map, state, walkingNorth))
      .toBe(HGSS_SAFARI_REMOVE_OBJECT_SCRIPT_ID)
  })

  it('respecte les gardes natives avant de proposer le décorateur Safari', () => {
    const state = createHgssSafariState(0)
    state.session.active = true
    state.objectUnlockLevel = 1

    const inactive = structuredClone(state)
    inactive.session.active = false
    expect(resolveHgssSafariMetatileInteractionScript(safariMap(), inactive, walkingNorth)).toBeUndefined()
    const linked = structuredClone(state)
    linked.activeAreaSet = 1
    expect(resolveHgssSafariMetatileInteractionScript(safariMap(), linked, walkingNorth)).toBeUndefined()
    const locked = structuredClone(state)
    locked.objectUnlockLevel = 0
    expect(resolveHgssSafariMetatileInteractionScript(safariMap(), locked, walkingNorth)).toBeUndefined()

    const outside = safariMap()
    outside.id = 356
    outside.header.mapId = 356
    expect(resolveHgssSafariMetatileInteractionScript(outside, state, walkingNorth)).toBeUndefined()
    expect(resolveHgssSafariMetatileInteractionScript(safariMap(0x8000), state, walkingNorth)).toBeUndefined()

    const standingBlocked = safariMap()
    standingBlocked.terrain!.attributes[8 * 96 + 8] = 34
    expect(resolveHgssSafariMetatileInteractionScript(standingBlocked, state, walkingNorth)).toBeUndefined()

    const mismatchedHeight = safariMap()
    mismatchedHeight.terrain!.collisionPlates = [
      { minX: 0, maxX: 96, minZ: 0, maxZ: 8, normalX: 0, normalY: 1, normalZ: 0, distance: 2 },
      { minX: 0, maxX: 96, minZ: 8, maxZ: 96, normalX: 0, normalY: 1, normalZ: 0, distance: 0 },
    ]
    expect(resolveHgssSafariMetatileInteractionScript(mismatchedHeight, state, walkingNorth)).toBeUndefined()

    const wrongSurface = safariMap(16)
    expect(resolveHgssSafariMetatileInteractionScript(wrongSurface, state, walkingNorth)).toBeUndefined()
    expect(resolveHgssSafariMetatileInteractionScript(safariMap(), state, { ...walkingNorth, state: 2 })).toBeUndefined()
  })

  it('sépare ECHANGER, qui accepte les doublons et réinitialise, d’ORDRE, qui conserve les Blocs', () => {
    let state = createHgssSafariState(0)
    state = placeHgssSafariObject(state, 0, 0, { objectId: 0, x: 1, y: 0, z: 1 })
    state = placeHgssSafariObject(state, 0, 1, { objectId: 3, x: 2, y: 0, z: 2 })
    const replacement: HgssSafariCustomizerChange = {
      areas: [7, 7, 1, 5, 3, 6],
      sourceSlot: 0,
      targetAreaId: 7,
      operation: 'replace',
    }
    const replaced = applyHgssSafariCustomizerChange(state, replacement)
    expect(replaced.areaSets[0].areas[0]).toEqual({ areaId: 7, placements: [] })
    expect(replaced.areaSets[0].areas[1]).toEqual({
      areaId: 7,
      placements: [{ objectId: 3, x: 2, y: 0, z: 2 }],
    })

    const ordered = applyHgssSafariCustomizerChange(state, {
      areas: [7, 0, 1, 5, 3, 6],
      sourceSlot: 0,
      targetAreaId: 7,
      operation: 'swap',
      swappedSlot: 1,
    })
    expect(ordered.areaSets[0].areas.slice(0, 2)).toEqual([
      { areaId: 7, placements: [{ objectId: 3, x: 2, y: 0, z: 2 }] },
      { areaId: 0, placements: [{ objectId: 0, x: 1, y: 0, z: 1 }] },
    ])
    expect(() => applyHgssSafariCustomizerChange(replaced, { ...replacement, areas: [0, 1, 2, 3, 4, 5] })).toThrow(/sans effet|correspond/)
  })

  it('fournit au customizer les cinq compteurs physiques ROM par emplacement', () => {
    let state = createHgssSafariState(0)
    for (const objectId of [0, 3, 6, 9, 12] as const) {
      state = placeHgssSafariObject(state, 0, 0, { objectId, x: objectId, y: 0, z: 1 })
    }
    const step = createHgssSafariCustomizerStep(state)
    expect(step.kind).toBe('safariCustomizer')
    expect(step.blockCounts[0]).toEqual([1, 1, 1, 1, 1])
    expect(step.blockCounts.slice(1)).toEqual(Array.from({ length: 5 }, () => [0, 0, 0, 0, 0]))
    expect(step.showBlockCounts).toBe(false)
    state.objectUnlockLevel = 1
    expect(createHgssSafariCustomizerStep(state).showBlockCounts).toBe(true)
  })

  it('pré-calcule les quatre empreintes devant l’avatar et grise celles qui ne tiennent pas', () => {
    const state = createHgssSafariState(0)
    state.objectUnlockLevel = 4
    const step = createHgssSafariDecoratorStep(safariMap(), state, walkingNorth, 0)
    const placement = (objectId: number): HgssSafariObjectPlacement | undefined => step.candidates.find((entry) => entry.objectId === objectId)?.placement
    expect(placement(0)).toEqual({ objectId: 0, x: 8, y: 0, z: 7 })
    expect(placement(12)).toEqual({ objectId: 12, x: 8, y: 0, z: 7 })
    expect(placement(16)).toEqual({ objectId: 16, x: 8, y: 0, z: 7 })
    expect(placement(3)).toEqual({ objectId: 3, x: 8, y: 0, z: 7 })
    expect(step.candidates.find(({ objectId }) => objectId === 10)).toEqual({ objectId: 10, unavailableReason: 2 })

    const chosen = applyHgssSafariDecoratorSelection(state, walkingNorth, step.candidates, 3)
    expect(chosen.result).toBe(3)
    expect(chosen.state.areaSets[0].areas[0].placements).toEqual([{ objectId: 3, x: 8, y: 0, z: 7 }])
    expect(applyHgssSafariDecoratorSelection(state, walkingNorth, step.candidates, undefined).result).toBe(255)
  })

  it('expose les quatre indisponibilités natives sans fermer ni modifier le décorateur', () => {
    const map = safariMap()
    const state = createHgssSafariState(0)
    state.objectUnlockLevel = 4
    const walking = createHgssSafariDecoratorStep(map, state, walkingNorth, 0)
    const fountain = walking.candidates.find(({ objectId }) => objectId === 10)!
    expect(fountain).toEqual({ objectId: 10, unavailableReason: 2 })
    const rejected = applyHgssSafariDecoratorSelection(state, walkingNorth, walking.candidates, 10)
    expect(rejected).toMatchObject({ unavailableReason: 2 })
    expect(rejected.state).toEqual(state)

    const surfing = createHgssSafariDecoratorStep(safariMap(16), state, { ...walkingNorth, state: 2 }, 0)
    expect(surfing.candidates.find(({ objectId }) => objectId === 0)).toEqual({ objectId: 0, unavailableReason: 3 })
    expect(surfing.candidates.find(({ objectId }) => objectId === 10)?.placement).toBeDefined()

    const blocked = safariMap(0x8000)
    expect(createHgssSafariDecoratorStep(blocked, state, walkingNorth, 0).candidates[0]).toEqual({ objectId: 0, unavailableReason: 1 })

    let full = state
    for (let index = 0; index < 30; index++) {
      full = placeHgssSafariObject(full, 0, 0, { objectId: 0, x: index, y: 0, z: 31 })
    }
    expect(createHgssSafariDecoratorStep(map, full, walkingNorth, 0).candidates.every(({ unavailableReason }) => unavailableReason === 4)).toBe(true)
  })

  it('conserve l’ordonnée native de l’avatar pour les cartes à plusieurs couches', () => {
    const state = createHgssSafariState(0)
    state.objectUnlockLevel = 4
    const layered = safariMap()
    layered.terrain!.collisionPlates!.push({ minX: 0, maxX: 96, minZ: 0, maxZ: 96, normalX: 0, normalY: 1, normalZ: 0, distance: 2 })
    const step = createHgssSafariDecoratorStep(layered, state, { ...walkingNorth, groundHeight: 2 }, 0)
    expect(step.candidates.find(({ objectId }) => objectId === 0)?.placement?.y).toBe(32)
    expect(createHgssSafariDecoratorStep(safariMap(), state, { ...walkingNorth, groundHeight: 2 }, 0).candidates[0])
      .toEqual({ objectId: 0, unavailableReason: 1 })

    const fractional = safariMap()
    fractional.terrain!.collisionPlates![0]!.distance = 0.54
    expect(createHgssSafariDecoratorStep(fractional, state, { ...walkingNorth, groundHeight: 0.54 }, 0)
      .candidates.find(({ objectId }) => objectId === 0)?.placement?.y).toBe(8)
    expect(createHgssSafariDecoratorStep(safariMap(), state, { ...walkingNorth, groundHeight: 0.00006 }, 0).candidates[0])
      .toEqual({ objectId: 0, unavailableReason: 1 })
  })

  it('retrouve une empreinte devant le joueur et retire compactement son index', () => {
    let state = createHgssSafariState(0)
    state = placeHgssSafariObject(state, 0, 0, { objectId: 0, x: 1, y: 0, z: 1 })
    state = placeHgssSafariObject(state, 0, 0, { objectId: 3, x: 4, y: 0, z: 6 })
    const player = { x: 36, z: 39, direction: 'north' as const, state: 0 }
    expect(findHgssSafariObjectInFront(state, player)).toEqual({ objectId: 3, placementIndex: 1 })
    const removed = removeHgssSafariObjectInFrontByIndex(state, player, 1)
    expect(removed.areaSets[0].areas[0].placements).toEqual([{ objectId: 0, x: 1, y: 0, z: 1 }])
  })

  it('respecte l’ordre des codes 721 : plein, Surf verrouillé, empreinte invalide, valide', () => {
    let state = createHgssSafariState(0)
    state.objectUnlockLevel = 3
    const surfing = { ...walkingNorth, state: 2 }
    expect(getHgssSafariDecoratorEligibility(safariMap(16), state, surfing, 0)).toBe(2)
    state.objectUnlockLevel = 4
    expect(getHgssSafariDecoratorEligibility(safariMap(), state, surfing, 0)).toBe(3)
    expect(getHgssSafariDecoratorEligibility(safariMap(16), state, surfing, 0)).toBe(0)
    for (let index = 0; index < 30; index++) {
      state = placeHgssSafariObject(state, 0, 0, { objectId: 0, x: index, y: 0, z: 31 })
    }
    expect(getHgssSafariDecoratorEligibility(safariMap(16), state, surfing, 0)).toBe(1)
  })

  it('conserve le set reçu exactement 24 h puis désactive seulement le lien', () => {
    const state = createHgssSafariState(0)
    const received = receiveHgssSafariLinkedAreaSet(
      state,
      state.areaSets[0],
      { trainerId: 42, name: 'BAOBA', gender: 'male', language: 3, gameVersion: 7 },
      1_000,
      -120,
    )
    expect(deactivateHgssSafariLinkIfExpired(received, 1_000 + 86_400, -120).linkLeader.linked).toBe(true)
    const expired = deactivateHgssSafariLinkIfExpired(received, 1_000 + 86_401, -120)
    expect(expired.linkLeader.linked).toBe(false)
    expect(expired.linkLeader.name).toBe('BAOBA')
    expect(deactivateHgssSafariLinkIfExpired(received, 900, -60).linkLeader.linked).toBe(false)
  })

  it('rejette un set lié qui dépasse la capacité native de trente Blocs', () => {
    const state = createHgssSafariState(0)
    const remote = structuredClone(state.areaSets[0])
    remote.areas[0].placements = Array.from({ length: 31 }, (_, x) => ({ objectId: 0 as const, x, y: 0, z: 31 }))
    expect(() => receiveHgssSafariLinkedAreaSet(
      state,
      remote,
      { trainerId: 42, name: 'BAOBA', gender: 'male', language: 3, gameVersion: 7 },
      1_000,
      -120,
    )).toThrow(/30 Blocs/)
  })
})
