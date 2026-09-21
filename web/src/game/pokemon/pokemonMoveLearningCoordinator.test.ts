import { describe, expect, it, vi } from 'vitest'
import { createPokemonMoveLearningCoordinator } from './pokemonMoveLearningCoordinator'

function fixture() {
  const confirmations: Array<{ kind: 'learn' | 'cancel', resolve: (confirmed: boolean) => void }> = []
  const showChoices = vi.fn()
  const resumeChoices = vi.fn()
  const commit = vi.fn()
  const coordinator = createPokemonMoveLearningCoordinator<string>({
    requestConfirmation: (kind, _request, resolve) => confirmations.push({ kind, resolve }),
    showChoices,
    resumeChoices,
    commit,
  })
  return { confirmations, showChoices, resumeChoices, commit, coordinator }
}

describe('coordinateur global d’apprentissage de capacité', () => {
  it('refuse le spam et ne montre les capacités qu’après un Oui explicite', () => {
    const { confirmations, showChoices, commit, coordinator } = fixture()
    expect(coordinator.start('party:0', 45)).toBe(true)
    expect(coordinator.start('party:0', 46)).toBe(false)
    confirmations[0]!.resolve(true)
    confirmations[0]!.resolve(true)
    expect(showChoices).toHaveBeenCalledOnce()
    expect(coordinator.choose(2)).toBe(true)
    expect(coordinator.choose(2)).toBe(false)
    expect(commit).toHaveBeenCalledOnce()
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({ target: 'party:0', moveId: 45 }), 2)
  })

  it('conserve les capacités quand le premier prompt reste sur Non', () => {
    const { confirmations, commit, coordinator } = fixture()
    coordinator.start('party:1', 45)
    confirmations[0]!.resolve(false)
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({ target: 'party:1', moveId: 45 }), -1)
  })

  it('demande confirmation avant un abandon et revient au choix sur Non', () => {
    const { confirmations, resumeChoices, commit, coordinator } = fixture()
    coordinator.start('party:2', 45)
    confirmations[0]!.resolve(true)
    expect(coordinator.cancel()).toBe(true)
    expect(confirmations[1]?.kind).toBe('cancel')
    confirmations[1]!.resolve(false)
    expect(resumeChoices).toHaveBeenCalledOnce()
    expect(commit).not.toHaveBeenCalled()
    coordinator.cancel()
    confirmations[2]!.resolve(true)
    expect(commit).toHaveBeenCalledWith(expect.anything(), -1)
  })
})
