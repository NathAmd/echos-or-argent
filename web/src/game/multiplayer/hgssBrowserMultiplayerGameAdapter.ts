import type { PokemonCatalog } from '../../ndsTypes'
import type { HgssItemCatalog } from '../../rom/items/itemData'
import type { HgssNpcTrade } from '../../rom/pokemon/npcTradeData'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import type { PokemonInstanceId } from '../pokemon/pokemonInstanceId'
import type { PokemonTeamPolicy } from '../pokemon/pokemonTeamPolicy'
import type { FieldScriptState } from '../scripts/fieldScriptRunner'
import type {
  BrowserMultiplayerGamePorts,
  BrowserMultiplayerTradeSelection,
} from './browserMultiplayerRuntime'
import type { HgssP2pTradeCommitResult } from './hgssP2pTradeCoordinator'
import { snapshotCanonicalPokemonForP2pTrade } from './hgssP2pTradePokemonAdapter'
import {
  createHgssP2pTradeRuntimeEscrow,
  type HgssP2pTradeRuntimeEscrow,
} from './hgssP2pTradeRuntimeEscrow'

export type HgssBrowserMultiplayerGameContext = Readonly<{
  state: FieldScriptState
  pokemonCatalog: PokemonCatalog
  uiMessageBanks?: Readonly<Record<number, Readonly<Record<number, string>>>>
  itemCatalog?: HgssItemCatalog
  npcTradeCatalog?: readonly HgssNpcTrade[]
  eggDisplayName?: string
  teamPolicy: PokemonTeamPolicy
  createPokemonVisual?: (request: Readonly<{
    speciesId: number
    form: number
    isEgg: boolean
    shiny: boolean
    gender: CanonicalPokemon['gender']
  }>) => HTMLElement | undefined
}>

export type HgssBrowserMultiplayerGameAdapterOptions = Readonly<{
  readContext: () => HgssBrowserMultiplayerGameContext | undefined
  choosePokemon: (currentPokemonId?: PokemonInstanceId) => Promise<
    | Readonly<{ kind: 'offer', pokemonId: PokemonInstanceId }>
    | Readonly<{ kind: 'withdraw' }>
    | Readonly<{ kind: 'cancel' }>
  >
  cancelPokemon?: () => void
  persistState: (state: FieldScriptState) => Promise<void> | void
  publishState: (state: FieldScriptState) => void
  reportStatus?: (message: string) => void
  reportError?: (error: Error, area: 'connection' | 'social' | 'session' | 'trade') => void
}>

export type HgssBrowserMultiplayerGameAdapter = Readonly<{
  game: BrowserMultiplayerGamePorts
  escrow: HgssP2pTradeRuntimeEscrow
}>

function requireContext(
  readContext: HgssBrowserMultiplayerGameAdapterOptions['readContext'],
): HgssBrowserMultiplayerGameContext {
  const context = readContext()
  if (!context || !context.state.pokemonRuntime) {
    throw new Error("La partie locale et ses ressources ROM doivent être prêtes pour l'échange.")
  }
  return context
}

function findPartyPokemon(state: FieldScriptState, pokemonId: PokemonInstanceId): CanonicalPokemon {
  const pokemon = state.party.members.find(({ instanceId }) => instanceId === pokemonId)
  if (!pokemon) throw new Error("Le Pokémon sélectionné n'est plus dans l'équipe locale.")
  return pokemon
}

function localSpeciesName(catalog: PokemonCatalog, speciesId: number): string {
  return catalog.speciesNames[speciesId]?.trim() || `#${speciesId}`
}

