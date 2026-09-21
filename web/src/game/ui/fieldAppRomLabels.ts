import { stripMessageControls } from '../../rom/messages/hgssMessageBank'

export type HgssUiMessageBanks = Readonly<Record<number, Readonly<Record<number, string>>>>

export type FieldAppRomLabels = Readonly<{
  confirm: string
  close: string
  easyChatTitle: string
  easyChatCancel: string
  pokeathlonTitle: string
  pokeathlonClose: string
  frontierTitle: string
  frontierClose: string
  alphQuit: string
}>

function readLabel(banks: HgssUiMessageBanks, bankId: number, messageId: number): string {
  return stripMessageControls(banks[bankId]?.[messageId] ?? '').trim()
}

/**
 * Centralise les libellés de coque des applications terrain. Tous les champs
 * viennent des banques HGSS ; une absence reste vide et n'est jamais traduite
 * ou remplacée par un texte propre au remaster.
 */
export function resolveFieldAppRomLabels(banks: HgssUiMessageBanks): FieldAppRomLabels {
  return {
    confirm: readLabel(banks, 45, 7),
    close: readLabel(banks, 45, 8),
    easyChatTitle: readLabel(banks, 196, 34),
    easyChatCancel: readLabel(banks, 282, 13),
    pokeathlonTitle: readLabel(banks, 191, 272) || readLabel(banks, 24, 54),
    pokeathlonClose: readLabel(banks, 24, 76),
    frontierTitle: readLabel(banks, 19, 43),
    frontierClose: readLabel(banks, 19, 39),
    alphQuit: readLabel(banks, 2, 0),
  }
}

const shellLabelKeys = [
  'confirm',
  'close',
  'easy-chat-title',
  'easy-chat-cancel',
  'pokeathlon-title',
  'pokeathlon-close',
  'frontier-title',
  'frontier-close',
  'alph-quit',
] as const

type ShellLabelKey = typeof shellLabelKeys[number]

function camelCaseLabelKey(key: ShellLabelKey): keyof FieldAppRomLabels {
  return key.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase()) as keyof FieldAppRomLabels
}

export function installFieldAppRomLabels(root: ParentNode, banks: HgssUiMessageBanks): FieldAppRomLabels {
  const labels = resolveFieldAppRomLabels(banks)
  for (const key of shellLabelKeys) {
    const label = labels[camelCaseLabelKey(key)]
    for (const element of root.querySelectorAll<HTMLElement>(`[data-rom-label="${key}"]`)) {
      element.textContent = label
      if (element.tagName === 'BUTTON' && label) element.setAttribute('aria-label', label)
    }
  }
  const easyChat = root.querySelector<HTMLElement>('#field-easy-chat')
  if (labels.easyChatTitle) easyChat?.setAttribute('aria-label', labels.easyChatTitle)
  const categories = root.querySelector<HTMLElement>('#field-easy-chat-categories')
  if (labels.easyChatTitle) categories?.setAttribute('aria-label', labels.easyChatTitle)
  return labels
}
