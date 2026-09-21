import type { OpeningMapPreview, RomSoundArchive } from '../ndsTypes'
import { decodeSwarWave, resolveSbnkInstrument, type NitroInstrument, type NitroWave } from '../rom/audio/nitroSamples'
import { decodeSdat, readSdatFile } from '../rom/audio/sdat'
import { decodeSseqTimeline, type SseqLoop, type SseqTempo, type SseqTimeline } from '../rom/audio/sseq'
import { isHgssNighttime, resolveHgssTimeOfDay } from '../game/time/hgssRtc'
import { hgssVBlanksToSeconds } from '../game/time/hgssFrameTiming'
import { createRomAudioExclusiveChannel } from './romAudioExclusiveChannel'
import { createRomAudioFanfareGate } from './romAudioFanfareGate'
import { createRomAudioMusicBus } from './romAudioMusicBus'
import { createRomAudioMusicFadeController } from './romAudioMusicFade'
import { createRomAudioPlayerChannels } from './romAudioPlayerChannels'
import { createRomAudioPlaybackCompletion, type RomAudioPlaybackCompletion } from './romAudioPlaybackCompletion'

export type RomAudioRuntime = {
  playMapMusic: (map: OpeningMapPreview, date?: Date) => Promise<number>
  playMusic: (sequenceId: number) => Promise<void>
  playMusicByName: (names: readonly string[]) => Promise<number>
  stopMusic: () => void
  fadeMusic: (targetVolume: number, frames: number) => Promise<void>
  playSoundEffect: (sequenceId: number) => Promise<void>
  playPannedSoundEffect: (sequenceId: number, pan: number) => Promise<void>
  playMovingSoundEffect: (sequenceId: number, startPan: number, endPan: number, panStep: number, intervalFrames: number) => Promise<void>
  stopSoundEffect: (sequenceId: number) => void
  isSoundEffectPlaying: (sequenceId: number) => boolean
  isAnySoundEffectPlaying: () => boolean
  playFanfare: (sequenceId: number) => Promise<void>
  isFanfarePlaying: () => boolean
  playCry: (speciesId: number, pattern: number, pan?: number, volume?: number, form?: number) => Promise<void>
  playCryAndWait: (speciesId: number, pattern: number, pan?: number, volume?: number, form?: number) => Promise<void>
  isCryPlaying: () => boolean
  stop: () => void
  dispose: () => Promise<void>
}

export type ConfirmedHgssCryModulation = {
  reverse: boolean
  playbackRate: number
  chorus?: {
    reverse?: boolean
    playbackRate: number
    volumeReduction: number
    minimumVolume: number
  }
  maximumFrames?: number
  fadeFrames?: number
}

const nitroTrackPitchRatio = (pitch: number): number => 2 ** (pitch / 64 / 12)

/** Reproduit `sub_02006A0C`: seule la forme Céleste utilise la banque de cri interne 494. */
export function resolveHgssCryBankId(speciesId: number, form = 0): number {
  return speciesId === 492 && form === 1 ? 494 : speciesId
}

export function resolveConfirmedHgssCryModulation(pattern: number): ConfirmedHgssCryModulation | undefined {
  if (pattern === 0) return { reverse: false, playbackRate: 1 }
  if (pattern === 1) return { reverse: false, playbackRate: 1, maximumFrames: 20, fadeFrames: 10 }
  if (pattern === 2) return {
    reverse: false,
    playbackRate: nitroTrackPitchRatio(64),
    chorus: { playbackRate: nitroTrackPitchRatio(20), volumeReduction: 30, minimumVolume: 1 },
  }
  if (pattern === 3) return {
    reverse: false,
    playbackRate: nitroTrackPitchRatio(192),
    chorus: { playbackRate: nitroTrackPitchRatio(16), volumeReduction: 30, minimumVolume: 1 },
    maximumFrames: 30,
    fadeFrames: 10,
  }
  if (pattern === 4) return {
    reverse: true,
    playbackRate: 0x8600 / 0x8000,
    chorus: {
      reverse: true,
      playbackRate: 0x8600 / 0x8000,
      volumeReduction: 30,
      minimumVolume: 1,
    },
    maximumFrames: 15,
  }
  if (pattern === 5) return { reverse: false, playbackRate: nitroTrackPitchRatio(-224) }
  if (pattern === 6) return {
    reverse: false,
    playbackRate: nitroTrackPitchRatio(44),
    chorus: { playbackRate: nitroTrackPitchRatio(-64), volumeReduction: 30, minimumVolume: 1 },
  }
  if (pattern === 7) return {
    reverse: false,
    playbackRate: nitroTrackPitchRatio(-128),
    maximumFrames: 11,
    fadeFrames: 10,
  }
  if (pattern === 8) return {
    reverse: false,
    playbackRate: nitroTrackPitchRatio(60),
    maximumFrames: 60,
    fadeFrames: 10,
  }
  // Les handles WaveOut 14/15 ne sont pas affectes par le MoveVolume de la
  // tache d'arret. Le motif 9 s'arrete donc net a la frame 13.
  if (pattern === 9) return { reverse: true, playbackRate: 0x6800 / 0x8000, maximumFrames: 13 }
  if (pattern === 10) return {
    reverse: false,
    playbackRate: nitroTrackPitchRatio(-44),
    maximumFrames: 100,
    fadeFrames: 10,
  }
  if (pattern === 11) return { reverse: false, playbackRate: nitroTrackPitchRatio(-96) }
  if (pattern === 12) return {
    reverse: false,
    playbackRate: nitroTrackPitchRatio(-96),
    maximumFrames: 20,
    fadeFrames: 10,
  }
  if (pattern === 13) return {
    reverse: false,
    playbackRate: 1,
    chorus: { playbackRate: nitroTrackPitchRatio(20), volumeReduction: 0, minimumVolume: 0 },
  }
  if (pattern === 14) return { reverse: false, playbackRate: 1 }
  return undefined
}

