import { Buffer } from 'node:buffer'
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  CdpClient,
  createChromeExitMonitor,
  createIdempotentCleanup,
  enrichInfrastructureError,
  HarnessDiagnostics,
  HarnessInfrastructureError,
  installSignalCleanup,
  raceWithChromeExit,
  runCleanupSteps,
  stopChrome,
  TimestampedLineBuffer,
} from './live-debug-harness-runtime.mjs'

class FakeWebSocket {
  constructor() {
    this.listeners = new Map()
    this.readyState = 0
    this.sent = []
  }

  addEventListener(type, listener, options = {}) {
    const listeners = this.listeners.get(type) ?? []
    listeners.push({ listener, once: Boolean(options.once) })
    this.listeners.set(type, listeners)
  }

  dispatch(type, event = {}) {
    if (type === 'open') this.readyState = 1
    if (type === 'close') this.readyState = 3
    const listeners = [...(this.listeners.get(type) ?? [])]
    for (const entry of listeners) {
      entry.listener(event)
      if (entry.once) {
        this.listeners.set(type, (this.listeners.get(type) ?? []).filter((candidate) => candidate !== entry))
      }
    }
  }

  send(payload) {
    this.sent.push(payload)
  }

  close() {
    this.dispatch('close', { code: 1000, reason: 'arrêt du test', wasClean: true })
  }
}

class FakeChrome extends EventEmitter {
  constructor(onKill) {
    super()
    this.exitCode = null
    this.signalCode = null
    this.kills = []
    this.onKill = onKill
  }

  kill(signal) {
    this.kills.push(signal)
    this.onKill?.(signal, this)
    return true
  }

  finish(code, signal) {
    this.exitCode = code
    this.signalCode = signal
    this.emit('exit', code, signal)
  }
}

async function connectedClient() {
  const socket = new FakeWebSocket()
  const client = new CdpClient('ws://test', {
    createWebSocket: () => socket,
    openState: 1,
  })
  const connecting = client.connect()
  socket.dispatch('open')
  await connecting
  return { client, socket }
}

describe('transport du harness CDP', () => {
  it('conserve le code, la raison et la propreté d’une fermeture de cible', async () => {
    const { client, socket } = await connectedClient()
    const pending = client.send('Runtime.evaluate')

    socket.dispatch('close', { code: 1006, reason: 'renderer disparu', wasClean: false })

    await expect(pending).rejects.toMatchObject({
      details: { code: 1006, reason: 'renderer disparu', wasClean: false },
      kind: 'target-closed',
    })
    await expect(client.send('Page.enable')).rejects.toMatchObject({ kind: 'target-closed' })
  })

  it('distingue une erreur de transport WebSocket d’une fermeture de cible', async () => {
    const { client, socket } = await connectedClient()
    const pending = client.send('DOM.getDocument')

    socket.dispatch('error', { message: 'ECONNRESET' })
    socket.dispatch('close', { code: 1006, reason: '', wasClean: false })

    await expect(pending).rejects.toMatchObject({
      details: { message: 'ECONNRESET' },
      kind: 'transport-error',
    })
  })
})

