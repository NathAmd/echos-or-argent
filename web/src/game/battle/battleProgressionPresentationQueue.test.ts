import { describe, expect, it } from 'vitest'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createBattleProgressionPokemonKey, createBattleProgressionPresentationQueue } from './battleProgressionPresentationQueue'

describe('battleProgressionPresentationQueue', () => {
  it('présente tous les apprentissages avant les évolutions', () => {
    const queue = createBattleProgressionPresentationQueue<string>()
    queue.enqueueEvolution('mime-jr', 'evolution')
    queue.enqueueMoveLearning('mimique')

    expect(queue.drain()).toEqual(['mimique', 'evolution'])
    expect(queue.isEmpty()).toBe(true)
  })

  it('ne conserve qu’une évolution par identité de Pokémon', () => {
    const queue = createBattleProgressionPresentationQueue<string>()
    queue.enqueueEvolution('7:1234', 'première closure')
    queue.enqueueEvolution('7:1234', 'closure obsolète')

    expect(queue.drain()).toEqual(['première closure'])
  })

  it("ne déduplique pas deux instances qui partagent les anciens marqueurs PK4", () => {
    const source = { kind: 'single' }
    const first = { instanceId: 'first' as CanonicalPokemon['instanceId'] }
    const second = { instanceId: 'second' as CanonicalPokemon['instanceId'] }

    expect(createBattleProgressionPokemonKey(first, source)).not.toBe(createBattleProgressionPokemonKey(second, source))
    expect(createBattleProgressionPokemonKey(first, source)).toBe(createBattleProgressionPokemonKey({ ...first }, source))
  })

  it('oublie atomiquement toutes les présentations annulées', () => {
    const queue = createBattleProgressionPresentationQueue<string>()
    queue.enqueueMoveLearning('capacité')
    queue.enqueueEvolution('pokemon', 'évolution')
    queue.clear()

    expect(queue.drain()).toEqual([])
  })
})
