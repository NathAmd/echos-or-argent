import type { FieldScriptState } from '../scripts/fieldScriptRunner'
import {
  isHgssFieldMapTemporaryVariable,
  isHgssFieldScriptTemporaryVariable,
} from '../scripts/fieldVariableLifecycle'

const baselineFormat = 'hgss-shared-field-event-baseline.v1' as const
const maximumFieldIdentifier = 0xffff
const maximumSharedVariableMagnitude = 1_000_000_000
const allowedStateKeys = new Set<PropertyKey>(['flags', 'variables'])

type CapturedProperty = Readonly<{
  key: PropertyKey
  kind: 'data' | 'accessor'
  value?: CapturedValue
  get?: (() => unknown)
  set?: ((value: unknown) => void)
}>

type CapturedValue =
  | Readonly<{ kind: 'primitive', value: null | undefined | boolean | number | string | bigint | symbol }>
  | Readonly<{ kind: 'reference', id: number }>
  | Readonly<{ kind: 'function', id: number, identity: object, properties: readonly CapturedProperty[] }>
  | Readonly<{ kind: 'array-buffer', id: number, bytes: readonly number[], properties: readonly CapturedProperty[] }>
  | Readonly<{ kind: 'array-buffer-view', id: number, constructorName: string, bytes: readonly number[], properties: readonly CapturedProperty[] }>
  | Readonly<{ kind: 'date', id: number, timestamp: number, properties: readonly CapturedProperty[] }>
  | Readonly<{ kind: 'regexp', id: number, source: string, flags: string, lastIndex: number, properties: readonly CapturedProperty[] }>
  | Readonly<{ kind: 'map', id: number, entries: readonly (readonly [CapturedValue, CapturedValue])[], properties: readonly CapturedProperty[] }>
  | Readonly<{ kind: 'set', id: number, values: readonly CapturedValue[], properties: readonly CapturedProperty[] }>
  | Readonly<{ kind: 'object', id: number, prototype: object | null, properties: readonly CapturedProperty[] }>

type ForbiddenStateEntry = Readonly<{
  key: PropertyKey
  value: CapturedValue
}>

type VariableEntry = readonly [variableId: number, value: number]

export type HgssSharedFieldEventBaseline = Readonly<{
  format: typeof baselineFormat
  flags: readonly number[]
  variables: readonly VariableEntry[]
  forbiddenState: readonly ForbiddenStateEntry[]
  lcrngSeed?: number
  mtSnapshot?: CapturedValue
}>

export type HgssSharedFieldEventDelta = Readonly<{
  addedFlagIds: readonly number[]
  removedFlagIds: readonly number[]
  variables: readonly Readonly<{
    variableId: number
    expectedValue: number
    value: number
  }>[]
}>

export class HgssSharedFieldEventDeltaError extends Error {
  readonly code: 'invalid-state' | 'unattestable-domain' | 'unsupported-mutation'
  readonly path: string

  constructor(
    code: HgssSharedFieldEventDeltaError['code'],
    path: string,
    message: string,
  ) {
    super(message)
    this.name = 'HgssSharedFieldEventDeltaError'
    this.code = code
    this.path = path
  }
}

type CaptureContext = {
  active: Map<object, number>
  nextId: number
}

function failInvalid(path: string, message: string): never {
  throw new HgssSharedFieldEventDeltaError('invalid-state', path, message)
}

function comparePropertyKeys(left: PropertyKey, right: PropertyKey): number {
  if (typeof left === 'string' && typeof right === 'string') return left.localeCompare(right)
  if (typeof left === 'string') return -1
  if (typeof right === 'string') return 1
  if (typeof left === 'number' && typeof right === 'number') return left - right
  if (typeof left === 'number') return -1
  if (typeof right === 'number') return 1
  const descriptionOrder = (left.description ?? '').localeCompare(right.description ?? '')
  return descriptionOrder === 0 ? 0 : descriptionOrder
}

