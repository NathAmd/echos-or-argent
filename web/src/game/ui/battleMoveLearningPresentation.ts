import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import type { PokemonCatalog } from '../../ndsTypes'
import { formatHgssRomMessage } from './romMessageFormatting'

export type BattleMoveLearningPresentationOptions = {
  pokemon: CanonicalPokemon
  moveId: number
  pokemonCatalog: PokemonCatalog
  typeNames: readonly string[]
  sourceLabel: string
  cancelLabel: string
  partyMessages: Record<number, string>
  battleMessages: Record<number, string>
}

export type BattleMoveLearningChoice = {
  index: number
  name: string
  detail: string
}

export type BattleMoveLearningModel = {
  pokemonName: string
  newMoveName: string
  newMoveDetail: string
  choices: readonly BattleMoveLearningChoice[]
}

function requireRomLabel(labels: readonly string[], id: number, kind: string): string {
  const label = labels[id]
  if (!label) throw new Error(`Le nom ROM ${kind} ${id} est absent.`)
  return label
}

function formatMoveDetail(move: CanonicalPokemon['moves'][number]['data'], pp: number, maxPp: number, typeNames: readonly string[], messages: Record<number, string>): string {
  return `${requireRomLabel(typeNames, move.type, 'du type')} · ${move.power > 0 ? `${messages[48] ?? ''} ${move.power}` : messages[55] ?? ''} · ${messages[51] ?? ''} ${move.accuracy || '—'} · ${messages[43] ?? ''} ${pp}/${maxPp}`
}

export function createBattleMoveLearningModel(
  pokemon: CanonicalPokemon,
  moveId: number,
  pokemonCatalog: PokemonCatalog,
  typeNames: readonly string[],
  partyMessages: Record<number, string> = {},
): BattleMoveLearningModel {
  const newMove = pokemonCatalog.moves[moveId]
  if (!newMove) throw new Error(`La capacité ROM ${moveId} à apprendre est absente.`)
  return {
    pokemonName: pokemon.nickname ?? pokemon.speciesName,
    newMoveName: requireRomLabel(pokemonCatalog.moveNames, moveId, 'de la capacité'),
    newMoveDetail: formatMoveDetail(newMove, newMove.pp, newMove.pp, typeNames, partyMessages),
    choices: pokemon.moves.map((move, index) => ({
      index,
      name: requireRomLabel(pokemonCatalog.moveNames, move.moveId, 'de la capacité'),
      detail: formatMoveDetail(move.data, move.pp, move.maxPp, typeNames, partyMessages),
    })),
  }
}

export function createBattleMoveLearningPresentation(options: BattleMoveLearningPresentationOptions): HTMLElement[] {
  const model = createBattleMoveLearningModel(options.pokemon, options.moveId, options.pokemonCatalog, options.typeNames, options.partyMessages)
  const introduction = document.createElement('header')
  introduction.className = 'battle-learn-move-header'
  const source = document.createElement('span')
  source.textContent = options.sourceLabel
  const heading = document.createElement('h3')
  heading.textContent = model.newMoveName
  const summary = document.createElement('p')
  summary.textContent = model.newMoveDetail
  const instruction = document.createElement('strong')
  instruction.textContent = options.battleMessages[939] ?? ''
  introduction.append(source, heading, summary, instruction)
  const choices = model.choices.map((choice) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.battleForgetMove = String(choice.index)
    button.className = 'battle-learn-move-option'
    const action = document.createElement('small')
    action.textContent = options.partyMessages[58] ?? ''
    const name = document.createElement('strong')
    name.textContent = choice.name
    const detail = document.createElement('span')
    detail.textContent = choice.detail
    button.append(action, name, detail)
    return button
  })
  const cancel = document.createElement('button')
  cancel.type = 'button'
  cancel.dataset.battleForgetMove = '-1'
  cancel.className = 'battle-learn-move-cancel'
  cancel.textContent = options.cancelLabel
  return [introduction, ...choices, cancel]
}

export function formatMoveReplacementConfirmation(template: string, learnedMoveName: string): string {
  return formatHgssRomMessage(template, [learnedMoveName])
}
