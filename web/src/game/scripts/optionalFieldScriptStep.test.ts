import { describe, expect, it, vi } from 'vitest'
import { settleOptionalFieldScriptStep } from './optionalFieldScriptStep'

describe('optional field-script presentation', () => {
  it('resumes the ROM script when an optional resource fails', async () => {
    const reportFailure = vi.fn()
    const resume = vi.fn()
    const missingProgram = new Error('Le programme SBNK 62 est absent.')

    const result = await settleOptionalFieldScriptStep(Promise.reject(missingProgram), {
      isCurrent: () => true,
      reportFailure,
      resume,
    })

    expect(result).toBe('resumed')
    expect(reportFailure).toHaveBeenCalledWith(missingProgram)
    expect(resume).toHaveBeenCalledOnce()
  })

  it('resumes normally after a successful presentation', async () => {
    const reportFailure = vi.fn()
    const resume = vi.fn()

    const result = await settleOptionalFieldScriptStep(Promise.resolve(), {
      isCurrent: () => true,
      reportFailure,
      resume,
    })

    expect(result).toBe('resumed')
    expect(reportFailure).not.toHaveBeenCalled()
    expect(resume).toHaveBeenCalledOnce()
  })

  it('does not resume a presentation belonging to an obsolete script', async () => {
    const reportFailure = vi.fn()
    const resume = vi.fn()

    const result = await settleOptionalFieldScriptStep(Promise.reject(new Error('cancelled')), {
      isCurrent: () => false,
      reportFailure,
      resume,
    })

    expect(result).toBe('stale')
    expect(reportFailure).not.toHaveBeenCalled()
    expect(resume).not.toHaveBeenCalled()
  })
})
