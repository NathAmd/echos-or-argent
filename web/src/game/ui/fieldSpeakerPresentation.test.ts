import { describe, expect, it } from 'vitest'
import type { OpeningMapPreview } from '../../ndsTypes'
import { resolveFieldSpeakerName, type FieldSpeakerCatalog } from './fieldSpeakerPresentation'

function createMap(object: { id: number, spriteId: number, type: number, scriptId: number }, id = 1): OpeningMapPreview {
  return {
    id,
    events: {
      backgroundEvents: 0,
      backgrounds: [],
      coordinateEvents: [],
      objects: [{ ...object, movement: 0, eventFlag: 0, facingDirection: 0, xRange: 0, zRange: 0, x: 0, z: 0 }],
      warps: [],
    },
  } as unknown as OpeningMapPreview
}

describe('field speaker presentation', () => {
  it('uses the exact known ROM character identity', () => {
    expect(resolveFieldSpeakerName(createMap({ id: 7, spriteId: 99, type: 0, scriptId: 1 }), 7, 'RIVAL')).toBe('Prof. Orme')
  })

  it('combines the ROM trainer class and name for both standard script ranges', () => {
    const catalog = {
      trainerCatalog: Array.from({ length: 5 }, (_, trainerClass) => ({ trainerClass })),
      trainerNames: ['', '', 'ALICE', '', 'BOB'],
      trainerClassNames: ['', '', 'KARATÉKA', '', 'TOPDRESSEUR'],
    } as FieldSpeakerCatalog

    expect(resolveFieldSpeakerName(createMap({ id: 1, spriteId: 10, type: 1, scriptId: 3001 }), 1, '', catalog)).toBe('KARATÉKA ALICE')
    expect(resolveFieldSpeakerName(createMap({ id: 1, spriteId: 10, type: 4, scriptId: 5003 }), 1, '', catalog)).toBe('TOPDRESSEUR BOB')
  })

  it('gives ordinary local NPCs a neutral role instead of hiding the speaker', () => {
    expect(resolveFieldSpeakerName(createMap({ id: 4, spriteId: 42, type: 0, scriptId: 12 }), 4, '')).toBe('Habitant')
  })

  it('does not label signs, item objects, mechanisms, or a missing actor', () => {
    expect(resolveFieldSpeakerName(createMap({ id: 4, spriteId: 80, type: 0, scriptId: 7001 }), 4, '')).toBeUndefined()
    expect(resolveFieldSpeakerName(createMap({ id: 4, spriteId: 86, type: 0, scriptId: 10000 }), 4, '')).toBeUndefined()
    expect(resolveFieldSpeakerName(createMap({ id: 4, spriteId: 42, type: 0, scriptId: 12 }), undefined, '')).toBeUndefined()
    expect(resolveFieldSpeakerName(createMap({ id: 4, spriteId: 42, type: 0, scriptId: 12 }), 9, '')).toBeUndefined()
  })
})
