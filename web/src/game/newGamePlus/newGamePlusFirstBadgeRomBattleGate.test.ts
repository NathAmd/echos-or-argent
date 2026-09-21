import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readRomInventory } from '../../nds'
import type { RomInventory } from '../../ndsTypes'
import { createPlayerProfileForRom } from '../../playerProfile'
import { observeDoubleBattleOutcomeEvents, observeSimpleBattleOutcomeEvents } from '../battle/battleOutcomeProjection'
import { createDoubleBattleSession } from '../battle/doubleBattleSession'
import { getUsableFieldBattlePartySlots } from '../battle/fieldBattlePartySelection'
import { createFieldDoubleBattlePlayerRoster } from '../battle/fieldDoubleBattlePlayerRoster'
import { createInitialTrainerBattleState } from '../battle/initialTrainerBattleState'
import { prepareFieldBattle, type PreparedFieldBattle } from '../battle/prepareFieldBattle'
import { createSimpleBattleSession } from '../battle/simpleBattleSession'
import { advanceTrainerBattleIntroduction, createTrainerBattleIntroduction } from '../battle/trainerBattleIntroduction'
import { createRealtimeBattleDebugController } from '../diagnostics/realtimeBattleDebug'
import { createHgssSessionRng, type HgssSessionRng } from '../pokemon/hgssSessionRng'
import { createDefaultHgssGameOptions } from '../save/hgssGameOptions'
import { createHgssSaveState, restoreHgssSaveState } from '../save/hgssSaveState'
import { createFieldScriptState, type FieldScriptState } from '../scripts/fieldScriptRunner'
import { giveHgssStarterToParty } from '../scripts/fieldScriptPokemonTransactions'
import { createNewGamePlusFirstBadgeGameplayMatrix } from './newGamePlusFirstBadgeFormatMatrix'
import { createNewGamePlusGameplayRuntime, type NewGamePlusGameplayRuntime } from './newGamePlusGameplayRuntime'
import { allBattlesInDuoModuleId } from './modules/allBattlesInDuoModule'

const defaultRomPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const romPath = process.env.ROM_JOURNEY_PATH ? resolve(process.env.ROM_JOURNEY_PATH) : defaultRomPath
const romGate = process.env.RUN_ROM_JOURNEY === '1' && existsSync(romPath) ? it : it.skip
const falknerTrainerId = 20
const falknerRosterSignature = '16:9,17:13'
const allHgssSpeciesIds = Object.freeze(Array.from({ length: 493 }, (_, index) => index + 1))
const falknerBattle = Object.freeze({
  kind: 'trainer' as const,
  trainerId: falknerTrainerId,
  trainerParameter: 0,
  encounterType: 0,
  battleParameter: 0,
})

let inventoryPromise: Promise<RomInventory> | undefined

