import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { GameDigitalEvent } from '../../gameInput'
import type { GameTextEntryOverlay, GameTextEntryRequest } from '../ui/gameTextEntryOverlay'
import type { BugScreenshot, PokeMasterBugReport } from './bugReport'
import { createBrowserBugReportHost } from './browserBugReportHost'

const appShellSource = readFileSync(new URL('../../appShell.ts', import.meta.url), 'utf8')

class TestElement {
  hidden = true
  disabled = false
  value = ''
  placeholder = 'Décris le problème'
  src = ''
  focused = false
  textContent = ''
  dataset: Record<string, string> = {}
  private readonly listeners = new Map<string, Set<(event: Event) => void>>()

  focus(): void { this.focused = true }
  removeAttribute(name: string): void { if (name === 'src') this.src = '' }
  addEventListener(name: string, listener: EventListener): void {
    const listeners = this.listeners.get(name) ?? new Set()
    listeners.add(listener)
    this.listeners.set(name, listeners)
  }
  removeEventListener(name: string, listener: EventListener): void {
    this.listeners.get(name)?.delete(listener)
  }
  click(): void {
    for (const listener of this.listeners.get('click') ?? []) listener({} as Event)
  }
}

function fixture(overrides: {
  capture?: (root: HTMLElement) => Promise<BugScreenshot>
  collectDiagnostics?: () => Record<string, unknown>
} = {}) {
  const modal = new TestElement()
  const description = new TestElement()
  const preview = new TestElement()
  const status = new TestElement()
  const cancel = new TestElement()
  const edit = new TestElement()
  const download = new TestElement()
  let entry: GameTextEntryRequest | undefined
  const textEntry = {
    open: vi.fn((request: GameTextEntryRequest) => { entry = request }),
    close: vi.fn(() => { const request = entry; entry = undefined; request?.cancel() }),
    isOpen: () => entry !== undefined,
  } as unknown as GameTextEntryOverlay
  const write = vi.fn(async (report: PokeMasterBugReport) => { void report; return { fileName: 'report.html', destination: 'REPPORT/report.html' } })
  const host = createBrowserBugReportHost({
    elements: { modal, description, preview, status, cancel, edit, download } as unknown as Parameters<typeof createBrowserBugReportHost>[0]['elements'],
    captureRoot: new TestElement() as unknown as HTMLElement,
    textEntry,
    readSaveSlot: () => 2,
    collectDiagnostics: overrides.collectDiagnostics ?? (() => ({ map: 17 })),
    renderFrame: vi.fn(),
    clearInput: vi.fn(),
    focusGame: vi.fn(),
    dependencies: {
      capture: vi.fn(overrides.capture ?? (async (root: HTMLElement) => { void root; return { dataUrl: 'data:image/png;base64,AA', width: 320, height: 180, method: 'canvas-fallback' as const } })),
      collectEnvironment: () => ({ platform: 'test' }),
      write,
      download: vi.fn(),
      development: true,
    },
  })
  return { host, modal, description, preview, status, edit, download, textEntry, write, entry: () => entry }
}

function digital(action: GameDigitalEvent['action']): GameDigitalEvent {
  return { action, pressed: true, source: 'gamepad' }
}

describe('browser bug report host', () => {
  it('captures first, opens only the central multiline editor, then exports from the gamepad', async () => {
    const view = fixture()
    await view.host.open()

    expect(view.modal.hidden).toBe(true)
    expect(view.entry()).toMatchObject({ mode: 'multiline', maxLength: 2000 })
    expect(view.preview.src).toBe('data:image/png;base64,AA')

    view.entry()!.write('Deux lignes\nprécises')
    view.entry()!.submit('Deux lignes\nprécises')
    expect(view.description.textContent).toBe('Deux lignes\nprécises')
    expect(view.description.dataset.empty).toBe('false')
    expect(view.modal.hidden).toBe(false)
    expect(view.download.focused).toBe(true)

    view.edit.click()
    expect(view.entry()?.read()).toBe('Deux lignes\nprécises')
    view.entry()!.submit('Deux lignes\ntrès précises')

    expect(view.host.handleDigitalEvent(digital('confirm'))).toBe(true)
    await vi.waitFor(() => { expect(view.write).toHaveBeenCalledOnce() })
    expect(view.write.mock.calls[0]?.[0]).toMatchObject({ description: 'Deux lignes\ntrès précises', id: expect.stringContaining('slot-2') })
    expect(view.status.textContent).toContain('REPPORT/report.html')
    expect(view.description.textContent).toBe('Aucune description.')
  })

  it('closes the whole report when the centralized editor is cancelled', async () => {
    const view = fixture()
    await view.host.open()
    view.entry()!.cancel()
    expect(view.host.isOpen()).toBe(false)
    expect(view.description.textContent).toBe('Aucune description.')
    expect(view.preview.src).toBe('')
  })

  it('ne rouvre pas l’éditeur si le rapport est fermé pendant la capture', async () => {
    let finishCapture: ((screenshot: BugScreenshot) => void) | undefined
    const capture = new Promise<BugScreenshot>((resolve) => { finishCapture = resolve })
    const view = fixture({ capture: async () => capture })

    const opening = view.host.open()
    expect(view.host.isOpen()).toBe(true)
    expect(view.host.handleDigitalEvent(digital('cancel'))).toBe(true)
    expect(view.host.isOpen()).toBe(false)

    finishCapture?.({ dataUrl: 'data:image/png;base64,LATE', width: 320, height: 180, method: 'canvas-fallback' })
    await opening

    expect(view.entry()).toBeUndefined()
    expect(view.modal.hidden).toBe(true)
    expect(view.preview.src).toBe('')
  })

  it('reste récupérable si la collecte du diagnostic échoue avant la capture', async () => {
    const view = fixture({ collectDiagnostics: () => { throw new Error('diagnostic indisponible') } })

    await expect(view.host.open()).resolves.toBeUndefined()

    expect(view.entry()).toMatchObject({ mode: 'multiline' })
    expect(view.status.textContent).toContain('capture a échoué')
    view.entry()!.cancel()
    expect(view.host.isOpen()).toBe(false)
  })

  it('présente la description en lecture et fournit un vrai bouton Modifier avec l’indice secondaire', () => {
    expect(appShellSource).toContain('<p id="bug-report-description"')
    expect(appShellSource).not.toContain('<textarea id="bug-report-description"')
    expect(appShellSource).toContain('<button id="bug-report-edit" type="button">')
    expect(appShellSource).toContain('data-input-key="secondary"')
  })
})
