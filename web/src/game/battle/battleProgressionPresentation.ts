import { formatHgssRomMessage } from '../ui/romMessageFormatting'
import type { BattleLevelUp } from './battleProgression'
import { createCanonicalPokemonPartyTarget, type CanonicalPokemonPartyTarget, type PokemonPartySlotSource } from '../pokemon/canonicalPokemonPartyTarget'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import type { GameDigitalAction } from '../../gameInput'

export type BattleProgressionMessageEntry = string | {
  text: string
  onShow?: () => void
}

export function resolveFieldProgressionMessageInput(
  action: GameDigitalAction,
  presentationLocked: boolean,
): 'advance' | 'skip' | 'ignored' {
  if (action !== 'confirm' && action !== 'cancel') return 'ignored'
  return presentationLocked ? 'skip' : 'advance'
}

export type BattleMoveLearningMessagesOptions = {
  pokemonName: string
  learnedMoveIds: readonly number[]
  skippedMoveIds: readonly number[]
  moveNames: readonly string[]
  battleMessages: Record<number, string>
  onReplacementRequested: (moveId: number) => void
}

export type CanonicalBattleProgressionPresenterResources = {
  moveNames: readonly string[]
  battleMessages: Record<number, string>
}

export type CanonicalBattleProgressionPresenter = {
  createMoveLearningEntries(
    pokemon: CanonicalPokemon,
    source: PokemonPartySlotSource,
    learnedMoveIds: readonly number[],
    skippedMoveIds: readonly number[],
  ): BattleProgressionMessageEntry[]
  enqueueMoveLearning(
    queue: { enqueueMoveLearning(entry: BattleProgressionMessageEntry): void },
    pokemon: CanonicalPokemon,
    source: PokemonPartySlotSource,
    learnedMoveIds: readonly number[],
    skippedMoveIds: readonly number[],
  ): void
}

export function createCanonicalBattleProgressionPresenter(options: {
  getResources: () => CanonicalBattleProgressionPresenterResources | undefined
  getPokemonName: (pokemon: CanonicalPokemon) => string
  requestReplacement: (target: CanonicalPokemonPartyTarget, moveId: number) => void
}): CanonicalBattleProgressionPresenter {
  const createMoveLearningEntries: CanonicalBattleProgressionPresenter['createMoveLearningEntries'] = (
    pokemon, source, learnedMoveIds, skippedMoveIds,
  ) => {
    const resources = options.getResources()
    if (!resources) return []
    const target = createCanonicalPokemonPartyTarget(pokemon, source)
    return createBattleMoveLearningMessages({
      pokemonName: options.getPokemonName(pokemon),
      learnedMoveIds,
      skippedMoveIds,
      ...resources,
      onReplacementRequested: (moveId) => options.requestReplacement(target, moveId),
    })
  }
  return {
    createMoveLearningEntries,
    enqueueMoveLearning(queue, pokemon, source, learnedMoveIds, skippedMoveIds) {
      for (const entry of createMoveLearningEntries(pokemon, source, learnedMoveIds, skippedMoveIds)) queue.enqueueMoveLearning(entry)
    },
  }
}

/**
 * Construit une seule séquence ROM pour tous les apprentissages différés.
 * Le moteur de progression ne connaît ainsi ni le DOM ni le menu de combat.
 */
export function createBattleMoveLearningMessages(
  options: BattleMoveLearningMessagesOptions,
): BattleProgressionMessageEntry[] {
  const entries: BattleProgressionMessageEntry[] = []
  const moveName = (moveId: number) => options.moveNames[moveId] ?? `Capacité ${moveId}`

  for (const moveId of options.learnedMoveIds) {
    entries.push(formatHgssRomMessage(
      options.battleMessages[4] ?? '{101 0,0} apprend {106 1,0}!',
      [options.pokemonName, moveName(moveId)],
    ))
  }

  for (const moveId of options.skippedMoveIds) {
    const name = moveName(moveId)
    entries.push(
      formatHgssRomMessage(
        options.battleMessages[5] ?? '{101 0,0} tente d’apprendre {106 1,0}.',
        [options.pokemonName, name],
      ),
      formatHgssRomMessage(
        options.battleMessages[6] ?? 'Mais {101 0,0} ne peut pas avoir plus de quatre capacités.',
        [options.pokemonName],
      ),
      {
        text: formatHgssRomMessage(
          options.battleMessages[7] ?? 'Effacer une ancienne capacité pour {106 1,0}?',
          [name],
        ),
        onShow: () => options.onReplacementRequested(moveId),
      },
    )
  }

  return entries
}

export type BattleLevelUpCardOptions = {
  card: HTMLElement
  pokemonName: string
  level: BattleLevelUp
  levelUpLabel: string
  levelPrefix: string
  statsMessages: Record<number, string>
}

/** Rend uniquement la carte de statistiques ; sons et animations restent orchestrés par l'hôte. */
export function renderBattleLevelUpCard(options: BattleLevelUpCardOptions): void {
  const eyebrow = document.createElement('span')
  eyebrow.className = 'battle-level-up-eyebrow'
  eyebrow.textContent = options.levelUpLabel
  const heading = document.createElement('h3')
  heading.textContent = options.pokemonName
  const levelValue = document.createElement('strong')
  levelValue.className = 'battle-level-up-value'
  levelValue.textContent = `${options.levelPrefix}${options.level.level}`
  const header = document.createElement('header')
  header.append(eyebrow, heading, levelValue)
  const stats = document.createElement('div')
  stats.className = 'battle-level-up-stats'
  const labels = [
    [169, 'hp'], [170, 'attack'], [171, 'defense'], [174, 'speed'], [172, 'specialAttack'], [173, 'specialDefense'],
  ] as const
  stats.replaceChildren(...labels.flatMap(([messageId, stat]) => {
    const name = document.createElement('span')
    name.textContent = options.statsMessages[messageId] ?? ''
    const gain = document.createElement('strong')
    gain.textContent = `${options.level.statsAfter[stat]}  +${options.level.statsAfter[stat] - options.level.statsBefore[stat]}`
    return [name, gain]
  }))
  options.card.replaceChildren(header, stats)
  options.card.hidden = false
}

export function syncFieldProgressionScreen(
  elements: { screen: HTMLElement, message: HTMLElement, commands: HTMLElement, moves: HTMLElement },
  visible: boolean,
): void {
  elements.screen.classList.toggle('is-evolution-only', visible)
  elements.screen.hidden = !visible
  elements.message.hidden = true
  elements.commands.hidden = true
  elements.moves.hidden = true
  if (!visible) elements.moves.classList.remove('battle-learn-move')
}
