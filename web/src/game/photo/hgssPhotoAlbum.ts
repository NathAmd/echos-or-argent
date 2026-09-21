import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import type { HgssPhotoData, HgssPhotoDataCatalog } from '../../rom/photo/photoData'

export const hgssPhotoAlbumCapacity = 36
export const hgssPhotoAlbumSchemaVersion = 1
export const hgssDataOnlyPhotoAlbumSchemaVersion = 2

export type HgssPhotoMon = {
  speciesId: number
  form: number
  shiny: boolean
  /** Champ d'un bit de PhotoMon : 0 mâle/neutre, 1 femelle. */
  genderBit: 0 | 1
}

export type HgssPhotoRtc = {
  year: number
  month: number
  day: number
  weekday: number
  hour: number
  minute: number
}

export type HgssPhotoCamera = {
  distanceFx32: number
  angle: readonly [number, number, number]
  perspectiveType: number
  perspective: number
  clipping: readonly [number, number]
  lookAtFx32: readonly [number, number, number]
}

export const hgssPhotoCamera: HgssPhotoCamera = Object.freeze({
  distanceFx32: 2_731_713,
  angle: [0xee00, 0, 0] as const,
  perspectiveType: 0,
  perspective: 0x230,
  clipping: [0x96, 0x384] as const,
  lookAtFx32: [66_816, 0, -192_512] as const,
})

/** Projection sérialisable de Photo (0x84 octets) sans ses octets de remplissage. */
export type HgssSavedPhoto = {
  /** Identifiant de la fiche PhotoData; les anciennes sauvegardes peuvent ne pas l'avoir. */
  photoDataId?: number
  playerGenderBit: 0 | 1
  iconId: number
  numMons: number
  playerName: string
  playerNameSource?: 'user-text'
  /** Texte local conservé pour préserver l'affichage de l'album. */
  leadPokemonNickname?: string
  /**
   * Marqueur portable strict : son absence signifie local ou ambigu, jamais
   * implicitement une saisie joueur.
   */
  leadPokemonNameSource?: 'user-text'
  avatarState: number
  mapId: number
  x: number
  z: number
  rtc: HgssPhotoRtc
  parameters: readonly [number, number]
  subjectSpriteId: number
  subjectParameter: number
  camera: HgssPhotoCamera
  party: readonly HgssPhotoMon[]
}

export type HgssPhotoAlbumState = {
  schemaVersion: typeof hgssPhotoAlbumSchemaVersion
  /** Comme PhotoAlbum::photos : les trous sont conservés jusqu'à un rangement. */
  slots: Array<HgssSavedPhoto | undefined>
}

/** Snapshot persistant sans coordonnées, caméra, sprites ni paramètres issus de la ROM. */
export type HgssDataOnlySavedPhoto = {
  photoDataId: number
  playerGenderBit: 0 | 1
  numMons: number
  playerName?: string
  playerNameSource?: 'user-text'
  leadPokemonNickname?: string
  leadPokemonNameSource?: 'user-text'
  avatarState: number
  rtc: HgssPhotoRtc
  party: readonly HgssPhotoMon[]
}

export type HgssDataOnlyPhotoAlbum = {
  schemaVersion: typeof hgssDataOnlyPhotoAlbumSchemaVersion
  slots: Array<HgssDataOnlySavedPhoto | null>
}

export type HgssPhotoCaptureContext = {
  playerName: string
  playerGender: 'male' | 'female'
  avatarState: number
  party: readonly CanonicalPokemon[]
  now: Date
  data: HgssPhotoData
}

const emptyPhotoMon = (): HgssPhotoMon => ({ speciesId: 0, form: 0, shiny: false, genderBit: 0 })

function clonePhotoMon(mon: HgssPhotoMon): HgssPhotoMon {
  return { ...mon }
}

export function cloneHgssSavedPhoto(photo: HgssSavedPhoto): HgssSavedPhoto {
  return {
    ...photo,
    rtc: { ...photo.rtc },
    parameters: [...photo.parameters] as [number, number],
    camera: {
      ...photo.camera,
      angle: [...photo.camera.angle] as [number, number, number],
      clipping: [...photo.camera.clipping] as [number, number],
      lookAtFx32: [...photo.camera.lookAtFx32] as [number, number, number],
    },
    party: photo.party.map(clonePhotoMon),
  }
}