function captureProperties(
  source: object,
  context: CaptureContext,
  ignoredKeys: ReadonlySet<PropertyKey> = new Set(),
): readonly CapturedProperty[] {
  return Object.freeze(Reflect.ownKeys(source)
    .filter((key) => !ignoredKeys.has(key))
    .sort(comparePropertyKeys)
    .map((key): CapturedProperty => {
      const descriptor = Object.getOwnPropertyDescriptor(source, key)
      if (!descriptor) failInvalid(String(key), 'Une propriété de l’état terrain a disparu pendant sa capture.')
      if ('value' in descriptor) {
        return Object.freeze({ key, kind: 'data', value: captureValue(descriptor.value, context) })
      }
      return Object.freeze({ key, kind: 'accessor', get: descriptor.get, set: descriptor.set })
    }))
}

function captureValue(value: unknown, context: CaptureContext): CapturedValue {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') {
    return Object.freeze({
      kind: 'primitive',
      value: value as null | undefined | boolean | number | string | bigint | symbol,
    })
  }

  const object = value as object
  const knownId = context.active.get(object)
  if (knownId !== undefined) return Object.freeze({ kind: 'reference', id: knownId })
  const id = context.nextId++
  context.active.set(object, id)
  const finish = <Captured extends CapturedValue>(captured: Captured): Captured => {
    context.active.delete(object)
    return captured
  }

  if (typeof value === 'function') {
    return finish(Object.freeze({
      kind: 'function', id, identity: value,
      properties: captureProperties(value, context),
    }))
  }
  if (value instanceof WeakMap || value instanceof WeakSet || value instanceof Promise) {
    throw new HgssSharedFieldEventDeltaError(
      'unattestable-domain',
      '$state',
      `Le domaine ${value.constructor.name} ne peut pas être attesté structurellement.`,
    )
  }
  if (value instanceof ArrayBuffer) {
    return finish(Object.freeze({
      kind: 'array-buffer', id,
      bytes: Object.freeze(Array.from(new Uint8Array(value))),
      properties: captureProperties(value, context),
    }))
  }
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView
    const ignoredKeys = new Set<PropertyKey>()
    for (let index = 0; index < view.byteLength; index += 1) ignoredKeys.add(String(index))
    return finish(Object.freeze({
      kind: 'array-buffer-view', id,
      constructorName: value.constructor.name,
      bytes: Object.freeze(Array.from(new Uint8Array(view.buffer, view.byteOffset, view.byteLength))),
      properties: captureProperties(value, context, ignoredKeys),
    }))
  }
  if (value instanceof Date) {
    return finish(Object.freeze({
      kind: 'date', id, timestamp: value.getTime(),
      properties: captureProperties(value, context),
    }))
  }
  if (value instanceof RegExp) {
    return finish(Object.freeze({
      kind: 'regexp', id, source: value.source, flags: value.flags, lastIndex: value.lastIndex,
      properties: captureProperties(value, context),
    }))
  }
  if (value instanceof Map) {
    return finish(Object.freeze({
      kind: 'map', id,
      entries: Object.freeze([...value].map(([key, entry]) => Object.freeze([
        captureValue(key, context), captureValue(entry, context),
      ] as const))),
      properties: captureProperties(value, context),
    }))
  }
  if (value instanceof Set) {
    return finish(Object.freeze({
      kind: 'set', id,
      values: Object.freeze([...value].map((entry) => captureValue(entry, context))),
      properties: captureProperties(value, context),
    }))
  }

  const prototype = Object.getPrototypeOf(value) as object | null
  if (prototype !== null && prototype !== Object.prototype && prototype !== Array.prototype) {
    throw new HgssSharedFieldEventDeltaError(
      'unattestable-domain',
      '$state',
      `Le domaine ${value.constructor?.name ?? 'objet'} ne peut pas être attesté sans codec explicite.`,
    )
  }
  return finish(Object.freeze({
    kind: 'object', id, prototype,
    properties: captureProperties(value, context),
  }))
}

function captureForbiddenState(state: FieldScriptState): readonly ForbiddenStateEntry[] {
  if (!state || typeof state !== 'object') failInvalid('$state', "L’état terrain à attester est absent.")
  const context: CaptureContext = { active: new Map(), nextId: 0 }
  return Object.freeze(Reflect.ownKeys(state)
    // cloneFieldScriptState matérialise certains champs optionnels absents avec
    // la valeur undefined. Ils sont sémantiquement équivalents à une absence.
    .filter((key) => !allowedStateKeys.has(key) && Reflect.get(state, key) !== undefined)
    .sort(comparePropertyKeys)
    .map((key) => Object.freeze({ key, value: captureValue(Reflect.get(state, key), context) })))
}

