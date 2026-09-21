import type { RomAudioRuntime } from '../../audio/romAudioRuntime'
import { playRomCryThenFanfare, startRomCry } from '../../audio/romAudioPresentation'
import type { GameDigitalAction } from '../../gameInput'
import type { NitroGraphic, RomInventory } from '../../ndsTypes'
import type { BattlePokemonSprite } from '../../rom/pokemon/battlePokemonSprites'
import type { PokemonEvolutionRule } from '../../rom/pokemon/evolutionData'
import type {
  BattleProgressionMessageEntry,
  CanonicalBattleProgressionPresenter,
} from '../battle/battleProgressionPresentation'
import { resolveBattleEvolutionInput, type BattleEvolutionInputPhase } from '../battle/battleEvolutionInput'
import type { FieldScriptRunner, FieldScriptStep } from '../scripts/fieldScriptProtocol'
import type { HgssTimeOfDay } from '../time/hgssRtc'
import { syncFieldProgressionScreen } from '../battle/battleProgressionPresentation'
import { formatHgssRomMessage } from '../ui/romMessageFormatting'
import type { CanonicalPokemon } from './canonicalPokemon'
import {
  createCanonicalPokemonPartyTarget,
  resolveCanonicalPokemonPartyTarget,
  type PokemonPartySlotSource,
  type ResolvePokemonParty,
} from './canonicalPokemonPartyTarget'
import { resolveHgssEggHatchInput, type HgssEggHatchInputPhase } from './hgssEggHatchInput'
import { hgssPokemonNicknameMaxLength } from './pokemonNickname'
import {
  createPokemonEvolutionIdentity,
  evolveCanonicalPokemonPartyMember,
  resolveLevelUpEvolution,
  type PokemonEvolutionIdentity,
} from './pokemonEvolution'
import {
  evolveCanonicalPokemonPartyMemberByRuleTransaction,
  resolvePokemonEvolutionMutationDecision,
} from './pokemonEvolutionTransaction'
import { getGenderFromPersonality, resolvePokemonPersonalData } from './pokemonFormulas'
import type { PokemonPartyMutationDecision, PokemonTeamPolicy } from './pokemonTeamPolicy'

export type PokemonTransformationSceneResources = Pick<
  RomInventory,
  | 'battleMessages'
  | 'battlePokemonSpriteResolver'
  | 'itemCatalog'
  | 'pokemonCatalog'
  | 'pokemonIconResolver'
  | 'uiMessageBanks'
>

export type PokemonTransformationSceneContext = Readonly<{
  resources?: PokemonTransformationSceneResources
  bagInventory: Map<number, number>
  teamPolicy: PokemonTeamPolicy
  timeOfDay: HgssTimeOfDay
  vblank: number
  battleAnimations: boolean
  prefersReducedMotion: boolean
  battleActive: boolean
}>

export type PokemonTransformationSceneElements = Readonly<{
  screen: HTMLElement
  scene: HTMLElement
  kicker: HTMLElement
  from: HTMLElement
  to: HTMLElement
  title: HTMLElement
  text: HTMLElement
  message: HTMLElement
  commands: HTMLElement
  moves: HTMLElement
  nickname: HTMLElement
  nicknameInput: HTMLInputElement
}>

export type PokemonTransformationSceneSpritePort = Readonly<{
  mountGraphicCanvas: (host: HTMLElement, graphic: NitroGraphic) => HTMLCanvasElement
  registerEvolution: (
    entries: readonly [
      Readonly<{ host: HTMLElement, sprite: BattlePokemonSprite }>,
      Readonly<{ host: HTMLElement, sprite: BattlePokemonSprite }>,
    ],
    vblank: number,
  ) => void
  restartEvolution: (vblank: number) => void
  clearEvolution: () => void
}>

export type PokemonTransformationSceneAudioRuntime = Pick<
  RomAudioRuntime,
  | 'playCry'
  | 'playCryAndWait'
  | 'playFanfare'
  | 'playMusicByName'
  | 'playSoundEffect'
  | 'stopMusic'
