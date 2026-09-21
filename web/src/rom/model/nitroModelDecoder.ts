import { readUint16, readUint32 } from '../../core/binaryReader'
import type { NarcMember, NitroModelPreview, NitroSurfacePreview, RomFile } from '../../ndsTypes'
import type {
  NitroGeometryPreview,
  NitroMaterialBinding,
  NitroPiece,
  NitroRenderState,
  NitroSurfaceAccumulator,
} from './internalTypes'
import { decodeNitroVertices, selectNitroMaterial } from './nitroGeometryCommands'
import {
  addWeightedNitroMatrix,
  cloneNitroMatrix,
  fix16,
  fix32,
  identityNitroMatrix,
  multiplyNitroMatrices,
  nitroRotationMatrix,
  nitroScaleMatrix,
  nitroTranslationMatrix,
  pivotNitroRotationMatrix,
  zeroNitroMatrix,
  type NitroMatrix,
} from './nitroMatrix'
import { readNitroMaterialBindings, readNitroTextureSet } from './nitroModelResources'
import { hasNitroMagic, readNitroInfoOffsets, type NitroResourceView } from './nitroResource'
import { decodeNitroModelTextures, resolveNitroPaletteName } from './nitroTextureDecoder'
import { findNitroTextureSection } from './nitroTextureResources'

function readNitroObjectMatrices(resource: NitroResourceView, infoOffset: number): NitroMatrix[] {
  const { view, fileSize } = resource
  return readNitroInfoOffsets(resource, infoOffset).map((objectOffset) => {
    if (objectOffset + 4 > fileSize) return identityNitroMatrix()
    const flags = readUint16(view, objectOffset)
    const translationIdentity = flags & 1
    const rotationIdentity = (flags >> 1) & 1
    const scaleIdentity = (flags >> 2) & 1
    const usesPivotRotation = (flags >> 3) & 1
    const firstRotationValue = fix16(readUint16(view, objectOffset + 2))
    let cursor = objectOffset + 4
    const translation = translationIdentity === 0 && cursor + 12 <= fileSize
      ? [fix32(view.getInt32(cursor, true)), fix32(view.getInt32(cursor + 4, true)), fix32(view.getInt32(cursor + 8, true))] as const
      : [0, 0, 0] as const
    if (translationIdentity === 0) cursor += 12

    let rotation = identityNitroMatrix()
    if (usesPivotRotation === 1 && cursor + 4 <= fileSize) {
      rotation = pivotNitroRotationMatrix(
        (flags >> 4) & 0x0f,
        (flags >> 8) & 0x0f,
        fix16(readUint16(view, cursor)),
        fix16(readUint16(view, cursor + 2)),
      )
      cursor += 4
    } else if (rotationIdentity === 0 && cursor + 16 <= fileSize) {
      rotation = nitroRotationMatrix([
        firstRotationValue,
        fix16(readUint16(view, cursor)),
        fix16(readUint16(view, cursor + 2)),
        fix16(readUint16(view, cursor + 4)),
        fix16(readUint16(view, cursor + 6)),
        fix16(readUint16(view, cursor + 8)),
        fix16(readUint16(view, cursor + 10)),
        fix16(readUint16(view, cursor + 12)),
        fix16(readUint16(view, cursor + 14)),
      ])
      cursor += 16
    }

    const scale = scaleIdentity === 0 && cursor + 12 <= fileSize
      ? nitroScaleMatrix(
        fix32(view.getInt32(cursor, true)),
        fix32(view.getInt32(cursor + 4, true)),
        fix32(view.getInt32(cursor + 8, true)),
      )
      : identityNitroMatrix()
    return multiplyNitroMatrices(
      nitroTranslationMatrix(translation[0], translation[1], translation[2]),
      multiplyNitroMatrices(rotation, scale),
    )
  })
}

function readNitroPieces(resource: NitroResourceView, infoOffset: number): Array<NitroPiece | undefined> {
  const { view, fileSize } = resource
  return readNitroInfoOffsets(resource, infoOffset).map((pieceOffset) => {
    if (pieceOffset + 16 > fileSize) return undefined
    const commandOffset = readUint32(view, pieceOffset + 8)
    const commandLength = readUint32(view, pieceOffset + 12)
    if (commandLength === 0 || commandLength % 4 !== 0 || pieceOffset + commandOffset + commandLength > fileSize) return undefined
    return {
      commandOffset: pieceOffset + commandOffset,
      commandLength,
    }
  })
}

