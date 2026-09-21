import { describe, expect, it, vi } from 'vitest'
import type { NitroGraphic } from '../../ndsTypes'
import type { HgssPokedexEntry } from '../pokedex/pokedexMenuModel'
import {
  createPokemonUiSpritePresentation,
  type PokedexPreviewPresentationRequest,
} from './pokemonUiSpritePresentation'

function graphic(offset: number): NitroGraphic {
  return {
    width: 1,
    height: 1,
    pixels: new Uint8ClampedArray(4),
    graphicsOffset: offset,
    paletteOffset: 0,
    colorDepth: 4,
  }
}

class FakeCanvas {
  width = 1
  height = 1
  className = 'game-menu-rom-asset'
  isConnected = true
  dataset: Record<string, string> = {}
  style = { transform: '' }
  readonly clearRect = vi.fn()
  readonly drawImage = vi.fn()
  getContext() { return { clearRect: this.clearRect, drawImage: this.drawImage } }
}

class FakeHost {
  className = ''
  isConnected = true
  dataset: Record<string, string> = {}
  children: FakeCanvas[] = []
  replaceCount = 0
  readonly attributes = new Map<string, string>()
  get firstElementChild(): FakeCanvas | null { return this.children[0] ?? null }
  replaceChildren(...children: FakeCanvas[]) { this.children = children; this.replaceCount += 1 }
  setAttribute(name: string, value: string) { this.attributes.set(name, value) }
}

const entry = (form = 0): HgssPokedexEntry => ({
  speciesId: 25,
  dexNumber: 22,
  speciesName: 'PIKACHU',
  seen: true,
  caught: true,
  forms: [form],
  genders: ['male'],
})

function createFixture() {
  const canvases: FakeCanvas[] = []
  const hosts: FakeHost[] = []
  const resolvedFrames: NitroGraphic[] = []
  const presentation = createPokemonUiSpritePresentation({
    createGraphicCanvas: () => {
      const canvas = new FakeCanvas()
      canvases.push(canvas)
      return canvas as unknown as HTMLCanvasElement
    },
    resolveFrameCanvas: (frame) => {
      resolvedFrames.push(frame)
      return new FakeCanvas() as unknown as HTMLCanvasElement
    },
    createPokedexHost: () => {
      const host = new FakeHost()
      hosts.push(host)
      return host as unknown as HTMLElement
    },
  })
  return { presentation, canvases, hosts, resolvedFrames }
}

describe('présentation commune des sprites Pokémon dans les menus', () => {
  it('cadence les starters uniquement avec le VBlank pause-safe partagé', () => {
    const { presentation, canvases, resolvedFrames } = createFixture()
    const first = graphic(0)
    const second = graphic(1)
    presentation.createStarterIcon([first, second])

    presentation.animate(23, { startersVisible: true })
    expect(canvases[0]?.drawImage).not.toHaveBeenCalled()
    presentation.animate(24, { startersVisible: true })
    expect(resolvedFrames).toEqual([second])
    expect(canvases[0]?.drawImage).toHaveBeenCalledOnce()

    presentation.animate(24, { startersVisible: true })
    presentation.animate(47, { startersVisible: true })
    expect(canvases[0]?.drawImage).toHaveBeenCalledOnce()
    presentation.animate(48, { startersVisible: false })
    expect(canvases[0]?.drawImage).toHaveBeenCalledOnce()
  })

  it('partage la cadence de 24 VBlank avec le fallback icône du Pokédex', () => {
    const { presentation, canvases, hosts } = createFixture()
    const inventory = {
      battlePokemonSpriteResolver: vi.fn(),
      pokemonIconResolver: vi.fn(() => ({ frames: [graphic(0), graphic(1)] })),
    } as unknown as PokedexPreviewPresentationRequest['inventory']
    const host = presentation.createPokedexPreview({
      entry: entry(1),
      inventory,
      startedAtVblank: 100,
    }) as unknown as FakeHost

    presentation.animate(123, { startersVisible: false })
    expect(host.firstElementChild).toBe(canvases[0])
    presentation.animate(124, { startersVisible: false })
    expect(host.firstElementChild).toBe(canvases[1])
    expect(hosts[0]?.replaceCount).toBe(2)
    expect(inventory.battlePokemonSpriteResolver).not.toHaveBeenCalled()
  })

  it('applique puis efface le décalage du script Poképic sans conserver l’ancien état', () => {
    const { presentation, canvases } = createFixture()
    const frames = [graphic(0), graphic(1)]
    const inventory = {
      battlePokemonSpriteResolver: vi.fn(() => ({
        frames,
        animationScript: [
          { next: 0, duration: 1, xOffset: 0 },
          { next: 1, duration: 2, xOffset: 3 },
          { next: -1, duration: 0, xOffset: 0 },
        ],
      })),
      pokemonIconResolver: vi.fn(),
    } as unknown as PokedexPreviewPresentationRequest['inventory']
    const host = presentation.createPokedexPreview({
      entry: entry(),
      inventory,
      startedAtVblank: 100,
    }) as unknown as FakeHost

    presentation.animate(102, { startersVisible: false })
    expect(host.firstElementChild).toBe(canvases[1])
    expect(host.firstElementChild?.style.transform).toBe('translateX(3.75%)')

    presentation.animate(105, { startersVisible: false })
    expect(host.firstElementChild).toBe(canvases[0])
    expect(host.firstElementChild?.style.transform).toBe('')

    host.isConnected = false
    presentation.animate(106, { startersVisible: false })
    const replacements = host.replaceCount
    host.isConnected = true
    presentation.animate(108, { startersVisible: false })
    expect(host.replaceCount).toBe(replacements)
  })

  it('rejette explicitement une animation starter vide', () => {
    const { presentation } = createFixture()
    expect(() => presentation.createStarterIcon([])).toThrow("L'animation ROM de l'icône starter est vide.")
  })
})
