import { describe, expect, it } from 'vitest'
import { moveBattleArcCursor, moveBattleMenuCursor, moveBattleMenuCursorSkippingDisabled, moveBattleMenuCursorSpatially, resolveRememberedBattleMoveCursor } from './battleMenuNavigation'

describe('navigation du menu de combat', () => {
  it('déplace horizontalement dans la ligne et verticalement dans la colonne', () => {
    expect(moveBattleMenuCursor(0, 4, 'right')).toBe(1)
    expect(moveBattleMenuCursor(0, 4, 'down')).toBe(2)
    expect(moveBattleMenuCursor(3, 4, 'up')).toBe(1)
    expect(moveBattleMenuCursor(1, 4, 'left')).toBe(0)
  })

  it('boucle sans sélectionner une case inexistante', () => {
    expect(moveBattleMenuCursor(4, 5, 'right')).toBe(4)
    expect(moveBattleMenuCursor(4, 5, 'down')).toBe(1)
    expect(moveBattleMenuCursor(0, 5, 'up')).toBe(3)
  })

  it('saute une case verrouillée sans comprimer la géométrie de la grille', () => {
    const enabled = [true, false, true, true]
    expect(moveBattleMenuCursorSkippingDisabled(0, enabled, 'right')).toBe(0)
    expect(moveBattleMenuCursorSkippingDisabled(0, enabled, 'down')).toBe(2)
    expect(moveBattleMenuCursorSkippingDisabled(2, enabled, 'right')).toBe(3)
  })

  it('presélectionne la dernière capacité confirmée tant qu’elle reste utilisable', () => {
    expect(resolveRememberedBattleMoveCursor([0, 2, 3], 2)).toBe(1)
    expect(resolveRememberedBattleMoveCursor([0, 2, 3], 1)).toBe(0)
    expect(resolveRememberedBattleMoveCursor([0, 2, 3], undefined)).toBe(0)
  })

  it('suit la disposition visuelle en arc et reboucle au bord', () => {
    const points = [
      { x: 0, y: 0, enabled: true },
      { x: 10, y: 0, enabled: true },
      { x: 11, y: 10, enabled: true },
      { x: 10, y: 20, enabled: true },
    ]
    expect(moveBattleMenuCursorSpatially(0, points, 'right')).toBe(1)
    expect(moveBattleMenuCursorSpatially(1, points, 'down')).toBe(2)
    expect(moveBattleMenuCursorSpatially(2, points, 'down')).toBe(3)
    expect(moveBattleMenuCursorSpatially(3, points, 'down')).toBe(1)
  })

  it('ignore une capacité sans PP au lieu de bloquer le curseur', () => {
    const points = [
      { x: 0, y: 0, enabled: true },
      { x: 10, y: 0, enabled: false },
      { x: 11, y: 10, enabled: true },
      { x: 10, y: 20, enabled: true },
    ]
    expect(moveBattleMenuCursorSpatially(0, points, 'right')).toBe(2)
    expect(moveBattleMenuCursorSpatially(0, points, 'down')).toBe(2)
    expect(moveBattleMenuCursorSpatially(2, points, 'up')).toBe(0)
  })

  it('suit les quatre voisins visuels stables de l’arc de combat', () => {
    const enabled = [true, true, true, true]
    expect(['left', 'right', 'up', 'down'].map((direction) => (
      moveBattleArcCursor(0, enabled, direction as 'left' | 'right' | 'up' | 'down')
    ))).toEqual([1, 1, 3, 1])
    expect(moveBattleArcCursor(1, enabled, 'down')).toBe(2)
    expect(moveBattleArcCursor(2, enabled, 'up')).toBe(1)
    expect(moveBattleArcCursor(2, enabled, 'down')).toBe(3)
    expect(moveBattleArcCursor(3, enabled, 'up')).toBe(2)
  })

  it('saute les boutons désactivés sans comprimer ni réordonner l’arc', () => {
    expect(moveBattleArcCursor(0, [true, false, true, true], 'right')).toBe(2)
    expect(moveBattleArcCursor(2, [true, false, true, true], 'up')).toBe(0)
    expect(moveBattleArcCursor(1, [true, true, false, true], 'down')).toBe(3)
    expect(moveBattleArcCursor(3, [true, true, false, true], 'up')).toBe(1)
    expect(moveBattleArcCursor(0, [true, false, false, true], 'down')).toBe(3)
  })

  it("ne détourne pas gauche et droite dans une liste verticale d'objets", () => {
    const points = [
      { x: 10, y: 0, enabled: true },
      { x: 10, y: 10, enabled: true },
      { x: 10, y: 20, enabled: true },
    ]
    expect(moveBattleMenuCursorSpatially(1, points, 'left')).toBe(1)
    expect(moveBattleMenuCursorSpatially(1, points, 'right')).toBe(1)
    expect(moveBattleMenuCursorSpatially(1, points, 'down')).toBe(2)
  })
})
