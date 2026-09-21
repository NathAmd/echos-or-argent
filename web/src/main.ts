import './styles/index.css'
import { installHgssUiTheme } from './game/ui/romUiTheme'
import { applyHgssUiTheme } from './game/ui/hgssUiThemes'
import { createInGameHudController, resolveHgssDayPhase, resolveHgssTimeOfDay } from './game/ui/inGameHud'
import { createPcBoxController } from './game/ui/pcBoxController'
import { createPokemonUiAnimationRegistry } from './game/ui/pokemonUiAnimation'
import { createPokemonUiSpritePresentation } from './game/ui/pokemonUiSpritePresentation'
import { createGameFullscreenController, type GameFullscreenController } from './game/ui/gameFullscreenController'
import { createUnifiedPcEntryCoordinator } from './game/ui/pcBoxLegacyEntry'
import { createInputPromptController, syncFocusedMenuControl } from './game/ui/inputPromptController'
import { createBattlePpItemChoices, renderBattleTypeBadges, syncBattleControlHints } from './game/ui/battlePresentation'
import { renderBattlePartyGauge } from './game/ui/battlePartyGaugePresentation'
import { animateSteppedBattleGauge, resolveBattleGaugeAnimationTiming, resolveBattleGaugeTarget } from './game/ui/battleGaugePresentation'
import { createBattlePresentationLease, createBattlePresentationSkipRegistry } from './game/battle/battlePresentationSkip'
import { restartBattleCssAnimation, type BattleCssAnimationRun } from './game/battle/battleCssAnimation'
import { applyBattleStagePresentation, syncBattleHudPrimaryStatus, syncBattleStageSummary } from './game/battle/battleHudPresentation'
import { playBattleImpact, playBattlePokemonFaint, playBattleTrainerEntrance, playBattleTrainerThrow, revealBattlePokemon } from './game/battle/battleSceneAnimations'
import { HGSS_BATTLE_SEND_OUT_TIMING } from './game/battle/battlePokemonSendOutPlayback'
import { createBattlePokemonSendOutRuntime } from './game/battle/battlePokemonSendOutRuntime'
import { collectBattleMoveDamageEvents } from './game/battle/battleEventPresentation'
import { createBattleProgressionPokemonKey as battleEvolutionQueueKey, createBattleProgressionPresentationQueue } from './game/battle/battleProgressionPresentationQueue'
import { createCanonicalBattleProgressionPresenter, type BattleProgressionMessageEntry } from './game/battle/battleProgressionPresentation'
import { isHeldItemBattleCondition, resolveBattleConditionMessage } from './game/battle/battleConditionPresentation'
import { formatHgssRomMessage as formatBattleRomMessage } from './game/ui/romMessageFormatting'
import { playHgssFieldMusic, resolveHgssEncounterRadioEffect } from './game/pokegear/hgssRadio'
import { createPokegearUiCoordinator, type PokegearUiCoordinator } from './game/pokegear/pokegearUiCoordinator'
import { createPokegearOutgoingPhoneCoordinator } from './game/pokegear/pokegearOutgoingPhoneCoordinator'
import { createPokegearFlyRuntime } from './game/pokegear/pokegearFlyRuntime'
import { createHgssPhoneRingSession } from './game/pokegear/hgssPhoneRingSession'
import { resolveHgssFieldPhoneCallInput } from './game/pokegear/hgssFieldPhoneCallInput'
import { createChoicePopupController } from './game/ui/choicePopupController'
import { createYesNoConfirmationController } from './game/ui/yesNoConfirmationController'
import { createSafariUiHost } from './game/ui/safariUiHost'
import { createPhotoAlbumMainAdapter } from './game/ui/photoAlbumMainAdapter'
import { createPokedexCaptureRegistrationHost } from './game/ui/pokedexCaptureRegistrationHost'
import { createUiLayerCoordinator } from './game/ui/uiLayerCoordinator'
import { collectVisibleBugReportElements } from './game/diagnostics/bugReportSnapshot'
import { createGameBugDiagnosticsCollector } from './game/diagnostics/gameBugDiagnostics'
import { createRealtimeBattleDebugController, resolveRealtimeBattleAdvanceAction, resolveRealtimeTutorialStepAfterDebugEffect } from './game/diagnostics/realtimeBattleDebug'
import { createRealtimeTestPanel } from './game/diagnostics/realtimeTestPanel'
import { createRealtimeJourneyBridge } from './game/diagnostics/realtimeJourneyBridge'
import { clickRequiredRealtimeBotControl } from './game/diagnostics/realtimeBotControl'
import type { RealtimeTestBotJourney, RealtimeTestDebugCommand } from './game/diagnostics/realtimeTestScript'
import { collectRealtimeJourneyEvidence, createRealtimeJourneyAgent, recordBotWins, runBotMachine, type RealtimeJourneyAgent } from './game/diagnostics/realtimeJourneyAutomation'
import { createRealtimeCampaignAudit, type RealtimeCampaignPresetId } from './game/diagnostics/realtimeNewGamePlusPresets'
import { createEphemeralStorageOverlay, maskHgssCampaignSavesInOverlay } from './game/diagnostics/ephemeralStorageOverlay'
import { createFieldChoiceHost } from './game/ui/fieldChoiceHost'
import { createFieldEasyChatHost } from './game/ui/fieldEasyChatHost'
import { createAlphFieldUiHost } from './game/ui/alphFieldUiHost'
import { createFieldRecordAppsHost } from './game/ui/fieldRecordAppsHost'
import { installFieldAppRomLabels } from './game/ui/fieldAppRomLabels'
import { createFieldDialogueRuntime } from './game/ui/fieldDialogueRuntime'
import { createDelegatedButtonActivation } from './game/ui/controlActivation'
import { renderAppShell } from './appShell'
import { createGameScreenRuntime } from './gameScreenRuntime'
import { createGameInputRouter, shouldDispatchFullscreenBack, type GameDigitalAction } from './gameInput'
import { hideArchiveInspector, renderFileList as renderInventoryFileList, renderGraphicPreview, renderInventorySummary, renderResourceCatalog, renderRomDetails, showArchiveMembers as renderArchiveMembers, type InventoryView } from './inventoryView'
import type { IntroPointerAction } from './introControls'
import { getMapOrigin } from './game/world/mapCoordinates'
import { hgssDynamicWarpSentinelAnchor, hgssDynamicWarpSentinelMapId, type WorldMoveResult, type WorldSession } from './game/world/worldSession'
import { createHgssFieldWorldSession } from './game/world/hgssFieldWorldSessionFactory'
import { completeHgssFieldStep, isHgssProcessableFieldStep, resolveHgssFieldStepInterruptScript } from './game/world/hgssFieldStepCompletion'
import { playHgssFieldPoisonPresentation } from './game/world/hgssFieldPoisonPresentation'
import { createBrowserFieldObjectMotionRuntime } from './game/world/browserFieldObjectMotionRuntime'
import { createBrowserFieldExplorationRuntime, type BrowserFieldExplorationRuntime, type BrowserFieldPendingWarpTarget } from './game/world/browserFieldExplorationRuntime'
import { createHgssVBlankClock, hgssVBlanksToMilliseconds } from './game/time/hgssFrameTiming'
import { cloneFieldScriptState, createFieldPhoneCallRunner, createFieldScriptMapInitSequenceRunner, createFieldScriptRunner, createFieldScriptSequenceRunner, createFieldScriptState, formatFieldMessage, hasFieldScript, initializeNewGameFieldScriptState, projectFieldScriptState, releaseFieldScriptExecutionState, setFieldScriptPlayerState, type FieldScriptRunner, type FieldScriptState } from './game/scripts/fieldScriptRunner'
import { initializeHgssGymmickState } from './game/scripts/hgssGymmickFieldRuntime'
import { createFieldScriptHost } from './game/scripts/fieldScriptHost'
import { createFieldScriptExecutionState } from './game/scripts/fieldScriptExecutionState'
import { createFieldScriptAudioHost } from './game/scripts/fieldScriptAudioHost'
import { createFieldScriptWorldHost } from './game/scripts/fieldScriptWorldHost'
import { createFieldScriptLifecycleHost } from './game/scripts/fieldScriptLifecycleHost'
import { createFieldScriptEffectsHost } from './game/scripts/fieldScriptEffectsHost'
import { createFieldScriptFollowerHost } from './game/scripts/fieldScriptFollowerHost'
import { createFieldScriptUiHost } from './game/scripts/fieldScriptUiHost'
import { createFieldScriptSessionHost } from './game/scripts/fieldScriptSessionHost'
import { createFieldScriptWaitPoller } from './game/scripts/fieldScriptWaitPoller'
import { applyProjectedFieldState } from './game/scripts/projectedFieldState'
import { isHgssNighttime, refreshHgssTimeOfDayState, resolveHgssBattlePaletteTime } from './game/time/hgssRtc'
import { createHgssInGameTimeClock } from './game/time/hgssInGameTime'
import { createHgssRtcPenaltyState, hasHgssRtcPenalty, type HgssRtcPenaltyState } from './game/time/hgssRtcPenalty'
import { resolveHgssBattleWeather, resolveHgssMapWeather, restoreHgssSavedMapWeather, type HgssWeather } from './game/world/hgssWeather'
import { createHgssEnvironmentCoordinator } from './game/world/hgssEnvironmentCoordinator'
import { createLocalWeatherService, resolvePresentedHgssWeather, toggleLocalWeatherPreference } from './game/world/localWeather'
import { settleOptionalFieldScriptStep } from './game/scripts/optionalFieldScriptStep'
import { getResponsiveHgssDialogColumns } from './game/ui/hgssDialogPages'
import type { FieldScriptWaitKind } from './game/ui/fieldDialogWait'
import { resolveCanonicalPokemonPartyTarget, type CanonicalPokemonPartyTarget, type PokemonPartySlotSource } from './game/pokemon/canonicalPokemonPartyTarget'
import { createHgssSessionRng, deriveHgssRtcSeed, type HgssSessionRng } from './game/pokemon/hgssSessionRng'
import { createHgssSaveState, type RestoredHgssSaveState } from './game/save/hgssSaveState'
import { hgssDataOnlySaveAuthority } from './game/save/hgssDataOnlySaveDocument'
import { createHgssSessionPersistenceCoordinator, isVisualMovementSaveBlocked } from './game/save/hgssSessionPersistenceCoordinator'
import { createBrowserSaveStatusPresenter } from './game/save/browserSaveStatusPresenter'
import { createBrowserSessionPageCheckpoint } from './game/save/browserSessionPageCheckpoint'
import { createBrowserSessionAutosave } from './game/save/browserSessionAutosave'
import { prepareHgssRestoredSession, rebuildHgssLocalFieldMapProjection } from './game/save/hgssRestoredSession'
import { runSessionRestoreTransaction } from './game/save/sessionRestoreTransaction'
import { projectHgssSavedWorldPosition } from './game/save/hgssSavedWorldPosition'
import type { VersionedSaveExtensions } from './game/save/versionedSaveExtensions'
import { hgssBrowserSaveSlotCount, inspectHgssBrowserSaveSlot, type HgssBrowserSaveKind, type HgssBrowserSaveSlot } from './game/save/hgssSaveStorage'
import { createBrowserTitleSaveAccess } from './game/menu/browserTitleSaveAccess'
import { installBrowserGameSessionPageLifecycle } from './game/boot/browserGameSessionPageLifecycle'
import type { TitleSaveCatalog } from './game/menu/titleSaveCatalog'
import { createDefaultHgssGameOptions, getHgssTextFrameDelay, readHgssGameOptions, writeHgssGameOptions } from './game/save/hgssGameOptions'
import { createMapDynamicPokemonSpeciesTextureResolver } from './mapRuntime'
import { applyPlayerProfileSkin, createDefaultPlayerProfile, createPlayerProfileForRom, initializeHgssNewGamePlayerProfile } from './playerProfile'
import { createRomAudioRuntime, type RomAudioRuntime } from './audio/romAudioRuntime'
import { playRomCrySequence, startRomCry, startRomSoundEffect } from './audio/romAudioPresentation'
import { resolveMapInitScripts, type MapInitPhase } from './rom/scripts/fieldScripts'
import { createBrowserGameInputHost } from './input/browserGameInputHost'
import { createGameDigitalInputCoordinator } from './input/gameDigitalInputCoordinator'
import { installGameSurfacePointerBindings } from './input/gameSurfacePointerBindings'
import { createMovementInput, movementDirections, observePhysicalMovementInput, type Movement } from './input/movementInput'
import { giveHgssFashionAccessory } from './game/fashion/hgssFashionCase'
import { createBrowserFieldBattleLauncher } from './game/battle/runtime/browserFieldBattleLauncher'
import { getFirstUsableFieldBattlePartySlot, getUsableFieldBattlePartySlots } from './game/battle/fieldBattlePartySelection'
import type { TrainerBattleIntroduction } from './game/battle/trainerBattleIntroduction'
import { clonePersistentSimpleBattlePokemon, completeSimpleBattleCapture, consumeSimpleBattleInitialEvents, createSimpleBattleSession, executeSimpleBattleOpponentTurn, executeSimpleBattlePlayerSwitchTurn, executeSimpleBattleTurn, switchSimpleBattlePokemon, tryRunFromSimpleBattle, type SimpleBattleEvent, type SimpleBattleSession } from './game/battle/simpleBattleSession'
import { attemptFieldWildCapture } from './game/battle/fieldWildCaptureAttempt'
import { formatFieldWildCaptureStorageMessage } from './game/battle/fieldWildCaptureMessages'
import { escapeDoubleWildBattleWithItem, tryRunFromDoubleWildBattle } from './game/battle/doubleWildBattleEscape'
import { selectBaseFieldBattleBagEntries } from './game/battle/fieldBattleBagActionResolver'
import { applySimpleBattleEscapeItem, applySimpleBattlePartyItem, applySimpleBattleStatItem } from './game/battle/simpleBattleBagItems'
import type { BattleBagActionRole, PlayerBattleActionIntent } from './game/battle/battleActionPolicy'
import { fadeHgssCapturedBall, playHgssBattleCaptureAnimation } from './game/battle/battleCapturePlayback'
import { resetBattleScenePresentation } from './game/battle/battleScenePresentation'
import { bindBattlePokemonSpritePresentation, getBattlePokemonSpriteFrame, isBattlePokemonSpriteBoundTo } from './game/battle/battlePokemonSpritePresentation'
import { createBattlePokemonSpriteAnimator } from './game/battle/battlePokemonSpriteAnimator'
import { createBattleEntrySceneTransitionController } from './game/battle/battleEntryTransition'
import { createBattleDigitalInputHost } from './game/battle/battleDigitalInputHost'
import { createBrowserTrainerBattleIntroductionHost } from './game/battle/runtime/browserTrainerBattleIntroductionHost'
import { createBrowserDoubleBattleSceneHost } from './game/battle/runtime/browserDoubleBattleSceneHost'
import { createBrowserDoubleBattleEventPresenter } from './game/battle/runtime/browserDoubleBattleEventPresenter'
import { createBrowserSimpleBattlePresentationHost } from './game/battle/runtime/browserSimpleBattlePresentationHost'
import type { BattleLevelUp } from './game/battle/battleProgression'
import { applyHgssPostBattleProgression as applyPostBattle } from './game/battle/hgssPostBattleAbilities'
import { createBattleProgressionApplicator } from './game/battle/battleProgressionPolicy'
import { resolveFieldBattleExperienceRecipients } from './game/battle/fieldBattleExperienceRecipients'
import { observeExplicitOpponentCapture, observeSimpleBattleOutcomeEvents } from './game/battle/battleOutcomeProjection'
import { createHgssFieldEncounterSession, type HgssFieldEncounterSession, type PreparedFieldWildEncounter } from './game/encounters/wildEncounterSelection'
import type { WildEncounterStartedMethod } from './game/encounters/wildEncounterStartedObserver'
import { createBrowserFishingHost } from './game/encounters/browserFishingHost'
import { commitHgssWildCaptureBeforeStorage, completeHgssWildCaptureAfterBattle, finalizeHgssWildCaptureProgression, hasHgssPokemonNicknameInput, prepareHgssWildCaptureProgression, recordHgssWildEncounterStarted, recordHgssWildOpponentFled, scheduleHgssPostWildBattleCalls } from './game/encounters/hgssWildCaptureFinalizer'
import { createCanonicalWildPokemon } from './game/encounters/wildPokemonGeneration'
import { applyHgssRoamerBattleResult, repelActiveHgssRoamersFromMap, selectHgssRoamerEncounter } from './game/encounters/hgssRoamers'
import { createFieldEncounterCoordinator } from './game/encounters/fieldEncounterCoordinator'
import { cloneCanonicalPokemon, type CanonicalPokemon } from './game/pokemon/canonicalPokemon'
import { createBrowserPokemonTransformationSceneHost } from './game/pokemon/browserPokemonTransformationSceneHost'
import { createMainMenuController } from './game/menu/mainMenuController'
import { resolveHgssMainMenuAvailability } from './game/menu/hgssMainMenuAvailability'
import { createBrowserUtilityMenuHost, createBrowserUtilityMenuSelectionState, createDeferredBrowserUtilityMenuHost } from './game/menu/browserUtilityMenuHost'
import { createUtilityMenuInputHost } from './game/menu/utilityMenuInputHost'
import { createUtilityMenuScreenItemsHost } from './game/menu/utilityMenuScreenItemsHost'
import { assertHgssFieldPartyInvariant, replacePokemonParty } from './game/pokemon/pokemonParty'
import { healPokemonPartyWithPolicy } from './game/pokemon/pokemonPartyHealingPolicy'
import { baseGameplayExtensionPorts } from './game/extensions/gameplayExtensionPorts'
import { createGameplayExtensionRuntime } from './game/extensions/gameplayExtensionRuntime'
import { takeBagItem } from './game/items/bagInventory'
import { createTitleMenuController, type TitleMenuResult } from './game/menu/titleMenuController'
import { createTitleAccountGateHost, type TitleSaveCatalogAccess, type TitleSaveCatalogConflictResolutions, type TitleSaveCatalogLocalImportDecision } from './game/menu/titleAccountGate'
import { createTitleCampaignCoordinator, type TitleCampaignActivationKind, type TitleCampaignCoordinator } from './game/newGamePlus/titleCampaignCoordinator'
import { allBattlesInDuoModuleId, type NewGamePlusGameplayRuntime } from './game/newGamePlus/newGamePlusGameplayRuntime'
import { createTitleNewGamePlusRuntime } from './game/newGamePlus/titleNewGamePlusRuntimeComposition'
import type { NewGamePlusProfileV1 } from './game/newGamePlus'
import { createGameAccessGate } from './game/access/gameFeatureAccess'
import { createBrowserNewGamePlusWorldComposition } from './game/newGamePlus/browserNewGamePlusWorldComposition'
import type { AllPokemonQuestWorldInteraction } from './game/newGamePlus/modules/allPokemonQuestWorldCoordinator'
import { takeHeldItemFromPokemon } from './game/items/heldItemTransfer'
import { setPokemonNickname } from './game/pokemon/pokemonNickname'
import { replacePokemonMoveAfterChoice } from './game/pokemon/pokemonMoveLearning'
import { createPokemonMoveLearningCoordinator, type PokemonMoveLearningRequest } from './game/pokemon/pokemonMoveLearningCoordinator'
import { formatBattleMoveLearningResult, requirePokemonMoveName } from './game/pokemon/pokemonMoveLearningMessages'
import { createStarterCryPreview } from './game/pokemon/starterCryPreview'
import { getHgssStarterSpeciesId } from './game/pokemon/hgssStarters'
import { createTitleModelRenderer } from './titleModelRenderer'
import { createBrowserFollowerReactionRuntime } from './game/pokemon/browserFollowerReactionRuntime'
import { createHgssPostOakFieldState } from './game/intro/hgssPostOakFieldState'
import { createOakIntroRuntime } from './game/intro/oakIntroRuntime'
import { canSkipOpeningCinematic, openingCinematicDurationMs } from './game/boot/openingCinematic'
import { createBrowserRomLoader } from './game/boot/browserRomLoader'
import { createBrowserMapRuntime } from './game/boot/browserMapRuntimeBootstrap'
import { cleanupBrowserApplication, installTerminalPageCleanup } from './game/boot/browserApplicationPageLifecycle'
import type { OpeningMapPreview, PlayerDirection, PlayerGender, RomFile, RomInventory } from './ndsTypes'
import { createCanvasAssetCache } from './rendering/canvas/canvasAssets'
import { syncBrowserSingleScreenLayout } from './game/ui/singleScreenLayout'
import { createGameTextEntryOverlay, type GameTextEntryRequest } from './game/ui/gameTextEntryOverlay'
import { createFieldTextEntryCoordinator } from './game/ui/fieldTextEntryCoordinator'
import { createSafariCaptureNicknameController } from './game/ui/safariCaptureNicknameController'
import { markPokemonCaught, markPokemonSeen } from './game/pokedex/hgssPokedex'
import { createPokedexRegistrationPresentation } from './game/ui/pokedexMenuPresentation'
import { createHgssShopPresentation } from './game/ui/shopPresentation'
import { playConfirmedHgssBattleAnimation } from './game/battle/battleAnimationPlayback'
import { resolveHgssBattleEventPresentationAnimation, type HgssBattlePresentationAnimation } from './game/battle/hgssBattlePresentationAnimation'
import { getPlayerMovementDurationFrames, type PlayerLocomotionMode } from './game/player/hgssPlayerMovement'
import { hgssMultiplayerUiSoundEffects } from './game/multiplayer/hgssBrowserMultiplayerHost'
import { createHgssBrowserFieldMultiplayerComposition, shouldTickHgssFieldObjects } from './game/multiplayer/hgssBrowserFieldMultiplayerComposition'
import { readBrowserOnlineAccountSession } from './online/onlineAccountSession'
import { readOnlineClientConfig } from './online/onlineClientConfig'
import { createBrowserHgssMultiplayerGateway } from './game/multiplayer/hgssLocalWirelessGateway'
import { consumeDoubleBattleInitialEvents, getDoubleBattleOccupiedPositions, getDoubleBattlePokemon, getRequiredDoubleBattleActors, submitDoubleBattleReplacement, syncDoubleBattleParties, validateDoubleBattleBagItem, type DoubleBattleAction, type DoubleBattlePosition, type DoubleBattleSession } from './game/battle/doubleBattleSession'
import { executeAdmittedDoubleBattleTurn } from './game/battle/doubleBattleActionAdmission'
import { clearPendingDoubleBattleReplacement, commitDoubleBattleCommandAction, createDoubleBattleCommandSelectionState } from './game/battle/doubleBattleCommandSelection'
import { createHgssSingleScreenBattleBackdrop } from './rom/battle/battleBackgrounds'
import { createBrowserBugReportHost } from './game/diagnostics/browserBugReportHost'
import { readDebugMapStart, resolveDebugSpawn, type DebugMapStart } from './game/diagnostics/debugMapStart'
import { appendDiagnosticEntry, createDeduplicatedDiagnosticRecorder, diagnosticErrorDetail, installRuntimeDiagnosticLog, presentRuntimeFailure } from './game/diagnostics/runtimeDiagnosticLog'
import { consumeHgssPersistentIncomingCall, resolveHgssPersistentIncomingCallLaunch, selectHgssPersistentIncomingCall, type HgssPersistentIncomingCall } from './game/pokegear/hgssPersistentIncomingCalls'
import { calculateHgssMoneyLoss, calculateHgssPayDayPayout, calculateHgssTrainerPrizeMoney } from './rom/battle/prizeMoney'
import { resolveHgssTrainerBattleMusic, resolveHgssWildBattleMusic } from './game/battle/hgssBattleMusic'
import { findHgssBattleVictoryFaintIndex, startHgssBattleVictoryMusic } from './game/battle/hgssBattleAudioPresentation'
import { hgssBattleAudioSequences } from './game/battle/hgssBattleAudio'
import { resolveHgssFieldBattleEnvironment } from './game/battle/hgssFieldBattleEnvironment'
import { createHgssSweetScentRuntimeCoordinator } from './game/encounters/hgssSweetScentRuntimeCoordinator'
import { createHgssSweetScentFieldEffect } from './game/encounters/hgssSweetScentFieldEffect'
import { HGSS_HONEY_ITEM_ID } from './game/encounters/hgssSweetScentEncounter'
import { createHgssGymCoordinator } from './game/gyms/hgssGymCoordinator'
import { createHgssSafariRuntimeCoordinator, HGSS_SAFARI_EXIT_SCRIPT_ID, type HgssSafariBattleFinish } from './game/safari/hgssSafariRuntimeCoordinator'
import { projectHgssSafariBattleFinishOutcome } from './game/safari/hgssSafariBattleOutcomeProjection'
import { finishHgssSafariHostCall, prepareHgssSafariIncomingCallPresentation, type HgssSafariIncomingCallPresentation } from './game/safari/hgssSafariHostRuntime'
import { answerHgssSafariIncomingCall, resolveHgssSafariIncomingCall } from './game/safari/hgssSafariPhoneRuntime'
import { getHgssSafariObjectConfig, HGSS_SAFARI_MAP_ID, resolveHgssSafariObjectModelId } from './game/safari/hgssSafariMap'
const developmentParameters = import.meta.env.DEV ? new URLSearchParams(window.location.search) : undefined
const realtimeTestMode = developmentParameters?.get('test') === '1'
const disposableDebugSession = realtimeTestMode || developmentParameters?.has('debugMap') === true
const developmentToolsVisible = developmentParameters?.get('bot') === '1' || realtimeTestMode

