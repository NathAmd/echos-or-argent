import type { GameDigitalAction } from '../../gameInput'
import { isRealtimeCampaignPresetId, type RealtimeCampaignPresetId } from './realtimeNewGamePlusPresets'

export const realtimeTestScriptMarker = 'pokemaster-debug-tape-v1'

const maximumScriptCharacters = 512 * 1024
const maximumExpandedSteps = 10_000
const maximumRepeatCount = 1_000
const maximumDurationMs = 25 * 60 * 1_000
const maximumHeldDurationMs = 30_000
const waitingProgressIntervalMs = 1_000
const maximumDiagnosticValueCharacters = 64
const maximumDiagnosticSnapshotCharacters = 2_048

const diagnosticSnapshotKeys = Object.freeze([
  'loaded',
  'flow',
  'map',
  'x',
  'z',
  'dialog',
  'phoneChoiceOpen',
  'script',
  'scriptWait',
  'scriptMovementTasks',
  'scriptMoving',
  'followerMoving',
  'menu',
  'menuScreen',
  'combat',
  'battle',
  'battlePhase',
  'battleUi',
  'debugReady',
  'bot',
  'botStatus',
  'botError',
  'zephyrBadge',
  'falknerDefeated',
  'togepiEggReceived',
  'togepiReturnComplete',
  'slowpokeWellCleared',
  'hiveBadge',
  'bugsyDefeated',
  'hiveGymComplete',
  'ilexForestCleared',
  'cutLearned',
  'radioQuizComplete',
  'plainBadge',
  'whitneyDefeated',
  'plainGymComplete',
  'squirtBottleReceived',
  'sudowoodoCleared',
  'legendaryBeastsReleased',
  'fogBadge',
  'mortyDefeated',
  'fogGymComplete',
  'campaignPreset',
  'campaignMode',
  'campaignModules',
  'journey',
  'journeyCheckpoint',
  'journeySeed',
  'journeyError',
  'saveReady',
  'runtimeStatus',
] as const)

export type RealtimeTestSnapshotValue = string | number | boolean | undefined
export type RealtimeTestSnapshot = Readonly<Record<string, RealtimeTestSnapshotValue>>
export type RealtimeTestDebugCommand =
  | Readonly<{ kind: 'godmode', enabled: boolean }>
  | Readonly<{ kind: 'instant-kill' }>
  | Readonly<{ kind: 'suicide' }>
export type RealtimeTestBotJourney = 'opening' | 'zephyr' | 'togepi' | 'hive' | 'plain' | 'fog'

type RealtimeTestStepBase = Readonly<{ line: number, source: string }>
export type RealtimeTestStep = RealtimeTestStepBase & (
  | Readonly<{ kind: 'press', action: GameDigitalAction, durationMs: number }>
  | Readonly<{ kind: 'wait', durationMs: number }>
  | Readonly<{ kind: 'wait-for', key: string, expected: string, timeoutMs: number }>
  | Readonly<{ kind: 'press-until', action: GameDigitalAction, key: string, expected: string, intervalMs: number, timeoutMs: number }>
  | Readonly<{ kind: 'expect', key: string, expected: string }>
  | Readonly<{ kind: 'expect-debug-error', command: RealtimeTestDebugCommand, expectedMessage: string }>
  | Readonly<{ kind: 'debug', command: RealtimeTestDebugCommand }>
  | Readonly<{ kind: 'bot', journey: RealtimeTestBotJourney, preset?: RealtimeCampaignPresetId }>
  | Readonly<{ kind: 'report', label: string }>
  | Readonly<{ kind: 'stop' }>
)

export type RealtimeTestScript = Readonly<{
  name: string
  steps: readonly RealtimeTestStep[]
}>

