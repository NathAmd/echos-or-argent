import { describe, expect, it } from 'vitest'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import type { HgssPhotoData } from '../../rom/photo/photoData'
import {
  addHgssSavedPhoto,
  cloneHgssPhotoAlbum,
  countHgssSavedPhotos,
  createHgssPhotoAlbum,
  createHgssSavedPhoto,
  deleteHgssSavedPhoto,
  getHgssSavedPhotos,
  hgssPhotoAlbumCapacity,
  isHgssPhotoAlbumFull,
  replaceHgssSavedPhotos,
  restoreHgssPhotoAlbum,
} from './hgssPhotoAlbum'

function pokemon(speciesId: number, overrides: Partial<CanonicalPokemon> = {}): CanonicalPokemon {
  return {
    speciesId,
    speciesName: `ROM ${speciesId}`,
    nickname: `MON ${speciesId}`,
    nicknameSource: 'user-text',
    form: 0,
    personality: speciesId,
    originalTrainer: { id: 1, name: 'JO', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 1, metLevel: 5, metTerrain: 0 },
    level: 5,
    experience: 0,
    individualValues: { hp: 0, attack: 0, defense: 0, speed: 0, specialAttack: 0, specialDefense: 0 },
    effortValues: { hp: 0, attack: 0, defense: 0, speed: 0, specialAttack: 0, specialDefense: 0 },
    nature: 0,
    gender: 'male',
    abilityId: 1,
    shiny: false,
    friendship: 70,
    moves: [],
    stats: { hp: 20, attack: 10, defense: 10, speed: 10, specialAttack: 10, specialDefense: 10 },
    currentHp: 20,
    status: 0,
    heldItemId: 0,
    ballId: 4,
    isEgg: false,
    fatefulEncounter: false,
    shinyLeafMask: 0,
    ribbonIds: [],
    ...overrides,
    instanceId: overrides.instanceId ?? `pkm:v1:r:${speciesId.toString(16).padStart(32, '0')}` as CanonicalPokemon['instanceId'],
  }
}

const data = (subjectSpriteId = 0): HgssPhotoData => ({
  id: 37, mapId: 152, iconId: 7, x: 101, z: 339, unk8: 1, unk9: 255,
  subjectSpriteId, parameters: [12, 34],
})

