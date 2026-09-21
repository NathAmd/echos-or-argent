import { describe, expect, it, vi } from 'vitest'
import { findHgssBattleVictoryFaintIndex, startHgssBattleVictoryMusic } from './hgssBattleAudioPresentation'

describe('présentation audio terminale des combats HGSS', () => {
  it('place le changement de BGM sur le dernier K.O. adverse du lot victorieux', () => {
    expect(findHgssBattleVictoryFaintIndex([
      { kind: 'faint', target: { side: 'opponent' } },
      { kind: 'faint', target: { side: 'player' } },
      { kind: 'faint', target: { side: 'opponent' } },
      { kind: 'result', result: 'won' },
    ])).toBe(2)
    expect(findHgssBattleVictoryFaintIndex([
      { kind: 'faint', side: 'opponent' },
      { kind: 'result', result: 'lost' },
    ])).toBe(-1)
  })

  it.each([
    ['wild', undefined, 1129],
    ['trainer', 1, 1128],
    ['trainer', 66, 1131],
    ['trainer', 97, 1148],
  ] as const)('lance la victoire %s de classe %s', (kind, trainerClass, sequenceId) => {
    const playMusic = vi.fn(async () => undefined)

    startHgssBattleVictoryMusic({ playMusic }, kind, trainerClass)

    expect(playMusic).toHaveBeenCalledExactlyOnceWith(sequenceId)
  })

  it('absorbe une indisponibilité audio sans bloquer les messages terminaux', async () => {
    const rejected = Promise.reject(new Error('autoplay'))
    startHgssBattleVictoryMusic({ playMusic: () => rejected }, 'wild')

    await rejected.catch(() => undefined)
  })
})
