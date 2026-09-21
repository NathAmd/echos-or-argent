import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import type { PokemonInstanceId } from '../pokemon/pokemonInstanceId'

export type HgssP2pTradePartyPickerEntry = Readonly<{
  pokemonId: PokemonInstanceId
  primaryLabel: string
  secondaryLabel: string
  heldItemLabel: string
  statsLabel: string
  current: boolean
  reserved: boolean
  pokemon: CanonicalPokemon
}>

export type HgssP2pTradePartyPickerChoice =
  | Readonly<{ kind: 'offer', pokemonId: PokemonInstanceId }>
  | Readonly<{ kind: 'withdraw' }>
  | Readonly<{ kind: 'cancel' }>

export type HgssP2pTradePartyPicker = Readonly<{
  choose: (currentPokemonId?: PokemonInstanceId) => Promise<HgssP2pTradePartyPickerChoice>
  cancel: () => void
  destroy: () => void
}>

export type HgssP2pTradePartyPickerOptions = Readonly<{
  root: HTMLElement
  readParty: () => readonly CanonicalPokemon[]
  getHeldItemName?: (itemId: number) => string | undefined
  createPokemonVisual?: (pokemon: CanonicalPokemon) => HTMLElement | undefined
  isPokemonReserved?: (pokemonId: PokemonInstanceId) => boolean
}>

export function createHgssP2pTradePartyPickerEntries(
  party: readonly CanonicalPokemon[],
  currentPokemonId: PokemonInstanceId | undefined,
  getHeldItemName: ((itemId: number) => string | undefined) = () => undefined,
  isPokemonReserved: ((pokemonId: PokemonInstanceId) => boolean) = () => false,
): readonly HgssP2pTradePartyPickerEntry[] {
  return Object.freeze(party.map((pokemon) => {
    const nickname = pokemon.nickname?.trim()
    const species = pokemon.speciesName.trim() || `#${pokemon.speciesId}`
    const { stats } = pokemon
    return Object.freeze({
      pokemonId: pokemon.instanceId,
      primaryLabel: nickname || species,
      secondaryLabel: nickname && nickname !== species ? `${species} · Niv. ${pokemon.level}` : `Niv. ${pokemon.level}`,
      heldItemLabel: pokemon.heldItemId === 0 ? '—' : getHeldItemName(pokemon.heldItemId)?.trim() || `#${pokemon.heldItemId}`,
      statsLabel: `PV ${pokemon.currentHp}/${stats.hp} · Atk ${stats.attack} · Déf ${stats.defense} · Vit ${stats.speed} · Atq.Spé ${stats.specialAttack} · Déf.Spé ${stats.specialDefense}`,
      current: pokemon.instanceId === currentPokemonId,
      reserved: isPokemonReserved(pokemon.instanceId),
      pokemon,
    })
  }))
}

function appendText(document: Document, parent: HTMLElement, className: string, value: string): HTMLElement {
  const element = document.createElement('span')
  element.className = className
  element.textContent = value
  parent.append(element)
  return element
}

/**
 * Sélecteur local : noms, sprites et objets sont reconstruits depuis la ROM
 * du joueur et ne quittent jamais ce composant.
 */
