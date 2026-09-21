import { describe, expect, it } from 'vitest'
import { createOnlineRuntimeAccessToken } from './onlineRuntimeAccessToken'

describe('jeton d’accès en mémoire', () => {
  it('ne l’expose que tant que la capsule runtime le détient', () => {
    const token = createOnlineRuntimeAccessToken()
    expect(token.read()).toBeUndefined()

    token.replace('opaque-runtime-token')
    expect(token.read()).toBe('opaque-runtime-token')

    token.clear()
    expect(token.read()).toBeUndefined()
  })

  it.each(['', 'avec espace', `x${'a'.repeat(512)}`])('refuse un jeton invalide ou trop grand', (value) => {
    const token = createOnlineRuntimeAccessToken()
    expect(() => token.replace(value)).toThrow('invalide')
    expect(token.read()).toBeUndefined()
  })
})
