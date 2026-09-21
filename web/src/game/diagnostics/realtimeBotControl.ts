/**
 * Active un contrôle que le parcours navigateur considère comme un invariant.
 * Un sélecteur optionnel masquerait une régression DOM jusqu'au timeout E2E.
 */
export function clickRequiredRealtimeBotControl(
  root: ParentNode,
  selector: string,
  label: string,
): void {
  const control = root.querySelector<HTMLButtonElement>(selector)
  if (!control) {
    throw new Error(`Contrôle E2E « ${label} » absent (${selector}).`)
  }
  if (control.disabled || control.hidden) {
    throw new Error(`Contrôle E2E « ${label} » indisponible (${selector}).`)
  }
  control.click()
}
