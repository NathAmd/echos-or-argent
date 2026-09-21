import { describe, expect, it } from 'vitest'
import {
  createGameAccessGate,
  createGameAccessPolicy,
  defaultGameAccessPolicy,
  evaluateGameFeatureAccess,
  type GameAccessSubjectState,
} from './gameFeatureAccess'

const anonymous: GameAccessSubjectState = {
  authentication: 'anonymous',
  subscription: 'unknown',
}
const signedIn: GameAccessSubjectState = {
  authentication: 'signed-in',
  subscription: 'inactive',
}
const subscribed: GameAccessSubjectState = {
  authentication: 'signed-in',
  subscription: 'active',
}

describe("politique commune d'accès aux fonctionnalités", () => {
  it("laisse aujourd'hui le multijoueur et le New Game+ ouverts sans compte ni abonnement", () => {
    expect(evaluateGameFeatureAccess('multiplayer', anonymous)).toEqual({ allowed: true })
    expect(evaluateGameFeatureAccess('new-game-plus', anonymous)).toEqual({ allowed: true })
    expect(defaultGameAccessPolicy).toEqual({
      multiplayer: { requireSignIn: false, requireSubscription: false },
      'new-game-plus': { requireSignIn: false, requireSubscription: false },
    })
  })

  it('renvoie sign-in-required uniquement quand la branche configurée exige une connexion', () => {
    const policy = createGameAccessPolicy({
      multiplayer: { requireSignIn: true },
    })

    expect(evaluateGameFeatureAccess('multiplayer', anonymous, policy))
      .toEqual({ allowed: false, reason: 'sign-in-required' })
    expect(evaluateGameFeatureAccess('multiplayer', signedIn, policy)).toEqual({ allowed: true })
    expect(evaluateGameFeatureAccess('new-game-plus', anonymous, policy)).toEqual({ allowed: true })
  })

  it("distingue la connexion manquante de l'abonnement manquant", () => {
    const policy = createGameAccessPolicy({
      'new-game-plus': { requireSubscription: true },
    })

    expect(evaluateGameFeatureAccess('new-game-plus', anonymous, policy))
      .toEqual({ allowed: false, reason: 'sign-in-required' })
    expect(evaluateGameFeatureAccess('new-game-plus', signedIn, policy))
      .toEqual({ allowed: false, reason: 'subscription-required' })
    expect(evaluateGameFeatureAccess('new-game-plus', {
      authentication: 'signed-in',
      subscription: 'unknown',
    }, policy)).toEqual({ allowed: false, reason: 'subscription-required' })
    expect(evaluateGameFeatureAccess('new-game-plus', subscribed, policy)).toEqual({ allowed: true })
  })

  it('relit un état injecté à chaque décision sans conserver de donnée de compte', () => {
    let current = anonymous
    const gate = createGameAccessGate({
      policy: createGameAccessPolicy({ multiplayer: { requireSubscription: true } }),
      readState: () => current,
    })

    expect(gate.check('multiplayer')).toEqual({ allowed: false, reason: 'sign-in-required' })
    current = signedIn
    expect(gate.check('multiplayer')).toEqual({ allowed: false, reason: 'subscription-required' })
    current = subscribed
    expect(gate.check('multiplayer')).toEqual({ allowed: true })
  })

  it('rejette les politiques, états et fonctionnalités non canoniques', () => {
    expect(() => createGameAccessPolicy({
      multiplayer: { requireSignIn: 'yes' },
    } as never)).toThrow(/booléenne/)
    expect(() => createGameAccessPolicy({ battle: {} } as never)).toThrow(/inconnue/)
    expect(() => evaluateGameFeatureAccess('multiplayer', {
      authentication: 'signed-in', subscription: 'active', secret: 'interdit',
    } as never)).toThrow(/invalide/)
    expect(() => evaluateGameFeatureAccess('battle' as never, anonymous)).toThrow(/inconnue/)
  })
})
