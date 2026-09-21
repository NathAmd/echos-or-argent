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
import { createFieldScriptState, type FieldScriptState } from '../scripts/fieldScriptRunner'
import { giveHgssStarterToParty } from '../scripts/fieldScriptPokemonTransactions'
import {
  assertNewGamePlusFirstBadgeAllConfigurationCounts,
  createNewGamePlusFirstBadgeAllConfigurationAxes,
  decodeNewGamePlusFirstBadgeAllProfileCoordinate,
  encodeNewGamePlusFirstBadgeAllProfileCoordinate,
  materializeNewGamePlusFirstBadgeAllProfile,
  newGamePlusFirstBadgeAllConfigurationsFactorization,
  validateNewGamePlusFirstBadgeAllConfigurations,
  type NewGamePlusFirstBadgeAllConfigurationAxes,
  type NewGamePlusFirstBadgeAllMaterializedProfile,
  type NewGamePlusFirstBadgeAllTeamConfiguration,
} from './newGamePlusFirstBadgeAllConfigurations'
import {
  createNewGamePlusGameplayRuntime,
  type NewGamePlusGameplayRuntime,
  type NewGamePlusGameplayRuntimeOptions,
} from './newGamePlusGameplayRuntime'
import {
  carryMoneyModuleId,
  carryPokedexModuleId,
  createBuiltInNewGamePlusRegistry,
  randomizerModuleId,
} from './modules/index'
import type { NewGamePlusProfileV1, NewGamePlusSource } from './newGamePlusTypes'

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

function createSource(inventory: RomInventory): NewGamePlusSource {
  return Object.freeze({
    gameCode: inventory.metadata.gameCode,
    slot: 1,
    playerName: 'GATE',
    leagueCompletedAt: '2026-08-25T12:00:00.000Z',
  })
}

function materializeAt(
  source: NewGamePlusSource,
  axes: NewGamePlusFirstBadgeAllConfigurationAxes,
  teamConfigurationIndex: number,
  independentGameplayMask = 0,
  transferMask = 0,
): NewGamePlusFirstBadgeAllMaterializedProfile {
  const linearIndex = encodeNewGamePlusFirstBadgeAllProfileCoordinate(axes, {
    teamConfigurationIndex,
    independentGameplayMask,
    transferMask,
  })
  return materializeNewGamePlusFirstBadgeAllProfile(
    source,
    axes,
    decodeNewGamePlusFirstBadgeAllProfileCoordinate(axes, linearIndex),
  )
}

type GateRuntimeOptions = Required<Pick<
  NewGamePlusGameplayRuntimeOptions,
  'readProgression' | 'allPokemonAccessible' | 'allPokemonQuestLocations'
>>

function createRuntimeOptions(
  inventory: RomInventory,
  fieldHost: { current?: FieldScriptState },
): GateRuntimeOptions {
  const startMap = inventory.resolvedMapCatalog.maps.find(({ id }) => id === inventory.resolvedMapCatalog.startMapId)
  if (!startMap) throw new Error('La carte ROM initiale est absente du gate exhaustif.')
  return Object.freeze({
    readProgression: () => fieldHost.current?.badges.size ?? 0,
    allPokemonAccessible: Object.freeze({
      mapSources: Object.freeze([]),
      encounterCatalog: Object.freeze([]),
      knownAccessibleSpeciesIds: allHgssSpeciesIds,
      readStatistics: () => Object.freeze({
        money: fieldHost.current?.money ?? 0,
        battlesWon: fieldHost.current?.trainerFlags.size ?? 0,
        caughtSpeciesIds: Object.freeze([...(fieldHost.current?.pokedex.caughtSpeciesIds ?? [])]),
      }),
    }),
    allPokemonQuestLocations: Object.freeze([Object.freeze({
      mapId: startMap.id,
      mapSectionId: startMap.header.mapSection,
      tileX: 0,
      tileZ: 0,
      direction: 'north' as const,
    })]),
  })
}

