import type { NitroAnimationPreview, NitroMapPropAnimationPreview, NitroModelPreview, RomFile, RomInventory } from '../../ndsTypes'

type ArchiveDecoders = {
  model: (archive: RomFile, member: number) => NitroModelPreview | undefined
  preview: (archive: RomFile, member: number, kind: NitroAnimationPreview['kind']) => NitroAnimationPreview | undefined
  skeletal: (archive: RomFile, modelMember: number, animationMember: number, frameCount: number) => NitroModelPreview[] | undefined
  pattern: (archive: RomFile, modelMember: number, animationMember: number, model: NitroModelPreview) => NitroModelPreview[] | undefined
  material: (payload: Uint8Array, model: NitroModelPreview) => NitroModelPreview[] | undefined
}

export function createNitroArchiveAssetResolvers(bytes: Uint8Array, files: readonly RomFile[], decoders: ArchiveDecoders): Pick<RomInventory, 'gymOverlayModelResolver' | 'gymOverlayAnimationResolver'> {
  const archives = new Map(files.map((file) => [file.path, file]))
  const models = new Map<string, NitroModelPreview | undefined>()
  const animations = new Map<string, NitroMapPropAnimationPreview | undefined>()
  const gymOverlayModelResolver = (archivePath: string, modelMember: number): NitroModelPreview | undefined => {
    const key = `${archivePath}:${modelMember}`
    if (!models.has(key)) {
      const archive = archives.get(archivePath)
      models.set(key, archive ? decoders.model(archive, modelMember) : undefined)
    }
    return models.get(key)
  }
  const gymOverlayAnimationResolver = (archivePath: string, modelMember: number, animationMember: number): NitroMapPropAnimationPreview | undefined => {
    const key = `${archivePath}:${modelMember}:${animationMember}`
    if (!animations.has(key)) {
      const archive = archives.get(archivePath)
      const model = gymOverlayModelResolver(archivePath, modelMember)
      const member = archive?.archiveMembers[animationMember]
      const skeletal = archive && decoders.preview(archive, animationMember, 'BCA')
      const pattern = !skeletal && archive ? decoders.preview(archive, animationMember, 'BTP') : undefined
      const material = !skeletal && !pattern && archive
        ? decoders.preview(archive, animationMember, 'BTA') ?? decoders.preview(archive, animationMember, 'BMA')
        : undefined
      const preview = skeletal ?? pattern ?? material
      const frames = archive && model && skeletal
        ? decoders.skeletal(archive, modelMember, animationMember, skeletal.frameCount)
        : archive && model && pattern
          ? decoders.pattern(archive, modelMember, animationMember, model)
          : model && material && member
            ? decoders.material(bytes.subarray(member.offset, member.offset + member.size), model)
            : undefined
      animations.set(key, preview && frames?.length === preview.frameCount ? { frameCount: preview.frameCount, frames } : undefined)
    }
    return animations.get(key)
  }
  return { gymOverlayModelResolver, gymOverlayAnimationResolver }
}
