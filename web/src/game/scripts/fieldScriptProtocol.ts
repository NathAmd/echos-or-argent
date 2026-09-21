import type { NitroGraphic, PlayerDirection } from '../../ndsTypes'
import type { HgssEasyChatCatalog } from '../../rom/easyChat/easyChatData'
import type { HgssFrontierRecordPage } from '../frontier/hgssFrontierRecords'
import type { HgssMartChoiceOption, HgssMartTransaction } from '../items/hgssMartSession'
import type { HgssMultiplayerRequest, HgssMultiplayerResult } from '../multiplayer/hgssMultiplayerGateway'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import type { HgssPhotoFieldStep, HgssPhotoRunnerControls } from '../photo/hgssPhotoFieldRuntime'
import type { HgssSafariFieldStep, HgssSafariRunnerControls } from '../safari/hgssSafariFieldCommands'
import type { HgssAlphPuzzleTile } from '../alph/hgssAlphPuzzle'
import type { FieldMovementAction } from './fieldMovement'
import type { HgssGymmickFieldStep } from './hgssGymmickFieldRuntime'
import type { HgssFieldMoveEffectMode } from '../world/hgssFieldMoveEffect'

export type FieldMapProp = {
  modelId: number
  x: number
  y: number
  z: number
}

export type FieldScriptActorState = {
  x: number
  z: number
  direction: PlayerDirection
  groundHeight?: number
  /** Identifiant de déplacement ObjectEvent ROM, absent pour l'avatar. */
  movement?: number
}

export type FieldScriptBattle =
  | { kind: 'trainer', trainerId: number, trainerParameter: number, encounterType: number, battleParameter: number }
  | { kind: 'multiTrainer', allyTrainerId: number, opponentTrainerIds: readonly [number, number], battleParameter: number }
  | { kind: 'wild', speciesId: number, level: number, battleParameter: number }
  | { kind: 'tutorial' }
  | { kind: 'trainerHouse', trainerNumber: number }

