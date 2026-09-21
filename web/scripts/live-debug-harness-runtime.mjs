import { Buffer } from 'node:buffer'
import console from 'node:console'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'

const defaultExitGraceMs = 750
const defaultStopGraceMs = 5_000
const defaultKillGraceMs = 1_000

export class HarnessInfrastructureError extends Error {
  constructor(kind, message, { cause, details } = {}) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'HarnessInfrastructureError'
    this.kind = kind
    this.details = details
  }
}

function describeSocketError(event) {
  if (typeof event?.message === 'string' && event.message) return event.message
  if (event?.error instanceof Error) return event.error.message
  return 'erreur WebSocket sans détail'
}

function createTransportError(event) {
  const message = describeSocketError(event)
  return new HarnessInfrastructureError(
    'transport-error',
    `Transport CDP en erreur: ${message}.`,
    { details: { message } },
  )
}

function createTargetClosedError(event) {
  const code = Number.isInteger(event?.code) ? event.code : undefined
  const reason = typeof event?.reason === 'string' ? event.reason : ''
  const wasClean = typeof event?.wasClean === 'boolean' ? event.wasClean : undefined
  const renderedCode = code === undefined ? 'inconnu' : String(code)
  const renderedReason = reason || 'aucune'
  const renderedClean = wasClean === undefined ? 'inconnu' : wasClean ? 'oui' : 'non'
  return new HarnessInfrastructureError(
    'target-closed',
    `Cible CDP fermée (code=${renderedCode}, propre=${renderedClean}, raison=${renderedReason}).`,
    { details: { code, reason, wasClean } },
  )
}

export class CdpClient {
  constructor(url, {
    createWebSocket = (address) => new globalThis.WebSocket(address),
    openState = globalThis.WebSocket?.OPEN ?? 1,
  } = {}) {
    this.url = url
    this.createWebSocket = createWebSocket
    this.openState = openState
    this.nextId = 1
    this.pending = new Map()
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }

  rememberFailure(error) {
    if (!this.failure) this.failure = error
    this.rejectPending(this.failure)
    return this.failure
  }