function createGateField(
  inventory: RomInventory,
  runtime: NewGamePlusGameplayRuntime,
  seed: number,
): Readonly<{ field: FieldScriptState, rng: HgssSessionRng, language: number, gameVersion: number }> {
  const rng = createHgssSessionRng(seed)
  const player = createPlayerProfileForRom(inventory.metadata)
  player.name = 'GATE'
  player.trainerId = 0x2bad_0000 + seed
  if (player.language === undefined || player.gameVersion === undefined) {
    throw new Error(`Le profil joueur ROM ${inventory.metadata.gameCode} est incomplet.`)
  }
  const pokemonRuntime = {
    catalog: inventory.pokemonCatalog,
    pokedexCatalog: inventory.pokedexCatalog,
    itemCatalog: inventory.itemCatalog,
    rng: rng.lc,
    mt: rng.mt,
    trainer: { id: player.trainerId, name: player.name, gender: player.gender },
    language: player.language,
    gameVersion: player.gameVersion,
    now: () => new Date(2026, 7, 25, 12, 0, 0),
  } as const
  const field = createFieldScriptState(player.gender, player.name, { pokemonRuntime })
  runtime.applyFieldStateMigrations(field)
  const startMap = inventory.resolvedMapCatalog.maps.find(({ id }) => id === inventory.resolvedMapCatalog.startMapId)
  if (!startMap) throw new Error('La carte ROM initiale est absente du gate exhaustif.')
  giveHgssStarterToParty(
    field.party,
    field.pokedex,
    0,
    startMap.header.mapSection,
    pokemonRuntime,
    runtime.ports.pokemonTeamPolicy,
    runtime.ports.pokemonInitialTeamResolver,
  )
  return Object.freeze({ field, rng, language: player.language, gameVersion: player.gameVersion })
}

function prepareFalkner(
  inventory: RomInventory,
  runtime: NewGamePlusGameplayRuntime,
  gate: ReturnType<typeof createGateField>,
  canonicalRoster: boolean,
): Extract<PreparedFieldBattle, { kind: 'trainer' }> {
  const prepared = prepareFieldBattle(
    falknerBattle,
    inventory.trainerCatalog,
    inventory.pokemonCatalog,
    {
      playerParty: gate.field.party,
      origin: { language: gate.language, gameVersion: gate.gameVersion },
      rosterPolicy: runtime.ports.fieldBattleRosterPolicy,
    },
  )
  if (prepared.kind !== 'trainer' || prepared.trainer.trainerId !== falknerTrainerId) {
    throw new Error(`Albert ROM ${falknerTrainerId} n’est pas le Dresseur préparé.`)
  }
  const signature = prepared.createdParty.map(({ pokemon }) => `${pokemon.speciesId}:${pokemon.level}`).join(',')
  if (canonicalRoster && signature !== falknerRosterSignature) {
    throw new Error(`Le roster d’Albert est ${signature} au lieu de ${falknerRosterSignature}.`)
  }
  return prepared
}

function assertTeamConfiguration(
  inventory: RomInventory,
  configuration: NewGamePlusFirstBadgeAllTeamConfiguration,
  runtime: NewGamePlusGameplayRuntime,
  field: FieldScriptState,
): void {
  if (field.party.members.length !== configuration.expectedInitialTeamSize) {
    throw new Error(`${configuration.id} crée ${field.party.members.length} membres au lieu de ${configuration.expectedInitialTeamSize}.`)
  }
  if (configuration.soloSpeciesId !== undefined
    && field.party.members.some(({ speciesId }) => speciesId !== configuration.soloSpeciesId)) {
    throw new Error(`${configuration.id} ne conserve pas son espèce Solo.`)
  }
  if (configuration.monotypeTypeId !== undefined
    && field.party.members.some(({ speciesId }) => (
      !inventory.pokemonCatalog.personalData[speciesId]?.types.includes(configuration.monotypeTypeId!)
    ))) {
    throw new Error(`${configuration.id} crée un membre hors type Monotype.`)
  }
  const expectedEngine = configuration.allBattlesInDuo ? 'double' : 'simple'
  const prepared = prepareFalkner(inventory, runtime, {
    field,
    rng: createHgssSessionRng(1),
    language: field.pokemonRuntime!.language,
    gameVersion: field.pokemonRuntime!.gameVersion,
  }, true)
  if (runtime.ports.fieldBattleFormatResolver(prepared).engine !== expectedEngine) {
    throw new Error(`${configuration.id} ne résout pas Albert avec le moteur ${expectedEngine}.`)
  }
}

