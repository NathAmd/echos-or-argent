import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { OpeningMapPreview, RomInventory } from './ndsTypes'
import { createCanonicalPokemon } from './game/pokemon/canonicalPokemon'
import { createHgssLcrng } from './game/pokemon/hgssPokemonRng'
import { createHgssMersenneTwister } from './game/pokemon/hgssSessionRng'
import { createFieldScriptMapInitSequenceRunner, createFieldScriptRunner, createFieldScriptState, formatFieldMessage, hasFieldScript, initializeNewGameFieldScriptState, projectFieldScriptState, setFieldScriptMapState, setFieldScriptPlayerState, type FieldPokemonRuntime, type FieldScriptRunner, type FieldScriptStep } from './game/scripts/fieldScriptRunner'
import { getMapGroundHeights, getMapOrigin, getMapTileBounds, hasMapDecorativeSurfaceAt, usesWorldMatrixCoordinates } from './game/world/mapCoordinates'
import { createWorldSession } from './game/world/worldSession'
import { readRomInventory } from './nds'
import { resolveMapFrameScripts, resolveMapInitScripts, type MapInitPhase } from './rom/scripts/fieldScripts'
import { createOfflineHgssMultiplayerResult } from './game/multiplayer/hgssMultiplayerGateway'
import { createFieldInputSimulator } from './game/simulation/fieldInputSimulator'
import { hgssAllGymMapIds } from './game/gyms/hgssGymMapCatalog'
import { createUnifiedPcEntryCoordinator } from './game/ui/pcBoxLegacyEntry'
import type { PokemonInitialTeamResolver } from './game/pokemon/pokemonInitialTeamResolver'
import { resolveHgssScriptedPhoneMessage } from './rom/phone/phoneCalls'

type ScriptProbeTarget = {
  kind: 'init' | 'frame' | 'object' | 'background' | 'coordinate'
  mapId: number
  mapLabel: string
  scriptId: number
  actorId?: number
  phase?: MapInitPhase
}

type ScriptProbeResult = {
  target: ScriptProbeTarget
  choiceStrategy: ProbeChoiceStrategy
  status: 'ok' | 'unsupported-opcode' | 'error'
  opcode?: number
  error?: string
}

type ProbeChoiceStrategy = 'service-cycle' | 'last-option' | 'cancel'

