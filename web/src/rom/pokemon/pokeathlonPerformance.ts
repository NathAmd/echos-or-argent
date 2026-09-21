import type { RomFile } from '../../ndsTypes'
import { readArm9FromRom } from '../maps/mapHeaders'

export const hgssPokeathlonPerformanceSize = 20
export const hgssPokeathlonPerformanceMemberCount = 554
export const hgssPokeathlonSpeciesCount = 494

export type HgssPokeathlonStat = 'power' | 'skill' | 'speed' | 'jump' | 'stamina'
export type HgssPokeathlonStatClass = 1 | 2 | 3 | 4 | 5
export type HgssPokeathlonModifiers = readonly [number, number, number, number, number]

export type HgssPokeathlonBasePerformanceStat = Readonly<{
  base: number
  minimum: number
  maximum: number
}>

export type HgssPokeathlonBasePerformance = Readonly<{
  memberIndex: number
  stats: Readonly<Record<HgssPokeathlonStat, HgssPokeathlonBasePerformanceStat>>
}>

export type HgssPokeathlonPerformanceCatalog = Readonly<{
  performances: readonly HgssPokeathlonBasePerformance[]
  memberIndexBySpecies: readonly number[]
}>

export type HgssPokeathlonStars = Readonly<Record<HgssPokeathlonStat, number>>

const statOrder = ['power', 'skill', 'speed', 'jump', 'stamina'] as const
const archiveStatIndexes: Readonly<Record<HgssPokeathlonStat, number>> = Object.freeze({
  power: 0,
  stamina: 1,
  jump: 2,
  skill: 3,
  speed: 4,
})
const memberIndexSignature = [0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] as const
const memberIndexAnchors = [
  [172, 171], [173, 173], [201, 201], [202, 229], [386, 413], [387, 417],
  [412, 442], [413, 445], [414, 448], [423, 458], [424, 460], [480, 521],
  [488, 530], [493, 536],
] as const

// Ordre PERFORMANCE_* du moteur : Power, Skill, Speed, Jump, Stamina.
const natureModifiers: readonly HgssPokeathlonModifiers[] = Object.freeze([
  [10, 0, 0, 0, -10], [35, -35, 0, 0, 0], [35, 0, 0, 0, -35], [35, 0, 0, -35, 0], [35, 0, -35, 0, 0],
  [-35, 35, 0, 0, 0], [0, 10, 0, -10, 0], [0, 35, 0, 0, -35], [0, 35, 0, -35, 0], [0, 35, -35, 0, 0],
  [-35, 0, 0, 0, 35], [0, -35, 0, 0, 35], [0, 0, -10, 0, 10], [0, 0, 0, -35, 35], [0, 0, -35, 0, 35],
  [-35, 0, 0, 35, 0], [0, -35, 0, 35, 0], [0, 0, 0, 35, -35], [-10, 0, 0, 10, 0], [0, 0, -35, 35, 0],
  [-35, 0, 35, 0, 0], [0, -35, 35, 0, 0], [0, 0, 35, 0, -35], [0, 0, 35, -35, 0], [0, -10, 10, 0, 0],
])

function requireMemberPayload(rom: Uint8Array, archive: RomFile, memberIndex: number): Uint8Array {
  const member = archive.archiveMembers[memberIndex]
  if (!member || member.index !== memberIndex) {
    throw new Error(`Le membre Pokéathlon HGSS ${memberIndex} est absent ou non contigu.`)
  }
  if (member.offset < 0 || member.size < 0 || member.offset + member.size > rom.byteLength) {
    throw new Error(`Le membre Pokéathlon HGSS ${memberIndex} dépasse les limites de la ROM.`)
  }
  return rom.subarray(member.offset, member.offset + member.size)
}

