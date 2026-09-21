import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readRomInventory } from '../../nds'
import type { RomInventory } from '../../ndsTypes'
import { createFieldScriptState, initializeNewGameFieldScriptState, type FieldScriptState } from '../scripts/fieldScriptRunner'
import { createHgssSessionRng } from '../pokemon/hgssSessionRng'
import { createFieldInputSimulator, type FieldInput } from './fieldInputSimulator'
import {
  createJohtoJourneyPlanner,
  findInputsToAdjacentMap,
  findInputsToBackground,
  findInputsToNpc,
  findInputsToProgressEvent,
  findInputsToTile,
  findInputsToWarp,
  isJohtoJourneyTargetReached,
  type JohtoJourneyPlanner,
  type JohtoJourneyPosition,
  ZEPHYR_BADGE_TARGET,
} from './johtoJourneyPlanner'
import { createOpeningJourneyAgent } from './openingJourneyAgent'
import { TOGEPI_EGG_TARGET } from './togepiEggJourneyAgent'
import { createPlayerJourneyAudit, type PlayerJourneyAudit } from './playerJourneyAudit'
import { createPlayerProfileForRom } from '../../playerProfile'
import { prepareFieldBattle } from '../battle/prepareFieldBattle'
import { createInitialTrainerBattleState } from '../battle/initialTrainerBattleState'
import { advanceTrainerBattleIntroduction, createTrainerBattleIntroduction } from '../battle/trainerBattleIntroduction'
import { inspectPokemonMachineCompatibility, usePokemonMachine } from '../items/usePokemonMachine'

const defaultRomPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const romPath = process.env.ROM_JOURNEY_PATH ? resolve(process.env.ROM_JOURNEY_PATH) : defaultRomPath
const journey = process.env.RUN_ROM_JOURNEY === '1' && existsSync(romPath) ? it : it.skip
const liveJourney = process.env.LIVE_ROM_JOURNEY === '1'
const requestedJourneyTarget = process.env.PLAYER_JOURNEY_TARGET ?? 'hive-badge'

function getInputState(simulator: ReturnType<typeof createFieldInputSimulator>): JohtoJourneyPosition {
  const state = simulator.getWorld().getState()
  if (!state) throw new Error('Le simulateur ne contient aucune carte active.')
  return { mapId: state.map.id, tileX: state.tileX, tileZ: state.tileZ, direction: state.direction, groundHeight: state.groundHeight }
}

function validateVisibleRomAssets(inventory: RomInventory, simulator: ReturnType<typeof createFieldInputSimulator>): void {
  const world = simulator.getWorld().getState()
  if (!world) throw new Error('La carte active est absente pendant la validation des assets ROM.')
  if (!inventory.fieldCameraParams[world.map.header.cameraType]) {
    throw new Error(`Le profil camera ROM ${world.map.header.cameraType} de la carte ${world.map.id} est absent.`)
  }
  const state = simulator.getFieldState()
  for (const object of world.map.events?.objects ?? []) {
    const visible = (object.eventFlag === 0 || !state.flags.has(object.eventFlag)) && !state.hiddenObjectIds.has(object.id)
    if (!visible) continue
    const variableId = object.spriteId >= 101 && object.spriteId <= 117 ? 0x4020 + object.spriteId - 101 : undefined
    const spriteId = variableId === undefined ? object.spriteId : state.variables.get(variableId)
    if (spriteId === undefined) throw new Error(`Le PNJ visible ${object.id} de la carte ${world.map.id} n'a aucun sprite ROM resolu.`)
    const preview = inventory.eventTexturePreviews?.[spriteId] ?? inventory.eventTextureResolver?.(spriteId).preview
    if (!preview) throw new Error(`L'asset ROM du PNJ visible ${object.id}, sprite ${spriteId}, carte ${world.map.id}, est absent.`)
  }
}

function createJourneyFieldState(inventory: RomInventory, name: string): FieldScriptState {
  const rng = createHgssSessionRng(5489)
  const profile = createPlayerProfileForRom(inventory.metadata)
  const state = createFieldScriptState('male', name, {
    pokemonRuntime: {
      catalog: inventory.pokemonCatalog,
      pokedexCatalog: inventory.pokedexCatalog,
      itemCatalog: inventory.itemCatalog,
      rng: rng.lc,
      mt: rng.mt,
      trainer: { id: 1, name, gender: 'male' },
      language: profile.language!,
      gameVersion: profile.gameVersion!,
      now: () => new Date(2026, 0, 1),
      phoneBookEntries: inventory.phoneBookEntries,
      trainerCatalog: inventory.trainerCatalog,
      trainerMessages: inventory.trainerMessages,
      npcTradeCatalog: inventory.npcTradeCatalog,
      trainerClassNames: inventory.trainerClassNames,
      easyChatCatalog: inventory.easyChatCatalog,
      pokeathlonDataMessages: inventory.pokeathlonDataMessages,
      alphPuzzleTiles: inventory.alphPuzzleTiles,
      alphPuzzleBackground: inventory.alphPuzzleBackground,
      alphPuzzleHints: inventory.alphPuzzleHints,
      alphHiddenRoomBackground: inventory.alphHiddenRoomBackground,
      alphHiddenRoomWords: inventory.alphHiddenRoomWords,
      mailMessageBanks: inventory.mailMessageBanks,
      trainerHouseDefaultName: inventory.trainerHouseDefaultName,
      mapSectionForMapId: (mapId) => inventory.resolvedMapCatalog.maps.find((map) => map.id === mapId)?.header.mapSection,
    },
  })
  const startMap = inventory.resolvedMapCatalog.maps.find((map) => map.id === inventory.resolvedMapCatalog.startMapId)
  if (!startMap) throw new Error('La carte ROM de depart est absente de la nouvelle partie simulee.')
  initializeNewGameFieldScriptState(startMap, state)
  return state
}

function formatJourneyEvents(events: ReturnType<ReturnType<typeof createFieldInputSimulator>['input']>): string {
  if (events.length === 0) return '—'
  return events.map((event) => {
    if (event.kind === 'moved') return `map ${event.mapId} (${event.tileX}, ${event.tileZ})`
    if (event.kind === 'message') return `dialogue ${event.messageId}`
    if (event.kind === 'blocked') return `bloqué (${event.reason})`
    if (event.kind === 'battle') return event.battle.kind === 'trainer'
      ? `combat dresseur ${event.battle.trainerId}`
      : `combat ${event.battle.kind}`
    return event.kind
  }).join(' → ')
}

function sendJourneyInput(audit: PlayerJourneyAudit, simulator: ReturnType<typeof createFieldInputSimulator>, input: FieldInput): ReturnType<ReturnType<typeof createFieldInputSimulator>['input']> {
  const events = audit.run(() => audit.input(input))
  if (liveJourney) {
    const state = getInputState(simulator)
    console.log(`[map ${state.mapId} · ${state.tileX},${state.tileZ}] ${input.padEnd(7)} ${formatJourneyEvents(events)}`)
  }
  return events
}

