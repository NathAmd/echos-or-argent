import type { InitialTrainerBattleState } from './initialTrainerBattleState'

export type BattleSide = 'player' | 'opponent'

export type TrainerBattleIntroductionEvent =
  | { kind: 'playEncounterAnimation' }
  | { kind: 'setTrainerEncounter', sides: 'all' }
  | { kind: 'waitFrames', frames: number }
  | { kind: 'waitForPresentation' }
  | { kind: 'loadPartyGauges' }
  | { kind: 'showPartyGauge', side: BattleSide }
  | { kind: 'printEncounterMessage', side: 'opponent' }
  | { kind: 'waitForAcknowledgement', minimumFrames: number }
  | { kind: 'printFirstSendOutMessage', side: BattleSide }
  | { kind: 'hidePartyGauge', side: BattleSide }
  | { kind: 'throwPokeBall', side: BattleSide, slots: number[] }
  | { kind: 'slidePokemonIn', side: BattleSide, slots: number[] }
  | { kind: 'showHealthBars', side: BattleSide }
  | { kind: 'freePartyGauges' }
  | { kind: 'setBattleBackground' }
  | { kind: 'introductionComplete' }

export type TrainerBattleIntroduction = {
  battle: InitialTrainerBattleState
  phase: 'introduction' | 'ready'
  cursor: number
  activeSlots: Record<BattleSide, number[]>
  events: TrainerBattleIntroductionEvent[]
}

export function createTrainerBattleIntroduction(battle: InitialTrainerBattleState): TrainerBattleIntroduction {
  return {
    battle,
    phase: 'introduction',
    cursor: 0,
    activeSlots: { player: [], opponent: [] },
    events: [
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
      { kind: 'throwPokeBall', side: 'opponent', slots: [...battle.opponent.openingSlots] },
      { kind: 'slidePokemonIn', side: 'opponent', slots: [...battle.opponent.openingSlots] },
      { kind: 'waitFrames', frames: 112 },
      { kind: 'showHealthBars', side: 'opponent' },
      { kind: 'waitForPresentation' },
      { kind: 'printFirstSendOutMessage', side: 'player' },
      { kind: 'hidePartyGauge', side: 'player' },
      { kind: 'throwPokeBall', side: 'player', slots: [...battle.player.openingSlots] },
      { kind: 'slidePokemonIn', side: 'player', slots: [...battle.player.openingSlots] },
      { kind: 'waitFrames', frames: 96 },
      { kind: 'showHealthBars', side: 'player' },
      { kind: 'waitForPresentation' },
      { kind: 'freePartyGauges' },
      { kind: 'setBattleBackground' },
      { kind: 'introductionComplete' },
    ],
  }
}

export function advanceTrainerBattleIntroduction(
  introduction: TrainerBattleIntroduction,
): TrainerBattleIntroductionEvent | undefined {
  if (introduction.phase === 'ready') return undefined
  const event = introduction.events[introduction.cursor]
  if (!event) throw new Error('La chronologie d’introduction du combat trainer est incomplete.')
  introduction.cursor += 1
  if (event.kind === 'slidePokemonIn') introduction.activeSlots[event.side] = [...event.slots]
  if (event.kind === 'introductionComplete') introduction.phase = 'ready'
  return event
}