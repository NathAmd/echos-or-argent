import type { PokemonCatalog } from '../../ndsTypes'
import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import { resolveHgssTimeOfDayByHour, resolveHgssWildTimeOfDay, type HgssTimeOfDay } from '../time/hgssRtc'
import type {
  HgssSafariAreaEncounterData,
  HgssSafariAreaId,
  HgssSafariBonusCondition,
  HgssSafariEncounterCatalog,
  HgssSafariEncounterMethod,
  HgssSafariEncounterSlot,
  HgssSafariEncounterTime,
} from '../../rom/safari/safariEncounterData'
import {
  getHgssSafariObjectScores,
  type HgssSafariAreaSet,
  type HgssSafariAreaSlot,
} from './hgssSafariState'

export const HGSS_SAFARI_ENCOUNTER_SLOT_COUNT = 10 as const
export const HGSS_SAFARI_FALLBACK_LEVEL = 5 as const
export const HGSS_SAFARI_LAND_FALLBACK_SPECIES_ID = 19 as const
export const HGSS_SAFARI_WATER_FALLBACK_SPECIES_ID = 129 as const

export type PreparedHgssSafariEncounter = HgssSafariEncounterSlot & {
  areaId: HgssSafariAreaId
  areaSlot: HgssSafariAreaSlot
  method: HgssSafariEncounterMethod
  time: HgssSafariEncounterTime
  slotIndex: number
}

export type HgssSafariEncounterLead = {
  abilityId: number
  isEgg: boolean
  level: number
}

export type HgssSafariEncounterFieldContext = {
  rng: HgssLcrng
  pokemonCatalog: PokemonCatalog
  lead: HgssSafariEncounterLead
  /** Niveau du premier Pokémon apte au combat lorsque le Repousse est actif. */
  repelLeadLevel?: number
  /** `EncounterGenState::isSweetScent` neutralise seulement Intimidation/Regard Vif. */
  isSweetScent?: boolean
}

export type HgssSafariEncounterGenerationResult =
  | { encounter: PreparedHgssSafariEncounter, suppressedBy?: undefined }
  | { encounter?: undefined, suppressedBy: 'ability' | 'repel' }

const safariTimesByWildTime = ['morning', 'day', 'night'] as const satisfies readonly HgssSafariEncounterTime[]
const signatureMethods = ['land', 'surf', 'oldRod', 'goodRod', 'superRod'] as const satisfies readonly HgssSafariEncounterMethod[]

function requireAreaSlot(areaSlot: number): asserts areaSlot is HgssSafariAreaSlot {
  if (!Number.isInteger(areaSlot) || areaSlot < 0 || areaSlot >= 6) {
    throw new Error(`L'emplacement de zone Safari ${areaSlot} est invalide.`)
  }
}

function getAreaData(catalog: HgssSafariEncounterCatalog, areaId: HgssSafariAreaId): HgssSafariAreaEncounterData {
  const area = catalog[areaId]
  if (!area || area.areaId !== areaId) {
    throw new Error(`La table de rencontres Safari HGSS de la zone ${areaId} est absente.`)
  }
  return area
}

function cloneSlot(slot: HgssSafariEncounterSlot): HgssSafariEncounterSlot {
  return { speciesId: slot.speciesId, level: slot.level }
}

function createFallbackSlots(method: HgssSafariEncounterMethod): HgssSafariEncounterSlot[] {
  const speciesId = method === 'land'
    ? HGSS_SAFARI_LAND_FALLBACK_SPECIES_ID
    : HGSS_SAFARI_WATER_FALLBACK_SPECIES_ID
  return Array.from({ length: HGSS_SAFARI_ENCOUNTER_SLOT_COUNT }, () => ({
    speciesId,
    level: HGSS_SAFARI_FALLBACK_LEVEL,
  }))
}