export type ConfirmedHgssCryPlaybackVoice = {
  reverse: boolean
  playbackRate: number
  volume: number
  /** Panoramique Web Audio absolu; absent conserve le pan SSEQ natif. */
  stereoPan?: number
}

export type ConfirmedHgssCryPlayback = {
  renderer: 'sequence' | 'wave-out-pcm8'
  voices: readonly ConfirmedHgssCryPlaybackVoice[]
  maximumFrames?: number
  fadeFrames?: number
}

export function resolveHgssWaveOutStereoPan(requestedPan: number): number {
  // PlayCryEx effectue une division signee tronquee vers zero, puis passe la
  // valeur 0..127 a NNS_SndWaveOutSetPan.
  const waveOutPan = Math.trunc(requestedPan / 2) + 64
  return Math.max(-1, Math.min(1, (waveOutPan - 64) / 63))
}

/**
 * Construit les handles PV/CHORUS de PlayCryEx. Le plan distingue le lecteur
 * SSEQ du WaveOut PCM8 brut employe par les motifs inverses 4 et 9.
 */
export function resolveConfirmedHgssCryPlayback(
  speciesId: number,
  pattern: number,
  volume: number,
  pan = 0,
): ConfirmedHgssCryPlayback | undefined {
  // Sans enregistrement micro dans le runtime Web, PlayCry suit son fallback
  // ROM. Ces cinq motifs Chatot court-circuitent ensuite toute modulation.
  const effectivePattern = speciesId === 441 && [1, 2, 5, 11, 12].includes(pattern) ? 0 : pattern
  const modulation = resolveConfirmedHgssCryModulation(effectivePattern)
  if (!modulation) return undefined

  // Le motif 14 appelle uniquement PlayCry: pan et volume demandes sont ignores.
  if (effectivePattern === 14) {
    return {
      renderer: 'sequence',
      voices: [{ reverse: false, playbackRate: 1, volume: 127 }],
    }
  }

  const requestedStereoPan = Math.max(-1, Math.min(1, pan / 127))
  // Le motif 13 force le handle principal a 127 sans modifier son pan, puis
  // applique les pan/volume demandes au seul handle CHORUS (+20).
  if (effectivePattern === 13) {
    return {
      renderer: 'sequence',
      voices: [
        { reverse: false, playbackRate: 1, volume: 127 },
        { reverse: false, playbackRate: nitroTrackPitchRatio(20), volume, stereoPan: requestedStereoPan },
      ],
    }
  }

  const renderer = effectivePattern === 4 || effectivePattern === 9 ? 'wave-out-pcm8' : 'sequence'
  const stereoPan = renderer === 'wave-out-pcm8' ? resolveHgssWaveOutStereoPan(pan) : requestedStereoPan
  const voices: ConfirmedHgssCryPlaybackVoice[] = [{
    reverse: modulation.reverse,
    playbackRate: modulation.playbackRate,
    volume,
    stereoPan,
  }]
  if (modulation.chorus) {
    voices.push({
      reverse: modulation.chorus.reverse ?? false,
      playbackRate: modulation.chorus.playbackRate,
      volume: Math.max(volume - modulation.chorus.volumeReduction, modulation.chorus.minimumVolume),
      stereoPan,
    })
  }
  return {
    renderer,
    voices,
    ...(modulation.maximumFrames === undefined ? {} : { maximumFrames: modulation.maximumFrames }),
    ...(modulation.fadeFrames === undefined ? {} : { fadeFrames: modulation.fadeFrames }),
  }
}

type SequencePlaybackVoice = ConfirmedHgssCryPlayback['voices'][number]

type SequencePlaybackOptions = {
  reverse?: boolean
  playbackRate?: number
  maximumFrames?: number
  fadeFrames?: number
  pan?: number
  movingPan?: { end: number, step: number, intervalFrames: number }
  volume?: number
  voices?: readonly SequencePlaybackVoice[]
  route?: 'music'
}

type ScheduledSequence = {
  sources: AudioBufferSourceNode[]
  output: GainNode
  endTime: number
  /**
   * `AudioContext.currentTime` stops while a browser suspends its context
   * (lost focus, mobile power saving, autoplay policy). Native field scripts
   * must not remain trapped in WaitSE/WaitFanfare/WaitCry in that case.
   */
  wallClockEndTime: number
  completion: RomAudioPlaybackCompletion
  /** Volume ROM combine de la sequence, avant le volume BGM global. */
  nominalVolume: number
  cancelLoop?: () => void
}

export function isScheduledRomAudioPlaying(
  playback: Pick<ScheduledSequence, 'endTime' | 'wallClockEndTime'>,
  currentAudioTime: number,
  currentWallClockTime: number,
): boolean {
  return currentAudioTime < playback.endTime && currentWallClockTime < playback.wallClockEndTime
}

function tickToSeconds(tick: number, tempos: SseqTempo[]): number {
  let seconds = 0
  let previousTick = 0
  let bpm = 120
  for (const tempo of tempos) {
    if (tempo.tick > tick) break
    seconds += (tempo.tick - previousTick) * 60 / (bpm * 48)
    previousTick = tempo.tick
    bpm = tempo.bpm
  }
  return seconds + (tick - previousTick) * 60 / (bpm * 48)
}

export function resolveRomMusicLoop(timeline: SseqTimeline): SseqLoop | undefined {
  if (timeline.loop) return timeline.loop
  if (timeline.endTick <= 0 || timeline.notes.length === 0) return undefined
  return { startTick: 0, endTick: timeline.endTick }
}

