import type { GameDigitalAction } from '../../../gameInput'
import type { CanonicalPokemon } from '../../pokemon/canonicalPokemon'
import type { FieldScriptBattle } from '../../scripts/fieldScriptProtocol'
import type { DoubleBattleSession } from '../doubleBattleSession'
import type { FieldBattleFormatResolver, ResolvedFieldBattleFormat } from '../fieldBattleFormatResolver'
import type { PreparedFieldBattle } from '../prepareFieldBattle'
import type { SimpleBattleResult, SimpleBattleSession } from '../simpleBattleSession'
import type { TrainerBattleIntroduction } from '../trainerBattleIntroduction'

export type BattleUiMode =
  | 'message'
  | 'command'
  | 'moves'
  | 'doubleTarget'
  | 'party'
  | 'bag'
  | 'bagTarget'
  | 'bagMove'
  | 'learnMove'

export type BattlePresentationPhase =
  | 'entering'
  | 'introduction'
  | 'command'
  | 'action'
  | 'exiting'

export type FieldBattleStartPolicy = Readonly<{
  /** Soigne l'équipe après une défaite imposée par un script. */
  healAfterLoss?: boolean
  /** Combat temporaire : aucun gain, objet post-combat ou appel sauvage. */
  suppressProgression?: boolean
  /** Équipe canonique à restaurer après un combat temporaire. */
  restorePlayerParty?: readonly CanonicalPokemon[]
}>

type FieldBattleStartRequestBase = Readonly<{
  /** Corrélation facultative avec le script ou la rencontre appelante. */
  requestId?: string
  opponentTrainerIds?: readonly number[]
  /** Identifiant du Pokémon fuyard à mettre à jour à la sortie. */
  roamerId?: number
  policy?: FieldBattleStartPolicy
}>

export type SimpleFieldBattleStartRequest = FieldBattleStartRequestBase & Readonly<{
  format: 'simple'
  session: SimpleBattleSession
  introduction?: TrainerBattleIntroduction
  flow?: 'standard' | 'capture-tutorial'
}>

export type DoubleFieldBattleStartRequest = FieldBattleStartRequestBase & Readonly<{
  format: 'double'
  session: DoubleBattleSession
}>

/** Requête entièrement préparée : le host ne recherche ni catalogue ni état global. */
export type FieldBattleStartRequest =
  | SimpleFieldBattleStartRequest
  | DoubleFieldBattleStartRequest

type ActiveBattleSnapshotBase = Readonly<{
  active: true
  requestId?: string
  presentationPhase: BattlePresentationPhase
  uiMode: BattleUiMode
  queuedMessageCount: number
  inputLocked: boolean
  exitPending: boolean
  commandSelectionPending: boolean
}>

export type IdleBattleSnapshot = Readonly<{
  active: false
  format: 'none'
  kind: 'none'
  sessionPhase: 'none'
  presentationPhase: 'idle'
  uiMode: 'none'
  queuedMessageCount: 0
  inputLocked: false
  exitPending: false
  commandSelectionPending: false
}>

export type SimpleBattleSnapshot = ActiveBattleSnapshotBase & Readonly<{
  format: 'simple'
  kind: SimpleBattleSession['kind']
  sessionPhase: SimpleBattleSession['phase']
}>

export type DoubleBattleSnapshot = ActiveBattleSnapshotBase & Readonly<{
  format: 'double'
  kind: DoubleBattleSession['kind']
  sessionPhase: DoubleBattleSession['phase']
}>

/** Projection stable destinée à l'input, l'autosave, au debug et au rendu. */
export type BattleSnapshot =
  | IdleBattleSnapshot
  | SimpleBattleSnapshot
  | DoubleBattleSnapshot

export type BattleSnapshotRuntimeState = Readonly<{
  presentationPhase: BattlePresentationPhase
  uiMode: BattleUiMode
  queuedMessageCount: number
  messageInputLocked: boolean
  presentationAnimationLocks: number
  hpAnimationLocks: number
  exitPending: boolean
  commandSelectionPending?: boolean
}>

export type SimpleFieldBattleCompletion = Readonly<{
  format: 'simple'
  requestId?: string
  result: SimpleBattleResult
  session: SimpleBattleSession
}>

export type DoubleFieldBattleCompletion = Readonly<{
  format: 'double'
  requestId?: string
  result: NonNullable<DoubleBattleSession['result']>
  session: DoubleBattleSession
}>

export type FieldBattleCompletion =
  | SimpleFieldBattleCompletion
  | DoubleFieldBattleCompletion

/** Port sortant minimal ; les dépendances DOM/audio restent dans le runtime concret. */
export type FieldBattleLifecyclePort = Readonly<{
  onSnapshotChange?: (snapshot: BattleSnapshot) => void
  onCompletion: (completion: FieldBattleCompletion) => void
}>

