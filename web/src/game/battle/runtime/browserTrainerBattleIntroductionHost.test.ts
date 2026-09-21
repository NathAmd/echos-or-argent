import { describe, expect, it, vi } from 'vitest'
import type { CanonicalPokemon } from '../../pokemon/canonicalPokemon'
import { hgssVBlanksToMilliseconds } from '../../time/hgssFrameTiming'
import type { InitialTrainerBattleState } from '../initialTrainerBattleState'
import type { SimpleBattleEvent, SimpleBattleSession } from '../simpleBattleSession'
import type {
  TrainerBattleIntroduction,
  TrainerBattleIntroductionEvent,
} from '../trainerBattleIntroduction'
import {
  createBrowserTrainerBattleIntroductionHost,
  type BrowserTrainerBattleIntroductionAnimationRun,
  type BrowserTrainerBattleIntroductionResources,
} from './browserTrainerBattleIntroductionHost'

function pokemon(instanceId: string, speciesName: string, nickname?: string): CanonicalPokemon {
  return { instanceId, speciesName, nickname } as CanonicalPokemon
}

function initialBattle(player: CanonicalPokemon, opponent: CanonicalPokemon): InitialTrainerBattleState {
  return {
    kind: 'trainer',
    phase: 'setup',
    format: 'single',
    turn: 0,
    script: { kind: 'trainer', trainerId: 4, trainerParameter: 0, encounterType: 1, battleParameter: 0 },
    trainer: {
      trainerId: 4,
      trainerType: 0,
      trainerClass: 2,
      partySize: 1,
      items: [0, 0, 0, 0],
      aiFlags: 0,
      doubleBattle: false,
      party: [],
    },
    player: { party: { members: [player] }, openingSlots: [0] },
    opponent: { party: { members: [opponent] }, openingSlots: [0] },
  }
}

function introduction(
  battle: InitialTrainerBattleState,
  events: readonly TrainerBattleIntroductionEvent[],
): TrainerBattleIntroduction {
  return {
    battle,
    phase: 'introduction',
    cursor: 0,
    activeSlots: { player: [], opponent: [] },
    events: [...events],
  }
}

function resolvedAnimationRun(): BrowserTrainerBattleIntroductionAnimationRun {
  return { finished: Promise.resolve(), cancel: vi.fn() }
}

function deferredAnimationRun(): {
  run: BrowserTrainerBattleIntroductionAnimationRun
  resolve: () => void
} {
  let resolve = (): void => undefined
  const finished = new Promise<void>((complete) => { resolve = complete })
  return { run: { finished, cancel: vi.fn() }, resolve }
}