export function createHgssPhotoAlbum(): HgssPhotoAlbumState {
  return { schemaVersion: hgssPhotoAlbumSchemaVersion, slots: Array.from({ length: hgssPhotoAlbumCapacity }) }
}

export function cloneHgssPhotoAlbum(album: HgssPhotoAlbumState): HgssPhotoAlbumState {
  return {
    schemaVersion: hgssPhotoAlbumSchemaVersion,
    slots: Array.from({ length: hgssPhotoAlbumCapacity }, (_, index) => {
      const photo = album.slots[index]
      return photo && cloneHgssSavedPhoto(photo)
    }),
  }
}

function pokemonToPhotoMon(pokemon: CanonicalPokemon | undefined): HgssPhotoMon {
  if (!pokemon || pokemon.isEgg) return emptyPhotoMon()
  return {
    speciesId: pokemon.speciesId,
    form: pokemon.form,
    shiny: pokemon.shiny,
    genderBit: pokemon.gender === 'female' ? 1 : 0,
  }
}

export function createHgssSavedPhoto(context: HgssPhotoCaptureContext): HgssSavedPhoto {
  if (!Number.isInteger(context.avatarState) || context.avatarState < 0 || context.avatarState > 0xff) {
    throw new Error(`L'état d'avatar HGSS ${context.avatarState} ne tient pas dans Photo.`)
  }
  if (context.party.length > 6) throw new Error(`La photo HGSS reçoit ${context.party.length} Pokémon au lieu de six au maximum.`)
  if ([...context.playerName].length > 7) throw new Error('Le nom joueur de la photo HGSS dépasse 7 caractères.')
  const lead = context.party.find((pokemon) => !pokemon.isEgg && pokemon.currentHp > 0)
  if (!lead) throw new Error('La prise de photo HGSS requiert un premier Pokémon vivant et non-Œuf.')
  const subject = context.data.subjectSpriteId !== 0
  const mons = Array.from({ length: 6 }, (_, index) => (
    pokemonToPhotoMon(subject ? (index === 0 ? lead : undefined) : context.party[index])
  ))
  const fullYear = context.now.getFullYear()
  const year = ((fullYear - 2000) % 256 + 256) % 256
  return {
    photoDataId: context.data.id,
    playerGenderBit: context.playerGender === 'female' ? 1 : 0,
    iconId: context.data.iconId,
    numMons: subject ? 1 : context.party.length,
    playerName: context.playerName,
    playerNameSource: 'user-text',
    ...(lead.nickname ? {
      leadPokemonNickname: lead.nickname,
      ...(lead.nicknameSource === 'user-text' ? { leadPokemonNameSource: 'user-text' as const } : {}),
    } : {}),
    avatarState: context.avatarState,
    mapId: context.data.mapId,
    x: context.data.x,
    z: context.data.z,
    rtc: {
      year,
      month: context.now.getMonth() + 1,
      day: context.now.getDate(),
      weekday: context.now.getDay(),
      hour: context.now.getHours(),
      minute: context.now.getMinutes(),
    },
    parameters: [...context.data.parameters] as [number, number],
    subjectSpriteId: context.data.subjectSpriteId,
    subjectParameter: context.data.unk9,
    camera: cloneHgssSavedPhotoCamera(hgssPhotoCamera),
    party: mons,
  }
}

function cloneHgssSavedPhotoCamera(camera: HgssPhotoCamera): HgssPhotoCamera {
  return {
    ...camera,
    angle: [...camera.angle] as [number, number, number],
    clipping: [...camera.clipping] as [number, number],
    lookAtFx32: [...camera.lookAtFx32] as [number, number, number],
  }
}

export function countHgssSavedPhotos(album: HgssPhotoAlbumState): number {
  return album.slots.slice(0, hgssPhotoAlbumCapacity).reduce((count, photo) => count + (photo?.numMons ? 1 : 0), 0)
}

export function isHgssPhotoAlbumFull(album: HgssPhotoAlbumState): boolean {
  return countHgssSavedPhotos(album) >= hgssPhotoAlbumCapacity
}

