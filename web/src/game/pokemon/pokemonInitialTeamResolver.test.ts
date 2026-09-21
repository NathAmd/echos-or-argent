import { describe, expect, it } from 'vitest'
import {
  basePokemonInitialTeamResolver,
  composePokemonInitialTeamResolvers,
  resolvePokemonInitialTeam,
  type PokemonInitialTeamMemberDefinition,
  type PokemonInitialTeamRequest,
  type PokemonInitialTeamResolver,
} from './pokemonInitialTeamResolver'

const request: PokemonInitialTeamRequest = {
  choice: 1,
  baseDefinition: { speciesId: 155, level: 5, form: 0 },
}

describe('résolution de l’équipe Pokémon initiale', () => {
  it('préserve exactement la définition HGSS de base', () => {
    const resolved = resolvePokemonInitialTeam(request, basePokemonInitialTeamResolver)

    expect(resolved).toEqual([{ speciesId: 155, level: 5, form: 0 }])
    expect(Object.isFrozen(resolved)).toBe(true)
    expect(Object.isFrozen(resolved[0])).toBe(true)
  })

  it('compose les resolvers séquentiellement sur une équipe validée', () => {
    const order: string[] = []
    const append: PokemonInitialTeamResolver = (_request, current) => {
      order.push(`append:${current.length}`)
      return [...current, { speciesId: 152, level: 6, form: 0 }]
    }
    const replaceSecond: PokemonInitialTeamResolver = (_request, current) => {
      order.push(`replace:${current.length}`)
      return current.map((definition, index) => index === 1
        ? { speciesId: 158, level: 7, form: 0 }
        : definition)
    }

    expect(resolvePokemonInitialTeam(request, composePokemonInitialTeamResolvers([
      basePokemonInitialTeamResolver,
      append,
      replaceSecond,
    ]))).toEqual([
      { speciesId: 155, level: 5, form: 0 },
      { speciesId: 158, level: 7, form: 0 },
    ])
    expect(order).toEqual(['append:1', 'replace:2'])
  })

  it('propage les notifications post-commit dans le même ordre', () => {
    const observed: string[] = []
    const first = Object.assign(
      ((_request: PokemonInitialTeamRequest, current: readonly PokemonInitialTeamMemberDefinition[]) => current) satisfies PokemonInitialTeamResolver,
      { onInitialTeamCommitted: () => { observed.push('first') } },
    )
    const second = Object.assign(
      ((_request: PokemonInitialTeamRequest, current: readonly PokemonInitialTeamMemberDefinition[]) => current) satisfies PokemonInitialTeamResolver,
      { onInitialTeamCommitted: () => { observed.push('second') } },
    )
    const composed = composePokemonInitialTeamResolvers([basePokemonInitialTeamResolver, first, second])

    composed.onInitialTeamCommitted?.([{ instanceId: 'hgss-test:1', speciesId: 155, isEgg: false, currentHp: 20 }])
    expect(observed).toEqual(['first', 'second'])
  })

  it.each([
    [[], 'entre 1 et 6'],
    [Array.from({ length: 7 }, () => request.baseDefinition), 'entre 1 et 6'],
    [[{ speciesId: 0, level: 5, form: 0 }], 'espèce HGSS'],
    [[{ speciesId: 494, level: 5, form: 0 }], 'espèce HGSS'],
    [[{ speciesId: 155, level: 0, form: 0 }], 'niveau'],
    [[{ speciesId: 155, level: 101, form: 0 }], 'niveau'],
    [[{ speciesId: 155, level: 5, form: -1 }], 'forme'],
    [[{ speciesId: 155, level: 5, form: 0x100 }], 'forme'],
  ] as const)('rejette strictement une résolution invalide %#', (definitions, message) => {
    const resolver: PokemonInitialTeamResolver = () => definitions as readonly PokemonInitialTeamMemberDefinition[]
    expect(() => resolvePokemonInitialTeam(request, resolver)).toThrow(message)
  })

  it('valide aussi chaque résultat intermédiaire de la composition', () => {
    const invalid: PokemonInitialTeamResolver = () => []
    const unreachable: PokemonInitialTeamResolver = () => {
      throw new Error('ne doit pas être appelé')
    }
    expect(() => resolvePokemonInitialTeam(request, composePokemonInitialTeamResolvers([
      basePokemonInitialTeamResolver,
      invalid,
      unreachable,
    ]))).toThrow('resolver d’équipe initiale 2')
  })
})
