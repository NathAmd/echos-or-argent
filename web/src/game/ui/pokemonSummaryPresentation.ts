import type { PokemonCatalog } from '../../ndsTypes'
import { stripMessageControls } from '../../rom/messages/hgssMessageBank'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createBattleExperienceDisplay } from '../battle/battleExperienceDisplay'
import { calculatePokemonEvTotal, formatPokemonIvScore, pokemonEffortValueMaximum, pokemonEffortValueTotalMaximum, pokemonIndividualValueMaximum, pokemonTrainingStatKeys, resolvePokemonNatureStatModifier } from '../pokemon/pokemonTrainingValues'

export const pokemonSummaryPages = ['profile', 'stats', 'moves', 'ribbons'] as const
export type PokemonSummaryPage = typeof pokemonSummaryPages[number]

export type PokemonSummaryMove = {
  moveId: number
  name: string
  typeName: string
  categoryId: number
  power: number
  accuracy: number
  pp: number
  maxPp: number
}

export type PokemonSummaryModel = {
  pokemon: CanonicalPokemon
  displayName: string
  speciesName: string
  level: number
  genderMark: string
  typeNames: string[]
  abilityName: string
  natureName: string
  heldItemName?: string
  metLocationName?: string
  trainerName: string
  trainerId: string
  experience: ReturnType<typeof createBattleExperienceDisplay>
  moves: PokemonSummaryMove[]
}

export type PokemonSummaryModelOptions = {
  typeNames: readonly string[]
  heldItemName?: string
  metLocationName?: string
}

function requireRomName(names: readonly string[] | undefined, id: number, label: string): string {
  const name = names?.[id]
  if (!name) throw new Error(`Le nom ROM ${label} ${id} est absent du catalogue.`)
  return name
}

export function createPokemonSummaryModel(
  pokemon: CanonicalPokemon,
  catalog: PokemonCatalog,
  options: PokemonSummaryModelOptions,
): PokemonSummaryModel {
  const personal = catalog.personalData[pokemon.speciesId]
  if (!personal) throw new Error(`Les données personnelles ROM de l’espèce ${pokemon.speciesId} sont absentes.`)
  const typeNames = [...new Set(personal.types)].map((typeId) => requireRomName(options.typeNames, typeId, 'du type'))
  return {
    pokemon,
    displayName: pokemon.nickname ?? pokemon.speciesName,
    speciesName: pokemon.speciesName,
    level: pokemon.level,
    genderMark: pokemon.gender === 'male' ? '♂' : pokemon.gender === 'female' ? '♀' : '',
    typeNames,
    abilityName: requireRomName(catalog.abilityNames, pokemon.abilityId, 'du talent'),
    natureName: requireRomName(catalog.natureNames, pokemon.nature, 'de la nature'),
    heldItemName: options.heldItemName,
    metLocationName: options.metLocationName,
    trainerName: pokemon.originalTrainer.name,
    trainerId: String(pokemon.originalTrainer.id & 0xffff).padStart(5, '0'),
    experience: createBattleExperienceDisplay(pokemon, catalog),
    moves: pokemon.moves.map((move) => ({
      moveId: move.moveId,
      name: requireRomName(catalog.moveNames, move.moveId, 'de la capacité'),
      typeName: requireRomName(options.typeNames, move.data.type, 'du type'),
      categoryId: move.data.category,
      power: move.data.power,
      accuracy: move.data.accuracy,
      pp: move.pp,
      maxPp: move.maxPp,
    })),
  }
}

export function movePokemonSummaryPage(page: PokemonSummaryPage, delta: number): PokemonSummaryPage {
  const index = pokemonSummaryPages.indexOf(page)
  return pokemonSummaryPages[(index + Math.trunc(delta) % pokemonSummaryPages.length + pokemonSummaryPages.length) % pokemonSummaryPages.length]!
}

function appendDefinition(list: HTMLDListElement, label: string, value: string): void {
  const term = document.createElement('dt')
  term.textContent = label
  const detail = document.createElement('dd')
  detail.textContent = value
  list.append(term, detail)
}

function createTypeBadge(typeName: string): HTMLElement {
  const badge = document.createElement('span')
  badge.className = 'pokemon-summary-type'
  badge.textContent = typeName
  return badge
}