export function formatHgssP2pTradeCommitMessage(
  result: HgssP2pTradeCommitResult,
  catalog: PokemonCatalog,
): string {
  const received = localSpeciesName(catalog, result.receivedSpeciesId)
  const destination = result.destination.kind === 'party'
    ? `équipe · emplacement ${result.destination.slot + 1}`
    : `PC · boîte ${result.destination.box + 1}, emplacement ${result.destination.slot + 1}`
  if (result.evolution) {
    const source = localSpeciesName(catalog, result.evolution.sourceSpeciesId)
    const target = localSpeciesName(catalog, result.evolution.targetSpeciesId)
    return `Échange terminé : ${received} reçu dans ${destination}. ${source} a évolué en ${target}. Sauvegarde mise à jour.`
  }
  return result.status === 'already-committed'
    ? `Échange déjà appliqué et vérifié : ${received} dans ${destination}.`
    : `Échange terminé : ${received} reçu dans ${destination}. Sauvegarde mise à jour.`
}

/** Relie le runtime réseau générique à l'état HGSS local, jamais au serveur. */
export function createHgssBrowserMultiplayerGameAdapter(
  options: HgssBrowserMultiplayerGameAdapterOptions,
): HgssBrowserMultiplayerGameAdapter {
  const dynamicTeamPolicy: PokemonTeamPolicy = Object.freeze({
    vetoBattleEligibility: (intent) => requireContext(options.readContext).teamPolicy.vetoBattleEligibility(intent),
    vetoPartyMutation: (intent) => requireContext(options.readContext).teamPolicy.vetoPartyMutation(intent),
  })
  const initialContext = requireContext(options.readContext)
  const escrow = createHgssP2pTradeRuntimeEscrow({
    getState: () => requireContext(options.readContext).state,
    persistState: options.persistState,
    publishState: options.publishState,
    teamPolicy: dynamicTeamPolicy,
    ...(initialContext.eggDisplayName ? { eggDisplayName: initialContext.eggDisplayName } : {}),
  })
  const presentationResources: BrowserMultiplayerGamePorts['presentationResources'] = Object.freeze({
    get pokemonCatalog() { return requireContext(options.readContext).pokemonCatalog },
    get itemCatalog() { return requireContext(options.readContext).itemCatalog },
    get npcTradeCatalog() { return requireContext(options.readContext).npcTradeCatalog },
    get eggDisplayName() { return requireContext(options.readContext).eggDisplayName },
    createPokemonVisual: (request) => requireContext(options.readContext).createPokemonVisual?.(request),
  })
  const chooseLocalTradeOffer = async (
    request: Readonly<{ currentPokemonId?: PokemonInstanceId }>,
  ): Promise<BrowserMultiplayerTradeSelection> => {
    const choice = await options.choosePokemon(request.currentPokemonId)
    if (choice.kind !== 'offer') return choice
    if (escrow.isPokemonReserved(choice.pokemonId)) {
      throw new Error("Ce Pokémon est déjà réservé par une transaction d'échange.")
    }
    const context = requireContext(options.readContext)
    const pokemon = findPartyPokemon(context.state, choice.pokemonId)
    return {
      kind: 'offer',
      pokemon: snapshotCanonicalPokemonForP2pTrade(pokemon, {
        catalog: context.pokemonCatalog,
        trainer: context.state.pokemonRuntime!.trainer,
        npcTradeCatalog: context.npcTradeCatalog,
        itemCatalog: context.itemCatalog,
        ...(context.eggDisplayName ? { eggDisplayName: context.eggDisplayName } : {}),
      }),
    }
  }
  const game: BrowserMultiplayerGamePorts = Object.freeze({
    escrow,
    presentationResources,
    chooseLocalTradeOffer,
    cancelLocalTradeOfferSelection: options.cancelPokemon,
    onTradeCommitted: (result) => {
      const context = requireContext(options.readContext)
      options.reportStatus?.(formatHgssP2pTradeCommitMessage(result, context.pokemonCatalog))
    },
    onTradeRecoveryRequired: () => {
      options.reportStatus?.("Reprise d'échange interrompue : la sauvegarde locale reste l'autorité.")
    },
    reportError: (error, area) => {
      options.reportError?.(error, area)
      options.reportStatus?.(`Multijoueur : ${error.message}`)
    },
  })
  return Object.freeze({ game, escrow })
}
