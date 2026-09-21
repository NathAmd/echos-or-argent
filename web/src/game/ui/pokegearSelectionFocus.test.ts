import { describe, expect, it, vi } from 'vitest'
import { focusPokegearMapBoard } from './pokegearMapPresentation'
import { focusPokegearRadioSelection } from './pokegearRadioPresentation'

function createFocusFixture(): {
  root: ParentNode
  focus: ReturnType<typeof vi.fn>
  scrollIntoView: ReturnType<typeof vi.fn>
} {
  const focus = vi.fn()
  const scrollIntoView = vi.fn()
  const button = { focus, scrollIntoView } as unknown as HTMLButtonElement
  const root = { querySelector: vi.fn(() => button) } as unknown as ParentNode
  return { root, focus, scrollIntoView }
}

describe('Pokématos roving focus', () => {
  it('transfers focus to the interactive map surface', () => {
    const fixture = createFocusFixture()

    expect(focusPokegearMapBoard(fixture.root)).toBe(true)
    expect(fixture.focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(fixture.scrollIntoView).not.toHaveBeenCalled()
  })

  it('transfers focus to the tuned radio station', () => {
    const fixture = createFocusFixture()

    expect(focusPokegearRadioSelection(fixture.root)).toBe(true)
    expect(fixture.focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(fixture.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
  })

  it('does not claim a focus transfer when no selection exists', () => {
    const root = { querySelector: vi.fn(() => null) } as unknown as ParentNode

    expect(focusPokegearMapBoard(root)).toBe(false)
    expect(focusPokegearRadioSelection(root)).toBe(false)
  })
})