function syncSingleScreenLayout(): void {
  syncBrowserSingleScreenLayout(window, document.documentElement)
}
syncSingleScreenLayout()
const app = document.querySelector<HTMLDivElement>('#app')!
const shell = renderAppShell(app)
const {
  picker, chooseRom, runtimePanel, status, saveStatus, details, inventorySection, inventorySummary, inventoryNote, filter, fileListBody,
  archiveInspector, archiveTitle, archiveSummary, archiveListBody, archiveNote, closeArchive, graphicPreview, graphicCanvas,
  graphicCaption, resourceCatalog, catalogGrid, gameMenu, pcBox, safariCustomizer, safariDecorator, photoAlbum, inGameHud,
  runtimePosition, screenCanvas, runtimeCanvas, gameMenuButton, gameMenuButtonKey, fullscreenButton,
  bugReportModal, bugReportDescription, bugReportPreview, bugReportStatus, bugReportCancel, bugReportEdit, bugReportDownload, fieldFade,
  pokegearFlyTransition,
  fieldDialogue, fieldDialogueSpeaker, fieldDialogueText, fieldChoice, fieldNumber, fieldNumberInput, fieldNickname,
  fieldNicknameInput, fieldEasyChat, fieldEasyChatCategories, fieldEasyChatWords, fieldPokeathlon,
  fieldPokeathlonTitle, fieldPokeathlonContent, fieldFrontierRecords, fieldFrontierRecordsTitle, fieldFrontierRecordsView,
  fieldFrontierRecordsContent, fieldAlphPuzzle, fieldAlphPuzzleBoard, fieldAlphPuzzleHint, fieldAlphInscription,
  fieldAlphInscriptionVisual, fieldAlphInscriptionWord, modalConfirm, modalConfirmText, battleScreen, battleBackground,
  battleOpponentTrainer, battleOpponentSprite, battlePlayerSprite, battleOpponentParty, battlePlayerParty, battleOpponentName,
  battlePlayerName, battleOpponentLevel, battlePlayerLevel, battleOpponentHp, battlePlayerHp, battlePlayerHpText,
  battlePlayerExp, battleMessage, battleCommands, battleMoves, battleEvolution, battleEvolutionKicker, battleEvolutionFrom,
  battleEvolutionTo, battleEvolutionTitle, battleEvolutionText,
} = shell
// Installer le filet de diagnostic avant l'initialisation des runtimes : une
// panne de rendu ou de composition précoce doit rester visible au joueur.
const { errors: recentDiagnosticErrors, inputs: recentDiagnosticInputs, statuses: recentDiagnosticStatuses } = installRuntimeDiagnosticLog(status)
const deferredUtilityMenuHost = createDeferredBrowserUtilityMenuHost()
const {
  require: getUtilityMenuHost,
  createPokedexPresentationOptions,
  createGraphicCanvas: createUtilityMenuGraphicCanvas,
  createPokemonCanvas: createUtilityMenuPokemonCanvas,
  createButton: createUtilityMenuButton,
  render: renderMainMenu,
  syncCursor: syncMainMenuCursor,
  syncPokedex: syncSelectedPokedexMenu,
  syncTeam: syncSelectedTeamMenu,
  syncTeamSummaryPage: syncSelectedTeamSummaryPage,
  syncTeamSummaryPokemon: syncSelectedTeamSummaryPokemon,
  syncBagPocket: syncUtilityBagPocket,
  syncBagItemDetail: syncUtilityBagItemDetail,
  syncOptions: syncUtilityMenuOptionPresentation,
  applyResult: applyMainMenuResult,
  setOpen: setMenuOpen,
} = deferredUtilityMenuHost
const botToggle = shell.botToggle!, botStatus = shell.botStatus!, realtimeTestPanelRoot = shell.realtimeTestPanel
if (import.meta.env.DEV) { botToggle.closest<HTMLElement>('.bot-controls')!.hidden = !developmentToolsVisible; realtimeTestPanelRoot!.hidden = !realtimeTestMode }
const pokegearFlyRuntime = createPokegearFlyRuntime(
  pokegearFlyTransition,
  runtimeCanvas,
  () => document.createElement('canvas'),
  () => ({
    safariActive: fieldScriptState.safariZone.session.active, inventory: currentInventory, session: worldSession,
    badges: fieldScriptState.badges, party: fieldScriptState.party.members,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    createCarrierAsset: (pokemon) => createUtilityMenuPokemonCanvas(pokemon.speciesId, pokemon.form, pokemon.isEgg, pokemon.shiny, pokemon.gender, 'battle'),
    closeMenu: () => { renderMainMenu(mainMenu.close()) }, refreshMenu: () => { renderMainMenu(mainMenu.refresh()) }, clearMovementInput,
    playCry: (speciesId) => { void audioRuntime?.playCry(speciesId, 0).catch(() => undefined) }, resetPhoneRing: () => { fieldPhoneRing.reset() },
    loadMap: (map) => { loadMap(map, 'transition') }, waitForMapPresentation: () => new Promise((resolve) => { requestAnimationFrame((now) => { runtime.renderFrame(now); resolve() }) }), setStatus: (message) => { status.textContent = message },
  }),
)
const inputPrompts = createInputPromptController(document.documentElement, gameMenuButton, gameMenuButtonKey)
const unifiedPcEntry = createUnifiedPcEntryCoordinator()
const gameplayExtensionRuntime = createGameplayExtensionRuntime(baseGameplayExtensionPorts)
const gameplayExtensionPorts = gameplayExtensionRuntime.ports
const fieldScriptExtensionPolicies = [gameplayExtensionPorts.pokemonPartyHealingPolicy, gameplayExtensionPorts.pokemonTeamPolicy, gameplayExtensionPorts.pokemonInitialTeamResolver, gameplayExtensionPorts.pokemonLevelPolicy, gameplayExtensionPorts.fieldBattleFormatResolver, () => runtime.getFollowerMapObjectSignal()] as const
const pcBoxUi = createPcBoxController(pcBox, { teamPolicy: gameplayExtensionPorts.pokemonTeamPolicy,
  readContext: () => ({ party: fieldScriptState.party, storage: fieldScriptState.pokemonStorage, pokemonCatalog: currentInventory?.pokemonCatalog, typeNames: currentInventory?.pokedexCatalog.typeNames, boxNames: currentInventory?.storageBoxNames, playerName: playerProfile.name, romMessages: currentInventory?.uiMessageBanks[191], storageMessages: currentInventory?.uiMessageBanks[24], partyMessages: currentInventory?.uiMessageBanks[6], summaryMessages: currentInventory?.uiMessageBanks[302] }),
  createPokemonIcon: (pokemon) => createUtilityMenuPokemonCanvas(pokemon.speciesId, pokemon.form, pokemon.isEgg, pokemon.shiny, pokemon.gender, 'battle'), createHeldItemIcon: (itemId) => currentInventory ? createUtilityMenuGraphicCanvas(currentInventory.itemIconResolver(itemId)) : undefined, getItemName: (itemId) => currentInventory?.itemCatalog.items[itemId]?.name, takeHeldItem: (pokemon) => { if (!currentInventory) return false; const result = takeHeldItemFromPokemon(fieldScriptState.inventory, currentInventory.itemCatalog, pokemon, currentInventory.pokemonCatalog); if (result.kind !== 'taken') return false; syncFollowerPresentation(true); persistCurrentSession('auto', true); return true },
  onCommit: (party, storage) => { replacePokemonParty(fieldScriptState.party, party.members); fieldScriptState.pokemonStorage = storage; syncFollowerPresentation(true); persistCurrentSession('auto', true) },
  onCurrentBoxChange: (box) => { fieldScriptState.pokemonStorage.currentBox = box; persistCurrentSession('auto', true) }, onRender: () => inputPrompts.refresh(),
  onClose: () => { if (!activeFieldScript) return; unifiedPcEntry.applicationClosed(); activeFieldScript.closePcBox(); advanceFieldScript() },
})
const fieldPokemonPortrait = document.createElement('div')
fieldPokemonPortrait.className = 'field-pokemon-portrait'
fieldPokemonPortrait.hidden = true
fieldPokemonPortrait.setAttribute('aria-hidden', 'true')
fieldDialogue.parentElement?.append(fieldPokemonPortrait)
createUiLayerCoordinator(runtimePanel)
function setBattleUiMode(mode: typeof battleUiMode, canCancel = mode !== 'message' && mode !== 'command'): void {
  battleUiMode = mode
  battleScreen.dataset.uiMode = mode
  syncBattleControlHints(battleScreen, mode, canCancel, currentInventory?.uiMessageBanks)
  inputPrompts.refresh()
}
type BattlePresentationPhase = 'entering' | 'introduction' | 'command' | 'action' | 'exiting'
function prefersReducedBattleMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
function setBattlePresentation(phase: BattlePresentationPhase): void {
  battleScreen.dataset.presentation = phase
  if (phase !== 'entering') delete battleScreen.dataset.entryOverlay
}
function restartBattleAnimation(element: HTMLElement, className: string): BattleCssAnimationRun {
  return restartBattleCssAnimation(element, className)
}
async function playBattleCaptureAnimation(mode: 'normal' | 'safari', itemId: number, shakes: 0 | 1 | 2 | 3 | 4, caught: boolean): Promise<void> {
  const ball = battleScreen.querySelector<HTMLElement>('.battle-pokeball-player')
  const inventory = currentInventory
  if (!ball || !inventory) return
  const capturedOpponent = activeBattle?.opponent.pokemon ?? (activeDoubleBattle?.kind === 'wild' ? getDoubleBattlePokemon(activeDoubleBattle, { side: 'opponent', slot: 0 }) : undefined) ?? activeSafariBattlePokemon
  battleMessageInputLocked = true
  const generation = battlePresentationGeneration
  const lease = createBattlePresentationLease(battlePresentationSkip)
  try {
    await playHgssBattleCaptureAnimation({ mode, itemId, shakes, caught, ball, opponent: battleOpponentSprite,
      resolveBallAsset: inventory.battleAnimationCatalog.ballSpriteResolver,
      createGraphic: (graphic) => menuCanvasAssets.createGraphicCanvas(graphic), createItemIcon: (id) => menuCanvasAssets.createGraphicCanvas(inventory.itemIconResolver(id)),
      playSoundEffect: (sequenceId) => audioRuntime?.playSoundEffect(sequenceId), playPannedSoundEffect: (sequenceId, pan) => audioRuntime?.playPannedSoundEffect(sequenceId, pan),
      playPokemonSendOut: capturedOpponent ? (ballId, host, opponent) => battlePokemonSendOut.play([
        { side: 'opponent', slot: 0, pokemon: capturedOpponent, ballId, sprite: opponent },
      ], { mode: 'release-only', host })?.finished.then(() => undefined) : undefined,
      waitFrames: lease.waitFrames,
      reducedMotion: prefersReducedBattleMotion(), isCurrent: () => generation === battlePresentationGeneration, onOutcomeAnimationStart: (outcome) => { if (outcome === 'click') restartBattleAnimation(battleScreen, 'is-capture-success') },
    })
  } finally {
    lease.close()
    if (generation === battlePresentationGeneration) battleMessageInputLocked = false
  }
}
function playQueuedBattleCapture(itemId: number, shakes: 0 | 1 | 2 | 3 | 4, caught: boolean): void {
  const battle = activeBattle ?? activeDoubleBattle
  void playBattleCaptureAnimation('normal', itemId, shakes, caught).catch(() => undefined).then(() => { if ((activeBattle ?? activeDoubleBattle) === battle) showNextBattleMessage() })
}
function fadeBattleCapturedBallAfterMessage(): void {
  const ball = battleScreen.querySelector<HTMLElement>('.battle-pokeball-player')
  if (!ball) return
  battleMessageInputLocked = true
  const generation = battlePresentationGeneration
  const lease = createBattlePresentationLease(battlePresentationSkip)
  void lease.waitFrames(prefersReducedBattleMotion() ? 0 : 30).then(() => fadeHgssCapturedBall({ ball, waitFrames: lease.waitFrames, reducedMotion: prefersReducedBattleMotion(), isCurrent: () => generation === battlePresentationGeneration })).finally(() => {
    lease.close()
    if (generation === battlePresentationGeneration) battleMessageInputLocked = false
  })
}
function animateBattleProgress(progress: HTMLProgressElement, hpText: HTMLElement | null, amount: number): Promise<void> {
  if (amount === 0) return Promise.resolve()
  const from = progress.value
  const to = resolveBattleGaugeTarget(from, progress.max, amount)
  const timing = resolveBattleGaugeAnimationTiming(from, to, progress.max, prefersReducedBattleMotion())
  const version = (battleGaugeAnimationVersions.get(progress) ?? 0) + 1
  const generation = battlePresentationGeneration
  battleGaugeAnimationVersions.set(progress, version)
  const lease = createBattlePresentationLease(battlePresentationSkip)
  battleHpAnimationLocks += 1
  const render = (value: number) => {
    progress.value = value
    syncBattleHpZone(progress)
    if (hpText) hpText.textContent = `${progress.value} / ${progress.max}`
  }
  const isCurrent = () => generation === battlePresentationGeneration
    && battleGaugeAnimationVersions.get(progress) === version
  return animateSteppedBattleGauge(from, to, timing.duration, render, () => !lease.signal.aborted && isCurrent(), timing.steps)
    .finally(() => {
      if (isCurrent()) render(to)
      lease.close()
      if (generation === battlePresentationGeneration) battleHpAnimationLocks = Math.max(0, battleHpAnimationLocks - 1)
    })
}
function animateBattleHp(side: 'player' | 'opponent', amount: number): Promise<void> {
  return animateBattleProgress(
    side === 'player' ? battlePlayerHp : battleOpponentHp,
    side === 'player' ? battlePlayerHpText : null,
    amount,
  )
}
function beginBattleAction(moveType: number): void {
  battleActionLease?.close()
  battleActionLease = undefined
  battleScreen.dataset.actionType = String(moveType)
  setBattlePresentation('action')
}
function finishBattleAction(): void {
  battleActionLease?.close()
  const lease = createBattlePresentationLease(battlePresentationSkip)
  battleActionLease = lease
  void lease.waitFrames(prefersReducedBattleMotion() ? 0 : 25).then(() => {
    if (battleActionLease !== lease) return
    battleActionLease = undefined
    lease.close()
    delete battleScreen.dataset.actionType
    if ((activeBattle || activeDoubleBattle) && battleScreen.dataset.presentation === 'action') setBattlePresentation('introduction')
    battleMessageInputLocked = false
  })
}
const runtime = createBrowserMapRuntime(runtimeCanvas, status)
const gymMechanisms = createHgssGymCoordinator(runtime, (error) => { if (error) status.textContent = error.message; syncFieldScriptPlayerStateFromWorld(); sessionAutosave.schedule(0) }, (task, message) => waitForOptionalFieldScriptPresentation('gymMechanism', task, message, { afterResume: () => sessionAutosave.schedule(0) }), (sequenceId) => { void audioRuntime?.playSoundEffect(sequenceId).catch(() => undefined) }, (sequenceId) => audioRuntime?.stopSoundEffect(sequenceId))
const gameScreenRuntime = createGameScreenRuntime(screenCanvas, runtimePanel)
const gameKeyboardCodes = [
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Space', 'Escape', 'Backspace',
  'ShiftLeft', 'ShiftRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyX', 'KeyM', 'PageUp', 'PageDown',
]
const fullscreenController: GameFullscreenController = createGameFullscreenController({
  document,
  window,
  navigator,
  panel: runtimePanel,
  button: fullscreenButton,
  keyboardCodes: gameKeyboardCodes,
  onChange: ({ previouslyActive, active, exitRequested }) => {
    syncSingleScreenLayout()
    fullscreenController.focus(true)
    if (mainMenu.getState().open) syncUtilityMenuOptionPresentation()
    if (shouldDispatchFullscreenBack(previouslyActive, active, exitRequested)) inputRouter.pointer('cancel')
  },
  onRequestResult: (enabled) => {
    status.textContent = enabled
      ? 'Plein écran activé. La manette contrôle le jeu.'
      : 'Le plein écran a été refusé par le navigateur.'
  },
})
const menuCanvasAssets = createCanvasAssetCache()
const battlePokemonSpriteAnimator = createBattlePokemonSpriteAnimator({
  resolveBattleFrameHost: getBattlePokemonSpriteFrame,
  mountGraphicCanvas: (host, graphic) => menuCanvasAssets.mountGraphicCanvas(host, graphic),
})
const battleEntryTransition = createBattleEntrySceneTransitionController({
  host: runtimePanel,
  screen: battleScreen,
  createOverlay: () => document.createElement('div'),
  schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clearSchedule: (handle) => window.clearTimeout(handle),
  reducedMotion: prefersReducedBattleMotion,
})
const battlePokemonSendOut = createBattlePokemonSendOutRuntime({
  readStage: () => battleScreen.querySelector<HTMLElement>('.battle-stage'), readBallHost: (side) => battleScreen.querySelector<HTMLElement>(`.battle-pokeball-${side}`),
  readResources: () => currentInventory && ({ ballSpriteResolver: currentInventory.battleAnimationCatalog.ballSpriteResolver, createGraphic: (graphic) => menuCanvasAssets.createGraphicCanvas(graphic), playSoundEffect: (sequenceId) => audioRuntime?.playSoundEffect(sequenceId) }),
  playCrySequence: (speciesIds, _entries, isCurrent) => playRomCrySequence(audioRuntime, speciesIds.map((speciesId) => ({ speciesId })), { isCurrent }).then(() => undefined),
  reducedMotion: prefersReducedBattleMotion, readGeneration: () => battlePresentationGeneration, register: trackBattleAnimationStep,
})
const utilityMenuPokemonAnimations = createPokemonUiAnimationRegistry((frame) => menuCanvasAssets.getGraphicCanvas(frame))
const pokemonUiSprites = createPokemonUiSpritePresentation({
  createGraphicCanvas: (graphic) => createUtilityMenuGraphicCanvas(graphic),
  resolveFrameCanvas: (graphic) => menuCanvasAssets.getGraphicCanvas(graphic),
  createPokedexHost: () => document.createElement('span'),
})
const titleMenu = createTitleMenuController()
const onlineAccountSession = readBrowserOnlineAccountSession()
const titlePersistenceStorage = disposableDebugSession ? createEphemeralStorageOverlay(window.localStorage) : window.localStorage
const titleSaveAccess = createBrowserTitleSaveAccess({ storage: titlePersistenceStorage, keyStorage: window.localStorage, config: readOnlineClientConfig(), accountSession: onlineAccountSession, reportStatus: (message) => { status.textContent = message } })
const gameAccessGate = createGameAccessGate({
  readState: () => {
    const access = onlineAccountSession.getAccessSnapshot()
    return {
      authentication: access.signedIn ? 'signed-in' : 'anonymous',
      subscription: access.premiumClient ? 'active' : access.signedIn ? 'inactive' : 'unknown',
    }
  },
})
const inventoryView: InventoryView = {
  details,
  inventorySection,
  inventorySummary,
  inventoryNote,
  fileListBody,
  archiveInspector,
  archiveTitle,
  archiveSummary,
  archiveListBody,
  archiveNote,
  graphicPreview,
  graphicCanvas,
  graphicCaption,
  resourceCatalog,
  catalogGrid,
}
let currentFiles: RomFile[] = []
let playerTextureStatus = 'joueur ROM non decode'
type GameFlowState = 'empty' | 'boot' | 'title' | 'intro' | 'bedroom'
let gameFlowState: GameFlowState = 'empty'
let currentInventory: RomInventory | undefined
let worldSession: WorldSession | undefined
const getCurrentHgssFieldBattleEnvironment = () => {
  const world = worldSession?.getState()
  return resolveHgssFieldBattleEnvironment({
    terrainAttribute: world && worldSession?.getTerrainAttributeAt(world.tileX, world.tileZ),
    mapBattleBackgroundId: world?.map.header.battleBackground ?? 0,
    locomotion: world?.locomotion ?? 'walking',
  })
}
let openingStartedAt = 0
let playerProfile = createDefaultPlayerProfile()
let gameOptions = createDefaultHgssGameOptions()
const localWeatherService = createLocalWeatherService()
let audioRuntime: RomAudioRuntime | undefined
const gameTextEntry = createGameTextEntryOverlay(runtimePanel, {
  onFeedback: (feedback) => {
    const sequenceId = feedback === 'submit'
      ? hgssMultiplayerUiSoundEffects.select
      : feedback === 'invalid'
        ? hgssMultiplayerUiSoundEffects.unavailable
        : feedback === 'page' || feedback === 'cancel'
          ? hgssMultiplayerUiSoundEffects.page
          : hgssMultiplayerUiSoundEffects.cursor
    void audioRuntime?.playSoundEffect(sequenceId).catch(() => undefined)
  },
})
const starterCryPreview = createStarterCryPreview((speciesId, pattern) => {
  if (!audioRuntime) return Promise.reject(new Error('L’archive audio ROM n’est pas chargee.'))
  return audioRuntime.playCry(speciesId, pattern)
})
const starterModelRenderer = createTitleModelRenderer()
const safariObjectModelRenderer = createTitleModelRenderer()
let appliedPlayerGender: PlayerGender | undefined
let appliedPlayerLocomotion: PlayerLocomotionMode | undefined
let appliedPlayerState: number | undefined
let activeFieldScript: FieldScriptRunner | undefined
const fieldScriptExecution = createFieldScriptExecutionState<FieldScriptRunner>({
  read: () => activeFieldScript,
  write: (runner) => { activeFieldScript = runner },
})
let fieldScriptState: FieldScriptState = createFieldScriptState(playerProfile.gender, playerProfile.name)
let fieldWeather: HgssWeather | undefined
const currentHgssTimeOfDay = () => refreshHgssTimeOfDayState(fieldScriptState)
const hgssEnvironment = createHgssEnvironmentCoordinator({
  readSnapshot: () => {
    const world = worldSession?.getState()
    if (!world) return
    const now = fieldScriptState.pokemonRuntime?.now() ?? new Date()
    return {
      map: world.map,
      now,
      timeOfDay: currentHgssTimeOfDay(),
      weather: resolvePresentedHgssWeather(
        fieldWeather ?? fieldScriptState.weather,
        world.map.header.mapType,
        gameOptions.localWeather,
        localWeatherService.getSnapshot(),
      ),
      mapType: world.map.header.mapType,
      allowMusicTransition: gameFlowState === 'bedroom' && battleScreen.hidden && !activeFieldScript,
      radioMusicSequenceId: fieldScriptState.radioMusicSequenceId,
    }
  },
  applyPresentation: (environment) => runtime.setWorldEnvironment(environment),
  playMapMusic: (map, now) => audioRuntime?.playMapMusic(map, now),
})
const inGameHudController = createInGameHudController(inGameHud, () => {
  const world = worldSession?.getState()
  if (!world || gameFlowState !== 'bedroom' || !battleScreen.hidden) return { visible: false }
  const now = fieldScriptState.pokemonRuntime?.now() ?? new Date()
  return {
    visible: true,
    location: world.map.label,
    region: world.map.header.region === 1 ? 'Kanto' : 'Johto',
    now,
    money: fieldScriptState.money,
    phase: resolveHgssDayPhase(resolveHgssTimeOfDay(now)),
  }
})
let sessionRng: HgssSessionRng | undefined
let activeSaveExtensions: VersionedSaveExtensions | undefined
let activeNewGamePlusGameplayRuntime: NewGamePlusGameplayRuntime | undefined
const fieldMultiplayer = createHgssBrowserFieldMultiplayerComposition({
  readState: () => ({ gameActive: gameFlowState === 'bedroom', fieldBusy: Boolean(activeFieldScript || fieldExplorationRuntime?.isTransitionActive() || runtime.isPlayerMoving() || forcedPlayerMovement !== undefined || pendingCoordinateScriptId !== undefined || pendingWarpTarget !== undefined || pendingHeldWarpTarget !== undefined || pendingFieldStep !== undefined || pendingWildEncounterCheck || activeBattle || activeDoubleBattle || !battleScreen.hidden || fieldScriptState.safariZone.session.active), sessionRngReady: Boolean(sessionRng), inventory: currentInventory, fieldState: fieldScriptState, profile: playerProfile, world: worldSession, gameplay: gameplayExtensionPorts }),
  isFieldMutationBlocked: () => fieldObjectMotion.isInputBlocked(),
  dynamicActors: { readCurrentMapId: () => worldSession?.getState()?.map.id, resolveEventTexture: (spriteId) => currentInventory?.eventTextureResolver?.(spriteId), resolveSpeciesTexture: (speciesId, actor) => { const inventory = currentInventory; return inventory ? createMapDynamicPokemonSpeciesTextureResolver(inventory.pokemonCatalog, inventory.followerTextureResolver)(speciesId, actor) : undefined }, renderActors: runtime.syncDynamicPokemonActors, clearActors: runtime.clearDynamicPokemonActors },
  panel: runtimePanel, textEntry: gameTextEntry, runtimeOptions: { accountSession: onlineAccountSession, accountManagement: false }, readAccountAccess: onlineAccountSession.getAccessSnapshot,
  checkMultiplayerAccess: () => gameAccessGate.check('multiplayer'),
  createPokemonVisual: (request) => createUtilityMenuPokemonCanvas(request.speciesId, request.form, request.isEgg, request.shiny, request.gender, 'battle'),
  readSaveExtensions: () => activeSaveExtensions,
  writeSaveExtensions: (extensions) => { activeSaveExtensions = extensions },
  persistState: (candidate) => { if (!sessionPersistence.persist(candidate, 'auto', true)) throw new Error('La sauvegarde atomique a échoué.') },
  publishState: (candidate) => { fieldScriptState = candidate; runtime.syncEventVisibility(candidate); syncFollowerPresentation(true); inGameHudController.update(true) },
  presentLocalTurn: (direction, durationMs) => { runtime.setPlayerDirection(direction); syncFieldScriptPlayerStateFromWorld(); playerTurnReadyAt = performance.now() + durationMs },
  presentLocalStep: (result, duration) => { syncFieldScriptPlayerStateFromWorld(); blockedInputUntil = 0; runtimePosition.textContent = runtime.setPlayerPosition(result.state.tileX, result.state.tileZ, result.state.direction, true, result.state.groundHeight, duration, result.movement); sessionAutosave.schedule() },
  presentLocalTransition: (result, presentation) => { fieldExplorationRuntime.presentAuthoritativeTransition(result, presentation) },
  onFieldLockChanged: (locked) => {
    runButtonPressed = false; clearMovementInput(); forcedPlayerMovement = undefined; discardPendingFieldStep()
    if (locked) runtime.setFollowerPosition(undefined)
    else void fieldExplorationRuntime.activatePresentedMap().then((activated) => {
      if (!activated && !pageCheckpoint.isReleasing()) { syncFollowerPresentation(false); sessionAutosave.schedule() }
    }).catch((error: unknown) => {
      status.textContent = error instanceof Error ? error.message : 'Activation Coop impossible.'
    })
  },
  reportStatus: (message) => { status.textContent = message }, playSoundEffect: (sequenceId) => audioRuntime?.playSoundEffect(sequenceId),
  onOpen: () => { runButtonPressed = false; clearMovementInput() }, onClose: () => { fullscreenController.focus(true) },
})
const { campaign: fieldCampaign, actors: dynamicWorldActorHost, host: browserMultiplayerHost } = fieldMultiplayer
const activateGameplayPorts = (ports = baseGameplayExtensionPorts): void => { gameplayExtensionRuntime.activate(fieldMultiplayer.composeGameplay(ports)) }
activateGameplayPorts()
const newGamePlusWorldHost = createBrowserNewGamePlusWorldComposition({
  readRuntime: () => activeNewGamePlusGameplayRuntime, readInventory: () => currentInventory,
  readWorldSession: () => worldSession, readFieldState: () => fieldScriptState,
  prepareSafariEncounter: (request) => safariBattle.prepareEncounterAt(request),
  hasDynamicBlockingActor: (mapId, tileX, tileZ, excludedActorId) => gameplayExtensionPorts.worldSessionExtensionPorts.dynamicActors.getBlockingActorsAt(mapId, tileX, tileZ, excludedActorId).length > 0,
  renderActors: (actors) => { dynamicWorldActorHost.setSourceActors('new-game-plus', actors) },
  startPreparedWildEncounter, startQuestWildEncounter: startAllPokemonQuestWildEncounter,
})
let inGameTimeClock = createHgssInGameTimeClock()
let rtcPenaltyState: HgssRtcPenaltyState = createHgssRtcPenaltyState(new Date())
function resetInGameTimeClock(initial?: Parameters<typeof createHgssInGameTimeClock>[0]): void {
  inGameTimeClock.pause(); inGameTimeClock = createHgssInGameTimeClock(initial)
  fieldPhoneRing.reinitializeIncomingCallGate(inGameTimeClock.totalMinutes())
  if (gameFlowState === 'bedroom' && document.visibilityState !== 'hidden') inGameTimeClock.resume()
}
let pendingTitleSaves: TitleSaveCatalog['saves'] = new Map()
let pendingTitleCorruptSaves: TitleSaveCatalog['corruptSaves'] = new Map()
let activeSaveSlot: HgssBrowserSaveSlot = 1
const titleCampaignStorage = titleSaveAccess.campaignStorage
function activateTitleCampaignProfile(profile: NewGamePlusProfileV1 | undefined, extensions: VersionedSaveExtensions | undefined, kind: TitleCampaignActivationKind): void {
  activeNewGamePlusGameplayRuntime = createTitleNewGamePlusRuntime({ profile, extensions, kind, inventory: currentInventory, readFieldState: () => fieldScriptState })
  activateGameplayPorts(activeNewGamePlusGameplayRuntime?.ports)
  if (!profile) newGamePlusWorldHost.clear()
}
const titleCampaign: TitleCampaignCoordinator = createTitleCampaignCoordinator({
  host: runtimePanel,
  menuRoot: gameMenu,
  menu: titleMenu,
  storage: titleCampaignStorage, allowPreparedNewGamePlusStart: import.meta.env.DEV && realtimeTestMode,
  readInventory: () => currentInventory,
  readSaves: () => pendingTitleSaves,
  readCorruptSaves: () => pendingTitleCorruptSaves,
  createPokemonIcon: createUtilityMenuPokemonCanvas,
  onActivateProfile: activateTitleCampaignProfile,
  onResume: (slot, save) => {
    if (!currentInventory) return
    restoreCurrentSession(currentInventory, save.restored, gameOptions)
    activeSaveSlot = slot
    lastSessionSaveAt = save.savedAt
    status.textContent = `Emplacement ${slot} · partie de ${save.restored.profile.name} reprise.`
  },
  onBegin: beginTitleNewGame, onExit: titleSaveAccess.deactivateCloud,
  deleteSave: titleSaveAccess.deleteSlot, onDelete: (slot) => { pendingTitleSaves.delete(slot); pendingTitleCorruptSaves.delete(slot) },
  reportStatus: (message) => { status.textContent = message },
  checkFeatureAccess: gameAccessGate.check,
  playSoundEffect: (sequenceId) => { void audioRuntime?.playSoundEffect(sequenceId).catch(() => undefined) },
})
const titleAccountGate = createTitleAccountGateHost({
  host: runtimePanel,
  session: onlineAccountSession,
  requestTextEntry: (request: GameTextEntryRequest) => { gameTextEntry.open(request) },
  onAuthenticated: titleSaveAccess.prepareAuthentication,
  onAuthorizeCatalogAccess: authorizeTitleSaveCatalog,
  onCancel: () => { titleSaveAccess.deactivateCloud(); fullscreenController.focus(true) },
})
let lastSessionSaveAt: string | undefined
const recordBattleAnimationDiagnostic = createDeduplicatedDiagnosticRecorder(recentDiagnosticStatuses, 'battle-animation-fallback', 80)
const collectBugDiagnostics = createGameBugDiagnosticsCollector({
  readState: () => ({
    game: {
      flow: gameFlowState,
      activeSaveSlot,
      lastSessionSaveAt,
      frameCounter: vblankCounter,
      options: gameOptions,
      profile: playerProfile,
      rom: currentInventory?.metadata,
    },
    script: {
      activeFieldScript,
      activeDoorTransition: fieldExplorationRuntime?.isTransitionActive() ?? false,
      pendingWarpTarget,
      pendingCoordinateScriptId,
      pendingWildEncounterCheck,
      forcedPlayerMovement,
    },
    battle: {
      active: activeBattle,
      activeDouble: activeDoubleBattle,
      uiMode: battleUiMode,
      cursor: battleUiCursor,
      messageQueue: battleMessageQueue,
      messageInputLocked: battleMessageInputLocked,
      presentationAnimationLocks: battlePresentationAnimationLocks,
      playerSlot: activeBattlePlayerSlot,
      opponentSlot: activeBattleOpponentSlot,
      preparedEncounter: preparedFieldWildEncounter,
    },
    ui: { utilityNotice: utilityMenuSelection.notice },
    logs: {
      errors: recentDiagnosticErrors,
      inputs: recentDiagnosticInputs,
      statuses: recentDiagnosticStatuses,
    },
  }),
  readWorldSession: () => worldSession,
  readMovementRuntime: () => runtime,
  readScriptExecution: () => fieldScriptExecution,
  readDialogueRuntime: () => fieldDialogueRuntime,
  readMainMenu: () => mainMenu,
  readTitleMenu: () => titleMenu,
  readOakIntroRuntime: () => oakIntroRuntime,
  readDialogueSpeaker: () => fieldDialogueSpeaker.textContent,
  readFadeOpacity: () => fieldFade.style.opacity || window.getComputedStyle(fieldFade).opacity,
  readVisibleElements: () => collectVisibleBugReportElements(runtimePanel),
  createReproductionState: (world, follower) => {
    if (!currentInventory || !sessionRng) return undefined
    return createHgssSaveState(
      currentInventory.metadata.gameCode,
      playerProfile,
      sessionRng,
      projectHgssSavedWorldPosition(world, follower),
      fieldScriptState,
      gameOptions,
      inGameTimeClock.snapshot(),
      rtcPenaltyState,
      titleCampaign.getActiveProfile(),
      activeSaveExtensions,
    )
  },
})
const bugReportHost = createBrowserBugReportHost({ elements: { modal: bugReportModal, description: bugReportDescription, preview: bugReportPreview, status: bugReportStatus, cancel: bugReportCancel, edit: bugReportEdit, download: bugReportDownload }, captureRoot: runtimePanel, textEntry: gameTextEntry,
  readSaveSlot: () => activeSaveSlot, collectDiagnostics: collectBugDiagnostics, renderFrame: () => { runtime.renderFrame() }, clearInput: clearMovementInput, focusGame: () => { fullscreenController.focus(true) },
  recordError: (kind, error) => { appendDiagnosticEntry(recentDiagnosticErrors, { at: new Date().toISOString(), kind, detail: diagnosticErrorDetail(error) }, 40) } })
let fieldEncounterSession: HgssFieldEncounterSession | undefined
let pendingEncounterRepelProtection = false
let preparedFieldWildEncounter: (PreparedFieldWildEncounter & { speciesName: string, pokemon: CanonicalPokemon }) | undefined
let activeBattleRoamerId: number | undefined
let activeBattle: SimpleBattleSession | undefined
let activeDoubleBattle: DoubleBattleSession | undefined
const realtimeBattleDebug = import.meta.env.DEV ? createRealtimeBattleDebugController() : undefined
let doubleBattleCommandSelection = createDoubleBattleCommandSelectionState()
let activeBattlePlayerSlot = 0
let activeBattleOpponentSlot = 0
let activeBattleParticipantSlots = new Set<number>()
let activeBattlePlayerParty: CanonicalPokemon[] = []
let activeBattleOpponentParty: CanonicalPokemon[] = []
let activeBattleScript: FieldScriptRunner | undefined
let battleUiMode: 'message' | 'command' | 'moves' | 'doubleTarget' | 'party' | 'bag' | 'bagTarget' | 'bagMove' | 'learnMove' = 'message'
let battlePartySelectionForced = false
let pendingBattleItemId: number | undefined
let pendingBattleItemTargetSlot: number | undefined
let battleUiCursor = 0
type FieldIncomingPhoneCall = { incoming: HgssPersistentIncomingCall, safari?: HgssSafariIncomingCallPresentation }
const fieldPhoneRing = createHgssPhoneRingSession<FieldIncomingPhoneCall>({
  isSoundPlaying: (sequenceId) => audioRuntime?.isSoundEffectPlaying(sequenceId) ?? false,
  playSound: (sequenceId) => { void audioRuntime?.playSoundEffect(sequenceId).catch(() => undefined) },
  stopSound: (sequenceId) => audioRuntime?.stopSoundEffect(sequenceId),
  onStateChange: (ringing) => {
    gameMenuButton.classList.toggle('is-phone-ringing', ringing)
    if (!ringing && !fieldDialogueRuntime.isPhoneActive()) fieldScriptState.pendingPhoneCall = undefined
    inputPrompts.refresh()
  },
})
const battleMoveLearning = createPokemonMoveLearningCoordinator<CanonicalPokemonPartyTarget>({
  requestConfirmation: (kind, request, resolve) => {
    const inventory = currentInventory
    const moveName = inventory?.pokemonCatalog.moveNames[request.moveId]
    if (!inventory || !resolveCanonicalPokemonPartyTarget(request.target, resolvePokemonPartySource) || !moveName) throw new Error(`Les données ROM requises pour apprendre la capacité ${request.moveId} sont absentes.`)
    requestYesNo(formatBattleRomMessage(inventory.battleMessages[kind === 'learn' ? 7 : 9] ?? '', [moveName]), resolve)
  },
  showChoices: showBattleMoveLearningChoice,
  resumeChoices: () => renderBattleCursor(battleMoves),
  commit: finishBattleMoveLearning,
})
const battleProgressionPresenter = createCanonicalBattleProgressionPresenter({
  getResources: () => currentInventory && ({ moveNames: currentInventory.pokemonCatalog.moveNames, battleMessages: currentInventory.battleMessages }),
  getPokemonName: pokemonBattleName,
  requestReplacement: (target, moveId) => { battleMoveLearning.start(target, moveId) },
})
let battleMessageInputLocked = false
let battlePresentationAnimationLocks = 0
let battleLaunchTimer: number | undefined
let battleExitTimer: number | undefined
let battleActionLease: ReturnType<typeof createBattlePresentationLease> | undefined
const battlePresentationSkip = createBattlePresentationSkipRegistry()
const battleGaugeAnimationVersions = new WeakMap<HTMLProgressElement, number>()
let battleHpAnimationLocks = 0
let battlePresentationGeneration = 0
function trackBattleAnimationStep(run: { finished: Promise<unknown>, cancel: () => void } | undefined): void {
  if (!run) return
  const generation = battlePresentationGeneration, unregister = battlePresentationSkip.register(run.cancel)
  battlePresentationAnimationLocks += 1
  void run.finished.catch(() => undefined).finally(() => {
    unregister()
    if (generation === battlePresentationGeneration) battlePresentationAnimationLocks = Math.max(0, battlePresentationAnimationLocks - 1)
  })
}
function playSimpleBattlePokemonSendOut(side: 'player' | 'opponent', pokemon: CanonicalPokemon, completionWindowFrames: number = HGSS_BATTLE_SEND_OUT_TIMING.switchWindowFrames, hud = true): void {
  const sprite = side === 'player' ? battlePlayerSprite : battleOpponentSprite
  const health = hud ? battleScreen.querySelector<HTMLElement>(`.battle-hud-${side}:not(.battle-hud-secondary)`) : undefined
  if (battlePokemonSendOut.play([{ side, slot: 0, pokemon, sprite, hud: health }], { completionWindowFrames })) return
  trackBattlePokemonReveal(revealBattlePokemon({ sprite, hud: health }))
  startRomCry(audioRuntime, pokemon.speciesId)
}
function trackBattlePokemonReveal(reveal: ReturnType<typeof revealBattlePokemon>): void {
  trackBattleAnimationStep(reveal.spriteAnimation)
  trackBattleAnimationStep(reveal.hudAnimation)
}

function resetBattlePresentationAsyncState(): void {
  battleEntryTransition.cancel()
  delete battleScreen.dataset.entryOverlay
  battlePresentationGeneration += 1
  battlePresentationSkip.clear()
  battleActionLease?.close()
  battleActionLease = undefined
  battlePresentationHost.cancelAsyncPresentation()
  battleHpAnimationLocks = 0
  battlePresentationAnimationLocks = 0
  battleMessageInputLocked = false
}

let pendingBlackoutFollowup: (() => void) | undefined
type BattleMessageEntry = BattleProgressionMessageEntry

let battleMessageQueue: BattleMessageEntry[] = []
const deferredBattleProgression = createBattleProgressionPresentationQueue<BattleMessageEntry>()
const pokemonTransformationSceneHost = createBrowserPokemonTransformationSceneHost({
  elements: {
    screen: battleScreen,
    scene: battleEvolution,
    kicker: battleEvolutionKicker,
    from: battleEvolutionFrom,
    to: battleEvolutionTo,
    title: battleEvolutionTitle,
    text: battleEvolutionText,
    message: battleMessage,
    commands: battleCommands,
    moves: battleMoves,
    nickname: fieldNickname,
    nicknameInput: fieldNicknameInput,
  },
  readContext: () => ({
    resources: currentInventory,
    bagInventory: fieldScriptState.inventory,
    teamPolicy: gameplayExtensionPorts.pokemonTeamPolicy,
    timeOfDay: currentHgssTimeOfDay(),
    vblank: vblankCounter,
    battleAnimations: gameOptions.battleAnimations,
    prefersReducedMotion: prefersReducedBattleMotion(),
    battleActive: activeBattle !== undefined || activeDoubleBattle !== undefined,
  }),
  getPokemonName: pokemonBattleName,
  sprites: {
    mountGraphicCanvas: (host, graphic) => menuCanvasAssets.mountGraphicCanvas(host, graphic),
    registerEvolution: battlePokemonSpriteAnimator.registerEvolution,
    restartEvolution: battlePokemonSpriteAnimator.restartEvolution,
    clearEvolution: battlePokemonSpriteAnimator.clearEvolution,
  },
  audio: {
    read: () => audioRuntime,
    resumeFieldMusic: () => {
      const worldState = worldSession?.getState()
      if (worldState) void playHgssFieldMusic(audioRuntime, worldState.map, fieldScriptState.radioMusicSequenceId)?.catch(() => {})
    },
  },
  party: {
    resolve: resolvePokemonPartySource,
    readFieldParty: () => fieldScriptState.party.members,
    synchronizeEvolution: (source, pokemon, partySlot) => {
      if (source.kind === 'single') {
        if (activeBattle && partySlot === activeBattlePlayerSlot) {
          activeBattle.player.pokemon = cloneCanonicalPokemon(pokemon)
          refreshActiveBattleSprite('player')
        }
        if (fieldScriptState.party.members[partySlot]) {
          fieldScriptState.party.members[partySlot] = cloneCanonicalPokemon(pokemon)
        }
        return
      }
      if (source.kind === 'double') {
        if (fieldScriptState.party.members[partySlot]) {
          fieldScriptState.party.members[partySlot] = cloneCanonicalPokemon(pokemon)
        }
        renderDoubleBattle()
        return
      }
      syncFollowerPresentation(true)
    },
    markCaught: (pokemon) => {
      markPokemonCaught(fieldScriptState.pokedex, pokemon, fieldScriptState.pokemonRuntime?.language)
    },
  },
  progression: {
    moveLearning: battleProgressionPresenter,
    replaceMessages: (entries) => { battleMessageQueue = [...entries] },
    prependMessages: (entries) => { battleMessageQueue.unshift(...entries) },
    clearMessages: () => { battleMessageQueue = [] },
    hasPendingMessages: () => battleMessageQueue.length > 0,
    showNextMessage: showNextBattleMessage,
    clearMoveLearning: battleMoveLearning.clear,
    resetPresentationAsyncState: resetBattlePresentationAsyncState,
    setMessageInputLocked: (locked) => { battleMessageInputLocked = locked },
  },
  field: {
    readEggHatchRunner: () => activeFieldScript,
    renderMenu: () => { renderMainMenu(mainMenu.getState()) },
    closeAndRefreshMenu: () => { mainMenu.close(); renderMainMenu(mainMenu.refresh()) },
    persistAuto: () => { persistCurrentSession('auto') },
    syncFollower: syncFollowerPresentation,
    advanceScript: advanceFieldScript,
  },
  input: {
    requestYesNo,
    setNicknameCancellable: (cancellable) => { fieldTextEntry.setNicknameCancellable(cancellable) },
    openNickname: () => { fieldTextEntry.openNickname() },
  },
  diagnostics: {
    recordEvolutionCompletionError: (error) => {
      appendDiagnosticEntry(recentDiagnosticErrors, {
        at: new Date().toISOString(),
        kind: 'evolution-completion-error',
        detail: diagnosticErrorDetail(error),
      }, 40)
    },
  },
})
let activeBattleHealAfterLoss = false
/** Trainer House: équipe temporaire plafonnée. */
let activeBattleRestorePlayerParty: CanonicalPokemon[] | undefined
let activeBattleSuppressProgression = false
const fieldBattleLauncher = createBrowserFieldBattleLauncher({
  readContext: () => ({
    inventory: currentInventory,
    state: fieldScriptState,
    formatPolicy: gameplayExtensionPorts.fieldBattleFormatResolver,
    rosterPolicy: gameplayExtensionPorts.fieldBattleRosterPolicy,
    teamPolicy: gameplayExtensionPorts.pokemonTeamPolicy,
    terrainId: getCurrentHgssFieldBattleEnvironment().terrainId,
    allBattlesInDuo: activeNewGamePlusGameplayRuntime?.getModuleRuntime(allBattlesInDuoModuleId) !== undefined,
  }),
  applyPolicy: (policy) => {
    activeBattleHealAfterLoss = policy.healAfterLoss
    activeBattleSuppressProgression = policy.suppressProgression
    activeBattleRestorePlayerParty = policy.restorePlayerParty
      ? fieldScriptState.party.members.map(cloneCanonicalPokemon)
      : undefined
  },
  startCatchingTutorialBattle,
  startSimpleBattle,
  startDoubleBattle,
  startCanonicalFieldWildBattle,
  observeStartedWildEncounter,
})
let activeBattleTutorialStep: 0 | 1 | 2 | undefined
let activeBattleOpponentTrainerIds: number[] = []
let activeBattleMoneySettled = false
let vblankCounter = 0
const vblankClock = createHgssVBlankClock()
let runButtonPressed = false
let fieldFadeRevision = 0
const multiplayerGateway = createBrowserHgssMultiplayerGateway()
const applyBattleProgression = createBattleProgressionApplicator(gameplayExtensionPorts.battleProgressionPolicy, gameplayExtensionPorts.pokemonLevelPolicy)
function resolveBattleBagActionRole(itemId: number, opponent: 'wild' | 'trainer'): BattleBagActionRole | undefined {
  const item = currentInventory?.itemCatalog.items[itemId]
  if (!item) return undefined
  const action = gameplayExtensionPorts.fieldBattleBagActionResolver(item, { opponent })
  return action.kind === 'blocked' ? undefined : action.kind
}
function rejectPlayerBattleAction(intent: PlayerBattleActionIntent): boolean {
  const veto = gameplayExtensionPorts.battleActionPolicy.vetoPlayerAction(intent)
  if (!veto) return false
  battleMessageQueue = [veto.reason]
  showNextBattleMessage()
  return true
}
const fieldChoiceHost = createFieldChoiceHost(fieldChoice, {
  createButton: () => document.createElement('button'),
  createElement: (tag) => document.createElement(tag),
  createShopPresentation: (step) => createHgssShopPresentation({
    step,
    shopMessages: currentInventory?.uiMessageBanks[191] ?? {},
    bagMessages: currentInventory?.uiMessageBanks[10] ?? {},
    martMessages: currentInventory?.uiMessageBanks[435] ?? {},
    createItemIcon: (itemId) => {
      if (!currentInventory) throw new Error('La ROM doit être chargée pour dessiner la boutique.')
      return createUtilityMenuGraphicCanvas(currentInventory.itemIconResolver(itemId))
    },
  }),
  createStarterMachine: () => starterModelRenderer.render(currentInventory?.starterMachineModel, undefined, undefined, undefined, 16 / 9),
  createStarterIcon: (choice) => {
    const starterSpeciesId = getHgssStarterSpeciesId(choice)
    const pokemonPreview = currentInventory?.pokemonIconResolver(starterSpeciesId)
    if (!pokemonPreview?.frames[0]) throw new Error(`L'icône ROM du starter ${starterSpeciesId} est indisponible.`)
    return pokemonUiSprites.createStarterIcon(pokemonPreview.frames)
  },
  createPartyChoice: (slot) => {
    const pokemon = fieldScriptState.party.members[slot]
    const pokemonPreview = pokemon && currentInventory && (pokemon.shiny && !pokemon.isEgg
      ? currentInventory.battlePokemonSpriteResolver({ speciesId: pokemon.speciesId, form: pokemon.form, gender: pokemon.gender, facing: 'front', shiny: true })
      : currentInventory.pokemonIconResolver(pokemon.speciesId, pokemon.form, pokemon.isEgg))
    if (!pokemon || !pokemonPreview?.frames[0]) {
      throw new Error(`L'icône ROM du Pokémon d’équipe ${slot} est indisponible.`)
    }
    return {
      icon: pokemonUiSprites.createStarterIcon(pokemonPreview.frames),
      name: pokemon.nickname ?? pokemon.speciesName,
      details: `${currentInventory?.uiMessageBanks[6]?.[23] ?? ''}${pokemon.level} · ${currentInventory?.uiMessageBanks[6]?.[28] ?? ''} ${pokemon.currentHp}/${pokemon.stats.hp}`,
      shiny: pokemon.shiny,
    }
  },
  formatOptionLabel: (label) => formatFieldMessage(label, fieldScriptState),
  previewStarter: (choice) => starterCryPreview.preview(choice),
  resetStarterPreview: () => starterCryPreview.reset(),
  clearStarterIcons: () => pokemonUiSprites.clearStarterIcons(),
  reportStarterPreviewError: (error) => {
    status.textContent = error instanceof Error ? error.message : 'Le cri du starter ROM ne peut pas être lu.'
  },
  onPointerInteraction: () => {
    if (botRunning) resetBot('Bot arrêté : choix repris manuellement.')
  },
  readRunner: () => {
    const runner = activeFieldScript
    return runner ? { choose: (value) => runner.choose(value), resume: advanceFieldScript } : undefined
  },
})
const fieldEasyChatHost = createFieldEasyChatHost({
  root: fieldEasyChat,
  categories: fieldEasyChatCategories,
  words: fieldEasyChatWords,
}, {
  createButton: () => document.createElement('button'),
  isPointerInput: () => document.documentElement.dataset.inputModality === 'pointer',
  readGridTemplateColumns: () => getComputedStyle(fieldEasyChatWords).gridTemplateColumns,
  readRunner: () => {
    const runner = activeFieldScript
    return runner ? {
      submit: (selection) => runner.submitEasyChat(selection),
      resume: advanceFieldScript,
    } : undefined
  },
})
const fieldRecordAppsHost = createFieldRecordAppsHost({
  pokeathlon: fieldPokeathlon,
  pokeathlonTitle: fieldPokeathlonTitle,
  pokeathlonContent: fieldPokeathlonContent,
  frontierRecords: fieldFrontierRecords,
  frontierRecordsTitle: fieldFrontierRecordsTitle,
  frontierRecordsView: fieldFrontierRecordsView,
  frontierRecordsContent: fieldFrontierRecordsContent,
}, {
  createElement: (tagName) => document.createElement(tagName),
  readRom: () => currentInventory && ({ pokeathlonDataMessages: currentInventory.pokeathlonDataMessages }),
  readRunner: () => activeFieldScript,
  onAdvance: advanceFieldScript,
  onGameClear: (firstClear) => titleCampaign.noteGameClear(firstClear),
})
const alphFieldUiHost = createAlphFieldUiHost({
  root: fieldAlphPuzzle,
  board: fieldAlphPuzzleBoard,
  hint: fieldAlphPuzzleHint,
  inscription: fieldAlphInscription,
  inscriptionVisual: fieldAlphInscriptionVisual,
  inscriptionWord: fieldAlphInscriptionWord,
}, {
  getGraphicCanvas: (graphic) => menuCanvasAssets.getGraphicCanvas(graphic),
  getMapLabel: () => worldSession?.getState()?.map.label ?? '',
  getQuitMessage: () => currentInventory?.uiMessageBanks[2]?.[5] ?? '',
  requestConfirmation,
  prefersReducedMotion: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  getAudio: () => audioRuntime,
  reportError: (message) => { status.textContent = message },
  readRunner: () => {
    const runner = activeFieldScript
    return runner ? {
      finishPuzzle: (solved) => runner.finishAlphPuzzle(solved),
      closeInscription: () => runner.closeAlphHiddenRoom(),
      resume: advanceFieldScript,
    } : undefined
  },
  onManualInteraction: (kind) => {
    if (!import.meta.env.DEV || !botRunning) return
    resetBot(kind === 'puzzle'
      ? 'Bot arrêté : puzzle repris manuellement.'
      : 'Bot arrêté : inscription reprise manuellement.')
  },
  createElement: (tagName) => document.createElement(tagName),
})
const fieldDialogueRuntime = createFieldDialogueRuntime({
  root: fieldDialogue,
  speaker: fieldDialogueSpeaker,
  text: fieldDialogueText,
}, {
  execution: fieldScriptExecution,
  advance: advanceFieldScript,
  clearMovement: clearMovementInput,
  getMaxColumns: () => getResponsiveHgssDialogColumns(runtimePanel.clientWidth || window.innerWidth),
  consumeFinalConfirmation: () => followerReactionRuntime.consumeMessageConfirmation(),
  onPhoneClosed: () => { fieldScriptState.pendingPhoneCall = undefined },
})
const followerReactionRuntime = createBrowserFollowerReactionRuntime({
  readState: () => fieldScriptState,
  readMapLabel: () => worldSession?.getState()?.map.label ?? '',
  readResources: () => {
    const inventory = currentInventory
    if (!inventory) throw new Error('Les ressources ROM du follower sont absentes.')
    return {
      catalog: inventory.followerReactionCatalog,
      resolveEmote: inventory.followerEmoteResolver,
      getItemName: (itemId: number) => inventory.itemCatalog.items[itemId]?.name,
    }
  },
  formatMessage: formatFieldMessage,
  runtime,
  readAudio: () => audioRuntime,
  dialogue: fieldDialogueRuntime,
  execution: fieldScriptExecution,
  clearMovement: clearMovementInput,
  giveFashionAccessory: (accessoryId) => {
    giveHgssFashionAccessory(fieldScriptState.fashionAccessories, accessoryId, 1)
  },
  reportStatus: (message) => { status.textContent = message },
  advance: advanceFieldScript,
  timer: {
    schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
    cancel: (handle) => window.clearTimeout(handle as number),
    framesToMilliseconds: hgssVBlanksToMilliseconds,
  },
})
const openFieldPhoneDialogue = fieldDialogueRuntime.openPhone
const confirmFieldMessage = fieldDialogueRuntime.confirm
const resumeFieldScriptInputWait = fieldDialogueRuntime.resumeInputWait
const skipAcknowledgedFieldMessageWait = fieldDialogueRuntime.skipAcknowledgedWait
const dismissAcknowledgedFieldMessage = fieldDialogueRuntime.dismiss
const hideFieldDialogueWindow = fieldDialogueRuntime.hide
const completeFieldMessageText = fieldDialogueRuntime.completeText
let pendingMenuNicknameSlot: number | undefined
let activeSafariBattlePokemon: CanonicalPokemon | undefined
let botRunning = false
let botNextActionAt = 0
let botDirectionCursor = 0
let botJourneyAgent: RealtimeJourneyAgent | undefined
let botJourneyKind: RealtimeTestBotJourney = 'opening', botJourneySeedOverride: number | undefined, botJourneyError: Error | undefined
const botTileAttempts = new Map<string, number>()
const botInspectedTiles = new Set<string>(), realtimeWonTrainerBattleIds = new Set<number>(), realtimeCampaignAudit = import.meta.env.DEV ? createRealtimeCampaignAudit() : undefined
const botDirections: Movement[] = [movementDirections.ArrowUp, movementDirections.ArrowRight, movementDirections.ArrowDown, movementDirections.ArrowLeft].filter((movement): movement is Movement => movement !== undefined)

