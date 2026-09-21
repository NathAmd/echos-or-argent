import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import { takeBagItem } from '../items/bagInventory'
import { resolveHgssActiveAbilityId } from './hgssBattleEntryRules'
import { resolveHgssSwitchBlock } from './hgssAbilityMoveRules'
import { getDoubleBattlePokemon, type DoubleBattlePosition, type DoubleBattleSession } from './doubleBattleSession'

export type DoubleWildRunResult = 'escaped' | 'failed'

const runAttempts = new WeakMap<DoubleBattleSession, number>()

function activeAbilityId(session: DoubleBattleSession, position: DoubleBattlePosition): number {
  const participant = session.teams[position.side][position.slot]!
  return resolveHgssActiveAbilityId(
    getDoubleBattlePokemon(session, position).abilityId,
    participant.volatile.abilityOverrideId,
    participant.volatile.abilitySuppressed,
  )
}

/** Reproduit le calcul HGSS de fuite pour l'acteur qui choisit RUN en 2v1. */
export function tryRunFromDoubleWildBattle(
  session: DoubleBattleSession,
  actor: DoubleBattlePosition,
  rng: HgssLcrng,
): DoubleWildRunResult {
  if (session.kind !== 'wild' || session.phase !== 'command' || actor.side !== 'player') {
    throw new Error("La fuite sauvage 2v1 n'est pas disponible dans ce combat.")
  }
  const participant = session.teams.player[actor.slot]!
  const pokemon = getDoubleBattlePokemon(session, actor)
  const opponents = session.teams.opponent.map((_, slot) => ({ side: 'opponent', slot: slot as 0 | 1 } as const))
    .filter((position) => getDoubleBattlePokemon(session, position).currentHp > 0)
  const opponentSpeed = Math.max(...opponents.map((position) => getDoubleBattlePokemon(session, position).stats.speed))
  const heldEffect = session.itemCatalog?.items[pokemon.heldItemId]?.holdEffect ?? 0
  const trapped = resolveHgssSwitchBlock({
    selfAbilityId: activeAbilityId(session, actor),
    selfTypes: participant.types,
    heldItemEffect: heldEffect,
    magnetRise: participant.volatile.magnetRiseTurns > 0,
    gravity: session.gravityTurns > 0,
    bound: participant.volatile.trappedTurns > 0 || participant.volatile.cannotSwitch,
    ingrained: participant.volatile.ingrain,
    opposingAbilityIds: opponents.map((position) => activeAbilityId(session, position)),
  }).blocked
  const attempts = runAttempts.get(session) ?? 0
  let escaped = activeAbilityId(session, actor) === 50 || heldEffect === 63
    || (!trapped && pokemon.stats.speed >= opponentSpeed)
  if (!escaped && !trapped) {
    escaped = Math.floor(pokemon.stats.speed * 128 / opponentSpeed) + attempts * 30 > rng.nextU16() % 256
  }
  runAttempts.set(session, attempts + 1)
  if (!escaped) return 'failed'
  session.phase = 'ended'
  session.result = 'escaped'
  return 'escaped'
}

/** Consomme transactionnellement un objet de fuite puis termine le 2v1. */
export function escapeDoubleWildBattleWithItem(
  session: DoubleBattleSession,
  inventory: Map<number, number>,
  item: Readonly<{ itemId: number, name: string }>,
): void {
  if (session.kind !== 'wild' || session.phase !== 'command') {
    throw new Error("L'objet de fuite n'est pas utilisable dans ce combat.")
  }
  if (!takeBagItem(inventory, item.itemId, 1)) {
    throw new Error(`${item.name} a disparu du Sac avant son utilisation.`)
  }
  session.phase = 'ended'
  session.result = 'escaped'
}
