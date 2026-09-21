import { describe, expect, it } from 'vitest'
import { getResponsiveHgssDialogColumns, splitHgssDialogPages } from './hgssDialogPages'

describe('HGSS dialog pages', () => {
  it('preserves native line and page controls', () => {
    expect(splitHgssDialogPages('Ligne 1\nLigne 2\rPage 2\fPage 3')).toEqual([
      'Ligne 1\nLigne 2',
      'Page 2',
      'Page 3',
    ])
  })

  it('keeps only two wrapped lines visible at once', () => {
    expect(splitHgssDialogPages('un deux trois quatre cinq six', { maxColumns: 10, maxLines: 2 })).toEqual([
      'un deux\ntrois',
      'quatre\ncinq six',
    ])
  })

  it('uses the full single-screen width before wrapping dialog text', () => {
    expect(getResponsiveHgssDialogColumns(390)).toBe(40)
    expect(getResponsiveHgssDialogColumns(700)).toBe(48)
    expect(getResponsiveHgssDialogColumns(1280)).toBe(64)
    expect(getResponsiveHgssDialogColumns(0)).toBe(52)
  })
})
