import type { BrowserMultiplayerRuntimeOptions } from './browserMultiplayerRuntime'
import type { GameAccessDecision } from '../access/gameFeatureAccess'
import type { GameplayExtensionPorts } from '../extensions/gameplayExtensionPorts'
import { composeGameplayExtensionPorts } from '../extensions/composeGameplayExtensionPorts'
import { getPlayerAvatarSpriteId, getPlayerMovementDurationFrames } from '../player/hgssPlayerMovement'
import type { FieldScriptRunner, FieldScriptState } from '../scripts/fieldScriptRunner'
import type { VersionedSaveExtensions } from '../save/versionedSaveExtensions'
import {
  createHgssSharedCampaignBranchId,
  readHgssSharedCampaignSaveExtension,
  replaceHgssSharedCampaignSaveExtension,
  type HgssSharedCampaignSaveExtensionV1,
} from '../save/hgssSharedCampaignSaveExtension'
import type { GameTextEntryOverlay } from '../ui/gameTextEntryOverlay'
import {
  readBrowserOnlineAccountSession,
  type OnlineAccountAccessSnapshot,
} from '../../online/onlineAccountSession'
import { readOnlineClientConfig } from '../../online/onlineClientConfig'
import type { PlayerProfile } from '../../playerProfile'
import type { RomInventory } from '../../ndsTypes'
import { hgssVBlanksToMilliseconds } from '../time/hgssFrameTiming'
import {
  createBrowserDynamicWorldActorHost,
  type BrowserDynamicWorldActorHost,
  type BrowserDynamicWorldActorHostOptions,
} from '../world/browserDynamicWorldActorHost'
import type {
  AuthoritativePlayerMoveResult,
  AuthoritativePlayerTransitionResult,
  WorldSession,
} from '../world/worldSession'
import type { BrowserFieldSharedScriptRequest } from '../world/browserFieldExplorationRuntime'
import {
  createHgssBrowserFieldCampaign,
  createHgssCampaignFieldPositionInspector,
  createHgssCampaignFieldWorldProbeFactory,
  type HgssBrowserFieldCampaign,
} from './hgssBrowserFieldCampaign'
import {
  createHgssCampaignAuthoritativeService,
  type HgssCampaignAuthoritativeService,
} from './hgssCampaignAuthoritativeService'
import type { HgssCampaignWorldTransitionPresentation } from './hgssCampaignWorldMovementPort'
import type { HgssBrowserMultiplayerGameContext } from './hgssBrowserMultiplayerGameAdapter'
import {
  createHgssBrowserMultiplayerHost,
  hgssMultiplayerUiSoundEffects,
  type HgssBrowserMultiplayerHost,
} from './hgssBrowserMultiplayerHost'
import {
  assertHgssSharedCampaignProgressionMatchesFieldState,
  createHgssSharedCampaignProgressionSeed,
} from './hgssSharedCampaignProgression'
import { createHgssSharedCampaignFieldEventId } from './hgssSharedCampaignEventIdentity'
import { createHgssSharedFieldEventAdmission } from './hgssSharedFieldEventAdmission'
import {
  createHgssSharedFieldScriptPresentationRunner,
  evaluateHgssSharedFieldScriptTransaction,
} from './hgssSharedFieldScriptTransaction'

export type HgssBrowserFieldMultiplayerState = Readonly<{
  gameActive: boolean
  fieldBusy: boolean
  sessionRngReady: boolean
  inventory?: RomInventory
  fieldState: FieldScriptState
  profile: PlayerProfile
  world?: WorldSession
  gameplay: GameplayExtensionPorts
}>

