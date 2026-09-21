import type { NitroModelPreview, NitroSurfacePreview } from '../../ndsTypes'

const epsilon = 1e-5

function sameValue(left: unknown, right: unknown): boolean {
  return Array.isArray(left) && Array.isArray(right) ? left.length === right.length && left.every((value, index) => value === right[index]) : left === right
}

function mergeChangedValue<T>(base: T | undefined, output: T | undefined, candidate: T | undefined, label: string): T | undefined {
  if (candidate === undefined || sameValue(candidate, base)) return output
  if (!sameValue(output, base) && !sameValue(output, candidate)) throw new Error(`Les pistes Nitro ${label} sont incompatibles.`)
  return candidate
}

function mergeChangedValues(
  base: Float32Array | undefined,
  output: Float32Array | undefined,
  candidate: Float32Array | undefined,
  label: string,
): Float32Array | undefined {
  if (!candidate) return output
  if (!base || !output || base.length !== candidate.length || output.length !== candidate.length) {
    throw new Error(`La piste Nitro ${label} ne correspond pas au modèle de base.`)
  }
  for (let index = 0; index < candidate.length; index += 1) {
    if (Math.abs(candidate[index]! - base[index]!) <= epsilon) continue
    if (Math.abs(output[index]! - base[index]!) > epsilon && Math.abs(output[index]! - candidate[index]!) > epsilon) {
      throw new Error(`Les pistes Nitro ${label} modifient la même composante ${index} de façon incompatible.`)
    }
    output[index] = candidate[index]!
  }
  return output
}

function cloneSurface(surface: NitroSurfacePreview): NitroSurfacePreview {
  return {
    ...surface,
    positions: surface.positions.slice(),
    colors: surface.colors?.slice(),
    uvs: surface.uvs?.slice(),
  }
}

/**
 * Reproduit l’empilement de plusieurs animations Nitro attachées au même
 * render object. Chaque piste doit toucher des composantes disjointes ; un
 * chevauchement contradictoire échoue explicitement au lieu d’écraser une
 * piste selon l’ordre JavaScript.
 */
export function composeNitroModelAnimationFrames(
  base: NitroModelPreview,
  tracks: readonly (readonly NitroModelPreview[])[],
): NitroModelPreview[] {
  if (!base.surfaces?.length || tracks.length === 0) return []
  const frameCount = Math.max(...tracks.map((track) => track.length))
  if (frameCount < 1) return []
  return Array.from({ length: frameCount }, (_, frameIndex) => {
    const surfaces = base.surfaces!.map(cloneSurface)
    const textures = new Map((base.textures ?? []).map((texture) => [texture.id, texture]))
    for (const track of tracks) {
      const frame = track[Math.min(frameIndex, track.length - 1)]
      if (!frame?.surfaces || frame.surfaces.length !== surfaces.length) throw new Error('Une piste Nitro composée ne correspond pas aux surfaces du modèle de base.')
      for (let surfaceIndex = 0; surfaceIndex < surfaces.length; surfaceIndex += 1) {
        const baseSurface = base.surfaces![surfaceIndex]!
        const output = surfaces[surfaceIndex]!
        const candidate = frame.surfaces[surfaceIndex]!
        output.positions = mergeChangedValues(baseSurface.positions, output.positions, candidate.positions, `positions[${surfaceIndex}]`)!
        output.colors = mergeChangedValues(baseSurface.colors, output.colors, candidate.colors, `couleurs[${surfaceIndex}]`)
        output.uvs = mergeChangedValues(baseSurface.uvs, output.uvs, candidate.uvs, `UV[${surfaceIndex}]`)
        output.materialColor = mergeChangedValue(baseSurface.materialColor, output.materialColor, candidate.materialColor, `couleur matériau[${surfaceIndex}]`)
        output.materialDiffuseColor = mergeChangedValue(baseSurface.materialDiffuseColor, output.materialDiffuseColor, candidate.materialDiffuseColor, `diffuse[${surfaceIndex}]`)
        output.materialAmbientColor = mergeChangedValue(baseSurface.materialAmbientColor, output.materialAmbientColor, candidate.materialAmbientColor, `ambiante[${surfaceIndex}]`)
        output.materialSpecularColor = mergeChangedValue(baseSurface.materialSpecularColor, output.materialSpecularColor, candidate.materialSpecularColor, `spéculaire[${surfaceIndex}]`)
        output.materialEmissionColor = mergeChangedValue(baseSurface.materialEmissionColor, output.materialEmissionColor, candidate.materialEmissionColor, `émission[${surfaceIndex}]`)
        output.materialAlpha = mergeChangedValue(baseSurface.materialAlpha, output.materialAlpha, candidate.materialAlpha, `alpha[${surfaceIndex}]`)
        output.textureId = mergeChangedValue(baseSurface.textureId, output.textureId, candidate.textureId, `texture[${surfaceIndex}]`)
        output.textureName = mergeChangedValue(baseSurface.textureName, output.textureName, candidate.textureName, `nom de texture[${surfaceIndex}]`)
        output.paletteName = mergeChangedValue(baseSurface.paletteName, output.paletteName, candidate.paletteName, `palette[${surfaceIndex}]`)
      }
      for (const texture of frame.textures ?? []) textures.set(texture.id, texture)
    }
    return { ...base, surfaces, textures: [...textures.values()] }
  })
}
