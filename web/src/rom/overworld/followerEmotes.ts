import type { NitroTexturePreview } from '../../ndsTypes'

export const hgssFollowerEmoteCount = 14
export const hgssFollowerEmoteTextureBase = 2
export const hgssFollowerEmoteTimelineBase = 150
export const hgssFollowerEmoteSoundId = 1501
export const hgssFollowerEmoteEntranceHeights = [6, 10, 12, 12, 10, 6, 0] as const

export type HgssFollowerEmoteTimeline = {
  durations: readonly number[]
  textureIndexes: readonly number[]
  paletteIndexes: readonly number[]
}

export type HgssFollowerEmote = {
  emoteId: number
  textures: readonly NitroTexturePreview[]
  timeline: HgssFollowerEmoteTimeline
  soundId: typeof hgssFollowerEmoteSoundId
}

export type HgssFollowerEmoteSample = {
  complete: boolean
  textureIndex: number
  heightUnits: number
}

export function decodeHgssFollowerEmoteTimeline(payload: Uint8Array, emoteId: number): HgssFollowerEmoteTimeline {
  if (!Number.isInteger(emoteId) || emoteId < 1 || emoteId > hgssFollowerEmoteCount) {
    throw new Error(`L’identifiant d’emote follower HGSS ${emoteId} est invalide.`)
  }
  if (payload.byteLength < 8) throw new Error(`La timeline de l’emote follower HGSS ${emoteId} est tronquée.`)
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  const entryCount = view.getUint32(0, true)
  if (entryCount === 0 || 4 + entryCount * 4 !== payload.byteLength) {
    throw new Error(`La timeline de l’emote follower HGSS ${emoteId} a une taille invalide.`)
  }
  const textureIndexesOffset = 4 + entryCount * 2
  const paletteIndexesOffset = textureIndexesOffset + entryCount
  return {
    durations: Array.from({ length: entryCount }, (_, index) => view.getUint16(4 + index * 2, true)),
    textureIndexes: [...payload.subarray(textureIndexesOffset, paletteIndexesOffset)],
    paletteIndexes: [...payload.subarray(paletteIndexesOffset)],
  }
}

/** Reproduit l'entrée parabolique, la timeline texture et les deux VBlanks finales. */
export function sampleHgssFollowerEmote(emote: HgssFollowerEmote, elapsedFrames: number): HgssFollowerEmoteSample {
  if (!Number.isInteger(elapsedFrames) || elapsedFrames < 0) {
    throw new Error(`La frame d’emote follower HGSS ${elapsedFrames} est invalide.`)
  }
  if (elapsedFrames < hgssFollowerEmoteEntranceHeights.length) {
    return {
      complete: false,
      textureIndex: emote.timeline.textureIndexes[0] ?? 0,
      heightUnits: hgssFollowerEmoteEntranceHeights[elapsedFrames]!,
    }
  }
  let entryIndex = 0
  let frameCounter = 0
  let textureIndex = emote.timeline.textureIndexes[0] ?? 0
  let state: 'animation' | 'hold' | 'cleanup' = 'animation'
  let holdFrames = 0
  const animationFrames = elapsedFrames - hgssFollowerEmoteEntranceHeights.length
  for (let frame = 0; frame <= animationFrames; frame += 1) {
    if (state === 'animation') {
      frameCounter += 1
      if (frameCounter >= (emote.timeline.durations[entryIndex] ?? 0)) {
        entryIndex += 1
        frameCounter = 0
        if (entryIndex >= emote.timeline.durations.length) state = 'hold'
        else textureIndex = emote.timeline.textureIndexes[entryIndex] ?? textureIndex
      }
    } else if (state === 'hold') {
      holdFrames += 1
      if (holdFrames >= 2) state = 'cleanup'
    } else {
      return { complete: true, textureIndex, heightUnits: 0 }
    }
  }
  return { complete: false, textureIndex, heightUnits: 0 }
}
