import type { GameDigitalAction } from '../../gameInput'
import { startRomAudioPresentation } from '../../audio/romAudioPresentation'
import { hgssVBlankDurationMs } from '../time/hgssFrameTiming'
import type { NitroGraphic, PokemonCatalog, RomInventory } from '../../ndsTypes'
import { createHgssSingleScreenBattleBackdrop } from '../../rom/battle/battleBackgrounds'
import { hgssBattleAudioSequences } from '../battle/hgssBattleAudio'
import {
  baseBattleActionPolicy,
  composeBattleActionPolicies,
  type BattleActionPolicy,
  type BattleActionVeto,
} from '../battle/battleActionPolicy'
import { fadeHgssCapturedBall, resetHgssBattleBallPresentation } from '../battle/battleCapturePlayback'
import { restartBattleCssAnimation } from '../battle/battleCssAnimation'
import { bindBattlePokemonSpritePresentation, getBattlePokemonSpriteFrame, resetBattlePokemonSpritePresentation } from '../battle/battlePokemonSpritePresentation'
import { resetBattleScenePresentation } from '../battle/battleScenePresentation'
import type { HgssBattleAnimationPlaybackAudio } from '../battle/battleAnimationPlayback'
import { createHgssBattleSpriteEffectPlayback } from '../battle/battleSpriteEffectPlayback'
import type { HgssBattleMessagePrinterControl } from '../battle/hgssBattleMessagePrinter'
import { playHgssBattleThrowSprite } from '../battle/battleThrowPlayback'
import type { BattlePokemonSprite } from '../../rom/pokemon/battlePokemonSprites'
import type { HgssSafariEncounterMethod } from '../../rom/safari/safariEncounterData'
import { resolveHgssWildBattleMusic } from '../battle/hgssBattleMusic'
import { cloneCanonicalPokemon, type CanonicalPokemon, type PokemonTrainerIdentity } from '../pokemon/canonicalPokemon'
import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import { hasHgssPokemonNicknameInput, setPokemonNickname } from '../pokemon/pokemonNickname'
import type { PokemonParty } from '../pokemon/pokemonParty'
import type { PokemonStorage, PokemonStoragePlacement } from '../pokemon/pokemonStorage'
import {
  assertPreparedPokemonAcquisitionAvailable,
  commitPreparedPokemonAcquisition,
  hasPokemonAcquisitionCapacity,
  preparePokemonAcquisition,
  type PokemonAcquisitionPlan,
} from '../pokemon/pokemonAcquisition'
import type { PokemonTeamPolicy } from '../pokemon/pokemonTeamPolicy'
import { markPokemonSeen, type HgssPokedexState } from '../pokedex/hgssPokedex'
import { createSafariBattleController, type SafariBattleController, type SafariBattleElements } from '../ui/safariBattleController'
import { formatHgssRomMessage } from '../ui/romMessageFormatting'
import { createCanonicalWildPokemon, hasWildHeldItemCompoundEyesInfluence } from '../encounters/wildPokemonGeneration'
import type { PreparedSafariWildEncounter } from '../encounters/wildEncounterSelection'
import { sampleHgssBattlePokemonAnimation } from '../../rom/pokemon/battlePokemonSprites'
import { createHgssSafariBattleState, hgssSafariBallItemId, type HgssSafariBattleAction, type HgssSafariBattleOutcome, type HgssSafariBattleState } from './hgssSafariBattle'
import type { HgssSafariBattlePresentationEntry } from './hgssSafariBattleFlow'
import { generateHgssSafariFieldEncounter, resolveHgssSafariEncounterTimeByHour } from './hgssSafariEncounters'
import { HGSS_SAFARI_MAP_ID, resolveHgssSafariAreaCellAtWorldPosition } from './hgssSafariMap'
import { HGSS_SAFARI_MAP_SECTION_ID } from './hgssSafariProgression'
import type { HgssSafariState } from './hgssSafariState'
import type { HgssWildCapturePreparation } from '../encounters/hgssWildCaptureFinalizer'
import { playHgssSafariReactionAnimation } from './hgssSafariBattleAnimation'
import { createHgssSafariPostBattleFinalizer } from './hgssSafariPostBattle'

/** Alias historique : les captures et l'opcode 791 partagent la même section ROM. */
export { HGSS_SAFARI_MAP_SECTION_ID as HGSS_SAFARI_MET_LOCATION }
export const HGSS_SAFARI_BALLS_OUT_SCRIPT_ID = 8803 as const
export const HGSS_SAFARI_STORAGE_FULL_SCRIPT_ID = 8804 as const
export const HGSS_SAFARI_REENTRY_SCRIPT_ID = 8805 as const
export const HGSS_SAFARI_EXIT_SCRIPT_ID = 8806 as const
export const HGSS_SYS_MET_BILL_FLAG_ID = 0x976 as const

type SafariInventory = Pick<
  RomInventory,
  | 'battleBackgroundResolver'
  | 'battleAnimationCatalog'
  | 'battleMessages'
  | 'battlePokemonSpriteResolver'
  | 'itemCatalog'
  | 'pokemonCatalog'
  | 'safariEncounterCatalog'
  | 'storageBoxNames'
>

export type HgssSafariRuntimeWorld = {
  mapId: number
  tileX: number
  tileZ: number
  battleBackgroundId: number
  battleTerrainId: number
  region: number
  hour: number
  battlePaletteTime: Parameters<RomInventory['battleBackgroundResolver']>[0]['timeOfDay']
}