function createProfilePage(model: PokemonSummaryModel, messages: Record<number, string>): HTMLElement {
  const page = document.createElement('section')
  page.className = 'pokemon-summary-page pokemon-summary-profile'
  const data = document.createElement('dl')
  appendDefinition(data, messages[8] ?? '', String(model.pokemon.speciesId).padStart(3, '0'))
  appendDefinition(data, messages[10] ?? '', model.speciesName)
  appendDefinition(data, messages[13] ?? '', model.trainerName)
  appendDefinition(data, messages[15] ?? '', model.trainerId)
  appendDefinition(data, messages[17] ?? '', model.experience.total.toLocaleString('fr-FR'))
  appendDefinition(data, messages[19] ?? '', model.experience.levelCap ? '—' : model.experience.remaining.toLocaleString('fr-FR'))
  page.append(data)
  const memo = document.createElement('p')
  memo.className = 'pokemon-summary-memo'
  const date = model.pokemon.origin.metDate
  const dateLabel = date ? `${String(date.day).padStart(2, '0')}/${String(date.month).padStart(2, '0')}/${date.year}` : undefined
  memo.textContent = [model.natureName, dateLabel, model.metLocationName, model.pokemon.origin.metLevel].filter((value) => value !== undefined).join(' · ')
  page.append(memo)
  return page
}

function createTrainingValue(value: number, maximum: number, label: 'IV' | 'EV'): HTMLElement {
  const content = document.createElement('span')
  content.className = 'pokemon-summary-training-value'
  const bar = document.createElement('progress')
  bar.max = maximum
  bar.value = value
  bar.setAttribute('aria-label', `${label} ${value} / ${maximum}`)
  const exact = document.createElement('strong')
  exact.textContent = String(value)
  content.append(bar, exact)
  return content
}

export function createPokemonSummaryStatsPresentation(model: PokemonSummaryModel, messages: Record<number, string>): HTMLElement {
  const page = document.createElement('section')
  page.className = 'pokemon-summary-page pokemon-summary-stats'
  const overview = document.createElement('div')
  overview.className = 'pokemon-summary-training-overview'
  const ivScore = document.createElement('span')
  ivScore.textContent = `IV ${formatPokemonIvScore(model.pokemon.individualValues)} / 10`
  const evTotal = document.createElement('span')
  evTotal.textContent = `EV ${calculatePokemonEvTotal(model.pokemon.effortValues)} / ${pokemonEffortValueTotalMaximum}`
  overview.append(ivScore, evTotal)
  const table = document.createElement('table')
  const head = document.createElement('thead')
  const headings = document.createElement('tr')
  for (const heading of ['', messages[109] ?? '', `IV / ${pokemonIndividualValueMaximum}`, `EV / ${pokemonEffortValueMaximum}`]) {
    const cell = document.createElement('th')
    cell.scope = 'col'
    cell.textContent = heading
    headings.append(cell)
  }
  head.append(headings)
  const body = document.createElement('tbody')
  const labels = [110, 111, 112, 113, 114, 115] as const
  pokemonTrainingStatKeys.forEach((stat, index) => {
    const row = document.createElement('tr')
    const natureModifier = resolvePokemonNatureStatModifier(model.pokemon.nature, stat)
    if (natureModifier !== 0) row.dataset.natureModifier = natureModifier > 0 ? 'increased' : 'decreased'
    const label = document.createElement('th')
    label.scope = 'row'
    label.textContent = messages[labels[index]!] ?? ''
    const value = document.createElement('td')
    value.textContent = stat === 'hp' ? `${model.pokemon.currentHp} / ${model.pokemon.stats.hp}` : String(model.pokemon.stats[stat])
    const iv = document.createElement('td')
    iv.append(createTrainingValue(model.pokemon.individualValues[stat], pokemonIndividualValueMaximum, 'IV'))
    const ev = document.createElement('td')
    ev.append(createTrainingValue(model.pokemon.effortValues[stat], pokemonEffortValueMaximum, 'EV'))
    row.append(label, value, iv, ev)
    body.append(row)
  })
  table.append(head, body)
  page.append(overview, table)
  const ability = document.createElement('article')
  const label = document.createElement('small')
  label.textContent = messages[116] ?? ''
  const name = document.createElement('strong')
  name.textContent = model.abilityName
  const nature = document.createElement('span')
  nature.className = 'pokemon-summary-nature'
  nature.textContent = stripMessageControls(messages[24 + model.pokemon.nature] ?? '')
  ability.append(label, name, nature)
  page.append(ability)
  return page
}

