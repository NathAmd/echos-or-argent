import { describe, expect, it, vi } from 'vitest'
import type { OpeningMapPreview } from '../../ndsTypes'
import { createFieldScriptState } from '../scripts/fieldScriptRunner'
import type { WorldSession } from '../world/worldSession'
import { createBrowserNewGamePlusWorldContext } from './browserNewGamePlusWorldComposition'

function mapFixture(): OpeningMapPreview {
  return {
    id: 9,
    matrix: {
      matrixIndex: 1,
      name: 'composition-test',
      width: 1,
      height: 1,
      hasHeaders: false,
      headers: new Uint16Array([9]),
      altitudes: new Uint8Array(1),
      modelIds: new Uint16Array(1),
    },
    events: {
      objects: [{ id: 7, eventFlag: 0 }],
      warps: [],
      backgrounds: [],
      coordinateEvents: [],
    },
  } as unknown as OpeningMapPreview
}

describe('composition navigateur du monde New Game Plus', () => {
  it('projette un contexte cohérent et centralise toutes les occupations de cases', () => {
    const map = mapFixture()
    const fieldState = createFieldScriptState('male', 'ALICE')
    fieldState.pokemonRuntime = {
      now: () => new Date(2026, 7, 28, 12, 30),
    } as NonNullable<typeof fieldState.pokemonRuntime>
    fieldState.objects.set(7, { x: 5, z: 6 } as never)
    const worldSession = {
      getState: () => ({ map, tileX: 1, tileZ: 2 }),
      getFollowerState: () => ({ map, tileX: 3, tileZ: 4 }),
    } as unknown as WorldSession
    const prepareSafariEncounter = vi.fn()
    const hasDynamicBlockingActor = vi.fn((mapId: number, tileX: number, tileZ: number) => (
      mapId === 9 && tileX === 8 && tileZ === 8
    ))

    const context = createBrowserNewGamePlusWorldContext({
      readInventory: () => ({ wildEncounterCatalog: [] }),
      readWorldSession: () => worldSession,
      readFieldState: () => fieldState,
      prepareSafariEncounter,
      hasDynamicBlockingActor,
    })

    expect(context).toMatchObject({ map, hour: 12, isSafari: false })
    expect(context?.prepareSafariEncounter).toBe(prepareSafariEncounter)
    expect(context?.isTileBlocked(10, 0, 0)).toBe(true)
    expect(context?.isTileBlocked(9, 1, 2)).toBe(true)
    expect(context?.isTileBlocked(9, 3, 4)).toBe(true)
    expect(context?.isTileBlocked(9, 5, 6)).toBe(true)

    fieldState.hiddenObjectIds.add(7)
    expect(context?.isTileBlocked(9, 5, 6)).toBe(false)
    expect(context?.isTileBlocked(9, 8, 8, 'new-game-plus:7')).toBe(true)
    expect(hasDynamicBlockingActor).toHaveBeenLastCalledWith(9, 8, 8, 'new-game-plus:7')
    expect(context?.isTileBlocked(9, 7, 7)).toBe(false)
  })

  it('ne projette rien tant que ROM, monde ou runtime Pokémon manque', () => {
    const fieldState = createFieldScriptState('female', 'KRIS')
    expect(createBrowserNewGamePlusWorldContext({
      readInventory: () => undefined,
      readWorldSession: () => undefined,
      readFieldState: () => fieldState,
      prepareSafariEncounter: vi.fn(),
      hasDynamicBlockingActor: () => false,
    })).toBeUndefined()
  })
})