export type RealtimeTestRunnerStatus = 'idle' | 'running' | 'passed' | 'failed' | 'stopped'
export type RealtimeTestLogEntry = Readonly<{
  atMs: number
  line?: number
  level: 'info' | 'checkpoint' | 'error'
  message: string
}>
export type RealtimeTestRunnerState = Readonly<{
  status: RealtimeTestRunnerStatus
  scriptName?: string
  stepIndex: number
  stepCount: number
  currentLine?: number
  startedAtMs?: number
  finishedAtMs?: number
  message: string
  logs: readonly RealtimeTestLogEntry[]
}>

export type RealtimeTestRunnerHost = Readonly<{
  dispatch: (action: GameDigitalAction, pressed: boolean, inputId: string) => void
  readSnapshot: () => RealtimeTestSnapshot
  executeDebugCommand: (command: RealtimeTestDebugCommand) => string
  startBotJourney: (journey: RealtimeTestBotJourney, preset?: RealtimeCampaignPresetId) => string
  recordCheckpoint?: (label: string, snapshot: RealtimeTestSnapshot) => void
  onStateChange?: (state: RealtimeTestRunnerState) => void
}>

const actionAliases = new Map<string, GameDigitalAction>([
  ['confirm', 'confirm'], ['valider', 'confirm'], ['entree', 'confirm'],
  ['cancel', 'cancel'], ['annuler', 'cancel'], ['retour', 'cancel'],
  ['up', 'up'], ['haut', 'up'], ['down', 'down'], ['bas', 'down'],
  ['left', 'left'], ['gauche', 'left'], ['right', 'right'], ['droite', 'right'],
  ['secondary', 'secondary'], ['secondaire', 'secondary'],
  ['tertiary', 'tertiary'], ['tertiaire', 'tertiary'], ['menu', 'menu'],
  ['page-previous', 'page-previous'], ['page-precedente', 'page-previous'],
  ['page-next', 'page-next'], ['page-suivante', 'page-next'],
])

function scriptError(line: number, message: string): never {
  throw new Error(`Script de test, ligne ${line}: ${message}`)
}

function tokenize(source: string, line: number): string[] {
  const tokens: string[] = []
  let cursor = 0
  while (cursor < source.length) {
    while (/\s/.test(source[cursor] ?? '')) cursor += 1
    if (cursor >= source.length) break
    if (source[cursor] !== '"') {
      const end = source.slice(cursor).search(/\s/)
      const next = end < 0 ? source.length : cursor + end
      tokens.push(source.slice(cursor, next))
      cursor = next
      continue
    }
    cursor += 1
    let value = ''
    let closed = false
    while (cursor < source.length) {
      const character = source[cursor++]!
      if (character === '"') { closed = true; break }
      if (character === '\\') {
        const escaped = source[cursor++]
        if (escaped !== '"' && escaped !== '\\') scriptError(line, 'échappement invalide dans une chaîne.')
        value += escaped
      } else value += character
    }
    if (!closed) scriptError(line, 'guillemet fermant manquant.')
    if (cursor < source.length && !/\s/.test(source[cursor] ?? '')) scriptError(line, 'espace attendu après une chaîne.')
    tokens.push(value)
  }
  return tokens
}

function stripInlineComment(source: string): string {
  let quoted = false
  let escaped = false
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!
    if (escaped) { escaped = false; continue }
    if (quoted && character === '\\') { escaped = true; continue }
    if (character === '"') { quoted = !quoted; continue }
    if (!quoted && character === '#' && (index === 0 || /\s/.test(source[index - 1]!))) return source.slice(0, index)
  }
  return source
}

function parseDuration(token: string | undefined, line: number, label: string, maximum = maximumDurationMs): number {
  if (!token) scriptError(line, `${label} manquante.`)
  const match = /^(\d+)(ms|s|m)?$/i.exec(token)
  if (!match) scriptError(line, `${label} invalide: ${token}. Utilisez par exemple 250ms, 2s ou 1m.`)
  const unit = match[2]?.toLowerCase()
  const value = Number.parseInt(match[1]!, 10) * (unit === 'm' ? 60_000 : unit === 's' ? 1_000 : 1)
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) scriptError(line, `${label} hors limites (0 à ${maximum} ms).`)
  return value
}