function requireIdentifier(value: number, path: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximumFieldIdentifier) {
    failInvalid(path, `L’identifiant terrain ${String(value)} n’est pas partageable.`)
  }
  return value
}

function requireVariableValue(value: number, path: string): number {
  if (!Number.isSafeInteger(value)
    || value < -maximumSharedVariableMagnitude
    || value > maximumSharedVariableMagnitude) {
    failInvalid(path, `La valeur terrain ${String(value)} n’est pas partageable.`)
  }
  return value
}

function captureFlags(state: FieldScriptState): readonly number[] {
  if (!(state.flags instanceof Set)) failInvalid('flags', 'Les flags terrain ne forment pas un Set.')
  return Object.freeze([...state.flags]
    .map((flagId) => requireIdentifier(flagId, 'flags'))
    .sort((left, right) => left - right))
}

function captureVariables(state: FieldScriptState): readonly VariableEntry[] {
  if (!(state.variables instanceof Map)) failInvalid('variables', 'Les variables terrain ne forment pas une Map.')
  return Object.freeze([...state.variables]
    .map(([variableId, value]) => Object.freeze([
      requireIdentifier(variableId, 'variables'),
      requireVariableValue(value, `variables.${String(variableId)}`),
    ] as const))
    .sort(([left], [right]) => left - right))
}

function captureRng(state: FieldScriptState): Pick<HgssSharedFieldEventBaseline, 'lcrngSeed' | 'mtSnapshot'> {
  const runtime = state.pokemonRuntime
  if (!runtime) return {}
  let lcrngSeed: number
  try {
    lcrngSeed = runtime.rng.getSeed()
  } catch {
    failInvalid('pokemonRuntime.rng', "La graine du RNG terrain n’est pas lisible.")
  }
  if (!Number.isInteger(lcrngSeed) || lcrngSeed < 0 || lcrngSeed > 0xffffffff) {
    failInvalid('pokemonRuntime.rng', `La graine du RNG terrain ${String(lcrngSeed)} est invalide.`)
  }
  if (!runtime.mt) return { lcrngSeed }
  try {
    return {
      lcrngSeed,
      mtSnapshot: captureValue(runtime.mt.snapshot(), { active: new Map(), nextId: 0 }),
    }
  } catch (error) {
    if (error instanceof HgssSharedFieldEventDeltaError) throw error
    failInvalid('pokemonRuntime.mt', "L’état du Mersenne Twister terrain n’est pas lisible.")
  }
}

/**
 * Capture la preuve avant l’exécution isolée. Cette étape préalable est
 * indispensable pour détecter une mutation d’un objet partagé par le clone,
 * notamment les RNG et les catalogues du runtime Pokémon.
 */
export function captureHgssSharedFieldEventBaseline(
  state: FieldScriptState,
): HgssSharedFieldEventBaseline {
  return Object.freeze({
    format: baselineFormat,
    flags: captureFlags(state),
    variables: captureVariables(state),
    forbiddenState: captureForbiddenState(state),
    ...captureRng(state),
  })
}

function samePropertyKey(left: PropertyKey, right: PropertyKey): boolean {
  return Object.is(left, right)
}