function createMovesPage(model: PokemonSummaryModel, summaryMessages: Record<number, string>, partyMessages: Record<number, string>): HTMLElement {
  const page = document.createElement('section')
  page.className = 'pokemon-summary-page pokemon-summary-moves'
  for (const move of model.moves) {
    const row = document.createElement('article')
    const identity = document.createElement('div')
    const name = document.createElement('strong')
    name.textContent = move.name
    identity.append(name, createTypeBadge(move.typeName))
    const category = document.createElement('small')
    category.textContent = partyMessages[54 + Math.max(0, Math.min(2, move.categoryId))] ?? ''
    const numbers = document.createElement('span')
    numbers.textContent = `${summaryMessages[147] ?? ''} ${move.power || '—'} · ${summaryMessages[148] ?? ''} ${move.accuracy || '—'} · ${summaryMessages[135] ?? ''} ${move.pp}/${move.maxPp}`
    row.append(identity, category, numbers)
    page.append(row)
  }
  return page
}

function createRibbonsPage(model: PokemonSummaryModel, messages: Record<number, string>): HTMLElement {
  const page = document.createElement('section')
  page.className = 'pokemon-summary-page pokemon-summary-ribbons'
  const heading = document.createElement('strong')
  heading.textContent = `${messages[182] ?? ''} ${model.pokemon.ribbonIds.length}`.trim()
  page.append(heading)
  if (model.pokemon.ribbonIds.length > 0) {
    const list = document.createElement('div')
    for (const ribbonId of model.pokemon.ribbonIds) {
      const ribbon = document.createElement('span')
      ribbon.textContent = String(ribbonId)
      list.append(ribbon)
    }
    page.append(list)
  }
  return page
}

export type PokemonSummaryPresentationOptions = {
  model: PokemonSummaryModel
  page: PokemonSummaryPage
  partySlot: number
  partySize: number
  createPokemonSprite: () => HTMLElement
  createHeldItemIcon?: () => HTMLElement
  summaryMessages?: Record<number, string>
  partyMessages?: Record<number, string>
  onSelectPage: (page: PokemonSummaryPage) => void
  onSelectPartySlot: (slot: number) => void
}

export type PokemonSummaryPagePresentationOptions = Pick<PokemonSummaryPresentationOptions,
  'model' | 'page' | 'summaryMessages' | 'partyMessages'
>

export function createPokemonTeamDetailPresentation(
  model: PokemonSummaryModel,
  partySlot: number,
  partySize: number,
  statusLabel: string | undefined,
  createPokemonIcon: () => HTMLElement,
  createHeldItemIcon?: () => HTMLElement,
): DocumentFragment {
  const fragment = document.createDocumentFragment()
  const identity = document.createElement('div')
  identity.className = 'game-menu-pokemon-row'
  identity.dataset.shiny = String(model.pokemon.shiny)
  const icon = createPokemonIcon()
  icon.classList.add('game-menu-pokemon-icon')
  const copy = document.createElement('div')
  const kicker = document.createElement('span')
  kicker.className = 'game-menu-kicker'
  kicker.textContent = `${partySlot + 1} / ${partySize}`
  const heading = document.createElement('h3')
  heading.textContent = `${model.displayName}${model.genderMark ? ` ${model.genderMark}` : ''}`
  const summary = document.createElement('p')
  summary.textContent = `${model.speciesName} · N.${model.level} · PV ${model.pokemon.currentHp}/${model.pokemon.stats.hp}${statusLabel ? ` · ${statusLabel}` : ''}`
  const hp = document.createElement('progress')
  hp.className = 'game-menu-hp'
  hp.max = model.pokemon.stats.hp
  hp.value = model.pokemon.currentHp
  hp.setAttribute('aria-label', `PV ${model.pokemon.currentHp} sur ${model.pokemon.stats.hp}`)
  const states = document.createElement('div')
  states.className = 'game-menu-pokemon-states'
  states.append(...model.typeNames.map(createTypeBadge))
  if (model.heldItemName) {
    const item = document.createElement('span')
    item.className = 'pokemon-state-item'
    const itemIcon = createHeldItemIcon?.()
    if (itemIcon) item.append(itemIcon)
    item.append(model.heldItemName)
    states.append(item)
  }
  copy.append(kicker, heading, summary, hp, states)
  identity.append(icon, copy)
  fragment.append(identity)
  return fragment
}

