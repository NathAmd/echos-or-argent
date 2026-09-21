import { describe, expect, it } from 'vitest'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import type { PokegearFlypoint } from './pokegearMapController'
import { createPokegearFlyRuntime, type PokegearFlyRuntimeContext } from './pokegearFlyRuntime'

class FakeElement {
  hidden = false
  readonly dataset: Record<string, string> = {}
  readonly attributes = new Map<string, string>()
  children: FakeElement[] = []
  replaceChildren(...children: FakeElement[]) { this.children = children }
  setAttribute(name: string, value: string) { this.attributes.set(name, value) }
  removeAttribute(name: string) { this.attributes.delete(name) }
  animate() { return { finished: Promise.resolve(), cancel: () => undefined } as unknown as Animation }
}

class FakeCanvas extends FakeElement {
  width = 256
  height = 192
  draws: unknown[][] = []
  readonly context = {
    imageSmoothingEnabled: true,
    drawImage: (...arguments_: unknown[]) => { this.draws.push(arguments_) },
  }
  getContext() { return this.context }
}

const map = { id: 77, label: 'Doublonville' }
const destination = { warpMapId: 77, label: 'Doublonville' } as PokegearFlypoint
const carrier = {
  speciesId: 18,
  speciesName: 'ROUCOUPS',
  nickname: 'AILE',
  form: 0,
  gender: 'male',
  shiny: false,
  isEgg: false,
  currentHp: 40,
  moves: [{ moveId: 19 }],
} as CanonicalPokemon

function createFixture(overrides: Partial<PokegearFlyRuntimeContext> = {}) {
  const root = new FakeElement()
  const scene = new FakeElement()
  const carrierHost = new FakeElement()
  const carrierAsset = new FakeElement()
  const veil = new FakeElement()
  const source = new FakeCanvas()
  const snapshots: FakeCanvas[] = []
  const events: string[] = []
  const statuses: string[] = []
  let warps = 0
  const context: PokegearFlyRuntimeContext = {
    safariActive: false,
    inventory: {
      flyDestinationResolver: () => ({ mapId: 77, x: 31, z: 42, direction: 'south' }),
      resolvedMapCatalog: { maps: [map] },
    } as unknown as PokegearFlyRuntimeContext['inventory'],
    session: {
      scriptWarpTo: () => {
        warps += 1
        events.push('warp')
        return { kind: 'transitioned', state: { map } }
      },
    } as unknown as PokegearFlyRuntimeContext['session'],
    badges: new Set([4]),
    party: [carrier],
    reducedMotion: true,
    createCarrierAsset: () => { events.push('carrier'); return new FakeElement() as unknown as HTMLElement },
    closeMenu: () => { events.push('close-menu') },
    refreshMenu: () => { events.push('refresh-menu') },
    clearMovementInput: () => { events.push('clear-input') },
    playCry: () => { events.push('cry') },
    resetPhoneRing: () => { events.push('reset-phone') },
    loadMap: () => { events.push('load-map') },
    setStatus: (message) => { statuses.push(message) },
    ...overrides,
  }
  const runtime = createPokegearFlyRuntime(
    { root, scene, carrier: carrierHost, carrierAsset, veil } as unknown as Parameters<typeof createPokegearFlyRuntime>[0],
    source as unknown as HTMLCanvasElement,
    () => {
      const snapshot = new FakeCanvas()
      snapshots.push(snapshot)
      return snapshot as unknown as HTMLCanvasElement
    },
    () => context,
  )
  return { runtime, root, scene, carrierAsset, snapshots, events, statuses, getWarps: () => warps }
}

describe('adaptateur runtime de Vol', () => {
  it('valide, capture les deux scènes puis ne charge la carte que sous le voile', async () => {
    let presentationFrames = 0
    const fixture = createFixture({ waitForMapPresentation: () => { presentationFrames += 1 } })
    const result = await fixture.runtime.use(destination)

    expect(result).toEqual({ status: 'completed', teleported: true })
    expect(fixture.getWarps()).toBe(1)
    expect(fixture.snapshots).toHaveLength(2)
    expect(fixture.snapshots.every(({ context, draws }) => !context.imageSmoothingEnabled && draws.length === 1)).toBe(true)
    expect(fixture.events).toEqual([
      'carrier', 'clear-input', 'close-menu', 'cry',
      'warp', 'reset-phone', 'clear-input', 'load-map',
    ])
    expect(presentationFrames).toBe(1)
    expect(fixture.statuses).toEqual([
      'AILE utilise VOL vers Doublonville.',
      'VOL vers Doublonville · destination ARM9 31, 42.',
    ])
    expect(fixture.root.hidden).toBe(true)
    expect(fixture.scene.children).toEqual([])
    expect(fixture.carrierAsset.children).toEqual([])
  })

  it('bloque le Safari et les destinations absentes avant tout warp', async () => {
    const safari = createFixture({ safariActive: true })
    expect(await safari.runtime.use(destination)).toEqual({ status: 'blocked', reason: 'safari' })
    expect(safari.events).toEqual(['refresh-menu'])
    expect(safari.getWarps()).toBe(0)

    const unavailable = createFixture({ inventory: undefined })
    expect(await unavailable.runtime.use(destination)).toEqual({ status: 'blocked', reason: 'destination' })
    expect(unavailable.statuses.at(-1)).toContain('indisponible')
    expect(unavailable.getWarps()).toBe(0)
  })

  it('refuse un porteur invalide et une carte absente du catalogue ROM', async () => {
    const noCarrier = createFixture({ party: [{ ...carrier, currentHp: 0 }] })
    expect(await noCarrier.runtime.use(destination)).toEqual({ status: 'blocked', reason: 'party' })
    expect(noCarrier.getWarps()).toBe(0)

    const missingMap = createFixture({
      inventory: {
        flyDestinationResolver: () => ({ mapId: 77, x: 31, z: 42, direction: 'south' }),
        resolvedMapCatalog: { maps: [] },
      } as unknown as PokegearFlyRuntimeContext['inventory'],
    })
    expect(await missingMap.runtime.use(destination)).toEqual({ status: 'blocked', reason: 'map' })
    expect(missingMap.getWarps()).toBe(0)
  })

  it('refuse de lancer une transition sans représentation du porteur', async () => {
    const fixture = createFixture({ createCarrierAsset: () => undefined })

    const result = await fixture.runtime.use(destination)

    expect(result).toMatchObject({ status: 'failed', teleported: false })
    expect(fixture.statuses.at(-1)).toContain('sprite ROM')
    expect(fixture.getWarps()).toBe(0)
    expect(fixture.root.hidden).toBe(true)
  })

  it('propage un warp devenu invalide et remet toute la présentation à zéro', async () => {
    const fixture = createFixture({
      session: {
        scriptWarpTo: () => ({ kind: 'missing-map', mapId: 77 }),
      } as PokegearFlyRuntimeContext['session'],
    })
    const result = await fixture.runtime.use(destination)

    expect(result).toMatchObject({ status: 'failed', teleported: false })
    expect(fixture.statuses.at(-1)).toContain('n’est plus disponible')
    expect(fixture.root.hidden).toBe(true)
    expect(fixture.root.dataset.phase).toBeUndefined()
    expect(fixture.scene.children).toEqual([])
  })
})
