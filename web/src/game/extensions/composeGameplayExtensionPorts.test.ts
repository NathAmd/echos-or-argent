import { describe, expect, it, vi } from 'vitest'
import type { BattleProgressionPolicy, DefeatedPokemonProgressionRequest } from '../battle/battleProgressionPolicy'
import type { FieldBattleRosterPolicy, ScriptedWildPokemonDefinition } from '../battle/fieldBattleRosterPolicy'
import type { FieldWildEncounterIdentityPort } from '../encounters/fieldWildEncounterIdentityPort'
import type { PokemonInitialTeamResolver } from '../pokemon/pokemonInitialTeamResolver'
import type { DynamicWorldActor } from '../world/dynamicWorldActorRegistry'
import { baseGameplayExtensionPorts } from './gameplayExtensionPorts'
import { composeGameplayExtensionPorts } from './composeGameplayExtensionPorts'

describe('composeGameplayExtensionPorts', () => {
  it('preserve exactement la base gelee sans contribution', () => {
    const composed = composeGameplayExtensionPorts(baseGameplayExtensionPorts, [])

    expect(composed).toBe(baseGameplayExtensionPorts)
    expect(Object.isFrozen(composed)).toBe(true)
  })

  it('applique roster, progression, identite et equipe initiale dans l’ordre', () => {
    const order: string[] = []
    const firstRoster: FieldBattleRosterPolicy = {
      ...baseGameplayExtensionPorts.fieldBattleRosterPolicy,
      transformScriptedWildPokemon: (pokemon) => {
        order.push('roster-1')
        return { ...pokemon, level: pokemon.level + 1 }
      },
    }
    const secondRoster: FieldBattleRosterPolicy = {
      ...baseGameplayExtensionPorts.fieldBattleRosterPolicy,
      transformScriptedWildPokemon: (pokemon) => {
        order.push('roster-2')
        return { ...pokemon, speciesId: pokemon.speciesId + 1 }
      },
    }
    const firstProgression: BattleProgressionPolicy = {
      transformDefeatedPokemonRequest: (request) => {
        order.push('progression-1')
        return { ...request, experienceDivisor: 2 }
      },
    }
    const secondProgression: BattleProgressionPolicy = {
      transformDefeatedPokemonRequest: (request) => {
        order.push('progression-2')
        return { ...request, experienceDivisor: (request.experienceDivisor ?? 0) + 3 }
      },
    }
    const firstIdentity: FieldWildEncounterIdentityPort = (prepared) => {
      order.push('identity-1')
      return {
        ...prepared,
        encounter: { ...prepared.encounter, speciesId: 25 },
      } as typeof prepared
    }
    const secondIdentity: FieldWildEncounterIdentityPort = (prepared) => {
      order.push('identity-2')
      return {
        ...prepared,
        encounter: { ...prepared.encounter, level: prepared.encounter.level + 2 },
      } as typeof prepared
    }
    const initialTeamCommitted = vi.fn()
    const firstInitialTeam: PokemonInitialTeamResolver = Object.assign(
      (_request: Parameters<PokemonInitialTeamResolver>[0], currentTeam: Parameters<PokemonInitialTeamResolver>[1]) => {
        order.push(`team-1:${currentTeam.map((member) => member.speciesId).join(',')}`)
        return [...currentTeam, { speciesId: 152, level: 5, form: 0 }]
      },
      { onInitialTeamCommitted: initialTeamCommitted },
    )
    const secondInitialTeam: PokemonInitialTeamResolver = (_request, currentTeam) => {
      order.push(`team-2:${currentTeam.map((member) => member.speciesId).join(',')}`)
      return currentTeam.map((member) => ({ ...member, level: member.level + 1 }))
    }
    const composed = composeGameplayExtensionPorts(baseGameplayExtensionPorts, [
      {
        fieldBattleRosterPolicy: firstRoster,
        battleProgressionPolicy: firstProgression,
        fieldWildEncounterIdentityPort: firstIdentity,
        pokemonInitialTeamResolver: firstInitialTeam,
      },
      {
        fieldBattleRosterPolicy: secondRoster,
        battleProgressionPolicy: secondProgression,
        fieldWildEncounterIdentityPort: secondIdentity,
        pokemonInitialTeamResolver: secondInitialTeam,
      },
    ])

    const roster = composed.fieldBattleRosterPolicy.transformScriptedWildPokemon({
      speciesId: 1,
      level: 5,
    } satisfies ScriptedWildPokemonDefinition)
    const progression = composed.battleProgressionPolicy.transformDefeatedPokemonRequest({
      pokemon: {},
      defeated: {},
      trainerBattle: false,
    } as unknown as DefeatedPokemonProgressionRequest)
    const prepared = {
      encounter: { speciesId: 1, level: 5 },
    } as Parameters<FieldWildEncounterIdentityPort>[0]
    const identity = composed.fieldWildEncounterIdentityPort(prepared, { mapId: 1, source: 'step' })
    const team = composed.pokemonInitialTeamResolver({
      choice: 0,
      baseDefinition: { speciesId: 155, level: 5, form: 0 },
    }, [])
    const committedParty = [{
      instanceId: 'hgss-test:1',
      speciesId: 155,
      isEgg: false,
      currentHp: 20,
    }]
    composed.pokemonInitialTeamResolver.onInitialTeamCommitted?.(committedParty)

    expect(roster).toMatchObject({ speciesId: 2, level: 6 })
    expect(progression.experienceDivisor).toBe(5)
    expect(identity.encounter).toMatchObject({ speciesId: 25, level: 7 })
    expect(team).toEqual([
      { speciesId: 155, level: 6, form: 0 },
      { speciesId: 152, level: 6, form: 0 },
    ])
    expect(initialTeamCommitted).toHaveBeenCalledWith(committedParty)
    expect(order).toEqual([
      'roster-1',
      'roster-2',
      'progression-1',
      'progression-2',
      'identity-1',
      'identity-2',
      'team-1:155',
      'team-2:155,152',
    ])
  })

  it('notifie tous les observateurs dans l’ordre', () => {
    const calls: string[] = []
    const composed = composeGameplayExtensionPorts(baseGameplayExtensionPorts, [
      {
        wildEncounterStartedObserver: {
          observeWildEncounterStarted: () => { calls.push('wild-1') },
        },
        detailedBattleOutcomeObserver: {
          observeBattleOutcome: () => { calls.push('outcome-1') },
        },
      },
      {
        wildEncounterStartedObserver: {
          observeWildEncounterStarted: () => { calls.push('wild-2') },
        },
        detailedBattleOutcomeObserver: {
          observeBattleOutcome: () => { calls.push('outcome-2') },
        },
      },
    ])

    composed.wildEncounterStartedObserver.observeWildEncounterStarted({} as never)
    composed.detailedBattleOutcomeObserver.observeBattleOutcome({ kind: 'battle-finished', outcome: 'win' })

    expect(calls).toEqual(['wild-1', 'wild-2', 'outcome-1', 'outcome-2'])
  })

  it('retient le premier veto pour action, soin et equipe', () => {
    const lateAction = vi.fn(() => ({ code: 'late', reason: 'Trop tard.' }))
    const lateHealing = vi.fn(() => ({ code: 'late', reason: 'Trop tard.' }))
    const lateTeam = vi.fn(() => ({ code: 'late', reason: 'Trop tard.' }))
    const composed = composeGameplayExtensionPorts(baseGameplayExtensionPorts, [
      {
        battleActionPolicy: {
          vetoPlayerAction: () => ({ code: 'action-first', reason: 'Action bloquee.' }),
        },
        pokemonPartyHealingPolicy: {
          vetoFullHealRestoration: () => ({ code: 'heal-first', reason: 'Soin bloque.' }),
        },
        pokemonTeamPolicy: {
          vetoBattleEligibility: () => undefined,
          vetoPartyMutation: () => ({ code: 'team-first', reason: 'Equipe bloquee.' }),
        },
      },
      {
        battleActionPolicy: { vetoPlayerAction: lateAction },
        pokemonPartyHealingPolicy: { vetoFullHealRestoration: lateHealing },
        pokemonTeamPolicy: {
          vetoBattleEligibility: () => undefined,
          vetoPartyMutation: lateTeam,
        },
      },
    ])

    expect(composed.battleActionPolicy.vetoPlayerAction({
      kind: 'switch',
      format: 'simple',
      mode: 'voluntary',
      partyIndex: 1,
    })).toMatchObject({ code: 'action-first' })
    expect(composed.pokemonPartyHealingPolicy.vetoFullHealRestoration({} as never)).toMatchObject({
      code: 'heal-first',
    })
    expect(composed.pokemonTeamPolicy.vetoPartyMutation({} as never)).toMatchObject({ code: 'team-first' })
    expect(lateAction).not.toHaveBeenCalled()
    expect(lateHealing).not.toHaveBeenCalled()
    expect(lateTeam).not.toHaveBeenCalled()
  })

  it('conserve le plafond de niveau le plus bas', () => {
    const composed = composeGameplayExtensionPorts(baseGameplayExtensionPorts, [
      { pokemonLevelPolicy: { resolveLevelCap: () => 50 } },
      { pokemonLevelPolicy: { resolveLevelCap: () => 42 } },
      { pokemonLevelPolicy: { resolveLevelCap: () => 60 } },
    ])

    expect(composed.pokemonLevelPolicy.resolveLevelCap({} as never)).toBe(42)
  })

  it('utilise le dernier override pour format, route et Sac', () => {
    const firstFormat = (battle: Parameters<typeof baseGameplayExtensionPorts.fieldBattleFormatResolver>[0]) => (
      baseGameplayExtensionPorts.fieldBattleFormatResolver(battle)
    )
    const lastFormat = (battle: Parameters<typeof baseGameplayExtensionPorts.fieldBattleFormatResolver>[0]) => (
      baseGameplayExtensionPorts.fieldBattleFormatResolver(battle)
    )
    const firstRoute = (encounter: Parameters<typeof baseGameplayExtensionPorts.fieldWildEncounterRouteResolver>[0]) => (
      baseGameplayExtensionPorts.fieldWildEncounterRouteResolver(encounter)
    )
    const lastRoute = (encounter: Parameters<typeof baseGameplayExtensionPorts.fieldWildEncounterRouteResolver>[0]) => (
      baseGameplayExtensionPorts.fieldWildEncounterRouteResolver(encounter)
    )
    const firstBag = (...args: Parameters<typeof baseGameplayExtensionPorts.fieldBattleBagActionResolver>) => (
      baseGameplayExtensionPorts.fieldBattleBagActionResolver(...args)
    )
    const lastBag = (...args: Parameters<typeof baseGameplayExtensionPorts.fieldBattleBagActionResolver>) => (
      baseGameplayExtensionPorts.fieldBattleBagActionResolver(...args)
    )
    const composed = composeGameplayExtensionPorts(baseGameplayExtensionPorts, [
      {
        fieldBattleFormatResolver: firstFormat,
        fieldWildEncounterRouteResolver: firstRoute,
        fieldBattleBagActionResolver: firstBag,
      },
      {},
      {
        fieldBattleFormatResolver: lastFormat,
        fieldWildEncounterRouteResolver: lastRoute,
        fieldBattleBagActionResolver: lastBag,
      },
    ])

    expect(composed.fieldBattleFormatResolver).toBe(lastFormat)
    expect(composed.fieldWildEncounterRouteResolver).toBe(lastRoute)
    expect(composed.fieldBattleBagActionResolver).toBe(lastBag)
    expect(Object.isFrozen(composed)).toBe(true)
  })

  it('concatene les acteurs dynamiques et garde la premiere occurrence de chaque id', () => {
    const first = createVisibleWildActor('wild:1', 25)
    const duplicate = createVisibleWildActor('wild:1', 26)
    const second = createVisibleWildActor('wild:2', 133)
    const firstBlocking = vi.fn(() => [first])
    const secondBlocking = vi.fn(() => [duplicate, second])
    const composed = composeGameplayExtensionPorts(baseGameplayExtensionPorts, [
      {
        worldSessionExtensionPorts: {
          dynamicActors: {
            getBlockingActorsAt: firstBlocking,
            getInteractableActorsAt: () => [first],
          },
        },
      },
      {
        worldSessionExtensionPorts: {
          dynamicActors: {
            getBlockingActorsAt: secondBlocking,
            getInteractableActorsAt: () => [duplicate, second],
          },
        },
      },
    ])

    const blocking = composed.worldSessionExtensionPorts.dynamicActors.getBlockingActorsAt(1, 2, 3, 'player')
    const interactable = composed.worldSessionExtensionPorts.dynamicActors.getInteractableActorsAt(1, 2, 3)

    expect(blocking).toEqual([first, second])
    expect(interactable).toEqual([first, second])
    expect(Object.isFrozen(blocking)).toBe(true)
    expect(firstBlocking).toHaveBeenCalledWith(1, 2, 3, 'player')
    expect(secondBlocking).toHaveBeenCalledWith(1, 2, 3, 'player')
  })
})

function createVisibleWildActor(id: string, speciesId: number): DynamicWorldActor {
  return Object.freeze({
    id,
    kind: 'visible-wild',
    mapId: 1,
    tileX: 2,
    tileZ: 3,
    direction: 'south',
    collision: 'blocking',
    interaction: 'action',
    speciesId,
    form: 0,
    level: 5,
  })
}
