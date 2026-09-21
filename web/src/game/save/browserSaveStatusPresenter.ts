export type BrowserSaveStatusPresenter = Readonly<{
  reportError: (message: string) => void
  clearError: () => void
}>

export function createBrowserSaveStatusPresenter(element: HTMLElement): BrowserSaveStatusPresenter {
  const reportError = (message: string): void => {
    element.textContent = message
    element.dataset.saveError = 'true'
    element.hidden = false
  }

  const clearError = (): void => {
    element.hidden = true
    element.textContent = ''
    delete element.dataset.saveError
  }

  clearError()
  return Object.freeze({ reportError, clearError })
}