function readGateInventory(): Promise<RomInventory> {
  inventoryPromise ??= readFile(romPath).then((bytes) => (
    readRomInventory(new File([bytes], basename(romPath)))
  ))
  return inventoryPromise
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

function requirePreparedTrainer(
  prepared: PreparedFieldBattle,
  expectCanonicalRoster: boolean,
): Extract<PreparedFieldBattle, { kind: 'trainer' }> {
  if (prepared.kind !== 'trainer') throw new Error(`Le combat d'Albert est préparé comme ${prepared.kind}.`)
  if (prepared.trainer.trainerId !== falknerTrainerId) {
    throw new Error(`Le combat préparé vise le Dresseur ${prepared.trainer.trainerId} au lieu d'Albert (${falknerTrainerId}).`)
  }
  const rosterSignature = prepared.createdParty.map(({ pokemon }) => `${pokemon.speciesId}:${pokemon.level}`).join(',')
  if (expectCanonicalRoster && rosterSignature !== falknerRosterSignature) {
    throw new Error(`Le roster d'Albert est ${rosterSignature} au lieu de ${falknerRosterSignature}.`)
  }
  return prepared
}

function createGateField(
  inventory: RomInventory,
  runtime: NewGamePlusGameplayRuntime,
  matrixIndex: number,
): Readonly<{ field: FieldScriptState, rng: HgssSessionRng, profile: ReturnType<typeof createPlayerProfileForRom> }> {
  const rng = createHgssSessionRng(5_489 + matrixIndex)
  const profile = createPlayerProfileForRom(inventory.metadata)
  profile.name = 'GATE'
  profile.trainerId = 0x1bad_0000 + matrixIndex
  if (profile.language === undefined || profile.gameVersion === undefined) {
    throw new Error(`Le profil joueur ROM ${inventory.metadata.gameCode} est incomplet.`)
  }
  const pokemonRuntime = {
    catalog: inventory.pokemonCatalog,
    pokedexCatalog: inventory.pokedexCatalog,
    itemCatalog: inventory.itemCatalog,
    rng: rng.lc,
    mt: rng.mt,
    trainer: { id: profile.trainerId, name: profile.name, gender: profile.gender },
    language: profile.language,
    gameVersion: profile.gameVersion,
    now: () => new Date(2026, 7, 25, 12, 0, 0),
  } as const
  const field = createFieldScriptState(profile.gender, profile.name, { pokemonRuntime })
  runtime.applyFieldStateMigrations(field)
  const startMap = inventory.resolvedMapCatalog.maps.find(({ id }) => id === inventory.resolvedMapCatalog.startMapId)
  if (!startMap) throw new Error('La carte ROM de départ est absente du gate premier badge.')
  giveHgssStarterToParty(
    field.party,
    field.pokedex,
    0,
    startMap.header.mapSection,
    pokemonRuntime,
    runtime.ports.pokemonTeamPolicy,
    runtime.ports.pokemonInitialTeamResolver,
  )
  return Object.freeze({ field, rng, profile })
}

function finishSimpleBattle(
  inventory: RomInventory,
  prepared: Extract<PreparedFieldBattle, { kind: 'trainer' }>,
  runtime: NewGamePlusGameplayRuntime,
): void {
  const format = runtime.ports.fieldBattleFormatResolver(prepared)
  const initial = createInitialTrainerBattleState(prepared, format, runtime.ports.pokemonTeamPolicy)
  const introduction = createTrainerBattleIntroduction(initial)
  while (advanceTrainerBattleIntroduction(introduction)) continue
  if (introduction.phase !== 'ready' || initial.format !== 'single') {
    throw new Error("L'introduction simple d'Albert n'atteint pas son état prêt.")
  }
  const playerParty = initial.player.party.members
  const opponentParty = initial.opponent.party.members
  const player = playerParty[initial.player.openingSlots[0]!]
  const opponent = opponentParty[initial.opponent.openingSlots[0]!]
  if (!player || !opponent) throw new Error("Un combattant simple d'Albert est absent.")
  const session = createSimpleBattleSession({
    kind: 'trainer',
    player,
    opponent,
    catalog: inventory.pokemonCatalog,
    trainerId: falknerTrainerId,
    opponentAiFlags: prepared.trainer.aiFlags,
    itemCatalog: inventory.itemCatalog,
    opponentItems: prepared.trainer.items,
    playerParty,
    opponentParty,
    sharePartyState: true,
    playerTeamPolicy: runtime.ports.pokemonTeamPolicy,
  })
  const effect = createRealtimeBattleDebugController().execute({ kind: 'instant-kill' }, { simple: session })
  if (effect.kind !== 'simple-events') throw new Error("La victoire administrative simple d'Albert n'a produit aucun événement.")
  observeSimpleBattleOutcomeEvents(effect.events, session.parties, runtime.ports.detailedBattleOutcomeObserver)
  if (session.phase !== 'ended' || session.result !== 'won') {
    throw new Error("La session simple d'Albert ne se termine pas par une victoire.")
  }
}

function finishDoubleBattle(
  inventory: RomInventory,
  prepared: Extract<PreparedFieldBattle, { kind: 'trainer' }>,
  runtime: NewGamePlusGameplayRuntime,
): number {
  const playerParty = prepared.playerParty.members
  const opponentParty = prepared.createdParty.map(({ pokemon }) => pokemon)
  const opponentSlots = getUsableFieldBattlePartySlots(opponentParty)
  if (opponentSlots.length < 1) throw new Error("Le roster Duo d'Albert ne contient aucun adversaire utilisable.")
  const player = createFieldDoubleBattlePlayerRoster({
    party: playerParty,
    teamPolicy: runtime.ports.pokemonTeamPolicy,
    allowSingleParticipant: true,
  })
  const ownerId = `trainer-${falknerTrainerId}`
  const opponent = opponentSlots.length === 1
    ? [{ ownerId, party: opponentParty, activePartyIndex: opponentSlots[0]!, controlled: false }] as const
    : [
        { ownerId, party: opponentParty, activePartyIndex: opponentSlots[0]!, controlled: false },
        { ownerId, party: opponentParty, activePartyIndex: opponentSlots[1]!, controlled: false },
      ] as const
  const session = createDoubleBattleSession({
    kind: 'double',
    catalog: inventory.pokemonCatalog,
    itemCatalog: inventory.itemCatalog,
    playerTeamPolicy: runtime.ports.pokemonTeamPolicy,
    allowSinglePlayerParticipant: true,
    player,
    opponent,
  })
  const effect = createRealtimeBattleDebugController().execute({ kind: 'instant-kill' }, { double: session })
  if (effect.kind !== 'double-events') throw new Error("La victoire administrative Duo d'Albert n'a produit aucun événement.")
  observeDoubleBattleOutcomeEvents(effect.events, session.teams, runtime.ports.detailedBattleOutcomeObserver)
  if (session.phase !== 'ended' || session.result !== 'won') {
    throw new Error("La session Duo d'Albert ne se termine pas par une victoire.")
  }
  return player.length
}

describe('gate ROM du premier badge pour tous les gameplays NG+', () => {
  romGate('prépare, termine et reprend les 640 formats contre Albert', async () => {
    const inventory = await readGateInventory()
    const matrix = createNewGamePlusFirstBadgeGameplayMatrix({
      gameCode: inventory.metadata.gameCode,
      slot: 1,
      playerName: 'GATE',
      leagueCompletedAt: '2026-08-25T12:00:00.000Z',
    })
    // Ce gate certifie le combat et la sauvegarde. Les probes dédiés de
    // AllPokemonAccessibilityPlanner certifient séparément la topologie ROM.
    // Une couverture hôte complète évite de recalculer ce plan 640 fois ici.
    const startMap = inventory.resolvedMapCatalog.maps.find(({ id }) => id === inventory.resolvedMapCatalog.startMapId)
    if (!startMap) throw new Error('La carte ROM de départ est absente du gate premier badge.')
    const questLocations = Object.freeze([Object.freeze({
      mapId: startMap.id,
      mapSectionId: startMap.header.mapSection,
      tileX: 0,
      tileZ: 0,
      direction: 'north' as const,
    })])
    const failures: Array<{ label: string, modules: readonly string[], error: string }> = []
    let simpleFormats = 0
    let doubleFormats = 0
    let singleParticipantDoubleFormats = 0

    for (const [matrixIndex, row] of matrix.entries()) {
      try {
        const fieldHost: { current?: FieldScriptState } = {}
        let progression = 0
        const allPokemonAccessible = {
          mapSources: Object.freeze([]),
          encounterCatalog: Object.freeze([]),
          knownAccessibleSpeciesIds: allHgssSpeciesIds,
          readStatistics: () => ({
            money: fieldHost.current?.money ?? 0,
            battlesWon: fieldHost.current?.trainerFlags.size ?? 0,
            caughtSpeciesIds: [...(fieldHost.current?.pokedex.caughtSpeciesIds ?? [])],
          }),
        }
        const runtime = createNewGamePlusGameplayRuntime(row.profile, {
          catalog: inventory.pokemonCatalog,
          activation: 'new',
          readProgression: () => progression,
          allPokemonAccessible,
          allPokemonQuestLocations: questLocations,
        })
        const gate = createGateField(inventory, runtime, matrixIndex)
        const field = gate.field
        fieldHost.current = field
        const prepared = requirePreparedTrainer(prepareFieldBattle(
          falknerBattle,
          inventory.trainerCatalog,
          inventory.pokemonCatalog,
          {
            playerParty: field.party,
            origin: { language: gate.profile.language!, gameVersion: gate.profile.gameVersion! },
            rosterPolicy: runtime.ports.fieldBattleRosterPolicy,
          },
        ), !row.moduleIds.includes('randomizer'))
        const format = runtime.ports.fieldBattleFormatResolver(prepared)
        const duoEnabled = row.moduleIds.includes(allBattlesInDuoModuleId)
        if (duoEnabled) {
          if (format.engine !== 'double' || format.sessionKind !== 'double') {
            throw new Error(`Le module Duo résout Albert avec le moteur ${format.engine}.`)
          }
          doubleFormats += 1
          const participants = finishDoubleBattle(inventory, prepared, runtime)
          if (participants === 1) singleParticipantDoubleFormats += 1
        } else {
          if (format.engine !== 'simple' || format.sessionKind !== 'trainer') {
            throw new Error(`Le format standard résout Albert avec le moteur ${format.engine}.`)
          }
          simpleFormats += 1
          finishSimpleBattle(inventory, prepared, runtime)
        }

        // La campagne ROM standard possède l'autorité sur l'attribution du
        // badge ; ce gate ne rejoue pas son script 640 fois après avoir prouvé
        // chaque session. Albert n'emploie pas de TrainerFlag dans la ROM.
        field.badges.add(0)
        progression = field.badges.size
        const extensions = runtime.snapshotExtensions()
        const saved = createHgssSaveState(
          inventory.metadata.gameCode,
          gate.profile,
          gate.rng,
          { mapId: 135, tileX: 0, tileZ: 0, direction: 'south' },
          field,
          createDefaultHgssGameOptions(),
          { hours: 1, minutes: 0, seconds: 0 },
          undefined,
          row.profile,
          extensions,
        )
        const restored = restoreHgssSaveState(
          JSON.parse(JSON.stringify(saved)),
          inventory.metadata.gameCode,
          inventory.pokemonCatalog,
          () => new Date(2026, 7, 25, 12, 1, 0),
          inventory.itemCatalog,
          inventory.pokedexCatalog,
        )
        if (!restored.newGamePlus || !restored.field.badges.has(0)) {
          throw new Error('La reprise ne conserve pas le profil et le Badge Zéphyr.')
        }
        const restoredField = restored.field
        const resumed = createNewGamePlusGameplayRuntime(restored.newGamePlus, {
          catalog: inventory.pokemonCatalog,
          activation: 'resume',
          extensions: restored.extensions,
          readProgression: () => restoredField.badges.size,
          allPokemonAccessible: {
            ...allPokemonAccessible,
            readStatistics: () => ({
              money: restoredField.money,
              battlesWon: restoredField.trainerFlags.size,
              caughtSpeciesIds: [...restoredField.pokedex.caughtSpeciesIds],
            }),
          },
          allPokemonQuestLocations: questLocations,
        })
        resumed.applyFieldStateMigrations(restoredField)
        if (JSON.stringify(resumed.snapshotExtensions()) !== JSON.stringify(extensions)) {
          throw new Error('Les extensions du profil diffèrent après la reprise du premier badge.')
        }
      } catch (error) {
        failures.push({ label: row.gameplayLabel, modules: row.moduleIds, error: errorMessage(error) })
      }
    }

    expect(failures, failures.slice(0, 20).map((failure) => (
      `${failure.label} [${failure.modules.join(', ') || 'base'}] — ${failure.error}`
    )).join('\n')).toEqual([])
    expect({ simpleFormats, doubleFormats, singleParticipantDoubleFormats }).toEqual({
      simpleFormats: 320,
      doubleFormats: 320,
      singleParticipantDoubleFormats: 128,
    })
  }, 180_000)
})