export type HgssBrowserFieldMultiplayerCompositionOptions = Readonly<{
  readState: () => HgssBrowserFieldMultiplayerState
  isFieldMutationBlocked: () => boolean
  dynamicActors: BrowserDynamicWorldActorHostOptions
  panel: HTMLElement
  textEntry: GameTextEntryOverlay
  runtimeOptions: Omit<BrowserMultiplayerRuntimeOptions, 'root' | 'game'>
  readAccountAccess: () => Pick<OnlineAccountAccessSnapshot, 'signedIn' | 'online'>
  checkMultiplayerAccess: () => GameAccessDecision
  createPokemonVisual: NonNullable<HgssBrowserMultiplayerGameContext['createPokemonVisual']>
  readSaveExtensions: () => VersionedSaveExtensions | undefined
  writeSaveExtensions: (extensions: VersionedSaveExtensions | undefined) => void
  persistState: (state: FieldScriptState) => Promise<void> | void
  publishState: (state: FieldScriptState) => void
  presentLocalTurn: (direction: AuthoritativePlayerMoveResult['state']['direction'], durationMs: number) => void
  presentLocalStep: (result: AuthoritativePlayerMoveResult, durationFrames: number) => void
  presentLocalTransition?: (
    result: AuthoritativePlayerTransitionResult,
    presentation: HgssCampaignWorldTransitionPresentation,
  ) => void
  onFieldLockChanged: (locked: boolean) => void
  reportStatus?: (message: string) => void
  playSoundEffect?: (sequenceId: number) => Promise<unknown> | void
  onOpen?: () => void
  onClose?: () => void
}>

export type HgssBrowserFieldMultiplayerComposition = Readonly<{
  campaign: HgssBrowserFieldCampaign
  exploration: Readonly<{
    isLocked: () => boolean
    tryStartSharedScript: (request: BrowserFieldSharedScriptRequest) => Promise<FieldScriptRunner | undefined>
  }>
  actors: BrowserDynamicWorldActorHost
  host: HgssBrowserMultiplayerHost
  composeGameplay: (ports: GameplayExtensionPorts) => GameplayExtensionPorts
}>

const unavailableCampaignAuthority: HgssCampaignAuthoritativeService = Object.freeze({
  prepareHost: async () => {
    throw new Error("Le serveur de campagne n'est pas configuré.")
  },
  prepareGuest: async () => {
    throw new Error("Le serveur de campagne n'est pas configuré.")
  },
})

function readCampaignContext(options: HgssBrowserFieldMultiplayerCompositionOptions) {
  const current = options.readState()
  const { inventory, world, profile } = current
  const worldState = world?.getState()
  if (!current.gameActive || current.fieldBusy || options.isFieldMutationBlocked()
    || !inventory || !world || !worldState
    || worldState.locomotion !== 'walking' || profile.gameVersion === undefined
    || profile.language === undefined) return undefined
  const rocket = current.fieldState.playerState === 3
    || current.fieldState.playerState === 12
    || current.fieldState.playerState === 14
  return Object.freeze({
    gameCode: inventory.metadata.gameCode,
    gameVersion: profile.gameVersion,
    language: profile.language,
    displayName: profile.name,
    gender: profile.gender,
    spriteId: rocket
      ? profile.gender === 'male' ? 222 : 221
      : getPlayerAvatarSpriteId(profile.gender, 'walking'),
    world,
  })
}

function readOpenBlocker(options: HgssBrowserFieldMultiplayerCompositionOptions): string | undefined {
  const current = options.readState()
  if (!current.gameActive || !current.inventory || !current.fieldState.pokemonRuntime
    || !current.sessionRngReady || !current.world?.getState()) {
    return 'Chargez une ROM et ouvrez une partie avant le multijoueur.'
  }
  if (current.fieldBusy || options.isFieldMutationBlocked()) {
    return "Terminez l'action, le menu, le combat ou la session Safari en cours avant d'ouvrir le multijoueur."
  }
  const account = options.readAccountAccess()
  if (!account.signedIn) return 'Connectez-vous depuis l’écran titre avant de charger une sauvegarde.'
  if (!account.online) return 'Ce compte ne possède pas l’accès en ligne.'
  const access = options.checkMultiplayerAccess()
  if (!access.allowed && access.reason === 'subscription-required') {
    return 'Un abonnement actif est nécessaire pour accéder au multijoueur.'
  }
  return undefined
}

