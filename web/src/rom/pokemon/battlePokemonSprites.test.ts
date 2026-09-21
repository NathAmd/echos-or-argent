import { describe, expect, it } from 'vitest'
import { getBattlePokemonMemberIndexes, getStandardBattlePokemonMemberIndexes, sampleHgssBattlePokemonAnimation, splitBattlePokemonAnimationFrames } from './battlePokemonSprites'

describe('sprites Pokémon de combat HGSS', () => {
  it('reproduit la formule ROM espèce × 6 + orientation + genre', () => {
    expect(getStandardBattlePokemonMemberIndexes({ speciesId: 155, gender: 'male', facing: 'front', shiny: false })).toEqual({
      graphic: 933,
      palette: 934,
      height: 623,
    })
    expect(getStandardBattlePokemonMemberIndexes({ speciesId: 152, gender: 'female', facing: 'back', shiny: true })).toEqual({
      graphic: 912,
      palette: 917,
      height: 608,
    })
  })

  it('refuse de faire passer une forme spéciale par la formule standard', () => {
    expect(() => getStandardBattlePokemonMemberIndexes({
      speciesId: 479,
      gender: 'genderless',
      facing: 'front',
      shiny: false,
      form: 1,
    })).toThrow(/formes spéciales/)
  })

  it('reproduit les tables ROM des formes et leurs palettes shiny dédiées', () => {
    expect(getBattlePokemonMemberIndexes({ speciesId: 479, gender: 'genderless', facing: 'front', shiny: false, form: 1 })).toEqual({
      archive: 'forms', graphic: 141, palette: 238, height: 143, animationSpeciesId: 479,
    })
    expect(getBattlePokemonMemberIndexes({ speciesId: 479, gender: 'genderless', facing: 'front', shiny: true, form: 1 })).toMatchObject({
      archive: 'forms', graphic: 141, palette: 239,
    })
    expect(getBattlePokemonMemberIndexes({ speciesId: 386, gender: 'genderless', facing: 'back', shiny: true, form: 3 })).toEqual({
      archive: 'forms', graphic: 6, palette: 159, height: 6, animationSpeciesId: 386,
    })
    expect(getBattlePokemonMemberIndexes({ speciesId: 421, gender: 'female', facing: 'front', shiny: true, form: 1 })).toMatchObject({
      archive: 'forms', graphic: 95, palette: 193,
    })
  })

  it('découpe la planche horizontale ROM en images 80 × 80 intactes', () => {
    const pixels = new Uint8ClampedArray(160 * 80 * 4)
    for (let y = 0; y < 80; y += 1) {
      pixels.fill(17, y * 160 * 4, (y * 160 + 80) * 4)
      pixels.fill(29, (y * 160 + 80) * 4, (y + 1) * 160 * 4)
    }

    const frames = splitBattlePokemonAnimationFrames({
      width: 160,
      height: 80,
      pixels,
      graphicsOffset: 0,
      paletteOffset: 0,
      colorDepth: 4,
    })

    expect(frames).toHaveLength(2)
    expect(frames[0]?.pixels.every((value) => value === 17)).toBe(true)
    expect(frames[1]?.pixels.every((value) => value === 29)).toBe(true)
  })

  it('exécute les frames, durées et fin du script Pokepic ROM', () => {
    const script = [
      { next: 0, duration: 1, xOffset: 0 },
      { next: 1, duration: 2, xOffset: 3 },
      { next: -1, duration: 0, xOffset: 0 },
    ]

    expect(sampleHgssBattlePokemonAnimation(script, 0)).toEqual({ frameIndex: 0, xOffset: 0, complete: false })
    expect(sampleHgssBattlePokemonAnimation(script, 2)).toEqual({ frameIndex: 1, xOffset: 3, complete: false })
    expect(sampleHgssBattlePokemonAnimation(script, 5)).toEqual({ frameIndex: 0, xOffset: 0, complete: true })
  })
})