/** Port entrant du futur runtime de combat de terrain. */
export type FieldBattleHost = Readonly<{
  start: (request: FieldBattleStartRequest) => void
  handleDigitalInput: (action: GameDigitalAction) => boolean
  tick: (vblankCounter: number) => void
  getSnapshot: () => BattleSnapshot
  reset: () => void
  dispose: () => void
}>

/**
 * Mutation de cycle de vie à appliquer avant le démarrage concret. Le booléen
 * restorePlayerParty demande au port main de capturer l'équipe canonique à cet
 * instant ; le routeur ne lit volontairement aucun état global.
 */
export type FieldBattleLaunchPolicy = Readonly<{
  healAfterLoss: boolean
  suppressProgression: boolean
  restorePlayerParty: boolean
}>

type PreparedBattleOf<Kind extends PreparedFieldBattle['kind']> = Extract<PreparedFieldBattle, { kind: Kind }>
type FieldBattleFormatOf<Engine extends ResolvedFieldBattleFormat['engine']> = Extract<ResolvedFieldBattleFormat, { engine: Engine }>
type FieldBattleSessionFormatOf<
  Engine extends 'simple' | 'double',
  SessionKind extends Extract<ResolvedFieldBattleFormat, { engine: Engine }>['sessionKind'],
> = Extract<ResolvedFieldBattleFormat, { engine: Engine, sessionKind: SessionKind }>

type FieldBattleLaunchRouteBase<
  Kind extends string,
  Battle extends PreparedFieldBattle,
  Format extends ResolvedFieldBattleFormat,
> = Readonly<{
  kind: Kind
  battle: Battle
  format: Format
  policy: FieldBattleLaunchPolicy
}>

export type TutorialFieldBattleLaunch = FieldBattleLaunchRouteBase<
  'capture-tutorial',
  PreparedBattleOf<'tutorial'>,
  FieldBattleFormatOf<'tutorial'>
>

export type TrainerHouseFieldBattleLaunch = FieldBattleLaunchRouteBase<
  'trainer-house-simple',
  PreparedBattleOf<'trainerHouse'>,
  FieldBattleSessionFormatOf<'simple', 'trainer'>
>

export type TagTrainerFieldBattleLaunch = FieldBattleLaunchRouteBase<
  'tag-trainer-double',
  PreparedBattleOf<'tagTrainer'>,
  FieldBattleSessionFormatOf<'double', 'double'>
> & Readonly<{
  opponentTrainerIds: readonly [number, number]
  allowSinglePlayerParticipant: boolean
}>

export type MultiTrainerFieldBattleLaunch = FieldBattleLaunchRouteBase<
  'multi-trainer-double',
  PreparedBattleOf<'multiTrainer'>,
  FieldBattleSessionFormatOf<'double', 'multi'>
> & Readonly<{
  opponentTrainerIds: readonly [number, number]
}>

export type SimpleTrainerFieldBattleLaunch = FieldBattleLaunchRouteBase<
  'trainer-simple',
  PreparedBattleOf<'trainer'>,
  FieldBattleSessionFormatOf<'simple', 'trainer'>
> & Readonly<{
  trainerId: number
}>

export type DoubleTrainerFieldBattleLaunch = FieldBattleLaunchRouteBase<
  'trainer-double',
  PreparedBattleOf<'trainer'>,
  FieldBattleSessionFormatOf<'double', 'double'>
> & Readonly<{
  opponentTrainerIds: readonly [number]
  allowSinglePlayerParticipant: boolean
}>

export type SimpleWildFieldBattleLaunch = FieldBattleLaunchRouteBase<
  'wild-simple',
  PreparedBattleOf<'wild'>,
  FieldBattleSessionFormatOf<'simple', 'wild'>
>

export type DoubleWildFieldBattleLaunch = FieldBattleLaunchRouteBase<
  'wild-double',
  PreparedBattleOf<'wild'>,
  FieldBattleSessionFormatOf<'double', 'double'>
> & Readonly<{
  allowSinglePlayerParticipant: true
}>

export type FieldBattleLaunchRoute =
  | TutorialFieldBattleLaunch
  | TrainerHouseFieldBattleLaunch
  | TagTrainerFieldBattleLaunch
  | MultiTrainerFieldBattleLaunch
  | SimpleTrainerFieldBattleLaunch
  | DoubleTrainerFieldBattleLaunch
  | SimpleWildFieldBattleLaunch
  | DoubleWildFieldBattleLaunch

export type FieldBattleLaunchRoutingOptions = Readonly<{
  /** Politique NG+ « tous les combats en duo ». */
  allowSinglePlayerParticipant: boolean
}>

