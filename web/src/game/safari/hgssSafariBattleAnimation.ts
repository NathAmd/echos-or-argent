import type { HgssBattleAnimationCatalog, HgssBattleAnimationScript } from '../../rom/battle/battleAnimationScripts'
import {
  playConfirmedHgssBattleAnimation,
  type HgssBattleAnimationPlaybackAudio,
  type HgssBattleAnimationPlaybackElements,
  type HgssBattleAnimationSpritePlayback,
} from '../battle/battleAnimationPlayback'

export type HgssSafariBattleReaction = 'bait' | 'mud'

/** BATTLE_ANIMATION_HAPPY/EATING/ANGRY de `battle_subscript.h`. */
export const hgssSafariReactionAnimationScriptIds = Object.freeze({
  bait: [27, 28],
  mud: [29],
} as const satisfies Readonly<Record<HgssSafariBattleReaction, readonly number[]>>)

export function resolveHgssSafariReactionAnimationScripts(
  catalog: Pick<HgssBattleAnimationCatalog, 'battleScripts'>,
  reaction: HgssSafariBattleReaction,
): readonly HgssBattleAnimationScript[] {
  return hgssSafariReactionAnimationScriptIds[reaction].map((scriptId) => {
    const script = catalog.battleScripts[scriptId]
    if (!script?.instructions.length) throw new Error(`L'animation Safari HGSS ${scriptId} est absente de la ROM.`)
    return script
  })
}

/**
 * Rejoue séquentiellement les sous-animations réellement demandées par les
 * scripts Safari 227/228. Le lanceur reste le joueur et le Pokémon la cible.
 */
export async function playHgssSafariReactionAnimation(
  catalog: Pick<HgssBattleAnimationCatalog, 'battleScripts' | 'particleResourceResolver'>,
  reaction: HgssSafariBattleReaction,
  elements: HgssBattleAnimationPlaybackElements,
  audio?: HgssBattleAnimationPlaybackAudio,
  spritePlayback?: HgssBattleAnimationSpritePlayback,
  options: { signal?: AbortSignal } = {},
): Promise<void> {
  for (const script of resolveHgssSafariReactionAnimationScripts(catalog, reaction)) {
    await playConfirmedHgssBattleAnimation(
      script,
      'player',
      elements,
      audio,
      catalog.particleResourceResolver,
      { signal: options.signal },
      spritePlayback,
    )
  }
}
