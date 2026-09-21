import { spawn } from 'node:child_process'
import console from 'node:console'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { URL } from 'node:url'
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

const chromeCandidates = [
  process.env.POKEMASTER_CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean)

const defaultTapes = [
  'debug-tests/campagne-premier-badge.txt',
  'debug-tests/campagne-oeuf-togepi.txt',
  'debug-tests/campagne-badge-essaim.txt',
  'debug-tests/campagne-badge-plaine.txt',
  'debug-tests/campagne-badge-brume.txt',
  'debug-tests/campagne-premier-badge-ngp-monotype-complet.txt',
  'debug-tests/campagne-premier-badge-ngp-duo-eevee.txt',
  'debug-tests/campagne-premier-badge-ngp-duo-solo-monotype.txt',
]

function usage() {
  return [
    'Usage: npm run test:live:headless -- --rom /chemin/jeu.nds [options] [scenario.txt ...]',
    '',
    'Options:',
    '  --url URL                  URL du serveur Vite déjà lancé (défaut: http://127.0.0.1:5173/?test=1)',
    '  --timeout-minutes N        délai maximal par scénario (défaut: 26)',
    '  --reduced-motion           émule la préférence système d’animations réduites',
    '  --rom PATH                 ROM locale à charger (obligatoire)',
    '  --help                     affiche cette aide',
    '',
    'Sans scénario explicite, les huit parcours de campagne sont exécutés.',
  ].join('\n')
}

function parseArguments(argv) {
  const options = {
    url: 'http://127.0.0.1:5173/?test=1',
    timeoutMs: 26 * 60_000,
    reducedMotion: false,
    rom: undefined,
    tapes: [],
  }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--help') {
      console.log(usage())
      process.exit(0)
    }
    if (value === '--rom') options.rom = argv[++index]
    else if (value === '--url') options.url = argv[++index]
    else if (value === '--reduced-motion') options.reducedMotion = true
    else if (value === '--timeout-minutes') {
      const minutes = Number(argv[++index])
      if (!Number.isFinite(minutes) || minutes <= 0) throw new Error('--timeout-minutes doit être un nombre positif.')
      options.timeoutMs = minutes * 60_000
    } else if (value.startsWith('--')) throw new Error(`Option inconnue: ${value}`)
    else options.tapes.push(value)
  }
  if (!options.rom) throw new Error(`--rom est obligatoire.\n\n${usage()}`)
  if (options.tapes.length === 0) options.tapes = defaultTapes
  return options
}

async function existingPath(candidate, label) {
  const resolved = path.resolve(candidate)
  try {
    await access(resolved)
  } catch {
    throw new Error(`${label} introuvable: ${resolved}`)
  }
  return resolved
}

async function resolveChrome() {
  for (const candidate of chromeCandidates) {
    try {
      await access(candidate)
      return candidate
    } catch {
      // Essaie le candidat suivant.
    }
  }
  throw new Error('Chrome/Chromium est introuvable. Définissez POKEMASTER_CHROME_PATH.')
}

async function reservePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : undefined
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  if (!port) throw new Error('Impossible de réserver le port de débogage Chrome.')
  return port
}

async function waitFor(read, accept, timeoutMs, label, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs
  let latest
  while (Date.now() < deadline) {
    latest = await read()
    if (accept(latest)) return latest
    await delay(intervalMs)
  }
  throw new Error(`${label} (dernier état: ${JSON.stringify(latest)})`)
}

async function evaluate(cdp, expression) {
  const response = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? 'Évaluation JavaScript échouée.')
  return response.result.value
}

async function setFileInput(cdp, selector, filePath) {
  const document = await cdp.send('DOM.getDocument', { depth: -1, pierce: true })
  const result = await cdp.send('DOM.querySelector', { nodeId: document.root.nodeId, selector })
  if (!result.nodeId) throw new Error(`Champ fichier absent: ${selector}`)
  await cdp.send('DOM.setFileInputFiles', { nodeId: result.nodeId, files: [filePath] })
}

async function readPanel(cdp) {
  return evaluate(cdp, `(() => {
    const status = document.querySelector('[data-realtime-test-status]')
    const progress = document.querySelector('[data-realtime-test-progress]')
    const run = document.querySelector('[data-realtime-test-run]')
    const file = document.querySelector('[data-realtime-test-file]')
    return {
      readyState: document.readyState,
      state: status?.dataset.state ?? 'absent',
      message: status?.value ?? status?.textContent ?? '',
      step: Number(progress?.value ?? 0),
      stepCount: Number(progress?.max ?? 0),
      runDisabled: Boolean(run?.disabled),
      fileDisabled: Boolean(file?.disabled),
      visibility: document.visibilityState,
      runtimeStatus: document.querySelector('#runtime-status')?.textContent ?? '',
    }
  })()`)
}