function settleMapScript(audit: PlayerJourneyAudit, simulator: ReturnType<typeof createFieldInputSimulator>): void {
  for (let steps = 0; steps < 512 && simulator.hasActiveScript() && !simulator.isWaitingForBattle(); steps += 1) {
    if (simulator.isWaitingForInput()) sendJourneyInput(audit, simulator, 'confirm')
    else if (simulator.getChoiceIndex() !== undefined) sendJourneyInput(audit, simulator, 'confirm')
    else audit.run(() => audit.settle())
  }
  if (simulator.hasActiveScript() && !simulator.isWaitingForBattle()) {
    audit.run(() => { throw new Error('Le script ROM de carte ne se stabilise pas après 512 reprises.') })
  }
}

function replayInputs(
  audit: PlayerJourneyAudit,
  simulator: ReturnType<typeof createFieldInputSimulator>,
  inputs: readonly FieldInput[],
  resolveTrainerBattles = false,
  replanOnBlockedMovement = false,
): boolean {
  for (let inputIndex = 0; inputIndex < inputs.length; inputIndex += 1) {
    const input = inputs[inputIndex]!
    const events = sendJourneyInput(audit, simulator, input)
    settleMapScript(audit, simulator)
    if (resolveTrainerBattles && simulator.isWaitingForBattle()) {
      audit.run(() => audit.battleResult(true))
      settleMapScript(audit, simulator)
      return true
    }
    if (replanOnBlockedMovement && inputs[inputIndex + 1] !== 'confirm' && events.some((event) => event.kind === 'blocked')) return true
  }
  return false
}

function replayToNpcUntil(
  audit: PlayerJourneyAudit,
  simulator: ReturnType<typeof createFieldInputSimulator>,
  maps: Awaited<ReturnType<typeof readRomInventory>>['resolvedMapCatalog']['maps'],
  objectId: number,
  reached: () => boolean,
): void {
  for (let replans = 0; replans < 32 && !reached(); replans += 1) {
    const inputs = findInputsToNpc(maps, getInputState(simulator), objectId, simulator.getFieldState())
    replayInputs(audit, simulator, inputs, true, true)
  }
  if (!reached()) {
    audit.run(() => { throw new Error(`Le PNJ ${objectId} n'atteint pas son état de quête après 32 recalculs de trajet.`) })
  }
}

function replayToAdjacentMap(
  audit: PlayerJourneyAudit,
  simulator: ReturnType<typeof createFieldInputSimulator>,
  maps: Awaited<ReturnType<typeof readRomInventory>>['resolvedMapCatalog']['maps'],
  targetMapId: number,
  resolveTrainerBattles = false,
): void {
  for (let replans = 0; replans < 32 && getInputState(simulator).mapId !== targetMapId; replans += 1) {
    const inputs = findInputsToAdjacentMap(maps, getInputState(simulator), targetMapId, simulator.getFieldState())
    replayInputs(audit, simulator, inputs, resolveTrainerBattles, resolveTrainerBattles)
  }
  if (getInputState(simulator).mapId !== targetMapId) {
    audit.run(() => { throw new Error(`Le bot n'atteint pas la carte ${targetMapId} apres 32 recalculs de trajet.`) })
  }
}

function replayToTile(
  audit: PlayerJourneyAudit,
  simulator: ReturnType<typeof createFieldInputSimulator>,
  maps: Awaited<ReturnType<typeof readRomInventory>>['resolvedMapCatalog']['maps'],
  tileX: number,
  tileZ: number,
  avoidCoordinateScriptIds?: ReadonlySet<number>,
): void {
  for (let replans = 0; replans < 32; replans += 1) {
    const position = getInputState(simulator)
    if (position.tileX === tileX && position.tileZ === tileZ) return
    const inputs = findInputsToTile(maps, position, { tileX, tileZ }, simulator.getFieldState(), { avoidCoordinateScriptIds })
    replayInputs(audit, simulator, inputs, true, true)
  }
  const position = getInputState(simulator)
  if (position.tileX !== tileX || position.tileZ !== tileZ) {
    audit.run(() => { throw new Error(`Le bot n'atteint pas la case ${tileX},${tileZ} après 32 recalculs de trajet.`) })
  }
}

function replayTowardAdjacentMapUntilBattle(
  audit: PlayerJourneyAudit,
  simulator: ReturnType<typeof createFieldInputSimulator>,
  maps: Awaited<ReturnType<typeof readRomInventory>>['resolvedMapCatalog']['maps'],
  targetMapId: number,
): Extract<ReturnType<typeof simulator.getHistory>[number], { kind: 'battle' }> {
  for (let replans = 0; replans < 16 && getInputState(simulator).mapId !== targetMapId; replans += 1) {
    const inputs = findInputsToAdjacentMap(maps, getInputState(simulator), targetMapId, simulator.getFieldState())
    for (const input of inputs) {
      sendJourneyInput(audit, simulator, input)
      settleMapScript(audit, simulator)
      if (simulator.isWaitingForBattle()) return advanceToBattle(audit, simulator)
    }
  }
  throw new Error(`Le trajet vers la carte ${targetMapId} n'a declenche aucun combat ROM.`)
}

function replayToWarp(
  audit: PlayerJourneyAudit,
  simulator: ReturnType<typeof createFieldInputSimulator>,
  maps: Awaited<ReturnType<typeof readRomInventory>>['resolvedMapCatalog']['maps'],
  targetMapId: number,
  resolveTrainerBattles = false,
): void {
  for (let replans = 0; replans < 32 && getInputState(simulator).mapId !== targetMapId; replans += 1) {
    const before = getInputState(simulator)
    const inputs = findInputsToWarp(maps, before, targetMapId, simulator.getFieldState())
    replayInputs(audit, simulator, inputs, resolveTrainerBattles, resolveTrainerBattles)
    const after = getInputState(simulator)
    if (before.mapId === after.mapId && before.tileX === after.tileX && before.tileZ === after.tileZ) {
      const lastEvent = simulator.getHistory().at(-1)
      // Le premier pas vers le MapObject follower le fait céder; le second
      // échange leurs positions. Ce blocage transitoire natif doit donc être
      // replanifié une fois au lieu d'être diagnostiqué comme une stagnation.
      if (lastEvent?.kind === 'blocked' && lastEvent.reason === 'follower') continue
      const objects = [...simulator.getFieldState().objects].map(([id, object]) => ({ id, ...object }))
      audit.run(() => { throw new Error(`Le trajet vers le warp ${targetMapId} stagne: ${JSON.stringify({ before, inputs, objects })}.`) })
    }
  }
  if (getInputState(simulator).mapId !== targetMapId) {
    audit.run(() => { throw new Error(`Le bot n'atteint pas le warp vers la carte ${targetMapId} apres 32 recalculs de trajet.`) })
  }
}

function replayToJourneyTarget(
  audit: PlayerJourneyAudit,
  simulator: ReturnType<typeof createFieldInputSimulator>,
  planner: JohtoJourneyPlanner,
): void {
  for (let replans = 0; replans < 256; replans += 1) {
    if (planner.getMilestone(simulator.getFieldState()).reached) return
    const inputs = planner.planInputs(getInputState(simulator), simulator.getFieldState())
    if (!inputs || inputs.length === 0) {
      audit.run(() => { throw new Error(`Le planificateur du jalon ${planner.target.id} ne fournit plus d'entrée.`) })
      continue
    }
    replayInputs(audit, simulator, inputs, true, true)
  }
  if (!planner.getMilestone(simulator.getFieldState()).reached) {
    audit.run(() => { throw new Error(`Le jalon ${planner.target.id} reste inaccessible après 256 recalculs de trajet.`) })
  }
}

