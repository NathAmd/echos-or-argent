import type { GameDigitalAction } from '../../gameInput'
import { cloneHgssSavedPhoto, type HgssSavedPhoto } from '../photo/hgssPhotoAlbum'

export type PhotoAlbumUiPhase = 'grid' | 'actions' | 'deleteConfirm' | 'move' | 'view'

export type PhotoAlbumUiModel = {
  photos: HgssSavedPhoto[]
  phase: PhotoAlbumUiPhase
  cursor: number
  actionCursor: number
  confirmCursor: 0 | 1
  moveSource?: number
  notice: 'switched' | undefined
}

export type PhotoAlbumUiEffect = 'none' | 'close' | 'changed'

export function createPhotoAlbumUiModel(photos: readonly HgssSavedPhoto[]): PhotoAlbumUiModel {
  return {
    photos: photos.map(cloneHgssSavedPhoto),
    phase: 'grid',
    cursor: 0,
    actionCursor: 0,
    confirmCursor: 1,
    notice: undefined,
  }
}

function moveGrid(cursor: number, count: number, action: GameDigitalAction): number {
  if (count <= 0) return 0
  const columns = Math.min(4, count)
  const row = Math.floor(cursor / columns)
  const column = cursor % columns
  if (action === 'left') return cursor % columns === 0 ? Math.min(count - 1, row * columns + columns - 1) : cursor - 1
  if (action === 'right') return cursor === Math.min(count - 1, row * columns + columns - 1) ? row * columns : cursor + 1
  if (action === 'up' || action === 'down') {
    const rows = Math.ceil(count / columns)
    const nextRow = (row + (action === 'up' ? -1 : 1) + rows) % rows
    return Math.min(count - 1, nextRow * columns + column)
  }
  return cursor
}

function wrap(value: number, count: number): number {
  return count <= 0 ? 0 : (value % count + count) % count
}

export function focusPhotoAlbumEntry(model: PhotoAlbumUiModel, cursor: number): void {
  if (!Number.isInteger(cursor) || cursor < 0 || cursor >= model.photos.length) return
  model.cursor = cursor
  model.notice = undefined
}

export function focusPhotoAlbumAction(model: PhotoAlbumUiModel, cursor: number): void {
  if (!Number.isInteger(cursor) || cursor < 0 || cursor >= 4) return
  model.actionCursor = cursor
}

export function focusPhotoAlbumConfirmation(model: PhotoAlbumUiModel, cursor: 0 | 1): void {
  model.confirmCursor = cursor
}

export function updatePhotoAlbumUi(model: PhotoAlbumUiModel, action: GameDigitalAction): PhotoAlbumUiEffect {
  const normalized = action === 'menu' ? 'cancel' : action
  if (model.phase === 'grid') {
    if (normalized === 'cancel') return 'close'
    if ((normalized === 'confirm' || normalized === 'secondary') && model.photos.length > 0) {
      model.phase = 'actions'
      model.actionCursor = 0
      model.notice = undefined
      return 'none'
    }
    if (['left', 'right', 'up', 'down'].includes(normalized)) {
      model.cursor = moveGrid(model.cursor, model.photos.length, normalized)
    }
    if (normalized === 'page-previous') model.cursor = wrap(model.cursor - 12, model.photos.length)
    if (normalized === 'page-next') model.cursor = wrap(model.cursor + 12, model.photos.length)
    return 'none'
  }
  if (model.phase === 'actions') {
    if (normalized === 'cancel') { model.phase = 'grid'; return 'none' }
    if (normalized === 'up' || normalized === 'left') model.actionCursor = wrap(model.actionCursor - 1, 4)
    if (normalized === 'down' || normalized === 'right') model.actionCursor = wrap(model.actionCursor + 1, 4)
    if (normalized !== 'confirm') return 'none'
    if (model.actionCursor === 0) model.phase = 'view'
    else if (model.actionCursor === 1) { model.phase = 'deleteConfirm'; model.confirmCursor = 1 }
    else if (model.actionCursor === 2) { model.phase = 'move'; model.moveSource = model.cursor }
    else model.phase = 'grid'
    return 'none'
  }
  if (model.phase === 'deleteConfirm') {
    if (normalized === 'cancel') { model.phase = 'actions'; return 'none' }
    if (normalized === 'left' || normalized === 'right' || normalized === 'up' || normalized === 'down') {
      model.confirmCursor = model.confirmCursor === 0 ? 1 : 0
      return 'none'
    }
    if (normalized !== 'confirm') return 'none'
    if (model.confirmCursor === 1) { model.phase = 'actions'; return 'none' }
    model.photos.splice(model.cursor, 1)
    model.cursor = Math.max(0, Math.min(model.cursor, model.photos.length - 1))
    model.phase = 'grid'
    return 'changed'
  }
  if (model.phase === 'move') {
    if (normalized === 'cancel') { model.phase = 'grid'; model.moveSource = undefined; return 'none' }
    if (['left', 'right', 'up', 'down'].includes(normalized)) model.cursor = moveGrid(model.cursor, model.photos.length, normalized)
    if (normalized === 'page-previous') model.cursor = wrap(model.cursor - 12, model.photos.length)
    if (normalized === 'page-next') model.cursor = wrap(model.cursor + 12, model.photos.length)
    if (normalized !== 'confirm' || model.moveSource === undefined) return 'none'
    const source = model.moveSource
    const target = model.cursor
    if (source !== target) [model.photos[source], model.photos[target]] = [model.photos[target]!, model.photos[source]!]
    model.moveSource = undefined
    model.notice = 'switched'
    model.phase = 'grid'
    return source === target ? 'none' : 'changed'
  }
  if (normalized === 'left' || normalized === 'page-previous') model.cursor = wrap(model.cursor - 1, model.photos.length)
  else if (normalized === 'right' || normalized === 'page-next') model.cursor = wrap(model.cursor + 1, model.photos.length)
  else if (normalized === 'confirm' || normalized === 'cancel') model.phase = 'grid'
  return 'none'
}
