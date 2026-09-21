import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import { resolveHgssConsumedItemEffect } from './hgssConsumedItemRules'
import { applyHgssPrimaryStatus, type BattleStat } from './hgssBattleRules'
import type { DoubleBattleEvent, DoubleBattlePosition, DoubleBattleSession } from './doubleBattleSession'
import { isDoubleBattleWeatherSuppressed } from './doubleBattleMoveOrder'
import { canHgssConfuse } from './hgssAbilityMoveRules'
import { requireDoubleBattleParticipantAt } from './doubleBattleRoster'

export function applyDoubleConsumedItemEffect(session: DoubleBattleSession, position: DoubleBattlePosition, effect: number, parameter: number, rng: HgssLcrng, events: DoubleBattleEvent[]): void {
  const participant = requireDoubleBattleParticipantAt(session, position)
  const pokemon = participant.party[participant.activePartyIndex]!
  const resolved = resolveHgssConsumedItemEffect(effect, parameter, pokemon.stats.hp, pokemon.nature)
  const name = pokemon.nickname ?? pokemon.speciesName
  if (resolved.kind === 'heal') {
    if (participant.volatile.healBlockTurns > 0) return
    const amount = Math.min(resolved.amount, pokemon.stats.hp - pokemon.currentHp)
    pokemon.currentHp += amount
    if (amount > 0) events.push({ kind: 'heal', target: position, pokemonName: name, amount })
    if (resolved.confuse && participant.volatile.confusionTurns === 0 && canHgssConfuse(participant.volatile.abilitySuppressed ? 0 : participant.volatile.abilityOverrideId ?? pokemon.abilityId)) { participant.volatile.confusionTurns = 2 + rng.nextU16() % 4; events.push({ kind: 'confusion', target: position, pokemonName: name, state: 'started' }) }
  } else if (resolved.kind === 'cure') {
    const before = pokemon.status; const confusion = participant.volatile.confusionTurns
    if (resolved.status === 'all') { pokemon.status = 0; participant.volatile.confusionTurns = 0 }
    else if (resolved.status === 'paralysis') pokemon.status &= ~0x40
    else if (resolved.status === 'sleep') pokemon.status &= ~0x7
    else if (resolved.status === 'poison') pokemon.status &= ~(0x8 | 0x80 | 0xf00)
    else if (resolved.status === 'burn') pokemon.status &= ~0x10
    else if (resolved.status === 'freeze') pokemon.status &= ~0x20
    else participant.volatile.confusionTurns = 0
    events.push({ kind: 'statusCured', target: position, pokemonName: name, applied: before !== pokemon.status || confusion !== participant.volatile.confusionTurns })
  } else if (resolved.kind === 'restorePp') {
    const move = pokemon.moves.reduce((best, candidate) => candidate.maxPp - candidate.pp > (best ? best.maxPp - best.pp : 0) ? candidate : best, pokemon.moves[0])
    if (move) move.pp = Math.min(move.maxPp, move.pp + resolved.amount)
    events.push({ kind: 'condition', target: position, condition: 'consumedItemPp', applied: Boolean(move) })
  } else if (resolved.kind === 'raiseStat' || resolved.kind === 'raiseRandomStat') {
    const candidates = resolved.kind === 'raiseStat' ? [resolved.stat] : (['attack', 'defense', 'speed', 'specialAttack', 'specialDefense'] as BattleStat[]).filter((stat) => participant.stages[stat] < 6)
    const stat = candidates[rng.nextU16() % Math.max(1, candidates.length)]
    if (stat) { const before = participant.stages[stat]; participant.stages[stat] = Math.min(6, before + resolved.change); events.push({ kind: 'stat', target: position, pokemonName: name, stat, change: resolved.change, applied: before !== participant.stages[stat] }) }
  } else if (resolved.kind === 'focusEnergy') participant.volatile.focusEnergy = true
  else if (resolved.kind === 'nextMoveAccuracy') participant.volatile.micleAccuracy = true
  else if (resolved.kind === 'restoreLoweredStats') for (const stat of Object.keys(participant.stages) as BattleStat[]) participant.stages[stat] = Math.max(0, participant.stages[stat])
  else if (resolved.kind === 'cureInfatuation') participant.volatile.infatuated = false
  else if (resolved.kind === 'flinch') participant.volatile.flinched = true
  else if (resolved.kind === 'inflict' && session.sideConditions[position.side].safeguardTurns === 0) {
    const abilityId = participant.volatile.abilitySuppressed ? 0 : participant.volatile.abilityOverrideId ?? pokemon.abilityId
    events.push({ kind: 'status', target: position, pokemonName: name, ...applyHgssPrimaryStatus(resolved.status, pokemon, participant.types, rng, abilityId, { weather: isDoubleBattleWeatherSuppressed(session) ? 'clear' : session.weather.kind }) })
  }
}
