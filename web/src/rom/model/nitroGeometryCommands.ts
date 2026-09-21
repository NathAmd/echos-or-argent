import type { NitroMaterialBinding, NitroRenderState, NitroSurfaceAccumulator, NitroVertex } from './internalTypes'
import { cloneNitroMatrix, fix32, multiplyNitroMatrices, nitroScaleMatrix, nitroTranslationMatrix, transformNitroPoint } from './nitroMatrix'

function signExtend(value: number, bits: number): number {
  const sign = 1 << (bits - 1)
  return value & sign ? value - (1 << bits) : value
}

function getSurfaceAccumulator(accumulators: Map<number, NitroSurfaceAccumulator>, materialIndex: number): NitroSurfaceAccumulator {
  const existing = accumulators.get(materialIndex)
  if (existing) return existing
  const created: NitroSurfaceAccumulator = { materialIndex, positions: [], colors: [], uvs: [], usesVertexColors: false, usesUvs: false }
  accumulators.set(materialIndex, created)
  return created
}

function decodeTexcoord(packed: number, material: NitroMaterialBinding | undefined): [number, number] {
  const s = signExtend(packed & 0xffff, 16) / 16
  const t = signExtend(packed >>> 16, 16) / 16
  return [s / Math.max(material?.textureWidth ?? 1, 1), t / Math.max(material?.textureHeight ?? 1, 1)]
}

export function selectNitroMaterial(
  state: NitroRenderState,
  materialIndex: number,
  materials: NitroMaterialBinding[],
): void {
  state.currentMaterialIndex = materialIndex
  const material = materials[materialIndex]
  // GX_PACK_DIFFAMB_PARAM's C bit updates the hardware's current vertex
  // color while the material is bound. Omitting it lets a COLOR command from
  // the preceding shape bleed into the next one (often a black baked shadow).
  if (material?.setsVertexColor && material.diffuseColor) state.currentColor = material.diffuseColor
}

function parameterCount(opcode: number): number | undefined {
  if (opcode === 0x00 || opcode === 0x11 || opcode === 0x15 || opcode === 0x41) return 0
  if (opcode === 0x10 || opcode === 0x12 || opcode === 0x13 || opcode === 0x14 || opcode === 0x20 || opcode === 0x21 || opcode === 0x22 || opcode === 0x24 || opcode === 0x25 || opcode === 0x26 || opcode === 0x27 || opcode === 0x28 || opcode === 0x29 || opcode === 0x2a || opcode === 0x2b || opcode === 0x40) return 1
  if (opcode === 0x23) return 2
  if (opcode === 0x16 || opcode === 0x18) return 16
  if (opcode === 0x17 || opcode === 0x19) return 12
  if (opcode === 0x1a) return 9
  if (opcode === 0x1b || opcode === 0x1c) return 3
  return undefined
}

