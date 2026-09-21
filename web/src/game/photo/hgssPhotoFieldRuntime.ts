import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import type { HgssPhotoDataCatalog } from '../../rom/photo/photoData'
import {
  addHgssSavedPhoto,
  cloneHgssPhotoAlbum,
  cloneHgssSavedPhoto,
  countHgssSavedPhotos,
  createHgssPhotoAlbum,
  createHgssSavedPhoto,
  getHgssSavedPhotos,
  isHgssPhotoAlbumFull,
  replaceHgssSavedPhotos,
  type HgssPhotoAlbumState,
  type HgssSavedPhoto,
} from './hgssPhotoAlbum'

export const hgssPhotoOpcodes = Object.freeze({
  take: 615,
  count: 616,
  openAlbum: 617,
  isFull: 618,
})

export const hgssPhotoShutterSequenceId = 2335
export const hgssPhotoExposureDelayFrames = 30

export type HgssPhotoFieldSlice = {
  photoAlbum: HgssPhotoAlbumState
}

export type HgssPhotoFieldStep =
  | {
    kind: 'photoCapture'
    photoDataId: number
    slot: number
    photo: HgssSavedPhoto
    exposureDelayFrames: typeof hgssPhotoExposureDelayFrames
    shutterSequenceId: typeof hgssPhotoShutterSequenceId
  }
  | { kind: 'photoAlbum', photos: readonly HgssSavedPhoto[] }

export type HgssPhotoRunnerControls = {
  finishPhotoCapture: () => void
  closePhotoAlbum: (photos?: readonly HgssSavedPhoto[]) => void
}

type HgssPhotoFieldState = HgssPhotoFieldSlice & {
  gender: 'male' | 'female'
  playerName: string
  playerState: number
  party: { members: readonly CanonicalPokemon[] }
  variables: Map<number, number>
  pokemonRuntime?: {
    now: () => Date
    photoDataCatalog?: HgssPhotoDataCatalog
  }
}

export function createHgssPhotoFieldSlice(): HgssPhotoFieldSlice {
  return { photoAlbum: createHgssPhotoAlbum() }
}

export function cloneHgssPhotoFieldSlice(state: HgssPhotoFieldSlice): HgssPhotoFieldSlice {
  return { photoAlbum: cloneHgssPhotoAlbum(state.photoAlbum) }
}

function requireBytes(bytes: Uint8Array, cursor: number, count: number, opcode: number): void {
  if (cursor < 0 || cursor + count > bytes.byteLength) {
    throw new Error(`Opcode PhotoAlbum HGSS ${opcode} tronqué à l'offset ${cursor}.`)
  }
}

export function runHgssPhotoImmediateOpcode(opcode: 616 | 618, state: HgssPhotoFieldState, bytes: Uint8Array, cursor: number): number {
  requireBytes(bytes, cursor, 2, opcode)
  const destination = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(cursor, true)
  state.variables.set(destination, opcode === hgssPhotoOpcodes.count
    ? countHgssSavedPhotos(state.photoAlbum)
    : Number(isHgssPhotoAlbumFull(state.photoAlbum)))
  return cursor + 2
}

export function createHgssPhotoFieldAppRuntime(state: HgssPhotoFieldState): {
  launchCapture: (photoDataId: number) => HgssPhotoFieldStep
  launchAlbum: () => HgssPhotoFieldStep
  isAwaitingInput: () => boolean
} & HgssPhotoRunnerControls {
  let pendingCapture: { slot: number, photo: HgssSavedPhoto } | undefined
  let pendingAlbum = false

  const assertIdle = (): void => {
    if (pendingCapture || pendingAlbum) throw new Error("Une application PhotoAlbum HGSS attend déjà l'hôte.")
  }

  return {
    launchCapture(photoDataId): HgssPhotoFieldStep {
      assertIdle()
      if (!Number.isInteger(photoDataId) || photoDataId < 0) throw new Error(`PhotoData HGSS ${photoDataId} invalide.`)
      const catalog = state.pokemonRuntime?.photoDataCatalog
      const data = catalog?.[photoDataId]
      if (!data) throw new Error(`PhotoData HGSS ${photoDataId} est absent de la ROM chargée.`)
      if (isHgssPhotoAlbumFull(state.photoAlbum)) throw new Error("L'album photo HGSS est plein avant CameronPhoto.")
      const slot = state.photoAlbum.slots.findIndex((photo) => !photo?.numMons)
      const photo = createHgssSavedPhoto({
        playerName: state.playerName,
        playerGender: state.gender,
        avatarState: state.playerState,
        party: state.party.members,
        now: state.pokemonRuntime!.now(),
        data,
      })
      pendingCapture = { slot, photo }
      return {
        kind: 'photoCapture', photoDataId, slot, photo: cloneHgssSavedPhoto(photo),
        exposureDelayFrames: hgssPhotoExposureDelayFrames,
        shutterSequenceId: hgssPhotoShutterSequenceId,
      }
    },
    finishPhotoCapture(): void {
      if (!pendingCapture) throw new Error("Aucune prise de photo HGSS n'est active.")
      const actualSlot = addHgssSavedPhoto(state.photoAlbum, pendingCapture.photo)
      if (actualSlot !== pendingCapture.slot) throw new Error(`L'emplacement PhotoAlbum HGSS attendu ${pendingCapture.slot} est devenu ${actualSlot}.`)
      pendingCapture = undefined
    },
    launchAlbum(): HgssPhotoFieldStep {
      assertIdle()
      pendingAlbum = true
      return { kind: 'photoAlbum', photos: getHgssSavedPhotos(state.photoAlbum) }
    },
    closePhotoAlbum(photos): void {
      if (!pendingAlbum) throw new Error("Aucun PhotoAlbum HGSS n'est actif.")
      if (photos) replaceHgssSavedPhotos(state.photoAlbum, photos)
      pendingAlbum = false
    },
    isAwaitingInput: () => Boolean(pendingCapture || pendingAlbum),
  }
}
