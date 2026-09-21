import type { PokemonCatalog } from '../../ndsTypes'
import { takeBagItem } from '../items/bagInventory'
import { useFieldItemOnPokemon } from '../items/useFieldItem'
import { basePokemonPartyHealingPolicy, getPokemonHealingVeto, type PokemonPartyHealingPolicy } from '../pokemon/pokemonPartyHealingPolicy'
import type { DoubleBattleEvent, DoubleBattleItemAction, DoubleBattlePosition, DoubleBattleSession } from './doubleBattleSession'
import { getDoubleBattleOccupiedPositions, requireDoubleBattleParticipantAt } from './doubleBattleRoster'

function activeTargetPosition(session: DoubleBattleSession, ownerId: string, partyIndex: number): DoubleBattlePosition | undefined {
  for (const position of getDoubleBattleOccupiedPositions(session)) {
    const participant = requireDoubleBattleParticipantAt(session, position)
    if (participant.ownerId === ownerId && participant.activePartyIndex === partyIndex) return position
  }
  return undefined
}

export function validateDoubleBattleBagItem(session: DoubleBattleSession, action: DoubleBattleItemAction, catalog: PokemonCatalog, healingPolicy: PokemonPartyHealingPolicy = basePokemonPartyHealingPolicy): string | undefined {
  const participant = requireDoubleBattleParticipantAt(session, action.actor)
  const pokemon = participant.party[action.targetPartyIndex]
  const item = session.itemCatalog?.items[action.itemId]
  const inventory = session.bagInventory
  if (!pokemon || !item || !inventory) return 'Les données du Sac ou de la cible sont absentes.'
  const parameters = item.partyParameters
  const changes = [parameters.attackStages && participant.stages.attack < 6, parameters.defenseStages && participant.stages.defense < 6,
    parameters.specialAttackStages && participant.stages.specialAttack < 6, parameters.specialDefenseStages && participant.stages.specialDefense < 6,
    parameters.speedStages && participant.stages.speed < 6, parameters.accuracyStages && participant.stages.accuracy < 6]
  const combatItem = [parameters.attackStages, parameters.defenseStages, parameters.specialAttackStages, parameters.specialDefenseStages, parameters.speedStages, parameters.accuracyStages].some((change) => change > 0) || parameters.guardSpec || parameters.criticalRateStages > 0
  if (combatItem) {
    if (action.targetPartyIndex !== participant.activePartyIndex) return 'Cet objet de combat cible un Pokémon actif.'
    if (!changes.some(Boolean) && (!parameters.guardSpec || session.sideConditions[action.actor.side].mistTurns > 0) && (!parameters.criticalRateStages || participant.volatile.focusEnergy)) return `${item.name} n’aurait aucun effet.`
    return (inventory.get(item.itemId) ?? 0) > 0 ? undefined : `${item.name} n’est plus dans le Sac.`
  }
  const active = activeTargetPosition(session, participant.ownerId, action.targetPartyIndex)
  const volatile = active && requireDoubleBattleParticipantAt(session, active).volatile
  const volatileCure = Boolean(parameters.confusionHeal && volatile?.confusionTurns || parameters.infatuationHeal && volatile?.infatuated)
  const statusVeto = volatileCure ? getPokemonHealingVeto(pokemon, action.targetPartyIndex, 'status', 'battle-item', healingPolicy) : undefined
  const result = useFieldItemOnPokemon(new Map(inventory), item, structuredClone(pokemon), action.moveIndex, {
    pokemonCatalog: catalog, itemCatalog: session.itemCatalog, party: participant.party,
    healingPolicy, partyIndex: action.targetPartyIndex, healingSource: 'battle-item',
  })
  if (result.kind === 'no-effect' && volatileCure && !statusVeto) return undefined
  if (result.kind === 'no-effect' && statusVeto) return statusVeto.reason
  return result.kind === 'used' ? undefined : result.reason
}