function firstCapturedDifference(
  left: CapturedValue,
  right: CapturedValue,
  path: string,
): string | undefined {
  if (left.kind !== right.kind) return path
  if (left.kind === 'primitive' && right.kind === 'primitive') {
    return Object.is(left.value, right.value) ? undefined : path
  }
  if (left.kind === 'reference' && right.kind === 'reference') {
    return left.id === right.id ? undefined : path
  }
  if (left.kind === 'function' && right.kind === 'function' && left.identity !== right.identity) return path
  if (left.kind === 'array-buffer' && right.kind === 'array-buffer'
    && firstArrayDifference(left.bytes, right.bytes)) return `${path}.bytes`
  if (left.kind === 'array-buffer-view' && right.kind === 'array-buffer-view') {
    if (left.constructorName !== right.constructorName) return path
    if (firstArrayDifference(left.bytes, right.bytes)) return `${path}.bytes`
  }
  if (left.kind === 'date' && right.kind === 'date' && !Object.is(left.timestamp, right.timestamp)) return path
  if (left.kind === 'regexp' && right.kind === 'regexp'
    && (left.source !== right.source || left.flags !== right.flags || left.lastIndex !== right.lastIndex)) return path
  if (left.kind === 'object' && right.kind === 'object' && left.prototype !== right.prototype) return path
  if (left.kind === 'map' && right.kind === 'map') {
    if (left.entries.length !== right.entries.length) return path
    for (let index = 0; index < left.entries.length; index += 1) {
      const leftEntry = left.entries[index]!
      const rightEntry = right.entries[index]!
      const keyDifference = firstCapturedDifference(leftEntry[0], rightEntry[0], `${path}.key(${index})`)
      if (keyDifference) return keyDifference
      const valueDifference = firstCapturedDifference(leftEntry[1], rightEntry[1], `${path}.value(${index})`)
      if (valueDifference) return valueDifference
    }
  }
  if (left.kind === 'set' && right.kind === 'set') {
    if (left.values.length !== right.values.length) return path
    for (let index = 0; index < left.values.length; index += 1) {
      const difference = firstCapturedDifference(left.values[index]!, right.values[index]!, `${path}.value(${index})`)
      if (difference) return difference
    }
  }

  if (!('properties' in left) || !('properties' in right)) return path
  if (left.properties.length !== right.properties.length) return path
  for (let index = 0; index < left.properties.length; index += 1) {
    const leftProperty = left.properties[index]!
    const rightProperty = right.properties[index]!
    if (!samePropertyKey(leftProperty.key, rightProperty.key) || leftProperty.kind !== rightProperty.kind) return path
    const propertyPath = `${path}.${String(leftProperty.key)}`
    if (leftProperty.kind === 'accessor' || rightProperty.kind === 'accessor') {
      if (leftProperty.get !== rightProperty.get || leftProperty.set !== rightProperty.set) return propertyPath
      continue
    }
    const difference = firstCapturedDifference(leftProperty.value!, rightProperty.value!, propertyPath)
    if (difference) return difference
  }
  return undefined
}

function firstArrayDifference(left: readonly number[], right: readonly number[]): boolean {
  return left.length !== right.length || left.some((value, index) => !Object.is(value, right[index]))
}

function assertForbiddenStateUnchanged(
  baseline: HgssSharedFieldEventBaseline,
  after: FieldScriptState,
): void {
  const candidate = captureForbiddenState(after)
  if (baseline.forbiddenState.length !== candidate.length) {
    const added = candidate.find((entry) => !baseline.forbiddenState
      .some((beforeEntry) => samePropertyKey(beforeEntry.key, entry.key)))
    const removed = baseline.forbiddenState.find((entry) => !candidate
      .some((afterEntry) => samePropertyKey(afterEntry.key, entry.key)))
    const path = String(added?.key ?? removed?.key ?? '$state')
    throw new HgssSharedFieldEventDeltaError(
      'unsupported-mutation', path,
      `Le script a modifié la structure du domaine terrain ${path}.`,
    )
  }
  for (let index = 0; index < baseline.forbiddenState.length; index += 1) {
    const beforeEntry = baseline.forbiddenState[index]!
    const afterEntry = candidate[index]!
    if (!samePropertyKey(beforeEntry.key, afterEntry.key)) {
      throw new HgssSharedFieldEventDeltaError(
        'unsupported-mutation', '$state',
        "Le script a modifié la structure de l’état terrain.",
      )
    }
    const path = String(beforeEntry.key)
    const difference = firstCapturedDifference(beforeEntry.value, afterEntry.value, path)
    if (difference) {
      throw new HgssSharedFieldEventDeltaError(
        'unsupported-mutation', difference,
        `Le script terrain a modifié le domaine non partageable ${difference}.`,
      )
    }
  }
}