export function addHgssSavedPhoto(album: HgssPhotoAlbumState, photo: HgssSavedPhoto): number | undefined {
  const slot = Array.from({ length: hgssPhotoAlbumCapacity }, (_, index) => index)
    .find((index) => !album.slots[index]?.numMons)
  if (slot === undefined) return undefined
  album.slots[slot] = cloneHgssSavedPhoto(photo)
  return slot
}

export function deleteHgssSavedPhoto(album: HgssPhotoAlbumState, slot: number): boolean {
  if (!Number.isInteger(slot) || slot < 0 || slot >= hgssPhotoAlbumCapacity || !album.slots[slot]) return false
  album.slots[slot] = undefined
  return true
}

export function getHgssSavedPhotos(album: HgssPhotoAlbumState): HgssSavedPhoto[] {
  return album.slots.slice(0, hgssPhotoAlbumCapacity)
    .filter((photo): photo is HgssSavedPhoto => Boolean(photo?.numMons))
    .map(cloneHgssSavedPhoto)
}

/** Réécriture compacte identique à l'overlay Album après suppression/déplacement. */
export function replaceHgssSavedPhotos(album: HgssPhotoAlbumState, photos: readonly HgssSavedPhoto[]): void {
  if (photos.length > hgssPhotoAlbumCapacity) throw new Error(`L'album HGSS ne peut contenir que ${hgssPhotoAlbumCapacity} photos.`)
  album.slots = Array.from({ length: hgssPhotoAlbumCapacity }, (_, index) => {
    const photo = photos[index]
    return photo && cloneHgssSavedPhoto(photo)
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function requireOnlyKeys(record: Record<string, unknown>, keys: readonly string[], label: string): void {
  const allowed = new Set(keys)
  const unknown = Object.keys(record).find((key) => !allowed.has(key))
  if (unknown !== undefined) throw new Error(`${label} contient un champ inconnu ${unknown}.`)
}

function asInteger(value: unknown, min: number, max: number, label: string): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`${label} est invalide dans la sauvegarde PhotoAlbum HGSS.`)
  }
  return value as number
}

function asBoundedText(value: unknown, maximumCharacters: number, label: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0) || [...value].length > maximumCharacters) {
    throw new Error(`${label} est invalide dans la sauvegarde PhotoAlbum HGSS.`)
  }
  return value
}

function restorePhotoMon(raw: unknown): HgssPhotoMon {
  if (!isRecord(raw)) throw new Error('Un PhotoMon HGSS sauvegardé est invalide.')
  requireOnlyKeys(raw, ['form', 'genderBit', 'shiny', 'speciesId'], 'Un PhotoMon HGSS sauvegardé')
  if (typeof raw.shiny !== 'boolean') throw new Error('Le chromatisme PhotoMon HGSS sauvegardé est invalide.')
  return {
    speciesId: asInteger(raw.speciesId, 0, 0xffff, 'L’espèce'),
    form: asInteger(raw.form, 0, 0xff, 'La forme'),
    shiny: raw.shiny,
    genderBit: asInteger(raw.genderBit, 0, 1, 'Le genre') as 0 | 1,
  }
}

