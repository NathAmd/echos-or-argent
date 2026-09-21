import { describe, expect, it } from 'vitest'
import { resolvePokemonInitialTeam } from '../../pokemon/pokemonInitialTeamResolver'
import { resolvePokemonPartyMutationDecision, type PokemonTeamMember } from '../../pokemon/pokemonTeamPolicy'
import { createPokemonTestCatalog } from '../../pokemon/pokemonTestCatalog'
import type { PokemonCatalog } from '../../../ndsTypes'
import {
  createEeveeTeamRuntime,
  decodeEeveeTeamConfig,
  decodeEeveeTeamRuntimeState,
  defaultEeveeTeamConfig,
  eeveeSpeciesId,
  eeveeTeamModule,
} from './eeveeTeamModule'

const pokemonId = (value: number): string => `pkm:v1:r:${value.toString(16).padStart(32, '0')}`
const member = (value: number, speciesId = eeveeSpeciesId): PokemonTeamMember => ({
  instanceId: pokemonId(value),
  speciesId,
  isEgg: false,
  currentHp: 10,
})

function createEeveeCatalog(): PokemonCatalog {
  const catalog = createPokemonTestCatalog(493)
  const assignments = [
    [134, 11], [135, 13], [136, 10], [196, 14], [197, 17], [470, 12], [471, 15],
  ] as const
  for (const [speciesId, typeId] of assignments) {
    catalog.personalData[speciesId] = { ...catalog.personalData[speciesId]!, types: [typeId, typeId] }
  }
  return catalog
}

