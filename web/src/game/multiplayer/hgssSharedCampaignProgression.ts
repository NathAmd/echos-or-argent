import {
  cloneFieldScriptState,
  type FieldScriptState,
} from '../scripts/fieldScriptRunner'
import {
  isHgssFieldMapTemporaryVariable,
  isHgssFieldScriptTemporaryVariable,
} from '../scripts/fieldVariableLifecycle'
import type {
  HgssCampaignClientCommand,
  HgssCampaignSharedProgression,
} from './hgssCampaignProtocol'
import {
  hgssSharedCampaignFieldEventIdPrefix,
  parseHgssSharedCampaignFieldEventId,
} from './hgssSharedCampaignEventIdentity'

const schemaMilestone = 'field.schema.v1'
const eventPrefix = hgssSharedCampaignFieldEventIdPrefix
const branchPrefix = 'field.branch.'
const progressionRevisionCounter = 'field.progression-revision'
const flagPrefix = 'field.flag.'
const badgePrefix = 'field.badge.'
const trainerPrefix = 'field.trainer.'
const variablePrefix = 'field.variable.'
const maximumMilestones = 512
const maximumCounters = 256
const maximumEventMilestones = 32
const maximumEventCounters = 32
const maximumFieldIdentifier = 0xffff
const branchIdPattern = /^[0-9a-f]{32}$/

type CampaignEventIntent = Omit<
  Extract<HgssCampaignClientCommand, { kind: 'shared-event' }>,
  'protocolVersion' | 'commandId' | 'expectedRevision'
>

export class HgssSharedCampaignProgressionError extends Error {
  readonly code:
    | 'baseline-conflict'
    | 'capacity-exceeded'
    | 'event-already-committed'
    | 'invalid-event-id'
    | 'invalid-progression'
    | 'unsupported-mutation'

  constructor(code: HgssSharedCampaignProgressionError['code'], message: string) {
    super(message)
    this.name = 'HgssSharedCampaignProgressionError'
    this.code = code
  }
}

function requireFieldIdentifier(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximumFieldIdentifier) {
    throw new HgssSharedCampaignProgressionError(
      'invalid-progression',
      `${label} de progression HGSS invalide : ${String(value)}.`,
    )
  }
  return value
}

function encodeFieldIdentifier(prefix: string, value: number, label: string): string {
  return `${prefix}${requireFieldIdentifier(value, label).toString(16).padStart(4, '0')}`
}

function decodeFieldIdentifier(value: string, prefix: string): number | undefined {
  if (!value.startsWith(prefix)) return undefined
  const encoded = value.slice(prefix.length)
  if (!/^[0-9a-f]{4}$/.test(encoded)) return undefined
  return Number.parseInt(encoded, 16)
}

function sortedIdentifiers(values: Iterable<number>, prefix: string, label: string): string[] {
  return [...values]
    .map((value) => requireFieldIdentifier(value, label))
    .sort((left, right) => left - right)
    .map((value) => encodeFieldIdentifier(prefix, value, label))
}

function isPersistentVariable(variableId: number): boolean {
  return !isHgssFieldScriptTemporaryVariable(variableId)
    && !isHgssFieldMapTemporaryVariable(variableId)
}

function persistentVariables(state: FieldScriptState): Map<number, number> {
  const values = new Map<number, number>()
  for (const [variableId, value] of state.variables) {
    requireFieldIdentifier(variableId, 'Variable')
    if (!isPersistentVariable(variableId) || value === 0) continue
    if (!Number.isSafeInteger(value) || value < -1_000_000_000 || value > 1_000_000_000) {
      throw new HgssSharedCampaignProgressionError(
        'invalid-progression',
        `Valeur de variable HGSS hors limites : ${String(value)}.`,
      )
    }
    values.set(variableId, value)
  }
  return values
}

function requireCapacity(progression: HgssCampaignSharedProgression): void {
  if (progression.milestoneIds.length > maximumMilestones
    || progression.counters.length > maximumCounters) {
    throw new HgssSharedCampaignProgressionError(
      'capacity-exceeded',
      'La progression de campagne dépasse la capacité du protocole partagé.',
    )
  }
}

/**
 * Projection canonique de la tranche de scénario partageable sans récompense
 * personnelle. Les registres temporaires de script/carte restent locaux.
 */
