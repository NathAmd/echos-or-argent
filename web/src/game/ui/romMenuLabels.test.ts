import { describe, expect, it } from 'vitest'
import type { MainMenuItem } from '../menu/mainMenuController'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { resolveRomMenuItemState, resolveRomMenuLabel } from './romMenuLabels'

const item = (id: MainMenuItem['id'], label = 'texte ajouté'): MainMenuItem => ({ id, label, kind: id === 'root' ? 'screen' : 'command' })
const pokemon = { speciesName: 'HERICENDRE', nickname: undefined, level: 12, shiny: true } as CanonicalPokemon

describe('libellés de menu issus de la ROM', () => {
  it('résout les écrans et actions depuis leurs banques natives', () => {
    const banks = { 6: { 23: 'N.' }, 24: { 61: 'DEPLACER', 65: 'RESUME' }, 196: { 0: 'POKéDEX', 21: 'RETOUR' } }
    expect(resolveRomMenuLabel(item('pokedex'), banks, [pokemon])).toBe('POKéDEX')
    expect(resolveRomMenuLabel(item('team-summary:0'), banks, [pokemon])).toBe('RESUME')
    expect(resolveRomMenuLabel(item('team-move-up:0'), banks, [pokemon])).toBe('DEPLACER ↑')
  })

  it('n’affiche aucun texte de secours lorsque la banque manque', () => {
    expect(resolveRomMenuLabel(item('options'), {}, [pokemon])).toBe('')
  })

  it('nomme le multijoueur avec le message réseau le plus proche de la ROM', () => {
    expect(resolveRomMenuLabel(item('multiplayer', 'Multijoueur'), { 19: { 45: 'Multi avec un ami' } }, [pokemon])).toBe('Multi avec un ami')
    expect(resolveRomMenuLabel(item('multiplayer', 'Multijoueur'), undefined, [pokemon])).toBe('Multijoueur')
  })

  it('n’ajoute aucun libellé chromatique au nom sauvegardé', () => {
    expect(resolveRomMenuLabel(item('team-member:0'), { 6: { 23: 'N.' } }, [pokemon])).toBe('HERICENDRE · N.12')
  })

  it('nomme la capacité à oublier avec l’action et le nom issus de la ROM', () => {
    const banks = { 302: { 193: '{205}OUBLIER' } }
    expect(resolveRomMenuLabel(item('bag-machine-replace:328:0:0', 'CHARGE'), banks, [pokemon])).toBe('OUBLIER CHARGE')
  })

  it('garde distincts le retour de menu et le retour de secours natif', () => {
    const banks = { 191: { 440: 'REVENIR' }, 196: { 21: 'RETOUR' }, 442: { 1: 'NOUVELLE PARTIE' } }
    expect(resolveRomMenuLabel(item('emergency-unstick'), banks, [pokemon])).toBe('REVENIR')
    expect(resolveRomMenuLabel(item('new-game'), banks, [pokemon])).toBe('NOUVELLE PARTIE')
    expect(resolveRomMenuLabel(item('root'), banks, [pokemon])).toBe('RETOUR')
  })

  it('expose les états Options depuis les valeurs natives sans texte de secours', () => {
    const banks = { 45: { 9: '1', 10: '2', 11: '3', 12: 'OUI', 13: 'NON' } }
    const options = { textSpeed: 'normal' as const, battleAnimations: true, localWeather: false }

    expect(resolveRomMenuItemState('cycle-text-speed', options, false, banks)).toEqual({ value: '2', token: 'normal', position: 2, size: 3 })
    expect(resolveRomMenuItemState('toggle-battle-animations', options, false, banks)).toEqual({ value: 'OUI', token: 'true', pressed: true })
    expect(resolveRomMenuItemState('toggle-local-weather', options, false, banks)).toEqual({ value: 'NON', token: 'false', pressed: false })
    expect(resolveRomMenuItemState('toggle-fullscreen', options, true, banks)).toEqual({ value: 'OUI', token: 'true', pressed: true })
    expect(resolveRomMenuItemState('save', options, false, banks)).toBeUndefined()
    expect(resolveRomMenuItemState('cycle-text-speed', options, false, {})).toMatchObject({ value: '' })
  })
})