function parseAction(token: string | undefined, line: number): GameDigitalAction {
  const action = token && actionAliases.get(token.toLowerCase())
  if (!action) scriptError(line, `touche inconnue: ${token ?? '(absente)'}.`)
  return action
}

function parseCondition(token: string | undefined, line: number): { key: string, expected: string } {
  const match = token && /^([a-z][a-z0-9.-]*)=(.+)$/i.exec(token)
  if (!match) scriptError(line, `condition invalide: ${token ?? '(absente)'}. Utilisez cle=valeur.`)
  return { key: match[1]!.toLowerCase(), expected: match[2]! }
}

function parseCommand(tokens: readonly string[], line: number, source: string): RealtimeTestStep {
  const [rawCommand, ...parameters] = tokens
  const command = rawCommand?.toLowerCase()
  if (command === 'press' || command === 'tap' || command === 'touche') {
    if (parameters.length > 2) scriptError(line, 'PRESS accepte une touche et une durée facultative.')
    return { kind: 'press', action: parseAction(parameters[0], line), durationMs: parameters[1] ? parseDuration(parameters[1], line, 'durée', maximumHeldDurationMs) : 70, line, source }
  }
  if (command === 'hold' || command === 'maintien') {
    if (parameters.length !== 2) scriptError(line, 'HOLD attend exactement une touche et une durée.')
    return { kind: 'press', action: parseAction(parameters[0], line), durationMs: parseDuration(parameters[1], line, 'durée', maximumHeldDurationMs), line, source }
  }
  if (command === 'wait' || command === 'attendre') {
    if (parameters[0]?.includes('=')) {
      if (parameters.length > 2) scriptError(line, 'WAIT cle=valeur accepte seulement un délai maximal facultatif.')
      return { kind: 'wait-for', ...parseCondition(parameters[0], line), timeoutMs: parameters[1] ? parseDuration(parameters[1], line, 'délai maximal') : 15_000, line, source }
    }
    if (parameters.length !== 1) scriptError(line, 'WAIT attend exactement une durée ou une condition.')
    return { kind: 'wait', durationMs: parseDuration(parameters[0], line, 'durée'), line, source }
  }
  if (command === 'press-until' || command === 'jusqua' || command === 'jusquà') {
    if (parameters.length !== 4) scriptError(line, 'PRESS-UNTIL attend touche, cle=valeur, intervalle et délai maximal.')
    return {
      kind: 'press-until', action: parseAction(parameters[0], line), ...parseCondition(parameters[1], line),
      intervalMs: parseDuration(parameters[2], line, 'intervalle', maximumHeldDurationMs),
      timeoutMs: parseDuration(parameters[3], line, 'délai maximal'), line, source,
    }
  }
  if (command === 'expect' || command === 'verifier' || command === 'vérifier') {
    if (parameters.length !== 1) scriptError(line, 'EXPECT attend exactement une condition cle=valeur.')
    return { kind: 'expect', ...parseCondition(parameters[0], line), line, source }
  }
  if (command === 'expect-error' || command === 'erreur-attendue') {
    if (!parameters[0]?.trim() || parameters[1]?.toLowerCase() !== 'debug') scriptError(line, 'EXPECT-ERROR attend texte DEBUG commande.')
    const nested = parseCommand(parameters.slice(1), line, source)
    if (nested.kind !== 'debug') scriptError(line, 'EXPECT-ERROR accepte uniquement une commande DEBUG.')
    return { kind: 'expect-debug-error', command: nested.command, expectedMessage: parameters[0]!, line, source }
  }
  if (command === 'debug' || command === 'commande') {
    const debugCommand = parameters[0]?.toLowerCase()
    if (debugCommand === 'godmode') {
      if (parameters.length !== 2 || !['on', 'off'].includes(parameters[1]?.toLowerCase() ?? '')) scriptError(line, 'DEBUG GODMODE attend ON ou OFF.')
      return { kind: 'debug', command: { kind: 'godmode', enabled: parameters[1]!.toLowerCase() === 'on' }, line, source }
    }
    if ((debugCommand === 'instant-kill' || debugCommand === 'instantkill') && parameters.length === 1) return { kind: 'debug', command: { kind: 'instant-kill' }, line, source }
    if (debugCommand === 'suicide' && parameters.length === 1) return { kind: 'debug', command: { kind: 'suicide' }, line, source }
    scriptError(line, `commande DEBUG inconnue: ${parameters.join(' ') || '(absente)'}.`)
  }
  if (command === 'bot') {
    const journey = parameters[0]?.toLowerCase()
    if (parameters.length < 1 || parameters.length > 2) scriptError(line, 'BOT attend OPENING, ZEPHYR, TOGEPI, HIVE, PLAIN ou FOG, puis un preset de campagne facultatif.')
    if (journey === 'opening' || journey === 'ouverture') {
      if (parameters.length !== 1) scriptError(line, 'BOT OPENING n’accepte aucun preset.')
      return { kind: 'bot', journey: 'opening', line, source }
    }
    if (journey === 'zephyr' || journey === 'zéphyr' || journey === 'premier-badge') {
      const preset = parameters[1]?.toLowerCase() ?? 'normal'
      if (!isRealtimeCampaignPresetId(preset)) scriptError(line, `preset de campagne inconnu: ${preset}.`)
      return { kind: 'bot', journey: 'zephyr', preset, line, source }
    }
    if (journey === 'togepi' || journey === 'togepi-egg' || journey === 'oeuf-togepi' || journey === 'œuf-togepi') {
      const preset = parameters[1]?.toLowerCase() ?? 'normal'
      if (!isRealtimeCampaignPresetId(preset)) scriptError(line, `preset de campagne inconnu: ${preset}.`)
      return { kind: 'bot', journey: 'togepi', preset, line, source }
    }
    if (journey === 'hive' || journey === 'hive-badge' || journey === 'badge-essaim' || journey === 'essaim') {
      const preset = parameters[1]?.toLowerCase() ?? 'normal'
      if (!isRealtimeCampaignPresetId(preset)) scriptError(line, `preset de campagne inconnu: ${preset}.`)
      return { kind: 'bot', journey: 'hive', preset, line, source }
    }
    if (journey === 'plain' || journey === 'plain-badge' || journey === 'badge-plaine' || journey === 'plaine') {
      const preset = parameters[1]?.toLowerCase() ?? 'normal'
      if (!isRealtimeCampaignPresetId(preset)) scriptError(line, `preset de campagne inconnu: ${preset}.`)
      return { kind: 'bot', journey: 'plain', preset, line, source }
    }
    if (journey === 'fog' || journey === 'fog-badge' || journey === 'badge-brume' || journey === 'brume') {
      const preset = parameters[1]?.toLowerCase() ?? 'normal'
      if (!isRealtimeCampaignPresetId(preset)) scriptError(line, `preset de campagne inconnu: ${preset}.`)
      return { kind: 'bot', journey: 'fog', preset, line, source }
    }
    scriptError(line, 'BOT attend OPENING, ZEPHYR, TOGEPI, HIVE, PLAIN ou FOG.')
  }
  if (command === 'report' || command === 'rapport') {
    const label = parameters.join(' ').trim()
    if (!label) scriptError(line, 'REPORT attend un libellé.')
    return { kind: 'report', label, line, source }
  }
  if (command === 'stop' || command === 'fin') {
    if (parameters.length > 0) scriptError(line, 'STOP n’accepte aucun paramètre.')
    return { kind: 'stop', line, source }
  }
  scriptError(line, `commande inconnue: ${rawCommand ?? '(ligne vide)'}.`)
}

