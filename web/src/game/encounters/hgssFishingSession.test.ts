import { describe, expect, it, vi } from 'vitest'
import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import {
  HGSS_FISHING_CAST_FRAMES,
  HGSS_FISHING_LANDED_DELAY_FRAMES,
  HGSS_FISHING_NO_BITE_WAIT_FRAMES,
  HGSS_FISHING_RECOVERY_FRAMES,
  createHgssFishingSession,
  getHgssFishingHookWindowFrames,
} from './hgssFishingSession'

function rng(value: number): Pick<HgssLcrng, 'nextU16'> {
  return { nextU16: () => value }
}

function tick(session: ReturnType<typeof createHgssFishingSession>, count: number): void {
  for (let frame = 0; frame < count; frame += 1) session.tick()
}

describe('mini-jeu de pêche HGSS', () => {
  it('reproduit les fenêtres des trois cannes et les cinq bonus d humeur du follower', () => {
    expect(['oldRod', 'goodRod', 'superRod'].map((rod) => getHgssFishingHookWindowFrames(rod as never))).toEqual([45, 30, 15])
    expect([-10, -9, 10, 50, 100].map((mood) => getHgssFishingHookWindowFrames('oldRod', mood))).toEqual([45, 54, 60, 66, 75])
    expect([-10, -9, 10, 50, 100].map((mood) => getHgssFishingHookWindowFrames('goodRod', mood))).toEqual([30, 36, 42, 48, 54])
    expect([-10, -9, 10, 50, 100].map((mood) => getHgssFishingHookWindowFrames('superRod', mood))).toEqual([15, 18, 21, 24, 27])
  })

  it('joue le son au dixième frame puis accepte A uniquement pendant la fenêtre de touche', () => {
    const sound = vi.fn()
    const bite = vi.fn()
    const messages: number[] = []
    const complete = vi.fn()
    const session = createHgssFishingSession({
      rod: 'superRod', hasEncounter: true, rng: rng(0), onCastSound: sound, onBite: bite,
      onMessage: (messageId) => messages.push(messageId), onComplete: complete,
    })
    tick(session, 9)
    expect(sound).not.toHaveBeenCalled()
    session.tick()
    expect(sound).toHaveBeenCalledWith(1615)
    tick(session, HGSS_FISHING_CAST_FRAMES - 10)
    expect(session.getState()).toMatchObject({ phase: 'waiting', framesRemaining: 29 })
    tick(session, 29)
    expect(session.getState()).toMatchObject({ phase: 'bite', framesRemaining: 14 })
    expect(bite).toHaveBeenCalledOnce()
    session.handle('confirm')
    tick(session, HGSS_FISHING_LANDED_DELAY_FRAMES - 1)
    expect(messages).toEqual([])
    session.tick()
    expect(messages).toEqual([52])
    session.handle('confirm')
    expect(session.getState()).toMatchObject({ phase: 'recovering', framesRemaining: HGSS_FISHING_RECOVERY_FRAMES })
    tick(session, HGSS_FISHING_RECOVERY_FRAMES - 1)
    expect(complete).not.toHaveBeenCalled()
    session.tick()
    expect(complete).toHaveBeenCalledWith('landed')
  })

  it('distingue retrait trop tôt, aucune touche et Pokémon échappé avec les messages 51, 49 et 50', () => {
    const run = (hasEncounter: boolean, advance: number, pressEarly = false): number[] => {
      const messages: number[] = []
      const session = createHgssFishingSession({ rod: 'oldRod', hasEncounter, rng: rng(0), onMessage: (id) => messages.push(id) })
      tick(session, HGSS_FISHING_CAST_FRAMES)
      if (pressEarly) session.handle('confirm')
      else tick(session, advance)
      return messages
    }
    expect(run(true, 0, true)).toEqual([51])
    expect(run(false, HGSS_FISHING_NO_BITE_WAIT_FRAMES - 1)).toEqual([49])
    expect(run(true, 29 + 44 + 1)).toEqual([50])
  })

  it('ignore B avant le message puis accepte A ou B dès que le message est imprimé', () => {
    const complete = vi.fn()
    const session = createHgssFishingSession({ rod: 'oldRod', hasEncounter: true, rng: rng(0), onComplete: complete })
    tick(session, HGSS_FISHING_CAST_FRAMES)
    session.handle('cancel')
    expect(session.getState().phase).toBe('waiting')
    session.handle('confirm')
    session.handle('cancel')
    tick(session, HGSS_FISHING_RECOVERY_FRAMES)
    expect(complete).toHaveBeenCalledWith('too-early')
  })

  it('consomme le tirage natif et place la réaction sur le follower selon son amitié', () => {
    const values = [0, 19]
    const targets: string[] = []
    const session = createHgssFishingSession({
      rod: 'oldRod', hasEncounter: true,
      rng: { nextU16: () => values.shift() ?? 0xffff },
      followerFriendship: 100,
      onBite: (target) => targets.push(target),
    })
    tick(session, HGSS_FISHING_CAST_FRAMES + 29)
    expect(targets).toEqual(['follower'])
  })

  it('conserve puis retire l indicateur de touche aux mêmes transitions que la ROM', () => {
    const ended: string[] = []
    const dismissed: number[] = []
    const session = createHgssFishingSession({
      rod: 'superRod', hasEncounter: true, rng: rng(0),
      onBiteEnd: (target) => ended.push(target),
      onMessageDismiss: (messageId) => dismissed.push(messageId),
    })
    tick(session, HGSS_FISHING_CAST_FRAMES + 29)
    tick(session, 14)
    expect(session.getState().phase).toBe('got-away-delay')
    expect(ended).toEqual([])
    session.tick()
    expect(session.getState().phase).toBe('message')
    session.handle('cancel')
    expect(ended).toEqual(['player'])
    expect(dismissed).toEqual([50])
  })
})
