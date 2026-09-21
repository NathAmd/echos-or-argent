import { describe, expect, it } from 'vitest'
import type { NitroGraphic, OpeningMapPreview } from '../../ndsTypes'
import type { HgssPhoneBookEntry } from '../../rom/phone/phoneBook'
import { HGSS_PAL_PARK_SYSTEM_FLAG, HGSS_SAFARI_SYSTEM_FLAG } from '../scripts/hgssFieldSystemFlags'
import { hgssPokegearFlypointFlagBase } from './pokegearNativeState'
import type { PokemonInstanceId } from '../pokemon/pokemonInstanceId'
import { composePokegearMapBackground, composePokegearMapHighlight, createPokegearMapModel, getPokegearPointerSelectionCursor, movePokegearMapSelection, type PokegearMapContext, type PokegearMapLocation } from './pokegearMapController'

const background: NitroGraphic = {
  width: 376,
  height: 160,
  pixels: new Uint8ClampedArray(376 * 160 * 4),
  graphicsOffset: 0,
  paletteOffset: 0,
  colorDepth: 4,
}

const currentMap = {
  id: 1,
  label: 'Route ROM',
  header: { worldMapX: 10, worldMapY: 3, region: 0, flyAllowed: false },
} as OpeningMapPreview

const phoneEntry = {
  id: 7,
  mapId: 1,
} as HgssPhoneBookEntry

