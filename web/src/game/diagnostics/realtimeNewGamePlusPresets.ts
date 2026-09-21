import type { FieldScriptState } from '../scripts/fieldScriptRunner'
import { cloneFieldScriptState } from '../scripts/fieldScriptRunner'
import { HGSS_GAME_CLEAR_SYSTEM_FLAG } from '../scripts/hgssFieldSystemFlags'
import {
  allBattlesInDuoModuleId,
  allPokemonAccessibleModuleId,
  carryMoneyModuleId,
  carryPokedexModuleId,
  createBuiltInNewGamePlusRegistry,
  eeveeTeamModuleId,
  hardcoreModuleId,
  monotypeModuleId,
  nuzlockeModuleId,
  permanentDeathModuleId,
  randomizerModuleId,
  soloRunModuleId,
  visibleWildPokemonModuleId,
} from '../newGamePlus/modules'
import type { NewGamePlusProfileDraft, NewGamePlusProfileV1 } from '../newGamePlus/newGamePlusTypes'

export const realtimeCampaignPresetIds = Object.freeze([
  'normal',
  'ngp-simple-full-monotype',
  'ngp-duo-eevee',
  'ngp-duo-solo-monotype',
] as const)

export type RealtimeCampaignPresetId = typeof realtimeCampaignPresetIds[number]

type ModuleDraft = NewGamePlusProfileDraft['modules'][number]

const fullSimpleMonotypeModules: readonly ModuleDraft[] = Object.freeze([
  { id: carryPokedexModuleId },
  { id: carryMoneyModuleId },
  { id: nuzlockeModuleId },
  { id: hardcoreModuleId },
  { id: permanentDeathModuleId },
  { id: randomizerModuleId },
  { id: allPokemonAccessibleModuleId },
  { id: visibleWildPokemonModuleId },
  { id: monotypeModuleId, config: { typeId: 12 } },
])

const presetModules: Readonly<Record<RealtimeCampaignPresetId, readonly ModuleDraft[]>> = Object.freeze({
  normal: Object.freeze([]),
  'ngp-simple-full-monotype': fullSimpleMonotypeModules,
  'ngp-duo-eevee': Object.freeze([
    { id: allBattlesInDuoModuleId },
    { id: eeveeTeamModuleId },
  ]),
  'ngp-duo-solo-monotype': Object.freeze([
    { id: allBattlesInDuoModuleId },
    { id: monotypeModuleId, config: { typeId: 12 } },
    { id: soloRunModuleId, config: { speciesId: 152, form: 0 } },
  ]),
})

export function isRealtimeCampaignPresetId(value: string): value is RealtimeCampaignPresetId {
  return (realtimeCampaignPresetIds as readonly string[]).includes(value)
}

export type RealtimePreparedCampaign = Readonly<{
  id: RealtimeCampaignPresetId
  profile?: NewGamePlusProfileV1
  source?: FieldScriptState
  targetSlot: 2
}>

export type RealtimeCampaignEvidenceSnapshot = Readonly<{
  campaignPreset: RealtimeCampaignPresetId
  campaignMode: 'normal' | 'new-game-plus'
  campaignModules: string
  initialPartySize: number
  initialPartySpecies: string
  simpleBattleSeen: boolean
  doubleBattleSeen: boolean
  minDoublePlayerParticipants: number
}>

/**
 * Prépare uniquement des profils de test jetables. Le registre intégré reste
 * l'unique frontière de décodage et le coordinateur titre applique ensuite le
 * profil avec sa transaction normale.
 */
export function createRealtimeCampaignAudit(): Readonly<{
  prepare: (id: RealtimeCampaignPresetId, options: Readonly<{
    gameCode: string
    playerName: string
    source: FieldScriptState
  }>) => RealtimePreparedCampaign
  recordInitialParty: (speciesIds: readonly number[]) => void
  recordSimpleBattle: () => void
  recordDoubleBattle: (playerParticipants: number) => void
  getSnapshot: (activeProfile: NewGamePlusProfileV1 | undefined) => RealtimeCampaignEvidenceSnapshot
}> {
  const registry = createBuiltInNewGamePlusRegistry()
  let campaignPreset: RealtimeCampaignPresetId = 'normal'
  let initialPartySpecies: readonly number[] = Object.freeze([])
  let simpleBattleSeen = false
  let doubleBattleSeen = false
  let minDoublePlayerParticipants: number | undefined

  const resetEvidence = (id: RealtimeCampaignPresetId): void => {
    campaignPreset = id
    initialPartySpecies = Object.freeze([])
    simpleBattleSeen = false
    doubleBattleSeen = false
    minDoublePlayerParticipants = undefined
  }

  return Object.freeze({
    prepare(id, options) {
      resetEvidence(id)
      if (id === 'normal') return Object.freeze({ id, targetSlot: 2 as const })
      const source = cloneFieldScriptState(options.source)
      source.flags.add(HGSS_GAME_CLEAR_SYSTEM_FLAG)
      // Valeurs reconnaissables : les modules de transfert passent par leur
      // vraie application sans dépendre d'une sauvegarde personnelle.
      source.money = 424_242
      source.pokedex.enabled = true
      source.pokedex.nationalDexEnabled = true
      source.pokedex.seenSpeciesIds.add(25)
      source.pokedex.caughtSpeciesIds.add(25)
      const profile = registry.createProfile({
        source: {
          gameCode: options.gameCode,
          slot: 1,
          playerName: options.playerName.trim() || 'B',
          leagueCompletedAt: '2000-01-01T00:00:00.000Z',
        },
        modules: presetModules[id],
      })
      return Object.freeze({ id, profile, source, targetSlot: 2 as const })
    },
    recordInitialParty(speciesIds) {
      if (initialPartySpecies.length > 0 || speciesIds.length === 0) return
      initialPartySpecies = Object.freeze([...speciesIds])
    },
    recordSimpleBattle() { simpleBattleSeen = true },
    recordDoubleBattle(playerParticipants) {
      if (!Number.isSafeInteger(playerParticipants) || playerParticipants < 1) {
        throw new RangeError('Le nombre de participants joueur du combat double est invalide.')
      }
      doubleBattleSeen = true
      minDoublePlayerParticipants = Math.min(minDoublePlayerParticipants ?? playerParticipants, playerParticipants)
    },
    getSnapshot(activeProfile) {
      return Object.freeze({
        campaignPreset,
        campaignMode: activeProfile ? 'new-game-plus' : 'normal',
        campaignModules: activeProfile?.modules.map(({ id }) => id).join(',') || 'none',
        initialPartySize: initialPartySpecies.length,
        initialPartySpecies: initialPartySpecies.join(',') || 'none',
        simpleBattleSeen,
        doubleBattleSeen,
        minDoublePlayerParticipants: minDoublePlayerParticipants ?? 0,
      })
    },
  })
}
