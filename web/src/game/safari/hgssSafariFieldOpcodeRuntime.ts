import type { OpeningMapPreview } from '../../ndsTypes'
import type { HgssMultiplayerRequest, HgssMultiplayerResult } from '../multiplayer/hgssMultiplayerGateway'
import { getHgssRtcTimestampSeconds } from '../time/hgssRtcPenalty'
import {
  cloneHgssSafariState,
  deactivateHgssSafariLinkIfExpired,
  receiveHgssSafariLinkedAreaSet,
  type HgssSafariState,
} from './hgssSafariState'
import {
  HGSS_SAFARI_CUSTOMIZER_CHANGED_FLAG,
  applyHgssSafariCustomizerChange,
  applyHgssSafariDecoratorSelection,
  createHgssSafariCustomizerStep,
  createHgssSafariDecoratorStep,
  findHgssSafariObjectInFront,
  getHgssSafariDecoratorEligibility,
  getHgssSafariObjectName,
  removeHgssSafariObjectInFrontByIndex,
  type HgssSafariCustomizerChange,
  type HgssSafariDecoratorCandidate,
  type HgssSafariFieldStep,
  type HgssSafariPlayerPosition,
  type HgssSafariRunnerControls,
} from './hgssSafariFieldCommands'

type HgssSafariOpcodeRuntime = {
  trainer: { id: number }
  language: number
  gameVersion: number
  now: () => Date
  ownerRtcOffset?: () => number
}

export type HgssSafariFieldOpcodeState = {
  safariZone: HgssSafariState
  variables: Map<number, number>
  buffers: Map<number, string>
  flags: Set<number>
  player: Omit<HgssSafariPlayerPosition, 'state'>
  playerState: number
  pokemonRuntime?: HgssSafariOpcodeRuntime
}

function requireBytes(bytes: Uint8Array, offset: number, size: number, opcode: number): void {
  if (offset < 0 || offset + size > bytes.byteLength) {
    throw new Error(`La commande script ${opcode} est tronquee a l’offset ${offset}.`)
  }
}

function readHalfword(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | bytes[offset + 1]! << 8
}

function readScriptValue(state: HgssSafariFieldOpcodeState, bytes: Uint8Array, offset: number): number {
  const value = readHalfword(bytes, offset)
  return value >= 0x4000 ? state.variables.get(value) ?? 0 : value
}

function playerPosition(state: HgssSafariFieldOpcodeState): HgssSafariPlayerPosition {
  return { ...state.player, state: state.playerState }
}

function requireRuntime(state: HgssSafariFieldOpcodeState): HgssSafariOpcodeRuntime {
  if (!state.pokemonRuntime) throw new Error('Le runtime Pokémon HGSS requis par le Parc Safari est absent.')
  return state.pokemonRuntime
}

function readNativeRtc(runtime: HgssSafariOpcodeRuntime): { timestampSeconds: number, ownerRtcOffset: number } {
  return {
    timestampSeconds: getHgssRtcTimestampSeconds(runtime.now()),
    ownerRtcOffset: runtime.ownerRtcOffset?.() ?? 0,
  }
}

export type HgssSafariFieldAppRuntime = HgssSafariRunnerControls & {
  isAwaitingInput: () => boolean
  launchCustomizer: () => Extract<HgssSafariFieldStep, { kind: 'safariCustomizer' }>
  launchDecorator: (destination: number) => Extract<HgssSafariFieldStep, { kind: 'safariDecorator' }>
}

export function createHgssSafariFieldAppRuntime(
  map: OpeningMapPreview,
  state: HgssSafariFieldOpcodeState,
): HgssSafariFieldAppRuntime {
  let customizer: { dirty: boolean } | undefined
  let decorator: { destination: number, candidates: readonly HgssSafariDecoratorCandidate[] } | undefined
  return {
    isAwaitingInput: () => customizer !== undefined || decorator !== undefined,
    launchCustomizer() {
      if (customizer || decorator) throw new Error('Une application Safari HGSS est déjà active.')
      customizer = { dirty: false }
      return createHgssSafariCustomizerStep(state.safariZone)
    },
    submitSafariCustomizerChange(change: HgssSafariCustomizerChange) {
      if (!customizer) throw new Error('Le customizer Safari HGSS n’est pas actif.')
      state.safariZone = applyHgssSafariCustomizerChange(state.safariZone, change)
      customizer.dirty = true
    },
    closeSafariCustomizer() {
      if (!customizer) throw new Error('Le customizer Safari HGSS n’est pas actif.')
      if (customizer.dirty) state.flags.add(HGSS_SAFARI_CUSTOMIZER_CHANGED_FLAG)
      else state.flags.delete(HGSS_SAFARI_CUSTOMIZER_CHANGED_FLAG)
      customizer = undefined
    },
    launchDecorator(destination: number) {
      if (customizer || decorator) throw new Error('Une application Safari HGSS est déjà active.')
      const step = createHgssSafariDecoratorStep(map, state.safariZone, playerPosition(state), requireRuntime(state).trainer.id)
      decorator = { destination, candidates: step.candidates }
      return step
    },
    submitSafariDecoratorSelection(objectId: number | undefined) {
      if (!decorator) throw new Error('Le décorateur Safari HGSS n’est pas actif.')
      const result = applyHgssSafariDecoratorSelection(
        state.safariZone,
        playerPosition(state),
        decorator.candidates,
        objectId,
      )
      if (result.unavailableReason !== undefined) return
      state.safariZone = result.state
      state.variables.set(decorator.destination, result.result!)
      decorator = undefined
    },
  }
}