export function createPokemonSummaryPresentation(options: PokemonSummaryPresentationOptions): HTMLElement {
  const { model } = options
  const root = document.createElement('div')
  root.className = 'pokemon-summary'
  root.dataset.summaryPage = options.page
  const tabs = document.createElement('nav')
  tabs.className = 'pokemon-summary-tabs'
  const summaryMessages = options.summaryMessages ?? {}, partyMessages = options.partyMessages ?? {}
  const labels: Record<PokemonSummaryPage, string> = { profile: summaryMessages[7] ?? '', stats: summaryMessages[109] ?? '', moves: summaryMessages[128] ?? '', ribbons: summaryMessages[179] ?? '' }
  for (const page of pokemonSummaryPages) {
    const tab = document.createElement('button')
    tab.type = 'button'
    tab.dataset.pokemonSummaryPage = page
    tab.setAttribute('aria-current', String(page === options.page))
    tab.textContent = labels[page]
    tab.addEventListener('click', () => options.onSelectPage(page))
    tabs.append(tab)
  }
  const previous = document.createElement('button')
  previous.type = 'button'
  previous.className = 'pokemon-summary-party-step pokemon-summary-party-previous'
  previous.dataset.pokemonSummaryParty = String((options.partySlot - 1 + options.partySize) % options.partySize)
  previous.textContent = '‹'
  previous.addEventListener('click', () => options.onSelectPartySlot(Number(previous.dataset.pokemonSummaryParty)))
  const next = document.createElement('button')
  next.type = 'button'
  next.className = 'pokemon-summary-party-step pokemon-summary-party-next'
  next.dataset.pokemonSummaryParty = String((options.partySlot + 1) % options.partySize)
  next.textContent = '›'
  next.addEventListener('click', () => options.onSelectPartySlot(Number(next.dataset.pokemonSummaryParty)))
  const identity = document.createElement('aside')
  identity.className = 'pokemon-summary-identity'
  identity.dataset.shiny = String(model.pokemon.shiny)
  const slot = document.createElement('small')
  slot.textContent = `${options.partySlot + 1} / ${options.partySize}`
  const name = document.createElement('h3')
  name.textContent = `${model.displayName}${model.genderMark ? ` ${model.genderMark}` : ''}`
  const level = document.createElement('strong')
  level.textContent = `N. ${model.level}`
  const sprite = options.createPokemonSprite()
  sprite.classList.add('pokemon-summary-sprite')
  const types = document.createElement('div')
  types.className = 'pokemon-summary-types'
  types.append(...model.typeNames.map(createTypeBadge))
  const hp = document.createElement('progress')
  hp.max = model.pokemon.stats.hp
  hp.value = model.pokemon.currentHp
  hp.setAttribute('aria-label', `PV ${model.pokemon.currentHp} sur ${model.pokemon.stats.hp}`)
  const item = document.createElement('div')
  item.className = 'pokemon-summary-item'
  const itemCopy = document.createElement('span')
  itemCopy.textContent = model.heldItemName ?? ''
  const itemIcon = options.createHeldItemIcon?.()
  item.append(...(itemIcon ? [itemIcon] : []), itemCopy)
  identity.append(slot, name, level, sprite, types, hp, ...(model.heldItemName ? [item] : []))
  const body = document.createElement('div')
  body.className = 'pokemon-summary-body'
  body.append(tabs, options.page === 'profile' ? createProfilePage(model, summaryMessages) : options.page === 'stats' ? createPokemonSummaryStatsPresentation(model, summaryMessages) : options.page === 'moves' ? createMovesPage(model, summaryMessages, partyMessages) : createRibbonsPage(model, summaryMessages))
  root.append(previous, identity, body, next)
  return root
}

export function syncPokemonSummaryPagePresentation(
  host: ParentNode,
  options: PokemonSummaryPagePresentationOptions,
): boolean {
  const root = host.querySelector<HTMLElement>('.pokemon-summary')
  const currentPage = root?.querySelector<HTMLElement>('.pokemon-summary-page')
  if (!root || !currentPage) return false
  root.dataset.summaryPage = options.page
  for (const tab of root.querySelectorAll<HTMLButtonElement>('[data-pokemon-summary-page]')) {
    tab.setAttribute('aria-current', String(tab.dataset.pokemonSummaryPage === options.page))
  }
  const summaryMessages = options.summaryMessages ?? {}, partyMessages = options.partyMessages ?? {}
  currentPage.replaceWith(options.page === 'profile'
    ? createProfilePage(options.model, summaryMessages)
    : options.page === 'stats'
      ? createPokemonSummaryStatsPresentation(options.model, summaryMessages)
      : options.page === 'moves'
        ? createMovesPage(options.model, summaryMessages, partyMessages)
        : createRibbonsPage(options.model, summaryMessages))
  return true
}
