import { describe, expect, it } from 'vitest'
import { createFieldScriptState } from '../../scripts/fieldScriptRunner'
import { createNewGamePlusRegistry } from '../newGamePlusRegistry'
import { nuzlockeModule, nuzlockeModuleId } from './nuzlockeModule'

describe('module de profil Nuzlocke', () => {
  it('est désactivé par défaut et expose une configuration vide stricte', () => {
    const registry = createNewGamePlusRegistry([nuzlockeModule])
    expect(registry.listModules()).toEqual([{
      id: nuzlockeModuleId,
      revision: 1,
      title: 'Nuzlocke',
      description: 'Une seule première rencontre capturable par zone.',
      enabledByDefault: false,
      defaultConfig: {},
    }])
  })

  it('valide la sélection sans modifier le gameplay lors de la seule application du profil', () => {
    const registry = createNewGamePlusRegistry([nuzlockeModule])
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
      modules: [{ id: nuzlockeModuleId }],
    })

    expect(profile.modules).toEqual([{ id: nuzlockeModuleId, revision: 1, config: {} }])
    expect(registry.applyProfile(profile, source, destination).money).toBe(321)
  })

  it('refuse toute option inconnue', () => {
    const registry = createNewGamePlusRegistry([nuzlockeModule])
    expect(() => registry.createProfile({
      source: {
        gameCode: 'IPKF',
        slot: 1,
        playerName: 'RED',
        leagueCompletedAt: '2026-08-25T12:00:00.000Z',
      },
      modules: [{ id: nuzlockeModuleId, config: { duplicateClause: true } }],
    })).toThrow(/configuration du module New Game\+ nuzlocke est invalide/)
  })
})
