import type { NitroGraphic, PlayerGender, RomInventory } from '../../ndsTypes'
import {
  resolveHgssScriptedPhoneMessage,
  type HgssScriptedPhoneFlagEffect,
  type HgssScriptedPhoneChoiceValue,
} from '../../rom/phone/phoneCalls'
import type { WorldSession } from '../world/worldSession'
import type { AlphFieldUiHost } from '../ui/alphFieldUiHost'
import type { FieldChoiceHost } from '../ui/fieldChoiceHost'
import type { FieldDialogueRuntime } from '../ui/fieldDialogueRuntime'
import type { FieldEasyChatHost } from '../ui/fieldEasyChatHost'
import type { FieldRecordAppsHost } from '../ui/fieldRecordAppsHost'
import { resolveFieldSpeakerName } from '../ui/fieldSpeakerPresentation'
import type { FieldTextEntryCoordinator } from '../ui/fieldTextEntryCoordinator'
import type { PcBoxController } from '../ui/pcBoxController'
import type { PhotoAlbumUiHost } from '../ui/photoAlbumUiHost'
import type { ChoicePopupController } from '../ui/choicePopupController'
import { formatHgssRomMessage } from '../ui/romMessageFormatting'
import type { SafariUiHost } from '../ui/safariUiHost'
import { syncHgssShopNumberPresentation } from '../ui/shopPresentation'
import type { FieldScriptClearWaitOptions } from './fieldScriptExecutionState'
import type { FieldScriptState } from './fieldScriptRunner'
import type { FieldScriptStep } from './fieldScriptProtocol'
import type { FieldScriptStepHandler } from './fieldScriptHost'

type SafariUiStep = Extract<FieldScriptStep, { kind: 'safariCustomizer' | 'safariDecorator' }>
type PhotoUiStep = Extract<FieldScriptStep, { kind: 'photoCapture' | 'photoAlbum' }>
type EggHatchStep = Extract<FieldScriptStep, { kind: 'eggHatch' }>

export type FieldScriptUiHostContext = Readonly<{
  state: FieldScriptState
  world: Pick<WorldSession, 'getState'> | undefined
  inventory: RomInventory | undefined
  playerGender: PlayerGender
}>

export type FieldScriptUiHostElements = Readonly<{
  dialogue: HTMLElement
  pokemonPortrait: HTMLElement
  nickname: HTMLElement
  nicknameInput: HTMLInputElement
  number: HTMLFormElement
  numberInput: HTMLInputElement
}>

export type FieldScriptUiHostExecutionPort = Readonly<{
  clearWait: (options?: FieldScriptClearWaitOptions) => void
  beginWait: (wait: 'input') => void
}>

export type FieldScriptUiHostUnifiedPcPort = Readonly<{
  isUnwinding: () => boolean
  resolveChoice: (
    options: Extract<FieldScriptStep, { kind: 'choice' }>['options'],
    messages: Record<number, string> | undefined,
  ) => number | undefined
}>

export type FieldScriptUiHostOptions = Readonly<{
  elements: FieldScriptUiHostElements
  dialogue: Pick<FieldDialogueRuntime, 'setAcknowledged' | 'showMessages' | 'openPhone' | 'hide'>
  execution: FieldScriptUiHostExecutionPort
  unifiedPc: FieldScriptUiHostUnifiedPcPort
  safari: Pick<SafariUiHost, 'present'>
  photoAlbum: Pick<PhotoAlbumUiHost, 'present'>
  choice: Pick<FieldChoiceHost, 'open'>
  textEntry: Pick<FieldTextEntryCoordinator, 'setNicknameCancellable' | 'openNickname' | 'openNumber'>
  easyChat: Pick<FieldEasyChatHost, 'open'>
  alph: Pick<AlphFieldUiHost, 'openPuzzle' | 'openInscription'>
  pcBox: Pick<PcBoxController, 'open'>
  recordApps: Pick<FieldRecordAppsHost, 'open'>
  phoneChoice: Pick<ChoicePopupController, 'open'>
  readContext: () => FieldScriptUiHostContext
  formatFieldMessage: (message: string, state: FieldScriptState) => string
  mountGraphic: (host: HTMLElement, graphic: NitroGraphic) => void
  startEggHatch: (step: EggHatchStep) => void
  clearMovement: () => void
  refreshInputPrompts: () => void
  advanceScript: () => void
}>

function acknowledgeNewUi(options: FieldScriptUiHostOptions): void {
  options.dialogue.setAcknowledged(false)
}

