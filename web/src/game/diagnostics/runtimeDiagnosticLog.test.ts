import { describe, expect, it, vi } from 'vitest'
import { diagnosticErrorDetail, presentRuntimeFailure } from './runtimeDiagnosticLog'

describe('runtime diagnostic log', () => {
  it('projects errors without losing their useful diagnostic fields', () => {
    expect(diagnosticErrorDetail(new TypeError('renderer unavailable'))).toMatchObject({
      name: 'TypeError',
      message: 'renderer unavailable',
    })
  })

  it('makes an unexpected failure visible and assertive', () => {
    const add = vi.fn()
    const setAttribute = vi.fn()
    const status = { classList: { add }, setAttribute, textContent: '' } as unknown as HTMLElement

    presentRuntimeFailure(status, new Error('WebGL indisponible'), 'Initialisation impossible')

    expect(status.textContent).toBe('Initialisation impossible : WebGL indisponible. Rechargez la page puis réessayez.')
    expect(add).toHaveBeenCalledWith('runtime-status-error')
    expect(setAttribute).toHaveBeenCalledWith('role', 'alert')
    expect(setAttribute).toHaveBeenCalledWith('aria-live', 'assertive')
  })
})