function conditionIsMet(
  condition: HgssSafariBonusCondition,
  effectiveLevels: readonly number[],
): boolean {
  if (condition.blockType1 === 0) {
    throw new Error('Une condition primaire de rencontre Safari HGSS ne peut pas utiliser le type de bloc 0.')
  }
  if ((effectiveLevels[condition.blockType1 - 1] ?? 0) < condition.blockCount1) return false
  return condition.blockType2 === 0
    || (effectiveLevels[condition.blockType2 - 1] ?? 0) >= condition.blockCount2
}

export function resolveHgssSafariEncounterTime(timeOfDay: HgssTimeOfDay): HgssSafariEncounterTime {
  return safariTimesByWildTime[resolveHgssWildTimeOfDay(timeOfDay)]!
}

export function resolveHgssSafariEncounterTimeByHour(hour: number): HgssSafariEncounterTime {
  return resolveHgssSafariEncounterTime(resolveHgssTimeOfDayByHour(hour))
}

/**
 * Port de `SafariZoneAreaSet_LoadAreaEncounters` : dix slots équiprobables,
 * les bonus éligibles remplaçant les premiers slots dans l'ordre de la ROM.
 */
export function resolveHgssSafariEncounterSlots(
  catalog: HgssSafariEncounterCatalog,
  areaSet: HgssSafariAreaSet,
  areaSlotValue: number,
  method: HgssSafariEncounterMethod,
  time: HgssSafariEncounterTime,
): HgssSafariEncounterSlot[] {
  requireAreaSlot(areaSlotValue)
  const areaId = areaSet.areas[areaSlotValue].areaId
  const areaData = getAreaData(catalog, areaId)
  const methodData = areaData.methods[method]

  // La ROM teste le nombre de bonus Surf pour savoir si toute rencontre
  // aquatique est absente, quel que soit le type de canne demandé ensuite.
  if (method !== 'land' && areaData.methods.surf.bonusCount === 0) {
    return createFallbackSlots(method)
  }

  const slots = methodData.base[time].map(cloneSlot)
  if (slots.length !== HGSS_SAFARI_ENCOUNTER_SLOT_COUNT) {
    throw new Error(`La zone Safari ${areaId} contient ${slots.length} slots ${method} au lieu de 10.`)
  }

  const { effectiveLevels } = getHgssSafariObjectScores(areaSet, areaSlotValue)
  let replacementIndex = 0
  methodData.bonusConditions.forEach((condition, bonusIndex) => {
    if (replacementIndex >= HGSS_SAFARI_ENCOUNTER_SLOT_COUNT || !conditionIsMet(condition, effectiveLevels)) return
    const bonus = methodData.bonus[time][bonusIndex]
    if (!bonus) throw new Error(`Le bonus Safari ${bonusIndex} de la zone ${areaId} (${method}, ${time}) est absent.`)
    slots[replacementIndex++] = cloneSlot(bonus)
  })
  return slots
}

export function prepareHgssSafariEncounter(
  catalog: HgssSafariEncounterCatalog,
  areaSet: HgssSafariAreaSet,
  areaSlotValue: number,
  method: HgssSafariEncounterMethod,
  time: HgssSafariEncounterTime,
  rng: HgssLcrng,
): PreparedHgssSafariEncounter {
  requireAreaSlot(areaSlotValue)
  const slots = resolveHgssSafariEncounterSlots(catalog, areaSet, areaSlotValue, method, time)
  const slotIndex = rng.nextU16() % HGSS_SAFARI_ENCOUNTER_SLOT_COUNT
  const slot = slots[slotIndex]!
  return {
    ...cloneSlot(slot),
    areaId: areaSet.areas[areaSlotValue].areaId,
    areaSlot: areaSlotValue,
    method,
    time,
    slotIndex,
  }
}