const yesNoConfirmation = createYesNoConfirmationController({ root: modalConfirm, message: modalConfirmText })
const fieldTextEntry = createFieldTextEntryCoordinator({
  nicknameRoot: fieldNickname,
  nicknameInput: fieldNicknameInput,
  numberInput: fieldNumberInput,
  textEntry: gameTextEntry,
  submitNickname: submitFieldNickname,
  submitNumber: submitFieldNumber,
})
const safariCaptureNickname = createSafariCaptureNicknameController({
  battleScreen, root: fieldNickname, input: fieldNicknameInput,
}, {
  getAudio: () => audioRuntime,
  getNicknamePromptTemplate: () => currentInventory?.uiMessageBanks[249]?.[1],
  requestConfirmation: requestYesNo,
  setNicknameCancellable: fieldTextEntry.setNicknameCancellable,
  prepareNicknameInput: fieldTextEntry.openNickname,
})

const pokedexCaptureRegistration = createPokedexCaptureRegistrationHost({
  root: gameMenu, battleScreen,
  render: (pokemon) => { utilityMenuSelection.pokedexSpeciesId = pokemon.speciesId; const options = createPokedexPresentationOptions(mainMenu.getState()); if (!options) throw new Error("Les données ROM de l'enregistrement Pokédex sont absentes."); return createPokedexRegistrationPresentation(options, pokemon) },
  onVisibilityChange: () => inputPrompts.refresh(),
})

const safariBattle = createHgssSafariRuntimeCoordinator({
  screen: battleScreen, background: battleBackground, opponentTrainer: battleOpponentTrainer,
  opponentSprite: battleOpponentSprite, playerSprite: battlePlayerSprite,
  opponentParty: battleOpponentParty, playerParty: battlePlayerParty,
  message: battleMessage, commands: battleCommands, moves: battleMoves,
}, {
  readContext: () => {
    const inventory = currentInventory, world = worldSession?.getState(), pokemonRuntime = fieldScriptState.pokemonRuntime
    if (!inventory || !world || !pokemonRuntime) return undefined
    const origin = getMapOrigin(world.map), now = pokemonRuntime.now(), battle = getCurrentHgssFieldBattleEnvironment()
    return { inventory, safariZone: fieldScriptState.safariZone, party: fieldScriptState.party, pokemonStorage: fieldScriptState.pokemonStorage, pokedex: fieldScriptState.pokedex, eventFlags: fieldScriptState.flags, progression: { recordEncounterStarted: () => recordHgssWildEncounterStarted(fieldScriptState), recordOpponentFled: () => recordHgssWildOpponentFled(fieldScriptState), prepareCapture: (pokemon) => prepareHgssWildCaptureProgression(fieldScriptState, pokemon, { nativeGameLanguage: pokemonRuntime.language, johtoDexNumbers: inventory.pokedexCatalog.johtoDexNumbers }), commitCaptureBeforeStorage: (preparation, nickname) => commitHgssWildCaptureBeforeStorage(preparation, { nicknameWasEntered: hasHgssPokemonNicknameInput(nickname) }), completeCaptureAfterBattle: (preparation) => completeHgssWildCaptureAfterBattle(preparation, { onUrgentTriggerScheduled: () => fieldPhoneRing.primeUrgentIncomingCall() }) }, pokemonRuntime, playerName: playerProfile.name, world: { mapId: world.map.id, tileX: origin.x + world.tileX, tileZ: origin.z + world.tileZ, battleBackgroundId: battle.backgroundId, battleTerrainId: battle.terrainId, region: world.map.header.region, hour: now.getHours(), battlePaletteTime: resolveHgssBattlePaletteTime(currentHgssTimeOfDay()) }, teamPolicy: gameplayExtensionPorts.pokemonTeamPolicy }
  },
  createGraphicCanvas: (graphic) => menuCanvasAssets.createGraphicCanvas(graphic), mountGraphicCanvas: (host, graphic) => menuCanvasAssets.mountGraphicCanvas(host, graphic),
  playMusic: (sequenceId) => audioRuntime?.playMusic(sequenceId).catch(() => undefined),
  playSoundEffect: (sequenceId) => audioRuntime?.playSoundEffect(sequenceId).catch(() => undefined),
  playPannedSoundEffect: (sequenceId, pan) => audioRuntime?.playPannedSoundEffect(sequenceId, pan).catch(() => undefined), stopSoundEffect: (sequenceId) => audioRuntime?.stopSoundEffect(sequenceId),
  isAnySoundEffectPlaying: () => audioRuntime?.isAnySoundEffectPlaying() ?? false,
  playFanfare: (sequenceId) => audioRuntime?.playFanfare(sequenceId).catch(() => undefined),
  isFanfarePlaying: () => audioRuntime?.isFanfarePlaying() ?? false,
  playCry: (speciesId, pattern, pan, volume) => audioRuntime?.playCry(speciesId, pattern, pan, volume).catch(() => undefined), isCryPlaying: () => audioRuntime?.isCryPlaying() ?? false,
  playCaptureAnimation: (itemId, shakes, caught) => playBattleCaptureAnimation('safari', itemId, shakes, caught),
  getTextFrameDelay: () => getHgssTextFrameDelay(gameOptions.textSpeed),
  presentPokedexRegistration: (pokemon) => pokedexCaptureRegistration.open(pokemon),
  requestNickname: safariCaptureNickname.request,
  actionPolicy: gameplayExtensionPorts.battleActionPolicy,
  onActionVeto: (veto) => { status.textContent = veto.reason },
  onStart: resetBattlePresentationAsyncState, onFastForward: () => battlePresentationSkip.request(), onPresentationReset: () => battlePresentationSkip.reset(),
  onPhaseChange: (phase) => setBattleUiMode(phase === 'command' ? 'command' : 'message'),
  onFinish: finishSafariBattle,
})
const fishingHost = createBrowserFishingHost({
  sources: {
    readWorld: () => worldSession?.getState(),
    readPokemonRuntime: () => fieldScriptState.pokemonRuntime,
    readInventory: () => currentInventory,
    readFieldState: () => fieldScriptState,
    readPlayer: () => playerProfile,
    isFacingSurfableSurface: () => worldSession?.isFacingSurfableSurface() ?? false,
  },
  encounters: {
    identityPort: gameplayExtensionPorts.fieldWildEncounterIdentityPort,
    prepareSafariEncounter: (rod) => safariBattle.prepareEncounter(rod),
    materializePreparedEncounter: materializePreparedWildEncounter,
    startPreparedEncounter: startPreparedWildEncounter,
  },
  presentation: {
    clearMovementInput,
    setFollowerMovementPaused: runtime.setFollowerMovementPaused,
    setPlayerTextureFrames: runtime.setPlayerTextureFrames,
    setPlayerTexture: runtime.setPlayerTexture,
    applyCurrentPlayerSkin,
    startFishingBiteEffect: runtime.startFishingBiteEffect,
    stopFishingBiteEffect: runtime.stopFishingBiteEffect,
    setStatus: (text) => { status.textContent = text },
  },
  dialogue: {
    showMessages: fieldDialogueRuntime.showMessages,
    hide: hideFieldDialogueWindow,
  },
  audio: {
    playSoundEffect: (sequenceId) => audioRuntime?.playSoundEffect(sequenceId),
  },
  persistence: { scheduleAutosave: (delay) => sessionAutosave.schedule(delay) },
})
const sweetScentFieldEffect = createHgssSweetScentFieldEffect(fieldFade, (sequenceId) => startRomSoundEffect(audioRuntime, sequenceId))
const sweetScentRuntime = createHgssSweetScentRuntimeCoordinator({
  readContext: () => { const world = worldSession?.getState(), inventory = currentInventory, pokemonRuntime = fieldScriptState.pokemonRuntime; if (!world || !inventory || !pokemonRuntime) return undefined; const bankId = world.map.header.wildEncounterBank, safari = world.map.id === HGSS_SAFARI_MAP_ID && fieldScriptState.safariZone.session.active, prepareContextEncounter = safari ? (method: 'land' | 'surf') => safariBattle.prepareEncounter(method, undefined, true) : undefined; return { mapId: world.map.id, weatherId: fieldScriptState.weather, terrainAttribute: worldSession?.getTerrainAttributeAt(world.tileX, world.tileZ), encounters: bankId === 0xff ? undefined : inventory.wildEncounterCatalog[bankId], eventFlags: fieldScriptState.flags, hour: pokemonRuntime.now().getHours(), rng: pokemonRuntime.rng, prepareContextEncounter, prepareForcedEncounter: (check) => fieldEncounterSession?.prepareForced({ mapId: world.map.id, bankId, method: check.method, encounterRate: check.encounterRate, prepareSpecialEncounter: () => { const selected = selectHgssRoamerEncounter(fieldScriptState.roamers, world.map.id, pokemonRuntime.rng); return selected && { bankId, slotIndex: selected.roamerId, method: 'roamer', speciesId: selected.roamer.speciesId, level: selected.roamer.level, roamerId: selected.roamerId } }, prepareContextEncounter, generationContext: { lead: fieldScriptState.party.members[0], resolveSpeciesTypes: (speciesId) => pokemonRuntime.catalog.personalData[speciesId]?.types, radioEffect: resolveHgssEncounterRadioEffect(fieldScriptState.radioMusicSequenceId), massOutbreak: { active: fieldScriptState.roamers.massOutbreaksEnabled, randomValue: fieldScriptState.friendGroups[1]?.randomValue ?? 0 } } }) } },
  consumeHoney: () => takeBagItem(fieldScriptState.inventory, HGSS_HONEY_ITEM_ID, 1), closeMenu: () => renderMainMenu(mainMenu.close()),
  presentAnimation: () => sweetScentFieldEffect.present(), dismissAnimation: (successful) => sweetScentFieldEffect.dismiss(successful),
  presentFailureScript: (scriptId) => { const map = worldSession?.getState()?.map; if (map) startFieldScript(map, scriptId) },
  startEncounter: (prepared) => { const mapId = worldSession?.getState()?.map.id; return mapId !== undefined && startPreparedWildEncounter(gameplayExtensionPorts.fieldWildEncounterIdentityPort(prepared, { mapId, source: 'forced' })) }, persist: () => { persistCurrentSession() },
})
const safariUi = createSafariUiHost({
  customizerRoot: safariCustomizer, decoratorRoot: safariDecorator,
  readResources: () => currentInventory && ({ assets: currentInventory.safariUiAssets, messageBanks: currentInventory.uiMessageBanks, createGraphic: createUtilityMenuGraphicCanvas,
    playSoundEffect: (sequenceId) => { void audioRuntime?.playSoundEffect(sequenceId).catch(() => undefined) },
    createObjectPreview: (objectId) => { const map = currentInventory!.resolvedMapCatalog.maps.find(({ id }) => id === HGSS_SAFARI_MAP_ID); const config = getHgssSafariObjectConfig(objectId); const model = map && currentInventory!.mapPropModelResolver?.(resolveHgssSafariObjectModelId(config.objectId, playerProfile.gender), map.header.areaDataBank, 'field'); return safariObjectModelRenderer.render(model, undefined, undefined, undefined, 1) },
  }),
  onResume: advanceFieldScript,
  onStateChange: () => { refreshSafariMapVariant(); inputPrompts.refresh() },
})
const photoAlbumUi = createPhotoAlbumMainAdapter({ root: photoAlbum, runtimeCanvas, canvasAssets: menuCanvasAssets, readInventory: () => currentInventory, playSoundEffect: (sequenceId) => audioRuntime?.playSoundEffect(sequenceId), onResume: advanceFieldScript, onStateChange: () => inputPrompts.refresh() })
function bootstrapDebugFieldState(inventory: RomInventory): void {
  const startMap = inventory.resolvedMapCatalog.maps.find((candidate) => candidate.id === inventory.resolvedMapCatalog.startMapId)
  if (!startMap) return
  initializeNewGameFieldScriptState(startMap, fieldScriptState, ...fieldScriptExtensionPolicies)
  const initScriptIds = ['load', 'resume'].flatMap((phase) => resolveMapInitScripts(startMap.initScripts, phase as MapInitPhase))
  if (initScriptIds.length === 0) return
  const projectedState = cloneFieldScriptState(fieldScriptState)
  projectFieldScriptState(createFieldScriptSequenceRunner(
    initScriptIds.map((scriptId) => createFieldScriptRunner(startMap, scriptId, projectedState, undefined, ...fieldScriptExtensionPolicies)),
  ))
  applyProjectedFieldState(fieldScriptState, projectedState, document.documentElement)
}
function createPostOakFieldScriptState(inventory: RomInventory): FieldScriptState {
  const now = new Date()
  rtcPenaltyState = createHgssRtcPenaltyState(now)
  sessionRng = createHgssSessionRng(botJourneySeedOverride ?? deriveHgssRtcSeed(now, vblankCounter)); botJourneySeedOverride = undefined
  initializeHgssNewGamePlayerProfile(playerProfile, sessionRng)
  return createHgssPostOakFieldState(inventory, playerProfile, sessionRng, {
    now: () => new Date(),
    ownerRtcOffset: () => rtcPenaltyState.ownerRtcOffset,
    igtMinutes: () => inGameTimeClock.totalMinutes(),
    rtcPenalty: () => hasHgssRtcPenalty(rtcPenaltyState),
  })
}
const browserSaveStatus = createBrowserSaveStatusPresenter(saveStatus)
const sessionPersistence = createHgssSessionPersistenceCoordinator<FieldScriptState, Parameters<typeof createHgssSaveState>, ReturnType<typeof hgssDataOnlySaveAuthority.project>>({
  readArguments: (candidate, explicitFieldSave) => { const world = worldSession?.getState(); if (gameFlowState !== 'bedroom' || !explicitFieldSave && activeFieldScript || fieldExplorationRuntime?.isTransitionActive() || isVisualMovementSaveBlocked(runtime.isPlayerMoving(), explicitFieldSave) || pendingCoordinateScriptId !== undefined || pendingWarpTarget !== undefined || pendingHeldWarpTarget !== undefined || pendingFieldStep !== undefined || pendingWildEncounterCheck || activeBattle || activeDoubleBattle || !explicitFieldSave && candidate.safariZone.session.active || !battleScreen.hidden || !currentInventory || !sessionRng || !world) return; activeSaveExtensions = activeNewGamePlusGameplayRuntime?.snapshotExtensions(activeSaveExtensions) ?? activeSaveExtensions; return [currentInventory.metadata.gameCode, playerProfile, sessionRng, projectHgssSavedWorldPosition(world, worldSession?.getFollowerState()), candidate, gameOptions, inGameTimeClock.snapshot(), rtcPenaltyState, titleCampaign.getActiveProfile(), activeSaveExtensions] },
  write: (gameCode, save, kind) => { const record = titleCampaign.writeSaveSlot(gameCode, activeSaveSlot, save, kind); titleSaveAccess.noteSaved(activeSaveSlot, save, record); return record },
  createDocument: (...args: Parameters<typeof createHgssSaveState>) => hgssDataOnlySaveAuthority.project(createHgssSaveState(...args)),
  onSaved: (savedAt) => { lastSessionSaveAt = savedAt; browserSaveStatus.clearError() },
  reportError: (message) => { status.textContent = message; browserSaveStatus.reportError(message) },
})
function persistCurrentSession(kind: HgssBrowserSaveKind = 'auto', explicitFieldSave = false): boolean { return sessionPersistence.persist(fieldScriptState, kind, explicitFieldSave) }
const sessionAutosave = createBrowserSessionAutosave(window, () => gameFlowState === 'bedroom', () => { persistCurrentSession('auto') })
const pageCheckpoint = createBrowserSessionPageCheckpoint({
  cancelAutosave: sessionAutosave.cancel,
  prepareForRelease: [fieldCampaign.prepareForPageRelease, browserMultiplayerHost.prepareForPageRelease],
  activatePresentedMap: () => { fieldExplorationRuntime.activatePresentedMapImmediately() },
  persistSession: () => gameFlowState !== 'bedroom' || persistCurrentSession('auto', true),
  flushCloud: titleSaveAccess.flushCloud,
  reportError: (error) => { status.textContent = error instanceof Error ? error.message : 'Cloud en attente.' },
})
function hasUnfinishedP2pTrade(): boolean {
  return fieldScriptState.p2pTradeJournals.some(({ phase }) => phase === 'prepared')
}
function requestConfirmation(message: string, onConfirm: () => void): void {
  requestYesNo(message, (confirmed) => { if (confirmed) onConfirm() })
}
function requestYesNo(message: string, onResolve: (confirmed: boolean) => void, defaultConfirmed = false): void {
  yesNoConfirmation.request(message, onResolve, defaultConfirmed)
}
function startNewGameFromMenu(): void {
  if (!currentInventory) return; const confirmedSave = inspectHgssBrowserSaveSlot(titleCampaignStorage, currentInventory.metadata.gameCode, activeSaveSlot); if (confirmedSave.kind === 'empty') return
  requestConfirmation(`La partie de l’emplacement ${activeSaveSlot} sera effacée. Les autres emplacements seront conservés.`, () => { void titleSaveAccess.deleteSlot(activeSaveSlot, confirmedSave.deletionToken).then((deletionResult) => {
    if (!currentInventory) return
    if (deletionResult !== 'deleted') throw new Error(`L’emplacement ${activeSaveSlot} a changé : suppression annulée.`)
    pendingTitleSaves.delete(activeSaveSlot)
    pendingTitleCorruptSaves.delete(activeSaveSlot)
    lastSessionSaveAt = undefined
    sessionRng = undefined
    activeSaveExtensions = undefined
    titleCampaign.startNormalCampaign()
    playerProfile = createPlayerProfileForRom(currentInventory.metadata)
    fieldScriptState = createFieldScriptState(playerProfile.gender, playerProfile.name)
    applyHgssUiTheme(document.documentElement, fieldScriptState.pokegear.skin)
    fieldPhoneRing.reset()
    worldSession = undefined
    closeFieldDialogue()
    showMainScreen(currentInventory)
    status.textContent = `Emplacement ${activeSaveSlot} effacé : nouvelle partie prête.`
  }).catch((error: unknown) => { status.textContent = error instanceof Error ? error.message : 'Suppression impossible.' }) })
}
function restoreCurrentSession(
  inventory: RomInventory,
  restored: RestoredHgssSaveState,
  preferredOptions?: ReturnType<typeof createDefaultHgssGameOptions>,
): void {
  const next = prepareHgssRestoredSession(inventory, restored, {
    igtMinutes: () => inGameTimeClock.totalMinutes(), rtcPenalty: () => hasHgssRtcPenalty(rtcPenaltyState), ownerRtcOffset: () => rtcPenaltyState.ownerRtcOffset,
  }, preferredOptions)
  activeNewGamePlusGameplayRuntime?.applyFieldStateMigrations(next.field)
  const nextWorldSession = createHgssFieldWorldSession({
    inventory,
    readFieldState: () => next.field,
    readPlayerGender: () => next.profile.gender,
    extensionPorts: gameplayExtensionPorts.worldSessionExtensionPorts,
  })
  const world = nextWorldSession.loadMap(restored.world.mapId, restored.world.tileX, restored.world.tileZ, restored.world.direction, restored.world.locomotion)
  if (!world) throw new Error(`La carte sauvegardee ${restored.world.mapId} est absente de la ROM.`)
  rebuildHgssLocalFieldMapProjection(next.field, world.map, restored.world)
  next.field.weather = restoreHgssSavedMapWeather(next.field.weather, world.map.id, world.map.header.weather, next.field.pokemonRuntime?.now() ?? new Date(), hasHgssRtcPenalty(next.rtcPenalty))
  if (restored.world.follower) nextWorldSession.restoreFollowerState(restored.world.follower)
  runSessionRestoreTransaction({
    snapshot: () => ({ playerProfile, sessionRng, activeSaveExtensions, rtcPenaltyState, fieldScriptState, gameOptions, gameFlowState, worldSession,
      clock: inGameTimeClock.snapshot(), clockRunning: inGameTimeClock.running(), activeFieldScript, fieldEncounterSession, fieldExploration: fieldExplorationRuntime.snapshotTransientState() }),
    restore: (previous) => {
      playerProfile = previous.playerProfile; sessionRng = previous.sessionRng; activeSaveExtensions = previous.activeSaveExtensions; rtcPenaltyState = previous.rtcPenaltyState
      fieldScriptState = previous.fieldScriptState; gameOptions = previous.gameOptions; gameFlowState = previous.gameFlowState; worldSession = previous.worldSession
      resetInGameTimeClock(previous.clock); if (previous.clockRunning) inGameTimeClock.resume()
      activeFieldScript = previous.activeFieldScript; fieldEncounterSession = previous.fieldEncounterSession; fieldExplorationRuntime.restoreTransientState(previous.fieldExploration)
      applyHgssUiTheme(document.documentElement, fieldScriptState.pokegear.skin); fieldPhoneRing.reset(); gameScreenRuntime.setMode('story'); gameScreenRuntime.showCanvas(true); gameScreenRuntime.drawTitle(inventory, true)
    },
    attempt: () => {
      playerProfile = next.profile; sessionRng = next.rng; activeSaveExtensions = next.extensions; rtcPenaltyState = next.rtcPenalty; fieldScriptState = next.field
      gameOptions = next.options; gameFlowState = 'bedroom'; worldSession = nextWorldSession; resetInGameTimeClock(restored.igt)
      applyHgssUiTheme(document.documentElement, fieldScriptState.pokegear.skin); fieldPhoneRing.reset(); gameScreenRuntime.setMode('map'); gameScreenRuntime.showCanvas(false); applyCurrentPlayerSkin(true)
      loadMap(world.map, 'resume', undefined, true, undefined, false)
      writeHgssGameOptions(titlePersistenceStorage, inventory.metadata.gameCode, gameOptions); renderMainMenu(mainMenu.close())
      oakIntroRuntime.cancel()
    },
  })
}
function startDebugMap(inventory: RomInventory, debugStart: DebugMapStart): boolean {
  const { maps, startMapId } = inventory.resolvedMapCatalog
  const map = maps.find((candidate) => candidate.id === debugStart.mapId)
  if (!map) {
    status.textContent = `Carte debug ${debugStart.mapId} introuvable dans le catalogue resolu.`
    return false
  }
  const initPhase = debugStart.phase ?? (map.id === startMapId ? 'load' : 'transition')
  gameFlowState = 'bedroom'
  titleCampaign.startNormalCampaign()
  activeSaveExtensions = undefined
  resetInGameTimeClock()
  oakIntroRuntime.cancel()
  fieldScriptState = createPostOakFieldScriptState(inventory)
  bootstrapDebugFieldState(inventory)
  applyCurrentPlayerSkin(true)
  gameScreenRuntime.setMode('map')
  gameScreenRuntime.showCanvas(false)
  worldSession = createHgssFieldWorldSession({
    inventory,
    readFieldState: () => fieldScriptState,
    readPlayerGender: () => playerProfile.gender,
    extensionPorts: gameplayExtensionPorts.worldSessionExtensionPorts,
  })
  const spawn = resolveDebugSpawn(map, debugStart)
  const state = worldSession.loadMap(map.id, spawn.tileX, spawn.tileZ, debugStart.direction)
  if (!state) {
    status.textContent = `Impossible de demarrer la carte debug ${debugStart.mapId}.`
    return false
  }
  loadMap(state.map, initPhase)
  renderMainMenu(mainMenu.close())
  return true
}
const browserRomLoader = createBrowserRomLoader({
  elements: { picker, chooseRom, status, details, inventorySection },
  beforeLoad: () => pokegearFlyRuntime.cancel(),
  shouldCachePickedFile: () => !disposableDebugSession,
  canRestoreCachedFile: () => gameFlowState === 'empty',
  onInventoryReady: showRomInventory,
  onInvalid: () => {
    gameFlowState = 'empty'
    if (import.meta.env.DEV) botToggle.disabled = true
    realtimeTestPanelController?.setReady(false)
    if (import.meta.env.DEV) resetBot('ROM invalide : bot indisponible.')
  },
  recordDiagnostic: ({ target, entry, maximumEntries }) => {
    appendDiagnosticEntry(
      target === 'statuses' ? recentDiagnosticStatuses : recentDiagnosticErrors,
      entry,
      maximumEntries,
    )
    if (target === 'errors') presentRuntimeFailure(status, entry.detail, 'Chargement de la ROM impossible')
  },
})
void browserRomLoader.restoreCached()

filter.addEventListener('input', () => renderFileList(filter.value))
closeArchive.addEventListener('click', () => hideArchiveInspector(inventoryView))

function applyCurrentPlayerSkin(force = false): void {
  if (!currentInventory) return
  const locomotion = worldSession?.getState()?.locomotion ?? 'walking'
  if (!force && appliedPlayerGender === playerProfile.gender && appliedPlayerLocomotion === locomotion && appliedPlayerState === fieldScriptState.playerState) return
  playerTextureStatus = applyPlayerProfileSkin(runtime, currentInventory, playerProfile, locomotion, fieldScriptState.playerState)
  appliedPlayerGender = playerProfile.gender
  appliedPlayerLocomotion = locomotion
  appliedPlayerState = fieldScriptState.playerState
}

const oakIntroRuntime = createOakIntroRuntime({
  screen: gameScreenRuntime,
  fade: fieldFade,
  textEntry: gameTextEntry,
  getInventory: () => currentInventory,
  getAudio: () => audioRuntime,
  getProfile: () => playerProfile,
  beforeStart: () => {
    clearMovementInput()
    titleMenu.close()
    gameMenu.hidden = true
    gameFlowState = 'intro'
  },
  applyPlayerSkin: () => applyCurrentPlayerSkin(),
  onComplete: startBedroom,
  reportStatus: (message) => { status.textContent = message },
})

async function authorizeTitleSaveCatalog(
  access: TitleSaveCatalogAccess,
  signal: AbortSignal,
  conflictResolutions: TitleSaveCatalogConflictResolutions, localImportDecision?: TitleSaveCatalogLocalImportDecision,
): Promise<void> {
  const inventory = currentInventory
  if (!inventory || gameFlowState !== 'title') throw new Error('La ROM doit être prête avant les sauvegardes.')
  const { gameVersion, language } = playerProfile
  if (gameVersion === undefined || language === undefined) throw new Error('L’identité ROM des sauvegardes est indisponible.')
  const authorized = await titleSaveAccess.authorize(
    access,
    inventory,
    { gameVersion, language },
    signal,
    conflictResolutions, localImportDecision,
  )
  if (signal.aborted) return
  pendingTitleSaves = authorized.catalog.saves
  pendingTitleCorruptSaves = authorized.catalog.corruptSaves
  const warnings = [...authorized.catalog.warnings, ...titleCampaign.reconcileEntitlement(inventory)]
  titleCampaign.open()
  const cloudChanges = authorized.cloud ? authorized.cloud.uploaded + authorized.cloud.downloaded + authorized.cloud.deletedLocally : 0
  status.textContent = warnings.length > 0
    ? `${authorized.identity} · ${warnings.join(' ')}`
    : cloudChanges > 0 ? `${authorized.identity} · cloud synchronisé (${cloudChanges}).` : `${authorized.identity} · sauvegardes prêtes.`
}

function showRomInventory(inventory: RomInventory): void {
  titleCampaign.resetForRom()
  titleAccountGate.close()
  titleSaveAccess.deactivateCloud()
  pendingTitleSaves = new Map()
  pendingTitleCorruptSaves = new Map()
  chooseRom.hidden = true
  currentInventory = inventory
  installHgssUiTheme(document.documentElement, inventory.uiAssets)
  installFieldAppRomLabels(app, inventory.uiMessageBanks)
  const romNo = inventory.uiMessageBanks[271]?.[19]
  const romYes = inventory.uiMessageBanks[271]?.[18]
  if (romNo) modalConfirm.querySelector<HTMLButtonElement>('[data-confirm-value="false"]')!.textContent = romNo
  if (romYes) modalConfirm.querySelector<HTMLButtonElement>('[data-confirm-value="true"]')!.textContent = romYes
  if (import.meta.env.DEV) { botToggle.disabled = false; botStatus.textContent = 'Prêt : le bot peut rejouer l’intro puis explorer la carte.'; realtimeTestPanelController?.setReady(true) }
  fieldPhoneRing.reset()
  void audioRuntime?.dispose()
  audioRuntime = createRomAudioRuntime(inventory.soundArchive)
  playerProfile = createPlayerProfileForRom(inventory.metadata)
  fieldScriptState = createFieldScriptState(playerProfile.gender, playerProfile.name)
  applyHgssUiTheme(document.documentElement, fieldScriptState.pokegear.skin)
  let optionsWarning: string | undefined
  let storedOptions: ReturnType<typeof createDefaultHgssGameOptions> | undefined
  try {
    storedOptions = readHgssGameOptions(titlePersistenceStorage, inventory.metadata.gameCode)
    gameOptions = storedOptions ?? createDefaultHgssGameOptions()
  } catch (error) {
    gameOptions = createDefaultHgssGameOptions()
    optionsWarning = error instanceof Error ? error.message : 'Options HGSS enregistrées invalides.'
  }
  if (gameOptions.localWeather) localWeatherService.resume()
  else localWeatherService.disable()
  appliedPlayerGender = undefined
  appliedPlayerLocomotion = undefined
  appliedPlayerState = undefined
  renderRomDetails(inventoryView, inventory)
  currentFiles = inventory.files
  applyCurrentPlayerSkin(true)
  renderInventorySummary(inventoryView, inventory)
  renderGraphicPreview(inventoryView, inventory)
  renderResourceCatalog(inventoryView, inventory)
  const debugMapStart = import.meta.env.DEV ? readDebugMapStart(window.location.search) : undefined
  if (debugMapStart) {
    if (!startDebugMap(inventory, debugMapStart)) showMainScreen(inventory)
  } else {
    showMainScreen(inventory)
  }
  if (optionsWarning) status.textContent = `${status.textContent} ${optionsWarning}`
  filter.value = ''
  renderFileList('')
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('bot') === '1') setBotRunning(true)
}

