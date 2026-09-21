import { describe, expect, it } from 'vitest'
import { resolvePokemonInitialTeam } from '../../pokemon/pokemonInitialTeamResolver'
import { getPokemonBattleEligiblePartySlots, resolvePokemonPartyMutationDecision, type PokemonTeamMember } from '../../pokemon/pokemonTeamPolicy'
import { createPokemonTestCatalog } from '../../pokemon/pokemonTestCatalog'
import {
  createSoloRunTeamRuntime,
  decodeSoloRunConfig,
  decodeSoloRunRuntimeState,
  soloRunModule,
} from './soloRunModule'

const pokemonId = (value: number): string => `pkm:v1:r:${value.toString(16).padStart(32, '0')}`
const member = (instanceId: string, speciesId = 155): PokemonTeamMember => ({
  instanceId,
  speciesId,
  isEgg: false,
  currentHp: 10,
})

describe('module NG+ Solo Run', () => {
  it('remplace le starter par l’espèce choisie tout en conservant le niveau natif', () => {
    const runtime = createSoloRunTeamRuntime(createPokemonTestCatalog(200), { speciesId: 155, form: 2 })

    expect(resolvePokemonInitialTeam({
      choice: 0,
      baseDefinition: { speciesId: 152, level: 5, form: 0 },
    }, runtime.initialTeamResolver)).toEqual([{ speciesId: 155, level: 5, form: 2 }])
    expect(soloRunModule.enabledByDefault).toBe(false)
  })

  it('valide le préflight du starter puis verrouille son instance après liaison', () => {
    const runtime = createSoloRunTeamRuntime(createPokemonTestCatalog(200), { speciesId: 155, form: 0 })
    const selected = member(pokemonId(1))
    const stranger = member(pokemonId(2))

    expect(resolvePokemonPartyMutationDecision('starter', [], [selected], runtime.teamPolicy)).toEqual({ kind: 'allowed' })
    expect(getPokemonBattleEligiblePartySlots([selected], {
      format: 'simple', phase: 'initial',
    }, runtime.teamPolicy)).toEqual([])

    expect(runtime.initialTeamResolver.onInitialTeamCommitted).toBeTypeOf('function')
    runtime.initialTeamResolver.onInitialTeamCommitted?.([selected])
    expect(runtime.isBound()).toBe(true)
    expect(getPokemonBattleEligiblePartySlots([selected, stranger], {
      format: 'simple', phase: 'initial',
    }, runtime.teamPolicy)).toEqual([0])
    expect(JSON.parse(JSON.stringify(runtime.snapshot()))).toEqual({ version: 1, instanceId: pokemonId(1) })
  })

  it('autorise compagnons et réorganisation, mais protège l’identité combattante', () => {
    const runtime = createSoloRunTeamRuntime(createPokemonTestCatalog(200), { speciesId: 155, form: 0 })
    const selected = member(pokemonId(1))
    const companion = member(pokemonId(2), 152)
    runtime.bindInitialTeam([selected])

    expect(resolvePokemonPartyMutationDecision('capture', [selected], [selected, companion], runtime.teamPolicy)).toEqual({ kind: 'allowed' })
    expect(resolvePokemonPartyMutationDecision('reorder', [selected, companion], [companion, selected], runtime.teamPolicy)).toEqual({ kind: 'allowed' })
    expect(resolvePokemonPartyMutationDecision('pc', [selected, companion], [selected], runtime.teamPolicy)).toEqual({ kind: 'allowed' })
    expect(resolvePokemonPartyMutationDecision('pc', [selected], [], runtime.teamPolicy).kind).toBe('blocked')
    expect(resolvePokemonPartyMutationDecision('npc-trade', [selected], [member(pokemonId(2))], runtime.teamPolicy).kind).toBe('blocked')
    expect(resolvePokemonPartyMutationDecision('evolution', [selected], [member(pokemonId(1), 156)], runtime.teamPolicy)).toEqual({ kind: 'allowed' })
    expect(resolvePokemonPartyMutationDecision('gift', [selected], [member(pokemonId(1), 156)], runtime.teamPolicy).kind).toBe('blocked')
    expect(getPokemonBattleEligiblePartySlots([companion, selected], {
      format: 'double', phase: 'initial',
    }, runtime.teamPolicy)).toEqual([1])
  })

  it('restaure un verrou JSON strict et rend la liaison idempotente', () => {
    const state = { version: 1, instanceId: pokemonId(7) }
    const runtime = createSoloRunTeamRuntime(createPokemonTestCatalog(200), { speciesId: 155, form: 0 }, state)
    const selected = member(pokemonId(7))

    runtime.bindInitialTeam([selected])
    expect(runtime.snapshot()).toEqual(state)
    expect(() => runtime.bindInitialTeam([member(pokemonId(8))])).toThrow('déjà liée')
    expect(Object.isFrozen(runtime.snapshot())).toBe(true)
  })

  it('rejette strictement les configurations, états et liaisons corrompus', () => {
    for (const invalid of [
      null,
      { speciesId: 0, form: 0 },
      { speciesId: 155, form: -1 },
      { speciesId: 155, form: 0, extra: true },
    ]) expect(() => decodeSoloRunConfig(invalid)).toThrow()
    for (const invalid of [
      { version: 2, instanceId: null },
      { version: 1, instanceId: 'pokemon-1' },
      { version: 1, instanceId: null, extra: true },
    ]) expect(() => decodeSoloRunRuntimeState(invalid)).toThrow()

    const runtime = createSoloRunTeamRuntime(createPokemonTestCatalog(200), { speciesId: 155, form: 0 })
    expect(() => runtime.bindInitialTeam([])).toThrow('exactement')
    expect(() => runtime.bindInitialTeam([member('invalide')])).toThrow('exactement')
    expect(() => runtime.bindInitialTeam([member(pokemonId(1), 152)])).toThrow('exactement')
  })
})
