import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import type { HgssEncounterSlot, HgssLandEncounterSlot, HgssWildEncounterData } from '../../rom/encounters/wildEncounterData'
import type { PlayerDirection } from '../../ndsTypes'
import { isHgssNighttime, resolveHgssTimeOfDayByHour, resolveHgssWildTimeOfDay } from '../time/hgssRtc'
import type { PreparedHgssSafariEncounter } from '../safari/hgssSafariEncounters'
import { applyHgssLandOrSurfEncounterRateModifiers, type HgssEncounterRateContext } from './hgssEncounterRateModifiers'
import { isHgssMassOutbreakActiveForMap, type HgssMassOutbreakContext } from './hgssMassOutbreak'

const tileBehaviorMask = 0xff
const encounterTileBehaviors = new Set([2, 3, 5, 8, 11, 16, 18, 21, 37, 42, 114, 119, 123, 166, 167])
const surfableEncounterTileBehaviors = new Set([16, 18, 21, 42])

export type WildEncounterTerrain = 'none' | 'land' | 'surfing'
export type EncounterMovementMode = 'walking' | 'running' | 'cycling' | 'surfing'
export type EncounterRadioEffect = 'none' | 'march' | 'lullaby' | 'hoenn' | 'sinnoh'
export type HgssFishingRod = 'oldRod' | 'goodRod' | 'superRod'

export type HgssLandOrSurfEncounterLead = {
  abilityId: number
  isEgg: boolean
  level: number
}

export type HgssLandOrSurfEncounterGenerationContext = {
  mapId: number
  lead?: HgssLandOrSurfEncounterLead
  resolveSpeciesTypes?: (speciesId: number) => readonly number[] | undefined
  radioEffect?: EncounterRadioEffect
  massOutbreak?: HgssMassOutbreakContext
  /** Neutralise Regard Vif/Intimidation, sans neutraliser les autres talents. */
  isSweetScent?: boolean
}

export type WildEncounterRateRoll = {
  triggered: boolean
  modifiedRate: number
  firstRoll: number
  secondRoll?: number
}

export type PreparedLandWildEncounter = HgssLandEncounterSlot & {
  bankId: number
  slotIndex: number
  method: 'land'
  time: 'morning' | 'day' | 'night'
}

export type PreparedSurfWildEncounter = HgssEncounterSlot & {
  bankId: number
  slotIndex: number
  method: 'surfing'
  level: number
}

export type PreparedFishingWildEncounter = HgssEncounterSlot & {
  bankId: number
  slotIndex: number
  method: 'fishing'
  rod: HgssFishingRod
  level: number
}

export type PreparedRoamerEncounter = {
  bankId: number
  slotIndex: number
  method: 'roamer'
  speciesId: number
  level: number
  roamerId: number
}

export type PreparedSafariWildEncounter = Omit<PreparedHgssSafariEncounter, 'method'> & {
  method: 'safari'
  safariMethod: PreparedHgssSafariEncounter['method']
}

export type PreparedWildEncounter = PreparedLandWildEncounter | PreparedSurfWildEncounter | PreparedFishingWildEncounter | PreparedRoamerEncounter | PreparedSafariWildEncounter

export type PreparedFieldWildEncounter = {
  encounter: PreparedWildEncounter
  rateRoll: WildEncounterRateRoll
}

