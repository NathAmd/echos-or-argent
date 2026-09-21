/** Données du premier slot de l'équipe, comme le `leadMon` natif HGSS. */
export type HgssEncounterRateLead = {
  abilityId: number
  heldItemId: number
  isEgg: boolean
}

export type HgssEncounterRateContext = {
  lead?: HgssEncounterRateLead
  /** Valeur WEATHER_* sauvegardée par le terrain ; WEATHER_SNOW vaut 5. */
  weatherType?: number
  /** 0 : aucune, 1 : Flûte Noire, 2 : Flûte Blanche. */
  flutePlayed?: 0 | 1 | 2
}

const increasingEncounterAbilities = new Set([35, 71, 99]) // Illuminate, Piège, Annule Garde
const reducingEncounterAbilities = new Set([1, 73, 95]) // Puanteur, Écran Fumée, Pied Véloce

/**
 * Port exact de l'ordre natif HGSS : talent, flûte, puis objet tenu.
 * Les affectations par pointeur sont des `u8`, donc chaque étape rabat à 8 bits.
 */
export function applyHgssLandOrSurfEncounterRateModifiers(
  encounterRate: number,
  context: HgssEncounterRateContext,
): number {
  if (!Number.isInteger(encounterRate) || encounterRate < 0 || encounterRate > 0xff) {
    throw new Error(`Le taux de rencontre HGSS ${encounterRate} est invalide.`)
  }
  const { lead } = context
  let rate = encounterRate

  if (lead && !lead.isEgg) {
    if (increasingEncounterAbilities.has(lead.abilityId)) rate *= 2
    else if (lead.abilityId === 81 && context.weatherType === 5) rate = Math.floor(rate / 2)
    else if (reducingEncounterAbilities.has(lead.abilityId)) rate = Math.floor(rate / 2)
    if (rate > 100) rate = 100
  }
  rate &= 0xff

  if (context.flutePlayed === 1) rate = Math.floor(rate / 2)
  else if (context.flutePlayed === 2) rate = (rate + Math.floor(rate / 2)) & 0xff

  if (lead?.heldItemId === 224 || lead?.heldItemId === 320) {
    rate = Math.floor(rate * 2 / 3) & 0xff
  }
  return rate
}