export type HgssSafariRuntimeContext = {
  inventory: SafariInventory
  safariZone: HgssSafariState
  party: PokemonParty
  pokemonStorage: PokemonStorage
  pokedex: HgssPokedexState
  eventFlags: ReadonlySet<number>
  progression: {
    recordEncounterStarted: () => void
    recordOpponentFled: () => void
    prepareCapture: (pokemon: CanonicalPokemon) => HgssWildCapturePreparation
    commitCaptureBeforeStorage: (preparation: HgssWildCapturePreparation, nickname?: string) => void
    completeCaptureAfterBattle: (preparation: HgssWildCapturePreparation) => void
  }
  pokemonRuntime: {
    catalog: PokemonCatalog
    rng: HgssLcrng
    trainer: PokemonTrainerIdentity
    language: number
    gameVersion: number
  }
  playerName: string
  world: HgssSafariRuntimeWorld
  teamPolicy?: PokemonTeamPolicy
}

export type HgssSafariEncounterAtRequest = Readonly<{
  method: 'land' | 'surf'
  /** Coordonnees absolues dans la matrice Safari, et non dans le terrain compose. */
  worldTileX: number
  worldTileZ: number
  /** Heure figee par la cle visible afin qu'un rechargement ne change pas la table. */
  hour: number
  /** RNG isole appartenant au peuplement visible, jamais celui de la partie. */
  rng: HgssLcrng
  repelLeadLevel?: number
  isSweetScent?: boolean
}>

export type HgssSafariNicknameStorageMessage = {
  template: string
  previousBoxName: string
  destinationBoxName: string
  movedToDifferentBox: boolean
}

export type HgssSafariBattleRuntimeElements = SafariBattleElements & {
  background: HTMLElement
  opponentTrainer: HTMLElement
  opponentSprite: HTMLElement
  playerSprite: HTMLElement
  opponentParty: HTMLElement
  playerParty: HTMLElement
}

export type HgssSafariBattleFinish = {
  outcome: HgssSafariBattleOutcome
  opponent: CanonicalPokemon
  exitScriptId?: typeof HGSS_SAFARI_BALLS_OUT_SCRIPT_ID | typeof HGSS_SAFARI_STORAGE_FULL_SCRIPT_ID | typeof HGSS_SAFARI_REENTRY_SCRIPT_ID
  /** Le dernier lancer rate retourne au warp dynamique avant le script 8805. */
  returnToDynamicWarp?: true
}

export type HgssSafariExitRoute = Pick<HgssSafariBattleFinish, 'exitScriptId' | 'returnToDynamicWarp'>

export type HgssSafariCaptureCommit = {
  pokemon: CanonicalPokemon
  alreadyCaught: boolean
  joinedParty: boolean
  storagePlacement?: PokemonStoragePlacement
  presentation: HgssSafariBattlePresentationEntry[]
}

export type HgssSafariPendingCapture = Pick<HgssSafariCaptureCommit, 'pokemon' | 'alreadyCaught' | 'presentation'> & {
  progression?: HgssWildCapturePreparation
  acquisitionPlan: PokemonAcquisitionPlan
}

export type HgssSafariCaptureBlockedResult = Readonly<{
  kind: 'blocked' | 'full'
  code: string
  reason: string
}>

export class HgssSafariCaptureBlockedError extends Error {
  readonly result: HgssSafariCaptureBlockedResult

  constructor(result: HgssSafariCaptureBlockedResult) {
    super(result.reason)
    this.name = 'HgssSafariCaptureBlockedError'
    this.result = result
  }
}

export type HgssSafariRuntimeCoordinator = {
  prepareEncounter: (method: HgssSafariEncounterMethod, repelLeadLevel?: number, isSweetScent?: boolean) => PreparedSafariWildEncounter | undefined
  prepareEncounterAt: (request: HgssSafariEncounterAtRequest) => PreparedSafariWildEncounter | undefined
  materializeEncounter: (encounter: PreparedSafariWildEncounter) => CanonicalPokemon
  start: (encounter: PreparedSafariWildEncounter, vblank: number, preparedOpponent?: CanonicalPokemon) => CanonicalPokemon
  handle: (action: GameDigitalAction, pressed?: boolean) => boolean
  isActive: () => boolean
  tick: (vblank: number) => void
  close: () => void
}

export type HgssSafariRuntimeOptions = {
  readContext: () => HgssSafariRuntimeContext | undefined
  createGraphicCanvas: (graphic: NitroGraphic) => HTMLCanvasElement
  mountGraphicCanvas: (host: Element, graphic: NitroGraphic) => HTMLCanvasElement
  playMusic?: (sequenceId: number) => void | Promise<void>
  playSoundEffect?: (sequenceId: number) => void | Promise<void>
  playPannedSoundEffect?: (sequenceId: number, pan: number) => void | Promise<void>
  stopSoundEffect?: (sequenceId: number) => void
  isAnySoundEffectPlaying?: () => boolean
  playFanfare?: (sequenceId: number) => void | Promise<void>
  isFanfarePlaying?: () => boolean
  playCry?: (speciesId: number, pattern: number, pan?: number, volume?: number) => void | Promise<void>
  isCryPlaying?: () => boolean
  playCaptureAnimation?: (itemId: number, shakes: 0 | 1 | 2 | 3 | 4, caught: boolean) => void | Promise<void>
  getTextFrameDelay?: () => 1 | 4 | 8
  presentPokedexRegistration: (pokemon: CanonicalPokemon) => Promise<void>
  requestNickname: (pokemon: CanonicalPokemon, prompt: string, storageMessage?: HgssSafariNicknameStorageMessage) => Promise<string | undefined>
  actionPolicy?: BattleActionPolicy
  onActionVeto?: (veto: BattleActionVeto, action: HgssSafariBattleAction, state: HgssSafariBattleState) => void
  onStart?: () => void
  onFastForward?: () => boolean
  onPresentationReset?: () => void
  onPhaseChange?: (phase: 'message' | 'command') => void
  onFinish: (finish: HgssSafariBattleFinish) => void
}

