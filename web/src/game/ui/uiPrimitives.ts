export type UiValueRow = Readonly<{
  label: string
  value: string
  tone?: string
}>

export function createUiButton(
  document: Pick<Document, 'createElement'>,
  label: string,
  dataset: Readonly<Record<string, string>> = {},
): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = label
  Object.assign(button.dataset, dataset)
  return button
}

export function syncRovingSelection(buttons: readonly HTMLButtonElement[], selectedIndex: number): void {
  buttons.forEach((button, index) => {
    const selected = index === selectedIndex
    button.setAttribute('aria-current', String(selected))
    button.tabIndex = selected ? 0 : -1
  })
  buttons[selectedIndex]?.focus({ preventScroll: true })
}

export function createUiValueList(
  createElement: <K extends keyof HTMLElementTagNameMap>(tagName: K) => HTMLElementTagNameMap[K],
  className: string,
  rows: readonly UiValueRow[],
): HTMLOListElement {
  const list = createElement('ol')
  list.className = className
  list.replaceChildren(...rows.map((row) => {
    const item = createElement('li')
    if (row.tone) item.dataset.tone = row.tone
    const label = createElement('span')
    label.textContent = row.label
    const value = createElement('strong')
    value.textContent = row.value
    item.append(label, value)
    return item
  }))
  return list
}