function assertRngUnchanged(baseline: HgssSharedFieldEventBaseline, after: FieldScriptState): void {
  const candidate = captureRng(after)
  if (baseline.lcrngSeed !== candidate.lcrngSeed) {
    throw new HgssSharedFieldEventDeltaError(
      'unsupported-mutation', 'pokemonRuntime.rng',
      'Le script terrain a consommé ou remplacé le RNG LCRNG.',
    )
  }
  if (baseline.mtSnapshot === undefined && candidate.mtSnapshot === undefined) return
  if (baseline.mtSnapshot === undefined || candidate.mtSnapshot === undefined
    || firstCapturedDifference(baseline.mtSnapshot, candidate.mtSnapshot, 'pokemonRuntime.mt')) {
    throw new HgssSharedFieldEventDeltaError(
      'unsupported-mutation', 'pokemonRuntime.mt',
      'Le script terrain a consommé ou remplacé le Mersenne Twister.',
    )
  }
}

function isTemporaryVariable(variableId: number): boolean {
  return isHgssFieldScriptTemporaryVariable(variableId)
    || isHgssFieldMapTemporaryVariable(variableId)
}

function variableMap(entries: readonly VariableEntry[]): Map<number, number> {
  return new Map(entries)
}

function assertTemporaryVariablesUnchanged(
  before: ReadonlyMap<number, number>,
  after: ReadonlyMap<number, number>,
): void {
  const ids = new Set([...before.keys(), ...after.keys()])
  for (const variableId of ids) {
    if (!isTemporaryVariable(variableId)) continue
    if (!before.has(variableId) || !after.has(variableId)
      || before.get(variableId) !== after.get(variableId)) {
      throw new HgssSharedFieldEventDeltaError(
        'unsupported-mutation', `variables.${variableId.toString(16)}`,
        `Le registre temporaire ${variableId.toString(16)} ne peut pas entrer dans un événement partagé.`,
      )
    }
  }
}

function sortedDifference(left: ReadonlySet<number>, right: ReadonlySet<number>): readonly number[] {
  return Object.freeze([...left].filter((value) => !right.has(value)).sort((a, b) => a - b))
}

/**
 * Atteste l’état obtenu contre une capture prise avant le script et produit le
 * seul delta partageable : flags et variables persistantes, triés et gelés.
 */
export function attestHgssSharedFieldEventDelta(
  baseline: HgssSharedFieldEventBaseline,
  after: FieldScriptState,
): HgssSharedFieldEventDelta {
  if (baseline.format !== baselineFormat) failInvalid('$baseline', 'Le format de preuve terrain est invalide.')
  assertForbiddenStateUnchanged(baseline, after)
  assertRngUnchanged(baseline, after)

  const beforeFlags = new Set(baseline.flags)
  const afterFlags = new Set(captureFlags(after))
  const beforeVariables = variableMap(baseline.variables)
  const afterVariables = variableMap(captureVariables(after))
  assertTemporaryVariablesUnchanged(beforeVariables, afterVariables)

  const changedVariableIds = new Set([...beforeVariables.keys(), ...afterVariables.keys()])
  const variables = [...changedVariableIds]
    .filter((variableId) => !isTemporaryVariable(variableId))
    .sort((left, right) => left - right)
    .flatMap((variableId) => {
      const expectedValue = beforeVariables.get(variableId) ?? 0
      const value = afterVariables.get(variableId) ?? 0
      return expectedValue === value
        ? []
        : [Object.freeze({ variableId, expectedValue, value })]
    })

  return Object.freeze({
    addedFlagIds: sortedDifference(afterFlags, beforeFlags),
    removedFlagIds: sortedDifference(beforeFlags, afterFlags),
    variables: Object.freeze(variables),
  })
}

/** Raccourci sûr uniquement si `before` n’a partagé aucune référence mutable avec l’exécution. */
export function createHgssSharedFieldEventDelta(
  before: FieldScriptState,
  after: FieldScriptState,
): HgssSharedFieldEventDelta {
  return attestHgssSharedFieldEventDelta(captureHgssSharedFieldEventBaseline(before), after)
}