function restoreSavedPhoto(raw: unknown): HgssSavedPhoto {
  if (!isRecord(raw) || !isRecord(raw.rtc) || !isRecord(raw.camera) || !Array.isArray(raw.parameters) || !Array.isArray(raw.party)) {
    throw new Error('Une photo HGSS sauvegardée est structurellement invalide.')
  }
  requireOnlyKeys(raw, [
    'avatarState', 'camera', 'iconId', 'leadPokemonNameSource', 'leadPokemonNickname', 'mapId', 'numMons',
    'parameters', 'party', 'photoDataId', 'playerGenderBit', 'playerName', 'playerNameSource', 'rtc', 'subjectParameter',
    'subjectSpriteId', 'x', 'z',
  ], 'Une photo HGSS sauvegardée')
  requireOnlyKeys(raw.rtc, ['day', 'hour', 'minute', 'month', 'weekday', 'year'], 'La RTC photo HGSS')
  if (raw.party.length !== 6 || raw.parameters.length !== 2) throw new Error('Une photo HGSS sauvegardée ne respecte pas ses tableaux natifs.')
  const camera = raw.camera
  requireOnlyKeys(camera, ['angle', 'clipping', 'distanceFx32', 'lookAtFx32', 'perspective', 'perspectiveType'], 'La caméra photo HGSS')
  if (!Array.isArray(camera.angle) || !Array.isArray(camera.clipping) || !Array.isArray(camera.lookAtFx32)
    || camera.angle.length !== 3 || camera.clipping.length !== 2 || camera.lookAtFx32.length !== 3) {
    throw new Error('La caméra d’une photo HGSS sauvegardée est invalide.')
  }
  const leadPokemonNickname = typeof raw.leadPokemonNickname === 'string' && raw.leadPokemonNickname.length > 0
    ? asBoundedText(raw.leadPokemonNickname, 10, 'Le surnom meneur')
    : undefined
  // La valeur historique `nickname` affirmait une provenance que le modèle
  // canonique ne suivait pas encore. `local-ref` est explicitement non
  // portable. Les deux restent lisibles mais ne reçoivent aucun marqueur sûr.
  const ambiguousNicknameSource = raw.leadPokemonNameSource === 'nickname'
    || raw.leadPokemonNameSource === 'local-ref'
  const leadPokemonNameSource = raw.leadPokemonNameSource === 'user-text'
    ? raw.leadPokemonNameSource
    : undefined
  if (raw.leadPokemonNameSource !== undefined && !ambiguousNicknameSource && leadPokemonNameSource === undefined) {
    throw new Error("La provenance du nom meneur d'une photo HGSS sauvegardee est invalide.")
  }
  if (leadPokemonNameSource && !leadPokemonNickname) {
    throw new Error("Le surnom meneur d'une photo HGSS sauvegardee est absent.")
  }
  const photo: HgssSavedPhoto = {
    ...(raw.photoDataId === undefined ? {} : { photoDataId: asInteger(raw.photoDataId, 0, 0xffff, 'La fiche PhotoData') }),
    playerGenderBit: asInteger(raw.playerGenderBit, 0, 1, 'Le genre du joueur') as 0 | 1,
    iconId: asInteger(raw.iconId, 0, 0x7f, 'L’icône'),
    numMons: asInteger(raw.numMons, 1, 6, 'Le nombre de Pokémon'),
    playerName: typeof raw.playerName === 'string' ? asBoundedText(raw.playerName, 7, 'Le nom joueur', true) : '',
    ...(raw.playerNameSource === 'user-text' ? { playerNameSource: 'user-text' as const } : {}),
    ...(leadPokemonNickname ? { leadPokemonNickname } : {}),
    ...(leadPokemonNameSource ? { leadPokemonNameSource } : {}),
    avatarState: asInteger(raw.avatarState, 0, 0xff, 'L’état avatar'),
    mapId: asInteger(raw.mapId, 0, 0xffff, 'La carte'),
    x: asInteger(raw.x, 0, 0xffff, 'La coordonnée X'),
    z: asInteger(raw.z, 0, 0xffff, 'La coordonnée Y'),
    rtc: {
      year: asInteger(raw.rtc.year, 0, 0xff, 'L’année'),
      month: asInteger(raw.rtc.month, 1, 12, 'Le mois'),
      day: asInteger(raw.rtc.day, 1, 31, 'Le jour'),
      weekday: asInteger(raw.rtc.weekday, 0, 6, 'Le jour de semaine'),
      hour: asInteger(raw.rtc.hour, 0, 23, 'L’heure'),
      minute: asInteger(raw.rtc.minute, 0, 59, 'La minute'),
    },
    parameters: raw.parameters.map((value, index) => asInteger(value, 0, 0xffff, `Le paramètre ${index}`)) as [number, number],
    subjectSpriteId: asInteger(raw.subjectSpriteId, 0, 0xffff, 'Le sprite sujet'),
    subjectParameter: asInteger(raw.subjectParameter, 0, 0xffff, 'Le paramètre sujet'),
    camera: {
      distanceFx32: asInteger(camera.distanceFx32, -0x80000000, 0x7fffffff, 'La distance caméra'),
      angle: camera.angle.map((value, index) => asInteger(value, 0, 0xffff, `L’angle caméra ${index}`)) as [number, number, number],
      perspectiveType: asInteger(camera.perspectiveType, 0, 0xffff, 'Le type de perspective'),
      perspective: asInteger(camera.perspective, 0, 0xffff, 'La perspective'),
      clipping: camera.clipping.map((value, index) => asInteger(value, -0x80000000, 0x7fffffff, `Le plan caméra ${index}`)) as [number, number],
      lookAtFx32: camera.lookAtFx32.map((value, index) => asInteger(value, -0x80000000, 0x7fffffff, `Le regard caméra ${index}`)) as [number, number, number],
    },
    party: raw.party.map(restorePhotoMon),
  }
  return photo
}