const defaultRomPath = fileURLToPath(new URL('../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const romPath = process.env.ROM_AUDIT_PATH ? resolve(process.env.ROM_AUDIT_PATH) : defaultRomPath
const reportPath = fileURLToPath(new URL('../.field-script-probe-details.json', import.meta.url))
const targetReportPath = process.env.ROM_AUDIT_REPORT_PATH
  ? resolve(process.env.ROM_AUDIT_REPORT_PATH)
  : fileURLToPath(new URL('../.field-script-probe-target-details.json', import.meta.url))
const probe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip
const fullRomAudit = process.env.RUN_FULL_ROM_AUDIT === '1' && existsSync(romPath) ? it : it.skip
const writeProbeReports = process.env.WRITE_ROM_PROBE_REPORTS === '1'
let probeInventoryPromise: Promise<RomInventory> | undefined

function readProbeInventory(): Promise<RomInventory> {
  probeInventoryPromise ??= readFile(romPath).then((romBuffer) => (
    readRomInventory(new File([romBuffer], basename(romPath)))
  ))
  return probeInventoryPromise
}

function createProbePokemonRuntime(inventory: RomInventory): FieldPokemonRuntime {
  return {
    catalog: inventory.pokemonCatalog,
    pokedexCatalog: inventory.pokedexCatalog,
    itemCatalog: inventory.itemCatalog,
    rng: createHgssLcrng(0),
    mt: createHgssMersenneTwister(0),
    trainer: { id: 0x12345678, name: 'PROBE', gender: 'male' },
    language: 3,
    gameVersion: 7,
    now: () => new Date(2026, 2, 12),
    igtMinutes: () => 0,
    safariEncounterCatalog: inventory.safariEncounterCatalog,
    phoneBookEntries: inventory.phoneBookEntries,
    trainerCatalog: inventory.trainerCatalog,
    trainerMessages: inventory.trainerMessages,
    npcTradeCatalog: inventory.npcTradeCatalog,
    photoDataCatalog: inventory.photoDataCatalog,
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

function createProbeFieldState(inventory: RomInventory, speciesId?: number, starterChoice?: number, level = 5) {
  const pokemonRuntime = createProbePokemonRuntime(inventory)
  const party = speciesId === undefined ? [] : [createCanonicalPokemon(pokemonRuntime.catalog, {
    speciesId,
    level,
    rng: pokemonRuntime.rng,
    personality: { kind: 'random' },
    individualValues: { kind: 'random' },
    originalTrainer: pokemonRuntime.trainer,
    origin: { language: 3, gameVersion: 7, metLocation: 126, metLevel: 5, metTerrain: 12 },
    ballId: 4,
  })]
  return createFieldScriptState('male', 'PROBE', { party, pokemonRuntime, starterChoice })
}
const openingMapIds = new Set([60, 61, 62, 63, 64, 65, 66])

function collectTargets(map: OpeningMapPreview): ScriptProbeTarget[] {
  const targets: ScriptProbeTarget[] = []
  const add = (target: ScriptProbeTarget): void => {
    if (!hasFieldScript(map, target.scriptId)) return
    if (targets.some((candidate) => candidate.kind === target.kind
      && candidate.mapId === target.mapId
      && candidate.scriptId === target.scriptId
      && candidate.actorId === target.actorId
      && candidate.phase === target.phase)) {
      return
    }
    targets.push(target)
  }

  for (const phase of ['load', 'transition', 'resume'] as const) {
    for (const scriptId of resolveMapInitScripts(map.initScripts, phase)) {
      add({ kind: 'init', mapId: map.id, mapLabel: map.label, scriptId, phase })
    }
  }
  for (const entry of map.initScripts) {
    if (entry.type !== 'onFrame') continue
    for (const condition of entry.conditions) {
      add({ kind: 'frame', mapId: map.id, mapLabel: map.label, scriptId: condition.scriptId })
    }
  }
  for (const object of map.events?.objects ?? []) {
    add({ kind: 'object', mapId: map.id, mapLabel: map.label, scriptId: object.scriptId, actorId: object.id })
  }
  for (const background of map.events?.backgrounds ?? []) {
    add({ kind: 'background', mapId: map.id, mapLabel: map.label, scriptId: background.scriptId })
  }
  for (const coordinate of map.events?.coordinateEvents ?? []) {
    add({ kind: 'coordinate', mapId: map.id, mapLabel: map.label, scriptId: coordinate.scriptId })
  }
  return targets
}

function prepareRunner(inventory: RomInventory, map: OpeningMapPreview, target: ScriptProbeTarget): { runner: FieldScriptRunner, state: ReturnType<typeof createProbeFieldState> } {
  // Les scripts de terrain accessibles après Bourg Geon partent du contrat
  // natif qu'un starter occupe l'équipe. Une équipe vide force autrement des
  // sentinelles de menu (slot 6) dans des chemins impossibles en partie réelle.
  const state = createProbeFieldState(inventory, 155, 1, target.mapId === 291 ? 50 : 5)
  const lead = state.party.members[0]
  const fallbackMove = inventory.pokemonCatalog.moves[45]
  if (target.mapId === 291 && lead && fallbackMove && lead.moves.length < 2) {
    lead.moves.push({ moveId: 45, pp: fallbackMove.pp, maxPp: fallbackMove.pp, ppUps: 0, data: fallbackMove })
  }
  const actor = target.actorId === undefined ? undefined : map.events?.objects.find((object) => object.id === target.actorId)
  const playerX = actor ? actor.x : 0
  const playerZ = actor ? actor.z + 1 : 0
  setFieldScriptMapState(state, map, playerX, playerZ, 'south')
  return { runner: createFieldScriptRunner(map, target.scriptId, state, target.actorId), state }
}

function handleInteractiveStep(
  runner: FieldScriptRunner,
  step: FieldScriptStep,
  state: Pick<ReturnType<typeof createProbeFieldState>, 'variables'>,
  choiceVisits?: Map<string, number>,
  choiceStrategy: ProbeChoiceStrategy = 'service-cycle',
): number | undefined {
  if (step.kind === 'choice') {
    if (step.options.length === 0) throw new Error('Le script demande un choix sans options.')
    // Les libellés peuvent contenir des buffers dynamiques (nom, nombre,
    // espèce) et changer à chaque retour sans que le menu ROM ait changé.
    // La structure native du menu est définie par ses valeurs et son mode.
    const signature = `${step.presentation ?? 'list'}:${step.cancellable ? 1 : 0}:${step.options.map((option) => option.value).join('|')}`
    const visits = choiceVisits?.get(signature) ?? 0
    choiceVisits?.set(signature, visits + 1)
    // Les services HGSS reviennent au même menu après une action. On visite
    // d'abord la branche principale puis l'option de sortie au retour, au lieu
    // de signaler à tort une boucle infinie.
    const confirmsMoveDeletion = visits === 1
      && step.options.length === 2
      && step.options[0]?.value === 0
      && step.options[1]?.value === 1
      && [...(choiceVisits?.keys() ?? [])].some((key) => key.endsWith(':255'))
    const confirmsNickname = choiceVisits?.delete('__nickname__') ?? false
    // Une branche « Non » ou Annuler peut légitimement ramener au même menu.
    // L'audit la visite une fois, puis reprend le cycle natif principal/sortie
    // afin de distinguer ce retour volontaire d'une boucle du moteur.
    const exploratoryChoice = choiceStrategy === 'cancel' && step.cancellable && visits === 0
      ? 0xfffe
      : choiceStrategy === 'last-option' && visits === 0
        ? step.options.at(-1)!.value
        : undefined
    const serviceVisits = choiceStrategy === 'service-cycle' ? visits : Math.max(0, visits - 1)
    const primaryOption = step.options.find((option) => option.value === 0) ?? step.options[0]!
    const value = exploratoryChoice ?? (confirmsNickname || serviceVisits === 0 || confirmsMoveDeletion
      ? primaryOption.value
      : step.cancellable && step.options.length === 1
        ? 0xfffe
        : step.options.at(-1)!.value)
    runner.choose(value)
    return value
  }
  if (step.kind === 'number') runner.enterNumber(step.min)
  if (step.kind === 'nickname') {
    runner.enterNickname(step.currentName || 'MON')
    choiceVisits?.set('__nickname__', 1)
  }
  if (step.kind === 'eggHatch') runner.finishEggHatch(undefined)
  if (step.kind === 'fieldMoveEffect') state.variables.set(step.completionVariable, 1)
  if (step.kind === 'battle') runner.submitBattleResult(true)
  if (step.kind === 'multiplayer') runner.submitMultiplayerResult(createOfflineHgssMultiplayerResult(step.request))
  if (step.kind === 'easyChat') runner.submitEasyChat(undefined)
  if (step.kind === 'pcBox') runner.closePcBox()
  if (step.kind === 'photoCapture') {
    if (!runner.finishPhotoCapture) throw new Error('Le runner du probe ne peut pas terminer la prise de photo.')
    runner.finishPhotoCapture()
  }
  if (step.kind === 'photoAlbum') {
    if (!runner.closePhotoAlbum) throw new Error("Le runner du probe ne peut pas fermer l'album photo.")
    runner.closePhotoAlbum(step.photos)
  }
  if (step.kind === 'pokeathlonApp') runner.closePokeathlonApp()
  if (step.kind === 'frontierRecordsApp') runner.closeFrontierRecordsApp()
  if (step.kind === 'gameClear') runner.closeGameClear()
  if (step.kind === 'alphPuzzle') runner.finishAlphPuzzle(true)
  if (step.kind === 'alphHiddenRoom') runner.closeAlphHiddenRoom()
  if (step.kind === 'safariCustomizer') {
    if (!runner.closeSafariCustomizer) throw new Error('Le runner du probe ne peut pas fermer le Customizer Safari.')
    runner.closeSafariCustomizer()
  }
  if (step.kind === 'safariDecorator') {
    if (!runner.submitSafariDecoratorSelection) throw new Error('Le runner du probe ne peut pas fermer le Décorateur Safari.')
    runner.submitSafariDecoratorSelection(undefined)
  }
}

function validatePhoneCallPresentation(
  inventory: RomInventory,
  state: ReturnType<typeof createProbeFieldState>,
  step: FieldScriptStep,
): void {
  if (step.kind !== 'phoneCall') return
  const resolved = resolveHgssScriptedPhoneMessage(step.call, state.gender, {
    nationalDexOwnedCount: state.pokedex.caughtSpeciesIds.size,
    eventFlags: state.flags,
  })
  if (!resolved) {
    throw new Error(
      `L’appel Pokématos ROM ${step.call.callerId}/${step.call.parameter1}/${step.call.parameter2} n’est pas interprété par le runtime.`,
    )
  }
  if (inventory.phoneContactNames[resolved.callerId] === undefined) {
    throw new Error(`Le nom ROM du contact Pokématos ${resolved.callerId} est absent.`)
  }
  if (inventory.phoneContactMessages[resolved.callerId]?.[resolved.messageId] === undefined) {
    throw new Error(
      `Le message Pokématos ROM ${resolved.callerId}/${resolved.phoneScriptId}/${resolved.messageId} est absent.`,
    )
  }
  if (resolved.choice) {
    const choiceCount = resolved.choice.options.length
    if (choiceCount === 0
      || resolved.choice.defaultIndex < 0 || resolved.choice.defaultIndex >= choiceCount
      || resolved.choice.cancelIndex < 0 || resolved.choice.cancelIndex >= choiceCount) {
      throw new Error(`Le menu Pokématos ROM du contact ${resolved.callerId} possède des curseurs invalides.`)
    }
    for (const option of resolved.choice.options) {
      if (inventory.uiMessageBanks[271]?.[option.labelMessageId] === undefined) {
        throw new Error(`Le libellé Pokématos ROM 271/${option.labelMessageId} est absent.`)
      }
      if (inventory.phoneContactMessages[resolved.callerId]?.[option.continuationMessageId] === undefined) {
        throw new Error(
          `La continuation Pokématos ROM ${resolved.callerId}/${option.continuationMessageId} est absente.`,
        )
      }
    }
  }
}

function validateScriptWarpDestination(
  inventory: RomInventory,
  step: FieldScriptStep,
): void {
  if (step.kind !== 'warp') return
  const destination = inventory.resolvedMapCatalog.maps.find((map) => map.id === step.mapId)
  if (!destination) throw new Error(`Le warp de script cible la carte ROM absente ${step.mapId}.`)
  const origin = getMapOrigin(destination)
  const tileX = step.x - origin.x
  const tileZ = step.z - origin.z
  const bounds = getMapTileBounds(destination) ?? (destination.terrain
    ? { minX: 0, maxX: destination.terrain.width, minZ: 0, maxZ: destination.terrain.height }
    : undefined)
  if (!bounds) throw new Error(`L’empreinte de la carte ROM ${step.mapId} ciblée par un warp de script est absente.`)
  if (tileX < bounds.minX || tileX >= bounds.maxX || tileZ < bounds.minZ || tileZ >= bounds.maxZ) {
    throw new Error(
      `Le warp de script vers ${step.mapId} place le joueur hors empreinte à ${tileX},${tileZ} `
      + `(bornes ${bounds.minX}..${bounds.maxX - 1},${bounds.minZ}..${bounds.maxZ - 1}).`,
    )
  }
}

function probeScript(
  inventory: RomInventory,
  map: OpeningMapPreview,
  target: ScriptProbeTarget,
  maxSteps = 2048,
  choiceStrategy: ProbeChoiceStrategy = 'service-cycle',
): ScriptProbeResult {
  try {
    const { runner, state } = prepareRunner(inventory, map, target)
    const choiceVisits = new Map<string, number>()
    const debugSteps: string[] = []
    for (let stepCount = 0; stepCount < maxSteps; stepCount += 1) {
      const step = runner.resume()
      const debugIndex = debugSteps.length
      if (debugSteps.length < 80) {
        debugSteps.push(step.kind === 'choice' ? `choice(${step.options.map((option) => option.value).join('/')})` : step.kind)
      }
      if (step.kind === 'ended') return { target, choiceStrategy, status: 'ok' }
      if (step.kind === 'message') formatFieldMessage(step.text, state)
      validatePhoneCallPresentation(inventory, state, step)
      validateScriptWarpDestination(inventory, step)
      const submitted = handleInteractiveStep(runner, step, state, choiceVisits, choiceStrategy)
      if (submitted !== undefined && debugIndex < 80) debugSteps[debugIndex] += `→${submitted}`
    }
    return {
      target,
      choiceStrategy,
      status: 'error',
      error: `Le probe a depasse ${maxSteps} etapes sans fin de script.${debugSteps.length ? ` Étapes: ${debugSteps.join(',')}` : ''}`,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const opcodeMatch = /Opcode HGSS (\d+)/.exec(message)
    return {
      target,
      choiceStrategy,
      status: opcodeMatch ? 'unsupported-opcode' : 'error',
      opcode: opcodeMatch ? Number.parseInt(opcodeMatch[1], 10) : undefined,
      error: message,
    }
  }
}

function traceRomTarget(
  inventory: RomInventory,
  map: OpeningMapPreview,
  target: ScriptProbeTarget,
  starterChoice = 1,
  configureState?: (state: ReturnType<typeof createProbeFieldState>) => void,
): { state: ReturnType<typeof createProbeFieldState>, steps: FieldScriptStep[] } {
  const { runner, state } = prepareRunner(inventory, map, target)
  state.starterChoice = starterChoice
  configureState?.(state)
  const steps: FieldScriptStep[] = []
  const choiceVisits = new Map<string, number>()
  for (let stepCount = 0; stepCount < 2048; stepCount += 1) {
    const step = runner.resume()
    steps.push(step)
    if (step.kind === 'message') formatFieldMessage(step.text, state)
    validatePhoneCallPresentation(inventory, state, step)
    validateScriptWarpDestination(inventory, step)
    handleInteractiveStep(runner, step, state, choiceVisits)
    if (step.kind === 'ended') return { state, steps }
  }
  throw new Error(`Le contrat de progression ROM ${map.id}/${target.scriptId} depasse 2048 etapes.`)
}

describe('field script probe', () => {
  probe('keeps every Pokemon League lobby NPC reachable and executable', async () => {
    const inventory = await readProbeInventory()
    const map = inventory.resolvedMapCatalog.maps.find(({ id }) => id === 300)
    expect(map).toBeDefined()
    if (!map) return
    const state = createProbeFieldState(inventory, 155, 1, 50)
    const session = createWorldSession(inventory.resolvedMapCatalog.maps, state.flags, state.hiddenObjectIds, state.variables)
    const interactions = (map.events?.objects ?? [])
      .filter(({ scriptId }) => hasFieldScript(map, scriptId))
      .map((object) => {
        const southAttribute = map.terrain?.attributes[(object.z + 1) * map.terrain.width + object.x]
        const distance = ((southAttribute ?? 0) & 0xff) === 0x80 ? 2 : 1
        session.loadMap(map.id, object.x, object.z + distance, 'north')
        return { object, interaction: session.interact() }
      })
    expect(interactions.map(({ object, interaction }) => ({ id: object.id, interaction }))).toEqual([
      { id: 0, interaction: { kind: 'npc', id: 0, scriptId: 1 } },
      { id: 1, interaction: { kind: 'npc', id: 1, scriptId: 3 } },
      { id: 2, interaction: { kind: 'npc', id: 2, scriptId: 2 } },
      { id: 3, interaction: { kind: 'npc', id: 3, scriptId: 4 } },
      { id: 4, interaction: { kind: 'npc', id: 4, scriptId: 5 } },
      { id: 6, interaction: { kind: 'npc', id: 6, scriptId: 9003 } },
      { id: 7, interaction: { kind: 'npc', id: 7, scriptId: 9001 } },
      { id: 8, interaction: { kind: 'npc', id: 8, scriptId: 9 } },
    ])
    const failures = interactions.flatMap(({ object }) => {
      const result = probeScript(inventory, map, {
        kind: 'object', mapId: map.id, mapLabel: map.label, scriptId: object.scriptId, actorId: object.id,
      })
      return result.status === 'ok' ? [] : [result]
    })
    expect(failures).toEqual([])
    const firstSteps = interactions.map(({ object }) => {
      const { runner } = prepareRunner(inventory, map, {
        kind: 'object', mapId: map.id, mapLabel: map.label, scriptId: object.scriptId, actorId: object.id,
      })
      const kinds: FieldScriptStep['kind'][] = []
      for (let index = 0; index < 32; index += 1) {
        const step = runner.resume()
        kinds.push(step.kind)
        if (step.kind === 'message' || step.kind === 'choice' || step.kind === 'battle' || step.kind === 'ended') break
      }
      return { id: object.id, scriptId: object.scriptId, kinds }
    })
    expect(firstSteps.every(({ kinds }) => kinds.some((kind) => kind === 'message' || kind === 'choice'))).toBe(true)
  }, 120000)

  probe('resolves the Pokemon Center PC terminal and its standard script', async () => {
    const inventory = await readProbeInventory()
    const map = inventory.resolvedMapCatalog.maps.find(({ id }) => id === 69)
    expect(map).toBeDefined()
    if (!map) return
    expect(hasFieldScript(map, 2010)).toBe(true)
    const pcTiles: { x: number, z: number }[] = []
    for (let z = 0; z < map.terrain!.height; z += 1) for (let x = 0; x < map.terrain!.width; x += 1) {
      if ((map.terrain!.attributes[z * map.terrain!.width + x]! & 0xff) === 131) pcTiles.push({ x, z })
    }
    expect(pcTiles.length).toBeGreaterThan(0)
    const session = createWorldSession(inventory.resolvedMapCatalog.maps)
    const reachablePc = pcTiles.some(({ x, z }) => {
      session.loadMap(map.id, x, z + 1, 'north')
      const interaction = session.interact()
      return interaction?.kind === 'metatile' && interaction.scriptId === 2010
    })
    expect(reachablePc).toBe(true)

    const { runner, state } = prepareRunner(inventory, map, { kind: 'background', mapId: map.id, mapLabel: map.label, scriptId: 2010 })
    const choiceVisits = new Map<string, number>()
    let reachedPcApplication = false
    for (let stepCount = 0; stepCount < 128; stepCount += 1) {
      const step = runner.resume()
      if (step.kind === 'pcBox') {
        reachedPcApplication = true
        break
      }
      handleInteractiveStep(runner, step, state, choiceVisits)
      if (step.kind === 'ended') break
    }
    expect(reachedPcApplication).toBe(true)
    const pcEntry = createUnifiedPcEntryCoordinator()
    pcEntry.applicationClosed()
    runner.closePcBox()
    let terminalEnded = false
    let boxReopened = false
    const surfacedMessages: string[] = []
    for (let stepCount = 0; stepCount < 32; stepCount += 1) {
      const step = runner.resume()
      if (step.kind === 'message') { if (!pcEntry.isUnwinding()) surfacedMessages.push(step.text); continue }
      if (step.kind === 'choice') {
        const choice = pcEntry.resolveChoice(step.options, inventory.uiMessageBanks[191])
        if (choice === undefined) break
        runner.choose(choice)
      } else if (step.kind === 'pcBox') { boxReopened = true; break }
      else if (step.kind === 'ended') { terminalEnded = true; break }
    }
    expect({ terminalEnded, boxReopened, surfacedMessages }).toEqual({ terminalEnded: true, boxReopened: false, surfacedMessages: [] })
  }, 120000)

  probe('gates the native Cascade script behind badge 7, move 127 and confirmation', async () => {
    const inventory = await readProbeInventory()
    const selected = inventory.resolvedMapCatalog.maps
      .map((map) => {
        const index = map.terrain?.attributes.findIndex((attribute, tileIndex) => {
          if ((attribute & 0xff) !== 19 || !map.terrain) return false
          const z = Math.floor(tileIndex / map.terrain.width)
          return z > 0 && z + 1 < map.terrain.height
        }) ?? -1
        return { map, index }
      })
      .find(({ map, index }) => index >= 0 && hasFieldScript(map, 10005))
    expect(selected).toBeDefined()
    if (!selected?.map.terrain) return

    const waterfallX = selected.index % selected.map.terrain.width
    const waterfallZ = Math.floor(selected.index / selected.map.terrain.width)
    const run = (badge: boolean, move: boolean, confirm: boolean, direction: 'north' | 'south' = 'south') => {
      const state = createProbeFieldState(inventory, 155)
      const lead = state.party.members[0]
      const moveData = inventory.pokemonCatalog.moves[127]
      if (!lead || !moveData) throw new Error('La ROM ne fournit pas le Pokémon ou Cascade requis par le probe.')
      lead.moves = move
        ? [{ moveId: 127, pp: moveData.pp, maxPp: moveData.pp, ppUps: 0, data: moveData }]
        : []
      if (badge) state.badges.add(7)
      state.playerState = 2
      const startZ = waterfallZ + (direction === 'north' ? 1 : -1)
      setFieldScriptMapState(state, selected.map, waterfallX, startZ, direction)
      const runner = createFieldScriptRunner(selected.map, 10005, state)
      const steps: FieldScriptStep[] = []
      for (let stepCount = 0; stepCount < 128; stepCount += 1) {
        const step = runner.resume()
        steps.push(step)
        if (step.kind === 'message') formatFieldMessage(step.text, state)
        if (step.kind === 'choice') runner.choose((confirm ? step.options[0] : step.options.at(-1))!.value)
        if (step.kind === 'ended') return { state, steps, startZ }
      }
      throw new Error('Le script ROM Cascade 10005 ne se termine pas en 128 étapes.')
    }
    const playerMovements = (steps: readonly FieldScriptStep[]) => steps.filter((step) => step.kind === 'movement' && step.objectId === 255)

    expect(playerMovements(run(false, true, true).steps)).toHaveLength(0)
    expect(playerMovements(run(true, false, true).steps)).toHaveLength(0)
    expect(playerMovements(run(true, true, false).steps)).toHaveLength(0)

    const descent = run(true, true, true, 'south')
    expect(descent.steps.some((step) => step.kind === 'choice')).toBe(true)
    expect(playerMovements(descent.steps)).toMatchObject([{ actions: [{ direction: 'south' }, { direction: 'south' }] }])
    expect(descent.steps[descent.steps.findIndex((step) => step.kind === 'movement') + 1]).toMatchObject({ kind: 'waiting', waitFor: 'movement' })
    expect(descent.state.player).toMatchObject({ x: waterfallX, z: descent.startZ + 2, direction: 'south' })

    const ascent = run(true, true, true, 'north')
    expect(ascent.steps.some((step) => step.kind === 'choice')).toBe(true)
    expect(playerMovements(ascent.steps)).toMatchObject([{ actions: [{ direction: 'north' }, { direction: 'north' }] }])
    expect(ascent.steps[ascent.steps.findIndex((step) => step.kind === 'movement') + 1]).toMatchObject({ kind: 'waiting', waitFor: 'movement' })
    expect(ascent.state.player).toMatchObject({ x: waterfallX, z: ascent.startZ - 2, direction: 'north' })
  }, 120000)

  probe('formats every control code found in decoded ROM field dialogue banks', async () => {
    const inventory = await readProbeInventory()
    const state = createProbeFieldState(inventory, 155, 1)
    for (let index = 0; index < 16; index += 1) state.buffers.set(index, `BUF${index}`)
    const banks = new Set<Record<number, string>>()
    for (const map of inventory.resolvedMapCatalog.maps) {
      banks.add(map.messages)
      for (const bank of map.standardScriptBanks ?? []) banks.add(bank.messages)
      for (const messages of Object.values(map.externalMessages ?? {})) banks.add(messages)
    }
    for (const messages of inventory.trainerMessages.values()) banks.add(Object.fromEntries(messages))
    const unsupported = new Map<string, number>()
    let messageCount = 0
    for (const bank of banks) for (const message of Object.values(bank)) {
      messageCount += 1
      try {
        formatFieldMessage(message, state)
      } catch (error) {
        const control = /Controle de message HGSS ([0-9a-f]+)/i.exec(error instanceof Error ? error.message : String(error))?.[1] ?? 'mal-formé'
        unsupported.set(control, (unsupported.get(control) ?? 0) + 1)
      }
    }
    expect(messageCount).toBeGreaterThan(0)
    if (unsupported.size > 0) throw new Error(`Contrôles de dialogue ROM non pris en charge: ${JSON.stringify(Object.fromEntries(unsupported))}`)
  }, 120000)

  probe('reaches every decoded ROM NPC placed behind a native counter tile', async () => {
    const inventory = await readProbeInventory()
    const directions = [
      { direction: 'north' as const, dx: 0, dz: -1 },
      { direction: 'south' as const, dx: 0, dz: 1 },
      { direction: 'west' as const, dx: -1, dz: 0 },
      { direction: 'east' as const, dx: 1, dz: 0 },
    ]
    const arrangements: { map: OpeningMapPreview, objectId: number, playerX: number, playerZ: number, direction: typeof directions[number]['direction'] }[] = []
    for (const map of inventory.resolvedMapCatalog.maps) {
      if (!map.terrain) continue
      const origin = getMapOrigin(map)
      for (const object of map.events?.objects ?? []) {
        const objectX = object.x - origin.x
        const objectZ = object.z - origin.z
        for (const { direction, dx, dz } of directions) {
          const counterX = objectX - dx
          const counterZ = objectZ - dz
          const attribute = map.terrain.attributes[counterZ * map.terrain.width + counterX]
          const playerX = objectX - dx * 2
          const playerZ = objectZ - dz * 2
          if (counterX < 0 || counterZ < 0 || counterX >= map.terrain.width || counterZ >= map.terrain.height) continue
          if (playerX < 0 || playerZ < 0 || playerX >= map.terrain.width || playerZ >= map.terrain.height) continue
          if (((attribute ?? 0) & 0xff) !== 0x80) continue
          arrangements.push({ map, objectId: object.id, playerX, playerZ, direction })
        }
      }
    }

    expect(arrangements.length).toBeGreaterThan(0)
    for (const arrangement of arrangements) {
      const session = createWorldSession(inventory.resolvedMapCatalog.maps)
      session.loadMap(arrangement.map.id, arrangement.playerX, arrangement.playerZ, arrangement.direction)
      // Certains emplacements superposent plusieurs variantes du même PNJ,
      // masquées par des flags de quête différents. L'objet actif dépend de
      // la sauvegarde, mais la tuile de comptoir doit toujours atteindre un PNJ.
      expect(session.interact(), `${arrangement.map.label} (${arrangement.map.id}), objet ${arrangement.objectId}`).toMatchObject({ kind: 'npc' })
    }
  }, 120000)

  probe('completes the native Kurt and Slowpoke Well chain before opening Azalea Gym', async () => {
    const inventory = await readProbeInventory()
    const mapsById = new Map(inventory.resolvedMapCatalog.maps.map((map) => [map.id, map]))
    const azalea = mapsById.get(74)
    const kurtHouse = mapsById.get(164)
    const slowpokeWell = mapsById.get(177)
    if (!azalea || !kurtHouse || !slowpokeWell) throw new Error('Les cartes ROM de la quête d’Écorcia sont absentes.')

    const state = createProbeFieldState(inventory, 155, 1)
    state.flags.add(0x6a)
    state.followMonActive = true
    state.variables.set(0x4080, 1)
    setFieldScriptMapState(state, kurtHouse, 4, 5, 'north')
    const kurtWorld = createWorldSession(inventory.resolvedMapCatalog.maps, state.flags, state.hiddenObjectIds, state.variables, undefined, state.trainerFlags, () => state.dynamicWarp)
    kurtWorld.loadMap(kurtHouse.id, 4, 5, 'north')
    kurtWorld.setFollowerEnabled(true)
    kurtWorld.configureFollower(1, 0)

    const followerBehaviors: number[] = []
    const runQuestScript = (runner: FieldScriptRunner, world?: ReturnType<typeof createWorldSession>): void => {
      const choiceVisits = new Map<string, number>()
      for (let stepCount = 0; stepCount < 512; stepCount += 1) {
        const step = runner.resume()
        if (step.kind === 'ended') return
        if (step.kind === 'message') formatFieldMessage(step.text, state)
        if (step.kind === 'movement') world?.applyObjectMovement(step.objectId, step.actions, !state.followMonMovementPaused)
        if (step.kind === 'followerMovement' && step.action === 'movement') {
          const applied = world?.applyFollowerScriptMovement(step.movement)
          expect(applied?.movement.movementId).toBe(step.movement)
          followerBehaviors.push(step.movement)
        }
        handleInteractiveStep(runner, step, state, choiceVisits)
      }
      throw new Error('La chaîne de quête d’Écorcia ne termine pas son script ROM.')
    }

    const kurt = kurtHouse.events?.objects.find((object) => object.id === 0)
    if (!kurt) throw new Error('Fargas est absent de sa maison dans les événements ROM.')
    runQuestScript(createFieldScriptRunner(kurtHouse, kurt.scriptId, state, kurt.id), kurtWorld)
    expect(followerBehaviors).toEqual([56, 48])
    expect([0x77, 0x19e, 0x19f].filter((flag) => !state.flags.has(flag))).toEqual([])

    setFieldScriptMapState(state, slowpokeWell, 27, 4, 'south')
    const wellWorld = createWorldSession(inventory.resolvedMapCatalog.maps, state.flags, state.hiddenObjectIds, state.variables, undefined, state.trainerFlags, () => state.dynamicWarp)
    wellWorld.loadMap(slowpokeWell.id, 27, 4, 'south')
    wellWorld.setFollowerEnabled(true)
    wellWorld.configureFollower(0, 1)
    const proton = slowpokeWell.events?.objects.find((object) => object.id === 4)
    if (!proton) throw new Error('Proton est absent du Puits Ramoloss dans les événements ROM.')
    runQuestScript(createFieldScriptRunner(slowpokeWell, proton.scriptId, state, proton.id), wellWorld)

    expect(followerBehaviors).toEqual([56, 48, 55, 48])
    expect(state.flags.has(0x7b)).toBe(true)
    expect(state.flags.has(0x1a9)).toBe(true)
    expect(state.variables.get(0x4080)).toBe(2)

    const gymGuard = azalea.events?.objects.find((object) => object.id === 1)
    const gymWarp = azalea.events?.warps.find((warp) => warp.header === 136)
    expect(gymGuard).toMatchObject({ x: 405, z: 472, eventFlag: 0x1a9 })
    expect(gymWarp).toMatchObject({ x: 405, z: 471, header: 136 })

    const azaleaWorld = createWorldSession(inventory.resolvedMapCatalog.maps, state.flags, state.hiddenObjectIds, state.variables, undefined, state.trainerFlags, () => state.dynamicWarp)
    azaleaWorld.loadMap(azalea.id, 21, 25, 'north')
    expect(azaleaWorld.tryMove(0, -1, 'north')).toMatchObject({ state: { tileX: 21, tileZ: 24 } })
    expect(azaleaWorld.tryMove(0, -1, 'north')).toMatchObject({ warp: { kind: 'warp', header: 136, anchor: 0 } })
  }, 120000)

  probe("rejoue toute la quête ROM des deux Canarticho et remet Coupe", async () => {
    const inventory = await readProbeInventory()
    const ilex = inventory.resolvedMapCatalog.maps.find(({ id }) => id === 117)
    if (!ilex) throw new Error("La Forêt d'Ilex ROM est absente.")

    const state = createProbeFieldState(inventory, 155, 1)
    state.flags.add(0x7b) // FLAG_BEAT_AZALEA_ROCKETS
    setFieldScriptMapState(state, ilex, 25, 65, 'south')
    const world = createWorldSession(inventory.resolvedMapCatalog.maps, state.flags, state.hiddenObjectIds, state.variables, undefined, state.trainerFlags, () => state.dynamicWarp)
    world.loadMap(ilex.id, 25, 65, 'south')

    const runScript = (scriptId: number, actorId?: number): FieldScriptStep[] => {
      const runner = createFieldScriptRunner(ilex, scriptId, state, actorId)
      const steps: FieldScriptStep[] = []
      const choiceVisits = new Map<string, number>()
      for (let stepCount = 0; stepCount < 1024; stepCount += 1) {
        const step = runner.resume()
        steps.push(step)
        if (step.kind === 'message') formatFieldMessage(step.text, state)
        if (step.kind === 'movement') world.applyObjectMovement(step.objectId, step.actions, !state.followMonMovementPaused)
        if (step.kind === 'objectState') world.setObjectState(step.objectId, step.x, step.z, step.direction)
        if (step.kind === 'facePlayer' && step.objectId !== undefined) world.faceObjectAtPlayer(step.objectId)
        if (step.kind === 'warp') {
          world.scriptWarpTo(step.mapId, step.x, step.z, step.direction)
          setFieldScriptPlayerState(state, step.x, step.z, step.direction)
        }
        handleInteractiveStep(runner, step, state, choiceVisits)
        if (step.kind === 'ended') return steps
      }
      throw new Error(`Le script Canarticho ${scriptId} ne se termine pas.`)
    }

    // Le script d'initialisation ROM arme exactement les brindilles utiles.
    runScript(1)
    expect(state.variables.get(0x4099)).toBe(1)
    expect(state.variables.get(0x409a)).toBe(2)
    expect(state.variables.get(0x409c)).toBe(2)
    expect(state.variables.get(0x409e)).toBe(1)

    // Première brindille : le premier Canarticho regarde le bruit et expose son dos.
    runScript(4)
    expect(state.variables.get(0x4002)).toBe(1)
    expect(state.objects.get(0)).toMatchObject({ x: 25, z: 62, direction: 'south' })
    setFieldScriptPlayerState(state, 25, 61, 'south')
    world.setObjectState(255, 25, 61, 'south')
    runScript(2, 0)
    expect(state.flags.has(0x7d)).toBe(true)
    expect(state.flags.has(0x1a7)).toBe(true)

    // Le second fuit à droite ; la seconde brindille le tourne à l'est, puis
    // une interaction par l'ouest termine le puzzle comme sur la cartouche.
    setFieldScriptPlayerState(state, 41, 55, 'north')
    world.setObjectState(255, 41, 55, 'north')
    runScript(6, 2)
    expect(state.objects.get(2)).toMatchObject({ x: 49, z: 54, direction: 'west' })
    runScript(8)
    expect(state.variables.get(0x4003)).toBe(1)
    expect(state.objects.get(2)).toMatchObject({ x: 49, z: 54, direction: 'east' })
    setFieldScriptPlayerState(state, 48, 54, 'east')
    world.setObjectState(255, 48, 54, 'east')
    const finalSteps = runScript(6, 2)

    expect(finalSteps.some((step) => step.kind === 'warp' && step.mapId === ilex.id && step.x === 15 && step.z === 65)).toBe(true)
    expect(state.flags.has(0x7e)).toBe(true)
    expect(state.flags.has(0x1a8)).toBe(true)
    expect(state.flags.has(0x80)).toBe(true) // FLAG_GOT_HM01
    expect(state.inventory.get(420)).toBe(1) // ITEM_HM01
    expect([0x1ad, 0x1af, 0x1d3, 0x1d4].filter((flag) => !state.flags.has(flag))).toEqual([])
  }, 120000)

  probe('termine Coupe avec un Pokémon suiveur et active Force pour tous les rochers ROM', async () => {
    const inventory = await readProbeInventory()
    const route43 = inventory.resolvedMapCatalog.maps.find((map) => map.id === 45)
    const cutTree = route43?.events?.objects.find((object) => object.spriteId === 86 && object.scriptId === 10000)
    if (!route43 || !cutTree) throw new Error("L'arbre Coupe ROM de la Route 43 est absent.")

    const cut = traceRomTarget(inventory, route43, {
      kind: 'object', mapId: route43.id, mapLabel: route43.label, scriptId: cutTree.scriptId, actorId: cutTree.id,
    }, 1, (state) => {
      state.badges.add(1)
      state.followMonActive = true
      const pokemon = state.party.members[0]!
      const move = inventory.pokemonCatalog.moves[15]!
      pokemon.moves.push({ moveId: 15, pp: move.pp, maxPp: move.pp, ppUps: 0, data: move })
    })
    expect(cut.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'followerMovement', action: 'refresh' }),
      expect.objectContaining({ kind: 'fieldMoveEffect', mode: 3 }),
      expect.objectContaining({ kind: 'objectVisibility', objectId: cutTree.id, visible: false }),
      expect.objectContaining({ kind: 'ended' }),
    ]))
    expect(cut.state.hiddenObjectIds.has(cutTree.id)).toBe(true)

    const strengthHost = inventory.resolvedMapCatalog.maps.find((map) => map.events?.objects.some((object) => object.spriteId === 84 && object.scriptId === 10002))
    const strengthRock = strengthHost?.events?.objects.find((object) => object.spriteId === 84 && object.scriptId === 10002)
    if (!strengthHost || !strengthRock) throw new Error('Le rocher Force standard ROM est absent.')
    const strength = traceRomTarget(inventory, strengthHost, {
      kind: 'object', mapId: strengthHost.id, mapLabel: strengthHost.label, scriptId: strengthRock.scriptId, actorId: strengthRock.id,
    }, 1, (state) => {
      state.badges.add(2)
      const pokemon = state.party.members[0]!
      const move = inventory.pokemonCatalog.moves[70]!
      pokemon.moves.push({ moveId: 70, pp: move.pp, maxPp: move.pp, ppUps: 0, data: move })
    })
    expect(strength.steps.at(-1)).toEqual({ kind: 'ended' })
    expect(strength.state.flags.has(0x962)).toBe(true)
  }, 120000)

  probe("fait glisser et fusionner les vrais blocs de glace de l'arène d'Acajou", async () => {
    const inventory = await readProbeInventory()
    const gymEntrance = inventory.resolvedMapCatalog.maps.find((map) => map.id === 397)
    if (!gymEntrance) throw new Error("L'entrée ROM de l'arène d'Acajou est absente.")
    const world = createWorldSession(inventory.resolvedMapCatalog.maps)
    world.loadMap(gymEntrance.id, 4, 13, 'north')

    expect(world.tryMove(0, -1, 'north', { forced: true })).toMatchObject({
      kind: 'blocked',
      objectMovements: [
        { objectId: 0, kind: 'ice-block-slide', distance: 3, tileX: 4, tileZ: 9, finalDirection: 'north' },
        { objectId: 1, kind: 'ice-block-slide', distance: 0, tileX: 4, tileZ: 8, finalDirection: 'north' },
      ],
    })
    expect(world.findEventAt(4, 9)).toEqual({ kind: 'npc', id: 0, scriptId: 0 })
    expect(world.findEventAt(4, 8)).toEqual({ kind: 'npc', id: 1, scriptId: 0 })
  }, 120000)

  probe("reconstruit les douze voies Spinarak et les animations de l'Arène d'Écorcia depuis la ROM", async () => {
    const inventory = await readProbeInventory()
    const gym = inventory.resolvedMapCatalog.maps.find(({ id }) => id === 180)
    if (!gym) throw new Error("La carte ROM de l'Arène d'Écorcia est absente.")

    expect(gym.events?.coordinateEvents.map(({ scriptId, x, z }) => ({ scriptId, x, z }))).toEqual([
      { scriptId: 3, x: 3, z: 32 }, { scriptId: 4, x: 9, z: 32 }, { scriptId: 5, x: 15, z: 32 },
      { scriptId: 6, x: 3, z: 24 }, { scriptId: 7, x: 9, z: 24 }, { scriptId: 8, x: 15, z: 24 },
      { scriptId: 9, x: 3, z: 17 }, { scriptId: 10, x: 9, z: 17 }, { scriptId: 11, x: 15, z: 17 },
      { scriptId: 12, x: 3, z: 9 }, { scriptId: 13, x: 9, z: 9 }, { scriptId: 14, x: 15, z: 9 },
    ])
    expect(gym.model?.mapProps?.map(({ modelId }) => modelId)).toEqual([117, 117, 117, 116, 115, 122, 1])
    expect([115, 116, 117, 118, 122].map((modelId) =>
      inventory.mapPropAnimationMetadataResolver?.(modelId, 'room')?.animationArchiveIds,
    )).toEqual([[25, 26], [27, 28], [23, 24], [43], [41, 42]])
    const decodedAnimations: Array<{ modelId: number, archiveId: number, frames: number }> = []
    for (const modelId of [115, 116, 117, 118, 122]) {
      const archiveIds = inventory.mapPropAnimationMetadataResolver?.(modelId, 'room')?.animationArchiveIds ?? []
      expect(archiveIds.length).toBeGreaterThan(0)
      for (const archiveId of archiveIds) {
        decodedAnimations.push({
          modelId,
          archiveId,
          frames: inventory.mapPropAnimationResolver?.(modelId, gym.header.areaDataBank, archiveId, 'room')?.frames.length ?? 0,
        })
      }
    }
    expect(decodedAnimations.filter(({ frames }) => frames === 0)).toEqual([])
    expect(inventory.mapPropAnimationResolver?.(117, gym.header.areaDataBank, 23, 'room')?.frames.at(-1)?.surfaces?.[0]?.textureName).toBe('g2switch.1')
    expect(inventory.mapPropAnimationResolver?.(117, gym.header.areaDataBank, 24, 'room')?.frames.at(-1)?.surfaces?.[0]?.textureName).toBe('g2switch.2')
    expect(inventory.mapPropAnimationResolver?.(122, gym.header.areaDataBank, 41, 'room')?.frames.at(-1)?.surfaces?.[0]?.textureName).toBe('g2switch_r.1')
    expect(inventory.mapPropAnimationResolver?.(122, gym.header.areaDataBank, 42, 'room')?.frames.at(-1)?.surfaces?.[0]?.textureName).toBe('g2switch_r.2')

    const state = createProbeFieldState(inventory, 155, 1)
    setFieldScriptMapState(state, gym, 3, 32, 'north')
    const init = createFieldScriptRunner(gym, 17, state).resume()
    expect(init).toMatchObject({ kind: 'gymMechanism', gymType: 5, action: 'init', spiderNodes: [0, 1, 2, 7], switchState: 0 })
    const ride = createFieldScriptRunner(gym, 3, state).resume()
    expect(ride).toMatchObject({
      kind: 'gymMechanism',
      gymType: 5,
      action: 'rideSpinarak',
      parameter: 0,
      destination: { x: 9, z: 23, direction: 'north' },
      followerDestination: { x: 9, z: 24, direction: 'north' },
    })
    expect(ride.kind === 'gymMechanism' ? ride.ride?.route : undefined).toHaveLength(8)

    const simulatorState = createProbeFieldState(inventory, 155, 1)
    const simulator = createFieldInputSimulator(inventory.resolvedMapCatalog.maps, simulatorState, {
      mapId: gym.id,
      tileX: 9,
      tileZ: 36,
      direction: 'north',
    })
    for (let step = 0; step < 4; step += 1) simulator.input('up')
    expect(simulator.getWorld().getState()).toMatchObject({ tileX: 15, tileZ: 23, direction: 'north' })
    expect([...simulatorState.gymmick.data.subarray(0, 4)]).toEqual([0, 5, 2, 7])
  }, 120000)

  probe('executes the complete native Apricorn tree opcode family', async () => {
    const inventory = await readProbeInventory()
    const azalea = inventory.resolvedMapCatalog.maps.find((map) => map.id === 74)
    const tree = azalea?.events?.objects.find((object) => object.id === 10)
    if (!azalea || !tree) throw new Error("L'arbre Noigrume ROM d’Écorcia est absent.")
    const state = createProbeFieldState(inventory, 155, 1)
    state.inventory.set(468, 1)
    setFieldScriptMapState(state, azalea, 396, 454, 'north')
    const runner = createFieldScriptRunner(azalea, tree.scriptId, state, tree.id)
    const steps: FieldScriptStep[] = []
    const choiceVisits = new Map<string, number>()
    for (let stepCount = 0; stepCount < 128; stepCount += 1) {
      const step = runner.resume()
      steps.push(step)
      if (step.kind === 'message') formatFieldMessage(step.text, state)
      handleInteractiveStep(runner, step, state, choiceVisits)
      if (step.kind === 'ended') break
    }

    expect(steps).toContainEqual({ kind: 'apricornTree', objectId: 10, treeIndex: 30, apricornType: 5 })
    expect(state.apricornBox).toEqual([0, 0, 0, 0, 0, 1, 0])
    expect(state.harvestedApricornTrees.has(30)).toBe(true)
    expect(state.buffers.get(1)).toBe(azalea.externalMessages?.[21]?.[12])
    expect(steps.at(-1)).toEqual({ kind: 'ended' })
  }, 120000)

  probe('decodes the layered ROM assets used by the modernized Oak introduction', async () => {
    const inventory = await readProbeInventory()
    expect(inventory.introTopBackgroundGraphic).toBeDefined()
    expect(inventory.introOakSpriteGraphic).toBeDefined()
    expect(inventory.introGenderBackgroundGraphic).toBeDefined()
    expect(inventory.introBoyGraphic).toBeDefined()
    expect(inventory.introGirlGraphic).toBeDefined()
  }, 60_000)

  probe('decodes every native Ruins of Alph puzzle and hidden-room screen asset', async () => {
    const inventory = await readProbeInventory()
    expect(inventory.alphPuzzleTiles.map((tiles) => tiles.length)).toEqual([16, 16, 16, 16])
    expect(inventory.alphPuzzleTiles.flat().every((graphic) => graphic.width > 0 && graphic.height > 0)).toBe(true)
    // Les BG DS sont des tilemaps 32x32 (256x256), recadrées par l’écran 256x192.
    expect(inventory.alphPuzzleBackground).toMatchObject({ width: 256, height: 256 })
    expect(inventory.alphPuzzleHints.every((hint) => hint.length > 0)).toBe(true)
    expect(inventory.alphHiddenRoomBackground).toMatchObject({ width: 256, height: 256 })
    expect(inventory.alphHiddenRoomWords).toHaveLength(4)
    expect(inventory.alphHiddenRoomWords.every((word) => word.length > 0)).toBe(true)
  }, 300_000)

  probe('executes the ROM new-game init script and sets its 143 visibility flags', async () => {
    const inventory = await readProbeInventory()
    const startMap = inventory.resolvedMapCatalog.maps.find((map) => map.id === inventory.resolvedMapCatalog.startMapId)
    if (!startMap) throw new Error('Carte de depart ROM absente du catalogue.')
    const state = createProbeFieldState(inventory)

    initializeNewGameFieldScriptState(startMap, state)

    // scr_seq_0149 contient exactement 143 SetFlag distincts dans la ROM FR.
    expect(state.flags.size).toBe(143)
    expect(state.money).toBe(3000)
  }, 60_000)

  probe('completes Professor Elm healing with a fade back to the overworld', async () => {
    const inventory = await readProbeInventory()
    const map = inventory.resolvedMapCatalog.maps.find((candidate) => candidate.id === 61)
    expect(map).toBeDefined()
    if (!map) return
    const state = createProbeFieldState(inventory, 155, 1)
    state.flags.add(0x6a)
    const runner = createFieldScriptRunner(map, 14, state, 0)
    const fadeTypes: number[] = []
    for (let steps = 0; steps < 128; steps += 1) {
      const step = runner.resume()
      if (step.kind === 'choice') runner.choose(0)
      if (step.kind === 'screenFade') fadeTypes.push(step.type)
      if (step.kind === 'ended') break
    }
    expect(fadeTypes).toEqual([0, 1])
    expect(runner.resume()).toEqual({ kind: 'ended' })
  }, 60000)

  probe('completes the Elm lab starter script for native and transformed NG+ story identities', async () => {
    const inventory = await readProbeInventory()
    const map = inventory.resolvedMapCatalog.maps.find((candidate) => candidate.id === 61)
    expect(map).toBeDefined()
    if (!map) return
    const starterBall = map.events?.backgrounds.find((background) => background.x === 8 && background.z === 4)
    expect(starterBall).toBeDefined()
    if (!starterBall) return
    for (const expected of [
      { choice: 0, speciesId: 152, name: 'GERMIGNON', label: 'GERMIGNON natif', transformed: false },
      { choice: 1, speciesId: 155, name: 'HERICENDRE', label: 'HERICENDRE natif', transformed: false },
      { choice: 2, speciesId: 158, name: 'KAIMINUS', label: 'KAIMINUS natif', transformed: false },
      { choice: 1, speciesId: 254, name: 'HERICENDRE', label: 'starter NG+ 254', transformed: true },
      { choice: 1, speciesId: 133, name: 'HERICENDRE', label: 'Équipe Évoli NG+ 133', transformed: true },
      { choice: 1, speciesId: 152, name: 'HERICENDRE', label: 'Solo Monotype NG+ 152', transformed: true },
    ]) {
      const state = createProbeFieldState(inventory)
      state.flags.add(0x160)
      setFieldScriptMapState(state, map, 8, 5, 'north')
      projectFieldScriptState(createFieldScriptRunner(map, 11, state))
      const initialTeamResolver: PokemonInitialTeamResolver | undefined = expected.transformed
        ? ((request) => Object.freeze([Object.freeze({ ...request.baseDefinition, speciesId: expected.speciesId })]))
        : undefined
      const runner = createFieldScriptRunner(map, starterBall.scriptId, state, undefined, undefined, undefined, initialTeamResolver)
      let starterSelected = false
      let ended = false
      const renderedMessages: string[] = []
      const followerSteps: FieldScriptStep[] = []
      for (let steps = 0; steps < 256; steps += 1) {
        const step = runner.resume()
        if (step.kind === 'message') renderedMessages.push(formatFieldMessage(step.text, state))
        if (step.kind === 'followerMovement' || (step.kind === 'waiting' && step.waitFor === 'followerMovement')) followerSteps.push(step)
        if (step.kind === 'choice') {
          runner.choose(starterSelected ? step.options[0]?.value ?? 0 : expected.choice)
          starterSelected = true
        }
        if (step.kind === 'number') runner.enterNumber(step.min)
        if (step.kind === 'nickname') runner.enterNickname('PROBE')
        if (step.kind === 'eggHatch') runner.finishEggHatch(undefined)
        if (step.kind === 'ended') {
          ended = true
          break
        }
      }
      expect(state.followMonActive).toBe(true)
      expect(followerSteps).toEqual([
        { kind: 'followerMovement', action: 'configure', parameters: [3, 2] },
        { kind: 'followerMovement', action: 'pause', paused: false },
        { kind: 'followerMovement', action: 'refresh' },
        { kind: 'followerMovement', action: 'pause', paused: true },
        { kind: 'followerMovement', action: 'pause', paused: false },
        { kind: 'waiting', waitFor: 'followerMovement' },
        { kind: 'followerMovement', action: 'movement', movement: 55 },
        { kind: 'waiting', waitFor: 'followerMovement' },
        { kind: 'followerMovement', action: 'pause', paused: true },
        { kind: 'followerMovement', action: 'movement', movement: 48 },
      ])

      expect(ended, expected.label).toBe(true)
      expect(state.party.members.map((pokemon) => pokemon.speciesId), expected.label).toEqual([expected.speciesId])
      expect(state.starterStorySpeciesId, expected.label).toBe(expected.speciesId)
      expect(state.party.members[0]?.nickname, expected.label).toBe('PROBE')
      if (!expected.transformed) {
        expect(renderedMessages.some((message) => message.includes(expected.name)), expected.label).toBe(true)
      }
      expect(state.flags.has(0x6a), expected.label).toBe(true)
      expect(state.flags.has(0x160), expected.label).toBe(false)
      expect(state.variables.get(0x4108), expected.label).toBe(1)
      expect(state.variables.get(0x4072), expected.label).toBe(1)
      expect(state.mapProps, expected.label).toHaveLength(2)
      expect(state.player, expected.label).toMatchObject({ x: 4, z: 7, direction: 'north' })
      expect(state.objects.get(0), expected.label).toMatchObject({ x: 4, z: 5, direction: 'south' })
    }
  }, 60000)

  probe('executes Bourg Geon follower activity and movement pause commands from the ROM', async () => {
    const inventory = await readProbeInventory()
    const map = inventory.resolvedMapCatalog.maps.find((candidate) => candidate.id === 60)
    expect(map).toBeDefined()
    if (!map) return

    for (const expected of [
      { speciesId: undefined, active: 0 },
      { speciesId: 155, active: 1 },
    ]) {
      const state = createProbeFieldState(inventory, expected.speciesId, expected.speciesId === undefined ? undefined : 1)
      if (expected.active === 1) state.flags.add(0x6a)
      setFieldScriptMapState(state, map, 688, 392, 'south')
      const runner = createFieldScriptRunner(map, 11, state)
      let result: 'ended' | undefined
      for (let steps = 0; steps < 32; steps += 1) {
        const step = runner.resume()
        handleInteractiveStep(runner, step, state)
        if (step.kind === 'ended') {
          result = 'ended'
          break
        }
      }
      expect(result).toBe('ended')
      expect(state.followMonActive).toBe(expected.active === 1)
      const followerModelIndex = expected.speciesId === undefined
        ? undefined
        : inventory.pokemonCatalog.followers.modelIndexBySpecies[expected.speciesId]
      const followerParameter = followerModelIndex === undefined
        ? undefined
        : inventory.pokemonCatalog.followers.parameters[followerModelIndex]
      expect(state.variables.get(0x800c)).toBe(followerParameter ? (followerParameter.values[1] >> 8) & 0x0f : 0)
    }

    const state = createProbeFieldState(inventory, 155, 1)
  state.flags.add(0x6a)
    state.followMonMovementPaused = true
    setFieldScriptMapState(state, map, 700, 398, 'south')
    const runner = createFieldScriptRunner(map, 13, state)
    let followerWaitObserved = false
    for (let steps = 0; steps < 64; steps += 1) {
      const step = runner.resume()
      handleInteractiveStep(runner, step, state)
      if (step.kind === 'waiting' && step.waitFor === 'followerMovement') {
        followerWaitObserved = true
        break
      }
      if (step.kind === 'ended') break
    }

    expect(followerWaitObserved).toBe(true)
    expect(state.followMonMovementPaused).toBe(false)
  }, 60000)

  probe('executes the native standard follower interaction script 9700', async () => {
    const inventory = await readProbeInventory()
    const map = inventory.resolvedMapCatalog.maps.find((candidate) => candidate.id === 60)
    expect(map).toBeDefined()
    if (!map) return

    const state = createProbeFieldState(inventory, 155, 1)
    state.flags.add(0x6a)
    setFieldScriptMapState(state, map, 676, 398, 'south')
    const runner = createFieldScriptRunner(map, 9700, state)

    expect(runner.resume()).toEqual({ kind: 'soundEffect', action: 'play', sequenceId: 1500 })
    expect(runner.resume()).toEqual({ kind: 'followerMovement', action: 'facePlayer' })
    expect(runner.resume()).toEqual({ kind: 'followerInteraction', slot: 0, speciesId: 155 })
    expect(runner.resume()).toEqual({ kind: 'ended' })
  }, 60000)

  probe('runs a native trainer sight encounter through approach, battle, and defeat flag', async () => {
    const inventory = await readProbeInventory()
    const state = createProbeFieldState(inventory, 155, 1)
    const session = createWorldSession(
      inventory.resolvedMapCatalog.maps,
      state.flags,
      state.hiddenObjectIds,
      state.variables,
      undefined,
      state.trainerFlags,
    )
    const directionDeltas = {
      north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0],
    } as const
    const directions = ['north', 'south', 'west', 'east'] as const
    let selected: {
      map: OpeningMapPreview
      tileX: number
      tileZ: number
      engagement: ReturnType<typeof session.findEngagingTrainers>[number]
    } | undefined

    for (const map of inventory.resolvedMapCatalog.maps) {
      const origin = getMapOrigin(map)
      for (const object of map.events?.objects ?? []) {
        const trainerId = object.scriptId < 5000 ? object.scriptId - 2999 : object.scriptId - 4999
        if (trainerId < 1 || trainerId > 740 || (object.parameters?.[0] ?? 0) < 1) continue
        const candidateDirections = object.type === 2
          ? directions
          : object.type === 1 || (object.type >= 4 && object.type <= 8)
            ? [directions[object.facingDirection] ?? 'south']
            : []
        for (const direction of candidateDirections) {
          const [deltaX, deltaZ] = directionDeltas[direction]
          const tileX = object.x + deltaX - origin.x
          const tileZ = object.z + deltaZ - origin.z
          if (!session.loadMap(map.id, tileX, tileZ, 'south')) continue
          const engagement = session.findEngagingTrainers().find((candidate) => candidate.objectId === object.id)
          if (!engagement) continue
          selected = { map, tileX, tileZ, engagement }
          break
        }
        if (selected) break
      }
      if (selected) break
    }

    expect(selected).toBeDefined()
    if (!selected) return
    expect(hasFieldScript(selected.map, 3739)).toBe(true)
    setFieldScriptMapState(state, selected.map, selected.tileX, selected.tileZ, 'south')
    state.engagedTrainers = [{
      objectId: selected.engagement.objectId,
      trainerId: selected.engagement.trainerId,
      direction: selected.engagement.direction,
      distance: selected.engagement.distance,
      encounterType: selected.engagement.encounterType,
    }]
    const runner = createFieldScriptRunner(selected.map, 3739, state, selected.engagement.objectId)
    let battleTrainerId: number | undefined
    let ended = false
    for (let steps = 0; steps < 128; steps += 1) {
      const step = runner.resume()
      if (step.kind === 'movement') session.applyObjectMovement(step.objectId, step.actions)
      if (step.kind === 'battle' && step.battle.kind === 'trainer') battleTrainerId = step.battle.trainerId
      handleInteractiveStep(runner, step, state)
      if (step.kind === 'ended') {
        ended = true
        break
      }
    }

    expect(battleTrainerId).toBe(selected.engagement.trainerId)
    expect(ended).toBe(true)
    expect(state.trainerFlags.has(selected.engagement.trainerId)).toBe(true)
  }, 60000)

  probe('emits the complete Elm lab tag-77 door cycle from the reachable west-exit event', async () => {
    const inventory = await readProbeInventory()
    const map = inventory.resolvedMapCatalog.maps.find((candidate) => candidate.id === 60)
    expect(map).toBeDefined()
    if (!map) return
    const coordinate = map.events?.coordinateEvents.find((event) => event.x === 676 && event.z === 396)
    expect(coordinate).toBeDefined()
    if (!coordinate) return

    const state = createProbeFieldState(inventory, 155, 1)
    state.flags.add(0x6a)
    state.flags.add(0x9c)
    state.variables.set(coordinate.variableId, coordinate.expectedValue)
    setFieldScriptMapState(state, map, 676, 396, 'west')
    const runner = createFieldScriptRunner(map, coordinate.scriptId, state)
    const doorSteps: FieldScriptStep[] = []
    for (let steps = 0; steps < 1024 && doorSteps.length < 6; steps += 1) {
      const step = runner.resume()
      if (step.kind === 'doorAnimation') doorSteps.push(step)
      handleInteractiveStep(runner, step, state)
      if (step.kind === 'ended') break
    }

    expect(doorSteps).toEqual([
      { kind: 'doorAnimation', action: 'setup', tag: 77, worldX: 684, worldZ: 393 },
      { kind: 'doorAnimation', action: 'play', tag: 77, animationIndex: 0 },
      { kind: 'doorAnimation', action: 'wait', tag: 77 },
      { kind: 'doorAnimation', action: 'play', tag: 77, animationIndex: 1 },
      { kind: 'doorAnimation', action: 'wait', tag: 77 },
      { kind: 'doorAnimation', action: 'unload', tag: 77 },
    ])
  }, 60000)

  probe('keeps the potion assistant on the ROM path and returns it to its lab spawn', async () => {
    const inventory = await readProbeInventory()
    const map = inventory.resolvedMapCatalog.maps.find((candidate) => candidate.id === 61)
    expect(map).toBeDefined()
    if (!map) return

    for (const playerX of [3, 4, 5, 6]) {
      const state = createProbeFieldState(inventory, 155, 1)
      setFieldScriptMapState(state, map, playerX, 11, 'south')
      const runner = createFieldScriptRunner(map, 4, state)
      const movements: Extract<FieldScriptStep, { kind: 'movement' }>[] = []
      for (let steps = 0; steps < 128; steps += 1) {
        const step = runner.resume()
        if (step.kind === 'movement') movements.push(step)
        if (step.kind === 'message') formatFieldMessage(step.text, state)
        if (step.kind === 'choice') runner.choose(step.options.at(-1)?.value ?? 0)
        if (step.kind === 'ended') break
      }

      expect(movements.map((movement) => movement.objectId), `colonne ${playerX}`).toEqual([2, 2])
      expect(movements[0]?.actions.find((action) => action.kind === 'walk'), `colonne ${playerX}`).toMatchObject({
        direction: 'west',
        repetitions: 9 - playerX,
      })
      expect(movements[1]?.actions.find((action) => action.kind === 'walk'), `colonne ${playerX}`).toMatchObject({
        direction: 'east',
        repetitions: 9 - playerX,
      })
      expect(state.objects.get(2), `colonne ${playerX}`).toMatchObject({ x: 9, z: 12, direction: 'west' })
      expect(state.variables.get(0x4108), `colonne ${playerX}`).toBe(2)
    }
  }, 60000)

  probe('steps through Bourg Geon object script 6 past PlayCry', async () => {
    const inventory = await readProbeInventory()
    const map = inventory.resolvedMapCatalog.maps.find((candidate) => candidate.id === 60)
    expect(map).toBeDefined()
    if (process.env.REPORT_WORLD_SURFACES === '1') {
      const names = [...new Set((map?.model?.surfaces ?? []).map((surface) => `${surface.materialName ?? '-'} | ${surface.textureName ?? '-'}`))]
      console.log(JSON.stringify(names, null, 2))
      const rotors = (map?.model?.surfaces ?? []).filter((surface) => /wind/.test(`${surface.materialName ?? ''} ${surface.textureName ?? ''}`))
        .map((surface) => {
          const values = surface.positions
          const min = [Infinity, Infinity, Infinity]
          const max = [-Infinity, -Infinity, -Infinity]
          for (let index = 0; index < values.length; index += 3) {
            for (let axis = 0; axis < 3; axis += 1) {
              min[axis] = Math.min(min[axis], values[index + axis])
              max[axis] = Math.max(max[axis], values[index + axis])
            }
          }
          return { material: surface.materialName, texture: surface.textureName, min, max }
        })
      console.log(JSON.stringify(rotors, null, 2))
    }
    if (process.env.REPORT_WORLD_AUDIT === '1') {
      const audit = inventory.resolvedMapCatalog.maps
        .filter((candidate) => usesWorldMatrixCoordinates(candidate) && candidate.id >= 60 && candidate.id <= 66)
        .map((candidate) => {
          const terrainCounts = new Map<number, number>()
          for (const attribute of candidate.terrain?.attributes ?? []) terrainCounts.set(attribute, (terrainCounts.get(attribute) ?? 0) + 1)
          let groundTiles = 0
          let decorativeOnlyTiles = 0
          const bounds = getMapTileBounds(candidate)
          if (bounds) {
            for (let z = bounds.minZ; z < bounds.maxZ; z += 1) for (let x = bounds.minX; x < bounds.maxX; x += 1) {
              if (getMapGroundHeights(candidate, x, z)?.length) groundTiles += 1
              else if (hasMapDecorativeSurfaceAt(candidate, x, z)) decorativeOnlyTiles += 1
            }
          }
          return {
            id: candidate.id,
            label: candidate.label,
            matrix: `${candidate.matrix.width}x${candidate.matrix.height}`,
            bounds,
            terrainValues: [...terrainCounts.entries()].sort((left, right) => right[1] - left[1]).slice(0, 12),
            groundTiles,
            decorativeOnlyTiles,
            movementSurfaces: candidate.model?.surfaces?.filter((surface) => surface.supportsMovement !== false).length ?? 0,
            decorativeSurfaces: candidate.model?.surfaces?.filter((surface) => surface.supportsMovement === false).length ?? 0,
          }
        })
      console.log(JSON.stringify(audit, null, 2))
    }
    if (process.env.REPORT_REACHABLE_MAPS === '1') {
      console.log(JSON.stringify(inventory.resolvedMapCatalog.maps.map((candidate) => ({
        id: candidate.id,
        label: candidate.label,
        connected: candidate.connectedMapIds,
        fieldScripts: candidate.fieldScripts.entryOffsets.length,
        events: {
          warps: candidate.events?.warps.length ?? 0,
          objects: candidate.events?.objects.length ?? 0,
          coordinates: candidate.events?.coordinateEvents.length ?? 0,
        },
      })), null, 2))
    }
    if (process.env.REPORT_START_ROUTE === '1') {
      console.log(JSON.stringify(inventory.resolvedMapCatalog.maps
        .filter((candidate) => [126, 127, 177, 178].includes(candidate.header.mapSection))
        .map((candidate) => ({
          id: candidate.id,
          label: candidate.label,
          section: candidate.header.mapSection,
          scripts: candidate.fieldScripts.entryOffsets.length,
          events: candidate.events,
        })), null, 2))
    }
    if (process.env.REPORT_ROUTE_SCRIPT_RESULTS === '1') {
      const routes = inventory.resolvedMapCatalog.maps.filter((candidate) => candidate.id === 33 || candidate.id === 34)
      console.log(JSON.stringify(routes.flatMap((candidate) => collectTargets(candidate).map((target) => probeScript(inventory, candidate, target))), null, 2))
    }
    const result = probeScript(inventory, map!, {
      kind: 'object',
      mapId: 60,
      mapLabel: map!.label,
      scriptId: 6,
      actorId: 3,
    })

    if (writeProbeReports) await writeFile(targetReportPath, JSON.stringify(result, null, 2))
    if (result.status === 'unsupported-opcode' && result.opcode === 76) {
      throw new Error(JSON.stringify(result, null, 2))
    }
    expect(result.status === 'unsupported-opcode' ? result.opcode : undefined).not.toBe(76)
  }, 120000)

  probe('advances the native Ville Griotte guide-tour variable after the west entrance scene', async () => {
    const inventory = await readProbeInventory()
    const map = inventory.resolvedMapCatalog.maps.find((candidate) => candidate.id === 67)
    expect(map?.events?.coordinateEvents.find((event) => event.scriptId === 2)).toMatchObject({
      variableId: 16499,
      expectedValue: 0,
    })
    if (!map) throw new Error('Ville Griotte (67) absente de la ROM.')
    const state = createProbeFieldState(inventory, 155, 1)
    setFieldScriptMapState(state, map, 566, 397, 'north')
    const runner = createFieldScriptRunner(map, 2, state)
    const choiceVisits = new Map<string, number>()
    for (let stepCount = 0; stepCount < 512; stepCount += 1) {
      const step = runner.resume()
      if (step.kind === 'ended') break
      handleInteractiveStep(runner, step, state, choiceVisits)
    }

    expect(state.variables.get(16499)).not.toBe(0)
  }, 120000)

  probe('opens and completes Orme’s ROM phone call after leaving Mr Pokémon', async () => {
    const inventory = await readProbeInventory()
    const map = inventory.resolvedMapCatalog.maps.find((candidate) => candidate.id === 34)
    if (!map) throw new Error('Route 30 (34) absente de la ROM.')
    const selectionState = createProbeFieldState(inventory, 155, 1)
    for (const [variable, value] of [[16499, 3], [16524, 2], [16647, 1], [16648, 3], [16498, 2]] as const) selectionState.variables.set(variable, value)
    const scriptIds = resolveMapFrameScripts(map.initScripts, (variable) => selectionState.variables.get(variable) ?? 0)
    const traces = scriptIds.map((scriptId) => {
      const state = createProbeFieldState(inventory, 155, 1)
      for (const [variable, value] of [[16499, 3], [16524, 2], [16647, 1], [16648, 3], [16498, 2]] as const) {
        state.variables.set(variable, value)
      }
      for (const flag of [408, 680, 679, 1088, 591, 109, 1056, 107, 405, 790, 400, 238]) state.flags.add(flag)
      setFieldScriptMapState(state, map, 8, 8, 'south')
      const runner = createFieldScriptRunner(map, scriptId, state)
      const steps: FieldScriptStep[] = []
      for (let count = 0; count < 64; count += 1) {
        const step = runner.resume()
        steps.push(step)
        if (step.kind === 'ended') break
      }
      return { scriptId, steps, pendingPhoneCall: state.pendingPhoneCall }
    })
    expect(scriptIds).toEqual([2])
    expect(traces[0]?.pendingPhoneCall).toEqual({ callerId: 1, parameter1: 2, parameter2: 0 })
    expect(traces[0]?.steps).toContainEqual({
      kind: 'phoneCall',
      call: { callerId: 1, parameter1: 2, parameter2: 0 },
    })
    expect(traces[0]?.steps.at(-1)).toEqual({ kind: 'ended' })
    expect(inventory.phoneContactMessages[1]?.[33]).toContain('Reviens vite!')
  }, 120000)

  probe('launches the Mauville ON_FRAME scene immediately after leaving with Togepi’s egg', async () => {
    const inventory = await readProbeInventory()
    const shop = inventory.resolvedMapCatalog.maps.find((candidate) => candidate.id === 157)
    if (!shop) throw new Error('La Boutique Pokémon de Mauville (157) est absente de la ROM.')
    const state = createProbeFieldState(inventory, 158, 2, 16)
    state.flags.add(0x6a)
    state.flags.add(407)
    state.variables.set(16500, 3)
    const simulator = createFieldInputSimulator(inventory.resolvedMapCatalog.maps, state, {
      mapId: shop.id,
      tileX: 4,
      tileZ: 10,
      direction: 'south',
    })
    // Reproduit les résidus exacts visibles dans le rapport : ils doivent être
    // libérés par la transition libre avant le script de la carte destination.
    state.variables.set(0x8000, 751)
    state.variables.set(0x800d, 4)
    state.followMonMovementPaused = true
    state.pendingPhoneCall = { callerId: 0, parameter1: 2, parameter2: 0 }

    const events = [...simulator.input('down')]
    for (let count = 0; simulator.hasActiveScript() && count < 32; count += 1) {
      events.push(...(simulator.isWaitingForInput() ? simulator.input('confirm') : simulator.settle()))
    }

    expect(simulator.getWorld().getState()).toMatchObject({ map: { id: 73 }, tileX: 21, tileZ: 34 })
    expect(events).toContainEqual(expect.objectContaining({ kind: 'message', messageId: 13 }))
    expect(events).toContainEqual(expect.objectContaining({ kind: 'message', messageId: 16 }))
    expect(state.variables.get(16500)).toBe(4)
    expect(state.variables.has(0x8000)).toBe(false)
    expect(state.variables.has(0x800d)).toBe(false)
    expect(state.followMonMovementPaused).toBe(false)
    expect(state.pendingPhoneCall).toBeUndefined()
    expect(simulator.hasActiveScript()).toBe(false)
  }, 120000)

  probe('completes Wade’s native number-registration dialogue and stores the contact once', async () => {
    const inventory = await readProbeInventory()
    const map = inventory.resolvedMapCatalog.maps.find((candidate) => candidate.id === 35)
    if (!map) throw new Error('Route 31 (35) absente de la ROM.')
    const wade = map.events?.objects.find((object) => object.scriptId === 3003)
    expect(wade).toBeDefined()
    if (!wade) return

    const state = createProbeFieldState(inventory, 155, 1)
    state.trainerFlags.add(4)
    setFieldScriptMapState(state, map, wade.x, wade.z - 1, 'south')
    const runner = createFieldScriptRunner(map, wade.scriptId, state, wade.id)
    const steps: FieldScriptStep[] = []
    const choiceVisits = new Map<string, number>()
    for (let count = 0; count < 128; count += 1) {
      const step = runner.resume()
      steps.push(step)
      if (step.kind === 'message') formatFieldMessage(step.text, state)
      handleInteractiveStep(runner, step, state, choiceVisits)
      if (step.kind === 'ended') break
    }

    expect(steps).toContainEqual({ kind: 'fanfare', action: 'play', sequenceId: 1206 })
    expect(steps).toContainEqual({ kind: 'fanfare', action: 'wait' })
    expect(steps.some((step) => step.kind === 'message' && step.messageId === 101)).toBe(true)
    expect([...state.phoneContacts]).toEqual([0, 13])
    expect(steps.at(-1)).toEqual({ kind: 'ended' })

    // SavePokegear_RegisterPhoneNumber is idempotent: replaying a malformed
    // legacy path cannot append Wade a second time or move his slot.
    const duplicateRunner = createFieldScriptRunner(map, wade.scriptId, state, wade.id)
    for (let count = 0; count < 64; count += 1) {
      const step = duplicateRunner.resume()
      handleInteractiveStep(duplicateRunner, step, state, new Map())
      if (step.kind === 'ended') break
    }
    expect([...state.phoneContacts]).toEqual([0, 13])
  }, 120000)

  probe('reports unsupported opcodes reachable from resolved ROM map scripts', async () => {
    const inventory = await readProbeInventory()
    const maps = inventory.resolvedMapCatalog.maps
      .filter((map) => openingMapIds.has(map.id))
      .sort((left, right) => left.id - right.id)
    const results = maps.flatMap((map) => collectTargets(map).map((target) => probeScript(inventory, map, target)))
    const unsupported = results.filter((result) => result.status === 'unsupported-opcode')
    const failures = results.filter((result) => result.status === 'error')

    const report = {
      scannedScripts: results.length,
      unsupported,
      failures,
    }
    if (writeProbeReports) await writeFile(reportPath, JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
    if (unsupported.length > 0 || failures.length > 0) {
      const summary = {
        scannedScripts: report.scannedScripts,
        unsupportedOpcodes: unsupported.slice(0, 20).map((result) => ({
          opcode: result.opcode,
          target: result.target,
          error: result.error,
        })),
        failureExamples: failures.slice(0, 10),
      }
      throw new Error(JSON.stringify(summary, null, 2))
    }

    expect(results.length).toBeGreaterThan(0)
  }, 120000)

  probe('executes every decoded endpoint of the sixteen badge gyms through all menu paths', async () => {
    const inventory = await readProbeInventory()
    const mapsById = new Map(inventory.resolvedMapCatalog.maps.map((map) => [map.id, map]))
    const strategies: readonly ProbeChoiceStrategy[] = ['service-cycle', 'last-option', 'cancel']
    const results = hgssAllGymMapIds.flatMap((mapId) => {
      const map = mapsById.get(mapId)
      if (!map) throw new Error(`L’arène ROM ${mapId} est absente.`)
      return collectTargets(map).flatMap((target) => strategies.map((strategy) => probeScript(inventory, map, target, 2048, strategy)))
    })
    const failures = results.filter(({ status }) => status !== 'ok')
    expect(failures, JSON.stringify({ checkedPaths: results.length, failures }, null, 2)).toEqual([])
    expect(results.length).toBeGreaterThan(0)
  }, 180000)

  probe('permits the real Acajou gym ice tile 0x8020 reported as blocked in bug reports', async () => {
    const inventory = await readProbeInventory()
    const map = inventory.resolvedMapCatalog.maps.find((candidate) => candidate.id === 396)
    if (!map?.terrain) throw new Error("La carte ROM de l'arène d'Acajou est absente.")

    const targetX = 8
    const targetZ = 12
    expect(map.terrain.attributes[targetZ * map.terrain.width + targetX]).toBe(0x8020)

    const session = createWorldSession([map])
    session.loadMap(map.id, 9, 12, 'west')

    expect(session.tryMove(-1, 0, 'west')).toMatchObject({
      kind: 'moved',
      state: { tileX: targetX, tileZ: targetZ },
      continuationDirection: 'west',
    })
  }, 120000)

  probe('plays the native Radio Tower disguise reveal before the stair warp on scene 3', async () => {
    const inventory = await readProbeInventory()
    const map = inventory.resolvedMapCatalog.maps.find((candidate) => candidate.id === 112)
    if (!map) throw new Error('La carte ROM 112 de la Tour Radio est absente.')

    const state = createProbeFieldState(inventory, 155, 1)
    state.flags.add(0x969)
    state.playerState = 3
    state.followMonActive = true
    state.variables.set(16503, 3)
    setFieldScriptMapState(state, map, 22, 5, 'east')

    const transition = createFieldScriptMapInitSequenceRunner(map, state, 'transition')
    if (transition) {
      for (let stepCount = 0; stepCount < 128; stepCount += 1) {
        const step = transition.resume()
        handleInteractiveStep(transition, step, state)
        if (step.kind === 'ended') break
      }
    }
    expect(state.flags.has(440)).toBe(true)
    expect(state.flags.has(444)).toBe(false)

    const simulator = createFieldInputSimulator(inventory.resolvedMapCatalog.maps, state, {
      mapId: 112,
      tileX: 22,
      tileZ: 5,
      direction: 'east',
    })

    const transcript: Array<{ kind: string, messageId?: number }> = []
    const record = (events: ReadonlyArray<{ kind: string, messageId?: number }>) => {
      for (const event of events) transcript.push({ kind: event.kind, messageId: event.messageId })
    }
    const drain = (): void => {
      for (let count = 0; count < 64; count += 1) {
        if (simulator.isWaitingForInput()) record(simulator.input('confirm'))
        else if (simulator.hasActiveScript()) record(simulator.settle())
        else break
      }
    }

    record(simulator.input('confirm'))
    drain()
    expect(state.objects.get(6)).toMatchObject({ x: 23, z: 6, direction: 'west' })

    record(simulator.input('right'))
    drain()
    expect(simulator.getWorld().getState()).toMatchObject({ map: { id: 112 }, tileX: 23, tileZ: 5 })
    expect(transcript.some((event) => event.kind === 'movement')).toBe(true)
    expect(transcript.some((event) => event.kind === 'message' && event.messageId === 21)).toBe(true)
  }, 120000)

  probe('replays the Ice Path old-man interaction and follow-up coordinate script from the latest report state', async () => {
    const inventory = await readProbeInventory()
    const map = inventory.resolvedMapCatalog.maps.find((candidate) => candidate.id === 120)
    if (!map) throw new Error('La carte ROM 120 de la Route de Glace est absente.')

    const nearbyObjects = (map.events?.objects ?? [])
      .filter((object) => Math.abs(object.x - 46) <= 2 && Math.abs(object.z - 7) <= 3)
      .map((object) => ({
        id: object.id,
        scriptId: object.scriptId,
        eventFlag: object.eventFlag,
        x: object.x,
        z: object.z,
        facingDirection: object.facingDirection,
        movement: object.movement,
      }))
    const nearbyCoordinates = (map.events?.coordinateEvents ?? [])
      .filter((event) => Math.abs(event.x - 46) <= 2 && Math.abs(event.z - 7) <= 3)
    const tracedNpc = traceRomTarget(inventory, map, { kind: 'object', mapId: map.id, mapLabel: map.label, scriptId: 1, actorId: 1 }, 2, (probeState) => {
      probeState.followMonActive = true
      setFieldScriptMapState(probeState, map, 46, 7, 'east')
    }).steps.slice(0, 10).map((step) => {
      if (step.kind === 'movement') return { kind: step.kind, objectId: step.objectId, actions: step.actions.map((action) => action.kind) }
      if (step.kind === 'message') return { kind: step.kind, messageId: step.messageId }
      return { kind: step.kind }
    })

    const state = createProbeFieldState(inventory, 158, 2, 35)
    state.followMonActive = true
    setFieldScriptMapState(state, map, 46, 7, 'east')
    const simulator = createFieldInputSimulator(inventory.resolvedMapCatalog.maps, state, {
      mapId: 120,
      tileX: 46,
      tileZ: 7,
      direction: 'east',
    })
    const transcript: Array<{ kind: string, messageId?: number }> = []
    const record = (events: ReadonlyArray<{ kind: string, messageId?: number }>) => {
      for (const event of events) transcript.push({ kind: event.kind, messageId: event.messageId })
    }
    record(simulator.input('confirm').map((event) => ({ kind: event.kind, messageId: 'messageId' in event ? event.messageId : undefined })))
    for (let count = 0; count < 32; count += 1) {
      if (simulator.isWaitingForInput()) {
        record(simulator.input('confirm').map((event) => ({ kind: event.kind, messageId: 'messageId' in event ? event.messageId : undefined })))
      } else if (simulator.hasActiveScript()) {
        record(simulator.settle().map((event) => ({ kind: event.kind, messageId: 'messageId' in event ? event.messageId : undefined })))
      } else {
        break
      }
    }
    const moveEast = simulator.input('right').map((event) => ({ kind: event.kind, messageId: 'messageId' in event ? event.messageId : undefined }))
    const moveNorth = simulator.input('up').map((event) => ({ kind: event.kind, messageId: 'messageId' in event ? event.messageId : undefined }))
    const moveEastAfterNorth = simulator.input('right').map((event) => ({ kind: event.kind, messageId: 'messageId' in event ? event.messageId : undefined }))
    for (let count = 0; count < 32; count += 1) {
      if (simulator.isWaitingForInput()) {
        record(simulator.input('confirm').map((event) => ({ kind: event.kind, messageId: 'messageId' in event ? event.messageId : undefined })))
      } else if (simulator.hasActiveScript()) {
        record(simulator.settle().map((event) => ({ kind: event.kind, messageId: 'messageId' in event ? event.messageId : undefined })))
      } else {
        break
      }
    }

    expect(nearbyObjects).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 1, scriptId: 1, x: 47, z: 7 }),
    ]))
    expect(nearbyCoordinates).toEqual(expect.arrayContaining([
      expect.objectContaining({ scriptId: 5, x: 47, z: 6, variableId: 16640, expectedValue: 0 }),
    ]))
    expect(tracedNpc).toEqual([
      { kind: 'soundEffect' },
      { kind: 'facePlayer' },
      { kind: 'message', messageId: 1 },
      { kind: 'dialogue' },
      { kind: 'movement', objectId: 1, actions: ['face'] },
      { kind: 'waiting' },
      { kind: 'ended' },
    ])
    expect(moveEast).toEqual([{ kind: 'blocked', messageId: undefined }])
    expect(moveNorth).toEqual([{ kind: 'moved', messageId: undefined }])
    expect(moveEastAfterNorth[0]).toEqual({ kind: 'moved', messageId: undefined })
    expect(transcript.some((event) => event.kind === 'message' && event.messageId === 1)).toBe(true)
    expect(transcript.filter((event) => event.kind === 'movement')).toHaveLength(3)
    expect(simulator.getWorld().getState()).toMatchObject({ map: { id: 120 }, tileX: 46, tileZ: 6, direction: 'west' })
  }, 120000)

  probe("résout la quête des semelles de la Route de Glace après la récupération de CS07", async () => {
    const inventory = await readProbeInventory()
    const map = inventory.resolvedMapCatalog.maps.find((candidate) => candidate.id === 120)
    if (!map) throw new Error('La carte ROM 120 de la Route de Glace est absente.')
    const state = createProbeFieldState(inventory, 158, 2, 35)
    state.followMonActive = true
    setFieldScriptMapState(state, map, 47, 11, 'north')

    const run = (scriptId: number, actorId: number): FieldScriptStep[] => {
      const runner = createFieldScriptRunner(map, scriptId, state, actorId)
      const steps: FieldScriptStep[] = []
      const choiceVisits = new Map<string, number>()
      for (let count = 0; count < 256; count += 1) {
        const step = runner.resume()
        steps.push(step)
        if (step.kind === 'message') formatFieldMessage(step.text, state)
        handleInteractiveStep(runner, step, state, choiceVisits)
        if (step.kind === 'ended') return steps
      }
      throw new Error(`Le script Route de Glace ${scriptId} ne se termine pas.`)
    }

    const pickup = run(7149, 0)
    expect(pickup.at(-1)).toEqual({ kind: 'ended' })
    expect(state.inventory.get(426)).toBe(1)
    expect(state.flags.has(1111)).toBe(true)

    setFieldScriptPlayerState(state, 46, 7, 'east')
    const resolution = run(1, 1)
    expect(resolution).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'message', messageId: 2 }),
      expect.objectContaining({ kind: 'ended' }),
    ]))
    expect(state.variables.get(16640)).toBe(1)
  }, 120000)

  fullRomAudit('audits every decoded ROM script endpoint and reports progression gaps', async () => {
    const inventory = await readProbeInventory()
    const shardCount = Math.max(1, Number.parseInt(process.env.ROM_AUDIT_SHARDS ?? '1', 10) || 1)
    const shardIndex = Math.min(shardCount - 1, Math.max(0, Number.parseInt(process.env.ROM_AUDIT_SHARD ?? '0', 10) || 0))
    const allTargets = inventory.resolvedMapCatalog.maps.flatMap((map) => collectTargets(map))
      .filter((target, index, allTargets) => allTargets.findIndex((candidate) => candidate.mapId === target.mapId && candidate.scriptId === target.scriptId) === index)
    const targets = allTargets.filter((_, index) => index % shardCount === shardIndex)
    const choiceStrategies: readonly ProbeChoiceStrategy[] = ['service-cycle', 'last-option', 'cancel']
    const results = targets.flatMap((target) => {
      const map = inventory.resolvedMapCatalog.maps.find((candidate) => candidate.id === target.mapId)
      if (!map) throw new Error(`Carte ${target.mapId} absente pendant l'audit ROM.`)
      // Plusieurs services ROM reviennent volontairement à leur premier menu
      // après une branche (maîtres des capacités, ascenseurs, soins). Le même
      // pilote de choix finit alors par sélectionner « Retour », mais 256
      // suspensions était trop court pour distinguer ce cycle d'une vraie boucle.
      return choiceStrategies.map((choiceStrategy) => probeScript(inventory, map, target, 2048, choiceStrategy))
    })
    const unsupported = results.filter((result) => result.status === 'unsupported-opcode')
    const failures = results.filter((result) => result.status === 'error')
    const unsupportedByOpcode = [...unsupported.reduce((counts, result) => {
      if (result.opcode !== undefined) counts.set(result.opcode, (counts.get(result.opcode) ?? 0) + 1)
      return counts
    }, new Map<number, number>())]
      .sort(([left], [right]) => left - right)
      .map(([opcode, count]) => ({ opcode, count }))
    const terrainCoverage = inventory.resolvedMapCatalog.maps
      .filter((map) => usesWorldMatrixCoordinates(map))
      .map((map) => {
        const bounds = getMapTileBounds(map)
        const tiles = bounds ? (bounds.maxX - bounds.minX) * (bounds.maxZ - bounds.minZ) : 0
        const permissionTiles = [...(map.terrain?.attributes ?? [])].filter((attribute) => (attribute & 0x8000) === 0).length
        return {
          mapId: map.id,
          tiles,
          permissionTiles,
          collisionPlates: map.terrain?.collisionPlates?.length ?? 0,
          movementSurfaces: map.model?.surfaces?.filter((surface) => surface.supportsMovement !== false).length ?? 0,
          decorativeSurfaces: map.model?.surfaces?.filter((surface) => surface.supportsMovement === false).length ?? 0,
        }
      })
    const report = {
      startMapId: inventory.resolvedMapCatalog.startMapId,
      decodedMaps: inventory.resolvedMapCatalog.maps.length,
      shard: { index: shardIndex, count: shardCount, totalScriptEndpoints: allTargets.length },
      checkedScriptEndpoints: targets.length,
      checkedChoicePaths: results.length,
      completedChoicePaths: results.length - unsupported.length - failures.length,
      unsupportedByOpcode,
      failureCount: failures.length,
      failureExamples: failures.slice(0, 20),
      terrainCoverage,
    }
    const conciseReport = {
      startMapId: report.startMapId,
      decodedMaps: report.decodedMaps,
      shard: report.shard,
      checkedScriptEndpoints: report.checkedScriptEndpoints,
      checkedChoicePaths: report.checkedChoicePaths,
      completedChoicePaths: report.completedChoicePaths,
      unsupportedByOpcode: report.unsupportedByOpcode,
      failureCount: report.failureCount,
      failureExamples: report.failureExamples,
      unsupportedExamples: unsupported.slice(0, 8),
      terrainMaps: report.terrainCoverage.length,
    }
    if (writeProbeReports) await writeFile(targetReportPath, JSON.stringify({ ...report, unsupported }, null, 2))
    console.log(JSON.stringify(conciseReport, null, 2))

    expect(results.length).toBeGreaterThan(0)
    if (unsupported.length > 0 || failures.length > 0) throw new Error(JSON.stringify(conciseReport, null, 2))
  }, 600000)

  fullRomAudit('couvre les seize badges, toutes les variantes du rival et les trois fins Rocket de la ROM', async () => {
    const inventory = await readProbeInventory()
    const mapsById = new Map(inventory.resolvedMapCatalog.maps.map((map) => [map.id, map]))
    const traceMaps = (mapIds: readonly number[], starterChoices: readonly number[] = [1]) => mapIds.flatMap((mapId) => {
      const map = mapsById.get(mapId)
      if (!map) throw new Error(`Carte de progression ROM ${mapId} absente.`)
      return starterChoices.flatMap((starterChoice) => collectTargets(map).map((target) => traceRomTarget(inventory, map, target, starterChoice)))
    })

    const badgeTraces = traceMaps([135, 180, 137, 80, 139, 138, 140, 288, 473, 427, 365, 395, 480, 410, 457, 496])
    const cianwood = mapsById.get(139)!
    const goldenrod = mapsById.get(137)!
    const cianwoodLeader = collectTargets(cianwood).find((target) => target.scriptId === 1 && target.kind === 'object')!
    const goldenrodLeader = collectTargets(goldenrod).find((target) => target.scriptId === 1 && target.kind === 'object')!
    badgeTraces.push(
      traceRomTarget(inventory, cianwood, cianwoodLeader, 1, (state) => state.variables.set(0x4000, 1)),
      traceRomTarget(inventory, goldenrod, goldenrodLeader, 1, (state) => state.flags.add(0x0b7)),
    )
    const badges = new Set(badgeTraces.flatMap(({ state }) => [...state.badges]))
    expect([...badges].sort((left, right) => left - right)).toEqual(Array.from({ length: 16 }, (_, index) => index))

    // Toutes les cartes qui portent une scene ou un changement de visibilité
    // du rival dans les scripts ROM, y compris le duo de l'Antre du Dragon et
    // l'événement Celebi/Giovanni de la Route 22.
    const rivalTraces = traceMaps([143, 67, 74, 7, 77, 78, 249, 112, 201, 179, 300, 107, 253, 117, 27], [0, 1, 2])
    const dragonsDen = mapsById.get(253)!
    const dragonsDenRival = collectTargets(dragonsDen).find((target) => target.scriptId === 5 && target.kind === 'coordinate')!
    for (const variableSprite of [1048, 1049, 1047]) {
      rivalTraces.push(traceRomTarget(inventory, dragonsDen, dragonsDenRival, 1, (state) => state.variables.set(0x4020, variableSprite)))
    }
    const rivalTrainerIds = new Set(rivalTraces.flatMap(({ steps }) => steps.flatMap((step) => (
      step.kind !== 'battle' ? []
        : step.battle.kind === 'trainer' ? [step.battle.trainerId]
          : step.battle.kind === 'multiTrainer' ? [step.battle.allyTrainerId]
            : []
    ))))
    const expectedRivalTrainerIds = [
      1, 263, 264, 266, 267, 268, 269, 270, 271, 272,
      285, 286, 287, 288, 289, 489, 490, 491, 735, 736, 737,
    ]
    expect(expectedRivalTrainerIds.filter((trainerId) => !rivalTrainerIds.has(trainerId))).toEqual([])
    const rivalFlags = new Set(rivalTraces.flatMap(({ state }) => [...state.flags]))
    // 0x250 (Ligue) reste volontairement effacé après une victoire afin de
    // permettre la revanche hebdomadaire; 0x2e0 est posé par l'initialisation
    // globale et la scène de l'Antre emploie seulement HidePerson localement.
    expect([0x190, 0x19c, 0x1bd, 0x1d6, 0x1fd, 0x20a, 0x23f, 0x301]
      .filter((flag) => !rivalFlags.has(flag))).toEqual([])

    const slowpokeFlags = new Set(traceMaps([177]).flatMap(({ state }) => [...state.flags]))
    const hideoutTraces = traceMaps([248])
    const hideout = mapsById.get(248)!
    const thirdElectrode = collectTargets(hideout).find((target) => target.scriptId === 7 && target.kind === 'object')!
    hideoutTraces.push(traceRomTarget(inventory, hideout, thirdElectrode, 1, (state) => {
      state.flags.add(0xcb)
      state.flags.add(0xcc)
    }))
    const hideoutFlags = new Set(hideoutTraces.flatMap(({ state }) => [...state.flags]))
    const radioTowerFlags = new Set(traceMaps([190]).flatMap(({ state }) => [...state.flags]))
    expect(slowpokeFlags.has(0x7b)).toBe(true)
    expect(hideoutFlags.has(0xca)).toBe(true)
    expect(radioTowerFlags.has(0xc6)).toBe(true)
  }, 600000)

  probe('reprend la fin du troisième Électrode du Repaire Rocket via la vraie reprise onLoad après combat', async () => {
    const inventory = await readProbeInventory()
    const hideout = inventory.resolvedMapCatalog.maps.find((map) => map.id === 248)
    if (!hideout) throw new Error('Carte 248 absente de la ROM.')
    const thirdElectrode = collectTargets(hideout).find((target) => target.scriptId === 7 && target.kind === 'object')
    if (!thirdElectrode) throw new Error('Troisième Électrode introuvable dans la carte 248.')

    const { runner, state } = prepareRunner(inventory, hideout, thirdElectrode)
    state.starterChoice = 1
    state.flags.add(0xcb)
    state.flags.add(0xcc)
    let activeRunner: FieldScriptRunner = runner
    const steps: FieldScriptStep[] = []
    const choiceVisits = new Map<string, number>()

    for (let stepCount = 0; stepCount < 2048; stepCount += 1) {
      const step = activeRunner.resume()
      steps.push(step)
      if (step.kind === 'message') formatFieldMessage(step.text, state)
      if (step.kind === 'battle') {
        activeRunner.submitBattleResult(true)
        activeRunner = createFieldScriptMapInitSequenceRunner(hideout, state, 'load', activeRunner) ?? activeRunner
      } else {
        handleInteractiveStep(activeRunner, step, state, choiceVisits)
      }
      if (step.kind === 'ended') break
    }

    expect(steps.some((step) => step.kind === 'battle' && step.battle.kind === 'wild' && step.battle.speciesId === 101)).toBe(true)
    expect(state.flags.has(0xca)).toBe(true)
  }, 120000)
})
