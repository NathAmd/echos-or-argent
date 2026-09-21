import type { HgssBattleAnimationCatalog, HgssBattleAnimationScript } from '../../rom/battle/battleAnimationScripts'
import {
  playConfirmedHgssBattleAnimation,
  type HgssBattleAnimationPlaybackAudio,
  type HgssBattleAnimationPlaybackContext,
  type HgssBattleAnimationPlaybackElements,
  type HgssBattleAnimationSpritePlayback,
} from './battleAnimationPlayback'
import type { SimpleBattleSide } from './simpleBattleSession'

/** Identifiants BATTLE_ANIMATION_* de la table native HGSS (/a/0/6/1). */
export const HGSS_BATTLE_PRESENTATION_SCRIPT_IDS = {
  sleep: 1,
  poison: 2,
  badPoison: 2,
  burn: 3,
  freeze: 4,
  paralysis: 5,
  confusion: 6,
  infatuation: 7,
  levelUp: 8,
  bagItem: 9,
  heldItem: 10,
  shiny: 11,
  statUp: 12,
  statDown: 13,
  heal: 14,
} as const

export type HgssBattlePresentationAnimation = keyof typeof HGSS_BATTLE_PRESENTATION_SCRIPT_IDS

const cannotActAnimations = {
  sleep: 'sleep',
  freeze: 'freeze',
  paralysis: 'paralysis',
  infatuation: 'infatuation',
} as const satisfies Readonly<Record<string, HgssBattlePresentationAnimation>>

export function resolveHgssCannotActPresentationAnimation(reason: string): HgssBattlePresentationAnimation | undefined {
  return cannotActAnimations[reason as keyof typeof cannotActAnimations]
}

export function resolveHgssConditionPresentationAnimation(
  condition: string,
  applied: boolean,
): HgssBattlePresentationAnimation | undefined {
  // La ROM ne joue l'effet cœur que lors du contrôle d'action, pas lors de
  // l'application d'Attraction (l'animation de la capacité s'en charge).
  return applied && condition === 'infatuationActive' ? 'infatuation' : undefined
}

export type HgssBattlePresentationEvent =
  | { kind: 'status', status: 'sleep' | 'poison' | 'badPoison' | 'burn' | 'freeze' | 'paralysis', applied: boolean }
  | { kind: 'cannotAct', reason: string }
  | { kind: 'confusion', state: 'started' | 'active' | 'ended' }
  | { kind: 'residual', status: string }
  | { kind: 'heal', amount: number }
  | { kind: 'stat', change: number, applied: boolean }
  | { kind: 'condition', condition: string, applied: boolean }

/** Même décision de présentation pour les événements simples et doubles. */
export function resolveHgssBattleEventPresentationAnimation(
  event: HgssBattlePresentationEvent,
): HgssBattlePresentationAnimation | undefined {
  if (event.kind === 'status') return event.applied ? event.status : undefined
  if (event.kind === 'cannotAct') return resolveHgssCannotActPresentationAnimation(event.reason)
  if (event.kind === 'confusion') return event.state === 'ended' ? undefined : 'confusion'
  if (event.kind === 'residual') {
    return event.status === 'poison' || event.status === 'badPoison' || event.status === 'burn'
      ? event.status
      : undefined
  }
  if (event.kind === 'heal') return event.amount > 0 ? 'heal' : undefined
  if (event.kind === 'stat') return event.applied ? event.change > 0 ? 'statUp' : 'statDown' : undefined
  return resolveHgssConditionPresentationAnimation(event.condition, event.applied)
}

export function resolveHgssBattlePresentationScript(
  catalog: Pick<HgssBattleAnimationCatalog, 'battleScripts'>,
  animation: HgssBattlePresentationAnimation,
): HgssBattleAnimationScript | undefined {
  const script = catalog.battleScripts[HGSS_BATTLE_PRESENTATION_SCRIPT_IDS[animation]]
  return script && script.instructions.length > 0 ? script : undefined
}

/**
 * Point d'entrée commun aux effets hors-capacité. Il exécute les scripts,
 * particules et sons présents dans la ROM avec le battler affecté comme cible.
 */
export async function playHgssBattlePresentationAnimation(
  catalog: Pick<HgssBattleAnimationCatalog, 'battleScripts' | 'particleResourceResolver'>,
  animation: HgssBattlePresentationAnimation,
  affectedSide: SimpleBattleSide,
  elements: HgssBattleAnimationPlaybackElements,
  audio?: HgssBattleAnimationPlaybackAudio,
  context: HgssBattleAnimationPlaybackContext = {},
  spritePlayback?: HgssBattleAnimationSpritePlayback,
): Promise<void> {
  const script = resolveHgssBattlePresentationScript(catalog, animation)
  if (!script) return
  await playConfirmedHgssBattleAnimation(
    script,
    affectedSide,
    elements,
    audio,
    catalog.particleResourceResolver,
    context,
    spritePlayback,
  )
}
