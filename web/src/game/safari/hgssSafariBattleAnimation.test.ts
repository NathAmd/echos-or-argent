import { describe, expect, it, vi } from 'vitest'
import type { HgssBattleAnimationCatalog, HgssBattleAnimationScript } from '../../rom/battle/battleAnimationScripts'
import type { HgssBattleAnimationPlaybackAudio } from '../battle/battleAnimationPlayback'
import {
  hgssSafariReactionAnimationScriptIds,
  playHgssSafariReactionAnimation,
  resolveHgssSafariReactionAnimationScripts,
} from './hgssSafariBattleAnimation'

function script(id: number, soundEffect?: number): HgssBattleAnimationScript {
  return {
    id,
    byteLength: soundEffect === undefined ? 4 : 12,
    words: new Uint32Array(),
    instructions: soundEffect === undefined
      ? [{ offsetWords: 0, opcode: 0, name: 'End', operands: new Uint32Array() }]
      : [
          { offsetWords: 0, opcode: 0, name: 'PlaySoundEffect', operands: Uint32Array.of(soundEffect) },
          { offsetWords: 2, opcode: 0, name: 'End', operands: new Uint32Array() },
        ],
  }
}

function catalog(): Pick<HgssBattleAnimationCatalog, 'battleScripts' | 'particleResourceResolver'> {
  const battleScripts = Array.from({ length: 30 }, (_, id) => script(id))
  battleScripts[27] = script(27, 1821)
  battleScripts[28] = script(28, 1927)
  battleScripts[29] = script(29, 2027)
  return { battleScripts, particleResourceResolver: vi.fn() }
}

function audio(): HgssBattleAnimationPlaybackAudio & { playSoundEffect: ReturnType<typeof vi.fn> } {
  return {
    playSoundEffect: vi.fn(async () => undefined),
    playPannedSoundEffect: vi.fn(async () => undefined),
    stopSoundEffect: vi.fn(),
    playPokemonCry: vi.fn(async () => undefined),
    isPokemonCryPlaying: vi.fn(() => false),
  }
}

describe('animations de réaction Safari HGSS', () => {
  it('enchaîne HAPPY puis EATING pour l’Appât et ANGRY pour la Boue', async () => {
    expect(hgssSafariReactionAnimationScriptIds).toEqual({ bait: [27, 28], mud: [29] })
    const resources = catalog()
    expect(resolveHgssSafariReactionAnimationScripts(resources, 'bait').map(({ id }) => id)).toEqual([27, 28])
    expect(resolveHgssSafariReactionAnimationScripts(resources, 'mud').map(({ id }) => id)).toEqual([29])
    const playbackAudio = audio()
    const player = { style: { animation: '', transform: '', transformOrigin: '' } } as unknown as HTMLElement
    const opponent = { style: { animation: '', transform: '', transformOrigin: '' } } as unknown as HTMLElement
    await playHgssSafariReactionAnimation(resources, 'bait', { player, opponent }, playbackAudio)
    expect(playbackAudio.playSoundEffect.mock.calls.map(([sequenceId]) => sequenceId)).toEqual([1821, 1927])
  })

  it('refuse silencieusement aucun remplacement si un script ROM requis manque', () => {
    const resources = catalog()
    resources.battleScripts[28] = { ...script(28), instructions: [] }
    expect(() => resolveHgssSafariReactionAnimationScripts(resources, 'bait')).toThrow(/28/)
  })
})