function createFixture(options: Readonly<{
  initialEvents?: readonly SimpleBattleEvent[]
  trainerThrow?: BrowserTrainerBattleIntroductionAnimationRun
}> = {}) {
  const player = pokemon('player-1', 'Héricendre', 'BRAISE')
  const opponent = pokemon('opponent-1', 'Germignon', 'FEUILLE')
  const nativeBattle = initialBattle(player, opponent)
  const battle = {
    kind: 'trainer',
    trainerId: 4,
    trainerName: 'ALICE',
    player: { pokemon: player },
    opponent: { pokemon: opponent },
  } as SimpleBattleSession
  const trainerCatalog = Array.from({ length: 5 })
  trainerCatalog[4] = { trainerClass: 2 }
  const resources = {
    battleMessages: {
      969: 'Défi de {10e 0,0} {103 1,0}!',
      972: '{101 2,0} est envoyé par {10e 0,0} {103 1,0}!',
      979: 'Go, {101 0,0}!',
    },
    trainerCatalog,
    trainerClassNames: ['', '', 'CHAMPION'],
  } as unknown as BrowserTrainerBattleIntroductionResources
  let currentBattle: SimpleBattleSession | undefined = battle
  let currentResources: BrowserTrainerBattleIntroductionResources | undefined = resources
  let presentationAnimationLocks = 0
  let nextTimer = 1
  const delays: number[] = []
  const timers = new Map<number, () => void>()
  const timerHistory = new Map<number, () => void>()
  const encounterAnimation = resolvedAnimationRun()
  const trainerEntrance = resolvedAnimationRun()
  const trainerThrow = options.trainerThrow ?? resolvedAnimationRun()
  const setBattlePresentation = vi.fn()
  const setBattleUiMode = vi.fn()
  const setMessage = vi.fn()
  const setMessageVisible = vi.fn()
  const setMessageInputLocked = vi.fn()
  const showPartyGauge = vi.fn()
  const hidePartyGauge = vi.fn()
  const hideOpponentTrainer = vi.fn()
  const playEncounterAnimation = vi.fn(() => encounterAnimation)
  const playTrainerEntrance = vi.fn(() => trainerEntrance)
  const playTrainerThrow = vi.fn(() => trainerThrow)
  const track = vi.fn()
  const sendOut = vi.fn()
  const consumeInitialEvents = vi.fn((): readonly SimpleBattleEvent[] => options.initialEvents ?? [])
  const queueInitialEvents = vi.fn()
  const showCommands = vi.fn()
  const host = createBrowserTrainerBattleIntroductionHost({
    readContext: () => ({ battle: currentBattle, resources: currentResources, presentationAnimationLocks }),
    getPokemonName: ({ nickname, speciesName }) => nickname ?? speciesName,
    presentation: {
      setBattlePresentation,
      setBattleUiMode,
      setMessage,
      setMessageVisible,
      setMessageInputLocked,
      showPartyGauge,
      hidePartyGauge,
      hideOpponentTrainer,
    },
    animations: {
      playEncounterAnimation,
      playTrainerEntrance,
      playTrainerThrow,
      track,
      sendOut,
    },
    completion: { consumeInitialEvents, queueInitialEvents, showCommands },
    scheduler: {
      setTimeout: (callback, delayMs) => {
        const id = nextTimer
        nextTimer += 1
        delays.push(delayMs)
        timers.set(id, callback)
        timerHistory.set(id, callback)
        return id
      },
      clearTimeout: (id) => { timers.delete(id) },
    },
  })

  const runNextTimer = (): number => {
    const entry = timers.entries().next().value as [number, () => void] | undefined
    if (!entry) throw new Error('Aucun timer actif.')
    timers.delete(entry[0])
    entry[1]()
    return entry[0]
  }

  return {
    host,
    battle,
    nativeBattle,
    player,
    opponent,
    resources,
    delays,
    timers,
    timerHistory,
    encounterAnimation,
    trainerEntrance,
    trainerThrow,
    setBattlePresentation,
    setBattleUiMode,
    setMessage,
    setMessageVisible,
    setMessageInputLocked,
    showPartyGauge,
    hidePartyGauge,
    hideOpponentTrainer,
    playEncounterAnimation,
    playTrainerEntrance,
    playTrainerThrow,
    track,
    sendOut,
    consumeInitialEvents,
    queueInitialEvents,
    showCommands,
    runNextTimer,
    setBattle: (next: SimpleBattleSession | undefined) => { currentBattle = next },
    setResources: (next: BrowserTrainerBattleIntroductionResources | undefined) => { currentResources = next },
    setPresentationAnimationLocks: (locks: number) => { presentationAnimationLocks = locks },
  }
}