function resumeAndAssertSnapshot(
  inventory: RomInventory,
  profile: NewGamePlusProfileV1,
  runtime: NewGamePlusGameplayRuntime,
  options: GateRuntimeOptions,
): void {
  const extensions = runtime.snapshotExtensions()
  const resumed = createNewGamePlusGameplayRuntime(profile, {
    catalog: inventory.pokemonCatalog,
    activation: 'resume',
    extensions,
    ...options,
  })
  if (JSON.stringify(resumed.snapshotExtensions()) !== JSON.stringify(extensions)) {
    throw new Error('Les extensions NG+ diffèrent après la reprise factorisée.')
  }
}

function finishSimpleFalkner(
  inventory: RomInventory,
  prepared: Extract<PreparedFieldBattle, { kind: 'trainer' }>,
  runtime: NewGamePlusGameplayRuntime,
): void {
  const format = runtime.ports.fieldBattleFormatResolver(prepared)
  const initial = createInitialTrainerBattleState(prepared, format, runtime.ports.pokemonTeamPolicy)
  const introduction = createTrainerBattleIntroduction(initial)
  while (advanceTrainerBattleIntroduction(introduction)) continue
  if (introduction.phase !== 'ready' || initial.format !== 'single') {
    throw new Error('La classe simple d’Albert n’atteint pas son état prêt.')
  }
  const playerParty = initial.player.party.members
  const opponentParty = initial.opponent.party.members
  const player = playerParty[initial.player.openingSlots[0]!]
  const opponent = opponentParty[initial.opponent.openingSlots[0]!]
  if (!player || !opponent) throw new Error('Un combattant simple d’Albert est absent.')
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
  if (effect.kind !== 'simple-events') throw new Error('La victoire simple d’Albert ne produit aucun événement.')
  observeSimpleBattleOutcomeEvents(effect.events, session.parties, runtime.ports.detailedBattleOutcomeObserver)
  if (session.phase !== 'ended' || session.result !== 'won') throw new Error('La classe simple d’Albert ne se termine pas gagnée.')
}

function finishDoubleFalkner(
  inventory: RomInventory,
  prepared: Extract<PreparedFieldBattle, { kind: 'trainer' }>,
  runtime: NewGamePlusGameplayRuntime,
): number {
  const playerParty = prepared.playerParty.members
  const opponentParty = prepared.createdParty.map(({ pokemon }) => pokemon)
  const opponentSlots = getUsableFieldBattlePartySlots(opponentParty)
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
  if (effect.kind !== 'double-events') throw new Error('La victoire Duo d’Albert ne produit aucun événement.')
  observeDoubleBattleOutcomeEvents(effect.events, session.teams, runtime.ports.detailedBattleOutcomeObserver)
  if (session.phase !== 'ended' || session.result !== 'won') throw new Error('La classe Duo d’Albert ne se termine pas gagnée.')
  return player.length
}