function presentPokemonPortrait(
  step: Extract<FieldScriptStep, { kind: 'pokemonPortrait' }>,
  options: FieldScriptUiHostOptions,
): void {
  const host = options.elements.pokemonPortrait
  if (step.action === 'hide') {
    host.hidden = true
    host.replaceChildren()
    return
  }
  const inventory = options.readContext().inventory
  if (!inventory) throw new Error('La ROM doit être chargée pour dessiner le portrait Pokémon.')
  const sprite = inventory.battlePokemonSpriteResolver({
    speciesId: step.speciesId,
    form: 0,
    gender: step.gender === 0 ? 'male' : 'female',
    facing: 'front',
    shiny: false,
  })
  options.mountGraphic(host, sprite.frames[0]!)
  host.hidden = false
  host.animate([
    { opacity: 0, transform: 'translateY(8px) scale(.92)' },
    { opacity: 1, transform: 'translateY(0) scale(1)' },
  ], { duration: 220, easing: 'steps(6, end)', fill: 'both' })
}

function presentPhoneCall(
  step: Extract<FieldScriptStep, { kind: 'phoneCall' }>,
  options: FieldScriptUiHostOptions,
): void {
  const { inventory, playerGender, state } = options.readContext()
  if (!inventory) throw new Error('La ROM doit être chargée pour ouvrir l’appel Pokématos.')
  const resolved = resolveHgssScriptedPhoneMessage(step.call, playerGender, {
    nationalDexOwnedCount: state.pokedex.caughtSpeciesIds.size,
    eventFlags: state.flags,
  })
  if (!resolved) {
    throw new Error(
      `L’appel Pokématos ROM ${step.call.callerId}/${step.call.parameter1}/${step.call.parameter2} n’est pas encore interprété.`,
    )
  }
  const contactMessages = inventory.phoneContactMessages[resolved.callerId]
  const text = contactMessages?.[resolved.messageId]
  if (text === undefined) {
    throw new Error(`Le message Pokématos ${resolved.messageId} du contact ${resolved.callerId} est absent de la ROM.`)
  }
  state.buffers.set(0, state.playerName)
  const caller = inventory.phoneContactNames[resolved.callerId]
  if (caller === undefined) throw new Error(`Le nom ROM du contact ${resolved.callerId} est absent.`)
  const formattedPrompt = options.formatFieldMessage(text, state)
  const applyEffects = (effects: readonly HgssScriptedPhoneFlagEffect[] | undefined): void => {
    for (const effect of effects ?? []) {
      if (effect.enabled) state.flags.add(effect.flagId)
      else state.flags.delete(effect.flagId)
    }
  }
  applyEffects(resolved.initialEffects)

  if (!resolved.choice) {
    options.dialogue.openPhone(caller, [formattedPrompt])
    return
  }

  const phoneUiMessages = inventory.uiMessageBanks[271]
  const presentations = resolved.choice.options.map((choiceOption) => {
    const label = phoneUiMessages?.[choiceOption.labelMessageId]
    if (label === undefined) {
      throw new Error(`Le libellé Pokématos ${choiceOption.labelMessageId} est absent de la banque ROM 271.`)
    }
    const continuation = contactMessages?.[choiceOption.continuationMessageId]
    if (continuation === undefined) {
      throw new Error(
        `Le message Pokématos ${choiceOption.continuationMessageId} du contact ${resolved.callerId} est absent de la ROM.`,
      )
    }
    return {
      option: choiceOption,
      label: options.formatFieldMessage(label, state),
      continuation: options.formatFieldMessage(continuation, state),
    }
  })
  const choice = resolved.choice
  options.dialogue.openPhone(caller, [formattedPrompt], () => {
    options.phoneChoice.open<HgssScriptedPhoneChoiceValue>({
      title: caller,
      message: formattedPrompt,
      options: presentations.map(({ option, label }) => ({ value: option.value, label })),
      initialIndex: choice.defaultIndex,
      cancelIndex: choice.cancelIndex,
      onSelect: (value) => {
        const selected = presentations.find(({ option }) => option.value === value)
        if (!selected) return
        applyEffects(selected.option.effects)
        options.dialogue.openPhone(caller, [selected.continuation], options.advanceScript)
      },
    })
  })
}

function presentNickname(
  step: Extract<FieldScriptStep, { kind: 'nickname' }>,
  options: FieldScriptUiHostOptions,
): void {
  const { nickname, nicknameInput } = options.elements
  const inventory = options.readContext().inventory
  acknowledgeNewUi(options)
  nicknameInput.maxLength = step.maxLength
  nicknameInput.value = step.currentName
  const prompt = formatHgssRomMessage(
    inventory?.uiMessageBanks[249]?.[step.promptMessageId] ?? '',
    step.promptValues ?? [],
  )
  const label = nickname.querySelector('label')
  if (label) label.textContent = prompt
  nicknameInput.setAttribute('aria-label', prompt)
  const count = nickname.querySelector('.field-nickname-count')
  if (count) count.textContent = `${nicknameInput.value.length}/${step.maxLength}`
  options.textEntry.setNicknameCancellable(step.cancellable)
  nickname.hidden = false
  options.textEntry.openNickname()
}