export function projectHgssSharedCampaignProgression(
  state: FieldScriptState,
): HgssCampaignSharedProgression {
  const milestoneIds = [
    schemaMilestone,
    ...sortedIdentifiers(state.flags, flagPrefix, 'Flag'),
    ...sortedIdentifiers(state.badges, badgePrefix, 'Badge'),
    ...sortedIdentifiers(state.trainerFlags, trainerPrefix, 'Drapeau Dresseur'),
  ]
  const counters = [...persistentVariables(state)]
    .sort(([left], [right]) => left - right)
    .map(([variableId, value]) => Object.freeze({
      id: encodeFieldIdentifier(variablePrefix, variableId, 'Variable'),
      value,
    }))
  const projection = Object.freeze({
    milestoneIds: Object.freeze(milestoneIds),
    counters: Object.freeze(counters),
  })
  requireCapacity(projection)
  return projection
}

type DecodedProgression = Readonly<{
  campaignBranchId: string
  progressionRevision: number
  flags: ReadonlySet<number>
  badges: ReadonlySet<number>
  trainerFlags: ReadonlySet<number>
  variables: ReadonlyMap<number, number>
  counterValues: ReadonlyMap<string, number>
  milestoneIds: ReadonlySet<string>
}>

function decodeProgression(progression: HgssCampaignSharedProgression): DecodedProgression {
  requireCapacity(progression)
  const milestones = new Set(progression.milestoneIds)
  if (milestones.size !== progression.milestoneIds.length
    || progression.milestoneIds.filter((id) => id === schemaMilestone).length !== 1
    || !milestones.has(schemaMilestone)) {
    throw new HgssSharedCampaignProgressionError(
      'invalid-progression',
      "Le schéma de progression terrain partagé est absent.",
    )
  }
  const counterValues = new Map(progression.counters.map(({ id, value }) => [id, value]))
  if (counterValues.size !== progression.counters.length) {
    throw new HgssSharedCampaignProgressionError(
      'invalid-progression',
      'La progression terrain partagée contient des compteurs dupliqués.',
    )
  }
  const branchIds = progression.milestoneIds
    .filter((milestoneId) => milestoneId.startsWith(branchPrefix))
    .map((milestoneId) => milestoneId.slice(branchPrefix.length))
  const progressionRevision = counterValues.get(progressionRevisionCounter)
  if (branchIds.length !== 1 || !branchIdPattern.test(branchIds[0]!)
    || !Number.isSafeInteger(progressionRevision)
    || progressionRevision! < 0 || progressionRevision! > 1_000_000_000) {
    throw new HgssSharedCampaignProgressionError(
      'invalid-progression',
      "L'identité durable de la campagne partagée est absente ou invalide.",
    )
  }
  const flags = new Set<number>()
  const badges = new Set<number>()
  const trainerFlags = new Set<number>()
  const variables = new Map<number, number>()
  for (const milestoneId of milestones) {
    if (milestoneId === schemaMilestone || milestoneId.startsWith(branchPrefix)) continue
    if (milestoneId.startsWith(eventPrefix)) {
      if (parseHgssSharedCampaignFieldEventId(milestoneId)) continue
      throw new HgssSharedCampaignProgressionError(
        'invalid-progression',
        `Reçu d'événement terrain inconnu : ${milestoneId}.`,
      )
    }
    const flagId = decodeFieldIdentifier(milestoneId, flagPrefix)
    const badgeId = decodeFieldIdentifier(milestoneId, badgePrefix)
    const trainerId = decodeFieldIdentifier(milestoneId, trainerPrefix)
    if (flagId !== undefined) flags.add(flagId)
    else if (badgeId !== undefined) badges.add(badgeId)
    else if (trainerId !== undefined) trainerFlags.add(trainerId)
    else {
      throw new HgssSharedCampaignProgressionError(
        'invalid-progression',
        `Milestone de progression terrain inconnu : ${milestoneId}.`,
      )
    }
  }
  for (const [counterId, value] of counterValues) {
    if (counterId === progressionRevisionCounter) continue
    const flagId = decodeFieldIdentifier(counterId, flagPrefix)
    const variableId = decodeFieldIdentifier(counterId, variablePrefix)
    if (flagId !== undefined) {
      if (value !== 0 && value !== 1) {
        throw new HgssSharedCampaignProgressionError(
          'invalid-progression',
          `Le compteur ${counterId} doit valoir 0 ou 1.`,
        )
      }
      if (value === 1) flags.add(flagId)
      else flags.delete(flagId)
    } else if (variableId !== undefined && isPersistentVariable(variableId)) {
      if (value !== 0) variables.set(variableId, value)
    } else {
      throw new HgssSharedCampaignProgressionError(
        'invalid-progression',
        `Compteur de progression terrain inconnu : ${counterId}.`,
      )
    }
  }
  return Object.freeze({
    campaignBranchId: branchIds[0]!,
    progressionRevision: progressionRevision!,
    flags,
    badges,
    trainerFlags,
    variables,
    counterValues,
    milestoneIds: milestones,
  })
}

