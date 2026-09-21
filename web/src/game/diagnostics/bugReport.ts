export const pokeMasterBugReportFormat = 'pokemaster-bug-report'
export const pokeMasterBugReportRevision = 1

export type BugScreenshot = {
  dataUrl: string
  width: number
  height: number
  method: 'dom-foreign-object' | 'canvas-fallback'
}

export type PokeMasterBugReport = {
  format: typeof pokeMasterBugReportFormat
  revision: typeof pokeMasterBugReportRevision
  id: string
  createdAt: string
  description: string
  screenshot: BugScreenshot
  environment: Record<string, unknown>
  diagnostics: Record<string, unknown>
}

function inlineComputedStyles(source: Element, target: Element): void {
  const computed = window.getComputedStyle(source)
  const declarations: string[] = []
  for (let index = 0; index < computed.length; index += 1) {
    const property = computed.item(index)
    const value = computed.getPropertyValue(property)
    if (value) declarations.push(`${property}:${value}`)
  }
  target.setAttribute('style', declarations.join(';'))
  if (source instanceof HTMLInputElement && target instanceof HTMLInputElement) target.setAttribute('value', source.value)
  if (source instanceof HTMLTextAreaElement && target instanceof HTMLTextAreaElement) target.textContent = source.value
}

function canvasDataUrl(canvas: HTMLCanvasElement): string | undefined {
  try {
    return canvas.toDataURL('image/png')
  } catch {
    return undefined
  }
}

async function loadDataImage(source: string): Promise<HTMLImageElement> {
  return await new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('La capture SVG du rapport ne peut pas être décodée.'))
    image.src = source
  })
}

