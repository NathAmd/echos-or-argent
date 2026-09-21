import { createMapRuntime } from '../../mapRuntime'
import type { MapRuntime } from '../../mapRuntimeTypes'
import { presentRuntimeFailure } from '../diagnostics/runtimeDiagnosticLog'

type MapRuntimeFactory = (canvas: HTMLCanvasElement) => MapRuntime

/** Installe la remontée de perte WebGL avant de construire le moteur de carte. */
export function createBrowserMapRuntime(
  canvas: HTMLCanvasElement,
  status: HTMLElement,
  factory: MapRuntimeFactory = createMapRuntime,
): MapRuntime {
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault()
    presentRuntimeFailure(status, 'le contexte graphique WebGL a été perdu', 'Affichage interrompu')
  })
  try {
    return factory(canvas)
  } catch (error) {
    presentRuntimeFailure(status, error, 'Initialisation WebGL impossible')
    throw error
  }
}
