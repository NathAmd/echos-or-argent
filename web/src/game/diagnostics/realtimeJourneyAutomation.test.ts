import { describe, expect, it } from 'vitest'
import type { PokemonCatalog } from '../../ndsTypes'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { createFieldScriptState } from '../scripts/fieldScriptRunner'
import { HIVE_BADGE_TARGET } from '../simulation/hiveBadgeJourneyAgent'
import { PLAIN_BADGE_TARGET } from '../simulation/plainBadgeJourneyAgent'
import { TOGEPI_EGG_TARGET } from '../simulation/togepiEggJourneyAgent'
import { collectRealtimeJourneyEvidence, createRealtimeJourneyAgent, recordBotWins, runBotMachine, type RealtimeJourneyAgent } from './realtimeJourneyAutomation'
import type { RealtimeTestBotJourney } from './realtimeTestScript'

describe('real-time journey automation', () => {
  it('collecte séparément les preuves persistantes Zéphyr, Togepi, Puits et Essaim', () => {
    const state = createFieldScriptState('male')
    state.badges.add(0)
    state.party.members.push({ speciesId: TOGEPI_EGG_TARGET.speciesId, isEgg: true } as (typeof state.party.members)[number])
    state.flags.add(TOGEPI_EGG_TARGET.receivedFlagId)
    state.variables.set(TOGEPI_EGG_TARGET.deliveryVariableId, TOGEPI_EGG_TARGET.deliveryVariableValue)

    expect(collectRealtimeJourneyEvidence(state, new Set([20]), TOGEPI_EGG_TARGET.violetCityMapId)).toEqual({
      zephyrBadge: true,
      falknerDefeated: true,
      togepiEggReceived: true,
      togepiReturnComplete: true,
      slowpokeWellCleared: false,
      hiveBadge: false,
      bugsyDefeated: false,
      hiveGymComplete: false,
      ilexForestCleared: false,
      cutLearned: false,
      radioQuizComplete: false,
      plainBadge: false,
      whitneyDefeated: false,
      plainGymComplete: false,
      squirtBottleReceived: false,
      sudowoodoCleared: false,
      legendaryBeastsReleased: false,
      fogBadge: false,
      mortyDefeated: false,
      fogGymComplete: false,
    })
    expect(collectRealtimeJourneyEvidence(state, new Set(), TOGEPI_EGG_TARGET.violetShopMapId)).toEqual({
      zephyrBadge: true,
      falknerDefeated: false,
      togepiEggReceived: true,
      togepiReturnComplete: false,
      slowpokeWellCleared: false,
      hiveBadge: false,
      bugsyDefeated: false,
      hiveGymComplete: false,
      ilexForestCleared: false,
      cutLearned: false,
      radioQuizComplete: false,
      plainBadge: false,
      whitneyDefeated: false,
      plainGymComplete: false,
      squirtBottleReceived: false,
      sudowoodoCleared: false,
      legendaryBeastsReleased: false,
      fogBadge: false,
      mortyDefeated: false,
      fogGymComplete: false,
    })

    state.flags.add(HIVE_BADGE_TARGET.rocketsDefeatedFlagId)
    state.flags.add(HIVE_BADGE_TARGET.gymGuardRemovedFlagId)
    state.badges.add(HIVE_BADGE_TARGET.badgeIndex)
    expect(collectRealtimeJourneyEvidence(state, new Set([20, 21]), HIVE_BADGE_TARGET.azaleaGymMapId)).toEqual({
      zephyrBadge: true,
      falknerDefeated: true,
      togepiEggReceived: true,
      togepiReturnComplete: false,
      slowpokeWellCleared: true,
      hiveBadge: true,
      bugsyDefeated: true,
      hiveGymComplete: true,
      ilexForestCleared: false,
      cutLearned: false,
      radioQuizComplete: false,
      plainBadge: false,
      whitneyDefeated: false,
      plainGymComplete: false,
      squirtBottleReceived: false,
      sudowoodoCleared: false,
      legendaryBeastsReleased: false,
      fogBadge: false,
      mortyDefeated: false,
      fogGymComplete: false,
    })

    state.flags.add(PLAIN_BADGE_TARGET.firstFarfetchdFlagId)
    state.flags.add(PLAIN_BADGE_TARGET.secondFarfetchdFlagId)
    state.flags.add(PLAIN_BADGE_TARGET.hmReceivedFlagId)
    state.flags.add(PLAIN_BADGE_TARGET.cutTreeFlagId)
    state.flags.add(PLAIN_BADGE_TARGET.radioQuizCompleteFlagId)
    state.flags.add(PLAIN_BADGE_TARGET.whitneyCrySceneFlagId)
    state.badges.add(PLAIN_BADGE_TARGET.badgeIndex)
    state.party.members.push({ speciesId: 158, moves: [{ moveId: PLAIN_BADGE_TARGET.cutMoveId }] } as (typeof state.party.members)[number])
    expect(collectRealtimeJourneyEvidence(state, new Set([20, 21, 30]), PLAIN_BADGE_TARGET.goldenrodGymMapId)).toMatchObject({
      ilexForestCleared: true,
      cutLearned: true,
      radioQuizComplete: true,
      plainBadge: true,
      whitneyDefeated: true,
      plainGymComplete: true,
    })
  })

  it('fails closed for an unknown browser journey', () => {
    expect(() => createRealtimeJourneyAgent('inconnu' as RealtimeTestBotJourney, []))
      .toThrow('Parcours d’audit navigateur inconnu: inconnu.')
  })

  it('apprend une CS compatible par le chemin du bot et conserve la CS', () => {
    const state = createFieldScriptState('male')
    const catalog = createPokemonTestCatalog() as PokemonCatalog
    catalog.moves[15] = { ...catalog.moves[33]!, moveId: 15, pp: 30 }
    catalog.personalData[1] = { ...catalog.personalData[1]!, tmHmCompatibility: [0, 0, 1 << 28, 0] }
    const pokemon = {
      speciesId: 1,
      form: 0,
      isEgg: false,
      moves: [{ moveId: 33, pp: 35, maxPp: 35, ppUps: 0, data: catalog.moves[33]! }],
    } as CanonicalPokemon
    state.party.members.push(pokemon)
    state.inventory.set(420, 1)
    state.pokemonRuntime = { catalog } as NonNullable<typeof state.pokemonRuntime>
    const failures: string[] = []
    const successes: string[] = []

    runBotMachine(state, 420, 'teach-cut', (message) => failures.push(message), (message) => successes.push(message))

    expect(failures).toEqual([])
    expect(successes).toEqual(['Bot audit : CS1 apprise ·'])
    expect(pokemon.moves.at(-1)?.moveId).toBe(15)
    expect(state.inventory.get(420)).toBe(1)
  })

  it('enregistre chaque victoire et la notifie à l’agent courant', () => {
    const wonTrainerBattleIds = new Set<number>()
    const notified: number[] = []
    const agent = { notifyTrainerBattleWon: (trainerId: number) => notified.push(trainerId) } as unknown as RealtimeJourneyAgent

    recordBotWins(wonTrainerBattleIds, agent, [5, 30])

    expect([...wonTrainerBattleIds]).toEqual([5, 30])
    expect(notified).toEqual([5, 30])
  })
})