/** Ports exactement alignés sur les huit branches de lancement de main. */
export type FieldBattleLauncherPorts = Readonly<{
  prepareBattle: (battle: FieldScriptBattle) => PreparedFieldBattle
  resolveFormat: FieldBattleFormatResolver
  readRoutingOptions: () => FieldBattleLaunchRoutingOptions
  applyPolicy: (policy: FieldBattleLaunchPolicy) => void
  startCaptureTutorial: (launch: TutorialFieldBattleLaunch) => void
  startTrainerHouse: (launch: TrainerHouseFieldBattleLaunch) => void
  startTagTrainer: (launch: TagTrainerFieldBattleLaunch) => void
  startMultiTrainer: (launch: MultiTrainerFieldBattleLaunch) => void
  startSimpleTrainer: (launch: SimpleTrainerFieldBattleLaunch) => void
  startDoubleTrainer: (launch: DoubleTrainerFieldBattleLaunch) => void
  startSimpleWild: (launch: SimpleWildFieldBattleLaunch) => void
  startDoubleWild: (launch: DoubleWildFieldBattleLaunch) => void
}>

export type FieldBattleLauncher = Readonly<{
  /** Prépare, résout la politique de format, applique la politique puis démarre. */
  launch: (battle: FieldScriptBattle) => FieldBattleLaunchRoute
}>

const idleBattleSnapshot: IdleBattleSnapshot = Object.freeze({
  active: false,
  format: 'none',
  kind: 'none',
  sessionPhase: 'none',
  presentationPhase: 'idle',
  uiMode: 'none',
  queuedMessageCount: 0,
  inputLocked: false,
  exitPending: false,
  commandSelectionPending: false,
})

export function createIdleBattleSnapshot(): IdleBattleSnapshot {
  return idleBattleSnapshot
}

