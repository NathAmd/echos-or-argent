import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createBattleMoveLearningMessages, resolveFieldProgressionMessageInput } from './battleProgressionPresentation'

const progressionCss = readFileSync(new URL('../../styles/progression.css', import.meta.url), 'utf8')

describe('resolveFieldProgressionMessageInput', () => {
  it('avance le Super Bonbon, saute une animation verrouillée et consomme les autres touches', () => {
    expect(resolveFieldProgressionMessageInput('confirm', false)).toBe('advance')
    expect(resolveFieldProgressionMessageInput('cancel', false)).toBe('advance')
    expect(resolveFieldProgressionMessageInput('confirm', true)).toBe('skip')
    expect(resolveFieldProgressionMessageInput('up', false)).toBe('ignored')
  })
})

describe('présentation de progression hors combat', () => {
  it('masque la scène de combat sans masquer le message du Super Bonbon', () => {
    expect(progressionCss).toMatch(/\.battle-screen\.is-evolution-only\s*>\s*\.battle-stage\s*\{\s*visibility:\s*hidden;/)
    expect(progressionCss).not.toMatch(/\.battle-screen\.is-evolution-only[^{}]*battle-command-deck[^{}]*\{[^{}]*visibility:\s*hidden;/)
  })
})

describe('createBattleMoveLearningMessages', () => {
  it('ordonne les annonces automatiques avant le choix d’un remplacement', () => {
    const onReplacementRequested = vi.fn()
    const entries = createBattleMoveLearningMessages({
      pokemonName: 'Évoli',
      learnedMoveIds: [33],
      skippedMoveIds: [45],
      moveNames: Object.assign([], { 33: 'Charge', 45: 'Rugissement' }),
      battleMessages: {},
      onReplacementRequested,
    })

    expect(entries).toHaveLength(4)
    expect(entries[0]).toContain('Charge')
    expect(entries[1]).toContain('Rugissement')
    expect(entries[2]).toContain('quatre capacités')
    expect(typeof entries[3]).toBe('object')
    if (typeof entries[3] !== 'string') entries[3].onShow?.()
    expect(onReplacementRequested).toHaveBeenCalledWith(45)
  })
})