export function resolveHgssSafariExitScript(
  outcome: HgssSafariBattleOutcome,
  ballsRemaining: number,
  hasCaptureCapacity: boolean,
): HgssSafariBattleFinish['exitScriptId'] {
  if (ballsRemaining === 0) {
    return outcome === 'caught' ? HGSS_SAFARI_BALLS_OUT_SCRIPT_ID : HGSS_SAFARI_REENTRY_SCRIPT_ID
  }
  if (ballsRemaining > 0 && !hasCaptureCapacity) return HGSS_SAFARI_STORAGE_FULL_SCRIPT_ID
  return undefined
}

/** Route les cases 3/4/7 de Task_SafariEncounter sans confondre ses deux retours a l'entree. */
export function resolveHgssSafariExitRoute(
  outcome: HgssSafariBattleOutcome,
  ballsRemaining: number,
  hasCaptureCapacity: boolean,
): HgssSafariExitRoute {
  const exitScriptId = resolveHgssSafariExitScript(outcome, ballsRemaining, hasCaptureCapacity)
  if (exitScriptId === undefined) return {}
  if (exitScriptId === HGSS_SAFARI_REENTRY_SCRIPT_ID) return { exitScriptId, returnToDynamicWarp: true }
  return { exitScriptId }
}

function hasHgssSafariCaptureCapacity(
  context: Pick<HgssSafariRuntimeContext, 'party' | 'pokemonStorage'>,
): boolean {
  return hasPokemonAcquisitionCapacity(context.party, context.pokemonStorage)
}

function requireContext(context: HgssSafariRuntimeContext | undefined): HgssSafariRuntimeContext {
  if (!context) throw new Error('Le contexte ROM du combat Safari est absent.')
  if (context.world.mapId !== HGSS_SAFARI_MAP_ID || !context.safariZone.session.active) {
    throw new Error('Une rencontre Safari ne peut commencer hors de la session HGSS active.')
  }
  return context
}

function requireRomText(messages: Readonly<Record<number, string | undefined>>, messageId: number, label: string): string {
  const value = messages[messageId]
  if (!value) throw new Error(`${label} ${messageId} est absent de la ROM.`)
  return value
}

function pokemonName(pokemon: CanonicalPokemon): string {
  return pokemon.nickname ?? pokemon.speciesName
}

export function prepareHgssSafariRuntimeEncounter(
  context: HgssSafariRuntimeContext,
  method: HgssSafariEncounterMethod,
  repelLeadLevel?: number,
  isSweetScent = false,
): PreparedSafariWildEncounter | undefined {
  if (!context.safariZone.session.active || context.world.mapId !== HGSS_SAFARI_MAP_ID) return undefined
  const areaSet = context.safariZone.areaSets[context.safariZone.activeAreaSet]
  const area = resolveHgssSafariAreaCellAtWorldPosition(areaSet, context.world.tileX, context.world.tileZ)
  const lead = context.party.members[0]
  if (!area || !lead) return undefined
  const generated = generateHgssSafariFieldEncounter(
    context.inventory.safariEncounterCatalog,
    areaSet,
    area.areaSlot,
    method,
    resolveHgssSafariEncounterTimeByHour(context.world.hour),
    {
      rng: context.pokemonRuntime.rng,
      pokemonCatalog: context.inventory.pokemonCatalog,
      lead: { abilityId: lead.abilityId, isEgg: lead.isEgg, level: lead.level },
      repelLeadLevel,
      isSweetScent,
    },
  )
  return generated.encounter && { ...generated.encounter, method: 'safari', safariMethod: generated.encounter.method }
}

/**
 * Variante pure de peuplement : elle remplace seulement position, heure et RNG
 * dans une copie du contexte. Le monde et le LCRNG normaux restent intacts.
 */
export function prepareHgssSafariRuntimeEncounterAt(
  context: HgssSafariRuntimeContext,
  request: HgssSafariEncounterAtRequest,
): PreparedSafariWildEncounter | undefined {
  if (request.method !== 'land' && request.method !== 'surf') {
    throw new Error(`La methode Safari visible ${String(request.method)} est invalide.`)
  }
  if (!Number.isSafeInteger(request.worldTileX) || !Number.isSafeInteger(request.worldTileZ)) {
    throw new Error('Les coordonnees monde de la rencontre Safari visible sont invalides.')
  }
  if (!Number.isInteger(request.hour) || request.hour < 0 || request.hour > 23) {
    throw new Error("L'heure de la rencontre Safari visible est invalide.")
  }
  if (!request.rng || typeof request.rng.getSeed !== 'function' || typeof request.rng.nextU16 !== 'function') {
    throw new Error('Le RNG isole de la rencontre Safari visible est invalide.')
  }
  const positionedContext: HgssSafariRuntimeContext = {
    ...context,
    pokemonRuntime: { ...context.pokemonRuntime, rng: request.rng },
    world: {
      ...context.world,
      tileX: request.worldTileX,
      tileZ: request.worldTileZ,
      hour: request.hour,
    },
  }
  return prepareHgssSafariRuntimeEncounter(
    positionedContext,
    request.method,
    request.repelLeadLevel,
    request.isSweetScent,
  )
}

