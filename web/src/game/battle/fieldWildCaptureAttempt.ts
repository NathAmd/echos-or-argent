import type { PokemonCatalog } from '../../ndsTypes'
import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import {
  commitPreparedPokemonAcquisition,
  preparePokemonAcquisition,
  type PokemonAcquisitionResult,
} from '../pokemon/pokemonAcquisition'
import type { PokemonParty } from '../pokemon/pokemonParty'
import type { PokemonStorage } from '../pokemon/pokemonStorage'
import { basePokemonTeamPolicy, type PokemonTeamPolicy } from '../pokemon/pokemonTeamPolicy'
import { cloneCanonicalPokemon, type CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { takeBagItem } from '../items/bagInventory'
import { resolveHgssBallIdFromItemId } from '../../rom/battle/battleBallSprites'
import { calculateHgssBallShakes, isHgssBallItem, type HgssCaptureResult } from './hgssCapture'

export type FieldWildCaptureAttemptOptions = Readonly<{
  item: Readonly<{ itemId: number, name: string }>
  player: CanonicalPokemon
  target: CanonicalPokemon
  party: PokemonParty
  storage: PokemonStorage
  inventory: Map<number, number>
  catalog: PokemonCatalog
  rng: HgssLcrng
  turnCount: number
  alreadyCaught: boolean
  isNight: boolean
  terrain: 'normal' | 'water' | 'cave'
  isFishing?: boolean
  targetWeightTenthsKg?: number
  teamPolicy?: PokemonTeamPolicy
}>

export type FieldWildCaptureAttemptResult =
  | Readonly<{ kind: 'blocked', reason: string }>
  | Readonly<{ kind: 'escaped-ball', caught: CanonicalPokemon, capture: HgssCaptureResult }>
  | Readonly<{
      kind: 'caught'
      caught: CanonicalPokemon
      capture: HgssCaptureResult
      acquisition: Extract<PokemonAcquisitionResult, { kind: 'party' | 'storage' }>
    }>

/**
 * Transaction de capture commune aux combats sauvages simples et 2v1.
 * Elle réserve d'abord l'Équipe/PC, consomme ensuite une seule Ball, puis ne
 * publie le Pokémon capturé que si le calcul HGSS a réussi.
 */
export function attemptFieldWildCapture(
  options: FieldWildCaptureAttemptOptions,
): FieldWildCaptureAttemptResult {
  const { item } = options
  if (!isHgssBallItem(item.itemId)) throw new Error(`${item.name} n’est pas une Ball HGSS.`)
  const caught = cloneCanonicalPokemon(options.target)
  caught.ballId = resolveHgssBallIdFromItemId(item.itemId)
  if (item.itemId === 14) { caught.currentHp = caught.stats.hp; caught.status = 0 }
  if (item.itemId === 497) caught.friendship = 200
  const plan = preparePokemonAcquisition(
    options.party,
    options.storage,
    caught,
    { reason: 'capture' },
    options.teamPolicy ?? basePokemonTeamPolicy,
  )
  if (plan.kind === 'full') return Object.freeze({ kind: 'blocked', reason: "L'Équipe et toutes les Boîtes PC sont pleines." })
  if (plan.kind === 'blocked') return Object.freeze({ kind: 'blocked', reason: plan.reason })
  const capture = calculateHgssBallShakes({
    itemId: item.itemId,
    player: options.player,
    target: options.target,
    catalog: options.catalog,
    turnCount: options.turnCount,
    alreadyCaught: options.alreadyCaught,
    isNight: options.isNight,
    terrain: options.terrain,
    isFishing: options.isFishing,
    targetWeightTenthsKg: options.targetWeightTenthsKg,
  }, options.rng)
  if (!takeBagItem(options.inventory, item.itemId, 1)) {
    throw new Error(`${item.name} a disparu du Sac avant son utilisation.`)
  }
  if (!capture.caught) return Object.freeze({ kind: 'escaped-ball', caught, capture })
  const acquisition = commitPreparedPokemonAcquisition(options.party, options.storage, caught, plan)
  if (acquisition.kind === 'full' || acquisition.kind === 'blocked') {
    throw new Error(acquisition.kind === 'blocked'
      ? acquisition.reason
      : 'Le Pokémon capturé ne peut rejoindre ni l’Équipe ni le PC.')
  }
  return Object.freeze({ kind: 'caught', caught, capture, acquisition })
}
