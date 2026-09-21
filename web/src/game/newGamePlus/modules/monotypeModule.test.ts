import { describe, expect, it } from 'vitest'
import { resolvePokemonInitialTeam } from '../../pokemon/pokemonInitialTeamResolver'
import { basePokemonTeamPolicy, resolvePokemonPartyMutationDecision, type PokemonTeamMember } from '../../pokemon/pokemonTeamPolicy'
import { createPokemonTestCatalog } from '../../pokemon/pokemonTestCatalog'
import {
  createMonotypeTeamRuntime,
  decodeMonotypeConfig,
  decodeMonotypeRuntimeState,
  monotypeModule,
} from './monotypeModule'

const member = (instanceId: string, speciesId: number): PokemonTeamMember => ({
  instanceId,
  speciesId,
  isEgg: false,
  currentHp: 10,
})

describe('module NG+ Monotype', () => {
  it('accepte un double type grâce aux données personnelles du catalogue', () => {
    const catalog = createPokemonTestCatalog(200)
    catalog.personalData[152] = { ...catalog.personalData[152]!, types: [12, 2] }
    catalog.personalData[155] = { ...catalog.personalData[155]!, types: [10, 10] }
    const runtime = createMonotypeTeamRuntime(catalog, { typeId: 2 })

    expect(resolvePokemonInitialTeam({
      choice: 0,
      baseDefinition: { speciesId: 152, level: 5, form: 0 },
    }, runtime.initialTeamResolver)).toEqual([{ speciesId: 152, level: 5, form: 0 }])
    expect(runtime.teamPolicy.vetoBattleEligibility({
      format: 'simple', phase: 'initial', partyIndex: 0, pokemon: member('dual', 152),
    })).toBeUndefined()
    expect(runtime.teamPolicy.vetoBattleEligibility({
      format: 'simple', phase: 'initial', partyIndex: 0, pokemon: member('fire', 155),
    })).toMatchObject({ code: 'monotype-species-type' })
  })

  it('laisse acquérir et stocker les espèces hors type, mais leur interdit le combat', () => {
    const catalog = createPokemonTestCatalog(200)
    catalog.personalData[152] = { ...catalog.personalData[152]!, types: [12, 12] }
    catalog.personalData[155] = { ...catalog.personalData[155]!, types: [10, 10] }
    const runtime = createMonotypeTeamRuntime(catalog, { typeId: 12 })

    expect(resolvePokemonInitialTeam({
      choice: 1,
      baseDefinition: { speciesId: 155, level: 5, form: 0 },
    }, runtime.initialTeamResolver)).toEqual([{ speciesId: 152, level: 5, form: 0 }])
    expect(resolvePokemonPartyMutationDecision(
      'gift',
      [member('grass', 152)],
      [member('grass', 152), member('fire', 155)],
      runtime.teamPolicy,
    )).toEqual({ kind: 'allowed' })
  })

  it('refuse seulement une évolution qui ferait perdre le type imposé', () => {
    const catalog = createPokemonTestCatalog(200)
    catalog.personalData[152] = { ...catalog.personalData[152]!, types: [12, 12] }
    catalog.personalData[153] = { ...catalog.personalData[153]!, types: [10, 10] }
    catalog.personalData[154] = { ...catalog.personalData[154]!, types: [12, 2] }
    const runtime = createMonotypeTeamRuntime(catalog, { typeId: 12 })
    const source = member('starter', 152)

    expect(resolvePokemonPartyMutationDecision('evolution', [source], [member('starter', 153)], runtime.teamPolicy))
      .toMatchObject({ kind: 'blocked', code: 'monotype-species-type' })
    expect(resolvePokemonPartyMutationDecision('evolution', [source], [member('starter', 154)], runtime.teamPolicy))
      .toEqual({ kind: 'allowed' })
  })

  it('remplace chaque starter hors type par une espèce complète et déterministe du type choisi', () => {
    const catalog = createPokemonTestCatalog(200)
    catalog.personalData[25] = { ...catalog.personalData[25]!, types: [13, 13] }
    catalog.personalData[81] = { ...catalog.personalData[81]!, types: [13, 8] }
    const runtime = createMonotypeTeamRuntime(catalog, { typeId: 13 })
    const request = { choice: 0, baseDefinition: { speciesId: 152, level: 5, form: 0 } }

    expect(resolvePokemonInitialTeam(request, runtime.initialTeamResolver)).toEqual([
      { speciesId: 25, level: 5, form: 0 },
    ])
    expect(resolvePokemonInitialTeam(
      request,
      (input) => runtime.initialTeamResolver(input, [input.baseDefinition, input.baseDefinition]),
    )).toEqual([
      { speciesId: 25, level: 5, form: 0 },
      { speciesId: 81, level: 5, form: 0 },
    ])
  })

  it('décode strictement sa configuration et son état JSON versionné', () => {
    expect(decodeMonotypeConfig({ typeId: 17 })).toEqual({ typeId: 17 })
    expect(decodeMonotypeRuntimeState({ version: 1, typeId: 17 })).toEqual({ version: 1, typeId: 17 })
    for (const invalid of [null, { typeId: -1 }, { typeId: 18 }, { typeId: 12, extra: true }]) {
      expect(() => decodeMonotypeConfig(invalid)).toThrow()
    }
    for (const invalid of [{ version: 2, typeId: 12 }, { version: 1, typeId: 12, extra: true }]) {
      expect(() => decodeMonotypeRuntimeState(invalid)).toThrow()
    }
  })

  it('produit un snapshot sérialisable cohérent avec la configuration', () => {
    const catalog = createPokemonTestCatalog(158)
    catalog.personalData[152] = { ...catalog.personalData[152]!, types: [12, 12] }
    const runtime = createMonotypeTeamRuntime(catalog, { typeId: 12 })

    expect(JSON.parse(JSON.stringify(runtime.snapshot()))).toEqual({ version: 1, typeId: 12 })
    expect(Object.isFrozen(runtime.snapshot())).toBe(true)
    expect(() => createMonotypeTeamRuntime(catalog, { typeId: 12 }, { version: 1, typeId: 10 })).toThrow('ne correspond pas')
  })

  it('reste opt-in et ne modifie pas les ports de base lorsqu’il n’est pas composé', () => {
    const candidate = member('base', 155)
    expect(monotypeModule.enabledByDefault).toBe(false)
    expect(basePokemonTeamPolicy.vetoBattleEligibility({
      format: 'simple', phase: 'initial', partyIndex: 0, pokemon: candidate,
    })).toBeUndefined()
  })
})