  async connect() {
    this.socket = this.createWebSocket(this.url)
    await new Promise((resolve, reject) => {
      let settled = false
      const rejectConnection = (error) => {
        if (settled) return
        settled = true
        reject(error)
      }

      this.socket.addEventListener('open', () => {
        if (settled) return
        settled = true
        resolve()
      }, { once: true })
      this.socket.addEventListener('message', (event) => {
        let message
        try {
          message = JSON.parse(String(event.data))
        } catch (cause) {
          const error = new HarnessInfrastructureError(
            'transport-error',
            'Le transport CDP a reçu un message JSON invalide.',
            { cause },
          )
          rejectConnection(this.rememberFailure(error))
          return
        }
        if (!message.id) return
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`))
        else pending.resolve(message.result)
      })
      this.socket.addEventListener('error', (event) => {
        rejectConnection(this.rememberFailure(createTransportError(event)))
      })
      this.socket.addEventListener('close', (event) => {
        rejectConnection(this.rememberFailure(createTargetClosedError(event)))
      })
    })
  }

  send(method, params = {}) {
    if (!this.socket || this.socket.readyState !== this.openState) {
      return Promise.reject(this.failure ?? new HarnessInfrastructureError(
        'transport-error',
        'Connexion CDP indisponible.',
        { details: { readyState: this.socket?.readyState } },
      ))
    }
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject })
      try {
        this.socket.send(JSON.stringify({ id, method, params }))
      } catch (cause) {
        this.pending.delete(id)
        const error = new HarnessInfrastructureError(
          'transport-error',
          `Échec d’envoi CDP pour ${method}.`,
          { cause, details: { method } },
        )
        reject(this.rememberFailure(error))
      }
    })
  }

  close() {
    this.socket?.close()
  }
}

function currentChromeTermination(chrome, now) {
  if (chrome.exitCode === null && chrome.signalCode === null) return undefined
  return {
    at: now(),
    code: chrome.exitCode,
    kind: 'exit',
    signal: chrome.signalCode,
  }
}

export function createChromeExitMonitor(chrome, {
  now = Date.now,
  wait = (timeoutMs, signal) => delay(timeoutMs, undefined, { signal }),
} = {}) {
  let current = currentChromeTermination(chrome, now)
  let resolveTermination
  const promise = new Promise((resolve) => {
    resolveTermination = resolve
  })

  const capture = (termination) => {
    if (current) return
    current = termination
    resolveTermination(termination)
  }
  chrome.once('error', (error) => capture({
    at: now(),
    error: error instanceof Error ? error.message : String(error),
    kind: 'spawn-error',
  }))
  chrome.once('exit', (code, signal) => capture({
    at: now(),
    code,
    kind: 'exit',
    signal,
  }))
  if (current) resolveTermination(current)

  return {
    get current() {
      return current
    },
    promise,
    async waitFor(timeoutMs) {
      if (current) return current
      const controller = new globalThis.AbortController()
      try {
        return await Promise.race([
          promise,
          wait(timeoutMs, controller.signal).then(() => undefined),
        ])
      } finally {
        controller.abort()
      }
    },
  }
}

function formatChromeTermination(termination) {
  if (termination.kind === 'spawn-error') {
    return `Chrome n’a pas pu démarrer: ${termination.error}.`
  }
  const code = termination.code ?? 'null'
  const signal = termination.signal ?? 'aucun'
  return `Chrome s’est arrêté (code=${code}, signal=${signal}).`
}

export function createBrowserExitError(termination, cause) {
  return new HarnessInfrastructureError(
    'browser-exit',
    formatChromeTermination(termination),
    {
      cause,
      details: {
        previousTransport: cause instanceof HarnessInfrastructureError ? cause.details : undefined,
        termination,
      },
    },
  )
}

export function raceWithChromeExit(work, monitor) {
  return Promise.race([
    Promise.resolve(work),
    monitor.promise.then((termination) => {
      throw createBrowserExitError(termination)
    }),
  ])
}

function clonePanel(panel) {
  return panel ? { ...panel } : undefined
}

export class HarnessDiagnostics {
  constructor({ now = Date.now } = {}) {
    this.now = now
  }

  beginTape(tape, index, total) {
    const startedAt = this.now()
    this.current = {
      index: index + 1,
      lastPanel: undefined,
      stage: 'navigation',
      startedAt,
      tape,
      total,
    }
  }

  markStage(stage) {
    if (this.current) this.current.stage = stage
  }

  recordPanel(stage, panel) {
    if (!this.current) return
    this.current.stage = stage
    this.current.lastPanel = clonePanel(panel)
  }

  snapshot() {
    if (!this.current) return undefined
    return {
      elapsedMs: Math.max(0, this.now() - this.current.startedAt),
      index: this.current.index,
      lastPanel: clonePanel(this.current.lastPanel),
      stage: this.current.stage,
      tape: this.current.tape,
      total: this.current.total,
    }
  }
}

function attachDiagnostics(error, diagnostics) {
  const snapshot = diagnostics?.snapshot?.() ?? diagnostics
  if (!snapshot) return error
  return new HarnessInfrastructureError(
    error.kind,
    `${error.message}\nContexte harness: ${JSON.stringify(snapshot)}`,
    {
      cause: error,
      details: { ...error.details, diagnostics: snapshot },
    },
  )
}

export async function enrichInfrastructureError(error, {
  diagnostics,
  exitGraceMs = defaultExitGraceMs,
  monitor,
} = {}) {
  if (!(error instanceof HarnessInfrastructureError)) return error
  let diagnosed = error
  if (monitor && error.kind !== 'browser-exit') {
    const termination = monitor.current ?? await monitor.waitFor(exitGraceMs)
    if (termination) diagnosed = createBrowserExitError(termination, error)
  }
  return attachDiagnostics(diagnosed, diagnostics)
}

function trimUtf8Tail(value, maximumBytes) {
  const encoded = Buffer.from(value)
  if (encoded.byteLength <= maximumBytes) return value
  const ellipsis = Buffer.from('…')
  const available = Math.max(0, maximumBytes - ellipsis.byteLength)
  const tail = encoded.subarray(encoded.byteLength - available).toString('utf8').replace(/^\uFFFD/, '')
  return `…${tail}`
}

export class TimestampedLineBuffer {
  constructor({
    maximumBytes = 1024 * 1024,
    maximumLines = 200,
    now = () => new Date().toISOString(),
  } = {}) {
    this.maximumBytes = maximumBytes
    this.maximumLines = maximumLines
    this.now = now
    this.lines = []
    this.byteLength = 0
    this.partial = ''
    this.partialTimestamp = undefined
  }

  append(chunk) {
    const incoming = String(chunk)
    if (!incoming) return
    if (!this.partialTimestamp) this.partialTimestamp = this.now()
    const parts = `${this.partial}${incoming}`.split(/\r?\n/)
    this.partial = parts.pop() ?? ''
    const timestamp = this.partialTimestamp
    this.partialTimestamp = this.partial ? this.now() : undefined
    for (const line of parts) this.pushLine(timestamp, line)
    this.partial = trimUtf8Tail(this.partial, this.maximumBytes)
  }

  pushLine(timestamp, line) {
    const rendered = trimUtf8Tail(`[${timestamp}] ${line}`, this.maximumBytes)
    const bytes = Buffer.byteLength(rendered)
    this.lines.push({ bytes, rendered })
    this.byteLength += bytes
    while (this.lines.length > this.maximumLines || this.byteLength > this.maximumBytes) {
      const removed = this.lines.shift()
      this.byteLength -= removed?.bytes ?? 0
    }
  }

  toString() {
    const retainedLineCount = Math.max(0, this.maximumLines - (this.partial ? 1 : 0))
    const retainedLines = retainedLineCount === 0 ? [] : this.lines.slice(-retainedLineCount)
    const rendered = retainedLines.map((line) => line.rendered)
    if (this.partial) rendered.push(`[${this.partialTimestamp ?? this.now()}] ${this.partial}`)
    return trimUtf8Tail(rendered.join('\n'), this.maximumBytes)
  }
}

export function createIdempotentCleanup(cleanup) {
  let pending
  return () => {
    pending ??= Promise.resolve().then(cleanup)
    return pending
  }
}

export async function runCleanupSteps(steps) {
  const errors = []
  for (const step of steps) {
    try {
      await step()
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length > 0) {
    throw new globalThis.AggregateError(errors, 'Le nettoyage du harness est incomplet.')
  }
}

export function signalExitCode(signal) {
  return signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1
}

export function installSignalCleanup({
  cleanup,
  emitter = process,
  exit = (code) => process.exit(code),
  reportError = (error) => console.error(error),
  signals = ['SIGINT', 'SIGTERM'],
}) {
  let completion
  let receivedSignal
  const handlers = new Map()

  const request = (signal) => {
    if (completion) return completion
    receivedSignal = signal
    completion = (async () => {
      try {
        await cleanup()
      } catch (error) {
        reportError(error)
      }
      return exit(signalExitCode(signal), signal)
    })()
    return completion
  }

  for (const signal of signals) {
    const handler = () => void request(signal)
    handlers.set(signal, handler)
    emitter.on(signal, handler)
  }

  return {
    dispose() {
      for (const [signal, handler] of handlers) emitter.off(signal, handler)
    },
    get completion() {
      return completion
    },
    get receivedSignal() {
      return receivedSignal
    },
    request,
  }
}

function hasChromeTerminated(chrome) {
  return chrome.exitCode !== null || chrome.signalCode !== null
}

export async function stopChrome(chrome, monitor, {
  killGraceMs = defaultKillGraceMs,
  stopGraceMs = defaultStopGraceMs,
} = {}) {
  if (!chrome || hasChromeTerminated(chrome)) return monitor?.current
  chrome.kill('SIGTERM')
  const gracefulExit = await monitor.waitFor(stopGraceMs)
  if (gracefulExit || hasChromeTerminated(chrome)) return gracefulExit ?? monitor.current
  chrome.kill('SIGKILL')
  return monitor.waitFor(killGraceMs)
}
