import { describe, expect, it } from 'vitest'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssSessionRng } from '../pokemon/hgssSessionRng'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { createHgssSaveState, restoreHgssSaveState } from '../save/hgssSaveState'
import { createFieldScriptState } from '../scripts/fieldScriptRunner'
import { addHgssSavedPhoto, countHgssSavedPhotos, createHgssSavedPhoto } from './hgssPhotoAlbum'

const profile = { gender: 'male', name: 'JO', trainerId: 0x12345678, language: 3, gameVersion: 7 } as const
const world = { mapId: 152, tileX: 101, tileZ: 339, direction: 'south' } as const

describe('HGSS PhotoAlbum save integration', () => {
  it('résout les données de présentation localement et migre une ancienne sauvegarde sans album', () => {
    const catalog = createPokemonTestCatalog()
    const rng = createHgssSessionRng(41)
    const pokemon = createCanonicalPokemon(catalog, {
      speciesId: 152, level: 5, rng: rng.lc, personality: { kind: 'fixed', value: 1 }, individualValues: { kind: 'fixed', value: 0 },
      originalTrainer: { id: profile.trainerId, name: profile.name, gender: profile.gender },
      origin: { language: 3, gameVersion: 7, metLocation: 152, metLevel: 5, metTerrain: 0 }, ballId: 4,
    })
    pokemon.shiny = true
    pokemon.nickname = 'GERMIGNON'
    pokemon.nicknameSource = 'user-text'
    const field = createFieldScriptState('male', 'JO', { party: [pokemon] })
    const photoDataCatalog = Array.from({ length: 38 }, (_, id) => ({
      id, mapId: 152, iconId: 7, x: 101, z: 339, unk8: 1, unk9: 255,
      subjectSpriteId: 0, parameters: [0, 0] as [number, number],
    }))
    addHgssSavedPhoto(field.photoAlbum, createHgssSavedPhoto({
      playerName: 'JO', playerGender: 'male', avatarState: 0, party: field.party.members,
      now: new Date(2026, 7, 22, 18, 45),
      data: photoDataCatalog[37]!,
    }))

    const saved = createHgssSaveState('IPKF', profile, rng, world, field)
    expect(JSON.stringify(saved.field.photoAlbum)).not.toContain('"mapId"')
    expect(JSON.stringify(saved.field.photoAlbum)).not.toContain('"camera"')
    const restored = restoreHgssSaveState(
      JSON.parse(JSON.stringify(saved)), 'IPKF', catalog, () => new Date(), undefined, undefined, {}, { photoDataCatalog },
    )
    expect(restored.field.photoAlbum.slots).toHaveLength(36)
    expect(restored.field.photoAlbum.slots[0]).toMatchObject({
      mapId: 152, rtc: { year: 26, month: 8, day: 22, hour: 18, minute: 45 },
      leadPokemonNickname: 'GERMIGNON', leadPokemonNameSource: 'user-text',
    })
    expect(restored.field.photoAlbum.slots[0]?.party[0]).toMatchObject({ speciesId: 152, shiny: true })

    delete saved.field.photoAlbum
    expect(countHgssSavedPhotos(restoreHgssSaveState(saved, 'IPKF', catalog, () => new Date()).field.photoAlbum)).toBe(0)
  })
})