function assertSnapshotCount(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} doit être un entier positif ou nul.`)
  }
}

/**
 * Construit la projection sans recopier la session mutable. Les compteurs de
 * verrouillage sont réduits à un booléen afin de ne pas exposer l'implémentation.
 */
export function createActiveBattleSnapshot(
  request: FieldBattleStartRequest,
  state: BattleSnapshotRuntimeState,
): SimpleBattleSnapshot | DoubleBattleSnapshot {
  assertSnapshotCount('queuedMessageCount', state.queuedMessageCount)
  assertSnapshotCount('presentationAnimationLocks', state.presentationAnimationLocks)
  assertSnapshotCount('hpAnimationLocks', state.hpAnimationLocks)
  const common = {
    active: true as const,
    requestId: request.requestId,
    presentationPhase: state.presentationPhase,
    uiMode: state.uiMode,
    queuedMessageCount: state.queuedMessageCount,
    inputLocked: state.messageInputLocked
      || state.presentationAnimationLocks > 0
      || state.hpAnimationLocks > 0,
    exitPending: state.exitPending,
    commandSelectionPending: state.commandSelectionPending ?? false,
  }
  return request.format === 'simple'
    ? Object.freeze({
        ...common,
        format: 'simple' as const,
        kind: request.session.kind,
        sessionPhase: request.session.phase,
      })
    : Object.freeze({
        ...common,
        format: 'double' as const,
        kind: request.session.kind,
        sessionPhase: request.session.phase,
      })
}

/** Équivalent contractuel de la condition du terminal temps réel actuel. */
export function isBattleCommandReady(snapshot: BattleSnapshot): boolean {
  return snapshot.active
    && snapshot.sessionPhase === 'command'
    && snapshot.presentationPhase === 'command'
    && snapshot.uiMode === 'command'
    && snapshot.queuedMessageCount === 0
    && !snapshot.inputLocked
    && !snapshot.exitPending
    && !snapshot.commandSelectionPending
}

const standardFieldBattlePolicy: FieldBattleLaunchPolicy = Object.freeze({
  healAfterLoss: false,
  suppressProgression: false,
  restorePlayerParty: false,
})

const temporaryFieldBattlePolicy: FieldBattleLaunchPolicy = Object.freeze({
  healAfterLoss: false,
  suppressProgression: true,
  restorePlayerParty: true,
})

const healingFieldBattlePolicy: FieldBattleLaunchPolicy = Object.freeze({
  healAfterLoss: true,
  suppressProgression: false,
  restorePlayerParty: false,
})

function scriptedTrainerPolicy(encounterType: number): FieldBattleLaunchPolicy {
  return encounterType === 0 ? standardFieldBattlePolicy : healingFieldBattlePolicy
}

function describeResolvedFieldBattleFormat(format: ResolvedFieldBattleFormat): string {
  return format.engine === 'tutorial' ? format.engine : `${format.engine}/${format.sessionKind}`
}

/**
 * Matrice pure du branchement historique `step.kind === 'battle'`. Elle ne
 * construit aucune session : les huit sorties transportent le variant préparé
 * exact et toutes les décisions nécessaires au port de lancement correspondant.
 */
export function resolvePreparedFieldBattleLaunch(
  battle: PreparedFieldBattle,
  format: ResolvedFieldBattleFormat,
  options: FieldBattleLaunchRoutingOptions = { allowSinglePlayerParticipant: false },
): FieldBattleLaunchRoute {
  if (battle.kind === 'tutorial' && format.engine === 'tutorial') {
    return Object.freeze({
      kind: 'capture-tutorial',
      battle,
      format,
      policy: temporaryFieldBattlePolicy,
    })
  }
  if (battle.kind === 'trainerHouse' && format.engine === 'simple' && format.sessionKind === 'trainer') {
    return Object.freeze({
      kind: 'trainer-house-simple',
      battle,
      format,
      policy: temporaryFieldBattlePolicy,
    })
  }
  if (battle.kind === 'tagTrainer' && format.engine === 'double' && format.sessionKind === 'double') {
    return Object.freeze({
      kind: 'tag-trainer-double',
      battle,
      format,
      policy: scriptedTrainerPolicy(battle.script.encounterType),
      opponentTrainerIds: Object.freeze(battle.opponentTrainers.map(({ trainerId }) => trainerId)) as readonly [number, number],
      allowSinglePlayerParticipant: options.allowSinglePlayerParticipant,
    })
  }
  if (battle.kind === 'multiTrainer' && format.engine === 'double' && format.sessionKind === 'multi') {
    return Object.freeze({
      kind: 'multi-trainer-double',
      battle,
      format,
      policy: healingFieldBattlePolicy,
      opponentTrainerIds: Object.freeze(battle.opponentTrainers.map(({ trainerId }) => trainerId)) as readonly [number, number],
    })
  }
  if (battle.kind === 'trainer') {
    if (format.engine === 'simple' && format.sessionKind === 'trainer') {
      return Object.freeze({
        kind: 'trainer-simple',
        battle,
        format,
        policy: scriptedTrainerPolicy(battle.script.encounterType),
        trainerId: battle.trainer.trainerId,
      })
    }
    if (format.engine === 'double' && format.sessionKind === 'double') {
      return Object.freeze({
        kind: 'trainer-double',
        battle,
        format,
        policy: scriptedTrainerPolicy(battle.script.encounterType),
        opponentTrainerIds: Object.freeze([battle.trainer.trainerId]) as readonly [number],
        allowSinglePlayerParticipant: options.allowSinglePlayerParticipant,
      })
    }
    throw new Error(`Le format ${describeResolvedFieldBattleFormat(format)} ne prend pas en charge ce combat de Dresseur.`)
  }
  if (battle.kind === 'wild') {
    if (format.engine === 'simple' && format.sessionKind === 'wild') {
      return Object.freeze({
        kind: 'wild-simple',
        battle,
        format,
        policy: standardFieldBattlePolicy,
      })
    }
    if (format.engine === 'double' && format.sessionKind === 'double') {
      return Object.freeze({
        kind: 'wild-double',
        battle,
        format,
        policy: standardFieldBattlePolicy,
        allowSinglePlayerParticipant: true,
      })
    }
  }
  throw new Error(`Le format ${describeResolvedFieldBattleFormat(format)} du combat ${battle.kind} n'est pas pris en charge.`)
}

function startResolvedFieldBattleLaunch(route: FieldBattleLaunchRoute, ports: FieldBattleLauncherPorts): void {
  ports.applyPolicy(route.policy)
  switch (route.kind) {
    case 'capture-tutorial': ports.startCaptureTutorial(route); return
    case 'trainer-house-simple': ports.startTrainerHouse(route); return
    case 'tag-trainer-double': ports.startTagTrainer(route); return
    case 'multi-trainer-double': ports.startMultiTrainer(route); return
    case 'trainer-simple': ports.startSimpleTrainer(route); return
    case 'trainer-double': ports.startDoubleTrainer(route); return
    case 'wild-simple': ports.startSimpleWild(route); return
    case 'wild-double': ports.startDoubleWild(route); return
  }
}

/**
 * Orchestrateur prêt à remplacer le branchement de `advanceFieldScript` : les
 * erreurs de préparation, de politique ou de démarrage restent propagées afin
 * que la transaction actuelle puisse soumettre l'échec au runner et nettoyer
 * la présentation.
 */
export function createFieldBattleLauncher(ports: FieldBattleLauncherPorts): FieldBattleLauncher {
  return Object.freeze({
    launch: (battle: FieldScriptBattle): FieldBattleLaunchRoute => {
      const prepared = ports.prepareBattle(battle)
      const format = ports.resolveFormat(prepared)
      const route = resolvePreparedFieldBattleLaunch(prepared, format, ports.readRoutingOptions())
      startResolvedFieldBattleLaunch(route, ports)
      return route
    },
  })
}