function loadStartMap(inventory: RomInventory): void {
  const { startMapId } = inventory.resolvedMapCatalog
  worldSession = createHgssFieldWorldSession({
    inventory,
    readFieldState: () => fieldScriptState,
    readPlayerGender: () => playerProfile.gender,
    extensionPorts: gameplayExtensionPorts.worldSessionExtensionPorts,
  })
  const state = worldSession.loadMap(startMapId, 6, 6, 'south')
  if (!state) {
    status.textContent = 'Parcours de départ non validé dans cette ROM'
    return
  }
  loadMap(state.map)
}

function syncFieldScriptPlayerStateFromWorld(): void {
  const worldState = worldSession?.getState()
  if (!worldState) return
  const origin = getMapOrigin(worldState.map)
  setFieldScriptPlayerState(
    fieldScriptState,
    origin.x + worldState.tileX,
    origin.z + worldState.tileZ,
    worldState.direction,
    worldState.groundHeight,
  )
  const keepsRocketAvatar = fieldScriptState.flags.has(0x969)
    && (fieldScriptState.playerState === 3 || fieldScriptState.playerState === 12 || fieldScriptState.playerState === 14)
  if (!keepsRocketAvatar) {
    fieldScriptState.playerState = worldState.locomotion === 'cycling' ? 1 : worldState.locomotion === 'surfing' ? 2 : 0
  }
}

function renderFileList(query: string): void {
  renderInventoryFileList(inventoryView, currentFiles, query)
}

fileListBody.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof HTMLButtonElement)) return
  const fileId = Number(target.dataset.fileId)
  const file = currentFiles.find((candidate) => candidate.id === fileId)
  if (file) showArchiveMembers(file)
})

function showArchiveMembers(file: RomFile): void {
  renderArchiveMembers(inventoryView, file)
}

function showMainScreen(inventory: RomInventory): void {
  currentInventory = inventory
  titleAccountGate.close(); titleSaveAccess.deactivateCloud(); titleCampaign.resetForRom(); pendingTitleSaves = new Map(); pendingTitleCorruptSaves = new Map()
  oakIntroRuntime.cancel()
  clearMovementInput()
  gameFlowState = 'boot'
  inGameTimeClock.pause()
  openingStartedAt = performance.now()
  gameScreenRuntime.setMode('story')
  gameScreenRuntime.showCanvas(true)
  titleMenu.close()
  gameMenu.hidden = true
  status.textContent = 'ROM chargée : séquence de lancement en cours.'
  void audioRuntime?.playMusicByName(['SEQ_GS_TITLE']).catch(() => {})
  gameScreenRuntime.drawOpening(inventory, 0, true)
}
installBrowserGameSessionPageLifecycle({
  window, document, checkpoint: pageCheckpoint,
  animations: { pause: runtime.pauseAnimations, resume: runtime.resumeAnimations },
  clock: { pause: inGameTimeClock.pause, resume: inGameTimeClock.resume, resynchronize: vblankClock.resynchronize },
  resetInput: () => { browserGameInputHost.reset(); runButtonPressed = false; clearMovementInput() },
  isGameActive: () => gameFlowState === 'bedroom', focus: fullscreenController.focus,
  releaseAuthorization: titleSaveAccess.deactivateCloud,
  restoreTitle: () => { pageCheckpoint.reset(); if (currentInventory) showMainScreen(currentInventory) },
  hasPendingCloud: titleSaveAccess.hasPendingCloud,
  retryPendingCloud: titleSaveAccess.flushCloud,
})

function startTitleScreen(): void {
  if (!currentInventory) return
  gameFlowState = 'title'
  openingStartedAt = 0
  status.textContent = 'Écran titre. Appuyez sur Entrée / Espace ou cliquez dans l’écran.'
  void audioRuntime?.playMusicByName(['SEQ_GS_POKEMON_THEME']).catch(() => {})
  gameScreenRuntime.drawTitle(currentInventory, true)
}

function beginTitleNewGame(slot: HgssBrowserSaveSlot): void {
  activeSaveSlot = slot
  titleMenu.close()
  gameMenu.hidden = true
  sessionRng = undefined
  activeSaveExtensions = undefined
  worldSession = undefined
  fieldPhoneRing.reset()
  resetInGameTimeClock()
  if (currentInventory) {
    playerProfile = createPlayerProfileForRom(currentInventory.metadata)
    fieldScriptState = createFieldScriptState(playerProfile.gender, playerProfile.name)
  }
  startOakIntro()
}

function applyTitleMenuResult(result: TitleMenuResult): boolean {
  return titleCampaign.applyMenuResult(result)
}

const resetBot = import.meta.env.DEV ? (message: string, error?: Error): void => {
  botRunning = false; botNextActionAt = 0; botDirectionCursor = 0; botJourneyKind = 'opening'; botJourneySeedOverride = undefined; botJourneyError = error
  botTileAttempts.clear(); botInspectedTiles.clear(); botJourneyAgent = undefined
  botToggle.textContent = 'Bot : démarrer'; botStatus.textContent = message
  } : (_message: string, _error?: Error): void => { void _message; void _error }

const setBotRunning = import.meta.env.DEV ? (running: boolean, journey: RealtimeTestBotJourney = 'opening'): void => {
  if (!currentInventory) return
  if (!running) {
    resetBot('Bot arrêté. Vous pouvez reprendre à tout moment.')
    return
  }
  clearMovementInput(); setMenuOpen(false); botRunning = true; botJourneyKind = journey; botJourneyError = undefined
  botNextActionAt = 0; botDirectionCursor = 0; botTileAttempts.clear(); botInspectedTiles.clear()
  let journeyError: string | undefined
  try {
    botJourneyAgent = createRealtimeJourneyAgent(journey, currentInventory.resolvedMapCatalog.maps)
  } catch (error) {
    botJourneyAgent = undefined
    journeyError = error instanceof Error ? error.message : 'Parcours d’audit ROM indisponible.'
    if (journey !== 'opening') throw error
  }
  botToggle.textContent = 'Bot : arrêter'
  botStatus.textContent = journeyError ?? (gameFlowState === 'bedroom'
    ? 'Bot actif : exploration des entrées ROM…'
    : 'Bot actif : l’introduction est rejouée en direct…')
  } : (_running: boolean): void => { void _running }

const prepareRealtimeBotJourney = import.meta.env.DEV ? (journey: RealtimeTestBotJourney, seed?: number, preset: RealtimeCampaignPresetId = 'normal'): string => {
  const inventory = currentInventory
  if (!realtimeTestMode || !inventory) throw new Error('Le bot de campagne exige une ROM chargée dans ?test=1.')
  if (gameFlowState !== 'boot' && gameFlowState !== 'title' && gameFlowState !== 'intro') throw new Error(`Rechargez la ROM avant BOT ${journey.toUpperCase()} afin de repartir du lancement.`)
  // Le bot démarre avant que le sas de sauvegarde ait publié sa façade de
  // campagne. La surcouche jetable appartient donc au stockage titre brut,
  // pas à `campaignStorage`, qui doit continuer à refuser toute lecture ou
  // écriture hors d'une autorisation active.
  maskHgssCampaignSavesInOverlay(titlePersistenceStorage, inventory.metadata.gameCode); const preparedCampaign = realtimeCampaignAudit!.prepare(preset, { gameCode: inventory.metadata.gameCode, playerName: playerProfile.name, source: fieldScriptState })
  pendingTitleSaves.clear(); pendingTitleCorruptSaves.clear(); titleCampaign.resetForRom(); titleMenu.close(); realtimeWonTrainerBattleIds.clear()
  if (preparedCampaign.profile && preparedCampaign.source) titleCampaign.beginPreparedNewGamePlusForDevelopment({ profile: preparedCampaign.profile, source: preparedCampaign.source, targetSlot: preparedCampaign.targetSlot })
  botJourneySeedOverride = seed; setBotRunning(true, journey)
  return journey === 'opening' ? 'Bot d’ouverture lancé dans trois emplacements jetables vides.' : `Bot ${journey} ${preset} lancé dans trois emplacements jetables.`
  } : (_journey: RealtimeTestBotJourney, _seed?: number, _preset?: RealtimeCampaignPresetId): string => { void _journey; void _seed; void _preset; return '' }
const startRealtimeOpeningBot = import.meta.env.DEV ? (): string => prepareRealtimeBotJourney('opening') : (): string => ''
const pauseRealtimeJourneyTerrain = import.meta.env.DEV ? (): void => { botRunning = false; if (botJourneyAgent && 'invalidatePlan' in botJourneyAgent) botJourneyAgent.invalidatePlan(); botToggle.textContent = 'Bot : en pause'; botStatus.textContent = 'Bot de campagne : combat en cours…' } : (): void => {}
const resumeRealtimeJourneyTerrain = import.meta.env.DEV ? (): void => { if (!botJourneyAgent || botJourneyKind === 'opening') throw new Error('Le plan terrain de campagne à reprendre est absent.'); botRunning = true; botNextActionAt = 0; botToggle.textContent = 'Bot : arrêter' } : (): void => {}
const suspendBotForBattle = import.meta.env.DEV ? (): void => { if (botJourneyKind !== 'opening') pauseRealtimeJourneyTerrain(); else resetBot('Bot arrêté : combat ROM détecté.') } : (): void => {}

const updateBotStatus = import.meta.env.DEV ? (prefix: string): void => {
  const state = worldSession?.getState()
  botStatus.textContent = state ? `${prefix} ${state.map.label} · ${state.tileX}, ${state.tileZ}` : prefix
  } : (_prefix: string): void => { void _prefix }

const advanceBotIntro = import.meta.env.DEV ? (): void => {
  if (gameFlowState === 'boot') {
    advanceFlow()
    botStatus.textContent = 'Bot actif : séquence de lancement…'
    return
  }
  if (gameFlowState === 'title') {
    if (titleAccountGate.isOpen()) {
      if (titleAccountGate.getState().stage === 'authorizing') {
        botStatus.textContent = 'Bot actif : autorisation du dossier local…'
        return
      }
      try {
        clickRequiredRealtimeBotControl(
          runtimePanel,
          '[data-title-account-key="local"]',
          'Mode local',
        )
        botStatus.textContent = 'Bot actif : autorisation du dossier local demandée.'
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error))
        resetBot(`Bot E2E bloqué : ${failure.message}`, failure)
      }
      return
    }
    if (!titleMenu.getState().open) advanceFlow()
    else {
      const firstEmptySlot = Array.from({ length: hgssBrowserSaveSlotCount }, (_, index) => (index + 1) as HgssBrowserSaveSlot)
        .find((slot) => !pendingTitleSaves.has(slot) && !pendingTitleCorruptSaves.has(slot)) ?? 1
      applyTitleMenuResult({ kind: 'choice', choice: `slot-${firstEmptySlot}`, state: titleMenu.getState() })
    }
    botStatus.textContent = 'Bot actif : introduction Oak…'
    return
  }
  if (gameFlowState !== 'intro') return
  const introState = oakIntroRuntime.getSnapshot().renderState
  if (!introState) return
  if (introState.mode === 'tutorial-choice' && introState.choices?.length === 3) { advanceFlow({ kind: 'choice', index: 2 }); botStatus.textContent = 'Bot actif : tutoriel passé, introduction Oak…'; return }
  if (introState.mode === 'name-input') {
    oakIntroRuntime.submitAutomatedName(introState.playerName || 'B')
    botStatus.textContent = 'Bot actif : nom du joueur « B ».'
    return
  }
  advanceFlow()
  botStatus.textContent = 'Bot actif : introduction Oak…'
  } : (): void => {}

const inspectBotTile = import.meta.env.DEV ? (): boolean => {
  if (!worldSession) return false
  for (const movement of botDirections) {
    worldSession.setDirection(movement.direction)
    runtime.setPlayerDirection(movement.direction)
    const beforeScript = activeFieldScript
    interact()
    if (activeFieldScript !== beforeScript || activeFieldScript) {
      botStatus.textContent = 'Bot actif : interaction ROM détectée.'
      return true
    }
  }
  return false
  } : (): boolean => false

const advanceBotField = import.meta.env.DEV ? (): void => {
  if (pendingBlackoutFollowup) { confirmBlackoutMessage(); return }
  const checkpoint = botJourneyAgent?.getCheckpoint()
  if (activeFieldScript) {
    if (phoneChoicePopup.isOpen()) {
      phoneChoicePopup.handle('confirm')
      botStatus.textContent = 'Bot actif : choix Pokématos validé.'
    } else if (alphFieldUiHost.isInscriptionOpen()) {
      alphFieldUiHost.closeInscription()
      botStatus.textContent = 'Bot actif : inscription des Ruines d’Alpha refermée.'
    } else if (alphFieldUiHost.isPuzzleOpen()) {
      alphFieldUiHost.solveForAutomation()
      botStatus.textContent = 'Bot actif : tablette des Ruines d’Alpha reconstituée.'
    } else if (fieldRecordAppsHost.getOpenApp() === 'pokeathlon') {
      fieldRecordAppsHost.close()
      botStatus.textContent = 'Bot actif : données Pokéathlon refermées.'
    } else if (fieldRecordAppsHost.isOpen()) {
      fieldRecordAppsHost.close()
      botStatus.textContent = 'Bot actif : records Frontier refermés.'
    } else if (fieldEasyChatHost.isOpen()) {
      fieldEasyChatHost.cancel()
      botStatus.textContent = 'Bot actif : Easy Chat annulé.'
    } else if (!fieldNickname.hidden) {
      const cancellable = fieldTextEntry.isNicknameCancellable()
      fieldTextEntry.completeNicknameForAutomation()
      botStatus.textContent = cancellable
        ? 'Bot actif : surnom par défaut conservé.'
        : 'Bot actif : nom obligatoire validé.'
    } else if (!fieldNumber.hidden) {
      fieldTextEntry.completeNumberForAutomation()
      botStatus.textContent = 'Bot actif : valeur par défaut validée.'
    } else if (fieldChoiceHost.isOpen()) {
      fieldChoiceHost.select(botJourneyAgent?.getChoiceIndex(fieldScriptState) ?? 0)
      botStatus.textContent = `Bot actif : choix validé · ${checkpoint?.label ?? 'exploration'}.`
    } else if (fieldScriptExecution.getWait() === 'input') {
      if (!fieldDialogue.hidden) confirmFieldMessage()
      else resumeFieldScriptInputWait('confirm')
      botStatus.textContent = 'Bot actif : dialogue ROM confirmé.'
    }
    return
  }
  if (fieldExplorationRuntime.isTransitionActive() || runtime.isPlayerMoving() || pendingCoordinateScriptId !== undefined || pendingWarpTarget !== undefined) return
  const state = worldSession?.getState()
  if (!state) return
  if (botJourneyAgent) {
    let input: ReturnType<RealtimeJourneyAgent['nextInput']>
    try {
      input = botJourneyAgent.nextInput({
        mapId: state.map.id,
        tileX: state.tileX,
        tileZ: state.tileZ,
        direction: state.direction,
        groundHeight: state.groundHeight,
      }, fieldScriptState)
    } catch (error) {
      const checkpoint = botJourneyAgent.getCheckpoint()
      const failure = error instanceof Error ? error : new Error('Erreur de planification inconnue.')
      resetBot(`Blocage audit ${checkpoint.id} · ${failure.message}`, failure)
      return
    }
    if (!input) {
      const completedCheckpoint = botJourneyAgent?.getCheckpoint()
      resetBot(completedCheckpoint?.id === 'pre-wild-complete'
        ? 'Parcours avant combats sauvages terminé. Le numéro d’Orme est enregistré.'
        : completedCheckpoint
          ? `Parcours terminé : ${completedCheckpoint.label}.`
          : 'Parcours d’ouverture terminé.')
      return
    }
    if (typeof input === 'object') { runBotMachine(fieldScriptState, input.itemId, botJourneyAgent.getCheckpoint().id, resetBot, updateBotStatus); return }
    if (input === 'confirm') interact()
    else {
      const movement = input === 'up' ? movementDirections.ArrowUp
        : input === 'down' ? movementDirections.ArrowDown
          : input === 'left' ? movementDirections.ArrowLeft
            : movementDirections.ArrowRight
      const before = `${state.map.id}:${state.tileX}:${state.tileZ}`; tryStartMovement(movement); const after = worldSession?.getState(); if (after && `${after.map.id}:${after.tileX}:${after.tileZ}` === before && worldSession?.findDynamicActorInteraction()) interact()
    }
    updateBotStatus(`Bot audit : ${botJourneyAgent.getCheckpoint().label} ·`)
    return
  }
  const tileKey = `${state.map.id}:${state.tileX}:${state.tileZ}`
  if (!botInspectedTiles.has(tileKey)) {
    botInspectedTiles.add(tileKey)
    if (inspectBotTile()) return
  }
  const attempted = botTileAttempts.get(tileKey) ?? 0
  const movement = botDirections[(botDirectionCursor + attempted) % botDirections.length]
  if (!movement) return
  const before = `${state.map.id}:${state.tileX}:${state.tileZ}`
  tryStartMovement(movement)
  const afterState = worldSession?.getState()
  const after = afterState ? `${afterState.map.id}:${afterState.tileX}:${afterState.tileZ}` : before
  if (after === before) botTileAttempts.set(tileKey, attempted + 1)
  else {
    botTileAttempts.delete(tileKey)
    botDirectionCursor = (botDirectionCursor + 1) % botDirections.length
  }
  updateBotStatus('Bot actif : déplacement…')
  } : (): void => {}

const runBot = import.meta.env.DEV ? (now: number): void => {
  if (!botRunning || now < botNextActionAt) return
  botNextActionAt = now + (realtimeTestMode && botJourneyKind !== 'opening' ? 45 : gameFlowState === 'bedroom' ? 420 : 520)
  if (gameFlowState === 'boot' || gameFlowState === 'title' || gameFlowState === 'intro') { advanceBotIntro(); return }
  if (gameFlowState === 'bedroom') advanceBotField()
  } : (_now: number): void => { void _now }

function startOakIntro(): void {
  oakIntroRuntime.start()
}

function startBedroom(): void {
  if (!currentInventory) return
  const inventory = currentInventory
  gameFlowState = 'bedroom'
  resetInGameTimeClock()
  fieldScriptState = createPostOakFieldScriptState(inventory)
  const startMap = inventory.resolvedMapCatalog.maps.find((map) => map.id === inventory.resolvedMapCatalog.startMapId)
  if (!startMap) throw new Error('La carte de depart ROM est absente du catalogue resolu.')
  initializeNewGameFieldScriptState(startMap, fieldScriptState, ...fieldScriptExtensionPolicies)
  fieldScriptState = titleCampaign.applyPendingStart(fieldScriptState); if (import.meta.env.DEV) realtimeCampaignAudit!.recordInitialParty(fieldScriptState.party.members.map(({ speciesId }) => speciesId))
  applyCurrentPlayerSkin(true)
  gameScreenRuntime.setMode('map')
  gameScreenRuntime.showCanvas(false)
  loadStartMap(inventory)
  renderMainMenu(mainMenu.close())
}

function drawGameScreen(force = false): void {
  if (!currentInventory) return
  if (gameFlowState === 'boot') {
    const elapsedMs = performance.now() - openingStartedAt
    if (elapsedMs >= openingCinematicDurationMs) startTitleScreen()
    else gameScreenRuntime.drawOpening(currentInventory, elapsedMs, force)
    return
  }
  if (gameFlowState === 'title') {
    gameScreenRuntime.drawTitle(currentInventory, force)
    return
  }
  if (gameFlowState === 'intro') oakIntroRuntime.draw(force)
}

function advanceFlow(action?: IntroPointerAction): boolean {
  if (gameFlowState === 'boot') {
    const elapsedMs = performance.now() - openingStartedAt
    if (!canSkipOpeningCinematic(elapsedMs)) return true
    startTitleScreen()
    return true
  }
  if (gameFlowState === 'title') {
    if (currentInventory) {
      void audioRuntime?.playMusicByName(['SEQ_GS_POKEMON_THEME']).catch(() => {})
    }
    void titleAccountGate.open().catch((error: unknown) => {
      status.textContent = error instanceof Error ? error.message : 'La connexion ne peut pas être ouverte.'
    })
    return true
  }
  if (gameFlowState === 'intro') return oakIntroRuntime.advance(action)
  return false
}

function handleIntroDigitalAction(action: GameDigitalAction): boolean {
  // The ROM only accepts A, START or a new touch after scene 1 unlocks skip.
  if (gameFlowState === 'boot') return action === 'confirm' || action === 'menu' ? advanceFlow() : false
  if (gameFlowState === 'title') {
    return titleMenu.getState().open
      ? titleCampaign.handleMenuInput(action)
      : action === 'confirm' ? advanceFlow() : false
  }
  if (gameFlowState !== 'intro') return false
  return oakIntroRuntime.handleDigital(action)
}

const movementInput = createMovementInput()
const utilityMenuSelection = createBrowserUtilityMenuSelectionState()

const utilityMenuScreenItemsHost = createUtilityMenuScreenItemsHost({
  readContext: () => ({
    inventory: currentInventory,
    fieldState: fieldScriptState,
    mapId: worldSession?.getState()?.map.id,
  }),
  selection: {
    team: {
      readSlot: () => utilityMenuSelection.teamSlot,
      writeSlot: (slot) => { utilityMenuSelection.teamSlot = slot },
    },
    pokedex: {
      readSpeciesId: () => utilityMenuSelection.pokedexSpeciesId,
      writeSpeciesId: (speciesId) => { utilityMenuSelection.pokedexSpeciesId = speciesId },
    },
    bag: {
      read: () => ({
        itemId: utilityMenuSelection.bagItemId,
        pocket: utilityMenuSelection.bagPocket,
        action: utilityMenuSelection.bagAction,
        pendingMachineTeaching: utilityMenuSelection.pendingBagMachineTeaching,
      }),
      write: (selection) => {
        utilityMenuSelection.bagPocket = selection.pocket
        utilityMenuSelection.bagItemId = selection.itemId
      },
    },
  },
  pokegear: {
    selectCard: (card) => { pokegearUi?.selectCard(card) },
    getMenuItems: () => pokegearUi?.getMenuItems() ?? [],
  },
})

const mainMenu = createMainMenuController(() => resolveHgssMainMenuAvailability(fieldScriptState, {
  campaignLocked: fieldCampaign.isFieldLocked(),
  fullscreenSupported: fullscreenController.isSupported(),
  fullscreenInstalled: fullscreenController.isInstalled(),
}), utilityMenuScreenItemsHost.getItems)
const phoneChoicePopup = createChoicePopupController(modalConfirm)
deferredUtilityMenuHost.install(createBrowserUtilityMenuHost({
  elements: { root: gameMenu, trigger: gameMenuButton, battleScreen, status },
  menu: mainMenu,
  selection: utilityMenuSelection,
  readInventory: () => currentInventory,
  readFieldState: () => fieldScriptState,
  readGameOptions: () => gameOptions,
  readVblank: () => vblankCounter,
  isGameplayChromeSuppressed: () => gameFlowState !== 'bedroom'
    || Boolean(activeFieldScript)
    || sweetScentRuntime.isActive()
    || fieldExplorationRuntime?.isTransitionActive()
    || !battleScreen.hidden,
  canvasAssets: menuCanvasAssets,
  pokemonAnimations: utilityMenuPokemonAnimations,
  pokemonSprites: pokemonUiSprites,
  prompts: inputPrompts,
  pokegear: {
    createPresentation: (state) => pokegearUi.createPresentation(state),
    deactivate: () => pokegearUi.deactivate(),
    reset: () => pokegearUi.reset(),
    selectContact: (contactId) => pokegearUi.selectContact(contactId),
    selectRadioSlot: (slot) => pokegearUi.selectRadioSlot(slot),
    syncAfterRender: () => pokegearUi.syncAfterRender(),
  },
  commands: {
    system: {
      safariExit: {
        scriptId: HGSS_SAFARI_EXIT_SCRIPT_ID,
        readActiveMap: () => worldSession?.getState()?.map,
        hasScript: hasFieldScript,
        startScript: startFieldScript,
        isSessionActive: () => fieldScriptState.safariZone.session.active,
      },
      save: {
        persistManual: () => persistCurrentSession('manual'),
        readActiveSlot: () => activeSaveSlot,
      },
      bugReport: { open: bugReportHost.open },
      emergency: {
        requestConfirmation,
        perform: emergencyUnstickAndBlackout,
      },
      newGame: { start: startNewGameFromMenu },
      fullscreen: fullscreenController,
      localWeather: {
        toggle: (currentlyEnabled) => toggleLocalWeatherPreference(localWeatherService, currentlyEnabled),
        updateEnvironment: hgssEnvironment.update,
      },
      options: {
        read: () => gameOptions,
        persistRom: (nextOptions) => {
          if (currentInventory) {
            writeHgssGameOptions(titlePersistenceStorage, currentInventory.metadata.gameCode, nextOptions)
          }
        },
        persistSession: () => { persistCurrentSession() },
      },
    },
    pokegear: {
      popup: phoneChoicePopup,
      ui: {
        selectContact: (contactId) => pokegearUi.selectContact(contactId),
        selectRadioSlot: (slot) => pokegearUi.selectRadioSlot(slot),
      },
      outgoingCall: { start: (contactId) => pokegearOutgoingPhone.start(contactId) },
      contacts: {
        read: () => fieldScriptState.phoneContacts,
        write: (contacts) => { fieldScriptState.phoneContacts = contacts },
      },
      skin: {
        write: (skin) => { fieldScriptState.pokegear.skin = skin },
        apply: (skin) => { applyHgssUiTheme(document.documentElement, skin) },
      },
      resources: {
        read: () => currentInventory && ({
          contactNames: currentInventory.phoneContactNames,
          phoneMessages: currentInventory.uiMessageBanks[271] ?? {},
          phoneBookEntries: currentInventory.phoneBookEntries,
          configureMessages: currentInventory.uiMessageBanks[270] ?? {},
          speciesNames: currentInventory.pokemonCatalog.speciesNames,
        }),
      },
      prompts: { refresh: inputPrompts.refresh },
      persist: () => { persistCurrentSession() },
    },
    team: {
      team: {
        readParty: () => fieldScriptState.party,
        policy: gameplayExtensionPorts.pokemonTeamPolicy,
        syncFollower: syncFollowerPresentation,
      },
      bag: { readInventory: () => fieldScriptState.inventory },
      mailbox: {
        read: () => ({
          identities: fieldScriptState.mailboxMailIdentities,
          messageCount: fieldScriptState.mailboxMessageCount,
        }),
        writeMessageCount: (messageCount) => { fieldScriptState.mailboxMessageCount = messageCount },
      },
      confirmation: { request: requestYesNo },
      resources: {
        read: () => currentInventory && ({
          itemCatalog: currentInventory.itemCatalog,
          pokemonCatalog: currentInventory.pokemonCatalog,
          uiMessageBanks: currentInventory.uiMessageBanks,
        }),
      },
      fieldMoves: {
        useSweetScent: () => sweetScentRuntime.use('move'),
        offerSurf: tryOfferSurf,
      },
      nickname: {
        root: fieldNickname,
        input: fieldNicknameInput,
        textEntry: fieldTextEntry,
        setPendingPartySlot: (partySlot) => { pendingMenuNicknameSlot = partySlot },
      },
      persist: () => { persistCurrentSession() },
      setFieldStatus: (message) => { status.textContent = message },
    },
    bag: {
      resources: {
        read: () => currentInventory && ({
          itemCatalog: currentInventory.itemCatalog,
          pokemonCatalog: currentInventory.pokemonCatalog,
          uiMessageBanks: currentInventory.uiMessageBanks,
        }),
      },
      state: { read: () => fieldScriptState },
      confirmation: { request: requestYesNo },
      policies: {
        level: gameplayExtensionPorts.pokemonLevelPolicy,
        healing: gameplayExtensionPorts.pokemonPartyHealingPolicy,
        team: gameplayExtensionPorts.pokemonTeamPolicy,
      },
      world: {
        read: () => worldSession,
        applyPlayerSkin: applyCurrentPlayerSkin,
        syncFollower: syncFollowerPresentation,
      },
      encounters: {
        startFishing: fishingHost.tryStart,
        useSweetScent: () => { sweetScentRuntime.use('honey') },
      },
      progression: {
        moveLearning: battleProgressionPresenter,
        createEvolutionEntry: pokemonTransformationSceneHost.createEvolutionEntry,
        startPresentation: pokemonTransformationSceneHost.startFieldProgression,
        startEvolution: (pokemon, targetSpeciesId, source, rule) => (
          pokemonTransformationSceneHost.startEvolution({
            pokemon,
            targetSpeciesId,
            source,
            rule,
          })
        ),
      },
      currentTimeOfDay: currentHgssTimeOfDay,
      setFieldStatus: (message) => { status.textContent = message },
      persist: () => { persistCurrentSession() },
    },
  },
  routing: {
    openMultiplayer: browserMultiplayerHost.open,
    clearMovementInput,
    resetPhoneRing: fieldPhoneRing.reset,
    answerIncomingPhoneCall: () => {
      const incoming = fieldPhoneRing.answer()
      return Boolean(incoming && answerFieldIncomingPhoneCall(incoming))
    },
    playPokedexCry: (speciesId) => { startRomCry(audioRuntime, speciesId) },
  },
}))
const pokegearUi: PokegearUiCoordinator = createPokegearUiCoordinator({
  getInventory: () => currentInventory, getFieldState: () => fieldScriptState,
  getMap: () => worldSession?.getState()?.map, getAudio: () => audioRuntime, getPlayerPosition: () => { const state = worldSession?.getState(); return state ? { tileX: state.tileX, tileZ: state.tileZ } : undefined },
  menu: mainMenu, menuElement: gameMenu,
  renderMenu: renderMainMenu, syncMenuCursor: syncMainMenuCursor,
  refreshInputPrompts: () => inputPrompts.refresh(), persist: () => { persistCurrentSession() },
  confirmFly: ({ title, message, yesLabel, noLabel, onConfirm }) => {
    phoneChoicePopup.open<'yes' | 'no'>({
      title,
      message,
      options: [{ value: 'yes', label: yesLabel }, { value: 'no', label: noLabel }],
      initialIndex: 1,
      cancelIndex: 1,
      onSelect: (choice) => { if (choice === 'yes') onConfirm() },
    })
  },
  useFly: pokegearFlyRuntime.use, applyMenuSelection: (index) => applyMainMenuResult(mainMenu.select(index)),
  createButton: createUtilityMenuButton, createPortrait: (trainerClass) => currentInventory!.trainerBattleSpriteResolver(trainerClass),
  createGraphic: createUtilityMenuGraphicCanvas, createPokemonIcon: (speciesId) => createUtilityMenuPokemonCanvas(speciesId),
})
const pokegearOutgoingPhone = createPokegearOutgoingPhoneCoordinator({ getSnapshot: () => currentInventory && sessionRng && worldSession?.getState()?.map ? { state: fieldScriptState, inventory: currentInventory, map: worldSession.getState()!.map, rng: sessionRng } : undefined, present: openFieldPhoneDialogue, choose: (request) => phoneChoicePopup.open(request), finish: () => { gameMenu.hidden = false; renderMainMenu(mainMenu.refresh()); inputPrompts.refresh() }, persist: () => { persistCurrentSession() }, levelPolicy: gameplayExtensionPorts.pokemonLevelPolicy })
type PendingWarpTarget = BrowserFieldPendingWarpTarget
type PendingFieldStep = Extract<WorldMoveResult, { kind: 'moved' }>
let pendingWarpTarget: PendingWarpTarget | undefined, pendingHeldWarpTarget: PendingWarpTarget | undefined, pendingCoordinateScriptId: number | undefined
let pendingFieldStep: PendingFieldStep | undefined, pendingFieldPhoneStep: PendingFieldStep | undefined
let pendingWildEncounterCheck = false
let pendingEncounterMovementMode: 'walking' | 'running' | 'cycling' | 'surfing' = 'walking'
let blockedInputUntil = 0
let playerTurnReadyAt = 0
let forcedPlayerMovement: Movement | undefined
const fieldMovementDelta: Readonly<Record<PlayerDirection, readonly [number, number]>> = {
  north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0],
}
const fieldObjectMotion = createBrowserFieldObjectMotionRuntime({
  readState: () => fieldScriptState,
  readWorldSession: () => worldSession,
  readRng: () => sessionRng?.lc,
  readVBlankFrame: () => vblankCounter,
  isFieldScriptActive: () => activeFieldScript !== undefined,
  runtime,
})
let lastWorldRenderAt = 0
const fieldExplorationRuntime = createBrowserFieldExplorationRuntime({
  runtime,
  context: {
    readFieldState: () => fieldScriptState, readInventory: () => currentInventory,
    readWorld: () => worldSession, readAudio: () => audioRuntime,
    readPlayerTextureStatus: () => playerTextureStatus,
  },
  campaign: fieldMultiplayer.exploration,
  script: {
    readActive: () => activeFieldScript, writeActive: (runner) => { activeFieldScript = runner }, has: hasFieldScript,
    create: (map, scriptId, actorId) => createFieldScriptRunner(map, scriptId, fieldScriptState, actorId, ...fieldScriptExtensionPolicies),
    sequence: (runners) => createFieldScriptSequenceRunner([...runners]), advance: advanceFieldScript,
  },
  field: {
    applyPlayerSkin: () => { applyCurrentPlayerSkin() }, syncPlayerStateFromWorld: syncFieldScriptPlayerStateFromWorld,
    resetScriptEffects: () => { fieldScriptEffectsHost.reset() },
    discardPendingStep: discardPendingFieldStep, clearMovementInput, startMovement: (movement) => { tryStartMovement(movement) },
    closeDialogue: closeFieldDialogue, recoverScriptFailure: () => { fieldFade.style.transition = 'none'; fieldFade.style.opacity = '0' },
    resetPcEntry: unifiedPcEntry.reset, resetPhoneRing: fieldPhoneRing.reset,
    setEncounterSession: (session) => { fieldEncounterSession = session },
    createEncounterSession: (inventory, state, direction) => state.pokemonRuntime
      ? createHgssFieldEncounterSession(inventory.wildEncounterCatalog, state.pokemonRuntime.rng, state.pokemonRuntime.now, direction)
      : undefined,
    clearPreparedEncounter: () => { preparedFieldWildEncounter = undefined }, clearActiveBattleRoamer: () => { activeBattleRoamerId = undefined },
    syncEnvironment: hgssEnvironment.update,
    setPresentationMap: (map) => {
      const now = fieldScriptState.pokemonRuntime?.now() ?? new Date()
      fieldWeather = map
        ? resolveHgssMapWeather(map.id, map.header.weather ?? 0, now, hasHgssRtcPenalty(rtcPenaltyState))
        : undefined
    },
    onAuthoritativePresentationFailure: () => { void fieldCampaign.close() },
    syncGym: (map, state, inventory) => { gymMechanisms.sync(map, state, inventory) },
    refreshDynamicActors: dynamicWorldActorHost.refresh, syncDynamicWorld: newGamePlusWorldHost.syncCurrentMap,
    tryDynamicWorldInteraction: newGamePlusWorldHost.tryInteract, objectMotion: fieldObjectMotion,
  },
  ui: {
    closeTransientApplications: () => { if (safariUi.isOpen()) safariUi.close(); if (photoAlbumUi.isOpen()) photoAlbumUi.close() },
    closeMenu: () => { mainMenu.close() }, refreshMenu: () => { renderMainMenu(mainMenu.refresh()) },
    requestConfirmation, setStatus: (message) => { status.textContent = message },
    setPositionStatus: (message) => { runtimePosition.textContent = message }, resetFade: resetFieldFade,
    fadeScreen: (phase, frames, color) => { applyFieldScreenFade(frames, phase === 'out' ? 0 : 1, color) },
  },
  lifecycle: { persist: (kind, explicit) => persistCurrentSession(kind, explicit), scheduleAutosave: sessionAutosave.schedule },
  gym: {
    sync: (map, state, inventory) => { gymMechanisms.sync(map, state, inventory) },
    tryInteract: (state, world) => gymMechanisms.tryInteract(state, world),
  },
})
function loadMap(...parameters: Parameters<BrowserFieldExplorationRuntime['loadMap']>): void { fieldExplorationRuntime.loadMap(...parameters) }
function refreshSafariMapVariant(): void { fieldExplorationRuntime.refreshSafariMapVariant() }
function placePlayer(animate = false, durationFrames = 8): void { fieldExplorationRuntime.placePlayer(animate, durationFrames) }
function syncFollowerPresentation(animate = false, preserveActiveMovement = false, durationFrames = 8): void { fieldExplorationRuntime.syncFollowerPresentation(animate, preserveActiveMovement, durationFrames) }
function tryOfferSurf(preferredPartySlot?: number): boolean { return fieldExplorationRuntime.tryOfferSurf(preferredPartySlot) }
function interact(): void { fieldExplorationRuntime.interact() }
function startFieldScript(map: OpeningMapPreview, scriptId: number, actorId?: number): void { fieldExplorationRuntime.startFieldScript(map, scriptId, actorId) }
function tryStartMapFrameScript(): boolean { return fieldExplorationRuntime.tryStartMapFrameScript() }

