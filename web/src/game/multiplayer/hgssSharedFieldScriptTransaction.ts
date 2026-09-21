import type { OpeningMapPreview } from '../../ndsTypes'
import {
  cloneFieldScriptState,
  createFieldScriptRunner,
  type FieldScriptRunner,
  type FieldScriptState,
  type FieldScriptStep,
} from '../scripts/fieldScriptRunner'
import {
  attestHgssSharedFieldEventDelta,
  captureHgssSharedFieldEventBaseline,
  type HgssSharedFieldEventDelta,
} from './hgssSharedFieldEventDelta'

const maximumPresentationSteps = 1_024
const sharedStateKeys = new Set<PropertyKey>(['flags', 'variables'])

type SharedPresentationStep = Extract<FieldScriptStep, {
  kind: 'message' | 'dialogue' | 'inputWait' | 'waiting' | 'music' | 'soundEffect' | 'cry' | 'fanfare'
}>

export type HgssSharedFieldScriptTransactionRequest = Readonly<{
  map: OpeningMapPreview
  scriptId: number
  actorId?: number
  state: FieldScriptState
}>

export type HgssSharedFieldScriptTransaction = Readonly<{
  /** Snapshot causal transmis au CAS; il n'est jamais exécuté. */
  before: FieldScriptState
  /** Sandbox attestée dont seules les projections flags/variables seront commises. */
  after: FieldScriptState
  delta: HgssSharedFieldEventDelta
  presentationSteps: readonly SharedPresentationStep[]
}>

export class HgssSharedFieldScriptTransactionError extends Error {
  readonly code: 'invalid-request' | 'sandbox-unavailable' | 'unsupported-state-read' | 'unsupported-step' | 'step-limit'
  readonly path?: string
  readonly stepKind?: FieldScriptStep['kind']

  constructor(
    code: HgssSharedFieldScriptTransactionError['code'],
    message: string,
    stepKind?: FieldScriptStep['kind'],
    path?: string,
  ) {
    super(message)
    this.name = 'HgssSharedFieldScriptTransactionError'
    this.code = code
    this.stepKind = stepKind
    this.path = path
  }
}

function createDetachedSandbox(state: FieldScriptState): FieldScriptState {
  try {
    // La première tranche partagée ne peut consulter ni RTC, ni catalogues,
    // ni RNG personnels. Les retirer avant le clone structurel ferme aussi la
    // dernière référence mutable que cloneFieldScriptState conserve exprès.
    return structuredClone({ ...state, pokemonRuntime: undefined })
  } catch {
    throw new HgssSharedFieldScriptTransactionError(
      'sandbox-unavailable',
      "L'état terrain ne peut pas être isolé pour cet événement partagé.",
    )
  }
}

function createTrackedSharedState(state: FieldScriptState): Readonly<{
  state: FieldScriptState
  track: <Value>(operation: () => Value) => Value
}> {
  let tracking = false
  const assertSharedKey = (key: PropertyKey): void => {
    if (!tracking || sharedStateKeys.has(key)) return
    const path = typeof key === 'symbol' ? key.description ?? 'symbol' : String(key)
    throw new HgssSharedFieldScriptTransactionError(
      'unsupported-state-read',
      `Le script terrain a consulté le domaine personnel ${path}.`,
      undefined,
      path,
    )
  }
  const proxy = new Proxy(state, {
    defineProperty: (target, key, descriptor) => {
      assertSharedKey(key)
      return Reflect.defineProperty(target, key, descriptor)
    },
    deleteProperty: (target, key) => {
      assertSharedKey(key)
      return Reflect.deleteProperty(target, key)
    },
    get: (target, key) => {
      assertSharedKey(key)
      return Reflect.get(target, key, target) as unknown
    },
    has: (target, key) => {
      assertSharedKey(key)
      return Reflect.has(target, key)
    },
    ownKeys: (target) => {
      if (tracking) assertSharedKey('$state')
      return Reflect.ownKeys(target)
    },
    set: (target, key, value) => {
      assertSharedKey(key)
      return Reflect.set(target, key, value, target)
    },
  })
  return Object.freeze({
    state: proxy,
    track: <Value>(operation: () => Value): Value => {
      tracking = true
      try { return operation() } finally { tracking = false }
    },
  })
}

