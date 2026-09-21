const defaultRenderPixelBudget = 3_200_000

/**
 * Garde une densité nette sur les petits écrans sans multiplier inutilement
 * le fill-rate WebGL/Canvas sur les écrans Retina et très larges.
 */
export function resolveGameRenderPixelRatio(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  pixelBudget = defaultRenderPixelBudget,
): number {
  const width = Math.max(1, Number.isFinite(cssWidth) ? cssWidth : 1)
  const height = Math.max(1, Number.isFinite(cssHeight) ? cssHeight : 1)
  const nativeRatio = Math.max(1, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1)
  const budgetRatio = Math.sqrt(Math.max(1, pixelBudget) / (width * height))
  return Math.max(0.75, Math.min(2, nativeRatio, budgetRatio))
}
