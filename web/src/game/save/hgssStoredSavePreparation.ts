import {
  createHgssSaveState,
  type RestoredHgssSaveState,
} from './hgssSaveState'
import {
  hgssDataOnlySaveAuthority,
  type HgssDataOnlySaveDocument,
} from './hgssDataOnlySaveDocument'

export type { HgssDataOnlySaveDocument } from './hgssDataOnlySaveDocument'

/** Façade bornée pour les formats portables qui doivent revalider un document. */
export function decodeHgssStoredDataOnlySave(value: unknown): HgssDataOnlySaveDocument {
  return hgssDataOnlySaveAuthority.decode(value)
}

/** La provenance d'un document émis localement reste vérifiée par l'autorité privée. */
export function ownsHgssStoredDataOnlySave(value: unknown): value is HgssDataOnlySaveDocument {
  return hgssDataOnlySaveAuthority.owns(value)
}

export type PreparedHgssStoredSave = Readonly<{
  document: HgssDataOnlySaveDocument
  restored: RestoredHgssSaveState
  migrationRequired: boolean
}>

/**
 * Prépare une valeur relue du Storage sans le modifier. Le format canonique
 * passe par le décodeur exact; le format legacy est d'abord résolu avec les
 * ressources ROM locales fournies par l'hôte, puis reprojeté data-only.
 */
export function prepareHgssStoredSave(
  value: unknown,
  gameCode: string,
  restoreWithLocalRom: (value: unknown) => RestoredHgssSaveState,
): PreparedHgssStoredSave {
  let canonical: HgssDataOnlySaveDocument | undefined
  try {
    canonical = hgssDataOnlySaveAuthority.decode(value)
  } catch {
    // La restauration compatible legacy ci-dessous est volontairement
    // distincte : une erreur ROM sur un document canonique ne doit jamais
    // déclencher sa réécriture comme s'il s'agissait d'une ancienne save.
  }
  if (canonical) {
    return Object.freeze({
      document: canonical,
      restored: restoreWithLocalRom(canonical),
      migrationRequired: false,
    })
  }

  const legacy = restoreWithLocalRom(value)
  const document = hgssDataOnlySaveAuthority.project(createHgssSaveState(
    gameCode,
    legacy.profile,
    legacy.rng,
    legacy.world,
    legacy.field,
    legacy.options,
    legacy.igt,
    legacy.rtcPenalty,
    legacy.newGamePlus,
    legacy.extensions,
  ))
  // Le runtime doit reprendre exactement le document qui vient d'être
  // persisté, et non une projection legacy parallèle.
  return Object.freeze({
    document,
    restored: restoreWithLocalRom(document),
    migrationRequired: true,
  })
}