export type HgssSharedCampaignProgressionIdentity = Readonly<{
  campaignBranchId: string
  progressionRevision: number
}>

/** Attache à une projection terrain l'identité durable qui survit aux rooms. */
export function createHgssSharedCampaignProgressionSeed(
  state: FieldScriptState,
  campaignBranchId: string,
  progressionRevision = 0,
): HgssCampaignSharedProgression {
  if (!branchIdPattern.test(campaignBranchId)
    || !Number.isSafeInteger(progressionRevision)
    || progressionRevision < 0 || progressionRevision > 1_000_000_000) {
    throw new HgssSharedCampaignProgressionError(
      'invalid-progression',
      "L'identité de la campagne partagée est invalide.",
    )
  }
  const field = projectHgssSharedCampaignProgression(state)
  const seed = Object.freeze({
    milestoneIds: Object.freeze([
      schemaMilestone,
      `${branchPrefix}${campaignBranchId}`,
      ...field.milestoneIds.filter((id) => id !== schemaMilestone),
    ]),
    counters: Object.freeze([
      Object.freeze({ id: progressionRevisionCounter, value: progressionRevision }),
      ...field.counters,
    ]),
  })
  requireCapacity(seed)
  return seed
}

export function readHgssSharedCampaignProgressionIdentity(
  progression: HgssCampaignSharedProgression,
): HgssSharedCampaignProgressionIdentity {
  const decoded = decodeProgression(progression)
  return Object.freeze({
    campaignBranchId: decoded.campaignBranchId,
    progressionRevision: decoded.progressionRevision,
  })
}

/** Applique deux fois le même agrégat sans doubler aucun effet. */
export function applyHgssSharedCampaignProgression(
  source: FieldScriptState,
  progression: HgssCampaignSharedProgression,
): FieldScriptState {
  const decoded = decodeProgression(progression)
  const target = cloneFieldScriptState(source)
  target.flags = new Set(decoded.flags)
  target.badges = new Set(decoded.badges)
  target.trainerFlags = new Set(decoded.trainerFlags)
  const temporaryVariables = [...target.variables]
    .filter(([variableId]) => !isPersistentVariable(variableId))
  target.variables = new Map([...temporaryVariables, ...decoded.variables])
  return target
}

function sameNumberSet(left: ReadonlySet<number>, right: ReadonlySet<number>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value))
}

function sameNumberMap(left: ReadonlyMap<number, number>, right: ReadonlyMap<number, number>): boolean {
  return left.size === right.size && [...left].every(([key, value]) => right.get(key) === value)
}

function requireMatchingBaseline(state: FieldScriptState, decoded: DecodedProgression): void {
  if (!sameNumberSet(state.flags, decoded.flags)
    || !sameNumberSet(state.badges, decoded.badges)
    || !sameNumberSet(state.trainerFlags, decoded.trainerFlags)
    || !sameNumberMap(persistentVariables(state), decoded.variables)) {
    throw new HgssSharedCampaignProgressionError(
      'baseline-conflict',
      "L'état local doit appliquer le dernier snapshot partagé avant de produire un événement.",
    )
  }
}

export function assertHgssSharedCampaignProgressionMatchesFieldState(
  state: FieldScriptState,
  progression: HgssCampaignSharedProgression,
): void {
  requireMatchingBaseline(state, decodeProgression(progression))
}

function addedValues(before: ReadonlySet<number>, after: ReadonlySet<number>): number[] {
  return [...after].filter((value) => !before.has(value)).sort((left, right) => left - right)
}