export type FieldScriptStep = HgssSafariFieldStep | HgssPhotoFieldStep
  | { kind: 'message', messageId: number, text: string, fontId?: number, speakerObjectId?: number }
  | { kind: 'dialogue', action: 'open' | 'close' | 'hold' | 'waitingIconAdd' | 'waitingIconRemove' }
  | { kind: 'choice', options: HgssMartChoiceOption[], cancellable: boolean, presentation?: 'starter' | 'party' | 'shop', shop?: { mode: 'buy' | 'sell', phase: 'browse' | 'confirm', balance: number, transaction?: HgssMartTransaction } }
  | { kind: 'number', min: number, max: number, shop?: { mode: 'buy' | 'sell', balance: number, transaction: HgssMartTransaction } }
  | { kind: 'nickname', slot: number, currentName: string, maxLength: number, cancellable: boolean, promptMessageId: 1 | 3 | 5, promptValues?: readonly string[] }
  | { kind: 'movement', objectId: number, actions: FieldMovementAction[] }
  | { kind: 'objectState', objectId: number, x?: number, z?: number, direction?: PlayerDirection }
  | { kind: 'facePlayer', objectId?: number }
  | { kind: 'cameraTarget', target: 'position', x: number, z: number }
  | { kind: 'cameraTarget', target: 'player' }
  | { kind: 'objectVisibility', objectId: number, visible: boolean }
  | { kind: 'mapProps', props: FieldMapProp[] }
  | { kind: 'fieldMoveEffect', mode: HgssFieldMoveEffectMode, completionVariable: number }
  | { kind: 'mapPropAnimation', action: 'attach', bindings: readonly { modelId: number, animationIndex: number }[] }
  | { kind: 'mapPropAnimation', action: 'load', tag: number, modelIds: readonly number[], animationCount: number, loopCount: number, reversed: boolean }
  | { kind: 'mapPropAnimation', action: 'play', tag: number, animationIndex: number }
  | { kind: 'mapPropAnimation', action: 'wait' | 'unload', tag: number }
  | { kind: 'doorAnimation', action: 'setup', tag: number, worldX: number, worldZ: number }
  | { kind: 'doorAnimation', action: 'play', tag: number, animationIndex: 0 | 1 }
  | { kind: 'doorAnimation', action: 'wait' | 'unload', tag: number }
  | { kind: 'followerMovement', action: 'pause', paused: boolean }
  | { kind: 'followerMovement', action: 'facePlayer' }
  | { kind: 'followerMovement', action: 'movement', movement: number }
  | { kind: 'followerMovement', action: 'configure', parameters: readonly [number, number] }
  | { kind: 'followerMovement', action: 'refresh' }
  | { kind: 'followerInteraction', slot: number, speciesId: number }
  | { kind: 'music', action: 'play' | 'stop' | 'reset' | 'fadeOut' | 'fadeIn', sequenceId?: number, targetVolume?: number, frames?: number }
  | { kind: 'soundEffect', action: 'play' | 'stop' | 'wait', sequenceId: number }
  | { kind: 'cry', action: 'play', speciesId: number, pattern: number }
  | { kind: 'cry', action: 'wait' }
  | { kind: 'fanfare', action: 'play', sequenceId: number }
  | { kind: 'fanfare', action: 'wait' }
  | { kind: 'screenFade', durationFrames: number, type: number, color: number }
  | { kind: 'screenShake', x: number, y: number, repeats: number, durationFrames: number }
  | { kind: 'specialCutscene', effect: 'celebiTimeTravel' | 'hallOfFame' | 'sinjohStage' | 'sinjohCircle' | 'sinjohEgg' | 'sinjohRestore' | 'linkReturn', parameter?: number }
  | { kind: 'save' }
  | { kind: 'pokemonPortrait', action: 'show', speciesId: number, gender: number }
  | { kind: 'pokemonPortrait', action: 'hide' }
  | HgssGymmickFieldStep
  | { kind: 'fieldOverlay', overlay: 'points' | 'saveStats' | 'floor', action: 'show' | 'hide' | 'update', type?: number, x?: number, y?: number }
  | { kind: 'objectEffect', action: 'configure' | 'moveTask' | 'rocketTrap' | 'persianStatues' | 'lakeFlight' | 'pokeCenter' | 'friendshipStatues', objectIds: number[], parameters: number[] }
  | { kind: 'apricornTree', objectId: number, treeIndex: number, apricornType: number }
  | { kind: 'mapEventState', event: 'warp', eventId: number, x: number, z: number }
  | { kind: 'warp', mapId: number, x: number, z: number, direction: PlayerDirection }
  | { kind: 'battle', battle: FieldScriptBattle }
  | { kind: 'multiplayer', request: HgssMultiplayerRequest }
  | { kind: 'easyChat', mode: number, catalog: HgssEasyChatCatalog, wordCount?: number, initialWordIds?: readonly number[] }
  | { kind: 'pcBox', mode: 0 | 1 | 2 | 3 | 4 }
  | { kind: 'pokeathlonApp', app: 'courseRecords' | 'medals' | 'eventRecords' | 'overview' | 'data', dataType?: number, records: readonly number[], athletePoints: number, rows?: readonly { label: string, value: number }[] }
  | { kind: 'frontierRecordsApp', page: HgssFrontierRecordPage }
  | { kind: 'gameClear', page: HgssFrontierRecordPage, defeatedRed: boolean, firstClear: boolean }
  | { kind: 'alphPuzzle', puzzleIndex: number, hint: string, tiles: HgssAlphPuzzleTile[], graphics: readonly NitroGraphic[], background?: NitroGraphic }
  | { kind: 'alphHiddenRoom', roomIndex: number, word: string, background: NitroGraphic }
  | { kind: 'daycareObjects', objects: Array<{ objectId: 250 | 251, x: number, z: number, pokemon: CanonicalPokemon }> }
  | { kind: 'eggHatch', partySlot: number, pokemon: CanonicalPokemon }
  | { kind: 'blackout' }
  | { kind: 'phoneCall', call: { callerId: number, parameter1: number, parameter2: number } }
  | { kind: 'inputWait', accepts: readonly ('confirm' | 'cancel' | 'direction')[], frames?: number }
  | { kind: 'waiting', waitFor: 'movement' | 'followerMovement' | 'fanfare' | 'timer', frames?: number }
  | { kind: 'ended' }