export type HgssFieldEncounterSession = {
  checkStep: (step: {
    mapId: number
    bankId: number
    terrainAttribute: number | undefined
    direction: PlayerDirection
    movementMode?: EncounterMovementMode
    radioEffect?: EncounterRadioEffect
    /** Modificateurs natifs appliqués au taux terrestre/Surf avant les deux jets. */
    rateContext?: HgssEncounterRateContext
    /** Appelé après le jet de taux, avant tout tirage de slot sauvage, comme getRandomActiveRoamerInCurrMap. */
    prepareSpecialEncounter?: () => PreparedRoamerEncounter | undefined
    /** Substitution de table après le contrôle des roamers, utilisée par les contextes natifs comme le Safari. */
    prepareContextEncounter?: (method: 'land' | 'surf') => PreparedSafariWildEncounter | undefined
    /** Conserve le jet HGSS et les roamers, mais laisse les acteurs visibles remplacer le slot ordinaire. */
    suppressOrdinaryEncounter?: boolean
    generationContext?: Omit<HgssLandOrSurfEncounterGenerationContext, 'mapId' | 'radioEffect' | 'isSweetScent'>
    /** Niveau du premier Pokémon vivant seulement lorsque le Repousse est actif. */
    repelLeadLevel?: number
  }) => PreparedFieldWildEncounter | undefined
  /** Rencontre forcée de Doux Parfum/Miel: aucun jet de taux ni Repousse. */
  prepareForced: (request: {
    mapId: number
    bankId: number
    method: 'land' | 'surf'
    encounterRate: number
    prepareSpecialEncounter?: () => PreparedRoamerEncounter | undefined
    prepareContextEncounter?: (method: 'land' | 'surf') => PreparedSafariWildEncounter | undefined
    generationContext?: Omit<HgssLandOrSurfEncounterGenerationContext, 'mapId' | 'isSweetScent'>
  }) => PreparedFieldWildEncounter | undefined
  reset: (direction: PlayerDirection) => void
}

function randRange(rng: HgssLcrng, maximum: number): number {
  return rng.nextU16() % maximum
}

export function classifyWildEncounterTerrain(attribute: number | undefined): WildEncounterTerrain {
  if (attribute === undefined) return 'none'
  const behavior = attribute & tileBehaviorMask
  if (!encounterTileBehaviors.has(behavior)) return 'none'
  return surfableEncounterTileBehaviors.has(behavior) ? 'surfing' : 'land'
}

export function isVeryTallGrass(attribute: number | undefined): boolean {
  return attribute !== undefined && (attribute & tileBehaviorMask) === 3
}

export function selectHgssLandEncounterSlot(roll: number): number {
  if (!Number.isInteger(roll) || roll < 0 || roll >= 100) throw new Error(`Le tirage de slot terrestre ${roll} est invalide.`)
  if (roll < 20) return 0
  if (roll < 40) return 1
  if (roll < 50) return 2
  if (roll < 60) return 3
  if (roll < 70) return 4
  if (roll < 80) return 5
  if (roll < 85) return 6
  if (roll < 90) return 7
  if (roll < 94) return 8
  if (roll < 98) return 9
  return roll === 98 ? 10 : 11
}

export function rollHgssLandEncounterSlot(rng: HgssLcrng): number {
  return selectHgssLandEncounterSlot(randRange(rng, 100))
}

export function selectHgssSurfEncounterSlot(roll: number): number {
  if (!Number.isInteger(roll) || roll < 0 || roll >= 100) throw new Error(`Le tirage de slot Surf ${roll} est invalide.`)
  if (roll < 60) return 0
  if (roll < 90) return 1
  if (roll < 95) return 2
  if (roll < 99) return 3
  return 4
}

export function rollHgssEncounterLevel(slot: HgssEncounterSlot, rng: HgssLcrng): number {
  const minimum = Math.min(slot.minLevel, slot.maxLevel)
  const maximum = Math.max(slot.minLevel, slot.maxLevel)
  return minimum + randRange(rng, maximum - minimum + 1)
}

export function selectHgssFishingEncounterSlot(roll: number): number {
  if (!Number.isInteger(roll) || roll < 0 || roll >= 100) throw new Error(`Le tirage de pêche ${roll} est invalide.`)
  if (roll < 40) return 0
  if (roll < 70) return 1
  if (roll < 85) return 2
  if (roll < 95) return 3
  return 4
}

/** Probabilité native que l'indicateur de touche suive le Pokémon compagnon. */
export function getHgssFollowerFishingReactionChance(friendship: number): number {
  if (!Number.isInteger(friendship) || friendship < 0 || friendship > 0xff) {
    throw new Error(`L’amitié de pêche HGSS ${friendship} est invalide.`)
  }
  if (friendship <= 99) return 0
  if (friendship <= 149) return 20
  if (friendship <= 199) return 30
  if (friendship <= 249) return 40
  return 50
}

export type HgssFishingLead = {
  abilityId: number
  isEgg: boolean
  level: number
}