export type HgssSafariImmediateOpcode = 718 | 719 | 720 | 721 | 823 | 824

export function runHgssSafariImmediateOpcode(
  opcode: HgssSafariImmediateOpcode,
  map: OpeningMapPreview,
  state: HgssSafariFieldOpcodeState,
  bytes: Uint8Array,
  cursor: number,
): number {
  if (opcode === 718) {
    requireBytes(bytes, cursor, 3, opcode)
    state.buffers.set(bytes[cursor]!, getHgssSafariObjectName(map.externalMessages?.[430], readScriptValue(state, bytes, cursor + 1) & 0xff))
    return cursor + 3
  }
  if (opcode === 719) {
    requireBytes(bytes, cursor, 4, opcode)
    const found = findHgssSafariObjectInFront(state.safariZone, playerPosition(state))
    state.variables.set(readHalfword(bytes, cursor), found.objectId)
    state.variables.set(readHalfword(bytes, cursor + 2), found.placementIndex)
    return cursor + 4
  }
  if (opcode === 720) {
    requireBytes(bytes, cursor, 2, opcode)
    state.safariZone = removeHgssSafariObjectInFrontByIndex(state.safariZone, playerPosition(state), readScriptValue(state, bytes, cursor) & 0xff)
    return cursor + 2
  }
  if (opcode === 721) {
    requireBytes(bytes, cursor, 2, opcode)
    state.variables.set(readHalfword(bytes, cursor), getHgssSafariDecoratorEligibility(
      map, state.safariZone, playerPosition(state), requireRuntime(state).trainer.id,
    ))
    return cursor + 2
  }
  if (opcode === 823) {
    requireBytes(bytes, cursor, 2, opcode)
    state.buffers.set(state.variables.get(readHalfword(bytes, cursor)) ?? 0, state.safariZone.linkLeader.name)
    return cursor + 2
  }
  requireBytes(bytes, cursor, 2, opcode)
  const rtc = readNativeRtc(requireRuntime(state))
  state.safariZone = deactivateHgssSafariLinkIfExpired(
    state.safariZone,
    rtc.timestampSeconds,
    rtc.ownerRtcOffset,
  )
  state.variables.set(readHalfword(bytes, cursor), state.safariZone.linkLeader.linked ? 1 : 0)
  return cursor + 2
}

type MultiplayerRequestBase = Pick<
  Extract<HgssMultiplayerRequest, { kind: 'profile-status' }>,
  'protocolVersion' | 'requestId' | 'romOpcode' | 'player'
>

export function createHgssSafariAreaExchangeRequest(
  state: HgssSafariFieldOpcodeState,
  base: MultiplayerRequestBase,
): Extract<HgssMultiplayerRequest, { kind: 'safari-area-exchange' }> {
  const runtime = requireRuntime(state)
  return {
    ...base,
    kind: 'safari-area-exchange',
    areaSet: cloneHgssSafariState(state.safariZone).areaSets[0],
    language: runtime.language,
    gameVersion: runtime.gameVersion,
  }
}

export function applyHgssSafariAreaExchangeResult(
  state: HgssSafariFieldOpcodeState,
  result: HgssMultiplayerResult,
): void {
  if (result.status !== 'completed') return
  if (!result.safariAreaSet || !result.safariPlayer) throw new Error('La réponse du set Safari lié est incomplète.')
  const rtc = readNativeRtc(requireRuntime(state))
  state.safariZone = receiveHgssSafariLinkedAreaSet(
    state.safariZone,
    result.safariAreaSet,
    {
      trainerId: result.safariPlayer.trainerId,
      name: result.safariPlayer.name,
      gender: result.safariPlayer.gender,
      language: result.safariPlayer.language,
      gameVersion: result.safariPlayer.gameVersion,
    },
    rtc.timestampSeconds,
    rtc.ownerRtcOffset,
  )
}
