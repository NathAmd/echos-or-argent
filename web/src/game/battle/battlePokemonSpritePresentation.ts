import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { clearBattleCssAnimations } from './battleCssAnimation'

export const transientBattlePokemonClasses = [
  'is-arriving',
  'is-hit',
  'is-fainting',
  'is-stat-up',
  'is-stat-down',
  'is-heal',
] as const

const transientBattlePokemonStyleProperties = [
  'animation',
  'opacity',
  'transform',
  'transformOrigin',
  'translate',
  'scale',
  'rotate',
  'filter',
  'visibility',
] as const

type BattlePokemonIdentity = Pick<CanonicalPokemon, 'instanceId'>
const fallbackPresentationDatasets = new WeakMap<HTMLElement, Record<string, string>>()

export type BattlePokemonSpritePresentationToken = Readonly<{
  identity?: string
  revision: number
}>

function presentationDataset(element: HTMLElement): DOMStringMap | Record<string, string> {
  if (element.dataset) return element.dataset
  let dataset = fallbackPresentationDatasets.get(element)
  if (!dataset) {
    dataset = {}
    fallbackPresentationDatasets.set(element, dataset)
  }
  return dataset
}

function nextPresentationRevision(element: HTMLElement): number {
  const dataset = presentationDataset(element)
  const current = Number.parseInt(dataset.battlePresentationRevision ?? '0', 10)
  const revision = Number.isFinite(current) ? current + 1 : 1
  dataset.battlePresentationRevision = String(revision)
  return revision
}

/** Identité persistante d'un Pokémon, stable entre les clones moteur/UI. */
export function getBattlePokemonPresentationIdentity(pokemon: BattlePokemonIdentity): string {
  return pokemon.instanceId
}

export function captureBattlePokemonSpritePresentation(
  element: HTMLElement,
): BattlePokemonSpritePresentationToken {
  const dataset = presentationDataset(element)
  return {
    identity: dataset.battlePokemonIdentity,
    revision: Number.parseInt(dataset.battlePresentationRevision ?? '0', 10) || 0,
  }
}

export function isBattlePokemonSpritePresentationCurrent(
  element: HTMLElement,
  token: BattlePokemonSpritePresentationToken,
): boolean {
  const dataset = presentationDataset(element)
  return dataset.battlePokemonIdentity === token.identity
    && (Number.parseInt(dataset.battlePresentationRevision ?? '0', 10) || 0) === token.revision
}

/**
 * Lie atomiquement un host partagé à son occupant. Un changement d'identité
 * invalide d'abord tous les lecteurs qui détenaient encore l'ancien host.
 */
export function bindBattlePokemonSpritePresentation(
  element: HTMLElement,
  pokemon: BattlePokemonIdentity,
  options: { hidden?: boolean, force?: boolean } = {},
): { identity: string, changed: boolean, token: BattlePokemonSpritePresentationToken } {
  const dataset = presentationDataset(element)
  const identity = getBattlePokemonPresentationIdentity(pokemon)
  const changed = options.force === true || dataset.battlePokemonIdentity !== identity
  if (changed) resetBattlePokemonSpritePresentation(element, options.hidden ?? false)
  else element.hidden = options.hidden ?? element.hidden
  presentationDataset(element).battlePokemonIdentity = identity
  return { identity, changed, token: captureBattlePokemonSpritePresentation(element) }
}

export function isBattlePokemonSpriteBoundTo(
  element: HTMLElement,
  pokemon: BattlePokemonIdentity,
): boolean {
  return presentationDataset(element).battlePokemonIdentity === getBattlePokemonPresentationIdentity(pokemon)
}

/**
 * Couche stable animée par CSS. Les frames ROM peuvent remplacer leur canvas
 * sans redémarrer l'impact, le changement de statistique ou l'animation de K.O.
 */
export function getBattlePokemonSpriteFrame(element: HTMLElement): HTMLElement {
  const mounted = element.querySelector<HTMLElement>(':scope > .battle-pokemon-frame')
  if (mounted) return mounted
  const frame = document.createElement('div')
  frame.className = 'battle-pokemon-frame'
  const currentCanvas = element.querySelector<HTMLCanvasElement>(':scope > canvas')
  if (currentCanvas) frame.append(currentCanvas)
  element.replaceChildren(frame)
  return frame
}

/**
 * Rend un host de Pokémon réutilisable par n'importe quelle scène de combat.
 *
 * Les combats simples, doubles et Safari partagent leurs éléments DOM. Une
 * Web Animation terminée avec `fill: forwards` survit au changement de scène :
 * il faut donc annuler le lecteur lui-même, et pas seulement masquer le host.
 */
export function resetBattlePokemonSpritePresentation(
  element: HTMLElement,
  hidden = element.hidden,
): void {
  const dataset = presentationDataset(element)
  nextPresentationRevision(element)
  clearBattleCssAnimations(element)
  element.classList.remove(...transientBattlePokemonClasses)
  for (const property of transientBattlePokemonStyleProperties) element.style[property] = ''
  element.style.removeProperty?.('--battle-sprite-height')
  for (const child of element.querySelectorAll?.<HTMLElement>(':scope > canvas, :scope > .battle-pokemon-frame, :scope > .battle-pokemon-frame > canvas') ?? []) {
    for (const property of transientBattlePokemonStyleProperties) child.style[property] = ''
  }
  // Le cache de rendu conserve un canvas par frame et par host. Recréer la
  // couche stable à chaque occupant empêche un canvas détaché (et son ancien
  // transform Poképic) de réapparaître pendant une frame au prochain switch.
  element.replaceChildren()
  delete dataset.battlePokemonIdentity
  delete dataset.battlePokemonVisual
  delete dataset.shiny
  element.hidden = hidden
}
