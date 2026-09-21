import { resetHgssBattleBallPresentation } from './battleCapturePlayback'
import { clearBattleCssAnimations } from './battleCssAnimation'
import { resetBattlePokemonSpritePresentation } from './battlePokemonSpritePresentation'

export type BattleScenePresentationResetMode = 'start' | 'exit'

export type BattleScenePresentationResetOptions = Readonly<{
  /**
   * `start` prépare les hosts sans changer la visibilité du root. `exit`
   * masque également le root une fois son sous-arbre neutralisé.
   */
  mode?: BattleScenePresentationResetMode
  /** Supprime les datasets visuels appartenant à la scène précédente. */
  clearDatasets?: boolean
}>

const transientBattleSceneClasses = [
  'is-impact',
  'is-heavy-impact',
  'is-capture-success',
  'is-trainer-encounter',
  'is-level-up',
  'is-exp-gaining',
  'is-evolution-only',
  'is-egg-hatch',
] as const

const transientBattleSceneDatasetKeys = [
  'presentation',
  'phase',
  'actionType',
  'action',
  'terrain',
  'battleKind',
  'kind',
  'weather',
  'uiMode',
  'ui',
  'safariMessageAdvance',
  'safariMessagePageTransition',
  'entryOverlay',
] as const

function descendants(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('*'))
}

function cancelBattleSceneAnimations(root: HTMLElement): void {
  // Fermer d'abord les lecteurs suivis sur chaque host empêche leur callback de
  // fin de se déclencher après le recyclage de la scène.
  for (const element of [root, ...descendants(root)]) {
    clearBattleCssAnimations(element, { cancelSubtreeAnimations: false })
  }
  // Puis neutraliser en une fois toute animation WAAPI/CSS non suivie.
  clearBattleCssAnimations(root, { cancelSubtreeAnimations: true })
}

function removeClasses(
  elements: Iterable<HTMLElement>,
  ...classNames: string[]
): void {
  for (const element of elements) element.classList.remove(...classNames)
}

function hide(elements: Iterable<HTMLElement>): void {
  for (const element of elements) element.hidden = true
}

function clearBattleEffectLayer(element: HTMLElement): void {
  if (element.tagName.toLowerCase() !== 'canvas') {
    element.replaceChildren()
    return
  }
  // Redimensionner à sa largeur courante efface le bitmap mais aussi les états
  // 2D (transform, alpha, composite) laissés par un effet interrompu.
  const canvas = element as HTMLCanvasElement
  const width = canvas.width
  canvas.width = width
}

/**
 * Rend le sous-arbre d'une scène de combat réutilisable par un nouveau combat.
 * La fonction ne dépend pas du type de session : simple, double et Safari
 * partagent le même contrat de nettoyage.
 */
export function resetBattleScenePresentation(
  root: HTMLElement,
  options: BattleScenePresentationResetOptions = {},
): void {
  const mode = options.mode ?? 'exit'
  cancelBattleSceneAnimations(root)

  root.classList.remove(...transientBattleSceneClasses)

  const trainers = root.querySelectorAll<HTMLElement>('.battle-trainer')
  removeClasses(trainers, 'is-arriving', 'is-throwing', 'is-double')
  hide(trainers)

  const huds = root.querySelectorAll<HTMLElement>('.battle-hud')
  removeClasses(huds, 'is-arriving', 'is-updating')
  hide(huds)

  const messages = root.querySelectorAll<HTMLElement>('.battle-message')
  removeClasses(messages, 'is-changing')
  hide(messages)

  const statCards = root.querySelectorAll<HTMLElement>('.battle-stat-gains')
  removeClasses(statCards, 'is-revealed')
  hide(statCards)

  for (const sprite of root.querySelectorAll<HTMLElement>('.battle-pokemon-sprite')) {
    resetBattlePokemonSpritePresentation(sprite, true)
  }
  for (const ball of root.querySelectorAll<HTMLElement>('.battle-pokeball')) {
    resetHgssBattleBallPresentation(ball)
  }

  hide(root.querySelectorAll<HTMLElement>('.battle-party-gauge'))
  hide(root.querySelectorAll<HTMLElement>('.battle-commands, .battle-moves'))
  removeClasses(root.querySelectorAll<HTMLElement>('.battle-moves'), 'battle-learn-move')

  for (const effects of root.querySelectorAll<HTMLElement>('.battle-effects')) {
    clearBattleEffectLayer(effects)
  }

  if (options.clearDatasets ?? true) {
    for (const key of transientBattleSceneDatasetKeys) delete root.dataset[key]
  }
  if (mode === 'exit') root.hidden = true
}
