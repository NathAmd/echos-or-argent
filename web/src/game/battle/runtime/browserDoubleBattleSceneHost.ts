import type { RomInventory } from '../../../ndsTypes'
import type { CanvasAssetCache } from '../../../rendering/canvas/canvasAssets'
import { createBattleExperienceDisplay } from '../battleExperienceDisplay'
import {
  getBattlePokemonSpriteFrame,
  bindBattlePokemonSpritePresentation,
} from '../battlePokemonSpritePresentation'
import type { BattlePokemonSpriteAnimator } from '../battlePokemonSpriteAnimator'
import {
  canSwitchDoubleBattleParticipant,
  getDoubleBattleOccupiedPositions,
  getDoubleBattlePokemon,
  getDoubleBattleReserveIndexes,
  getLivingDoubleBattleTargets,
  getSelectableDoubleBattleMoveIndexes,
  type DoubleBattlePosition,
  type DoubleBattleSession,
} from '../doubleBattleSession'
import {
  getCurrentDoubleBattleCommandActor,
  setPendingDoubleBattleMove,
  setPendingDoubleBattleReplacement,
  type DoubleBattleCommandSelectionState,
} from '../doubleBattleCommandSelection'
import { resolveRememberedBattleMoveCursor } from '../battleMenuNavigation'
import { neutralBattleStatStages, type BattleStatStages } from '../hgssBattleRules'
import type { PokemonTeamPolicy } from '../../pokemon/pokemonTeamPolicy'
import type { CanonicalPokemon } from '../../pokemon/canonicalPokemon'
import {
  createBattleMoveChoices,
  createBattlePartyChoices,
  renderBattleTypeBadges,
} from '../../ui/battlePresentation'
import { renderBattlePartyGauge } from '../../ui/battlePartyGaugePresentation'
import {
  setBattleExperienceGaugeElement,
  syncBattleConditionHud,
} from '../battleHudPresentation'
import { formatHgssRomMessage } from '../../ui/romMessageFormatting'

export type DoubleBattleSceneUiMode = 'command' | 'moves' | 'party' | 'doubleTarget'

export type BrowserDoubleBattleSceneContext = Readonly<{
  battle?: DoubleBattleSession
  resources?: RomInventory
  selection: DoubleBattleCommandSelectionState
  teamPolicy: PokemonTeamPolicy
  vblank: number
}>

export type BrowserDoubleBattleSceneElements = Readonly<{
  screen: HTMLElement
  playerSprite: HTMLElement
  opponentSprite: HTMLElement
  playerParty: HTMLElement
  opponentParty: HTMLElement
  message: HTMLElement
  commands: HTMLElement
  moves: HTMLElement
}>

export type BrowserDoubleBattleSceneHostPorts = Readonly<{
  elements: BrowserDoubleBattleSceneElements
  readContext: () => BrowserDoubleBattleSceneContext
  setSelection: (selection: DoubleBattleCommandSelectionState) => void
  setCommandPresentation: () => void
  setUiMode: (mode: DoubleBattleSceneUiMode, canCancel?: boolean) => void
  setCursor: (cursor: number) => void
  renderCursor: (container: HTMLElement) => void
  getPokemonName: (pokemon: CanonicalPokemon) => string
  getBagItemCount: () => number
  createPokemonIcon: (pokemon: CanonicalPokemon) => HTMLElement | undefined
  selectTarget: (target: DoubleBattlePosition) => void
  syncHpZone: (progress: HTMLProgressElement) => void
  gaugeAnimationVersions: WeakMap<HTMLProgressElement, number>
  canvasAssets: Pick<CanvasAssetCache, 'mountGraphicCanvas'>
  spriteAnimator: Pick<BattlePokemonSpriteAnimator, 'registerDouble'>
}>

export type BrowserDoubleBattleSceneHost = Readonly<{
  element: (position: DoubleBattlePosition) => { sprite: HTMLElement, hud: HTMLElement }
  renderPosition: (
    position: DoubleBattlePosition,
    pokemon: CanonicalPokemon,
    types: readonly number[],
    stages: BattleStatStages,
    hidden?: boolean,
  ) => void
  render: (initial?: boolean, hidden?: boolean) => void
  currentActor: () => DoubleBattlePosition | undefined
  showCommands: () => void
  showMoves: () => void
  showParty: () => void
  showReplacement: (target: DoubleBattlePosition, reserveIndexes: readonly number[]) => void
  showTargets: (moveIndex: number) => void
  rememberMove: (actor: DoubleBattlePosition, moveIndex: number) => void
  clearRememberedMoves: () => void
}>