describe('host navigateur de l’introduction de combat Dresseur', () => {
  it('préserve les attentes VBlank, le verrou minimal et les deux temps de l’acquittement', () => {
    const initialEvents = [{ kind: 'escaped' }] as const satisfies readonly SimpleBattleEvent[]
    const fixture = createFixture({ initialEvents })
    const active = introduction(fixture.nativeBattle, [
      { kind: 'waitFrames', frames: 96 },
      { kind: 'waitForPresentation' },
      { kind: 'waitForAcknowledgement', minimumFrames: 30 },
      { kind: 'introductionComplete' },
    ])

    fixture.host.start(active)
    fixture.host.advance()
    expect(fixture.delays).toEqual([hgssVBlanksToMilliseconds(96)])

    fixture.setPresentationAnimationLocks(1)
    fixture.runNextTimer()
    expect(active.cursor).toBe(1)
    expect(fixture.delays.at(-1)).toBe(hgssVBlanksToMilliseconds(1))

    fixture.setPresentationAnimationLocks(0)
    fixture.runNextTimer()
    expect(active.cursor).toBe(2)
    expect(fixture.delays.at(-1)).toBe(hgssVBlanksToMilliseconds(1))

    fixture.runNextTimer()
    expect(fixture.host.getSnapshot()).toEqual({ active: true, awaitingAcknowledgement: true })
    expect(fixture.setBattleUiMode).toHaveBeenCalledWith('message')
    expect(fixture.setMessageInputLocked).toHaveBeenLastCalledWith(true)
    expect(fixture.delays.at(-1)).toBe(hgssVBlanksToMilliseconds(30))

    fixture.host.releaseLockedAcknowledgement()
    expect(fixture.timers.size).toBe(0)
    expect(fixture.setMessageInputLocked).toHaveBeenLastCalledWith(false)
    expect(fixture.host.getSnapshot().awaitingAcknowledgement).toBe(true)

    fixture.host.acknowledge()
    expect(fixture.host.getSnapshot()).toEqual({ active: false, awaitingAcknowledgement: false })
    expect(fixture.consumeInitialEvents).toHaveBeenCalledWith(fixture.battle)
    expect(fixture.queueInitialEvents).toHaveBeenCalledWith(initialEvents)
    expect(fixture.showCommands).not.toHaveBeenCalled()
  })

  it('applique les gauges, messages ROM, animations et fenêtres exactes d’envoi', async () => {
    const fixture = createFixture()
    fixture.host.start(introduction(fixture.nativeBattle, [
      { kind: 'playEncounterAnimation' },
      { kind: 'setTrainerEncounter', sides: 'all' },
      { kind: 'loadPartyGauges' },
      { kind: 'showPartyGauge', side: 'opponent' },
      { kind: 'showPartyGauge', side: 'player' },
      { kind: 'printEncounterMessage', side: 'opponent' },
      { kind: 'printFirstSendOutMessage', side: 'opponent' },
      { kind: 'hidePartyGauge', side: 'opponent' },
      { kind: 'throwPokeBall', side: 'opponent', slots: [0] },
      { kind: 'slidePokemonIn', side: 'opponent', slots: [0] },
      { kind: 'showHealthBars', side: 'opponent' },
      { kind: 'printFirstSendOutMessage', side: 'player' },
      { kind: 'throwPokeBall', side: 'player', slots: [0] },
      { kind: 'freePartyGauges' },
      { kind: 'setBattleBackground' },
      { kind: 'introductionComplete' },
    ]))

    fixture.host.advance()

    expect(fixture.track.mock.calls.map(([run]) => run)).toEqual([
      fixture.encounterAnimation,
      fixture.trainerEntrance,
      fixture.trainerThrow,
    ])
    expect(fixture.showPartyGauge).toHaveBeenNthCalledWith(1, 'opponent', [fixture.opponent])
    expect(fixture.showPartyGauge).toHaveBeenNthCalledWith(2, 'player', [fixture.player])
    expect(fixture.setBattlePresentation).toHaveBeenCalledWith('introduction')
    expect(fixture.setMessage.mock.calls.map(([message]) => message)).toEqual([
      'Défi de CHAMPION ALICE!',
      'FEUILLE est envoyé par CHAMPION ALICE!',
      'Go, BRAISE!',
    ])
    expect(fixture.setMessageVisible).toHaveBeenCalledTimes(3)
    expect(fixture.sendOut).toHaveBeenNthCalledWith(1, 'opponent', fixture.opponent, 112)
    expect(fixture.sendOut).toHaveBeenNthCalledWith(2, 'player', fixture.player, 96)
    expect(fixture.hidePartyGauge.mock.calls.map(([side]) => side)).toEqual([
      'opponent',
      'opponent',
      'player',
    ])
    expect(fixture.consumeInitialEvents).toHaveBeenCalledWith(fixture.battle)
    expect(fixture.showCommands).toHaveBeenCalledOnce()
    expect(fixture.queueInitialEvents).not.toHaveBeenCalled()
    expect(fixture.setMessageInputLocked).toHaveBeenLastCalledWith(false)
    expect(fixture.host.getSnapshot().active).toBe(false)

    await fixture.trainerThrow.finished
    await Promise.resolve()
    expect(fixture.hideOpponentTrainer).toHaveBeenCalledOnce()
  })

  it('déverrouille automatiquement le message après la durée minimale sans acquitter', () => {
    const fixture = createFixture()
    fixture.host.start(introduction(fixture.nativeBattle, [
      { kind: 'waitForAcknowledgement', minimumFrames: 30 },
      { kind: 'introductionComplete' },
    ]))

    fixture.host.advance()
    expect(fixture.setMessageInputLocked).toHaveBeenLastCalledWith(true)
    fixture.runNextTimer()

    expect(fixture.setMessageInputLocked).toHaveBeenLastCalledWith(false)
    expect(fixture.host.getSnapshot()).toEqual({ active: true, awaitingAcknowledgement: true })

    fixture.host.acknowledge()
    expect(fixture.showCommands).toHaveBeenCalledOnce()
    expect(fixture.host.getSnapshot().active).toBe(false)
  })

  it('ne fait pas disparaître le Dresseur si le combat actif a changé avant la fin du lancer', async () => {
    const deferred = deferredAnimationRun()
    const fixture = createFixture({ trainerThrow: deferred.run })
    fixture.host.start(introduction(fixture.nativeBattle, [
      { kind: 'throwPokeBall', side: 'opponent', slots: [0] },
      { kind: 'waitFrames', frames: 1 },
    ]))
    fixture.host.advance()
    fixture.setBattle({ ...fixture.battle } as SimpleBattleSession)

    deferred.resolve()
    await deferred.run.finished
    await Promise.resolve()

    expect(fixture.hideOpponentTrainer).not.toHaveBeenCalled()
  })

  it('n’avance pas sans combat ou ressources et invalide le timer lors du clear', () => {
    const fixture = createFixture()
    const active = introduction(fixture.nativeBattle, [
      { kind: 'playEncounterAnimation' },
      { kind: 'waitFrames', frames: 12 },
    ])
    fixture.host.start(active)

    fixture.setResources(undefined)
    fixture.host.advance()
    fixture.setResources(fixture.resources)
    fixture.setBattle(undefined)
    fixture.host.advance()
    expect(active.cursor).toBe(0)
    expect(fixture.playEncounterAnimation).not.toHaveBeenCalled()

    fixture.setBattle(fixture.battle)
    fixture.host.advance()
    expect(fixture.playEncounterAnimation).toHaveBeenCalledOnce()
    expect(fixture.timers.size).toBe(1)
    const staleTimer = fixture.timerHistory.values().next().value as (() => void) | undefined

    fixture.host.clear()
    staleTimer?.()

    expect(fixture.timers.size).toBe(0)
    expect(fixture.host.getSnapshot()).toEqual({ active: false, awaitingAcknowledgement: false })
    expect(active.cursor).toBe(2)
    expect(fixture.hidePartyGauge.mock.calls.map(([side]) => side)).toEqual(['opponent', 'player'])
    expect(fixture.setMessageInputLocked).toHaveBeenLastCalledWith(false)
  })
})
