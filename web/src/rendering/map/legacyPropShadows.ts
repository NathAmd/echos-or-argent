import type { NitroSurfacePreview } from '../../ndsTypes'

const legacyShadowToken = /(?:^|[_:])(?:kage|shade)(?:$|[_:])/i

/**
 * HGSS props contain flat, pre-rendered DS shadow geometry. It competes with
 * the remastered directional shadow map, but remains useful in depthless rooms.
 */
export function isLegacyPropShadowSurface(surface: NitroSurfacePreview): boolean {
  return [surface.materialName, surface.textureName, surface.paletteName]
    .some((name) => legacyShadowToken.test(name ?? ''))
}
