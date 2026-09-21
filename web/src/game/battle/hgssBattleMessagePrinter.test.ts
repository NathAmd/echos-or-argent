import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHgssBattleMessagePrinterPages, playHgssBattleMessagePrinterPage } from './hgssBattleMessagePrinter'

afterEach(() => vi.useRealTimers())

describe('printer des messages de combat HGSS', () => {
  it('conserve la fanfare, son attente et le 25BC terminal de la capture', () => {
    expect(createHgssBattleMessagePrinterPages('{202 3}Et hop!\n{101 0,0} est attrapé!{202 2}\r', ['RACAILLOU'])).toEqual([{
      text: 'Et hop!\nRACAILLOU est attrapé!',
      tokens: [
        { kind: 'control', control: { kind: 'play-fanfare', sequenceId: 1187 } },
        { kind: 'text', text: 'Et hop!\nRACAILLOU est attrapé!' },
        { kind: 'control', control: { kind: 'wait-fanfare' } },
      ],
      waitForInput: 'clear',
    }])
  })

  it('sépare les deux écrans du transfert vers une autre Boîte', () => {
    expect(createHgssBattleMessagePrinterPages('La {10b 1,0} est pleine.\r{101 0,0} va dans la {10b 2,0}.', ['BOÎTE 1', 'RACAILLOU', 'BOÎTE 2'])).toEqual([
      { text: 'La BOÎTE 1 est pleine.', tokens: [{ kind: 'text', text: 'La BOÎTE 1 est pleine.' }], waitForInput: 'clear' },
      { text: 'RACAILLOU va dans la BOÎTE 2.', tokens: [{ kind: 'text', text: 'RACAILLOU va dans la BOÎTE 2.' }] },
    ])
  })

  it('distingue le défilement 25BD et tous les callbacks WAIT natifs', () => {
    expect(createHgssBattleMessagePrinterPages('{202 1}{202 4}A\f{202 5}B', [])).toEqual([
      { text: 'A', tokens: [{ kind: 'control', control: { kind: 'wait-sound' } }, { kind: 'control', control: { kind: 'play-sound', sequenceId: 1510 } }, { kind: 'text', text: 'A' }], waitForInput: 'scroll' },
      { text: 'B', tokens: [{ kind: 'control', control: { kind: 'play-fanfare', sequenceId: 1184 } }, { kind: 'text', text: 'B' }] },
    ])
  })

  it('affiche le texte atomiquement tout en jouant les contrôles au curseur exact', async () => {
    const page = createHgssBattleMessagePrinterPages('{202 3}AB{202 2}', [])[0]!
    const order: string[] = []
    const playback = playHgssBattleMessagePrinterPage(page, {
      delayFrames: 4,
      onText: (text) => order.push(`text:${text}`),
      onControl: (control) => { order.push(control.kind) },
      onComplete: () => order.push('complete'),
    })
    expect(order).toEqual(['text:', 'play-fanfare'])
    await vi.waitFor(() => expect(order).toEqual(['text:', 'play-fanfare', 'text:AB', 'wait-fanfare', 'complete']))
    expect(playback.isPrinting()).toBe(false)
  })

  it('ne transforme plus le premier appui en accélération de glyphes', async () => {
    const text: string[] = []
    const complete = vi.fn()
    const playback = playHgssBattleMessagePrinterPage(createHgssBattleMessagePrinterPages('ABC', [])[0]!, {
      delayFrames: 8, onText: (value) => text.push(value), onComplete: complete,
    })
    expect(text).toEqual(['', 'ABC'])
    expect(playback.isPrinting()).toBe(false)
    playback.setFastForward(true)
    playback.setFastForward(false)
    expect(text).toEqual(['', 'ABC'])
    await vi.waitFor(() => expect(complete).toHaveBeenCalledOnce())
  })

  it('un appui libère immédiatement un contrôle audio encore en attente', async () => {
    let releaseAudio: (() => void) | undefined
    const complete = vi.fn()
    const playback = playHgssBattleMessagePrinterPage(createHgssBattleMessagePrinterPages('{202 1}ABC', [])[0]!, {
      delayFrames: 4,
      onText: () => undefined,
      onControl: () => new Promise<void>((resolve) => { releaseAudio = resolve }),
      onComplete: complete,
    })
    expect(playback.isPrinting()).toBe(true)
    playback.setFastForward(true)
    await vi.waitFor(() => expect(complete).toHaveBeenCalledOnce())
    releaseAudio?.()
  })
})
