export const storySafeWidth = 512
export const storySafeHeight = 384

export type AdaptiveViewport = {
  width: number
  height: number
  safeX: number
  safeY: number
}

export function getAdaptiveViewport(displayWidth: number, displayHeight: number): AdaptiveViewport {
  const aspect = Math.max(1, displayWidth) / Math.max(1, displayHeight)
  const safeAspect = storySafeWidth / storySafeHeight
  const width = aspect >= safeAspect ? Math.round(storySafeHeight * aspect) : storySafeWidth
  const height = aspect >= safeAspect ? storySafeHeight : Math.round(storySafeWidth / aspect)
  return {
    width,
    height,
    safeX: Math.round((width - storySafeWidth) / 2),
    safeY: Math.round((height - storySafeHeight) / 2),
  }
}

export function displayToViewportPosition(
  displayX: number,
  displayY: number,
  displayWidth: number,
  displayHeight: number,
): { x: number, y: number } {
  const viewport = getAdaptiveViewport(displayWidth, displayHeight)
  return {
    x: displayX * viewport.width / displayWidth,
    y: displayY * viewport.height / displayHeight,
  }
}