export function shouldTickHgssFieldObjects(fishingActive: boolean, campaignLocked: boolean): boolean {
  return !fishingActive && !campaignLocked
}

function readTradeContext(
  options: HgssBrowserFieldMultiplayerCompositionOptions,
): HgssBrowserMultiplayerGameContext | undefined {
  const current = options.readState()
  const inventory = current.inventory
  if (!inventory || !current.fieldState.pokemonRuntime) return undefined
  return Object.freeze({
    state: current.fieldState,
    pokemonCatalog: inventory.pokemonCatalog,
    uiMessageBanks: inventory.uiMessageBanks,
    itemCatalog: inventory.itemCatalog,
    npcTradeCatalog: inventory.npcTradeCatalog,
    teamPolicy: current.gameplay.pokemonTeamPolicy,
    createPokemonVisual: options.createPokemonVisual,
  })
}

function hasSharedFieldDelta(
  delta: ReturnType<typeof evaluateHgssSharedFieldScriptTransaction>['delta'],
): boolean {
  return delta.addedFlagIds.length > 0
    || delta.removedFlagIds.length > 0
    || delta.variables.length > 0
}

/**
 * Frontière navigateur unique du terrain multijoueur. Elle compose les acteurs
 * dynamiques, la campagne autoritaire et la coque Online sans réintroduire ces
 * règles de cycle de vie dans `main.ts`.
 */
