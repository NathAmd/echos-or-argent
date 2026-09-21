import { describe, expect, it } from 'vitest'
import type { InitialTrainerBattleState } from './initialTrainerBattleState'
import { advanceTrainerBattleIntroduction, createTrainerBattleIntroduction } from './trainerBattleIntroduction'

function createBattle(): InitialTrainerBattleState {
  return {
    kind: 'trainer',
    phase: 'setup',
    format: 'single',
    turn: 0,
    script: { kind: 'trainer', trainerId: 497, trainerParameter: 0, encounterType: 1, battleParameter: 0 },
    trainer: { trainerId: 497, trainerType: 0, trainerClass: 23, partySize: 1, items: [0, 0, 0, 0], aiFlags: 0, doubleBattle: false, party: [] },
    player: { party: { members: [] }, openingSlots: [1] },
    opponent: { party: { members: [] }, openingSlots: [0] },
  }
}

describe('native trainer battle introduction', () => {
  it('preserves the native trainer send-out order and explicit frame waits', () => {
    const introduction = createTrainerBattleIntroduction(createBattle())

    expect(introduction.events).toMatchObject([
      { kind: 'playEncounterAnimation' },
      { kind: 'setTrainerEncounter', sides: 'all' },
      { kind: 'waitFrames', frames: 96 },
      { kind: 'loadPartyGauges' },
      { kind: 'showPartyGauge', side: 'opponent' },
      { kind: 'showPartyGauge', side: 'player' },
      { kind: 'printEncounterMessage', side: 'opponent' },
      { kind: 'waitForPresentation' },
      { kind: 'waitForAcknowledgement', minimumFrames: 30 },
      { kind: 'printFirstSendOutMessage', side: 'opponent' },
      { kind: 'hidePartyGauge', side: 'opponent' },
      { kind: 'throwPokeBall', side: 'opponent', slots: [0] },
      { kind: 'slidePokemonIn', side: 'opponent', slots: [0] },
      { kind: 'waitFrames', frames: 112 },
      { kind: 'showHealthBars', side: 'opponent' },
      { kind: 'waitForPresentation' },
      { kind: 'printFirstSendOutMessage', side: 'player' },
      { kind: 'hidePartyGauge', side: 'player' },
      { kind: 'throwPokeBall', side: 'player', slots: [1] },
      { kind: 'slidePokemonIn', side: 'player', slots: [1] },
      { kind: 'waitFrames', frames: 96 },
      { kind: 'showHealthBars', side: 'player' },
      { kind: 'waitForPresentation' },
      { kind: 'freePartyGauges' },
      { kind: 'setBattleBackground' },
      { kind: 'introductionComplete' },
    ])
  })

  it('activates each side only when its native send-out event is consumed', () => {
    const introduction = createTrainerBattleIntroduction(createBattle())
    while (introduction.events[introduction.cursor]?.kind !== 'throwPokeBall') advanceTrainerBattleIntroduction(introduction)
    expect(introduction.activeSlots).toEqual({ player: [], opponent: [] })
    expect(advanceTrainerBattleIntroduction(introduction)).toEqual({ kind: 'throwPokeBall', side: 'opponent', slots: [0] })
    expect(introduction.activeSlots).toEqual({ player: [], opponent: [] })
    expect(advanceTrainerBattleIntroduction(introduction)).toEqual({ kind: 'slidePokemonIn', side: 'opponent', slots: [0] })
    expect(introduction.activeSlots).toEqual({ player: [], opponent: [0] })
    while (introduction.events[introduction.cursor]?.kind !== 'slidePokemonIn') advanceTrainerBattleIntroduction(introduction)
    expect(advanceTrainerBattleIntroduction(introduction)).toEqual({ kind: 'slidePokemonIn', side: 'player', slots: [1] })
    while (advanceTrainerBattleIntroduction(introduction)?.kind !== 'introductionComplete') continue
    expect(introduction).toMatchObject({ phase: 'ready', activeSlots: { player: [1], opponent: [0] } })
    expect(advanceTrainerBattleIntroduction(introduction)).toBeUndefined()
  })
})