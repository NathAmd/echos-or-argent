import type { NitroModelPreview, OpeningMapPreview, RomInventory } from '../../ndsTypes'
import { composeNitroModelAnimationFrames } from '../../rom/model/nitroModelFrameComposition'

export type HgssGymPropAnimationBinding = { targetModelId: number, animationModelId: number }
export type HgssGymPropPresentation = { modelId: number, base: NitroModelPreview, frames?: NitroModelPreview[] }

export function resolveHgssGymPropPresentations(
  map: OpeningMapPreview,
  bindings: readonly HgssGymPropAnimationBinding[],
  enabled: boolean,
  modelResolver: RomInventory['mapPropModelResolver'],
  animationResolver: RomInventory['mapPropAnimationResolver'],
  metadataResolver: RomInventory['mapPropAnimationMetadataResolver'],
): HgssGymPropPresentation[] {
  if (!modelResolver || (enabled && (!animationResolver || !metadataResolver))) throw new Error(`Les ressources d’animation ROM de l’arène ${map.label} sont absentes.`)
  return bindings.map(({ targetModelId, animationModelId }) => {
    const base = modelResolver(targetModelId, map.header.areaDataBank, 'room')
    if (!base) throw new Error(`Le modèle ROM ${targetModelId} de l’arène ${map.label} est absent.`)
    if (!enabled) return { modelId: targetModelId, base }
    if (!animationResolver || !metadataResolver) throw new Error(`Les pistes ROM ${animationModelId} de l’arène ${map.label} sont absentes.`)
    const archiveIds = metadataResolver(animationModelId, 'room', map.header.areaDataBank)?.animationArchiveIds
    if (!archiveIds?.length) throw new Error(`Les pistes ROM ${animationModelId} de l’arène ${map.label} sont absentes.`)
    const tracks = archiveIds.map((archiveId) => animationResolver(targetModelId, map.header.areaDataBank, archiveId, 'room')?.frames)
    if (tracks.some((track) => !track?.length)) throw new Error(`Une piste ROM ${animationModelId} de l’arène ${map.label} ne peut pas être décodée.`)
    return { modelId: targetModelId, base, frames: composeNitroModelAnimationFrames(base, tracks as NitroModelPreview[][]) }
  })
}