export type HgssFishingSpeciesTypeResolver = (speciesId: number) => readonly number[] | undefined

/**
 * Sticky Hold (60) et Suction Cups (21) doublent le taux. La routine native
 * ne borne pas le taux quand le meneur est un œuf ; sinon elle le borne à 100,
 * même lorsqu'aucun des deux talents de pêche n'est actif.
 */
export function applyHgssFishingLeadAbilityRate(encounterRate: number, lead?: HgssFishingLead): number {
  if (!Number.isInteger(encounterRate) || encounterRate < 0 || encounterRate > 0xff) {
    throw new Error(`Le taux de pêche HGSS ${encounterRate} est invalide.`)
  }
  if (lead?.isEgg) return encounterRate
  const modified = lead?.abilityId === 21 || lead?.abilityId === 60
    ? encounterRate * 2
    : encounterRate
  return Math.min(100, modified)
}

/** Port de FieldSystem_GetFishingEncounterRate puis ApplyAbilityEffectToEncounterRate. */
export function resolveHgssFishingEncounterRate(
  baseRate: number,
  followerFriendship?: number,
  lead?: HgssFishingLead,
): number {
  if (!Number.isInteger(baseRate) || baseRate < 0 || baseRate > 0xff) {
    throw new Error(`Le taux de pêche HGSS ${baseRate} est invalide.`)
  }
  if (baseRate === 0) return 0
  const followerBonus = followerFriendship === undefined
    ? 0
    : getHgssFollowerFishingReactionChance(followerFriendship)
  // `ret` est un u8 dans la ROM : l'addition est donc rabattue avant que le
  // talent du meneur ne soit appliqué.
  return applyHgssFishingLeadAbilityRate((baseRate + followerBonus) & 0xff, lead)
}

function requireHgssFishingLead(lead: HgssFishingLead): void {
  if (!Number.isInteger(lead.abilityId) || lead.abilityId < 0 || lead.abilityId > 0xff
    || !Number.isInteger(lead.level) || lead.level < 1 || lead.level > 100) {
    throw new Error(`Le meneur de pêche HGSS (talent ${lead.abilityId}, niveau ${lead.level}) est invalide.`)
  }
}

function chooseHgssFishingEncounterSlotWithLead(
  slots: readonly HgssEncounterSlot[],
  rng: HgssLcrng,
  lead?: HgssFishingLead,
  resolveSpeciesTypes?: HgssFishingSpeciesTypeResolver,
): number {
  if (!lead) return selectHgssFishingEncounterSlot(randRange(rng, 100))
  requireHgssFishingLead(lead)
  const influencedType = !lead.isEgg && lead.abilityId === 42
    ? 8 // Acier, Magnépiège
    : !lead.isEgg && lead.abilityId === 9
      ? 13 // Électrik, Statik
      : undefined
  if (influencedType !== undefined && randRange(rng, 2) === 0) {
    if (!resolveSpeciesTypes) throw new Error('Les types ROM requis par le talent du meneur de pêche HGSS sont absents.')
    const matching = slots.flatMap((slot, index) => {
      const types = resolveSpeciesTypes(slot.speciesId)
      if (!types) throw new Error(`Les types ROM de l'espèce pêchée ${slot.speciesId} sont absents.`)
      return types.includes(influencedType) ? [index] : []
    })
    // chooseAbilityCoercedSlot refuse une table vide ou entièrement du type.
    if (matching.length > 0 && matching.length < slots.length) return matching[randRange(rng, matching.length)]!
  }
  return selectHgssFishingEncounterSlot(randRange(rng, 100))
}

function rollHgssFishingEncounterLevel(slot: HgssEncounterSlot, rng: HgssLcrng, lead?: HgssFishingLead): number {
  const level = rollHgssEncounterLevel(slot, rng)
  if (!lead) return level
  requireHgssFishingLead(lead)
  if (!lead.isEgg && (lead.abilityId === 46 || lead.abilityId === 55 || lead.abilityId === 72)
    && randRange(rng, 2) !== 0) {
    return Math.max(slot.minLevel, slot.maxLevel)
  }
  return level
}

