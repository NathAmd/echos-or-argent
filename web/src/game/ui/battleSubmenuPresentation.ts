function prepareBagButton(button: HTMLButtonElement): void {
  if (button.dataset.battleItemPrepared === 'true') return
  prepareCarouselAnimation(button)
  button.dataset.battleItemPrepared = 'true'
}

function prepareCarouselAnimation(button: HTMLButtonElement): void {
  if (button.dataset.battleCarouselAnimationPrepared === 'true') return
  button.addEventListener('animationend', (event) => {
    if (event.target === button && event.animationName.startsWith('combat-carousel-enter')) {
      delete button.dataset.carouselEntering
    }
  })
  button.dataset.battleCarouselAnimationPrepared = 'true'
}

function preparePartyButton(button: HTMLButtonElement): void {
  if (button.dataset.battlePartyPrepared === 'true') return
  const labelNode = [...button.childNodes].find((node) => node.nodeType === Node.TEXT_NODE)
  const label = document.createElement('span')
  label.className = 'battle-party-name'
  label.textContent = labelNode?.textContent?.trim() ?? ''
  labelNode?.replaceWith(label)
  button.querySelector<HTMLElement>(':scope > span:not(.battle-party-name):not(.battle-menu-types)')
    ?.classList.add('battle-party-detail')
  button.dataset.battlePartyPrepared = 'true'
}

export function resolveBattlePartyArcPosition(index: number, count: number): {
  centeredPosition: number
  horizontalOffset: number
  tilt: number
} | undefined {
  const visibleCount = Math.min(6, Math.max(0, count))
  if (index < 0 || index >= visibleCount) return undefined
  const progress = visibleCount <= 1 ? .5 : index / (visibleCount - 1)
  return {
    centeredPosition: index + (6 - visibleCount) / 2,
    horizontalOffset: Math.sin(progress * Math.PI) * 48,
    tilt: -5 + progress * 10,
  }
}

function arrangeBattlePartyArc(buttons: readonly HTMLButtonElement[]): void {
  for (const [index, button] of buttons.entries()) {
    const position = resolveBattlePartyArcPosition(index, buttons.length)
    button.hidden = !position
    if (!position) continue
    button.dataset.battlePartyArcPosition = String(index)
    button.style.setProperty('--battle-party-arc-x', `${position.horizontalOffset.toFixed(1)}px`)
    button.style.setProperty('--battle-party-arc-y', `calc(15px + var(--battle-party-step, 66px) * ${position.centeredPosition})`)
    button.style.setProperty('--battle-party-arc-tilt', `${position.tilt.toFixed(1)}deg`)
    button.style.setProperty('--battle-party-arc-layer', String(3 + Math.round(position.horizontalOffset / 24)))
  }
}

export function resolveBattleCarouselSlot(index: number, selectedIndex: number, count: number): number | undefined {
  if (count <= 0) return undefined
  let slot = (index - selectedIndex + count) % count
  if (slot > Math.floor(count / 2)) slot -= count
  return Math.abs(slot) <= 2 ? slot : undefined
}

export const resolveBattleBagCarouselSlot = resolveBattleCarouselSlot

function arrangeBattleCarousel(container: HTMLElement, buttons: readonly HTMLButtonElement[], selectedIndex: number): void {
  const count = buttons.length
  const previousIndex = Number.parseInt(container.dataset.carouselSelectedIndex ?? '', 10)
  if (Number.isInteger(previousIndex) && previousIndex !== selectedIndex) {
    const forwardDistance = (selectedIndex - previousIndex + count) % count
    container.dataset.carouselDirection = forwardDistance <= count / 2 ? 'next' : 'previous'
  } else delete container.dataset.carouselDirection
  container.dataset.carouselSelectedIndex = String(selectedIndex)
  container.scrollTop = 0
  const horizontalOffsets = [0, 30, 48, 30, 0]
  const tilts = [-5, -2.5, 0, 2.5, 5]
  const scales = [.94, .97, 1.02, .97, .94]
  const opacities = [.64, .84, 1, .84, .64]
  for (const [index, button] of buttons.entries()) {
    const slot = resolveBattleCarouselSlot(index, selectedIndex, count)
    const visible = slot !== undefined
    const wasVisible = button.dataset.battleCarouselSlot !== undefined && !button.hidden
    if (!visible) {
      button.hidden = true
      delete button.dataset.battleCarouselSlot
      delete button.dataset.carouselEntering
      continue
    }
    button.hidden = false
    if (!wasVisible && Number.isInteger(previousIndex)) button.dataset.carouselEntering = 'true'
    const visualIndex = slot + 2
    button.dataset.battleCarouselSlot = String(slot)
    button.style.setProperty('--battle-carousel-arc-x', `${horizontalOffsets[visualIndex]}px`)
    button.style.setProperty('--battle-carousel-arc-y', `calc(var(--battle-carousel-step, 67px) * ${visualIndex})`)
    button.style.setProperty('--battle-carousel-arc-tilt', `${tilts[visualIndex]}deg`)
    button.style.setProperty('--battle-carousel-arc-scale', String(scales[visualIndex]))
    button.style.setProperty('--battle-carousel-arc-opacity', String(opacities[visualIndex]))
    button.style.setProperty('--battle-carousel-arc-layer', String(3 - Math.abs(slot)))
  }
}

function syncOverflowingDescriptions(buttons: readonly HTMLButtonElement[]): void {
  for (const button of buttons) {
    const viewport = button.querySelector<HTMLElement>('.battle-item-description-viewport')
    const track = viewport?.querySelector<HTMLElement>('.battle-item-description-track')
    const description = track?.querySelector<HTMLElement>('.battle-item-description')
    if (!viewport || !track || !description) continue
    const width = Math.round(viewport.clientWidth)
    if (track.dataset.overflowWidth === String(width)) continue
    track.dataset.overflowWidth = String(width)
    track.querySelectorAll('[aria-hidden="true"]').forEach((copy) => copy.remove())
    delete track.dataset.overflow
    if (description.scrollWidth <= viewport.clientWidth) continue
    track.dataset.overflow = 'true'
    const copy = description.cloneNode(true) as HTMLElement
    copy.setAttribute('aria-hidden', 'true')
    track.append(copy)
  }
}

export function syncBattleSubmenuPresentation(container: HTMLElement): void {
  container.closest<HTMLElement>('.battle-command-deck')
    ?.querySelector<HTMLElement>(':scope > .battle-submenu-inspector')?.remove()
  const mode = container.closest<HTMLElement>('.battle-screen')?.dataset.uiMode
  if (mode !== 'bag' && mode !== 'party') return
  if (container.dataset.battleCarouselMode !== mode) {
    delete container.dataset.carouselSelectedIndex
    delete container.dataset.carouselDirection
    container.dataset.battleCarouselMode = mode
  }
  const selector = mode === 'bag' ? 'button[data-battle-item]' : 'button[data-battle-party-slot]'
  const buttons = [...container.querySelectorAll<HTMLButtonElement>(selector)]
  for (const button of buttons) {
    if (mode === 'bag') prepareBagButton(button)
    else preparePartyButton(button)
  }
  const selected = buttons.find((button) => button.getAttribute('aria-current') === 'true')
  if (!selected) return
  if (mode === 'party') {
    arrangeBattlePartyArc(buttons)
    return
  }
  arrangeBattleCarousel(container, buttons, buttons.indexOf(selected))
  syncOverflowingDescriptions(buttons)
}
