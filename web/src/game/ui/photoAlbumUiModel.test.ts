import { describe, expect, it } from 'vitest'
import type { HgssSavedPhoto } from '../photo/hgssPhotoAlbum'
import { createPhotoAlbumUiModel, focusPhotoAlbumAction, focusPhotoAlbumConfirmation, focusPhotoAlbumEntry, updatePhotoAlbumUi } from './photoAlbumUiModel'
import { resolvePhotoAlbumRomText } from './photoAlbumUiHost'

function photo(mapId: number): HgssSavedPhoto {
  return {
    playerGenderBit: 0, iconId: 0, numMons: 1, playerName: 'JO', leadPokemonNickname: 'GERMIGNON', avatarState: 0,
    mapId, x: 0, z: 0, rtc: { year: 26, month: 8, day: 22, weekday: 6, hour: 12, minute: 0 },
    parameters: [0, 0], subjectSpriteId: 0, subjectParameter: 255,
    camera: { distanceFx32: 2_731_713, angle: [0xee00, 0, 0], perspectiveType: 0, perspective: 0x230, clipping: [0x96, 0x384], lookAtFx32: [66_816, 0, -192_512] },
    party: Array.from({ length: 6 }, (_, index) => ({ speciesId: index === 0 ? 152 : 0, form: 0, shiny: false, genderBit: 0 })),
  }
}

describe('HGSS PhotoAlbum UI navigation', () => {
  it('résout uniquement les douze messages de la banque ROM 0', () => {
    const messages = Object.fromEntries(Array.from({ length: 12 }, (_, id) => [id, `ROM ${id}`]))
    expect(resolvePhotoAlbumRomText(messages)).toEqual({
      exit: 'ROM 0', view: 'ROM 1', delete: 'ROM 2', move: 'ROM 3', cancel: 'ROM 4',
      selectPrompt: 'ROM 5', actionPrompt: 'ROM 6', movePrompt: 'ROM 7', switched: 'ROM 8', deletePrompt: 'ROM 9',
      singleDetailTemplate: 'ROM 10', groupDetailTemplate: 'ROM 11',
    })
  })

  it('navigue les 36 cases en grille et par pages sans recréer le modèle', () => {
    const model = createPhotoAlbumUiModel(Array.from({ length: 36 }, (_, index) => photo(index)))
    updatePhotoAlbumUi(model, 'right')
    updatePhotoAlbumUi(model, 'down')
    expect(model.cursor).toBe(5)
    updatePhotoAlbumUi(model, 'page-next')
    expect(model.cursor).toBe(17)
    focusPhotoAlbumEntry(model, 35)
    updatePhotoAlbumUi(model, 'right')
    expect(model.cursor).toBe(32)
  })

  it('ouvre Voir, boucle entre les photos et revient sans fermer le script', () => {
    const model = createPhotoAlbumUiModel([photo(1), photo(2)])
    updatePhotoAlbumUi(model, 'confirm')
    expect(model.phase).toBe('actions')
    updatePhotoAlbumUi(model, 'confirm')
    expect(model.phase).toBe('view')
    updatePhotoAlbumUi(model, 'left')
    expect(model.cursor).toBe(1)
    updatePhotoAlbumUi(model, 'cancel')
    expect(model.phase).toBe('grid')
  })

  it('préselectionne Annuler pour supprimer, puis supprime seulement après confirmation', () => {
    const model = createPhotoAlbumUiModel([photo(1), photo(2)])
    updatePhotoAlbumUi(model, 'confirm')
    focusPhotoAlbumAction(model, 1)
    updatePhotoAlbumUi(model, 'confirm')
    expect(model).toMatchObject({ phase: 'deleteConfirm', confirmCursor: 1 })
    updatePhotoAlbumUi(model, 'confirm')
    expect(model.photos).toHaveLength(2)
    focusPhotoAlbumAction(model, 1)
    updatePhotoAlbumUi(model, 'confirm')
    focusPhotoAlbumConfirmation(model, 0)
    expect(updatePhotoAlbumUi(model, 'confirm')).toBe('changed')
    expect(model.photos.map(({ mapId }) => mapId)).toEqual([2])
  })

  it('déplace par échange, expose le message ROM et laisse B annuler', () => {
    const model = createPhotoAlbumUiModel([photo(1), photo(2), photo(3)])
    updatePhotoAlbumUi(model, 'confirm')
    focusPhotoAlbumAction(model, 2)
    updatePhotoAlbumUi(model, 'confirm')
    updatePhotoAlbumUi(model, 'right')
    expect(updatePhotoAlbumUi(model, 'confirm')).toBe('changed')
    expect(model.photos.map(({ mapId }) => mapId)).toEqual([2, 1, 3])
    expect(model.notice).toBe('switched')
    expect(updatePhotoAlbumUi(model, 'cancel')).toBe('close')
  })
})