function doesHgssFishingLeadSuppressEncounter(level: number, rng: HgssLcrng, lead?: HgssFishingLead): boolean {
  if (!lead) return false
  requireHgssFishingLead(lead)
  return !lead.isEgg
    && (lead.abilityId === 22 || lead.abilityId === 51)
    && lead.level > 5
    && level <= lead.level - 5
    && randRange(rng, 2) === 0
}

/** Reproduit FieldSystem_PerformFishEncounterCheck et ses remplacements de slots. */
export function prepareHgssFishingWildEncounter(
  encounters: HgssWildEncounterData,
  rod: HgssFishingRod,
  hour: number,
  rng: HgssLcrng,
  fishingSwarmActiveForMap = false,
  prepareContextEncounter?: (rod: HgssFishingRod) => PreparedSafariWildEncounter | undefined,
  lead?: HgssFishingLead,
  /** Amitié du premier Pokémon vivant, uniquement si FollowMon_IsActive. */
  followerFriendship?: number,
  resolveSpeciesTypes?: HgssFishingSpeciesTypeResolver,
): PreparedFieldWildEncounter | undefined {
  const baseRate = encounters.rates[rod]
  if (baseRate <= 0) return undefined
  const encounterRate = resolveHgssFishingEncounterRate(baseRate, followerFriendship, lead)
  const firstRoll = randRange(rng, 100)
  if (firstRoll >= encounterRate) return undefined
  if (prepareContextEncounter) {
    const encounter = prepareContextEncounter(rod)
    return encounter ? { rateRoll: { triggered: true, modifiedRate: encounterRate, firstRoll }, encounter } : undefined
  }
  const slots = encounters[rod].map((slot) => ({ ...slot }))
  const night = isHgssNighttime(resolveHgssTimeOfDayByHour(hour))
  if (night && rod === 'goodRod' && slots[3]) slots[3].speciesId = encounters.swarm.nightFishingSpeciesId
  else if (night && rod === 'superRod' && slots[1]) slots[1].speciesId = encounters.swarm.nightFishingSpeciesId
  if (fishingSwarmActiveForMap) {
    const replaced = rod === 'oldRod' ? [2] : rod === 'goodRod' ? [0, 2, 3] : [0, 1, 2, 3, 4]
    for (const index of replaced) if (slots[index]) slots[index].speciesId = encounters.swarm.fishingSpeciesId
  }
  const slotIndex = chooseHgssFishingEncounterSlotWithLead(slots, rng, lead, resolveSpeciesTypes)
  const slot = slots[slotIndex]
  if (!slot) throw new Error(`Le slot de pêche ROM ${slotIndex} de la banque ${encounters.bankId} est absent.`)
  const level = rollHgssFishingEncounterLevel(slot, rng, lead)
  if (doesHgssFishingLeadSuppressEncounter(level, rng, lead)) return undefined
  return {
    rateRoll: { triggered: true, modifiedRate: encounterRate, firstRoll },
    encounter: {
      bankId: encounters.bankId,
      slotIndex,
      method: 'fishing',
      rod,
      ...slot,
      level,
    },
  }
}

export function prepareHgssSurfWildEncounter(
  encounters: HgssWildEncounterData,
  rng: HgssLcrng,
): PreparedSurfWildEncounter {
  const slotIndex = selectHgssSurfEncounterSlot(randRange(rng, 100))
  const slot = encounters.surfing[slotIndex]
  if (!slot) throw new Error(`Le slot Surf ROM ${slotIndex} de la banque ${encounters.bankId} est absent.`)
  return {
    bankId: encounters.bankId,
    slotIndex,
    method: 'surfing',
    ...slot,
    level: rollHgssEncounterLevel(slot, rng),
  }
}

export function getHgssLandEncounterTime(hour: number): PreparedLandWildEncounter['time'] {
  return ['morning', 'day', 'night'][resolveHgssWildTimeOfDay(resolveHgssTimeOfDayByHour(hour))] as PreparedLandWildEncounter['time']
}

