import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { OpeningMapPreview, RomInventory } from '../../ndsTypes'
import { readRomInventory } from '../../nds'
import { createOfflineHgssMultiplayerResult, hgssMultiplayerProtocolVersion, type HgssMultiplayerRequest, type HgssMultiplayerResult } from '../multiplayer/hgssMultiplayerGateway'
import { createCanonicalPokemon, type CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { createHgssMersenneTwister, createHgssSessionRng } from '../pokemon/hgssSessionRng'
import { createHgssOutgoingPhoneSession, formatHgssOutgoingPhoneMessages } from '../pokegear/outgoingPhoneSession'
import {
  createFieldScriptRunner,
  createFieldScriptState,
  formatFieldMessage,
  hasFieldScript,
  setFieldScriptMapState,
  type FieldPokemonRuntime,
  type FieldScriptState,
  type FieldScriptStep,
} from '../scripts/fieldScriptRunner'
import { resolveMapFrameScripts } from '../../rom/scripts/fieldScripts'
import { getHgssRtcTimestampSeconds } from '../time/hgssRtcPenalty'
import { advanceHgssSafariHostStep, finishHgssSafariHostCall } from './hgssSafariHostRuntime'
import { createHgssSafariDecoratorStep, type HgssSafariCustomizerChange } from './hgssSafariFieldCommands'
import { resolveHgssSafariAreaCellAtWorldPosition } from './hgssSafariMap'

const defaultRomPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const romPath = process.env.ROM_AUDIT_PATH ? resolve(process.env.ROM_AUDIT_PATH) : defaultRomPath
const probe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip

let inventoryPromise: Promise<RomInventory> | undefined

function readInventory(): Promise<RomInventory> {
  inventoryPromise ??= readFile(romPath).then((buffer) => readRomInventory(new File([buffer], basename(romPath))))
  return inventoryPromise
}

function createRuntime(inventory: RomInventory, igtMinutes: () => number): FieldPokemonRuntime {
  return {
    catalog: inventory.pokemonCatalog,
    pokedexCatalog: inventory.pokedexCatalog,
    itemCatalog: inventory.itemCatalog,
    rng: createHgssLcrng(0x1357),
    mt: createHgssMersenneTwister(0x2468),
    trainer: { id: 0x12345678, name: 'LUTH', gender: 'male' },
    language: 3,
    gameVersion: 7,
    now: () => new Date(2026, 7, 22, 12),
    igtMinutes,
    safariEncounterCatalog: inventory.safariEncounterCatalog,
    photoDataCatalog: inventory.photoDataCatalog,
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
  }
}

function createPokemon(runtime: FieldPokemonRuntime, speciesId: number, metLocation = 202): CanonicalPokemon {
  return createCanonicalPokemon(runtime.catalog, {
    speciesId,
    level: 15,
    rng: runtime.rng,
    personality: { kind: 'random' },
    individualValues: { kind: 'random' },
    originalTrainer: runtime.trainer,
    origin: {
      language: runtime.language ?? 3,
      gameVersion: runtime.gameVersion ?? 7,
      metLocation,
      eggLocation: 0,
      metLevel: 15,
      metTerrain: 2,
    },
    ballId: 5,
  })
}

function createState(inventory: RomInventory, igtMinutes: () => number, partySpecies: readonly number[] = [155]): FieldScriptState {
  const runtime = createRuntime(inventory, igtMinutes)
  return createFieldScriptState('male', 'LUTH', {
    pokemonRuntime: runtime,
    party: partySpecies.map((speciesId) => createPokemon(runtime, speciesId)),
    starterChoice: 1,
  })
}

function setStage(state: FieldScriptState, stage: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7): void {
  state.variables.set(0x4057, stage)
  state.safariProgression.baobaQuestStage = stage
}

type TraceOptions = {
  actorId?: number
  choices?: number[]
  preferExit?: boolean
  preserveMapState?: boolean
  playerPosition?: { x: number, z: number }
  customizerChange?: (step: Extract<FieldScriptStep, { kind: 'safariCustomizer' }>) => HgssSafariCustomizerChange | undefined
  decoratorSelection?: number | ((step: Extract<FieldScriptStep, { kind: 'safariDecorator' }>) => number | undefined)
  multiplayer?: (request: HgssMultiplayerRequest, state: FieldScriptState) => HgssMultiplayerResult
}

type ScriptTrace = {
  steps: FieldScriptStep[]
  messages: number[]
  multiplayerRequests: HgssMultiplayerRequest[]
}

function traceScript(
  map: OpeningMapPreview,
  scriptId: number,
  state: FieldScriptState,
  options: TraceOptions = {},
): ScriptTrace {
  const actor = options.actorId === undefined ? undefined : map.events?.objects.find(({ id }) => id === options.actorId)
  if (!options.preserveMapState) {
    setFieldScriptMapState(
      state,
      map,
      options.playerPosition?.x ?? actor?.x ?? 79,
      options.playerPosition?.z ?? (actor ? actor.z + 1 : 99),
      'north',
    )
  }
  const runner = createFieldScriptRunner(map, scriptId, state, options.actorId)
  const choices = [...(options.choices ?? [])]
  const choiceVisits = new Map<string, number>()
  const steps: FieldScriptStep[] = []
  const messages: number[] = []
  const multiplayerRequests: HgssMultiplayerRequest[] = []

  for (let count = 0; count < 4096; count++) {
    const step = runner.resume()
    steps.push(step)
    if (step.kind === 'message') {
      messages.push(step.messageId)
      formatFieldMessage(step.text, state)
    } else if (step.kind === 'choice') {
      const planned = choices.shift()
      const signature = step.options.map(({ value }) => value).join('/')
      const visits = choiceVisits.get(signature) ?? 0
      choiceVisits.set(signature, visits + 1)
      const fallback = options.preferExit
        ? step.options.at(-1)!.value
        : visits === 0
          ? step.options[0]!.value
          : step.options.at(-1)!.value
      const selected = planned ?? fallback
      if (!step.options.some(({ value }) => value === selected)) {
        throw new Error(`Le choix ROM ${selected} n'existe pas dans ${signature}.`)
      }
      runner.choose(selected)
    } else if (step.kind === 'number') {
      runner.enterNumber(step.min)
    } else if (step.kind === 'nickname') {
      runner.enterNickname(step.currentName)
    } else if (step.kind === 'battle') {
      runner.submitBattleResult(true)
    } else if (step.kind === 'multiplayer') {
      multiplayerRequests.push(step.request)
      runner.submitMultiplayerResult(options.multiplayer?.(step.request, state) ?? createOfflineHgssMultiplayerResult(step.request))
    } else if (step.kind === 'pcBox') {
      runner.closePcBox()
    } else if (step.kind === 'easyChat') {
      runner.submitEasyChat(undefined)
    } else if (step.kind === 'pokeathlonApp') {
      runner.closePokeathlonApp()
    } else if (step.kind === 'frontierRecordsApp') {
      runner.closeFrontierRecordsApp()
    } else if (step.kind === 'gameClear') {
      runner.closeGameClear()
    } else if (step.kind === 'alphPuzzle') {
      runner.finishAlphPuzzle(true)
    } else if (step.kind === 'alphHiddenRoom') {
      runner.closeAlphHiddenRoom()
    } else if (step.kind === 'eggHatch') {
      runner.finishEggHatch(undefined)
    } else if (step.kind === 'safariCustomizer') {
      const change = options.customizerChange?.(step)
      if (!runner.closeSafariCustomizer) throw new Error("Le contrôleur du customizer Safari HGSS n'est pas exposé.")
      if (change) {
        if (!runner.submitSafariCustomizerChange) throw new Error("Le contrôleur de modification Safari HGSS n'est pas exposé.")
        runner.submitSafariCustomizerChange(change)
      }
      runner.closeSafariCustomizer()
    } else if (step.kind === 'safariDecorator') {
      if (!runner.submitSafariDecoratorSelection) throw new Error("Le contrôleur du décorateur Safari HGSS n'est pas exposé.")
      runner.submitSafariDecoratorSelection(typeof options.decoratorSelection === 'function'
        ? options.decoratorSelection(step)
        : options.decoratorSelection)
    } else if (step.kind === 'photoCapture') {
      if (!runner.finishPhotoCapture) throw new Error("Le contrôleur de capture PhotoAlbum HGSS n'est pas exposé.")
      runner.finishPhotoCapture()
    } else if (step.kind === 'photoAlbum') {
      if (!runner.closePhotoAlbum) throw new Error("Le contrôleur de l'album photo HGSS n'est pas exposé.")
      runner.closePhotoAlbum()
    }
    if (step.kind === 'ended') return { steps, messages, multiplayerRequests }
  }
  throw new Error(`Le script Safari ROM ${map.id}/${scriptId} ne termine pas en 4096 étapes.`)
}

function requireMap(inventory: RomInventory, mapId: number): OpeningMapPreview {
  const map = inventory.resolvedMapCatalog.maps.find(({ id }) => id === mapId)
  if (!map) throw new Error(`La carte ROM ${mapId} est absente.`)
  return map
}

describe('audit ROM des PNJ et quêtes du Parc Safari HGSS', () => {
  probe('conserve la topologie exacte du portail, du parc et du Centre Pokémon puis exécute tous leurs PNJ', async () => {
    const inventory = await readInventory()
    const interior = requireMap(inventory, 173)
    const gate = requireMap(inventory, 174)
    const area14 = requireMap(inventory, 356)
    const safari = requireMap(inventory, 357)
    const pokemonCenter = requireMap(inventory, 534)
    const pokemonCenterBasement = requireMap(inventory, 535)

    expect(interior.header).toMatchObject({ mapId: 173, msgBank: 135, mapSection: 227 })
    expect(interior.matrix.matrixIndex).toBe(227)
    expect(interior.events?.objects.map(({ scriptId }) => scriptId).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 11, 12])
    expect(interior.events?.backgrounds.map(({ scriptId }) => scriptId)).toEqual([6])
    expect(gate.header).toMatchObject({ mapId: 174, msgBank: 133, mapSection: 227 })
    expect(gate.events?.objects.map(({ scriptId }) => scriptId).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 16, 17])
    expect(area14.matrix.matrixIndex).toBe(210)
    expect(area14.events?.objects ?? []).toEqual([])
    expect(safari.matrix).toMatchObject({ matrixIndex: 212, width: 5, height: 4 })
    expect(safari.header.mapSection).toBe(202)
    expect(safari.events?.warps).toHaveLength(2)
    expect(Array.from({ length: 12 }, (_, index) => hasFieldScript(interior, index + 1))).toEqual(Array(12).fill(true))
    expect(Array.from({ length: 17 }, (_, index) => hasFieldScript(gate, index + 1))).toEqual(Array(17).fill(true))
    expect(hasFieldScript(area14, 1)).toBe(true)
    expect(hasFieldScript(safari, 1)).toBe(true)
    expect(Array.from({ length: 7 }, (_, index) => hasFieldScript(safari, 8800 + index))).toEqual(Array(7).fill(true))
    expect(pokemonCenter.header.msgBank).toBe(134)
    expect(Array.from({ length: 3 }, (_, index) => hasFieldScript(pokemonCenter, index + 1))).toEqual(Array(3).fill(true))
    expect(pokemonCenter.events?.objects.map(({ scriptId }) => scriptId).sort((a, b) => a - b)).toEqual([1, 2, 3, 9001, 9003, 9017])
    expect(pokemonCenterBasement.header.msgBank).toBe(3)
    expect(hasFieldScript(pokemonCenterBasement, 1)).toBe(true)
    expect(pokemonCenterBasement.events?.objects.map(({ scriptId }) => scriptId).sort((a, b) => a - b)).toEqual([9201, 9202, 9203])

    for (const map of [interior, gate]) {
      const targets = [
        ...(map.events?.objects ?? []).map(({ scriptId, id }) => ({ scriptId, actorId: id })),
        ...(map.events?.backgrounds ?? []).map(({ scriptId }) => ({ scriptId, actorId: undefined })),
      ]
      for (const target of targets) {
        const state = createState(inventory, () => 500)
        setStage(state, 6)
        state.pokedex.nationalDexEnabled = true
        state.flags.add(0x183)
        state.safariZone.linkLeader = {
          linked: true,
          receivedTimestampSeconds: getHgssRtcTimestampSeconds(new Date(2026, 7, 22, 12)),
          rtcOffsetMinutes: 0,
          gender: 'male', language: 3, gameVersion: 7, trainerId: 77, name: 'AMI',
        }
        const trace = traceScript(map, target.scriptId, state, { actorId: target.actorId, preferExit: map.id === 174 })
        expect(trace.steps.at(-1), `${map.id}/${target.scriptId}`).toEqual({ kind: 'ended' })
      }
    }

    for (const scriptId of [8800, 8801, 8802, 8803, 8804, 8805, 8806]) {
      const state = createState(inventory, () => 500)
      state.safariZone.session = { active: true, balls: scriptId === 8803 ? 0 : 10 }
      state.safariZone.activeAreaSet = 0
      const trace = traceScript(safari, scriptId, state, { preferExit: true, playerPosition: { x: 48, z: 48 } })
      expect(trace.steps.at(-1), `357/${scriptId}`).toEqual({ kind: 'ended' })
    }

    for (const map of [area14, safari]) {
      expect(traceScript(map, 1, createState(inventory, () => 500)).steps.at(-1)).toEqual({ kind: 'ended' })
    }
    expect(traceScript(gate, 15, createState(inventory, () => 500)).steps.at(-1)).toEqual({ kind: 'ended' })
    for (const map of [pokemonCenter, pokemonCenterBasement]) {
      for (const { id, scriptId } of map.events?.objects ?? []) {
        const state = createState(inventory, () => 500)
        const trace = traceScript(map, scriptId, state, { actorId: id, preferExit: true })
        expect(trace.steps.at(-1), `${map.id}/${scriptId}`).toEqual({ kind: 'ended' })
      }
    }
  }, 180000)

  probe('reproduit toutes les issues du guichet à 500 ₽ et remet exactement 30 Safari Balls', async () => {
    const inventory = await readInventory()
    const map = requireMap(inventory, 173)
    const attendant = map.events?.objects.find(({ scriptId }) => scriptId === 2)
    if (!attendant) throw new Error('Le guichet principal Safari ROM est absent.')

    const declined = createState(inventory, () => 0)
    setStage(declined, 2)
    const declineTrace = traceScript(map, 2, declined, { actorId: attendant.id, choices: [1] })
    expect(declineTrace.messages).toEqual([0, 3])
    expect(declined.money).toBe(3000)
    expect(declined.safariZone.session.active).toBe(false)

    for (const [stage, messageId] of [[2, 10], [6, 11]] as const) {
      const poor = createState(inventory, () => 0)
      setStage(poor, stage)
      poor.money = 499
      const trace = traceScript(map, 2, poor, { actorId: attendant.id, choices: [0] })
      expect(trace.messages.at(-1)).toBe(messageId)
      expect(poor.money).toBe(499)
      expect(poor.safariZone.session.active).toBe(false)
    }

    for (const [stage, messageId] of [[2, 12], [6, 13]] as const) {
      const full = createState(inventory, () => 0, [155, 152, 158, 1, 4, 7])
      setStage(full, stage)
      const pokemon = full.party.members[0]!
      for (const box of full.pokemonStorage.boxes) box.fill(pokemon)
      const trace = traceScript(map, 2, full, { actorId: attendant.id, choices: [0] })
      expect(trace.messages.at(-1)).toBe(messageId)
      expect(full.money).toBe(3000)
      expect(full.safariZone.session.active).toBe(false)
    }

    const locked = createState(inventory, () => 0)
    setStage(locked, 7)
    const lockedTrace = traceScript(map, 2, locked, { actorId: attendant.id })
    expect(lockedTrace.messages).toEqual([18])
    expect(locked.safariZone.session.active).toBe(false)

    const beforeCustomizer = createState(inventory, () => 0)
    setStage(beforeCustomizer, 0)
    const beforeCustomizerTrace = traceScript(map, 6, beforeCustomizer)
    expect(beforeCustomizerTrace.messages).toEqual([28])
    expect(beforeCustomizerTrace.steps.some(({ kind }) => kind === 'safariCustomizer')).toBe(false)

    const admitted = createState(inventory, () => 0)
    setStage(admitted, 6)
    const admittedTrace = traceScript(map, 2, admitted, { actorId: attendant.id, choices: [0] })
    expect(admittedTrace.messages).toEqual([1, 2, 4, 5, 6])
    expect(admitted.money).toBe(2500)
    expect(admitted.variables.get(0x40e3)).toBe(1)
    expect(admitted.dynamicWarp).toEqual({ mapId: 173, warpId: 1, x: 5, z: 2, direction: 1 })
    expect(admitted.safariZone).toMatchObject({ activeAreaSet: 0, session: { active: true, balls: 30 } })
    expect(admittedTrace.steps).toContainEqual(expect.objectContaining({ kind: 'warp', mapId: 357, x: 79, z: 100 }))

    for (const partySpecies of [[155, 152, 158, 1, 4], [155, 152, 158, 1, 4, 7]] as const) {
      const availableSlot = createState(inventory, () => 0, partySpecies)
      setStage(availableSlot, 6)
      const pokemon = availableSlot.party.members[0]!
      for (const box of availableSlot.pokemonStorage.boxes) box.fill(pokemon)
      if (partySpecies.length === 6) availableSlot.pokemonStorage.boxes.at(-1)![29] = undefined
      traceScript(map, 2, availableSlot, { actorId: attendant.id, choices: [0] })
      expect(availableSlot.safariZone.session.active).toBe(true)
    }

    const linkedNpc = map.events?.objects.find(({ scriptId }) => scriptId === 5)
    if (!linkedNpc) throw new Error('Le second guichet Safari ROM est absent.')
    const enableLinkedEntry = (state: FieldScriptState): void => {
      state.pokedex.nationalDexEnabled = true
      state.safariZone.linkLeader = {
        linked: true,
        receivedTimestampSeconds: getHgssRtcTimestampSeconds(new Date(2026, 7, 22, 12)),
        rtcOffsetMinutes: 0,
        gender: 'male', language: 3, gameVersion: 7, trainerId: 77, name: 'AMI',
      }
    }
    const noNationalDex = createState(inventory, () => 0)
    setStage(noNationalDex, 6)
    expect(traceScript(map, 5, noNationalDex, { actorId: linkedNpc.id }).messages).toEqual([84])

    const noLeader = createState(inventory, () => 0)
    setStage(noLeader, 6)
    noLeader.pokedex.nationalDexEnabled = true
    expect(traceScript(map, 5, noLeader, { actorId: linkedNpc.id }).messages).toEqual([60])

    const linked = createState(inventory, () => 0)
    setStage(linked, 6)
    enableLinkedEntry(linked)
    const linkedTrace = traceScript(map, 5, linked, { actorId: linkedNpc.id, choices: [0] })
    expect(linkedTrace.messages).toEqual([54, 55, 57, 58, 59])
    expect(linked.money).toBe(2500)
    expect(linked.variables.get(0x40e3)).toBe(3)
    expect(linked.dynamicWarp).toEqual({ mapId: 173, warpId: 2, x: 19, z: 2, direction: 1 })
    expect(linked.safariZone).toMatchObject({ activeAreaSet: 1, session: { active: true, balls: 30 } })

    const linkedDecline = createState(inventory, () => 0)
    setStage(linkedDecline, 6)
    enableLinkedEntry(linkedDecline)
    expect(traceScript(map, 5, linkedDecline, { actorId: linkedNpc.id, choices: [1] }).messages).toEqual([54, 3])
    expect(linkedDecline.money).toBe(3000)
    expect(linkedDecline.safariZone.session.active).toBe(false)

    for (const [stage, poorMessage, fullMessage] of [[2, 10, 12], [6, 11, 13]] as const) {
      const poor = createState(inventory, () => 0)
      setStage(poor, stage)
      enableLinkedEntry(poor)
      poor.money = 499
      expect(traceScript(map, 5, poor, { actorId: linkedNpc.id, choices: [0] }).messages.at(-1)).toBe(poorMessage)
      expect(poor.money).toBe(499)

      const full = createState(inventory, () => 0, [155, 152, 158, 1, 4, 7])
      setStage(full, stage)
      enableLinkedEntry(full)
      for (const box of full.pokemonStorage.boxes) box.fill(full.party.members[0]!)
      expect(traceScript(map, 5, full, { actorId: linkedNpc.id, choices: [0] }).messages.at(-1)).toBe(fullMessage)
      expect(full.money).toBe(3000)
    }

    for (const partySpecies of [[155, 152, 158, 1, 4], [155, 152, 158, 1, 4, 7]] as const) {
      const availableSlot = createState(inventory, () => 0, partySpecies)
      setStage(availableSlot, 6)
      enableLinkedEntry(availableSlot)
      for (const box of availableSlot.pokemonStorage.boxes) box.fill(availableSlot.party.members[0]!)
      if (partySpecies.length === 6) availableSlot.pokemonStorage.boxes.at(-1)![29] = undefined
      traceScript(map, 5, availableSlot, { actorId: linkedNpc.id, choices: [0] })
      expect(availableSlot.safariZone.session.active).toBe(true)
    }

    const linkedLocked = createState(inventory, () => 0)
    setStage(linkedLocked, 7)
    enableLinkedEntry(linkedLocked)
    expect(traceScript(map, 5, linkedLocked, { actorId: linkedNpc.id }).messages).toEqual([18])
    linkedLocked.flags.add(0x183)
    expect(traceScript(map, 5, linkedLocked, { actorId: linkedNpc.id, choices: [1] }).messages).toEqual([54, 3])
  }, 180000)

  probe('respecte toutes les sorties forcées, le refus de retraite et le retour par le portail', async () => {
    const inventory = await readInventory()
    const safari = requireMap(inventory, 357)
    const interior = requireMap(inventory, 173)

    for (const [scriptId, messageId] of [[8802, 0], [8803, 1], [8804, 2], [8805, undefined]] as const) {
      const state = createState(inventory, () => 0)
      state.safariZone.session = { active: true, balls: scriptId === 8803 ? 0 : 10 }
      const trace = traceScript(safari, scriptId, state, { playerPosition: { x: 48, z: 48 } })
      expect(trace.messages).toEqual(messageId === undefined ? [] : [messageId])
      expect(state.safariZone.session.active).toBe(false)
      expect(state.variables.get(0x40e3)).toBe(2)
      if (scriptId !== 8805) {
        expect(trace.steps).toContainEqual(expect.objectContaining({ kind: 'warp', mapId: 173, x: 5, z: 2 }))
      }
    }

    const linkedExit = createState(inventory, () => 0)
    linkedExit.safariZone.activeAreaSet = 1
    linkedExit.safariZone.session = { active: true, balls: 0 }
    linkedExit.variables.set(0x40e3, 3)
    const linkedExitTrace = traceScript(safari, 8803, linkedExit, { playerPosition: { x: 48, z: 48 } })
    expect(linkedExitTrace.steps).toContainEqual(expect.objectContaining({ kind: 'warp', mapId: 173, x: 19, z: 2 }))

    const staying = createState(inventory, () => 0)
    staying.safariZone.session = { active: true, balls: 10 }
    traceScript(safari, 8806, staying, { choices: [1], playerPosition: { x: 48, z: 48 } })
    expect(staying.safariZone.session.active).toBe(true)

    const retiring = createState(inventory, () => 0)
    retiring.safariZone.session = { active: true, balls: 10 }
    traceScript(safari, 8806, retiring, { choices: [0], playerPosition: { x: 48, z: 48 } })
    expect(retiring.safariZone.session.active).toBe(false)

    const continueVisit = createState(inventory, () => 0)
    continueVisit.safariZone.session = { active: true, balls: 10 }
    continueVisit.variables.set(0x40e3, 1)
    const continueTrace = traceScript(interior, 7, continueVisit, { choices: [1] })
    expect(continueVisit.safariZone.session.active).toBe(true)
    expect(continueTrace.steps).toContainEqual(expect.objectContaining({ kind: 'warp', mapId: 357 }))

    const leaveVisit = createState(inventory, () => 0)
    leaveVisit.safariZone.session = { active: true, balls: 10 }
    leaveVisit.variables.set(0x40e3, 1)
    const leaveTrace = traceScript(interior, 7, leaveVisit, { choices: [0] })
    expect(leaveVisit.safariZone.session.active).toBe(false)
    expect(leaveVisit.variables.get(0x40e3)).toBe(0)
    expect(leaveTrace.messages).toEqual([7, 8, 9])

    const forcedReturn = createState(inventory, () => 0)
    forcedReturn.variables.set(0x40e3, 2)
    expect(resolveMapFrameScripts(interior.initScripts, (variable) => forcedReturn.variables.get(variable) ?? 0)).toEqual([8])
    expect(traceScript(interior, 8, forcedReturn).messages).toEqual([9])
    expect(forcedReturn.variables.get(0x40e3)).toBe(0)
  }, 180000)

  probe('enchaîne l’appel d’ouverture, Racaillou, Sabelette et les scènes automatiques du portail', async () => {
    const inventory = await readInventory()
    const route39 = requireMap(inventory, 43)
    const olivine = requireMap(inventory, 77)
    const interior = requireMap(inventory, 173)

    const contactState = createState(inventory, () => 0)
    const contactTrace = traceScript(route39, 3, contactState, { choices: [0] })
    expect(contactTrace.steps.at(-1)).toEqual({ kind: 'ended' })
    expect(contactState.phoneContacts.has(24)).toBe(true)
    expect(contactState.safariProgression.baobaContactRegistered).toBe(true)
    expect(contactState.flags.has(0x228)).toBe(true)
    expect(contactState.variables.get(0x408f)).toBe(1)

    const openingState = createState(inventory, () => 0)
    openingState.safariProgression.baobaContactRegistered = true
    const openingTrace = traceScript(olivine, 4, openingState)
    expect(openingTrace.steps).toContainEqual({ kind: 'phoneCall', call: { callerId: 24, parameter1: 2, parameter2: 0 } })
    expect(openingState.variables.get(0x4057)).toBe(1)
    expect(openingState.safariProgression.baobaQuestStage).toBe(1)
    expect(openingState.flags.has(0x249)).toBe(true)

    const firstScene = createState(inventory, () => 100)
    setStage(firstScene, 1)
    expect(resolveMapFrameScripts(interior.initScripts, (variable) => firstScene.variables.get(variable) ?? 0)).toEqual([9])
    traceScript(interior, 9, firstScene, { choices: [0] })
    expect(firstScene.safariProgression.baobaQuestStage).toBe(2)

    const baoba = interior.events?.objects.find(({ scriptId }) => scriptId === 11)
    if (!baoba) throw new Error('Baoba est absent du portail Safari ROM.')

    let journeyIgt = 0
    const journey = createState(inventory, () => journeyIgt)
    traceScript(route39, 3, journey, { choices: [0] })
    traceScript(olivine, 4, journey)
    traceScript(interior, 9, journey, { choices: [0] })
    journey.party.members = [createPokemon(journey.pokemonRuntime!, 74)]
    journeyIgt = 100
    traceScript(interior, 11, journey, { actorId: baoba.id })
    expect(journey.safariProgression.baobaQuestStage).toBe(3)
    const nextTest = advanceHgssSafariHostStep({
      state: journey,
      inventory,
      rng: createHgssLcrng(0),
      now: new Date(2026, 7, 22, 12),
      currentIgtMinutes: 280,
      currentMapId: route39.id,
      incomingCallsEnabled: true,
      playerGender: 'male',
    })
    expect(nextTest?.incoming.triggerId).toBe(7)
    finishHgssSafariHostCall(journey, nextTest!, 280)
    traceScript(interior, 10, journey)
    journey.party.members = [createPokemon(journey.pokemonRuntime!, 27)]
    journeyIgt = 500
    traceScript(interior, 11, journey, { actorId: baoba.id })
    expect(journey.safariProgression).toMatchObject({ baobaQuestStage: 6, baobaIgtReferenceMinutes: 500 })

    const missingGeodude = createState(inventory, () => 100)
    setStage(missingGeodude, 2)
    expect(traceScript(interior, 11, missingGeodude, { actorId: baoba.id }).messages).toContain(33)
    expect(missingGeodude.safariProgression.baobaQuestStage).toBe(2)

    const invalidFirstChallenges = [
      (pokemon: CanonicalPokemon) => { pokemon.origin.metLocation = 227 },
      (pokemon: CanonicalPokemon) => { pokemon.originalTrainer.id ^= 1 },
      (pokemon: CanonicalPokemon) => { pokemon.origin.eggLocation = 202 },
      (pokemon: CanonicalPokemon) => { pokemon.isEgg = true },
    ]
    for (const invalidate of invalidFirstChallenges) {
      const invalid = createState(inventory, () => 100, [74])
      setStage(invalid, 2)
      invalidate(invalid.party.members[0]!)
      expect(traceScript(interior, 11, invalid, { actorId: baoba.id }).messages).toContain(33)
      expect(invalid.safariProgression.baobaQuestStage).toBe(2)
    }

    const firstChallenge = createState(inventory, () => 100, [74])
    setStage(firstChallenge, 2)
    expect(traceScript(interior, 11, firstChallenge, { actorId: baoba.id }).messages).toContain(32)
    expect(firstChallenge.safariProgression).toMatchObject({ baobaQuestStage: 3, baobaIgtReferenceMinutes: 100 })

    const secondScene = createState(inventory, () => 280)
    setStage(secondScene, 4)
    secondScene.flags.add(0x319)
    expect(resolveMapFrameScripts(interior.initScripts, (variable) => secondScene.variables.get(variable) ?? 0)).toEqual([10])
    traceScript(interior, 10, secondScene)
    expect(secondScene.safariProgression.baobaQuestStage).toBe(5)
    expect(secondScene.flags.has(0x319)).toBe(false)

    const missingSandshrew = createState(inventory, () => 500)
    setStage(missingSandshrew, 5)
    expect(traceScript(interior, 11, missingSandshrew, { actorId: baoba.id }).messages).toContain(41)
    expect(missingSandshrew.safariProgression.baobaQuestStage).toBe(5)

    const secondChallenge = createState(inventory, () => 500, [27])
    setStage(secondChallenge, 5)
    expect(traceScript(interior, 11, secondChallenge, { actorId: baoba.id }).messages).toEqual(expect.arrayContaining([37, 38, 39]))
    expect(secondChallenge.safariProgression).toMatchObject({ baobaQuestStage: 6, baobaIgtReferenceMinutes: 500 })
  }, 180000)

  probe('utilise les messages français et les délais IGT natifs pour tous les appels de Baoba', async () => {
    const inventory = await readInventory()
    const state = createState(inventory, () => 0)
    state.safariProgression = {
      ...state.safariProgression,
      baobaContactRegistered: true,
      baobaQuestStage: 3,
      baobaIgtReferenceMinutes: 100,
      lastAreaUpdateDay: '2026-8-22',
    }
    state.variables.set(0x4057, 3)
    state.pokedex.nationalDexEnabled = true
    const base = {
      state,
      inventory,
      rng: createHgssLcrng(0),
      now: new Date(2026, 7, 22, 12),
      currentMapId: 100,
      incomingCallsEnabled: true,
      playerGender: 'male' as const,
    }

    expect(advanceHgssSafariHostStep({ ...base, currentIgtMinutes: 279 })).toBeUndefined()
    const nextTest = advanceHgssSafariHostStep({ ...base, currentIgtMinutes: 280 })
    expect(nextTest).toMatchObject({ incoming: { triggerId: 7, call: { callerId: 24, parameter1: 3, parameter2: 142 } } })
    expect(nextTest?.message).toBe(inventory.phoneContactMessages[24]?.[4])
    finishHgssSafariHostCall(state, nextTest!, 280)
    expect(state.safariProgression.baobaQuestStage).toBe(4)

    setStage(state, 6)
    state.safariProgression.baobaIgtReferenceMinutes = 500
    state.pokedex.nationalDexEnabled = false
    expect(advanceHgssSafariHostStep({ ...base, currentIgtMinutes: 680 })).toBeUndefined()
    state.pokedex.nationalDexEnabled = true

    const expected = [
      { minutes: 680, triggerId: 8, scriptId: 143, messageId: 6, unlock: 1 },
      { minutes: 860, triggerId: 9, scriptId: 144, messageId: 8, unlock: 2 },
      { minutes: 1040, triggerId: 9, scriptId: 144, messageId: 8, unlock: 3 },
      { minutes: 1220, triggerId: 10, scriptId: 145, messageId: 10, unlock: 4 },
    ] as const
    for (const entry of expected) {
      const call = advanceHgssSafariHostStep({ ...base, currentIgtMinutes: entry.minutes })
      expect(call).toMatchObject({ incoming: { triggerId: entry.triggerId, call: { callerId: 24, parameter1: 3, parameter2: entry.scriptId } } })
      expect(call?.message).toBe(inventory.phoneContactMessages[24]?.[entry.messageId])
      finishHgssSafariHostCall(state, call!, entry.minutes)
      expect(state.safariZone.objectUnlockLevel).toBe(entry.unlock)
    }

    const saturated = createState(inventory, () => 0)
    saturated.pokedex.nationalDexEnabled = true
    saturated.safariProgression = {
      ...saturated.safariProgression,
      baobaContactRegistered: true,
      baobaQuestStage: 7,
      baobaIgtReferenceMinutes: 59_899,
      lastAreaUpdateDay: '2026-8-22',
    }
    saturated.variables.set(0x4057, 7)
    saturated.safariZone.objectUnlockLevel = 2
    const memoryLoss = advanceHgssSafariHostStep({ ...base, state: saturated, currentIgtMinutes: 59_999 })
    expect(memoryLoss).toMatchObject({ incoming: { triggerId: 11, call: { callerId: 24, parameter1: 3, parameter2: 146 } } })
    expect(memoryLoss?.message).toBe(inventory.phoneContactMessages[24]?.[12])
    finishHgssSafariHostCall(saturated, memoryLoss!, 59_999)
    expect(saturated.safariZone.objectUnlockLevel).toBe(4)

    const newPokemon = createState(inventory, () => 0)
    newPokemon.safariProgression = {
      ...newPokemon.safariProgression,
      baobaContactRegistered: true,
      pendingEncounterAreaIds: [2, 7],
      lastAreaUpdateDay: '2026-8-22',
    }
    newPokemon.phoneCallTriggers.add(6)
    const encounterCall = advanceHgssSafariHostStep({ ...base, state: newPokemon, currentIgtMinutes: 0 })
    expect(encounterCall).toMatchObject({ incoming: { triggerId: 6, call: { callerId: 24, parameter1: 3, parameter2: 0 }, forcePickUp: false } })
    expect(encounterCall?.message).toBe(inventory.phoneContactMessages[24]?.[16])
    expect([...encounterCall!.buffers]).toEqual([[10, inventory.uiMessageBanks[428]?.[2]], [11, inventory.uiMessageBanks[428]?.[7]]])
    finishHgssSafariHostCall(newPokemon, encounterCall!, 0)
    expect(newPokemon.safariProgression.pendingEncounterAreaIds).toEqual([2, 7])

    const ownMap = createState(inventory, () => 0)
    ownMap.safariProgression.baobaContactRegistered = true
    ownMap.phoneCallTriggers.add(6)
    expect(advanceHgssSafariHostStep({ ...base, state: ownMap, currentIgtMinutes: 0, currentMapId: 173 })).toBeUndefined()
    expect(ownMap.phoneCallTriggers.has(6)).toBe(true)

    const callsDisabled = createState(inventory, () => 0)
    callsDisabled.safariProgression.baobaContactRegistered = true
    callsDisabled.phoneCallTriggers.add(6)
    expect(advanceHgssSafariHostStep({ ...base, state: callsDisabled, currentIgtMinutes: 0, incomingCallsEnabled: false })).toBeUndefined()
    expect(callsDisabled.phoneCallTriggers.has(6)).toBe(true)

    for (const gender of ['male', 'female'] as const) {
      for (let areaCount = 0; areaCount <= 6; areaCount += 1) {
        const dynamic = createState(inventory, () => 0)
        const areaIds = Array.from({ length: areaCount }, (_, areaId) => areaId as 0 | 1 | 2 | 3 | 4 | 5)
        dynamic.safariProgression = {
          ...dynamic.safariProgression,
          baobaContactRegistered: true,
          pendingEncounterAreaIds: areaIds,
          lastAreaUpdateDay: '2026-8-22',
        }
        dynamic.phoneCallTriggers.add(6)
        const call = advanceHgssSafariHostStep({
          ...base,
          state: dynamic,
          currentIgtMinutes: 0,
          playerGender: gender,
        })
        const baseMessageId = areaCount === 0 ? 38 : areaCount === 6 ? 24 : 14 + 2 * (areaCount - 1)
        expect(call?.message).toBe(inventory.phoneContactMessages[24]?.[baseMessageId + (gender === 'female' ? 1 : 0)])
        expect([...call!.buffers.values()]).toEqual(areaIds.map((areaId) => inventory.uiMessageBanks[428]?.[areaId]))
      }
    }
  }, 180000)

  probe('route tous les appels sortants de Baoba selon la carte et l’étape native', async () => {
    const inventory = await readInventory()
    const remoteMap = requireMap(inventory, 64)
    const baobaMap = requireMap(inventory, 173)
    const entry = inventory.phoneBookEntries.find(({ id }) => id === 24)
    expect(entry).toMatchObject({ id: 24, type: 13, mapId: 173, localScriptId: 140 })
    expect(remoteMap.header.outgoingCalls).toBe(true)
    expect(baobaMap.header.outgoingCalls).toBe(true)

    const unregistered = createState(inventory, () => 0)
    expect(createHgssOutgoingPhoneSession(24, unregistered, inventory, remoteMap, createHgssSessionRng(24))).toBeUndefined()

    for (let stage = 0; stage <= 7; stage += 1) {
      const state = createState(inventory, () => 0)
      state.phoneContacts.add(24)
      state.variables.set(0x4057, stage)
      state.safariProgression.baobaQuestStage = stage as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7
      const session = createHgssOutgoingPhoneSession(24, state, inventory, remoteMap, createHgssSessionRng(24 + stage))
      expect(session?.call).toMatchObject({
        callerId: 24,
        scriptId: 147 + stage,
        messages: [{ source: 'contact', messageId: 26 + stage * 2 }],
      })
      const messages = formatHgssOutgoingPhoneMessages(session!, state, inventory, remoteMap)
      expect(messages).toHaveLength(1)
      expect(messages[0]).toContain(state.playerName)
    }

    const local = createState(inventory, () => 0)
    local.phoneContacts.add(24)
    setStage(local, 7)
    const localSession = createHgssOutgoingPhoneSession(24, local, inventory, baobaMap, createHgssSessionRng(24))
    expect(localSession?.call).toMatchObject({ callerId: 24, scriptId: 140, messages: [{ source: 'contact', messageId: 1 }] })
    expect(formatHgssOutgoingPhoneMessages(localSession!, local, inventory, baobaMap)[0]?.trim().length).toBeGreaterThan(0)
  }, 180000)

  probe('exécute les six rubriques ROM de Baoba après la quête sans perdre le choix de sortie', async () => {
    const inventory = await readInventory()
    const map = requireMap(inventory, 173)
    const baoba = map.events?.objects.find(({ scriptId }) => scriptId === 11)
    if (!baoba) throw new Error('Baoba est absent du portail Safari ROM.')

    for (let topic = 0; topic < 6; topic += 1) {
      const state = createState(inventory, () => 0)
      setStage(state, 7)
      const trace = traceScript(map, 11, state, { actorId: baoba.id, choices: [0, topic, 6] })
      expect(trace.messages).toEqual([43, 44, 45, 47 + topic, 53])
      expect(state.flags.has(0x183)).toBe(true)
      expect(trace.steps.at(-1)).toEqual({ kind: 'ended' })
    }

    const declined = createState(inventory, () => 0)
    setStage(declined, 7)
    expect(traceScript(map, 11, declined, { actorId: baoba.id, choices: [1] }).messages).toEqual([43, 44, 45, 53])
    expect(declined.flags.has(0x183)).toBe(true)

    const returning = createState(inventory, () => 0)
    setStage(returning, 7)
    returning.flags.add(0x183)
    expect(traceScript(map, 11, returning, { actorId: baoba.id, choices: [1] }).messages).toEqual([45, 53])
  }, 180000)

  probe('couvre les dialogues secondaires et les états hebdomadaires de tous les PNJ du portail', async () => {
    const inventory = await readInventory()
    const interior = requireMap(inventory, 173)
    const gate = requireMap(inventory, 174)
    const actorFor = (map: OpeningMapPreview, scriptId: number) => map.events?.objects.find((object) => object.scriptId === scriptId)

    const visitor = actorFor(interior, 1)
    const guide = actorFor(interior, 3)
    const nationalGuide = actorFor(interior, 12)
    if (!visitor || !guide || !nationalGuide) throw new Error('Un PNJ secondaire du portail Safari ROM est absent.')
    for (const [stage, greeting] of [[2, 14], [6, 15]] as const) {
      for (const [choice, answer] of [[0, 16], [1, 17]] as const) {
        const state = createState(inventory, () => 0)
        setStage(state, stage)
        expect(traceScript(interior, 1, state, { actorId: visitor.id, choices: [choice] }).messages).toEqual([greeting, answer])
      }
    }

    const guideLocked = createState(inventory, () => 0)
    setStage(guideLocked, 3)
    expect(traceScript(interior, 3, guideLocked, { actorId: guide.id }).messages).toEqual([25])
    for (let topic = 0; topic < 5; topic += 1) {
      const state = createState(inventory, () => 0)
      setStage(state, 4)
      expect(traceScript(interior, 3, state, { actorId: guide.id, choices: [topic, 5] }).messages).toEqual([19, 20 + topic, 26])
    }

    const noNationalDex = createState(inventory, () => 0)
    expect(traceScript(interior, 12, noNationalDex, { actorId: nationalGuide.id }).messages).toEqual([92])
    for (const [stage, greeting] of [[5, 94], [6, 93]] as const) {
      for (const [choice, answer] of [[0, 95], [1, 96]] as const) {
        const state = createState(inventory, () => 0)
        setStage(state, stage)
        state.pokedex.nationalDexEnabled = true
        expect(traceScript(interior, 12, state, { actorId: nationalGuide.id, choices: [choice] }).messages).toEqual([greeting, answer])
      }
    }

    const baoba = actorFor(interior, 11)
    if (!baoba) throw new Error('Baoba est absent du portail Safari ROM.')
    for (const [stage, messageId] of [[0, 42], [1, 42], [3, 42], [4, 42], [6, 40]] as const) {
      const state = createState(inventory, () => 0)
      setStage(state, stage)
      expect(traceScript(interior, 11, state, { actorId: baoba.id }).messages).toEqual([messageId])
    }

    const alternatingNpc = actorFor(gate, 6)
    if (!alternatingNpc) throw new Error('Le PNJ à dialogue alterné du portail extérieur ROM est absent.')
    const alternating = createState(inventory, () => 0)
    expect(traceScript(gate, 6, alternating, { actorId: alternatingNpc.id }).messages).toEqual([7])
    expect(traceScript(gate, 6, alternating, { actorId: alternatingNpc.id, preserveMapState: true }).messages).toEqual([8])

    const saturday = createState(inventory, () => 0)
    traceScript(gate, 15, saturday)
    expect(saturday.flags.has(0x27e)).toBe(true)
    const tuesday = createState(inventory, () => 0)
    tuesday.pokemonRuntime!.now = () => new Date(2026, 7, 18, 12)
    tuesday.flags.add(0x27e)
    traceScript(gate, 15, tuesday)
    expect(tuesday.flags.has(0x27e)).toBe(false)
    const returningFromPhoto = createState(inventory, () => 0)
    returningFromPhoto.flags.add(0x189)
    returningFromPhoto.flags.add(0x27e)
    traceScript(gate, 15, returningFromPhoto)
    expect(returningFromPhoto.flags.has(0x189)).toBe(false)
    expect(returningFromPhoto.flags.has(0x27e)).toBe(true)

    const cameron = actorFor(gate, 14)
    if (!cameron) throw new Error('Cameron est absent du portail extérieur ROM.')
    expect(traceScript(gate, 14, createState(inventory, () => 0), { actorId: cameron.id, choices: [1] }).steps.at(-1)).toEqual({ kind: 'ended' })
    expect(traceScript(gate, 14, createState(inventory, () => 0), { actorId: cameron.id, choices: [0] }).steps.at(-1)).toEqual({ kind: 'ended' })
  }, 180000)

  probe('exécute les rôles rejoindre et hôte puis l’échange exact du set Safari', async () => {
    const inventory = await readInventory()
    const map = requireMap(inventory, 173)
    const exchangeNpc = map.events?.objects.find(({ scriptId }) => scriptId === 4)
    if (!exchangeNpc) throw new Error("Le guichet d'échange Safari ROM est absent.")

    const locked = createState(inventory, () => 500)
    setStage(locked, 7)
    locked.pokedex.nationalDexEnabled = true
    expect(traceScript(map, 4, locked, { actorId: exchangeNpc.id }).messages).toEqual([18])

    const noNationalDex = createState(inventory, () => 500)
    setStage(noNationalDex, 6)
    expect(traceScript(map, 4, noNationalDex, { actorId: exchangeNpc.id }).messages).toEqual([84])

    const saveDeclined = createState(inventory, () => 500)
    setStage(saveDeclined, 6)
    saveDeclined.pokedex.nationalDexEnabled = true
    const saveDeclinedTrace = traceScript(map, 4, saveDeclined, { actorId: exchangeNpc.id, choices: [0, 1] })
    expect(saveDeclinedTrace.multiplayerRequests).toEqual([])
    expect(saveDeclinedTrace.messages.at(-1)).toBe(85)

    const exchangedState = createState(inventory, () => 500)
    setStage(exchangedState, 6)
    exchangedState.pokedex.nationalDexEnabled = true
    const remoteSet = structuredClone(exchangedState.safariZone.areaSets[0])
    ;[remoteSet.areas[0], remoteSet.areas[1]] = [remoteSet.areas[1]!, remoteSet.areas[0]!]
    const exchangeTrace = traceScript(map, 4, exchangedState, {
      actorId: exchangeNpc.id,
      choices: [0, 0, 0, 0, 0],
      multiplayer: (request) => {
        if (request.kind === 'communication-club') return {
            protocolVersion: hgssMultiplayerProtocolVersion,
            requestId: request.requestId,
            kind: request.kind,
            romResult: 2,
            status: 'completed',
          }
        if (request.kind === 'union-handshake') return {
          protocolVersion: hgssMultiplayerProtocolVersion,
          requestId: request.requestId,
          kind: request.kind,
          romResult: 0,
          status: 'completed',
        }
        return {
            protocolVersion: hgssMultiplayerProtocolVersion,
            requestId: request.requestId,
            kind: request.kind,
            romResult: 0,
            status: 'completed',
            safariAreaSet: remoteSet,
            safariPlayer: { trainerId: 77, name: 'AMI', gender: 'male', language: 3, gameVersion: 7 },
          }
      },
    })
    expect(exchangeTrace.multiplayerRequests).toEqual([
      expect.objectContaining({ romOpcode: 226, kind: 'communication-club', role: 'join', communicationType: 39, parameter1: 0, parameter2: 0 }),
      expect.objectContaining({ romOpcode: 257, kind: 'union-handshake', command: 96 }),
      expect.objectContaining({ romOpcode: 822, kind: 'safari-area-exchange' }),
    ])
    expect(exchangedState.safariZone.areaSets[1]).toEqual(remoteSet)
    expect(exchangedState.safariZone.linkLeader).toMatchObject({ linked: true, trainerId: 77, name: 'AMI' })
    expect(exchangedState.variables.get(0x4133)).toBe(0)
    expect(exchangeTrace.steps.at(-1)).toEqual({ kind: 'ended' })

    const hostState = createState(inventory, () => 500)
    setStage(hostState, 6)
    hostState.pokedex.nationalDexEnabled = true
    const hostTrace = traceScript(map, 4, hostState, {
      actorId: exchangeNpc.id,
      choices: [0, 0, 0, 1, 0],
    })
    expect(hostTrace.multiplayerRequests).toEqual([
      expect.objectContaining({ romOpcode: 227, kind: 'communication-club', role: 'host', communicationType: 39, parameter1: 0, parameter2: 0 }),
    ])
    expect(hostTrace.messages.at(-1)).toBe(85)
    expect(hostTrace.steps.at(-1)).toEqual({ kind: 'ended' })

    const hostSuccess = createState(inventory, () => 500)
    setStage(hostSuccess, 6)
    hostSuccess.pokedex.nationalDexEnabled = true
    const hostSuccessTrace = traceScript(map, 4, hostSuccess, {
      actorId: exchangeNpc.id,
      choices: [0, 0, 0, 1, 0],
      multiplayer: (request) => request.kind === 'communication-club'
        ? {
            protocolVersion: hgssMultiplayerProtocolVersion,
            requestId: request.requestId,
            kind: request.kind,
            romResult: 2,
            status: 'completed',
          }
        : request.kind === 'union-handshake'
          ? {
              protocolVersion: hgssMultiplayerProtocolVersion,
              requestId: request.requestId,
              kind: request.kind,
              romResult: 0,
              status: 'completed',
            }
          : {
              protocolVersion: hgssMultiplayerProtocolVersion,
              requestId: request.requestId,
              kind: request.kind,
              romResult: 0,
              status: 'completed',
              safariAreaSet: remoteSet,
              safariPlayer: { trainerId: 77, name: 'AMI', gender: 'male', language: 3, gameVersion: 7 },
            },
    })
    expect(hostSuccessTrace.multiplayerRequests).toEqual([
      expect.objectContaining({ romOpcode: 227, kind: 'communication-club', role: 'host', communicationType: 39 }),
      expect.objectContaining({ romOpcode: 257, kind: 'union-handshake', command: 96 }),
      expect.objectContaining({ romOpcode: 822, kind: 'safari-area-exchange' }),
    ])
    expect(hostSuccess.safariZone.areaSets[1]).toEqual(remoteSet)

    for (const role of ['join', 'host'] as const) {
      for (const [romResult, messageId] of [[1, 85], [3, 87], [4, 85]] as const) {
        const state = createState(inventory, () => 500)
        setStage(state, 6)
        state.pokedex.nationalDexEnabled = true
        const trace = traceScript(map, 4, state, {
          actorId: exchangeNpc.id,
          choices: [0, 0, 0, role === 'join' ? 0 : 1, 0],
          multiplayer: (request) => ({
            protocolVersion: hgssMultiplayerProtocolVersion,
            requestId: request.requestId,
            kind: request.kind,
            romResult,
            status: romResult === 4 ? 'offline' : 'completed',
          }),
        })
        expect(trace.multiplayerRequests).toEqual([
          expect.objectContaining({
            romOpcode: role === 'join' ? 226 : 227,
            kind: 'communication-club',
            role,
            communicationType: 39,
          }),
        ])
        expect(trace.messages.at(-1)).toBe(messageId)
        expect(trace.steps.at(-1)).toEqual({ kind: 'ended' })
      }
    }
  }, 180000)

  probe('lance le customizer natif et ne signale une secousse qu’après un vrai changement', async () => {
    const inventory = await readInventory()
    const map = requireMap(inventory, 173)

    const unchanged = createState(inventory, () => 0)
    setStage(unchanged, 4)
    const unchangedTrace = traceScript(map, 6, unchanged)
    expect(unchangedTrace.steps.some(({ kind }) => kind === 'safariCustomizer')).toBe(true)
    expect(unchanged.flags.has(0x99d)).toBe(false)
    expect(unchangedTrace.messages).not.toContain(91)

    const changed = createState(inventory, () => 0)
    setStage(changed, 4)
    const changedTrace = traceScript(map, 6, changed, {
      customizerChange: ({ areas }) => ({
        areas: [areas[1], areas[0], areas[2], areas[3], areas[4], areas[5]],
        sourceSlot: 0,
        targetAreaId: areas[1],
        operation: 'swap',
        swappedSlot: 1,
      }),
    })
    expect(changed.flags.has(0x99d)).toBe(true)
    expect(changedTrace.messages).toContain(91)

    const safari = requireMap(inventory, 357)
    const decorated = createState(inventory, () => 0)
    decorated.safariZone.objectUnlockLevel = 4
    const safariVariant = inventory.mapVariantResolver?.(safari, {
      weekday: 6,
      rocketHideoutCleared: false,
      safariZone: decorated.safariZone,
      playerGender: decorated.gender,
    })
    if (!safariVariant) throw new Error('La variante dynamique de la carte Safari ROM est absente.')
    let decoratorPosition: { x: number, z: number } | undefined
    for (let z = 32; z < 96 && !decoratorPosition; z += 1) {
      for (let x = 32; x < 128; x += 1) {
        const step = createHgssSafariDecoratorStep(safariVariant, decorated.safariZone, { x, z, direction: 'north', state: 0 }, decorated.pokemonRuntime!.trainer.id)
        if (step.candidates.some(({ placement }) => placement)) {
          decoratorPosition = { x, z }
          break
        }
      }
    }
    if (!decoratorPosition) throw new Error('Aucune position ROM ne permet de placer un Bloc Safari.')
    const decorateTrace = traceScript(safariVariant, 8800, decorated, {
      choices: [0],
      decoratorSelection: (step) => step.candidates.find(({ placement }) => placement)?.objectId,
      playerPosition: decoratorPosition,
    })
    expect(decorateTrace.messages).toEqual([4, 5])
    const decoratorStep = decorateTrace.steps.find((step): step is Extract<FieldScriptStep, { kind: 'safariDecorator' }> => step.kind === 'safariDecorator')
    const selected = decoratorStep?.candidates.find(({ placement }) => placement)
    expect(selected?.placement).toBeDefined()
    const decoratedCell = resolveHgssSafariAreaCellAtWorldPosition(decorated.safariZone.areaSets[0], decoratorPosition.x, decoratorPosition.z)
    if (!decoratedCell) throw new Error('La position retenue est hors des six parcelles Safari.')
    expect(decorated.safariZone.areaSets[0].areas[decoratedCell.areaSlot].placements).toEqual([selected!.placement])

    const removeTrace = traceScript(safariVariant, 8801, decorated, {
      choices: [0], playerPosition: decoratorPosition,
    })
    expect(removeTrace.messages).toEqual([6, 7])
    expect(decorated.safariZone.areaSets[0].areas[decoratedCell.areaSlot].placements).toEqual([])
  }, 180000)
})