function freezePresentationStep(step: SharedPresentationStep): SharedPresentationStep {
  if (step.kind === 'inputWait') {
    return Object.freeze({ ...step, accepts: Object.freeze([...step.accepts]) })
  }
  return Object.freeze({ ...step })
}

function sanitizePresentationStep(step: FieldScriptStep): SharedPresentationStep {
  if (step.kind === 'message'
    || step.kind === 'dialogue'
    || step.kind === 'music'
    || step.kind === 'soundEffect'
    || step.kind === 'cry'
    || step.kind === 'fanfare') {
    return freezePresentationStep(step)
  }
  if (step.kind === 'inputWait') {
    if (step.accepts.length > 0
      && step.accepts.every((input) => input === 'confirm' || input === 'cancel' || input === 'direction')) {
      return freezePresentationStep(step)
    }
  } else if (step.kind === 'waiting'
    && step.waitFor === 'timer'
    && Number.isSafeInteger(step.frames)
    && (step.frames ?? 0) > 0) {
    return freezePresentationStep(step)
  }
  throw new HgssSharedFieldScriptTransactionError(
    'unsupported-step',
    `L'étape ROM ${step.kind} n'est pas présentable dans une transaction partagée sûre.`,
    step.kind,
  )
}

/**
 * Évalue un script ROM sans aucun host navigateur. La sandbox est totalement
 * détachée de l'état vivant et privée de runtime Pokémon; toute suspension qui
 * n'est pas une présentation sans décision est refusée avant le commit.
 */
export function evaluateHgssSharedFieldScriptTransaction(
  request: HgssSharedFieldScriptTransactionRequest,
): HgssSharedFieldScriptTransaction {
  if (!request.map || !Number.isSafeInteger(request.scriptId) || request.scriptId < 1
    || request.actorId !== undefined
      && (!Number.isSafeInteger(request.actorId) || request.actorId < 0 || request.actorId > 0xffff)) {
    throw new HgssSharedFieldScriptTransactionError(
      'invalid-request',
      "La source du script terrain partagé est invalide.",
    )
  }

  const before = cloneFieldScriptState(request.state)
  const after = createDetachedSandbox(request.state)
  const tracked = createTrackedSharedState(after)
  const runner = createFieldScriptRunner(request.map, request.scriptId, tracked.state, request.actorId)
  // createFieldScriptRunner initialise le registre acteur 0x800d. Il fait
  // partie de la baseline transitoire, jamais du patch causal partagé.
  const baseline = captureHgssSharedFieldEventBaseline(after)
  const presentationSteps: SharedPresentationStep[] = []

  for (let index = 0; index < maximumPresentationSteps; index += 1) {
    const step = tracked.track(runner.resume)
    if (step.kind === 'ended') {
      const delta = attestHgssSharedFieldEventDelta(baseline, after)
      return Object.freeze({
        before,
        after,
        delta,
        presentationSteps: Object.freeze(presentationSteps),
      })
    }
    presentationSteps.push(sanitizePresentationStep(step))
  }

  throw new HgssSharedFieldScriptTransactionError(
    'step-limit',
    `Le script terrain partagé dépasse ${maximumPresentationSteps} suspensions.`,
  )
}

function rejectPresentationInput(): never {
  throw new HgssSharedFieldScriptTransactionError(
    'unsupported-step',
    "La trace partagée ne possède aucune saisie de gameplay.",
  )
}

/** Rejoue uniquement la trace assainie via les hosts dialogue/audio existants. */
export function createHgssSharedFieldScriptPresentationRunner(
  steps: readonly SharedPresentationStep[],
): FieldScriptRunner {
  const trace = Object.freeze(steps.map(freezePresentationStep))
  let cursor = 0
  return Object.freeze({
    resume: () => trace[cursor++] ?? Object.freeze({ kind: 'ended' as const }),
    choose: rejectPresentationInput,
    enterNumber: rejectPresentationInput,
    enterNickname: rejectPresentationInput,
    submitBattleResult: rejectPresentationInput,
    submitMultiplayerResult: rejectPresentationInput,
    submitEasyChat: rejectPresentationInput,
    closePcBox: rejectPresentationInput,
    closePokeathlonApp: rejectPresentationInput,
    closeFrontierRecordsApp: rejectPresentationInput,
    closeGameClear: rejectPresentationInput,
    finishAlphPuzzle: rejectPresentationInput,
    closeAlphHiddenRoom: rejectPresentationInput,
    finishEggHatch: rejectPresentationInput,
  })
}