export type FieldScriptRunner = {
  resume: () => FieldScriptStep
  choose: (value: number) => void
  enterNumber: (value: number | undefined) => void
  enterNickname: (value: string | undefined) => void
  submitBattleResult: (won: boolean) => void
  submitMultiplayerResult: (result: HgssMultiplayerResult) => void
  submitEasyChat: (wordId: number | readonly number[] | undefined) => void
  closePcBox: () => void
  closePokeathlonApp: () => void
  closeFrontierRecordsApp: () => void
  closeGameClear: () => void
  finishAlphPuzzle: (solved: boolean) => void
  closeAlphHiddenRoom: () => void
  finishEggHatch: (nickname: string | undefined) => void
} & Partial<HgssSafariRunnerControls & HgssPhotoRunnerControls>

export function createFieldScriptSequenceRunner(runners: FieldScriptRunner[]): FieldScriptRunner {
  let index = 0
  return {
    resume: () => {
      while (index < runners.length) {
        const step = runners[index].resume()
        if (step.kind !== 'ended') return step
        index += 1
      }
      return { kind: 'ended' }
    },
    choose: (value) => runners[index]?.choose(value),
    enterNumber: (value) => runners[index]?.enterNumber(value),
    enterNickname: (value) => runners[index]?.enterNickname(value),
    submitBattleResult: (won) => runners[index]?.submitBattleResult(won),
    submitMultiplayerResult: (result) => runners[index]?.submitMultiplayerResult(result),
    submitEasyChat: (wordId) => runners[index]?.submitEasyChat(wordId),
    closePcBox: () => runners[index]?.closePcBox(),
    closePokeathlonApp: () => runners[index]?.closePokeathlonApp(),
    closeFrontierRecordsApp: () => runners[index]?.closeFrontierRecordsApp(),
    closeGameClear: () => runners[index]?.closeGameClear(),
    finishAlphPuzzle: (solved) => runners[index]?.finishAlphPuzzle(solved),
    closeAlphHiddenRoom: () => runners[index]?.closeAlphHiddenRoom(),
    finishEggHatch: (nickname) => runners[index]?.finishEggHatch(nickname),
    submitSafariCustomizerChange: (change) => runners[index]?.submitSafariCustomizerChange?.(change),
    closeSafariCustomizer: () => runners[index]?.closeSafariCustomizer?.(),
    submitSafariDecoratorSelection: (objectId) => runners[index]?.submitSafariDecoratorSelection?.(objectId),
    finishPhotoCapture: () => runners[index]?.finishPhotoCapture?.(),
    closePhotoAlbum: (photos) => runners[index]?.closePhotoAlbum?.(photos),
  }
}

/** Appel entrant déjà sélectionné par PhoneCallPersistentState. */
export function createFieldPhoneCallRunner(
  call: { callerId: number, parameter1: number, parameter2: number },
): FieldScriptRunner {
  let shown = false
  const unavailable = () => {
    throw new Error("Cette saisie n'est pas disponible pendant un appel Pokématos entrant.")
  }
  return {
    resume: () => {
      if (shown) return { kind: 'ended' }
      shown = true
      return { kind: 'phoneCall', call: { ...call } }
    },
    choose: unavailable,
    enterNumber: unavailable,
    enterNickname: unavailable,
    submitBattleResult: unavailable,
    submitMultiplayerResult: unavailable,
    submitEasyChat: unavailable,
    closePcBox: unavailable,
    closePokeathlonApp: unavailable,
    closeFrontierRecordsApp: unavailable,
    closeGameClear: unavailable,
    finishAlphPuzzle: unavailable,
    closeAlphHiddenRoom: unavailable,
    finishEggHatch: unavailable,
  }
}

export function projectFieldScriptState(runner: FieldScriptRunner): void {
  for (let stepCount = 0; stepCount < 1024; stepCount += 1) {
    const step = runner.resume()
    if (step.kind === 'ended') return
    if (step.kind === 'choice' || step.kind === 'number' || step.kind === 'nickname' || step.kind === 'eggHatch' || step.kind === 'multiplayer' || step.kind === 'easyChat' || step.kind === 'pcBox' || step.kind === 'pokeathlonApp' || step.kind === 'frontierRecordsApp' || step.kind === 'gameClear' || step.kind === 'alphPuzzle' || step.kind === 'alphHiddenRoom' || step.kind === 'safariCustomizer' || step.kind === 'safariDecorator' || step.kind === 'photoCapture' || step.kind === 'photoAlbum') {
      throw new Error(`Le script d’initialisation ROM requiert une saisie ${step.kind} avant de résoudre ses objets.`)
    }
  }
  throw new Error('Le script d’initialisation ROM dépasse 1024 suspensions pendant la résolution de ses objets.')
}
