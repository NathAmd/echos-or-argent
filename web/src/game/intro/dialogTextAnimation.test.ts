import { describe, expect, it } from 'vitest'
import { getRevealedDialogText } from './dialogTextAnimation'

describe('dialog text presentation', () => {
  it('presents the complete text immediately, including the first render', () => {
    expect(getRevealedDialogText('AB CD', 0)).toBe('AB CD')
    expect(getRevealedDialogText('Oui! A', 1)).toBe('Oui! A')
  })

  it('keeps option validation without reintroducing a reveal cadence', () => {
    expect(getRevealedDialogText('ABC', 0, 0.5)).toBe('ABC')
    expect(getRevealedDialogText('ABC', 0, 2)).toBe('ABC')
    expect(() => getRevealedDialogText('ABC', 60, 0)).toThrow('positif')
  })
})