function replayToNpcThroughMechanisms(
  audit: PlayerJourneyAudit,
  simulator: ReturnType<typeof createFieldInputSimulator>,
  maps: Awaited<ReturnType<typeof readRomInventory>>['resolvedMapCatalog']['maps'],
  objectId: number,
  reached: () => boolean,
): void {
  const attempted = new Set<string>()
  const visitedMechanismStates = new Set<string>()
  const map = maps.find((candidate) => candidate.id === getInputState(simulator).mapId)
  const target = simulator.getFieldState().objects.get(objectId) ?? map?.events?.objects.find((object) => object.id === objectId)
  if (!target) throw new Error(`Le PNJ cible ${objectId} est absent de la carte active.`)
  const rememberMechanismState = (): void => {
    visitedMechanismStates.add([...simulator.getFieldState().gymmick.data].join(','))
  }
  rememberMechanismState()
  for (let actions = 0; actions < 64 && !reached(); actions += 1) {
    try {
      const inputs = findInputsToNpc(maps, getInputState(simulator), objectId, simulator.getFieldState())
      replayInputs(audit, simulator, inputs, true, true)
      continue
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith("Aucun chemin d'inputs ROM vers le PNJ")) throw error
    }
    const gymState = [...simulator.getFieldState().gymmick.data].join(',')
    let event: ReturnType<typeof findInputsToProgressEvent>
    try {
      event = findInputsToProgressEvent(maps, getInputState(simulator), simulator.getFieldState(), new Set([
        ...[...attempted].filter((key) => key.startsWith('background:')),
        ...[...attempted].filter((key) => key.startsWith(`${gymState}:`)).map((key) => key.slice(gymState.length + 1)),
      ]), target, visitedMechanismStates)
    } catch (error) {
      const mechanismHistory = simulator.getHistory().filter((step) => step.kind === 'gymMechanism' || step.kind === 'moved').slice(-32)
      throw new Error(`${error instanceof Error ? error.message : String(error)} Historique: ${JSON.stringify(mechanismHistory)}.`, { cause: error })
    }
    const interrupted = replayInputs(audit, simulator, event.inputs, true, true)
    if (!interrupted) {
      attempted.add(event.key.startsWith('background:') ? event.key : `${gymState}:${event.key}`)
      rememberMechanismState()
    }
  }
  if (!reached()) {
    audit.run(() => { throw new Error(`Le puzzle ROM n'ouvre pas l'accès au PNJ ${objectId} après 64 actions.`) })
  }
}

function replayToWarpThroughMechanisms(
  audit: PlayerJourneyAudit,
  simulator: ReturnType<typeof createFieldInputSimulator>,
  maps: Awaited<ReturnType<typeof readRomInventory>>['resolvedMapCatalog']['maps'],
  targetMapId: number,
): void {
  const attempted = new Set<string>()
  const visitedMechanismStates = new Set<string>()
  const map = maps.find((candidate) => candidate.id === getInputState(simulator).mapId)
  const target = map?.events?.warps.find((warp) => warp.header === targetMapId)
  if (!target) throw new Error(`Le warp cible ${targetMapId} est absent de la carte active.`)
  const rememberMechanismState = (): void => {
    visitedMechanismStates.add([...simulator.getFieldState().gymmick.data].join(','))
  }
  rememberMechanismState()
  for (let actions = 0; actions < 64 && getInputState(simulator).mapId !== targetMapId; actions += 1) {
    try {
      const inputs = findInputsToWarp(maps, getInputState(simulator), targetMapId, simulator.getFieldState())
      replayInputs(audit, simulator, inputs, true, true)
      continue
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith("Aucun chemin d'inputs ROM vers la carte")) throw error
    }
    const mechanismState = [...simulator.getFieldState().gymmick.data].join(',')
    const event = findInputsToProgressEvent(maps, getInputState(simulator), simulator.getFieldState(), new Set([
      ...[...attempted].filter((key) => key.startsWith('background:')),
      ...[...attempted].filter((key) => key.startsWith(`${mechanismState}:`)).map((key) => key.slice(mechanismState.length + 1)),
    ]), target, visitedMechanismStates)
    const interrupted = replayInputs(audit, simulator, event.inputs, true, true)
    if (!interrupted) {
      attempted.add(event.key.startsWith('background:') ? event.key : `${mechanismState}:${event.key}`)
      rememberMechanismState()
    }
  }
  if (getInputState(simulator).mapId !== targetMapId) {
    audit.run(() => { throw new Error(`Le puzzle ROM n'ouvre pas le warp ${targetMapId} après 64 actions.`) })
  }
}

function advanceToChoice(audit: PlayerJourneyAudit, simulator: ReturnType<typeof createFieldInputSimulator>): void {
  for (let steps = 0; steps < 128 && simulator.hasActiveScript() && simulator.getChoiceIndex() === undefined; steps += 1) {
    if (simulator.isWaitingForInput()) sendJourneyInput(audit, simulator, 'confirm')
    else audit.run(() => audit.settle())
  }
  if (simulator.getChoiceIndex() === undefined) throw new Error(`Le script ROM attendu ne presente aucun choix joueur: ${JSON.stringify(simulator.getHistory().slice(-24))}`)
}

function finishScriptWithSecondChoice(audit: PlayerJourneyAudit, simulator: ReturnType<typeof createFieldInputSimulator>): void {
  for (let steps = 0; steps < 256 && simulator.hasActiveScript(); steps += 1) {
    if (simulator.getChoiceIndex() !== undefined) {
      sendJourneyInput(audit, simulator, 'down')
      sendJourneyInput(audit, simulator, 'confirm')
    } else if (simulator.isWaitingForInput()) sendJourneyInput(audit, simulator, 'confirm')
    else audit.run(() => audit.settle())
  }
  if (simulator.hasActiveScript()) throw new Error('Le choix de starter ROM ne se stabilise pas apres les confirmations joueur.')
}

function finishScriptWithDefaultChoices(audit: PlayerJourneyAudit, simulator: ReturnType<typeof createFieldInputSimulator>): void {
  for (let steps = 0; steps < 256 && simulator.hasActiveScript(); steps += 1) {
    if (simulator.getChoiceIndex() !== undefined || simulator.isWaitingForInput()) sendJourneyInput(audit, simulator, 'confirm')
    else audit.run(() => audit.settle())
  }
  if (simulator.hasActiveScript()) throw new Error('Le script ROM ne se stabilise pas avec les choix par defaut du joueur.')
}