describe('gate ROM factorisé de toutes les configurations NG+ contre Albert', () => {
  romGate('prouve les 628 736 profils sans exécuter 157 184 combats redondants', async () => {
    const inventory = await readGateInventory()
    const source = createSource(inventory)
    const axes = createNewGamePlusFirstBadgeAllConfigurationAxes(inventory.pokemonCatalog)
    assertNewGamePlusFirstBadgeAllConfigurationCounts(axes)
    const structuralReport = validateNewGamePlusFirstBadgeAllConfigurations(source, axes)
    const failures: string[] = []
    let seed = 8_000

    // Axe 1 : chacune des 2 456 configurations matérielles d’équipe est
    // activée, liée à ses vraies instances Pokémon ROM, préparée contre Albert
    // puis reprise depuis son snapshot. Aucun masque indépendant n’est répété.
    for (const [teamIndex, configuration] of axes.teamConfigurations.entries()) {
      try {
        const materialized = materializeAt(source, axes, teamIndex)
        const fieldHost: { current?: FieldScriptState } = {}
        const options = createRuntimeOptions(inventory, fieldHost)
        const runtime = createNewGamePlusGameplayRuntime(materialized.profile, {
          catalog: inventory.pokemonCatalog,
          activation: 'new',
          ...options,
        })
        const gate = createGateField(inventory, runtime, seed)
        seed += 1
        fieldHost.current = gate.field
        assertTeamConfiguration(inventory, configuration, runtime, gate.field)
        resumeAndAssertSnapshot(inventory, materialized.profile, runtime, options)
      } catch (error) {
        failures.push(`équipe ${configuration.id} — ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // Axe 2 : chaque masque indépendant est composé avec les dix familles.
    // Cela couvre les interactions de ports sans les multiplier par les 2 456
    // valeurs de config qui ont déjà été prouvées juste au-dessus.
    const familyRepresentatives = new Map<string, number>()
    for (const [index, configuration] of axes.teamConfigurations.entries()) {
      if (!familyRepresentatives.has(configuration.teamFormatId)) familyRepresentatives.set(configuration.teamFormatId, index)
    }
    let canonicalGameplayCompositions = 0
    for (const teamIndex of familyRepresentatives.values()) {
      for (const gameplay of axes.independentGameplayVariants) {
        const configuration = axes.teamConfigurations[teamIndex]!
        try {
          const materialized = materializeAt(source, axes, teamIndex, gameplay.mask)
          const fieldHost: { current?: FieldScriptState } = {}
          const options = createRuntimeOptions(inventory, fieldHost)
          const runtime = createNewGamePlusGameplayRuntime(materialized.profile, {
            catalog: inventory.pokemonCatalog,
            activation: 'new',
            ...options,
          })
          const gate = createGateField(inventory, runtime, seed)
          seed += 1
          fieldHost.current = gate.field
          const prepared = prepareFalkner(
            inventory,
            runtime,
            gate,
            !gameplay.moduleIds.includes(randomizerModuleId),
          )
          const expectedEngine = configuration.allBattlesInDuo ? 'double' : 'simple'
          if (runtime.ports.fieldBattleFormatResolver(prepared).engine !== expectedEngine) {
            throw new Error(`Albert emploie un moteur autre que ${expectedEngine}.`)
          }
          resumeAndAssertSnapshot(inventory, materialized.profile, runtime, options)
          canonicalGameplayCompositions += 1
        } catch (error) {
          failures.push(`gameplay ${configuration.id}/g=${gameplay.mask} — ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }

    // Axe 3 : les transferts sont appliqués au registre et leur absence de
    // contribution au combat est vérifiée sur la même préparation d’Albert.
    const registry = createBuiltInNewGamePlusRegistry()
    const sourceField = createFieldScriptState('male', 'SOURCE')
    sourceField.money = 654_321
    sourceField.pokedex.enabled = true
    sourceField.pokedex.nationalDexEnabled = true
    sourceField.pokedex.caughtSpeciesIds.add(25)
    const transferBattleSignatures: string[] = []
    for (const transfer of axes.transferVariants) {
      try {
        const materialized = materializeAt(source, axes, familyRepresentatives.get('standard')!, 0, transfer.mask)
        const destination = createFieldScriptState('female', 'DESTINATION')
        const applied = registry.applyProfile(materialized.profile, sourceField, destination)
        if (applied.money !== (transfer.moduleIds.includes(carryMoneyModuleId) ? sourceField.money : destination.money)
          || applied.pokedex.caughtSpeciesIds.has(25) !== transfer.moduleIds.includes(carryPokedexModuleId)) {
          throw new Error('Le transfert ne correspond pas à son masque.')
        }
        const fieldHost: { current?: FieldScriptState } = {}
        const options = createRuntimeOptions(inventory, fieldHost)
        const runtime = createNewGamePlusGameplayRuntime(materialized.profile, {
          catalog: inventory.pokemonCatalog,
          activation: 'new',
          ...options,
        })
        const gate = createGateField(inventory, runtime, seed)
        seed += 1
        fieldHost.current = gate.field
        const prepared = prepareFalkner(inventory, runtime, gate, true)
        transferBattleSignatures.push(JSON.stringify({
          engine: runtime.ports.fieldBattleFormatResolver(prepared).engine,
          roster: prepared.createdParty.map(({ pokemon }) => [pokemon.speciesId, pokemon.level]),
          party: prepared.playerParty.members.map(({ speciesId, level }) => [speciesId, level]),
        }))
      } catch (error) {
        failures.push(`transfert t=${transfer.mask} — ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // Sept exécutions seulement matérialisent toutes les classes susceptibles
    // de changer le moteur ou le roster ; les axes précédents prouvent ensuite
    // que toutes leurs valeurs se projettent sur l’une de ces classes.
    const battleClasses = [
      { id: 'simple', team: 'standard', gameplayMask: 0, participants: 1 },
      { id: 'duo-2', team: 'duo', gameplayMask: 0, participants: 2 },
      { id: 'duo-1', team: 'duo-solo', gameplayMask: 0, participants: 1 },
      { id: 'randomizer', team: 'standard', gameplayMask: axes.independentGameplayVariants.find(({ moduleIds }) => (
        moduleIds.length === 1 && moduleIds[0] === randomizerModuleId
      ))!.mask, participants: 1 },
      { id: 'monotype', team: 'monotype', gameplayMask: 0, participants: 1 },
      { id: 'solo', team: 'solo', gameplayMask: 0, participants: 1 },
      { id: 'eevee', team: 'eevee-team', gameplayMask: 0, participants: 1 },
    ] as const
    let simpleBattleClasses = 0
    let doubleBattleClasses = 0
    let singleParticipantDoubleClasses = 0
    for (const battleClass of battleClasses) {
      try {
        const teamIndex = familyRepresentatives.get(battleClass.team)
        if (teamIndex === undefined) throw new Error(`La famille ${battleClass.team} est absente.`)
        const materialized = materializeAt(source, axes, teamIndex, battleClass.gameplayMask)
        const fieldHost: { current?: FieldScriptState } = {}
        const options = createRuntimeOptions(inventory, fieldHost)
        const runtime = createNewGamePlusGameplayRuntime(materialized.profile, {
          catalog: inventory.pokemonCatalog,
          activation: 'new',
          ...options,
        })
        const gate = createGateField(inventory, runtime, seed)
        seed += 1
        fieldHost.current = gate.field
        const prepared = prepareFalkner(
          inventory,
          runtime,
          gate,
          battleClass.id !== 'randomizer',
        )
        const format = runtime.ports.fieldBattleFormatResolver(prepared)
        if (format.engine === 'double') {
          const participants = finishDoubleFalkner(inventory, prepared, runtime)
          if (participants !== battleClass.participants) {
            throw new Error(`${participants} participants au lieu de ${battleClass.participants}.`)
          }
          doubleBattleClasses += 1
          if (participants === 1) singleParticipantDoubleClasses += 1
        } else {
          finishSimpleFalkner(inventory, prepared, runtime)
          simpleBattleClasses += 1
        }
        gate.field.badges.add(0)
        if (!gate.field.badges.has(0)) throw new Error('Le Badge Zéphyr n’est pas conservé après Albert.')
      } catch (error) {
        failures.push(`classe ${battleClass.id} — ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    expect(failures, failures.slice(0, 30).join('\n')).toEqual([])
    expect(structuralReport.completeProfileCoordinatesValidated).toBe(628_736)
    expect(canonicalGameplayCompositions).toBe(640)
    expect(new Set(transferBattleSignatures).size).toBe(1)
    expect({ simpleBattleClasses, doubleBattleClasses, singleParticipantDoubleClasses }).toEqual({
      simpleBattleClasses: 5,
      doubleBattleClasses: 2,
      singleParticipantDoubleClasses: 1,
    })
    expect(newGamePlusFirstBadgeAllConfigurationsFactorization.formula).toContain('628 736')
  }, 180_000)
})
