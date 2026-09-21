import { hgssMartConfirmNoChoice, hgssMartExitChoice, type HgssMartChoiceOption } from '../items/hgssMartSession'
import type { FieldScriptStep } from '../scripts/fieldScriptRunner'
import { formatHgssRomMessage } from './romMessageFormatting'

type ShopStep = Extract<FieldScriptStep, { kind: 'choice' }> & { shop: NonNullable<Extract<FieldScriptStep, { kind: 'choice' }>['shop']> }
type ShopNumber = NonNullable<Extract<FieldScriptStep, { kind: 'number' }>['shop']>

export type HgssShopPresentationOptions = {
  step: ShopStep
  shopMessages: Record<number, string>
  bagMessages: Record<number, string>
  martMessages: Record<number, string>
  createItemIcon: (itemId: number) => HTMLElement
}

function shopLabel(value: number, messages: Record<number, string>): string {
  if (value === hgssMartExitChoice) return messages[323] ?? ''
  return ''
}

function createShopButton(option: HgssMartChoiceOption, index: number, options: HgssShopPresentationOptions): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.dataset.choiceIndex = String(index)
  if (option.itemId === undefined) {
    const confirming = options.step.shop.phase === 'confirm'
    button.className = confirming ? 'field-shop-confirm-action' : 'field-shop-exit'
    button.textContent = confirming
      ? options.shopMessages[option.value === hgssMartConfirmNoChoice ? 43 : 42] ?? ''
      : option.label ?? shopLabel(option.value, options.shopMessages)
    return button
  }
  button.className = 'field-shop-item'
  button.dataset.shopItemId = String(option.itemId)
  const icon = options.createItemIcon(option.itemId)
  icon.classList.add('field-shop-item-icon')
  icon.setAttribute('aria-hidden', 'true')
  const copy = document.createElement('span')
  copy.className = 'field-shop-item-copy'
  const name = document.createElement('strong')
  name.textContent = option.label ?? ''
  const description = document.createElement('small')
  description.textContent = option.description ?? ''
  copy.append(name, description)
  const values = document.createElement('span')
  values.className = 'field-shop-item-values'
  const price = document.createElement('strong')
  price.textContent = `${(option.price ?? 0).toLocaleString('fr-FR')} ₽`
  const quantity = document.createElement('small')
  quantity.textContent = `×${option.quantity ?? 0}`
  values.append(price, quantity)
  button.append(icon, copy, values)
  return button
}

export function createHgssShopPresentation(options: HgssShopPresentationOptions): HTMLElement[] {
  const { step } = options
  const buttons = step.options.map((option, index) => createShopButton(option, index, options))
  const header = document.createElement('header')
  header.className = 'field-shop-header'
  const title = document.createElement('strong')
  title.textContent = options.shopMessages[step.shop.mode === 'buy' ? 321 : 322] ?? ''
  const money = document.createElement('span')
  const moneyLabel = document.createElement('small')
  moneyLabel.textContent = options.bagMessages[80] ?? ''
  const moneyValue = document.createElement('strong')
  moneyValue.textContent = `${step.shop.balance.toLocaleString('fr-FR')} ₽`
  money.append(moneyLabel, moneyValue)
  header.append(title, money)
  if (step.shop.phase === 'confirm') {
    const transaction = step.shop.transaction
    if (!transaction) throw new Error('Le récapitulatif de boutique HGSS est absent.')
    const confirmation = document.createElement('section')
    confirmation.className = 'field-shop-confirm'
    const prompt = document.createElement('p')
    const template = step.shop.mode === 'buy' ? options.martMessages[14] ?? '' : options.bagMessages[78] ?? ''
    prompt.textContent = formatHgssRomMessage(template, step.shop.mode === 'buy'
      ? [String(transaction.quantity), transaction.total.toLocaleString('fr-FR')]
      : [transaction.total.toLocaleString('fr-FR')])
    const item = document.createElement('div')
    item.className = 'field-shop-confirm-item'
    const icon = options.createItemIcon(transaction.itemId)
    icon.classList.add('field-shop-item-icon')
    const identity = document.createElement('span')
    const name = document.createElement('strong')
    name.textContent = transaction.itemName
    const pocket = document.createElement('small')
    pocket.textContent = transaction.pocketLabel
    identity.append(name, pocket)
    const quantity = document.createElement('strong')
    quantity.textContent = `×${transaction.quantity}`
    item.append(icon, identity, quantity)
    const actions = document.createElement('nav')
    actions.replaceChildren(...buttons)
    confirmation.append(prompt, item, actions)
    return [header, confirmation]
  }
  const list = document.createElement('div')
  list.className = 'field-shop-list'
  const children: HTMLElement[] = []
  let currentPocket: number | undefined
  step.options.forEach((option, index) => {
    if (option.itemId !== undefined && option.pocket !== currentPocket) {
      currentPocket = option.pocket
      const pocket = document.createElement('strong')
      pocket.className = 'field-shop-pocket'
      pocket.textContent = option.pocketLabel ?? ''
      children.push(pocket)
    }
    children.push(buttons[index]!)
  })
  list.replaceChildren(...children)
  return [header, list]
}

export function syncHgssShopNumberPresentation(
  form: HTMLFormElement,
  shop: ShopNumber | undefined,
  messages: { shopMessages: Record<number, string>, bagMessages: Record<number, string>, martMessages: Record<number, string> },
): void {
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')
  const cancel = form.querySelector<HTMLButtonElement>('[data-number-cancel]')
  const input = form.querySelector<HTMLInputElement>('input[type="number"]')
  if (input && !input.dataset.defaultAriaLabel) input.dataset.defaultAriaLabel = input.getAttribute('aria-label') ?? ''
  for (const button of [submit, cancel]) if (button && !button.dataset.defaultAriaLabel) button.dataset.defaultAriaLabel = button.getAttribute('aria-label') ?? ''
  form.classList.toggle('field-number-shop', Boolean(shop))
  if (!shop) {
    delete form.dataset.shopPrompt; delete form.dataset.shopPrice
    form.removeAttribute('role'); form.removeAttribute('aria-modal'); form.removeAttribute('aria-label')
    if (input) input.setAttribute('aria-label', input.dataset.defaultAriaLabel ?? '')
    if (submit) { submit.textContent = '✓'; submit.setAttribute('aria-label', submit.dataset.defaultAriaLabel ?? '') }
    if (cancel) { cancel.textContent = '✕'; cancel.setAttribute('aria-label', cancel.dataset.defaultAriaLabel ?? '') }
    return
  }
  const transaction = shop.transaction
  const template = shop.mode === 'buy' ? messages.martMessages[12] ?? '' : messages.bagMessages[77] ?? ''
  const priceTemplate = shop.mode === 'buy' ? messages.martMessages[18] ?? '' : messages.bagMessages[81] ?? ''
  form.dataset.shopPrompt = formatHgssRomMessage(template, [transaction.itemName])
  form.dataset.shopPrice = `${formatHgssRomMessage(priceTemplate, [transaction.unitPrice.toLocaleString('fr-FR')])} · ×1–${transaction.maxQuantity}`
  form.setAttribute('role', 'dialog'); form.setAttribute('aria-modal', 'true'); form.setAttribute('aria-label', form.dataset.shopPrompt)
  if (input) input.setAttribute('aria-label', form.dataset.shopPrompt)
  if (submit) { submit.textContent = messages.shopMessages[40] ?? ''; submit.setAttribute('aria-label', submit.textContent) }
  if (cancel) { cancel.textContent = messages.shopMessages[45] ?? ''; cancel.setAttribute('aria-label', cancel.textContent) }
}
