import type { GameDigitalEvent } from '../../gameInput'
import type { GameTextEntryOverlay } from '../ui/gameTextEntryOverlay'
import {
  captureBugScreenshot,
  downloadBugReport,
  pokeMasterBugReportFormat,
  pokeMasterBugReportRevision,
  writeBugReportToWorkspace,
  type BugReportWriteResult,
  type BugScreenshot,
  type PokeMasterBugReport,
} from './bugReport'
import { collectBugReportEnvironment } from './bugReportSnapshot'

export type BrowserBugReportElements = Readonly<{
  modal: HTMLElement
  description: HTMLElement
  preview: HTMLImageElement
  status: HTMLElement
  cancel: HTMLButtonElement
  edit: HTMLButtonElement
  download: HTMLButtonElement
}>

export type BrowserBugReportHost = Readonly<{
  open: () => Promise<void>
  close: () => void
  isOpen: () => boolean
  handleDigitalEvent: (event: GameDigitalEvent) => boolean
  destroy: () => void
}>

type BugReportDependencies = Readonly<{
  capture?: (root: HTMLElement) => Promise<BugScreenshot>
  collectEnvironment?: () => Record<string, unknown>
  write?: (report: PokeMasterBugReport) => Promise<BugReportWriteResult | undefined>
  download?: (report: PokeMasterBugReport) => void
  development?: boolean
}>

export function createBrowserBugReportHost(options: {
  elements: BrowserBugReportElements
  captureRoot: HTMLElement
  textEntry: GameTextEntryOverlay
  readSaveSlot: () => number
  collectDiagnostics: () => Record<string, unknown>
  renderFrame: () => void
  clearInput: () => void
  focusGame: () => void
  recordError?: (kind: 'screenshot-error' | 'bug-report-write-error', error: unknown) => void
  dependencies?: BugReportDependencies
}): BrowserBugReportHost {
  const { modal, description, preview, status, cancel, edit, download } = options.elements
  const capture = options.dependencies?.capture ?? captureBugScreenshot
  const collectEnvironment = options.dependencies?.collectEnvironment ?? collectBugReportEnvironment
  const write = options.dependencies?.write ?? writeBugReportToWorkspace
  const saveDownload = options.dependencies?.download ?? downloadBugReport
  const development = options.dependencies?.development ?? import.meta.env.DEV
  let screenshot: BugScreenshot | undefined
  let diagnostics: Record<string, unknown> | undefined
  let environment: Record<string, unknown> | undefined
  let captureInProgress = false
  let editing = false
  let destroyed = false
  let descriptionValue = ''
  let revision = 0

  const syncDescription = (): void => {
    const empty = descriptionValue.trim().length === 0
    description.textContent = empty ? 'Aucune description.' : descriptionValue
    description.dataset.empty = String(empty)
  }

  const showSummary = (): void => {
    if (destroyed) return
    editing = false
    syncDescription()
    modal.hidden = false
    download.focus({ preventScroll: true })
  }

  const close = (): void => {
    revision += 1
    modal.hidden = true
    descriptionValue = ''
    syncDescription()
    preview.removeAttribute('src')
    screenshot = undefined
    diagnostics = undefined
    environment = undefined
    captureInProgress = false
    editing = false
    options.focusGame()
  }

  const openDescription = (): void => {
    if (destroyed || editing || options.textEntry.isOpen()) return
    let draft = descriptionValue
    modal.hidden = true
    editing = true
    options.textEntry.open({
      mode: 'multiline',
      title: 'Signaler un bug',
      label: 'Description',
      placeholder: description.dataset.placeholder,
      maxLength: 2000,
      read: () => draft,
      write: (value) => { draft = value },
      submit: (value) => { descriptionValue = value; showSummary() },
      cancel: close,
    })
  }

  const exportReport = async (): Promise<void> => {
    if (!screenshot || !diagnostics || !environment) {
      status.textContent = 'Capture indisponible : ferme puis rouvre le rapport.'
      return
    }
    const createdAt = new Date().toISOString()
    const report: PokeMasterBugReport = {
      format: pokeMasterBugReportFormat,
      revision: pokeMasterBugReportRevision,
      id: `${createdAt}-slot-${options.readSaveSlot()}`,
      createdAt,
      description: descriptionValue.trim(),
      screenshot,
      environment,
      diagnostics,
    }
    download.disabled = true
    status.textContent = 'Enregistrement du rapport…'
    try {
      const written = await write(report)
      if (written) {
        status.textContent = `Rapport enregistré directement dans ${written.destination ?? `REPPORT/${written.fileName}`}.`
        descriptionValue = ''
        syncDescription()
        return
      }
      saveDownload(report)
      status.textContent = development
        ? 'Serveur local indisponible : rapport téléchargé dans le dossier habituel du navigateur.'
        : 'Rapport téléchargé dans le dossier habituel du navigateur.'
    } catch (error) {
      options.recordError?.('bug-report-write-error', error)
      saveDownload(report)
      status.textContent = 'Écriture directe impossible : une copie a été téléchargée pour ne pas perdre le rapport.'
    } finally {
      download.disabled = false
    }
  }

  const open = async (): Promise<void> => {
    if (destroyed || captureInProgress || !modal.hidden || editing || options.textEntry.isOpen()) return
    const operationRevision = ++revision
    captureInProgress = true
    options.clearInput()
    try {
      diagnostics = options.collectDiagnostics()
      environment = collectEnvironment()
      options.renderFrame()
      const captured = await capture(options.captureRoot)
      if (destroyed || revision !== operationRevision) return
      screenshot = captured
      preview.src = screenshot.dataUrl
      status.textContent = `Capture ${screenshot.width} × ${screenshot.height} et diagnostic prêts.`
    } catch (error) {
      if (destroyed || revision !== operationRevision) return
      options.recordError?.('screenshot-error', error)
      status.textContent = 'La capture a échoué. Ferme puis réessaie.'
    } finally {
      if (!destroyed && revision === operationRevision) {
        captureInProgress = false
        openDescription()
      }
    }
  }

  const onCancel = (): void => { close() }
  const onEdit = (): void => { openDescription() }
  const onDownload = (): void => { void exportReport() }
  cancel.addEventListener('click', onCancel)
  edit.addEventListener('click', onEdit)
  download.addEventListener('click', onDownload)
  syncDescription()

  return Object.freeze({
    open,
    close,
    isOpen: () => captureInProgress || editing || !modal.hidden,
    handleDigitalEvent(event) {
      if (!captureInProgress && !editing && modal.hidden) return false
      if (!event.pressed) return true
      if (!editing && !captureInProgress && event.action === 'confirm' && !download.disabled) void exportReport()
      else if (!editing && !captureInProgress && event.action === 'secondary') openDescription()
      else if (!editing && (event.action === 'cancel' || event.action === 'menu')) close()
      return true
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      cancel.removeEventListener('click', onCancel)
      edit.removeEventListener('click', onEdit)
      download.removeEventListener('click', onDownload)
      if (editing) options.textEntry.close()
      close()
    },
  })
}
