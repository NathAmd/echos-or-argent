import type { PokemonCatalog } from '../../ndsTypes'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import { isHgssBattleBallItemId } from '../../rom/battle/battleBallSprites'

const standardBallRates = [20, 15, 10, 15] as const
const moonBallSpecies = new Set([29, 30, 31, 32, 33, 34, 173, 35, 36, 174, 39, 40, 300, 301])

export type HgssCaptureContext = {
  /** Identifiant d'objet ROM, tel que `ctx->itemTemp` dans le calcul natif. */
  itemId: number
  /** Absent dans les combats Safari, qui n'envoient aucun Pokemon joueur. */
  player?: CanonicalPokemon
  target: CanonicalPokemon
  catalog: PokemonCatalog
  turnCount: number
  /** Taux deja transforme par un mode de combat natif (Safari, concours...). */
  baseCatchRateOverride?: number
  alreadyCaught?: boolean
  terrain?: 'normal' | 'water' | 'cave'
  isNight?: boolean
  isFishing?: boolean
  targetWeightTenthsKg?: number
}

export type HgssCaptureResult = {
  caught: boolean
  shakes: 0 | 1 | 2 | 3 | 4
  modifiedCatchRate: number
}

/** Reproduction de BattleSystem_CalculateBallShakes (overlay 12 HGSS). */
export function calculateHgssBallShakes(context: HgssCaptureContext, rng: HgssLcrng): HgssCaptureResult {
  const targetPersonal = context.catalog.personalData[context.target.speciesId]
  if (!targetPersonal) throw new Error(`Le taux de capture ROM de ${context.target.speciesName} est absent.`)
  let catchRate = context.baseCatchRateOverride ?? targetPersonal.catchRate
  let ballMultiplier = 10
  const types = targetPersonal.types

  if (context.itemId >= 2 && context.itemId <= 5) {
    ballMultiplier = standardBallRates[context.itemId - 2]!
  } else {
    switch (context.itemId) {
      case 6: if (types.includes(11) || types.includes(6)) ballMultiplier = 30; break // Filet
      case 7: if (context.terrain === 'water') ballMultiplier = 35; break
      case 8: if (context.target.level < 40) ballMultiplier = Math.max(10, 40 - context.target.level); break
      case 9: if (context.alreadyCaught) ballMultiplier = 30; break
      case 10: ballMultiplier = Math.min(40, context.turnCount + 10); break
      case 13: if (context.isNight || context.terrain === 'cave') ballMultiplier = 35; break
      case 15: if (context.turnCount < 1) ballMultiplier = 40; break
      case 492: if (targetPersonal.baseStats.speed >= 100) catchRate *= 4; break
      case 493: {
        if (!context.player) throw new Error('Le Pokemon joueur est requis pour utiliser une Niveau Ball.')
        const attackerLevel = context.player.level
        const defenderLevel = context.target.level
        catchRate *= attackerLevel <= defenderLevel ? 1 : attackerLevel / 2 <= defenderLevel ? 2 : attackerLevel / 4 <= defenderLevel ? 4 : 8
        break
      }
      case 494: if (context.isFishing) catchRate *= 3; break
      case 495: {
        if (context.targetWeightTenthsKg === undefined) throw new Error('Le poids ROM est requis pour utiliser une Masse Ball.')
        const weight = context.targetWeightTenthsKg
        if (weight >= 4096) catchRate += 40
        else if (weight >= 3072) catchRate += 30
        else if (weight >= 2048) catchRate += 20
        else if (catchRate < 1024) catchRate -= 20 // bug officiel HGSS conservé
        break
      }
      case 496:
        if (!context.player) throw new Error('Le Pokemon joueur est requis pour utiliser une Love Ball.')
        if (context.player.speciesId === context.target.speciesId && context.player.gender !== context.target.gender) catchRate *= 8
        break
      case 498: if (moonBallSpecies.has(context.target.speciesId)) catchRate *= 4; break
      case 499: ballMultiplier = 15; break
    }
    catchRate = Math.max(1, Math.min(255, catchRate))
  }

  const maxHpTimes3 = context.target.stats.hp * 3
  const lostHp = maxHpTimes3 - context.target.currentHp * 2
  let modifiedCatchRate = Math.floor((Math.floor(catchRate * ballMultiplier / 10) * lostHp) / maxHpTimes3)
  const status = context.target.status
  if ((status & (0x7 | 0x20)) !== 0) modifiedCatchRate *= 2
  if ((status & (0x8 | 0x10 | 0x40 | 0x80)) !== 0) modifiedCatchRate = Math.floor(modifiedCatchRate * 15 / 10)

  let shakes = 0
  if (modifiedCatchRate >= 255 || context.itemId === 1) shakes = 4
  else {
    const firstRoot = Math.floor(Math.sqrt(Math.floor(0xff0000 / Math.max(1, modifiedCatchRate))))
    const secondRoot = Math.floor(Math.sqrt(firstRoot))
    const shakeProbability = Math.floor(0xffff0 / Math.max(1, secondRoot))
    while (shakes < 4 && rng.nextU16() < shakeProbability) shakes += 1
  }
  return { caught: shakes === 4, shakes: shakes as 0 | 1 | 2 | 3 | 4, modifiedCatchRate }
}

export function isHgssBallItem(itemId: number): boolean {
  return isHgssBattleBallItemId(itemId)
}