export function applyDoubleBattleBagItem(session: DoubleBattleSession, action: DoubleBattleItemAction, catalog: PokemonCatalog, healingPolicy: PokemonPartyHealingPolicy = basePokemonPartyHealingPolicy): DoubleBattleEvent[] {
  const participant = requireDoubleBattleParticipantAt(session, action.actor)
  const pokemon = participant.party[action.targetPartyIndex]
  const item = session.itemCatalog?.items[action.itemId]
  const inventory = session.bagInventory
  if (!pokemon || !item || !inventory) return [{ kind: 'item', actor: action.actor, itemId: action.itemId, itemName: item?.name ?? `Objet ${action.itemId}`, applied: false, reason: 'Les données du Sac ou de la cible sont absentes.' }]
  const parameters = item.partyParameters
  const stageChanges = [
    ['attack', parameters.attackStages], ['defense', parameters.defenseStages], ['specialAttack', parameters.specialAttackStages],
    ['specialDefense', parameters.specialDefenseStages], ['speed', parameters.speedStages], ['accuracy', parameters.accuracyStages],
  ] as const
  const combatItem = stageChanges.some(([, change]) => change > 0) || parameters.guardSpec || parameters.criticalRateStages > 0
  if (combatItem) {
    if (action.targetPartyIndex !== participant.activePartyIndex) return [{ kind: 'item', actor: action.actor, itemId: item.itemId, itemName: item.name, applied: false, reason: 'Cet objet de combat cible un Pokémon actif.' }]
    const canApply = stageChanges.some(([stat, change]) => change > 0 && participant.stages[stat] < 6)
      || parameters.guardSpec && session.sideConditions[action.actor.side].mistTurns === 0
      || parameters.criticalRateStages > 0 && !participant.volatile.focusEnergy
    if (!canApply) return [{ kind: 'item', actor: action.actor, itemId: item.itemId, itemName: item.name, applied: false, reason: `${item.name} n’aurait aucun effet.` }]
    if (!takeBagItem(inventory, item.itemId, 1)) return [{ kind: 'item', actor: action.actor, itemId: item.itemId, itemName: item.name, applied: false, reason: `${item.name} n’est plus dans le Sac.` }]
    const statEvents: DoubleBattleEvent[] = []
    for (const [stat, change] of stageChanges) if (change > 0) {
      const before = participant.stages[stat]
      participant.stages[stat] = Math.min(6, before + change)
      if (participant.stages[stat] !== before) statEvents.push({ kind: 'stat', target: action.actor, pokemonName: pokemon.nickname ?? pokemon.speciesName, stat, change, applied: true })
    }
    if (parameters.guardSpec && session.sideConditions[action.actor.side].mistTurns === 0) session.sideConditions[action.actor.side].mistTurns = 5
    if (parameters.criticalRateStages > 0 && !participant.volatile.focusEnergy) participant.volatile.focusEnergy = true
    return [{ kind: 'item', actor: action.actor, itemId: item.itemId, itemName: item.name, applied: true }, ...statEvents]
  }
  const hpBefore = pokemon.currentHp
  const statusBefore = pokemon.status
  const active = activeTargetPosition(session, participant.ownerId, action.targetPartyIndex)
  const volatile = active && requireDoubleBattleParticipantAt(session, active).volatile
  const volatileCure = Boolean(parameters.confusionHeal && volatile?.confusionTurns || parameters.infatuationHeal && volatile?.infatuated)
  const statusVeto = volatileCure ? getPokemonHealingVeto(pokemon, action.targetPartyIndex, 'status', 'battle-item', healingPolicy) : undefined
  const allowedVolatileCure = volatileCure && !statusVeto
  const result = useFieldItemOnPokemon(inventory, item, pokemon, action.moveIndex, {
    pokemonCatalog: catalog, itemCatalog: session.itemCatalog, party: participant.party,
    healingPolicy, partyIndex: action.targetPartyIndex, healingSource: 'battle-item',
  })
  if (result.kind !== 'used' && (!allowedVolatileCure || result.kind !== 'no-effect')) return [{ kind: 'item', actor: action.actor, itemId: item.itemId, itemName: item.name, applied: false, reason: statusVeto?.reason ?? result.reason }]
  if (result.kind !== 'used' && !takeBagItem(inventory, item.itemId, 1)) return [{ kind: 'item', actor: action.actor, itemId: item.itemId, itemName: item.name, applied: false, reason: `${item.name} n’est plus dans le Sac.` }]
  if (volatile && allowedVolatileCure) { if (parameters.confusionHeal) volatile.confusionTurns = 0; if (parameters.infatuationHeal) volatile.infatuated = false }
  const events: DoubleBattleEvent[] = [{ kind: 'item', actor: action.actor, itemId: item.itemId, itemName: item.name, applied: true }]
  if (active && pokemon.currentHp > hpBefore) events.push({ kind: 'heal', target: active, pokemonName: pokemon.nickname ?? pokemon.speciesName, amount: pokemon.currentHp - hpBefore })
  if (active && (pokemon.status !== statusBefore || allowedVolatileCure)) events.push({ kind: 'statusCured', target: active, pokemonName: pokemon.nickname ?? pokemon.speciesName, applied: true })
  return events
}