function presentNumber(
  step: Extract<FieldScriptStep, { kind: 'number' }>,
  options: FieldScriptUiHostOptions,
): void {
  const inventory = options.readContext().inventory
  acknowledgeNewUi(options)
  syncHgssShopNumberPresentation(options.elements.number, step.shop, {
    shopMessages: inventory?.uiMessageBanks[191] ?? {},
    bagMessages: inventory?.uiMessageBanks[10] ?? {},
    martMessages: inventory?.uiMessageBanks[435] ?? {},
  })
  options.elements.numberInput.min = String(step.min)
  options.elements.numberInput.max = String(step.max)
  options.elements.numberInput.value = String(step.min)
  options.elements.number.hidden = false
  options.textEntry.openNumber()
}

/** Routes only script steps whose owner is a field UI surface. */
export function createFieldScriptUiHost(options: FieldScriptUiHostOptions): FieldScriptStepHandler {
  return Object.freeze({
    handle(step, runner) {
      if (step.kind === 'safariCustomizer' || step.kind === 'safariDecorator') {
        acknowledgeNewUi(options)
        options.clearMovement()
        options.safari.present(step as SafariUiStep, runner)
        return 'suspend'
      }
      if (step.kind === 'photoCapture' || step.kind === 'photoAlbum') {
        acknowledgeNewUi(options)
        options.clearMovement()
        options.photoAlbum.present(step as PhotoUiStep, runner)
        return 'suspend'
      }
      if (step.kind === 'message') {
        if (options.unifiedPc.isUnwinding()) return 'continue'
        const { inventory, state, world } = options.readContext()
        acknowledgeNewUi(options)
        options.execution.clearWait({ clearAcceptedInputs: true })
        options.clearMovement()
        const map = world?.getState()?.map
        options.dialogue.showMessages(options.formatFieldMessage(step.text, state), {
          speaker: map
            ? resolveFieldSpeakerName(map, step.speakerObjectId, state.rivalName, inventory)
            : undefined,
        })
        options.execution.beginWait('input')
        return 'suspend'
      }
      if (step.kind === 'dialogue') {
        if (step.action === 'waitingIconAdd') {
          options.elements.dialogue.classList.add('has-waiting-icon')
        } else if (step.action === 'waitingIconRemove') {
          options.elements.dialogue.classList.remove('has-waiting-icon')
        } else if (step.action !== 'open') {
          options.dialogue.hide()
        }
        return 'continue'
      }
      if (step.kind === 'pokemonPortrait') {
        presentPokemonPortrait(step, options)
        return 'continue'
      }
      if (step.kind === 'phoneCall') {
        presentPhoneCall(step, options)
        return 'suspend'
      }
      if (step.kind === 'choice') {
        const inventory = options.readContext().inventory
        const unifiedChoice = options.unifiedPc.resolveChoice(
          step.options,
          inventory?.uiMessageBanks[191],
        )
        if (unifiedChoice !== undefined) {
          runner.choose(unifiedChoice)
          return 'continue'
        }
        acknowledgeNewUi(options)
        options.choice.open(step)
        return 'suspend'
      }
      if (step.kind === 'nickname') {
        presentNickname(step, options)
        return 'suspend'
      }
      if (step.kind === 'eggHatch') {
        acknowledgeNewUi(options)
        options.clearMovement()
        options.startEggHatch(step)
        return 'suspend'
      }
      if (step.kind === 'number') {
        presentNumber(step, options)
        return 'suspend'
      }
      if (step.kind === 'easyChat') {
        acknowledgeNewUi(options)
        options.clearMovement()
        options.easyChat.open(step)
        return 'suspend'
      }
      if (step.kind === 'alphPuzzle') {
        acknowledgeNewUi(options)
        options.clearMovement()
        options.alph.openPuzzle(step)
        return 'suspend'
      }
      if (step.kind === 'alphHiddenRoom') {
        acknowledgeNewUi(options)
        options.clearMovement()
        options.alph.openInscription(step)
        return 'suspend'
      }
      if (step.kind === 'pcBox') {
        options.clearMovement()
        options.pcBox.open(step.mode)
        options.refreshInputPrompts()
        return 'suspend'
      }
      if (
        step.kind === 'pokeathlonApp'
        || step.kind === 'frontierRecordsApp'
        || step.kind === 'gameClear'
      ) {
        acknowledgeNewUi(options)
        options.clearMovement()
        options.recordApps.open(step)
        return 'suspend'
      }
      return 'unhandled'
    },
  })
}