export function parseRealtimeTestScript(text: string): RealtimeTestScript {
  if (text.length > maximumScriptCharacters) throw new Error(`Script de test trop volumineux (${text.length} caractères).`)
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  const effective = lines.map((source, index) => ({ source: stripInlineComment(source).trim(), line: index + 1 }))
    .filter(({ source }) => source.length > 0)
  const header = effective.shift()
  if (!header) throw new Error('Le script de test est vide.')
  const headerTokens = tokenize(header.source, header.line)
  if (headerTokens[0]?.toLowerCase() !== realtimeTestScriptMarker || headerTokens.length !== 2 || !headerTokens[1]?.trim()) {
    scriptError(header.line, `en-tête attendu: ${realtimeTestScriptMarker} nom-du-test.`)
  }
  const steps: RealtimeTestStep[] = []
  for (const entry of effective) {
    const tokens = tokenize(entry.source, entry.line)
    const repeated = tokens[0]?.toLowerCase() === 'repeat' || tokens[0]?.toLowerCase() === 'repeter' || tokens[0]?.toLowerCase() === 'répéter'
    const count = repeated ? Number.parseInt(tokens[1] ?? '', 10) : 1
    if (repeated && (!/^\d+$/.test(tokens[1] ?? '') || count < 1 || count > maximumRepeatCount)) scriptError(entry.line, `répétition hors limites (1 à ${maximumRepeatCount}).`)
    const commandTokens = repeated ? tokens.slice(2) : tokens
    if (commandTokens[0]?.toLowerCase() === 'repeat') scriptError(entry.line, 'les répétitions imbriquées sont interdites.')
    const step = parseCommand(commandTokens, entry.line, entry.source)
    for (let index = 0; index < count; index += 1) steps.push(step)
    if (steps.length > maximumExpandedSteps) scriptError(entry.line, `plus de ${maximumExpandedSteps} étapes après expansion.`)
  }
  if (steps.length === 0) scriptError(header.line, 'aucune étape exécutable.')
  return { name: headerTokens[1]!, steps }
}

