import type { RomInventory } from '../../../ndsTypes'
import type { CanonicalPokemon } from '../../pokemon/canonicalPokemon'
import { hgssVBlanksToMilliseconds } from '../../time/hgssFrameTiming'
import { formatHgssRomMessage } from '../../ui/romMessageFormatting'
import { HGSS_BATTLE_SEND_OUT_TIMING } from '../battlePokemonSendOutPlayback'
import type { SimpleBattleEvent, SimpleBattleSession } from '../simpleBattleSession'
import {
  advanceTrainerBattleIntroduction,
  type BattleSide,
  type TrainerBattleIntroduction,
} from '../trainerBattleIntroduction'

export type BrowserTrainerBattleIntroductionResources = Pick<
  RomInventory,
  'battleMessages' | 'trainerCatalog' | 'trainerClassNames'
>

export type BrowserTrainerBattleIntroductionAnimationRun = Readonly<{
  finished: Promise<unknown>
  cancel: () => void
}>

export type BrowserTrainerBattleIntroductionContext = Readonly<{
  battle?: SimpleBattleSession
  resources?: BrowserTrainerBattleIntroductionResources
  presentationAnimationLocks: number
}>

export type BrowserTrainerBattleIntroductionScheduler = Readonly<{
  setTimeout: (callback: () => void, delayMs: number) => number
  clearTimeout: (timer: number) => void
}>

export type BrowserTrainerBattleIntroductionPresentationPort = Readonly<{
  setBattlePresentation: (phase: 'introduction') => void
  setBattleUiMode: (mode: 'message') => void
  setMessage: (message: string) => void
  setMessageVisible: (visible: boolean) => void
  setMessageInputLocked: (locked: boolean) => void
  showPartyGauge: (side: BattleSide, members: readonly CanonicalPokemon[]) => void
  hidePartyGauge: (side: BattleSide) => void
  hideOpponentTrainer: () => void
}>

export type BrowserTrainerBattleIntroductionAnimationPort = Readonly<{
  playEncounterAnimation: () => BrowserTrainerBattleIntroductionAnimationRun | undefined
  playTrainerEntrance: () => BrowserTrainerBattleIntroductionAnimationRun | undefined
  playTrainerThrow: () => BrowserTrainerBattleIntroductionAnimationRun | undefined
  track: (run: BrowserTrainerBattleIntroductionAnimationRun | undefined) => void
  sendOut: (side: BattleSide, pokemon: CanonicalPokemon, completionWindowFrames: number) => void
}>

export type BrowserTrainerBattleIntroductionCompletionPort = Readonly<{
  consumeInitialEvents: (battle: SimpleBattleSession) => readonly SimpleBattleEvent[]
  queueInitialEvents: (events: readonly SimpleBattleEvent[]) => void
  showCommands: () => void
}>

export type BrowserTrainerBattleIntroductionHostPorts = Readonly<{
  readContext: () => BrowserTrainerBattleIntroductionContext
  getPokemonName: (pokemon: CanonicalPokemon) => string
  presentation: BrowserTrainerBattleIntroductionPresentationPort
  animations: BrowserTrainerBattleIntroductionAnimationPort
  completion: BrowserTrainerBattleIntroductionCompletionPort
  scheduler?: BrowserTrainerBattleIntroductionScheduler
}>

export type BrowserTrainerBattleIntroductionSnapshot = Readonly<{
  active: boolean
  awaitingAcknowledgement: boolean
}>

export type BrowserTrainerBattleIntroductionHost = Readonly<{
  start: (introduction: TrainerBattleIntroduction) => void
  advance: () => void
  releaseLockedAcknowledgement: () => void
  acknowledge: () => void
  clear: () => void
  getSnapshot: () => BrowserTrainerBattleIntroductionSnapshot
}>

/**
 * Possède la chronologie navigateur d'une introduction de Dresseur.
 *
 * La machine native reste dans trainerBattleIntroduction ; ce host ne fait
 * qu'appliquer ses événements aux ports DOM/animation et possède les délais
 * ainsi que l'acquittement qui étaient auparavant des variables globales.
 */