describe('module NG+ Équipe Évoli', () => {
  it('crée six définitions d’Évoli distinctement matérialisables', () => {
    const runtime = createEeveeTeamRuntime(createEeveeCatalog())
    const definitions = resolvePokemonInitialTeam({
      choice: 2,
      baseDefinition: { speciesId: 158, level: 5, form: 0 },
    }, runtime.initialTeamResolver)

    expect(definitions).toHaveLength(6)
    expect(definitions).toEqual(Array.from({ length: 6 }, () => ({ speciesId: 133, level: 5, form: 0 })))
    expect(eeveeTeamModule.enabledByDefault).toBe(false)
  })

  it('lie six instanceId à six affectations d’évolution et de type', () => {
    const runtime = createEeveeTeamRuntime(createEeveeCatalog())
    const party = Array.from({ length: 6 }, (_, index) => member(index + 1))

    expect(resolvePokemonPartyMutationDecision('starter', [], party, runtime.teamPolicy)).toEqual({ kind: 'allowed' })
    expect(runtime.initialTeamResolver.onInitialTeamCommitted).toBeTypeOf('function')
    runtime.initialTeamResolver.onInitialTeamCommitted?.(party)

    const snapshot = runtime.snapshot()
    expect(snapshot.members).toHaveLength(6)
    expect(snapshot.members?.map(({ instanceId }) => instanceId)).toEqual(party.map(({ instanceId }) => instanceId))
    expect(snapshot.members?.map(({ targetSpeciesId, typeId }) => ({ targetSpeciesId, typeId }))).toEqual(defaultEeveeTeamConfig.assignments)
    expect(new Set(snapshot.members?.map(({ instanceId }) => instanceId)).size).toBe(6)
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot)
    expect(Object.isFrozen(snapshot.members)).toBe(true)
  })

  it('autorise uniquement l’évolution affectée à chaque instance', () => {
    const runtime = createEeveeTeamRuntime(createEeveeCatalog())
    const party = Array.from({ length: 6 }, (_, index) => member(index + 1))
    runtime.bindInitialTeam(party)

    const assignedEvolution = member(1, 134)
    const wrongEvolution = member(1, 135)
    expect(resolvePokemonPartyMutationDecision(
      'evolution', party, [assignedEvolution, ...party.slice(1)], runtime.teamPolicy,
    )).toEqual({ kind: 'allowed' })
    expect(resolvePokemonPartyMutationDecision(
      'evolution', party, [wrongEvolution, ...party.slice(1)], runtime.teamPolicy,
    )).toMatchObject({ kind: 'blocked', code: 'eevee-team-evolution-locked' })
    expect(runtime.teamPolicy.vetoBattleEligibility({
      format: 'simple', phase: 'initial', partyIndex: 0, pokemon: assignedEvolution,
    })).toBeUndefined()
    expect(runtime.teamPolicy.vetoBattleEligibility({
      format: 'simple', phase: 'initial', partyIndex: 0, pokemon: wrongEvolution,
    })).toMatchObject({ code: 'eevee-team-evolution-locked' })
  })

  it('verrouille ajout, remplacement et retrait vivant, mais permet le retrait déclaré mort', () => {
    const deadIds = new Set<string>()
    const runtime = createEeveeTeamRuntime(createEeveeCatalog(), defaultEeveeTeamConfig, undefined, (id) => deadIds.has(id))
    const party = Array.from({ length: 6 }, (_, index) => member(index + 1))
    runtime.bindInitialTeam(party)

    expect(resolvePokemonPartyMutationDecision('reorder', party, [...party].reverse(), runtime.teamPolicy)).toEqual({ kind: 'allowed' })
    expect(resolvePokemonPartyMutationDecision('capture', party, [...party, member(7)], runtime.teamPolicy).kind).toBe('blocked')
    expect(resolvePokemonPartyMutationDecision('npc-trade', party, [member(7), ...party.slice(1)], runtime.teamPolicy).kind).toBe('blocked')
    expect(resolvePokemonPartyMutationDecision('pc', party, party.slice(1), runtime.teamPolicy).kind).toBe('blocked')

    deadIds.add(party[0]!.instanceId)
    expect(resolvePokemonPartyMutationDecision('pc', party, party.slice(1), runtime.teamPolicy)).toEqual({ kind: 'allowed' })
    expect(resolvePokemonPartyMutationDecision('gift', party.slice(1), party, runtime.teamPolicy).kind).toBe('blocked')
  })

  it('restaure les affectations strictes et refuse tout état incohérent avec la configuration', () => {
    const initial = createEeveeTeamRuntime(createEeveeCatalog())
    const party = Array.from({ length: 6 }, (_, index) => member(index + 1))
    initial.bindInitialTeam(party)
    const saved = JSON.parse(JSON.stringify(initial.snapshot()))

    const restored = createEeveeTeamRuntime(createEeveeCatalog(), defaultEeveeTeamConfig, saved)
    expect(restored.snapshot()).toEqual(initial.snapshot())
    restored.bindInitialTeam(party)
    expect(() => restored.bindInitialTeam([...party.slice(0, 5), member(9)])).toThrow('déjà liées')

    const reversedConfig = { assignments: [...defaultEeveeTeamConfig.assignments].reverse() }
    expect(() => createEeveeTeamRuntime(createEeveeCatalog(), reversedConfig, saved)).toThrow('ne correspondent pas')
  })

  it('rejette les affectations, catalogues et snapshots corrompus', () => {
    const five = defaultEeveeTeamConfig.assignments.slice(0, 5)
    const duplicate = Array.from({ length: 6 }, () => defaultEeveeTeamConfig.assignments[0])
    for (const invalid of [
      null,
      { assignments: five },
      { assignments: duplicate },
      { assignments: defaultEeveeTeamConfig.assignments, extra: true },
      { assignments: [{ targetSpeciesId: 134, typeId: 10 }, ...defaultEeveeTeamConfig.assignments.slice(1)] },
    ]) expect(() => decodeEeveeTeamConfig(invalid)).toThrow()

    const runtime = createEeveeTeamRuntime(createEeveeCatalog())
    expect(() => runtime.bindInitialTeam(Array.from({ length: 6 }, () => member(1)))).toThrow('distinctes')
    expect(() => decodeEeveeTeamRuntimeState({ version: 2, members: null })).toThrow()
    expect(() => decodeEeveeTeamRuntimeState({ version: 1, members: [] })).toThrow()

    const wrongCatalog = createEeveeCatalog()
    wrongCatalog.personalData[134] = { ...wrongCatalog.personalData[134]!, types: [10, 10] }
    expect(() => createEeveeTeamRuntime(wrongCatalog)).toThrow('ne possède pas le type')
  })
})