function finishScriptWithChoices(
  audit: PlayerJourneyAudit,
  simulator: ReturnType<typeof createFieldInputSimulator>,
  choices: readonly number[],
): void {
  let choiceCursor = 0
  for (let steps = 0; steps < 512 && simulator.hasActiveScript(); steps += 1) {
    const currentChoice = simulator.getChoiceIndex()
    if (currentChoice !== undefined) {
      const targetChoice = choices[choiceCursor++]
      if (targetChoice === undefined) throw new Error(`Le script ROM présente un choix inattendu à l’index ${choiceCursor - 1}.`)
      let selected = currentChoice
      for (let attempts = 0; selected !== targetChoice && attempts < 16; attempts += 1) {
        sendJourneyInput(audit, simulator, 'down')
        selected = simulator.getChoiceIndex()!
      }
      if (selected !== targetChoice) throw new Error(`Le choix ROM ${targetChoice} est inaccessible depuis ${currentChoice}.`)
      sendJourneyInput(audit, simulator, 'confirm')
    } else if (simulator.isWaitingForInput()) sendJourneyInput(audit, simulator, 'confirm')
    else audit.run(() => audit.settle())
  }
  if (simulator.hasActiveScript()) throw new Error('Le script ROM ne se stabilise pas après les choix demandés.')
  if (choiceCursor !== choices.length) {
    throw new Error(`Le script ROM a consommé ${choiceCursor} choix sur les ${choices.length} attendus.`)
  }
}

function advanceToBattle(audit: PlayerJourneyAudit, simulator: ReturnType<typeof createFieldInputSimulator>): Extract<ReturnType<typeof simulator.getHistory>[number], { kind: 'battle' }> {
  for (let steps = 0; steps < 256; steps += 1) {
    const battle = simulator.getHistory().find((event): event is Extract<typeof event, { kind: 'battle' }> => event.kind === 'battle')
    if (battle) return battle
    if (!simulator.hasActiveScript()) break
    if (simulator.isWaitingForInput()) sendJourneyInput(audit, simulator, 'confirm')
    else if (simulator.getChoiceIndex() !== undefined) sendJourneyInput(audit, simulator, 'confirm')
    else audit.run(() => audit.settle())
  }
  throw new Error(`Le parcours ROM n’a pas atteint de combat: ${JSON.stringify(simulator.getHistory().slice(-24))}`)
}

async function writePlayerJourneyReport(
  simulator: ReturnType<typeof createFieldInputSimulator>,
  milestone: string,
): Promise<void> {
  if (!process.env.PLAYER_JOURNEY_REPORT_PATH) return
  const battles = simulator.getHistory().flatMap((event) => event.kind === 'battle' ? [event.battle] : [])
  await writeFile(resolve(process.env.PLAYER_JOURNEY_REPORT_PATH), `${JSON.stringify({
    format: 'pokemaster-player-journey-audit',
    revision: 1,
    milestone,
    finalMapId: simulator.getWorld().getState()?.map.id,
    badges: [...simulator.getFieldState().badges].sort((left, right) => left - right),
    defeatedTrainerIds: [...simulator.getFieldState().trainerFlags].sort((left, right) => left - right),
    wonTrainerBattleIds: simulator.getWonTrainerBattleIds(),
    scriptedBattles: battles.length,
  }, null, 2)}\n`)
}

