import { readUint16, readUint32 } from '../../core/binaryReader'
import type { NitroModelPreview, RomFile } from '../../ndsTypes'
import {
  composeNitroTrsMatrix,
  fix16,
  fix32,
  identityNitroMatrix,
  pivotNitroRotationMatrix,
  type NitroMatrix,
} from './nitroMatrix'
import { decodeNitroModel } from './nitroModelDecoder'
import { hasNitroMagic, readNitroDictionary, type NitroResourceView } from './nitroResource'

function signed(value: number, bits: number): number {
  const sign = 1 << (bits - 1)
  return (value & sign) !== 0 ? value - (1 << bits) : value
}

function readSampleIndex(header: number, frame: number): number {
  const startFrame = header & 0xffff
  const endFrame = (header >>> 16) & 0x0fff
  const rate = 1 << ((header >>> 30) & 0x03)
  const sampleCount = Math.max(1, Math.floor((endFrame - startFrame) / rate))
  if (frame <= startFrame) return 0
  return Math.min(sampleCount - 1, Math.floor((frame - startFrame) / rate))
}

function readNumericSample(
  view: DataView,
  animationOffset: number,
  cursor: number,
  frame: number,
  constant: boolean,
  channel: 'translation' | 'scale',
  fileSize: number,
): { value: number, nextOffset: number } | undefined {
  if (constant) {
    if (cursor + 4 > fileSize) return undefined
    return {
      value: fix32(view.getInt32(cursor, true)),
      nextOffset: cursor + (channel === 'scale' ? 8 : 4),
    }
  }

  if (cursor + 8 > fileSize) return undefined
  const header = readUint32(view, cursor)
  const width = (header >>> 28) & 0x03
  const sampleIndex = readSampleIndex(header, frame)
  const samplesOffset = animationOffset + readUint32(view, cursor + 4)
  const stride = channel === 'scale'
    ? width === 0 ? 8 : 4
    : width === 0 ? 4 : 2
  const sampleOffset = samplesOffset + sampleIndex * stride
  if (sampleOffset + (width === 0 ? 4 : 2) > fileSize) return undefined
  return {
    value: width === 0 ? fix32(view.getInt32(sampleOffset, true)) : fix16(readUint16(view, sampleOffset)),
    nextOffset: cursor + 8,
  }
}

