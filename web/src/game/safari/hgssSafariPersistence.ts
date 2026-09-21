import {
  HGSS_SAFARI_AREAS_PER_SET,
  HGSS_SAFARI_AREA_COUNT,
  HGSS_SAFARI_AREA_SET_COUNT,
  HGSS_SAFARI_BALL_COUNT,
  HGSS_SAFARI_MAX_OBJECTS_PER_AREA,
  HGSS_SAFARI_OBJECT_COUNT,
  cloneHgssSafariState,
  createHgssSafariState,
  migrateHgssSafariLegacySession,
  type HgssSafariLegacySessionState,
  type HgssSafariState,
} from './hgssSafariState'
import {
  HGSS_IGT_MAX_MINUTES,
  createHgssSafariProgressionState,
  registerHgssBaobaContact,
  setHgssBaobaQuestStage,
  type HgssSafariProgressionState,
} from './hgssSafariProgression'

export type SavedHgssSafariState = HgssSafariState | HgssSafariLegacySessionState
export type SavedHgssSafariProgressionState = HgssSafariProgressionState

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`La sauvegarde HGSS contient une valeur Safari invalide à ${path}.`)
  }
  return value as Record<string, unknown>
}

function requireOnlyKeys(record: Record<string, unknown>, keys: readonly string[], path: string): void {
  const allowed = new Set(keys)
  const unknown = Object.keys(record).find((key) => !allowed.has(key))
  if (unknown !== undefined) throw new Error(`La sauvegarde HGSS contient un champ Safari inconnu à ${path}.${unknown}.`)
}

function requireInteger(value: unknown, path: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`La sauvegarde HGSS contient un entier Safari invalide à ${path}.`)
  }
  return value as number
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`La sauvegarde HGSS contient un booléen Safari invalide à ${path}.`)
  return value
}

function requireArray(value: unknown, path: string, length?: number): unknown[] {
  if (!Array.isArray(value) || length !== undefined && value.length !== length) {
    throw new Error(`La sauvegarde HGSS contient un tableau Safari invalide à ${path}.`)
  }
  return value
}

function isLegacySafariState(value: Record<string, unknown>): boolean {
  return value.schemaVersion === undefined && value.areaSets === undefined
}