function chooseSafariSlotWithType(
  slots: readonly HgssSafariEncounterSlot[],
  typeId: number,
  pokemonCatalog: PokemonCatalog,
  rng: HgssLcrng,
): number | undefined {
  const matching = slots.flatMap((slot, index) => {
    const types = pokemonCatalog.personalData[slot.speciesId]?.types
    if (!types) throw new Error(`Les types ROM de l'espèce Safari ${slot.speciesId} sont absents.`)
    return types.includes(typeId) ? [index] : []
  })
  // La routine native refuse de biaiser une table entièrement du même type.
  if (matching.length === 0 || matching.length === slots.length) return undefined
  return matching[rng.nextU16() % matching.length]
}

function chooseSafariSlotWithLeadInfluence(
  slots: readonly HgssSafariEncounterSlot[],
  method: HgssSafariEncounterMethod,
  context: HgssSafariEncounterFieldContext,
): number {
  const { lead, pokemonCatalog, rng } = context
  let slotIndex: number | undefined
  if (!lead.isEgg && lead.abilityId === 42 && rng.nextU16() % 2 === 0) {
    slotIndex = chooseSafariSlotWithType(slots, 8, pokemonCatalog, rng)
  } else if (!lead.isEgg && lead.abilityId === 9 && rng.nextU16() % 2 === 0) {
    slotIndex = chooseSafariSlotWithType(slots, 13, pokemonCatalog, rng)
  }
  if (slotIndex === undefined) slotIndex = rng.nextU16() % HGSS_SAFARI_ENCOUNTER_SLOT_COUNT

  if (method === 'land' && !lead.isEgg && (lead.abilityId === 46 || lead.abilityId === 55 || lead.abilityId === 72)) {
    // Pression, Agitation et Esprit Vital ont une chance sur deux de chercher
    // le slot de niveau maximal de la même espèce.
    if (rng.nextU16() % 2 !== 0) {
      const chosen = slots[slotIndex]!
      for (let index = 0; index < slots.length; index += 1) {
        const slot = slots[index]!
        if (slot.speciesId === chosen.speciesId && slot.level > slots[slotIndex]!.level) slotIndex = index
      }
    }
  }
  return slotIndex
}

/**
 * Génération de terrain complète de `FieldSystem_GenerateSafariEncounter`,
 * y compris les talents du meneur et les deux suppressions postérieures au slot.
 */
export function generateHgssSafariFieldEncounter(
  catalog: HgssSafariEncounterCatalog,
  areaSet: HgssSafariAreaSet,
  areaSlotValue: number,
  method: HgssSafariEncounterMethod,
  time: HgssSafariEncounterTime,
  context: HgssSafariEncounterFieldContext,
): HgssSafariEncounterGenerationResult {
  requireAreaSlot(areaSlotValue)
  const slots = resolveHgssSafariEncounterSlots(catalog, areaSet, areaSlotValue, method, time)
  const slotIndex = chooseSafariSlotWithLeadInfluence(slots, method, context)
  const slot = slots[slotIndex]!

  if (!context.isSweetScent && !context.lead.isEgg
    && (context.lead.abilityId === 22 || context.lead.abilityId === 51)
    && context.lead.level > 5
    && slot.level <= context.lead.level - 5
    && context.rng.nextU16() % 2 === 0) {
    return { suppressedBy: 'ability' }
  }
  if (context.repelLeadLevel !== undefined && context.repelLeadLevel > slot.level) {
    return { suppressedBy: 'repel' }
  }

  return {
    encounter: {
      ...cloneSlot(slot),
      areaId: areaSet.areas[areaSlotValue].areaId,
      areaSlot: areaSlotValue,
      method,
      time,
      slotIndex,
    },
  }
}

/** Signature utilisée par le hook journalier natif : les cinq méthodes au matin. */
export function createHgssSafariMorningEncounterSignature(
  catalog: HgssSafariEncounterCatalog,
  areaSet: HgssSafariAreaSet,
  areaSlot: HgssSafariAreaSlot,
): string {
  return signatureMethods.flatMap((method) => (
    resolveHgssSafariEncounterSlots(catalog, areaSet, areaSlot, method, 'morning')
      .map((slot) => `${slot.speciesId}:${slot.level}`)
  )).join('|')
}
