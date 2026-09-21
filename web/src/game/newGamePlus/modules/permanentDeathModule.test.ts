import { describe, expect, it } from 'vitest'
import { createFieldScriptState } from '../../scripts/fieldScriptRunner'
import { createNewGamePlusRegistry } from '../newGamePlusRegistry'
import {
  permanentDeathModule,
  permanentDeathModuleId,
} from './permanentDeathModule'

describe('module de profil Mort définitive', () => {
  it('est désactivé par défaut et expose une configuration vide stricte', () => {
    const registry = createNewGamePlusRegistry([permanentDeathModule])

    expect(registry.listModules()).toEqual([{
      id: permanentDeathModuleId,
      revision: 1,
      title: 'Mort définitive',
      description: 'Tout Pokémon joueur mis K.O. ne peut plus combattre ni être soigné.',
      enabledByDefault: false,
      defaultConfig: {},
    }])
  })

  it('conserve le gameplay inchangé lors de la seule application du profil', () => {
    const registry = createNewGamePlusRegistry([permanentDeathModule])
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
      modules: [{ id: permanentDeathModuleId }],
    })

    expect(profile.modules).toEqual([{
      id: permanentDeathModuleId,
      revision: 1,
      config: {},
    }])
    expect(registry.applyProfile(profile, source, destination).money).toBe(321)
  })

  it('refuse tout champ de configuration inconnu', () => {
    const registry = createNewGamePlusRegistry([permanentDeathModule])
    expect(() => registry.createProfile({
      source: {
        gameCode: 'IPKF',
        slot: 1,
        playerName: 'RED',
        leagueCompletedAt: '2026-08-25T12:00:00.000Z',
      },
      modules: [{ id: permanentDeathModuleId, config: { revives: false } }],
    })).toThrow(/configuration du module New Game\+ permanent-death est invalide/)
  })
})
