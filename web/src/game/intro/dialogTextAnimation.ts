/**
 * Presents dialogue atomically throughout the single-screen UI.
 *
 * The timing arguments stay in the shared API because the intro and field
 * renderers use the same helper. They must not turn the first confirmation
 * into a hidden "finish typing" action.
 */
export function getRevealedDialogText(text: string, _elapsedMs: number, speedMultiplier = 1): string {
  if (!Number.isFinite(speedMultiplier) || speedMultiplier <= 0) throw new Error('Le multiplicateur de vitesse du texte doit être positif.')
  return text
}
