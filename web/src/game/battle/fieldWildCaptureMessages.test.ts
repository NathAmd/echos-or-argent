import { describe, expect, it, vi } from 'vitest'
import { formatFieldWildCaptureStorageMessage } from './fieldWildCaptureMessages'

describe('formatFieldWildCaptureStorageMessage', () => {
  it('utilise le message HGSS de la Boîte courante', () => {
    const format = vi.fn((template: string, values: readonly string[]) => `${template}|${values.join('|')}`)
    expect(formatFieldWildCaptureStorageMessage({ 1174: 'même boîte' }, 'Héricendre', {
      previousBox: 2,
      box: 2,
      slot: 0,
    }, format)).toBe('même boîte|Héricendre|BOÎTE 3')
  })

  it('utilise le message HGSS de redirection vers la Boîte suivante', () => {
    const format = vi.fn((template: string, values: readonly string[]) => `${template}|${values.join('|')}`)
    expect(formatFieldWildCaptureStorageMessage({ 1176: 'boîte suivante' }, 'Lugia', {
      previousBox: 0,
      box: 1,
      slot: 0,
    }, format)).toBe('boîte suivante|BOÎTE 1|Lugia|BOÎTE 2')
  })
})