export function prepareHgssLandWildEncounter(
  encounters: HgssWildEncounterData,
  hour: number,
  rng: HgssLcrng,
): PreparedLandWildEncounter {
  const time = getHgssLandEncounterTime(hour)
  const slotIndex = rollHgssLandEncounterSlot(rng)
  const slot = encounters.land[time][slotIndex]
  if (!slot) throw new Error(`Le slot terrestre ROM ${slotIndex} de la banque ${encounters.bankId} est absent.`)
  return { bankId: encounters.bankId, slotIndex, method: 'land', time, ...slot }
}

type HgssLandOrSurfSlot = {
  speciesId: number
  level: number
}

function chooseHgssLandOrSurfSlotWithLead(
  slots: readonly HgssLandOrSurfSlot[],
  rng: HgssLcrng,
  fallback: () => number,
  context: HgssLandOrSurfEncounterGenerationContext,
): number {
  const { lead } = context
  const influencedType = lead && !lead.isEgg && lead.abilityId === 42
    ? 8
    : lead && !lead.isEgg && lead.abilityId === 9
      ? 13
      : undefined
  if (influencedType !== undefined && randRange(rng, 2) === 0) {
    if (!context.resolveSpeciesTypes) throw new Error('Les types ROM requis par le talent du meneur HGSS sont absents.')
    const matching = slots.flatMap((slot, index) => {
      const types = context.resolveSpeciesTypes?.(slot.speciesId)
      if (!types) throw new Error(`Les types ROM de l’espèce sauvage ${slot.speciesId} sont absents.`)
      return types.includes(influencedType) ? [index] : []
    })
    // `chooseAbilityCoercedSlot` refuse les tables vides et entièrement du même type.
    if (matching.length > 0 && matching.length < slots.length) return matching[randRange(rng, matching.length)]!
  }
  return fallback()
}

function suppressesHgssLandOrSurfEncounter(
  level: number,
  rng: HgssLcrng,
  context: HgssLandOrSurfEncounterGenerationContext,
): boolean {
  const { lead } = context
  return !context.isSweetScent
    && Boolean(lead && !lead.isEgg && (lead.abilityId === 22 || lead.abilityId === 51)
      && lead.level > 5 && level <= lead.level - 5 && randRange(rng, 2) === 0)
}

function resolveHgssLandSlots(
  encounters: HgssWildEncounterData,
  hour: number,
  context: HgssLandOrSurfEncounterGenerationContext,
): { time: PreparedLandWildEncounter['time'], slots: HgssLandOrSurfSlot[] } {
  const time = getHgssLandEncounterTime(hour)
  const slots = encounters.land[time].map((slot) => ({ ...slot }))
  if (isHgssMassOutbreakActiveForMap(context.massOutbreak, context.mapId, 'land')) {
    if (slots[0]) slots[0].speciesId = encounters.swarm.landSpeciesId
    if (slots[1]) slots[1].speciesId = encounters.swarm.landSpeciesId
  }
  const soundSpecies = context.radioEffect === 'hoenn'
    ? encounters.hoennSoundSpecies
    : context.radioEffect === 'sinnoh'
      ? encounters.sinnohSoundSpecies
      : undefined
  if (soundSpecies) {
    if (slots[2]) slots[2].speciesId = soundSpecies[0]
    if (slots[3]) slots[3].speciesId = soundSpecies[0]
    if (slots[4]) slots[4].speciesId = soundSpecies[1]
    if (slots[5]) slots[5].speciesId = soundSpecies[1]
  }
  return { time, slots }
}

