import { hasMagic, readUint16, readUint32 } from '../../core/binaryReader'

export type NitroCellAnimationFrame = {
  durationFrames: number
  cellIndex: number
  positionX: number
  positionY: number
  rotation?: number
  scaleX?: number
  scaleY?: number
}

export type NitroCellAnimationSequence = {
  loopStartFrame: number
  animationElement: 0 | 1 | 2
  animationType: number
  playbackMode: number
  frames: NitroCellAnimationFrame[]
}

export type NitroCellAnimation = {
  sequences: NitroCellAnimationSequence[]
  declaredFrameCount: number
}

function assertRange(offset: number, size: number, byteLength: number, label: string): void {
  if (offset < 0 || size < 0 || offset + size > byteLength) throw new Error(`${label} dépasse le NANR.`)
}

function fx32(value: number): number {
  return value / 4096
}

/** Décode la banque ABNK d'un NANR Nitro 2D sans interpréter son mode de boucle. */
export function decodeNitroCellAnimationPayload(payload: Uint8Array): NitroCellAnimation | undefined {
  if (!hasMagic(payload, 0, 'RNAN') || payload.byteLength < 0x30) return undefined
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  const headerSize = readUint16(view, 12)
  if (headerSize < 16 || !hasMagic(payload, headerSize, 'KNBA')) return undefined
  const blockSize = readUint32(view, headerSize + 4)
  if (blockSize < 0x20 || headerSize + blockSize > payload.byteLength) return undefined
  const sequenceCount = readUint16(view, headerSize + 8)
  const declaredFrameCount = readUint16(view, headerSize + 10)
  const bankBase = headerSize + 8
  const sequenceStart = bankBase + readUint32(view, headerSize + 12)
  const frameStart = bankBase + readUint32(view, headerSize + 16)
  const resultStart = bankBase + readUint32(view, headerSize + 20)
  if (sequenceCount === 0 || declaredFrameCount === 0) return undefined
  assertRange(sequenceStart, sequenceCount * 16, headerSize + blockSize, 'Table des séquences ABNK')
  assertRange(frameStart, declaredFrameCount * 8, headerSize + blockSize, 'Table des frames ABNK')
  assertRange(resultStart, 2, headerSize + blockSize, 'Résultats ABNK')

  const sequences: NitroCellAnimationSequence[] = []
  let decodedFrameCount = 0
  for (let sequenceId = 0; sequenceId < sequenceCount; sequenceId += 1) {
    const sequenceOffset = sequenceStart + sequenceId * 16
    const frameCount = readUint16(view, sequenceOffset)
    const loopStartFrame = readUint16(view, sequenceOffset + 2)
    const animationElement = readUint16(view, sequenceOffset + 4)
    const animationType = readUint16(view, sequenceOffset + 6)
    const playbackMode = readUint32(view, sequenceOffset + 8)
    const relativeFramesOffset = readUint32(view, sequenceOffset + 12)
    if (animationElement > 2 || frameCount === 0 || loopStartFrame >= frameCount) return undefined
    const sequenceFramesStart = frameStart + relativeFramesOffset
    assertRange(sequenceFramesStart, frameCount * 8, headerSize + blockSize, `Frames de la séquence ABNK ${sequenceId}`)
    const frames: NitroCellAnimationFrame[] = []
    for (let frameId = 0; frameId < frameCount; frameId += 1) {
      const frameOffset = sequenceFramesStart + frameId * 8
      const resultOffset = readUint32(view, frameOffset)
      const durationFrames = readUint16(view, frameOffset + 4)
      const result = resultStart + resultOffset
      const resultSize = animationElement === 0 ? 2 : animationElement === 1 ? 16 : 8
      assertRange(result, resultSize, headerSize + blockSize, `Résultat de frame ABNK ${sequenceId}:${frameId}`)
      const frame: NitroCellAnimationFrame = {
        durationFrames,
        cellIndex: readUint16(view, result),
        positionX: animationElement === 0 ? 0 : view.getInt16(result + (animationElement === 1 ? 12 : 4), true),
        positionY: animationElement === 0 ? 0 : view.getInt16(result + (animationElement === 1 ? 14 : 6), true),
      }
      if (animationElement === 1) {
        frame.rotation = readUint16(view, result + 2)
        frame.scaleX = fx32(view.getInt32(result + 4, true))
        frame.scaleY = fx32(view.getInt32(result + 8, true))
      }
      frames.push(frame)
    }
    decodedFrameCount += frameCount
    sequences.push({ loopStartFrame, animationElement: animationElement as 0 | 1 | 2, animationType, playbackMode, frames })
  }
  if (decodedFrameCount > declaredFrameCount) return undefined
  return { sequences, declaredFrameCount }
}
