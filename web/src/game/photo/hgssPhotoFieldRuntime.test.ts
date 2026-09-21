import { describe, expect, it } from 'vitest'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import type { OpeningMapPreview } from '../../ndsTypes'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { createFieldScriptRunner, createFieldScriptState } from '../scripts/fieldScriptRunner'
import { countHgssSavedPhotos } from './hgssPhotoAlbum'
import {
  createHgssPhotoFieldAppRuntime,
  createHgssPhotoFieldSlice,
  hgssPhotoExposureDelayFrames,
  hgssPhotoShutterSequenceId,
  runHgssPhotoImmediateOpcode,
} from './hgssPhotoFieldRuntime'

const pokemon = (): CanonicalPokemon => ({
  instanceId: 'pkm:v1:r:00000000000000000000000000000152' as CanonicalPokemon['instanceId'],
  speciesId: 152, speciesName: 'GERMIGNON', form: 0, personality: 1,
  originalTrainer: { id: 1, name: 'JO', gender: 'male' }, origin: { language: 3, gameVersion: 7, metLocation: 1, metLevel: 5, metTerrain: 0 },
  level: 5, experience: 0,
  individualValues: { hp: 0, attack: 0, defense: 0, speed: 0, specialAttack: 0, specialDefense: 0 },
  effortValues: { hp: 0, attack: 0, defense: 0, speed: 0, specialAttack: 0, specialDefense: 0 },
  nature: 0, gender: 'male', abilityId: 1, shiny: false, friendship: 70, moves: [],
  stats: { hp: 20, attack: 10, defense: 10, speed: 10, specialAttack: 10, specialDefense: 10 },
  currentHp: 20, status: 0, heldItemId: 0, ballId: 4, isEgg: false, fatefulEncounter: false, shinyLeafMask: 0, ribbonIds: [],
})

function fixture() {
  return {
    ...createHgssPhotoFieldSlice(),
    gender: 'male' as const,
    playerName: 'JO',
    playerState: 0,
    party: { members: [pokemon()] },
    variables: new Map<number, number>(),
    pokemonRuntime: {
      now: () => new Date(2025, 4, 6, 12, 34),
      photoDataCatalog: [{ id: 0, mapId: 151, iconId: 0, x: 79, z: 371, unk8: 1, unk9: 255, subjectSpriteId: 77, parameters: [0, 0] }] as const,
    },
  }
}

function scriptMap(bytes: Uint8Array): OpeningMapPreview {
  return {
    id: 152, label: 'ROM', header: { mapId: 152, followMode: 2 } as OpeningMapPreview['header'],
    fieldScripts: { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }, initScripts: [], messages: {}, matrix: {} as OpeningMapPreview['matrix'],
  }
}

describe('HGSS photo field runtime', () => {
  it('suspend CameronPhoto jusqu’au flash hôte puis écrit la première case', () => {
    const state = fixture()
    const app = createHgssPhotoFieldAppRuntime(state)
    const step = app.launchCapture(0)
    expect(step).toMatchObject({ kind: 'photoCapture', photoDataId: 0, slot: 0, exposureDelayFrames: hgssPhotoExposureDelayFrames, shutterSequenceId: hgssPhotoShutterSequenceId })
    expect(app.isAwaitingInput()).toBe(true)
    expect(countHgssSavedPhotos(state.photoAlbum)).toBe(0)
    app.finishPhotoCapture()
    expect(app.isAwaitingInput()).toBe(false)
    expect(countHgssSavedPhotos(state.photoAlbum)).toBe(1)
  })

  it('porte CountSavedPhotos, PhotoAlbumIsFull et la réécriture de l’album', () => {
    const state = fixture()
    const app = createHgssPhotoFieldAppRuntime(state)
    app.launchCapture(0)
    app.finishPhotoCapture()
    const bytes = new Uint8Array([0x00, 0x40])
    expect(runHgssPhotoImmediateOpcode(616, state, bytes, 0)).toBe(2)
    expect(state.variables.get(0x4000)).toBe(1)
    runHgssPhotoImmediateOpcode(618, state, bytes, 0)
    expect(state.variables.get(0x4000)).toBe(0)

    const album = app.launchAlbum()
    expect(album.kind === 'photoAlbum' && album.photos).toHaveLength(1)
    app.closePhotoAlbum([])
    expect(countHgssSavedPhotos(state.photoAlbum)).toBe(0)
  })

  it('refuse de reprendre ou fermer une application dans le mauvais état', () => {
    const state = fixture()
    const app = createHgssPhotoFieldAppRuntime(state)
    expect(() => app.finishPhotoCapture()).toThrow('Aucune prise')
    app.launchAlbum()
    expect(() => app.launchCapture(0)).toThrow('attend déjà')
    app.closePhotoAlbum()
    expect(app.isAwaitingInput()).toBe(false)
  })

  it('route réellement les quatre opcodes 615–618 dans FieldScriptRunner', () => {
    const runtime = {
      catalog: createPokemonTestCatalog(), rng: createHgssLcrng(1), trainer: { id: 1, name: 'JO', gender: 'male' as const },
      language: 3, gameVersion: 7, now: () => new Date(2026, 7, 22, 12),
      photoDataCatalog: fixture().pokemonRuntime.photoDataCatalog,
    }
    const state = createFieldScriptState('male', 'JO', { pokemonRuntime: runtime, party: [pokemon()] })
    const take = new Uint8Array(6)
    const takeView = new DataView(take.buffer)
    takeView.setUint16(0, 615, true); takeView.setUint16(2, 0, true); takeView.setUint16(4, 2, true)
    const takeRunner = createFieldScriptRunner(scriptMap(take), 1, state)
    expect(takeRunner.resume()).toMatchObject({ kind: 'photoCapture', photoDataId: 0 })
    takeRunner.finishPhotoCapture?.()
    expect(takeRunner.resume()).toEqual({ kind: 'ended' })

    const countAndOpen = new Uint8Array(8)
    const countView = new DataView(countAndOpen.buffer)
    countView.setUint16(0, 616, true); countView.setUint16(2, 0x4000, true); countView.setUint16(4, 617, true); countView.setUint16(6, 2, true)
    const albumRunner = createFieldScriptRunner(scriptMap(countAndOpen), 1, state)
    expect(albumRunner.resume()).toMatchObject({ kind: 'photoAlbum', photos: [{ mapId: 151 }] })
    expect(state.variables.get(0x4000)).toBe(1)
    albumRunner.closePhotoAlbum?.()
    expect(albumRunner.resume()).toEqual({ kind: 'ended' })

    const full = new Uint8Array(6)
    const fullView = new DataView(full.buffer)
    fullView.setUint16(0, 618, true); fullView.setUint16(2, 0x4001, true); fullView.setUint16(4, 2, true)
    expect(createFieldScriptRunner(scriptMap(full), 1, state).resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4001)).toBe(0)
  })
})
