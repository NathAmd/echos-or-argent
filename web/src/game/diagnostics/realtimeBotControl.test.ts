import { describe, expect, it, vi } from 'vitest'
import { clickRequiredRealtimeBotControl } from './realtimeBotControl'

function rootReturning(control: Partial<HTMLButtonElement> | null): ParentNode {
  return {
    querySelector: vi.fn(() => control),
  } as unknown as ParentNode
}

describe('contrôle requis du bot temps réel', () => {
  it('active le contrôle attendu', () => {
    const click = vi.fn()

    clickRequiredRealtimeBotControl(
      rootReturning({ click, disabled: false, hidden: false }),
      '[data-title-account-key="local"]',
      'Mode local',
    )

    expect(click).toHaveBeenCalledOnce()
  })

  it('signale immédiatement un contrôle absent ou indisponible', () => {
    expect(() => clickRequiredRealtimeBotControl(
      rootReturning(null),
      '[data-title-account-key="local"]',
      'Mode local',
    )).toThrow('Contrôle E2E « Mode local » absent')

    expect(() => clickRequiredRealtimeBotControl(
      rootReturning({ click: vi.fn(), disabled: true, hidden: false }),
      '[data-title-account-key="local"]',
      'Mode local',
    )).toThrow('Contrôle E2E « Mode local » indisponible')
  })
})