function readNitroInvBindMatrices(view: DataView, offset: number, fileSize: number, matrixCount: number): NitroMatrix[] {
  const recordSize = 84
  return Array.from({ length: matrixCount }, (_, index) => {
    const matrixOffset = offset + index * recordSize
    if (matrixOffset + 48 > fileSize) return identityNitroMatrix()
    return new Float64Array([
      fix32(view.getInt32(matrixOffset, true)),
      fix32(view.getInt32(matrixOffset + 4, true)),
      fix32(view.getInt32(matrixOffset + 8, true)),
      0,
      fix32(view.getInt32(matrixOffset + 12, true)),
      fix32(view.getInt32(matrixOffset + 16, true)),
      fix32(view.getInt32(matrixOffset + 20, true)),
      0,
      fix32(view.getInt32(matrixOffset + 24, true)),
      fix32(view.getInt32(matrixOffset + 28, true)),
      fix32(view.getInt32(matrixOffset + 32, true)),
      0,
      fix32(view.getInt32(matrixOffset + 36, true)),
      fix32(view.getInt32(matrixOffset + 40, true)),
      fix32(view.getInt32(matrixOffset + 44, true)),
      1,
    ])
  })
}

function readNitroRenderParameterCount(view: DataView, offset: number, fileSize: number, opcode: number): number | undefined {
  if (opcode === 0x09) {
    if (offset + 2 > fileSize) return undefined
    return 2 + view.getUint8(offset + 1) * 3
  }
  if (opcode === 0x02) return 2
  if (opcode === 0x03 || opcode === 0x04 || opcode === 0x05 || opcode === 0x24 || opcode === 0x44) return 1
  if (opcode === 0x07 || opcode === 0x08) return 1
  if (opcode === 0x27 || opcode === 0x28 || opcode === 0x47 || opcode === 0x48) return 2
  if (opcode === 0x67 || opcode === 0x68) return 3
  if (opcode === 0x06) return 3
  if (opcode === 0x26 || opcode === 0x46) return 4
  if (opcode === 0x66) return 5
  return 0
}