function closeFieldDialogue(): void {
  if (photoAlbumUi.isOpen()) photoAlbumUi.close()
  pokemonTransformationSceneHost.closeEggHatch()
  followerReactionRuntime.cancel()
  fieldDialogueRuntime.reset()
  unifiedPcEntry.reset()
  fieldPokemonPortrait.hidden = true
  fieldPokemonPortrait.replaceChildren()
  fieldChoiceHost.reset()
  fieldNumber.hidden = true
  fieldNickname.hidden = true
  fieldEasyChatHost.reset()
  fieldRecordAppsHost.reset()
  alphFieldUiHost.reset()
  pendingMenuNicknameSlot = undefined
}

function presentHgssSafariPhoneCall(presentation: HgssSafariIncomingCallPresentation, answer = false): boolean {
  if (answer && !answerHgssSafariIncomingCall(fieldScriptState, presentation.incoming.triggerId, inGameTimeClock.totalMinutes())) return false
  for (const [bufferId, value] of presentation.buffers) fieldScriptState.buffers.set(bufferId, value)
  fieldScriptState.pendingPhoneCall = presentation.incoming.call
  openFieldPhoneDialogue(presentation.callerName, [formatFieldMessage(presentation.message, fieldScriptState)], () => {
    finishHgssSafariHostCall(fieldScriptState, presentation, inGameTimeClock.totalMinutes()); refreshSafariMapVariant()
    persistCurrentSession()
  })
  return true
}

function answerFieldIncomingPhoneCall(payload: FieldIncomingPhoneCall): boolean {
  if (payload.safari) {
    if (!presentHgssSafariPhoneCall(payload.safari, true)) return false
    mainMenu.close(); renderMainMenu(mainMenu.refresh())
    return true
  }
  if (!consumeHgssPersistentIncomingCall(fieldScriptState.phoneCallTriggers, payload.incoming.triggerId)) return false
  fieldScriptState.pendingPhoneCall = payload.incoming.call
  activeFieldScript = createFieldPhoneCallRunner(payload.incoming.call)
  persistCurrentSession(); mainMenu.close(); renderMainMenu(mainMenu.refresh()); advanceFieldScript()
  return true
}

function animateUtilityMenuIcons(now: number): void {
  utilityMenuPokemonAnimations.animate(now, vblankCounter)
}

function submitFieldNumber(value: number | undefined): void {
  if (!activeFieldScript) return
  activeFieldScript.enterNumber(value)
  fieldNumber.hidden = true
  advanceFieldScript()
}

function submitFieldNickname(value: string | undefined): void {
  if (safariCaptureNickname.submit(value)) return
  if (value === undefined && !fieldTextEntry.isNicknameCancellable()) return
  if (pokemonTransformationSceneHost.submitNickname(value)) return
  if (pendingMenuNicknameSlot !== undefined) {
    const pokemon = fieldScriptState.party.members[pendingMenuNicknameSlot]
    const slot = pendingMenuNicknameSlot
    pendingMenuNicknameSlot = undefined
    fieldNickname.hidden = true
    if (!pokemon) {
      status.textContent = 'Le Pokémon à renommer n’est plus dans l’Équipe.'
    } else if (value === undefined) {
      status.textContent = 'Renommage annulé.'
    } else {
      const changed = setPokemonNickname(pokemon, value)
      status.textContent = changed
        ? `Le Pokémon de l’emplacement ${slot + 1} s’appelle maintenant ${pokemon.nickname ?? pokemon.speciesName}.`
        : 'Le surnom est inchangé.'
      if (changed) persistCurrentSession()
    }
    renderMainMenu(mainMenu.refresh())
    return
  }
  if (!activeFieldScript) return
  activeFieldScript.enterNickname(value)
  fieldNickname.hidden = true
  fieldTextEntry.setNicknameCancellable(true)
  advanceFieldScript()
}

function applyFieldScreenFade(durationFrames: number, type: number, color: number): void {
  const revision = ++fieldFadeRevision
  const component = (shift: number) => Math.round(((color >> shift) & 0x1f) * 255 / 31)
  fieldFade.style.backgroundColor = `rgb(${component(0)}, ${component(5)}, ${component(10)})`
  // HGSS : 0/2 masque, 1/3 révèle; sinon l'opacité reste inchangée.
  const opacity = type === 0 || type === 2 ? '1' : type === 1 || type === 3 ? '0' : fieldFade.style.opacity
  if (opacity === '0') { fieldFade.style.transition = 'none'; fieldFade.style.opacity = '1' }
  window.requestAnimationFrame(() => {
    if (revision === fieldFadeRevision) { fieldFade.style.transition = `opacity ${hgssVBlanksToMilliseconds(durationFrames)}ms steps(${Math.max(1, durationFrames)}, end)`; fieldFade.style.opacity = opacity }
  })
}

function resetFieldFade(reveal: boolean): void {
  fieldFadeRevision += 1
  fieldFade.style.transition = 'none'
  if (reveal) fieldFade.style.opacity = '0'
}

function pokemonBattleName(pokemon: CanonicalPokemon): string {
  return pokemon.nickname ?? pokemon.speciesName
}

function resolvePokemonPartySource(source: PokemonPartySlotSource): CanonicalPokemon[] | undefined {
  if (source.kind === 'single') return activeBattlePlayerParty
  if (source.kind === 'double') return activeDoubleBattle?.teams.player.find(({ ownerId }) => ownerId === source.ownerId)?.party
  return fieldScriptState.party.members
}

const battlePresentationHost = createBrowserSimpleBattlePresentationHost({
  elements: {
    screen: battleScreen,
    effects: shell.battleEffects,
    playerSprite: battlePlayerSprite,
    opponentSprite: battleOpponentSprite,
    playerParty: battlePlayerParty,
    opponentParty: battleOpponentParty,
    playerName: battlePlayerName,
    opponentName: battleOpponentName,
    playerLevel: battlePlayerLevel,
    opponentLevel: battleOpponentLevel,
    playerHp: battlePlayerHp,
    opponentHp: battleOpponentHp,
    playerExperience: battlePlayerExp,
    message: battleMessage,
    commands: battleCommands,
    choices: battleMoves,
  },
  readContext: () => ({
    resources: currentInventory,
    simpleBattle: activeBattle,
    doubleBattle: activeDoubleBattle,
    doubleActor: currentDoubleBattleActor(),
    playerParty: activeBattlePlayerParty,
    opponentParty: activeBattleOpponentParty,
    playerSlot: activeBattlePlayerSlot,
    opponentSlot: activeBattleOpponentSlot,
    teamPolicy: gameplayExtensionPorts.pokemonTeamPolicy,
    battleAnimations: gameOptions.battleAnimations,
    presentationGeneration: battlePresentationGeneration,
    vblank: vblankCounter,
    audio: audioRuntime,
  }),
  state: {
    readMode: () => battleUiMode,
    setMode: setBattleUiMode,
    readCursor: () => battleUiCursor,
    setCursor: (cursor) => { battleUiCursor = cursor },
    setPartySelectionForced: (forced) => { battlePartySelectionForced = forced },
    setPendingItemId: (itemId) => { pendingBattleItemId = itemId },
    setMessageInputLocked: (locked) => { battleMessageInputLocked = locked },
  },
  presentation: {
    setPhase: setBattlePresentation,
    reducedMotion: prefersReducedBattleMotion,
    trackAnimation: trackBattleAnimationStep,
    restartAnimation: restartBattleAnimation,
    lockAnimation: () => {
      const generation = battlePresentationGeneration
      battlePresentationAnimationLocks += 1
      return () => {
        if (generation === battlePresentationGeneration) {
          battlePresentationAnimationLocks = Math.max(0, battlePresentationAnimationLocks - 1)
        }
      }
    },
    skip: battlePresentationSkip,
    reportAnimationDiagnostic: recordBattleAnimationDiagnostic,
  },
  assets: {
    canvas: menuCanvasAssets,
    pokemonAnimator: battlePokemonSpriteAnimator,
    gaugeAnimationVersions: battleGaugeAnimationVersions,
    createPokemonIcon: (pokemon) => createUtilityMenuPokemonCanvas(
      pokemon.speciesId,
      pokemon.form,
      pokemon.isEgg,
      pokemon.shiny,
      pokemon.gender,
      'battle',
    ),
    createItemIcon: (itemId) => {
      const inventory = currentInventory
      if (!inventory) throw new Error(`L'icône ROM de l'objet ${itemId} est absente.`)
      return createUtilityMenuGraphicCanvas(inventory.itemIconResolver(itemId))
    },
  },
  inventory: {
    listBattleBagEntries: () => currentInventory
      ? selectBaseFieldBattleBagEntries(fieldScriptState.inventory, currentInventory.itemCatalog.items)
      : [],
    isBattleBagItemBlocked: (item) => gameplayExtensionPorts.fieldBattleBagActionResolver(item, {
      opponent: activeBattle?.kind === 'wild' || activeDoubleBattle?.kind === 'wild' ? 'wild' : 'trainer',
    }).kind === 'blocked',
  },
  progression: { resolvePartySource: resolvePokemonPartySource },
  messages: {
    prepend: (message) => { battleMessageQueue.unshift(message) },
    showNext: showNextBattleMessage,
  },
  syncActiveParties: syncActiveBattlePokemonToParties,
  getPokemonName: pokemonBattleName,
})

const trainerBattleIntroductionHost = createBrowserTrainerBattleIntroductionHost({
  readContext: () => ({
    battle: activeBattle,
    resources: currentInventory,
    presentationAnimationLocks: battlePresentationAnimationLocks,
  }),
  getPokemonName: pokemonBattleName,
  presentation: {
    setBattlePresentation,
    setBattleUiMode,
    setMessage: (message) => { battleMessage.textContent = message },
    setMessageVisible: (visible) => { battleMessage.hidden = !visible },
    setMessageInputLocked: (locked) => { battleMessageInputLocked = locked },
    showPartyGauge: (side, members) => {
      const element = side === 'player' ? battlePlayerParty : battleOpponentParty
      renderBattlePartyGauge(element, members)
      element.hidden = false
    },
    hidePartyGauge: (side) => {
      ;(side === 'player' ? battlePlayerParty : battleOpponentParty).hidden = true
    },
    hideOpponentTrainer: () => { battleOpponentTrainer.hidden = true },
  },
  animations: {
    playEncounterAnimation: () => restartBattleAnimation(battleScreen, 'is-trainer-encounter'),
    playTrainerEntrance: () => playBattleTrainerEntrance({ trainer: battleOpponentTrainer }),
    playTrainerThrow: () => playBattleTrainerThrow({ trainer: battleOpponentTrainer }),
    track: trackBattleAnimationStep,
    sendOut: playSimpleBattlePokemonSendOut,
  },
  completion: {
    consumeInitialEvents: consumeSimpleBattleInitialEvents,
    queueInitialEvents: (events) => { queueBattleEvents(events) },
    showCommands: showBattleCommands,
  },
})

function renderBattleCursor(container: HTMLElement): void { battlePresentationHost.renderCursor(container) }
function moveBattleCursor(container: HTMLElement, direction: 'left' | 'right' | 'up' | 'down'): void { battlePresentationHost.moveCursor(container, direction) }
const doubleBattleScene = createBrowserDoubleBattleSceneHost({
  elements: {
    screen: battleScreen,
    playerSprite: battlePlayerSprite,
    opponentSprite: battleOpponentSprite,
    playerParty: battlePlayerParty,
    opponentParty: battleOpponentParty,
    message: battleMessage,
    commands: battleCommands,
    moves: battleMoves,
  },
  readContext: () => ({
    battle: activeDoubleBattle,
    resources: currentInventory,
    selection: doubleBattleCommandSelection,
    teamPolicy: gameplayExtensionPorts.pokemonTeamPolicy,
    vblank: vblankCounter,
  }),
  setSelection: (selection) => { doubleBattleCommandSelection = selection },
  setCommandPresentation: () => { setBattlePresentation('command') },
  setUiMode: setBattleUiMode,
  setCursor: (cursor) => { battleUiCursor = cursor },
  renderCursor: renderBattleCursor,
  getPokemonName: pokemonBattleName,
  getBagItemCount: battlePresentationHost.getBagItemCount,
  createPokemonIcon: createBattleMenuPokemonIcon,
  selectTarget: (target) => { selectDoubleBattleTarget(target) },
  syncHpZone: syncBattleHpZone,
  gaugeAnimationVersions: battleGaugeAnimationVersions,
  canvasAssets: menuCanvasAssets,
  spriteAnimator: battlePokemonSpriteAnimator,
})
const {
  element: doubleBattleElement,
  render: renderDoubleBattle,
  currentActor: currentDoubleBattleActor,
  showCommands: showDoubleBattleCommands,
  showMoves: showDoubleBattleMoves,
  showParty: showDoubleBattleParty,
  showTargets: showDoubleBattleTargets,
} = doubleBattleScene

function commitDoubleBattleReplacement(partyIndex: number): void {
  const battle = activeDoubleBattle
  const inventory = currentInventory
  const rng = fieldScriptState.pokemonRuntime?.rng
  const pending = doubleBattleCommandSelection.pendingReplacement
  if (!battle || !inventory || !rng || !pending || !pending.reserveIndexes.includes(partyIndex)) return
  doubleBattleCommandSelection = clearPendingDoubleBattleReplacement(doubleBattleCommandSelection)
  const events = submitDoubleBattleReplacement(battle, pending.target, partyIndex, inventory.pokemonCatalog, rng, gameplayExtensionPorts.pokemonTeamPolicy)
  queueDoubleBattleEvents(events)
}
const queueDoubleBattleEvents = createBrowserDoubleBattleEventPresenter({
  readContext: () => ({
    battle: activeDoubleBattle,
    resources: currentInventory,
    player: { id: playerProfile.trainerId!, name: playerProfile.name, gender: playerProfile.gender },
    nativeLanguage: fieldScriptState.pokemonRuntime?.language,
    currentLocationId: worldSession?.getState()?.map.id,
    suppressProgression: activeBattleSuppressProgression,
    opponentTrainerIds: activeBattleOpponentTrainerIds,
    battleAnimations: gameOptions.battleAnimations,
    presentationGeneration: battlePresentationGeneration,
    audio: audioRuntime,
    outcomeObserver: gameplayExtensionPorts.detailedBattleOutcomeObserver,
  }),
  scene: doubleBattleScene,
  elements: {
    screen: battleScreen,
    effects: shell.battleEffects,
  },
  presentation: {
    animateHp: (position, amount) => {
      const { hud } = doubleBattleElement(position)
      return animateBattleProgress(
        hud.querySelector<HTMLProgressElement>('progress')!,
        hud.querySelector<HTMLElement>('.battle-hp-text'),
        amount,
      )
    },
    playCondition: (position, animation) => {
      const { sprite, hud } = doubleBattleElement(position)
      playBattleConditionEffect(position.side, animation, {
        player: position.side === 'player' ? sprite : battlePlayerSprite,
        opponent: position.side === 'opponent' ? sprite : battleOpponentSprite,
        hud,
      })
    },
    beginAction: beginBattleAction,
    finishAction: finishBattleAction,
    setMessageInputLocked: (locked) => { battleMessageInputLocked = locked },
    trackAnimation: trackBattleAnimationStep,
    playSendOut: (position, pokemon, sprite, hud) => {
      battlePokemonSendOut.play([{ ...position, pokemon, sprite, hud }])
    },
    showLevelUpCard: showBattleLevelUpCard,
    createSpriteEffectPlayback: createActiveBattleSpriteEffectPlayback,
    onAnimationDiagnostic: recordBattleAnimationDiagnostic,
    skip: battlePresentationSkip,
  },
  progression: {
    apply: applyBattleProgression,
    messagePresenter: battleProgressionPresenter,
    deferred: deferredBattleProgression,
    createEvolutionEntry: pokemonTransformationSceneHost.createEvolutionEntry,
    settleMoney: settleBattleMoney,
  },
  messages: {
    replace: (entries) => { battleMessageQueue = [...entries] },
    append: (entries) => { battleMessageQueue = [...battleMessageQueue, ...entries] },
    showNext: showNextBattleMessage,
  },
  protectEvents: import.meta.env.DEV
    ? (battle, events) => realtimeBattleDebug!.protectDoubleEvents(battle, events)
    : undefined,
  markSeen: (pokemon) => { markPokemonSeen(fieldScriptState.pokedex, pokemon) },
  getPokemonName: pokemonBattleName,
}).queue
function commitDoubleBattleAction(action: DoubleBattleAction, showImmediately = true): void {
  const battle = activeDoubleBattle, inventory = currentInventory, rng = fieldScriptState.pokemonRuntime?.rng
  if (!battle || !inventory || !rng) return
  const itemRole = action.kind === 'item' ? resolveBattleBagActionRole(action.itemId, battle.kind === 'wild' ? 'wild' : 'trainer') : undefined
  if (action.kind === 'switch' && rejectPlayerBattleAction({ kind: 'switch', format: 'double', mode: 'voluntary', partyIndex: action.partyIndex })) return
  if (itemRole && action.kind === 'item' && rejectPlayerBattleAction({ kind: 'bag', format: 'double', itemId: action.itemId, role: itemRole })) return
  const transition = commitDoubleBattleCommandAction(battle, doubleBattleCommandSelection, action)
  doubleBattleCommandSelection = transition.state
  if (transition.kind === 'awaiting-action') { if (showImmediately) showDoubleBattleCommands(); return }
  queueDoubleBattleEvents(executeAdmittedDoubleBattleTurn(battle, transition.actions, inventory.pokemonCatalog, rng, gameplayExtensionPorts.pokemonTeamPolicy, gameplayExtensionPorts.battleActionPolicy, gameplayExtensionPorts.pokemonPartyHealingPolicy), showImmediately)
}
function selectDoubleBattleTarget(target: DoubleBattlePosition): void {
  const battle = activeDoubleBattle, actor = currentDoubleBattleActor(), moveIndex = doubleBattleCommandSelection.pendingMoveIndex
  if (!battle || !actor || moveIndex === undefined) return
  doubleBattleScene.rememberMove(actor, moveIndex)
  commitDoubleBattleAction({ actor, moveIndex, target })
}
function selectDoubleBattleItemTarget(partyIndex: number, moveIndex?: number): void {
  const battle = activeDoubleBattle, actor = currentDoubleBattleActor(), inventory = currentInventory, itemId = pendingBattleItemId
  if (!battle || !actor || !inventory || itemId === undefined) return
  const participant = battle.teams[actor.side][actor.slot], target = participant.party[partyIndex], item = inventory.itemCatalog.items[itemId]
  if (!target || !item) return
  const parameters = item.partyParameters
  if (moveIndex === undefined && (parameters.ppRestore || parameters.ppUp || parameters.ppMax)) {
    pendingBattleItemTargetSlot = partyIndex; setBattleUiMode('bagMove'); battleUiCursor = 0
    battleMessage.textContent = inventory.uiMessageBanks[6]?.[94] ?? ''; battleMoves.replaceChildren(...createBattlePpItemChoices(target, inventory.pokemonCatalog.moveNames, Boolean(parameters.ppRestore && !parameters.ppUp && !parameters.ppMax), inventory.uiMessageBanks[6]?.[43] ?? ''))
    renderBattleCursor(battleMoves); return
  }
  pendingBattleItemId = undefined; pendingBattleItemTargetSlot = undefined
  const action = { kind: 'item', actor, itemId, targetPartyIndex: partyIndex, moveIndex } as const, reason = validateDoubleBattleBagItem(battle, action, inventory.pokemonCatalog, gameplayExtensionPorts.pokemonPartyHealingPolicy)
  if (reason) { battleMessageQueue = [reason]; showNextBattleMessage(); return }
  commitDoubleBattleAction(action)
}
function startDoubleBattle(session: DoubleBattleSession, opponentTrainerIds: readonly number[] = []): void {
  if (fieldCampaign.isFieldLocked()) return
  const inventory = currentInventory
  if (!inventory) throw new Error('Le catalogue ROM du combat double est absent.')
  resetBattleScenePresentation(battleScreen, { mode: 'start' })
  activeDoubleBattle = session
  activeBattle = undefined; if (import.meta.env.DEV) realtimeCampaignAudit!.recordDoubleBattle(session.teams.player.filter(({ controlled }) => controlled).length)
  battlePokemonSpriteAnimator.clearDouble()
  resetBattlePresentationAsyncState()
  activeBattleOpponentTrainerIds = [...opponentTrainerIds]
  activeBattleMoneySettled = false
  const region = worldSession?.getState()?.map.header.region ?? 0
  const trainerClass = inventory.trainerCatalog[opponentTrainerIds[0] ?? -1]?.trainerClass
  const wildOpponent = session.kind === 'wild' ? getDoubleBattlePokemon(session, { side: 'opponent', slot: 0 }) : undefined
  const music = wildOpponent ? resolveHgssWildBattleMusic(wildOpponent.speciesId, region) : trainerClass === undefined ? undefined : resolveHgssTrainerBattleMusic(trainerClass, region)
  if (music !== undefined) void audioRuntime?.playMusic(music).catch(() => {})
  if (session.kind === 'wild') recordHgssWildEncounterStarted(fieldScriptState)
  if (battleLaunchTimer !== undefined) window.clearTimeout(battleLaunchTimer)
  if (battleExitTimer !== undefined) window.clearTimeout(battleExitTimer)
  battleActionLease?.close()
  battleLaunchTimer = undefined
  battleExitTimer = undefined
  battleActionLease = undefined
  doubleBattleCommandSelection = createDoubleBattleCommandSelectionState()
  doubleBattleScene.clearRememberedMoves()
  const battleBackgroundId = getCurrentHgssFieldBattleEnvironment().backgroundId
  menuCanvasAssets.mountGraphicCanvas(battleBackground, createHgssSingleScreenBattleBackdrop(
    inventory.battleBackgroundResolver({ backgroundId: battleBackgroundId, timeOfDay: resolveHgssBattlePaletteTime(currentHgssTimeOfDay()) }),
  ))
  battleScreen.dataset.battleKind = 'double'
  battleScreen.dataset.weather = resolveHgssBattleWeather(fieldScriptState.weather)
  battleOpponentParty.hidden = true
  battlePlayerParty.hidden = true
  renderDoubleBattle(true)
  battleOpponentTrainer.classList.toggle('is-double', opponentTrainerIds.length > 1)
  battleOpponentTrainer.replaceChildren(...opponentTrainerIds.map((trainerId) => {
    const trainer = inventory.trainerCatalog[trainerId]
    if (!trainer) throw new Error(`Le Dresseur ROM ${trainerId} est absent du combat double.`)
    return menuCanvasAssets.createGraphicCanvas(inventory.trainerBattleSpriteResolver(trainer.trainerClass))
  }))
  battleOpponentTrainer.hidden = true
  for (const position of getDoubleBattleOccupiedPositions(session).filter(({ side }) => side === 'opponent')) markPokemonSeen(fieldScriptState.pokedex, getDoubleBattlePokemon(session, position))
  setBattleUiMode('message')
  battleCommands.hidden = true
  battleMoves.hidden = true
  battleMessage.hidden = true
  battleMessageInputLocked = true
  deferredBattleProgression.clear()
  pokemonTransformationSceneHost.hideScene()
  battleMessageQueue = [
    {
      text: session.kind === 'wild' ? 'Combat sauvage en duo!' : `${session.kind === 'multi' ? 'Combat Multi' : 'Combat Double'}!`,
      onShow: session.kind === 'wild' ? undefined : () => { trackBattleAnimationStep(playBattleTrainerEntrance({ trainer: battleOpponentTrainer })) },
    },
    ...(['opponent', 'player'] as const).map((side): BattleMessageEntry => ({
      text: `${session.teams[side].map((_, slot) => pokemonBattleName(getDoubleBattlePokemon(session, { side, slot: slot as 0 | 1 }))).join(' et ')} entrent en scène!`,
      onShow: () => {
        if (side === 'opponent' && session.kind !== 'wild') {
          const trainerThrow = playBattleTrainerThrow({ trainer: battleOpponentTrainer })
          trackBattleAnimationStep(trainerThrow)
          void trainerThrow?.finished.then(() => { if (activeDoubleBattle === session) battleOpponentTrainer.hidden = true })
        }
        battlePokemonSendOut.play(getDoubleBattleOccupiedPositions(session).filter((position) => position.side === side).map((position) => {
          const visual = doubleBattleElement(position)
          return { ...position, pokemon: getDoubleBattlePokemon(session, position), ...visual }
        }), { completionWindowFrames: side === 'player' ? HGSS_BATTLE_SEND_OUT_TIMING.playerIntroductionWindowFrames : HGSS_BATTLE_SEND_OUT_TIMING.opponentIntroductionWindowFrames })
      },
    })),
  ]; queueDoubleBattleEvents(consumeDoubleBattleInitialEvents(session), false)
  battleEntryTransition.play({ kind: session.kind === 'wild' ? 'wild' : 'double', backgroundId: battleBackgroundId, variantSeed: opponentTrainerIds[0] })
  if (battleLaunchTimer !== undefined) window.clearTimeout(battleLaunchTimer)
  battleLaunchTimer = window.setTimeout(() => {
    battleLaunchTimer = undefined
    if (activeDoubleBattle !== session) return
    setBattlePresentation('introduction')
    battleMessageInputLocked = false
    showNextBattleMessage()
  }, prefersReducedBattleMotion() ? 0 : 960)
}
function finishDoubleBattle(): void {
  const battle = activeDoubleBattle
  if (!battle?.result || battleExitTimer !== undefined) return
  battleMessageInputLocked = true
  setBattlePresentation('exiting')
  battleExitTimer = window.setTimeout(completeDoubleBattleExit, prefersReducedBattleMotion() ? 0 : 620)
}
function createBattleMapResumeRunner(resume: FieldScriptRunner): FieldScriptRunner {
  const map = worldSession?.getState()?.map
  return map
    ? createFieldScriptMapInitSequenceRunner(map, fieldScriptState, 'load', resume, ...fieldScriptExtensionPolicies) ?? resume
    : resume
}
function completeDoubleBattleExit(): void {
  battleExitTimer = undefined
  const battle = activeDoubleBattle
  if (!battle?.result) return
  resetBattlePresentationAsyncState()
  const naturalWildBlackout = battle.kind === 'wild' && battle.result === 'lost' && !activeBattleScript
  if (battle.kind === 'wild' && battle.result !== 'captured' && !activeBattleSuppressProgression) scheduleHgssPostWildBattleCalls(fieldScriptState, () => fieldPhoneRing.primeUrgentIncomingCall())
  activeBattleScript?.submitBattleResult(battle.result !== 'lost'); if (import.meta.env.DEV && battle.result === 'won') recordBotWins(realtimeWonTrainerBattleIds, botJourneyAgent, activeBattleOpponentTrainerIds)
  const parties = syncDoubleBattleParties(battle)
  const playerParty = parties.get('player')
  if (playerParty) { fieldScriptState.party.members = playerParty.map(cloneCanonicalPokemon); const rng = fieldScriptState.pokemonRuntime?.rng; if (rng && !activeBattleSuppressProgression) applyPostBattle(fieldScriptState.party, rng, battle.result === 'won') }
  if (battle.kind === 'wild') {
    const opponent = getDoubleBattlePokemon(battle, { side: 'opponent', slot: 0 }), mapId = worldSession?.getState()?.map.id, rng = fieldScriptState.pokemonRuntime?.rng
    if (activeBattleRoamerId !== undefined && mapId !== undefined && rng) applyHgssRoamerBattleResult(fieldScriptState.roamers, activeBattleRoamerId, opponent, battle.result, mapId, rng)
    else if (battle.result !== 'lost' && mapId !== undefined && rng && rng.nextU16() % 100 < 30) repelActiveHgssRoamersFromMap(fieldScriptState.roamers, mapId, rng)
    syncFollowerPresentation(true)
  }
  if (battle.result === 'lost' && activeBattleHealAfterLoss) healPokemonPartyWithPolicy(fieldScriptState.party, gameplayExtensionPorts.pokemonPartyHealingPolicy)
  battleScreen.classList.remove('is-evolution-only')
  resetBattleScenePresentation(battleScreen, { mode: 'exit' })
  battleOpponentTrainer.replaceChildren()
  activeDoubleBattle = undefined
  preparedFieldWildEncounter = undefined
  activeBattleRoamerId = undefined
  battlePokemonSpriteAnimator.clearDouble()
  activeBattleOpponentTrainerIds = []
  activeBattleMoneySettled = false
  battleMessageInputLocked = false
  doubleBattleCommandSelection = createDoubleBattleCommandSelectionState()
  battleMoveLearning.clear()
  battleMoves.classList.remove('battle-learn-move')
  battleMessageQueue = []
  pokemonTransformationSceneHost.clearEvolution()
  deferredBattleProgression.clear()
  const resume = activeBattleScript
  activeBattleScript = undefined
  activeBattleHealAfterLoss = false
  const worldState = worldSession?.getState()
  if (naturalWildBlackout) { performNativeBlackout(); return }
  activeBattleSuppressProgression = false; newGamePlusWorldHost.syncCurrentMap()
  if (worldState) void playHgssFieldMusic(audioRuntime, worldState.map, fieldScriptState.radioMusicSequenceId)?.catch(() => {})
  if (resume) { activeFieldScript = createBattleMapResumeRunner(resume); advanceFieldScript() } else persistCurrentSession()
}
function syncActiveBattlePokemonToParties(): void {
  if (!activeBattle) return
  if (activeBattlePlayerParty[activeBattlePlayerSlot]) activeBattlePlayerParty[activeBattlePlayerSlot] = clonePersistentSimpleBattlePokemon(activeBattle.player)
  if (activeBattleOpponentParty[activeBattleOpponentSlot]) activeBattleOpponentParty[activeBattleOpponentSlot] = clonePersistentSimpleBattlePokemon(activeBattle.opponent)
}
function syncProgressedBattlePartySlot(slot: number): void {
  if (!activeBattle || slot !== activeBattlePlayerSlot) return
  const pokemon = activeBattlePlayerParty[slot]
  if (pokemon) activeBattle.player.pokemon = cloneCanonicalPokemon(pokemon)
}
function queueSingleBattleExperience(defeated: CanonicalPokemon): void {
  const inventory = currentInventory
  const battle = activeBattle
  if (!inventory || !battle) return
  syncActiveBattlePokemonToParties()
  if (activeBattleSuppressProgression) return
  const recipients = resolveFieldBattleExperienceRecipients({
    party: activeBattlePlayerParty,
    participantPartyIndexes: activeBattleParticipantSlots,
    player: { id: playerProfile.trainerId!, name: playerProfile.name, gender: playerProfile.gender },
    nativeLanguage: fieldScriptState.pokemonRuntime?.language,
    currentLocationId: worldSession?.getState()?.map.id,
    readHeldItem: (pokemon) => ({
      effect: inventory.itemCatalog.items[pokemon.heldItemId]?.holdEffect ?? 0,
      parameter: inventory.itemCatalog.items[pokemon.heldItemId]?.holdEffectParameter ?? 0,
    }),
  })
  for (const { partyIndex: slot, pokemon, experienceDivisor, modifiers } of recipients) {
    const source = { kind: 'single', partySlot: slot } as const
    const before = cloneCanonicalPokemon(pokemon)
    const progression = applyBattleProgression(
      pokemon,
      defeated,
      inventory.pokemonCatalog,
      battle.kind === 'trainer',
      experienceDivisor,
      modifiers,
    )
    syncProgressedBattlePartySlot(slot)
    if (progression.experienceGained === 0) continue
    battleMessageQueue.push({
      text: formatBattleRomMessage(
        inventory.battleMessages[1] ?? '{101 0,0} a gagné\n{136 1,0} points Exp.!',
        [pokemonBattleName(pokemon), String(progression.experienceGained)],
      ),
      onShow: () => {
        if (slot !== activeBattlePlayerSlot) return
        renderBattleHud(before)
        void animateBattleExperience(before, pokemon)
      },
    })
    for (const level of progression.levels) {
      battleMessageQueue.push({
        text: `${pokemonBattleName(pokemon)} monte au niveau ${level.level}!`,
        onShow: () => {
          if (slot === activeBattlePlayerSlot) {
            battlePlayerLevel.textContent = `N. ${level.level}`
            battlePlayerHp.max = level.statsAfter.hp
            battlePlayerHp.value = level.currentHpAfter
            battlePlayerHpText.textContent = `${level.currentHpAfter} / ${level.statsAfter.hp}`
            syncBattleHpZone(battlePlayerHp)
          }
          showBattleLevelUpCard(pokemon, level)
        },
      })
      battleProgressionPresenter.enqueueMoveLearning(deferredBattleProgression, pokemon, source, level.learnedMoveIds, level.skippedMoveIds)
    }
    if (progression.levels.length > 0) {
      const evolutionEntry = pokemonTransformationSceneHost.createEvolutionEntry(pokemon, source)
      deferredBattleProgression.enqueueEvolution(battleEvolutionQueueKey(pokemon, source), evolutionEntry)
    }
  }
}

function settleBattleMoney(result: 'won' | 'lost', ordinaryDouble = false): string | undefined {
  const inventory = currentInventory
  if (!inventory || activeBattleMoneySettled || activeBattleSuppressProgression) return undefined
  activeBattleMoneySettled = true
  if (result === 'won') {
    const prizeMoneyValue = activeBattle?.prizeMoneyMultiplier ?? activeDoubleBattle?.prizeMoneyMultiplier ?? 1
    const payDayAmount = calculateHgssPayDayPayout(activeBattle?.payDayCoins ?? activeDoubleBattle?.payDayCoins ?? 0, prizeMoneyValue)
    if (activeBattleOpponentTrainerIds.length === 0 && payDayAmount === 0) return undefined
    const tagBattle = activeBattleOpponentTrainerIds.length > 1
    const amount = activeBattleOpponentTrainerIds.reduce((total, trainerId) => {
      const trainer = inventory.trainerCatalog[trainerId]
      return trainer
        ? total + calculateHgssTrainerPrizeMoney(trainer, inventory.battlePrizeMoneyTable, { ordinaryDouble: ordinaryDouble && !tagBattle, prizeMoneyValue })
        : total
    }, payDayAmount)
    fieldScriptState.money = Math.min(999_999, fieldScriptState.money + amount)
    return formatBattleRomMessage(
      inventory.battleMessages[33] ?? '{103 0,0} reçoit ₽{105 1,0} pour sa victoire!',
      [playerProfile.name, String(amount)],
    )
  }
  const party = activeDoubleBattle
    ? syncDoubleBattleParties(activeDoubleBattle).get('player') ?? fieldScriptState.party.members
    : activeBattlePlayerParty
  const amount = calculateHgssMoneyLoss(party, fieldScriptState.badges.size, fieldScriptState.money)
  fieldScriptState.money -= amount
  if (amount === 0) return undefined
  return formatBattleRomMessage(
    inventory.battleMessages[activeBattleOpponentTrainerIds.length > 0 ? 35 : 34]
      ?? `${playerProfile.name} perd ₽${amount}!`,
    [playerProfile.name, String(amount)],
  )
}

function refreshActiveBattleSprite(side: 'player' | 'opponent', pokemonOverride?: CanonicalPokemon, enter = true): void { battlePresentationHost.refreshSprite(side, pokemonOverride, enter) }
function renderSimpleBattleSideHud(side: 'player' | 'opponent', pokemon: CanonicalPokemon, types: readonly number[], stages: import('./game/battle/hgssBattleRules').BattleStatStages, state?: SimpleBattleSession['player']): void { battlePresentationHost.renderSideHud(side, pokemon, types, stages, state) }
function renderPersistentBattlePartyGauges(player: CanonicalPokemon, opponent: CanonicalPokemon): void { battlePresentationHost.renderPersistentPartyGauges(player, opponent) }
function renderBattleHud(playerOverride?: CanonicalPokemon): void { battlePresentationHost.renderHud(playerOverride) }

function playBattleConditionEffect(
  side: 'player' | 'opponent',
  animation: HgssBattlePresentationAnimation,
  elements?: { player: HTMLElement, opponent: HTMLElement, hud?: HTMLElement },
): void {
  battlePresentationHost.playConditionEffect(side, animation, elements)
}

function createActiveBattleSpriteEffectPlayback() { return battlePresentationHost.createSpriteEffectPlayback() }