export function createHgssSafariRuntimePokemon(
  encounter: PreparedSafariWildEncounter,
  context: Pick<HgssSafariRuntimeContext, 'party' | 'pokemonRuntime' | 'world'>,
): CanonicalPokemon {
  const lead = context.party.members[0]
  return createCanonicalWildPokemon({
    speciesId: encounter.speciesId,
    level: encounter.level,
    catalog: context.pokemonRuntime.catalog,
    rng: context.pokemonRuntime.rng,
    originalTrainer: context.pokemonRuntime.trainer,
    origin: {
      language: context.pokemonRuntime.language,
      gameVersion: context.pokemonRuntime.gameVersion,
      metLocation: HGSS_SAFARI_MAP_SECTION_ID,
      metLevel: encounter.level,
      metTerrain: context.world.battleTerrainId,
    },
    leadPokemon: lead,
    compoundEyes: hasWildHeldItemCompoundEyesInfluence(lead),
    forceOnePerfectIv: true,
  })
}

export function prepareHgssSafariCapture(
  context: Pick<HgssSafariRuntimeContext, 'inventory' | 'party' | 'pokedex' | 'pokemonRuntime' | 'pokemonStorage' | 'progression' | 'teamPolicy'>,
  opponent: CanonicalPokemon,
): HgssSafariPendingCapture {
  const pokemon = cloneCanonicalPokemon(opponent)
  pokemon.ballId = hgssSafariBallItemId
  const alreadyCaught = context.pokedex.caughtSpeciesIds.has(pokemon.speciesId)
  const presentation: HgssSafariBattlePresentationEntry[] = []
  if (!alreadyCaught) {
    requireRomText(context.inventory.battleMessages, 871, 'Le message Pokédex Safari')
    presentation.push({ messageId: 871, values: [pokemonName(pokemon)], advance: 'automatic', minimumFrames: 30 })
  }
  const acquisitionPlan = preparePokemonAcquisition(
    context.party,
    context.pokemonStorage,
    pokemon,
    { reason: 'capture' },
    context.teamPolicy,
  )
  return { pokemon, alreadyCaught, presentation, acquisitionPlan }
}

export function getHgssSafariCaptureBlock(pending: HgssSafariPendingCapture): HgssSafariCaptureBlockedResult | undefined {
  if (pending.acquisitionPlan.kind === 'blocked') return pending.acquisitionPlan
  return pending.acquisitionPlan.kind === 'full'
    ? { kind: 'full', code: 'storage-full', reason: 'L’équipe et le PC sont pleins.' }
    : undefined
}

/**
 * Compose d'abord les règles externes, puis la réservation équipe/PC. Seul un
 * veto d'équipe sans repli PC bloque avant la Ball : le plein natif continue
 * vers `CheckSafariGameDone`, qui débite la Ball avant `storage-full`.
 */
export function createHgssSafariTransactionalActionPolicy(
  context: Parameters<typeof prepareHgssSafariCapture>[0],
  opponent: CanonicalPokemon,
  externalPolicy: BattleActionPolicy = baseBattleActionPolicy,
): BattleActionPolicy {
  const acquisitionPolicy: BattleActionPolicy = Object.freeze({
    vetoPlayerAction(intent) {
      if (intent.kind !== 'safari' || intent.action !== 'ball') return undefined
      const block = getHgssSafariCaptureBlock(prepareHgssSafariCapture(context, opponent))
      return block?.kind === 'blocked' ? Object.freeze({ code: block.code, reason: block.reason }) : undefined
    },
  })
  return composeBattleActionPolicies([externalPolicy, acquisitionPolicy])
}

function requireHgssSafariAcquisitionPlan(
  pending: HgssSafariPendingCapture,
): Exclude<PokemonAcquisitionPlan, { kind: 'blocked' | 'full' }> {
  const blocked = getHgssSafariCaptureBlock(pending)
  if (blocked) throw new HgssSafariCaptureBlockedError(blocked)
  return pending.acquisitionPlan as Exclude<PokemonAcquisitionPlan, { kind: 'blocked' | 'full' }>
}

/** `ov12_0223BB44`, appelé au moment précis où le printer du message 871 naît. */
export function beginHgssSafariCaptureRegistration(
  context: Pick<HgssSafariRuntimeContext, 'progression'>,
  pending: HgssSafariPendingCapture,
): HgssWildCapturePreparation {
  requireHgssSafariAcquisitionPlan(pending)
  pending.progression ??= context.progression.prepareCapture(pending.pokemon)
  return pending.progression
}

export function resolveHgssSafariStorageMessageId(
  movedToDifferentBox: boolean,
  eventFlags: ReadonlySet<number>,
): 1174 | 1175 | 1176 | 1177 {
  const baseMessageId = movedToDifferentBox ? 1176 : 1174
  return (baseMessageId + Number(eventFlags.has(HGSS_SYS_MET_BILL_FLAG_ID))) as 1174 | 1175 | 1176 | 1177
}

