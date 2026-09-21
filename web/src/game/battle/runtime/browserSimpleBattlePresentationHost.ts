import type { RomAudioRuntime } from '../../../audio/romAudioRuntime'
import type { RomInventory } from '../../../ndsTypes'
import type { CanvasAssetCache } from '../../../rendering/canvas/canvasAssets'
import type { CanonicalPokemon } from '../../pokemon/canonicalPokemon'
import {
  resolveCanonicalPokemonPartyTarget,
  type CanonicalPokemonPartyTarget,
  type PokemonPartySlotSource,
} from '../../pokemon/canonicalPokemonPartyTarget'
import type { PokemonMoveLearningRequest } from '../../pokemon/pokemonMoveLearningCoordinator'
import type { PokemonTeamPolicy } from '../../pokemon/pokemonTeamPolicy'
import {
  createBattleBagChoices,
  createBattleItemTargetChoices,
  createBattleMoveChoices,
  createBattlePartyChoices,
  renderBattleTypeBadges,
} from '../../ui/battlePresentation'
import { createBattleMoveLearningPresentation } from '../../ui/battleMoveLearningPresentation'
import { renderBattlePartyGauge } from '../../ui/battlePartyGaugePresentation'
import {
  setBattleExperienceGaugeElement,
  syncBattleConditionHud,
} from '../battleHudPresentation'
import type { BattleLevelUp } from '../battleProgression'
import { createBattleExperienceDisplay } from '../battleExperienceDisplay'
import {
  moveBattleArcCursor,
  moveBattleMenuCursorSkippingDisabled,
  moveBattleMenuCursorSpatially,
  resolveRememberedBattleMoveCursor,
} from '../battleMenuNavigation'
import {
  bindBattlePokemonSpritePresentation,
  getBattlePokemonSpriteFrame,
} from '../battlePokemonSpritePresentation'
import type { BattlePokemonSpriteAnimator } from '../battlePokemonSpriteAnimator'
import { createBattlePresentationLease, type BattlePresentationSkipRegistry } from '../battlePresentationSkip'
import { renderBattleLevelUpCard } from '../battleProgressionPresentation'
import { playBattlePokemonEntrance } from '../battleSceneAnimations'
import { createHgssBattleSpriteEffectPlayback } from '../battleSpriteEffectPlayback'
import type { DoubleBattlePosition, DoubleBattleSession } from '../doubleBattleSession'
import {
  playHgssBattlePresentationAnimation,
  type HgssBattlePresentationAnimation,
} from '../hgssBattlePresentationAnimation'
import type { BattleStatStages } from '../hgssBattleRules'
import { canSwitchSimpleBattlePokemon, getSelectableSimpleBattleMoveIndexes, type SimpleBattleSession } from '../simpleBattleSession'
import { getUsableFieldBattlePartySlots } from '../fieldBattlePartySelection'
import type { FieldBattleBagCatalogItem } from '../fieldBattleBagActionResolver'
import type { HgssBattleAnimationPlaybackDiagnostic } from '../battleAnimationPlayback'
import { formatHgssRomMessage } from '../../ui/romMessageFormatting'
import { syncRovingControlSelection } from '../../ui/fieldControlInteraction'
import { syncBattleSubmenuPresentation } from '../../ui/battleSubmenuPresentation'

type BattleSide = 'player' | 'opponent'
type BattleDirection = 'left' | 'right' | 'up' | 'down'
export type BrowserBattleUiMode = 'message' | 'command' | 'moves' | 'doubleTarget' | 'party' | 'bag' | 'bagTarget' | 'bagMove' | 'learnMove'

export type BrowserBattleBagItem = FieldBattleBagCatalogItem

export type BrowserBattleBagEntry = Readonly<{
  item: BrowserBattleBagItem
  quantity: number
}>

export type BrowserSimpleBattlePresentationContext = Readonly<{
  resources?: RomInventory
  simpleBattle?: SimpleBattleSession
  doubleBattle?: DoubleBattleSession
  doubleActor?: DoubleBattlePosition
  playerParty: readonly CanonicalPokemon[]
  opponentParty: readonly CanonicalPokemon[]
  playerSlot: number
  opponentSlot: number
  teamPolicy: PokemonTeamPolicy
  battleAnimations: boolean
  presentationGeneration: number
  vblank: number
  audio?: RomAudioRuntime
}>