function readNitroRenderGeometry(
  view: DataView,
  offset: number,
  fileSize: number,
  pieces: Array<NitroPiece | undefined>,
  objectMatrices: NitroMatrix[],
  invBindMatrices: NitroMatrix[],
  upScale: number,
  downScale: number,
  materials: NitroMaterialBinding[],
  resolvedPalettes: Map<number, string | undefined>,
): NitroGeometryPreview | undefined {
  const surfaces = new Map<number, NitroSurfaceAccumulator>()
  let usesVertexColors = false
  const state: NitroRenderState = {
    currentMatrix: identityNitroMatrix(),
    matrixStack: Array.from({ length: 32 }, () => identityNitroMatrix()),
    currentColor: [1, 1, 1],
    currentMaterialIndex: 0,
    currentTexcoord: [0, 0],
  }
  let cursor = offset
  while (cursor < fileSize) {
    const opcode = view.getUint8(cursor)
    cursor += 1
    if (opcode === 0x01) break
    const parameterCount = readNitroRenderParameterCount(view, cursor, fileSize, opcode)
    if (parameterCount === undefined || cursor + parameterCount > fileSize) break
    if (opcode === 0x03) {
      state.currentMatrix = cloneNitroMatrix(state.matrixStack[view.getUint8(cursor) & 31])
    } else if ((opcode & 0x1f) === 0x04) {
      selectNitroMaterial(state, view.getUint8(cursor), materials)
    } else if (opcode === 0x05) {
      const piece = pieces[view.getUint8(cursor)]
      if (piece) {
        usesVertexColors = decodeNitroVertices(
          view,
          piece.commandOffset,
          piece.commandLength,
          state,
          surfaces,
          materials,
        ).usesVertexColors || usesVertexColors
      }
    } else if (opcode === 0x09) {
      const storePos = view.getUint8(cursor) & 31
      const termCount = view.getUint8(cursor + 1)
      const skinnedMatrix = zeroNitroMatrix()
      for (let termIndex = 0; termIndex < termCount; termIndex += 1) {
        const termOffset = cursor + 2 + termIndex * 3
        const stackIndex = view.getUint8(termOffset) & 31
        const invBindIndex = view.getUint8(termOffset + 1)
        const weight = view.getUint8(termOffset + 2) / 256
        const bindMatrix = invBindMatrices[invBindIndex]
        if (!bindMatrix) continue
        addWeightedNitroMatrix(
          skinnedMatrix,
          multiplyNitroMatrices(state.matrixStack[stackIndex], bindMatrix),
          weight,
        )
      }
      state.currentMatrix = skinnedMatrix
      state.matrixStack[storePos] = cloneNitroMatrix(skinnedMatrix)
    } else if (opcode === 0x06 || opcode === 0x26 || opcode === 0x46 || opcode === 0x66) {
      const objectIndex = view.getUint8(cursor)
      const storePos = opcode === 0x26 || opcode === 0x66 ? view.getUint8(cursor + 3) & 31 : undefined
      const loadPos = opcode === 0x46 ? view.getUint8(cursor + 3) & 31 : opcode === 0x66 ? view.getUint8(cursor + 4) & 31 : undefined
      if (loadPos !== undefined) state.currentMatrix = cloneNitroMatrix(state.matrixStack[loadPos])
      if (objectMatrices[objectIndex]) state.currentMatrix = multiplyNitroMatrices(state.currentMatrix, objectMatrices[objectIndex])
      if (storePos !== undefined) state.matrixStack[storePos] = cloneNitroMatrix(state.currentMatrix)
    } else if (opcode === 0x0b) {
      state.currentMatrix = multiplyNitroMatrices(state.currentMatrix, nitroScaleMatrix(upScale, upScale, upScale))
    } else if (opcode === 0x2b) {
      state.currentMatrix = multiplyNitroMatrices(state.currentMatrix, nitroScaleMatrix(downScale, downScale, downScale))
    }
    cursor += parameterCount
  }

  const surfacePreviews = [...surfaces.values()]
    .filter((surface) => surface.positions.length > 0)
    .sort((left, right) => left.materialIndex - right.materialIndex)
    .map((surface): NitroSurfacePreview => {
      const material = materials[surface.materialIndex]
      const paletteName = material?.textureName ? resolvedPalettes.get(surface.materialIndex) ?? material.paletteName : undefined
      return {
        materialIndex: surface.materialIndex,
        materialName: material?.name,
        materialColor: material?.color,
        materialDiffuseColor: material?.diffuseColor,
        materialAmbientColor: material?.ambientColor,
        materialSpecularColor: material?.specularColor,
        materialEmissionColor: material?.emissionColor,
        materialAlpha: material?.alpha,
        fogEnabled: material?.fogEnabled,
        textureName: material?.textureName,
        paletteName,
        textureId: material?.textureName ? `${material.textureName}:${paletteName ?? ''}` : undefined,
        positions: new Float32Array(surface.positions),
        colors: surface.usesVertexColors ? new Float32Array(surface.colors) : undefined,
        uvs: surface.usesUvs ? new Float32Array(surface.uvs) : undefined,
      }
    })
  if (surfacePreviews.length === 0) return undefined

  const totalPositionCount = surfacePreviews.reduce((sum, surface) => sum + surface.positions.length, 0)
  const positions = new Float32Array(totalPositionCount)
  const colors = usesVertexColors ? new Float32Array(totalPositionCount) : undefined
  let positionCursor = 0
  for (const surface of surfacePreviews) {
    positions.set(surface.positions, positionCursor)
    if (colors) {
      if (surface.colors) colors.set(surface.colors, positionCursor)
      else colors.fill(1, positionCursor, positionCursor + surface.positions.length)
    }
    positionCursor += surface.positions.length
  }

  return { positions, colors, surfaces: surfacePreviews }
}

