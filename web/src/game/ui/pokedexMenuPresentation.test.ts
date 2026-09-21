import { describe, expect, it } from 'vitest'
import type { MainMenuItem, MainMenuState } from '../menu/mainMenuController'
import { createPokedexFormControlModels, getPokedexGridColumnCount, movePokedexFormCursor, movePokedexGridCursor, resolvePokedexFormLabel } from './pokedexMenuPresentation'

function state(cursor: number, speciesCount = 13): MainMenuState {
  const items: MainMenuItem[] = Array.from({ length: speciesCount }, (_, index) => ({
    id: `pokedex-species:${index + 1}`,
    label: String(index + 1),
    kind: 'command',
  }))
  items.push({ id: 'root', label: '', kind: 'screen' })
  return { open: true, screen: 'pokedex', cursor, items }
}

describe('Pokédex grid navigation', () => {
  it('uses the same responsive column count as the presentation', () => {
    expect(getPokedexGridColumnCount(430)).toBe(3)
    expect(getPokedexGridColumnCount(700)).toBe(4)
    expect(getPokedexGridColumnCount(1200)).toBe(5)
  })

  it('moves spatially and never focuses the trailing return command', () => {
    expect(movePokedexGridCursor(state(0), 'right', 5)).toBe(1)
    expect(movePokedexGridCursor(state(1), 'down', 5)).toBe(6)
    expect(movePokedexGridCursor(state(6), 'up', 5)).toBe(1)
    expect(movePokedexGridCursor(state(12), 'right', 5)).toBe(0)
    expect(movePokedexGridCursor(state(0), 'left', 5)).toBe(12)
  })

  it('pages by visible grid rows with wraparound', () => {
    expect(movePokedexGridCursor(state(0), 'page-next', 4, 3)).toBe(12)
    expect(movePokedexGridCursor(state(12), 'page-next', 4, 3)).toBe(11)
    expect(movePokedexGridCursor(state(0), 'page-previous', 4, 3)).toBe(1)
  })
})

describe('Pokédex form controls', () => {
  const messages = Array.from({ length: 176 }, (_, index) => `M${index}`)

  it('uses the native HGSS message indirection for named forms', () => {
    expect(resolvePokedexFormLabel(386, 2, messages, 'DEOXYS')).toBe('M147')
    expect(resolvePokedexFormLabel(479, 5, messages, 'MOTISMA')).toBe('M158')
    expect(resolvePokedexFormLabel(172, 2, messages, 'PICHU')).toBe('M166')
    expect(resolvePokedexFormLabel(422, 1, messages, 'SANCOKI')).toBe('M117')
    expect(resolvePokedexFormLabel(999, 7, messages, 'NOM-ROM')).toBe('NOM-ROM')
  })

  it('names Zarbi exclusively from native messages', () => {
    expect(resolvePokedexFormLabel(201, 0, messages, 'ZARBI')).toBe('M69')
    expect(resolvePokedexFormLabel(201, 25, messages, 'ZARBI')).toBe('M94')
    expect(resolvePokedexFormLabel(201, 26, messages, 'ZARBI')).toBe('M121')
    expect(resolvePokedexFormLabel(201, 27, messages, 'ZARBI')).toBe('M121')
  })

  it('keeps one cyclic form cursor over the ROM order', () => {
    expect(movePokedexFormCursor([2, 0, 1], 2, 1)).toBe(0)
    expect(movePokedexFormCursor([2, 0, 1], 2, -1)).toBe(1)
    expect(movePokedexFormCursor([2, 0, 1], 0, 1)).toBe(1)
    expect(movePokedexFormCursor([], undefined, 1)).toBeUndefined()
  })

  it('exposes one named roving control per decoded ROM form', () => {
    const controls = createPokedexFormControlModels(386, [0, 1, 2, 3], 2, messages, 'DEOXYS')
    expect(controls.map(({ label }) => label)).toEqual(['M145', 'M146', 'M147', 'M148'])
    expect(controls.map(({ tabIndex }) => tabIndex)).toEqual([-1, -1, 0, -1])
    expect(controls.map(({ position, setSize }) => [position, setSize])).toEqual([[1, 4], [2, 4], [3, 4], [4, 4]])
    expect(controls.filter(({ selected }) => selected)).toHaveLength(1)
    expect(controls.every(({ label }) => label.length > 0)).toBe(true)
  })
})
