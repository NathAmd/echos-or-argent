export type SseqNote = {
  trackId: number
  tick: number
  duration: number
  note: number
  velocity: number
  program: number
  masterVolume: number
  volume: number
  expression: number
  pan: number
  transpose: number
  pitchBend: number
  pitchBendRange: number
  attack?: number
  decay?: number
  sustain?: number
  release?: number
  sweepPitch?: number
  portamentoFromNote?: number
  portamentoTime?: number
  pitchTransitions?: SseqPitchTransition[]
}

export type SseqPitchTransition = {
  tick: number
  note: number
  transpose: number
  pitchBend: number
  pitchBendRange: number
  portamentoTime: number
}

export type SseqTempo = { tick: number, bpm: number }
export type SseqLoop = { startTick: number, endTick: number }
export type SseqTimeline = { notes: SseqNote[], tempos: SseqTempo[], endTick: number, loop?: SseqLoop }

type TrackState = {
  cursor: number
  tick: number
  program: number
  masterVolume: number
  volume: number
  expression: number
  pan: number
  transpose: number
  pitchBend: number
  pitchBendRange: number
  attack?: number
  decay?: number
  sustain?: number
  release?: number
  tie: boolean
  portamentoEnabled: boolean
  portamentoKey: number
  portamentoTime: number
  sweepPitch: number
  tiedNote?: SseqNote
  noteWait: boolean
  callStack: number[]
  loopStack: Array<{ cursor: number, startTick: number, remaining: number }>
}

function requireRange(bytes: Uint8Array, offset: number, size: number, label: string): void {
  if (offset < 0 || size < 0 || offset + size > bytes.byteLength) throw new Error(`${label} depasse les limites du SSEQ.`)
}

function readUint24(bytes: Uint8Array, offset: number): number {
  requireRange(bytes, offset, 3, 'Entier 24 bits')
  return bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16
}

function readVariableLength(bytes: Uint8Array, state: TrackState): number {
  let value = 0
  for (let count = 0; count < 4; count += 1) {
    requireRange(bytes, state.cursor, 1, 'Entier variable')
    const byte = bytes[state.cursor]
    state.cursor += 1
    value = value << 7 | byte & 0x7f
    if ((byte & 0x80) === 0) return value
  }
  throw new Error('Un entier variable SSEQ depasse quatre octets.')
}

function skip(bytes: Uint8Array, state: TrackState, size: number, command: number): void {
  requireRange(bytes, state.cursor, size, `Commande SSEQ 0x${command.toString(16)}`)
  state.cursor += size
}

