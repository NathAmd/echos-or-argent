import { describe, expect, it } from 'vitest'
import type { NitroTexturePreview } from '../../ndsTypes'
import {
  decodeHgssFollowerEmoteTimeline,
  hgssFollowerEmoteSoundId,
  sampleHgssFollowerEmote,
  type HgssFollowerEmote,
} from './followerEmotes'

const texture = (id: string): NitroTexturePreview => ({ id, name: id, width: 1, height: 1, pixels: new Uint8ClampedArray(4) })

describe('HGSS follower emotes', () => {
  it('decodes the native duration, texture and palette arrays', () => {
    const payload = new Uint8Array(20)
    const view = new DataView(payload.buffer)
    view.setUint32(0, 4, true)
    ;[0, 4, 8, 12].forEach((duration, index) => view.setUint16(4 + index * 2, duration, true))
    payload.set([0, 1, 0, 1], 12)

    expect(decodeHgssFollowerEmoteTimeline(payload, 1)).toEqual({
      durations: [0, 4, 8, 12],
      textureIndexes: [0, 1, 0, 1],
      paletteIndexes: [0, 0, 0, 0],
    })
    expect(() => decodeHgssFollowerEmoteTimeline(payload.subarray(1), 1)).toThrow('taille invalide')
    expect(() => decodeHgssFollowerEmoteTimeline(payload, 15)).toThrow('identifiant d’emote')
  })

  it('samples the native seven-frame bounce and texture timing', () => {
    const emote: HgssFollowerEmote = {
      emoteId: 1,
      textures: [texture('zero'), texture('one')],
      timeline: { durations: [0, 4, 8, 12], textureIndexes: [0, 1, 0, 1], paletteIndexes: [0, 0, 0, 0] },
      soundId: hgssFollowerEmoteSoundId,
    }
    expect(Array.from({ length: 7 }, (_, frame) => sampleHgssFollowerEmote(emote, frame).heightUnits)).toEqual([6, 10, 12, 12, 10, 6, 0])
    expect(sampleHgssFollowerEmote(emote, 7)).toMatchObject({ textureIndex: 1, complete: false })
    expect(sampleHgssFollowerEmote(emote, 10)).toMatchObject({ textureIndex: 1, complete: false })
    expect(sampleHgssFollowerEmote(emote, 11)).toMatchObject({ textureIndex: 0, complete: false })
    expect(sampleHgssFollowerEmote(emote, 19)).toMatchObject({ textureIndex: 1, complete: false })
    expect(sampleHgssFollowerEmote(emote, 33)).toMatchObject({ complete: false })
    expect(sampleHgssFollowerEmote(emote, 34)).toMatchObject({ complete: true })
  })
})
