import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import {
  clearBattleCssAnimation,
  restartBattleCssAnimation,
  type BattleCssAnimationRun,
} from './battleCssAnimation'
import { shouldPresentBattleFaint } from './battleFaintPresentation'
import {
  captureBattlePokemonSpritePresentation,
  isBattlePokemonSpriteBoundTo,
  isBattlePokemonSpritePresentationCurrent,
} from './battlePokemonSpritePresentation'

export type BattleSceneMotionOptions = Readonly<{
  reducedMotion?: boolean
}>

export type BattlePokemonRevealAnimations = Readonly<{
  spriteAnimation: BattleCssAnimationRun
  hudAnimation?: BattleCssAnimationRun
}>

export type BattleImpactAnimations = Readonly<{
  kind: 'light' | 'heavy'
  spriteAnimation: BattleCssAnimationRun
  sceneAnimation: BattleCssAnimationRun
}>

export type BattleFaintAnimationPokemon = Pick<
  CanonicalPokemon,
  'instanceId' | 'currentHp'
>

const battlePokemonFrameMotionClasses = [
  'is-arriving',
  'is-hit',
  'is-stat-up',
  'is-stat-down',
  'is-heal',
  'is-fainting',
] as const

function clearBattlePokemonFrameMotions(sprite: HTMLElement, except?: typeof battlePokemonFrameMotionClasses[number]): void {
  for (const className of battlePokemonFrameMotionClasses) if (className !== except) clearBattleCssAnimation(sprite, className)
}

function animationOptions(options: BattleSceneMotionOptions): BattleSceneMotionOptions {
  return { reducedMotion: options.reducedMotion }
}

/** Révèle un sprite et relance son entrée sans conserver un ancien état de K.O. */
export function playBattlePokemonEntrance(options: BattleSceneMotionOptions & Readonly<{
  sprite: HTMLElement
}>): BattleCssAnimationRun {
  clearBattlePokemonFrameMotions(options.sprite, 'is-arriving')
  options.sprite.hidden = false
  return restartBattleCssAnimation(options.sprite, 'is-arriving', animationOptions(options))
}

/** Révèle atomiquement le Pokémon et, lorsqu'il existe, son HUD. */
export function revealBattlePokemon(options: BattleSceneMotionOptions & Readonly<{
  sprite: HTMLElement
  hud?: HTMLElement | null
}>): BattlePokemonRevealAnimations {
  const spriteAnimation = playBattlePokemonEntrance(options)
  if (!options.hud) return { spriteAnimation }
  clearBattleCssAnimation(options.hud, 'is-updating')
  options.hud.hidden = false
  const hudAnimation = restartBattleCssAnimation(options.hud, 'is-arriving', animationOptions(options))
  return { spriteAnimation, hudAnimation }
}

/** Révèle un dresseur seulement lorsqu'un visuel a été monté dans son host. */
export function playBattleTrainerEntrance(options: BattleSceneMotionOptions & Readonly<{
  trainer: HTMLElement
}>): BattleCssAnimationRun | undefined {
  if (options.trainer.childElementCount === 0) return undefined
  clearBattleCssAnimation(options.trainer, 'is-throwing')
  options.trainer.hidden = false
  return restartBattleCssAnimation(options.trainer, 'is-arriving', animationOptions(options))
}

/** Le lancer remplace une éventuelle arrivée encore active sur le même host. */
export function playBattleTrainerThrow(options: BattleSceneMotionOptions & Readonly<{
  trainer: HTMLElement
}>): BattleCssAnimationRun | undefined {
  if (options.trainer.hidden) return undefined
  clearBattleCssAnimation(options.trainer, 'is-arriving')
  return restartBattleCssAnimation(options.trainer, 'is-throwing', animationOptions(options))
}

/**
 * Joue l'impact du sprite et de la scène. Comme dans HGSS, un coup retirant au
 * moins un quart des PV maximum utilise la variante lourde.
 */
export function playBattleImpact(options: BattleSceneMotionOptions & Readonly<{
  root: HTMLElement
  sprite: HTMLElement
  damage: number
  maximumHp: number
}>): BattleImpactAnimations | undefined {
  if (options.damage <= 0) return undefined
  clearBattlePokemonFrameMotions(options.sprite, 'is-hit')
  const spriteAnimation = restartBattleCssAnimation(options.sprite, 'is-hit', animationOptions(options))
  const heavy = options.damage * 4 >= Math.max(1, options.maximumHp)
  const sceneClass = heavy ? 'is-heavy-impact' : 'is-impact'
  clearBattleCssAnimation(options.root, heavy ? 'is-impact' : 'is-heavy-impact')
  const sceneAnimation = restartBattleCssAnimation(options.root, sceneClass, animationOptions(options))
  return { kind: heavy ? 'heavy' : 'light', spriteAnimation, sceneAnimation }
}

/**
 * Persiste le visuel de K.O. uniquement pour l'occupant encore lié au host.
 * Le token de révision protège aussi la micro-tâche terminale d'un rebind ayant
 * eu lieu entre la dernière frame et le callback de fin.
 */
export function playBattlePokemonFaint(options: BattleSceneMotionOptions & Readonly<{
  sprite: HTMLElement
  defeated: BattleFaintAnimationPokemon
  current: BattleFaintAnimationPokemon
}>): BattleCssAnimationRun | undefined {
  if (!shouldPresentBattleFaint(options.defeated, options.current)) return undefined
  if (!isBattlePokemonSpriteBoundTo(options.sprite, options.defeated)) return undefined
  const token = captureBattlePokemonSpritePresentation(options.sprite)
  clearBattlePokemonFrameMotions(options.sprite, 'is-fainting')
  return restartBattleCssAnimation(options.sprite, 'is-fainting', {
    ...animationOptions(options),
    persist: true,
    onFinish: () => {
      if (!isBattlePokemonSpritePresentationCurrent(options.sprite, token)) return
      if (isBattlePokemonSpriteBoundTo(options.sprite, options.defeated)) options.sprite.hidden = true
    },
  })
}