function showBattleLevelUpCard(pokemon: CanonicalPokemon, level: BattleLevelUp): void { battlePresentationHost.showLevelUpCard(pokemon, level) }

function showBattleMoveLearningChoice(request: PokemonMoveLearningRequest<CanonicalPokemonPartyTarget>): void { battlePresentationHost.showMoveLearningChoice(request) }
function animateBattleExperience(from: CanonicalPokemon, to: CanonicalPokemon): Promise<void> { return battlePresentationHost.animateExperience(from, to) }
function syncBattleHpZone(progress: HTMLProgressElement): void { battlePresentationHost.syncHpZone(progress) }

function showBattleCommands(): void { battlePresentationHost.showCommands() }
function showBattleMoves(): void { battlePresentationHost.showMoves() }
function createBattleMenuPokemonIcon(pokemon: CanonicalPokemon): HTMLElement | undefined { return battlePresentationHost.createPokemonIcon(pokemon) }
function showBattleParty(forced = false): void { battlePresentationHost.showParty(forced) }
function showBattleBag(): void { battlePresentationHost.showBag() }
function showBattleItemTargets(itemId: number): void { battlePresentationHost.showItemTargets(itemId) }

function finishActiveBattle(): void {
  if (!activeBattle || battleExitTimer !== undefined) return
  battleMessageInputLocked = true
  setBattlePresentation('exiting')
  battleExitTimer = window.setTimeout(completeActiveBattleExit, prefersReducedBattleMotion() ? 0 : 620)
}

function completeActiveBattleExit(): void {
  battleExitTimer = undefined
  const battle = activeBattle
  resetBattlePresentationAsyncState()
  const naturalWildBlackout = battle?.result === 'lost' && battle.kind === 'wild' && !activeBattleScript
  if (battle?.kind === 'wild' && battle.result !== 'captured' && !activeBattleSuppressProgression) scheduleHgssPostWildBattleCalls(fieldScriptState, () => fieldPhoneRing.primeUrgentIncomingCall())
  if (!battle?.result || battle.result === 'escaped' || battle.result === 'captured') {
    activeBattleScript?.submitBattleResult(true)
  } else {
    activeBattleScript?.submitBattleResult(battle.result === 'won')
  } if (import.meta.env.DEV && battle?.result === 'won') recordBotWins(realtimeWonTrainerBattleIds, botJourneyAgent, activeBattleOpponentTrainerIds)
  if (battle) {
    syncActiveBattlePokemonToParties()
    if (activeBattleRoamerId !== undefined && battle.result) {
      const opponent = activeBattleOpponentParty[activeBattleOpponentSlot]
      const mapId = worldSession?.getState()?.map.id
      const rng = fieldScriptState.pokemonRuntime?.rng
      if (opponent && mapId !== undefined && rng) {
        applyHgssRoamerBattleResult(fieldScriptState.roamers, activeBattleRoamerId, opponent, battle.result, mapId, rng)
      }
    } else if (battle.kind === 'wild' && battle.result && battle.result !== 'lost') {
      const mapId = worldSession?.getState()?.map.id
      const rng = fieldScriptState.pokemonRuntime?.rng
      if (mapId !== undefined && rng && rng.nextU16() % 100 < 30) {
        repelActiveHgssRoamersFromMap(fieldScriptState.roamers, mapId, rng)
      }
    }
    fieldScriptState.party.members = (activeBattleRestorePlayerParty ?? activeBattlePlayerParty).map(cloneCanonicalPokemon); const postBattleRng = fieldScriptState.pokemonRuntime?.rng; if (postBattleRng && !activeBattleSuppressProgression) applyPostBattle(fieldScriptState.party, postBattleRng, battle.result === 'won')
    syncFollowerPresentation(true)
  }
  if (battle?.result === 'lost' && activeBattleHealAfterLoss) healPokemonPartyWithPolicy(fieldScriptState.party, gameplayExtensionPorts.pokemonPartyHealingPolicy)
  battleScreen.classList.remove('is-evolution-only')
  resetBattleScenePresentation(battleScreen, { mode: 'exit' })
  battlePokemonSpriteAnimator.clearSimple()
  battleOpponentTrainer.replaceChildren()
  battleMessageQueue = []
  pokemonTransformationSceneHost.clearEvolution()
  if (battleLaunchTimer !== undefined) window.clearTimeout(battleLaunchTimer)
  battleActionLease?.close()
  battleLaunchTimer = undefined
  battleActionLease = undefined
  deferredBattleProgression.clear()
  trainerBattleIntroductionHost.clear()
  battleMoveLearning.clear()
  battleMoves.classList.remove('battle-learn-move')
  pendingBattleItemId = undefined
  pendingBattleItemTargetSlot = undefined
  battlePartySelectionForced = false
  battleMessageInputLocked = false
  activeBattleHealAfterLoss = false
  activeBattleRestorePlayerParty = undefined
  activeBattleSuppressProgression = false
  activeBattleTutorialStep = undefined
  activeBattle = undefined
  battlePokemonSpriteAnimator.clearDouble()
  activeBattleOpponentTrainerIds = []
  activeBattleMoneySettled = false
  activeBattleParticipantSlots.clear()
  activeBattlePlayerParty = []
  activeBattleOpponentParty = []
  preparedFieldWildEncounter = undefined
  activeBattleRoamerId = undefined
  const resume = activeBattleScript
  activeBattleScript = undefined
  if (naturalWildBlackout) {
    performNativeBlackout()
    return
  }
  newGamePlusWorldHost.syncCurrentMap()
  const worldState = worldSession?.getState()
  if (worldState) void playHgssFieldMusic(audioRuntime, worldState.map, fieldScriptState.radioMusicSequenceId)?.catch(() => {})
  if (resume) {
    activeFieldScript = createBattleMapResumeRunner(resume)
    advanceFieldScript()
  } else {
    persistCurrentSession()
  }
}

function finishSafariBattle(finish: HgssSafariBattleFinish): void {
  gameplayExtensionPorts.detailedBattleOutcomeObserver.observeBattleOutcome(projectHgssSafariBattleFinishOutcome(finish))
  resetBattlePresentationAsyncState()
  resetBattleScenePresentation(battleScreen, { mode: 'exit' })
  activeSafariBattlePokemon = undefined
  preparedFieldWildEncounter = undefined
  if (finish.returnToDynamicWarp) {
    const result = worldSession?.transitionTo(hgssDynamicWarpSentinelMapId, hgssDynamicWarpSentinelAnchor)
    if (!result || result.kind !== 'transitioned' || finish.exitScriptId === undefined) throw new Error('Le retour dynamique du Parc Safari est indisponible.')
    if (!hasFieldScript(result.state.map, finish.exitScriptId)) throw new Error(`Le script standard Safari ${finish.exitScriptId} est absent de la ROM.`)
    clearMovementInput()
    loadMap(result.state.map, 'transition', result.arrival, false, createFieldScriptRunner(result.state.map, finish.exitScriptId, fieldScriptState, undefined, ...fieldScriptExtensionPolicies))
    return
  }
  newGamePlusWorldHost.syncCurrentMap()
  const world = worldSession?.getState()
  if (world) void playHgssFieldMusic(audioRuntime, world.map, fieldScriptState.radioMusicSequenceId)?.catch(() => undefined)
  if (finish.exitScriptId !== undefined) {
    if (!world || !hasFieldScript(world.map, finish.exitScriptId)) throw new Error(`Le script standard Safari ${finish.exitScriptId} est absent de la ROM.`)
    startFieldScript(world.map, finish.exitScriptId)
  } else persistCurrentSession()
}

function performNativeBlackout(): void {
  const inventory = currentInventory
  if (!inventory || !worldSession) throw new Error('Le runtime ROM requis pour le blackout est absent.')
  const interruptedScript = activeFieldScript
  const destination = inventory.blackoutDestinationResolver(fieldScriptState.blackoutSpawn)
  fieldScriptState.followMonActive = false
  fieldScriptState.followMonMovementPaused = false
  initializeHgssGymmickState(fieldScriptState, 0)
  worldSession.setFollowerEnabled(false)
  healPokemonPartyWithPolicy(fieldScriptState.party, gameplayExtensionPorts.pokemonPartyHealingPolicy)
  const result = worldSession.scriptWarpTo(destination.mapId, destination.x, destination.z, destination.direction)
  if (result.kind !== 'transitioned') {
    throw new Error(`Le blackout ROM vers la carte ${destination.mapId} est indisponible.`)
  }
  clearMovementInput()
  loadMap(result.state.map, 'transition')
  const destinationInitScript = activeFieldScript
  activeFieldScript = undefined
  const followupScriptId = destination.followup === 'mom' ? 2012 : 2013
  pendingBlackoutFollowup = () => {
    const runners = [
      destinationInitScript,
      createFieldScriptRunner(result.state.map, followupScriptId, fieldScriptState, undefined, ...fieldScriptExtensionPolicies),
      interruptedScript,
    ].filter((runner): runner is FieldScriptRunner => Boolean(runner))
    activeFieldScript = runners.length === 1 ? runners[0] : createFieldScriptSequenceRunner(runners)
    advanceFieldScript()
  }
  const rawMessage = inventory.blackoutMessages[destination.followup === 'mom' ? 4 : 3]
  if (rawMessage === undefined) throw new Error('Le message de blackout de la banque ROM 203 est absent.')
  fieldDialogueRuntime.showMessages(rawMessage.replace(/\{[^}]*\}/g, playerProfile.name), { speaker: undefined })
  fieldScriptExecution.beginWait('input')
  status.textContent = destination.followup === 'mom' ? 'Blackout ROM : retour à la maison.' : 'Blackout ROM : retour au Centre Pokémon.'
}

function confirmBlackoutMessage(): void {
  if (!pendingBlackoutFollowup) return
  const message = fieldDialogueRuntime.getSnapshot()
  if (message.pageIndex < message.pages.length - 1) {
    fieldDialogueRuntime.showPage(message.pageIndex + 1)
    return
  }
  const followup = pendingBlackoutFollowup
  pendingBlackoutFollowup = undefined
  closeFieldDialogue()
  followup()
}

function showNextBattleMessage(): void {
  battlePresentationSkip.reset(); battleScreen.querySelector<HTMLElement>('.battle-stat-gains')!.hidden = true
  const next = battleMessageQueue.shift()
  if (next !== undefined) {
    setBattleUiMode('message')
    battleCommands.hidden = true
    battleMoves.hidden = true
    battleMessage.textContent = typeof next === 'string' ? next : next.text
    battleMessage.hidden = false
    restartBattleAnimation(battleMessage, 'is-changing')
    if (typeof next !== 'string') {
      next.onShow?.()
    }
    return
  }
  if (pokemonTransformationSceneHost.getSnapshot().fieldProgressionActive) {
    pokemonTransformationSceneHost.finishFieldProgression()
    return
  }
  if (activeBattle && activeBattleTutorialStep === 0) {
    const inventory = currentInventory
    const rng = fieldScriptState.pokemonRuntime?.rng
    if (!inventory || !rng) return
    activeBattleTutorialStep = 1
    queueBattleEvents(executeSimpleBattleTurn(activeBattle, 0, inventory.pokemonCatalog, rng, gameplayExtensionPorts.pokemonTeamPolicy))
    return
  }
  if (activeBattle && activeBattleTutorialStep === 1) {
    activeBattleTutorialStep = 2
    completeSimpleBattleCapture(activeBattle)
    battleMessageQueue = [{
      text: `${activeBattle.trainerName ?? 'Le Dresseur'} utilise une Poké Ball!`,
      onShow: () => { playQueuedBattleCapture(4, 4, true) },
    }, { text: `${pokemonBattleName(activeBattle.opponent.pokemon)} est attrapé!`, onShow: fadeBattleCapturedBallAfterMessage }]
    showNextBattleMessage()
    return
  }
  if (activeDoubleBattle?.phase === 'ended') finishDoubleBattle()
  else if (activeDoubleBattle?.phase === 'replacement') return
  else if (activeDoubleBattle && getRequiredDoubleBattleActors(activeDoubleBattle).length === 0) { const inventory = currentInventory; const rng = fieldScriptState.pokemonRuntime?.rng; if (inventory && rng) queueDoubleBattleEvents(executeAdmittedDoubleBattleTurn(activeDoubleBattle, [], inventory.pokemonCatalog, rng, gameplayExtensionPorts.pokemonTeamPolicy, gameplayExtensionPorts.battleActionPolicy, gameplayExtensionPorts.pokemonPartyHealingPolicy)) }
  else if (activeDoubleBattle) showDoubleBattleCommands()
  else if (activeBattle?.phase === 'ended') finishActiveBattle()
  else showBattleCommands()
}

function queueBattleEvents(events: readonly SimpleBattleEvent[], showImmediately = true): void {
  const inventory = currentInventory
  if (!inventory) return
  if (import.meta.env.DEV && activeBattle) events = realtimeBattleDebug!.protectSimpleEvents(activeBattle, events)
  if (activeBattle) observeSimpleBattleOutcomeEvents(events, { player: activeBattlePlayerParty, opponent: activeBattleOpponentParty }, gameplayExtensionPorts.detailedBattleOutcomeObserver)
  const victoryFaintIndex = findHgssBattleVictoryFaintIndex(events)
  const messageOffsetForSide = (side: 'player' | 'opponent') => side === 'player' ? 0 : activeBattle?.kind === 'wild' ? 1 : 2
  const pokemonMessage = (messageId: number, side: 'player' | 'opponent', pokemonName: string, fallback: string) => formatBattleRomMessage(
    inventory.battleMessages[messageId + messageOffsetForSide(side)] ?? fallback,
    [pokemonName],
  )
  for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
    const event = events[eventIndex]!
    if (event.kind === 'move') {
      const linkedDamage = collectBattleMoveDamageEvents(events, event)[0]
      battleMessageQueue.push({
        text: `${event.pokemonName} utilise ${event.moveName}!`,
        onShow: () => {
          if (!gameOptions.battleAnimations) {
            if (linkedDamage) animateBattleHp(linkedDamage.side, -linkedDamage.damage)
            return
          }
          const script = inventory.battleAnimationCatalog.moveScripts[event.moveId]
          const animationAudio = audioRuntime
          const battleSession = activeBattle
          const generation = battlePresentationGeneration
          battleMessageInputLocked = true
          beginBattleAction(event.moveType)
          const lease = createBattlePresentationLease(battlePresentationSkip)
          const playback = script ? playConfirmedHgssBattleAnimation(script, event.side, {
            player: battlePlayerSprite,
            opponent: battleOpponentSprite,
            effects: shell.battleEffects,
          }, animationAudio && battleSession ? {
            playSoundEffect: animationAudio.playSoundEffect,
            playPannedSoundEffect: animationAudio.playPannedSoundEffect,
            playMovingSoundEffect: animationAudio.playMovingSoundEffect,
            stopSoundEffect: animationAudio.stopSoundEffect,
            playPokemonCry: (side, modulation, pan, volume) => animationAudio.playCry(
              side === event.side ? event.actorSpeciesId : event.targetSpeciesId,
              modulation,
              pan,
              volume,
            ),
            isPokemonCryPlaying: animationAudio.isCryPlaying,
          } : undefined, inventory.battleAnimationCatalog.particleResourceResolver, {
            weather: event.weather, signal: lease.signal, onDiagnostic: recordBattleAnimationDiagnostic,
          }, createActiveBattleSpriteEffectPlayback()) : Promise.resolve()
          void playback
            .catch(() => undefined)
            .then(() => {
              if (activeBattle !== battleSession || generation !== battlePresentationGeneration) return undefined
              if (linkedDamage) {
                playBattleImpact({ root: battleScreen, sprite: linkedDamage.side === 'player' ? battlePlayerSprite : battleOpponentSprite, damage: linkedDamage.damage, maximumHp: (linkedDamage.side === 'player' ? battlePlayerHp : battleOpponentHp).max })
                return animateBattleHp(linkedDamage.side, -linkedDamage.damage)
              }
              return undefined
            })
            .finally(() => {
              lease.close()
              if (activeBattle === battleSession && generation === battlePresentationGeneration) finishBattleAction()
            })
        },
      })
    }
    else if (event.kind === 'miss') battleMessageQueue.push(inventory.battleMessages[event.side === 'opponent' ? 14 : 12]?.replace(/\{[^}]*\}/g, event.pokemonName) ?? `${event.pokemonName} rate son attaque!`)
    else if (event.kind === 'damage') {
      if (event.movePresentationId === undefined) battleMessageQueue.push({ text: 'Le Pokémon subit des dégâts!', onShow: () => { playBattleImpact({ root: battleScreen, sprite: event.side === 'player' ? battlePlayerSprite : battleOpponentSprite, damage: event.damage, maximumHp: (event.side === 'player' ? battlePlayerHp : battleOpponentHp).max }); animateBattleHp(event.side, -event.damage) } })
      if (event.critical) battleMessageQueue.push(inventory.battleMessages[774] ?? 'Coup critique!')
      if (event.typeMultiplier === 0) battleMessageQueue.push("Ça n'affecte pas la cible...")
      else if (event.typeMultiplier < 10) battleMessageQueue.push(inventory.battleMessages[779] ?? "Ce n'est pas très efficace...")
      else if (event.typeMultiplier > 10) battleMessageQueue.push(inventory.battleMessages[780] ?? "C'est super efficace!")
    } else if (event.kind === 'stat') {
      const statLabels = { attack: 'Attaque', defense: 'Défense', speed: 'Vitesse', specialAttack: 'Attaque Spéciale', specialDefense: 'Défense Spéciale', accuracy: 'Précision', evasion: 'Esquive' }
      const direction = event.change > 0 ? 'monte' : 'baisse'
      battleMessageQueue.push({
        text: event.applied ? `${statLabels[event.stat]} de ${event.pokemonName} ${direction}!` : `${statLabels[event.stat]} de ${event.pokemonName} ne peut plus changer!`,
        onShow: () => {
          const hud = battleScreen.querySelector<HTMLElement>(`.battle-hud-${event.side}:not(.battle-hud-secondary)`)
          if (hud && event.applied) applyBattleStagePresentation(hud, event.stat, event.change)
          const animation = resolveHgssBattleEventPresentationAnimation(event)
          if (animation) playBattleConditionEffect(event.side, animation)
        },
      })
    } else if (event.kind === 'status') {
      const messageIds = { sleep: 47, poison: 63, badPoison: 79, burn: 85, freeze: 101, paralysis: 120 }
      battleMessageQueue.push({
        text: event.applied
          ? pokemonMessage(messageIds[event.status], event.side, event.pokemonName, `${event.pokemonName} subit un statut!`)
          : pokemonMessage(60, event.side, event.pokemonName, `Cela n’a aucun effet sur ${event.pokemonName}.`),
        onShow: () => {
          const hud = battleScreen.querySelector<HTMLElement>(`.battle-hud-${event.side}:not(.battle-hud-secondary)`)
          if (hud && event.applied) syncBattleHudPrimaryStatus(hud, event.status)
          const animation = resolveHgssBattleEventPresentationAnimation(event)
          if (animation) playBattleConditionEffect(event.side, animation)
        },
      })
    } else if (event.kind === 'cannotAct') {
      const messageIds = { sleep: 299, freeze: 111, paralysis: 130, truant: 832 }
      battleMessageQueue.push({
        text: pokemonMessage(messageIds[event.reason], event.side, event.pokemonName, `${event.pokemonName} ne peut pas attaquer!`),
        onShow: () => {
          const animation = resolveHgssBattleEventPresentationAnimation(event)
          if (animation) playBattleConditionEffect(event.side, animation)
        },
      })
    } else if (event.kind === 'residual') {
      battleMessageQueue.push({
        text: pokemonMessage(event.status === 'burn' ? 95 : 73, event.side, event.pokemonName, `${event.pokemonName} souffre de son statut!`),
        onShow: () => {
          playBattleImpact({ root: battleScreen, sprite: event.side === 'player' ? battlePlayerSprite : battleOpponentSprite, damage: event.damage, maximumHp: (event.side === 'player' ? battlePlayerHp : battleOpponentHp).max })
          const animation = resolveHgssBattleEventPresentationAnimation(event)
          if (animation) playBattleConditionEffect(event.side, animation)
          animateBattleHp(event.side, -event.damage)
        },
      })
    } else if (event.kind === 'abilityHeal') {
      battleMessageQueue.push({
        text: `${event.pokemonName} récupère des PV grâce à son talent!`,
        onShow: () => animateBattleHp(event.side, event.amount),
      })
    } else if (event.kind === 'heal') {
      battleMessageQueue.push({
        text: event.amount > 0 ? `${event.pokemonName} récupère ${event.amount} PV!` : `${event.pokemonName} a déjà tous ses PV!`,
        onShow: () => {
          const animation = resolveHgssBattleEventPresentationAnimation(event)
          if (animation) playBattleConditionEffect(event.side, animation)
          animateBattleHp(event.side, event.amount)
        },
      })
    } else if (event.kind === 'recoil') {
      battleMessageQueue.push({
        text: `${event.pokemonName} est blessé par le contrecoup!`,
        onShow: () => {
          playBattleImpact({ root: battleScreen, sprite: event.side === 'player' ? battlePlayerSprite : battleOpponentSprite, damage: event.damage, maximumHp: (event.side === 'player' ? battlePlayerHp : battleOpponentHp).max })
          animateBattleHp(event.side, -event.damage)
        },
      })
    } else if (event.kind === 'statusCured') {
      battleMessageQueue.push({
        text: event.applied ? `${event.pokemonName} n’a plus de problème de statut!` : `Cela n’a aucun effet sur ${event.pokemonName}.`,
        onShow: () => {
          const hud = battleScreen.querySelector<HTMLElement>(`.battle-hud-${event.side}:not(.battle-hud-secondary)`)
          if (hud && event.applied) syncBattleHudPrimaryStatus(hud)
        },
      })
    } else if (event.kind === 'statsReset') {
      battleMessageQueue.push({ text: 'Tous les changements de stats sont annulés!', onShow: () => {
        const neutral = { attack: 0, defense: 0, speed: 0, specialAttack: 0, specialDefense: 0, accuracy: 0, evasion: 0 }
        battleScreen.querySelectorAll<HTMLElement>('.battle-hud').forEach((hud) => syncBattleStageSummary(hud, neutral))
      } })
    } else if (event.kind === 'noEffect') {
      battleMessageQueue.push(inventory.battleMessages[777] ?? 'Mais cela échoue!')
    } else if (event.kind === 'confusion') {
      const text = event.state === 'started' ? `${event.pokemonName} devient confus!`
        : event.state === 'ended' ? `${event.pokemonName} n’est plus confus!`
          : `${event.pokemonName} est confus!`
      battleMessageQueue.push({ text, onShow: () => {
        const animation = resolveHgssBattleEventPresentationAnimation(event)
        if (animation) playBattleConditionEffect(event.side, animation)
      } })
    } else if (event.kind === 'flinch') {
      battleMessageQueue.push(`${event.pokemonName} a la trouille et ne peut pas agir!`)
    } else if (event.kind === 'selfDamage') {
      battleMessageQueue.push({
        text: `${event.pokemonName} se blesse dans sa confusion!`,
        onShow: () => { playBattleImpact({ root: battleScreen, sprite: event.side === 'player' ? battlePlayerSprite : battleOpponentSprite, damage: event.damage, maximumHp: (event.side === 'player' ? battlePlayerHp : battleOpponentHp).max }); animateBattleHp(event.side, -event.damage) },
      })
    } else if (event.kind === 'multiHit') {
      battleMessageQueue.push(`Touché ${event.hits} fois!`)
    } else if (event.kind === 'screen') {
      battleMessageQueue.push({
        text: event.screen === 'reflect' ? `Un mur de lumière physique protège l’équipe!` : `Un mur de lumière spéciale protège l’équipe!`,
      })
    } else if (event.kind === 'abilityReveal') { const abilityName = inventory.pokemonCatalog.abilityNames?.[event.abilityId] ?? `Talent ${event.abilityId}`, values = event.abilityId === 107 ? [abilityName, event.pokemonName] : event.abilityId === 108 ? [event.pokemonName, abilityName, inventory.pokemonCatalog.moveNames[event.moveId ?? 0] ?? ''] : [event.pokemonName, inventory.itemCatalog.items[event.itemId ?? 0]?.name ?? '']; battleMessageQueue.push(formatBattleRomMessage(inventory.battleMessages[event.abilityId === 107 ? 1106 : event.abilityId === 108 ? 1109 : 1118] ?? `${event.pokemonName} active ${abilityName}!`, values)) } else if (event.kind === 'formChange') { battleMessageQueue.push({ text: formatBattleRomMessage(inventory.battleMessages[721] ?? `${pokemonBattleName(event.pokemon)} se transforme!`, [pokemonBattleName(event.pokemon)]), onShow: () => {
      refreshActiveBattleSprite(event.side, event.pokemon)
      const hud = battleScreen.querySelector<HTMLElement>(`.battle-hud-${event.side}:not(.battle-hud-secondary)`)
      if (hud) renderBattleTypeBadges(hud.querySelector('.battle-types'), event.types, inventory.pokedexCatalog.typeNames)
    } }) } else if (event.kind === 'condition') {
      battleMessageQueue.push({
        text: resolveBattleConditionMessage(event.condition, event.applied, inventory.battleMessages[777]),
        onShow: () => {
          if (event.applied && event.condition === 'transform' && activeBattle) {
            const transformed = activeBattle[event.side]
            refreshActiveBattleSprite(event.side, transformed.pokemon)
            const hud = battleScreen.querySelector<HTMLElement>(`.battle-hud-${event.side}:not(.battle-hud-secondary)`)
            if (hud) renderBattleTypeBadges(hud.querySelector('.battle-types'), transformed.types, inventory.pokedexCatalog.typeNames)
          }
          const animation = isHeldItemBattleCondition(event.condition) ? 'heldItem' : resolveHgssBattleEventPresentationAnimation(event)
          if (animation) playBattleConditionEffect(event.side, animation)
        },
      })
    } else if (event.kind === 'weather') {
      const weatherMessages = {
        clear: 'Le ciel redevient calme.', rain: 'La pluie commence à tomber!', sun: 'La lumière du soleil s’intensifie!',
        sandstorm: 'Une tempête de sable se lève!', hail: 'La grêle commence à tomber!',
      }
      battleMessageQueue.push({ text: weatherMessages[event.weather], onShow: () => { battleScreen.dataset.weather = event.weather } })
    } else if (event.kind === 'weatherDamage') {
      battleMessageQueue.push({
        text: event.weather === 'hail' ? `${event.pokemonName} est frappé par la grêle!` : `${event.pokemonName} est blessé par la tempête de sable!`,
        onShow: () => { playBattleImpact({ root: battleScreen, sprite: event.side === 'player' ? battlePlayerSprite : battleOpponentSprite, damage: event.damage, maximumHp: (event.side === 'player' ? battlePlayerHp : battleOpponentHp).max }); animateBattleHp(event.side, -event.damage) },
      })
    } else if (event.kind === 'entryHazard') {
      battleMessageQueue.push({
        text: event.hazard === 'spikes'
          ? `${event.pokemonName} est blessé par les Picots!`
          : `Des pierres pointues blessent ${event.pokemonName}!`,
        onShow: () => { playBattleImpact({ root: battleScreen, sprite: event.side === 'player' ? battlePlayerSprite : battleOpponentSprite, damage: event.damage, maximumHp: (event.side === 'player' ? battlePlayerHp : battleOpponentHp).max }); animateBattleHp(event.side, -event.damage) },
      })
    } else if (event.kind === 'toxicSpikesAbsorbed') {
      battleMessageQueue.push({ text: `${event.pokemonName} absorbe les Pics Toxik!` })
    } else if (event.kind === 'trainerItem') {
      battleMessageQueue.push({
        text: formatBattleRomMessage(
          inventory.battleMessages[857] ?? '{103 0,0} utilise {108 1,0}!',
          [event.trainerName, event.itemName],
        ),
        onShow: () => playBattleConditionEffect('opponent', 'bagItem'),
      })
    } else if (event.kind === 'switchRequest' && event.side === 'player') battleMessageQueue.push({ text: 'Choisissez un Pokémon.', onShow: () => showBattleParty(true) })
    else if (event.kind === 'switched') {
      const party = event.side === 'player' ? activeBattlePlayerParty : activeBattleOpponentParty
      const slot = party.findIndex((pokemon) => pokemon.instanceId === event.pokemon.instanceId)
      if (slot >= 0) party[slot] = cloneCanonicalPokemon(event.pokemon)
      battleMessageQueue.push({
        text: formatBattleRomMessage(inventory.battleMessages[event.side === 'player' ? 979 : 972] ?? '{101 0,0} est envoyé!', [pokemonBattleName(event.pokemon), '', activeBattle?.trainerName ?? '']),
        onShow: () => {
          if (!activeBattle) return
          if (slot >= 0) {
            if (event.side === 'player') activeBattlePlayerSlot = slot
            else activeBattleOpponentSlot = slot
          }
          refreshActiveBattleSprite(event.side, event.pokemon, false)
          renderSimpleBattleSideHud(event.side, event.pokemon, event.types, event.stages)
          renderPersistentBattlePartyGauges(activeBattle.player.pokemon, activeBattle.opponent.pokemon)
          if (event.side === 'opponent') markPokemonSeen(fieldScriptState.pokedex, event.pokemon)
          playSimpleBattlePokemonSendOut(event.side, event.pokemon)
        },
      })
    }
    else if (event.kind === 'protected') {
      battleMessageQueue.push(event.applied ? `${event.pokemonName} se protège!` : `${event.pokemonName} se protège de l’attaque!`)
    } else if (event.kind === 'leechSeed') {
      if (event.damage === 0) battleMessageQueue.push({ text: `${event.pokemonName} est infecté par Vampigraine!` })
      else battleMessageQueue.push({
        text: `Vampigraine draine l’énergie de ${event.pokemonName}!`,
        onShow: () => {
          playBattleImpact({ root: battleScreen, sprite: event.side === 'player' ? battlePlayerSprite : battleOpponentSprite, damage: event.damage, maximumHp: (event.side === 'player' ? battlePlayerHp : battleOpponentHp).max })
          animateBattleHp(event.side, -event.damage)
          if (event.recovery === 'heal' && event.recoveryAmount) animateBattleHp(event.healedSide, event.recoveryAmount)
        },
      })
    } else if (event.kind === 'recharge') {
      battleMessageQueue.push(`${event.pokemonName} doit se recharger!`)
    } else if (event.kind === 'faint') battleMessageQueue.push({
      text: formatBattleRomMessage(
        inventory.battleMessages[event.side === 'opponent' ? 32 : 30] ?? '{101 0,0} est K.O.!',
        [event.pokemonName],
      ),
      onShow: () => {
        const sprite = event.side === 'player' ? battlePlayerSprite : battleOpponentSprite
        trackBattleAnimationStep(playBattlePokemonFaint({ sprite, defeated: event.defeated, current: event.defeated }))
        if (eventIndex === victoryFaintIndex && activeBattle) startHgssBattleVictoryMusic(audioRuntime, activeBattle.kind, inventory.trainerCatalog[activeBattle.trainerId ?? -1]?.trainerClass)
      },
    })
    else if (event.kind === 'cannotRunTrainer') battleMessageQueue.push(inventory.battleMessages[793] ?? "On ne s'enfuit pas d'un combat de Dresseurs!")
    else if (event.kind === 'runFailed') battleMessageQueue.push(inventory.battleMessages[794] ?? 'Fuite impossible!')
    else if (event.kind === 'escaped') battleMessageQueue.push(inventory.battleMessages[781] ?? 'Vous prenez la fuite!')
  }
  const terminalResult = events.find((event): event is Extract<SimpleBattleEvent, { kind: 'result' }> => event.kind === 'result')
  const defeatedOpponent = events.find((event): event is Extract<SimpleBattleEvent, { kind: 'faint' }> => event.kind === 'faint' && event.side === 'opponent')
  if (defeatedOpponent && activeBattle) {
    queueSingleBattleExperience(defeatedOpponent.defeated)
    const nextOpponentSlot = terminalResult ? -1 : activeBattleOpponentParty.findIndex((pokemon, slot) => slot !== activeBattleOpponentSlot && !pokemon.isEgg && pokemon.currentHp > 0)
    if (nextOpponentSlot >= 0) {
      const nextOpponent = activeBattleOpponentParty[nextOpponentSlot]!
      battleMessageQueue.push({
        text: formatBattleRomMessage(inventory.battleMessages[972] ?? '{101 2,0} est envoyé!', [pokemonBattleName(nextOpponent), '', activeBattle.trainerName ?? '']),
        onShow: () => {
          if (!activeBattle) return
          activeBattleOpponentSlot = nextOpponentSlot
          const entryEvents = switchSimpleBattlePokemon(activeBattle, 'opponent', nextOpponent, inventory.pokemonCatalog)
          activeBattleParticipantSlots = new Set([activeBattlePlayerSlot])
          markPokemonSeen(fieldScriptState.pokedex, nextOpponent)
          refreshActiveBattleSprite('opponent', nextOpponent, false)
          renderSimpleBattleSideHud(
            'opponent',
            nextOpponent,
            inventory.pokemonCatalog.personalData[nextOpponent.speciesId]?.types ?? activeBattle.opponent.types,
            { attack: 0, defense: 0, speed: 0, specialAttack: 0, specialDefense: 0, accuracy: 0, evasion: 0 },
          )
          renderPersistentBattlePartyGauges(activeBattle.player.pokemon, nextOpponent)
          playSimpleBattlePokemonSendOut('opponent', nextOpponent)
          queueBattleEvents(entryEvents, false)
        },
      })
    }
  }
  if (!terminalResult && events.some((event) => event.kind === 'faint' && event.side === 'player') && activeBattle) {
    syncActiveBattlePokemonToParties()
    const reserve = getUsableFieldBattlePartySlots(activeBattlePlayerParty, { format: 'simple', phase: 'forced-replacement' }, gameplayExtensionPorts.pokemonTeamPolicy).some((slot) => slot !== activeBattlePlayerSlot)
    if (reserve) {
      battleMessageQueue.push({ text: 'Choisissez un Pokémon.', onShow: () => showBattleParty(true) })
    }
  }
  if (terminalResult && activeBattle && (terminalResult.result === 'won' || terminalResult.result === 'lost')) {
    syncActiveBattlePokemonToParties()
    const party = terminalResult.result === 'won' ? activeBattleOpponentParty : activeBattlePlayerParty
    const activeSlot = terminalResult.result === 'won' ? activeBattleOpponentSlot : activeBattlePlayerSlot
    const reserve = terminalResult.result === 'lost' ? getUsableFieldBattlePartySlots(party, { format: 'simple', phase: 'forced-replacement' }, gameplayExtensionPorts.pokemonTeamPolicy).some((slot) => slot !== activeSlot) : party.some((pokemon, slot) => slot !== activeSlot && !pokemon.isEgg && pokemon.currentHp > 0)
    if (!reserve) {
      battleMessageQueue.push(terminalResult.result === 'won' ? 'Victoire!' : 'Vous avez perdu…')
      const moneyMessage = settleBattleMoney(terminalResult.result === 'won' ? 'won' : 'lost')
      if (moneyMessage) battleMessageQueue.push(moneyMessage)
      battleMessageQueue.push(...deferredBattleProgression.drain())
    }
  }
  if (showImmediately) showNextBattleMessage()
}