export type BrowserSimpleBattlePresentationElements = Readonly<{
  screen: HTMLElement
  effects: HTMLCanvasElement
  playerSprite: HTMLElement
  opponentSprite: HTMLElement
  playerParty: HTMLElement
  opponentParty: HTMLElement
  playerName: HTMLElement
  opponentName: HTMLElement
  playerLevel: HTMLElement
  opponentLevel: HTMLElement
  playerHp: HTMLProgressElement
  opponentHp: HTMLProgressElement
  playerExperience: HTMLProgressElement
  message: HTMLElement
  commands: HTMLElement
  choices: HTMLElement
}>

export type BrowserSimpleBattlePresentationHostPorts = Readonly<{
  elements: BrowserSimpleBattlePresentationElements
  readContext: () => BrowserSimpleBattlePresentationContext
  state: Readonly<{
    readMode: () => BrowserBattleUiMode
    setMode: (mode: BrowserBattleUiMode, canCancel?: boolean) => void
    readCursor: () => number
    setCursor: (cursor: number) => void
    setPartySelectionForced: (forced: boolean) => void
    setPendingItemId: (itemId: number) => void
    setMessageInputLocked: (locked: boolean) => void
  }>
  presentation: Readonly<{
    setPhase: (phase: 'command') => void
    reducedMotion: () => boolean
    trackAnimation: (run: { finished: Promise<unknown>, cancel: () => void } | undefined) => void
    restartAnimation: (element: HTMLElement, className: string) => { finished: Promise<unknown>, cancel: () => void }
    lockAnimation: () => () => void
    skip: BattlePresentationSkipRegistry
    reportAnimationDiagnostic: (diagnostic: HgssBattleAnimationPlaybackDiagnostic) => void
  }>
  assets: Readonly<{
    canvas: Pick<CanvasAssetCache, 'createGraphicCanvas' | 'mountGraphicCanvas'>
    pokemonAnimator: Pick<BattlePokemonSpriteAnimator, 'registerSimple'>
    gaugeAnimationVersions: WeakMap<HTMLProgressElement, number>
    createPokemonIcon: (pokemon: CanonicalPokemon) => HTMLElement | undefined
    createItemIcon: (itemId: number) => HTMLElement
  }>
  inventory: Readonly<{
    listBattleBagEntries: () => readonly BrowserBattleBagEntry[]
    isBattleBagItemBlocked: (item: BrowserBattleBagItem) => boolean
  }>
  progression: Readonly<{
    resolvePartySource: (source: PokemonPartySlotSource) => CanonicalPokemon[] | undefined
  }>
  messages: Readonly<{
    prepend: (message: string) => void
    showNext: () => void
  }>
  syncActiveParties: () => void
  getPokemonName: (pokemon: CanonicalPokemon) => string
}>

export type BrowserSimpleBattlePresentationHost = Readonly<{
  cancelAsyncPresentation: () => void
  refreshSprite: (side: BattleSide, pokemonOverride?: CanonicalPokemon, enter?: boolean) => void
  renderSideHud: (
    side: BattleSide,
    pokemon: CanonicalPokemon,
    types: readonly number[],
    stages: BattleStatStages,
    state?: SimpleBattleSession['player'],
  ) => void
  renderPersistentPartyGauges: (player: CanonicalPokemon, opponent: CanonicalPokemon) => void
  renderHud: (playerOverride?: CanonicalPokemon) => void
  setExperienceGauge: (value: number, maximum: number, levelCap?: boolean) => void
  playConditionEffect: (
    side: BattleSide,
    animation: HgssBattlePresentationAnimation,
    elements?: { player: HTMLElement, opponent: HTMLElement, hud?: HTMLElement },
  ) => void
  createSpriteEffectPlayback: () => ReturnType<typeof createHgssBattleSpriteEffectPlayback> | undefined
  showLevelUpCard: (pokemon: CanonicalPokemon, level: BattleLevelUp) => void
  showMoveLearningChoice: (request: PokemonMoveLearningRequest<CanonicalPokemonPartyTarget>) => void
  animateExperience: (from: CanonicalPokemon, to: CanonicalPokemon) => Promise<void>
  syncHpZone: (progress: HTMLProgressElement) => void
  renderCursor: (container: HTMLElement) => void
  moveCursor: (container: HTMLElement, direction: BattleDirection) => void
  showCommands: () => void
  showMoves: () => void
  showParty: (forced?: boolean) => void
  getBagItemCount: () => number
  showBag: () => void
  showItemTargets: (itemId: number) => void
  createPokemonIcon: (pokemon: CanonicalPokemon) => HTMLElement | undefined
  rememberMove: (partySlot: number, moveIndex: number) => void
  clearRememberedMoves: () => void
}>

