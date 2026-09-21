import { clonePokemonParty, createPokemonParty, type PokemonParty } from '../pokemon/pokemonParty'
import { basePokemonTeamPolicy, type PokemonTeamPolicy } from '../pokemon/pokemonTeamPolicy'
import { resolveBaseFieldBattleFormat, type ResolvedFieldBattleFormat } from './fieldBattleFormatResolver'
import { getUsableFieldBattlePartySlots } from './fieldBattlePartySelection'
import type { PreparedFieldBattle } from './prepareFieldBattle'

export type InitialBattleSide = {
  party: PokemonParty
  openingSlots: number[]
}

export type InitialTrainerBattleState = {
  kind: 'trainer'
  phase: 'setup'
  format: 'single' | 'double'
  turn: 0
  script: Extract<PreparedFieldBattle, { kind: 'trainer' }>['script']
  trainer: Extract<PreparedFieldBattle, { kind: 'trainer' }>['trainer']
  player: InitialBattleSide
  opponent: InitialBattleSide
}

function getOpeningSlots(party: PokemonParty, count: number, side: string): number[] {
  const slots = party.members
    .map((pokemon, slot) => ({ pokemon, slot }))
    .filter(({ pokemon }) => !pokemon.isEgg && pokemon.currentHp > 0)
    .slice(0, count)
    .map(({ slot }) => slot)
  if (slots.length !== count) {
    throw new Error(`L'equipe ${side} ne contient pas ${count} Pokemon utilisable${count > 1 ? 's' : ''} pour ce combat.`)
  }
  return slots
}

export function createInitialTrainerBattleState(
  prepared: Extract<PreparedFieldBattle, { kind: 'trainer' }>,
  resolution: ResolvedFieldBattleFormat = resolveBaseFieldBattleFormat(prepared),
  playerTeamPolicy: PokemonTeamPolicy = basePokemonTeamPolicy,
): InitialTrainerBattleState {
  if (resolution.engine === 'tutorial'
    || (resolution.engine === 'simple' && resolution.sessionKind !== 'trainer')
    || (resolution.engine === 'double' && resolution.sessionKind !== 'double')) {
    throw new Error(`Le moteur ${resolution.engine} ne correspond pas à un combat de Dresseur.`)
  }
  const format = resolution.engine === 'double' ? 'double' : 'single'
  const openingCount = format === 'double' ? 2 : 1
  const playerParty = clonePokemonParty(prepared.playerParty)
  const opponentParty = createPokemonParty(prepared.createdParty.map(({ pokemon }) => pokemon))
  const playerOpeningSlots = getUsableFieldBattlePartySlots(
    playerParty.members,
    { format: format === 'double' ? 'double' : 'simple', phase: 'initial' },
    playerTeamPolicy,
  ).slice(0, openingCount)
  if (playerOpeningSlots.length !== openingCount) {
    throw new Error(`L'equipe du joueur ne contient pas ${openingCount} Pokemon utilisable${openingCount > 1 ? 's' : ''} pour ce combat.`)
  }
  return {
    kind: 'trainer',
    phase: 'setup',
    format,
    turn: 0,
    script: { ...prepared.script },
    trainer: {
      ...prepared.trainer,
      items: [...prepared.trainer.items] as [number, number, number, number],
      party: prepared.trainer.party.map((pokemon) => ({
        ...pokemon,
        moveIds: pokemon.moveIds && [...pokemon.moveIds] as [number, number, number, number],
      })),
    },
    player: { party: playerParty, openingSlots: playerOpeningSlots },
    opponent: { party: opponentParty, openingSlots: getOpeningSlots(opponentParty, openingCount, 'adverse') },
  }
}
