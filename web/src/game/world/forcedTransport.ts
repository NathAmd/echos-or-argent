export type ForcedTransportRouteNode = Readonly<{ x: number, z: number }>

export type ForcedTransportTiming = Readonly<{
  mountFrames: number
  prepareFrames: number
  shakeFrames: number
  terminalWaitFrames: number
  dismountFrames: number
}>

export type ForcedTransportPhase = 'mount' | 'prepare' | 'travel' | 'shake' | 'terminalWait' | 'dismount' | 'complete'

export type ForcedTransportSample = {
  phase: ForcedTransportPhase
  phaseProgress: number
  routeProgress: number
}

export const hgssAzaleaTransportTiming: ForcedTransportTiming = {
  mountFrames: 8,
  prepareFrames: 5,
  shakeFrames: 8,
  terminalWaitFrames: 9,
  dismountFrames: 8,
}

export function getForcedTransportRouteDistance(route: readonly ForcedTransportRouteNode[]): number {
  return route.slice(1).reduce((distance, node, index) => {
    const previous = route[index]!
    return distance + Math.hypot(node.x - previous.x, node.z - previous.z)
  }, 0)
}

export function sampleForcedTransportRoute(route: readonly ForcedTransportRouteNode[], distance: number): ForcedTransportRouteNode {
  let remaining = Math.max(0, distance)
  for (let index = 1; index < route.length; index += 1) {
    const previous = route[index - 1]!
    const next = route[index]!
    const length = Math.hypot(next.x - previous.x, next.z - previous.z)
    if (remaining <= length || index === route.length - 1) {
      const ratio = length <= 0 ? 1 : Math.max(0, Math.min(1, remaining / length))
      return { x: previous.x + (next.x - previous.x) * ratio, z: previous.z + (next.z - previous.z) * ratio }
    }
    remaining -= length
  }
  return route.at(-1) ?? { x: 0, z: 0 }
}

export function sampleForcedTransportTimeline(
  elapsedMs: number,
  routeDurationMs: number,
  frameDurationMs: number,
  timing: ForcedTransportTiming,
): ForcedTransportSample {
  const duration = (frames: number): number => Math.max(0, frames) * frameDurationMs
  const phases: Array<{ phase: Exclude<ForcedTransportPhase, 'travel' | 'complete'>, durationMs: number }> = [
    { phase: 'mount', durationMs: duration(timing.mountFrames) },
    { phase: 'prepare', durationMs: duration(timing.prepareFrames) },
  ]
  let cursor = Math.max(0, elapsedMs)
  for (const entry of phases) {
    if (cursor < entry.durationMs) return { phase: entry.phase, phaseProgress: entry.durationMs <= 0 ? 1 : cursor / entry.durationMs, routeProgress: 0 }
    cursor -= entry.durationMs
  }
  if (cursor < routeDurationMs) {
    return { phase: 'travel', phaseProgress: routeDurationMs <= 0 ? 1 : cursor / routeDurationMs, routeProgress: routeDurationMs <= 0 ? 1 : cursor / routeDurationMs }
  }
  cursor -= routeDurationMs
  for (const entry of [
    { phase: 'shake' as const, durationMs: duration(timing.shakeFrames) },
    { phase: 'terminalWait' as const, durationMs: duration(timing.terminalWaitFrames) },
    { phase: 'dismount' as const, durationMs: duration(timing.dismountFrames) },
  ]) {
    if (cursor < entry.durationMs) return { phase: entry.phase, phaseProgress: entry.durationMs <= 0 ? 1 : cursor / entry.durationMs, routeProgress: 1 }
    cursor -= entry.durationMs
  }
  return { phase: 'complete', phaseProgress: 1, routeProgress: 1 }
}