/**
 * Possède la projection DOM d'un combat simple et ses menus de sélection.
 *
 * Les règles et mutations du combat restent derrière les ports : cet hôte ne
 * fait que présenter la session courante, mémoriser le curseur de capacité et
 * piloter les animations navigateur annulables.
 */
export function createBrowserSimpleBattlePresentationHost(
  ports: BrowserSimpleBattlePresentationHostPorts,
): BrowserSimpleBattlePresentationHost {
  const rememberedMoveByPartySlot = new Map<number, number>()
  const { elements } = ports
  let experienceAnimationVersion = 0

  function syncHpZone(progress: HTMLProgressElement): void {
    const ratio = progress.max > 0 ? progress.value / progress.max : 0
    progress.dataset.hpZone = ratio > .5 ? 'high' : ratio > .2 ? 'medium' : 'low'
  }

  function setExperienceGauge(value: number, maximum: number, levelCap = false): void {
    setBattleExperienceGaugeElement(elements.playerExperience, value, maximum, levelCap)
  }

  function createPokemonIcon(pokemon: CanonicalPokemon): HTMLElement | undefined {
    const icon = ports.assets.createPokemonIcon(pokemon)
    if (!icon) return undefined
    icon.className = 'battle-menu-rom-asset'
    return icon
  }

  function renderCursor(container: HTMLElement): void {
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
    if (buttons.length === 0) return
    const hadFocus = document.activeElement instanceof Element && container.contains(document.activeElement)
    const cursor = (ports.state.readCursor() + buttons.length) % buttons.length
    ports.state.setCursor(cursor)
    syncRovingControlSelection(buttons, cursor, 'aria-current', hadFocus)
    syncBattleSubmenuPresentation(container)
  }

  function moveCursor(container: HTMLElement, direction: BattleDirection): void {
    const allButtons = [...container.querySelectorAll<HTMLButtonElement>('button')]
    const enabledButtons = allButtons.filter((button) => !button.disabled)
    if (enabledButtons.length === 0) return
    const cursor = ports.state.readCursor()
    const currentButton = enabledButtons[(cursor + enabledButtons.length) % enabledButtons.length]!
    const currentPosition = Math.max(0, allButtons.indexOf(currentButton))
    const enabledPositions = allButtons.map((button) => !button.disabled)
    const mode = ports.state.readMode()
    const nextPosition = mode === 'command' || mode === 'moves'
      ? moveBattleArcCursor(currentPosition, enabledPositions, direction)
      : mode === 'bag' || mode === 'party'
        ? moveBattleMenuCursorSkippingDisabled(currentPosition, enabledPositions, direction, 1)
        : moveBattleMenuCursorSpatially(currentPosition, allButtons.map((button) => {
            const bounds = button.getBoundingClientRect()
            return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2, enabled: !button.disabled }
          }), direction)
    const nextButton = allButtons[nextPosition]
    const nextCursor = nextButton ? enabledButtons.indexOf(nextButton) : -1
    if (nextCursor >= 0) ports.state.setCursor(nextCursor)
  }

  function renderPersistentPartyGauges(player: CanonicalPokemon, opponent: CanonicalPokemon): void {
    const context = ports.readContext()
    if (!context.simpleBattle || context.simpleBattle.kind !== 'trainer') {
      elements.opponentParty.hidden = true
      elements.playerParty.hidden = true
      return
    }
    const playerMembers = context.playerParty.map((pokemon, slot) => slot === context.playerSlot ? player : pokemon)
    const opponentMembers = context.opponentParty.map((pokemon, slot) => slot === context.opponentSlot ? opponent : pokemon)
    renderBattlePartyGauge(elements.playerParty, playerMembers, new Set([context.playerSlot]))
    renderBattlePartyGauge(elements.opponentParty, opponentMembers, new Set([context.opponentSlot]))
    elements.playerParty.hidden = false
    elements.opponentParty.hidden = false
  }

  function refreshSprite(side: BattleSide, pokemonOverride?: CanonicalPokemon, enter = true): void {
    const context = ports.readContext()
    if (!context.resources || !context.simpleBattle) return
    const pokemon = pokemonOverride ?? context.simpleBattle[side].pokemon
    const sprite = context.resources.battlePokemonSpriteResolver({
      speciesId: pokemon.speciesId,
      form: pokemon.form,
      gender: pokemon.gender,
      facing: side === 'player' ? 'back' : 'front',
      shiny: pokemon.shiny,
    })
    const element = side === 'player' ? elements.playerSprite : elements.opponentSprite
    bindBattlePokemonSpritePresentation(element, pokemon, { force: true, hidden: !enter })
    ports.assets.canvas.mountGraphicCanvas(getBattlePokemonSpriteFrame(element), sprite.frames[0]!)
    element.dataset.battlePokemonVisual = [pokemon.speciesId, pokemon.form, pokemon.gender, side, pokemon.shiny].join(':')
    element.style.setProperty('--battle-sprite-height', `${sprite.height}`)
    element.dataset.shiny = String(pokemon.shiny)
    if (enter) ports.presentation.trackAnimation(playBattlePokemonEntrance({ sprite: element }))
    ports.assets.pokemonAnimator.registerSimple(side, element, sprite, context.vblank)
  }

  function renderSideHud(
    side: BattleSide,
    pokemon: CanonicalPokemon,
    types: readonly number[],
    stages: BattleStatStages,
    state?: SimpleBattleSession['player'],
  ): void {
    const context = ports.readContext()
    const isPlayer = side === 'player'
    const name = isPlayer ? elements.playerName : elements.opponentName
    const level = isPlayer ? elements.playerLevel : elements.opponentLevel
    const hp = isPlayer ? elements.playerHp : elements.opponentHp
    const hud = elements.screen.querySelector<HTMLElement>(`.battle-hud-${side}:not(.battle-hud-secondary)`)
    name.textContent = ports.getPokemonName(pokemon)
    level.textContent = `N. ${pokemon.level}`
    hp.max = pokemon.stats.hp
    hp.value = pokemon.currentHp
    ports.assets.gaugeAnimationVersions.set(hp, (ports.assets.gaugeAnimationVersions.get(hp) ?? 0) + 1)
    syncHpZone(hp)
    const hpText = hud?.querySelector<HTMLElement>('.battle-hp-text')
    if (hpText) hpText.textContent = `${pokemon.currentHp} / ${pokemon.stats.hp}`
    if (isPlayer && context.resources) {
      const experience = createBattleExperienceDisplay(pokemon, context.resources.pokemonCatalog)
      setExperienceGauge(experience.progress, experience.required, experience.levelCap)
    }
    if (hud) {
      syncBattleConditionHud(hud, pokemon, stages, state)
      hud.dataset.gender = pokemon.gender
      if (context.resources) renderBattleTypeBadges(hud.querySelector('.battle-types'), types, context.resources.pokedexCatalog.typeNames)
    }
  }

  function renderHud(playerOverride?: CanonicalPokemon): void {
    const { simpleBattle } = ports.readContext()
    if (!simpleBattle) return
    const player = playerOverride ?? simpleBattle.player.pokemon
    const opponent = simpleBattle.opponent.pokemon
    renderSideHud('player', player, simpleBattle.player.types, simpleBattle.player.stages, simpleBattle.player)
    renderSideHud('opponent', opponent, simpleBattle.opponent.types, simpleBattle.opponent.stages, simpleBattle.opponent)
    renderPersistentPartyGauges(player, opponent)
    elements.screen.dataset.weather = simpleBattle.weather.kind
  }

  function createSpriteEffectPlayback(): ReturnType<typeof createHgssBattleSpriteEffectPlayback> | undefined {
    const { resources } = ports.readContext()
    const stage = elements.screen.querySelector<HTMLElement>(':scope > .battle-stage')
    return resources && stage
      ? createHgssBattleSpriteEffectPlayback(
          stage,
          resources.battleAnimationCatalog.spriteResourceResolver,
          (graphic) => ports.assets.canvas.createGraphicCanvas(graphic),
        )
      : undefined
  }

  function playConditionEffect(
    side: BattleSide,
    animation: HgssBattlePresentationAnimation,
    effectElements: { player: HTMLElement, opponent: HTMLElement, hud?: HTMLElement } = {
      player: elements.playerSprite,
      opponent: elements.opponentSprite,
      hud: elements.screen.querySelector<HTMLElement>(`.battle-hud-${side}:not(.battle-hud-secondary)`) ?? undefined,
    },
  ): void {
    const context = ports.readContext()
    if (!context.resources || !context.battleAnimations) return
    const spriteClass = animation === 'statUp' ? 'is-stat-up'
      : animation === 'statDown' ? 'is-stat-down'
        : animation === 'heal' ? 'is-heal' : undefined
    if (spriteClass) ports.presentation.trackAnimation(ports.presentation.restartAnimation(effectElements[side], spriteClass))
    if (effectElements.hud) ports.presentation.trackAnimation(ports.presentation.restartAnimation(effectElements.hud, 'is-updating'))
    const animationAudio = context.audio ? {
      playSoundEffect: context.audio.playSoundEffect,
      playPannedSoundEffect: context.audio.playPannedSoundEffect,
      stopSoundEffect: context.audio.stopSoundEffect,
      playPokemonCry: async () => undefined,
      isPokemonCryPlaying: context.audio.isCryPlaying,
    } : undefined
    const lease = createBattlePresentationLease(ports.presentation.skip)
    const unlock = ports.presentation.lockAnimation()
    void playHgssBattlePresentationAnimation(
      context.resources.battleAnimationCatalog,
      animation,
      side,
      { player: effectElements.player, opponent: effectElements.opponent, effects: elements.effects },
      animationAudio,
      {
        weather: context.simpleBattle?.weather.kind ?? context.doubleBattle?.weather.kind,
        signal: lease.signal,
        onDiagnostic: ports.presentation.reportAnimationDiagnostic,
      },
      createSpriteEffectPlayback(),
    ).catch(() => undefined).finally(() => {
      lease.close()
      unlock()
    })
  }

  function showLevelUpCard(pokemon: CanonicalPokemon, level: BattleLevelUp): void {
    const { resources, audio } = ports.readContext()
    const card = elements.screen.querySelector<HTMLElement>('.battle-stat-gains')!
    renderBattleLevelUpCard({
      card,
      pokemonName: ports.getPokemonName(pokemon),
      level,
      levelUpLabel: resources?.uiMessageBanks[157]?.[35] ?? '',
      levelPrefix: resources?.uiMessageBanks[6]?.[23] ?? '',
      statsMessages: resources?.uiMessageBanks[300] ?? {},
    })
    void audio?.playFanfare(1184).catch(() => {})
    ports.presentation.restartAnimation(card, 'is-revealed')
    ports.presentation.restartAnimation(elements.screen, 'is-level-up')
  }

  function showMoveLearningChoice(request: PokemonMoveLearningRequest<CanonicalPokemonPartyTarget>): void {
    const { resources } = ports.readContext()
    if (!resources) throw new Error("Le catalogue ROM d'apprentissage des capacités est absent.")
    const resolved = resolveCanonicalPokemonPartyTarget(request.target, ports.progression.resolvePartySource)
    if (!resolved) throw new Error(`Le Pokémon qui doit apprendre la capacité ROM ${request.moveId} n'est plus dans l'équipe.`)
    ports.state.setMode('learnMove')
    ports.state.setCursor(0)
    elements.choices.replaceChildren(...createBattleMoveLearningPresentation({
      pokemon: resolved.pokemon,
      moveId: request.moveId,
      pokemonCatalog: resources.pokemonCatalog,
      typeNames: resources.pokedexCatalog.typeNames,
      sourceLabel: resources.uiMessageBanks[6]?.[25] ?? '',
      cancelLabel: formatHgssRomMessage(resources.battleMessages[1182] ?? '', []),
      partyMessages: resources.uiMessageBanks[6] ?? {},
      battleMessages: resources.battleMessages,
    }))
    elements.choices.classList.add('battle-learn-move')
    elements.choices.hidden = false
    renderCursor(elements.choices)
  }

  async function animateExperience(from: CanonicalPokemon, to: CanonicalPokemon): Promise<void> {
    const { resources } = ports.readContext()
    if (!resources || to.experience <= from.experience) {
      renderHud(to)
      return
    }
    const version = ++experienceAnimationVersion
    const lease = createBattlePresentationLease(ports.presentation.skip)
    ports.state.setMessageInputLocked(true)
    elements.screen.classList.add('is-exp-gaining')
    let experience = from.experience
    let level = from.level
    elements.playerName.textContent = ports.getPokemonName(to)
    try {
      while (experience < to.experience && level < 100 && level <= to.level && version === experienceAnimationVersion && !lease.signal.aborted) {
        const fromDisplay = createBattleExperienceDisplay({ speciesId: to.speciesId, level, experience }, resources.pokemonCatalog)
        const segmentEnd = Math.min(to.experience, fromDisplay.levelEnd)
        const toDisplay = createBattleExperienceDisplay({ speciesId: to.speciesId, level, experience: segmentEnd }, resources.pokemonCatalog)
        const fromValue = fromDisplay.progress
        const toValue = Math.max(fromValue, toDisplay.progress)
        elements.playerLevel.textContent = `N. ${level}`
        setExperienceGauge(fromValue, fromDisplay.required)
        const ratio = (toValue - fromValue) / fromDisplay.required
        const duration = ports.presentation.reducedMotion() ? 0 : Math.round(420 + Math.min(1, ratio) * 680)
        await new Promise<void>((resolve) => {
          const startedAt = performance.now()
          const update = (now: number) => {
            if (version !== experienceAnimationVersion || lease.signal.aborted) { resolve(); return }
            const progress = duration === 0 ? 1 : Math.min(1, (now - startedAt) / duration)
            const stepped = Math.floor(progress * 24) / 24
            setExperienceGauge(Math.round(fromValue + (toValue - fromValue) * stepped), fromDisplay.required)
            if (progress < 1) window.requestAnimationFrame(update)
            else { setExperienceGauge(toValue, fromDisplay.required); resolve() }
          }
          window.requestAnimationFrame(update)
        })
        experience = segmentEnd
        if (experience >= fromDisplay.levelEnd && level < to.level) {
          level += 1
          elements.playerLevel.textContent = `N. ${level}`
          const nextDisplay = createBattleExperienceDisplay({ speciesId: to.speciesId, level, experience }, resources.pokemonCatalog)
          setExperienceGauge(0, nextDisplay.required)
          ports.presentation.restartAnimation(elements.screen, 'is-level-up')
        }
      }
    } finally {
      lease.close()
      if (version === experienceAnimationVersion) {
        renderHud(to)
        elements.screen.classList.remove('is-exp-gaining')
        ports.state.setMessageInputLocked(false)
      }
    }
  }

  function showCommands(): void {
    const context = ports.readContext()
    if (!context.simpleBattle || !context.resources) return
    renderHud()
    ports.presentation.setPhase('command')
    ports.state.setMode('command')
    ports.state.setCursor(0)
    elements.message.textContent = formatHgssRomMessage(
      context.resources.battleMessages[921] ?? '',
      [ports.getPokemonName(context.simpleBattle.player.pokemon)],
    )
    elements.message.hidden = false
    elements.choices.hidden = true
    const labels = [924, 925, 926, 927].map((id) => context.resources!.battleMessages[id] ?? '')
    elements.commands.replaceChildren(...labels.map((label, index) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset.battleCommand = ['fight', 'bag', 'party', 'run'][index]
      button.textContent = label
      if (index === 1) button.disabled = ports.inventory.listBattleBagEntries().length === 0
      if (index === 2) {
        button.disabled = !getUsableFieldBattlePartySlots(
          context.playerParty,
          { format: 'simple', phase: 'voluntary-switch' },
          context.teamPolicy,
        ).some((slot) => slot !== context.playerSlot)
      }
      return button
    }))
    elements.commands.hidden = false
    renderCursor(elements.commands)
  }

  function showMoves(): void {
    const { simpleBattle, resources, playerSlot } = ports.readContext()
    if (!simpleBattle || !resources) return
    ports.state.setMode('moves')
    elements.commands.hidden = true
    elements.message.textContent = resources.battleMessages[924] ?? ''
    elements.message.hidden = false
    const supported = new Set(getSelectableSimpleBattleMoveIndexes(simpleBattle, 'player'))
    elements.choices.replaceChildren(...createBattleMoveChoices(simpleBattle.player.pokemon.moves, supported, {
      moveNames: resources.pokemonCatalog.moveNames,
      typeNames: resources.pokedexCatalog.typeNames,
      ppLabel: resources.uiMessageBanks[6]?.[43],
      struggleMove: resources.pokemonCatalog.moves[165],
    }))
    elements.choices.hidden = false
    const enabledMoveIndexes = [...elements.choices.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
      .map((button) => Number.parseInt(button.dataset.battleMove ?? '', 10))
    ports.state.setCursor(resolveRememberedBattleMoveCursor(enabledMoveIndexes, rememberedMoveByPartySlot.get(playerSlot)))
    renderCursor(elements.choices)
  }

  function showParty(forced = false): void {
    const context = ports.readContext()
    if (!context.simpleBattle || !context.resources) return
    if (!forced && !canSwitchSimpleBattlePokemon(context.simpleBattle, 'player')) {
      ports.messages.prepend(`${ports.getPokemonName(context.simpleBattle.player.pokemon)} ne peut pas être retiré du combat!`)
      ports.messages.showNext()
      return
    }
    ports.syncActiveParties()
    ports.state.setMode('party', !forced)
    ports.state.setPartySelectionForced(forced)
    ports.state.setCursor(0)
    elements.commands.hidden = true
    elements.message.textContent = forced ? 'Choisissez le Pokémon à envoyer.' : 'Choisissez un Pokémon.'
    elements.message.hidden = false
    const selectable = new Set(getUsableFieldBattlePartySlots(
      context.playerParty,
      { format: 'simple', phase: forced ? 'forced-replacement' : 'voluntary-switch' },
      context.teamPolicy,
    ).filter((index) => index !== context.playerSlot))
    elements.choices.replaceChildren(...createBattlePartyChoices(
      context.playerParty,
      selectable,
      context.resources.pokedexCatalog.typeNames,
      (pokemon) => context.resources!.pokemonCatalog.personalData[pokemon.speciesId]?.types ?? [0, 0],
      createPokemonIcon,
      { level: context.resources.uiMessageBanks[6]?.[23], hp: context.resources.uiMessageBanks[6]?.[28] },
    ))
    elements.choices.hidden = false
    renderCursor(elements.choices)
  }

  function showBag(): void {
    const { resources } = ports.readContext()
    if (!resources) return
    const entries = ports.inventory.listBattleBagEntries()
    ports.state.setMode('bag')
    ports.state.setCursor(0)
    elements.commands.hidden = true
    elements.message.textContent = resources.battleMessages[925] ?? ''
    elements.message.hidden = false
    elements.choices.replaceChildren(...createBattleBagChoices(
      entries,
      ports.assets.createItemIcon,
      ports.inventory.isBattleBagItemBlocked,
    ))
    elements.choices.hidden = false
    renderCursor(elements.choices)
  }

  function showItemTargets(itemId: number): void {
    const context = ports.readContext()
    if (!context.resources) return
    const party = context.doubleBattle && context.doubleActor
      ? context.doubleBattle.teams[context.doubleActor.side][context.doubleActor.slot].party
      : context.playerParty
    ports.state.setPendingItemId(itemId)
    ports.state.setMode('bagTarget')
    ports.state.setCursor(0)
    elements.message.textContent = context.resources.uiMessageBanks[6]?.[7] ?? ''
    elements.message.hidden = false
    elements.choices.replaceChildren(...createBattleItemTargetChoices(
      party,
      createPokemonIcon,
      context.resources.uiMessageBanks[6]?.[28] ?? '',
    ))
    renderCursor(elements.choices)
  }

  return Object.freeze({
    cancelAsyncPresentation: () => { experienceAnimationVersion += 1 },
    refreshSprite,
    renderSideHud,
    renderPersistentPartyGauges,
    renderHud,
    setExperienceGauge,
    playConditionEffect,
    createSpriteEffectPlayback,
    showLevelUpCard,
    showMoveLearningChoice,
    animateExperience,
    syncHpZone,
    renderCursor,
    moveCursor,
    showCommands,
    showMoves,
    showParty,
    getBagItemCount: () => ports.inventory.listBattleBagEntries().length,
    showBag,
    showItemTargets,
    createPokemonIcon,
    rememberMove: (partySlot, moveIndex) => { rememberedMoveByPartySlot.set(partySlot, moveIndex) },
    clearRememberedMoves: () => { rememberedMoveByPartySlot.clear() },
  })
}