function createAudioBuffer(context: AudioContext, wave: NitroWave): AudioBuffer {
  const buffer = context.createBuffer(1, wave.samples.length, wave.sampleRate)
  buffer.getChannelData(0).set(wave.samples)
  return buffer
}

const hgssWaveOutSampleRate = 0x3443

/**
 * `sub_020057AC` remet a WaveOut le fichier SWAR entier comme PCM8, et
 * `sub_02005898` en inverse tous les octets. Il ne decode pas le SWAV interne.
 */
export function decodeHgssWaveOutPcm8(bytes: Uint8Array, reverse: boolean): Float32Array {
  return Float32Array.from({ length: bytes.byteLength }, (_, index) => {
    const sourceIndex = reverse ? bytes.byteLength - index - 1 : index
    return (bytes[sourceIndex]! << 24 >> 24) / 128
  })
}

export function resolveNitroStereoPan(trackPan: number, instrumentPan: number): number {
  return Math.max(-1, Math.min(1, (trackPan + instrumentPan - 128) / 63))
}

export function resolveHgssMovingPanAutomation(startPan: number, endPan: number, panStep: number, intervalFrames: number) {
  const panDistance = Math.abs(endPan - startPan)
  const panSteps = Math.max(1, Math.ceil(panDistance / Math.max(1, Math.abs(panStep))))
  return {
    start: Math.max(-1, Math.min(1, startPan / 127)),
    end: Math.max(-1, Math.min(1, endPan / 127)),
    durationSeconds: hgssVBlanksToSeconds(panSteps * Math.max(1, intervalFrames)),
  }
}

export function resolveNitroPitchRatio(note: Pick<ReturnType<typeof decodeSseqTimeline>['notes'][number], 'pitchBend' | 'pitchBendRange'>): number {
  return 2 ** (note.pitchBend / 128 * note.pitchBendRange / 12)
}

const nitroControlRate = 192
const nitroSilenceDecibels = -723 / 10
const nitroSilenceGain = 10 ** (nitroSilenceDecibels / 20)
const nitroAttackRates = [
  0x00, 0x01, 0x05, 0x0e, 0x1a, 0x26, 0x33, 0x3f, 0x49, 0x54,
  0x5c, 0x64, 0x6d, 0x74, 0x7b, 0x7f, 0x84, 0x89, 0x8f,
] as const

function convertNitroAttack(value: number): number {
  const attack = Math.max(0, Math.min(127, Math.trunc(value)))
  return attack >= 0x6d ? nitroAttackRates[0x7f - attack]! : 0xff - attack
}

function convertNitroFall(value: number): number {
  const fall = Math.max(0, Math.min(127, Math.trunc(value)))
  if (fall === 0x7f) return 0xffff
  if (fall === 0x7e) return 0x3c00
  if (fall < 0x32) return fall * 2 + 1
  return Math.trunc(0x1e00 / (0x7e - fall))
}

function resolveNitroSustainDecibels(value: number): number {
  const sustain = Math.max(0, Math.min(127, Math.trunc(value)))
  return sustain === 0 ? nitroSilenceDecibels : Math.max(nitroSilenceDecibels, Math.round(200 * Math.log10(sustain / 127)) / 10)
}

function resolveNitroAttackTicks(value: number): number {
  const rate = convertNitroAttack(value)
  if (rate === 0xff) return Number.POSITIVE_INFINITY
  let amplitude = -723 * 128
  let ticks = 0
  while (amplitude < 0) {
    amplitude = Math.trunc(rate * amplitude / 255)
    ticks += 1
  }
  return ticks
}

export function resolveNitroEnvelope(instrument: Pick<NitroInstrument, 'attack' | 'decay' | 'sustain' | 'release'>): {
  attackSeconds: number
  decaySeconds: number
  sustainLevel: number
  releaseSeconds: number
} {
  const sustainDecibels = resolveNitroSustainDecibels(instrument.sustain)
  const sustainAttenuation = Math.abs(sustainDecibels * 10 * 128)
  const silenceAttenuation = Math.abs(nitroSilenceDecibels * 10 * 128)
  return {
    attackSeconds: resolveNitroAttackTicks(instrument.attack) / nitroControlRate,
    decaySeconds: Math.ceil(sustainAttenuation / convertNitroFall(instrument.decay)) / nitroControlRate,
    sustainLevel: 10 ** (sustainDecibels / 20),
    releaseSeconds: Math.ceil((silenceAttenuation - sustainAttenuation) / convertNitroFall(instrument.release)) / nitroControlRate,
  }
}

export function resolveNitroSweepSeconds(sweepPitch: number, portamentoTime: number, noteSeconds: number): number {
  if (sweepPitch === 0) return 0
  if (portamentoTime === 0) return noteSeconds
  const sweepFrames = Math.abs(Math.trunc(sweepPitch)) * Math.trunc(portamentoTime) ** 2 >> 11
  return sweepFrames / nitroControlRate
}

function createNoiseWave(): NitroWave {
  const samples = new Float32Array(32767)
  let shiftRegister = 0x7fff
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = shiftRegister & 1 ? 1 : -1
    const feedback = (shiftRegister ^ (shiftRegister >> 1)) & 1
    shiftRegister = shiftRegister >> 1 | feedback << 14
  }
  return { sampleRate: 32768, samples, loop: true, loopStart: 0 }
}

function createPsgWave(duty: number, rootNote: number): NitroWave {
  if (duty < 0 || duty > 7) throw new Error(`Rapport cyclique PSG ROM ${duty} invalide.`)
  const sampleRate = 32768
  const frequency = 440 * 2 ** ((rootNote - 69) / 12)
  const periodLength = Math.max(8, Math.round(sampleRate / frequency))
  const highSamples = Math.max(1, Math.round(periodLength * (duty + 1) / 8))
  const samples = Float32Array.from({ length: periodLength }, (_, index) => index < highSamples ? 1 : -1)
  return { sampleRate, samples, loop: true, loopStart: 0 }
}

