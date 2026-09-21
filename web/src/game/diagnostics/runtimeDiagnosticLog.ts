export type DiagnosticLogEntry = { at: string, kind: string, detail: unknown }

export function appendDiagnosticEntry(target: DiagnosticLogEntry[], entry: DiagnosticLogEntry, maximum: number): void {
  target.push(entry)
  if (target.length > maximum) target.splice(0, target.length - maximum)
}

export function diagnosticErrorDetail(value: unknown): Record<string, unknown> {
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack }
  return { value: typeof value === 'string' ? value : String(value) }
}

function runtimeFailureDetail(value: unknown): string {
  if (value instanceof Error && value.message.trim()) return value.message.trim()
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (value && typeof value === 'object' && 'message' in value) {
    const message = Reflect.get(value, 'message')
    if (typeof message === 'string' && message.trim()) return message.trim()
  }
  return 'cause inconnue'
}

/** Rend une erreur fatale visible même lorsque les outils de développement sont masqués. */
export function presentRuntimeFailure(
  status: HTMLElement,
  value: unknown,
  context = 'Erreur inattendue',
): void {
  status.textContent = `${context} : ${runtimeFailureDetail(value)}. Rechargez la page puis réessayez.`
  status.classList.add('runtime-status-error')
  status.setAttribute('role', 'alert')
  status.setAttribute('aria-live', 'assertive')
}

export function createDeduplicatedDiagnosticRecorder<T>(
  target: DiagnosticLogEntry[],
  kind: string,
  maximum: number,
): (detail: T) => void {
  const signatures = new Set<string>()
  return (detail) => {
    const signature = JSON.stringify(detail)
    if (signatures.has(signature)) return
    signatures.add(signature)
    appendDiagnosticEntry(target, { at: new Date().toISOString(), kind, detail }, maximum)
  }
}

export function installRuntimeDiagnosticLog(status: HTMLElement): {
  errors: DiagnosticLogEntry[]
  inputs: DiagnosticLogEntry[]
  statuses: DiagnosticLogEntry[]
} {
  const errors: DiagnosticLogEntry[] = []
  const inputs: DiagnosticLogEntry[] = []
  const statuses: DiagnosticLogEntry[] = []
  window.addEventListener('error', (event) => {
    appendDiagnosticEntry(errors, {
      at: new Date().toISOString(),
      kind: 'window-error',
      detail: { message: event.message, filename: event.filename, line: event.lineno, column: event.colno, ...diagnosticErrorDetail(event.error) },
    }, 40)
    presentRuntimeFailure(status, event.error ?? event.message)
  })
  window.addEventListener('unhandledrejection', (event) => {
    appendDiagnosticEntry(errors, { at: new Date().toISOString(), kind: 'unhandled-rejection', detail: diagnosticErrorDetail(event.reason) }, 40)
    presentRuntimeFailure(status, event.reason)
  })
  new MutationObserver(() => {
    const text = status.textContent?.trim()
    if (!text || statuses.at(-1)?.detail === text) return
    appendDiagnosticEntry(statuses, { at: new Date().toISOString(), kind: 'runtime-status', detail: text }, 80)
  }).observe(status, { childList: true, characterData: true, subtree: true })
  return { errors, inputs, statuses }
}