export function createHgssBrowserFieldMultiplayerComposition(
  options: HgssBrowserFieldMultiplayerCompositionOptions,
): HgssBrowserFieldMultiplayerComposition {
  const actors = createBrowserDynamicWorldActorHost(options.dynamicActors)
  const onlineConfig = readOnlineClientConfig()
  const accountSession = options.runtimeOptions.accountSession ?? readBrowserOnlineAccountSession()
  const authoritativeService: HgssCampaignAuthoritativeService = onlineConfig
    ? createHgssCampaignAuthoritativeService({ config: onlineConfig, accountSession })
    : unavailableCampaignAuthority
  const transientCampaignBranchIds = new WeakMap<FieldScriptState, string>()
  const persistCampaignState = async (
    state: FieldScriptState,
    campaign: HgssSharedCampaignSaveExtensionV1,
  ): Promise<void> => {
    const previous = options.readSaveExtensions()
    options.writeSaveExtensions(replaceHgssSharedCampaignSaveExtension(previous, campaign))
    try { await options.persistState(state) }
    catch (error) {
      options.writeSaveExtensions(previous)
      throw error
    }
  }
  const readCampaignSeed = () => {
    const current = options.readState()
    const saved = readHgssSharedCampaignSaveExtension(options.readSaveExtensions())
    if (saved) {
      assertHgssSharedCampaignProgressionMatchesFieldState(
        current.fieldState,
        saved.appliedProgression,
      )
      return saved.appliedProgression
    }
    let branchId = transientCampaignBranchIds.get(current.fieldState)
    if (!branchId) {
      branchId = createHgssSharedCampaignBranchId()
      transientCampaignBranchIds.set(current.fieldState, branchId)
    }
    return createHgssSharedCampaignProgressionSeed(current.fieldState, branchId)
  }
  const readProbeContext = () => {
    const current = options.readState()
    return current.inventory ? {
      inventory: current.inventory,
      fieldState: current.fieldState,
      playerGender: current.profile.gender,
      extensionPorts: current.gameplay.worldSessionExtensionPorts,
    } : undefined
  }
  const sharedEventAdmission = createHgssSharedFieldEventAdmission(() => {
    const current = options.readState()
    const { inventory, profile } = current
    if (!current.gameActive || !inventory || profile.gameVersion === undefined
      || profile.language === undefined) return undefined
    return Object.freeze({
      inventory,
      fieldState: current.fieldState,
      playerGender: profile.gender,
      gameVersion: profile.gameVersion,
      language: profile.language,
      extensionPorts: current.gameplay.worldSessionExtensionPorts,
    })
  })
  const campaign = createHgssBrowserFieldCampaign({
    readContext: () => readCampaignContext(options),
    createMovementProbe: createHgssCampaignFieldWorldProbeFactory(readProbeContext),
    authoritativeService,
    sharedEventAdmission,
    progression: {
      readFieldState: () => options.readState().fieldState,
      readSeed: readCampaignSeed,
      readSavedCampaign: () => readHgssSharedCampaignSaveExtension(options.readSaveExtensions()),
      persistState: persistCampaignState,
      publishState: options.publishState,
    },
    inspectPlayerPosition: createHgssCampaignFieldPositionInspector(readProbeContext),
    persistAuthoritativePosition: () => options.persistState(options.readState().fieldState),
    publishActors: (next) => { actors.setSourceActors('campaign', next) },
    onLocalTurn: (direction) => {
      options.presentLocalTurn(
        direction,
        hgssVBlanksToMilliseconds(getPlayerMovementDurationFrames('turn')),
      )
    },
    onLocalStep: (result) => {
      options.presentLocalStep(result, getPlayerMovementDurationFrames(result.movement))
    },
    onLocalTransition: options.presentLocalTransition,
    onFieldLockChanged: options.onFieldLockChanged,
    onMovementRejected: () => {
      try {
        void Promise.resolve(options.playSoundEffect?.(hgssMultiplayerUiSoundEffects.unavailable))
          .catch(() => undefined)
      } catch { /* Le son de refus ne pilote jamais la campagne. */ }
    },
    onError: (error) => { options.reportStatus?.(error.message) },
  })
  const tryStartSharedScript = async (
    request: BrowserFieldSharedScriptRequest,
  ): Promise<FieldScriptRunner | undefined> => {
    const current = options.readState()
    const gameVersion = current.profile.gameVersion
    const language = current.profile.language
    if (!campaign.isFieldLocked() || !current.gameActive || current.fieldBusy
      || options.isFieldMutationBlocked() || !current.inventory || !current.world?.getState()
      || gameVersion === undefined || language === undefined) {
      throw new Error("L'autorité Coop n'est pas prête pour cette interaction terrain.")
    }
    if (request.source.kind === 'object' && request.actorId !== request.source.objectId
      || request.source.kind === 'coordinate' && request.actorId !== undefined) {
      throw new Error("La source de l'interaction terrain partagée est incohérente.")
    }

    const transaction = evaluateHgssSharedFieldScriptTransaction({
      map: request.map,
      scriptId: request.scriptId,
      actorId: request.actorId,
      state: current.fieldState,
    })
    if (hasSharedFieldDelta(transaction.delta)) {
      const eventId = createHgssSharedCampaignFieldEventId({
        rom: {
          gameCode: current.inventory.metadata.gameCode,
          gameVersion,
          language,
        },
        mapId: request.map.id,
        source: request.source,
        scriptId: request.scriptId,
      })
      const committed = await campaign.commitSharedEvent(
        eventId,
        transaction.before,
        transaction.after,
      )
      if (!committed) {
        throw new Error("L'autorité Coop n'a pas confirmé l'événement terrain.")
      }
    }
    return createHgssSharedFieldScriptPresentationRunner(transaction.presentationSteps)
  }
  const host = createHgssBrowserMultiplayerHost({
    panel: options.panel,
    showLauncher: false,
    textEntry: options.textEntry,
    ...(onlineConfig ? { campaign: campaign.port } : {}),
    runtimeOptions: options.runtimeOptions,
    readContext: () => readTradeContext(options),
    getOpenBlocker: () => readOpenBlocker(options),
    persistState: options.persistState,
    publishState: options.publishState,
    reportStatus: options.reportStatus,
    playSoundEffect: options.playSoundEffect,
    onOpen: options.onOpen,
    onClose: options.onClose,
  })
  return Object.freeze({
    campaign,
    exploration: Object.freeze({
      isLocked: campaign.isFieldLocked,
      tryStartSharedScript,
    }),
    actors,
    host,
    composeGameplay: (ports) => composeGameplayExtensionPorts(ports, [campaign.gameplayContribution]),
  })
}