/** Génération commune exacte après le jet de taux, partagée par les pas et Doux Parfum. */
export function prepareHgssLandOrSurfWildEncounter(
  encounters: HgssWildEncounterData,
  method: 'land' | 'surf',
  hour: number,
  rng: HgssLcrng,
  context: HgssLandOrSurfEncounterGenerationContext,
): PreparedLandWildEncounter | PreparedSurfWildEncounter | undefined {
  const leadHasHighLevelAbility = Boolean(context.lead && !context.lead.isEgg
    && (context.lead.abilityId === 46 || context.lead.abilityId === 55 || context.lead.abilityId === 72))
  if (method === 'land') {
    const { time, slots } = resolveHgssLandSlots(encounters, hour, context)
    let slotIndex = chooseHgssLandOrSurfSlotWithLead(slots, rng, () => rollHgssLandEncounterSlot(rng), context)
    if (leadHasHighLevelAbility && randRange(rng, 2) !== 0) {
      const speciesId = slots[slotIndex]!.speciesId
      for (let index = 0; index < slots.length; index += 1) {
        if (slots[index]!.speciesId === speciesId && slots[index]!.level > slots[slotIndex]!.level) slotIndex = index
      }
    }
    const slot = slots[slotIndex]
    if (!slot) throw new Error(`Le slot terrestre ROM ${slotIndex} de la banque ${encounters.bankId} est absent.`)
    if (suppressesHgssLandOrSurfEncounter(slot.level, rng, context)) return undefined
    return { bankId: encounters.bankId, slotIndex, method: 'land', time, ...slot }
  }

  const slots = encounters.surfing.map((slot) => ({ ...slot }))
  if (isHgssMassOutbreakActiveForMap(context.massOutbreak, context.mapId, 'surf') && slots[0]) {
    slots[0].speciesId = encounters.swarm.surfingSpeciesId
  }
  const coercedSlots = slots.map((slot) => ({ speciesId: slot.speciesId, level: Math.max(slot.minLevel, slot.maxLevel) }))
  const slotIndex = chooseHgssLandOrSurfSlotWithLead(coercedSlots, rng, () => selectHgssSurfEncounterSlot(randRange(rng, 100)), context)
  const slot = slots[slotIndex]
  if (!slot) throw new Error(`Le slot Surf ROM ${slotIndex} de la banque ${encounters.bankId} est absent.`)
  const rolledLevel = rollHgssEncounterLevel(slot, rng)
  const level = leadHasHighLevelAbility && randRange(rng, 2) !== 0
    ? Math.max(slot.minLevel, slot.maxLevel)
    : rolledLevel
  if (suppressesHgssLandOrSurfEncounter(level, rng, context)) return undefined
  return { bankId: encounters.bankId, slotIndex, method: 'surfing', ...slot, level }
}

export function getHgssStepEncounterRateBoost(stepCount: number): number {
  if (!Number.isInteger(stepCount) || stepCount < 0 || stepCount > 0xffff) {
    throw new Error(`Le compteur de pas de rencontre ${stepCount} est invalide.`)
  }
  if (stepCount >= 4) return 60
  if (stepCount >= 3) return 40
  if (stepCount >= 2) return 30
  return 0
}

export function rollHgssWildEncounterRate(
  rng: HgssLcrng,
  encounterRate: number,
  movementMode: EncounterMovementMode,
  stepCount: number,
  veryTallGrass: boolean,
  radioEffect: EncounterRadioEffect = 'none',
): WildEncounterRateRoll {
  if (!Number.isInteger(encounterRate) || encounterRate < 0) throw new Error(`Le taux de rencontre ${encounterRate} est invalide.`)
  const nativeRate = Math.min(encounterRate, 100)
  let modifiedRate = movementMode === 'walking' ? 20 : 40
  if (veryTallGrass) modifiedRate += 40
  else if (movementMode === 'cycling') modifiedRate += 30
  modifiedRate += getHgssStepEncounterRateBoost(stepCount)
  if (radioEffect === 'march') modifiedRate += 25
  else if (radioEffect === 'lullaby') modifiedRate -= 25
  modifiedRate &= 0xff
  if (modifiedRate > 100) modifiedRate = 100

  const firstRoll = randRange(rng, 100)
  if (firstRoll >= modifiedRate) return { triggered: false, modifiedRate, firstRoll }
  const secondRoll = randRange(rng, 100)
  return { triggered: secondRoll < nativeRate, modifiedRate, firstRoll, secondRoll }
}

