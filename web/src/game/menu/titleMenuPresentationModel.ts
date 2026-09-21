import type { RomInventory } from '../../ndsTypes'
import type { RestoredHgssSaveState } from '../save/hgssSaveState'
import type { HgssBrowserSaveKind, HgssBrowserSaveSlot, HgssBrowserSaveSlotDeletionToken } from '../save/hgssSaveStorage'
import type { TitleMenuState } from './titleMenuController'
import type { TitleMenuItemPresentation, TitleMenuPresentationModel } from '../ui/titleMenuPresentation'

export type TitleMenuSavePreview = {
  restored: RestoredHgssSaveState
  savedAt: string
  kind: HgssBrowserSaveKind
  deletionToken: HgssBrowserSaveSlotDeletionToken
}

export type TitleMenuCorruptSavePreview = {
  reason: string
  deletionToken: HgssBrowserSaveSlotDeletionToken
}

type TitleMenuMapPreview = Pick<RomInventory['resolvedMapCatalog']['maps'][number], 'id' | 'label'>

/** Sous-ensemble ROM réellement requis par ce modèle pur. */
export type TitleMenuPresentationInventory = {
  uiMessageBanks: RomInventory['uiMessageBanks']
  resolvedMapCatalog: {
    maps: readonly TitleMenuMapPreview[]
  }
}

// Keep the icon callback structurally typed without coupling this menu model to
// the renderer's concrete canvas implementation.
type PokemonPreview = RestoredHgssSaveState['field']['party']['members'][number]
type PokemonIconFactory = (
  speciesId: PokemonPreview['speciesId'],
  form: PokemonPreview['form'],
  isEgg: PokemonPreview['isEgg'],
  shiny: PokemonPreview['shiny'],
  gender: PokemonPreview['gender'],
) => HTMLElement | undefined

