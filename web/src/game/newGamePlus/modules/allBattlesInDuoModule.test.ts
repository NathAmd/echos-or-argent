import { describe, expect, it } from 'vitest'
import { createFieldScriptState } from '../../scripts/fieldScriptRunner'
import { createNewGamePlusRegistry } from '../newGamePlusRegistry'
import {
  allBattlesInDuoModule,
  allBattlesInDuoModuleId,
  decodeAllBattlesInDuoConfig,
} from './allBattlesInDuoModule'

describe('module de profil Tous les combats en duo', () => {
  it('est optionnel et possède une configuration vide stricte', () => {
    const registry = createNewGamePlusRegistry([allBattlesInDuoModule])

    expect(registry.listModules()).toEqual([{
      id: allBattlesInDuoModuleId,
      revision: 1,
      title: 'Tous les combats en duo',
      description: 'Deux Pokémon joueur combattent s’ils sont aptes ; sinon le seul disponible joue sans clone. Un légendaire adverse n’est jamais dupliqué.',
      enabledByDefault: false,
      defaultConfig: {},
    }])
    expect(Object.isFrozen(decodeAllBattlesInDuoConfig({}))).toBe(true)
  })

  it('enregistre la sélection sans modifier la transaction initiale', () => {
    const registry = createNewGamePlusRegistry([allBattlesInDuoModule])
    const source = createFieldScriptState('male', 'RED')
    const destination = createFieldScriptState('female', 'LEAF')
    destination.money = 321
    const profile = registry.createProfile({
      source: {
        gameCode: 'IPKF',
        slot: 1,
        playerName: 'RED',
        leagueCompletedAt: '2026-08-25T12:00:00.000Z',
      },
      modules: [{ id: allBattlesInDuoModuleId }],
    })

    expect(profile.modules).toEqual([{
      id: allBattlesInDuoModuleId,
      revision: 1,
      config: {},
    }])
    expect(registry.applyProfile(profile, source, destination).money).toBe(321)
  })

  it.each([
    null,
    [],
    { wildLegendaryClone: true },
    Object.assign(Object.create({ inherited: true }) as object, {}),
  ])('refuse une configuration non vide ou non JSON stricte : %#', (config) => {
    expect(() => decodeAllBattlesInDuoConfig(config)).toThrow(/configuration Tous les combats en duo/)
  })
})