describe('HGSS PhotoAlbum', () => {
  it('capture le profil, la RTC locale, PhotoData et les six PhotoMon comme le moteur natif', () => {
    const egg = pokemon(175, { isEgg: true })
    const shiny = pokemon(130, { form: 2, shiny: true, gender: 'female' })
    const photo = createHgssSavedPhoto({
      playerName: 'LUCAS', playerGender: 'male', avatarState: 1,
      party: [egg, shiny], now: new Date(2026, 7, 22, 14, 7), data: data(),
    })

    expect(photo).toMatchObject({
      playerGenderBit: 0, iconId: 7, numMons: 2, playerName: 'LUCAS',
      leadPokemonNickname: 'MON 130', avatarState: 1, mapId: 152, x: 101, z: 339,
      leadPokemonNameSource: 'user-text',
      rtc: { year: 26, month: 8, day: 22, hour: 14, minute: 7 },
      parameters: [12, 34], subjectSpriteId: 0, subjectParameter: 255,
      camera: { distanceFx32: 2_731_713, angle: [0xee00, 0, 0], perspective: 0x230 },
    })
    expect(photo.party[0]).toEqual({ speciesId: 0, form: 0, shiny: false, genderBit: 0 })
    expect(photo.party[1]).toEqual({ speciesId: 130, form: 2, shiny: true, genderBit: 1 })
  })

  it("ne copie pas le nom d'espece ROM quand le meneur n'a pas de surnom", () => {
    const photo = createHgssSavedPhoto({
      playerName: 'JO', playerGender: 'male', avatarState: 0,
      party: [pokemon(152, { nickname: undefined })], now: new Date(2026, 7, 22), data: data(),
    })

    expect(photo).not.toHaveProperty('leadPokemonNickname')
    expect(photo).not.toHaveProperty('leadPokemonNameSource')
    expect(photo.party[0]?.speciesId).toBe(152)
  })

  it('conserve l’affichage local sans prétendre qu’un surnom ROM ou legacy vient du joueur', () => {
    const localReference = createHgssSavedPhoto({
      playerName: 'JO', playerGender: 'male', avatarState: 0,
      party: [pokemon(21, { nickname: 'PIAFABEC', nicknameSource: 'local-ref' })],
      now: new Date(2026, 7, 22), data: data(),
    })
    const ambiguous = createHgssSavedPhoto({
      playerName: 'JO', playerGender: 'male', avatarState: 0,
      party: [pokemon(22, { nickname: 'ANCIEN', nicknameSource: undefined })],
      now: new Date(2026, 7, 22), data: data(),
    })

    expect(localReference.leadPokemonNickname).toBe('PIAFABEC')
    expect(localReference).not.toHaveProperty('leadPokemonNameSource')
    expect(ambiguous.leadPokemonNickname).toBe('ANCIEN')
    expect(ambiguous).not.toHaveProperty('leadPokemonNameSource')

    const migrated = restoreHgssPhotoAlbum({ photos: [{
      ...ambiguous,
      leadPokemonNameSource: 'nickname',
    }] })
    expect(migrated.slots[0]?.leadPokemonNickname).toBe('ANCIEN')
    expect(migrated.slots[0]).not.toHaveProperty('leadPokemonNameSource')

    const formerlyMarkedLocal = restoreHgssPhotoAlbum({ photos: [{
      ...ambiguous,
      leadPokemonNameSource: 'local-ref',
    }] })
    expect(formerlyMarkedLocal.slots[0]?.leadPokemonNickname).toBe('ANCIEN')
    expect(formerlyMarkedLocal.slots[0]).not.toHaveProperty('leadPokemonNameSource')
  })

  it('ne conserve que le premier vivant face à un sujet Cameron et refuse une équipe sans meneur', () => {
    const fainted = pokemon(152, { currentHp: 0 })
    const alive = pokemon(155)
    const photo = createHgssSavedPhoto({ playerName: 'JO', playerGender: 'female', avatarState: 0, party: [fainted, alive], now: new Date(2025, 0, 1), data: data(91) })
    expect(photo).toMatchObject({ playerGenderBit: 1, numMons: 1, leadPokemonNickname: 'MON 155', subjectSpriteId: 91 })
    expect(photo.party.map(({ speciesId }) => speciesId)).toEqual([155, 0, 0, 0, 0, 0])
    expect(() => createHgssSavedPhoto({ playerName: 'JO', playerGender: 'male', avatarState: 0, party: [fainted], now: new Date(), data: data() })).toThrow('vivant')
  })

  it('utilise le premier trou, compte 36 emplacements, supprime puis compacte/réordonne', () => {
    const album = createHgssPhotoAlbum()
    const photo = createHgssSavedPhoto({ playerName: 'JO', playerGender: 'male', avatarState: 0, party: [pokemon(152)], now: new Date(2025, 0, 1), data: data() })
    for (let index = 0; index < hgssPhotoAlbumCapacity; index += 1) expect(addHgssSavedPhoto(album, photo)).toBe(index)
    expect(countHgssSavedPhotos(album)).toBe(36)
    expect(isHgssPhotoAlbumFull(album)).toBe(true)
    expect(addHgssSavedPhoto(album, photo)).toBeUndefined()
    expect(deleteHgssSavedPhoto(album, 7)).toBe(true)
    expect(addHgssSavedPhoto(album, { ...photo, mapId: 151 })).toBe(7)
    const photos = getHgssSavedPhotos(album)
    replaceHgssSavedPhotos(album, [photos[35]!, ...photos.slice(0, 35)])
    expect(album.slots[0]?.mapId).toBe(152)
    expect(album.slots).toHaveLength(36)
  })

  it('clone profondément et migre absence, schéma courant et ancienne liste compacte', () => {
    const album = createHgssPhotoAlbum()
    addHgssSavedPhoto(album, createHgssSavedPhoto({ playerName: 'JO', playerGender: 'male', avatarState: 0, party: [pokemon(152)], now: new Date(2025, 0, 1), data: data() }))
    const clone = cloneHgssPhotoAlbum(album)
    clone.slots[0]!.party[0]!.speciesId = 1
    expect(album.slots[0]!.party[0]!.speciesId).toBe(152)
    expect(countHgssSavedPhotos(restoreHgssPhotoAlbum(undefined))).toBe(0)
    expect(restoreHgssPhotoAlbum(JSON.parse(JSON.stringify(album))).slots[0]?.mapId).toBe(152)
    expect(restoreHgssPhotoAlbum({ photos: [JSON.parse(JSON.stringify(album.slots[0]))] }).slots).toHaveLength(36)
  })
})