function formatPlayTime({ hours, minutes, seconds }: RestoredHgssSaveState['igt']): string {
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function createSaveStats(save: TitleMenuSavePreview, locales: Intl.LocalesArgument): TitleMenuItemPresentation['stats'] {
  const { restored } = save
  const seen = restored.field.pokedex.seenSpeciesIds.size
  const caught = restored.field.pokedex.caughtSpeciesIds.size
  return [
    { label: 'Temps de jeu', value: formatPlayTime(restored.igt) },
    { label: 'Badges', value: `${restored.field.badges.size} / 16` },
    { label: 'Pokédex', value: restored.field.pokedex.enabled ? `${caught} attrapés · ${seen} vus` : 'Non obtenu' },
    { label: 'Argent', value: `${new Intl.NumberFormat(locales).format(restored.field.money)} ₽` },
  ]
}

export function createTitleMenuPresentationModel(options: {
  state: TitleMenuState
  saves: ReadonlyMap<HgssBrowserSaveSlot, TitleMenuSavePreview>
  corruptSaves?: ReadonlyMap<HgssBrowserSaveSlot, TitleMenuCorruptSavePreview>
  inventory: TitleMenuPresentationInventory
  createPokemonIcon: PokemonIconFactory
  locales?: Intl.LocalesArgument
}): TitleMenuPresentationModel {
  const { state, saves, corruptSaves = new Map(), inventory, createPokemonIcon, locales = 'fr-FR' } = options
  const titleMessages = inventory.uiMessageBanks[442] ?? {}
  const items = state.items.map((item): TitleMenuItemPresentation => {
    if (item.kind === 'action') {
      return {
        id: item.id,
        kind: 'action',
        number: 'NG+',
        occupied: false,
        name: 'NOUVELLE PARTIE+',
        location: 'Nouvelle sauvegarde séparée',
        kicker: 'MODE DÉBLOQUÉ',
        progress: 'Combinez vos options sans modifier la partie terminée.',
        party: [],
        stats: [
          { label: 'Sauvegarde source', value: 'Toujours conservée' },
          { label: 'Options', value: 'Cumulables' },
        ],
        actions: [{
          id: 'new-game-plus',
          label: 'Configurer le New Game+',
          detail: 'Choisir la source, le nouvel emplacement et les modules',
          tone: 'primary',
        }],
      }
    }
    const save = saves.get(item.slot)
    const corrupt = corruptSaves.get(item.slot)
    const number = String(item.slot).padStart(2, '0')
    if (!save && corrupt) {
      return {
        id: item.id,
        kind: 'save-slot',
        number,
        occupied: true,
        corrupted: true,
        name: 'SAUVEGARDE CORROMPUE',
        location: 'Données conservées',
        kicker: `EMPLACEMENT ILLISIBLE · ${number}`,
        progress: corrupt.reason,
        party: [],
        stats: [
          { label: 'État', value: 'Illisible' },
          { label: 'Protection', value: 'Aucune nouvelle partie ne peut écraser ces données' },
        ],
        actions: [{
          id: 'delete',
          label: 'Supprimer',
          detail: `Supprimer explicitement les données corrompues de l’emplacement ${item.slot}`,
          tone: 'danger',
          slot: item.slot,
        }],
      }
    }
    if (!save) {
      return {
        id: item.id,
        kind: 'save-slot',
        number,
        occupied: false,
        name: titleMessages[1] ?? '',
        location: '',
        kicker: `${titleMessages[1] ?? ''} · ${number}`,
        progress: '',
        party: [],
        stats: [],
        actions: [
          {
            id: 'new-game',
            label: 'Nouvelle partie',
            detail: '',
            tone: 'primary',
            slot: item.slot,
          },
          {
            id: 'import',
            label: 'Importer un backup',
            detail: 'Choisir un fichier PokeMaster JSON sans écraser un autre slot',
            tone: 'secondary',
            slot: item.slot,
          },
        ],
      }
    }
    const mapLabel = inventory.resolvedMapCatalog.maps.find(({ id }) => id === save.restored.world.mapId)?.label
      ?? String(save.restored.world.mapId)
    const partyLabel = inventory.uiMessageBanks[196]?.[1]?.trim() || 'Équipe'
    return {
      id: item.id,
      kind: 'save-slot',
      number,
      occupied: true,
      name: save.restored.profile.name,
      location: mapLabel,
      kicker: save.restored.newGamePlus ? `NOUVELLE PARTIE+ · ${number}` : `${titleMessages[0] ?? ''} · ${number}`,
      progress: '',
      savedAt: {
        dateTime: save.savedAt,
        label: `${save.kind === 'auto' ? 'Auto' : 'Manuelle'} · ${new Intl.DateTimeFormat(locales, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(save.savedAt))}`,
      },
      partyLabel,
      party: save.restored.field.party.members.map((pokemon) => ({
        key: [pokemon.speciesId, pokemon.form, Number(pokemon.isEgg), Number(pokemon.shiny), pokemon.gender, pokemon.level, pokemon.nickname ?? pokemon.speciesName].join(':'),
        title: `${pokemon.nickname ?? pokemon.speciesName} · Niv. ${pokemon.level}`,
        createIcon: () => createPokemonIcon(pokemon.speciesId, pokemon.form, pokemon.isEgg, pokemon.shiny, pokemon.gender),
      })),
      stats: createSaveStats(save, locales),
      actions: [
        {
          id: 'continue',
          label: 'Continuer',
          detail: '',
          tone: 'primary',
          slot: item.slot,
        },
        {
          id: 'export',
          label: 'Exporter un backup',
          detail: 'Enregistrer une copie portable JSON',
          tone: 'secondary',
          slot: item.slot,
        },
        {
          id: 'delete',
          label: 'Supprimer',
          detail: '',
          tone: 'danger',
          slot: item.slot,
        },
      ],
    }
  })
  return {
    eyebrow: titleMessages[13] ?? '',
    heading: titleMessages[saves.size + corruptSaves.size > 0 ? 0 : 1] ?? '',
    cursor: state.cursor,
    items,
  }
}
