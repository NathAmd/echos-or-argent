import type { RomInventory } from '../../../ndsTypes'
import { cloneCanonicalPokemon, type CanonicalPokemon } from '../../pokemon/canonicalPokemon'
import type { PokemonTeamPolicy } from '../../pokemon/pokemonTeamPolicy'
import type { FieldPokemonRuntime, FieldScriptState } from '../../scripts/fieldScriptRunner'
import type { FieldScriptBattle } from '../../scripts/fieldScriptProtocol'
import { resolveHgssBattleWeather } from '../../world/hgssWeather'
import { createDoubleBattleTrainerAiOptions } from '../doubleBattleAi'
import { createDoubleBattleSession, type DoubleBattleSession } from '../doubleBattleSession'
import { createFieldDoubleBattlePlayerRoster } from '../fieldDoubleBattlePlayerRoster'
import type { FieldBattleFormatResolver } from '../fieldBattleFormatResolver'
import { getFirstUsableFieldBattlePartySlot, getUsableFieldBattlePartySlots } from '../fieldBattlePartySelection'
import type { FieldBattleRosterPolicy } from '../fieldBattleRosterPolicy'
import { createFieldScriptedWildPokemon } from '../fieldScriptedWildPokemon'
import { createInitialTrainerBattleState } from '../initialTrainerBattleState'
import { prepareFieldBattle } from '../prepareFieldBattle'
import type { TrainerBattleIntroduction } from '../trainerBattleIntroduction'
import { createTrainerBattleIntroduction } from '../trainerBattleIntroduction'
import {
  createFieldBattleLauncher,
  type DoubleTrainerFieldBattleLaunch,
  type FieldBattleLaunchPolicy,
  type FieldBattleLauncher,
  type MultiTrainerFieldBattleLaunch,
  type SimpleTrainerFieldBattleLaunch,
  type SimpleWildFieldBattleLaunch,
  type DoubleWildFieldBattleLaunch,
  type TagTrainerFieldBattleLaunch,
  type TrainerHouseFieldBattleLaunch,
} from './fieldBattleHost'

export type BrowserFieldBattleInventory = Pick<
  RomInventory,
  'trainerCatalog' | 'pokemonCatalog' | 'itemCatalog' | 'trainerNames'
>

export type BrowserFieldPokemonRuntime = Pick<
  FieldPokemonRuntime,
  'catalog' | 'rng' | 'trainer' | 'language' | 'gameVersion' | 'trainerHouseDefaultName'
>

/** Slice structurelle : un FieldScriptState complet est directement assignable. */
export type BrowserFieldBattleState = Readonly<{
  party: FieldScriptState['party']
  inventory: FieldScriptState['inventory']
  trainerHouseEntries: FieldScriptState['trainerHouseEntries']
  weather: FieldScriptState['weather']
  pokemonRuntime?: BrowserFieldPokemonRuntime
}>

export type BrowserFieldBattleLaunchContext = Readonly<{
  inventory?: BrowserFieldBattleInventory
  state: BrowserFieldBattleState
  formatPolicy: FieldBattleFormatResolver
  rosterPolicy: FieldBattleRosterPolicy
  teamPolicy: PokemonTeamPolicy
  terrainId: number
  allBattlesInDuo: boolean
}>

export type BrowserFieldBattleLauncherEffects = Readonly<{
  startCatchingTutorialBattle: () => void
  startSimpleBattle: (
    kind: 'trainer' | 'wild',
    opponents: readonly CanonicalPokemon[],
    trainerId?: number,
    introduction?: TrainerBattleIntroduction,
    playerParty?: readonly CanonicalPokemon[],
    trainerNameOverride?: string,
    tutorial?: boolean,
  ) => void
  startDoubleBattle: (session: DoubleBattleSession, opponentTrainerIds?: readonly number[]) => void
  startCanonicalFieldWildBattle: (pokemon: CanonicalPokemon) => void
  observeStartedWildEncounter: (pokemon: CanonicalPokemon, method: 'scripted') => void
  applyPolicy: (policy: FieldBattleLaunchPolicy) => void
}>

export type BrowserFieldBattleLauncherPorts = BrowserFieldBattleLauncherEffects & Readonly<{
  readContext: () => BrowserFieldBattleLaunchContext
}>

type RequiredBrowserFieldBattleContext = BrowserFieldBattleLaunchContext & Readonly<{
  inventory: BrowserFieldBattleInventory
  state: BrowserFieldBattleState & Readonly<{ pokemonRuntime: BrowserFieldPokemonRuntime }>
}>

function requireBrowserFieldBattleContext(
  context: BrowserFieldBattleLaunchContext,
): RequiredBrowserFieldBattleContext {
  if (!context.inventory) throw new Error('Le catalogue ROM requis pour preparer le combat est absent.')
  if (!context.state.pokemonRuntime) throw new Error('Le runtime Pokemon requis pour preparer le combat est absent.')
  return context as RequiredBrowserFieldBattleContext
}