function normalizedSnapshotValue(value: RealtimeTestSnapshotValue): string {
  return value === undefined ? 'undefined' : String(value).toLowerCase()
}

function readSnapshotValue(snapshot: RealtimeTestSnapshot, key: string): { found: boolean, value: RealtimeTestSnapshotValue } {
  const exactKey = Object.prototype.hasOwnProperty.call(snapshot, key)
    ? key
    : Object.keys(snapshot).find((candidate) => candidate.toLowerCase() === key.toLowerCase())
  return exactKey === undefined ? { found: false, value: undefined } : { found: true, value: snapshot[exactKey] }
}

function conditionMatches(snapshot: RealtimeTestSnapshot, key: string, expected: string): boolean {
  const actual = readSnapshotValue(snapshot, key)
  return actual.found && normalizedSnapshotValue(actual.value) === expected.toLowerCase()
}

function describeSnapshotValue(snapshot: RealtimeTestSnapshot, key: string): string {
  const actual = readSnapshotValue(snapshot, key)
  return actual.found ? normalizedSnapshotValue(actual.value) : '(clé absente)'
}

function boundedDiagnosticValue(value: RealtimeTestSnapshotValue, found: boolean): string {
  if (!found) return '∅'
  if (value === undefined) return 'undefined'
  const normalized = String(value)
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const escaped = (normalized || '""')
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll('=', '\\=')
  return escaped.length <= maximumDiagnosticValueCharacters
    ? escaped
    : `${escaped.slice(0, maximumDiagnosticValueCharacters - 1)}…`
}

function describeDiagnosticSnapshot(snapshot: RealtimeTestSnapshot): string {
  const entries = diagnosticSnapshotKeys.map((key) => {
    const observed = readSnapshotValue(snapshot, key)
    return `${key}=${boundedDiagnosticValue(observed.value, observed.found)}`
  })
  const rendered = `état{${entries.join('; ')}}`
  return rendered.length <= maximumDiagnosticSnapshotCharacters
    ? rendered
    : `${rendered.slice(0, maximumDiagnosticSnapshotCharacters - 2)}…}`
}