function startSimpleBattle(kind: 'trainer' | 'wild', opponents: readonly CanonicalPokemon[], trainerId?: number, introduction?: TrainerBattleIntroduction, playerParty?: readonly CanonicalPokemon[], trainerNameOverride?: string, tutorial = false): void {
  if (fieldCampaign.isFieldLocked()) return
  const inventory = currentInventory
  const pokemonRuntime = fieldScriptState.pokemonRuntime
  if (!inventory || !pokemonRuntime) throw new Error('Le runtime ROM du combat est absent.')
  assertHgssFieldPartyInvariant(fieldScriptState.party)
  if (opponents.length === 0) throw new Error("L'équipe adverse est vide.")
  resetBattlePresentationAsyncState()
  resetBattleScenePresentation(battleScreen, { mode: 'start' })
  activeBattlePlayerParty = (playerParty ?? fieldScriptState.party.members).map(cloneCanonicalPokemon)
  battlePokemonSpriteAnimator.clearDouble()
  battlePresentationHost.clearRememberedMoves()
  activeBattleOpponentParty = opponents.map(cloneCanonicalPokemon)
  activeBattlePlayerSlot = getFirstUsableFieldBattlePartySlot(activeBattlePlayerParty, { format: 'simple', phase: 'initial' }, gameplayExtensionPorts.pokemonTeamPolicy)
  activeBattleOpponentSlot = activeBattleOpponentParty.findIndex((pokemon) => !pokemon.isEgg && pokemon.currentHp > 0)
  const player = activeBattlePlayerParty[activeBattlePlayerSlot]
  const opponent = activeBattleOpponentParty[activeBattleOpponentSlot]
  if (!player) throw new Error("Invariant HGSS viole: l'emplacement du premier Pokemon utilisable est absent.")
  if (!opponent) throw new Error("L'équipe adverse ne contient aucun Pokémon utilisable.")
  const trainerName = trainerNameOverride ?? (trainerId === undefined
    ? undefined
    : inventory.trainerCatalog[trainerId]?.trainerClass === 23
      ? fieldScriptState.rivalName
      : inventory.trainerNames[trainerId])
  activeBattle = createSimpleBattleSession({
    kind,
    player,
    opponent,
    catalog: inventory.pokemonCatalog,
    trainerId,
    trainerName,
    opponentAiFlags: trainerId === undefined ? 0 : inventory.trainerCatalog[trainerId]?.aiFlags ?? 0,
    itemCatalog: inventory.itemCatalog,
    opponentItems: trainerId === undefined ? [] : inventory.trainerCatalog[trainerId]?.items ?? [], playerParty: activeBattlePlayerParty, opponentParty: activeBattleOpponentParty, sharePartyState: true, playerTeamPolicy: gameplayExtensionPorts.pokemonTeamPolicy,
    initialWeather: resolveHgssBattleWeather(fieldScriptState.weather), initialTerrainId: getCurrentHgssFieldBattleEnvironment().terrainId, rng: pokemonRuntime.rng,
  })
  activeBattleOpponentTrainerIds = trainerId === undefined ? [] : [trainerId]
  if (import.meta.env.DEV) realtimeCampaignAudit!.recordSimpleBattle()
  activeBattleMoneySettled = false
  if (kind === 'wild' && !tutorial) recordHgssWildEncounterStarted(fieldScriptState)
  const region = worldSession?.getState()?.map.header.region ?? 0
  const battleMusic = trainerId === undefined
    ? resolveHgssWildBattleMusic(opponent.speciesId, region)
    : resolveHgssTrainerBattleMusic(inventory.trainerCatalog[trainerId]?.trainerClass ?? 0, region)
  void audioRuntime?.playMusic(battleMusic).catch(() => {})
  activeBattleParticipantSlots = new Set([activeBattlePlayerSlot])
  if (!tutorial) markPokemonSeen(fieldScriptState.pokedex, opponent)
  const playerSprite = inventory.battlePokemonSpriteResolver({ speciesId: player.speciesId, form: player.form, gender: player.gender, facing: 'back', shiny: player.shiny })
  const opponentSprite = inventory.battlePokemonSpriteResolver({ speciesId: opponent.speciesId, form: opponent.form, gender: opponent.gender, facing: 'front', shiny: opponent.shiny })
  const battleBackgroundId = getCurrentHgssFieldBattleEnvironment().backgroundId
  const battleBackgroundGraphic = inventory.battleBackgroundResolver({
    backgroundId: battleBackgroundId,
    timeOfDay: resolveHgssBattlePaletteTime(currentHgssTimeOfDay()),
  })
  bindBattlePokemonSpritePresentation(battlePlayerSprite, player, { force: true, hidden: true })
  bindBattlePokemonSpritePresentation(battleOpponentSprite, opponent, { force: true, hidden: true })
  menuCanvasAssets.mountGraphicCanvas(getBattlePokemonSpriteFrame(battlePlayerSprite), playerSprite.frames[0]!)
  menuCanvasAssets.mountGraphicCanvas(getBattlePokemonSpriteFrame(battleOpponentSprite), opponentSprite.frames[0]!)
  battlePokemonSpriteAnimator.registerSimple('player', battlePlayerSprite, playerSprite, vblankCounter)
  battlePokemonSpriteAnimator.registerSimple('opponent', battleOpponentSprite, opponentSprite, vblankCounter)
  battlePlayerSprite.dataset.battlePokemonVisual = [player.speciesId, player.form, player.gender, 'player', player.shiny].join(':')
  battleOpponentSprite.dataset.battlePokemonVisual = [opponent.speciesId, opponent.form, opponent.gender, 'opponent', opponent.shiny].join(':')
  battlePlayerSprite.dataset.shiny = String(player.shiny)
  battleOpponentSprite.dataset.shiny = String(opponent.shiny)
  if (trainerId !== undefined) {
    battleOpponentTrainer.classList.remove('is-double')
    const trainer = inventory.trainerCatalog[trainerId]
    if (!trainer) throw new Error(`Le Dresseur ROM ${trainerId} est absent.`)
    menuCanvasAssets.mountGraphicCanvas(battleOpponentTrainer, inventory.trainerBattleSpriteResolver(trainer.trainerClass))
  } else battleOpponentTrainer.replaceChildren()
  battleOpponentTrainer.hidden = true
  menuCanvasAssets.mountGraphicCanvas(battleBackground, createHgssSingleScreenBattleBackdrop(battleBackgroundGraphic))
  battlePlayerSprite.style.setProperty('--battle-sprite-height', `${playerSprite.height}`)
  battleOpponentSprite.style.setProperty('--battle-sprite-height', `${opponentSprite.height}`)
  if (battleLaunchTimer !== undefined) window.clearTimeout(battleLaunchTimer)
  if (battleExitTimer !== undefined) window.clearTimeout(battleExitTimer)
  battleActionLease?.close()
  battleLaunchTimer = undefined
  battleExitTimer = undefined
  battleActionLease = undefined
  battleScreen.classList.remove('is-impact', 'is-heavy-impact')
  battleScreen.dataset.battleKind = kind
  setBattleUiMode('message')
  const neutralStages = { attack: 0, defense: 0, speed: 0, specialAttack: 0, specialDefense: 0, accuracy: 0, evasion: 0 }
  renderSimpleBattleSideHud('player', player, inventory.pokemonCatalog.personalData[player.speciesId]?.types ?? activeBattle.player.types, neutralStages)
  renderSimpleBattleSideHud('opponent', opponent, inventory.pokemonCatalog.personalData[opponent.speciesId]?.types ?? activeBattle.opponent.types, neutralStages)
  renderPersistentBattlePartyGauges(player, opponent)
  battleScreen.dataset.weather = resolveHgssBattleWeather(fieldScriptState.weather)
  if (introduction) trainerBattleIntroductionHost.start(introduction)
  else trainerBattleIntroductionHost.clear()
  const opponentHud = battleScreen.querySelector<HTMLElement>('.battle-hud-opponent')
  const playerHud = battleScreen.querySelector<HTMLElement>('.battle-hud-player')
  if (opponentHud) opponentHud.hidden = true
  if (playerHud) playerHud.hidden = true
  battleOpponentParty.hidden = true
  battlePlayerParty.hidden = true
  battleCommands.hidden = true
  battleMoves.hidden = true
  battleMessage.hidden = true
  battleMessageQueue = []
  deferredBattleProgression.clear()
  pokemonTransformationSceneHost.hideScene()
  battleMessageInputLocked = true

  battleEntryTransition.play({ kind, backgroundId: battleBackgroundId, variantSeed: trainerId ?? opponent.speciesId })

  battleLaunchTimer = window.setTimeout(() => {
    battleLaunchTimer = undefined
    if (!activeBattle) return
    setBattlePresentation('introduction')
    battleMessageInputLocked = false
    if (introduction) {
      trainerBattleIntroductionHost.advance()
      return
    }
    const encounterMessage = kind === 'wild'
      ? (inventory.battleMessages[965] ?? 'Un {101 0,0} sauvage apparaît!').replace(/\{[^}]*\}/g, pokemonBattleName(opponent))
      : `${trainerName ?? inventory.trainerClassNames[inventory.trainerCatalog[trainerId!]?.trainerClass ?? 0] ?? 'Dresseur'} veut se battre!`
    battleMessageQueue = [{
      text: encounterMessage,
      onShow: () => {
        if (kind === 'trainer') playSimpleBattlePokemonSendOut('opponent', opponent, HGSS_BATTLE_SEND_OUT_TIMING.opponentIntroductionWindowFrames)
        else {
          trackBattlePokemonReveal(revealBattlePokemon({ sprite: battleOpponentSprite, hud: battleScreen.querySelector<HTMLElement>('.battle-hud-opponent') }))
          startRomCry(audioRuntime, opponent.speciesId)
        }
      },
    }, {
      text: (inventory.battleMessages[979] ?? '{101 0,0}! Go!').replace(/\{[^}]*\}/g, pokemonBattleName(player)),
      onShow: () => playSimpleBattlePokemonSendOut('player', player, HGSS_BATTLE_SEND_OUT_TIMING.playerIntroductionWindowFrames),
    }]
    queueBattleEvents(consumeSimpleBattleInitialEvents(activeBattle), false)
    showNextBattleMessage()
  }, prefersReducedBattleMotion() ? 0 : 960)
}

function startCatchingTutorialBattle(): void {
  const inventory = currentInventory
  const runtime = fieldScriptState.pokemonRuntime
  if (!inventory || !runtime) throw new Error('Le runtime ROM du tutoriel de capture est absent.')
  const createTutorialPokemon = (speciesId: number, level: number) => createCanonicalWildPokemon({
    speciesId,
    level,
    catalog: inventory.pokemonCatalog,
    rng: runtime.rng,
    originalTrainer: runtime.trainer,
    origin: { language: runtime.language, gameVersion: runtime.gameVersion, metLocation: 0, metLevel: level, metTerrain: 0 },
  })
  const marill = createTutorialPokemon(183, 5)
  const rattata = createTutorialPokemon(19, 2)
  activeBattleRestorePlayerParty = fieldScriptState.party.members.map(cloneCanonicalPokemon)
  activeBattleSuppressProgression = true
  activeBattleHealAfterLoss = false
  activeBattleTutorialStep = 0
  startSimpleBattle('wild', [rattata], undefined, undefined, [marill], playerProfile.gender === 'male' ? 'Célesta' : 'Luth', true)
}

function selectBattlePartySlot(slot: number): void {
  const battle = activeBattle
  const inventory = currentInventory
  const rng = fieldScriptState.pokemonRuntime?.rng
  const replacement = activeBattlePlayerParty[slot]
  if (!battle || !inventory || !rng || !replacement || slot === activeBattlePlayerSlot || replacement.isEgg || replacement.currentHp <= 0) return
  const forced = battlePartySelectionForced
  if (!forced && rejectPlayerBattleAction({ kind: 'switch', format: 'simple', mode: 'voluntary', partyIndex: slot })) return
  syncActiveBattlePokemonToParties()
  if (!forced) { battlePartySelectionForced = false; activeBattleParticipantSlots.add(slot); queueBattleEvents(executeSimpleBattlePlayerSwitchTurn(battle, replacement, inventory.pokemonCatalog, rng, gameplayExtensionPorts.pokemonTeamPolicy)); return }
  const entryEvents = switchSimpleBattlePokemon(battle, 'player', replacement, inventory.pokemonCatalog, { phase: 'forced-replacement', playerTeamPolicy: gameplayExtensionPorts.pokemonTeamPolicy })
  activeBattlePlayerSlot = slot
  activeBattleParticipantSlots.add(slot)
  battlePartySelectionForced = false
  battleMessageQueue.push({
    text: formatBattleRomMessage(inventory.battleMessages[979] ?? '{101 0,0}! Go!', [pokemonBattleName(replacement)]),
    onShow: () => {
      refreshActiveBattleSprite('player', replacement, false)
      renderSimpleBattleSideHud(
        'player',
        replacement,
        inventory.pokemonCatalog.personalData[replacement.speciesId]?.types ?? battle.player.types,
        { attack: 0, defense: 0, speed: 0, specialAttack: 0, specialDefense: 0, accuracy: 0, evasion: 0 },
      )
      renderPersistentBattlePartyGauges(replacement, battle.opponent.pokemon)
      playSimpleBattlePokemonSendOut('player', replacement)
    },
  })
  queueBattleEvents(entryEvents, false)
  showNextBattleMessage()
}

function useSelectedBattleItemOn(slot: number, moveIndex?: number): void {
  const battle = activeBattle
  const inventory = currentInventory
  const rng = fieldScriptState.pokemonRuntime?.rng
  const itemId = pendingBattleItemId
  if (!battle || !inventory || !rng || itemId === undefined) return
  const item = inventory.itemCatalog.items[itemId]
  if (!item) return
  if (rejectPlayerBattleAction({ kind: 'bag', format: 'simple', itemId, role: 'party-target' })) return
  syncActiveBattlePokemonToParties()
  const result = applySimpleBattlePartyItem({
    state: battle,
    inventory: fieldScriptState.inventory,
    item,
    playerParty: activeBattlePlayerParty,
    activePartyIndex: activeBattlePlayerSlot,
    targetPartyIndex: slot,
    moveIndex,
    pokemonCatalog: inventory.pokemonCatalog,
    itemCatalog: inventory.itemCatalog,
    currentLocationId: worldSession?.getState()?.map.id,
    healingPolicy: gameplayExtensionPorts.pokemonPartyHealingPolicy,
  })
  if (result.kind === 'ignored') return
  if (result.kind === 'move-required') {
    pendingBattleItemTargetSlot = slot
    setBattleUiMode('bagMove')
    battleUiCursor = 0
    battleMessage.textContent = inventory.uiMessageBanks[6]?.[94] ?? ''
    battleMessage.hidden = false
    battleMoves.replaceChildren(...createBattlePpItemChoices(result.target, inventory.pokemonCatalog.moveNames, result.restoreOnly, inventory.uiMessageBanks[6]?.[43] ?? ''))
    renderBattleCursor(battleMoves)
    return
  }
  if (result.kind === 'rejected') {
    battleMessageQueue.push(result.reason)
    pendingBattleItemId = undefined
    pendingBattleItemTargetSlot = undefined
    showNextBattleMessage()
    return
  }
  pendingBattleItemId = undefined
  pendingBattleItemTargetSlot = undefined
  battleMessageQueue.push({
    text: formatBattleRomMessage(inventory.battleMessages[857] ?? '{103 0,0} utilise {108 1,0}!', [playerProfile.name, item.name]),
    onShow: () => {
      playBattleConditionEffect('player', 'bagItem')
      if (!result.activeTarget) return
      if (result.hpGained > 0) {
        playBattleConditionEffect('player', 'heal')
        animateBattleHp('player', result.hpGained)
      }
      if (result.statusChanged) syncBattleHudPrimaryStatus(battleScreen.querySelector<HTMLElement>('.battle-hud-player')!, result.currentStatus)
    },
  })
  queueBattleEvents(executeSimpleBattleOpponentTurn(battle, inventory.pokemonCatalog, rng, gameplayExtensionPorts.pokemonTeamPolicy))
}

function useSelectedBattleStatItem(itemId: number): boolean {
  const battle = activeBattle
  const inventory = currentInventory
  const rng = fieldScriptState.pokemonRuntime?.rng
  const item = inventory?.itemCatalog.items[itemId]
  if (!battle || !inventory || !rng || !item) return false
  if (resolveBattleBagActionRole(itemId, battle.kind) !== 'battle-stat') return false
  if (rejectPlayerBattleAction({ kind: 'bag', format: 'simple', itemId, role: 'battle-stat' })) return true
  const result = applySimpleBattleStatItem(battle, fieldScriptState.inventory, item)
  if (result.kind === 'not-stat-item') return false
  if (result.kind === 'no-effect') {
    battleMessageQueue.push(result.reason)
    showNextBattleMessage()
    return true
  }
  battleMessageQueue.push(formatBattleRomMessage(inventory.battleMessages[857] ?? '{103 0,0} utilise {108 1,0}!', [playerProfile.name, item.name]))
  queueBattleEvents(executeSimpleBattleOpponentTurn(battle, inventory.pokemonCatalog, rng, gameplayExtensionPorts.pokemonTeamPolicy))
  return true
}

function useSelectedBattleEscapeItem(itemId: number): boolean {
  const battle = activeBattle
  const inventory = currentInventory
  const item = inventory?.itemCatalog.items[itemId]
  if (!battle || !inventory || !item) return false
  if (resolveBattleBagActionRole(itemId, battle.kind) !== 'escape') return false
  if (rejectPlayerBattleAction({ kind: 'bag', format: 'simple', itemId, role: 'escape' })) return true
  const result = applySimpleBattleEscapeItem(battle, fieldScriptState.inventory, item)
  if (result.kind === 'not-escape-item') return false
  if (result.kind === 'used') battleMessageQueue.push(formatBattleRomMessage(inventory.battleMessages[857] ?? '{103 0,0} utilise {108 1,0}!', [playerProfile.name, item.name]))
  queueBattleEvents([...result.events])
  return true
}

function throwSelectedBattleBall(itemId: number): void {
  const battle = activeBattle?.kind === 'wild' ? activeBattle : undefined
  const double = activeDoubleBattle?.kind === 'wild' ? activeDoubleBattle : undefined
  const doubleActor = double && currentDoubleBattleActor()
  const inventory = currentInventory
  const rng = fieldScriptState.pokemonRuntime?.rng
  if ((!battle && (!double || !doubleActor)) || !inventory || !rng) return
  const item = inventory.itemCatalog.items[itemId]
  if (!item) return
  const format = double ? 'double' : 'simple', player = double ? getDoubleBattlePokemon(double, doubleActor!) : battle!.player.pokemon
  const target = double ? getDoubleBattlePokemon(double, { side: 'opponent', slot: 0 }) : battle!.opponent.pokemon
  const playerParty = double ? double.teams.player[0]!.party : activeBattlePlayerParty
  if (rejectPlayerBattleAction({ kind: 'bag', format, itemId, role: 'capture' })) return
  const alreadyCaught = fieldScriptState.pokedex.caughtSpeciesIds.has(target.speciesId)
  const battleBackgroundId = getCurrentHgssFieldBattleEnvironment().backgroundId
  const captureTerrain = battleBackgroundId === 1 ? 'water' : battleBackgroundId >= 9 && battleBackgroundId <= 11 ? 'cave' : 'normal'
  const attempt = attemptFieldWildCapture({ item, player, target,
    party: { members: playerParty }, storage: fieldScriptState.pokemonStorage, inventory: fieldScriptState.inventory,
    catalog: inventory.pokemonCatalog, rng, turnCount: (double ?? battle!).turn, alreadyCaught,
    isNight: isHgssNighttime(currentHgssTimeOfDay()), terrain: captureTerrain,
    targetWeightTenthsKg: inventory.pokedexCatalog.weightsTenthsKg[target.speciesId], teamPolicy: gameplayExtensionPorts.pokemonTeamPolicy })
  if (attempt.kind === 'blocked') { battleMessageQueue.push(attempt.reason); showNextBattleMessage(); return }
  const { caught, capture } = attempt
  battleMessageQueue.push({
    text: formatBattleRomMessage(inventory.battleMessages[857] ?? '{103 0,0} utilise {108 1,0}!', [playerProfile.name, item.name]),
    onShow: () => { playQueuedBattleCapture(itemId, capture.shakes, capture.caught) },
  })
  if (attempt.kind === 'caught') {
    const storagePlacement = attempt.acquisition.kind === 'storage' ? attempt.acquisition.placement : undefined
    finalizeHgssWildCaptureProgression(fieldScriptState, caught, { nativeGameLanguage: fieldScriptState.pokemonRuntime?.language ?? 3, johtoDexNumbers: inventory.pokedexCatalog.johtoDexNumbers, nicknameWasEntered: false, onUrgentTriggerScheduled: () => fieldPhoneRing.primeUrgentIncomingCall() })
    if (double) { double.phase = 'ended'; double.result = 'captured' } else completeSimpleBattleCapture(battle!)
    observeExplicitOpponentCapture(caught, double ? 0 : activeBattleOpponentSlot, gameplayExtensionPorts.detailedBattleOutcomeObserver)
    battleMessageQueue.push({ text: formatBattleRomMessage(inventory.battleMessages[867] ?? '{101 0,0} est attrapé!', [pokemonBattleName(caught)]), onShow: () => { void audioRuntime?.playMusic(hgssBattleAudioSequences.captureVictoryMusic).catch(() => undefined); fadeBattleCapturedBallAfterMessage() } })
    if (!alreadyCaught) battleMessageQueue.push(formatBattleRomMessage(inventory.battleMessages[871] ?? 'Les données de {101 0,0} sont ajoutées au Pokédex.', [pokemonBattleName(caught)]))
    if (storagePlacement) battleMessageQueue.push(formatFieldWildCaptureStorageMessage(inventory.battleMessages, pokemonBattleName(caught), storagePlacement, formatBattleRomMessage))
    showNextBattleMessage()
    return
  }
  battleMessageQueue.push(inventory.battleMessages[863 + capture.shakes] ?? `${pokemonBattleName(target)} sort de la Ball!`)
  if (double) commitDoubleBattleAction({ kind: 'pass', actor: doubleActor! }, false)
  else queueBattleEvents(executeSimpleBattleOpponentTurn(battle!, inventory.pokemonCatalog, rng, gameplayExtensionPorts.pokemonTeamPolicy), false)
  showNextBattleMessage()
}

function finishBattleMoveLearning(
  pending: PokemonMoveLearningRequest<CanonicalPokemonPartyTarget>,
  forgetIndex: number,
): void {
  const inventory = currentInventory
  const target = resolveCanonicalPokemonPartyTarget(pending.target, resolvePokemonPartySource)
  if (!inventory || !target) throw new Error(`Le Pokémon ou le catalogue ROM requis pour apprendre la capacité ${pending.moveId} est absent.`)
  const learnedName = requirePokemonMoveName(inventory.pokemonCatalog.moveNames, pending.moveId)
  const replacement = replacePokemonMoveAfterChoice(target.pokemon, pending.moveId, forgetIndex, inventory.pokemonCatalog)
  let forgottenName: string | undefined
  if (replacement.kind === 'replaced') {
    forgottenName = requirePokemonMoveName(inventory.pokemonCatalog.moveNames, replacement.forgotten.moveId)
    syncProgressedBattlePartySlot(target.partySlot)
  }
  battleMoves.classList.remove('battle-learn-move')
  battleMoves.hidden = true
  battleMessageQueue.unshift(...formatBattleMoveLearningResult(inventory.battleMessages, pokemonBattleName(target.pokemon), learnedName, forgottenName))
  showNextBattleMessage()
}

const battleDigitalInputHost = createBattleDigitalInputHost({
  state: {
    read: () => ({
      mode: battleUiMode,
      cursor: battleUiCursor,
      simpleActive: Boolean(activeBattle),
      simpleSelectionReady: Boolean(activeBattle && currentInventory && fieldScriptState.pokemonRuntime?.rng),
      doubleActive: Boolean(activeDoubleBattle),
      doubleWild: activeDoubleBattle?.kind === 'wild',
      doublePendingReplacement: Boolean(doubleBattleCommandSelection.pendingReplacement),
      fieldProgressionActive: pokemonTransformationSceneHost.getSnapshot().fieldProgressionActive,
      messageInputLocked: battleMessageInputLocked,
      presentationAnimationLocks: battlePresentationAnimationLocks,
      hpAnimationLocks: battleHpAnimationLocks,
      trainerIntroductionActive: trainerBattleIntroductionHost.getSnapshot().active,
      introductionAwaitingAcknowledgement: trainerBattleIntroductionHost.getSnapshot().awaitingAcknowledgement,
      partySelectionForced: battlePartySelectionForced,
      pendingItemId: pendingBattleItemId,
      pendingItemTargetSlot: pendingBattleItemTargetSlot,
    }),
    writeCursor: (cursor) => { battleUiCursor = cursor },
    clearPendingItemId: () => { pendingBattleItemId = undefined },
    clearPendingItems: () => {
      pendingBattleItemId = undefined
      pendingBattleItemTargetSlot = undefined
    },
  },
  elements: { commands: battleCommands, choices: battleMoves },
  navigation: {
    move: (container, direction) => { moveBattleCursor(container as HTMLElement, direction) },
    render: (container) => { renderBattleCursor(container as HTMLElement) },
  },
  evolution: { handle: pokemonTransformationSceneHost.handleInput },
  learning: {
    cancel: battleMoveLearning.cancel,
    choose: battleMoveLearning.choose,
  },
  messages: {
    advance: showNextBattleMessage,
    requestSkip: battlePresentationSkip.request,
  },
  introduction: {
    releaseLockedAcknowledgement: trainerBattleIntroductionHost.releaseLockedAcknowledgement,
    advance: trainerBattleIntroductionHost.acknowledge,
  },
  bag: {
    show: showBattleBag,
    showTargets: showBattleItemTargets,
    capture: throwSelectedBattleBall,
  },
  simple: {
    showMoves: showBattleMoves,
    showParty: showBattleParty,
    tryRun: () => {
      const battle = activeBattle
      const inventory = currentInventory
      const rng = fieldScriptState.pokemonRuntime?.rng
      if (battle && inventory && rng) {
        queueBattleEvents(tryRunFromSimpleBattle(
          battle,
          inventory.pokemonCatalog,
          rng,
          gameplayExtensionPorts.pokemonTeamPolicy,
        ))
      }
    },
    selectMove: (moveIndex) => {
      const battle = activeBattle
      const inventory = currentInventory
      const rng = fieldScriptState.pokemonRuntime?.rng
      if (!battle || !inventory || !rng) return
      battlePresentationHost.rememberMove(activeBattlePlayerSlot, moveIndex)
      queueBattleEvents(executeSimpleBattleTurn(
        battle,
        moveIndex,
        inventory.pokemonCatalog,
        rng,
        gameplayExtensionPorts.pokemonTeamPolicy,
      ))
    },
    selectParty: selectBattlePartySlot,
    resolveBagAction: (itemId) => activeBattle
      ? resolveBattleBagActionRole(itemId, activeBattle.kind)
      : undefined,
    useEscapeItem: useSelectedBattleEscapeItem,
    useStatItem: useSelectedBattleStatItem,
    useItemOnPartySlot: useSelectedBattleItemOn,
    useItemOnMove: useSelectedBattleItemOn,
    showCommands: showBattleCommands,
  },
  double: {
    showMoves: showDoubleBattleMoves,
    showParty: showDoubleBattleParty,
    showCommands: showDoubleBattleCommands,
    tryRun: () => {
      const battle = activeDoubleBattle
      const actor = currentDoubleBattleActor()
      const rng = fieldScriptState.pokemonRuntime?.rng
      if (!battle || !actor || !rng) return
      const escaped = tryRunFromDoubleWildBattle(battle, actor, rng) === 'escaped'
      battleMessageQueue = [
        escaped
          ? 'Vous prenez la fuite!'
          : currentInventory?.battleMessages[794] ?? 'Impossible de fuir!',
      ]
      if (escaped) {
        gameplayExtensionPorts.detailedBattleOutcomeObserver.observeBattleOutcome({
          kind: 'battle-finished',
          outcome: 'flee',
        })
      } else {
        commitDoubleBattleAction({ kind: 'pass', actor }, false)
      }
      showNextBattleMessage()
    },
    rejectRun: () => {
      battleMessageQueue = [
        currentInventory?.battleMessages[793]
          ?? "On ne s'enfuit pas d'un combat de Dresseurs!",
      ]
      showNextBattleMessage()
    },
    selectMove: showDoubleBattleTargets,
    selectTarget: selectDoubleBattleTarget,
    commitReplacement: commitDoubleBattleReplacement,
    switchParty: (partyIndex) => {
      const actor = currentDoubleBattleActor()
      if (actor) commitDoubleBattleAction({ kind: 'switch', actor, partyIndex })
    },
    resolveBagAction: (itemId) => {
      const battle = activeDoubleBattle
      return battle && currentDoubleBattleActor()
        ? resolveBattleBagActionRole(itemId, battle.kind === 'wild' ? 'wild' : 'trainer')
        : undefined
    },
    useEscapeItem: (itemId) => {
      const battle = activeDoubleBattle
      const inventory = currentInventory
      const item = inventory?.itemCatalog.items[itemId]
      if (!battle || !inventory || !item
        || rejectPlayerBattleAction({ kind: 'bag', format: 'double', itemId, role: 'escape' })) return
      escapeDoubleWildBattleWithItem(battle, fieldScriptState.inventory, item)
      gameplayExtensionPorts.detailedBattleOutcomeObserver.observeBattleOutcome({
        kind: 'battle-finished',
        outcome: 'flee',
      })
      battleMessageQueue = [formatBattleRomMessage(
        inventory.battleMessages[857] ?? '{103 0,0} utilise {108 1,0}!',
        [playerProfile.name, item.name],
      )]
      showNextBattleMessage()
    },
    selectStatItemTarget: (itemId) => {
      const battle = activeDoubleBattle
      const actor = currentDoubleBattleActor()
      if (!battle || !actor) return
      pendingBattleItemId = itemId
      selectDoubleBattleItemTarget(battle.teams[actor.side][actor.slot].activePartyIndex)
    },
    useItemOnPartySlot: selectDoubleBattleItemTarget,
    useItemOnMove: selectDoubleBattleItemTarget,
  },
})

function waitForOptionalFieldScriptPresentation(
  waitKind: FieldScriptWaitKind,
  task: Promise<unknown>,
  fallbackMessage: string,
  options: { dismissMessage?: boolean, afterResume?: () => void } = {},
): void {
  const script = activeFieldScript
  if (!script) return
  if (options.dismissMessage ?? true) dismissAcknowledgedFieldMessage()
  const waitToken = fieldScriptExecution.beginAsyncWait(waitKind, { bindRunner: true })
  void settleOptionalFieldScriptStep(task, {
    isCurrent: () => fieldScriptExecution.isAsyncWaitCurrent(waitToken),
    reportFailure: (error) => {
      status.textContent = error instanceof Error ? error.message : fallbackMessage
    },
    resume: () => {
      fieldScriptExecution.clearWait()
      options.afterResume?.()
      advanceFieldScript()
    },
  })
}

const fieldScriptAudioHost = createFieldScriptAudioHost({
  execution: fieldScriptExecution,
  readAudio: () => audioRuntime,
  readActiveMap: () => worldSession?.getState()?.map,
  reportStatus: (message) => { status.textContent = message },
  waitForPresentation: waitForOptionalFieldScriptPresentation,
})
const fieldScriptWorldHost = createFieldScriptWorldHost({
  execution: fieldScriptExecution,
  runtime,
  readWorldSession: () => worldSession,
  readFieldState: () => fieldScriptState,
  readInventory: () => currentInventory,
  dismissAcknowledgedMessage: dismissAcknowledgedFieldMessage,
  waitForPresentation: waitForOptionalFieldScriptPresentation,
})
const fieldScriptLifecycleHost = createFieldScriptLifecycleHost({
  execution: fieldScriptExecution,
  isMessageAcknowledged: fieldDialogueRuntime.isAcknowledged,
  setMessageAcknowledged: fieldDialogueRuntime.setAcknowledged,
  scheduleTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
  framesToMilliseconds: hgssVBlanksToMilliseconds,
  resume: advanceFieldScript,
  persistManualSave: () => persistCurrentSession('manual', true),
  reportStatus: (message) => { status.textContent = message },
  performBlackout: performNativeBlackout,
  finishScript: () => {
    releaseFieldScriptExecutionState(fieldScriptState)
    runtime.setFollowerMovementPaused(false)
    closeFieldDialogue()
    const saved = persistCurrentSession()
    titleCampaign.completeFieldScript(saved, lastSessionSaveAt, activeSaveSlot)
    renderMainMenu(mainMenu.refresh())
  },
})
const fieldScriptEffectsHost = createFieldScriptEffectsHost({
  runtime,
  context: {
    readState: () => fieldScriptState,
    readWorld: () => worldSession,
    readInventory: () => currentInventory,
    readAudio: () => audioRuntime,
  },
  presentation: {
    surfaces: [runtimeCanvas, screenCanvas],
    framesToMilliseconds: hgssVBlanksToMilliseconds,
    applyScreenFade: applyFieldScreenFade,
    waitForPresentation: waitForOptionalFieldScriptPresentation,
  },
  gym: {
    handleStep: (step, state, world, inventory) => gymMechanisms.handleStep(step, state, world, inventory),
  },
  field: {
    reportStatus: (message) => { status.textContent = message },
    refreshMainMenu: () => { renderMainMenu(mainMenu.refresh()) },
    syncFollowerPresentation,
    scheduleAutosave: sessionAutosave.schedule,
  },
})
const fieldScriptUiHost = createFieldScriptUiHost({
  elements: {
    dialogue: fieldDialogue,
    pokemonPortrait: fieldPokemonPortrait,
    nickname: fieldNickname,
    nicknameInput: fieldNicknameInput,
    number: fieldNumber,
    numberInput: fieldNumberInput,
  },
  dialogue: fieldDialogueRuntime,
  execution: fieldScriptExecution,
  unifiedPc: unifiedPcEntry,
  safari: safariUi,
  photoAlbum: photoAlbumUi,
  choice: fieldChoiceHost,
  textEntry: fieldTextEntry,
  easyChat: fieldEasyChatHost,
  alph: alphFieldUiHost,
  pcBox: pcBoxUi,
  recordApps: fieldRecordAppsHost,
  phoneChoice: phoneChoicePopup,
  readContext: () => ({
    state: fieldScriptState,
    world: worldSession,
    inventory: currentInventory,
    playerGender: playerProfile.gender,
  }),
  formatFieldMessage,
  mountGraphic: (host, graphic) => { menuCanvasAssets.mountGraphicCanvas(host, graphic) },
  startEggHatch: pokemonTransformationSceneHost.startEggHatch,
  clearMovement: clearMovementInput,
  refreshInputPrompts: inputPrompts.refresh,
  advanceScript: advanceFieldScript,
})
const fieldScriptFollowerHost = createFieldScriptFollowerHost({
  readState: () => fieldScriptState,
  readInventory: () => currentInventory,
  readWorld: () => worldSession,
  readRng: () => sessionRng?.lc,
  report: (message) => { status.textContent = message },
  startReaction: followerReactionRuntime.start,
})

const fieldScriptSessionHost = createFieldScriptSessionHost({
  execution: fieldScriptExecution,
  clearMovement: clearMovementInput,
  reportStatus: (message) => { status.textContent = message },
  warp: {
    readWorldSession: () => worldSession,
    loadTransition: (map, interruptedRunner) => {
      loadMap(map, 'transition', undefined, false, interruptedRunner)
    },
  },
  multiplayer: {
    gateway: multiplayerGateway,
    dismissAcknowledgedMessage: dismissAcknowledgedFieldMessage,
    resume: advanceFieldScript,
  },
  battle: {
    launcher: fieldBattleLauncher,
    setDialogueAcknowledged: fieldDialogueRuntime.setAcknowledged,
    setActiveRunner: (runner) => { activeBattleScript = runner },
    closeDialogue: closeFieldDialogue,
    isBotRunning: () => botRunning,
    suspendBot: suspendBotForBattle,
    resetAfterFailedLaunch: () => {
      activeBattle = undefined
      activeDoubleBattle = undefined
      activeBattleScript = undefined
      activeBattleHealAfterLoss = false
      activeBattleRestorePlayerParty = undefined
      activeBattleSuppressProgression = false
      battleScreen.hidden = true
      battleScreen.querySelector<HTMLElement>('.battle-stat-gains')!.hidden = true
    },
  },
})

const fieldScriptHost = createFieldScriptHost({
  readRunner: () => activeFieldScript,
  beforeStep: (step) => {
    refreshSafariMapVariant()
    fieldDialogue.classList.toggle('is-interactive', step.kind === 'message' || step.kind === 'phoneCall' || step.kind === 'inputWait')
    if (!mainMenu.getState().open && gameFlowState === 'bedroom') renderMainMenu(mainMenu.refresh())
    applyCurrentPlayerSkin()
    syncFollowerPresentation(false, true)
    runtime.syncEventVisibility(fieldScriptState)
  },
  handlers: [fieldScriptAudioHost, fieldScriptWorldHost, fieldScriptEffectsHost, fieldScriptUiHost, fieldScriptFollowerHost, fieldScriptLifecycleHost, fieldScriptSessionHost],
  onError: (error) => {
    const failure = error instanceof Error ? error : new Error('Le script ROM ne peut pas etre execute.')
    titleCampaign.cancelPendingGameClear()
    fieldScriptExecution.clearMovementTasks()
    status.textContent = failure.message
    releaseFieldScriptExecutionState(fieldScriptState)
    runtime.setFollowerMovementPaused(false)
    resetFieldFade(true)
    closeFieldDialogue()
    if (import.meta.env.DEV && botRunning) resetBot(`Bot E2E bloqué : ${failure.message}`, failure)
  },
})
function advanceFieldScript(): void { fieldScriptHost.advance() }

const fieldScriptWaitPoller = createFieldScriptWaitPoller({
  execution: fieldScriptExecution,
  runtime,
  isScriptActive: () => Boolean(activeFieldScript),
  readAudio: () => audioRuntime,
  resume: advanceFieldScript,
})

