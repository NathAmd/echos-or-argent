import { describe, expect, it } from 'vitest'
import type { OpeningMapPreview } from '../../ndsTypes'
import type { HgssPokegearFlypoint } from '../../rom/pokegear/mapData'
import type { HgssPhoneBookEntry } from '../../rom/phone/phoneBook'
import { canFlyBetweenPokegearRegions, createPokegearNativeState, getVisitedPokegearFlypointFlags, hgssPokegearFlypointFlagBase, isPokegearDestinationVisible, normalizePokegearNativeState, pokegearCardToNativeApp, pokegearNativeAppToCard, resolvePokegearRegion, setPokegearMapMarking, sortPokegearPhoneContacts } from './pokegearNativeState'

const entry = (id: number, sortParameters: readonly [number, number, number, number]) => ({ id, sortParameters }) as HgssPhoneBookEntry

describe('SavePokegear native state', () => {
  it('uses ROM defaults and reversible application ids', () => {
    expect(createPokegearNativeState()).toEqual({ lastUsedApp: 3, skin: 0, mapZoomed: false, radioCursorX: 128, radioCursorY: 128, mapMarkings: [], visitedMapIds: [] })
    expect([0, 1, 2, 3].map(pokegearCardToNativeApp)).toEqual([3, 2, 1, 0])
    expect([0, 1, 2, 3].map((app) => pokegearNativeAppToCard(app as 0 | 1 | 2 | 3))).toEqual([3, 2, 1, 0])
    const normalized = normalizePokegearNativeState({ skin: 99, radioCursorX: -20, radioCursorY: 999 })
    expect(normalized.skin).toBe(0)
    expect(Math.hypot(normalized.radioCursorX - 128, normalized.radioCursorY - 92)).toBeLessThanOrEqual(52.5)
    expect(normalizePokegearNativeState({ visitedMapIds: [60, 67, 60, -1, 0x1_0000] }).visitedMapIds).toEqual([60, 67])
  })

  it('stores the native four icon/four Easy Chat slots and erases an empty map entry', () => {
    let markings = setPokegearMapMarking([], 39, 'icon', 0, 3)
    markings = setPokegearMapMarking(markings, 39, 'word', 0, 496)
    expect(markings).toEqual([{ mapId: 39, icons: [3, null, null, null], words: [496, null, null, null] }])
    markings = setPokegearMapMarking(markings, 39, 'icon', 0, null)
    markings = setPokegearMapMarking(markings, 39, 'word', 0, null)
    expect(markings).toEqual([])
  })

  it('sorts the native phonebook by its three ROM parameters and keeps ties stable', () => {
    const entries = [entry(1, [4, 1, 8, 0]), entry(2, [3, 5, 2, 0]), entry(3, [3, 2, 6, 0])]
    expect(sortPokegearPhoneContacts([1, 2, 3], entries, 'trainer')).toEqual([2, 3, 1])
    expect(sortPokegearPhoneContacts([1, 2, 3], entries, 'alphabet')).toEqual([1, 3, 2])
    expect(sortPokegearPhoneContacts([1, 2, 3], entries, 'location')).toEqual([2, 3, 1])
    expect(sortPokegearPhoneContacts([1, 2, 3], entries, 'manual')).toEqual([1, 2, 3])
  })

  it('mirrors native map regions, unlock levels and cross-region flight rules', () => {
    expect(resolvePokegearRegion(21, 12)).toBe('johto')
    expect(resolvePokegearRegion(25, 8)).toBe('johto')
    expect(resolvePokegearRegion(28, 6)).toBe('indigo')
    expect(resolvePokegearRegion(32, 11)).toBe('kanto')
    expect(isPokegearDestinationVisible(28, 6, 0)).toBe(false)
    expect(isPokegearDestinationVisible(28, 6, 1)).toBe(true)
    expect(isPokegearDestinationVisible(28, 7, 1, 124)).toBe(true)
    expect(isPokegearDestinationVisible(32, 11, 1)).toBe(false)
    expect(isPokegearDestinationVisible(32, 11, 2)).toBe(true)
    expect(canFlyBetweenPokegearRegions('johto', 'kanto', 49)).toBe(false)
    expect(canFlyBetweenPokegearRegions('indigo', 'kanto', 49)).toBe(true)
    expect(canFlyBetweenPokegearRegions('johto', 'indigo', 58)).toBe(true)
  })

  it('discovers a ROM flypoint from its city map or an interior sharing its map area', () => {
    const map = (id: number, label: string, x: number, y: number) => ({ id, label, header: { worldMapX: x, worldMapY: y } }) as OpeningMapPreview
    const destination = {
      nameMapId: 60, warpMapId: 60, flagIndex: 11, x: 21, y: 12, width: 1, height: 1,
    } as HgssPokegearFlypoint
    const catalog = [map(60, 'Bourg Geon', 21, 12), map(64, 'Bourg Geon', 21, 12), map(65, 'Maison', 21, 12)]

    expect(getVisitedPokegearFlypointFlags(catalog[0]!, catalog, [destination])).toEqual([hgssPokegearFlypointFlagBase + 11])
    expect(getVisitedPokegearFlypointFlags(catalog[1]!, catalog, [destination])).toEqual([hgssPokegearFlypointFlagBase + 11])
    expect(getVisitedPokegearFlypointFlags(catalog[2]!, catalog, [destination])).toEqual([])
  })
})
