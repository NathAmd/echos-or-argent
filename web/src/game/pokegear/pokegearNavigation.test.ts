import { describe, expect, it } from 'vitest'
import {
  getPokegearGridColumnCount,
  movePokegearGridCursor,
  movePokegearStationCursor,
} from './pokegearNavigation'

describe('curseur des stations du Pokématos', () => {
  it('boucle uniquement entre les slots disponibles', () => {
    const slots = [0, 2, 5]
    expect(movePokegearStationCursor(slots, 0, -1)).toBe(5)
    expect(movePokegearStationCursor(slots, 5, 1)).toBe(0)
    expect(movePokegearStationCursor(slots, 0, 1)).toBe(2)
  })

  it('retombe sur le premier slot si le courant est absent', () => {
    expect(movePokegearStationCursor([1, 4], 3, 1)).toBe(1)
    expect(movePokegearStationCursor([1, 4], undefined, -1)).toBe(1)
  })

  it('ignore les doublons et ne retourne jamais un slot absent', () => {
    const slots = [1, 1, 4, 4]
    expect(movePokegearStationCursor(slots, 1, 1)).toBe(4)
    expect(movePokegearStationCursor(slots, 4, 1)).toBe(1)
  })

  it('gère une liste vide', () => {
    expect(movePokegearStationCursor([], 2, 1)).toBeUndefined()
  })
})

describe('grilles responsives du Pokématos', () => {
  it('reprend exactement les colonnes CSS des thèmes, icônes et mots', () => {
    expect(getPokegearGridColumnCount('themes', 901)).toBe(4)
    expect(getPokegearGridColumnCount('themes', 900)).toBe(3)
    expect(getPokegearGridColumnCount('themes', 640)).toBe(2)
    expect(getPokegearGridColumnCount('marking-icons', 900)).toBe(8)
    expect(getPokegearGridColumnCount('marking-icons', 640)).toBe(4)
    expect(getPokegearGridColumnCount('marking-words', 900)).toBe(3)
    expect(getPokegearGridColumnCount('marking-words', 640)).toBe(2)
  })

  it('déplace le curseur selon les lignes visibles et boucle dans sa colonne', () => {
    expect(movePokegearGridCursor(8, 1, 'down', 4)).toBe(5)
    expect(movePokegearGridCursor(8, 5, 'down', 4)).toBe(1)
    expect(movePokegearGridCursor(8, 5, 'up', 4)).toBe(1)
    expect(movePokegearGridCursor(8, 0, 'left', 4)).toBe(7)
    expect(movePokegearGridCursor(8, 7, 'right', 4)).toBe(0)
  })

  it('gère une dernière ligne incomplète sans viser de case absente', () => {
    expect(movePokegearGridCursor(10, 2, 'up', 4)).toBe(6)
    expect(movePokegearGridCursor(10, 6, 'down', 4)).toBe(2)
    expect(movePokegearGridCursor(10, 9, 'down', 4)).toBe(1)
  })

  it('retombe sur la première case et gère une grille vide', () => {
    expect(movePokegearGridCursor(4, 99, 'right', 2)).toBe(1)
    expect(movePokegearGridCursor(0, 0, 'down', 2)).toBeUndefined()
  })
})
