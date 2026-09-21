export type TitleMenuPartyMemberPresentation = {
  key: string
  title: string
  createIcon: () => HTMLElement | undefined
}

export type TitleMenuStatPresentation = {
  label: string
  value: string
}

export type TitleMenuActionId = 'continue' | 'new-game' | 'delete' | 'new-game-plus' | 'export' | 'import'

export type TitleMenuActionPresentation = {
  id: TitleMenuActionId
  label: string
  detail: string
  tone: 'primary' | 'secondary' | 'danger'
  slot?: number
}

export type TitleMenuItemPresentation = {
  id: string
  kind: 'save-slot' | 'action'
  number: string
  occupied: boolean
  corrupted?: true
  name: string
  location: string
  kicker: string
  progress: string
  savedAt?: { dateTime: string, label: string }
  partyLabel?: string
  party: readonly TitleMenuPartyMemberPresentation[]
  stats: readonly TitleMenuStatPresentation[]
  actions: readonly TitleMenuActionPresentation[]
}

export type TitleMenuPresentationModel = {
  eyebrow: string
  heading: string
  cursor: number
  items: readonly TitleMenuItemPresentation[]
}

type SlotRefs = {
  button: HTMLButtonElement
  number: HTMLSpanElement
  name: HTMLElement
  location: HTMLElement
}

type PartyCacheEntry = {
  signature: string
  icons: HTMLElement[]
}

type TitleMenuRefs = {
  screen: HTMLElement
  eyebrow: HTMLSpanElement
  heading: HTMLHeadingElement
  slots: SlotRefs[]
  preview: HTMLElement
  kicker: HTMLSpanElement
  player: HTMLHeadingElement
  location: HTMLElement
  progress: HTMLSpanElement
  stats: HTMLElement
  party: HTMLElement
  savedAt: HTMLTimeElement
  actions: HTMLElement
  partyCache: Map<string, PartyCacheEntry>
}

const presentationByRoot = new WeakMap<HTMLElement, TitleMenuRefs>()

function createStructure(root: HTMLElement, slotCount: number): TitleMenuRefs {
  const screen = document.createElement('section')
  screen.className = 'title-save-screen'

  const header = document.createElement('header')
  header.className = 'title-save-header'
  const headerCopy = document.createElement('div')
  const eyebrow = document.createElement('span')
  const heading = document.createElement('h2')
  const rule = document.createElement('i')
  rule.setAttribute('aria-hidden', 'true')
  headerCopy.append(eyebrow, heading)
  header.append(headerCopy, rule)

  const body = document.createElement('div')
  body.className = 'title-save-body'
  const slotList = document.createElement('nav')
  slotList.className = 'title-save-slots'
  const slots = Array.from({ length: slotCount }, (_, index): SlotRefs => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'title-save-slot'
    button.dataset.titleMenuIndex = String(index)
    const number = document.createElement('span')
    number.className = 'title-save-slot-number'
    const copy = document.createElement('span')
    copy.className = 'title-save-slot-copy'
    const name = document.createElement('strong')
    const location = document.createElement('small')
    copy.append(name, location)
    const marker = document.createElement('span')
    marker.className = 'title-save-slot-marker'
    marker.setAttribute('aria-hidden', 'true')
    button.append(number, copy, marker)
    slotList.append(button)
    return { button, number, name, location }
  })

  const preview = document.createElement('article')
  preview.className = 'title-save-preview'
  const kicker = document.createElement('span')
  kicker.className = 'title-save-kicker'
  const player = document.createElement('h3')
  const details = document.createElement('p')
  details.className = 'title-save-summary'
  const location = document.createElement('strong')
  const progress = document.createElement('span')
  details.append(location, progress)
  const stats = document.createElement('dl')
  stats.className = 'title-save-stats'
  const party = document.createElement('div')
  party.className = 'title-save-party'
  const savedAt = document.createElement('time')
  const actions = document.createElement('nav')
  actions.className = 'title-save-actions'
  actions.setAttribute('aria-label', 'Actions de sauvegarde')
  preview.append(kicker, player, details, stats, party, savedAt, actions)

  body.append(slotList, preview)
  screen.append(header, body)
  root.replaceChildren(screen)
  const refs = { screen, eyebrow, heading, slots, preview, kicker, player, location, progress, stats, party, savedAt, actions, partyCache: new Map() }
  presentationByRoot.set(root, refs)
  return refs
}

