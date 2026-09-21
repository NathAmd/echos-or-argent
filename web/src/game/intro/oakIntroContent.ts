import { splitHgssDialogPages } from '../ui/hgssDialogPages'

// Order used by OakSpeech_DoMainTask. 23 introduces the button diagram, while
// 25 and 26 are regular dialog windows around the second half of the lesson.
export const tutorialControlsMessages = [9, 10, 11, 12, 23, 25, 13, 14, 15, 16, 17, 26]
export const tutorialAdventureMessages = [28, 29, 30, 31, 32, 33]
export const tutorialDialogMessages = [25, 26]
export const profileIntroMessages = [34, 35, 36]
export const playerNameMaxLength = 7

export function getTimeOfDayIntroMessageId(date = new Date()): number {
  const hhmm = date.getHours() * 100 + date.getMinutes()
  if (hhmm >= 400 && hhmm <= 1059) return 1
  if (hhmm >= 1100 && hhmm <= 1559) return 2
  if (hhmm >= 1600 && hhmm <= 1859) return 3
  if (hhmm >= 1900 && hhmm <= 2359) return 4
  return 5
}

function normalizeMessage(message: string, playerName: string): string {
  return message
    .replace(/\{103[^}]*\}/g, playerName)
    .replace(/\{200[^}]*\}/g, '')
    .replace(/\{205\}/g, '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/\r/g, '\f')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]+\f/g, '\f')
    .trim()
}

export function splitDialogPages(message: string, playerName: string): string[] {
  return splitHgssDialogPages(normalizeMessage(message, playerName))
}

export function getMessage(messages: Record<number, string> | undefined, id: number): string {
  const message = messages?.[id]
  if (message === undefined) throw new Error(`Le message d’introduction ROM ${id} est absent.`)
  return message
}

export function getChoiceLabel(messages: Record<number, string> | undefined, id: number): string {
  const label = normalizeMessage(getMessage(messages, id), '').replace(/\s+/g, ' ').trim()
  if (!label) throw new Error(`Le libelle ROM du choix ${id} est vide.`)
  return label
}

export function getGenderPrompt(messages: Record<number, string> | undefined, playerName: string): string {
  const prompt = getMessage(messages, 37)
  const parts = normalizeMessage(prompt, playerName).split('\f')
  const firstPageLines = (parts[0] ?? '').split('\n').map((line) => line.trim()).filter(Boolean)
  const nextPageLines = parts.slice(1).join('\n').split('\n').map((line) => line.trim()).filter(Boolean)
  return [...firstPageLines.slice(-1), ...nextPageLines].join('\n') || prompt.replace(/\f/g, '\n')
}

export function clampChoice(index: number, choiceCount: number): number {
  return Math.max(0, Math.min(choiceCount - 1, index))
}

export function sanitizeNameCharacter(character: string): string | undefined {
  const normalized = character.toLocaleUpperCase('fr-FR')
  return /^[A-Z0-9 -]$/.test(normalized) ? normalized : undefined
}
