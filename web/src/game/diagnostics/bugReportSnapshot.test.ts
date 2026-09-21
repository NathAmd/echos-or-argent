import { describe, expect, it } from 'vitest'
import { copyBugDiagnosticValue } from './bugReportSnapshot'

describe('bug report snapshot', () => {
  it('normalizes runtime collections, typed bytes, and bigint values', () => {
    expect(copyBugDiagnosticValue({
      map: new Map([[1, 'one']]),
      set: new Set([2, 3]),
      bytes: new Uint8Array([4, 5]),
      counter: 6n,
    })).toEqual({ map: [[1, 'one']], set: [2, 3], bytes: [4, 5], counter: '6' })
  })

  it('does not recurse forever through shared runtime objects', () => {
    const circular: { self?: unknown } = {}
    circular.self = circular
    expect(copyBugDiagnosticValue(circular)).toEqual({ self: '[Circular]' })
  })
})