/**
 * Possède la scène et les menus d'un combat double navigateur.
 *
 * Le moteur fournit la session et la sélection courantes ; ce host ne décide
 * aucune action de combat. Il traduit uniquement cet état vers le DOM et
 * conserve la mémoire locale du dernier curseur de capacité par combattant.
 */
export function createBrowserDoubleBattleSceneHost(
  ports: BrowserDoubleBattleSceneHostPorts,
): BrowserDoubleBattleSceneHost {
  const rememberedMoveByPokemon = new Map<string, number>()

  function element(position: DoubleBattlePosition): { sprite: HTMLElement, hud: HTMLElement } {
    const { screen, playerSprite, opponentSprite } = ports.elements
    const key = `${position.side}-${position.slot}`
    const sprite = position.slot === 0
      ? position.side === 'player' ? playerSprite : opponentSprite
      : screen.querySelector<HTMLElement>(`[data-double-sprite='${key}']`)
    const hud = position.slot === 0
      ? screen.querySelector<HTMLElement>(`.battle-hud-${position.side}:not(.battle-hud-secondary)`)
      : screen.querySelector<HTMLElement>(`[data-double-hud='${key}']`)
    if (!sprite || !hud) throw new Error(`L'emplacement visuel double ${key} est absent.`)
    return { sprite, hud }
  }

  function renderPosition(
    position: DoubleBattlePosition,
    pokemon: CanonicalPokemon,
    types: readonly number[],
    stages: BattleStatStages,
    hidden = false,
  ): void {
    const { resources, vblank } = ports.readContext()
    if (!resources) return
    const { sprite, hud } = element(position)
    const graphic = resources.battlePokemonSpriteResolver({
      speciesId: pokemon.speciesId,
      form: pokemon.form,
      gender: pokemon.gender,
      facing: position.side === 'player' ? 'back' : 'front',
      shiny: pokemon.shiny,
    })
    const visualKey = [pokemon.speciesId, pokemon.form, pokemon.gender, position.side, pokemon.shiny].join(':')
    const binding = bindBattlePokemonSpritePresentation(sprite, pokemon, {
      force: sprite.dataset.battlePokemonVisual !== visualKey,
      hidden: hidden || pokemon.currentHp <= 0,
    })
    if (binding.changed) {
      ports.canvasAssets.mountGraphicCanvas(getBattlePokemonSpriteFrame(sprite), graphic.frames[0]!)
      ports.spriteAnimator.registerDouble(position, sprite, graphic, vblank)
    }
    sprite.dataset.battlePokemonVisual = visualKey
    sprite.style.setProperty('--battle-sprite-height', `${graphic.height}`)
    sprite.dataset.shiny = String(pokemon.shiny)
    sprite.hidden = hidden || pokemon.currentHp <= 0
    hud.querySelector('strong')!.textContent = ports.getPokemonName(pokemon)
    hud.dataset.gender = pokemon.gender
    renderBattleTypeBadges(hud.querySelector('.battle-types'), types, resources.pokedexCatalog.typeNames)
    hud.querySelector<HTMLElement>(':scope > div > span:last-child')!.textContent = `Nv.${pokemon.level}`
    const hp = hud.querySelector<HTMLProgressElement>('progress')!
    ports.gaugeAnimationVersions.set(hp, (ports.gaugeAnimationVersions.get(hp) ?? 0) + 1)
    hp.max = pokemon.stats.hp
    hp.value = pokemon.currentHp
    ports.syncHpZone(hp)
    const hpText = hud.querySelector<HTMLElement>('.battle-hp-text')
    if (hpText) hpText.textContent = `${pokemon.currentHp} / ${pokemon.stats.hp}`
    if (position.side === 'player') {
      const expProgress = hud.querySelector<HTMLProgressElement>('.battle-exp progress')
      if (expProgress) {
        const experience = createBattleExperienceDisplay(pokemon, resources.pokemonCatalog)
        setBattleExperienceGaugeElement(expProgress, experience.progress, experience.required, experience.levelCap)
      }
    }
    syncBattleConditionHud(hud, pokemon, stages)
    hud.hidden = hidden
  }

  function render(initial = false, hidden = initial): void {
    const { battle, resources } = ports.readContext()
    if (!battle || !resources) return
    for (const position of getDoubleBattleOccupiedPositions(battle)) {
      const participant = battle.teams[position.side][position.slot]!
      const pokemon = getDoubleBattlePokemon(battle, position)
      const original = initial ? participant.volatile.battleFormOriginal : undefined
      renderPosition(
        position,
        original ? { ...pokemon, form: original.form } : pokemon,
        initial
          ? original?.types ?? resources.pokemonCatalog.personalData[pokemon.speciesId]?.types ?? participant.types
          : participant.types,
        initial ? { ...neutralBattleStatStages } : participant.stages,
        hidden,
      )
    }
    for (const side of ['player', 'opponent'] as const) {
      const members: CanonicalPokemon[] = []
      const activeSlots = new Set<number>()
      const owners = new Set<string>()
      for (const participant of battle.teams[side]) {
        if (owners.has(participant.ownerId)) continue
        owners.add(participant.ownerId)
        const offset = members.length
        members.push(...participant.party)
        for (const teammate of battle.teams[side]) {
          if (teammate.ownerId === participant.ownerId) activeSlots.add(offset + teammate.activePartyIndex)
        }
      }
      const gauge = side === 'player' ? ports.elements.playerParty : ports.elements.opponentParty
      renderBattlePartyGauge(gauge, members.slice(0, 6), activeSlots)
      gauge.hidden = false
    }
  }

  function currentActor(): DoubleBattlePosition | undefined {
    const { battle, selection } = ports.readContext()
    return battle && getCurrentDoubleBattleCommandActor(battle, selection)
  }

  function showCommands(): void {
    const { battle, resources, teamPolicy } = ports.readContext()
    const actor = currentActor()
    if (!battle || !resources || !actor) return
    render()
    ports.setCommandPresentation()
    ports.setUiMode('command')
    ports.setCursor(0)
    ports.elements.message.textContent = formatHgssRomMessage(
      resources.battleMessages[921] ?? '',
      [ports.getPokemonName(getDoubleBattlePokemon(battle, actor))],
    )
    ports.elements.message.hidden = false
    ports.elements.moves.hidden = true
    const commands = [
      [resources.battleMessages[924] ?? '', 'fight'],
      [resources.battleMessages[925] ?? '', 'bag'],
      [resources.battleMessages[926] ?? '', 'party'],
      [resources.battleMessages[927] ?? '', 'run'],
    ] as const
    ports.elements.commands.replaceChildren(...commands.map(([label, command]) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset.battleCommand = command
      button.textContent = label
      if (command === 'party') {
        button.disabled = !canSwitchDoubleBattleParticipant(battle, actor)
          || getDoubleBattleReserveIndexes(battle, actor, 'voluntary-switch', teamPolicy).length === 0
      }
      if (command === 'bag') button.disabled = ports.getBagItemCount() === 0
      return button
    }))
    ports.elements.commands.hidden = false
    ports.renderCursor(ports.elements.commands)
  }

  function showMoves(): void {
    const { battle, resources } = ports.readContext()
    const actor = currentActor()
    if (!battle || !resources || !actor) return
    const pokemon = getDoubleBattlePokemon(battle, actor)
    const supported = new Set(getSelectableDoubleBattleMoveIndexes(battle, actor))
    ports.setUiMode('moves')
    ports.elements.commands.hidden = true
    ports.elements.message.textContent = resources.battleMessages[924] ?? ''
    ports.elements.message.hidden = false
    ports.elements.moves.replaceChildren(...createBattleMoveChoices(pokemon.moves, supported, {
      moveNames: resources.pokemonCatalog.moveNames,
      typeNames: resources.pokedexCatalog.typeNames,
      ppLabel: resources.uiMessageBanks[6]?.[43],
      struggleMove: resources.pokemonCatalog.moves[165],
    }))
    ports.elements.moves.hidden = false
    const participant = battle.teams[actor.side][actor.slot]
    const memoryKey = `${actor.side}:${participant.ownerId}:${participant.activePartyIndex}`
    const enabledMoveIndexes = [...ports.elements.moves.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
      .map((button) => Number.parseInt(button.dataset.battleMove ?? '', 10))
    ports.setCursor(resolveRememberedBattleMoveCursor(enabledMoveIndexes, rememberedMoveByPokemon.get(memoryKey)))
    ports.renderCursor(ports.elements.moves)
  }

  function showParty(): void {
    const { battle, resources, teamPolicy } = ports.readContext()
    const actor = currentActor()
    if (!battle || !resources || !actor) return
    const participant = battle.teams[actor.side][actor.slot]
    const selectable = new Set(canSwitchDoubleBattleParticipant(battle, actor)
      ? getDoubleBattleReserveIndexes(battle, actor, 'voluntary-switch', teamPolicy)
      : [])
    ports.setUiMode('party')
    ports.setCursor(0)
    ports.elements.commands.hidden = true
    ports.elements.message.textContent = resources.uiMessageBanks[6]?.[6] ?? ''
    ports.elements.message.hidden = false
    ports.elements.moves.replaceChildren(...createBattlePartyChoices(
      participant.party,
      selectable,
      resources.pokedexCatalog.typeNames,
      (pokemon) => resources.pokemonCatalog.personalData[pokemon.speciesId]?.types ?? [0, 0],
      ports.createPokemonIcon,
      { level: resources.uiMessageBanks[6]?.[23], hp: resources.uiMessageBanks[6]?.[28] },
    ))
    ports.elements.moves.hidden = false
    ports.renderCursor(ports.elements.moves)
  }

  function showReplacement(target: DoubleBattlePosition, reserveIndexes: readonly number[]): void {
    const { battle, resources, selection } = ports.readContext()
    if (!battle || !resources || battle.phase !== 'replacement') return
    const participant = battle.teams[target.side][target.slot]
    ports.setSelection(setPendingDoubleBattleReplacement(selection, { target, reserveIndexes }))
    ports.setUiMode('party', false)
    ports.setCursor(0)
    ports.elements.commands.hidden = true
    ports.elements.message.textContent = 'Choisissez le Pokémon à envoyer.'
    ports.elements.message.hidden = false
    ports.elements.moves.replaceChildren(...createBattlePartyChoices(
      participant.party,
      new Set(reserveIndexes),
      resources.pokedexCatalog.typeNames,
      (pokemon) => resources.pokemonCatalog.personalData[pokemon.speciesId]?.types ?? [0, 0],
      ports.createPokemonIcon,
      { level: resources.uiMessageBanks[6]?.[23], hp: resources.uiMessageBanks[6]?.[28] },
    ))
    ports.elements.moves.hidden = false
    ports.renderCursor(ports.elements.moves)
  }

  function showTargets(moveIndex: number): void {
    const { battle, resources, selection } = ports.readContext()
    const actor = currentActor()
    if (!battle || !resources || !actor) return
    const move = moveIndex === -1
      ? resources.pokemonCatalog.moves[165]
      : getDoubleBattlePokemon(battle, actor).moves[moveIndex]?.data
    if (!move) return
    ports.setSelection(setPendingDoubleBattleMove(selection, moveIndex))
    if ((move.range & ((1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5) | (1 << 6) | (1 << 7))) !== 0) {
      ports.selectTarget(actor)
      return
    }
    const targetSide = (move.range & ((1 << 8) | (1 << 9))) !== 0
      ? actor.side
      : actor.side === 'player' ? 'opponent' : 'player'
    let targets = getLivingDoubleBattleTargets(battle, targetSide)
    if ((move.range & (1 << 8)) !== 0) targets = targets.filter((target) => target.slot !== actor.slot)
    if (targets.length === 0) targets = [actor]
    ports.setUiMode('doubleTarget')
    ports.setCursor(0)
    ports.elements.message.textContent = resources.uiMessageBanks[6]?.[6] ?? ''
    ports.elements.message.hidden = false
    ports.elements.moves.replaceChildren(...targets.map((target) => {
      const pokemon = getDoubleBattlePokemon(battle, target)
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset.doubleTargetSide = target.side
      button.dataset.doubleTarget = String(target.slot)
      button.textContent = `${ports.getPokemonName(pokemon)} · ${resources.uiMessageBanks[6]?.[28] ?? ''} ${pokemon.currentHp}/${pokemon.stats.hp}`
      return button
    }))
    ports.renderCursor(ports.elements.moves)
  }

  function rememberMove(actor: DoubleBattlePosition, moveIndex: number): void {
    const { battle } = ports.readContext()
    const participant = battle?.teams[actor.side][actor.slot]
    if (!participant) return
    rememberedMoveByPokemon.set(`${actor.side}:${participant.ownerId}:${participant.activePartyIndex}`, moveIndex)
  }

  return Object.freeze({
    element,
    renderPosition,
    render,
    currentActor,
    showCommands,
    showMoves,
    showParty,
    showReplacement,
    showTargets,
    rememberMove,
    clearRememberedMoves: () => { rememberedMoveByPokemon.clear() },
  })
}
