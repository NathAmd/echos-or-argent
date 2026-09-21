import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'

/** Projection DOM commune aux jauges d'équipe simple et double. */
export function renderBattlePartyGauge(
  element: HTMLElement,
  members: readonly CanonicalPokemon[],
  activeSlots: ReadonlySet<number> = new Set(),
): void {
  const available = members.filter((pokemon) => pokemon.currentHp > 0).length
  const defeated = members.filter((pokemon) => pokemon.currentHp <= 0).length
  const summary = document.createElement('small')
  summary.textContent = `${available} dispo. · ${defeated} K.O.`
  const markers = Array.from({ length: 6 }, (_, index) => {
    const marker = document.createElement('span')
    const pokemon = members[index]
    const name = pokemon?.nickname ?? pokemon?.speciesName
    marker.dataset.state = !pokemon ? 'empty' : pokemon.currentHp <= 0 ? 'fainted' : activeSlots.has(index) ? 'active' : 'ready'
    marker.title = !pokemon
      ? 'Emplacement vide'
      : `${name} · ${pokemon.currentHp > 0 ? activeSlots.has(index) ? 'au combat' : 'disponible' : 'K.O.'}`
    return marker
  })
  element.dataset.available = String(available)
  element.dataset.defeated = String(defeated)
  element.setAttribute('aria-label', `${available} Pokémon disponibles, ${defeated} K.O.`)
  element.replaceChildren(summary, ...markers)
}
