import type { DoubleBattleEvent, DoubleBattlePosition, DoubleBattleSession } from '../battle/doubleBattleSession'
import type { SimpleBattleEvent, SimpleBattleSession } from '../battle/simpleBattleSession'
import { cloneCanonicalPokemon, type CanonicalPokemon } from '../pokemon/canonicalPokemon'
import type { RealtimeTestDebugCommand } from './realtimeTestScript'

export type RealtimeBattleDebugSessions = Readonly<{
  simple?: SimpleBattleSession
  double?: DoubleBattleSession
}>

export type RealtimeBattleDebugEffect =
  | Readonly<{ kind: 'state', message: string }>
  | Readonly<{ kind: 'simple-events', message: string, events: readonly SimpleBattleEvent[] }>
  | Readonly<{ kind: 'double-events', message: string, events: readonly DoubleBattleEvent[] }>

export type RealtimeBattleUiMode = 'message' | 'command' | 'moves' | 'doubleTarget' | 'party' | 'bag' | 'bagTarget' | 'bagMove' | 'learnMove'

/** L'automate DEV ne doit jamais transformer une avance de présentation en choix de combat. */
export function resolveRealtimeBattleAdvanceAction(mode: RealtimeBattleUiMode): 'confirm' | 'cancel' | undefined {
  if (mode === 'message') return 'confirm'
  if (mode === 'learnMove') return 'cancel'
  return undefined
}

export function resolveRealtimeTutorialStepAfterDebugEffect(
  step: 0 | 1 | 2 | undefined,
  effect: RealtimeBattleDebugEffect,
): 0 | 1 | 2 | undefined {
  return step !== undefined && effect.kind === 'simple-events' && effect.events.some(({ kind }) => kind === 'result') ? 2 : step
}

function pokemonName(pokemon: CanonicalPokemon): string {
  return pokemon.nickname ?? pokemon.speciesName
}

function setPartyHp(session: SimpleBattleSession, side: 'player' | 'opponent', hp: 'full' | 'zero'): void {
  const members = new Set([session[side].pokemon, ...session.parties[side]])
  for (const pokemon of members) if (!pokemon.isEgg) pokemon.currentHp = hp === 'full' ? pokemon.stats.hp : 0
}

function setDoublePartyHp(session: DoubleBattleSession, side: 'player' | 'opponent', hp: 'full' | 'zero', controlledOnly = false): void {
  const members = new Set(session.teams[side].filter(({ controlled }) => !controlledOnly || controlled).flatMap(({ party }) => party))
  for (const pokemon of members) if (!pokemon.isEgg) pokemon.currentHp = hp === 'full' ? pokemon.stats.hp : 0
}

function healActiveSimplePlayer(session: SimpleBattleSession): void {
  session.player.pokemon.currentHp = session.player.pokemon.stats.hp
  const partyMember = session.parties.player.find(({ instanceId }) => instanceId === session.player.pokemon.instanceId)
  if (partyMember) partyMember.currentHp = partyMember.stats.hp
}

function healActiveControlledDoublePlayers(session: DoubleBattleSession): void {
  for (const participant of session.teams.player) {
    if (!participant.controlled) continue
    const pokemon = participant.party[participant.activePartyIndex]
    if (pokemon) pokemon.currentHp = pokemon.stats.hp
  }
}

function simpleOpponentCanContinue(session: SimpleBattleSession): boolean {
  return [session.opponent.pokemon, ...session.parties.opponent].some((pokemon) => !pokemon.isEgg && pokemon.currentHp > 0)
}

function doubleOpponentCanContinue(session: DoubleBattleSession): boolean {
  return session.teams.opponent.some(({ party }) => party.some((pokemon) => !pokemon.isEgg && pokemon.currentHp > 0))
}

function isSimplePlayerHpLoss(event: SimpleBattleEvent): boolean {
  if (event.kind === 'faint') return event.side === 'player'
  if (event.kind === 'damage' || event.kind === 'selfDamage' || event.kind === 'residual' || event.kind === 'recoil'
    || event.kind === 'weatherDamage' || event.kind === 'entryHazard') return event.side === 'player'
  return event.kind === 'leechSeed' && event.side === 'player' && event.damage > 0
}

function isControlledDoublePlayerTarget(session: DoubleBattleSession, target: DoubleBattlePosition): boolean {
  return target.side === 'player' && session.teams.player[target.slot]?.controlled === true
}

function isDoublePlayerHpLoss(session: DoubleBattleSession, event: DoubleBattleEvent): boolean {
  if (event.kind !== 'damage' && event.kind !== 'selfDamage' && event.kind !== 'residual' && event.kind !== 'recoil'
    && event.kind !== 'weatherDamage' && event.kind !== 'faint') return false
  return isControlledDoublePlayerTarget(session, event.target)
}

function clearPlayerDoubleReplacements(session: DoubleBattleSession): void {
  for (const [key, target] of session.pendingReplacements) if (isControlledDoublePlayerTarget(session, target)) session.pendingReplacements.delete(key)
  if (session.phase === 'replacement' && session.pendingReplacements.size === 0) session.phase = 'command'
}