export function decodeHgssPokeathlonBasePerformance(
  payload: Uint8Array,
  memberIndex: number,
): HgssPokeathlonBasePerformance {
  if (!Number.isInteger(memberIndex) || memberIndex < 0) {
    throw new Error(`L’index de performance Pokéathlon HGSS ${memberIndex} est invalide.`)
  }
  if (payload.byteLength !== hgssPokeathlonPerformanceSize) {
    throw new Error(`La performance Pokéathlon HGSS ${memberIndex} mesure ${payload.byteLength} octets au lieu de ${hgssPokeathlonPerformanceSize}.`)
  }
  const stats = Object.fromEntries(statOrder.map((stat) => {
    const archiveIndex = archiveStatIndexes[stat]
    const minimum = payload[9 + archiveIndex * 2]!
    const maximum = payload[10 + archiveIndex * 2]!
    const base = payload[archiveIndex]!
    if (minimum > base || base > maximum || maximum > 5) {
      throw new Error(`La statistique ${stat} de la performance Pokéathlon HGSS ${memberIndex} est incohérente (${minimum}/${base}/${maximum}).`)
    }
    return [stat, Object.freeze({ base, minimum, maximum })]
  })) as Record<HgssPokeathlonStat, HgssPokeathlonBasePerformanceStat>
  return Object.freeze({ memberIndex, stats: Object.freeze(stats) })
}

export function locateHgssPokeathlonMemberIndexTable(arm9: Uint8Array, memberCount: number): number {
  if (!Number.isInteger(memberCount) || memberCount < hgssPokeathlonPerformanceMemberCount) {
    throw new Error(`L’archive Pokéathlon HGSS contient ${memberCount} membres; ${hgssPokeathlonPerformanceMemberCount} minimum attendus.`)
  }
  const tableSize = hgssPokeathlonSpeciesCount * 2
  const matches: number[] = []
  for (let offset = 0; offset + tableSize <= arm9.byteLength; offset += 2) {
    const view = new DataView(arm9.buffer, arm9.byteOffset + offset, tableSize)
    if (!memberIndexSignature.every((value, index) => view.getUint16(index * 2, true) === value)) continue
    if (!memberIndexAnchors.every(([speciesId, value]) => view.getUint16(speciesId * 2, true) === value)) continue
    const indexes = Array.from({ length: hgssPokeathlonSpeciesCount }, (_, speciesId) => view.getUint16(speciesId * 2, true))
    if (indexes.some((memberIndex) => memberIndex >= memberCount)) continue
    if (indexes.slice(1).some((memberIndex, index) => memberIndex < indexes[index]!)) continue
    matches.push(offset)
  }
  if (matches.length !== 1) {
    throw new Error(`La table ARM9 des performances Pokéathlon HGSS doit être unique; ${matches.length} candidate(s) trouvée(s).`)
  }
  return matches[0]!
}

export function decodeHgssPokeathlonMemberIndexes(
  arm9: Uint8Array,
  memberCount: number,
  tableOffset = locateHgssPokeathlonMemberIndexTable(arm9, memberCount),
): number[] {
  const tableSize = hgssPokeathlonSpeciesCount * 2
  if (!Number.isInteger(tableOffset) || tableOffset < 0 || tableOffset + tableSize > arm9.byteLength) {
    throw new Error(`L’offset ${tableOffset} de la table Pokéathlon HGSS est invalide.`)
  }
  const view = new DataView(arm9.buffer, arm9.byteOffset + tableOffset, tableSize)
  return Array.from({ length: hgssPokeathlonSpeciesCount }, (_, speciesId) => view.getUint16(speciesId * 2, true))
}

export function decodeHgssPokeathlonPerformanceCatalog(
  rom: Uint8Array,
  archive: RomFile,
): HgssPokeathlonPerformanceCatalog {
  if (archive.archiveMembers.length < hgssPokeathlonPerformanceMemberCount) {
    throw new Error(`L’archive Pokéathlon HGSS contient ${archive.archiveMembers.length} membres; ${hgssPokeathlonPerformanceMemberCount} minimum attendus.`)
  }
  const performances = archive.archiveMembers.map((_, memberIndex) => (
    decodeHgssPokeathlonBasePerformance(requireMemberPayload(rom, archive, memberIndex), memberIndex)
  ))
  return Object.freeze({
    performances: Object.freeze(performances),
    memberIndexBySpecies: Object.freeze(decodeHgssPokeathlonMemberIndexes(readArm9FromRom(rom), performances.length)),
  })
}