function photoMatchesData(photo: HgssSavedPhoto, data: HgssPhotoData): boolean {
  return photo.mapId === data.mapId && photo.iconId === data.iconId && photo.x === data.x && photo.z === data.z
    && photo.subjectSpriteId === data.subjectSpriteId && photo.subjectParameter === data.unk9
    && photo.parameters[0] === data.parameters[0] && photo.parameters[1] === data.parameters[1]
}

function resolvePhotoDataId(photo: HgssSavedPhoto, catalog?: HgssPhotoDataCatalog): number | undefined {
  if (Number.isInteger(photo.photoDataId) && (photo.photoDataId as number) >= 0) return photo.photoDataId
  return catalog?.find((data) => photoMatchesData(photo, data))?.id
}

/**
 * Projette l'album champ par champ. Une photo legacy impossible à rattacher à
 * une fiche locale est laissée en trou plutôt que de réémettre ses métadonnées.
 */
export function snapshotHgssDataOnlyPhotoAlbum(
  album: HgssPhotoAlbumState,
  catalog?: HgssPhotoDataCatalog,
  attestedPlayerName?: string,
): HgssDataOnlyPhotoAlbum {
  return {
    schemaVersion: hgssDataOnlyPhotoAlbumSchemaVersion,
    slots: Array.from({ length: hgssPhotoAlbumCapacity }, (_, index) => {
      const photo = album.slots[index]
      if (!photo) return null
      const photoDataId = resolvePhotoDataId(photo, catalog)
      if (photoDataId === undefined) return null
      const playerNameIsUserText = photo.playerNameSource === 'user-text'
        || attestedPlayerName !== undefined && photo.playerName === attestedPlayerName
      return {
        photoDataId,
        playerGenderBit: photo.playerGenderBit,
        numMons: photo.numMons,
        ...(playerNameIsUserText ? { playerName: photo.playerName, playerNameSource: 'user-text' as const } : {}),
        ...(photo.leadPokemonNickname && photo.leadPokemonNameSource === 'user-text'
          ? { leadPokemonNickname: photo.leadPokemonNickname, leadPokemonNameSource: 'user-text' as const }
          : {}),
        avatarState: photo.avatarState,
        rtc: {
          year: photo.rtc.year, month: photo.rtc.month, day: photo.rtc.day,
          weekday: photo.rtc.weekday, hour: photo.rtc.hour, minute: photo.rtc.minute,
        },
        party: photo.party.map((mon) => ({
          speciesId: mon.speciesId, form: mon.form, shiny: mon.shiny, genderBit: mon.genderBit,
        })),
      }
    }),
  }
}

