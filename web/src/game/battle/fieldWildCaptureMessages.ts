import type { PokemonStoragePlacement } from '../pokemon/pokemonStorage'

export type FieldWildCaptureMessageFormatter = (
  template: string,
  values: readonly string[],
) => string

/**
 * Conserve la variante HGSS exacte du message PC hors du point d'entrée.
 * Le combat simple et le combat sauvage 2v1 peuvent ainsi partager le même
 * texte sans dupliquer la logique de changement de Boîte.
 */
export function formatFieldWildCaptureStorageMessage(
  messages: Readonly<Record<number, string>>,
  pokemonName: string,
  placement: PokemonStoragePlacement,
  format: FieldWildCaptureMessageFormatter,
): string {
  const previousBoxName = `BOÎTE ${placement.previousBox + 1}`
  const destinationBoxName = `BOÎTE ${placement.box + 1}`
  if (placement.previousBox === placement.box) {
    return format(
      messages[1174] ?? `${pokemonName} est transféré vers ${destinationBoxName} dans le PC de quelqu’un!`,
      [pokemonName, destinationBoxName],
    )
  }
  return format(
    messages[1176] ?? `${previousBoxName} dans le PC de quelqu’un est pleine.\n${pokemonName} est transféré vers ${destinationBoxName}!`,
    [previousBoxName, pokemonName, destinationBoxName],
  )
}
