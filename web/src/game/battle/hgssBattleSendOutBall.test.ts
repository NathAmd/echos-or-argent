import { describe, expect, it } from 'vitest'
import { HGSS_POKE_BALL_ID } from '../../rom/battle/battleBallSprites'
import { resolveHgssBattleSendOutBallId } from './hgssBattleSendOutBall'

describe("résolution de la Ball d'envoi HGSS", () => {
  it('conserve chaque identifiant interne rendu par la LUT native', () => {
    for (const ballId of [1, 4, 5, 16, 17, 21, 24]) {
      expect(resolveHgssBattleSendOutBallId({ ballId })).toBe(ballId)
    }
  })

  it('retombe sans erreur sur la Poké Ball pour les données absentes ou invalides', () => {
    for (const pokemon of [
      undefined,
      null,
      {},
      { ballId: 0 },
      { ballId: -1 },
      { ballId: 25 },
      { ballId: 4.5 },
      { ballId: Number.NaN },
      { ballId: Number.POSITIVE_INFINITY },
    ]) {
      expect(resolveHgssBattleSendOutBallId(pokemon)).toBe(HGSS_POKE_BALL_ID)
    }
  })

  it("ne confond pas l'identifiant PK4 d'une Ball Fargas avec son identifiant d'objet", () => {
    expect(resolveHgssBattleSendOutBallId({ ballId: 21 })).toBe(21)
    expect(resolveHgssBattleSendOutBallId({ ballId: 496 })).toBe(HGSS_POKE_BALL_ID)
  })

  it('compose la même règle pour une entrée simple, un double et un remplacement', () => {
    const simple = { ballId: 11 }
    const double = [{ ballId: 5 }, { ballId: 24 }]
    const replacement = { ballId: 17 }

    expect(resolveHgssBattleSendOutBallId(simple)).toBe(11)
    expect(double.map(resolveHgssBattleSendOutBallId)).toEqual([5, 24])
    expect(resolveHgssBattleSendOutBallId(replacement)).toBe(17)
    expect(simple).toEqual({ ballId: 11 })
    expect(double).toEqual([{ ballId: 5 }, { ballId: 24 }])
    expect(replacement).toEqual({ ballId: 17 })
  })
})
