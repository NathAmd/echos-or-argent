import { describe, expect, it } from 'vitest'
import { formatHgssRomMessage, interpolateHgssRomMessage } from './romMessageFormatting'

describe('formatHgssRomMessage', () => {
  it('interpolates native species controls used by egg-hatching messages', () => {
    expect(formatHgssRomMessage(
      '{ff00 1}{100 0,0} vient de sortir de l’Oeuf!{ff00 0}{202 2}',
      ['TOGEPI'],
    )).toBe('TOGEPI vient de sortir de l’Oeuf!')
  })

  it('does not let presentation controls consume message values', () => {
    expect(formatHgssRomMessage(
      '{ff00 1}Félicitations! Votre {101 0,0}\révolue en {101 1,0}!{202 2}',
      ['GERMIGNON', 'MACRONIUM'],
    )).toBe('Félicitations! Votre GERMIGNON\névolue en MACRONIUM!')
  })

  it('interpole les quantités et prix natifs du magasin HGSS', () => {
    expect(formatHgssRomMessage('Pour {133 0,0}, cela fera {137 1,0}.', ['10', '2 000 ₽'])).toBe('Pour 10, cela fera 2 000 ₽.')
  })

  it('interpole les compteurs de page 132 utilisés par les overlays Safari', () => {
    expect(formatHgssRomMessage('{132 0,0}/{132 1,0}', ['2', '4'])).toBe('2/4')
  })

  it('réutilise une variable ROM répétée sans décaler les noms suivants', () => {
    expect(formatHgssRomMessage(
      '{101 0,0} veut apprendre {106 1,0}. Mais {101 0,0} connaît déjà quatre capacités. Remplacer une capacité par {106 1,0}?',
      ['GERMIGNON', 'TRANCH’HERBE'],
    )).toBe('GERMIGNON veut apprendre TRANCH’HERBE. Mais GERMIGNON connaît déjà quatre capacités. Remplacer une capacité par TRANCH’HERBE?')
  })

  it('distingue les emplacements non contigus par leur commande et leur slot ROM', () => {
    expect(formatHgssRomMessage(
      '{101 0,0} oublie {106 2,0}.',
      ['GERMIGNON', 'CHARGE'],
    )).toBe('GERMIGNON oublie CHARGE.')
  })

  it('peut interpoler sans détruire les contrôles de printer', () => {
    expect(interpolateHgssRomMessage('{202 3}{101 0,0}!{202 2}\r', ['TOGEPI']))
      .toBe('{202 3}TOGEPI!{202 2}\r')
  })
})