function createDoubleSessionBase(context: RequiredBrowserFieldBattleContext) {
  return {
    catalog: context.inventory.pokemonCatalog,
    itemCatalog: context.inventory.itemCatalog,
    bagInventory: context.state.inventory,
    rng: context.state.pokemonRuntime.rng,
    playerTeamPolicy: context.teamPolicy,
    initialWeather: resolveHgssBattleWeather(context.state.weather),
    initialTerrainId: context.terrainId,
  } as const
}

function createOpponentParticipant(
  trainer: TagTrainerFieldBattleLaunch['battle']['opponentTrainers'][number],
  party: CanonicalPokemon[],
  activePartyIndex: number,
  trainerNames: readonly string[],
) {
  return {
    ownerId: `trainer-${trainer.trainerId}`,
    party,
    activePartyIndex,
    controlled: false,
    ai: createDoubleBattleTrainerAiOptions(trainer, trainerNames),
  } as const
}

function startTrainerHouse(
  launch: TrainerHouseFieldBattleLaunch,
  effects: BrowserFieldBattleLauncherEffects,
): void {
  effects.startSimpleBattle(
    'trainer',
    launch.battle.trainer.party,
    undefined,
    undefined,
    launch.battle.playerParty.members,
    launch.battle.trainer.name,
  )
}

function startTagTrainer(
  launch: TagTrainerFieldBattleLaunch,
  context: RequiredBrowserFieldBattleContext,
  effects: BrowserFieldBattleLauncherEffects,
): void {
  const playerParty = context.state.party.members.map(cloneCanonicalPokemon)
  const opponentACount = launch.battle.opponentTrainers[0].party.length
  const opponentParty = launch.battle.createdOpponentParty.map(({ pokemon }) => pokemon)
  const opponentA = opponentParty.slice(0, opponentACount)
  const opponentB = opponentParty.slice(opponentACount)
  const player = createFieldDoubleBattlePlayerRoster({
    party: playerParty,
    teamPolicy: context.teamPolicy,
    allowSingleParticipant: launch.allowSinglePlayerParticipant,
  })
  const session = createDoubleBattleSession({
    ...createDoubleSessionBase(context),
    kind: 'double',
    allowSinglePlayerParticipant: launch.allowSinglePlayerParticipant,
    player,
    opponent: [
      createOpponentParticipant(launch.battle.opponentTrainers[0], opponentA, getFirstUsableFieldBattlePartySlot(opponentA), context.inventory.trainerNames),
      createOpponentParticipant(launch.battle.opponentTrainers[1], opponentB, getFirstUsableFieldBattlePartySlot(opponentB), context.inventory.trainerNames),
    ],
  })
  effects.startDoubleBattle(session, launch.opponentTrainerIds)
}

function startMultiTrainer(
  launch: MultiTrainerFieldBattleLaunch,
  context: RequiredBrowserFieldBattleContext,
  effects: BrowserFieldBattleLauncherEffects,
): void {
  const playerParty = context.state.party.members.map(cloneCanonicalPokemon)
  const allyParty = launch.battle.createdAllyParty.map(({ pokemon }) => pokemon)
  const opponentACount = launch.battle.opponentTrainers[0].party.length
  const opponentParty = launch.battle.createdOpponentParty.map(({ pokemon }) => pokemon)
  const opponentA = opponentParty.slice(0, opponentACount)
  const opponentB = opponentParty.slice(opponentACount)
  const session = createDoubleBattleSession({
    ...createDoubleSessionBase(context),
    kind: 'multi',
    player: [
      {
        ownerId: 'player',
        party: playerParty,
        activePartyIndex: getFirstUsableFieldBattlePartySlot(
          playerParty,
          { format: 'double', phase: 'initial' },
          context.teamPolicy,
        ),
        controlled: true,
      },
      {
        ownerId: 'ally',
        party: allyParty,
        activePartyIndex: getFirstUsableFieldBattlePartySlot(allyParty),
        controlled: false,
        ai: createDoubleBattleTrainerAiOptions(launch.battle.allyTrainer, context.inventory.trainerNames),
      },
    ],
    opponent: [
      createOpponentParticipant(launch.battle.opponentTrainers[0], opponentA, getFirstUsableFieldBattlePartySlot(opponentA), context.inventory.trainerNames),
      createOpponentParticipant(launch.battle.opponentTrainers[1], opponentB, getFirstUsableFieldBattlePartySlot(opponentB), context.inventory.trainerNames),
    ],
  })
  effects.startDoubleBattle(session, launch.opponentTrainerIds)
}

