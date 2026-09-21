import type { NitroSurfacePreview } from '../../ndsTypes'
import type { NitroMatrix } from './nitroMatrix'

export type { NitroMatrix } from './nitroMatrix'

export type NitroRenderState = {
  currentMatrix: NitroMatrix
  matrixStack: NitroMatrix[]
  currentColor: readonly [number, number, number]
  currentMaterialIndex: number
  currentTexcoord: readonly [number, number]
}

export type NitroPiece = {
  commandOffset: number
  commandLength: number
}

export type NitroGeometryPreview = {
  positions: Float32Array
  colors?: Float32Array
  surfaces: NitroSurfacePreview[]
}

export type NitroMaterialBinding = {
  name: string
  color?: readonly [number, number, number]
  diffuseColor?: readonly [number, number, number]
  /** DIF_AMB bit 15: binding the material also reloads the current GX vertex color. */
  setsVertexColor?: boolean
  ambientColor?: readonly [number, number, number]
  specularColor?: readonly [number, number, number]
  emissionColor?: readonly [number, number, number]
  alpha?: number
  fogEnabled?: boolean
  textureName?: string
  paletteName?: string
  textureWidth?: number
  textureHeight?: number
}

export type NitroNamedEntry<T> = {
  name: string
  value: T
}

export type NitroTextureSource = {
  name: string
  width: number
  height: number
  format: number
  color0Transparent: boolean
  dataOffset: number
}

export type NitroPaletteSource = {
  name: string
  dataOffset: number
}

export type NitroTextureSet = {
  textures: NitroTextureSource[]
  palettes: NitroPaletteSource[]
  block1Offset: number
  block1Length: number
  block4Offset: number
  block4Length: number
}

export type NitroSurfaceAccumulator = {
  materialIndex: number
  positions: number[]
  colors: number[]
  uvs: number[]
  usesVertexColors: boolean
  usesUvs: boolean
}

export type NitroVertex = {
  position: [number, number, number]
  color: readonly [number, number, number]
  uv: readonly [number, number]
}
