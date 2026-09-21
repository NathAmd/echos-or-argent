import type { PokemonCatalog } from '../../ndsTypes'
import type { HgssItemCatalog } from '../../rom/items/itemData'
import type { HgssNpcTrade } from '../../rom/pokemon/npcTradeData'
import type { MultiplayerTradeOfferPreview } from '../ui/multiplayerUiShell'
import type { HgssP2pTradeOfferPreview } from './hgssP2pTradeProtocol'

export type HgssP2pTradeOfferPresentationResources = Readonly<{
  pokemonCatalog: PokemonCatalog
  itemCatalog?: HgssItemCatalog
  npcTradeCatalog?: readonly HgssNpcTrade[]
  eggDisplayName?: string
  createPokemonVisual?: (request: Readonly<{
    speciesId: number
    form: number
    isEgg: boolean
    shiny: boolean
    gender: HgssP2pTradeOfferPreview['gender']
  }>) => HTMLElement | undefined
}>

function requireLocalLabel(value: string | undefined, fallback: string): string {
  return value && value.trim().length > 0 ? value : fallback
}

function resolveNickname(
  preview: HgssP2pTradeOfferPreview,
  resources: HgssP2pTradeOfferPresentationResources,
): string | undefined {
  if (preview.nicknameSource === 'user-text') return preview.nickname
  if (preview.nicknameLocalRef === 0) return resources.eggDisplayName ?? 'ŒUF'
  if (preview.nicknameLocalRef !== undefined) {
    return resources.npcTradeCatalog?.find(({ tradeId }) => tradeId === preview.nicknameLocalRef! - 1)?.nickname
  }
  return undefined
}

/** Convertit l'aperçu numérique en libellés et assets strictement locaux. */
export function presentHgssP2pTradeOffer(
  preview: HgssP2pTradeOfferPreview,
  resources: HgssP2pTradeOfferPresentationResources,
): MultiplayerTradeOfferPreview {
  const speciesName = requireLocalLabel(
    resources.pokemonCatalog.speciesNames[preview.speciesId],
    `#${preview.speciesId}`,
  )
  const nickname = resolveNickname(preview, resources)
  const heldItem = preview.heldItemId === 0
    ? '—'
    : requireLocalLabel(resources.itemCatalog?.items[preview.heldItemId]?.name, `#${preview.heldItemId}`)
  const moveNames = preview.moveIds.map((moveId) => requireLocalLabel(
    resources.pokemonCatalog.moveNames[moveId],
    `#${moveId}`,
  ))
  const { stats } = preview
  return Object.freeze({
    primaryLabel: nickname ?? speciesName,
    secondaryLabel: nickname && nickname !== speciesName
      ? `${speciesName} · Niv. ${preview.level}`
      : `Niv. ${preview.level}`,
    details: Object.freeze([
      Object.freeze({ label: 'PV', value: `${preview.currentHp}/${preview.maximumHp}` }),
      Object.freeze({ label: 'Statistiques', value: `Atk ${stats.attack} · Déf ${stats.defense} · Vit ${stats.speed} · Atq.Spé ${stats.specialAttack} · Déf.Spé ${stats.specialDefense}` }),
      Object.freeze({ label: 'Objet tenu', value: heldItem }),
      Object.freeze({ label: 'Capacités', value: moveNames.length > 0 ? moveNames.join(' · ') : '—' }),
      ...(preview.shiny ? [Object.freeze({ label: 'Chromatique', value: 'Oui' })] : []),
      ...(preview.isEgg ? [Object.freeze({ label: 'Œuf', value: 'Oui' })] : []),
    ]),
    ...(resources.createPokemonVisual ? {
      createVisual: () => resources.createPokemonVisual?.({
        speciesId: preview.speciesId,
        form: preview.form,
        isEgg: preview.isEgg,
        shiny: preview.shiny,
        gender: preview.gender,
      }),
    } : {}),
  })
}
