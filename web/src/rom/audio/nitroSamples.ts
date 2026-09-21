export type NitroInstrument = {
  type: 'pcm' | 'psg' | 'noise'
  waveId: number
  waveArchiveSlot: number
  rootNote: number
  attack: number
  decay: number
  sustain: number
  release: number
  pan: number
}

export type NitroWave = {
  sampleRate: number
  samples: Float32Array
  loop: boolean
  loopStart: number
}

function requireRange(bytes: Uint8Array, offset: number, size: number, label: string): void {
  if (offset < 0 || size < 0 || offset + size > bytes.byteLength) throw new Error(`${label} depasse les limites du fichier audio ROM.`)
}

function requireMagic(bytes: Uint8Array, magic: string): void {
  requireRange(bytes, 0, 4, magic)
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== magic) throw new Error(`Le fichier audio ROM n’est pas un ${magic}.`)
}

function readUint24(bytes: Uint8Array, offset: number): number {
  requireRange(bytes, offset, 3, 'Offset 24 bits SBNK')
  return bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16
}

function readBasicInstrument(bytes: Uint8Array, offset: number, type: NitroInstrument['type'] = 'pcm'): NitroInstrument {
  requireRange(bytes, offset, 10, 'Instrument PCM SBNK')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return {
    type,
    waveId: view.getUint16(offset, true),
    waveArchiveSlot: view.getUint16(offset + 2, true),
    rootNote: bytes[offset + 4],
    attack: bytes[offset + 5],
    decay: bytes[offset + 6],
    sustain: bytes[offset + 7],
    release: bytes[offset + 8],
    pan: bytes[offset + 9],
  }
}

function readNestedInstrument(bytes: Uint8Array, offset: number): NitroInstrument {
  requireRange(bytes, offset, 12, 'Sous-instrument SBNK')
  const type = bytes[offset]
  if (type !== 1) throw new Error(`Type de sous-instrument SBNK ${type} non pris en charge.`)
  return readBasicInstrument(bytes, offset + 2)
}

export function resolveSbnkInstrument(bytes: Uint8Array, program: number, note: number): NitroInstrument {
  requireMagic(bytes, 'SBNK')
  requireRange(bytes, 0x38, 4, 'Table SBNK')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = view.getUint32(0x38, true)
  if (program < 0 || program >= count) throw new Error(`Le programme SBNK ${program} est absent.`)
  const entryOffset = 0x3c + program * 4
  requireRange(bytes, entryOffset, 4, `Programme SBNK ${program}`)
  const type = bytes[entryOffset]
  const offset = readUint24(bytes, entryOffset + 1)
  if (type === 1) return readBasicInstrument(bytes, offset)
  if (type === 2) return readBasicInstrument(bytes, offset, 'psg')
  if (type === 3) return readBasicInstrument(bytes, offset, 'noise')
  if (type === 16) {
    requireRange(bytes, offset, 2, 'Plage de batterie SBNK')
    const minNote = bytes[offset]
    const maxNote = bytes[offset + 1]
    if (note < minNote || note > maxNote) throw new Error(`La note ${note} est hors de la batterie SBNK ${program}.`)
    return readNestedInstrument(bytes, offset + 2 + (note - minNote) * 12)
  }
  if (type === 17) {
    requireRange(bytes, offset, 8, 'Limites key-split SBNK')
    let region = -1
    for (let index = 0; index < 8; index += 1) {
      const maxNote = bytes[offset + index]
      if (maxNote === 0) break
      if (note <= maxNote) {
        region = index
        break
      }
    }
    if (region < 0) throw new Error(`La note ${note} n’appartient a aucune zone du programme SBNK ${program}.`)
    return readNestedInstrument(bytes, offset + 8 + region * 12)
  }
  throw new Error(`Type d’instrument SBNK ${type} non pris en charge pour le programme ${program}.`)
}

const imaStepTable = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31,
  34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143,
  157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658,
  724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327,
  3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289,
  16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
]
const imaIndexTable = [-1, -1, -1, -1, 2, 4, 6, 8]

function decodeAdpcm(data: Uint8Array): Float32Array {
  requireRange(data, 0, 4, 'En-tete ADPCM')
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let sample = view.getInt16(0, true)
  let stepIndex = Math.min(88, data[2])
  const output = new Float32Array(1 + (data.byteLength - 4) * 2)
  output[0] = sample / 32768
  let outputIndex = 1
  for (let index = 4; index < data.byteLength; index += 1) {
    for (const nibble of [data[index] & 0x0f, data[index] >> 4]) {
      const step = imaStepTable[stepIndex]
      let difference = step >> 3
      if (nibble & 1) difference += step >> 2
      if (nibble & 2) difference += step >> 1
      if (nibble & 4) difference += step
      sample += nibble & 8 ? -difference : difference
      sample = Math.max(-32768, Math.min(32767, sample))
      stepIndex = Math.max(0, Math.min(88, stepIndex + imaIndexTable[nibble & 7]))
      output[outputIndex] = sample / 32768
      outputIndex += 1
    }
  }
  return output
}

export function decodeSwarWave(bytes: Uint8Array, waveId: number): NitroWave {
  requireMagic(bytes, 'SWAR')
  requireRange(bytes, 0x38, 4, 'Table SWAR')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = view.getUint32(0x38, true)
  if (waveId < 0 || waveId >= count) throw new Error(`L’echantillon SWAR ${waveId} est absent.`)
  const tableOffset = 0x3c + waveId * 4
  requireRange(bytes, tableOffset, 4, `Offset SWAR ${waveId}`)
  const offset = view.getUint32(tableOffset, true)
  requireRange(bytes, offset, 12, `En-tete SWAV ${waveId}`)
  const waveType = bytes[offset]
  const loop = bytes[offset + 1] !== 0
  const sampleRate = view.getUint16(offset + 2, true)
  const loopOffsetWords = view.getUint16(offset + 6, true)
  const nonLoopLengthWords = view.getUint32(offset + 8, true)
  const dataLength = (loopOffsetWords + nonLoopLengthWords) * 4
  const dataOffset = offset + 12
  requireRange(bytes, dataOffset, dataLength, `Donnees SWAV ${waveId}`)
  const data = bytes.subarray(dataOffset, dataOffset + dataLength)
  let samples: Float32Array
  let loopStart: number
  if (waveType === 0) {
    samples = Float32Array.from(data, (value) => (value << 24 >> 24) / 128)
    loopStart = loopOffsetWords * 4
  } else if (waveType === 1) {
    if (data.byteLength % 2 !== 0) throw new Error(`L’echantillon PCM16 SWAR ${waveId} a une taille impaire.`)
    const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength)
    samples = Float32Array.from({ length: data.byteLength / 2 }, (_, index) => dataView.getInt16(index * 2, true) / 32768)
    loopStart = loopOffsetWords * 2
  } else if (waveType === 2) {
    samples = decodeAdpcm(data)
    loopStart = loopOffsetWords * 8 + 1
  } else throw new Error(`Format SWAV ${waveType} non pris en charge.`)
  if (sampleRate === 0) throw new Error(`L’echantillon SWAR ${waveId} a une frequence nulle.`)
  return { sampleRate, samples, loop, loopStart }
}