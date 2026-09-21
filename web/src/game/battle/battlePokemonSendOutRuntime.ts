import type { NitroGraphic } from '../../ndsTypes'
import type { HgssBattleBallSpriteAsset } from '../../rom/battle/battleBallSprites'
import {
  playHgssBattlePokemonSendOut,
  type HgssBattlePokemonSendOutEntry,
  type HgssBattlePokemonSendOutMode,
  type HgssBattlePokemonSendOutRun,
  type HgssBattleSendOutSide,
} from './battlePokemonSendOutPlayback'

export type BattlePokemonSendOutRuntimeEntry = Omit<HgssBattlePokemonSendOutEntry, 'host'>

export type BattlePokemonSendOutRuntimeResources = Readonly<{
  ballSpriteResolver: (ballId: number) => HgssBattleBallSpriteAsset | undefined
  createGraphic: (graphic: NitroGraphic) => HTMLElement
  playSoundEffect?: (sequenceId: number) => void | Promise<void>
}>

export type BattlePokemonSendOutRuntimeCryEntry = Readonly<{
  speciesId: number
  side: HgssBattleSendOutSide
  slot: number
}>

export type BattlePokemonSendOutRuntimeOptions = Readonly<{
  readStage: () => HTMLElement | null | undefined
  readResources: () => BattlePokemonSendOutRuntimeResources | undefined
  readBallHost: (side: HgssBattleSendOutSide) => HTMLElement | null | undefined
  playCry?: (speciesId: number, side: HgssBattleSendOutSide, slot: number) => void | Promise<void>
  playCrySequence?: (
    speciesIds: readonly number[],
    entries: readonly BattlePokemonSendOutRuntimeCryEntry[],
    isCurrent: () => boolean,
  ) => void | Promise<void>
  reducedMotion?: () => boolean
  readGeneration: () => number
  isCurrent?: (generation: number) => boolean
  register: (run: HgssBattlePokemonSendOutRun) => void
}>

export type BattlePokemonSendOutRuntimePlayOptions = Readonly<{
  mode?: HgssBattlePokemonSendOutMode
  /** Host déjà positionné par la capture, réservé au mode release-only. */
  host?: HTMLElement | null
  completionWindowFrames?: number
}>

export type BattlePokemonSendOutRuntime = Readonly<{
  play: (
    entries: readonly BattlePokemonSendOutRuntimeEntry[],
    options?: BattlePokemonSendOutRuntimePlayOptions,
  ) => HgssBattlePokemonSendOutRun | undefined
}>

/**
 * Fige les ressources et la génération au début d'une sortie. Le host par côté
 * reste seulement un modèle : le lecteur en clone une Ball par slot en double.
 */
export function createBattlePokemonSendOutRuntime(
  runtime: BattlePokemonSendOutRuntimeOptions,
): BattlePokemonSendOutRuntime {
  return {
    play(entries, options = {}) {
      if (entries.length === 0) return undefined
      const mode = options.mode ?? 'throw'
      if (mode === 'release-only' && entries.length !== 1) return undefined

      const generation = runtime.readGeneration()
      const stage = runtime.readStage()
      const resources = runtime.readResources()
      if (!stage || !resources
        || typeof resources.ballSpriteResolver !== 'function'
        || typeof resources.createGraphic !== 'function') return undefined

      const hosts = new Map<HgssBattleSendOutSide, HTMLElement>()
      const resolveHost = (side: HgssBattleSendOutSide): HTMLElement | undefined => {
        if (mode === 'release-only' && options.host) return options.host
        const cached = hosts.get(side)
        if (cached) return cached
        const host = runtime.readBallHost(side)
        if (!host) return undefined
        hosts.set(side, host)
        return host
      }
      const playbackEntries: HgssBattlePokemonSendOutEntry[] = []
      for (const entry of entries) {
        const host = resolveHost(entry.side)
        if (!host) return undefined
        playbackEntries.push({ ...entry, host })
      }

      const isCurrent = () => runtime.isCurrent
        ? runtime.isCurrent(generation)
        : Object.is(runtime.readGeneration(), generation)
      if (!isCurrent()) return undefined

      const run = playHgssBattlePokemonSendOut({
        mode,
        entries: playbackEntries,
        stage,
        ballSpriteResolver: resources.ballSpriteResolver,
        createGraphic: resources.createGraphic,
        playSoundEffect: resources.playSoundEffect,
        playCry: runtime.playCry
          ? (pokemon, side, slot) => runtime.playCry!(pokemon.speciesId, side, slot)
          : undefined,
        playCrySequence: runtime.playCrySequence
          ? (entries) => runtime.playCrySequence!(
            entries.map(({ pokemon }) => pokemon.speciesId),
            entries.map(({ pokemon, side, slot }) => ({ speciesId: pokemon.speciesId, side, slot })),
            isCurrent,
          )
          : undefined,
        completionWindowFrames: options.completionWindowFrames,
        reducedMotion: runtime.reducedMotion?.() ?? false,
        isCurrent,
      })
      try {
        runtime.register(run)
      } catch (error) {
        run.cancel()
        throw error
      }
      return run
    },
  }
}