function restoreDataOnlySavedPhoto(raw: unknown, catalog?: HgssPhotoDataCatalog): HgssSavedPhoto {
  if (!isRecord(raw) || !isRecord(raw.rtc) || !Array.isArray(raw.party) || raw.party.length !== 6) {
    throw new Error('Une photo data-only HGSS sauvegardée est invalide.')
  }
  requireOnlyKeys(raw, [
    'avatarState', 'leadPokemonNameSource', 'leadPokemonNickname', 'numMons', 'party', 'photoDataId',
    'playerGenderBit', 'playerName', 'playerNameSource', 'rtc',
  ], 'Une photo data-only HGSS sauvegardée')
  requireOnlyKeys(raw.rtc, ['day', 'hour', 'minute', 'month', 'weekday', 'year'], 'La RTC photo data-only HGSS')
  const photoDataId = asInteger(raw.photoDataId, 0, 0xffff, 'La fiche PhotoData')
  const data = catalog?.[photoDataId]
  if (data && data.id !== photoDataId) throw new Error(`La fiche PhotoData locale ${photoDataId} est incohérente.`)
  const playerName = raw.playerName === undefined
    ? undefined
    : asBoundedText(raw.playerName, 7, 'Le nom joueur')
  if ((playerName === undefined) !== (raw.playerNameSource === undefined)
    || raw.playerNameSource !== undefined && raw.playerNameSource !== 'user-text') {
    throw new Error("Le nom joueur d'une photo data-only HGSS n'est pas attesté.")
  }
  const leadPokemonNickname = raw.leadPokemonNickname === undefined
    ? undefined
    : asBoundedText(raw.leadPokemonNickname, 10, 'Le surnom meneur')
  if ((leadPokemonNickname === undefined) !== (raw.leadPokemonNameSource === undefined)
    || raw.leadPokemonNameSource !== undefined && raw.leadPokemonNameSource !== 'user-text') {
    throw new Error("Le surnom meneur d'une photo data-only HGSS n'est pas attesté.")
  }
  return {
    photoDataId,
    playerGenderBit: asInteger(raw.playerGenderBit, 0, 1, 'Le genre du joueur') as 0 | 1,
    iconId: data?.iconId ?? 0,
    numMons: asInteger(raw.numMons, 1, 6, 'Le nombre de Pokémon'),
    playerName: playerName ?? '',
    ...(playerName ? { playerNameSource: 'user-text' as const } : {}),
    ...(leadPokemonNickname ? { leadPokemonNickname, leadPokemonNameSource: 'user-text' as const } : {}),
    avatarState: asInteger(raw.avatarState, 0, 0xff, 'L’état avatar'),
    mapId: data?.mapId ?? 0,
    x: data?.x ?? 0,
    z: data?.z ?? 0,
    rtc: {
      year: asInteger(raw.rtc.year, 0, 0xff, 'L’année'),
      month: asInteger(raw.rtc.month, 1, 12, 'Le mois'),
      day: asInteger(raw.rtc.day, 1, 31, 'Le jour'),
      weekday: asInteger(raw.rtc.weekday, 0, 6, 'Le jour de semaine'),
      hour: asInteger(raw.rtc.hour, 0, 23, 'L’heure'),
      minute: asInteger(raw.rtc.minute, 0, 59, 'La minute'),
    },
    parameters: data ? [...data.parameters] as [number, number] : [0, 0],
    subjectSpriteId: data?.subjectSpriteId ?? 0,
    subjectParameter: data?.unk9 ?? 0,
    camera: cloneHgssSavedPhotoCamera(hgssPhotoCamera),
    party: raw.party.map(restorePhotoMon),
  }
}

/**
 * Accepte le schéma courant et l'ancienne forme compacte `{ photos: [] }`.
 * Une sauvegarde antérieure sans album migre vers l'album natif vide.
 */
export function restoreHgssPhotoAlbum(raw: unknown, catalog?: HgssPhotoDataCatalog): HgssPhotoAlbumState {
  if (raw === undefined || raw === null) return createHgssPhotoAlbum()
  if (isRecord(raw) && raw.schemaVersion === hgssDataOnlyPhotoAlbumSchemaVersion) {
    requireOnlyKeys(raw, ['schemaVersion', 'slots'], "L'album data-only HGSS")
    if (!Array.isArray(raw.slots) || raw.slots.length !== hgssPhotoAlbumCapacity) throw new Error('La sauvegarde PhotoAlbum data-only HGSS est invalide.')
    const album = createHgssPhotoAlbum()
    raw.slots.forEach((photo, index) => {
      if (photo !== undefined && photo !== null) album.slots[index] = restoreDataOnlySavedPhoto(photo, catalog)
    })
    return album
  }
  const source = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.slots)
      ? raw.slots
      : isRecord(raw) && Array.isArray(raw.photos)
        ? raw.photos
        : undefined
  if (!source) throw new Error('La sauvegarde PhotoAlbum HGSS est invalide.')
  if (source.length > hgssPhotoAlbumCapacity) throw new Error(`La sauvegarde PhotoAlbum HGSS dépasse ${hgssPhotoAlbumCapacity} photos.`)
  const album = createHgssPhotoAlbum()
  source.forEach((rawPhoto, index) => {
    if (rawPhoto !== undefined && rawPhoto !== null) album.slots[index] = restoreSavedPhoto(rawPhoto)
  })
  return album
}
