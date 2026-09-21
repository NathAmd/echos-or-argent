import { interpolateHgssRomMessage } from '../ui/romMessageFormatting'
import { hgssBattleAudioSequences } from './hgssBattleAudio'

export type HgssBattleMessagePrinterControl =
  | { kind: 'wait-sound' }
  | { kind: 'wait-fanfare' }
  | { kind: 'play-fanfare', sequenceId: number }
  | { kind: 'play-sound', sequenceId: number }

export type HgssBattleMessagePrinterToken =
  | { kind: 'text', text: string }
  | { kind: 'control', control: HgssBattleMessagePrinterControl }

export type HgssBattleMessagePrinterPage = {
  text: string
  tokens: readonly HgssBattleMessagePrinterToken[]
  waitForInput?: 'clear' | 'scroll'
}

export type HgssBattleMessagePrinterPlayback = {
  isPrinting: () => boolean
  setFastForward: (active: boolean) => void
  close: () => void
}

export const hgssBattleMessagePrinterContinueControl = Object.freeze({
  kind: 'play-sound',
  sequenceId: hgssBattleAudioSequences.printerContinueSound,
} as const satisfies HgssBattleMessagePrinterControl)

function decodeWaitControl(command: string, operands: string | undefined): HgssBattleMessagePrinterControl | undefined {
  if (Number.parseInt(command, 16) !== 0x202) return undefined
  const argument = Number.parseInt(operands?.match(/\d+/)?.[0] ?? '', 10)
  if (argument === 1) return { kind: 'wait-sound' }
  if (argument === 2) return { kind: 'wait-fanfare' }
  if (argument === 3) return { kind: 'play-fanfare', sequenceId: hgssBattleAudioSequences.pokemonCaughtFanfare }
  if (argument === 4) return { kind: 'play-sound', sequenceId: hgssBattleAudioSequences.printerControlSound }
  if (argument === 5) return { kind: 'play-fanfare', sequenceId: hgssBattleAudioSequences.levelUpFanfare }
  throw new Error(`Le contrôle WAIT HGSS ${operands ?? ''} est invalide.`)
}

function normalizePageText(value: string): string {
  return value.replace(/[ \t]+\n/g, '\n').replace(/^[ \t\n]+|[ \t\n]+$/g, '')
}

function normalizePageTokens(tokens: readonly HgssBattleMessagePrinterToken[]): HgssBattleMessagePrinterToken[] {
  const units: Array<string | HgssBattleMessagePrinterControl> = []
  for (const token of tokens) {
    if (token.kind === 'control') units.push(token.control)
    else units.push(...token.text)
  }
  while (typeof units[0] === 'string' && /[ \t\n]/.test(units[0])) units.shift()
  while (typeof units.at(-1) === 'string' && /[ \t\n]/.test(units.at(-1) as string)) units.pop()
  for (let index = units.length - 1; index >= 0; index -= 1) {
    if (units[index] !== '\n') continue
    while (typeof units[index - 1] === 'string' && /[ \t]/.test(units[index - 1] as string)) {
      units.splice(index - 1, 1)
      index -= 1
    }
  }
  const normalized: HgssBattleMessagePrinterToken[] = []
  for (const unit of units) {
    if (typeof unit !== 'string') normalized.push({ kind: 'control', control: unit })
    else if (normalized.at(-1)?.kind === 'text') (normalized.at(-1) as { kind: 'text', text: string }).text += unit
    else normalized.push({ kind: 'text', text: unit })
  }
  return normalized
}

/** Segmente le texte comme `RenderText`: 25BC efface, 25BD fait défiler. */
export function createHgssBattleMessagePrinterPages(
  template: string,
  values: readonly string[],
): HgssBattleMessagePrinterPage[] {
  const message = interpolateHgssRomMessage(template, values)
  const pages: HgssBattleMessagePrinterPage[] = []
  let tokens: HgssBattleMessagePrinterToken[] = []
  const tokenPattern = /\{([0-9a-f]+)(?: ([^}]*))?\}|[\r\f]/gi
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = tokenPattern.exec(message)) !== null) {
    const text = message.slice(cursor, match.index)
    if (text) tokens.push({ kind: 'text', text })
    const token = match[0]
    if (token === '\r' || token === '\f') {
      const normalized = normalizePageTokens(tokens)
      pages.push({ text: normalizePageText(normalized.filter(({ kind }) => kind === 'text').map((entry) => (entry as { text: string }).text).join('')), tokens: normalized, waitForInput: token === '\r' ? 'clear' : 'scroll' })
      tokens = []
    } else {
      const control = decodeWaitControl(match[1]!, match[2])
      if (control) tokens.push({ kind: 'control', control })
    }
    cursor = match.index + token.length
  }
  const trailingText = message.slice(cursor)
  if (trailingText) tokens.push({ kind: 'text', text: trailingText })
  if (tokens.length > 0 || pages.length === 0) {
    const normalized = normalizePageTokens(tokens)
    pages.push({ text: normalizePageText(normalized.filter(({ kind }) => kind === 'text').map((entry) => (entry as { text: string }).text).join('')), tokens: normalized })
  }
  return pages
}

/** Exécute le texte atomiquement et conserve les contrôles ROM dans l’ordre. */
export function playHgssBattleMessagePrinterPage(
  page: HgssBattleMessagePrinterPage,
  options: {
    delayFrames: 1 | 4 | 8
    onText: (revealedText: string) => void
    onControl?: (control: HgssBattleMessagePrinterControl) => void | Promise<void>
    onComplete: () => void
  },
): HgssBattleMessagePrinterPlayback {
  let active = true
  let closed = false
  let tokenIndex = 0
  let revealedText = ''
  let fastForward = false
  let releaseControlWait: (() => void) | undefined

  const complete = (): void => {
    if (!active) return
    active = false
    // Let the caller retain the returned playback before its completion
    // callback clears it. Browser input cannot occur between these microtasks.
    queueMicrotask(() => { if (!closed) options.onComplete() })
  }
  const advance = async (): Promise<void> => {
    while (active) {
      const token = page.tokens[tokenIndex]
      if (!token) { complete(); return }
      tokenIndex += 1
      if (token.kind === 'control') {
        const control = Promise.resolve(options.onControl?.(token.control))
        if (!fastForward) await Promise.race([control, new Promise<void>((resolve) => { releaseControlWait = resolve })])
        releaseControlWait = undefined
        continue
      }
      revealedText += token.text
      options.onText(revealedText)
    }
  }
  options.onText('')
  void advance()
  return {
    isPrinting: () => active,
    setFastForward: (enabled) => { fastForward = enabled; if (enabled) releaseControlWait?.() },
    close: () => { closed = true; active = false; releaseControlWait?.() },
  }
}
