import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBugReportFileName, createBugReportHtml, pokeMasterBugReportFormat, pokeMasterBugReportRevision, writeBugReportToWorkspace, type PokeMasterBugReport } from './bugReport'

function createReport(): PokeMasterBugReport {
  return {
    format: pokeMasterBugReportFormat,
    revision: pokeMasterBugReportRevision,
    id: '2026-08-15T12:30:00.000Z-slot-1',
    createdAt: '2026-08-15T12:30:00.000Z',
    description: '<script>alert("non")</script>',
    screenshot: { dataUrl: 'data:image/png;base64,AAAA', width: 640, height: 360, method: 'canvas-fallback' },
    environment: { browser: 'test' },
    diagnostics: { mapId: 1 },
  }
}

describe('PokeMaster bug report', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('creates a portable safe HTML report with embedded image and JSON', () => {
    const html = createBugReportHtml(createReport())
    expect(html).toContain('data:image/png;base64,AAAA')
    expect(html).toContain('application/json')
    expect(html).not.toContain('<script>alert("non")</script>')
    expect(html).toContain('&lt;script&gt;alert(&quot;non&quot;)&lt;/script&gt;')
  })

  it('creates a filesystem-safe report name', () => {
    expect(createBugReportFileName(createReport())).toBe('pokemaster-bug-2026-08-15T12-30-00-000Z-slot-1.html')
  })

  it('sends the complete HTML report to the local workspace writer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      fileName: 'pokemaster-bug-2026-08-15T12-30-00-000Z-slot-1.html',
      destination: 'REPPORT/pokemaster-bug-2026-08-15T12-30-00-000Z-slot-1.html',
    }), { status: 201, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(writeBugReportToWorkspace(createReport())).resolves.toMatchObject({ destination: expect.stringContaining('REPPORT/') })
    expect(fetchMock).toHaveBeenCalledWith('/__pokemaster/report', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('Rapport de bug PokeMaster'),
    }))
  })

  it('keeps the browser download fallback when no local writer exists', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })))
    await expect(writeBugReportToWorkspace(createReport())).resolves.toBeUndefined()
  })

  it('never sends a report to the static production host', async () => {
    const fetchMock = vi.fn()
    vi.stubEnv('DEV', false)
    vi.stubGlobal('fetch', fetchMock)

    await expect(writeBugReportToWorkspace(createReport())).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
