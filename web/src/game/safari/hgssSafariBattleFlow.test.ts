import { describe, expect, it } from 'vitest'
import { createHgssSafariBattleIntroduction, hgssSafariBattleCommandMessages, resolveHgssSafariBattleTurnPresentation } from './hgssSafariBattleFlow'

const names = { playerName: 'JOHAN', opponentName: 'RACAillou', safariBallName: 'SAFARI BALL' }

describe('présentation du combat Safari HGSS', () => {
  it('utilise exclusivement les quatre commandes et l introduction de la banque 197', () => {
    expect(hgssSafariBattleCommandMessages).toEqual([
      { action: 'ball', messageId: 931 },
      { action: 'bait', messageId: 932 },
      { action: 'mud', messageId: 933 },
      { action: 'run', messageId: 927 },
    ])
    expect(createHgssSafariBattleIntroduction(names)).toEqual([{
      messageId: 965, values: ['RACAillou'], animation: { kind: 'encounter' },
      sceneCues: { beforeMessage: 'opponent-gauge', afterPrinter: 'safari-gauge' },
      advance: 'input-or-timeout', beforeFrames: 122, minimumFrames: 7,
    }])
  })

  it('enchaîne automatiquement le lancer puis chacun des cinq résultats natifs', () => {
    const outcomes = [
      { caught: false as const, shakes: 0 as const, messageId: 863 },
      { caught: false as const, shakes: 1 as const, messageId: 864 },
      { caught: false as const, shakes: 2 as const, messageId: 865 },
      { caught: false as const, shakes: 3 as const, messageId: 866 },
      { caught: true as const, shakes: 4 as const, messageId: 867 },
    ]
    for (const outcome of outcomes) {
      const messages = resolveHgssSafariBattleTurnPresentation({
        state: {} as never,
        events: [{ kind: 'ball', capture: { caught: outcome.caught, shakes: outcome.shakes, modifiedCatchRate: 1 }, ballsRemaining: 1 }],
      }, names)
      expect(messages.map(({ messageId }) => messageId)).toEqual([857, outcome.messageId])
      expect(messages.map(({ advance }) => advance)).toEqual(['automatic', 'automatic'])
      expect(messages[0]).toMatchObject({ animation: { kind: 'ball' }, animationTiming: 'after-message' })
      expect(messages[0]!.minimumFrames).toBeUndefined()
      expect(messages[1]!.animation).toBeUndefined()
      expect(messages[1]!.sceneCues).toEqual(outcome.caught ? { afterPrinter: 'capture-fade', afterPrinterTiming: 'before-delay' } : undefined)
      expect(messages[1]!.values).toEqual(outcome.caught ? ['RACAillou'] : [])
      expect(messages[1]!.audio).toEqual(outcome.caught ? { kind: 'music', sequenceId: 1129 } : undefined)
    }
  })

  it('présente les réactions fortes Appât/Boue puis le tour adverse', () => {
    const messages = resolveHgssSafariBattleTurnPresentation({
      state: {} as never,
      events: [
        { kind: 'bait', strongReaction: true },
        { kind: 'watching' },
        { kind: 'mud', strongReaction: false },
        { kind: 'opponent-fled' },
      ],
    }, names)
    expect(messages.map(({ messageId }) => messageId)).toEqual([851, 853, 849, 854, 855, 784])
    expect(messages.every(({ advance }) => advance === 'input-or-timeout')).toBe(true)
    expect(messages.filter(({ animation }) => animation).every(({ animationTiming }) => animationTiming === 'after-message')).toBe(true)
  })

  it('utilise les messages ROM de fuite, manque de place et fin de Balls', () => {
    const outcomeIds = ['player-ran', 'storage-full', 'balls-out'].map((outcome) => resolveHgssSafariBattleTurnPresentation({
      state: {} as never,
      events: [{ kind: outcome === 'player-ran' ? 'player-ran' : outcome === 'storage-full' ? 'storage-full' : 'balls-out' }],
    }, names)[0]!.messageId)
    expect(outcomeIds).toEqual([781, 874, 850])
    expect(resolveHgssSafariBattleTurnPresentation({ state: {} as never, events: [{ kind: 'player-ran' }] }, names)[0]!.audio).toEqual({ kind: 'sound', sequenceId: 1791 })
    expect(resolveHgssSafariBattleTurnPresentation({ state: {} as never, events: [{ kind: 'balls-out' }] }, names)[0]!.audio).toEqual({ kind: 'sound', sequenceId: 1521 })
  })
})
