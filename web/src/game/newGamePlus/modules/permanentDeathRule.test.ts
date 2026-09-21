import { describe, expect, it } from 'vitest'
import {
  observeDoubleBattleOutcomeEvents,
  observeSimpleBattleOutcomeEvents,
} from '../../battle/battleOutcomeProjection'
import type { DoubleBattleEvent } from '../../battle/doubleBattleSession'
import type { SimpleBattleEvent } from '../../battle/simpleBattleSession'
import { createCanonicalPokemon, type CanonicalPokemon } from '../../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../../pokemon/hgssPokemonRng'
import { deriveLegacyPokemonInstanceId, parsePokemonInstanceId } from '../../pokemon/pokemonInstanceId'
import {
  basePokemonPartyHealingPolicy,
  healPokemonWithPolicy,
  type PokemonHealingRestoration,
  type PokemonHealingSource,
} from '../../pokemon/pokemonPartyHealingPolicy'
import { createPokemonTestCatalog } from '../../pokemon/pokemonTestCatalog'
import { basePokemonTeamPolicy, type PokemonTeamMember } from '../../pokemon/pokemonTeamPolicy'
import { createVersionedSaveExtensionRegistry } from '../../save/versionedSaveExtensions'
import { permanentDeathStateFormat } from './permanentDeathState'
import {
  createPermanentDeathRuntime,
  permanentDeathSaveExtension,
  permanentDeathSaveExtensionKey,
} from './permanentDeathRule'