async function runTape(cdp, diagnostics, options, tape, index) {
  diagnostics.beginTape(path.basename(tape), index, options.tapes.length)
  const readRememberedPanel = async (stage) => {
    diagnostics.markStage(stage)
    const panel = await readPanel(cdp)
    diagnostics.recordPanel(stage, panel)
    return panel
  }
  const scenarioUrl = new URL(options.url)
  scenarioUrl.searchParams.set('test', '1')
  scenarioUrl.searchParams.set('liveRun', `${Date.now()}-${index}`)
  diagnostics.markStage('navigation')
  await cdp.send('Page.navigate', { url: scenarioUrl.href })
  await waitFor(
    () => readRememberedPanel('panel-initialization'),
    (state) => state.readyState === 'complete' && state.state !== 'absent',
    30_000,
    'Le panneau temps réel ne s’est pas initialisé.',
  )

  console.log(`[${index + 1}/${options.tapes.length}] Chargement ROM · ${path.basename(tape)}`)
  diagnostics.markStage('rom-selection')
  await setFileInput(cdp, '#rom-picker', options.rom)
  await waitFor(
    () => readRememberedPanel('rom-loading'),
    (state) => !state.fileDisabled,
    4 * 60_000,
    'La ROM n’a pas rendu le banc temps réel disponible.',
    500,
  )

  diagnostics.markStage('scenario-selection')
  await setFileInput(cdp, '[data-realtime-test-file]', tape)
  const prepared = await waitFor(
    () => readRememberedPanel('scenario-preparation'),
    (state) => !state.runDisabled && state.state === 'idle',
    15_000,
    'Le scénario TXT n’a pas été préparé.',
  )
  console.log(`[${index + 1}/${options.tapes.length}] ${prepared.message}`)
  diagnostics.markStage('scenario-start')
  await evaluate(cdp, `document.querySelector('[data-realtime-test-run]').click()`)

  const start = Date.now()
  let lastMessage = ''
  let lastHeartbeat = 0
  const final = await waitFor(
    async () => {
      const state = await readRememberedPanel('scenario-running')
      const now = Date.now()
      if (state.message !== lastMessage || now - lastHeartbeat >= 30_000) {
        const elapsed = Math.round((now - start) / 1000)
        console.log(`[${index + 1}/${options.tapes.length}] ${elapsed}s · ${state.step}/${state.stepCount} · ${state.state} · ${state.message}`)
        lastMessage = state.message
        lastHeartbeat = now
      }
      return state
    },
    (state) => state.state === 'passed' || state.state === 'failed' || state.state === 'stopped',
    options.timeoutMs,
    `Le scénario ${path.basename(tape)} a dépassé son délai.`,
    500,
  )
  const elapsedMs = Date.now() - start
  diagnostics.recordPanel('scenario-finished', final)
  if (final.state !== 'passed') throw new Error(`${path.basename(tape)}: ${final.state} — ${final.message}`)
  console.log(`[${index + 1}/${options.tapes.length}] PASS · ${(elapsedMs / 1000).toFixed(1)}s · ${final.message}`)
  return { tape: path.basename(tape), elapsedMs, message: final.message }
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  options.rom = await existingPath(options.rom, 'ROM')
  options.tapes = await Promise.all(options.tapes.map((tape) => existingPath(tape, 'Scénario')))
  const response = await globalThis.fetch(options.url)
  if (!response.ok) throw new Error(`Le serveur existant répond HTTP ${response.status}: ${options.url}`)

  const chromePath = await resolveChrome()
  const port = await reservePort()
  const profilePrefix = path.join(tmpdir(), 'pokemaster-live-audit-')
  const profile = await mkdtemp(profilePrefix)
  const chromeErrors = new TimestampedLineBuffer()
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  const chromeMonitor = createChromeExitMonitor(chrome)
  chrome.stderr.setEncoding('utf8')
  chrome.stderr.on('data', (chunk) => chromeErrors.append(chunk))

  let cdp
  const diagnostics = new HarnessDiagnostics()
  const cleanup = createIdempotentCleanup(async () => {
    await runCleanupSteps([
      () => cdp?.close(),
      () => stopChrome(chrome, chromeMonitor),
      async () => {
        if (profile.startsWith(profilePrefix)) await rm(profile, { recursive: true, force: true })
      },
    ])
  })
  const signalCleanup = installSignalCleanup({ cleanup })
  try {
    await raceWithChromeExit((async () => {
      let target
      try {
        target = await waitFor(
          async () => {
            try {
              const targets = await globalThis.fetch(`http://127.0.0.1:${port}/json/list`).then((entry) => entry.json())
              return targets.find((entry) => entry.type === 'page')
            } catch {
              return undefined
            }
          },
          Boolean,
          20_000,
          'Chrome n’a pas ouvert son port CDP.',
        )
      } catch (cause) {
        throw new HarnessInfrastructureError(
          'browser-startup',
          'Chrome n’a pas ouvert son port CDP dans le délai imparti.',
          { cause, details: { port } },
        )
      }
      cdp = new CdpClient(target.webSocketDebuggerUrl)
      await cdp.connect()
      await cdp.send('Page.enable')
      await cdp.send('Runtime.enable')
      await cdp.send('DOM.enable')
      if (options.reducedMotion) {
        await cdp.send('Emulation.setEmulatedMedia', {
          features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
        })
        console.log('Chrome émule prefers-reduced-motion: reduce.')
      }

      const results = []
      for (let index = 0; index < options.tapes.length; index += 1) {
        results.push(await runTape(cdp, diagnostics, options, options.tapes[index], index))
      }
      const totalMs = results.reduce((sum, result) => sum + result.elapsedMs, 0)
      console.log(JSON.stringify({ status: 'passed', totalMs, results }, null, 2))
    })(), chromeMonitor)
  } catch (error) {
    const diagnosed = await enrichInfrastructureError(error, { diagnostics, monitor: chromeMonitor })
    const chromeOutput = chromeErrors.toString()
    if (chromeOutput) console.error(`Dernières sorties Chrome:\n${chromeOutput}`)
    throw diagnosed
  } finally {
    try {
      await cleanup()
    } finally {
      signalCleanup.dispose()
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
})
