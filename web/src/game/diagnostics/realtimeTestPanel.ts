import type { GameDigitalAction } from '../../gameInput'
import type { RealtimeCampaignPresetId } from './realtimeNewGamePlusPresets'
import {
  createRealtimeTestRunner,
  formatRealtimeTestReport,
  parseRealtimeTestScript,
  type RealtimeTestDebugCommand,
  type RealtimeTestBotJourney,
  type RealtimeTestRunnerState,
  type RealtimeTestScript,
  type RealtimeTestSnapshot,
} from './realtimeTestScript'

export type RealtimeTestPanelHost = Readonly<{
  dispatch: (action: GameDigitalAction, pressed: boolean, inputId: string) => void
  readSnapshot: () => RealtimeTestSnapshot
  executeDebugCommand: (command: RealtimeTestDebugCommand) => string
  startBotJourney: (journey: RealtimeTestBotJourney, preset?: RealtimeCampaignPresetId) => string
  stopBotJourney?: () => void
}>

function requirePanelElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector)
  if (!element) throw new Error(`Contrôle du banc temps réel absent: ${selector}`)
  return element
}

function safeFileName(value: string): string {
  return value.normalize('NFKD').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'test'
}

export function createRealtimeTestPanel(root: HTMLElement, host: RealtimeTestPanelHost): {
  tick: (nowMs: number) => void
  setReady: (ready: boolean) => void
  stop: (message?: string) => void
  isRunning: () => boolean
} {
  const file = requirePanelElement<HTMLInputElement>(root, '[data-realtime-test-file]')
  const run = requirePanelElement<HTMLButtonElement>(root, '[data-realtime-test-run]')
  const stop = requirePanelElement<HTMLButtonElement>(root, '[data-realtime-test-stop]')
  const download = requirePanelElement<HTMLButtonElement>(root, '[data-realtime-test-report]')
  const status = requirePanelElement<HTMLOutputElement>(root, '[data-realtime-test-status]')
  const progress = requirePanelElement<HTMLProgressElement>(root, '[data-realtime-test-progress]')
  const commandButtons = [...root.querySelectorAll<HTMLButtonElement>('[data-realtime-debug-command]')]
  const godModeButton = commandButtons.find((button) => button.dataset.realtimeDebugCommand === 'godmode')
  let ready = false
  let loaded: RealtimeTestScript | undefined
  let loadedFileName = ''
  let fileRevision = 0
  let checkpoints: Array<{ label: string, snapshot: RealtimeTestSnapshot }> = []

  const renderState = (state: RealtimeTestRunnerState): void => {
    if (state.status === 'failed' || state.status === 'stopped') host.stopBotJourney?.()
    status.value = state.message
    status.dataset.state = state.status
    progress.max = Math.max(1, state.stepCount)
    progress.value = Math.min(state.stepCount, state.stepIndex)
    stop.disabled = state.status !== 'running'
    run.disabled = !ready || !loaded || state.status === 'running'
    download.disabled = state.status === 'idle' && checkpoints.length === 0
    commandButtons.forEach((button) => { button.disabled = !ready || state.status === 'running' })
  }
  const syncGodModeButton = (): void => godModeButton?.setAttribute('aria-pressed', String(host.readSnapshot().godmode === true))
  const runner = createRealtimeTestRunner({
    dispatch: host.dispatch,
    readSnapshot: host.readSnapshot,
    executeDebugCommand: host.executeDebugCommand,
    startBotJourney: host.startBotJourney,
    recordCheckpoint: (label, snapshot) => { checkpoints.push({ label, snapshot }) },
    onStateChange: renderState,
  })

  const executeManualCommand = (command: RealtimeTestDebugCommand): void => {
    try {
      status.value = host.executeDebugCommand(command)
      status.dataset.state = 'passed'
    } catch (error) {
      status.value = error instanceof Error ? error.message : String(error)
      status.dataset.state = 'failed'
    }
  }

  file.addEventListener('change', () => {
    const selected = file.files?.[0]
    const revision = ++fileRevision
    runner.stop(performance.now(), 'Script remplacé avant sa fin.')
    loaded = undefined
    loadedFileName = ''
    checkpoints = []
    if (!selected) { renderState(runner.getState()); return }
    status.value = `Lecture de ${selected.name}…`
    void selected.text().then((text) => {
      if (revision !== fileRevision) return
      loaded = parseRealtimeTestScript(text)
      loadedFileName = selected.name
      status.value = `${loaded.name}: ${loaded.steps.length} étapes prêtes.`
      status.dataset.state = 'idle'
      run.disabled = !ready
    }).catch((error) => {
      if (revision !== fileRevision) return
      status.value = error instanceof Error ? error.message : String(error)
      status.dataset.state = 'failed'
      run.disabled = true
    })
  })
  run.addEventListener('click', () => {
    if (!ready || !loaded) return
    checkpoints = []
    runner.start(loaded, performance.now())
  })
  stop.addEventListener('click', () => runner.stop(performance.now()))
  commandButtons.forEach((button) => button.addEventListener('click', () => {
    const command = button.dataset.realtimeDebugCommand
    if (command === 'godmode') executeManualCommand({ kind: 'godmode', enabled: button.getAttribute('aria-pressed') !== 'true' })
    else if (command === 'instant-kill') executeManualCommand({ kind: 'instant-kill' })
    else if (command === 'suicide') executeManualCommand({ kind: 'suicide' })
    syncGodModeButton()
  }))
  download.addEventListener('click', () => {
    const state = runner.getState()
    const checkpointText = checkpoints.flatMap(({ label, snapshot }) => [
      '', `[checkpoint:${label}]`,
      ...Object.entries(snapshot).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${String(value)}`),
    ]).join('\n')
    const blob = new Blob([formatRealtimeTestReport(state, host.readSnapshot()), checkpointText, '\n'], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${safeFileName(state.scriptName ?? loadedFileName)}-rapport.txt`
    anchor.click()
    URL.revokeObjectURL(url)
  })

  const stopForInterruption = (): void => runner.stop(performance.now(), 'Script interrompu: la fenêtre de jeu a perdu le contrôle.')
  window.addEventListener('blur', stopForInterruption)
  window.addEventListener('pointerdown', (event) => {
    if (!(event.target instanceof Node) || !root.contains(event.target)) runner.stop(performance.now(), 'Script arrêté : interaction manuelle détectée.')
  }, true)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') stopForInterruption() })
  renderState(runner.getState())

  return {
    tick(nowMs) { runner.tick(nowMs); syncGodModeButton() },
    setReady(nextReady) {
      ready = nextReady
      file.disabled = !ready
      renderState(runner.getState())
      if (!ready) status.value = 'Chargez une ROM avant de lancer la batterie.'
    },
    stop(message) { runner.stop(performance.now(), message) },
    isRunning: () => runner.getState().status === 'running',
  }
}