describe('opening input journey', () => {
  journey('drives the real simulator with the same autonomous agent as the visible bot', async () => {
    const romBuffer = await readFile(romPath)
    const inventory = await readRomInventory(new File([romBuffer], basename(romPath)))
    const simulator = createFieldInputSimulator(inventory.resolvedMapCatalog.maps, createJourneyFieldState(inventory, 'BOT'), {
      mapId: inventory.resolvedMapCatalog.startMapId,
      tileX: 6,
      tileZ: 6,
      direction: 'south',
    }, {
      blackoutDestinationResolver: inventory.blackoutDestinationResolver,
      blackoutSpawnForMapResolver: inventory.blackoutSpawnForMapResolver,
    })
    const agent = createOpeningJourneyAgent(inventory.resolvedMapCatalog.maps)
    for (let steps = 0; steps < 300; steps += 1) {
      const currentWorld = simulator.getWorld().getState()
      const state = simulator.getFieldState()
      if (state.phoneContacts.has(1) && state.flags.has(0x9c) && currentWorld?.map.id === 60 && !simulator.hasActiveScript()) {
        expect(state.flags.has(0x6a)).toBe(true)
        expect(state.flags.has(0x160)).toBe(false)
        expect(state.party.members).toMatchObject([{ speciesId: 155, level: 5 }])
        expect([...state.phoneContacts]).toContain(1)
        expect(simulator.getHistory().some((event) => event.kind === 'battle')).toBe(false)
        expect(simulator.getHistory().some((event) => event.kind === 'moved' && event.mapId === 33)).toBe(false)
        expect(agent.nextInput({ mapId: 60, tileX: currentWorld.tileX, tileZ: currentWorld.tileZ, direction: currentWorld.direction, groundHeight: currentWorld.groundHeight }, state)).toBeUndefined()
        expect(agent.getCheckpoint()).toEqual({ id: 'pre-wild-complete', label: 'Parcours avant combats sauvages terminé' })
        return
      }
      if (simulator.hasActiveScript()) {
        const choiceIndex = simulator.getChoiceIndex()
        if (choiceIndex !== undefined) {
          const target = agent.getChoiceIndex(simulator.getFieldState())
          let index = choiceIndex
          for (let attempts = 0; index !== target && attempts < 8; attempts += 1) {
            simulator.input('down')
            index = simulator.getChoiceIndex()!
          }
          if (index !== target) throw new Error(`Le choix autonome ${target} est inaccessible depuis ${choiceIndex}.`)
          simulator.input('confirm')
        } else if (simulator.isWaitingForInput()) simulator.input('confirm')
        else simulator.settle()
        continue
      }
      const world = simulator.getWorld().getState()
      expect(world).toBeDefined()
      if (!world) return
      if (liveJourney) console.log(`[agent ${steps}] ${agent.getCheckpoint().id} @ ${world.map.id}:${world.tileX},${world.tileZ}`)
      const input = agent.nextInput({ mapId: world.map.id, tileX: world.tileX, tileZ: world.tileZ, direction: world.direction, groundHeight: world.groundHeight }, simulator.getFieldState())
      if (!input) throw new Error(`Le bot visible n'a plus d'entrée à ${world.map.id}:${world.tileX},${world.tileZ}.`)
      simulator.input(input)
    }
    throw new Error(`Le bot visible dépasse sa limite: ${JSON.stringify(simulator.getHistory().slice(-32))}`)
  }, 180000)

  journey('replays player inputs from a new game through the requested Johto badge', async () => {
    if (requestedJourneyTarget !== 'fog-badge' && requestedJourneyTarget !== 'plain-badge' && requestedJourneyTarget !== 'hive-badge' && requestedJourneyTarget !== ZEPHYR_BADGE_TARGET.id && requestedJourneyTarget !== TOGEPI_EGG_TARGET.id) {
      throw new Error(`Le jalon headless demandé est inconnu: ${requestedJourneyTarget}.`)
    }
    const romBuffer = await readFile(romPath)
    const inventory = await readRomInventory(new File([romBuffer], basename(romPath)))
    const fieldState = createJourneyFieldState(inventory, 'SIM')
    const simulator = createFieldInputSimulator(inventory.resolvedMapCatalog.maps, fieldState, {
      mapId: inventory.resolvedMapCatalog.startMapId,
      tileX: 6,
      tileZ: 6,
      direction: 'south',
    }, {
      blackoutDestinationResolver: inventory.blackoutDestinationResolver,
      blackoutSpawnForMapResolver: inventory.blackoutSpawnForMapResolver,
    })
    const audit = createPlayerJourneyAudit(simulator, () => validateVisibleRomAssets(inventory, simulator))
    validateVisibleRomAssets(inventory, simulator)

    audit.checkpoint('leave-bedroom', 'Quitter la chambre')
    replayToWarp(audit, simulator, inventory.resolvedMapCatalog.maps, 63)
    expect(simulator.getWorld().getState()?.map.id).toBe(63)
    settleMapScript(audit, simulator)
    audit.checkpoint('leave-home', 'Quitter la maison')
    replayToWarp(audit, simulator, inventory.resolvedMapCatalog.maps, 60)
    expect(simulator.getWorld().getState()?.map.id).toBe(60)
    settleMapScript(audit, simulator)
    audit.checkpoint('meet-elm', 'Atteindre le laboratoire du Professeur Orme')
    const labRouteHistoryStart = simulator.getHistory().length
    replayToWarp(audit, simulator, inventory.resolvedMapCatalog.maps, 61)
    expect(simulator.getWorld().getState()?.map.id).toBe(61)
    const labRouteEvents = simulator.getHistory().slice(labRouteHistoryStart)
    expect(labRouteEvents.some((event) => event.kind === 'moved' && event.mapId === 61)).toBe(true)
    expect(labRouteEvents.some((event) => event.kind === 'blocked'
      && event.reason === 'terrain'
      && event.tileX === 12
      && event.tileZ === 9)).toBe(false)
    replayInputs(audit, simulator, ['up', 'up', 'up', 'up'])
    settleMapScript(audit, simulator)
    const starterBall = simulator.getWorld().getState()?.map.events?.backgrounds.find((background) => background.x === 8 && background.z === 4)
    expect(starterBall).toBeDefined()
    if (!starterBall) return
    audit.checkpoint('choose-starter', 'Choisir le Pokémon de départ')
    const starterInputs = findInputsToBackground(inventory.resolvedMapCatalog.maps, getInputState(simulator), starterBall.scriptId, simulator.getFieldState())
    replayInputs(audit, simulator, starterInputs.slice(0, -1))
    sendJourneyInput(audit, simulator, starterInputs.at(-1)!)
    advanceToChoice(audit, simulator)
    const starterChoice = requestedJourneyTarget === 'plain-badge' || requestedJourneyTarget === 'fog-badge' ? 2 : 1
    for (let choice = 0; choice < starterChoice; choice += 1) sendJourneyInput(audit, simulator, 'down')
    sendJourneyInput(audit, simulator, 'confirm')
    const starterSpeciesId = [152, 155, 158][starterChoice]!
    expect(simulator.getFieldState().party.members).toMatchObject([{ speciesId: starterSpeciesId, level: 5 }])
    finishScriptWithSecondChoice(audit, simulator)
    expect(simulator.getFieldState().starterChoice).toBe(starterChoice)
    audit.checkpoint('visit-mr-pokemon', 'Atteindre la maison de M. Pokémon')
    replayToWarp(audit, simulator, inventory.resolvedMapCatalog.maps, 60)
    expect(simulator.getWorld().getState()?.map.id).toBe(60)
    settleMapScript(audit, simulator)
    replayToWarp(audit, simulator, inventory.resolvedMapCatalog.maps, 63)
    expect(simulator.getWorld().getState()?.map.id).toBe(63)
    settleMapScript(audit, simulator)
    const momInputs = findInputsToNpc(inventory.resolvedMapCatalog.maps, getInputState(simulator), 0, simulator.getFieldState())
    replayInputs(audit, simulator, momInputs.slice(0, -1))
    sendJourneyInput(audit, simulator, momInputs.at(-1)!)
    finishScriptWithDefaultChoices(audit, simulator)
    expect(simulator.getFieldState().flags.has(0x9c)).toBe(true)
    replayToWarp(audit, simulator, inventory.resolvedMapCatalog.maps, 60)
    expect(simulator.getWorld().getState()?.map.id).toBe(60)
    settleMapScript(audit, simulator)
    replayToAdjacentMap(audit, simulator, inventory.resolvedMapCatalog.maps, 33)
    expect(simulator.getWorld().getState()?.map.id).toBe(33)
    replayToAdjacentMap(audit, simulator, inventory.resolvedMapCatalog.maps, 67)
    expect(simulator.getWorld().getState()?.map.id).toBe(67)
    replayToAdjacentMap(audit, simulator, inventory.resolvedMapCatalog.maps, 34)
    expect(simulator.getWorld().getState()?.map.id).toBe(34)
    expect(simulator.getFieldState().runningShoes).toBe(true)
    replayToWarp(audit, simulator, inventory.resolvedMapCatalog.maps, 143)
    expect(simulator.getWorld().getState()?.map.id).toBe(143)
    settleMapScript(audit, simulator)
    const mysteryEgg = inventory.itemCatalog.items.find((item) => /uf myst/i.test(item.name))
    expect(mysteryEgg).toBeDefined()
    expect(simulator.getFieldState().inventory.get(mysteryEgg!.itemId)).toBe(1)
    audit.checkpoint('return-to-elm', 'Ramener l’Œuf à Orme')
    replayToWarp(audit, simulator, inventory.resolvedMapCatalog.maps, 34)
    expect(simulator.getWorld().getState()?.map.id).toBe(34)
    replayToAdjacentMap(audit, simulator, inventory.resolvedMapCatalog.maps, 67)
    expect(simulator.getWorld().getState()?.map.id).toBe(67)
    audit.checkpoint('first-battle', 'Déclencher le premier combat contre le rival')
    const battleStep = replayTowardAdjacentMapUntilBattle(audit, simulator, inventory.resolvedMapCatalog.maps, 33)
    expect(simulator.getWorld().getState()?.map.id).toBe(67)
    const rivalTrainerId = [496, 497, 495][starterChoice]!
    const rivalSpeciesId = [155, 158, 152][starterChoice]!
    expect(battleStep).toEqual({
      kind: 'battle',
      battle: { kind: 'trainer', trainerId: rivalTrainerId, trainerParameter: 0, encounterType: 1, battleParameter: 0 },
    })
    const rival = inventory.trainerCatalog[rivalTrainerId]!
    expect(rival).toMatchObject({
      trainerId: rivalTrainerId,
      partySize: 1,
      party: [{ speciesId: rivalSpeciesId, level: 5 }],
    })
    if (battleStep.kind !== 'battle' || battleStep.battle.kind !== 'trainer') throw new Error('Le combat rival ROM attendu est absent.')
    const battleFieldState = simulator.getFieldState()
    const pokemonRuntime = battleFieldState.pokemonRuntime
    if (!pokemonRuntime) throw new Error('Le runtime Pokemon du parcours ROM est absent.')
    const prepared = prepareFieldBattle(battleStep.battle, inventory.trainerCatalog, inventory.pokemonCatalog, {
      playerParty: battleFieldState.party,
      origin: { language: pokemonRuntime.language, gameVersion: pokemonRuntime.gameVersion },
    })
    expect(prepared).toMatchObject({
      kind: 'trainer',
      createdParty: [{
        pokemon: {
          speciesId: rivalSpeciesId,
          level: 5,
          individualValues: {
            hp: Math.floor(rival.party[0]!.difficulty * 31 / 255),
            attack: Math.floor(rival.party[0]!.difficulty * 31 / 255),
          },
          shiny: false,
        },
      }],
    })
    if (prepared.kind !== 'trainer') throw new Error('La preparation du rival ROM attendue est absente.')
    const initialBattle = createInitialTrainerBattleState(prepared)
    expect(initialBattle).toMatchObject({
      phase: 'setup',
      format: 'single',
      turn: 0,
      player: { openingSlots: [0], party: { members: [{ speciesId: starterSpeciesId }] } },
      opponent: { openingSlots: [0], party: { members: [{ speciesId: rivalSpeciesId }] } },
    })
    const introduction = createTrainerBattleIntroduction(initialBattle)
    while (advanceTrainerBattleIntroduction(introduction)) continue
    expect(introduction).toMatchObject({
      phase: 'ready',
      activeSlots: { player: [0], opponent: [0] },
      battle: { turn: 0 },
    })

    audit.checkpoint('resolve-first-rival', 'Terminer le combat et reprendre la scène du rival')
    audit.run(() => audit.battleResult(true))
    settleMapScript(audit, simulator)
    expect(simulator.isWaitingForBattle()).toBe(false)
    expect(simulator.hasActiveScript()).toBe(false)

    audit.checkpoint('return-egg-to-elm', 'Retourner au laboratoire avec l’Œuf Mystère')
    replayToAdjacentMap(audit, simulator, inventory.resolvedMapCatalog.maps, 33)
    replayToAdjacentMap(audit, simulator, inventory.resolvedMapCatalog.maps, 60)
    replayToWarp(audit, simulator, inventory.resolvedMapCatalog.maps, 61)
    settleMapScript(audit, simulator)
    expect(simulator.getWorld().getState()?.map.id).toBe(61)
    expect(simulator.getFieldState().inventory.get(mysteryEgg!.itemId) ?? 0).toBe(0)

    const zephyrPlanner = createJohtoJourneyPlanner(inventory.resolvedMapCatalog.maps, ZEPHYR_BADGE_TARGET)
    audit.checkpoint(ZEPHYR_BADGE_TARGET.id, ZEPHYR_BADGE_TARGET.label)
    expect(getInputState(simulator).mapId).toBe(ZEPHYR_BADGE_TARGET.routeStartMapId)
    replayToJourneyTarget(audit, simulator, zephyrPlanner)
    settleMapScript(audit, simulator)
    expect(simulator.getWorld().getState()?.map.id).toBe(ZEPHYR_BADGE_TARGET.destinationMapId)
    expect(zephyrPlanner.getMilestone(simulator.getFieldState())).toEqual({
      id: ZEPHYR_BADGE_TARGET.id,
      label: ZEPHYR_BADGE_TARGET.label,
      reached: true,
    })
    expect(isJohtoJourneyTargetReached(simulator.getFieldState(), ZEPHYR_BADGE_TARGET)).toBe(true)
    expect(simulator.getFieldState().badges.has(ZEPHYR_BADGE_TARGET.badgeIndex)).toBe(true)
    expect(simulator.hasWonTrainerBattle(ZEPHYR_BADGE_TARGET.trainerId)).toBe(true)
    expect(simulator.getHistory()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'battle',
        battle: expect.objectContaining({ kind: 'trainer', trainerId: ZEPHYR_BADGE_TARGET.trainerId }),
      }),
    ]))
    if (requestedJourneyTarget === ZEPHYR_BADGE_TARGET.id) {
      await writePlayerJourneyReport(simulator, ZEPHYR_BADGE_TARGET.id)
      return
    }

    audit.checkpoint('receive-togepi-egg', 'Répondre à Orme et récupérer l’Œuf de Togepi à la Boutique de Mauville')
    replayToWarp(audit, simulator, inventory.resolvedMapCatalog.maps, 73, true)
    replayToWarp(audit, simulator, inventory.resolvedMapCatalog.maps, 157, true)
    const violetShop = simulator.getWorld().getState()?.map
    const elmAide = violetShop?.events?.objects.find((object) => object.id === 4 && object.eventFlag === 407)
    expect(elmAide).toBeDefined()
    if (!elmAide) return
    replayInputs(
      audit,
      simulator,
      findInputsToNpc(inventory.resolvedMapCatalog.maps, getInputState(simulator), elmAide.id, simulator.getFieldState()),
    )
    expect(simulator.getFieldState().party.members.some((pokemon) => pokemon.speciesId === 175 && pokemon.isEgg)).toBe(true)
    expect(simulator.getFieldState().flags.has(407)).toBe(true)
    replayToWarp(audit, simulator, inventory.resolvedMapCatalog.maps, 73, true)
    expect(simulator.getFieldState().variables.get(16500)).toBe(4)
    if (requestedJourneyTarget === TOGEPI_EGG_TARGET.id) {
      await writePlayerJourneyReport(simulator, TOGEPI_EGG_TARGET.id)
      return
    }

    audit.checkpoint('reach-azalea', 'Traverser la Route 32, les Caves Jumelles et atteindre Écorcia')
    replayToAdjacentMap(audit, simulator, inventory.resolvedMapCatalog.maps, 36, true)
    replayToWarp(audit, simulator, inventory.resolvedMapCatalog.maps, 99, true)
    replayToWarp(audit, simulator, inventory.resolvedMapCatalog.maps, 37, true)
    replayToAdjacentMap(audit, simulator, inventory.resolvedMapCatalog.maps, 74, true)
    settleMapScript(audit, simulator)
    expect(simulator.getWorld().getState()?.map.id).toBe(74)

    audit.checkpoint('slowpoke-well', 'Faire partir Fargas et libérer le Puits Ramoloss')
    replayToWarp(audit, simulator, inventory.resolvedMapCatalog.maps, 164, true)
    const kurtHouse = simulator.getWorld().getState()?.map
    const kurt = kurtHouse?.events?.objects.find((object) => object.id === 0)
    expect(kurt).toBeDefined()
    if (!kurt) return
    replayToNpcUntil(audit, simulator, inventory.resolvedMapCatalog.maps, kurt.id, () => simulator.getFieldState().flags.has(0x77))
    replayToWarp(audit, simulator, inventory.resolvedMapCatalog.maps, 74, true)
    replayToWarp(audit, simulator, inventory.resolvedMapCatalog.maps, 114, true)
    replayToWarp(audit, simulator, inventory.resolvedMapCatalog.maps, 177, true)
    const slowpokeWell = simulator.getWorld().getState()?.map
    const proton = slowpokeWell?.events?.objects.find((object) => object.id === 4)
    expect(proton).toBeDefined()
    if (!proton) return
    replayToNpcUntil(audit, simulator, inventory.resolvedMapCatalog.maps, proton.id, () => simulator.getFieldState().flags.has(0x7b))
    expect(simulator.getFieldState().flags.has(0x7b)).toBe(true)
    expect(simulator.getFieldState().flags.has(0x1a9)).toBe(true)

    audit.checkpoint('hive-badge', 'Traverser l’Arène d’Écorcia et recevoir le Badge Essaim')
    if (getInputState(simulator).mapId === 164) replayToWarp(audit, simulator, inventory.resolvedMapCatalog.maps, 74, true)
    else {
      replayToWarp(audit, simulator, inventory.resolvedMapCatalog.maps, 114, true)
      replayToWarp(audit, simulator, inventory.resolvedMapCatalog.maps, 74, true)
    }
    replayToWarp(audit, simulator, inventory.resolvedMapCatalog.maps, 136, true)
    replayToWarp(audit, simulator, inventory.resolvedMapCatalog.maps, 180, true)
    const azaleaGym = simulator.getWorld().getState()?.map
    const bugsy = azaleaGym?.events?.objects.find((object) => object.spriteId === 353 && object.scriptId === 2)
    expect(bugsy).toBeDefined()
    if (!bugsy) return
    replayToNpcThroughMechanisms(audit, simulator, inventory.resolvedMapCatalog.maps, bugsy.id, () => simulator.getFieldState().badges.has(1))
    expect(simulator.getFieldState().badges.has(1)).toBe(true)
    if (requestedJourneyTarget === 'hive-badge') {
      await writePlayerJourneyReport(simulator, 'hive-badge')
      return
    }

    audit.checkpoint('ilex-farfetchd', 'Rassembler les deux Canarticho dans le Bois aux Chênes')
    replayToWarpThroughMechanisms(audit, simulator, inventory.resolvedMapCatalog.maps, 136)
    replayToWarp(audit, simulator, inventory.resolvedMapCatalog.maps, 74, true)
    replayToWarp(audit, simulator, inventory.resolvedMapCatalog.maps, 100, true)
    replayToWarp(audit, simulator, inventory.resolvedMapCatalog.maps, 117, true)
    settleMapScript(audit, simulator)
    expect(simulator.getWorld().getState()?.map.id).toBe(117)

    replayToTile(audit, simulator, inventory.resolvedMapCatalog.maps, 25, 66)
    expect(simulator.getFieldState().variables.get(0x4002)).toBe(1)
    replayToTile(audit, simulator, inventory.resolvedMapCatalog.maps, 25, 61)
    replayInputs(audit, simulator, ['down', 'confirm'], true, true)
    settleMapScript(audit, simulator)
    expect(simulator.getFieldState().flags.has(0x7d)).toBe(true)
    expect(simulator.getFieldState().flags.has(0x1a7)).toBe(true)

    replayToTile(audit, simulator, inventory.resolvedMapCatalog.maps, 41, 55)
    replayInputs(audit, simulator, ['up', 'confirm'], true, true)
    settleMapScript(audit, simulator)
    expect(simulator.getFieldState().objects.get(2)).toMatchObject({ x: 49, z: 54, direction: 'west' })
    replayToTile(audit, simulator, inventory.resolvedMapCatalog.maps, 52, 53)
    expect(simulator.getFieldState().variables.get(0x4003)).toBe(1)
    replayToTile(audit, simulator, inventory.resolvedMapCatalog.maps, 48, 54, new Set([7]))
    expect(simulator.getFieldState().objects.get(2)).toMatchObject({ x: 49, z: 54, direction: 'east' })
    replayInputs(audit, simulator, ['right', 'confirm'], true, true)
    settleMapScript(audit, simulator)
    expect(simulator.getFieldState().flags.has(0x7e)).toBe(true)
    expect(simulator.getFieldState().flags.has(0x1a8)).toBe(true)
    expect(simulator.getFieldState().flags.has(0x80)).toBe(true)
    expect(simulator.getFieldState().inventory.get(420)).toBe(1)

    audit.checkpoint('learn-cut', 'Apprendre Coupe depuis la CS01 reçue dans le Bois aux Chênes')
    const pokemonRuntimeAfterHm = simulator.getFieldState().pokemonRuntime
    if (!pokemonRuntimeAfterHm) throw new Error('Le runtime Pokémon est absent au moment d’apprendre Coupe.')
    const cutLearner = simulator.getFieldState().party.members.find((pokemon) => (
      inspectPokemonMachineCompatibility(pokemon, 420, pokemonRuntimeAfterHm.catalog).kind === 'compatible'
    ))
    expect(cutLearner).toBeDefined()
    if (!cutLearner) throw new Error('Aucun Pokémon de l’équipe ne peut apprendre Coupe.')
    let cutResult = usePokemonMachine(
      simulator.getFieldState().inventory,
      420,
      cutLearner,
      pokemonRuntimeAfterHm.catalog,
    )
    if (cutResult.kind === 'replacement-required') {
      cutResult = usePokemonMachine(
        simulator.getFieldState().inventory,
        420,
        cutLearner,
        pokemonRuntimeAfterHm.catalog,
        0,
      )
    }
    expect(cutResult).toMatchObject({ kind: 'learned', machine: { itemId: 420, moveId: 15, kind: 'CS' } })
    expect(cutLearner.moves.some((move) => move.moveId === 15)).toBe(true)
    expect(simulator.getFieldState().inventory.get(420)).toBe(1)

    audit.checkpoint('use-cut', 'Couper l’arbre qui bloque la sortie nord du Bois aux Chênes')
    const ilex = simulator.getWorld().getState()?.map
    const cutTree = ilex?.events?.objects.find((object) => object.spriteId === 86 && object.scriptId === 10000)
    expect(cutTree).toBeDefined()
    if (!cutTree) throw new Error("L’arbre Coupe du Bois aux Chênes est absent de la ROM.")
    replayToNpcUntil(
      audit,
      simulator,
      inventory.resolvedMapCatalog.maps,
      cutTree.id,
      () => simulator.getFieldState().flags.has(cutTree.eventFlag) || simulator.getFieldState().hiddenObjectIds.has(cutTree.id),
    )
    expect(simulator.getFieldState().hiddenObjectIds.has(cutTree.id)).toBe(true)

    audit.checkpoint('plain-badge', 'Atteindre Doublonville et vaincre Blanche')
    replayToWarp(audit, simulator, inventory.resolvedMapCatalog.maps, 171, true)
    replayToWarp(audit, simulator, inventory.resolvedMapCatalog.maps, 38, true)
    // La première traversée de la Route 34 déclenche, sur cette bande de
    // coordonnées, la visite guidée native de la Pension (carte 331).
    for (let replans = 0; replans < 32 && getInputState(simulator).mapId === 38; replans += 1) {
      const inputs = findInputsToTile(
        inventory.resolvedMapCatalog.maps,
        getInputState(simulator),
        { tileX: 17, tileZ: 29 },
        simulator.getFieldState(),
      )
      replayInputs(audit, simulator, inputs, true, true)
    }
    expect(getInputState(simulator).mapId).toBe(331)
    replayToWarp(audit, simulator, inventory.resolvedMapCatalog.maps, 38, true)
    replayToAdjacentMap(audit, simulator, inventory.resolvedMapCatalog.maps, 76, true)

    audit.checkpoint('radio-card-quiz', 'Réussir le quiz de la Tour Radio et libérer l’accès à l’Arène')
    replayToWarp(audit, simulator, inventory.resolvedMapCatalog.maps, 112, true)
    const radioTower = simulator.getWorld().getState()?.map
    const quizReceptionist = radioTower?.events?.objects.find((object) => object.id === 2 && object.scriptId === 3)
    expect(quizReceptionist).toBeDefined()
    if (!quizReceptionist) throw new Error('La réceptionniste du quiz Radio est absente de la ROM.')
    const quizInputs = findInputsToNpc(
      inventory.resolvedMapCatalog.maps,
      getInputState(simulator),
      quizReceptionist.id,
      simulator.getFieldState(),
    )
    replayInputs(audit, simulator, quizInputs.slice(0, -1), true, true)
    sendJourneyInput(audit, simulator, quizInputs.at(-1)!)
    finishScriptWithChoices(audit, simulator, [0, 0, 0, 1, 0, 1])
    expect(simulator.getFieldState().flags.has(792)).toBe(true)
    replayToWarp(audit, simulator, inventory.resolvedMapCatalog.maps, 76, true)

    replayToWarp(audit, simulator, inventory.resolvedMapCatalog.maps, 137, true)
    const goldenrodGym = simulator.getWorld().getState()?.map
    const whitney = goldenrodGym?.events?.objects.find((object) => object.spriteId === 354 && object.scriptId === 1)
    expect(whitney).toBeDefined()
    if (!whitney) throw new Error("Blanche est absente de l’Arène de Doublonville.")
    replayToNpcUntil(audit, simulator, inventory.resolvedMapCatalog.maps, whitney.id, () => simulator.hasWonTrainerBattle(30))
    expect(simulator.hasWonTrainerBattle(30)).toBe(true)
    // Après sa défaite, Blanche pleure. La coordonnée ROM placée sur le
    // chemin de sortie fait expliquer la scène par une Dresseuse, ce qui
    // autorise ensuite la remise du badge lors d'un second dialogue.
    for (let replans = 0; replans < 8 && !simulator.getFieldState().flags.has(0xb7); replans += 1) {
      const inputs = findInputsToTile(
        inventory.resolvedMapCatalog.maps,
        getInputState(simulator),
        { tileX: 13, tileZ: 11 },
        simulator.getFieldState(),
      )
      replayInputs(audit, simulator, inputs, true, true)
    }
    settleMapScript(audit, simulator)
    expect(simulator.getFieldState().flags.has(0xb7)).toBe(true)
    replayToNpcUntil(audit, simulator, inventory.resolvedMapCatalog.maps, whitney.id, () => simulator.getFieldState().badges.has(2))
    expect(simulator.getFieldState().badges.has(2)).toBe(true)
    if (requestedJourneyTarget === 'plain-badge') {
      await writePlayerJourneyReport(simulator, 'plain-badge')
      return
    }

    audit.checkpoint('squirtbottle', 'Recevoir le Carapuce à O après le Badge Plaine')
    replayToWarp(audit, simulator, inventory.resolvedMapCatalog.maps, 76, true)
    replayToWarp(audit, simulator, inventory.resolvedMapCatalog.maps, 184, true)
    const flowerShop = simulator.getWorld().getState()?.map
    const florist = flowerShop?.events?.objects.find((object) => object.id === 0 && object.scriptId === 1)
    const squirtBottle = inventory.itemCatalog.items.find((item) => /carapuce.*o/i.test(item.name))
    expect(florist).toBeDefined()
    expect(squirtBottle).toBeDefined()
    if (!florist || !squirtBottle) throw new Error('La fleuriste ou le Carapuce à O est absent de la ROM.')
    replayToNpcUntil(
      audit,
      simulator,
      inventory.resolvedMapCatalog.maps,
      florist.id,
      () => (simulator.getFieldState().inventory.get(squirtBottle.itemId) ?? 0) > 0,
    )

    audit.checkpoint('sudowoodo', 'Arroser et vaincre le Simularbre de la Route 36')
    replayToWarp(audit, simulator, inventory.resolvedMapCatalog.maps, 76, true)
    replayToWarp(audit, simulator, inventory.resolvedMapCatalog.maps, 101, true)
    replayToWarp(audit, simulator, inventory.resolvedMapCatalog.maps, 39, true)
    replayToAdjacentMap(audit, simulator, inventory.resolvedMapCatalog.maps, 40, true)
    const route36 = simulator.getWorld().getState()?.map
    const sudowoodo = route36?.events?.objects.find((object) => object.id === 4 && object.scriptId === 1)
    expect(sudowoodo).toBeDefined()
    if (!sudowoodo) throw new Error('Le Simularbre de la Route 36 est absent de la ROM.')
    replayToNpcUntil(
      audit,
      simulator,
      inventory.resolvedMapCatalog.maps,
      sudowoodo.id,
      () => simulator.getFieldState().flags.has(sudowoodo.eventFlag),
    )
    expect(simulator.getFieldState().flags.has(450)).toBe(true)

    audit.checkpoint('burned-tower', 'Atteindre Rosalia et libérer les fauves de la Tour Cendrée')
    replayToAdjacentMap(audit, simulator, inventory.resolvedMapCatalog.maps, 41, true)
    replayToAdjacentMap(audit, simulator, inventory.resolvedMapCatalog.maps, 78, true)
    replayToWarp(audit, simulator, inventory.resolvedMapCatalog.maps, 7, true)
    const towerHistoryStart = simulator.getHistory().length
    replayToTile(audit, simulator, inventory.resolvedMapCatalog.maps, 19, 23)
    settleMapScript(audit, simulator)
    const burnedTower = simulator.getWorld().getState()?.map
    const towerRival = burnedTower?.events?.objects.find((object) => object.id === 0 && object.spriteId === 148)
    expect(towerRival).toBeDefined()
    if (!towerRival) throw new Error('Le rival de la Tour Cendrée est absent de la ROM.')
    replayToNpcUntil(
      audit,
      simulator,
      inventory.resolvedMapCatalog.maps,
      towerRival.id,
      () => simulator.getFieldState().flags.has(towerRival.eventFlag),
    )
    expect(simulator.getHistory().slice(towerHistoryStart)).toEqual(expect.arrayContaining([
      expect.objectContaining({ battle: expect.objectContaining({ kind: 'trainer' }) }),
    ]))
    replayToWarp(audit, simulator, inventory.resolvedMapCatalog.maps, 217, true)
    replayToTile(audit, simulator, inventory.resolvedMapCatalog.maps, 20, 16)
    settleMapScript(audit, simulator)
    expect([457, 458, 459].every((flagId) => simulator.getFieldState().flags.has(flagId))).toBe(true)
    replayToWarp(audit, simulator, inventory.resolvedMapCatalog.maps, 7, true)
    replayToWarp(audit, simulator, inventory.resolvedMapCatalog.maps, 78, true)

    audit.checkpoint('fog-badge', 'Traverser l’Arène de Rosalia et recevoir le Badge Brume')
    replayToWarp(audit, simulator, inventory.resolvedMapCatalog.maps, 80, true)
    const ecruteakGym = simulator.getWorld().getState()?.map
    const morty = ecruteakGym?.events?.objects.find((object) => object.id === 1 && object.spriteId === 355)
    expect(morty).toBeDefined()
    if (!morty) throw new Error("Mortimer est absent de l’Arène de Rosalia.")
    replayToTile(audit, simulator, inventory.resolvedMapCatalog.maps, 10, 9, new Set([3]))
    replayInputs(audit, simulator, ['up', 'confirm'], true, true)
    settleMapScript(audit, simulator)
    expect(simulator.hasWonTrainerBattle(31)).toBe(true)
    expect(simulator.getFieldState().badges.has(3)).toBe(true)
    await writePlayerJourneyReport(simulator, 'fog-badge')
  }, 180000)
})
