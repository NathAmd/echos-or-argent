type PcChoiceOption = { label?: string, value: number }
type UnifiedPcEntryPhase = 'open' | 'exit'

function normalizePcChoiceLabel(value: string): string {
  return value.replace(/\{[^}]*\}/g, '').replace(/[\r\n\f]+/g, ' ').replace(/\s+/g, ' ').trim().toLocaleUpperCase('fr-FR')
}

/**
 * Reconnaît le sous-menu natif « déposer / retirer / déplacer / objets » du
 * terminal. La branche Déplacer conserve le cycle ScrCmd_158 de la ROM tout en
 * laissant l'interface unifiée proposer ensuite l'action sur le Pokémon.
 */
export function resolveUnifiedPcEntryChoice(
  options: readonly PcChoiceOption[],
  pcMessages: Record<number, string> | undefined,
  phase: UnifiedPcEntryPhase = 'open',
): number | undefined {
  const actionLabels = [67, 68, 69, 70]
    .map((messageId) => normalizePcChoiceLabel(pcMessages?.[messageId] ?? ''))
    .filter(Boolean)
  const normalized = options.map((option) => ({ ...option, normalizedLabel: normalizePcChoiceLabel(option.label ?? '') }))
  const nativeActionCount = normalized.filter(({ normalizedLabel }) => actionLabels.includes(normalizedLabel)).length
  if (nativeActionCount < 3) return undefined
  if (phase === 'exit') return normalized.filter(({ normalizedLabel }) => !actionLabels.includes(normalizedLabel)).at(-1)?.value
  const moveLabel = normalizePcChoiceLabel(pcMessages?.[69] ?? '')
  return normalized.find(({ normalizedLabel }) => normalizedLabel === moveLabel)?.value
}

function resolvePcTerminalExitChoice(options: readonly PcChoiceOption[]): number | undefined {
  const normalized = options.map((option) => ({ ...option, normalizedLabel: normalizePcChoiceLabel(option.label ?? '') }))
  if (normalized.filter(({ normalizedLabel }) => /(^|\s)PC(\s|$)/.test(normalizedLabel)).length < 2) return undefined
  return normalized.filter(({ normalizedLabel }) => !/(^|\s)PC(\s|$)/.test(normalizedLabel)).at(-1)?.value
}

export function createUnifiedPcEntryCoordinator(): {
  resolveChoice: (options: readonly PcChoiceOption[], pcMessages: Record<number, string> | undefined) => number | undefined
  applicationClosed: () => void
  isUnwinding: () => boolean
  reset: () => void
} {
  let phase: 'idle' | 'service-exit' | 'terminal-exit' = 'idle'
  return {
    resolveChoice(options, pcMessages) {
      if (phase === 'service-exit') {
        const choice = resolveUnifiedPcEntryChoice(options, pcMessages, 'exit')
        if (choice !== undefined) phase = 'terminal-exit'
        return choice
      }
      if (phase === 'terminal-exit') {
        const choice = resolvePcTerminalExitChoice(options)
        if (choice !== undefined) phase = 'idle'
        return choice
      }
      return resolveUnifiedPcEntryChoice(options, pcMessages)
    },
    applicationClosed: () => { phase = 'service-exit' },
    isUnwinding: () => phase !== 'idle',
    reset: () => { phase = 'idle' },
  }
}
