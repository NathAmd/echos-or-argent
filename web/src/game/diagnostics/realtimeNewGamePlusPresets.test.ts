import { describe, expect, it } from 'vitest'
import { createFieldScriptState } from '../scripts/fieldScriptRunner'
import { HGSS_GAME_CLEAR_SYSTEM_FLAG } from '../scripts/hgssFieldSystemFlags'
import { createRealtimeCampaignAudit, realtimeCampaignPresetIds } from './realtimeNewGamePlusPresets'

const expectedModules = {
  'ngp-simple-full-monotype': 'carry-pokedex,carry-money,nuzlocke,hardcore,permanent-death,randomizer,all-pokemon-accessible,visible-wild-pokemon,monotype',
  'ngp-duo-eevee': 'all-battles-in-duo,eevee-team',
  'ngp-duo-solo-monotype': 'all-battles-in-duo,monotype,solo-run',
} as const

describe('presets NG+ des campagnes navigateur', () => {
  it('crée les trois vrais profils avec le registre et garde le mode normal sans profil', () => {
    for (const id of realtimeCampaignPresetIds) {
      const source = createFieldScriptState('male', 'JO')
      const audit = createRealtimeCampaignAudit()
      const prepared = audit.prepare(id, { gameCode: 'IPKF', playerName: '', source })
      expect(prepared.targetSlot).toBe(2)
      if (id === 'normal') {
        expect(prepared.profile).toBeUndefined()
        expect(prepared.source).toBeUndefined()
        continue
      }
      expect(prepared.profile?.format).toBe('pokemaster-hgss-new-game-plus')
      expect(prepared.profile?.source.playerName).toBe('B')
      expect(prepared.profile?.modules.map(({ id: moduleId }) => moduleId).join(',')).toBe(expectedModules[id])
      expect(prepared.source?.flags.has(HGSS_GAME_CLEAR_SYSTEM_FLAG)).toBe(true)
      expect(prepared.source?.money).toBe(424_242)
      expect(prepared.source?.pokedex.caughtSpeciesIds.has(25)).toBe(true)
      expect(source.flags.has(HGSS_GAME_CLEAR_SYSTEM_FLAG)).toBe(false)
      expect(source.money).toBe(3_000)
    }
  })

  it('expose le profil réellement actif et verrouille les preuves matérielles rencontrées', () => {
    const audit = createRealtimeCampaignAudit()
    const prepared = audit.prepare('ngp-duo-eevee', {
      gameCode: 'IPKF', playerName: 'JO', source: createFieldScriptState('male', 'JO'),
    })
    audit.recordInitialParty([133, 133, 133, 133, 133, 133])
    audit.recordSimpleBattle()
    audit.recordDoubleBattle(2)
    audit.recordDoubleBattle(1)

    expect(audit.getSnapshot(prepared.profile)).toEqual({
      campaignPreset: 'ngp-duo-eevee',
      campaignMode: 'new-game-plus',
      campaignModules: 'all-battles-in-duo,eevee-team',
      initialPartySize: 6,
      initialPartySpecies: '133,133,133,133,133,133',
      simpleBattleSeen: true,
      doubleBattleSeen: true,
      minDoublePlayerParticipants: 1,
    })
    expect(audit.getSnapshot(undefined).campaignMode).toBe('normal')
    expect(() => audit.recordDoubleBattle(0)).toThrow('participants')
  })

  it('ignore la chambre vide puis fige la première équipe créée par le vrai choix du starter', () => {
    const audit = createRealtimeCampaignAudit()
    audit.prepare('normal', {
      gameCode: 'IPKF', playerName: 'JO', source: createFieldScriptState('male', 'JO'),
    })

    audit.recordInitialParty([])
    expect(audit.getSnapshot(undefined).initialPartySize).toBe(0)

    audit.recordInitialParty([152])
    audit.recordInitialParty([152, 155])
    expect(audit.getSnapshot(undefined)).toMatchObject({
      initialPartySize: 1,
      initialPartySpecies: '152',
    })
  })
})
