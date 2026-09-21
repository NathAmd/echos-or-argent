import type { NitroModelPreview, RomInventory } from '../../ndsTypes'
import {
  hgssFieldMoveEffectAnimationFrames,
  resolveHgssFieldMoveEffectProfile,
  type HgssFieldMoveEffectMode,
  type HgssFieldMoveEffectProfile,
} from '../../game/world/hgssFieldMoveEffect'
import { composeNitroModelAnimationFrames } from '../model/nitroModelFrameComposition'

export type HgssFieldMoveEffectAsset = Readonly<{
  profile: HgssFieldMoveEffectProfile
  model: NitroModelPreview
  frames: readonly NitroModelPreview[]
}>

export function resolveHgssFieldMoveEffectAsset(
  mode: HgssFieldMoveEffectMode,
  modelResolver: RomInventory['gymOverlayModelResolver'],
  animationResolver: RomInventory['gymOverlayAnimationResolver'],
): HgssFieldMoveEffectAsset {
  const profile = resolveHgssFieldMoveEffectProfile(mode)
  if (!modelResolver || !animationResolver) {
    throw new Error(`Les résolveurs Nitro de l'effet terrain ${profile.kind} sont absents.`)
  }
  const model = modelResolver(profile.archivePath, profile.modelMember)
  if (!model) {
    throw new Error(`Le modèle Nitro ${profile.archivePath}:${profile.modelMember} de l'effet terrain ${profile.kind} est absent.`)
  }
  const tracks = profile.animationMembers.map((member) => {
    const animation = animationResolver(profile.archivePath, profile.modelMember, member)
    if (!animation || animation.frames.length !== hgssFieldMoveEffectAnimationFrames) {
      throw new Error(`La piste Nitro ${profile.archivePath}:${member} de l'effet terrain ${profile.kind} n'a pas ses ${hgssFieldMoveEffectAnimationFrames} frames natives.`)
    }
    return animation.frames
  })
  const frames = composeNitroModelAnimationFrames(model, tracks)
  if (frames.length !== hgssFieldMoveEffectAnimationFrames) {
    throw new Error(`La composition Nitro de l'effet terrain ${profile.kind} n'a pas ses ${hgssFieldMoveEffectAnimationFrames} frames natives.`)
  }
  return { profile, model, frames }
}