describe('contrôleur global de la Carte du Pokématos', () => {
  it('saute spatialement entre les zones ROM dans la direction demandée', () => {
    const location = (mapId: number, x: number, y: number, region: PokegearMapLocation['region']): PokegearMapLocation => ({
      mapId, x, y, width: 2, height: 1, objectOffsetX: 0, objectOffsetY: 0,
      flavorMessageId: 0, tilemapBlockId: 0, tilemapSourceX: 0, tilemapSourceY: 0,
      tilemapWidth: 1, tilemapHeight: 1, label: `map-${mapId}`, flavor: '', region, visited: false, progressionIndex: mapId,
    })
    const locations = [location(1, 3, 4, 'johto'), location(2, 12, 3, 'johto'), location(3, 4, 12, 'indigo'), location(4, 20, 4, 'kanto')]
    expect(movePokegearMapSelection({ cursor: { x: 3, y: 4 }, location: locations[0], locations }, 'down')).toEqual({ x: 4, y: 12 })
    expect(movePokegearMapSelection({ cursor: { x: 3, y: 4 }, location: locations[0], locations }, 'up')).toEqual({ x: 12, y: 3 })
    expect(movePokegearMapSelection({ cursor: { x: 12, y: 3 }, location: locations[1], locations }, 'right')).toEqual({ x: 20, y: 4 })
    expect(movePokegearMapSelection({ cursor: { x: 3, y: 4 }, location: locations[0], locations }, 'left')).toEqual({ x: 3, y: 4 })
  })

  it('ne répète pas un même lieu ROM qui possède plusieurs entrées sur la carte', () => {
    const location = (mapId: number, x: number): PokegearMapLocation => ({
      mapId, x, y: 4, width: 1, height: 1, objectOffsetX: 0, objectOffsetY: 0,
      flavorMessageId: 0, tilemapBlockId: 0, tilemapSourceX: 0, tilemapSourceY: 0,
      tilemapWidth: 1, tilemapHeight: 1, label: `map-${mapId}`, flavor: '', region: 'johto', visited: false, progressionIndex: mapId,
    })
    const locations = [location(1, 3), location(1, 7), location(2, 12)]
    expect(movePokegearMapSelection({ cursor: { x: 3, y: 4 }, location: locations[0], locations }, 'right')).toEqual({ x: 12, y: 4 })
  })

  it('projette un clic de carte sur la destination ROM la plus proche', () => {
    const location = (mapId: number, x: number, y: number, region: PokegearMapLocation['region'] = 'johto'): PokegearMapLocation => ({
      mapId, x, y, width: 2, height: 2, objectOffsetX: 0, objectOffsetY: 0,
      flavorMessageId: 0, tilemapBlockId: 0, tilemapSourceX: 0, tilemapSourceY: 0,
      tilemapWidth: 1, tilemapHeight: 1, label: `map-${mapId}`, flavor: '', region, visited: true, progressionIndex: mapId,
    })
    const locations = [location(1, 4, 4), location(2, 20, 10)]
    const model = { cursor: { x: 4, y: 4 }, locations, flypoints: [] }

    expect(getPokegearPointerSelectionCursor(model, { x: 20.8, y: 10.4 })).toEqual({ x: 20, y: 10 })
    expect(getPokegearPointerSelectionCursor(model, { x: 16, y: 9 })).toEqual({ x: 20, y: 10 })
  })

  it('ne traverse pas la frontière Johto/Kanto à cause de la proximité géométrique', () => {
    const location = (mapId: number, x: number, y: number, region: PokegearMapLocation['region']): PokegearMapLocation => ({
      mapId, x, y, width: 1, height: 1, objectOffsetX: 0, objectOffsetY: 0,
      flavorMessageId: 0, tilemapBlockId: 0, tilemapSourceX: 0, tilemapSourceY: 0,
      tilemapWidth: 1, tilemapHeight: 1, label: `map-${mapId}`, flavor: '', region, visited: true, progressionIndex: mapId,
    })
    const johto = location(1, 21, 8, 'johto')
    const kanto = location(2, 22, 8, 'kanto')
    const model = { cursor: { x: 21, y: 8 }, locations: [johto, kanto], flypoints: [] }

    expect(getPokegearPointerSelectionCursor(model, { x: 21.9, y: 8.2 })).toEqual({ x: 21, y: 8 })
    expect(getPokegearPointerSelectionCursor(model, { x: 22.1, y: 8.2 })).toEqual({ x: 22, y: 8 })
  })

  it("conserve les segments ROM d'un même lieu pour la sélection directe", () => {
    const location = (x: number): PokegearMapLocation => ({
      mapId: 1, x, y: 5, width: 1, height: 1, objectOffsetX: 0, objectOffsetY: 0,
      flavorMessageId: 0, tilemapBlockId: 0, tilemapSourceX: 0, tilemapSourceY: 0,
      tilemapWidth: 1, tilemapHeight: 1, label: 'map-1', flavor: '', region: 'johto', visited: true, progressionIndex: x,
    })
    const model = { cursor: { x: 4, y: 5 }, locations: [location(4), location(18)], flypoints: [] }
    expect(getPokegearPointerSelectionCursor(model, { x: 18.2, y: 5.2 })).toEqual({ x: 18, y: 5 })
  })

  it('projette fuyards et alertes téléphone depuis les mêmes coordonnées ROM', () => {
    const model = createPokegearMapModel({
      mapData: {
        locations: [{
          mapId: 1,
          x: 10,
          y: 5,
          width: 2,
          height: 1,
          objectOffsetX: 4,
          objectOffsetY: 8,
          flavorMessageId: 12,
          tilemapBlockId: 0,
          tilemapSourceX: 0,
          tilemapSourceY: 0,
          tilemapWidth: 1,
          tilemapHeight: 1,
        }],
        flypoints: [],
      },
      maps: [currentMap],
      currentMap,
      flags: new Set(),
      badges: new Set(),
      party: { members: [] },
      background,
      mapUnlockLevel: 2,
      mapMessages: { 0: 'Kanto', 1: 'Johto', 12: 'Texte ROM' },
      cursor: { x: 10, y: 5 },
      roamers: [{
        instanceId: 'pkm:v1:r:00000000000000000000000000000243' as PokemonInstanceId,
        metLocation: 1,
        locationIndex: 0,
        individualValues: { hp: 0, attack: 0, defense: 0, specialAttack: 0, specialDefense: 0, speed: 0 },
        personality: 0,
        speciesId: 243,
        currentHp: 1,
        level: 40,
        status: 0,
        active: true,
      }],
      phoneBookEntries: [phoneEntry],
      phoneRematchSeeking: new Set([7]),
      phoneGiftItems: new Map([[7, 4]]),
      mapMarkings: [{ mapId: 1, icons: [3, null, null, null], words: [496, null, null, null] }],
    })

    expect(model.roamers).toEqual([{ roamerId: 0, speciesId: 243, mapId: 1, x: 11, y: 6.5 }])
    expect(model.phoneAttention).toEqual([{ mapId: 1, label: 'Route ROM', x: 11, y: 6.5 }])
    expect(model.currentPosition).toEqual({ x: 10, y: 5 })
    expect(model.currentCursor).toEqual({ x: 10, y: 5 })
    expect(model.currentLocation?.mapId).toBe(1)
    expect(model.selectedMarkings?.icons[0]).toBe(3)
    expect(model.location?.visited).toBe(true)
  })

  it('suit la cellule monde réelle du joueur sur une route multi-cellules', () => {
    const model = createPokegearMapModel({
      mapData: { locations: [], flypoints: [] }, maps: [currentMap], currentMap,
      flags: new Set(), badges: new Set(), party: { members: [] }, background,
      mapUnlockLevel: 2, mapMessages: { 0: 'Kanto', 1: 'Johto' },
      playerMapPosition: { x: 12, y: 7 }, roamers: [], phoneBookEntries: [],
      phoneRematchSeeking: new Set(), phoneGiftItems: new Map(), mapMarkings: [],
    })
    expect(model.currentPosition).toEqual({ x: 12, y: 7 })
  })

  it("résout un MapHeader nominal absent sans emprunter l'écran d'entrée d'un lieu voisin", () => {
    const ruinsMap = {
      id: 323, label: 'Ruines ROM',
      header: { worldMapX: 13, worldMapY: 8, region: 0, flyAllowed: false, areaIcon: 4 },
    } as OpeningMapPreview
    const model = createPokegearMapModel({
      mapData: { locations: [{
        mapId: 8, x: 13, y: 10, width: 1, height: 2, objectOffsetX: 0, objectOffsetY: 0,
        flavorMessageId: 45, tilemapBlockId: 0, tilemapSourceX: 3, tilemapSourceY: 32,
        tilemapWidth: 3, tilemapHeight: 4,
      }], flypoints: [] },
      maps: [ruinsMap], currentMap: ruinsMap, flags: new Set([0x123]), badges: new Set(),
      party: { members: [] }, background, mapUnlockLevel: 2,
      mapMessages: { 0: 'Kanto', 1: 'Johto', 45: 'Description ROM' },
      cursor: { x: 13, y: 10 }, roamers: [], phoneBookEntries: [],
      phoneRematchSeeking: new Set(), phoneGiftItems: new Map(), mapMarkings: [],
      encounterLandmarks: [{
        mapId: 323, speciesId: 150, level: 70, battleParameter: 0, command: 'wildBattle', conditions: [],
        isRomLegendary: true,
        provenance: { bank: 1, scriptId: 1, entryOffset: 0, commandOffset: 0, opcode: 589 },
      }, {
        mapId: 323, speciesId: 185, level: 20, battleParameter: 0, command: 'wildBattle', conditions: [],
        provenance: { bank: 1, scriptId: 2, entryOffset: 7, commandOffset: 7, opcode: 589 },
      }, {
        mapId: 323, speciesId: 100, level: 23, battleParameter: 0, command: 'rocketTrapBattle', conditions: [],
        isRomLegendary: true,
        provenance: { bank: 1, scriptId: 3, entryOffset: 14, commandOffset: 14, opcode: 249 },
      }, {
        mapId: 323, speciesId: 144, level: 50, battleParameter: 0, command: 'wildBattle', conditions: [],
        isRomLegendary: true, disappearanceFlagId: 0x123,
        provenance: { bank: 1, scriptId: 4, entryOffset: 20, commandOffset: 20, opcode: 589 },
      }],
      locationPreviewResolver: (mapId) => mapId === 323 ? background : undefined,
      areaBannerResolver: (areaIcon) => areaIcon === 4 ? background : undefined,
    })
    expect(model.location).toMatchObject({ mapId: 8, label: 'Ruines ROM' })
    expect(model.locationPreview).toBeUndefined()
    expect(model.areaBanner).toBe(background)
    expect(model.encounters).toEqual([{ mapId: 323, locationMapId: 8, speciesId: 150, x: 13.5, y: 10.5, completed: false }])
  })

  it('compose les blocs de lieux puis les marqueurs de Vol depuis le même atlas ROM', () => {
    const atlas = { ...background, width: 512, height: 512, pixels: new Uint8ClampedArray(512 * 512 * 4) }
    atlas.pixels[(32 * 8 * atlas.width + 35 * 8) * 4] = 91
    atlas.pixels[(32 * 8 * atlas.width + 35 * 8) * 4 + 3] = 255
    atlas.pixels[(20 * 8 * atlas.width + 5 * 8) * 4] = 207
    atlas.pixels[(20 * 8 * atlas.width + 5 * 8) * 4 + 3] = 255
    const landmark = {
      mapId: 50, x: 31, y: 9, width: 2, height: 2, objectOffsetX: 4, objectOffsetY: 4,
      flavorMessageId: 11, tilemapBlockId: 2, tilemapSourceX: 35, tilemapSourceY: 32, tilemapWidth: 4, tilemapHeight: 4,
    }
    const composed = composePokegearMapBackground(background, atlas, [{
      nameMapId: 50, warpMapId: 50, flagIndex: 1, markerPalette: 1, x: 31, y: 7, width: 2, height: 2,
      tilemapSourceX: 5, tilemapSourceY: 20, tilemapWidth: 4, tilemapHeight: 4, tilemapDestinationX: 1, tilemapDestinationY: 1,
      label: 'Jadielle', unlocked: false, region: 'kanto',
    }])
    const highlight = composePokegearMapHighlight(atlas, [landmark])
    expect(composed).toMatchObject({ width: 376, height: 160 })
    expect(composed.pixels[((8 * 8) * composed.width + 30 * 8) * 4]).toBe(207)
    expect(highlight?.pixels[((8 * 8) * composed.width + 30 * 8) * 4]).toBe(91)
  })

  it("réutilise les compositions ROM inchangées au lieu de les recalculer à chaque déplacement", () => {
    const atlas = { ...background, width: 512, height: 512, pixels: new Uint8ClampedArray(512 * 512 * 4) }
    const location = {
      mapId: 1, x: 10, y: 5, width: 1, height: 1, objectOffsetX: 0, objectOffsetY: 0,
      flavorMessageId: 0, tilemapBlockId: 0, tilemapSourceX: 0, tilemapSourceY: 0,
      tilemapWidth: 1, tilemapHeight: 1,
    }
    const context: PokegearMapContext = {
      mapData: { locations: [location], flypoints: [] }, maps: [currentMap], currentMap,
      flags: new Set<number>(), badges: new Set<number>(), party: { members: [] }, background,
      backgroundAtlas: atlas, highlightAtlas: atlas, mapUnlockLevel: 2,
      mapMessages: { 0: 'Kanto', 1: 'Johto' }, cursor: { x: 10, y: 5 }, roamers: [],
      phoneBookEntries: [], phoneRematchSeeking: new Set<number>(), phoneGiftItems: new Map<number, number>(), mapMarkings: [],
    }
    const first = createPokegearMapModel(context)
    const second = createPokegearMapModel({ ...context, cursor: { x: 10.2, y: 5.2 } })
    expect(second.background).toBe(first.background)
    expect(second.highlight).toBe(first.highlight)
  })

  it("ne masque pas Irisia mais masque une autre destination non découverte", () => {
    const atlas = { ...background, width: 512, height: 512, pixels: new Uint8ClampedArray(512 * 512 * 4) }
    atlas.pixels[(20 * 8 * atlas.width + 5 * 8) * 4] = 207
    atlas.pixels[(20 * 8 * atlas.width + 5 * 8) * 4 + 3] = 255
    const flypoint = (nameMapId: number) => ({
      nameMapId, warpMapId: nameMapId, flagIndex: 1, markerPalette: 1, x: 31, y: 7, width: 2, height: 2,
      tilemapSourceX: 5, tilemapSourceY: 20, tilemapWidth: 4, tilemapHeight: 4,
      tilemapDestinationX: 1, tilemapDestinationY: 1, label: 'ROM', unlocked: false, region: 'kanto' as const,
    })
    const cianwood = composePokegearMapBackground(background, atlas, [flypoint(75)], 2)
    const ecruteak = composePokegearMapBackground(background, atlas, [flypoint(78)], 2)
    const destination = ((8 * 8) * background.width + 30 * 8) * 4
    expect(cianwood.pixels[destination]).toBe(0)
    expect(ecruteak.pixels[destination]).toBe(207)
  })

  it('place la sélection spatiale sur le point de Vol découvert du lieu', () => {
    const location: PokegearMapLocation = {
      mapId: 1, x: 10, y: 5, width: 2, height: 2, objectOffsetX: 0, objectOffsetY: 0,
      flavorMessageId: 0, tilemapBlockId: 0, tilemapSourceX: 0, tilemapSourceY: 0,
      tilemapWidth: 1, tilemapHeight: 1, label: 'Map 1', flavor: '', region: 'johto', visited: true, progressionIndex: 0,
    }
    expect(movePokegearMapSelection({
      cursor: { x: 3, y: 4 }, location: undefined, locations: [location],
      flypoints: [{
        nameMapId: 1, warpMapId: 1, flagIndex: 0, markerPalette: 0, x: 11, y: 3,
        width: 1, height: 1, tilemapSourceX: 0, tilemapSourceY: 0, tilemapWidth: 1,
        tilemapHeight: 1, tilemapDestinationX: 0, tilemapDestinationY: 0,
        label: 'Map 1', unlocked: true, region: 'johto',
      }],
    }, 'down')).toEqual({ x: 11, y: 5 })
  })

  it('autorise Vol sur un point découvert avec le Badge et une capacité utilisable', () => {
    const context: PokegearMapContext = {
      mapData: {
        locations: [{
          mapId: 1, x: 10, y: 5, width: 1, height: 1, objectOffsetX: 0, objectOffsetY: 0,
          flavorMessageId: 0, tilemapBlockId: 0, tilemapSourceX: 0, tilemapSourceY: 0, tilemapWidth: 1, tilemapHeight: 1,
        }],
        flypoints: [{
          nameMapId: 1, warpMapId: 1, flagIndex: 3, markerPalette: 0, x: 10, y: 3, width: 1, height: 1,
          tilemapSourceX: 0, tilemapSourceY: 0, tilemapWidth: 1, tilemapHeight: 1, tilemapDestinationX: 0, tilemapDestinationY: 0,
        }],
      },
      maps: [{ ...currentMap, header: { ...currentMap.header, flyAllowed: true } }],
      currentMap: { ...currentMap, header: { ...currentMap.header, flyAllowed: true } },
      flags: new Set([hgssPokegearFlypointFlagBase + 3]),
      badges: new Set([4]),
      party: { members: [{ isEgg: false, currentHp: 12, moves: [{ moveId: 19 }] }] as never[] },
      background,
      mapUnlockLevel: 2,
      mapMessages: { 0: 'Kanto', 1: 'Johto', 7: 'Vol' },
      cursor: { x: 10, y: 5 },
      roamers: [], phoneBookEntries: [], phoneRematchSeeking: new Set(), phoneGiftItems: new Map(), mapMarkings: [],
    }
    const model = createPokegearMapModel(context)

    expect(model.flypoint?.unlocked).toBe(true)
    expect(model.canFly).toBe(true)
    expect(createPokegearMapModel({ ...context, flags: new Set([...context.flags, HGSS_SAFARI_SYSTEM_FLAG]) }).canFly).toBe(false)
    expect(createPokegearMapModel({ ...context, flags: new Set([...context.flags, HGSS_PAL_PARK_SYSTEM_FLAG]) }).canFly).toBe(false)
  })
})
