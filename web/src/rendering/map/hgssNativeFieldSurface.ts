import type { NitroTextureAnimationPreview } from '../../ndsTypes'

/**
 * Les noms ci-dessous proviennent directement des neuf entrées de
 * fldtanime.narc. Les deux autres entrées sont flower01/flower02 : exiger une
 * animation décodée évite de transformer un matériau arbitrairement nommé en
 * eau.
 */
export const hgssNativeWaterTextureAnimationNames = [
  'sea_on',
  'swave_p',
  'swave_un',
  'sea_rock',
  'sea_rock_m',
  'dsea_on',
  'r_sea_rock',
] as const

const nativeWaterTextureAnimationNames = new Set<string>(hgssNativeWaterTextureAnimationNames)

export function isHgssNativeWaterTextureAnimation(
  animation: Pick<NitroTextureAnimationPreview, 'name'> | undefined,
): boolean {
  return Boolean(animation && nativeWaterTextureAnimationNames.has(animation.name))
}

/**
 * Paramètres uniquement optiques : la texture, sa couleur, son alpha et sa
 * cadence restent intégralement ceux de la ROM.
 */
export const hgssRemasteredWaterMaterial = {
  clearcoat: 0.72,
  clearcoatRoughness: 0.2,
  ior: 1.333,
  metalness: 0,
  reflectivity: 0.42,
  roughness: 0.36,
  specularIntensity: 0.62,
} as const
