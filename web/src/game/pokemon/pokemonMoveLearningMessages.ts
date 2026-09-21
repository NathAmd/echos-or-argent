import { formatHgssRomMessage } from '../ui/romMessageFormatting'

export function requirePokemonMoveName(moveNames: readonly string[], moveId: number): string {
  const name = moveNames[moveId]
  if (!name) throw new Error(`Le nom ROM de la capacité ${moveId} est absent.`)
  return name
}

export function formatBattleMoveLearningResult(
  messages: Record<number, string>,
  pokemonName: string,
  learnedName: string,
  forgottenName?: string,
): string[] {
  if (!forgottenName) return [formatHgssRomMessage(messages[10] ?? '', [pokemonName, learnedName])]
  return [
    formatHgssRomMessage(messages[8] ?? '', [pokemonName, forgottenName]),
    formatHgssRomMessage(messages[4] ?? '', [pokemonName, learnedName]),
  ]
}

export function formatMachineMoveLearningResult(
  messages: Record<number, string>,
  pokemonName: string,
  learnedName: string,
  forgottenName?: string,
): string {
  const learned = formatHgssRomMessage(messages[62] ?? '', [pokemonName, learnedName])
  if (!forgottenName) return learned
  const forgotten = formatHgssRomMessage(messages[61] ?? '', [pokemonName, forgottenName])
  return `${forgotten}\n${learned}`.trim()
}

export function formatMachineMoveLearningDeclined(
  messages: Record<number, string>,
  pokemonName: string,
  learnedName: string,
): string {
  return formatHgssRomMessage(messages[59] ?? '', [pokemonName, learnedName])
}