>

export type PokemonTransformationSceneAudioPort = Readonly<{
  read: () => PokemonTransformationSceneAudioRuntime | undefined
  resumeFieldMusic: () => void
}>

export type PokemonTransformationScenePartyPort = Readonly<{
  resolve: ResolvePokemonParty
  readFieldParty: () => CanonicalPokemon[]
  synchronizeEvolution: (
    source: PokemonPartySlotSource,
    pokemon: CanonicalPokemon,
    partySlot: number,
  ) => void
  markCaught: (pokemon: CanonicalPokemon) => void
}>

export type PokemonTransformationSceneProgressionPort = Readonly<{
  moveLearning: Pick<CanonicalBattleProgressionPresenter, 'createMoveLearningEntries'>
  replaceMessages: (entries: readonly BattleProgressionMessageEntry[]) => void
  prependMessages: (entries: readonly BattleProgressionMessageEntry[]) => void
  clearMessages: () => void
  hasPendingMessages: () => boolean
  showNextMessage: () => void
  clearMoveLearning: () => void
  resetPresentationAsyncState: () => void
  setMessageInputLocked: (locked: boolean) => void
}>

export type PokemonTransformationSceneFieldPort = Readonly<{
  readEggHatchRunner: () => Pick<FieldScriptRunner, 'finishEggHatch'> | undefined
  renderMenu: () => void
  closeAndRefreshMenu: () => void
  persistAuto: () => void
  syncFollower: (force: boolean) => void
  advanceScript: () => void
}>

export type PokemonTransformationSceneInputPort = Readonly<{
  requestYesNo: (message: string, resolve: (confirmed: boolean) => void) => void
  setNicknameCancellable: (cancellable: boolean) => void
  openNickname: () => void
}>

export type PokemonTransformationSceneScheduler = Readonly<{
  setTimeout: (callback: () => void, delayMs: number) => number
  clearTimeout: (timer: number) => void
}>

export type PokemonTransformationScenePorts = Readonly<{
  elements: PokemonTransformationSceneElements
  readContext: () => PokemonTransformationSceneContext
  getPokemonName: (pokemon: CanonicalPokemon) => string
  sprites: PokemonTransformationSceneSpritePort
  audio: PokemonTransformationSceneAudioPort
  party: PokemonTransformationScenePartyPort
  progression: PokemonTransformationSceneProgressionPort
  field: PokemonTransformationSceneFieldPort
  input: PokemonTransformationSceneInputPort
  diagnostics: Readonly<{ recordEvolutionCompletionError: (error: unknown) => void }>
  scheduler?: PokemonTransformationSceneScheduler
}>

export type PokemonTransformationEvolutionRequest = Readonly<{
  pokemon: CanonicalPokemon
  targetSpeciesId: number
  source: PokemonPartySlotSource
  rule?: PokemonEvolutionRule
}>

export type PokemonTransformationExplicitEvolution = Readonly<{
  targetSpeciesId: number
  rule?: PokemonEvolutionRule
}>

export type PokemonTransformationEggHatchStep = Extract<FieldScriptStep, { kind: 'eggHatch' }>

export type PokemonTransformationSceneSnapshot = Readonly<{
  evolutionPhase?: BattleEvolutionInputPhase
  eggHatchPhase?: HgssEggHatchInputPhase
  fieldProgressionActive: boolean
  fieldProgressionEvolutionMusicActive: boolean
}>

export type PokemonTransformationSceneHost = Readonly<{
  startEvolution: (request: PokemonTransformationEvolutionRequest) => PokemonPartyMutationDecision
  createEvolutionEntry: (
    pokemon: CanonicalPokemon,
    source: PokemonPartySlotSource,
    explicitEvolution?: PokemonTransformationExplicitEvolution,
  ) => BattleProgressionMessageEntry
  startFieldProgression: (entries: readonly BattleProgressionMessageEntry[]) => void
  finishFieldProgression: () => void
  startEggHatch: (step: PokemonTransformationEggHatchStep) => void
  handleInput: (action: GameDigitalAction) => boolean
  submitNickname: (value: string | undefined) => boolean
  closeEggHatch: () => boolean
  clearEvolution: () => void
  hideScene: () => void
  reset: () => void
  getSnapshot: () => PokemonTransformationSceneSnapshot
}>

