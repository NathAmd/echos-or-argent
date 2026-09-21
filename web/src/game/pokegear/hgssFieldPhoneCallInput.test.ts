import { describe, expect, it } from 'vitest'
import { resolveHgssFieldPhoneCallInput } from './hgssFieldPhoneCallInput'

describe('propriété des entrées pendant un appel Pokématos', () => {
  it('laisse passer les commandes hors appel', () => {
    expect(resolveHgssFieldPhoneCallInput(false, true, 'up', true)).toBe('pass')
  })

  it('avance uniquement avec confirmation ou annulation visible', () => {
    expect(resolveHgssFieldPhoneCallInput(true, true, 'confirm', true)).toBe('advance')
    expect(resolveHgssFieldPhoneCallInput(true, true, 'cancel', true)).toBe('advance')
    expect(resolveHgssFieldPhoneCallInput(true, false, 'confirm', true)).toBe('block')
    expect(resolveHgssFieldPhoneCallInput(true, true, 'confirm', false)).toBe('block')
  })

  it('absorbe directions, menu et relâchements tant que l’appel est actif', () => {
    for (const action of ['up', 'down', 'left', 'right', 'menu']) {
      expect(resolveHgssFieldPhoneCallInput(true, true, action, true)).toBe('block')
    }
    expect(resolveHgssFieldPhoneCallInput(true, false, 'up', true)).toBe('block')
  })
})