export function decodeNitroVertices(
  view: DataView,
  offset: number,
  length: number,
  state: NitroRenderState,
  surfaces: Map<number, NitroSurfaceAccumulator>,
  materials: NitroMaterialBinding[],
): { usesVertexColors: boolean } {
  let cursor = offset
  const end = offset + length
  let primitive = -1
  let vertices: NitroVertex[] = []
  let current: [number, number, number] = [0, 0, 0]
  let usesVertexColors = false
  let usesUvs = false
  const pushTriangle = (first: NitroVertex, second: NitroVertex, third: NitroVertex): void => {
    const surface = getSurfaceAccumulator(surfaces, state.currentMaterialIndex)
    surface.usesVertexColors ||= usesVertexColors
    surface.usesUvs ||= usesUvs
    surface.positions.push(...first.position, ...second.position, ...third.position)
    surface.colors.push(...first.color, ...second.color, ...third.color)
    surface.uvs.push(...first.uv, ...second.uv, ...third.uv)
  }
  const emit = (): void => {
    if (primitive === 1 && vertices.length === 4) {
      pushTriangle(vertices[0], vertices[1], vertices[2])
      pushTriangle(vertices[0], vertices[2], vertices[3])
      vertices = []
    }
    if (primitive === 0 && vertices.length === 3) {
      pushTriangle(vertices[0], vertices[1], vertices[2])
      vertices = []
    }
    if (primitive === 2 && vertices.length >= 3) {
      const index = vertices.length - 1
      const triangle = index % 2 === 0 ? [vertices[index - 2], vertices[index - 1], vertices[index]] : [vertices[index - 1], vertices[index - 2], vertices[index]]
      pushTriangle(triangle[0], triangle[1], triangle[2])
    }
    if (primitive === 3 && vertices.length >= 4 && vertices.length % 2 === 0) {
      const index = vertices.length - 1
      pushTriangle(vertices[index - 3], vertices[index - 2], vertices[index])
      pushTriangle(vertices[index - 3], vertices[index], vertices[index - 1])
    }
  }
  while (cursor + 4 <= end) {
    const opcodes = view.getUint32(cursor, true)
    cursor += 4
    for (let slot = 0; slot < 4; slot += 1) {
      const opcode = (opcodes >> (slot * 8)) & 0xff
      const count = parameterCount(opcode)
      if (count === undefined || cursor + count * 4 > end) return { usesVertexColors }
      if (opcode === 0x20) {
        const packed = view.getUint32(cursor, true)
        state.currentColor = [(packed & 0x1f) / 31, ((packed >>> 5) & 0x1f) / 31, ((packed >>> 10) & 0x1f) / 31]
        usesVertexColors = true
      } else if (opcode === 0x21) {
        // On GX, NORMAL replaces the current COLOR result with the lighting
        // calculated for that normal. Three performs that lighting later, so
        // its neutral equivalent is white. Keeping a preceding COLOR here can
        // otherwise paint following lit geometry with stale explicit color.
        state.currentColor = [1, 1, 1]
      } else if (opcode === 0x22) {
        state.currentTexcoord = decodeTexcoord(view.getUint32(cursor, true), materials[state.currentMaterialIndex])
        usesUvs = true
      } else if (opcode === 0x40) {
        primitive = view.getUint32(cursor, true) & 3
        vertices = []
      } else if (opcode === 0x41) {
        vertices = []
        primitive = -1
      } else if (opcode === 0x14) {
        state.currentMatrix = cloneNitroMatrix(state.matrixStack[view.getUint32(cursor, true) & 31])
      } else if (opcode === 0x1b) {
        state.currentMatrix = multiplyNitroMatrices(state.currentMatrix, nitroScaleMatrix(fix32(view.getInt32(cursor, true)), fix32(view.getInt32(cursor + 4, true)), fix32(view.getInt32(cursor + 8, true))))
      } else if (opcode === 0x1c) {
        state.currentMatrix = multiplyNitroMatrices(state.currentMatrix, nitroTranslationMatrix(fix32(view.getInt32(cursor, true)), fix32(view.getInt32(cursor + 4, true)), fix32(view.getInt32(cursor + 8, true))))
      } else if (opcode === 0x23) {
        const first = view.getUint32(cursor, true)
        const second = view.getUint32(cursor + 4, true)
        current = [signExtend(first & 0xffff, 16) / 4096, signExtend(first >>> 16, 16) / 4096, signExtend(second & 0xffff, 16) / 4096]
        vertices.push({ position: transformNitroPoint(state.currentMatrix, current), color: state.currentColor, uv: state.currentTexcoord })
        emit()
      } else if (opcode === 0x24) {
        const packed = view.getUint32(cursor, true)
        current = [signExtend(packed & 0x3ff, 10) / 64, signExtend((packed >>> 10) & 0x3ff, 10) / 64, signExtend((packed >>> 20) & 0x3ff, 10) / 64]
        vertices.push({ position: transformNitroPoint(state.currentMatrix, current), color: state.currentColor, uv: state.currentTexcoord })
        emit()
      } else if (opcode >= 0x25 && opcode <= 0x27) {
        const packed = view.getUint32(cursor, true)
        const first = signExtend(packed & 0xffff, 16) / 4096
        const second = signExtend(packed >>> 16, 16) / 4096
        current = opcode === 0x25 ? [first, second, current[2]] : opcode === 0x26 ? [first, current[1], second] : [current[0], first, second]
        vertices.push({ position: transformNitroPoint(state.currentMatrix, current), color: state.currentColor, uv: state.currentTexcoord })
        emit()
      } else if (opcode === 0x28) {
        const packed = view.getUint32(cursor, true)
        current = [current[0] + signExtend(packed & 0x3ff, 10) / 4096, current[1] + signExtend((packed >>> 10) & 0x3ff, 10) / 4096, current[2] + signExtend((packed >>> 20) & 0x3ff, 10) / 4096]
        vertices.push({ position: transformNitroPoint(state.currentMatrix, current), color: state.currentColor, uv: state.currentTexcoord })
        emit()
      }
      cursor += count * 4
    }
  }
  return { usesVertexColors }
}
