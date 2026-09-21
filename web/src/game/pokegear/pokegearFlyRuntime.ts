import type { OpeningMapPreview, RomInventory } from '../../ndsTypes'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { getFieldMoveAvailability } from '../player/hgssPlayerMovement'
import type { WorldSession } from '../world/worldSession'
import type { PokegearFlypoint } from './pokegearMapController'
import {
  createPokegearFlyTransitionController,
  type PokegearFlyTransitionElements,
  type PokegearFlyTransitionResult,
} from './pokegearFlyTransition'

type PokegearFlyInventory = {
  flyDestinationResolver: RomInventory['flyDestinationResolver']
  resolvedMapCatalog: Pick<RomInventory['resolvedMapCatalog'], 'maps'>
}
type PokegearFlyWorldSession = Pick<WorldSession, 'scriptWarpTo'>

export type PokegearFlyRuntimeContext = {
  safariActive: boolean
  inventory?: PokegearFlyInventory
  session?: PokegearFlyWorldSession
  badges: ReadonlySet<number>
  party: readonly CanonicalPokemon[]
  reducedMotion: boolean
  createCarrierAsset: (pokemon: CanonicalPokemon) => HTMLElement | undefined
  closeMenu: () => void
  refreshMenu: () => void
  clearMovementInput: () => void
  playCry: (speciesId: number) => void
  resetPhoneRing: () => void
  loadMap: (map: OpeningMapPreview) => void
  /** Attend que le nouveau monde ait produit son premier frame capturable. */
  waitForMapPresentation?: () => void | Promise<void>
  setStatus: (message: string) => void
}

export type PokegearFlyRuntimeResult = PokegearFlyTransitionResult | {
  status: 'blocked'
  reason: 'active' | 'safari' | 'destination' | 'map' | 'party'
}

export type PokegearFlyRuntime = {
  use: (destination: PokegearFlypoint) => Promise<PokegearFlyRuntimeResult>
  cancel: () => void
  dispose: () => void
  isActive: () => boolean
}

function captureCanvas(
  source: HTMLCanvasElement,
  createCanvas: () => HTMLCanvasElement,
): HTMLCanvasElement {
  const snapshot = createCanvas()
  snapshot.width = Math.max(1, source.width)
  snapshot.height = Math.max(1, source.height)
  const context = snapshot.getContext('2d')
  if (context) {
    context.imageSmoothingEnabled = false
    context.drawImage(source, 0, 0, snapshot.width, snapshot.height)
  }
  snapshot.setAttribute('aria-hidden', 'true')
  return snapshot
}

function waitForBrowserPresentationFrame(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') return Promise.resolve()
  return new Promise((resolve) => { requestAnimationFrame(() => resolve()) })
}

/**
 * Adaptateur runtime de Vol : il fige toutes les dépendances de la source au
 * démarrage, valide le warp avant la présentation et ne mute le monde que
 * lorsque le contrôleur visuel atteint son voile opaque.
 */
export function createPokegearFlyRuntime(
  elements: PokegearFlyTransitionElements,
  sourceCanvas: HTMLCanvasElement,
  createCanvas: () => HTMLCanvasElement,
  readContext: () => PokegearFlyRuntimeContext,
): PokegearFlyRuntime {
  const transition = createPokegearFlyTransitionController(elements)

  const use = async (destination: PokegearFlypoint): Promise<PokegearFlyRuntimeResult> => {
    const context = readContext()
    if (context.safariActive) {
      context.refreshMenu()
      return { status: 'blocked', reason: 'safari' }
    }
    if (transition.isActive()) return { status: 'blocked', reason: 'active' }

    const { inventory, session } = context
    const warp = inventory?.flyDestinationResolver(destination.warpMapId)
    if (!inventory || !warp || !session) {
      context.setStatus(`Le point de VOL ROM vers ${destination.label} est indisponible.`)
      return { status: 'blocked', reason: 'destination' }
    }
    if (!inventory.resolvedMapCatalog.maps.some(({ id }) => id === warp.mapId)) {
      context.setStatus(`La carte ROM de ${destination.label} n’est pas chargée.`)
      return { status: 'blocked', reason: 'map' }
    }
    const availability = getFieldMoveAvailability('fly', context.badges, context.party)
    const carrier = availability.available ? context.party[availability.partySlot] : undefined
    if (!carrier) {
      context.setStatus('Aucun Pokémon disponible ne peut utiliser VOL.')
      return { status: 'blocked', reason: 'party' }
    }
    let carrierAsset: HTMLElement | undefined
    try {
      carrierAsset = context.createCarrierAsset(carrier)
    } catch (error) {
      context.setStatus(error instanceof Error ? error.message : `Le sprite ROM de ${carrier.speciesName} est indisponible.`)
      return { status: 'failed', teleported: false, error }
    }
    if (!carrierAsset) {
      const error = new Error(`Le sprite ROM de ${carrier.speciesName} est indisponible.`)
      context.setStatus(error.message)
      return { status: 'failed', teleported: false, error }
    }

    const result = await transition.play({
      carrier: carrierAsset,
      reducedMotion: context.reducedMotion,
      captureScene: () => captureCanvas(sourceCanvas, createCanvas),
      onStart: () => {
        context.clearMovementInput()
        context.closeMenu()
        context.setStatus(`${carrier.nickname ?? carrier.speciesName} utilise VOL vers ${destination.label}.`)
        context.playCry(carrier.speciesId)
      },
      teleport: async () => {
        const transitioned = session.scriptWarpTo(warp.mapId, warp.x, warp.z, warp.direction)
        if (transitioned.kind !== 'transitioned') throw new Error(`La destination ROM ${destination.label} n’est plus disponible.`)
        context.resetPhoneRing()
        context.clearMovementInput()
        context.loadMap(transitioned.state.map)
        // `loadMap` reconstruit la scene immediatement, mais le canevas WebGL
        // ne contient la destination qu'au prochain rendu. Sans cette
        // barriere, la phase d'arrivee reutilise parfois l'ancienne carte.
        await (context.waitForMapPresentation?.() ?? waitForBrowserPresentationFrame())
      },
    })
    if (result.status === 'completed') {
      context.setStatus(`VOL vers ${destination.label} · destination ARM9 ${warp.x}, ${warp.z}.`)
    } else if (result.status === 'failed') {
      context.setStatus(result.error instanceof Error ? result.error.message : `VOL vers ${destination.label} a été interrompu.`)
    }
    return result
  }

  return {
    use,
    cancel: transition.cancel,
    dispose: transition.dispose,
    isActive: transition.isActive,
  }
}
