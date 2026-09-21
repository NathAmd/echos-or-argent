import { describe, expect, it, vi } from 'vitest'
import { installFieldAppRomLabels, resolveFieldAppRomLabels } from './fieldAppRomLabels'

describe('libellés ROM des applications terrain', () => {
  it('résout uniquement les identifiants issus des banques HGSS', () => {
    const labels = resolveFieldAppRomLabels({
      2: { 0: 'QUIT.' },
      19: { 39: 'Retour', 43: 'RECORD' },
      24: { 54: 'POKéATHLON', 76: 'FERMER' },
      45: { 7: 'CONFIRMER', 8: 'FERMER' },
      191: { 272: 'POKéATHLON' },
      196: { 34: 'TCHAT.' },
      282: { 13: 'QUIT.' },
    })
    expect(labels).toEqual({
      confirm: 'CONFIRMER', close: 'FERMER', easyChatTitle: 'TCHAT.', easyChatCancel: 'QUIT.',
      pokeathlonTitle: 'POKéATHLON', pokeathlonClose: 'FERMER', frontierTitle: 'RECORD',
      frontierClose: 'Retour', alphQuit: 'QUIT.',
    })
  })

  it('installe le texte et les noms accessibles sans fabriquer de fallback', () => {
    const elements = new Map<string, { tagName: string, textContent: string, setAttribute: ReturnType<typeof vi.fn> }>([
      ['confirm', { tagName: 'BUTTON', textContent: '', setAttribute: vi.fn() }],
      ['easy-chat-title', { tagName: 'SPAN', textContent: '', setAttribute: vi.fn() }],
      ['alph-quit', { tagName: 'BUTTON', textContent: '', setAttribute: vi.fn() }],
    ])
    const easyChat = { setAttribute: vi.fn() }
    const categories = { setAttribute: vi.fn() }
    const root = {
      querySelectorAll: (selector: string) => {
        const key = selector.match(/data-rom-label="([^"]+)"/)?.[1]
        return key && elements.has(key) ? [elements.get(key)!] : []
      },
      querySelector: (selector: string) => selector === '#field-easy-chat' ? easyChat : selector === '#field-easy-chat-categories' ? categories : null,
    } as unknown as ParentNode
    const labels = installFieldAppRomLabels(root, {
      2: { 0: 'QUIT.' }, 45: { 7: 'CONFIRMER' }, 196: { 34: 'TCHAT.' },
    })
    expect(elements.get('confirm')?.textContent).toBe('CONFIRMER')
    expect(elements.get('confirm')?.setAttribute).toHaveBeenCalledWith('aria-label', 'CONFIRMER')
    expect(easyChat.setAttribute).toHaveBeenCalledWith('aria-label', 'TCHAT.')
    expect(elements.get('alph-quit')?.textContent).toBe('QUIT.')
    expect(labels.frontierTitle).toBe('')
  })
})
