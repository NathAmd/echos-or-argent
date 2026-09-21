import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { HGSS_POKE_BALL_ID, isHgssBattleBallId } from '../../rom/battle/battleBallSprites'

/**
 * Projection minimale acceptée par toutes les entrées de combat. Le champ est
 * optionnel pour que les anciennes données restaurées restent présentables.
 */
export type HgssBattleSendOutPokemon = Readonly<Partial<Pick<CanonicalPokemon, 'ballId'>>>

/**
 * Sélectionne la ressource d'envoi à partir de l'identifiant interne du PK4.
 * Les Balls Fargas y sont déjà normalisées en 17..24 : un identifiant d'objet
 * 492..499 ne doit donc jamais être reconverti à cette frontière.
 *
 * Cette fonction ne lève pas d'erreur. Une donnée ancienne, absente ou hors
 * de la LUT 1..24 utilise la Poké Ball native, ce qui protège les introductions
 * simples/doubles et tous les remplacements avec la même règle.
 */
export function resolveHgssBattleSendOutBallId(
  pokemon: HgssBattleSendOutPokemon | null | undefined,
): number {
  return isHgssBattleBallId(pokemon?.ballId) ? pokemon.ballId : HGSS_POKE_BALL_ID
}