function failureWithSnapshot(reason: string, snapshot: RealtimeTestSnapshot): string {
  return `${reason} · ${describeDiagnosticSnapshot(snapshot)}`
}

function readBotRuntimeError(snapshot: RealtimeTestSnapshot): string | undefined {
  for (const key of ['botError', 'journeyError']) {
    const candidate = readSnapshotValue(snapshot, key)
    if (candidate.found && typeof candidate.value === 'string' && candidate.value.trim()) {
      return candidate.value.trim()
    }
  }
  return undefined
}

function describeJourneyCheckpoint(snapshot: RealtimeTestSnapshot): string {
  const checkpoint = readSnapshotValue(snapshot, 'journeyCheckpoint')
  return checkpoint.found && checkpoint.value !== undefined
    ? ` · jalon ${String(checkpoint.value)}`
    : ''
}

export function createRealtimeTestRunner(host: RealtimeTestRunnerHost): {
  start: (script: RealtimeTestScript, nowMs: number) => void
  tick: (nowMs: number) => void
  stop: (nowMs: number, message?: string) => void
  getState: () => RealtimeTestRunnerState
} {
  let script: RealtimeTestScript | undefined
  let status: RealtimeTestRunnerStatus = 'idle'
  let stepIndex = 0
  let startedAtMs: number | undefined
  let finishedAtMs: number | undefined
  let stepStartedAtMs: number | undefined
  let nextStepAtMs = 0
  let message = 'Aucun script chargé.'
  let held: { action: GameDigitalAction, inputId: string, releaseAtMs: number } | undefined
  let logs: RealtimeTestLogEntry[] = []
  let lastWaitingProgressAtMs: number | undefined
  let botJourneyStarted = false

  const state = (): RealtimeTestRunnerState => ({
    status,
    scriptName: script?.name,
    stepIndex,
    stepCount: script?.steps.length ?? 0,
    currentLine: status === 'running' ? script?.steps[stepIndex]?.line : undefined,
    startedAtMs,
    finishedAtMs,
    message,
    logs: [...logs],
  })
  const publish = (): void => host.onStateChange?.(state())
  const log = (atMs: number, level: RealtimeTestLogEntry['level'], entryMessage: string, line?: number): void => {
    logs.push({ atMs, line, level, message: entryMessage })
  }
  const releaseHeld = (nowMs: number): void => {
    if (!held) return
    host.dispatch(held.action, false, held.inputId)
    log(nowMs, 'info', `Relâche ${held.action}.`, script?.steps[stepIndex]?.line)
    held = undefined
  }
  const finish = (nextStatus: 'passed' | 'failed' | 'stopped', nowMs: number, finalMessage: string): void => {
    releaseHeld(nowMs)
    status = nextStatus
    finishedAtMs = nowMs
    message = finalMessage
    log(nowMs, nextStatus === 'failed' ? 'error' : 'checkpoint', finalMessage, script?.steps[stepIndex]?.line)
    publish()
  }
  const fail = (nowMs: number, step: RealtimeTestStep, reason: string): void => finish('failed', nowMs, `Ligne ${step.line}: ${reason}`)
  const publishWaitingProgress = (nowMs: number, nextMessage: string): void => {
    if (lastWaitingProgressAtMs !== undefined && nowMs - lastWaitingProgressAtMs < waitingProgressIntervalMs) return
    lastWaitingProgressAtMs = nowMs
    message = nextMessage
    publish()
  }
  const advance = (nowMs: number): void => {
    stepIndex += 1
    stepStartedAtMs = undefined
    lastWaitingProgressAtMs = undefined
    nextStepAtMs = nowMs
    if (script && stepIndex >= script.steps.length) finish('passed', nowMs, `${script.name}: ${script.steps.length} étapes réussies.`)
  }

  return {
    start(nextScript, nowMs) {
      releaseHeld(nowMs)
      script = nextScript
      status = 'running'
      stepIndex = 0
      startedAtMs = nowMs
      finishedAtMs = undefined
      stepStartedAtMs = undefined
      nextStepAtMs = nowMs
      message = `${nextScript.name}: démarrage de ${nextScript.steps.length} étapes.`
      logs = []
      lastWaitingProgressAtMs = undefined
      botJourneyStarted = false
      log(nowMs, 'checkpoint', message)
      publish()
    },
    tick(nowMs) {
      if (status !== 'running' || !script) return
      if (held) {
        if (nowMs < held.releaseAtMs) return
        releaseHeld(nowMs)
        advance(nowMs)
        nextStepAtMs = nowMs + 45
        return
      }
      if (nowMs < nextStepAtMs) return
      for (let immediate = 0; immediate < 100 && status === 'running'; immediate += 1) {
        const step = script.steps[stepIndex]
        if (!step) { finish('passed', nowMs, `${script.name}: toutes les étapes sont terminées.`); return }
        try {
          let observedSnapshot: RealtimeTestSnapshot | undefined
          if (botJourneyStarted) {
            observedSnapshot = host.readSnapshot()
            const botError = readBotRuntimeError(observedSnapshot)
            if (botError) {
              fail(nowMs, step, failureWithSnapshot(`le bot E2E a échoué : ${botError}`, observedSnapshot))
              return
            }
          }
          if (step.kind === 'press') {
            const inputId = `test-tape:${script.name}:${step.line}`
            host.dispatch(step.action, true, inputId)
            held = { action: step.action, inputId, releaseAtMs: nowMs + step.durationMs }
            message = `Étape ${stepIndex + 1}/${script.steps.length}, ligne ${step.line}: ${step.action}.`
            log(nowMs, 'info', `Appuie sur ${step.action} pendant ${step.durationMs} ms.`, step.line)
            publish()
            return
          }
          if (step.kind === 'wait') {
            stepStartedAtMs ??= nowMs
            const elapsedMs = Math.min(step.durationMs, Math.max(0, nowMs - stepStartedAtMs))
            if (elapsedMs < step.durationMs) {
              publishWaitingProgress(
                nowMs,
                `Étape ${stepIndex + 1}/${script.steps.length}, ligne ${step.line}: attente ${elapsedMs}/${step.durationMs} ms.`,
              )
              return
            }
            log(nowMs, 'info', `Attente de ${step.durationMs} ms terminée.`, step.line)
            advance(nowMs)
          } else if (step.kind === 'wait-for') {
            stepStartedAtMs ??= nowMs
            const snapshot = observedSnapshot ?? host.readSnapshot()
            if (conditionMatches(snapshot, step.key, step.expected)) {
              log(nowMs, 'checkpoint', `${step.key}=${step.expected} atteint.`, step.line)
              advance(nowMs)
            } else if (nowMs - stepStartedAtMs >= step.timeoutMs) {
              fail(nowMs, step, failureWithSnapshot(
                `${step.key} vaut ${describeSnapshotValue(snapshot, step.key)}, attendu ${step.expected} après ${step.timeoutMs} ms.`,
                snapshot,
              ))
            } else {
              publishWaitingProgress(
                nowMs,
                `Étape ${stepIndex + 1}/${script.steps.length}, ligne ${step.line}: attente ${step.key}=${step.expected} · actuel ${describeSnapshotValue(snapshot, step.key)} · ${Math.max(0, nowMs - stepStartedAtMs)}/${step.timeoutMs} ms${describeJourneyCheckpoint(snapshot)} · ${describeDiagnosticSnapshot(snapshot)}.`,
              )
              return
            }
          } else if (step.kind === 'press-until') {
            stepStartedAtMs ??= nowMs
            const snapshot = observedSnapshot ?? host.readSnapshot()
            if (conditionMatches(snapshot, step.key, step.expected)) {
              log(nowMs, 'checkpoint', `${step.key}=${step.expected} atteint par ${step.action}.`, step.line)
              advance(nowMs)
            } else if (nowMs - stepStartedAtMs >= step.timeoutMs) {
              fail(nowMs, step, failureWithSnapshot(
                `${step.key} vaut ${describeSnapshotValue(snapshot, step.key)}, attendu ${step.expected} après ${step.timeoutMs} ms.`,
                snapshot,
              ))
            } else {
              const inputId = `test-tape:${script.name}:${step.line}`
              host.dispatch(step.action, true, inputId)
              host.dispatch(step.action, false, inputId)
              nextStepAtMs = nowMs + Math.max(45, step.intervalMs)
              message = `Ligne ${step.line}: ${step.action} jusqu’à ${step.key}=${step.expected} · ${describeDiagnosticSnapshot(snapshot)}.`
              publish()
              return
            }
          } else if (step.kind === 'expect') {
            const snapshot = observedSnapshot ?? host.readSnapshot()
            if (!conditionMatches(snapshot, step.key, step.expected)) {
              fail(nowMs, step, failureWithSnapshot(
                `${step.key} vaut ${describeSnapshotValue(snapshot, step.key)}, attendu ${step.expected}.`,
                snapshot,
              ))
              return
            }
            log(nowMs, 'checkpoint', `${step.key}=${step.expected} vérifié.`, step.line)
            advance(nowMs)
          } else if (step.kind === 'expect-debug-error') {
            let received = ''
            try { host.executeDebugCommand(step.command) } catch (error) { received = error instanceof Error ? error.message : String(error) }
            if (!received.toLowerCase().includes(step.expectedMessage.toLowerCase())) {
              fail(nowMs, step, received ? `erreur « ${received} », fragment attendu « ${step.expectedMessage} ».` : `la commande DEBUG a réussi, erreur contenant « ${step.expectedMessage} » attendue.`)
              return
            }
            log(nowMs, 'checkpoint', `Erreur attendue reçue: ${received}`, step.line)
            advance(nowMs)
          } else if (step.kind === 'debug') {
            log(nowMs, 'checkpoint', host.executeDebugCommand(step.command), step.line)
            advance(nowMs)
          } else if (step.kind === 'bot') {
            const botMessage = host.startBotJourney(step.journey, step.preset)
            botJourneyStarted = true
            message = `Étape ${stepIndex + 1}/${script.steps.length}, ligne ${step.line}: ${botMessage}`
            log(nowMs, 'checkpoint', botMessage, step.line)
            advance(nowMs)
            if (status === 'running') publish()
          } else if (step.kind === 'report') {
            const snapshot = host.readSnapshot()
            host.recordCheckpoint?.(step.label, snapshot)
            log(nowMs, 'checkpoint', `Rapport: ${step.label}.`, step.line)
            advance(nowMs)
          } else {
            stepIndex += 1
            finish('passed', nowMs, `${script.name}: arrêt demandé à la ligne ${step.line}.`)
          }
        } catch (error) {
          fail(nowMs, step, error instanceof Error ? error.message : String(error))
        }
      }
    },
    stop(nowMs, stopMessage = 'Script arrêté manuellement.') {
      if (status === 'running') finish('stopped', nowMs, stopMessage)
    },
    getState: state,
  }
}

export function formatRealtimeTestReport(state: RealtimeTestRunnerState, snapshot: RealtimeTestSnapshot): string {
  const elapsed = state.startedAtMs === undefined ? 0 : (state.finishedAtMs ?? state.startedAtMs) - state.startedAtMs
  const lines = [
    realtimeTestScriptMarker,
    `script=${state.scriptName ?? 'none'}`,
    `status=${state.status}`,
    `steps=${state.stepIndex}/${state.stepCount}`,
    `elapsedMs=${Math.max(0, Math.round(elapsed))}`,
    `message=${state.message}`,
    '',
    '[snapshot]',
    ...Object.entries(snapshot).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${String(value)}`),
    '',
    '[journal]',
    ...state.logs.map((entry) => `${Math.round(entry.atMs)}ms${entry.line ? ` line=${entry.line}` : ''} ${entry.level.toUpperCase()} ${entry.message}`),
  ]
  return `${lines.join('\n')}\n`
}
