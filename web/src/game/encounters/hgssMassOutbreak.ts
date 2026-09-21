export type HgssMassOutbreakMethod = 'land' | 'surf' | 'fishing'

export type HgssMassOutbreakContext = {
  active: boolean
  /** `Roamers_GetRand(save, 2)`, synchronisé sur le groupe ami natif. */
  randomValue: number
}

type HgssMassOutbreakLocation = readonly [mapId: number, method: HgssMassOutbreakMethod]

/** `sSwarmMapLUT` de `unk_02097F6C.c`, dans son ordre ROM exact. */
export const hgssMassOutbreakLocations: readonly HgssMassOutbreakLocation[] = [
  [9, 'land'], [11, 'land'], [17, 'land'], [20, 'fishing'], [21, 'land'],
  [91, 'surf'], [36, 'fishing'], [29, 'land'], [31, 'surf'], [38, 'land'],
  [39, 'land'], [42, 'land'], [46, 'fishing'], [47, 'land'], [151, 'land'],
  [119, 'land'], [176, 'land'], [147, 'land'], [54, 'surf'], [73, 'fishing'],
] as const

export function resolveHgssMassOutbreak(
  context: HgssMassOutbreakContext | undefined,
): HgssMassOutbreakLocation | undefined {
  if (!context?.active) return undefined
  if (!Number.isInteger(context.randomValue) || context.randomValue < 0 || context.randomValue > 0xffff_ffff) {
    throw new Error(`La valeur quotidienne d’essaim HGSS ${context.randomValue} est invalide.`)
  }
  return hgssMassOutbreakLocations[context.randomValue % hgssMassOutbreakLocations.length]
}

export function isHgssMassOutbreakActiveForMap(
  context: HgssMassOutbreakContext | undefined,
  mapId: number,
  method: HgssMassOutbreakMethod,
): boolean {
  const outbreak = resolveHgssMassOutbreak(context)
  return outbreak?.[0] === mapId && outbreak[1] === method
}

export function resolveHgssMassOutbreakAnnouncement(
  context: HgssMassOutbreakContext | undefined,
  maps: readonly OpeningMapPreview[],
  encounterCatalog: readonly HgssWildEncounterData[],
): { mapId: number, speciesId: number } | undefined {
  const outbreak = resolveHgssMassOutbreak(context)
  if (!outbreak) return undefined
  const [mapId, method] = outbreak
  const map = maps.find(({ id }) => id === mapId)
  const encounters = map && map.header.wildEncounterBank !== 0xff
    ? encounterCatalog[map.header.wildEncounterBank]
    : undefined
  if (!encounters) throw new Error(`La table ROM de l’essaim de la carte ${mapId} est absente.`)
  const speciesId = method === 'land'
    ? encounters.swarm.landSpeciesId
    : method === 'surf'
      ? encounters.swarm.surfingSpeciesId
      : encounters.swarm.fishingSpeciesId
  if (speciesId === 0) throw new Error(`L’espèce ROM de l’essaim de la carte ${mapId} est absente.`)
  return { mapId, speciesId }
}
import type { OpeningMapPreview } from '../../ndsTypes'
import type { HgssWildEncounterData } from '../../rom/encounters/wildEncounterData'
