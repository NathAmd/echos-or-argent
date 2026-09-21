import type { RomAudioRuntime } from '../../audio/romAudioRuntime'
import type { GameDigitalAction } from '../../gameInput'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { hasHgssPokemonNicknameInput, hgssPokemonNicknameMaxLength } from '../pokemon/pokemonNickname'
import { createHgssNamingScreenStorageMessageController } from './hgssNamingScreenStorageMessage'
import { formatHgssRomMessage } from './romMessageFormatting'

export type SafariCaptureNicknameElements = {
  battleScreen: HTMLElement
  root: HTMLElement
  input: HTMLInputElement
}

export type SafariCaptureStorageMessage = {
  template: string
  previousBoxName: string
  destinationBoxName: string
  movedToDifferentBox: boolean
}

export type SafariCaptureNicknameOptions = {
  getAudio: () => RomAudioRuntime | undefined
  getNicknamePromptTemplate: () => string | undefined
  requestConfirmation: (prompt: string, resolve: (confirmed: boolean) => void, defaultConfirmed: boolean) => void
  setNicknameCancellable: (cancellable: boolean) => void
  prepareNicknameInput: () => void
}

export type SafariCaptureNicknameController = {
  request: (
    pokemon: Pick<CanonicalPokemon, 'speciesName'>,
    confirmationPrompt: string,
    storageMessage?: SafariCaptureStorageMessage,
  ) => Promise<string | undefined>
  submit: (nickname: string | undefined) => boolean
  handleStorageMessage: (action: GameDigitalAction) => boolean
}

function requireDescendant<T extends Element>(root: HTMLElement, selector: string): T {
  const element = root.querySelector<T>(selector)
  if (!element) throw new Error(`L'élément ${selector} de l'écran de surnom Safari est absent.`)
  return element
}

/**
 * Possède uniquement la séquence de surnom après une capture Safari. Le
 * clavier reste partagé avec les autres Naming Screens du terrain.
 */
export function createSafariCaptureNicknameController(
  elements: SafariCaptureNicknameElements,
  options: SafariCaptureNicknameOptions,
): SafariCaptureNicknameController {
  const label = requireDescendant<HTMLElement>(elements.root, 'label')
  const count = requireDescendant<HTMLElement>(elements.root, '.field-nickname-count')
  const submitButton = requireDescendant<HTMLButtonElement>(elements.root, 'button[type="submit"]')
  const cancelButton = requireDescendant<HTMLButtonElement>(elements.root, '[data-nickname-cancel]')
  const storageMessageController = createHgssNamingScreenStorageMessageController({
    root: elements.root,
    label,
    input: elements.input,
    count,
    submit: submitButton,
    cancel: cancelButton,
  }, options.getAudio)
  let finishNicknameInput: ((nickname: string | undefined) => void) | undefined

  const request: SafariCaptureNicknameController['request'] = (pokemon, confirmationPrompt, storageMessage) => {
    elements.battleScreen.hidden = true
    return new Promise((resolve) => {
      const finish = (nickname: string | undefined): void => {
        elements.root.hidden = true
        if (!storageMessage) {
          resolve(nickname)
          return
        }
        const pokemonName = hasHgssPokemonNicknameInput(nickname) ? nickname : pokemon.speciesName
        const values = storageMessage.movedToDifferentBox
          ? [storageMessage.previousBoxName, pokemonName, storageMessage.destinationBoxName]
          : [pokemonName, storageMessage.destinationBoxName]
        void storageMessageController.present(storageMessage.template, values).then(() => resolve(nickname))
      }

      options.requestConfirmation(confirmationPrompt, (confirmed) => {
        if (!confirmed) {
          finish(undefined)
          return
        }
        const template = options.getNicknamePromptTemplate()
        if (!template) throw new Error('Le message ROM de l’écran de surnom Safari est absent.')
        const prompt = formatHgssRomMessage(template, [pokemon.speciesName])
        finishNicknameInput = finish
        elements.input.maxLength = hgssPokemonNicknameMaxLength
        elements.input.value = ''
        label.textContent = prompt
        elements.input.setAttribute('aria-label', prompt)
        count.textContent = `0/${hgssPokemonNicknameMaxLength}`
        options.setNicknameCancellable(false)
        elements.root.hidden = false
        options.prepareNicknameInput()
      }, true)
    })
  }

  return {
    request,
    submit(nickname) {
      if (storageMessageController.isActive()) {
        storageMessageController.handle('confirm')
        return true
      }
      if (!finishNicknameInput) return false
      // Le Naming Screen Safari natif n'est pas annulable une fois ouvert.
      if (nickname === undefined) return true
      const finish = finishNicknameInput
      finishNicknameInput = undefined
      options.setNicknameCancellable(true)
      finish(nickname)
      return true
    },
    handleStorageMessage: (action) => storageMessageController.handle(action),
  }
}