if (import.meta.env.DEV) botToggle.addEventListener('click', () => setBotRunning(!botRunning))
const titleSaveControls = createDelegatedButtonActivation(
  gameMenu,
  titleCampaign.focusMenuControl,
  titleCampaign.activateMenuControl,
)
gameMenuButton.addEventListener('click', () => {
  fullscreenController.focus()
  inputRouter.pointer('menu')
})
gameMenu.addEventListener('click', (event) => {
  const origin = event.target
  if (!(origin instanceof Element)) return
  if (gameFlowState === 'title' && titleMenu.getState().open) {
    titleSaveControls.click(event)
    return
  }
  if (pokedexCaptureRegistration.isOpen()) { pokedexCaptureRegistration.close(); return }
  const target = origin.closest<HTMLButtonElement>('button')
  if (!target || !gameMenu.contains(target)) return
  if (pokegearUi.handleDatasetButton(target)) return
  if (target.dataset.pokemonSummaryPage || target.dataset.pokemonSummaryParty) return
  if (utilityMenuSelection.teamSummaryOpen && target.dataset.menuId === 'root') {
    utilityMenuSelection.teamSummaryOpen = false
    renderMainMenu(mainMenu.refresh())
    void audioRuntime?.playSoundEffect(1500).catch(() => undefined)
    return
  }
  if (target.dataset.bagPopupClose === 'true') {
    getUtilityMenuHost().bag.closeActionPopup()
    void audioRuntime?.playSoundEffect(1500).catch(() => undefined)
    return
  }
  const index = Number.parseInt(target.dataset.menuIndex ?? '', 10)
  if (!Number.isInteger(index)) return
  mainMenu.focus(index)
  inputRouter.pointer('confirm')
})
gameMenu.addEventListener('focusin', (event) => {
  if (gameFlowState === 'title' && titleMenu.getState().open) {
    titleSaveControls.pointerDown(event)
    return
  }
  const state = mainMenu.getState()
  if (state.open) syncFocusedMenuControl(event.target, (index) => { if (index !== state.cursor) syncMainMenuCursor(mainMenu.focus(index)) })
})
gameMenu.addEventListener('pointerover', (event) => {
  if (gameFlowState === 'title' && document.documentElement.dataset.inputModality === 'pointer') titleSaveControls.pointerDown(event)
})
gameMenu.addEventListener('pointerdown', (event) => {
  if (gameFlowState === 'title' && titleMenu.getState().open) { titleSaveControls.pointerDown(event); return }
  pokegearUi.handlePointerDown(event)
})

gameMenu.addEventListener('pointermove', (event) => {
  pokegearUi.handlePointerMove(event)
})

for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
  gameMenu.addEventListener(type, (event) => pokegearUi.handlePointerUp(event))
}

function clearMovementInput(): void {
  movementInput.clear()
  blockedInputUntil = 0
  playerTurnReadyAt = 0
  forcedPlayerMovement = undefined
}

const fieldEncounterCoordinator = createFieldEncounterCoordinator({
  context: {
    readFieldState: () => fieldScriptState,
    readInventory: () => currentInventory,
    readWorldSession: () => worldSession,
    readEncounterSession: () => fieldEncounterSession,
    readVblankCounter: () => vblankCounter,
    readMovementMode: () => pendingEncounterMovementMode,
    isRepelProtected: () => pendingEncounterRepelProtection,
  },
  policies: {
    fieldWildEncounterRouteResolver: gameplayExtensionPorts.fieldWildEncounterRouteResolver,
    fieldWildEncounterIdentityPort: gameplayExtensionPorts.fieldWildEncounterIdentityPort,
    wildEncounterStartedObserver: gameplayExtensionPorts.wildEncounterStartedObserver,
    fieldBattleFormatResolver: gameplayExtensionPorts.fieldBattleFormatResolver,
    pokemonTeamPolicy: gameplayExtensionPorts.pokemonTeamPolicy,
  },
  battle: {
    isSimpleActive: () => activeBattle !== undefined,
    isDoubleActive: () => activeDoubleBattle !== undefined,
    startSimple: startSimpleBattle,
    startDouble: startDoubleBattle,
  },
  safari: {
    prepareEncounter: (method, repelLeadLevel) => safariBattle.prepareEncounter(method, repelLeadLevel),
    materializeEncounter: safariBattle.materializeEncounter,
    start: (encounter, vblank, pokemon) => safariBattle.start(encounter, vblank, pokemon),
  },
  script: {
    isActive: () => activeFieldScript !== undefined,
    has: hasFieldScript,
    start: startFieldScript,
    setActorDirection: runtime.setActorDirection,
  },
  state: {
    setPreparedEncounter: (prepared) => { preparedFieldWildEncounter = prepared },
    setActiveSafariPokemon: (pokemon) => { activeSafariBattlePokemon = pokemon },
    setActiveBattleRoamerId: (roamerId) => { activeBattleRoamerId = roamerId },
    setPendingWildEncounterCheck: (pending) => { pendingWildEncounterCheck = pending },
  },
  effects: {
    resolveBattleTerrainId: () => getCurrentHgssFieldBattleEnvironment().terrainId,
    resetPhoneRing: fieldPhoneRing.reset,
    clearMovementInput,
    isBotRunning: () => botRunning,
    suspendBotForBattle,
    setStatus: (text) => { status.textContent = text },
  },
})

function materializePreparedWildEncounter(prepared: PreparedFieldWildEncounter): CanonicalPokemon | undefined {
  return fieldEncounterCoordinator.materializePreparedWildEncounter(prepared)
}
function observeStartedWildEncounter(pokemon: CanonicalPokemon, method: WildEncounterStartedMethod, mapSectionIdOverride?: number): void {
  fieldEncounterCoordinator.observeStartedWildEncounter(pokemon, method, mapSectionIdOverride)
}
function startCanonicalFieldWildBattle(pokemon: CanonicalPokemon): void {
  if (fieldCampaign.isFieldLocked()) return
  fieldEncounterCoordinator.startCanonicalFieldWildBattle(pokemon)
}
function startAllPokemonQuestWildEncounter(interaction: AllPokemonQuestWorldInteraction): boolean {
  return !fieldCampaign.isFieldLocked() && fieldEncounterCoordinator.startAllPokemonQuestWildEncounter(interaction)
}
function startPreparedWildEncounter(prepared: PreparedFieldWildEncounter, materialized?: CanonicalPokemon): boolean {
  return !fieldCampaign.isFieldLocked() && fieldEncounterCoordinator.startPreparedWildEncounter(prepared, materialized)
}
function tryPrepareWildEncounter(suppressOrdinaryEncounter = false): boolean {
  return !fieldCampaign.isFieldLocked() && fieldEncounterCoordinator.tryPrepareWildEncounter(suppressOrdinaryEncounter)
}
function tryStartTrainerSightEncounter(): boolean {
  return !fieldCampaign.isFieldLocked() && fieldEncounterCoordinator.tryStartTrainerSightEncounter()
}

function tryStartMovement(movement: Movement, now = performance.now()): void {
  if (fieldCampaign.isFieldLocked()) return
  if (activeFieldScript || fieldExplorationRuntime.isTransitionActive() || preparedFieldWildEncounter || fieldDialogueRuntime.isPhoneActive()) return
  if (tryStartMapFrameScript()) return
  runtime.setPlayerDirection(movement.direction)
  const previousState = worldSession?.getState()
  const previousMapId = previousState?.map.id
  const forced = forcedPlayerMovement !== undefined
  const running = !forced
    && previousState?.locomotion === 'walking'
    && previousState.map.header.runningAllowed
    && fieldScriptState.runningShoes
    && runButtonPressed
  const result = worldSession?.tryMove(movement.x, movement.z, movement.direction, { enforceTurn: true, forced, running })
  if (!result) return
  syncFieldScriptPlayerStateFromWorld()
  fieldObjectMotion.applyMoveResult(result)
  if (result.kind === 'turned') {
    forcedPlayerMovement = undefined
    playerTurnReadyAt = now + hgssVBlanksToMilliseconds(getPlayerMovementDurationFrames('turn'))
    return
  }
  if (result.kind === 'blocked' && result.objectMovements?.length) {
    // Un bloc de glace absorbe le déplacement forcé du joueur pendant que le
    // bloc poursuit seul sa glissade. Ce n'est ni une erreur ni un dialogue.
    forcedPlayerMovement = undefined
    blockedInputUntil = 0
    sessionAutosave.schedule()
    return
  }
  if (result.kind === 'blocked' && (result.reason === 'bounds' || result.reason === 'terrain')) {
    forcedPlayerMovement = undefined; if (gymMechanisms.handleBlockedMovement(result, fieldScriptState, worldSession, currentInventory)) return
    if (now < blockedInputUntil) return
    status.textContent = result.reason === 'bounds' || result.attribute === undefined
      ? `Limite ROM : case ${result.tileX}, ${result.tileZ} hors zone`
      : `Collision ROM ${result.attribute.toString(16).padStart(4, '0')} : case ${result.tileX}, ${result.tileZ}`
    blockedInputUntil = now + 140
    return
  }
  if (result.kind === 'blocked' && result.reason === 'npc') {
    forcedPlayerMovement = undefined
    if (now < blockedInputUntil) return
    status.textContent = `PNJ ${result.event?.id ?? '?'} bloque la case. Appuyez sur Espace ou Entree a cote pour lire son script.`
    blockedInputUntil = now + 140
    return
  }
  if (result.kind === 'blocked' && result.reason === 'follower') {
    forcedPlayerMovement = undefined
    placePlayer(false)
    return
  }
  blockedInputUntil = 0; gymMechanisms.handleMovedMovement(result, fieldScriptState, worldSession, currentInventory)
  const processesFieldStep = isHgssProcessableFieldStep(result)
  if (result.kind === 'moved' && result.warp && result.warpActivation
    && (result.warpActivation.trigger === 'facing-door' || result.warpActivation.trigger === 'current-held')) {
    if (result.door) {
      void fieldExplorationRuntime.runDoorTransition(result.door, result.warp, result.warpActivation).catch((error: unknown) => {
        placePlayer()
        status.textContent = error instanceof Error ? `Transition de porte interrompue : ${error.message}` : 'Transition de porte ROM interrompue.'
      })
      return
    }
    void fieldExplorationRuntime.runWarpTransition({ header: result.warp.header, anchor: result.warp.anchor, activation: result.warpActivation })
    return
  }
  const mapChanged = result.kind === 'moved' && result.state.map.id !== previousMapId
  const movedResult = result.kind === 'moved' ? result : undefined
  const locomotionChanged = result.kind === 'moved' && result.state.locomotion !== previousState?.locomotion
  if (locomotionChanged) applyCurrentPlayerSkin()
  if (mapChanged) loadMap(result.state.map, 'transition')
  else if (result.kind === 'moved') {
    const duration = getPlayerMovementDurationFrames(result.movement)
    runtimePosition.textContent = runtime.setPlayerPosition(result.state.tileX, result.state.tileZ, result.state.direction, true, result.state.groundHeight, duration, result.movement)
    syncFollowerPresentation(true, false, duration)
  }
  forcedPlayerMovement = result.kind === 'moved' && result.continuationDirection
    ? {
        x: fieldMovementDelta[result.continuationDirection][0],
        z: fieldMovementDelta[result.continuationDirection][1],
        direction: result.continuationDirection,
      }
    : undefined
  pendingCoordinateScriptId = result.kind === 'moved' ? result.coordinate?.scriptId : undefined
  pendingWarpTarget = movedResult?.warp && movedResult.warpActivation?.trigger === 'completed-step'
    ? { header: movedResult.warp.header, anchor: movedResult.warp.anchor, activation: movedResult.warpActivation }
    : undefined
  pendingHeldWarpTarget = movedResult?.warp && movedResult.warpActivation?.trigger === 'completed-step-held'
    ? { header: movedResult.warp.header, anchor: movedResult.warp.anchor, activation: movedResult.warpActivation }
    : undefined
  pendingFieldStep = processesFieldStep ? movedResult : undefined
  pendingEncounterRepelProtection = false
  pendingWildEncounterCheck = false
}

function discardPendingFieldStep(): void {
  pendingCoordinateScriptId = undefined
  pendingWarpTarget = undefined
  pendingHeldWarpTarget = undefined
  pendingFieldStep = undefined
  pendingFieldPhoneStep = undefined
  pendingWildEncounterCheck = false
}

function completePendingFieldStep(): boolean {
  const result = pendingFieldStep
  if (!result) return false
  pendingFieldStep = undefined
  const completion = completeHgssFieldStep({
    state: fieldScriptState,
    inventory: currentInventory,
    rtcPenaltyState,
    currentIgtMinutes: inGameTimeClock.totalMinutes(),
    mapSectionId: result.state.map.header.mapSection,
    onUrgentTriggerScheduled: () => fieldPhoneRing.primeUrgentIncomingCall(),
  })
  if (completion.poison.effect !== 'none') void playHgssFieldPoisonPresentation([runtimeCanvas, screenCanvas], (id) => { startRomSoundEffect(audioRuntime, id) })
  rtcPenaltyState = completion.rtcPenaltyState
  const interruptScriptId = resolveHgssFieldStepInterruptScript(completion)
  if (interruptScriptId !== undefined) {
    fieldPhoneRing.reset(); forcedPlayerMovement = undefined; discardPendingFieldStep(); mainMenu.close()
    activeFieldScript = createFieldScriptRunner(result.state.map, interruptScriptId, fieldScriptState, undefined, ...fieldScriptExtensionPolicies)
    renderMainMenu(mainMenu.refresh()); advanceFieldScript()
    return true
  }
  newGamePlusWorldHost.advanceMovement()
  const repel = completion.repel
  pendingEncounterRepelProtection = repel?.protected ?? false
  pendingEncounterMovementMode = result.movement === 'run' ? 'running' : result.state.locomotion
  pendingWildEncounterCheck = !repel?.blocksEncounter
  pendingFieldPhoneStep = result
  return false
}

function tryStartPendingFieldPhoneCall(): boolean {
  const result = pendingFieldPhoneStep
  pendingFieldPhoneStep = undefined
  const runtime = fieldScriptState.pokemonRuntime
  if (!result || !runtime || !currentInventory || !result.state.map.header.incomingCalls) return false
  const incoming = selectHgssPersistentIncomingCall({ pendingTriggerIds: fieldScriptState.phoneCallTriggers, phoneBookEntries: currentInventory.phoneBookEntries, currentMapId: result.state.map.id, rng: runtime.rng, canSelectIncoming: fieldPhoneRing.canSelectIncoming, registeredContactIds: fieldScriptState.phoneContacts })
  if (!incoming) return false
  const safariIncoming = resolveHgssSafariIncomingCall(incoming)
  const payload: FieldIncomingPhoneCall = { incoming, safari: safariIncoming ? prepareHgssSafariIncomingCallPresentation({ state: fieldScriptState, inventory: currentInventory, playerGender: playerProfile.gender }, safariIncoming) : undefined }
  const launch = resolveHgssPersistentIncomingCallLaunch(incoming)
  if (launch.kind === 'forcePickUp') { fieldPhoneRing.consumeForcedIncomingCall(); return answerFieldIncomingPhoneCall(payload) }
  fieldScriptState.pendingPhoneCall = incoming.call
  fieldPhoneRing.start(payload, launch, vblankCounter, performance.now())
  return false
}

function processMovementInput(): void {
  if (gameFlowState !== 'bedroom' || browserMultiplayerHost.isOpen()) return
  if (hasUnfinishedP2pTrade()) {
    status.textContent = "Un échange interrompu doit être repris depuis « En ligne » avant de continuer."
    return
  }
  if (activeFieldScript || fieldExplorationRuntime.isTransitionActive() || sweetScentRuntime.isActive() || fieldDialogueRuntime.isPhoneActive()) return
  if (fishingHost.isActive()) return
  if (preparedFieldWildEncounter) return
  if (fieldObjectMotion.isInputBlocked()) return
  if (runtime.isPlayerMoving()) return
  if (fieldCampaign.isFieldLocked()) {
    if (performance.now() < playerTurnReadyAt) return
    const movement = movementInput.getActive(), world = worldSession?.getState()
    if (movement && world) fieldCampaign.consumeMovement({ deltaX: movement.x, deltaZ: movement.z, direction: movement.direction, running: world.map.header.runningAllowed && fieldScriptState.runningShoes && runButtonPressed })
    return
  }
  // Les tâches HGSS ON_FRAME sont réévaluées à chaque cycle terrain.
  if (tryStartMapFrameScript()) { discardPendingFieldStep(); return }
  if (tryStartTrainerSightEncounter()) { discardPendingFieldStep(); return }
  if (pendingCoordinateScriptId !== undefined) {
    const scriptId = pendingCoordinateScriptId
    const map = worldSession?.getState()?.map
    discardPendingFieldStep()
    if (map) startFieldScript(map, scriptId)
    return
  }
  if (pendingWarpTarget !== undefined) {
    const target = pendingWarpTarget
    discardPendingFieldStep()
    void fieldExplorationRuntime.runWarpTransition(target)
    return
  }
  if (completePendingFieldStep()) return
  if (pendingWildEncounterCheck) {
    pendingWildEncounterCheck = false
    if (tryPrepareWildEncounter(newGamePlusWorldHost.replacesStepEncounters())) { pendingHeldWarpTarget = undefined; pendingFieldPhoneStep = undefined; return }
    sessionAutosave.schedule()
  }
  if (pendingHeldWarpTarget !== undefined) {
    const target = pendingHeldWarpTarget
    pendingHeldWarpTarget = undefined
    if (target.activation.heldDirection && movementInput.isDirectionHeld(target.activation.heldDirection)) {
      pendingFieldPhoneStep = undefined
      void fieldExplorationRuntime.runWarpTransition(target)
      return
    }
  }
  if (tryStartPendingFieldPhoneCall()) return
  if (performance.now() < playerTurnReadyAt) return
  if (forcedPlayerMovement) {
    tryStartMovement(forcedPlayerMovement)
    return
  }
  const movement = movementInput.getActive()
  if (movement) tryStartMovement(movement)
}

function emergencyUnstickAndBlackout(): void {
  const inventory = currentInventory
  const worldState = worldSession?.getState()
  if (!inventory || !worldSession || !worldState) {
    status.textContent = 'Déblocage d’urgence indisponible tant que la carte ROM active n’est pas chargée.'
    return
  }
  if (activeBattle || activeDoubleBattle) {
    status.textContent = 'Le déblocage d’urgence n’est disponible qu’en exploration.'
    return
  }
  const currentSpawn = inventory.blackoutSpawnForMapResolver(worldState.map.id)
  if (currentSpawn !== undefined) fieldScriptState.blackoutSpawn = currentSpawn
  if (fieldScriptState.blackoutSpawn < 1) {
    status.textContent = 'Aucun point de blackout ROM n’est défini pour cette zone.'
    return
  }
  pendingBlackoutFollowup = undefined
  fieldScriptExecution.clearMovementTasks()
  discardPendingFieldStep()
  preparedFieldWildEncounter = undefined
  fishingHost.cancel()
  fieldExplorationRuntime.cancelTransition()
  renderMainMenu(mainMenu.close())
  clearMovementInput()
  closeFieldDialogue()
  runtime.setFollowerMovementPaused(false)
  performNativeBlackout()
}

const utilityMenuInputHost = createUtilityMenuInputHost({
  menu: mainMenu,
  menuElement: gameMenu,
  readViewportWidth: () => window.innerWidth,
  readPartySize: () => fieldScriptState.party.members.length,
  selection: {
    read: () => ({
      teamSummaryOpen: utilityMenuSelection.teamSummaryOpen,
      teamSummaryPage: utilityMenuSelection.teamSummaryPage,
      teamSlot: utilityMenuSelection.teamSlot,
      pokedexSpeciesId: utilityMenuSelection.pokedexSpeciesId,
      bagActionPopupOpen: utilityMenuSelection.bagActionPopupOpen,
      bagPocket: utilityMenuSelection.bagPocket,
      bagItemId: utilityMenuSelection.bagItemId,
    }),
    update: (update) => {
      if ('teamSummaryOpen' in update) utilityMenuSelection.teamSummaryOpen = update.teamSummaryOpen ?? false
      if ('teamSummaryPage' in update && update.teamSummaryPage) utilityMenuSelection.teamSummaryPage = update.teamSummaryPage
      if ('teamSlot' in update && update.teamSlot !== undefined) utilityMenuSelection.teamSlot = update.teamSlot
      if ('pokedexSpeciesId' in update) utilityMenuSelection.pokedexSpeciesId = update.pokedexSpeciesId
      if ('bagActionPopupOpen' in update) utilityMenuSelection.bagActionPopupOpen = update.bagActionPopupOpen ?? false
      if ('bagPocket' in update) utilityMenuSelection.bagPocket = update.bagPocket
      if ('bagItemId' in update) utilityMenuSelection.bagItemId = update.bagItemId
    },
  },
  presentation: {
    render: renderMainMenu,
    syncCursor: syncMainMenuCursor,
    syncPokedex: syncSelectedPokedexMenu,
    syncTeam: syncSelectedTeamMenu,
    syncTeamSummaryPage: syncSelectedTeamSummaryPage,
    syncTeamSummaryPokemon: syncSelectedTeamSummaryPokemon,
  },
  pokedex: { cycleForm: getUtilityMenuHost().cyclePokedexForm },
  bag: {
    closeActionPopup: getUtilityMenuHost().bag.closeActionPopup,
    clearPendingMachineTeaching: getUtilityMenuHost().bag.clearPendingMachineTeaching,
    syncPocket: syncUtilityBagPocket,
    syncItemDetail: syncUtilityBagItemDetail,
  },
  pokegear: { handle: pokegearUi.handleDigitalEvent },
  applyResult: applyMainMenuResult,
  playSoundEffect: (sequenceId) => { void audioRuntime?.playSoundEffect(sequenceId).catch(() => undefined) },
})

const gameDigitalInputCoordinator = createGameDigitalInputCoordinator({
  state: {
    read: () => {
      const transformation = pokemonTransformationSceneHost.getSnapshot()
      return {
        unfinishedTrade: hasUnfinishedP2pTrade(),
        flyActive: pokegearFlyRuntime.isActive(),
        titleUiOpen: titleCampaign.isUiOpen(),
        captureRegistrationOpen: pokedexCaptureRegistration.isOpen(),
        botRunning,
        eggHatchPhase: transformation.eggHatchPhase,
        battleEvolutionActive: transformation.evolutionPhase !== undefined,
        confirmationOpen: !modalConfirm.hidden,
        phoneChoiceOpen: phoneChoicePopup.isOpen(),
        fieldNicknameVisible: !fieldNickname.hidden,
        battleActive: activeBattle !== undefined || activeDoubleBattle !== undefined,
        fieldProgressionActive: transformation.fieldProgressionActive,
        safariBattleActive: safariBattle.isActive(),
        pcBoxOpen: pcBoxUi.isOpen(),
        safariUiOpen: safariUi.isOpen(),
        photoAlbumOpen: photoAlbumUi.isOpen(),
        fishingActive: fishingHost.isActive(),
        blackoutFollowupPending: pendingBlackoutFollowup !== undefined,
        fieldScriptActive: activeFieldScript !== undefined,
        fieldNumberVisible: !fieldNumber.hidden,
        fieldDialogueVisible: !fieldDialogue.hidden,
        fieldScriptInputWait: fieldScriptExecution.getWait() === 'input',
        phoneActive: fieldDialogueRuntime.isPhoneActive(),
        sweetScentActive: sweetScentRuntime.isActive(),
        preparedWildEncounter: preparedFieldWildEncounter !== undefined,
        flow: gameFlowState,
        mainMenuOpen: mainMenu.getState().open,
        playerMoving: runtime.isPlayerMoving(),
      }
    },
  },
  physical: {
    observe: (event) => observePhysicalMovementInput(event, movementInput, (pressed) => { runButtonPressed = pressed }),
    remember: movementInput.remember,
    processMovement: processMovementInput,
    releaseRun: () => { runButtonPressed = false },
  },
  gamepad: {
    useDevice: inputPrompts.useGamepad,
    readFallbackDeviceId: () => (navigator.getGamepads?.() ?? []).find((gamepad) => gamepad)?.id ?? '',
  },
  preemptiveConsumers: [
    gameTextEntry.handle,
    titleAccountGate.handleDigitalEvent,
    browserMultiplayerHost.handleDigitalEvent,
    bugReportHost.handleDigitalEvent,
  ],
  trade: {
    reportBlocked: () => { status.textContent = "Reprenez l'échange interrompu depuis « En ligne »." },
  },
  diagnostics: {
    record: (event) => appendDiagnosticEntry(recentDiagnosticInputs, {
      at: new Date().toISOString(),
      kind: `${event.source}:${event.pressed ? 'pressed' : 'released'}`,
      detail: { action: event.action, inputId: event.inputId },
    }, 100),
    isRealtimeTestRunning: () => realtimeTestPanelController?.isRunning() ?? false,
    stopRealtimeTest: () => { realtimeTestPanelController?.stop('Script arrêté : entrée manuelle détectée.') },
  },
  title: { handle: titleCampaign.handleUi },
  captureRegistration: { handle: pokedexCaptureRegistration.handle },
  bot: { stop: () => resetBot('Bot arrêté : entrée manuelle détectée.') },
  transformation: {
    handleEggHatch: pokemonTransformationSceneHost.handleInput,
    handleEvolution: pokemonTransformationSceneHost.handleInput,
  },
  confirmation: {
    handlePhoneChoice: phoneChoicePopup.handle,
    handleYesNo: yesNoConfirmation.handle,
  },
  battle: {
    handleSafari: safariBattle.handle,
    handleRegular: battleDigitalInputHost.handle,
  },
  applications: {
    handlePcBox: pcBoxUi.handle,
    handleSafari: safariUi.handle,
    handlePhotoAlbum: photoAlbumUi.handle,
  },
  fishing: {
    completeMessageText: completeFieldMessageText,
    handle: (action) => { fishingHost.handle(action) },
  },
  blackout: { confirm: confirmBlackoutMessage },
  fieldConsumers: [
    alphFieldUiHost.handleDigital,
    fieldRecordAppsHost.handleDigital,
    fieldEasyChatHost.handleDigital,
  ],
  nickname: {
    handleStorageMessage: (action) => { safariCaptureNickname.handleStorageMessage(action) },
  },
  script: {
    handleChoice: fieldChoiceHost.handleDigital,
    confirmMessage: confirmFieldMessage,
    skipAcknowledgedMessage: skipAcknowledgedFieldMessageWait,
    resolvePhoneInput: resolveHgssFieldPhoneCallInput,
    resumeInputWait: resumeFieldScriptInputWait,
  },
  menu: {
    handleUtilityInput: utilityMenuInputHost.handle,
    toggleFromAction: (action) => { applyMainMenuResult(mainMenu.handle(action)) },
    close: () => { setMenuOpen(false) },
  },
  intro: { handle: handleIntroDigitalAction },
  world: { interact },
})

const inputRouter = createGameInputRouter(gameDigitalInputCoordinator.handle)
const realtimeTerminalCommandReady = import.meta.env.DEV ? (): boolean => Boolean((activeBattle || activeDoubleBattle) && battleUiMode === 'command' && battleMessageQueue.length === 0 && !battleMessageInputLocked && battleExitTimer === undefined && !(activeDoubleBattle && (doubleBattleCommandSelection.actions.length > 0 || doubleBattleCommandSelection.actorCursor > 0 || doubleBattleCommandSelection.pendingMoveIndex !== undefined || doubleBattleCommandSelection.pendingReplacement))) : (): boolean => false
const executeRealtimeDebugCommand = import.meta.env.DEV ? (command: RealtimeTestDebugCommand): string => {
  if (!realtimeTestMode) throw new Error('Les commandes de combat exigent ?test=1 afin de protéger les sauvegardes normales.')
  if (safariBattle.isActive()) throw new Error('Commande de PV non applicable en Safari : aucun Pokémon joueur n’y possède de jauge de PV.')
  if (command.kind !== 'godmode' && !realtimeTerminalCommandReady()) throw new Error('Attendez la phase de commande vide du combat avant cette commande de test.')
  const effect = realtimeBattleDebug!.execute(command, { simple: activeBattle, double: activeDoubleBattle })
  if (effect.kind === 'simple-events') { activeBattleTutorialStep = resolveRealtimeTutorialStepAfterDebugEffect(activeBattleTutorialStep, effect); queueBattleEvents(effect.events) } else if (effect.kind === 'double-events') queueDoubleBattleEvents(effect.events)
  return effect.message
  } : (_command: RealtimeTestDebugCommand): string => { void _command; return '' }
const realtimeJourneyBridge = import.meta.env.DEV ? createRealtimeJourneyBridge({
  startOpening: startRealtimeOpeningBot, startTerrain: (seed, preset, journey) => { prepareRealtimeBotJourney(journey, seed, preset) }, pauseTerrain: pauseRealtimeJourneyTerrain, resumeTerrain: resumeRealtimeJourneyTerrain,
  stopTerrain: () => resetBot('Bot de campagne arrêté.'), advanceBattle: () => { const action = resolveRealtimeBattleAdvanceAction(battleUiMode); if (!action) return; inputRouter.dispatch(action, true, 'automation', 'journey:battle'); inputRouter.dispatch(action, false, 'automation', 'journey:battle') }, executeDebugCommand: executeRealtimeDebugCommand,
  requestPersistence: (confirm) => { confirm({ saveReady: persistCurrentSession('manual', true) }) },
  readJourneySnapshot: () => ({ battle: safariBattle.isActive() ? 'safari' : activeDoubleBattle ? 'double' : activeBattle ? 'simple' : 'none', debugReady: realtimeTerminalCommandReady(), script: Boolean(activeFieldScript), ...collectRealtimeJourneyEvidence(fieldScriptState, realtimeWonTrainerBattleIds, worldSession?.getState()?.map.id), checkpoint: botJourneyAgent?.getCheckpoint(), error: botJourneyError }),
}) : undefined
const realtimeTestPanelController = import.meta.env.DEV ? createRealtimeTestPanel(realtimeTestPanelRoot!, {
  dispatch: (action, pressed, inputId) => inputRouter.dispatch(action, pressed, 'automation', inputId),
  readSnapshot: () => { const world = worldSession?.getState(), menu = mainMenu.getState(), safari = safariBattle.isActive(), journey = realtimeJourneyBridge!.getSnapshot(), scriptExecution = fieldScriptExecution.snapshot(); return { loaded: Boolean(currentInventory), flow: gameFlowState, combat: Boolean(activeBattle || activeDoubleBattle || safari), battle: safari ? 'safari' : activeDoubleBattle ? 'double' : activeBattle ? 'simple' : 'none', battlePhase: activeDoubleBattle?.phase ?? activeBattle?.phase ?? (safari ? battleScreen.dataset.presentation : 'none'), battleUi: safari ? battleScreen.dataset.presentation : activeBattle || activeDoubleBattle ? battleUiMode : 'none', debugReady: realtimeTerminalCommandReady(), map: world?.map.id, x: world?.tileX, z: world?.tileZ, dialog: !fieldDialogue.hidden, phoneChoiceOpen: phoneChoicePopup.isOpen(), script: Boolean(activeFieldScript), scriptWait: scriptExecution.wait ?? 'none', scriptMovementTasks: scriptExecution.pendingMovementTaskCount, scriptMoving: runtime.isScriptMoving(), followerMoving: runtime.isFollowerMoving(), menu: menu.open, menuScreen: menu.open ? menu.screen : 'closed', bot: botRunning ? 'running' : 'stopped', botStatus: botStatus.textContent ?? '', botError: botJourneyError?.message, godmode: realtimeBattleDebug!.isGodModeEnabled({ simple: activeBattle, double: activeDoubleBattle }), ...collectRealtimeJourneyEvidence(fieldScriptState, realtimeWonTrainerBattleIds, world?.map.id), runtimeStatus: status.textContent ?? '', ...realtimeCampaignAudit!.getSnapshot(titleCampaign.getActiveProfile()), ...journey } },
  executeDebugCommand: executeRealtimeDebugCommand, startBotJourney: realtimeJourneyBridge!.startBotJourney, stopBotJourney: realtimeJourneyBridge!.stop,
}) : undefined
const browserGameInputHost = createBrowserGameInputHost({
  router: inputRouter,
  fullscreen: fullscreenController,
  prompts: inputPrompts,
  textEntry: gameTextEntry,
  bugReport: { isOpen: bugReportHost.isOpen, close: bugReportHost.close },
  bot: { isRunning: () => botRunning, stop: resetBot },
  isGamepadFocusBlocked: () => browserMultiplayerHost.isOpen() || titleAccountGate.isOpen(),
  touchControls: { panel: runtimePanel, isAvailable: () => gameFlowState !== 'empty' },
  resetPhysicalInput: () => { runButtonPressed = false; clearMovementInput() },
  onResize: syncSingleScreenLayout,
  onVisualViewportResize: (height) => { document.documentElement.style.setProperty('--visual-viewport-height', `${height}px`) },
})

const gameSurfacePointerBindings = installGameSurfacePointerBindings({
  elements: {
    fieldDialogue,
    battleMessage,
    battleCommands,
    battleMoves,
    battleScreen,
    battleEvolution,
    runtimeCanvas,
    fieldNumber,
    fieldNumberInput,
    fieldNickname,
    fieldNicknameInput,
    screenCanvas,
  },
  dispatchPointer: inputRouter.pointer,
  bot: {
    isRunning: () => botRunning,
    stop: resetBot,
  },
  battle: {
    readCursor: () => battleUiCursor,
    writeCursor: (cursor) => { battleUiCursor = cursor },
    renderCursor: renderBattleCursor,
    isBagOpen: () => battleUiMode === 'bag',
    readInputProfile: inputPrompts.getProfile,
  },
  field: {
    readFlowState: () => gameFlowState,
    isMainMenuOpen: () => mainMenu.getState().open,
    submitNumber: submitFieldNumber,
    submitNickname: submitFieldNickname,
  },
  intro: {
    readRenderState: () => oakIntroRuntime.getSnapshot().renderState,
    readOpeningElapsedMs: () => performance.now() - openingStartedAt,
    advance: advanceFlow,
    preview: oakIntroRuntime.preview,
  },
})

function render(): void {
  const now = performance.now()
  vblankCounter = vblankClock.sample(now)
  if (gameFlowState === 'bedroom') fieldPhoneRing.syncIncomingCallMinutes(inGameTimeClock.totalMinutes())
  fieldPhoneRing.tick(vblankCounter, now)
  browserGameInputHost.poll()
  fishingHost.tick()
  pokemonUiSprites.animate(vblankCounter, {
    startersVisible: !fieldChoice.hidden && fieldChoice.classList.contains('field-choice-starter'),
  })
  animateUtilityMenuIcons(now)
  pokegearUi.animate(now)
  safariBattle.tick(vblankCounter)
  battlePokemonSpriteAnimator.animate(vblankCounter, {
    mode: activeDoubleBattle ? 'double' : activeBattle ? 'simple' : 'none',
    isSimpleSideAlive: (side) => Boolean(activeBattle && activeBattle[side].pokemon.currentHp > 0),
    isDoublePlaybackCurrent: (position, element) => Boolean(activeDoubleBattle
      && isBattlePokemonSpriteBoundTo(element, getDoubleBattlePokemon(activeDoubleBattle, position))),
  })
  localWeatherService.refreshIfDue()
  hgssEnvironment.update()
  inGameHudController.update()
  if (gameFlowState === 'bedroom') processMovementInput()
  else drawGameScreen()
  if (import.meta.env.DEV) runBot(now)
  if (import.meta.env.DEV) realtimeCampaignAudit!.recordInitialParty(fieldScriptState.party.members.map(({ speciesId }) => speciesId))
  realtimeJourneyBridge?.tick()
  realtimeTestPanelController?.tick(now)
  if (shouldTickHgssFieldObjects(fishingHost.isActive(), fieldCampaign.isFieldLocked())) fieldObjectMotion.tick()
  const worldObscured = mainMenu.getState().open || pokedexCaptureRegistration.isOpen() || !pcBox.hidden || photoAlbumUi.isOpen() || alphFieldUiHost.isOpen() || fieldEasyChatHost.isOpen() || fieldRecordAppsHost.isOpen() || !fieldNickname.hidden || !modalConfirm.hidden || bugReportHost.isOpen() || titleCampaign.isUiOpen()
  const worldFrameInterval = worldObscured ? 1000 / 30 : 0
  if (gameFlowState === 'bedroom' && battleScreen.hidden && now - lastWorldRenderAt >= worldFrameInterval) {
    runtime.renderFrame(now)
    lastWorldRenderAt = now
  }
  fieldScriptWaitPoller.tick()
  window.requestAnimationFrame(render)
}

installTerminalPageCleanup(window, () => {
  void pageCheckpoint.release().finally(() => cleanupBrowserApplication({
    destroyNetwork: browserMultiplayerHost.destroy,
    dispose: [
      browserGameInputHost.dispose, gameSurfacePointerBindings.dispose, browserRomLoader.destroy,
      oakIntroRuntime.dispose, fieldChoiceHost.destroy, fieldEasyChatHost.destroy,
      alphFieldUiHost.destroy, fieldRecordAppsHost.destroy, bugReportHost.destroy,
      () => { multiplayerGateway.destroy?.() }, pokegearFlyRuntime.dispose, pokemonUiSprites.dispose,
      battleEntryTransition.dispose, battlePokemonSpriteAnimator.dispose, fullscreenController.dispose,
      gameScreenRuntime.dispose, runtime.dispose,
    ],
  }))
})

fullscreenController.updatePresentation()
render()
