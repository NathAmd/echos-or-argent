import type { PokemonCatalog } from '../../ndsTypes'
import { useFieldItemOnPokemon } from '../items/useFieldItem'
import { basePokemonPartyHealingPolicy } from '../pokemon/pokemonPartyHealingPolicy'
import type {
  DoubleBattleEvent,
  DoubleBattlePosition,
  DoubleBattleSession,
  DoubleBattleTrainerItemAction,
} from './doubleBattleSession'
import { requireDoubleBattleParticipantAt } from './doubleBattleRoster'

function trainerItemCanAffect(session: DoubleBattleSession, actor: DoubleBattlePosition, itemId: number): boolean {
  const participant = requireDoubleBattleParticipantAt(session, actor)
  const pokemon = participant.party[participant.activePartyIndex]
  const item = session.itemCatalog?.items[itemId]
  if (!pokemon || pokemon.currentHp <= 0 || !item) return false
  const parameters = item.partyParameters
  const status = pokemon.status
  const healsStatus = parameters.sleepHeal && (status & 0x7) !== 0
    || parameters.poisonHeal && (status & (0x8 | 0x80)) !== 0
    || parameters.burnHeal && (status & 0x10) !== 0
    || parameters.freezeHeal && (status & 0x20) !== 0
    || parameters.paralysisHeal && (status & 0x40) !== 0
    || parameters.confusionHeal && participant.volatile.confusionTurns > 0
    || parameters.infatuationHeal && participant.volatile.infatuated
  const healsHp = parameters.hpRestore
    && pokemon.currentHp < pokemon.stats.hp
    && pokemon.currentHp * 2 <= pokemon.stats.hp
  const raisesStats = parameters.guardSpec && session.sideConditions[actor.side].mistTurns === 0
    || parameters.attackStages > 0 && participant.stages.attack < 6
    || parameters.defenseStages > 0 && participant.stages.defense < 6
    || parameters.specialAttackStages > 0 && participant.stages.specialAttack < 6
    || parameters.specialDefenseStages > 0 && participant.stages.specialDefense < 6
    || parameters.speedStages > 0 && participant.stages.speed < 6
    || parameters.accuracyStages > 0 && participant.stages.accuracy < 6
    || parameters.criticalRateStages > 0 && !participant.volatile.focusEnergy
  return Boolean(healsStatus || healsHp || raisesStats)
}

export function chooseDoubleBattleTrainerItemAction(
  session: DoubleBattleSession,
  actor: DoubleBattlePosition,
): DoubleBattleTrainerItemAction | undefined {
  const participant = requireDoubleBattleParticipantAt(session, actor)
  const itemId = participant.ai.items.find((candidate) => trainerItemCanAffect(session, actor, candidate))
  return itemId === undefined ? undefined : {
    kind: 'trainerItem',
    actor,
    itemId,
    targetPartyIndex: participant.activePartyIndex,
  }
}

export function applyDoubleBattleTrainerItem(
  session: DoubleBattleSession,
  action: DoubleBattleTrainerItemAction,
  catalog: PokemonCatalog,
): DoubleBattleEvent[] {
  const participant = requireDoubleBattleParticipantAt(session, action.actor)
  const pokemon = participant.party[action.targetPartyIndex]
  const item = session.itemCatalog?.items[action.itemId]
  const itemIndex = participant.ai.items.indexOf(action.itemId)
  if (!pokemon || !item || itemIndex < 0 || pokemon.currentHp <= 0) {
    return [{
      kind: 'item',
      actor: action.actor,
      itemId: action.itemId,
      itemName: item?.name ?? `Objet ${action.itemId}`,
      source: 'trainer',
      trainerName: participant.ai.trainerName,
      applied: false,
      reason: "L'objet du Dresseur n'est plus utilisable.",
    }]
  }
  participant.ai.items.splice(itemIndex, 1)
  const itemEvent: Extract<DoubleBattleEvent, { kind: 'item' }> = {
    kind: 'item',
    actor: action.actor,
    itemId: item.itemId,
    itemName: item.name,
    source: 'trainer',
    trainerName: participant.ai.trainerName,
    applied: true,
  }
  const events: DoubleBattleEvent[] = [itemEvent]
  const parameters = item.partyParameters
  const stageChanges = [
    ['attack', parameters.attackStages], ['defense', parameters.defenseStages],
    ['specialAttack', parameters.specialAttackStages], ['specialDefense', parameters.specialDefenseStages],
    ['speed', parameters.speedStages], ['accuracy', parameters.accuracyStages],
  ] as const
  const combatItem = stageChanges.some(([, change]) => change > 0)
    || parameters.guardSpec || parameters.criticalRateStages > 0
  if (combatItem) {
    for (const [stat, change] of stageChanges) if (change > 0) {
      const before = participant.stages[stat]
      participant.stages[stat] = Math.min(6, before + change)
      if (participant.stages[stat] !== before) events.push({
        kind: 'stat', target: action.actor, pokemonName: pokemon.nickname ?? pokemon.speciesName,
        stat, change, applied: true,
      })
    }
    if (parameters.guardSpec) session.sideConditions[action.actor.side].mistTurns = 5
    if (parameters.criticalRateStages > 0) participant.volatile.focusEnergy = true
    return events
  }
  const hpBefore = pokemon.currentHp
  const statusBefore = pokemon.status
  const confusionBefore = participant.volatile.confusionTurns
  const infatuationBefore = participant.volatile.infatuated
  const result = useFieldItemOnPokemon(new Map([[item.itemId, 1]]), item, pokemon, undefined, {
    pokemonCatalog: catalog,
    itemCatalog: session.itemCatalog,
    party: participant.party,
    healingPolicy: basePokemonPartyHealingPolicy,
    partyIndex: action.targetPartyIndex,
    healingSource: 'battle-item',
  })
  if (parameters.confusionHeal) participant.volatile.confusionTurns = 0
  if (parameters.infatuationHeal) participant.volatile.infatuated = false
  if (pokemon.currentHp > hpBefore) events.push({
    kind: 'heal', target: action.actor, pokemonName: pokemon.nickname ?? pokemon.speciesName,
    amount: pokemon.currentHp - hpBefore,
  })
  if (pokemon.status !== statusBefore || participant.volatile.confusionTurns !== confusionBefore
    || participant.volatile.infatuated !== infatuationBefore) {
    events.push({ kind: 'statusCured', target: action.actor, pokemonName: pokemon.nickname ?? pokemon.speciesName, applied: true })
  }
  if (result.kind !== 'used' && events.length === 1) {
    itemEvent.applied = false
    itemEvent.reason = result.reason
  }
  return events
}
