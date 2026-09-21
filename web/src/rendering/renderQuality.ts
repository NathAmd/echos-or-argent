export type GameRenderQuality = 'performance' | 'balanced' | 'quality'

export type GameRenderQualityProfile = Readonly<{
  antialias: boolean
  pixelBudget: number
  shadowMapSize: number
  shadows: boolean
}>

const profiles: Record<GameRenderQuality, GameRenderQualityProfile> = {
  performance: {
    antialias: false,
    pixelBudget: 1_800_000,
    shadowMapSize: 512,
    shadows: false,
  },
  balanced: {
    antialias: true,
    pixelBudget: 3_200_000,
    shadowMapSize: 1024,
    shadows: true,
  },
  quality: {
    antialias: true,
    pixelBudget: 5_000_000,
    shadowMapSize: 2048,
    shadows: true,
  },
}

export function resolveGameRenderQualityProfile(
  quality: GameRenderQuality = 'balanced',
): GameRenderQualityProfile {
  return profiles[quality]
}