import { describe, expect, it, vi } from 'vitest'
import { resolveSingleScreenLayout, syncBrowserSingleScreenLayout } from './singleScreenLayout'

describe('single-screen responsive layout', () => {
  it('uses a touch-safe portrait composition without forcing the system keyboard', () => {
    expect(resolveSingleScreenLayout(390, 844, true)).toEqual({
      profile: 'phone-portrait', nicknameKeyboardColumns: 5, autoFocusTextInput: false, compactHeight: false,
    })
  })

  it('keeps a compact landscape composition on a phone', () => {
    expect(resolveSingleScreenLayout(844, 390, true)).toEqual({
      profile: 'phone-landscape', nicknameKeyboardColumns: 10, autoFocusTextInput: false, compactHeight: true,
    })
  })

  it('preserves hardware-keyboard focus on desktop', () => {
    expect(resolveSingleScreenLayout(1440, 900, false)).toEqual({
      profile: 'desktop', nicknameKeyboardColumns: 10, autoFocusTextInput: true, compactHeight: false,
    })
  })

  it('publishes the browser profile and visual viewport height for CSS', () => {
    const toggle = vi.fn()
    const setProperty = vi.fn()
    const target = { dataset: {}, classList: { toggle }, style: { setProperty } } as unknown as HTMLElement

    const layout = syncBrowserSingleScreenLayout({
      innerWidth: 844,
      innerHeight: 390,
      visualViewport: { height: 372 },
      matchMedia: () => ({ matches: true }),
    }, target)

    expect(layout.profile).toBe('phone-landscape')
    expect(target.dataset.displayProfile).toBe('phone-landscape')
    expect(toggle).toHaveBeenCalledWith('compact-height', true)
    expect(setProperty).toHaveBeenCalledWith('--visual-viewport-height', '372px')
  })
})
