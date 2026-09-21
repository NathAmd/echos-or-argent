import type { RomFile } from '../../ndsTypes'

export const hgssFollowerReactionRuleSize = 20
export const hgssFollowerSectionRuleCount = 30
export const hgssFollowerGlobalRuleCount = 70
export const hgssFollowerReactionSize = 52
export const hgssFollowerReactionStepSize = 8
export const hgssFollowerReactionStepCount = 5
export const hgssFollowerReactionMovementCount = 108
export const hgssFollowerReactionMovementSize = 80
export const hgssFollowerReactionMotionSegmentCount = 10
export const hgssFollowerReactionMotionSegmentSize = 8
export const hgssFollowerSpeciesCount = 493
export const hgssFollowerSpeciesReactionClassTableSize = 496

export type HgssFollowerReactionRule = {
  raw: readonly number[]
  conditionBits: number
  conditions: HgssFollowerReactionConditions
  reactionId: number
  probability: number
  requiredFlag: number
}

export type HgssFollowerReactionConditions = {
  hpClass: number
  moodRange: number
  friendshipRange: number
  natureClass: number
  genderClass: number
  statusClass: number
  heldItemClass: number
  typeClass: number
  pokeathlonStatClass: number
  terrainClass: number
  speciesReactionClass: number
  missingShinyLeaf: number
  weatherClass: number
  facingClass: number
  nearbyObjectCountClass: number
  timeOfDayClass: number
  mapIdPlusOne: number
  metatileBehavior: number
  levelClass: number
  reservedObjectCondition: number
  hiddenItemCountClass: number
}

export type HgssFollowerReactionStep = {
  movementId: number
  messageId: number
  soundId: number
  emoteId: number
  delay: number
}

export type HgssFollowerReactionEffects = {
  rawPrefix: readonly number[]
  friendshipDelta: number
  moodDelta: number
  fashionItemId: number
  shinyLeafIndex: number
}

export type HgssFollowerReaction = {
  reactionId: number
  steps: readonly HgssFollowerReactionStep[]
  terminated: boolean
  effects: HgssFollowerReactionEffects
}

export type HgssFollowerReactionMotionSegment = {
  facingDirection: number
  durationFrames: number
  offsetX: number
  heightAdjustment: number
  offsetZ: number
  triggerStepSound: boolean
  reserved: readonly [number, number]
}

export type HgssFollowerReactionMotion = {
  movementId: number
  segments: readonly HgssFollowerReactionMotionSegment[]
  terminated: boolean
}

export type HgssFollowerReactionMotionSample = {
  complete: boolean
  segmentIndex: number
  frameInSegment: number
  offsetX: number
  heightAdjustment: number
  offsetZ: number
  facingDirection: number | undefined
  triggerStepSound: boolean
}

export type HgssFollowerReactionCatalog = {
  globalRules: readonly HgssFollowerReactionRule[]
  sectionRules: readonly (readonly HgssFollowerReactionRule[])[]
  reactions: readonly HgssFollowerReaction[]
  movements: readonly HgssFollowerReactionMotion[]
  speciesReactionClasses: readonly number[]
  interactionMessages: Readonly<Record<number, string>>
  auxiliaryMessages: Readonly<Record<number, string>>
}

function readMember(rom: Uint8Array, archive: RomFile, memberIndex: number, expectedSize: number, label: string): Uint8Array {
  const member = archive.archiveMembers[memberIndex]
  if (!member) throw new Error(`Le membre ${memberIndex} de ${label} est absent.`)
  if (member.index !== memberIndex) throw new Error(`${label} n’est pas contiguë au membre ${member.index}.`)
  if (member.size !== expectedSize) {
    throw new Error(`Le membre ${memberIndex} de ${label} mesure ${member.size} octets au lieu de ${expectedSize}.`)
  }
  if (member.offset < 0 || member.offset + member.size > rom.byteLength) {
    throw new Error(`Le membre ${memberIndex} de ${label} dépasse les limites de la ROM.`)
  }
  return rom.subarray(member.offset, member.offset + member.size)
}

