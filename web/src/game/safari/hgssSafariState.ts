export const HGSS_SAFARI_STATE_SCHEMA_VERSION = 1 as const
export const HGSS_SAFARI_AREA_SET_COUNT = 2 as const
export const HGSS_SAFARI_AREAS_PER_SET = 6 as const
export const HGSS_SAFARI_AREA_COUNT = 12 as const
export const HGSS_SAFARI_MAX_OBJECTS_PER_AREA = 30 as const
export const HGSS_SAFARI_OBJECT_COUNT = 24 as const
export const HGSS_SAFARI_BALL_COUNT = 30 as const
export const HGSS_SAFARI_HAS_STEP_LIMIT = false as const

export type HgssSafariAreaSetIndex = 0 | 1
export type HgssSafariAreaSlot = 0 | 1 | 2 | 3 | 4 | 5
export type HgssSafariAreaId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11
export type HgssSafariObjectId =
  | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11
  | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23
export type HgssSafariObjectUnlockLevel = 0 | 1 | 2 | 3 | 4
export type HgssSafariObjectType = 0 | 1 | 2 | 3 | 4

export type HgssSafariObjectPlacement = {
  objectId: HgssSafariObjectId
  x: number
  y: number
  z: number
}

export type HgssSafariArea = {
  areaId: HgssSafariAreaId
  placements: HgssSafariObjectPlacement[]
}

export type HgssSafariAreaSet = {
  areas: [HgssSafariArea, HgssSafariArea, HgssSafariArea, HgssSafariArea, HgssSafariArea, HgssSafariArea]
  /** Un compteur journalier par identité de zone, et non par emplacement dans la grille. */
  areaLevels: [number, number, number, number, number, number, number, number, number, number, number, number]
}

export type HgssSafariSessionState = {
  active: boolean
  balls: number
}

/** Miroir sérialisable de `SAFARIZONE_LINKLEADER`. */
export type HgssSafariLinkLeader = {
  linked: boolean
  receivedTimestampSeconds: number
  rtcOffsetMinutes: number
  gender: 'male' | 'female'
  language: number
  gameVersion: number
  trainerId: number
  name: string
  nameSource?: 'user-text'
}

/**
 * Équivalent sérialisable des champs SafariZone et LocalFieldData de HGSS.
 * `pendingAreaDays` est le compteur u8 que la ROM diffère tant qu'une session est active.
 */
export type HgssSafariState = {
  schemaVersion: typeof HGSS_SAFARI_STATE_SCHEMA_VERSION
  areaSets: [HgssSafariAreaSet, HgssSafariAreaSet]
  activeAreaSet: HgssSafariAreaSetIndex
  objectUnlockLevel: HgssSafariObjectUnlockLevel
  pendingAreaDays: number
  session: HgssSafariSessionState
  linkLeader: HgssSafariLinkLeader
}

/** Ancienne forme déjà enregistrée par PokeMaster, acceptée uniquement par la migration explicite. */
export type HgssSafariLegacySessionState = {
  active: boolean
  areaSet: number
  balls: number
  steps?: number
}

/** Les dix arrangements que `SafariZone_ResetAreaSetToDefaultSet` indexe par RNG modulo 10. */
export const hgssSafariDefaultAreaArrangements = [
  [0, 7, 1, 5, 3, 6],
  [1, 8, 5, 6, 3, 7],
  [5, 9, 6, 7, 3, 8],
  [6, 10, 7, 8, 3, 9],
  [7, 2, 8, 9, 3, 10],
  [8, 0, 9, 10, 3, 2],
  [9, 1, 10, 2, 3, 0],
  [10, 5, 2, 0, 3, 1],
  [2, 6, 0, 1, 3, 5],
  [0, 2, 5, 7, 3, 9],
] as const satisfies readonly (readonly HgssSafariAreaId[])[]

/** Type de bloc de rencontre, dans l'ordre de `sObjects` de la ROM. */
export const hgssSafariObjectTypes = [
  1, 1, 1,
  2, 2, 2,
  3, 3, 3,
  4, 4, 4,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
] as const satisfies readonly HgssSafariObjectType[]

const objectGroups = [
  [0, 1, 2, 19, 20, 12],
  [3, 4, 5, 13, 14, 17],
  [6, 7, 8, 21, 22, 23],
  [9, 10, 11, 15, 16, 18],
] as const satisfies readonly (readonly HgssSafariObjectId[])[]

