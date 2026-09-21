import { describe, expect, it } from 'vitest'
import {
  HGSS_FISHING_BITE_BOUNCE_FRAMES,
  HGSS_FISHING_BITE_EFFECT_ARCHIVE_PATH,
  HGSS_FISHING_BITE_EFFECT_MODEL_MEMBER,
  HGSS_FISHING_BITE_EFFECT_RENDERER_ID,
  HGSS_FISHING_BITE_EFFECT_SOUND_FLAG,
  HGSS_FISHING_BITE_EFFECT_TEXTURE_MEMBER,
  HGSS_FISHING_BITE_EFFECT_TIMELINE_MEMBER,
  HGSS_FISHING_BITE_EFFECT_VARIANT,
  HGSS_FISHING_BITE_EFFECT_WORK_SIZE,
  HGSS_FISHING_BITE_HOLD_FRAMES,
  HGSS_FISHING_BITE_SETTLE_FRAME,
  resolveHgssFishingBiteSpawnPositionFx32,
  resolveHgssFishingBiteTrackedPositionFx32,
  sampleHgssFishingBiteEffect,
} from './hgssFishingBiteEffect'

describe('effet natif de touche de peche HGSS', () => {
  it('verrouille les ressources du variant peche sans son optionnel', () => {
    expect({
      archive: HGSS_FISHING_BITE_EFFECT_ARCHIVE_PATH,
      workSize: HGSS_FISHING_BITE_EFFECT_WORK_SIZE,
      model: HGSS_FISHING_BITE_EFFECT_MODEL_MEMBER,
      texture: HGSS_FISHING_BITE_EFFECT_TEXTURE_MEMBER,
      timeline: HGSS_FISHING_BITE_EFFECT_TIMELINE_MEMBER,
      renderer: HGSS_FISHING_BITE_EFFECT_RENDERER_ID,
      variant: HGSS_FISHING_BITE_EFFECT_VARIANT,
      soundFlag: HGSS_FISHING_BITE_EFFECT_SOUND_FLAG,
    }).toEqual({ archive: '/a/1/0/3', workSize: 0x44, model: 125, texture: 24, timeline: 140, renderer: 12, variant: 1, soundFlag: 0 })
  })

  it('reproduit les sept mises a jour de la parabole fx32', () => {
    expect(Array.from({ length: HGSS_FISHING_BITE_BOUNCE_FRAMES + 1 }, (_, frame) => (
      sampleHgssFishingBiteEffect(frame).verticalOffsetFx32 / 0x1000
    ))).toEqual([0, 6, 10, 12, 12, 10, 6, 0])
  })

  it('stabilise le flag apres les trente mises a jour de maintien sans auto-destruction', () => {
    expect(HGSS_FISHING_BITE_SETTLE_FRAME).toBe(HGSS_FISHING_BITE_BOUNCE_FRAMES + HGSS_FISHING_BITE_HOLD_FRAMES)
    expect(sampleHgssFishingBiteEffect(36)).toMatchObject({ phase: 'hold', animationComplete: false })
    expect(sampleHgssFishingBiteEffect(37)).toMatchObject({ phase: 'settled', animationComplete: true })
    expect(sampleHgssFishingBiteEffect(1000)).toMatchObject({ phase: 'settled', verticalOffsetFx32: 0, animationComplete: true })
  })

  it("conserve la frame zero car la peche n'avance pas la timeline partagee", () => {
    expect([0, 3, 4, 7, 8, 11, 12, 40].map((frame) => sampleHgssFishingBiteEffect(frame).textureAddressOffset))
      .toEqual([0, 0, 0, 0, 0, 0, 0, 0])
  })

  it('reproduit les formules initiale et suivie des vecteurs du MapObject', () => {
    expect(resolveHgssFishingBiteSpawnPositionFx32([0x1000, 0x2000, 0x3000], [0x10, 0x20, 0x30]))
      .toEqual([0x1010, 0x2020, 0x3030])
    expect(resolveHgssFishingBiteTrackedPositionFx32(
      [0x1000, 0x2000, 0x3000],
      [0x10, 0x20, 0x30],
      [0x100, 0x200, 0x300],
      [0x1000, 0x2000, 0x3000],
      0x6000,
    )).toEqual([0x2110, 0x2a220, 0x7330])
  })
})
