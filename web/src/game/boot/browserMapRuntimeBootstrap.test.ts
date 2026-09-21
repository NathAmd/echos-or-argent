import { describe, expect, it, vi } from 'vitest'
import type { MapRuntime } from '../../mapRuntimeTypes'
import { createBrowserMapRuntime } from './browserMapRuntimeBootstrap'

function setup() {
  let contextLost: ((event: Pick<Event, 'preventDefault'>) => void) | undefined
  const canvas = {
    addEventListener: vi.fn((type: string, listener: (event: Pick<Event, 'preventDefault'>) => void) => {
      if (type === 'webglcontextlost') contextLost = listener
    }),
  } as unknown as HTMLCanvasElement
  const status = {
    classList: { add: vi.fn() },
    setAttribute: vi.fn(),
    textContent: '',
  } as unknown as HTMLElement
  return { canvas, status, readContextLost: () => contextLost }
}

describe('browser map runtime bootstrap', () => {
  it('returns the runtime and makes a later WebGL context loss visible', () => {
    const { canvas, status, readContextLost } = setup()
    const runtime = {} as MapRuntime
    expect(createBrowserMapRuntime(canvas, status, () => runtime)).toBe(runtime)

    const preventDefault = vi.fn()
    readContextLost()?.({ preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(status.textContent).toContain('Affichage interrompu')
  })

  it('reports a construction failure before rethrowing it', () => {
    const { canvas, status } = setup()
    const failure = new Error('WebGL indisponible')

    expect(() => createBrowserMapRuntime(canvas, status, () => { throw failure })).toThrow(failure)
    expect(status.textContent).toContain('Initialisation WebGL impossible')
    expect(status.textContent).toContain('WebGL indisponible')
  })
})
