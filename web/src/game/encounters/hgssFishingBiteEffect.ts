import type { NitroModelPreview, NitroTexturePreview } from '../../ndsTypes'

export const HGSS_FISHING_BITE_EFFECT_ARCHIVE_PATH = '/a/1/0/3' as const
export const HGSS_FISHING_BITE_EFFECT_WORK_SIZE = 0x44 as const
export const HGSS_FISHING_BITE_EFFECT_MODEL_MEMBER = 0x7d as const
export const HGSS_FISHING_BITE_EFFECT_TEXTURE_MEMBER = 0x18 as const
export const HGSS_FISHING_BITE_EFFECT_TIMELINE_MEMBER = 0x8c as const
export const HGSS_FISHING_BITE_EFFECT_RENDERER_ID = 12 as const
export const HGSS_FISHING_BITE_EFFECT_VARIANT = 1 as const
export const HGSS_FISHING_BITE_EFFECT_SOUND_FLAG = 0 as const

export const HGSS_FX32_ONE = 0x1000 as const
export const HGSS_FISHING_BITE_TRACKED_Y_OFFSET_FX32 = 0x20000 as const
export const HGSS_FISHING_BITE_TRACKED_Z_OFFSET_FX32 = 0x1000 as const
export const HGSS_FISHING_BITE_INITIAL_VELOCITY_FX32 = 0x6000 as const
export const HGSS_FISHING_BITE_GRAVITY_FX32 = -0x2000 as const
export const HGSS_FISHING_BITE_BOUNCE_FRAMES = 7 as const
export const HGSS_FISHING_BITE_HOLD_FRAMES = 30 as const
export const HGSS_FISHING_BITE_SETTLE_FRAME = 37 as const
export const HGSS_FISHING_BITE_TEXTURE_ADDRESS_UNIT_BYTES = 8 as const

export const HGSS_FISHING_BITE_RESOURCE_TIMELINE = {
  keyFrames: [0, 4, 8, 12],
  textureAddressOffsets: [0, 1, 2, 3],
  paletteAddressOffsets: [0, 0, 0, 0],
} as const

export type HgssFishingBiteEffectTimeline = {
  keyFrames: number[]
  textureAddressOffsets: number[]
  paletteAddressOffsets: number[]
}

export type HgssFishingBiteEffectAsset = {
  model: NitroModelPreview
  /** Texture BTX originale du membre 24. */
  texture: NitroTexturePreview
  timeline: HgssFishingBiteEffectTimeline
}

export type HgssFishingBiteEffectPhase = 'bounce' | 'hold' | 'settled'

export type HgssFishingBiteEffectSample = {
  phase: HgssFishingBiteEffectPhase
  /** Offset local ajoute a Y, dans l'unite fx32 native (FX32_ONE = 0x1000). */
  verticalOffsetFx32: number
  textureAddressOffset: number
  paletteAddressOffset: number
  /** Le flag natif passe a 1, mais l'effet attend toujours un retrait externe. */
  animationComplete: boolean
}

export type HgssFishingBiteVectorFx32 = readonly [x: number, y: number, z: number]

function requireFrame(frame: number): number {
  if (!Number.isInteger(frame) || frame < 0) throw new Error(`La frame de l'effet de peche HGSS ${frame} est invalide.`)
  return frame
}

function requireVector(vector: HgssFishingBiteVectorFx32): void {
  if (vector.some((component) => !Number.isInteger(component))) {
    throw new Error(`Le vecteur fx32 de l'effet de peche HGSS [${vector.join(', ')}] est invalide.`)
  }
}

function sampleTextureAddress(): { textureAddressOffset: number, paletteAddressOffset: number } {
  // Le renderer est cree avec sa frame a zero et ov01_02200614 ne fait jamais
  // l'appel sub_02023F04 qui avancerait cette timeline partagee.
  return {
    textureAddressOffset: HGSS_FISHING_BITE_RESOURCE_TIMELINE.textureAddressOffsets[0],
    paletteAddressOffset: HGSS_FISHING_BITE_RESOURCE_TIMELINE.paletteAddressOffsets[0],
  }
}

/**
 * Reproduit ov01_02200614 apres `elapsedUpdates` callbacks de mise a jour.
 * Le rebond prend sept callbacks, puis le compteur attend trente callbacks.
 * L'effet ne s'auto-detruit pas une fois stabilise.
 */
export function sampleHgssFishingBiteEffect(elapsedUpdates: number): HgssFishingBiteEffectSample {
  const frame = requireFrame(elapsedUpdates)
  let verticalOffsetFx32 = 0
  let velocityFx32: number = HGSS_FISHING_BITE_INITIAL_VELOCITY_FX32
  const bounceUpdates = Math.min(frame, HGSS_FISHING_BITE_BOUNCE_FRAMES)
  for (let update = 0; update < bounceUpdates; update += 1) {
    verticalOffsetFx32 += velocityFx32
    if (verticalOffsetFx32 === 0) velocityFx32 = 0
    else velocityFx32 += HGSS_FISHING_BITE_GRAVITY_FX32
  }
  const textureAddress = sampleTextureAddress()
  return {
    phase: frame < HGSS_FISHING_BITE_BOUNCE_FRAMES
      ? 'bounce'
      : frame < HGSS_FISHING_BITE_SETTLE_FRAME
        ? 'hold'
        : 'settled',
    verticalOffsetFx32,
    ...textureAddress,
    animationComplete: frame >= HGSS_FISHING_BITE_SETTLE_FRAME,
  }
}

/** Position initiale passee a ov01_021F1620 : position + facingVector. */
export function resolveHgssFishingBiteSpawnPositionFx32(
  position: HgssFishingBiteVectorFx32,
  facingVector: HgssFishingBiteVectorFx32,
): HgssFishingBiteVectorFx32 {
  requireVector(position)
  requireVector(facingVector)
  return position.map((component, index) => component + facingVector[index]!) as unknown as HgssFishingBiteVectorFx32
}

/**
 * Position suivie a chaque callback : position + facingVector + unk88 + unk94,
 * puis Y += 0x20000, Z += 0x1000 et enfin le rebond local sur Y.
 */
export function resolveHgssFishingBiteTrackedPositionFx32(
  position: HgssFishingBiteVectorFx32,
  facingVector: HgssFishingBiteVectorFx32,
  movementOffset: HgssFishingBiteVectorFx32,
  renderOffset: HgssFishingBiteVectorFx32,
  verticalOffsetFx32 = 0,
): HgssFishingBiteVectorFx32 {
  requireVector(position)
  requireVector(facingVector)
  requireVector(movementOffset)
  requireVector(renderOffset)
  if (!Number.isInteger(verticalOffsetFx32)) throw new Error(`L'offset vertical fx32 de peche HGSS ${verticalOffsetFx32} est invalide.`)
  return [
    position[0] + facingVector[0] + movementOffset[0] + renderOffset[0],
    position[1] + facingVector[1] + movementOffset[1] + renderOffset[1]
      + HGSS_FISHING_BITE_TRACKED_Y_OFFSET_FX32 + verticalOffsetFx32,
    position[2] + facingVector[2] + movementOffset[2] + renderOffset[2]
      + HGSS_FISHING_BITE_TRACKED_Z_OFFSET_FX32,
  ]
}