const objectGroupOrderByTrainerIdDigit = [
  [0, 1, 2, 3],
  [0, 1, 2, 3],
  [0, 1, 2, 3],
  [1, 2, 3, 0],
  [1, 2, 3, 0],
  [1, 2, 3, 0],
  [2, 3, 0, 1],
  [2, 3, 0, 1],
  [3, 0, 1, 2],
  [3, 0, 1, 2],
] as const

const objectBoostBreakpoints = [
  [1, 5, 10, 15, 20],
  [2, 6, 11, 16, 21],
  [3, 7, 12, 17, 22],
  [4, 8, 13, 18, 23],
] as const

function requireIntegerInRange(value: number, min: number, max: number, label: string): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} ${value} est hors de la plage HGSS ${min}..${max}.`)
  }
  return value
}

function requireAreaSetIndex(value: number): HgssSafariAreaSetIndex {
  return requireIntegerInRange(value, 0, 1, 'Le set Safari') as HgssSafariAreaSetIndex
}

function requireAreaSlot(value: number): HgssSafariAreaSlot {
  return requireIntegerInRange(value, 0, HGSS_SAFARI_AREAS_PER_SET - 1, 'L’emplacement de zone Safari') as HgssSafariAreaSlot
}

function requireAreaId(value: number): HgssSafariAreaId {
  return requireIntegerInRange(value, 0, HGSS_SAFARI_AREA_COUNT - 1, 'La zone Safari') as HgssSafariAreaId
}

function requireObjectId(value: number): HgssSafariObjectId {
  return requireIntegerInRange(value, 0, HGSS_SAFARI_OBJECT_COUNT - 1, 'L’objet Safari') as HgssSafariObjectId
}

function createArea(areaId: HgssSafariAreaId): HgssSafariArea {
  return { areaId, placements: [] }
}

function createAreaLevels(): HgssSafariAreaSet['areaLevels'] {
  return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
}

export function createHgssSafariAreaSet(arrangement: readonly number[]): HgssSafariAreaSet {
  if (arrangement.length !== HGSS_SAFARI_AREAS_PER_SET) {
    throw new Error(`Un set Safari HGSS doit contenir exactement ${HGSS_SAFARI_AREAS_PER_SET} zones.`)
  }
  return {
    areas: arrangement.map((areaId) => createArea(requireAreaId(areaId))) as HgssSafariAreaSet['areas'],
    areaLevels: createAreaLevels(),
  }
}

function createZeroedLinkedAreaSet(): HgssSafariAreaSet {
  // Save_SafariZone_Init efface le second set; il reste donc six structures area_no=0
  // jusqu'à la réception du set d'un autre joueur.
  return createHgssSafariAreaSet([0, 0, 0, 0, 0, 0])
}

function createClearedLinkLeader(): HgssSafariLinkLeader {
  return {
    linked: false,
    receivedTimestampSeconds: 0,
    rtcOffsetMinutes: 0,
    gender: 'male',
    language: 0,
    gameVersion: 0,
    trainerId: 0,
    name: '',
  }
}

export function createHgssSafariState(initialRandomValue: number): HgssSafariState {
  requireIntegerInRange(initialRandomValue, 0, 0xffffffff, 'La valeur RNG Safari')
  const arrangement = hgssSafariDefaultAreaArrangements[initialRandomValue % hgssSafariDefaultAreaArrangements.length]!
  return {
    schemaVersion: HGSS_SAFARI_STATE_SCHEMA_VERSION,
    areaSets: [createHgssSafariAreaSet(arrangement), createZeroedLinkedAreaSet()],
    activeAreaSet: 0,
    objectUnlockLevel: 0,
    pendingAreaDays: 0,
    session: { active: false, balls: 0 },
    linkLeader: createClearedLinkLeader(),
  }
}

export function cloneHgssSafariState(state: HgssSafariState): HgssSafariState {
  const cloneSet = (areaSet: HgssSafariAreaSet): HgssSafariAreaSet => ({
    areas: areaSet.areas.map((area) => ({
      areaId: area.areaId,
      placements: area.placements.map((placement) => ({ ...placement })),
    })) as HgssSafariAreaSet['areas'],
    areaLevels: [...areaSet.areaLevels] as HgssSafariAreaSet['areaLevels'],
  })
  return {
    schemaVersion: HGSS_SAFARI_STATE_SCHEMA_VERSION,
    areaSets: [cloneSet(state.areaSets[0]), cloneSet(state.areaSets[1])],
    activeAreaSet: state.activeAreaSet,
    objectUnlockLevel: state.objectUnlockLevel,
    pendingAreaDays: state.pendingAreaDays,
    session: { ...state.session },
    linkLeader: { ...(state.linkLeader ?? createClearedLinkLeader()) },
  }
}

function cloneAreaSet(areaSet: HgssSafariAreaSet): HgssSafariAreaSet {
  return {
    areas: areaSet.areas.map((area) => {
      if (area.placements.length > HGSS_SAFARI_MAX_OBJECTS_PER_AREA) {
        throw new Error(`La zone Safari liée dépasse ${HGSS_SAFARI_MAX_OBJECTS_PER_AREA} Blocs.`)
      }
      return {
        areaId: requireAreaId(area.areaId),
        placements: area.placements.map((placement) => {
          requireObjectId(placement.objectId)
          requireIntegerInRange(placement.x, 0, 0xff, 'La coordonnée X de l’objet Safari lié')
          requireIntegerInRange(placement.y, 0, 0xff, 'La coordonnée Y de l’objet Safari lié')
          requireIntegerInRange(placement.z, 0, 0xff, 'La coordonnée Z de l’objet Safari lié')
          return { ...placement }
        }),
      }
    }) as HgssSafariAreaSet['areas'],
    areaLevels: areaSet.areaLevels.map((level) => requireIntegerInRange(level, 0, 0xff, 'Le niveau de zone Safari lié')) as HgssSafariAreaSet['areaLevels'],
  }
}

export function receiveHgssSafariLinkedAreaSet(
  state: HgssSafariState,
  areaSet: HgssSafariAreaSet,
  profile: Pick<HgssSafariLinkLeader, 'trainerId' | 'name' | 'gender' | 'language' | 'gameVersion'>,
  receivedTimestampSeconds: number,
  rtcOffsetMinutes: number,
): HgssSafariState {
  if (areaSet.areas.length !== HGSS_SAFARI_AREAS_PER_SET || areaSet.areaLevels.length !== HGSS_SAFARI_AREA_COUNT) {
    throw new Error('Le set Safari reçu ne possède pas la taille native 6 zones/12 niveaux.')
  }
  requireIntegerInRange(profile.trainerId, 0, 0xffffffff, 'L’identifiant du meneur Safari')
  if ([...profile.name].length > 7) throw new Error('Le nom du meneur Safari dépasse les 7 caractères HGSS.')
  requireIntegerInRange(profile.language, 0, 0xff, 'La langue du meneur Safari')
  requireIntegerInRange(profile.gameVersion, 0, 0xff, 'La version du meneur Safari')
  if (!Number.isSafeInteger(receivedTimestampSeconds)) throw new Error('L’horodatage du set Safari reçu est invalide.')
  if (!Number.isSafeInteger(rtcOffsetMinutes)) throw new Error('Le décalage RTC du set Safari reçu est invalide.')
  const next = cloneHgssSafariState(state)
  next.areaSets[1] = cloneAreaSet(areaSet)
  next.linkLeader = { ...profile, nameSource: 'user-text', linked: true, receivedTimestampSeconds, rtcOffsetMinutes }
  return next
}

/** Expiration native : strictement après 24 h, ou dès que le décalage RTC change. */
export function deactivateHgssSafariLinkIfExpired(
  state: HgssSafariState,
  currentTimestampSeconds: number,
  rtcOffsetMinutes: number,
): HgssSafariState {
  if (!Number.isSafeInteger(currentTimestampSeconds) || !Number.isSafeInteger(rtcOffsetMinutes)) {
    throw new Error('La RTC utilisée pour le set Safari lié est invalide.')
  }
  const next = cloneHgssSafariState(state)
  if (next.linkLeader.linked && (
    currentTimestampSeconds - next.linkLeader.receivedTimestampSeconds > 24 * 60 * 60
    || next.linkLeader.rtcOffsetMinutes !== rtcOffsetMinutes
  )) next.linkLeader.linked = false
  return next
}

export function migrateHgssSafariLegacySession(
  legacy: HgssSafariLegacySessionState,
  initialRandomValue: number,
): HgssSafariState {
  const state = createHgssSafariState(initialRandomValue)
  state.activeAreaSet = requireAreaSetIndex(legacy.areaSet)
  state.session.active = Boolean(legacy.active)
  const legacyBalls = requireIntegerInRange(legacy.balls, 0, HGSS_SAFARI_BALL_COUNT, 'Le nombre de Safari Balls')
  state.session.balls = state.session.active ? legacyBalls : 0
  // `steps` est volontairement ignoré : HGSS conserve le champ LocalFieldData mais ne l'incrémente jamais.
  return state
}

export function setHgssSafariObjectUnlockLevel(
  state: HgssSafariState,
  level: number,
): HgssSafariState {
  if (!Number.isFinite(level)) throw new Error(`Le palier d’objets Safari ${level} est invalide.`)
  const next = cloneHgssSafariState(state)
  next.objectUnlockLevel = Math.min(4, Math.max(0, Math.trunc(level))) as HgssSafariObjectUnlockLevel
  return next
}

export function incrementHgssSafariObjectUnlockLevel(
  state: HgssSafariState,
  amount: number,
): HgssSafariState {
  if (!Number.isInteger(amount)) throw new Error(`L’incrément d’objets Safari ${amount} est invalide.`)
  return setHgssSafariObjectUnlockLevel(state, state.objectUnlockLevel + amount)
}

export function getHgssSafariUnlockedObjectIds(
  trainerId: number,
  unlockLevel: HgssSafariObjectUnlockLevel,
): HgssSafariObjectId[] {
  requireIntegerInRange(trainerId, 0, 0xffffffff, 'L’identifiant Dresseur')
  requireIntegerInRange(unlockLevel, 0, 4, 'Le palier d’objets Safari')
  const groupOrder = objectGroupOrderByTrainerIdDigit[trainerId % 10]!
  return groupOrder.slice(0, unlockLevel).flatMap((groupIndex) => [...objectGroups[groupIndex]!])
}

function updateArea(
  state: HgssSafariState,
  setIndexValue: number,
  areaSlotValue: number,
  update: (area: HgssSafariArea) => HgssSafariArea,
): HgssSafariState {
  const setIndex = requireAreaSetIndex(setIndexValue)
  const areaSlot = requireAreaSlot(areaSlotValue)
  const next = cloneHgssSafariState(state)
  next.areaSets[setIndex].areas[areaSlot] = update(next.areaSets[setIndex].areas[areaSlot]!)
  return next
}

export function placeHgssSafariObject(
  state: HgssSafariState,
  setIndex: number,
  areaSlot: number,
  placement: HgssSafariObjectPlacement,
): HgssSafariState {
  requireObjectId(placement.objectId)
  requireIntegerInRange(placement.x, 0, 0xff, 'La coordonnée X de l’objet Safari')
  requireIntegerInRange(placement.y, 0, 0xff, 'La coordonnée Y de l’objet Safari')
  requireIntegerInRange(placement.z, 0, 0xff, 'La coordonnée Z de l’objet Safari')
  return updateArea(state, setIndex, areaSlot, (area) => {
    if (area.placements.length >= HGSS_SAFARI_MAX_OBJECTS_PER_AREA) {
      throw new Error(`La zone Safari contient déjà ses ${HGSS_SAFARI_MAX_OBJECTS_PER_AREA} objets.`)
    }
    return { ...area, placements: [...area.placements, { ...placement }] }
  })
}

export function removeHgssSafariObject(
  state: HgssSafariState,
  setIndex: number,
  areaSlot: number,
  placementIndex: number,
): HgssSafariState {
  return updateArea(state, setIndex, areaSlot, (area) => {
    requireIntegerInRange(placementIndex, 0, area.placements.length - 1, 'L’index de l’objet Safari')
    return { ...area, placements: area.placements.filter((_, index) => index !== placementIndex) }
  })
}

export function replaceHgssSafariArea(
  state: HgssSafariState,
  setIndex: number,
  areaSlot: number,
  areaId: number,
): HgssSafariState {
  return updateArea(state, setIndex, areaSlot, () => createArea(requireAreaId(areaId)))
}

export function swapHgssSafariAreas(
  state: HgssSafariState,
  setIndexValue: number,
  firstSlotValue: number,
  secondSlotValue: number,
): HgssSafariState {
  const setIndex = requireAreaSetIndex(setIndexValue)
  const firstSlot = requireAreaSlot(firstSlotValue)
  const secondSlot = requireAreaSlot(secondSlotValue)
  const next = cloneHgssSafariState(state)
  const first = next.areaSets[setIndex].areas[firstSlot]
  next.areaSets[setIndex].areas[firstSlot] = next.areaSets[setIndex].areas[secondSlot]
  next.areaSets[setIndex].areas[secondSlot] = first
  return next
}

function getObjectLevelBoost(areaDays: number, objectType: Exclude<HgssSafariObjectType, 0>): number {
  const age = Math.floor(areaDays / 10)
  const breakpoints = objectBoostBreakpoints[objectType - 1]
  const breakpointIndex = breakpoints.findIndex((breakpoint) => age < breakpoint)
  if (breakpointIndex >= 0) return breakpointIndex + 1
  return age < 25 ? 6 : 7
}

export type HgssSafariObjectScores = {
  /** Comptage physique des quatre types Plains, Forest, Peak et Water. */
  counts: [number, number, number, number]
  /** Comptage pondéré par l'âge, utilisé par les conditions de rencontres. */
  effectiveLevels: [number, number, number, number]
}

/**
 * Ordre exact du panneau du Customizer (messages 429:10..14) : herbes,
 * bois, rochers, eau, puis Blocs sans bonus de rencontre.
 */
export type HgssSafariObjectCategoryCounts = [number, number, number, number, number]

export function getHgssSafariObjectCategoryCounts(area: HgssSafariArea): HgssSafariObjectCategoryCounts {
  const counts: HgssSafariObjectCategoryCounts = [0, 0, 0, 0, 0]
  for (const placement of area.placements) {
    const objectType = hgssSafariObjectTypes[placement.objectId]
    counts[objectType === 0 ? 4 : objectType - 1]++
  }
  return counts
}

export function getHgssSafariObjectScores(areaSet: HgssSafariAreaSet, areaSlotValue: number): HgssSafariObjectScores {
  const areaSlot = requireAreaSlot(areaSlotValue)
  const area = areaSet.areas[areaSlot]
  const areaDays = areaSet.areaLevels[area.areaId]
  const counts: HgssSafariObjectScores['counts'] = [0, 0, 0, 0]
  const effectiveLevels: HgssSafariObjectScores['effectiveLevels'] = [0, 0, 0, 0]
  for (const placement of area.placements) {
    const objectType = hgssSafariObjectTypes[placement.objectId]
    if (objectType === 0) continue
    const index = objectType - 1
    counts[index]++
    effectiveLevels[index] = Math.min(0xff, effectiveLevels[index] + getObjectLevelBoost(areaDays, objectType))
  }
  return { counts, effectiveLevels }
}

export function startHgssSafariSession(
  state: HgssSafariState,
  areaSetValue: number = 0,
): HgssSafariState {
  if (state.session.active) throw new Error('Une session Safari HGSS est déjà active.')
  const next = cloneHgssSafariState(state)
  next.activeAreaSet = requireAreaSetIndex(areaSetValue)
  next.session = { active: true, balls: HGSS_SAFARI_BALL_COUNT }
  return next
}

export function consumeHgssSafariBall(state: HgssSafariState): HgssSafariState {
  if (!state.session.active) throw new Error('Aucune session Safari HGSS n’est active.')
  if (state.session.balls <= 0) throw new Error('Il ne reste aucune Safari Ball.')
  const next = cloneHgssSafariState(state)
  next.session.balls--
  return next
}

export function isHgssSafariSessionOutOfBalls(state: HgssSafariState): boolean {
  return state.session.active && state.session.balls === 0
}

/** Fermeture brute de `SafariZoneAction 1`; le module de progression applique d'abord les jours différés. */
export function closeHgssSafariSessionState(state: HgssSafariState): HgssSafariState {
  const next = cloneHgssSafariState(state)
  next.activeAreaSet = 1
  next.pendingAreaDays = 0
  next.session = { active: false, balls: 0 }
  return next
}