export function resolveHgssPokeathlonBasePerformance(
  catalog: HgssPokeathlonPerformanceCatalog,
  speciesId: number,
  form: number,
): HgssPokeathlonBasePerformance {
  if (!Number.isInteger(speciesId) || speciesId < 0 || speciesId >= hgssPokeathlonSpeciesCount) {
    throw new Error(`L’espèce Pokéathlon HGSS ${speciesId} est invalide.`)
  }
  if (!Number.isInteger(form) || form < 0) throw new Error(`La forme Pokéathlon HGSS ${form} est invalide.`)
  const baseIndex = catalog.memberIndexBySpecies[speciesId]
  const nextBaseIndex = baseIndex === undefined
    ? undefined
    : catalog.memberIndexBySpecies.slice(speciesId + 1).find((memberIndex) => memberIndex > baseIndex)
      ?? catalog.performances.length
  const performance = baseIndex === undefined || nextBaseIndex === undefined || baseIndex + form >= nextBaseIndex
    ? undefined
    : catalog.performances[baseIndex + form]
  if (!performance) {
    throw new Error(`La performance Pokéathlon HGSS de l’espèce ${speciesId}, forme ${form}, est absente.`)
  }
  return performance
}

function decimalDigit(value: number, digit: number): number {
  const divisor = 10 ** digit
  return Math.floor((value % (divisor * 10)) / divisor)
}

export function scoreHgssPokeathlonModifier(value: number): number {
  if (!Number.isInteger(value)) throw new Error(`Le score Pokéathlon HGSS ${value} est invalide.`)
  if (value <= -120) return -4
  if (value <= -80) return -3
  if (value <= -40) return -2
  if (value <= -15) return -1
  if (value <= 14) return 0
  if (value <= 39) return 1
  if (value <= 79) return 2
  if (value <= 119) return 3
  return 4
}

export function calculateHgssPokeathlonStars(
  performance: HgssPokeathlonBasePerformance,
  personality: number,
  nature: number,
  date: Date,
  aprijuice: HgssPokeathlonModifiers = [0, 0, 0, 0, 0],
): HgssPokeathlonStars {
  if (!Number.isInteger(personality) || personality < 0 || personality > 0xffffffff) {
    throw new Error(`La personnalité Pokéathlon HGSS ${personality} est invalide.`)
  }
  const modifiers = natureModifiers[nature]
  if (!modifiers) throw new Error(`La nature Pokéathlon HGSS ${nature} est invalide.`)
  if (Number.isNaN(date.getTime())) throw new Error('La date Pokéathlon HGSS est invalide.')
  if (aprijuice.length !== statOrder.length || aprijuice.some((value) => !Number.isInteger(value) || value < -128 || value > 127)) {
    throw new Error('Les modificateurs Aprijuice HGSS doivent contenir cinq octets signés.')
  }
  const day = date.getDate()
  const pid = personality >>> 0
  return Object.freeze(Object.fromEntries(statOrder.map((stat, index) => {
    const pidDigit = decimalDigit(pid, index)
    const dailyDigit = decimalDigit(pidDigit + (day + (7 - index)) * (day + (index + 3)), 0)
    const dailyModifier = modifiers[index]! + (2 * dailyDigit - 9)
    const base = performance.stats[stat]
    const stars = Math.max(base.minimum, Math.min(base.maximum, base.base + scoreHgssPokeathlonModifier(dailyModifier + aprijuice[index]!)))
    return [stat, stars]
  }))) as HgssPokeathlonStars
}

/**
 * Classe utilisée par FollowMonInteract. Les égalités conservent le premier
 * candidat natif : Power, Stamina, Jump, Skill, puis Speed.
 */
export function resolveHgssFollowerPokeathlonStatClass(stars: HgssPokeathlonStars): HgssPokeathlonStatClass {
  const candidates = [
    ['power', 1], ['stamina', 2], ['jump', 4], ['skill', 3], ['speed', 5],
  ] as const
  let selected: (typeof candidates)[number] = candidates[0]!
  for (const candidate of candidates.slice(1)) {
    if (stars[candidate[0]] > stars[selected[0]]) selected = candidate
  }
  return selected[1]
}