export function decodeNitroModelMember(
  bytes: Uint8Array,
  member: NarcMember | undefined,
  modelId: number,
  includeUnboundTextures = false,
  boneMatricesOverride?: NitroMatrix[],
  includeTexturePreviews = true,
): NitroModelPreview | undefined {
  if (!member || member.size < 0x20 || !hasNitroMagic(bytes, member.offset, 'BMD0')) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset + member.offset, member.size)
  const fileSize = readUint32(view, 8)
  const headerSize = readUint16(view, 12)
  const sectionCount = readUint16(view, 14)
  if (fileSize > member.size || headerSize !== 16 || sectionCount === 0 || 16 + sectionCount * 4 > fileSize) return undefined
  const resource: NitroResourceView = { bytes, view, baseOffset: member.offset, fileSize }
  let modelSectionOffset: number | undefined
  for (let section = 0; section < sectionCount; section += 1) {
    const sectionOffset = readUint32(view, 16 + section * 4)
    if (
      modelSectionOffset === undefined
      && sectionOffset + 8 <= fileSize
      && hasNitroMagic(bytes, member.offset + sectionOffset, 'MDL0')
    ) modelSectionOffset = sectionOffset
  }
  if (modelSectionOffset === undefined) return undefined

  const infoOffset = modelSectionOffset + 8
  if (infoOffset + 16 > fileSize || bytes[member.offset + infoOffset] !== 0) return undefined
  const count = bytes[member.offset + infoOffset + 1]
  const dataOffset = infoOffset + 16 + count * 4
  if (dataOffset + count * 4 > fileSize || count === 0) return undefined
  const modelOffset = readUint32(view, dataOffset)
  if (modelOffset + 57 > fileSize) return undefined
  const model = modelSectionOffset + modelOffset
  const preview: NitroModelPreview = {
    modelId,
    materialCount: bytes[member.offset + model + 24],
    pieceCount: bytes[member.offset + model + 25],
    vertexCount: readUint16(view, model + 36),
    triangleCount: readUint16(view, model + 40),
    quadCount: readUint16(view, model + 42),
  }
  const renderCommandsOffset = readUint32(view, model + 4)
  const materialsOffset = model + readUint32(view, model + 8)
  const piecesOffset = readUint32(view, model + 12)
  const materials = readNitroMaterialBindings(bytes, view, member.offset, materialsOffset, fileSize)
  const resolvedPalettes = new Map<number, string | undefined>()

  const textureSectionOffset = findNitroTextureSection(bytes, member)?.textureSectionOffset
  if (textureSectionOffset !== undefined) {
    const textureSet = readNitroTextureSet(bytes, view, member.offset, textureSectionOffset, fileSize)
    if (textureSet) {
      const texturesByName = new Map(textureSet.textures.map((texture) => [texture.name, texture]))
      const palettesByName = new Map(textureSet.palettes.map((palette) => [palette.name, palette]))
      materials.forEach((material, materialIndex) => {
        const texture = material.textureName ? texturesByName.get(material.textureName) : undefined
        if (texture) {
          material.textureWidth = texture.width
          material.textureHeight = texture.height
        }
        const paletteName = material.textureName
          ? resolveNitroPaletteName(material.textureName, material.paletteName, palettesByName)
          : undefined
        resolvedPalettes.set(materialIndex, paletteName)
      })
      if (includeTexturePreviews) {
        const textures = decodeNitroModelTextures(bytes, textureSet, materials, resolvedPalettes, includeUnboundTextures)
        if (textures.length > 0) preview.textures = textures
      }
    }
  }

  const objectMatrices = boneMatricesOverride ?? readNitroObjectMatrices(resource, model + 64)
  const invBindMatricesOffset = readUint32(view, model + 16)
  const invBindMatrices = invBindMatricesOffset === 0
    ? []
    : readNitroInvBindMatrices(
      view,
      model + invBindMatricesOffset,
      fileSize,
      bytes[member.offset + model + 23],
    )
  const pieces = readNitroPieces(resource, model + piecesOffset)
  const geometry = readNitroRenderGeometry(
    view,
    model + renderCommandsOffset,
    fileSize,
    pieces,
    objectMatrices,
    invBindMatrices,
    fix32(view.getInt32(model + 28, true)),
    fix32(view.getInt32(model + 32, true)),
    materials,
    resolvedPalettes,
  )
  if (geometry) {
    preview.positions = geometry.positions
    if (geometry.colors) preview.colors = geometry.colors
    preview.surfaces = geometry.surfaces
  }
  return preview
}

export function decodeNitroModel(
  bytes: Uint8Array,
  archive: RomFile | undefined,
  modelId: number,
  includeUnboundTextures = false,
  boneMatricesOverride?: NitroMatrix[],
  includeTexturePreviews = true,
): NitroModelPreview | undefined {
  return decodeNitroModelMember(
    bytes,
    archive?.archiveMembers[modelId],
    modelId,
    includeUnboundTextures,
    boneMatricesOverride,
    includeTexturePreviews,
  )
}