export function createHgssP2pTradePartyPicker(
  options: HgssP2pTradePartyPickerOptions,
): HgssP2pTradePartyPicker {
  const { root } = options
  const document = root.ownerDocument
  let pending: ((choice: HgssP2pTradePartyPickerChoice) => void) | undefined
  let destroyed = false

  const settle = (choice: HgssP2pTradePartyPickerChoice): void => {
    const resolve = pending
    if (!resolve) return
    pending = undefined
    root.hidden = true
    root.replaceChildren()
    resolve(choice)
  }

  const onClick = (event: Event): void => {
    const origin = event.target as Element | null
    const button = origin?.closest('[data-trade-picker-action]') as HTMLButtonElement | null
    if (!button || !root.contains(button) || button.disabled) return
    const action = button.dataset.tradePickerAction
    if (action === 'cancel') settle({ kind: 'cancel' })
    else if (action === 'withdraw') settle({ kind: 'withdraw' })
    else if (action === 'offer') {
      const pokemonId = button.dataset.pokemonId as PokemonInstanceId | undefined
      if (pokemonId) settle({ kind: 'offer', pokemonId })
    }
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (root.hidden || event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    settle({ kind: 'cancel' })
  }

  root.addEventListener('click', onClick)
  root.addEventListener('keydown', onKeyDown)
  root.classList.add('multiplayer-trade-picker')
  root.hidden = true

  return Object.freeze({
    choose(currentPokemonId) {
      if (destroyed) return Promise.reject(new Error("Le sélecteur d'échange a été détruit."))
      if (pending) settle({ kind: 'cancel' })
      const entries = createHgssP2pTradePartyPickerEntries(
        options.readParty(),
        currentPokemonId,
        options.getHeldItemName,
        options.isPokemonReserved,
      )
      const surface = document.createElement('section')
      surface.className = 'multiplayer-trade-picker-surface'
      surface.setAttribute('role', 'dialog')
      surface.setAttribute('aria-modal', 'true')
      surface.setAttribute('aria-labelledby', 'multiplayer-trade-picker-title')
      const title = document.createElement('h2')
      title.id = 'multiplayer-trade-picker-title'
      title.textContent = 'Choisir le Pokémon à proposer'
      const hint = document.createElement('p')
      hint.className = 'multiplayer-trade-picker-hint'
      hint.textContent = "L'offre reste modifiable. Toute modification annule automatiquement les deux acceptations."
      const list = document.createElement('div')
      list.className = 'multiplayer-trade-picker-list'
      if (entries.length === 0) {
        const empty = document.createElement('p')
        empty.className = 'multiplayer-trade-picker-empty'
        empty.textContent = "L'équipe est vide. Aucun échange ne peut être proposé."
        list.append(empty)
      }
      for (const entry of entries) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'multiplayer-trade-picker-entry'
        button.dataset.tradePickerAction = 'offer'
        button.dataset.pokemonId = entry.pokemonId
        button.dataset.current = String(entry.current)
        button.disabled = entry.reserved
        if (entry.current) button.setAttribute('aria-current', 'true')
        const visual = options.createPokemonVisual?.(entry.pokemon)
        if (visual) {
          visual.classList.add('multiplayer-trade-picker-visual')
          visual.setAttribute('aria-hidden', 'true')
          button.append(visual)
        }
        const copy = document.createElement('span')
        copy.className = 'multiplayer-trade-picker-copy'
        appendText(document, copy, 'multiplayer-trade-picker-primary', entry.primaryLabel)
        appendText(document, copy, 'multiplayer-trade-picker-secondary', entry.secondaryLabel)
        appendText(document, copy, 'multiplayer-trade-picker-stats', entry.statsLabel)
        appendText(document, copy, 'multiplayer-trade-picker-item', `Objet tenu : ${entry.heldItemLabel}`)
        if (entry.reserved) appendText(document, copy, 'multiplayer-trade-picker-reserved', 'Déjà réservé par une transaction')
        else if (entry.current) appendText(document, copy, 'multiplayer-trade-picker-current', 'Offre actuelle')
        button.append(copy)
        list.append(button)
      }
      const actions = document.createElement('div')
      actions.className = 'multiplayer-trade-picker-actions'
      if (currentPokemonId) {
        const withdraw = document.createElement('button')
        withdraw.type = 'button'
        withdraw.className = 'multiplayer-shell-button'
        withdraw.dataset.tradePickerAction = 'withdraw'
        withdraw.textContent = "Retirer l'offre"
        actions.append(withdraw)
      }
      const cancel = document.createElement('button')
      cancel.type = 'button'
      cancel.className = 'multiplayer-shell-button'
      cancel.dataset.tradePickerAction = 'cancel'
      cancel.textContent = 'Retour'
      actions.append(cancel)
      surface.append(title, hint, list, actions)
      root.replaceChildren(surface)
      root.hidden = false
      return new Promise<HgssP2pTradePartyPickerChoice>((resolve) => {
        pending = resolve
        window.requestAnimationFrame(() => list.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus())
      })
    },
    cancel: () => settle({ kind: 'cancel' }),
    destroy() {
      if (destroyed) return
      destroyed = true
      settle({ kind: 'cancel' })
      root.removeEventListener('click', onClick)
      root.removeEventListener('keydown', onKeyDown)
      root.classList.remove('multiplayer-trade-picker')
      root.replaceChildren()
      root.hidden = true
    },
  })
}