function startDoubleTrainer(
  launch: DoubleTrainerFieldBattleLaunch,
  context: RequiredBrowserFieldBattleContext,
  effects: BrowserFieldBattleLauncherEffects,
): void {
  const playerParty = context.state.party.members.map(cloneCanonicalPokemon)
  const opponentParty = launch.battle.createdParty.map(({ pokemon }) => pokemon)
  const opponentSlots = getUsableFieldBattlePartySlots(opponentParty)
  if (opponentSlots.length < 1) throw new Error('Le combat duo requiert au moins un adversaire utilisable.')
  const player = createFieldDoubleBattlePlayerRoster({
    party: playerParty,
    teamPolicy: context.teamPolicy,
    allowSingleParticipant: launch.allowSinglePlayerParticipant,
  })
  const createOpponent = (activePartyIndex: number) => createOpponentParticipant(
    launch.battle.trainer,
    opponentParty,
    activePartyIndex,
    context.inventory.trainerNames,
  )
  const opponent = opponentSlots.length === 1
    ? [createOpponent(opponentSlots[0]!)] as const
    : [createOpponent(opponentSlots[0]!), createOpponent(opponentSlots[1]!)] as const
  const session = createDoubleBattleSession({
    ...createDoubleSessionBase(context),
    kind: 'double',
    allowSinglePlayerParticipant: launch.allowSinglePlayerParticipant,
    player,
    opponent,
  })
  effects.startDoubleBattle(session, launch.opponentTrainerIds)
}

function startSimpleTrainer(
  launch: SimpleTrainerFieldBattleLaunch,
  context: RequiredBrowserFieldBattleContext,
  effects: BrowserFieldBattleLauncherEffects,
): void {
  const introduction = createTrainerBattleIntroduction(
    createInitialTrainerBattleState(launch.battle, launch.format, context.teamPolicy),
  )
  const opponents = launch.battle.createdParty.map(({ pokemon }) => pokemon)
  if (opponents.length === 0) throw new Error('Le premier Pokémon du Dresseur est absent.')
  effects.startSimpleBattle('trainer', opponents, launch.trainerId, introduction)
}

function startScriptedWild(
  launch: SimpleWildFieldBattleLaunch | DoubleWildFieldBattleLaunch,
  context: RequiredBrowserFieldBattleContext,
  effects: BrowserFieldBattleLauncherEffects,
): void {
  const runtime = context.state.pokemonRuntime
  const wild = createFieldScriptedWildPokemon({
    definition: launch.battle.party[0],
    battleParameter: launch.battle.battleParameter,
    catalog: runtime.catalog,
    rng: runtime.rng,
    originalTrainer: runtime.trainer,
    language: runtime.language,
    gameVersion: runtime.gameVersion,
    metLocation: 0,
    metTerrain: 0,
  })
  effects.startCanonicalFieldWildBattle(wild)
  effects.observeStartedWildEncounter(wild, 'scripted')
}

function createLauncherForContext(
  context: RequiredBrowserFieldBattleContext,
  effects: BrowserFieldBattleLauncherEffects,
): FieldBattleLauncher {
  return createFieldBattleLauncher({
    prepareBattle: (battle) => prepareFieldBattle(
      battle,
      context.inventory.trainerCatalog,
      context.inventory.pokemonCatalog,
      {
        playerParty: context.state.party,
        origin: {
          language: context.state.pokemonRuntime.language,
          gameVersion: context.state.pokemonRuntime.gameVersion,
        },
        trainerHouseEntries: context.state.trainerHouseEntries,
        trainerHouseDefaultName: context.state.pokemonRuntime.trainerHouseDefaultName,
        rosterPolicy: context.rosterPolicy,
      },
    ),
    resolveFormat: context.formatPolicy,
    readRoutingOptions: () => ({ allowSinglePlayerParticipant: context.allBattlesInDuo }),
    applyPolicy: effects.applyPolicy,
    startCaptureTutorial: effects.startCatchingTutorialBattle,
    startTrainerHouse: (launch) => startTrainerHouse(launch, effects),
    startTagTrainer: (launch) => startTagTrainer(launch, context, effects),
    startMultiTrainer: (launch) => startMultiTrainer(launch, context, effects),
    startSimpleTrainer: (launch) => startSimpleTrainer(launch, context, effects),
    startDoubleTrainer: (launch) => startDoubleTrainer(launch, context, effects),
    startSimpleWild: (launch) => startScriptedWild(launch, context, effects),
    startDoubleWild: (launch) => startScriptedWild(launch, context, effects),
  })
}

/**
 * Adaptateur navigateur sans DOM ni runner. Le contexte est capturé une seule
 * fois par lancement afin que préparation, politiques et session utilisent le
 * même inventaire ROM et le même état terrain.
 */
export function createBrowserFieldBattleLauncher(ports: BrowserFieldBattleLauncherPorts): FieldBattleLauncher {
  return Object.freeze({
    launch: (battle: FieldScriptBattle) => {
      const context = requireBrowserFieldBattleContext(ports.readContext())
      return createLauncherForContext(context, ports).launch(battle)
    },
  })
}