function removedValues(before: ReadonlySet<number>, after: ReadonlySet<number>): number[] {
  return [...before].filter((value) => !after.has(value)).sort((left, right) => left - right)
}

/**
 * Construit la mutation CAS d'un script déjà évalué sur une copie isolée.
 * Le premier lot autorise uniquement les drapeaux et variables de scénario.
 * Les badges et victoires de Dresseur restent hors transaction tant que leurs
 * récompenses personnelles ne sont pas attribuées par une autorité dédiée.
 */
export function createHgssSharedCampaignEventIntent(
  eventId: string,
  authoritative: HgssCampaignSharedProgression,
  before: FieldScriptState,
  after: FieldScriptState,
): CampaignEventIntent | undefined {
  if (!parseHgssSharedCampaignFieldEventId(eventId)) {
    throw new HgssSharedCampaignProgressionError(
      'invalid-event-id',
      "L'identifiant de l'événement terrain partagé est invalide.",
    )
  }
  const decoded = decodeProgression(authoritative)
  if (decoded.milestoneIds.has(eventId)) {
    throw new HgssSharedCampaignProgressionError(
      'event-already-committed',
      "Cet événement terrain a déjà été commis dans la campagne.",
    )
  }
  requireMatchingBaseline(before, decoded)

  if (!sameNumberSet(before.badges, after.badges)
    || !sameNumberSet(before.trainerFlags, after.trainerFlags)) {
    throw new HgssSharedCampaignProgressionError(
      'unsupported-mutation',
      'Les badges et victoires de Dresseur ne font pas partie des événements terrain sûrs.',
    )
  }

  const milestoneIds: string[] = []
  const counters: Array<Readonly<{ id: string, expectedValue: number | null, value: number }>> = []
  for (const flagId of addedValues(before.flags, after.flags)) {
    const id = encodeFieldIdentifier(flagPrefix, flagId, 'Flag')
    const currentCounter = decoded.counterValues.get(id)
    if (currentCounter === undefined) milestoneIds.push(id)
    else counters.push(Object.freeze({ id, expectedValue: currentCounter, value: 1 }))
  }
  for (const flagId of removedValues(before.flags, after.flags)) {
    const id = encodeFieldIdentifier(flagPrefix, flagId, 'Flag')
    const currentCounter = decoded.counterValues.get(id)
    counters.push(Object.freeze({ id, expectedValue: currentCounter ?? null, value: 0 }))
  }
  const beforeVariables = persistentVariables(before)
  const afterVariables = persistentVariables(after)
  const changedVariableIds = new Set([...beforeVariables.keys(), ...afterVariables.keys()])
  for (const variableId of [...changedVariableIds].sort((left, right) => left - right)) {
    const beforeValue = beforeVariables.get(variableId) ?? 0
    const afterValue = afterVariables.get(variableId) ?? 0
    if (beforeValue === afterValue) continue
    const id = encodeFieldIdentifier(variablePrefix, variableId, 'Variable')
    const currentCounter = decoded.counterValues.get(id)
    counters.push(Object.freeze({ id, expectedValue: currentCounter ?? null, value: afterValue }))
  }

  if (milestoneIds.length > maximumEventMilestones || counters.length > maximumEventCounters) {
    throw new HgssSharedCampaignProgressionError(
      'capacity-exceeded',
      "Le script modifie trop d'éléments pour un commit partagé atomique.",
    )
  }
  if (milestoneIds.length === 0 && counters.length === 0) return undefined
  if (decoded.progressionRevision >= 1_000_000_000
    || counters.length + 1 > maximumEventCounters) {
    throw new HgssSharedCampaignProgressionError(
      'capacity-exceeded',
      "La révision durable de campagne ne peut plus avancer.",
    )
  }
  counters.unshift(Object.freeze({
    id: progressionRevisionCounter,
    expectedValue: decoded.progressionRevision,
    value: decoded.progressionRevision + 1,
  }))
  return Object.freeze({
    kind: 'shared-event',
    eventId,
    milestoneIds: Object.freeze(milestoneIds),
    counters: Object.freeze(counters),
  })
}

export const hgssSharedCampaignProgressionSchemaMilestone = schemaMilestone
export const hgssSharedCampaignEventPrefix = eventPrefix
export const hgssSharedCampaignProgressionBranchPrefix = branchPrefix
export const hgssSharedCampaignProgressionRevisionCounter = progressionRevisionCounter