function createOutputCanvas(width: number, height: number): { canvas: HTMLCanvasElement, scale: number } {
  const maximumDimension = 2560
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  const scale = Math.min(ratio, maximumDimension / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  return { canvas, scale }
}

async function captureWithForeignObject(element: HTMLElement): Promise<BugScreenshot> {
  const bounds = element.getBoundingClientRect()
  const width = Math.max(1, Math.round(bounds.width))
  const height = Math.max(1, Math.round(bounds.height))
  const clone = element.cloneNode(true) as HTMLElement
  const sources = [element, ...element.querySelectorAll('*')]
  const targets = [clone, ...clone.querySelectorAll('*')]
  for (let index = Math.min(sources.length, targets.length) - 1; index >= 0; index -= 1) {
    const source = sources[index]!
    const target = targets[index]!
    inlineComputedStyles(source, target)
    if (!(source instanceof HTMLCanvasElement)) continue
    const dataUrl = canvasDataUrl(source)
    if (!dataUrl) continue
    const image = document.createElement('img')
    image.src = dataUrl
    image.setAttribute('style', target.getAttribute('style') ?? '')
    image.setAttribute('width', String(source.width))
    image.setAttribute('height', String(source.height))
    target.replaceWith(image)
  }
  clone.querySelectorAll('[data-bug-report-exclude]').forEach((excluded) => excluded.remove())
  clone.style.position = 'relative'
  clone.style.inset = 'auto'
  clone.style.width = `${width}px`
  clone.style.height = `${height}px`
  clone.style.margin = '0'
  clone.style.transform = 'none'
  const serialized = new XMLSerializer().serializeToString(clone)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml">${serialized}</div></foreignObject></svg>`
  const image = await loadDataImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`)
  const output = createOutputCanvas(width, height)
  const context = output.canvas.getContext('2d')
  if (!context) throw new Error('Canvas de capture indisponible.')
  context.drawImage(image, 0, 0, output.canvas.width, output.canvas.height)
  return {
    dataUrl: output.canvas.toDataURL('image/png'),
    width: output.canvas.width,
    height: output.canvas.height,
    method: 'dom-foreign-object',
  }
}

function captureVisibleCanvasFallback(element: HTMLElement): BugScreenshot {
  const bounds = element.getBoundingClientRect()
  const width = Math.max(1, Math.round(bounds.width))
  const height = Math.max(1, Math.round(bounds.height))
  const output = createOutputCanvas(width, height)
  const context = output.canvas.getContext('2d')
  if (!context) throw new Error('Canvas de capture indisponible.')
  context.fillStyle = '#08161d'
  context.fillRect(0, 0, output.canvas.width, output.canvas.height)
  for (const canvas of element.querySelectorAll<HTMLCanvasElement>('canvas')) {
    if (canvas.hidden || window.getComputedStyle(canvas).display === 'none') continue
    const canvasBounds = canvas.getBoundingClientRect()
    context.drawImage(
      canvas,
      (canvasBounds.left - bounds.left) * output.scale,
      (canvasBounds.top - bounds.top) * output.scale,
      canvasBounds.width * output.scale,
      canvasBounds.height * output.scale,
    )
  }
  return {
    dataUrl: output.canvas.toDataURL('image/png'),
    width: output.canvas.width,
    height: output.canvas.height,
    method: 'canvas-fallback',
  }
}

export async function captureBugScreenshot(element: HTMLElement): Promise<BugScreenshot> {
  try {
    return await captureWithForeignObject(element)
  } catch {
    return captureVisibleCanvasFallback(element)
  }
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

export function createBugReportFileName(report: Pick<PokeMasterBugReport, 'id'>): string {
  return `pokemaster-bug-${report.id.replaceAll(/[^a-zA-Z0-9_-]/g, '-')}.html`
}

export function createBugReportHtml(report: PokeMasterBugReport): string {
  // The PNG is embedded once in the visible image. Repeating its base64 bytes
  // in the JSON would double multi-megabyte mobile reports for no diagnostic gain.
  const reportIndex = { ...report, screenshot: { ...report.screenshot, dataUrl: '[PNG intégré dans #bug-screenshot]' } }
  const json = JSON.stringify(reportIndex, null, 2).replaceAll('<', '\\u003c')
  const readableJson = escapeHtml(JSON.stringify(reportIndex, null, 2))
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Rapport PokeMaster ${escapeHtml(report.id)}</title>
<style>body{margin:0;padding:24px;color:#173744;background:#e8eee5;font:14px/1.5 ui-monospace,monospace}main{max-width:1100px;margin:auto}h1{font-size:22px}.shot{display:block;max-width:100%;border:4px solid #294553;image-rendering:auto;background:#08161d}pre{overflow:auto;padding:16px;border:3px solid #294553;background:#fffced;white-space:pre-wrap;word-break:break-word}.note{padding:10px;background:#d9ece2}</style></head>
<body><main><h1>Rapport de bug PokeMaster</h1><p class="note">Joindre ce fichier complet à la conversation. Il ne contient aucun octet de la ROM.</p><h2>Description</h2><p>${escapeHtml(report.description || 'Aucune description fournie.')}</p><h2>Capture</h2><img id="bug-screenshot" class="shot" src="${report.screenshot.dataUrl}" alt="Capture du bug"><h2>Diagnostic structuré</h2><pre>${readableJson}</pre><script type="application/json" id="pokemaster-bug-report">${json}</script></main></body></html>`
}

export function downloadBugReport(report: PokeMasterBugReport): void {
  const blob = new Blob([createBugReportHtml(report)], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = createBugReportFileName(report)
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

export type BugReportWriteResult = {
  fileName: string
  destination?: string
}

/**
 * The local Vite server owns the workspace and can write into REPPORT. A
 * deployed static build has no such endpoint and returns undefined so the UI
 * can retain the portable download fallback.
 */
export async function writeBugReportToWorkspace(report: PokeMasterBugReport): Promise<BugReportWriteResult | undefined> {
  // This endpoint exists only in the local Vite development plugin. Never let
  // a production Pages build POST a screenshot or runtime diagnostic to its
  // hosting origin before falling back to the local download.
  if (!import.meta.env.DEV) return undefined
  const fileName = createBugReportFileName(report)
  try {
    const response = await fetch('/__pokemaster/report', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/html;charset=utf-8',
        'X-PokeMaster-Report-Name': fileName,
      },
      body: createBugReportHtml(report),
    })
    if (response.status === 404) return undefined
    if (!response.ok) throw new Error(`Le serveur de rapports a répondu ${response.status}.`)
    return await response.json() as BugReportWriteResult
  } catch (error) {
    if (error instanceof TypeError) return undefined
    throw error
  }
}
