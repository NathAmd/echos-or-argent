export type GameRenderStats = Readonly<{
  calls: number
  frameTimeMs: number
  geometries: number
  lines: number
  points: number
  textures: number
  triangles: number
}>

type RenderInfo = Readonly<{
  calls: number
  lines: number
  points: number
  triangles: number
}>

type MemoryInfo = Readonly<{
  geometries: number
  textures: number
}>

export function createGameRenderStats(
  render: RenderInfo,
  memory: MemoryInfo,
  frameTimeMs: number,
): GameRenderStats {
  return {
    calls: render.calls,
    frameTimeMs: Math.max(0, frameTimeMs),
    geometries: memory.geometries,
    lines: render.lines,
    points: render.points,
    textures: memory.textures,
    triangles: render.triangles,
  }
}