function readBasisRotation(view: DataView, offset: number, fileSize: number): NitroMatrix | undefined {
  if (offset + 10 > fileSize) return undefined
  const xs = Array.from({ length: 5 }, (_, index) => readUint16(view, offset + index * 2))
  const ys = [xs[4], xs[0], xs[1], xs[2], xs[3]]
  const zs = [0, 0, 0, 0, 0, 0]
  for (let index = 0; index < 5; index += 1) {
    zs[index] = ys[index]! >>> 3
    zs[5] = (zs[5]! << 3) | (ys[index]! & 0x07)
  }
  const component = (value: number): number => signed(value & 0x1fff, 13) / 4096
  const a: [number, number, number] = [component(zs[1]!), component(zs[2]!), component(zs[3]!)]
  const b: [number, number, number] = [component(zs[4]!), component(zs[0]!), component(zs[5]!)]
  const c: [number, number, number] = [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
  return new Float64Array([
    a[0], a[1], a[2], 0,
    b[0], b[1], b[2], 0,
    c[0], c[1], c[2], 0,
    0, 0, 0, 1,
  ])
}

function readRotation(
  view: DataView,
  animationOffset: number,
  pivotDataOffset: number,
  basisMatricesOffset: number,
  rotationIndex: number,
  fileSize: number,
): NitroMatrix {
  const index = rotationIndex & 0x7fff
  if ((rotationIndex & 0x8000) !== 0) {
    const offset = animationOffset + pivotDataOffset + index * 6
    if (offset + 6 <= fileSize) {
      const flags = readUint16(view, offset)
      const neg = ((flags >>> 4) & 1) | (((flags >>> 5) & 1) << 1) | (((flags >>> 6) & 1) << 2)
      return pivotNitroRotationMatrix(
        flags & 0x0f,
        neg,
        fix16(readUint16(view, offset + 2)),
        fix16(readUint16(view, offset + 4)),
      )
    }
    return identityNitroMatrix()
  }

  return readBasisRotation(view, animationOffset + basisMatricesOffset + index * 10, fileSize)
    ?? identityNitroMatrix()
}

function readRotationSample(
  view: DataView,
  animationOffset: number,
  pivotDataOffset: number,
  basisMatricesOffset: number,
  cursor: number,
  frame: number,
  constant: boolean,
  fileSize: number,
): { matrix: NitroMatrix, nextOffset: number } | undefined {
  if (constant) {
    if (cursor + 4 > fileSize) return undefined
    return {
      matrix: readRotation(
        view,
        animationOffset,
        pivotDataOffset,
        basisMatricesOffset,
        readUint16(view, cursor),
        fileSize,
      ),
      nextOffset: cursor + 4,
    }
  }

  if (cursor + 8 > fileSize) return undefined
  const header = readUint32(view, cursor)
  const sampleIndex = readSampleIndex(header, frame)
  const sampleOffset = animationOffset + readUint32(view, cursor + 4) + sampleIndex * 2
  if (sampleOffset + 2 > fileSize) return undefined
  return {
    matrix: readRotation(
      view,
      animationOffset,
      pivotDataOffset,
      basisMatricesOffset,
      readUint16(view, sampleOffset),
      fileSize,
    ),
    nextOffset: cursor + 8,
  }
}

/** Décode une pose BCA/JNT sans dépendre du chargeur global de ROM. */
export function decodeNitroSkeletalAnimationFrame(
  bytes: Uint8Array,
  archive: RomFile | undefined,
  memberIndex: number,
  frame: number,
): NitroMatrix[] | undefined {
  const member = archive?.archiveMembers[memberIndex]
  if (!archive || !member || member.size < 0x20 || !hasNitroMagic(bytes, member.offset, 'BCA0')) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset + member.offset, member.size)
  const fileSize = readUint32(view, 8)
  const sectionOffset = readUint32(view, 16)
  if (fileSize > member.size || sectionOffset + 16 > fileSize || !hasNitroMagic(bytes, member.offset + sectionOffset, 'JNT0')) return undefined
  const resource: NitroResourceView = { bytes, view, baseOffset: member.offset, fileSize }
  const entries = readNitroDictionary(resource, sectionOffset + 8, (elementOffset) => readUint32(view, elementOffset))
  if (entries.length === 0) return undefined
  const animationOffset = sectionOffset + entries[0]!.value
  if (animationOffset + 20 > fileSize) return undefined
  const frameCount = readUint16(view, animationOffset + 4)
  const trackCount = readUint16(view, animationOffset + 6)
  const pivotDataOffset = readUint32(view, animationOffset + 12)
  const basisMatricesOffset = readUint32(view, animationOffset + 16)
  if (trackCount === 0 || animationOffset + 20 + trackCount * 2 > fileSize) return undefined
  const normalizedFrameCount = Math.max(1, frameCount)
  const animationFrame = ((frame % normalizedFrameCount) + normalizedFrameCount) % normalizedFrameCount
  const matrices: NitroMatrix[] = []

  for (let track = 0; track < trackCount; track += 1) {
    const trackOffset = animationOffset + readUint16(view, animationOffset + 20 + track * 2)
    if (trackOffset + 4 > fileSize) continue
    const flags = readUint16(view, trackOffset)
    const targetIndex = view.getUint8(trackOffset + 3)
    if ((flags & 1) !== 0) continue
    let cursor = trackOffset + 4
    const translation: [number, number, number] = [0, 0, 0]
    let rotation = identityNitroMatrix()
    const scale: [number, number, number] = [1, 1, 1]

    if (((flags >>> 1) & 0x03) === 0) {
      for (let axis = 0; axis < 3; axis += 1) {
        const sample = readNumericSample(
          view,
          animationOffset,
          cursor,
          animationFrame,
          ((flags >>> (3 + axis)) & 1) !== 0,
          'translation',
          fileSize,
        )
        if (!sample) return undefined
        translation[axis] = sample.value
        cursor = sample.nextOffset
      }
    }

    if (((flags >>> 6) & 0x03) === 0) {
      const sample = readRotationSample(
        view,
        animationOffset,
        pivotDataOffset,
        basisMatricesOffset,
        cursor,
        animationFrame,
        ((flags >>> 8) & 1) !== 0,
        fileSize,
      )
      if (!sample) return undefined
      rotation = sample.matrix
      cursor = sample.nextOffset
    }

    if (((flags >>> 9) & 0x03) === 0) {
      for (let axis = 0; axis < 3; axis += 1) {
        const sample = readNumericSample(
          view,
          animationOffset,
          cursor,
          animationFrame,
          ((flags >>> (11 + axis)) & 1) !== 0,
          'scale',
          fileSize,
        )
        if (!sample) return undefined
        scale[axis] = sample.value
        cursor = sample.nextOffset
      }
    }

    matrices[targetIndex] = composeNitroTrsMatrix(translation, rotation, scale)
  }

  return matrices.length > 0 ? matrices : undefined
}

/** Applique des poses BCA échantillonnées au modèle sans conserver d'état entre deux assets. */
export function decodeNitroSkeletalModelFrames(
  bytes: Uint8Array,
  modelArchive: RomFile | undefined,
  animationArchive: RomFile | undefined,
  modelId: number,
  animationMemberIndex: number,
  frameCount: number | undefined,
  sampleCount: number,
): NitroModelPreview[] | undefined {
  const finalFrameCount = Math.max(1, frameCount ?? 1)
  const finalSampleCount = Math.max(1, Math.min(sampleCount, finalFrameCount))
  const frames: NitroModelPreview[] = []
  for (let index = 0; index < finalSampleCount; index += 1) {
    const frame = Math.floor(index * finalFrameCount / finalSampleCount)
    const matrices = decodeNitroSkeletalAnimationFrame(bytes, animationArchive, animationMemberIndex, frame)
    const model = decodeNitroModel(bytes, modelArchive, modelId, false, matrices, false)
    if (model) frames.push(model)
  }
  // Certains mécanismes utilisent une BCA d'une seule pose pour chaque état.
  return frames.length > 0 ? frames : undefined
}