describe('runtime Mort définitive', () => {
  it("reste strictement neutre lorsqu'il est désactivé", () => {
    const runtime = createPermanentDeathRuntime({ enabled: false })

    expect(runtime.enabled).toBe(false)
    expect(runtime.teamPolicy).toBe(basePokemonTeamPolicy)
    expect(runtime.healingPolicy).toBe(basePokemonPartyHealingPolicy)
    runtime.detailedBattleOutcomeObserver.observeBattleOutcome({
      kind: 'pokemon-knocked-out',
      pokemon: { instanceId: instanceId('disabled'), side: 'player', partyIndex: 0 },
    })
    expect(runtime.isPermanentlyDead(instanceId('disabled'))).toBe(false)
    expect(runtime.snapshotState()).toBeUndefined()
  })

  it('enregistre les KO joueur projetés par les combats simples et doubles uniquement', () => {
    const runtime = createPermanentDeathRuntime({ enabled: true })
    const simpleDead = pokemon('simple-dead', 152)
    const doubleDead = pokemon('double-dead', 155)
    const opponentDead = pokemon('opponent-dead', 158)
    const simpleEvents: readonly SimpleBattleEvent[] = [{
      kind: 'faint',
      side: 'player',
      pokemonName: simpleDead.speciesName,
      defeated: simpleDead,
    }, {
      kind: 'faint',
      side: 'opponent',
      pokemonName: opponentDead.speciesName,
      defeated: opponentDead,
    }]
    observeSimpleBattleOutcomeEvents(
      simpleEvents,
      { player: [simpleDead], opponent: [opponentDead] },
      runtime.detailedBattleOutcomeObserver,
    )

    const sharedPlayerParty = [simpleDead, doubleDead]
    const doubleEvents: readonly DoubleBattleEvent[] = [{
      kind: 'faint',
      target: { side: 'player', slot: 1 },
      pokemonName: doubleDead.speciesName,
      defeated: doubleDead,
    }]
    observeDoubleBattleOutcomeEvents(doubleEvents, {
      player: [{ party: sharedPlayerParty }, { party: sharedPlayerParty }],
      opponent: [],
    }, runtime.detailedBattleOutcomeObserver)

    expect(runtime.isPermanentlyDead(simpleDead.instanceId)).toBe(true)
    expect(runtime.isPermanentlyDead(doubleDead.instanceId)).toBe(true)
    expect(runtime.isPermanentlyDead(opponentDead.instanceId)).toBe(false)
    expect(runtime.snapshotState()).toEqual({
      format: permanentDeathStateFormat,
      version: 1,
      deadPokemonInstanceIds: [simpleDead.instanceId, doubleDead.instanceId].sort(),
    })
  })

  it('interdit sélection volontaire et remplacement forcé, mais autorise le dépôt PC', () => {
    const runtime = createPermanentDeathRuntime({ enabled: true })
    const dead = member('dead', 152)
    const living = member('living', 155)
    markDead(runtime, dead.instanceId)

    for (const format of ['simple', 'double'] as const) {
      for (const phase of ['initial', 'voluntary-switch', 'forced-replacement'] as const) {
        expect(runtime.teamPolicy.vetoBattleEligibility({
          format,
          phase,
          partyIndex: 0,
          pokemon: { ...dead, currentHp: 99 },
        })?.code).toBe('new-game-plus.permanent-death.battle-forbidden')
      }
    }
    expect(runtime.teamPolicy.vetoBattleEligibility({
      format: 'simple',
      phase: 'initial',
      partyIndex: 1,
      pokemon: living,
    })).toBeUndefined()

    expect(runtime.teamPolicy.vetoPartyMutation({
      reason: 'pc',
      before: [dead, living],
      after: [living],
    })).toBeUndefined()
    expect(runtime.teamPolicy.vetoPartyMutation({
      reason: 'reorder',
      before: [dead, living],
      after: [living, dead],
    })).toBeUndefined()
    expect(runtime.teamPolicy.vetoPartyMutation({
      reason: 'pc',
      before: [living],
      after: [living, dead],
    })?.code).toBe('new-game-plus.permanent-death.return-to-party-forbidden')
  })

  it('refuse PV, statut et PP pour toutes les sources de soin d’un mort', () => {
    const runtime = createPermanentDeathRuntime({ enabled: true })
    const dead = pokemon('healing-dead', 152)
    markDead(runtime, dead.instanceId)
    dead.currentHp = 1
    dead.status = 4
    for (const move of dead.moves) move.pp = 0

    const sources: readonly PokemonHealingSource[] = ['full-heal', 'daycare', 'field-item', 'battle-item']
    const restorations: readonly PokemonHealingRestoration[] = ['hp', 'status', 'move-pp']
    for (const source of sources) {
      for (const restoration of restorations) {
        expect(runtime.healingPolicy.vetoFullHealRestoration({
          pokemon: dead,
          partyIndex: 0,
          source,
          restoration,
        })?.code).toBe('new-game-plus.permanent-death.healing-forbidden')
      }
    }

    const before = {
      currentHp: dead.currentHp,
      status: dead.status,
      pp: dead.moves.map(({ pp }) => pp),
    }
    const result = healPokemonWithPolicy(dead, 0, runtime.healingPolicy, 'field-item')
    expect(result.restored).toEqual([])
    expect(result.vetoes.map(({ restoration }) => restoration)).toEqual(['hp', 'status', 'move-pp'])
    expect({
      currentHp: dead.currentHp,
      status: dead.status,
      pp: dead.moves.map(({ pp }) => pp),
    }).toEqual(before)
  })

  it('sauvegarde et restaure son état v1 via le contributeur existant', () => {
    const registry = createVersionedSaveExtensionRegistry([permanentDeathSaveExtension])
    const source = createPermanentDeathRuntime({ enabled: true })
    const first = instanceId('save-first')
    const second = instanceId('save-second')
    markDead(source, second)
    markDead(source, first)

    const saved = registry.save(source)
    expect(saved).toEqual({
      [permanentDeathSaveExtensionKey]: {
        version: 1,
        value: {
          format: permanentDeathStateFormat,
          version: 1,
          deadPokemonInstanceIds: [first, second].sort(),
        },
      },
    })

    const restored = createPermanentDeathRuntime({ enabled: true })
    registry.load(restored, saved)
    expect(restored.isPermanentlyDead(first)).toBe(true)
    expect(restored.isPermanentlyDead(second)).toBe(true)
  })

  it('refuse les restaurations hostiles sans altérer le dernier état valide', () => {
    const kept = instanceId('restore-kept')
    const runtime = createPermanentDeathRuntime({
      enabled: true,
      state: validState([kept]),
    })
    const invalidStates: unknown[] = [
      { ...validState([]), version: 2 },
      { ...validState([]), extra: true },
      validState([kept, kept]),
      validState(['not-an-instance-id']),
      { ...validState([]), deadPokemonInstanceIds: { 0: kept } },
      Object.assign(Object.create({ inherited: true }), validState([])),
    ]

    for (const invalidState of invalidStates) {
      expect(() => runtime.restoreState(invalidState)).toThrow()
      expect(runtime.snapshotState()).toEqual(validState([kept]))
    }
  })
})

function instanceId(path: string) {
  return deriveLegacyPokemonInstanceId('permanent-death-tests', path)
}

function member(path: string, speciesId: number): PokemonTeamMember {
  return Object.freeze({
    instanceId: instanceId(path),
    speciesId,
    isEgg: false,
    currentHp: 10,
  })
}

function markDead(
  runtime: ReturnType<typeof createPermanentDeathRuntime>,
  pokemonInstanceId: string,
): void {
  runtime.detailedBattleOutcomeObserver.observeBattleOutcome({
    kind: 'pokemon-knocked-out',
    pokemon: { instanceId: parsePokemonInstanceId(pokemonInstanceId), side: 'player', partyIndex: 0 },
  })
}

function validState(deadPokemonInstanceIds: readonly string[]) {
  return {
    format: permanentDeathStateFormat,
    version: 1,
    deadPokemonInstanceIds,
  } as const
}

function pokemon(path: string, speciesId: number): CanonicalPokemon {
  return createCanonicalPokemon(createPokemonTestCatalog(), {
    instanceId: instanceId(path),
    speciesId,
    level: 10,
    rng: createHgssLcrng(speciesId),
    personality: { kind: 'fixed', value: speciesId },
    individualValues: { kind: 'fixed', value: 0 },
    originalTrainer: { id: 7, name: 'JO', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 1, metLevel: 10, metTerrain: 0 },
    ballId: 4,
  })
}
