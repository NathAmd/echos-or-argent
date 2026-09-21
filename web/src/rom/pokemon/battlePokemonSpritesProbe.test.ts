import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readRomInventory } from '../../nds'

const romPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const probe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip

function getAlphaCoverage(pixels: Uint8ClampedArray): { opaque: number, transparent: number, transparentBorder: number } {
  let opaque = 0
  let transparent = 0
  let transparentBorder = 0
  let borderPixels = 0
  for (let index = 3; index < pixels.length; index += 4) {
    const pixelIndex = (index - 3) / 4
    const x = pixelIndex % 80
    const y = Math.floor(pixelIndex / 80)
    const border = x === 0 || x === 79 || y === 0 || y === 79
    if (border) borderPixels += 1
    if (pixels[index] === 0) {
      transparent += 1
      if (border) transparentBorder += 1
    }
    else opaque += 1
  }
  const pixelCount = pixels.length / 4
  return {
    opaque: opaque / pixelCount,
    transparent: transparent / pixelCount,
    transparentBorder: transparentBorder / borderPixels,
  }
}

describe('sprites Pokémon de combat de la ROM HGSS', () => {
  probe('décode deux silhouettes non bruitées pour les faces avant et arrière', async () => {
    const bytes = await readFile(romPath)
    const inventory = await readRomInventory(new File([bytes], basename(romPath)))
    const sprites = [
      inventory.battlePokemonSpriteResolver({ speciesId: 16, gender: 'male', facing: 'front', shiny: false }),
      inventory.battlePokemonSpriteResolver({ speciesId: 155, gender: 'male', facing: 'back', shiny: false }),
    ]

    for (const sprite of sprites) {
      expect(sprite.frames).toHaveLength(2)
      expect(sprite.height).toBeGreaterThanOrEqual(0)
      expect(sprite.height).toBeLessThan(80)
      expect(sprite.animationScript).toHaveLength(10)
      expect(sprite.animationScript.some((command) => command.next === 1)).toBe(true)
      expect(sprite.animationScript.some((command) => command.next === -1)).toBe(true)
      for (const frame of sprite.frames) {
        expect(frame).toMatchObject({ width: 80, height: 80, colorDepth: 4 })
        const coverage = getAlphaCoverage(frame.pixels)
        expect(coverage.transparent).toBeGreaterThan(0.25)
        expect(coverage.transparentBorder).toBeGreaterThan(0.75)
        expect(coverage.opaque).toBeGreaterThan(0.05)
      }
    }

    const dayBackground = inventory.battleBackgroundResolver({ backgroundId: 0, timeOfDay: 1 })
    const nightBackground = inventory.battleBackgroundResolver({ backgroundId: 0, timeOfDay: 2 })
    expect(dayBackground).toMatchObject({ width: 256, height: 192, colorDepth: 8 })
    expect(dayBackground.pixels.every((channel, index) => index % 4 !== 3 || channel === 255)).toBe(true)
    expect(nightBackground.pixels).not.toEqual(dayBackground.pixels)
  }, 90_000)
})