export function decodeHgssFollowerReactionRule(payload: Uint8Array): HgssFollowerReactionRule {
  if (payload.byteLength !== hgssFollowerReactionRuleSize) {
    throw new Error(`Une règle de réaction follower HGSS mesure ${payload.byteLength} octets au lieu de ${hgssFollowerReactionRuleSize}.`)
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  const packedReaction = view.getUint16(10, true)
  const reactionId = packedReaction >>> 6
  if (reactionId > 1023) throw new Error(`La réaction follower HGSS ${reactionId} est invalide.`)
  const probability = payload[17]!
  if (probability > 100) throw new Error(`La probabilité follower HGSS ${probability} dépasse 100.`)
  return {
    raw: [...payload],
    conditionBits: packedReaction & 0x3f,
    conditions: {
      hpClass: payload[0]!,
      moodRange: payload[1]! & 0x0f,
      friendshipRange: payload[1]! >>> 4,
      natureClass: payload[2]! & 0x07,
      genderClass: (payload[2]! >>> 3) & 0x03,
      statusClass: payload[2]! >>> 5,
      heldItemClass: payload[3]! & 0x1f,
      typeClass: payload[4]! & 0x1f,
      pokeathlonStatClass: payload[4]! >>> 5,
      terrainClass: payload[5]!,
      speciesReactionClass: payload[6]!,
      missingShinyLeaf: payload[7]!,
      weatherClass: view.getUint16(8, true) & 0x07,
      facingClass: view.getUint16(8, true) >>> 13,
      nearbyObjectCountClass: packedReaction & 0x07,
      timeOfDayClass: (packedReaction >>> 3) & 0x07,
      mapIdPlusOne: view.getUint16(12, true),
      metatileBehavior: view.getUint16(14, true),
      levelClass: (payload[16]! >>> 1) & 0x03,
      reservedObjectCondition: (payload[16]! >>> 3) & 0x03,
      hiddenItemCountClass: payload[16]! >>> 5,
    },
    reactionId,
    probability,
    requiredFlag: view.getUint16(18, true),
  }
}

function decodeRules(payload: Uint8Array): HgssFollowerReactionRule[] {
  if (payload.byteLength % hgssFollowerReactionRuleSize !== 0) {
    throw new Error(`Un groupe de règles follower HGSS mesure ${payload.byteLength} octets, non multiple de ${hgssFollowerReactionRuleSize}.`)
  }
  return Array.from({ length: payload.byteLength / hgssFollowerReactionRuleSize }, (_, index) => (
    decodeHgssFollowerReactionRule(payload.subarray(index * hgssFollowerReactionRuleSize, (index + 1) * hgssFollowerReactionRuleSize))
  ))
}

export function decodeHgssFollowerReaction(payload: Uint8Array, reactionId: number): HgssFollowerReaction {
  if (payload.byteLength !== hgssFollowerReactionSize) {
    throw new Error(`La réaction follower HGSS ${reactionId} mesure ${payload.byteLength} octets au lieu de ${hgssFollowerReactionSize}.`)
  }
  if (!Number.isInteger(reactionId) || reactionId < 1 || reactionId > 1023) {
    throw new Error(`L’identifiant de réaction follower HGSS ${reactionId} est invalide.`)
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  const steps: HgssFollowerReactionStep[] = []
  let terminated = false
  for (let index = 0; index < hgssFollowerReactionStepCount; index += 1) {
    const offset = index * hgssFollowerReactionStepSize
    const movementId = view.getUint16(offset, true)
    if (movementId === 0xffff) {
      terminated = true
      break
    }
    steps.push({
      movementId,
      messageId: view.getUint16(offset + 2, true),
      soundId: view.getUint16(offset + 4, true),
      emoteId: payload[offset + 6]!,
      delay: payload[offset + 7]!,
    })
  }
  return {
    reactionId,
    steps,
    terminated,
    effects: {
      rawPrefix: [...payload.subarray(40, 48)],
      friendshipDelta: view.getInt8(48),
      moodDelta: view.getInt8(49),
      fashionItemId: payload[50]!,
      shinyLeafIndex: payload[51]!,
    },
  }
}

export function decodeHgssFollowerReactionMotion(payload: Uint8Array, movementId: number): HgssFollowerReactionMotion {
  if (payload.byteLength !== hgssFollowerReactionMovementSize) {
    throw new Error(`Le mouvement de réaction follower HGSS ${movementId} mesure ${payload.byteLength} octets au lieu de ${hgssFollowerReactionMovementSize}.`)
  }
  if (!Number.isInteger(movementId) || movementId < 1 || movementId > hgssFollowerReactionMovementCount) {
    throw new Error(`L’identifiant de mouvement follower HGSS ${movementId} est invalide.`)
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  const segments: HgssFollowerReactionMotionSegment[] = []
  let terminated = false
  for (let index = 0; index < hgssFollowerReactionMotionSegmentCount; index += 1) {
    const offset = index * hgssFollowerReactionMotionSegmentSize
    const facingDirection = payload[offset]!
    if (facingDirection === 0xff) {
      terminated = true
      break
    }
    if (facingDirection > 4) {
      throw new Error(`Le mouvement follower HGSS ${movementId} contient la direction ${facingDirection}.`)
    }
    segments.push({
      facingDirection,
      durationFrames: payload[offset + 1]!,
      offsetX: view.getInt8(offset + 2),
      heightAdjustment: view.getInt8(offset + 3),
      offsetZ: view.getInt8(offset + 4),
      triggerStepSound: payload[offset + 5]! !== 0,
      reserved: [payload[offset + 6]!, payload[offset + 7]!],
    })
  }
  return { movementId, segments, terminated }
}

export function getHgssFollowerReactionMotionDuration(motion: HgssFollowerReactionMotion): number {
  return motion.segments.reduce((duration, segment) => duration + Math.max(1, segment.durationFrames), 0)
}

/**
 * Reproduit les updates VBlank de l'overlay : chaque segment applique une
 * translation relative une fois, puis la conserve au moins une frame. A la
 * fin, le moteur restaure la position et la direction sauvegardées.
 */
export function sampleHgssFollowerReactionMotion(
  motion: HgssFollowerReactionMotion,
  elapsedFrames: number,
): HgssFollowerReactionMotionSample {
  if (!Number.isInteger(elapsedFrames) || elapsedFrames < 0) {
    throw new Error(`La frame follower HGSS ${elapsedFrames} est invalide.`)
  }
  let remainingFrames = elapsedFrames
  let offsetX = 0
  let heightAdjustment = 0
  let offsetZ = 0
  let facingDirection: number | undefined
  for (let segmentIndex = 0; segmentIndex < motion.segments.length; segmentIndex += 1) {
    const segment = motion.segments[segmentIndex]!
    const durationFrames = Math.max(1, segment.durationFrames)
    offsetX += segment.offsetX
    heightAdjustment += segment.heightAdjustment
    offsetZ += segment.offsetZ
    if (segment.facingDirection !== 0) facingDirection = segment.facingDirection
    if (remainingFrames < durationFrames) {
      return {
        complete: false,
        segmentIndex,
        frameInSegment: remainingFrames,
        offsetX,
        heightAdjustment,
        offsetZ,
        facingDirection,
        triggerStepSound: remainingFrames === 0 && segment.triggerStepSound,
      }
    }
    remainingFrames -= durationFrames
  }
  return {
    complete: true,
    segmentIndex: motion.segments.length,
    frameInSegment: 0,
    offsetX: 0,
    heightAdjustment: 0,
    offsetZ: 0,
    facingDirection: undefined,
    triggerStepSound: false,
  }
}

export function decodeHgssFollowerReactionCatalog(
  rom: Uint8Array,
  ruleArchive: RomFile,
  reactionArchive: RomFile,
  movementArchive: RomFile,
  speciesClassArchive: RomFile,
  interactionMessages: Record<number, string> | undefined,
  auxiliaryMessages: Record<number, string> | undefined,
): HgssFollowerReactionCatalog {
  if (!interactionMessages || !auxiliaryMessages) {
    throw new Error('Les banques ROM HGSS 265/40 des réactions follower sont absentes ou invalides.')
  }
  if (ruleArchive.archiveMembers.length < 2) throw new Error("L’archive HGSS des règles follower ne contient aucune section de carte.")
  if (reactionArchive.archiveMembers.length !== 1023) {
    throw new Error(`L’archive HGSS des réactions follower contient ${reactionArchive.archiveMembers.length} membres au lieu de 1023.`)
  }
  if (movementArchive.archiveMembers.length !== hgssFollowerReactionMovementCount) {
    throw new Error(`L’archive HGSS des mouvements follower contient ${movementArchive.archiveMembers.length} membres au lieu de ${hgssFollowerReactionMovementCount}.`)
  }
  if (speciesClassArchive.archiveMembers.length !== 1) {
    throw new Error(`L’archive HGSS des classes d’espèces follower contient ${speciesClassArchive.archiveMembers.length} membres au lieu de 1.`)
  }
  const globalRules = decodeRules(readMember(
    rom,
    ruleArchive,
    0,
    hgssFollowerGlobalRuleCount * hgssFollowerReactionRuleSize,
    'l’archive HGSS des règles follower',
  ))
  const sectionRules = Array.from({ length: ruleArchive.archiveMembers.length - 1 }, (_, section) => decodeRules(readMember(
    rom,
    ruleArchive,
    section + 1,
    hgssFollowerSectionRuleCount * hgssFollowerReactionRuleSize,
    'l’archive HGSS des règles follower',
  )))
  const reactions = Array.from({ length: 1023 }, (_, index) => decodeHgssFollowerReaction(readMember(
    rom,
    reactionArchive,
    index,
    hgssFollowerReactionSize,
    'l’archive HGSS des réactions follower',
  ), index + 1))
  const movements = Array.from({ length: hgssFollowerReactionMovementCount }, (_, index) => decodeHgssFollowerReactionMotion(readMember(
    rom,
    movementArchive,
    index,
    hgssFollowerReactionMovementSize,
    'l’archive HGSS des mouvements follower',
  ), index + 1))
  const speciesReactionClasses = [...readMember(
    rom,
    speciesClassArchive,
    0,
    hgssFollowerSpeciesReactionClassTableSize,
    'l’archive HGSS des classes d’espèces follower',
  ).subarray(0, hgssFollowerSpeciesCount)]
  return { globalRules, sectionRules, reactions, movements, speciesReactionClasses, interactionMessages, auxiliaryMessages }
}

export function getHgssFollowerRuleOrder(catalog: HgssFollowerReactionCatalog, mapSection: number): readonly HgssFollowerReactionRule[] {
  const section = catalog.sectionRules[mapSection]
  if (!section) throw new Error(`La section de carte HGSS ${mapSection} n’a aucune règle follower.`)
  return [
    ...catalog.globalRules.slice(0, 12),
    ...section,
    ...catalog.globalRules.slice(12),
  ]
}
