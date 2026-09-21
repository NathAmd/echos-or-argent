import type { NitroSurfacePreview } from '../../ndsTypes'

export type NitroRenderColor = readonly [number, number, number]

const neutralNitroRenderColor: NitroRenderColor = [1, 1, 1]
const blackNitroRenderColor: NitroRenderColor = [0, 0, 0]

function hasColorEnergy(color: NitroRenderColor | undefined): color is NitroRenderColor {
  return Boolean(color?.some((channel) => channel > 0))
}

function resolveChannel(
  surface: NitroSurfacePreview,
  fallback: NitroSurfacePreview | undefined,
  key: 'materialColor' | 'materialDiffuseColor' | 'materialAmbientColor' | 'materialEmissionColor',
): NitroRenderColor | undefined {
  return surface[key] ?? fallback?.[key]
}

/**
 * Resolves the single Three.js material multiplier corresponding to Nitro GX.
 *
 * A GX COLOR command already produces the final per-vertex modulation color;
 * multiplying it by DIF_AMB's diffuse field a second time darkens the model
 * and turns every vertex black when the native material uses diffuse black.
 * NORMAL-only geometry still needs a material color, with ambient/emission as
 * the native fallback when diffuse carries no light at all.
 */
export function resolveNitroSurfaceMaterialColor(
  surface: NitroSurfacePreview,
  fallback?: NitroSurfacePreview,
  hasVertexColorChannel = surface.colors?.length === surface.positions.length,
): NitroRenderColor {
  if (hasVertexColorChannel) return neutralNitroRenderColor

  const diffuse = resolveChannel(surface, fallback, 'materialColor')
    ?? resolveChannel(surface, fallback, 'materialDiffuseColor')
  if (hasColorEnergy(diffuse)) return diffuse

  const ambient = resolveChannel(surface, fallback, 'materialAmbientColor')
  const emission = resolveChannel(surface, fallback, 'materialEmissionColor')
  if (!hasColorEnergy(ambient) && !hasColorEnergy(emission)) {
    return diffuse ?? (ambient || emission ? blackNitroRenderColor : neutralNitroRenderColor)
  }
  return [
    Math.max(ambient?.[0] ?? 0, emission?.[0] ?? 0),
    Math.max(ambient?.[1] ?? 0, emission?.[1] ?? 0),
    Math.max(ambient?.[2] ?? 0, emission?.[2] ?? 0),
  ]
}
