import type { MapMatrixPreview, OpeningMapPreview, RomInventory } from '../../ndsTypes'
import {
  HGSS_SAFARI_MAP_ID,
  applyHgssSafariCollisionTiles,
  composeHgssSafariMatrix,
  resolveHgssSafariAreaSetPlacements,
} from '../../game/safari/hgssSafariMap'
import { createHgssWednesdayLakeMatrix, shouldUseHgssWednesdayLakeVariant } from '../../game/world/hgssWeeklyWorld'

export function createHgssMapVariantResolver(
  buildVariant: (map: OpeningMapPreview, matrix: MapMatrixPreview) => OpeningMapPreview,
): NonNullable<RomInventory['mapVariantResolver']> {
  const cache = new Map<number, OpeningMapPreview>()
  return (map, context) => {
    if (map.id === HGSS_SAFARI_MAP_ID && context.safariZone && context.playerGender) {
      const areaSet = context.safariZone.areaSets[context.safariZone.activeAreaSet]
      const matrix = composeHgssSafariMatrix(map.matrix, areaSet)
      // Le terrain et le modele doivent etre reconstruits apres le remplacement
      // des six 0xFFFF de la matrice brute, jamais a partir de la carte statique.
      const variant = buildVariant(map, matrix)
      const placements = resolveHgssSafariAreaSetPlacements(matrix, areaSet, context.playerGender)
      if (placements.length === 0) return variant

      const mapProps = placements.map(({ mapProp }) => mapProp)
      const collisionTiles = placements.flatMap(({ collisionTiles: tiles }) => tiles)
      return {
        ...variant,
        model: variant.model ? {
          ...variant.model,
          mapProps: [...(variant.model.mapProps ?? []), ...mapProps],
        } : variant.model,
        terrain: variant.terrain ? {
          ...variant.terrain,
          attributes: applyHgssSafariCollisionTiles(
            variant.terrain.attributes,
            variant.terrain.width,
            variant.terrain.height,
            collisionTiles,
          ),
        } : variant.terrain,
      }
    }
    if (!shouldUseHgssWednesdayLakeVariant(map.id, context.weekday as 0 | 1 | 2 | 3 | 4 | 5 | 6, context.rocketHideoutCleared)) return map
    const cached = cache.get(map.id)
    if (cached) return cached
    const variant = buildVariant(map, createHgssWednesdayLakeMatrix(map.matrix))
    cache.set(map.id, variant)
    return variant
  }
}
