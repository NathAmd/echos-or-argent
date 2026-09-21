import { describe, expect, it, vi } from 'vitest'
import type { NitroGraphic } from '../../ndsTypes'
import { createPokemonUiAnimationRegistry, pokemonUiIconFrameDurationMs, samplePokemonUiIconFrame } from './pokemonUiAnimation'

function graphic(offset: number): NitroGraphic {
  return { width: 1, height: 1, pixels: new Uint8ClampedArray(4), graphicsOffset: offset, paletteOffset: 0, colorDepth: 4 }
}

describe('lecteur commun des animations Pokémon dans les UI', () => {
  it('keeps one icon cadence regardless of selection presentation', () => {
    expect(samplePokemonUiIconFrame(pokemonUiIconFrameDurationMs - .01, 2)).toBe(0)
    expect(samplePokemonUiIconFrame(pokemonUiIconFrameDurationMs, 2)).toBe(1)
  })

  it('cadence les cases PC avec le script Pokepic ROM et son décalage horizontal', () => {
    const drawImage = vi.fn()
    const clearRect = vi.fn()
    const renderedFrame = {} as HTMLCanvasElement
    const canvas = {
      isConnected: true,
      width: 1,
      height: 1,
      style: { transform: '' },
      closest: vi.fn(() => null),
      getContext: vi.fn(() => ({ clearRect, drawImage })),
    } as unknown as HTMLCanvasElement
    const registry = createPokemonUiAnimationRegistry(() => renderedFrame)
    registry.register(canvas, {
      source: 'battle',
      frames: [graphic(0), graphic(1)],
      animationScript: [
        { next: 0, duration: 1, xOffset: 0 },
        { next: 1, duration: 2, xOffset: 3 },
        { next: -1, duration: 0, xOffset: 0 },
      ],
    }, 20)

    registry.animate(0, 22)

    expect(clearRect).toHaveBeenCalledOnce()
    expect(drawImage).toHaveBeenCalledWith(renderedFrame, 0, 0)
    expect(canvas.style.transform).toBe('translateX(3.75%)')
  })
})
