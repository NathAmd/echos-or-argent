export type HgssDexEvaluation = {
  messageId: number
  fanfareSequenceId: 1194 | 1199
  ownedCount: number
  complete: boolean
}

const nationalMythicalSpecies = new Set([151, 251, 385, 386, 489, 490, 491, 492, 493])
const johtoMythicalSpecies = new Set([151, 251])

const johtoThresholds = [9, 19, 34, 49, 64, 79, 94, 109, 124, 139, 154, 169, 184, 199, 214, 229, 244, 253] as const
const nationalThresholds = [100, 150, 200, 250, 300, 350, 400, 435, 465, 475, 483] as const

/** Reproduction de GetOakJohtoDexRating/GetOakNationalDexRating. */
export function evaluateHgssPokedex(
  caughtSpeciesIds: ReadonlySet<number>,
  national: boolean,
  gender: 'male' | 'female',
  johtoDexNumbers?: readonly number[],
): HgssDexEvaluation {
  if (!national && !johtoDexNumbers) throw new Error("La table ROM d'index du Pokédex de Johto est absente.")
  const ownedCount = [...caughtSpeciesIds].reduce((count, speciesId) => {
    if (speciesId < 1 || speciesId > 493) return count
    if (national) return count + (nationalMythicalSpecies.has(speciesId) ? 0 : 1)
    return count + ((johtoDexNumbers![speciesId] ?? 0) !== 0 && !johtoMythicalSpecies.has(speciesId) ? 1 : 0)
  }, 0)
  const thresholds = national ? nationalThresholds : johtoThresholds
  const ratingIndex = thresholds.findIndex((maximum) => ownedCount <= maximum)
  if (ratingIndex >= 0) {
    return {
      messageId: (national ? 46 : 28) + ratingIndex,
      fanfareSequenceId: 1194,
      ownedCount,
      complete: false,
    }
  }
  return {
    messageId: national
      ? (gender === 'male' ? 24 : 25)
      : (gender === 'male' ? 22 : 23),
    fanfareSequenceId: 1199,
    ownedCount,
    complete: true,
  }
}