type PendingEvolution = {
  timers: number[]
  identity: PokemonEvolutionIdentity
  source: PokemonPartySlotSource
  previousName: string
  targetName: string
  targetSpeciesId: number
  rule?: PokemonEvolutionRule
  phase: BattleEvolutionInputPhase
}

type PendingEggHatch = {
  timers: number[]
  partySlot: number
  pokemon: CanonicalPokemon
  speciesName: string
  phase: HgssEggHatchInputPhase
}

/**
 * Possède les scènes de transformation Pokémon qui partagent la même surface
 * plein écran. Les mutations canoniques restent transactionnelles tandis que
 * les dépendances navigateur sont regroupées derrière des ports explicites.
 */
export function createBrowserPokemonTransformationSceneHost(
  ports: PokemonTransformationScenePorts,
): PokemonTransformationSceneHost {
  const { elements } = ports
  const scheduler = ports.scheduler ?? {
    setTimeout: (callback: () => void, delayMs: number) => window.setTimeout(callback, delayMs),
    clearTimeout: (timer: number) => window.clearTimeout(timer),
  }
  let pendingEvolution: PendingEvolution | undefined
  let pendingEggHatch: PendingEggHatch | undefined
  let fieldProgressionActive = false
  let fieldProgressionEvolutionMusicActive = false

  function clearTimers(pending: { timers: number[] }): void {
    for (const timer of pending.timers) scheduler.clearTimeout(timer)
    pending.timers.length = 0
  }

  function scheduleEvolutionStep(pending: PendingEvolution, delayMs: number, step: () => void): void {
    const timer = scheduler.setTimeout(() => {
      const index = pending.timers.indexOf(timer)
      if (index >= 0) pending.timers.splice(index, 1)
      if (pendingEvolution === pending) step()
    }, delayMs)
    pending.timers.push(timer)
  }

  function scheduleEggHatchStep(pending: PendingEggHatch, delayMs: number, step: () => void): void {
    const timer = scheduler.setTimeout(() => {
      const index = pending.timers.indexOf(timer)
      if (index >= 0) pending.timers.splice(index, 1)
      if (pendingEggHatch === pending) step()
    }, delayMs)
    pending.timers.push(timer)
  }

  function hideScene(): void {
    ports.sprites.clearEvolution()
    elements.scene.hidden = true
    elements.scene.classList.remove(
      'is-intro',
      'is-transforming',
      'is-complete',
      'is-cancelled',
      'is-hatching',
      'is-hatched',
    )
    elements.kicker.textContent = ports.readContext().resources?.uiMessageBanks[825]?.[133] ?? ''
    elements.from.replaceChildren()
    elements.to.replaceChildren()
    delete elements.from.dataset.shiny
    delete elements.to.dataset.shiny
  }

  function clearEvolution(): void {
    if (pendingEvolution) clearTimers(pendingEvolution)
    pendingEvolution = undefined
    hideScene()
  }

  function finishFieldProgression(): void {
    if (!fieldProgressionActive) return
    fieldProgressionActive = false
    ports.progression.clearMessages()
    ports.progression.clearMoveLearning()
    syncFieldProgressionScreen({
      screen: elements.screen,
      message: elements.message,
      commands: elements.commands,
      moves: elements.moves,
    }, false)
    if (fieldProgressionEvolutionMusicActive) {
      fieldProgressionEvolutionMusicActive = false
      ports.audio.read()?.stopMusic()
      ports.audio.resumeFieldMusic()
    }
    ports.field.persistAuto()
    ports.field.renderMenu()
  }

  function finishEvolutionScreen(): void {
    const pending = pendingEvolution
    if (!pending) return
    const returnsToField = pending.source.kind === 'field'
    clearTimers(pending)
    pendingEvolution = undefined
    hideScene()
    ports.progression.setMessageInputLocked(false)
    ports.audio.read()?.stopMusic()
    if (returnsToField) {
      if (ports.progression.hasPendingMessages()) {
        ports.progression.showNextMessage()
        return
      }
      finishFieldProgression()
      return
    }
    ports.progression.showNextMessage()
  }

  function beginEvolutionTransformation(): void {
    const pending = pendingEvolution
    if (!pending || pending.phase !== 'intro') return
    clearTimers(pending)
    pending.phase = 'transforming'
    ports.sprites.restartEvolution(ports.readContext().vblank)
    elements.scene.classList.remove('is-intro')
    elements.scene.classList.add('is-transforming')
    const audio = ports.audio.read()
    void audio?.playMusicByName(['SEQ_GS_SHINKA']).catch(() => undefined)
    void audio?.playSoundEffect(0x5f8).catch(() => undefined)
    const context = ports.readContext()
    const reduced = !context.battleAnimations || context.prefersReducedMotion
    if (!reduced) {
      scheduleEvolutionStep(pending, 720, () => {
        void ports.audio.read()?.playSoundEffect(0x5f9).catch(() => undefined)
      })
      scheduleEvolutionStep(pending, 1840, () => {
        void ports.audio.read()?.playSoundEffect(0x5fa).catch(() => undefined)
      })
      scheduleEvolutionStep(pending, 2920, () => {
        void ports.audio.read()?.playSoundEffect(0x5fb).catch(() => undefined)
      })
    }
    scheduleEvolutionStep(pending, reduced ? 520 : 3600, completeEvolution)
  }

  function completeEvolution(): void {
    const pending = pendingEvolution
    const context = ports.readContext()
    const resources = context.resources
    if (!pending || (pending.phase !== 'intro' && pending.phase !== 'transforming') || !resources) return
    clearTimers(pending)
    let completed = false
    try {
      const party = ports.party.resolve(pending.source)
      if (!party) throw new Error("L'equipe qui doit recevoir l'evolution n'est plus active.")
      const rule = pending.rule
        ?? resources.pokemonCatalog.evolutions[pending.identity.speciesId]?.find(
          (candidate) => candidate.targetSpeciesId === pending.targetSpeciesId,
        )
      const transaction = rule
        ? evolveCanonicalPokemonPartyMemberByRuleTransaction(
          party,
          pending.source.partySlot,
          pending.identity,
          rule,
          resources.pokemonCatalog,
          { inventory: context.bagInventory, teamPolicy: context.teamPolicy },
        )
        : {
          primary: evolveCanonicalPokemonPartyMember(
            party,
            pending.source.partySlot,
            pending.identity,
            pending.targetSpeciesId,
            resources.pokemonCatalog,
          ),
        }
      const result = transaction.primary
      ports.party.markCaught(result.pokemon)
      if (transaction.shedinja) ports.party.markCaught(transaction.shedinja.pokemon)
      ports.party.synchronizeEvolution(pending.source, result.pokemon, result.partySlot)
      const followupEntries = ports.progression.moveLearning.createMoveLearningEntries(
        result.pokemon,
        { ...pending.source, partySlot: result.partySlot },
        result.learnedMoveIds,
        result.skippedMoveIds,
      )
      if (transaction.shedinja) {
        followupEntries.push(`${ports.getPokemonName(transaction.shedinja.pokemon)} apparaît dans l’Équipe!`)
      }
      if (transaction.shedinjaBlocked) followupEntries.push(transaction.shedinjaBlocked.reason)
      if (followupEntries.length > 0) ports.progression.prependMessages(followupEntries)
      pending.phase = 'complete'
      ports.sprites.restartEvolution(ports.readContext().vblank)
      elements.scene.classList.remove('is-intro', 'is-transforming')
      elements.scene.classList.add('is-complete')
      elements.title.textContent = pending.targetName
      elements.text.textContent = formatHgssRomMessage(
        resources.battleMessages[918]
          ?? 'Félicitations! Votre {101 0,0} évolue en {101 1,0}!',
        [pending.previousName, pending.targetName],
      )
      const evolutionAudio = ports.audio.read()
      if (evolutionAudio) {
        void playRomCryThenFanfare(
          evolutionAudio,
          { speciesId: pending.targetSpeciesId, pattern: 0 },
          1188,
          {
            isCurrent: () => (
              evolutionAudio === ports.audio.read()
              && pendingEvolution === pending
              && pending.phase === 'complete'
            ),
          },
        ).catch(() => undefined)
      }
      completed = true
    } catch (error) {
      ports.progression.prependMessages([
        error instanceof Error ? error.message : "L'évolution n'a pas pu être terminée.",
      ])
      ports.diagnostics.recordEvolutionCompletionError(error)
    } finally {
      if (!completed && pendingEvolution === pending) finishEvolutionScreen()
    }
  }

  function startEvolution(request: PokemonTransformationEvolutionRequest): PokemonPartyMutationDecision {
    const context = ports.readContext()
    const resources = context.resources
    if (!resources) throw new Error("Le catalogue ROM requis par l'évolution est absent.")
    const identity = createPokemonEvolutionIdentity(request.pokemon)
    const party = ports.party.resolve(request.source)
    if (!party) throw new Error("L'equipe qui doit recevoir l'evolution n'est plus active.")
    const resolvedRule = request.rule
      ?? resources.pokemonCatalog.evolutions[request.pokemon.speciesId]?.find(
        (candidate) => candidate.targetSpeciesId === request.targetSpeciesId,
      )
    const decision: PokemonPartyMutationDecision = resolvedRule
      ? resolvePokemonEvolutionMutationDecision(
        party,
        request.source.partySlot,
        identity,
        resolvedRule,
        resources.pokemonCatalog,
        context.teamPolicy,
      )
      : { kind: 'allowed' }
    if (decision.kind === 'blocked') return decision

    if (pendingEvolution) clearTimers(pendingEvolution)
    const previousName = ports.getPokemonName(request.pokemon)
    const targetName = resources.pokemonCatalog.speciesNames[request.targetSpeciesId]
      ?? `Pokémon ${request.targetSpeciesId}`
    const previousSprite = resources.battlePokemonSpriteResolver({
      speciesId: request.pokemon.speciesId,
      form: request.pokemon.form,
      gender: request.pokemon.gender,
      facing: 'front',
      shiny: request.pokemon.shiny,
    })
    const targetPersonal = resolvePokemonPersonalData(
      resources.pokemonCatalog,
      request.targetSpeciesId,
      request.pokemon.form,
    )
    const targetSprite = resources.battlePokemonSpriteResolver({
      speciesId: request.targetSpeciesId,
      form: request.pokemon.form,
      gender: getGenderFromPersonality(targetPersonal, request.pokemon.personality),
      facing: 'front',
      shiny: request.pokemon.shiny,
    })
    hideScene()
    elements.kicker.textContent = resources.uiMessageBanks[825]?.[133] ?? ''
    ports.sprites.mountGraphicCanvas(elements.from, previousSprite.frames[0]!)
    ports.sprites.mountGraphicCanvas(elements.to, targetSprite.frames[0]!)
    ports.sprites.registerEvolution([
      { host: elements.from, sprite: previousSprite },
      { host: elements.to, sprite: targetSprite },
    ], context.vblank)
    elements.from.dataset.shiny = String(request.pokemon.shiny)
    elements.to.dataset.shiny = String(request.pokemon.shiny)
    elements.title.textContent = previousName
    const openingMessageId = request.source.kind === 'field' ? 915 : 917
    elements.text.textContent = formatHgssRomMessage(
      resources.battleMessages[openingMessageId]
        ?? (request.source.kind === 'field' ? 'Quoi? {101 0,0} évolue!' : '{101 0,0} évolue!'),
      [previousName],
    )
    elements.scene.hidden = false
    elements.scene.classList.add('is-intro')
    if (request.source.kind === 'field') {
      fieldProgressionActive = true
      fieldProgressionEvolutionMusicActive = true
      elements.screen.classList.add('is-evolution-only')
      elements.screen.hidden = false
      ports.field.renderMenu()
    }
    elements.message.hidden = true
    elements.commands.hidden = true
    elements.moves.hidden = true
    ports.progression.setMessageInputLocked(true)
    const pending: PendingEvolution = {
      timers: [],
      identity,
      source: request.source,
      previousName,
      targetName,
      targetSpeciesId: request.targetSpeciesId,
      rule: resolvedRule,
      phase: 'intro',
    }
    pendingEvolution = pending
    startRomCry(ports.audio.read(), request.pokemon.speciesId)
    scheduleEvolutionStep(
      pending,
      !context.battleAnimations || context.prefersReducedMotion ? 120 : 900,
      beginEvolutionTransformation,
    )
    return decision
  }

  function createEvolutionEntry(
    pokemon: CanonicalPokemon,
    source: PokemonPartySlotSource,
    explicitEvolution?: PokemonTransformationExplicitEvolution,
  ): BattleProgressionMessageEntry {
    const target = createCanonicalPokemonPartyTarget(pokemon, source)
    return {
      text: '',
      onShow: () => {
        const context = ports.readContext()
        const resources = context.resources
        if (!resources) {
          ports.progression.showNextMessage()
          return
        }
        const resolved = resolveCanonicalPokemonPartyTarget(target, ports.party.resolve)
        if (!resolved) {
          ports.progression.showNextMessage()
          return
        }
        const levelEvolution = explicitEvolution
          ? undefined
          : resolveLevelUpEvolution(resolved.pokemon, resources.pokemonCatalog, {
            timeOfDay: context.timeOfDay,
            itemCatalog: resources.itemCatalog,
            party: ports.party.resolve(source) ?? ports.party.readFieldParty(),
          })
        const targetSpeciesId = explicitEvolution?.targetSpeciesId ?? levelEvolution?.targetSpeciesId
        if (targetSpeciesId === undefined) {
          ports.progression.showNextMessage()
          return
        }
        const decision = startEvolution({
          pokemon: resolved.pokemon,
          targetSpeciesId,
          source: { ...source, partySlot: resolved.partySlot },
          rule: explicitEvolution?.rule ?? levelEvolution,
        })
        if (decision.kind === 'blocked') {
          elements.message.textContent = decision.reason
          ports.progression.setMessageInputLocked(false)
        }
      },
    }
  }

  function startFieldProgression(entries: readonly BattleProgressionMessageEntry[]): void {
    if (ports.readContext().battleActive) {
      throw new Error('Une progression de terrain ne peut pas remplacer un combat actif.')
    }
    ports.progression.resetPresentationAsyncState()
    hideScene()
    fieldProgressionActive = true
    fieldProgressionEvolutionMusicActive = false
    ports.progression.replaceMessages(entries)
    syncFieldProgressionScreen({
      screen: elements.screen,
      message: elements.message,
      commands: elements.commands,
      moves: elements.moves,
    }, true)
    ports.progression.setMessageInputLocked(false)
    ports.field.renderMenu()
    ports.progression.showNextMessage()
  }

  function cancelEvolution(): void {
    const pending = pendingEvolution
    if (!pending || pending.phase === 'complete' || pending.phase === 'cancelled') return
    clearTimers(pending)
    pending.phase = 'cancelled'
    ports.sprites.restartEvolution(ports.readContext().vblank)
    elements.scene.classList.remove('is-intro', 'is-transforming')
    elements.scene.classList.add('is-cancelled')
    elements.title.textContent = pending.previousName
    elements.text.textContent = formatHgssRomMessage(
      ports.readContext().resources?.battleMessages[919] ?? 'Hein? {101 0,0} n’évolue plus!',
      [pending.previousName],
    )
    ports.audio.read()?.stopMusic()
    startRomCry(ports.audio.read(), pending.identity.speciesId)
  }

  function revealHatchedPokemon(): void {
    const pending = pendingEggHatch
    if (!pending || pending.phase !== 'cracking') return
    clearTimers(pending)
    pending.phase = 'hatched'
    elements.scene.classList.remove('is-intro', 'is-transforming')
    elements.scene.classList.add('is-complete', 'is-hatched')
    elements.title.textContent = pending.speciesName
    elements.text.textContent = formatHgssRomMessage(
      ports.readContext().resources?.uiMessageBanks[40]?.[63] ?? '',
      [pending.speciesName],
    )
    startRomCry(ports.audio.read(), pending.pokemon.speciesId)
  }

  function finalizeEggHatch(nickname: string | undefined): void {
    const pending = pendingEggHatch
    const runner = ports.field.readEggHatchRunner()
    if (!pending || !runner) return
    clearTimers(pending)
    runner.finishEggHatch(nickname)
    pendingEggHatch = undefined
    elements.nickname.hidden = true
    hideScene()
    elements.screen.classList.remove('is-evolution-only', 'is-egg-hatch')
    elements.screen.hidden = true
    ports.progression.setMessageInputLocked(false)
    ports.audio.resumeFieldMusic()
    ports.field.syncFollower(true)
    ports.field.advanceScript()
  }

  function openEggHatchNicknameInput(): void {
    const pending = pendingEggHatch
    if (!pending) return
    pending.phase = 'naming'
    elements.nicknameInput.maxLength = hgssPokemonNicknameMaxLength
    elements.nicknameInput.value = ''
    const label = elements.nickname.querySelector('label')
    const prompt = formatHgssRomMessage(
      ports.readContext().resources?.uiMessageBanks[249]?.[1] ?? '',
      [pending.speciesName],
    )
    if (label) label.textContent = prompt
    elements.nicknameInput.setAttribute('aria-label', prompt)
    const count = elements.nickname.querySelector('.field-nickname-count')
    if (count) count.textContent = `0/${hgssPokemonNicknameMaxLength}`
    ports.input.setNicknameCancellable(true)
    elements.nickname.hidden = false
    ports.input.openNickname()
  }

  function requestEggHatchNickname(): void {
    const pending = pendingEggHatch
    if (!pending || pending.phase !== 'hatched') return
    pending.phase = 'nickname-choice'
    elements.scene.hidden = true
    elements.screen.hidden = true
    ports.input.requestYesNo(formatHgssRomMessage(
      ports.readContext().resources?.uiMessageBanks[40]?.[64] ?? '',
      [pending.speciesName],
    ), (confirmed) => {
      if (pendingEggHatch !== pending) return
      if (confirmed) openEggHatchNicknameInput()
      else finalizeEggHatch(undefined)
    })
  }

  function startEggHatch(step: PokemonTransformationEggHatchStep): void {
    const context = ports.readContext()
    const resources = context.resources
    if (!resources) throw new Error("Les ressources ROM requises par l'éclosion sont absentes.")
    const eggPreview = resources.pokemonIconResolver(step.pokemon.speciesId, step.pokemon.form, true)
    const eggFrame = eggPreview.frames[0]
    if (!eggFrame) throw new Error("Le sprite ROM de l'Œuf est absent.")
    const pokemonSprite = resources.battlePokemonSpriteResolver({
      speciesId: step.pokemon.speciesId,
      form: step.pokemon.form,
      gender: step.pokemon.gender,
      facing: 'front',
      shiny: step.pokemon.shiny,
    })
    const speciesName = resources.pokemonCatalog.speciesNames[step.pokemon.speciesId]
      ?? step.pokemon.speciesName
    if (pendingEggHatch) clearTimers(pendingEggHatch)
    hideScene()
    elements.kicker.textContent = resources.uiMessageBanks[191]?.[141] ?? ''
    const eggCanvas = ports.sprites.mountGraphicCanvas(elements.from, eggFrame)
    eggCanvas.className = 'egg-hatch-icon'
    ports.sprites.mountGraphicCanvas(elements.to, pokemonSprite.frames[0]!)
    elements.from.dataset.shiny = 'false'
    elements.to.dataset.shiny = String(step.pokemon.shiny)
    elements.title.textContent = ''
    elements.text.textContent = resources.uiMessageBanks[40]?.[62] ?? ''
    elements.scene.hidden = false
    elements.scene.classList.add('is-intro', 'is-transforming', 'is-hatching')
    elements.screen.classList.add('is-evolution-only', 'is-egg-hatch')
    elements.screen.hidden = false
    elements.message.hidden = true
    elements.commands.hidden = true
    elements.moves.hidden = true
    ports.progression.setMessageInputLocked(true)
    ports.field.closeAndRefreshMenu()
    const pending: PendingEggHatch = {
      timers: [],
      partySlot: step.partySlot,
      pokemon: step.pokemon,
      speciesName,
      phase: 'cracking',
    }
    pendingEggHatch = pending
    void ports.audio.read()?.playSoundEffect(1812).catch(() => undefined)
    scheduleEggHatchStep(
      pending,
      !context.battleAnimations || context.prefersReducedMotion ? 520 : 3200,
      revealHatchedPokemon,
    )
  }

  function closeEggHatch(): boolean {
    const pending = pendingEggHatch
    if (!pending) return false
    clearTimers(pending)
    pendingEggHatch = undefined
    hideScene()
    elements.screen.classList.remove('is-evolution-only', 'is-egg-hatch')
    elements.screen.hidden = true
    ports.progression.setMessageInputLocked(false)
    return true
  }

  function handleInput(action: GameDigitalAction): boolean {
    const eggHatch = pendingEggHatch
    if (eggHatch) {
      if (resolveHgssEggHatchInput(eggHatch.phase, action) === 'request-nickname') {
        requestEggHatchNickname()
      }
      return true
    }
    const evolution = pendingEvolution
    if (!evolution) return false
    if (action !== 'confirm' && action !== 'cancel') return true
    const decision = resolveBattleEvolutionInput(
      evolution.phase,
      action,
      evolution.source.kind !== 'field' || evolution.source.cancellable,
    )
    if (decision === 'cancel') cancelEvolution()
    else if (decision === 'close') finishEvolutionScreen()
    return true
  }

  function reset(): void {
    if (pendingEvolution) clearTimers(pendingEvolution)
    if (pendingEggHatch) clearTimers(pendingEggHatch)
    pendingEvolution = undefined
    pendingEggHatch = undefined
    fieldProgressionActive = false
    fieldProgressionEvolutionMusicActive = false
    elements.nickname.hidden = true
    hideScene()
    elements.screen.classList.remove('is-evolution-only', 'is-egg-hatch')
    ports.progression.setMessageInputLocked(false)
  }

  return Object.freeze({
    startEvolution,
    createEvolutionEntry,
    startFieldProgression,
    finishFieldProgression,
    startEggHatch,
    handleInput,
    submitNickname(value): boolean {
      if (pendingEggHatch?.phase !== 'naming') return false
      finalizeEggHatch(value)
      return true
    },
    closeEggHatch,
    clearEvolution,
    hideScene,
    reset,
    getSnapshot(): PokemonTransformationSceneSnapshot {
      return {
        evolutionPhase: pendingEvolution?.phase,
        eggHatchPhase: pendingEggHatch?.phase,
        fieldProgressionActive,
        fieldProgressionEvolutionMusicActive,
      }
    },
  })
}