export function createRomAudioRuntime(soundArchive: RomSoundArchive): RomAudioRuntime {
  const sdat = decodeSdat(soundArchive.bytes)
  let context: AudioContext | undefined
  const musicBus = createRomAudioMusicBus()
  const musicFade = createRomAudioMusicFadeController()
  const waveCache = new Map<string, { buffer: AudioBuffer, reversedBuffer?: AudioBuffer, wave: NitroWave }>()
  const waveOutCache = new Map<string, AudioBuffer>()

  const stopSources = (sources: AudioBufferSourceNode[], channelOutput?: GainNode): void => {
    for (const source of sources) {
      try {
        source.stop()
      } catch {
        // A source that already ended cannot be stopped again.
      }
      source.disconnect()
    }
    channelOutput?.disconnect()
  }

  const resolveSequenceDestination = (playbackContext: AudioContext, route?: 'music'): AudioNode => {
    if (route !== 'music') return playbackContext.destination
    return musicBus.route(playbackContext)
  }

  const scheduleWaveOutCry = async (
    waveArchiveId: number,
    playback: ConfirmedHgssCryPlayback,
  ): Promise<ScheduledSequence> => {
    if (playback.renderer !== 'wave-out-pcm8') {
      throw new Error('Un plan de cri SSEQ ne peut pas etre lu par WaveOut.')
    }
    const waveArchive = sdat.waveArchives[waveArchiveId]
    if (!waveArchive) throw new Error(`La wave archive de cri ROM ${waveArchiveId} est absente.`)
    const waveArchiveBytes = readSdatFile(sdat, waveArchive.fileId, 'SWAR')
    const playbackContext = context ??= new AudioContext()
    await playbackContext.resume()
    if (context !== playbackContext || playbackContext.state === 'closed') {
      throw new Error(`La lecture WaveOut du cri ROM ${waveArchiveId} a ete interrompue.`)
    }

    const output = playbackContext.createGain()
    const sources: AudioBufferSourceNode[] = []
    try {
      output.gain.value = 1
      output.connect(playbackContext.destination)
      const startTime = playbackContext.currentTime + 0.05
      const maximumEndTime = playback.maximumFrames === undefined
        ? Number.POSITIVE_INFINITY
        : startTime + hgssVBlanksToSeconds(playback.maximumFrames)
      let endTime = startTime

      for (const voice of playback.voices) {
        const cacheKey = `${waveArchiveId}:${voice.reverse ? 'reverse' : 'forward'}`
        let buffer = waveOutCache.get(cacheKey)
        if (!buffer) {
          const samples = decodeHgssWaveOutPcm8(waveArchiveBytes, voice.reverse)
          buffer = playbackContext.createBuffer(1, samples.length, hgssWaveOutSampleRate)
          buffer.getChannelData(0).set(samples)
          waveOutCache.set(cacheKey, buffer)
        }
        const voiceEndTime = Math.min(maximumEndTime, startTime + buffer.duration / voice.playbackRate)
        if (voiceEndTime <= startTime) continue
        const source = playbackContext.createBufferSource()
        source.buffer = buffer
        source.playbackRate.setValueAtTime(voice.playbackRate, startTime)
        const gain = playbackContext.createGain()
        gain.gain.setValueAtTime(voice.volume / 127, startTime)
        const pan = playbackContext.createStereoPanner()
        pan.pan.setValueAtTime(voice.stereoPan ?? 0, startTime)
        source.connect(gain).connect(pan).connect(output)
        sources.push(source)
        source.addEventListener('ended', () => {
          const sourceIndex = sources.indexOf(source)
          if (sourceIndex >= 0) sources.splice(sourceIndex, 1)
          source.disconnect()
          gain.disconnect()
          pan.disconnect()
        }, { once: true })
        source.start(startTime)
        source.stop(voiceEndTime)
        endTime = Math.max(endTime, voiceEndTime)
      }

      const wallClockEndTime = performance.now() + Math.max(0, endTime - playbackContext.currentTime) * 1000 + 100
      const completion = createRomAudioPlaybackCompletion(
        sources.length,
        Math.max(0, wallClockEndTime - performance.now()),
        Math.max(0, endTime - playbackContext.currentTime) * 1000,
      )
      for (const source of sources) source.addEventListener('ended', completion.markSourceEnded, { once: true })
      return { sources, output, endTime, wallClockEndTime, completion, nominalVolume: 1 }
    } catch (error) {
      stopSources(sources, output)
      throw error
    }
  }

  const scheduleSequence = async (
    sequenceId: number,
    bankIdOverride?: number,
    options?: SequencePlaybackOptions,
  ): Promise<ScheduledSequence> => {
    const sequence = sdat.sequences[sequenceId]
    if (!sequence) throw new Error(`La sequence sonore ROM ${sequenceId} est absente.`)
    const bankId = bankIdOverride ?? sequence.bankId
    const bank = sdat.banks[bankId]
    if (!bank) throw new Error(`La banque sonore ROM ${bankId} est absente.`)
    const sequenceBytes = readSdatFile(sdat, sequence.fileId, 'SSEQ')
    const bankBytes = readSdatFile(sdat, bank.fileId, 'SBNK')
    const timeline = decodeSseqTimeline(sequenceBytes, 48 * 128 * 4)
    const playbackContext = context ??= new AudioContext()
    await playbackContext.resume()
    // `dispose()` detache le contexte avant de le fermer. Une initialisation
    // qui reprend ensuite ne doit creer aucun noeud dans cet ancien contexte.
    if (context !== playbackContext || playbackContext.state === 'closed') {
      throw new Error(`La lecture de la sequence ROM ${sequenceId} a ete interrompue.`)
    }
    const sequenceOutput = playbackContext.createGain()
    const sources: AudioBufferSourceNode[] = []
    try {
      // Plusieurs motifs jouent les handles PV et CHORUS avec deux volumes
      // distincts. Leur volume vit donc sur chaque voix; ce gain commun garde
      // le volume SDAT et porte le fondu natif commun aux handles SSEQ.
      const outputVolume = sequence.volume / 127 * (options?.voices ? 1 : (options?.volume ?? 127) / 127)
      sequenceOutput.gain.value = outputVolume
      sequenceOutput.connect(resolveSequenceDestination(playbackContext, options?.route))
      const startTime = playbackContext.currentTime + 0.05
      const maximumEndTime = options?.maximumFrames === undefined
        ? Number.POSITIVE_INFINITY
        : startTime + hgssVBlanksToSeconds(options.maximumFrames)
      if (options?.fadeFrames !== undefined && Number.isFinite(maximumEndTime)) {
        const fadeStartTime = Math.max(startTime, maximumEndTime - hgssVBlanksToSeconds(options.fadeFrames))
        sequenceOutput.gain.setValueAtTime(outputVolume, fadeStartTime)
        sequenceOutput.gain.linearRampToValueAtTime(0, maximumEndTime)
      }
      let endTime = startTime
      const sequenceLoop = options?.route === 'music' ? resolveRomMusicLoop(timeline) : undefined

      const scheduleNote = (note: typeof timeline.notes[number], timeOffset = 0, voice?: SequencePlaybackVoice): void => {
        // SSEQ transpose is applied before a drum/key-split SBNK lookup on the
        // Nitro sequencer. Looking up the untransposed command note selected no
        // region for valid ROM tracks (for example note 28 in bank program 39).
        const effectiveNote = note.note + note.transpose
        const instrument = resolveSbnkInstrument(bankBytes, note.program, effectiveNote)
        const waveArchiveId = instrument.type === 'pcm' ? bank.waveArchiveIds[instrument.waveArchiveSlot] : undefined
        if (instrument.type === 'pcm' && waveArchiveId === undefined) throw new Error(`Le slot SWAR ${instrument.waveArchiveSlot} du programme ${note.program} est absent.`)
        const waveArchive = waveArchiveId === undefined ? undefined : sdat.waveArchives[waveArchiveId]
        if (waveArchiveId !== undefined && !waveArchive) throw new Error(`La wave archive ROM ${waveArchiveId} est absente.`)
        const waveKey = instrument.type === 'noise'
          ? 'psg-noise'
          : instrument.type === 'psg'
            ? `psg-square:${instrument.waveId}:${instrument.rootNote}`
            : `${waveArchiveId}:${instrument.waveId}`
        let cachedWave = waveCache.get(waveKey)
        if (!cachedWave) {
          const wave = instrument.type === 'noise'
            ? createNoiseWave()
            : instrument.type === 'psg'
              ? createPsgWave(instrument.waveId, instrument.rootNote)
              : decodeSwarWave(readSdatFile(sdat, waveArchive!.fileId, 'SWAR'), instrument.waveId)
          cachedWave = { wave, buffer: createAudioBuffer(playbackContext, wave) }
          waveCache.set(waveKey, cachedWave)
        }

        const noteStart = startTime + tickToSeconds(note.tick, timeline.tempos) + timeOffset
        const noteEnd = Math.min(maximumEndTime, startTime + tickToSeconds(note.tick + note.duration, timeline.tempos) + timeOffset)
        if (noteStart >= noteEnd) return
        const source = playbackContext.createBufferSource()
        const reverse = voice?.reverse ?? options?.reverse ?? false
        if (reverse) {
          if (!cachedWave.reversedBuffer) {
            const reversedBuffer = playbackContext.createBuffer(cachedWave.buffer.numberOfChannels, cachedWave.buffer.length, cachedWave.buffer.sampleRate)
            for (let channel = 0; channel < cachedWave.buffer.numberOfChannels; channel += 1) {
              reversedBuffer.copyToChannel(Float32Array.from(cachedWave.buffer.getChannelData(channel)).reverse(), channel)
            }
            cachedWave.reversedBuffer = reversedBuffer
          }
          source.buffer = cachedWave.reversedBuffer
        } else source.buffer = cachedWave.buffer
        const playbackRateScale = voice?.playbackRate ?? options?.playbackRate ?? 1
        const targetPlaybackRate = 2 ** ((effectiveNote - instrument.rootNote) / 12)
          * resolveNitroPitchRatio(note)
          * playbackRateScale
        const initialSweepPitch = (note.sweepPitch ?? 0) + (note.portamentoFromNote === undefined ? 0 : (note.portamentoFromNote - note.note) * 64)
        const sweepSeconds = Math.min(
          noteEnd - noteStart,
          resolveNitroSweepSeconds(initialSweepPitch, note.portamentoTime ?? 0, noteEnd - noteStart),
        )
        source.playbackRate.setValueAtTime(targetPlaybackRate * 2 ** (initialSweepPitch / 64 / 12), noteStart)
        if (sweepSeconds > 0) source.playbackRate.exponentialRampToValueAtTime(targetPlaybackRate, noteStart + sweepSeconds)
        else source.playbackRate.setValueAtTime(targetPlaybackRate, noteStart)
        let previousTransitionNote = note.note
        for (const transition of note.pitchTransitions ?? []) {
          const transitionTime = startTime + tickToSeconds(transition.tick, timeline.tempos) + timeOffset
          const transitionEffectiveNote = transition.note + transition.transpose
          const transitionRate = 2 ** ((transitionEffectiveNote - instrument.rootNote) / 12)
            * resolveNitroPitchRatio(transition)
            * playbackRateScale
          const transitionSweepPitch = (previousTransitionNote - transition.note) * 64
          const transitionSweepSeconds = Math.min(
            noteEnd - transitionTime,
            resolveNitroSweepSeconds(transitionSweepPitch, transition.portamentoTime, noteEnd - transitionTime),
          )
          source.playbackRate.setValueAtTime(2 ** ((previousTransitionNote + transition.transpose - instrument.rootNote) / 12) * resolveNitroPitchRatio(transition) * playbackRateScale, transitionTime)
          if (transitionSweepSeconds > 0) source.playbackRate.exponentialRampToValueAtTime(transitionRate, transitionTime + transitionSweepSeconds)
          else source.playbackRate.setValueAtTime(transitionRate, transitionTime)
          previousTransitionNote = transition.note
        }
        source.loop = cachedWave.wave.loop && !reverse
        if (source.loop) {
          source.loopStart = cachedWave.wave.loopStart / cachedWave.wave.sampleRate
          source.loopEnd = cachedWave.wave.samples.length / cachedWave.wave.sampleRate
        }
        const gain = playbackContext.createGain()
        const noteGain = note.velocity / 127 * note.masterVolume / 127 * note.volume / 127 * note.expression / 127
          * (voice?.volume ?? 127) / 127
        const envelope = resolveNitroEnvelope({
          attack: note.attack ?? instrument.attack,
          decay: note.decay ?? instrument.decay,
          sustain: note.sustain ?? instrument.sustain,
          release: note.release ?? instrument.release,
        })
        const attackEnd = Math.min(noteEnd, noteStart + envelope.attackSeconds)
        const decayEnd = Math.min(noteEnd, attackEnd + envelope.decaySeconds)
        const releaseEnd = Math.min(maximumEndTime, noteEnd + envelope.releaseSeconds)
        if (noteGain === 0) {
          // Web Audio refuse une cible nulle sur une rampe exponentielle.
          gain.gain.setValueAtTime(0, noteStart)
        } else {
          gain.gain.setValueAtTime(noteGain * nitroSilenceGain, noteStart)
          if (Number.isFinite(envelope.attackSeconds)) gain.gain.exponentialRampToValueAtTime(noteGain, attackEnd)
          if (decayEnd > attackEnd) gain.gain.exponentialRampToValueAtTime(noteGain * Math.max(nitroSilenceGain, envelope.sustainLevel), decayEnd)
          gain.gain.cancelAndHoldAtTime(noteEnd)
          if (releaseEnd > noteEnd) gain.gain.exponentialRampToValueAtTime(noteGain * nitroSilenceGain, releaseEnd)
        }
        const pan = playbackContext.createStereoPanner()
        const initialPan = voice?.stereoPan
          ?? (options?.pan !== undefined
            ? Math.max(-1, Math.min(1, options.pan / 127))
            : resolveNitroStereoPan(note.pan, instrument.pan))
        if (options?.movingPan) {
          const automation = resolveHgssMovingPanAutomation(options.pan ?? 0, options.movingPan.end, options.movingPan.step, options.movingPan.intervalFrames)
          pan.pan.setValueAtTime(automation.start, startTime)
          pan.pan.linearRampToValueAtTime(automation.end, Math.min(noteEnd, startTime + automation.durationSeconds))
        } else pan.pan.setValueAtTime(initialPan, noteStart)
        source.connect(gain).connect(pan).connect(sequenceOutput)
        sources.push(source)
        source.addEventListener('ended', () => {
          const sourceIndex = sources.indexOf(source)
          if (sourceIndex >= 0) sources.splice(sourceIndex, 1)
          source.disconnect()
          gain.disconnect()
          pan.disconnect()
        }, { once: true })
        source.start(noteStart)
        source.stop(releaseEnd)
        endTime = Math.max(endTime, releaseEnd)
      }

      const scheduleVoices = (note: typeof timeline.notes[number], timeOffset = 0): void => {
        if (options?.voices) {
          // Toutes les voix reutilisent strictement le meme startTime.
          for (const voice of options.voices) scheduleNote(note, timeOffset, voice)
        } else scheduleNote(note, timeOffset)
      }
      const initialNotes = sequenceLoop
        ? timeline.notes.filter((note) => note.tick < sequenceLoop.endTick)
        : timeline.notes
      for (const note of initialNotes) scheduleVoices(note)
      endTime = Math.max(
        endTime,
        Math.min(maximumEndTime, startTime + tickToSeconds(sequenceLoop?.endTick ?? timeline.endTick, timeline.tempos)),
      )
      // Keep a monotonic real-time deadline alongside the Web Audio clock. The
      // small grace period covers scheduling jitter without extending gameplay
      // waits noticeably.
      const wallClockEndTime = performance.now() + Math.max(0, endTime - playbackContext.currentTime) * 1000 + 100
      const completion = createRomAudioPlaybackCompletion(
        sources.length,
        Math.max(0, wallClockEndTime - performance.now()),
        Math.max(0, endTime - playbackContext.currentTime) * 1000,
      )
      for (const source of sources) source.addEventListener('ended', completion.markSourceEnded, { once: true })
      let cancelLoop: (() => void) | undefined
      if (sequenceLoop) {
        const loopStartSeconds = tickToSeconds(sequenceLoop.startTick, timeline.tempos)
        const loopEndSeconds = tickToSeconds(sequenceLoop.endTick, timeline.tempos)
        const loopDurationSeconds = loopEndSeconds - loopStartSeconds
        const loopNotes = timeline.notes.filter((note) => note.tick >= sequenceLoop.startTick && note.tick < sequenceLoop.endTick)
        if (loopDurationSeconds > 0 && loopNotes.length > 0) {
          let cancelled = false
          let nextIteration = 1
          let timer: ReturnType<typeof setTimeout> | undefined
          const armNextLoop = (): void => {
            const loopStartTime = startTime + loopStartSeconds + nextIteration * loopDurationSeconds
            const delayMilliseconds = Math.max(0, loopStartTime - playbackContext.currentTime - 1) * 1000
            timer = setTimeout(() => {
              if (cancelled || context !== playbackContext || playbackContext.state === 'closed') return
              const timeOffset = nextIteration * loopDurationSeconds
              for (const note of loopNotes) scheduleVoices(note, timeOffset)
              nextIteration += 1
              armNextLoop()
            }, delayMilliseconds)
          }
          armNextLoop()
          cancelLoop = () => {
            cancelled = true
            if (timer !== undefined) clearTimeout(timer)
          }
        }
      }
      return {
        sources,
        output: sequenceOutput,
        endTime: sequenceLoop ? Number.POSITIVE_INFINITY : endTime,
        wallClockEndTime: sequenceLoop ? Number.POSITIVE_INFINITY : wallClockEndTime,
        completion,
        nominalVolume: outputVolume,
        ...(cancelLoop ? { cancelLoop } : {}),
      }
    } catch (error) {
      stopSources(sources, sequenceOutput)
      throw error
    }
  }

  const releaseScheduledSequence = (scheduled: ScheduledSequence): void => {
    scheduled.cancelLoop?.()
    scheduled.completion.finish()
    stopSources(scheduled.sources, scheduled.output)
  }

  type ScheduledMusic = ScheduledSequence & { sequenceId: number }
  const musicChannel = createRomAudioExclusiveChannel<ScheduledMusic>(releaseScheduledSequence)
  const fanfareChannel = createRomAudioExclusiveChannel<ScheduledSequence>(releaseScheduledSequence)
  const cryChannel = createRomAudioExclusiveChannel<ScheduledSequence>(releaseScheduledSequence)
  const soundEffectPlayers = createRomAudioPlayerChannels<ScheduledSequence>(releaseScheduledSequence)
  const stopMusic = (): void => {
    musicFade.cancel()
    musicChannel.stop()
  }

  const soundEffectPlayerId = (sequenceId: number): number | undefined => sdat.sequences[sequenceId]?.playerId

  const playSequence = async (sequenceId: number): Promise<void> => {
    const currentMusic = musicChannel.peek()
    if (currentMusic?.sequenceId === sequenceId && context
      && isScheduledRomAudioPlaying(currentMusic, context.currentTime, performance.now())) {
      await context.resume()
      return
    }
    musicFade.cancel()
    await musicChannel.replace(async () => ({ ...await scheduleSequence(sequenceId, undefined, { route: 'music' }), sequenceId }))
  }

  const playMusicByName = async (names: readonly string[]): Promise<number> => {
    const sequenceId = names
      .map((name) => sdat.sequenceNames.findIndex((candidate) => candidate === name))
      .find((index) => index >= 0)
    if (sequenceId === undefined) throw new Error(`Aucune des séquences ROM ${names.join(', ')} n’est présente.`)
    await playSequence(sequenceId)
    return sequenceId
  }

  const stopSoundEffect = (sequenceId: number): void => {
    const playerId = soundEffectPlayerId(sequenceId)
    if (playerId !== undefined) soundEffectPlayers.stop(playerId, sequenceId)
  }

  const playFiniteSoundEffect = async (sequenceId: number, pan?: number): Promise<void> => {
    const playerId = soundEffectPlayerId(sequenceId)
    if (playerId === undefined) throw new Error(`La sequence sonore ROM ${sequenceId} est absente.`)
    const lease = await soundEffectPlayers.play(
      playerId,
      sequenceId,
      () => scheduleSequence(sequenceId, undefined, pan === undefined ? undefined : { pan }),
    )
    if (!lease) return
    await lease.playback.completion.finished
    soundEffectPlayers.finish(lease)
  }

  const playSoundEffect = (sequenceId: number): Promise<void> => playFiniteSoundEffect(sequenceId)

  const playPannedSoundEffect = (sequenceId: number, pan: number): Promise<void> => {
    if (!Number.isInteger(pan) || pan < -127 || pan > 127) return Promise.reject(new Error(`Le panoramique d'effet sonore HGSS ${pan} est invalide.`))
    return playFiniteSoundEffect(sequenceId, pan)
  }

  const playMovingSoundEffect = (sequenceId: number, startPan: number, endPan: number, panStep: number, intervalFrames: number): Promise<void> => {
    if (![startPan, endPan].every((pan) => Number.isInteger(pan) && pan >= -127 && pan <= 127)) {
      return Promise.reject(new Error(`Le panoramique mobile HGSS ${startPan} -> ${endPan} est invalide.`))
    }
    if (!Number.isInteger(panStep) || panStep === 0 || !Number.isInteger(intervalFrames) || intervalFrames <= 0) {
      return Promise.reject(new Error(`Le pas de panoramique mobile HGSS ${panStep}/${intervalFrames} est invalide.`))
    }
    const playerId = soundEffectPlayerId(sequenceId)
    if (playerId === undefined) return Promise.reject(new Error(`La sequence sonore ROM ${sequenceId} est absente.`))
    return soundEffectPlayers.play(
      playerId,
      sequenceId,
      () => scheduleSequence(sequenceId, undefined, { pan: startPan, movingPan: { end: endPan, step: panStep, intervalFrames } }),
    ).then(async (lease) => {
      if (!lease) return
      await lease.playback.completion.finished
      soundEffectPlayers.finish(lease)
    })
  }

  const isSoundEffectPlaying = (sequenceId: number): boolean => {
    const playerId = soundEffectPlayerId(sequenceId)
    if (playerId === undefined || !soundEffectPlayers.isOccupied(playerId)) return false
    const lease = soundEffectPlayers.current(playerId)
    // WaitSE execute juste apres PlaySE doit voir le player reserve meme si
    // AudioContext.resume() n'a pas encore termine.
    if (!lease) return true
    if (context && isScheduledRomAudioPlaying(lease.playback, context.currentTime, performance.now())) return true
    soundEffectPlayers.finish(lease)
    return false
  }

  const isAnySoundEffectPlaying = soundEffectPlayers.hasOccupiedPlayer

  const fanfareGate = createRomAudioFanfareGate({
    graceMilliseconds: hgssVBlanksToSeconds(15) * 1000,
    setMusicMuted: musicBus.setMuted,
  })

  const stopFanfare = (): void => {
    fanfareGate.stop()
    fanfareChannel.stop()
  }

  const playFanfare = async (sequenceId: number): Promise<void> => {
    const gateSession = fanfareGate.begin()
    let scheduled: ScheduledSequence | undefined
    try {
      scheduled = await fanfareChannel.replace(() => scheduleSequence(sequenceId))
    } catch (error) {
      gateSession.fail()
      throw error
    }
    if (!scheduled || !gateSession.markPlaying()) return
    const activeScheduled = scheduled
    void activeScheduled.completion.finished.then(() => {
      gateSession.beginGrace(() => { fanfareChannel.releaseIfCurrent(activeScheduled) })
    })
  }

  const isFanfarePlaying = (): boolean => {
    if (!fanfareGate.isPlaying()) return false
    if (fanfareGate.getPhase() !== 'playing') return true
    const scheduled = fanfareChannel.peek()
    if (!scheduled || !context) {
      stopFanfare()
      return false
    }
    if (isScheduledRomAudioPlaying(scheduled, context.currentTime, performance.now())) return true
    // Declenche la meme transition de grace si le polling monotone precede
    // l'evenement ended Web Audio (contexte suspendu ou onglet masque).
    scheduled.completion.finish()
    return true
  }

  const startCry = async (speciesId: number, pattern: number, pan: number, volume: number, form: number): Promise<ScheduledSequence | undefined> => {
    if (!Number.isInteger(speciesId) || speciesId < 1 || speciesId > 493) {
      throw new Error(`L’espèce ROM ${speciesId} demandée pour PlayCry est invalide.`)
    }
    if (!Number.isInteger(pan) || pan < -127 || pan > 127) throw new Error(`Le panoramique de cri HGSS ${pan} est invalide.`)
    if (!Number.isInteger(volume) || volume < 0 || volume > 127) throw new Error(`Le volume de cri HGSS ${volume} est invalide.`)
    if (!Number.isInteger(form) || form < 0 || form > 0xff) throw new Error(`La forme de cri HGSS ${form} est invalide.`)
    const playback = resolveConfirmedHgssCryPlayback(speciesId, pattern, volume, pan)
    if (!playback) throw new Error(`Le motif de cri HGSS ${pattern} n’est pas reproduit par la ROM.`)
    const cryBankId = resolveHgssCryBankId(speciesId, form)
    const scheduled = await cryChannel.replace(() => playback.renderer === 'wave-out-pcm8'
      ? scheduleWaveOutCry(cryBankId, playback)
      : scheduleSequence(2, cryBankId, playback))
    if (scheduled) void scheduled.completion.finished.then(() => { cryChannel.releaseIfCurrent(scheduled) })
    return scheduled
  }

  const playCry = async (speciesId: number, pattern: number, pan = 0, volume = 127, form = 0): Promise<void> => {
    await startCry(speciesId, pattern, pan, volume, form)
  }

  const playCryAndWait = async (speciesId: number, pattern: number, pan = 0, volume = 127, form = 0): Promise<void> => {
    const scheduled = await startCry(speciesId, pattern, pan, volume, form)
    await scheduled?.completion.finished
  }

  const isCryPlaying = (): boolean => {
    const scheduled = cryChannel.peek()
    if (!scheduled || !context) return false
    if (isScheduledRomAudioPlaying(scheduled, context.currentTime, performance.now())) return true
    cryChannel.releaseIfCurrent(scheduled)
    return false
  }

  const stop = (): void => {
    stopMusic()
    soundEffectPlayers.stopAll()
    stopFanfare()
    cryChannel.stop()
  }

  const playMapMusic = async (map: OpeningMapPreview, date = new Date()): Promise<number> => {
    const sequenceId = isHgssNighttime(resolveHgssTimeOfDay(date)) ? map.header.nightMusicId : map.header.dayMusicId
    await playSequence(sequenceId)
    return sequenceId
  }

  const fadeMusic = async (targetVolume: number, frames: number): Promise<void> => {
    const music = musicChannel.peek()
    if (!music) throw new Error('Aucune musique ROM n’est active pour le fondu.')
    await musicFade.fade(music, targetVolume, frames, () => musicChannel.peek() === music)
  }

  const dispose = async (): Promise<void> => {
    stop()
    const disposedContext = context
    context = undefined
    musicBus.disconnect()
    waveCache.clear()
    waveOutCache.clear()
    if (disposedContext) await disposedContext.close()
  }

  return { playMapMusic, playMusic: playSequence, playMusicByName, stopMusic, fadeMusic, playSoundEffect, playPannedSoundEffect, playMovingSoundEffect, stopSoundEffect, isSoundEffectPlaying, isAnySoundEffectPlaying, playFanfare, isFanfarePlaying, playCry, playCryAndWait, isCryPlaying, stop, dispose }
}