function getStructure(root: HTMLElement, slotCount: number): TitleMenuRefs {
  const current = presentationByRoot.get(root)
  return current?.screen.parentElement === root && current.slots.length === slotCount
    ? current
    : createStructure(root, slotCount)
}

function syncParty(refs: TitleMenuRefs, slot: TitleMenuItemPresentation): void {
  const signature = slot.party.map(({ key }) => key).join('\u001f')
  let cached = refs.partyCache.get(slot.id)
  if (!cached || cached.signature !== signature) {
    cached = {
      signature,
      icons: slot.party.flatMap(({ createIcon, title }) => {
        const icon = createIcon()
        if (!icon) return []
        icon.title = title
        return [icon]
      }),
    }
    refs.partyCache.set(slot.id, cached)
  }
  refs.party.replaceChildren(...cached.icons)
  refs.party.hidden = cached.icons.length === 0
  if (slot.partyLabel) refs.party.setAttribute('aria-label', slot.partyLabel)
  else refs.party.removeAttribute('aria-label')
}

function syncStats(refs: TitleMenuRefs, slot: TitleMenuItemPresentation): void {
  refs.stats.replaceChildren(...slot.stats.map(({ label, value }) => {
    const group = document.createElement('div')
    const term = document.createElement('dt')
    term.textContent = label
    const description = document.createElement('dd')
    description.textContent = value
    group.append(term, description)
    return group
  }))
  refs.stats.hidden = slot.stats.length === 0
}

function syncActions(refs: TitleMenuRefs, slot: TitleMenuItemPresentation): void {
  refs.actions.replaceChildren(...slot.actions.map((action, index) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'title-save-action'
    button.dataset.titleMenuAction = action.id
    button.dataset.actionTone = action.tone
    if (action.slot !== undefined) button.dataset.titleMenuSlot = String(action.slot)
    button.tabIndex = index === 0 ? 0 : -1
    const label = document.createElement('strong')
    label.textContent = action.label
    button.append(label)
    if (action.detail) {
      const detail = document.createElement('small')
      detail.textContent = action.detail
      button.append(detail)
    }
    return button
  }))
  refs.actions.hidden = slot.actions.length === 0
}

export function syncTitleMenuPresentation(root: HTMLElement, model: TitleMenuPresentationModel): void {
  const refs = getStructure(root, model.items.length)
  refs.eyebrow.textContent = model.eyebrow
  refs.heading.textContent = model.heading

  model.items.forEach((slot, index) => {
    const ref = refs.slots[index]!
    const selected = index === model.cursor
    ref.button.dataset.menuId = slot.id
    ref.button.dataset.digitalInputDelegate = 'true'
    ref.button.dataset.saveState = slot.kind === 'action' ? 'action' : slot.corrupted ? 'corrupt' : slot.occupied ? 'occupied' : 'empty'
    ref.button.setAttribute('aria-current', String(selected))
    ref.button.tabIndex = selected ? 0 : -1
    ref.number.textContent = slot.number
    ref.name.textContent = slot.name
    ref.location.textContent = slot.location
  })

  const selected = model.items[model.cursor]
  if (!selected) return
  if (selected.kind === 'save-slot') refs.preview.dataset.saveSlot = selected.number
  else delete refs.preview.dataset.saveSlot
  refs.kicker.textContent = selected.kicker
  refs.player.textContent = selected.name
  refs.location.textContent = selected.location
  refs.progress.textContent = selected.progress
  refs.progress.hidden = selected.progress.length === 0
  syncStats(refs, selected)
  syncParty(refs, selected)
  refs.savedAt.hidden = !selected.savedAt
  refs.savedAt.dateTime = selected.savedAt?.dateTime ?? ''
  refs.savedAt.textContent = selected.savedAt?.label ?? ''
  syncActions(refs, selected)

  const selectedButton = refs.slots[model.cursor]?.button
  const focusedAction = (document.activeElement as HTMLElement | undefined)?.dataset?.titleMenuAction
  if (!focusedAction && selectedButton && document.activeElement !== selectedButton) selectedButton.focus({ preventScroll: true })
  selectedButton?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
}