export function finalizeHgssSafariCapture(
  context: Pick<HgssSafariRuntimeContext, 'eventFlags' | 'inventory' | 'party' | 'pokedex' | 'pokemonRuntime' | 'pokemonStorage' | 'progression'>,
  pending: HgssSafariPendingCapture,
  nickname?: string,
): HgssSafariCaptureCommit {
  const { pokemon, alreadyCaught } = pending
  if (hasHgssPokemonNicknameInput(nickname)) setPokemonNickname(pokemon, nickname)
  const acquisitionPlan = requireHgssSafariAcquisitionPlan(pending)
  assertPreparedPokemonAcquisitionAvailable(context.party, context.pokemonStorage, acquisitionPlan)
  const progression = beginHgssSafariCaptureRegistration(context, pending)
  context.progression.commitCaptureBeforeStorage(progression, nickname)
  const acquisition = commitPreparedPokemonAcquisition(context.party, context.pokemonStorage, pokemon, acquisitionPlan)
  if (acquisition.kind === 'full' || acquisition.kind === 'blocked') throw new Error('La capture Safari a perdu son emplacement réservé.')
  const joinedParty = acquisition.kind === 'party'
  const storagePlacement = acquisition.kind === 'storage' ? acquisition.placement : undefined

  const presentation: HgssSafariBattlePresentationEntry[] = []
  if (storagePlacement) {
    const previousName = context.inventory.storageBoxNames[storagePlacement.previousBox]
    const destinationName = context.inventory.storageBoxNames[storagePlacement.box]
    if (!previousName || !destinationName) throw new Error('Le nom ROM de la Boîte Safari est absent.')
    const messageId = resolveHgssSafariStorageMessageId(
      storagePlacement.previousBox !== storagePlacement.box,
      context.eventFlags,
    )
    requireRomText(context.inventory.battleMessages, messageId, 'Le message de transfert Safari')
    presentation.push({
      messageId,
      values: storagePlacement.previousBox === storagePlacement.box
        ? [pokemonName(pokemon), destinationName]
        : [previousName, pokemonName(pokemon), destinationName],
      advance: 'automatic',
      minimumFrames: 30,
    })
  }
  return { pokemon, alreadyCaught, joinedParty, storagePlacement, presentation }
}

export function commitHgssSafariCapture(
  context: Pick<HgssSafariRuntimeContext, 'eventFlags' | 'inventory' | 'party' | 'pokedex' | 'pokemonRuntime' | 'pokemonStorage' | 'progression' | 'teamPolicy'>,
  opponent: CanonicalPokemon,
  nickname?: string,
): HgssSafariCaptureCommit {
  const pending = prepareHgssSafariCapture(context, opponent)
  const progression = beginHgssSafariCaptureRegistration(context, pending)
  const committed = finalizeHgssSafariCapture(context, pending, nickname)
  context.progression.completeCaptureAfterBattle(progression)
  return { ...committed, presentation: [...pending.presentation, ...committed.presentation] }
}

export async function completeHgssSafariCaptureSequence(
  context: Pick<HgssSafariRuntimeContext, 'eventFlags' | 'inventory' | 'party' | 'pokedex' | 'pokemonRuntime' | 'pokemonStorage' | 'progression'>,
  pending: HgssSafariPendingCapture,
  nicknamePrompt: string,
  callbacks: Pick<HgssSafariRuntimeOptions, 'presentPokedexRegistration' | 'requestNickname'> & { isCurrent?: () => boolean },
): Promise<HgssSafariCaptureCommit> {
  const ensureCurrent = (): void => {
    if (callbacks.isCurrent?.() === false) throw new DOMException('Capture Safari remplacée.', 'AbortError')
  }
  ensureCurrent()
  beginHgssSafariCaptureRegistration(context, pending)
  if (!pending.alreadyCaught) await callbacks.presentPokedexRegistration(pending.pokemon)
  ensureCurrent()
  const destination = requireHgssSafariAcquisitionPlan(pending)
  const storageMessage = destination.kind === 'storage' ? (() => {
    const previousBoxName = context.inventory.storageBoxNames[destination.previousBox]
    const destinationBoxName = context.inventory.storageBoxNames[destination.box]
    if (!previousBoxName || !destinationBoxName) throw new Error('Le nom ROM de la Boîte Safari est absent.')
    const movedToDifferentBox = destination.previousBox !== destination.box
    const messageId = resolveHgssSafariStorageMessageId(movedToDifferentBox, context.eventFlags)
    return { template: requireRomText(context.inventory.battleMessages, messageId, 'Le message de transfert Safari'), previousBoxName, destinationBoxName, movedToDifferentBox }
  })() : undefined
  const nickname = await callbacks.requestNickname(pending.pokemon, nicknamePrompt, storageMessage)
  ensureCurrent()
  const committed = finalizeHgssSafariCapture(context, pending, nickname)
  // 1174–1177 est imprimé dans l'overlay de nom pour Oui comme pour Non : la
  // scène de combat ne doit jamais réapparaître pendant le retour au terrain.
  if (committed.storagePlacement) committed.presentation.length = 0
  return committed
}

async function restartAnimation(element: HTMLElement, className: string): Promise<void> {
  await restartBattleCssAnimation(element, className).finished
}

/** `BALL_ANIM_FADE` ne cible que la Ball capturée du joueur et bloque le script. */
export async function fadeHgssSafariCapturedBall(screen: HTMLElement, isCurrent?: () => boolean): Promise<void> {
  const ball = screen.querySelector<HTMLElement>('.battle-pokeball-player')
  if (!ball) throw new Error('La Safari Ball capturée du joueur est absente de la scène.')
  await fadeHgssCapturedBall({ ball, isCurrent })
}