export function validateSavedHgssSafariState(
  value: unknown,
  path = 'field.safariZone',
  requireDataOnlyTextProvenance = false,
): void {
  const safari = requireRecord(value, path)
  if (isLegacySafariState(safari)) {
    requireOnlyKeys(safari, ['active', 'areaSet', 'balls', 'steps'], path)
    requireBoolean(safari.active, `${path}.active`)
    requireInteger(safari.areaSet, `${path}.areaSet`, 0, 1)
    requireInteger(safari.balls, `${path}.balls`, 0, HGSS_SAFARI_BALL_COUNT)
    if (safari.steps !== undefined) requireInteger(safari.steps, `${path}.steps`, 0, 0xffff)
    return
  }

  requireOnlyKeys(safari, ['activeAreaSet', 'areaSets', 'linkLeader', 'objectUnlockLevel', 'pendingAreaDays', 'schemaVersion', 'session'], path)

  requireInteger(safari.schemaVersion, `${path}.schemaVersion`, 1, 1)
  const areaSets = requireArray(safari.areaSets, `${path}.areaSets`, HGSS_SAFARI_AREA_SET_COUNT)
  areaSets.forEach((areaSetValue, setIndex) => {
    const areaSet = requireRecord(areaSetValue, `${path}.areaSets[${setIndex}]`)
    requireOnlyKeys(areaSet, ['areaLevels', 'areas'], `${path}.areaSets[${setIndex}]`)
    const areas = requireArray(areaSet.areas, `${path}.areaSets[${setIndex}].areas`, HGSS_SAFARI_AREAS_PER_SET)
    areas.forEach((areaValue, areaSlot) => {
      const area = requireRecord(areaValue, `${path}.areaSets[${setIndex}].areas[${areaSlot}]`)
      requireOnlyKeys(area, ['areaId', 'placements'], `${path}.areaSets[${setIndex}].areas[${areaSlot}]`)
      requireInteger(area.areaId, `${path}.areaSets[${setIndex}].areas[${areaSlot}].areaId`, 0, HGSS_SAFARI_AREA_COUNT - 1)
      const placements = requireArray(area.placements, `${path}.areaSets[${setIndex}].areas[${areaSlot}].placements`)
      if (placements.length > HGSS_SAFARI_MAX_OBJECTS_PER_AREA) {
        throw new Error(`La sauvegarde HGSS dépasse ${HGSS_SAFARI_MAX_OBJECTS_PER_AREA} objets à ${path}.areaSets[${setIndex}].areas[${areaSlot}].placements.`)
      }
      placements.forEach((placementValue, placementIndex) => {
        const placementPath = `${path}.areaSets[${setIndex}].areas[${areaSlot}].placements[${placementIndex}]`
        const placement = requireRecord(placementValue, placementPath)
        requireOnlyKeys(placement, ['objectId', 'x', 'y', 'z'], placementPath)
        requireInteger(placement.objectId, `${placementPath}.objectId`, 0, HGSS_SAFARI_OBJECT_COUNT - 1)
        requireInteger(placement.x, `${placementPath}.x`, 0, 0xff)
        requireInteger(placement.y, `${placementPath}.y`, 0, 0xff)
        requireInteger(placement.z, `${placementPath}.z`, 0, 0xff)
      })
    })
    requireArray(areaSet.areaLevels, `${path}.areaSets[${setIndex}].areaLevels`, HGSS_SAFARI_AREA_COUNT)
      .forEach((level, areaId) => requireInteger(level, `${path}.areaSets[${setIndex}].areaLevels[${areaId}]`, 0, 0xff))
  })
  requireInteger(safari.activeAreaSet, `${path}.activeAreaSet`, 0, 1)
  requireInteger(safari.objectUnlockLevel, `${path}.objectUnlockLevel`, 0, 4)
  requireInteger(safari.pendingAreaDays, `${path}.pendingAreaDays`, 0, 0xff)
  const session = requireRecord(safari.session, `${path}.session`)
  requireOnlyKeys(session, ['active', 'balls'], `${path}.session`)
  requireBoolean(session.active, `${path}.session.active`)
  requireInteger(session.balls, `${path}.session.balls`, 0, HGSS_SAFARI_BALL_COUNT)
  if (safari.linkLeader !== undefined) {
    const leader = requireRecord(safari.linkLeader, `${path}.linkLeader`)
    requireOnlyKeys(leader, ['gameVersion', 'gender', 'language', 'linked', 'name', 'nameSource', 'receivedTimestampSeconds', 'rtcOffsetMinutes', 'trainerId'], `${path}.linkLeader`)
    requireBoolean(leader.linked, `${path}.linkLeader.linked`)
    requireInteger(leader.receivedTimestampSeconds, `${path}.linkLeader.receivedTimestampSeconds`, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
    requireInteger(leader.rtcOffsetMinutes, `${path}.linkLeader.rtcOffsetMinutes`, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
    if (leader.gender !== 'male' && leader.gender !== 'female') throw new Error(`La sauvegarde HGSS contient un genre Safari invalide à ${path}.linkLeader.gender.`)
    requireInteger(leader.language, `${path}.linkLeader.language`, 0, 0xff)
    requireInteger(leader.gameVersion, `${path}.linkLeader.gameVersion`, 0, 0xff)
    requireInteger(leader.trainerId, `${path}.linkLeader.trainerId`, 0, 0xffffffff)
    if (typeof leader.name !== 'string' || [...leader.name].length > 7) throw new Error(`La sauvegarde HGSS contient un nom Safari invalide à ${path}.linkLeader.name.`)
    if (leader.nameSource !== undefined && leader.nameSource !== 'user-text') throw new Error(`La provenance du nom Safari est invalide à ${path}.linkLeader.nameSource.`)
    if (requireDataOnlyTextProvenance && leader.name !== '' && leader.nameSource !== 'user-text') {
      throw new Error(`Le nom Safari à ${path}.linkLeader.name n'est pas attesté utilisateur.`)
    }
  }
}

export function snapshotHgssSafariState(state: HgssSafariState): HgssSafariState {
  return {
    schemaVersion: 1,
    areaSets: state.areaSets.map((areaSet) => ({
      areas: areaSet.areas.map((area) => ({
        areaId: area.areaId,
        placements: area.placements.map((placement) => ({
          objectId: placement.objectId, x: placement.x, y: placement.y, z: placement.z,
        })),
      })) as HgssSafariState['areaSets'][number]['areas'],
      areaLevels: [...areaSet.areaLevels],
    })) as HgssSafariState['areaSets'],
    activeAreaSet: state.activeAreaSet,
    objectUnlockLevel: state.objectUnlockLevel,
    pendingAreaDays: state.pendingAreaDays,
    session: { active: state.session.active, balls: state.session.balls },
    linkLeader: {
      linked: state.linkLeader.linked,
      receivedTimestampSeconds: state.linkLeader.receivedTimestampSeconds,
      rtcOffsetMinutes: state.linkLeader.rtcOffsetMinutes,
      gender: state.linkLeader.gender,
      language: state.linkLeader.language,
      gameVersion: state.linkLeader.gameVersion,
      trainerId: state.linkLeader.trainerId,
      name: state.linkLeader.nameSource === 'user-text' ? state.linkLeader.name : '',
      ...(state.linkLeader.nameSource === 'user-text' && state.linkLeader.name ? { nameSource: 'user-text' as const } : {}),
    },
  }
}

export function restoreHgssSafariState(
  value: unknown,
  initialRandomValue: number,
): HgssSafariState {
  if (value === undefined) return createHgssSafariState(initialRandomValue)
  validateSavedHgssSafariState(value)
  const safari = value as SavedHgssSafariState
  if (!('schemaVersion' in safari)) return migrateHgssSafariLegacySession(safari, initialRandomValue)
  const restored = cloneHgssSafariState(safari)
  // Dans ce bloc, le nom ne peut venir que du profil du joueur distant reçu
  // avec son set de zones. Les anciennes saves ne stockaient pas le marqueur.
  if (restored.linkLeader.name && restored.linkLeader.nameSource === undefined) {
    restored.linkLeader.nameSource = 'user-text'
  }
  return restored
}

export function validateSavedHgssSafariProgression(
  value: unknown,
  path = 'field.safariProgression',
): void {
  const progression = requireRecord(value, path)
  requireOnlyKeys(progression, ['baobaContactRegistered', 'baobaIgtReferenceMinutes', 'baobaQuestStage', 'lastAreaUpdateDay', 'pendingEncounterAreaIds', 'schemaVersion'], path)
  requireInteger(progression.schemaVersion, `${path}.schemaVersion`, 1, 1)
  requireBoolean(progression.baobaContactRegistered, `${path}.baobaContactRegistered`)
  requireInteger(progression.baobaQuestStage, `${path}.baobaQuestStage`, 0, 7)
  requireInteger(progression.baobaIgtReferenceMinutes, `${path}.baobaIgtReferenceMinutes`, 0, HGSS_IGT_MAX_MINUTES)
  if (progression.lastAreaUpdateDay !== undefined) {
    if (typeof progression.lastAreaUpdateDay !== 'string') {
      throw new Error(`La sauvegarde HGSS contient un jour Safari invalide à ${path}.lastAreaUpdateDay.`)
    }
    const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(progression.lastAreaUpdateDay)
    const year = Number(match?.[1])
    const month = Number(match?.[2])
    const day = Number(match?.[3])
    const parsed = new Date(Date.UTC(year, month - 1, day))
    if (!match || parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
      throw new Error(`La sauvegarde HGSS contient un jour Safari invalide à ${path}.lastAreaUpdateDay.`)
    }
  }
  if (progression.pendingEncounterAreaIds !== undefined) {
    const pending = requireArray(progression.pendingEncounterAreaIds, `${path}.pendingEncounterAreaIds`)
    if (pending.length > HGSS_SAFARI_AREAS_PER_SET || new Set(pending).size !== pending.length) {
      throw new Error(`La sauvegarde HGSS contient une file de zones Safari invalide à ${path}.pendingEncounterAreaIds.`)
    }
    pending.forEach((areaId, index) => {
      requireInteger(areaId, `${path}.pendingEncounterAreaIds[${index}]`, 0, HGSS_SAFARI_AREA_COUNT - 1)
    })
  }
}

export function snapshotHgssSafariProgression(
  state: HgssSafariProgressionState,
): HgssSafariProgressionState {
  return {
    schemaVersion: 1,
    baobaContactRegistered: state.baobaContactRegistered,
    baobaQuestStage: state.baobaQuestStage,
    baobaIgtReferenceMinutes: state.baobaIgtReferenceMinutes,
    ...(state.lastAreaUpdateDay === undefined ? {} : { lastAreaUpdateDay: state.lastAreaUpdateDay }),
    pendingEncounterAreaIds: [...state.pendingEncounterAreaIds],
  }
}

export function restoreHgssSafariProgression(
  value: unknown,
  nativeQuestStage?: number,
  baobaContactRegistered = false,
): HgssSafariProgressionState {
  let state: HgssSafariProgressionState
  if (value === undefined) state = createHgssSafariProgressionState()
  else {
    validateSavedHgssSafariProgression(value)
    const restored = value as HgssSafariProgressionState
    state = { ...restored, pendingEncounterAreaIds: [...(restored.pendingEncounterAreaIds ?? [])] }
  }
  if (nativeQuestStage !== undefined) state = setHgssBaobaQuestStage(state, nativeQuestStage)
  if (baobaContactRegistered) state = registerHgssBaobaContact(state)
  return state
}