export function createRealtimeBattleDebugController(): {
  execute: (command: RealtimeTestDebugCommand, sessions: RealtimeBattleDebugSessions) => RealtimeBattleDebugEffect
  protectSimpleEvents: (session: SimpleBattleSession, events: readonly SimpleBattleEvent[]) => SimpleBattleEvent[]
  protectDoubleEvents: (session: DoubleBattleSession, events: readonly DoubleBattleEvent[]) => DoubleBattleEvent[]
  isGodModeEnabled: (sessions: RealtimeBattleDebugSessions) => boolean
  reset: () => void
} {
  let godModeSessions = new WeakSet<SimpleBattleSession | DoubleBattleSession>()

  const protectSimpleEvents = (session: SimpleBattleSession, events: readonly SimpleBattleEvent[]): SimpleBattleEvent[] => {
    if (!godModeSessions.has(session)) return [...events]
    healActiveSimplePlayer(session)
    const lossWasResolved = session.result === 'lost' || events.some((event) => event.kind === 'result' && event.result === 'lost')
    let protectedEvents = events.filter((event) => !isSimplePlayerHpLoss(event) && !(event.kind === 'result' && event.result === 'lost'))
    if (!lossWasResolved) return protectedEvents
    delete session.pendingSwitches.player
    session.switchingSide = undefined
    if (!simpleOpponentCanContinue(session)) {
      session.phase = 'ended'
      session.result = 'won'
      protectedEvents = protectedEvents.filter((event) => event.kind !== 'result')
      return [...protectedEvents, { kind: 'result', result: 'won' }]
    }
    session.phase = 'command'
    session.result = undefined
    return protectedEvents
  }

  const protectDoubleEvents = (session: DoubleBattleSession, events: readonly DoubleBattleEvent[]): DoubleBattleEvent[] => {
    if (!godModeSessions.has(session)) return [...events]
    healActiveControlledDoublePlayers(session)
    const lossWasResolved = session.result === 'lost' || events.some((event) => event.kind === 'result' && event.result === 'lost')
    let protectedEvents = events.filter((event) => !isDoublePlayerHpLoss(session, event)
      && !(event.kind === 'replacementRequest' && isControlledDoublePlayerTarget(session, event.target))
      && !(event.kind === 'result' && event.result === 'lost'))
    clearPlayerDoubleReplacements(session)
    if (!lossWasResolved) return protectedEvents
    if (!doubleOpponentCanContinue(session)) {
      session.phase = 'ended'
      session.result = 'won'
      protectedEvents = protectedEvents.filter((event) => event.kind !== 'result')
      return [...protectedEvents, { kind: 'result', result: 'won' }]
    }
    session.phase = 'command'
    session.result = undefined
    return protectedEvents
  }

  return {
    execute(command, sessions) {
      if (command.kind === 'godmode') {
        const session = sessions.double ?? sessions.simple
        if (!session) throw new Error('Aucun combat simple ou double actif. En Safari, le godmode ne s’applique pas.')
        if (command.enabled) godModeSessions.add(session)
        else godModeSessions.delete(session)
        if (command.enabled && sessions.simple) healActiveSimplePlayer(sessions.simple)
        if (command.enabled && sessions.double) healActiveControlledDoublePlayers(sessions.double)
        return { kind: 'state', message: `Godmode ${command.enabled ? 'activé' : 'désactivé'}.` }
      }
      const simple = sessions.simple
      const double = sessions.double
      if (!simple && !double) throw new Error('Aucun combat simple ou double actif. En Safari, ces commandes de PV ne s’appliquent pas.')
      if (simple) {
        if (simple.phase === 'ended') throw new Error('Le combat simple est déjà terminé.')
        const side = command.kind === 'instant-kill' ? 'opponent' : 'player'
        if (side === 'player') godModeSessions.delete(simple)
        setPartyHp(simple, side, 'zero')
        const defeated = cloneCanonicalPokemon(simple[side].pokemon)
        const result = side === 'opponent' ? 'won' : 'lost'
        simple.phase = 'ended'
        simple.result = result
        return {
          kind: 'simple-events',
          message: command.kind === 'instant-kill' ? 'Victoire instantanée injectée dans le combat simple.' : 'Défaite volontaire injectée dans le combat simple.',
          events: [
            { kind: 'faint', side, pokemonName: pokemonName(defeated), defeated },
            { kind: 'result', result },
          ],
        }
      }
      if (double!.phase === 'ended') throw new Error('Le combat double est déjà terminé.')
      if (command.kind === 'suicide' && double!.teams.player.some(({ controlled }) => !controlled)) throw new Error('Suicide non applicable en combat Multi: l’allié non contrôlé doit rester autoritaire.')
      const side = command.kind === 'instant-kill' ? 'opponent' : 'player'
      if (side === 'player') godModeSessions.delete(double!)
      const active = double!.teams[side].filter(({ controlled }) => side === 'opponent' || controlled).map((participant, slot) => ({
        target: { side, slot: slot as 0 | 1 } satisfies DoubleBattlePosition,
        pokemon: participant.party[participant.activePartyIndex]!,
      }))
      setDoublePartyHp(double!, side, 'zero', side === 'player')
      const result = side === 'opponent' ? 'won' : 'lost'
      double!.phase = 'ended'
      double!.result = result
      double!.pendingReplacements.clear()
      return {
        kind: 'double-events',
        message: command.kind === 'instant-kill' ? 'Victoire instantanée injectée dans le combat double.' : 'Défaite volontaire injectée dans le combat double.',
        events: [
          ...active.map(({ target, pokemon }): DoubleBattleEvent => ({ kind: 'faint', target, pokemonName: pokemonName(pokemon), defeated: cloneCanonicalPokemon(pokemon) })),
          { kind: 'result', result },
        ],
      }
    },
    protectSimpleEvents,
    protectDoubleEvents,
    isGodModeEnabled: (sessions) => Boolean(sessions.simple && godModeSessions.has(sessions.simple) || sessions.double && godModeSessions.has(sessions.double)),
    reset() { godModeSessions = new WeakSet() },
  }
}