export function createHgssFieldEncounterSession(
  catalog: readonly HgssWildEncounterData[],
  rng: HgssLcrng,
  now: () => Date,
  initialDirection: PlayerDirection,
): HgssFieldEncounterSession {
  let encounterInhibitSteps = 0
  let reverseTurnFrameSteps = 0
  let lastDirection = initialDirection

  return {
    checkStep(step) {
      encounterInhibitSteps = Math.min(encounterInhibitSteps + 1, 0xffff)
      const terrain = classifyWildEncounterTerrain(step.terrainAttribute)
      const encounterMethod = terrain === 'land'
        ? 'land'
        : terrain === 'surfing' && step.movementMode === 'surfing'
          ? 'surfing'
          : undefined
      if (encounterInhibitSteps <= 3 || !encounterMethod || step.bankId === 0xff) return undefined
      const encounters = catalog[step.bankId]
      if (!encounters) throw new Error(`La banque ROM de rencontres ${step.bankId} de la carte ${step.mapId} est absente.`)
      const baseEncounterRate = encounterMethod === 'land' ? encounters.rates.walking : encounters.rates.surfing
      if (baseEncounterRate === 0) return undefined
      const encounterRate = step.rateContext
        ? applyHgssLandOrSurfEncounterRateModifiers(baseEncounterRate, step.rateContext)
        : baseEncounterRate
      const oppositeDirections: Partial<Record<PlayerDirection, PlayerDirection>> = {
        north: 'south',
        south: 'north',
        west: 'east',
        east: 'west',
      }
      if (oppositeDirections[step.direction] === lastDirection) reverseTurnFrameSteps = Math.min(reverseTurnFrameSteps + 1, 0xffff)
      lastDirection = step.direction
      const rateRoll = rollHgssWildEncounterRate(
        rng,
        encounterRate,
        step.movementMode ?? 'walking',
        reverseTurnFrameSteps,
        encounterMethod === 'land' && isVeryTallGrass(step.terrainAttribute),
        step.radioEffect,
      )
      if (!rateRoll.triggered) return undefined
      const specialEncounter = step.prepareSpecialEncounter?.()
      // La ROM retourne directement du chemin roamer : ces deux compteurs ne
      // sont remis à zéro que par une rencontre sauvage non-roamer réussie.
      if (specialEncounter) {
        return step.repelLeadLevel !== undefined && step.repelLeadLevel > specialEncounter.level
          ? undefined
          : { encounter: specialEncounter, rateRoll }
      }
      if (step.suppressOrdinaryEncounter) return undefined
      let encounter: PreparedWildEncounter | undefined
      if (step.prepareContextEncounter) {
        encounter = step.prepareContextEncounter(encounterMethod === 'land' ? 'land' : 'surf')
        // Une suppression Talent/Repousse intervient après le jet de taux et ne
        // doit jamais retomber sur la table sauvage ordinaire de la carte.
        if (!encounter) return undefined
      }
      encounter ??= prepareHgssLandOrSurfWildEncounter(
        encounters,
        encounterMethod === 'land' ? 'land' : 'surf',
        now().getHours(),
        rng,
        {
          mapId: step.mapId,
          ...step.generationContext,
          radioEffect: step.radioEffect,
        },
      )
      if (!encounter) return undefined
      if (step.repelLeadLevel !== undefined && step.repelLeadLevel > encounter.level) return undefined
      encounterInhibitSteps = 0
      reverseTurnFrameSteps = 0
      return { encounter, rateRoll }
    },
    prepareForced(request) {
      if (request.bankId === 0xff) return undefined
      const encounters = catalog[request.bankId]
      if (!encounters) throw new Error(`La banque ROM de rencontres ${request.bankId} de la carte ${request.mapId} est absente.`)
      const rateRoll: WildEncounterRateRoll = {
        triggered: true,
        modifiedRate: request.encounterRate,
        firstRoll: 0,
      }
      const specialEncounter = request.prepareSpecialEncounter?.()
      if (specialEncounter) return { encounter: specialEncounter, rateRoll }
      let encounter: PreparedWildEncounter | undefined
      if (request.prepareContextEncounter) {
        encounter = request.prepareContextEncounter(request.method)
        if (!encounter) return undefined
      } else {
        encounter = prepareHgssLandOrSurfWildEncounter(
          encounters,
          request.method,
          now().getHours(),
          rng,
          { mapId: request.mapId, ...request.generationContext, isSweetScent: true },
        )
      }
      if (!encounter) return undefined
      encounterInhibitSteps = 0
      reverseTurnFrameSteps = 0
      return { encounter, rateRoll }
    },
    reset(direction) {
      encounterInhibitSteps = 0
      reverseTurnFrameSteps = 0
      lastDirection = direction
    },
  }
}