export function createHgssSafariRuntimeCoordinator(
  elements: HgssSafariBattleRuntimeElements,
  options: HgssSafariRuntimeOptions,
): HgssSafariRuntimeCoordinator {
  const controller: SafariBattleController = createSafariBattleController(elements)
  let opponent: CanonicalPokemon | undefined
  let opponentSprite: BattlePokemonSprite | undefined
  let spriteStartedAtVblank = 0
  let spriteFrameIndex = -1
  let presentationRevision = 0
  let presentationAbort = new AbortController()
  const battleAnimationAudio: HgssBattleAnimationPlaybackAudio = {
    playSoundEffect: async (sequenceId) => { await options.playSoundEffect?.(sequenceId) },
    playPannedSoundEffect: async (sequenceId, pan) => { await (options.playPannedSoundEffect?.(sequenceId, pan) ?? options.playSoundEffect?.(sequenceId)) },
    stopSoundEffect: (sequenceId) => { options.stopSoundEffect?.(sequenceId) },
    playPokemonCry: async (side, modulation, pan, volume) => {
      if (side === 'opponent' && opponent) await options.playCry?.(opponent.speciesId, modulation, pan, volume)
    },
    isPokemonCryPlaying: () => options.isCryPlaying?.() ?? false,
  }

  const hideBattleScene = (): void => {
    presentationRevision += 1
    presentationAbort.abort()
    presentationAbort = new AbortController()
    controller.close()
    elements.screen.hidden = true
    elements.background.replaceChildren()
    elements.message.replaceChildren()
    elements.commands.replaceChildren()
    elements.moves.replaceChildren()
    elements.message.hidden = true
    elements.commands.hidden = true
    elements.moves.hidden = true
    elements.opponentTrainer.hidden = true
    elements.opponentTrainer.replaceChildren()
    resetBattlePokemonSpritePresentation(elements.opponentSprite, true)
    elements.opponentSprite.replaceChildren()
    elements.opponentSprite.style.removeProperty('--battle-sprite-height')
    delete elements.opponentSprite.dataset.shiny
    resetBattlePokemonSpritePresentation(elements.playerSprite, true)
    elements.playerSprite.replaceChildren()
    elements.opponentParty.hidden = true
    elements.playerParty.hidden = true
    elements.screen.querySelectorAll<HTMLElement>('.battle-hud').forEach((hud) => { hud.hidden = true })
    for (const ball of elements.screen.querySelectorAll<HTMLElement>('.battle-pokeball')) {
      resetHgssBattleBallPresentation(ball)
    }
    elements.screen.classList.remove('is-impact', 'is-heavy-impact', 'is-capture-success')
    delete elements.screen.dataset.presentation
    delete elements.screen.dataset.actionType
    delete elements.screen.dataset.terrain
    delete elements.screen.dataset.weather
    opponent = undefined
    opponentSprite = undefined
    spriteFrameIndex = -1
  }

  const prepareBattleScene = (context: HgssSafariRuntimeContext, pokemon: CanonicalPokemon, vblank: number): void => {
    resetBattleScenePresentation(elements.screen, { mode: 'start' })
    bindBattlePokemonSpritePresentation(elements.opponentSprite, pokemon, { force: true, hidden: true })
    resetBattlePokemonSpritePresentation(elements.playerSprite, true)
    const sprite = context.inventory.battlePokemonSpriteResolver({
      speciesId: pokemon.speciesId,
      form: pokemon.form,
      gender: pokemon.gender,
      facing: 'front',
      shiny: pokemon.shiny,
    })
    const backdrop = createHgssSingleScreenBattleBackdrop(context.inventory.battleBackgroundResolver({
      backgroundId: context.world.battleBackgroundId,
      timeOfDay: context.world.battlePaletteTime,
    }))
    options.mountGraphicCanvas(elements.background, backdrop)
    options.mountGraphicCanvas(getBattlePokemonSpriteFrame(elements.opponentSprite), sprite.frames[0]!)
    elements.opponentSprite.dataset.battlePokemonVisual = [pokemon.speciesId, pokemon.form, pokemon.gender, 'opponent', pokemon.shiny].join(':')
    elements.opponentSprite.style.setProperty('--battle-sprite-height', `${sprite.height}`)
    elements.opponentSprite.dataset.shiny = String(pokemon.shiny)
    elements.opponentSprite.hidden = true
    elements.playerSprite.hidden = true
    elements.opponentTrainer.hidden = true
    elements.opponentTrainer.replaceChildren()
    elements.opponentParty.hidden = true
    elements.playerParty.hidden = true
    elements.screen.querySelectorAll<HTMLElement>('.battle-hud').forEach((hud) => { hud.hidden = true })
    elements.screen.dataset.presentation = 'introduction'
    elements.screen.dataset.terrain = context.world.battleTerrainId === 7 ? 'water' : 'field'
    opponentSprite = sprite
    spriteStartedAtVblank = vblank
    spriteFrameIndex = 0
    startRomAudioPresentation(options.playMusic
      ? () => options.playMusic?.(resolveHgssWildBattleMusic(pokemon.speciesId, context.world.region))
      : undefined)
  }

  const presentAnimation = async (
    animation: NonNullable<HgssSafariBattlePresentationEntry['animation']>,
    revision: number,
    signal: AbortSignal,
  ): Promise<void> => {
    const isCurrent = () => revision === presentationRevision && !signal.aborted && Boolean(opponent)
    if (!isCurrent() || !opponent) return
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    if (animation.kind === 'encounter') {
      elements.opponentSprite.hidden = false
      await Promise.all([restartAnimation(elements.opponentSprite, 'is-arriving'), options.playCry?.(opponent.speciesId, opponent.form)])
      return
    }
    if (animation.kind === 'ball') {
      await options.playCaptureAnimation?.(hgssSafariBallItemId, animation.capture.shakes, animation.capture.caught)
    } else if (animation.kind === 'bait' || animation.kind === 'mud') {
      const context = requireContext(options.readContext())
      const stage = elements.screen.querySelector<HTMLElement>(':scope > .battle-stage')
      const effects = elements.screen.querySelector<HTMLCanvasElement>('.battle-effects')
      if (!stage || !effects) throw new Error("La couche d'animation globale du combat Safari est absente.")
      await playHgssBattleThrowSprite({
        stage,
        asset: context.inventory.battleAnimationCatalog.throwSpriteResolver(animation.kind === 'mud' ? 'safari-rock' : 'safari-bait'),
        createGraphic: options.createGraphicCanvas,
        playImpactSound: () => options.playSoundEffect?.(hgssBattleAudioSequences.throwSound),
        signal,
      })
      if (!isCurrent()) return
      await playHgssSafariReactionAnimation(
        context.inventory.battleAnimationCatalog,
        animation.kind,
        { player: elements.playerSprite, opponent: elements.opponentSprite, effects },
        battleAnimationAudio,
        createHgssBattleSpriteEffectPlayback(stage, context.inventory.battleAnimationCatalog.spriteResourceResolver, options.createGraphicCanvas),
        { signal },
      )
    } else if (animation.kind === 'opponentFled') {
      await elements.opponentSprite.animate([
        { opacity: 1, transform: 'translateX(0)' },
        { opacity: 0, transform: 'translateX(42%)' },
      ], { duration: reducedMotion ? 0 : 420, easing: 'steps(8, end)', fill: 'forwards' }).finished.catch(() => undefined)
      if (!isCurrent()) return
      elements.opponentSprite.hidden = true
    }
    if (!isCurrent()) return
    if (animation.kind === 'opponentFled' || animation.kind === 'exit') {
      elements.screen.dataset.presentation = 'exiting'
      await new Promise((resolve) => setTimeout(resolve, reducedMotion ? 0 : 620))
    }
  }

  const presentSceneCue = async (cue: import('./hgssSafariBattleFlow').HgssSafariBattleSceneCue, revision: number, signal: AbortSignal): Promise<void> => {
    const isCurrent = () => revision === presentationRevision && !signal.aborted && Boolean(opponent)
    if (!isCurrent() || !opponent) return
    if (cue === 'opponent-gauge') {
      const hud = elements.screen.querySelector<HTMLElement>('.battle-hud-opponent:not(.battle-hud-secondary)')
      const name = elements.screen.querySelector<HTMLElement>('#battle-opponent-name')
      const level = elements.screen.querySelector<HTMLElement>('#battle-opponent-level')
      const hp = elements.screen.querySelector<HTMLProgressElement>('#battle-opponent-hp')
      if (!hud || !name || !level || !hp) throw new Error('La jauge adverse globale du combat Safari est absente.')
      name.textContent = pokemonName(opponent)
      level.textContent = `N. ${opponent.level}`
      hp.max = opponent.stats.hp
      hp.value = opponent.currentHp
      hp.dataset.hpZone = opponent.currentHp * 2 <= opponent.stats.hp ? opponent.currentHp * 5 <= opponent.stats.hp ? 'low' : 'medium' : 'high'
      hud.dataset.gender = opponent.gender
      hud.querySelector<HTMLElement>('.battle-condition')!.hidden = true
      hud.querySelector<HTMLElement>('.battle-types')!.replaceChildren()
      hud.hidden = false
      await restartAnimation(hud, 'is-arriving')
      return
    }
    if (cue === 'capture-fade') {
      await fadeHgssSafariCapturedBall(elements.screen, isCurrent)
    }
  }

  const presentAudio = (entry: HgssSafariBattlePresentationEntry): void => {
    if (entry.audio?.kind === 'music') {
      startRomAudioPresentation(options.playMusic ? () => options.playMusic?.(entry.audio!.sequenceId) : undefined)
    } else if (entry.audio?.kind === 'sound') {
      startRomAudioPresentation(options.playSoundEffect ? () => options.playSoundEffect?.(entry.audio!.sequenceId) : undefined)
    }
  }

  const presentMessageControl = async (control: HgssBattleMessagePrinterControl): Promise<void> => {
    if (control.kind === 'play-fanfare') await options.playFanfare?.(control.sequenceId)
    else if (control.kind === 'play-sound') {
      startRomAudioPresentation(options.playSoundEffect
        ? () => options.playSoundEffect?.(control.sequenceId)
        : undefined)
    }
    else {
      const isPlaying = control.kind === 'wait-fanfare' ? options.isFanfarePlaying : options.isAnySoundEffectPlaying
      while (isPlaying?.()) await new Promise((resolve) => setTimeout(resolve, hgssVBlankDurationMs))
    }
  }

  return {
    prepareEncounter(method, repelLeadLevel, isSweetScent) {
      const context = options.readContext()
      return context ? prepareHgssSafariRuntimeEncounter(context, method, repelLeadLevel, isSweetScent) : undefined
    },
    prepareEncounterAt(request) {
      const context = options.readContext()
      return context ? prepareHgssSafariRuntimeEncounterAt(context, request) : undefined
    },
    materializeEncounter(encounter) {
      return createHgssSafariRuntimePokemon(encounter, requireContext(options.readContext()))
    },
    start(encounter, vblank, preparedOpponent) {
      if (controller.isActive()) throw new Error('Un combat Safari HGSS est déjà actif.')
      presentationAbort.abort()
      presentationAbort = new AbortController()
      const revision = ++presentationRevision
      const signal = presentationAbort.signal
      options.onStart?.()
      const context = requireContext(options.readContext())
      const finishPostBattle = createHgssSafariPostBattleFinalizer(context.party, context.pokemonRuntime.rng)
      if (preparedOpponent && (preparedOpponent.speciesId !== encounter.speciesId || preparedOpponent.level !== encounter.level)) {
        throw new Error('Le Pokémon Safari matérialisé ne correspond pas à la rencontre préparée.')
      }
      context.progression.recordEncounterStarted()
      opponent = preparedOpponent ?? createHgssSafariRuntimePokemon(encounter, context)
      markPokemonSeen(context.pokedex, opponent)
      prepareBattleScene(context, opponent, vblank)
      const safariBallName = context.inventory.itemCatalog.items[hgssSafariBallItemId]?.name
      if (!safariBallName) throw new Error('Le nom ROM de la Safari Ball est absent.')
      controller.start({
        state: createHgssSafariBattleState(opponent, context.safariZone.session.balls),
        context: {
          catalog: context.inventory.pokemonCatalog,
          rng: context.pokemonRuntime.rng,
          hasStorageSpace: hasHgssSafariCaptureCapacity(context),
        },
        names: { playerName: context.playerName, opponentName: pokemonName(opponent), safariBallName },
        messages: context.inventory.battleMessages,
        actionPolicy: createHgssSafariTransactionalActionPolicy(context, opponent, options.actionPolicy),
        onActionVeto: options.onActionVeto,
        textDelayFrames: options.getTextFrameDelay?.(),
        onStateChange: (state) => { if (revision === presentationRevision) context.safariZone.session.balls = state.ballsRemaining },
        onAudio: presentAudio,
        onMessageControl: (control) => presentMessageControl(control),
        onAnimation: (animation) => presentAnimation(animation, revision, signal),
        onSceneCue: (cue) => presentSceneCue(cue, revision, signal),
        onFastForward: options.onFastForward,
        onPresentationReset: options.onPresentationReset,
        onCaught: () => {
          const isCurrent = () => revision === presentationRevision && !signal.aborted && Boolean(opponent)
          if (!isCurrent() || !opponent) throw new DOMException('Capture Safari remplacée.', 'AbortError')
          const pending = prepareHgssSafariCapture(context, opponent!)
          const nicknamePrompt = formatHgssRomMessage(
            requireRomText(context.inventory.battleMessages, 868, 'La demande de surnom Safari'),
            [pokemonName(pending.pokemon)],
          )
          return {
            presentation: pending.presentation,
            onPresentationStart: pending.alreadyCaught
              ? undefined
              : () => { if (isCurrent()) beginHgssSafariCaptureRegistration(context, pending) },
            afterPresentation: async () => {
              if (!isCurrent()) return []
              const committed = await completeHgssSafariCaptureSequence(context, pending, nicknamePrompt, { ...options, isCurrent })
              return committed.presentation
            },
            afterAllPresentation: () => {
              if (!isCurrent()) return
              const progression = pending.progression
              if (!progression) throw new Error('La progression de capture Safari est absente au retour du combat.')
              finishPostBattle()
              context.progression.completeCaptureAfterBattle(progression)
            },
          }
        },
        onPhaseChange: (phase) => {
          if (revision !== presentationRevision) return
          elements.screen.dataset.presentation = phase === 'command' ? 'command' : 'action'
          options.onPhaseChange?.(phase)
        },
        onFinish: (outcome, state) => {
          if (revision !== presentationRevision || !opponent) return
          if (outcome === 'opponent-fled') context.progression.recordOpponentFled()
          finishPostBattle()
          const exitRoute = resolveHgssSafariExitRoute(
            outcome,
            state.ballsRemaining,
            hasHgssSafariCaptureCapacity(context),
          )
          const finish: HgssSafariBattleFinish = {
            outcome,
            opponent: opponent!,
            // Task_SafariEncounter refait la capacite apres chaque combat :
            // une capture peut elle-meme remplir la derniere place disponible.
            ...exitRoute,
          }
          hideBattleScene()
          options.onFinish(finish)
        },
      })
      return opponent
    },
    handle: (action, pressed) => controller.handle(action, pressed),
    isActive: () => controller.isActive(),
    tick(vblank) {
      if (!controller.isActive() || !opponentSprite || elements.opponentSprite.hidden) return
      const sample = sampleHgssBattlePokemonAnimation(opponentSprite.animationScript, (vblank - spriteStartedAtVblank) >>> 0)
      if (sample.frameIndex !== spriteFrameIndex) {
        options.mountGraphicCanvas(getBattlePokemonSpriteFrame(elements.opponentSprite), opponentSprite.frames[sample.frameIndex]!)
        spriteFrameIndex = sample.frameIndex
      }
      const canvas = getBattlePokemonSpriteFrame(elements.opponentSprite).firstElementChild
      if (canvas instanceof HTMLCanvasElement) canvas.style.transform = `translateX(${sample.xOffset * 1.25}%)`
    },
    close: hideBattleScene,
  }
}
