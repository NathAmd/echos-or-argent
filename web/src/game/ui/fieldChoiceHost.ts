import type { GameDigitalEvent } from '../../gameInput'
import type { FieldScriptStep } from '../scripts/fieldScriptProtocol'
import { createFieldControlActivation, resolveIndexedButton, syncRovingControlSelection } from './fieldControlInteraction'
import { createShopNavigationMemory } from './shopNavigationMemory'

export type FieldChoiceStep = Extract<FieldScriptStep, { kind: 'choice' }>
export type FieldShopChoiceStep = FieldChoiceStep & { shop: NonNullable<FieldChoiceStep['shop']> }

export type FieldChoiceRunnerPort = Readonly<{
  choose: (value: number) => void
  resume: () => void
}>

export type FieldPartyChoicePresentation = Readonly<{
  icon: HTMLElement
  name: string
  details: string
  shiny: boolean
}>

export type FieldChoiceHost = Readonly<{
  open: (step: FieldChoiceStep) => void
  handleDigital: (event: GameDigitalEvent) => boolean
  select: (index?: number) => void
  cancel: () => void
  reset: () => void
  isOpen: () => boolean
  destroy: () => void
}>

export function createFieldChoiceHost(root: HTMLElement, ports: Readonly<{
  createButton: () => HTMLButtonElement
  createElement: (tag: 'span' | 'strong' | 'small') => HTMLElement
  createShopPresentation: (step: FieldShopChoiceStep) => HTMLElement[]
  createStarterMachine: () => HTMLElement | undefined
  createStarterIcon: (choice: number) => HTMLElement
  createPartyChoice: (slot: number) => FieldPartyChoicePresentation
  formatOptionLabel: (label: string) => string
  previewStarter: (choice: number) => Promise<unknown>
  resetStarterPreview: () => void
  clearStarterIcons: () => void
  reportStarterPreviewError: (error: unknown) => void
  onPointerInteraction: () => void
  readRunner: () => FieldChoiceRunnerPort | undefined
}>): FieldChoiceHost {
  let values: number[] = []
  let cursor = 0
  let cancellable = false
  const shopNavigationMemory = createShopNavigationMemory()

  const isOpen = (): boolean => !root.hidden

  const render = (focusSelected = false): void => {
    root.dataset.starterCursor = String(cursor)
    const selected = syncRovingControlSelection([...root.querySelectorAll<HTMLButtonElement>('button')], cursor, 'aria-current', focusSelected)
    if (selected && root.classList.contains('field-choice-shop')) selected.scrollIntoView({ block: 'nearest' })
  }

  const previewStarter = (): void => {
    if (!root.classList.contains('field-choice-starter')) return
    const choice = values[cursor]
    if (choice === undefined) return
    void ports.previewStarter(choice).catch(ports.reportStarterPreviewError)
  }

  const move = (direction: -1 | 1): void => {
    if (values.length === 0) return
    cursor = (cursor + direction + values.length) % values.length
    render(true)
    previewStarter()
  }

  const rememberSelection = (value: number): void => {
    const shopMode = root.classList.contains('field-choice-shop') ? root.dataset.shopMode : undefined
    if (shopMode === 'buy' || shopMode === 'sell') {
      shopNavigationMemory.rememberSelection(shopMode, root.dataset.shopPhase === 'browse' ? 'browse' : 'confirm', value, root.querySelector<HTMLElement>('.field-shop-list')?.scrollTop ?? 0)
    }
  }

  const rememberScroll = (): void => {
    const shopMode = root.classList.contains('field-choice-shop') ? root.dataset.shopMode : undefined
    if (shopMode === 'buy' || shopMode === 'sell') {
      shopNavigationMemory.rememberScroll(shopMode, root.dataset.shopPhase === 'browse' ? 'browse' : 'confirm', root.querySelector<HTMLElement>('.field-shop-list')?.scrollTop ?? 0)
    }
  }

  const closePresentation = (): void => {
    root.hidden = true
    root.replaceChildren()
    ports.clearStarterIcons()
    values = []
    cancellable = false
    ports.resetStarterPreview()
  }

  const select = (index = cursor): void => {
    const value = values[index]
    const runner = ports.readRunner()
    if (!runner || value === undefined) return
    rememberSelection(value)
    runner.choose(value)
    closePresentation()
    runner.resume()
  }

  const cancel = (): void => {
    const runner = ports.readRunner()
    if (!runner || !cancellable) return
    rememberScroll()
    runner.choose(0xfffe)
    closePresentation()
    runner.resume()
  }

  const activation = createFieldControlActivation(
    (index: number) => { cursor = index; render(true); previewStarter() },
    select,
  )

  const open = (step: FieldChoiceStep): void => {
    const starterPresentation = step.presentation === 'starter'
    const partyPresentation = step.presentation === 'party'
    const shopPresentation = step.presentation === 'shop' && step.shop !== undefined
    root.classList.toggle('field-choice-starter', starterPresentation)
    root.classList.toggle('field-choice-party', partyPresentation)
    root.classList.toggle('field-choice-shop', shopPresentation)
    if (step.shop) {
      root.dataset.shopMode = step.shop.mode
      root.dataset.shopPhase = step.shop.phase
    } else {
      delete root.dataset.shopMode
      delete root.dataset.shopPhase
    }
    values = step.options.map((option) => option.value)
    cancellable = step.cancellable
    const rememberedShopValue = step.shop ? shopNavigationMemory.read(step.shop.mode).value : undefined
    const rememberedShopIndex = rememberedShopValue === undefined ? -1 : values.indexOf(rememberedShopValue)
    cursor = rememberedShopIndex >= 0 ? rememberedShopIndex : 0
    ports.resetStarterPreview()

    const starterMachine = starterPresentation ? ports.createStarterMachine() : undefined
    if (starterMachine) {
      starterMachine.className = 'starter-machine-model'
      starterMachine.setAttribute('aria-hidden', 'true')
    }
    const choiceButtons = shopPresentation ? ports.createShopPresentation(step as FieldShopChoiceStep) : step.options.map((option, index) => {
      const button = ports.createButton()
      button.type = 'button'
      button.dataset.choiceIndex = String(index)
      if (starterPresentation) {
        button.dataset.starterValue = String(option.value)
        const pokemonIcon = ports.createStarterIcon(option.value)
        pokemonIcon.className = 'starter-pokemon-icon'
        pokemonIcon.setAttribute('aria-hidden', 'true')
        const label = ports.createElement('span')
        label.className = 'starter-name'
        label.textContent = option.label ? ports.formatOptionLabel(option.label) : ''
        button.append(pokemonIcon, label)
      } else if (partyPresentation && option.value !== 0xfffe) {
        const presentation = ports.createPartyChoice(option.value)
        presentation.icon.className = 'field-party-choice-icon'
        presentation.icon.dataset.shiny = String(presentation.shiny)
        presentation.icon.setAttribute('aria-hidden', 'true')
        const identity = ports.createElement('span')
        identity.className = 'field-party-choice-identity'
        const name = ports.createElement('strong')
        name.textContent = presentation.name
        const details = ports.createElement('small')
        details.textContent = presentation.details
        identity.append(name, details)
        button.append(presentation.icon, identity)
      } else {
        button.textContent = option.label ? ports.formatOptionLabel(option.label) : index === 0 ? '✓' : '✕'
      }
      return button
    })
    root.replaceChildren(...(starterMachine ? [starterMachine, ...choiceButtons] : choiceButtons))
    root.hidden = false
    if (step.shop?.phase === 'browse') root.querySelector<HTMLElement>('.field-shop-list')?.scrollTo({ top: shopNavigationMemory.read(step.shop.mode).scrollTop })
    render()
    previewStarter()
  }

  const handleDigital = (event: GameDigitalEvent): boolean => {
    if (!isOpen() || !event.pressed || !ports.readRunner()) return false
    if (event.action === 'up' || event.action === 'left') move(-1)
    else if (event.action === 'down' || event.action === 'right') move(1)
    else if (event.action === 'confirm') activation.click(cursor)
    else if (event.action === 'cancel' || event.action === 'menu') cancel()
    return true
  }

  const handlePointerDown = (event: PointerEvent): void => {
    ports.onPointerInteraction()
    const index = resolveIndexedButton(event.target, root, 'data-choice-index', values.length)
    if (index !== undefined) activation.pointerDown(index)
  }
  const handleClick = (event: MouseEvent): void => {
    const index = resolveIndexedButton(event.target, root, 'data-choice-index', values.length)
    if (index !== undefined) activation.click(index)
  }
  root.addEventListener('pointerdown', handlePointerDown)
  root.addEventListener('click', handleClick)

  const reset = (): void => {
    closePresentation()
    root.classList.remove('field-choice-starter', 'field-choice-party', 'field-choice-shop')
    delete root.dataset.shopMode
    delete root.dataset.shopPhase
    cursor = 0
    shopNavigationMemory.clear()
  }

  return Object.freeze({
    open,
    handleDigital,
    select,
    cancel,
    reset,
    isOpen,
    destroy: () => {
      root.removeEventListener('pointerdown', handlePointerDown)
      root.removeEventListener('click', handleClick)
      reset()
    },
  })
}