export function decodeSseqTimeline(bytes: Uint8Array, maxTicks = 48 * 120): SseqTimeline {
  requireRange(bytes, 0, 0x1c, 'En-tete SSEQ')
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'SSEQ') throw new Error('Le fichier musical ROM n’est pas un SSEQ.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const dataOffset = view.getUint32(0x18, true)
  requireRange(bytes, dataOffset, 1, 'Flux DATA SSEQ')
  const trackOffsets = new Set<number>([dataOffset])
  const notes: SseqNote[] = []
  const tempos: SseqTempo[] = [{ tick: 0, bpm: 120 }]
  let endTick = 0
  let loop: SseqLoop | undefined

  let trackId = 0
  for (const trackOffset of trackOffsets) {
    const state: TrackState = {
      cursor: trackOffset,
      tick: 0,
      program: 0,
      masterVolume: 127,
      volume: 127,
      expression: 127,
      pan: 64,
      transpose: 0,
      pitchBend: 0,
      pitchBendRange: 2,
      tie: false,
      portamentoEnabled: false,
      portamentoKey: 60,
      portamentoTime: 0,
      sweepPitch: 0,
      noteWait: true,
      callStack: [],
      loopStack: [],
    }
    const commandTicks = new Map<number, number>()
    for (let commandCount = 0; commandCount < 200_000 && state.tick <= maxTicks; commandCount += 1) {
      requireRange(bytes, state.cursor, 1, 'Commande SSEQ')
      const commandOffset = state.cursor
      if (!commandTicks.has(commandOffset)) commandTicks.set(commandOffset, state.tick)
      const command = bytes[state.cursor]
      state.cursor += 1
      if (command <= 0x7f) {
        requireRange(bytes, state.cursor, 1, 'Velocite SSEQ')
        const velocity = bytes[state.cursor]
        state.cursor += 1
        const duration = readVariableLength(bytes, state)
        const tiedNoteEnd = state.tiedNote ? state.tiedNote.tick + state.tiedNote.duration : -1
        if (state.tie && state.tiedNote && tiedNoteEnd === state.tick) {
          state.tiedNote.pitchTransitions ??= []
          state.tiedNote.pitchTransitions.push({
            tick: state.tick,
            note: command,
            transpose: state.transpose,
            pitchBend: state.pitchBend,
            pitchBendRange: state.pitchBendRange,
            portamentoTime: state.portamentoEnabled ? state.portamentoTime : 0,
          })
          state.tiedNote.duration = state.tick + duration - state.tiedNote.tick
        } else {
          const note: SseqNote = {
            trackId, tick: state.tick, duration, note: command, velocity, program: state.program,
            masterVolume: state.masterVolume, volume: state.volume, expression: state.expression,
            pan: state.pan, transpose: state.transpose, pitchBend: state.pitchBend,
            pitchBendRange: state.pitchBendRange,
            ...(state.attack === undefined ? {} : { attack: state.attack }),
            ...(state.decay === undefined ? {} : { decay: state.decay }),
            ...(state.sustain === undefined ? {} : { sustain: state.sustain }),
            ...(state.release === undefined ? {} : { release: state.release }),
            ...(state.sweepPitch === 0 ? {} : { sweepPitch: state.sweepPitch }),
            ...(state.portamentoEnabled ? { portamentoFromNote: state.portamentoKey, portamentoTime: state.portamentoTime } : {}),
          }
          notes.push(note)
          state.tiedNote = state.tie ? note : undefined
        }
        state.portamentoKey = command
        if (state.noteWait) state.tick += duration
        continue
      }
      if (command === 0x80) {
        state.tick += readVariableLength(bytes, state)
        continue
      }
      if (command === 0x81) {
        state.program = readVariableLength(bytes, state)
        continue
      }
      if (command === 0x93) {
        skip(bytes, state, 1, command)
        const relativeOffset = readUint24(bytes, state.cursor)
        state.cursor += 3
        trackOffsets.add(dataOffset + relativeOffset)
        continue
      }
      if (command === 0x94) {
        const relativeOffset = readUint24(bytes, state.cursor)
        const destination = dataOffset + relativeOffset
        const loopStartTick = commandTicks.get(destination)
        if (loopStartTick !== undefined && loopStartTick < state.tick && loop === undefined) {
          loop = { startTick: loopStartTick, endTick: state.tick }
        }
        state.cursor = destination
        continue
      }
      if (command === 0x95) {
        const relativeOffset = readUint24(bytes, state.cursor)
        state.cursor += 3
        state.callStack.push(state.cursor)
        state.cursor = dataOffset + relativeOffset
        continue
      }
      if (command >= 0xb0 && command <= 0xb6) {
        skip(bytes, state, 3, command)
        continue
      }
      if (command >= 0xc0 && command <= 0xc6) {
        requireRange(bytes, state.cursor, 1, `Commande SSEQ 0x${command.toString(16)}`)
        const value = bytes[state.cursor]
        state.cursor += 1
        if (command === 0xc0) state.pan = value
        else if (command === 0xc1) state.volume = value
        else if (command === 0xc2) state.masterVolume = value
        else if (command === 0xc3) state.transpose = value << 24 >> 24
        else if (command === 0xc4) state.pitchBend = value << 24 >> 24
        else if (command === 0xc5) state.pitchBendRange = value
        continue
      }
      if (command === 0xc7 || command === 0xc8 || command === 0xc9 || (command >= 0xca && command <= 0xcf)) {
        requireRange(bytes, state.cursor, 1, `Commande SSEQ 0x${command.toString(16)}`)
        const value = bytes[state.cursor]
        state.cursor += 1
        if (command === 0xc7) state.noteWait = value !== 0
        else if (command === 0xc8) {
          state.tie = value !== 0
          if (!state.tie) state.tiedNote = undefined
        } else if (command === 0xc9) state.portamentoKey = value
        else if (command === 0xce) state.portamentoEnabled = value !== 0
        else if (command === 0xcf) state.portamentoTime = value
        continue
      }
      if (command >= 0xd0 && command <= 0xd6) {
        requireRange(bytes, state.cursor, 1, `Commande SSEQ 0x${command.toString(16)}`)
        const value = bytes[state.cursor]
        state.cursor += 1
        if (command === 0xd0) state.attack = value
        else if (command === 0xd1) state.decay = value
        else if (command === 0xd2) state.sustain = value
        else if (command === 0xd3) state.release = value
        else if (command === 0xd4) state.loopStack.push({ cursor: state.cursor, startTick: state.tick, remaining: value === 0 ? Number.POSITIVE_INFINITY : value })
        else if (command === 0xd5) state.expression = value
        continue
      }
      if (command === 0xe0) {
        skip(bytes, state, 2, command)
        continue
      }
      if (command === 0xe3) {
        requireRange(bytes, state.cursor, 2, 'Sweep pitch SSEQ')
        state.sweepPitch = view.getInt16(state.cursor, true)
        state.cursor += 2
        continue
      }
      if (command === 0xe1) {
        requireRange(bytes, state.cursor, 2, 'Tempo SSEQ')
        const bpm = view.getUint16(state.cursor, true)
        state.cursor += 2
        if (bpm === 0) throw new Error('Le tempo SSEQ ne peut pas etre nul.')
        tempos.push({ tick: state.tick, bpm })
        continue
      }
      if (command === 0xfc) {
        const activeLoop = state.loopStack.at(-1)
        if (!activeLoop) throw new Error('LoopEnd SSEQ sans LoopStart.')
        if (activeLoop.remaining === Number.POSITIVE_INFINITY && loop === undefined) {
          loop = { startTick: activeLoop.startTick, endTick: state.tick }
        }
        if (activeLoop.remaining === Number.POSITIVE_INFINITY || activeLoop.remaining > 1) {
          if (activeLoop.remaining !== Number.POSITIVE_INFINITY) activeLoop.remaining -= 1
          state.cursor = activeLoop.cursor
        } else state.loopStack.pop()
        continue
      }
      if (command === 0xfd) {
        const returnOffset = state.callStack.pop()
        if (returnOffset === undefined) throw new Error('Return SSEQ sans Call.')
        state.cursor = returnOffset
        continue
      }
      if (command === 0xfe) {
        skip(bytes, state, 2, command)
        continue
      }
      if (command === 0xff) break
      throw new Error(`Commande SSEQ 0x${command.toString(16).padStart(2, '0')} non prise en charge a l’offset ${state.cursor - 1}.`)
    }
    endTick = Math.max(endTick, state.tick)
    trackId += 1
  }

  return { notes, tempos: tempos.sort((left, right) => left.tick - right.tick), endTick, ...(loop ? { loop } : {}) }
}