export function createBrowserTrainerBattleIntroductionHost(
  ports: BrowserTrainerBattleIntroductionHostPorts,
): BrowserTrainerBattleIntroductionHost {
  const scheduler = ports.scheduler ?? {
    setTimeout: (callback: () => void, delayMs: number) => window.setTimeout(callback, delayMs),
    clearTimeout: (timer: number) => window.clearTimeout(timer),
  }
  let activeIntroduction: TrainerBattleIntroduction | undefined
  let timer: number | undefined
  let awaitingAcknowledgement = false

  function clearTimer(): void {
    if (timer !== undefined) scheduler.clearTimeout(timer)
    timer = undefined
  }

  function clear(): void {
    clearTimer()
    activeIntroduction = undefined
    awaitingAcknowledgement = false
    ports.presentation.setMessageInputLocked(false)
    ports.presentation.hidePartyGauge('opponent')
    ports.presentation.hidePartyGauge('player')
  }

  function scheduleAdvance(frames: number): void {
    clearTimer()
    const scheduledIntroduction = activeIntroduction
    timer = scheduler.setTimeout(() => {
      timer = undefined
      if (activeIntroduction === scheduledIntroduction) advance()
    }, hgssVBlanksToMilliseconds(frames))
  }

  function scheduleAcknowledgementUnlock(frames: number): void {
    const scheduledIntroduction = activeIntroduction
    timer = scheduler.setTimeout(() => {
      timer = undefined
      if (activeIntroduction === scheduledIntroduction) {
        ports.presentation.setMessageInputLocked(false)
      }
    }, hgssVBlanksToMilliseconds(frames))
  }

  function complete(battle: SimpleBattleSession): void {
    clear()
    const initialEvents = ports.completion.consumeInitialEvents(battle)
    if (initialEvents.length > 0) ports.completion.queueInitialEvents(initialEvents)
    else ports.completion.showCommands()
  }

  function advance(): void {
    const introduction = activeIntroduction
    const { battle, resources } = ports.readContext()
    if (!introduction || !battle || !resources) return

    for (;;) {
      const event = advanceTrainerBattleIntroduction(introduction)
      if (!event) return
      if (event.kind === 'playEncounterAnimation') {
        ports.animations.track(ports.animations.playEncounterAnimation())
        continue
      }
      if (event.kind === 'waitFrames') {
        scheduleAdvance(event.frames)
        return
      }
      if (event.kind === 'waitForPresentation') {
        if (ports.readContext().presentationAnimationLocks > 0) introduction.cursor -= 1
        scheduleAdvance(1)
        return
      }
      if (event.kind === 'setTrainerEncounter') {
        ports.animations.track(ports.animations.playTrainerEntrance())
        continue
      }
      if (event.kind === 'showPartyGauge') {
        const members = event.side === 'player'
          ? introduction.battle.player.party.members
          : introduction.battle.opponent.party.members
        ports.presentation.showPartyGauge(event.side, members)
        continue
      }
      if (event.kind === 'hidePartyGauge') {
        ports.presentation.hidePartyGauge(event.side)
        continue
      }
      if (event.kind === 'printEncounterMessage') {
        ports.presentation.setBattlePresentation('introduction')
        const trainer = resources.trainerCatalog[battle.trainerId ?? -1]
        ports.presentation.setMessage(formatHgssRomMessage(
          resources.battleMessages[969] ?? 'Un combat est lancé par {10e 0,0} {103 1,0}!',
          [
            resources.trainerClassNames[trainer?.trainerClass ?? 0] ?? '',
            battle.trainerName ?? '',
          ],
        ))
        ports.presentation.setMessageVisible(true)
        continue
      }
      if (event.kind === 'waitForAcknowledgement') {
        ports.presentation.setBattleUiMode('message')
        awaitingAcknowledgement = true
        ports.presentation.setMessageInputLocked(true)
        scheduleAcknowledgementUnlock(event.minimumFrames)
        return
      }
      if (event.kind === 'printFirstSendOutMessage') {
        if (event.side === 'opponent') {
          const trainer = resources.trainerCatalog[battle.trainerId ?? -1]
          ports.presentation.setMessage(formatHgssRomMessage(
            resources.battleMessages[972] ?? '{101 2,0} est envoyé par {10e 0,0} {103 1,0}!',
            [
              ports.getPokemonName(battle.opponent.pokemon),
              resources.trainerClassNames[trainer?.trainerClass ?? 0] ?? '',
              battle.trainerName ?? '',
            ],
          ))
        } else {
          ports.presentation.setMessage(formatHgssRomMessage(
            resources.battleMessages[979] ?? '{101 0,0}! Go!',
            [ports.getPokemonName(battle.player.pokemon)],
          ))
        }
        ports.presentation.setMessageVisible(true)
        continue
      }
      if (event.kind === 'throwPokeBall') {
        if (event.side === 'opponent') {
          const trainerThrow = ports.animations.playTrainerThrow()
          ports.animations.track(trainerThrow)
          void trainerThrow?.finished.then(() => {
            if (ports.readContext().battle === battle) ports.presentation.hideOpponentTrainer()
          })
        }
        ports.animations.sendOut(
          event.side,
          event.side === 'player' ? battle.player.pokemon : battle.opponent.pokemon,
          event.side === 'player'
            ? HGSS_BATTLE_SEND_OUT_TIMING.playerIntroductionWindowFrames
            : HGSS_BATTLE_SEND_OUT_TIMING.opponentIntroductionWindowFrames,
        )
        continue
      }
      if (event.kind === 'introductionComplete') {
        complete(battle)
        return
      }
      // Ces événements décrivent l'ordre natif. Le rendu des sprites et HUD a
      // déjà été préparé par la scène de combat ; ils ne demandent aucun effet.
      if (event.kind === 'loadPartyGauges'
        || event.kind === 'slidePokemonIn'
        || event.kind === 'showHealthBars'
        || event.kind === 'freePartyGauges'
        || event.kind === 'setBattleBackground') continue
    }
  }

  return Object.freeze({
    start(introduction): void {
      clearTimer()
      activeIntroduction = introduction
      awaitingAcknowledgement = false
    },
    advance,
    releaseLockedAcknowledgement(): void {
      clearTimer()
      ports.presentation.setMessageInputLocked(false)
    },
    acknowledge(): void {
      awaitingAcknowledgement = false
      advance()
    },
    clear,
    getSnapshot(): BrowserTrainerBattleIntroductionSnapshot {
      return {
        active: activeIntroduction !== undefined,
        awaitingAcknowledgement,
      }
    },
  })
}
