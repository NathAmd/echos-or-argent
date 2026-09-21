import { describe, expect, it } from 'vitest'
import { resolveHgssEggHatchInput } from './hgssEggHatchInput'

describe('entree de la scene d eclosion HGSS', () => {
  it('laisse le timer posseder toute la phase de fissuration', () => {
    expect(resolveHgssEggHatchInput('cracking', 'confirm')).toBe('ignore')
    expect(resolveHgssEggHatchInput('cracking', 'cancel')).toBe('ignore')
  })

  it.each(['confirm', 'cancel'])('ouvre le choix du surnom avec %s une fois eclos', (action) => {
    expect(resolveHgssEggHatchInput('hatched', action)).toBe('request-nickname')
  })

  it('ignore les directions et les phases deja transferees a une autre UI', () => {
    expect(resolveHgssEggHatchInput('hatched', 'left')).toBe('ignore')
    expect(resolveHgssEggHatchInput('nickname-choice', 'confirm')).toBe('ignore')
    expect(resolveHgssEggHatchInput('naming', 'cancel')).toBe('ignore')
  })
})
