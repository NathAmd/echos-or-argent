import type { GameTextEntryOverlay } from './gameTextEntryOverlay'

export type FieldTextEntryCoordinator = Readonly<{
  setNicknameCancellable: (cancellable: boolean) => void
  isNicknameCancellable: () => boolean
  writeNickname: (value: string) => void
  openNickname: () => void
  openNumber: () => void
  completeNicknameForAutomation: () => boolean
  completeNumberForAutomation: () => boolean
}>

export function createFieldTextEntryCoordinator(options: Readonly<{
  nicknameRoot: HTMLElement
  nicknameInput: HTMLInputElement
  numberInput: HTMLInputElement
  textEntry: GameTextEntryOverlay
  submitNickname: (value: string | undefined) => void
  submitNumber: (value: number | undefined) => void
}>): FieldTextEntryCoordinator {
  let nicknameCancellable = true

  const setNicknameCancellable = (cancellable: boolean): void => {
    nicknameCancellable = cancellable
    const cancel = options.nicknameRoot.querySelector<HTMLButtonElement>('[data-nickname-cancel]')
    if (cancel) { cancel.hidden = !cancellable; cancel.disabled = !cancellable }
  }

  const writeNickname = (value: string): void => {
    options.nicknameInput.value = value
    const count = options.nicknameRoot.querySelector<HTMLElement>('.field-nickname-count')
    if (count) count.textContent = `${value.length}/${options.nicknameInput.maxLength}`
  }

  const openNickname = (): void => {
    if (options.textEntry.isOpen()) return
    options.textEntry.open({
      mode: 'name',
      title: options.nicknameInput.getAttribute('aria-label') || 'Surnom',
      maxLength: options.nicknameInput.maxLength,
      cancellable: nicknameCancellable,
      read: () => options.nicknameInput.value,
      write: writeNickname,
      submit: options.submitNickname,
      cancel: () => { if (nicknameCancellable) options.submitNickname(undefined) },
    })
  }

  const openNumber = (): void => {
    if (options.textEntry.isOpen()) return
    options.textEntry.open({
      mode: 'number',
      title: options.numberInput.getAttribute('aria-label') || 'Nombre',
      min: Number(options.numberInput.min),
      max: Number(options.numberInput.max),
      step: Number(options.numberInput.step) || 1,
      cancellable: true,
      read: () => options.numberInput.value,
      write: (value) => { options.numberInput.value = value },
      submit: (value) => { options.submitNumber(Number(value)) },
      cancel: () => { options.submitNumber(undefined) },
    })
  }

  return Object.freeze({
    setNicknameCancellable,
    isNicknameCancellable: () => nicknameCancellable,
    writeNickname,
    openNickname,
    openNumber,
    completeNicknameForAutomation: () => {
      if (options.textEntry.isOpen()) {
        if (nicknameCancellable) options.textEntry.close()
        else return options.textEntry.submitCurrent()
        return true
      }
      options.submitNickname(nicknameCancellable ? undefined : options.nicknameInput.value)
      return true
    },
    completeNumberForAutomation: () => {
      if (options.textEntry.isOpen()) return options.textEntry.submitCurrent()
      options.submitNumber(Number(options.numberInput.value))
      return true
    },
  })
}