describe('diagnostic de sortie Chrome', () => {
  it('absorbe la course fermeture CDP puis sortie du navigateur', async () => {
    const chrome = new FakeChrome()
    const monitor = createChromeExitMonitor(chrome)
    let now = 1_000
    const diagnostics = new HarnessDiagnostics({ now: () => now })
    diagnostics.beginTape('campagne-premier-badge.txt', 0, 4)
    now = 6_250
    diagnostics.recordPanel('scenario-running', {
      message: 'zephyr-badge',
      state: 'paused-for-battle',
      step: 2,
      stepCount: 16,
    })
    const transportError = new HarnessInfrastructureError('target-closed', 'Cible CDP fermée.')

    const diagnosedPromise = enrichInfrastructureError(transportError, { diagnostics, monitor })
    chrome.finish(null, 'SIGKILL')
    const diagnosed = await diagnosedPromise

    expect(diagnosed).toMatchObject({
      details: {
        diagnostics: {
          elapsedMs: 5_250,
          index: 1,
          lastPanel: {
            message: 'zephyr-badge',
            state: 'paused-for-battle',
            step: 2,
            stepCount: 16,
          },
          tape: 'campagne-premier-badge.txt',
          total: 4,
        },
        termination: { code: null, kind: 'exit', signal: 'SIGKILL' },
      },
      kind: 'browser-exit',
    })
    expect(diagnosed.message).toContain('Chrome s’est arrêté (code=null, signal=SIGKILL).')
    expect(diagnosed.message).toContain('paused-for-battle')
  })

  it('interrompt immédiatement le travail si Chrome sort en premier', async () => {
    const chrome = new FakeChrome()
    const monitor = createChromeExitMonitor(chrome)
    const never = new Promise(() => {})
    const raced = raceWithChromeExit(never, monitor)

    chrome.finish(9, null)

    await expect(raced).rejects.toMatchObject({
      details: { termination: { code: 9, kind: 'exit', signal: null } },
      kind: 'browser-exit',
    })
  })

  it('borne et horodate les sorties stderr sans perdre la fin utile', () => {
    const output = new TimestampedLineBuffer({
      maximumBytes: 120,
      maximumLines: 2,
      now: () => '2026-09-07T21:30:00.000Z',
    })
    output.append('ancienne\nintermédiaire\nfatale\n')

    expect(output.toString()).toBe([
      '[2026-09-07T21:30:00.000Z] intermédiaire',
      '[2026-09-07T21:30:00.000Z] fatale',
    ].join('\n'))

    const bounded = new TimestampedLineBuffer({
      maximumBytes: 48,
      maximumLines: 10,
      now: () => 'T',
    })
    bounded.append(`${'x'.repeat(200)}\n`)
    expect(Buffer.byteLength(bounded.toString())).toBeLessThanOrEqual(48)
    expect(bounded.toString()).toContain('…')
  })
})

describe('arrêt et nettoyage du navigateur', () => {
  it('considère signalCode comme une sortie déjà achevée', async () => {
    const chrome = new FakeChrome()
    chrome.signalCode = 'SIGKILL'
    const monitor = createChromeExitMonitor(chrome)

    await stopChrome(chrome, monitor)

    expect(chrome.kills).toEqual([])
  })

  it('écoute la sortie avant SIGTERM et n’envoie pas de SIGKILL si elle arrive', async () => {
    const chrome = new FakeChrome((signal, process) => process.finish(null, signal))
    const monitor = createChromeExitMonitor(chrome)

    const termination = await stopChrome(chrome, monitor)

    expect(chrome.kills).toEqual(['SIGTERM'])
    expect(termination).toMatchObject({ kind: 'exit', signal: 'SIGTERM' })
  })

  it('force après le délai de grâce quand SIGTERM ne termine pas Chrome', async () => {
    const chrome = new FakeChrome((signal, process) => {
      if (signal === 'SIGKILL') process.finish(null, signal)
    })
    const monitor = createChromeExitMonitor(chrome, { wait: async () => undefined })

    const termination = await stopChrome(chrome, monitor)

    expect(chrome.kills).toEqual(['SIGTERM', 'SIGKILL'])
    expect(termination).toMatchObject({ kind: 'exit', signal: 'SIGKILL' })
  })

  it('nettoie une seule fois sur SIGINT/SIGTERM concurrents avant de sortir', async () => {
    const emitter = new EventEmitter()
    const cleanup = vi.fn(async () => undefined)
    const exit = vi.fn(async () => undefined)
    const controller = installSignalCleanup({ cleanup, emitter, exit })

    emitter.emit('SIGINT')
    emitter.emit('SIGTERM')
    await controller.completion
    controller.dispose()

    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(130, 'SIGINT')
    expect(emitter.listenerCount('SIGINT')).toBe(0)
    expect(emitter.listenerCount('SIGTERM')).toBe(0)
  })

  it('rend aussi le finally et le signal idempotents', async () => {
    const cleanupWork = vi.fn(async () => 'nettoyé')
    const cleanup = createIdempotentCleanup(cleanupWork)

    await Promise.all([cleanup(), cleanup(), cleanup()])

    expect(cleanupWork).toHaveBeenCalledTimes(1)
  })

  it('tente la suppression du profil même si une étape précédente échoue', async () => {
    const profileRemoval = vi.fn(async () => undefined)

    await expect(runCleanupSteps([
      async () => {
        throw new Error('fermeture CDP impossible')
      },
      async () => {
        throw new Error('arrêt Chrome impossible')
      },
      profileRemoval,
    ])).rejects.toMatchObject({
      errors: [
        expect.objectContaining({ message: 'fermeture CDP impossible' }),
        expect.objectContaining({ message: 'arrêt Chrome impossible' }),
      ],
    })
    expect(profileRemoval).toHaveBeenCalledOnce()
  })
})
