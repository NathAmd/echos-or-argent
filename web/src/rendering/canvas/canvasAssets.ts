import type { NitroGraphic, NitroTexturePreview } from '../../ndsTypes'
import { bleedTransparentPixelColors } from '../alphaBleed'

export type CanvasAssetCache = {
  createGraphicCanvas: (graphic: NitroGraphic) => HTMLCanvasElement
  getGraphicCanvas: (graphic: NitroGraphic) => HTMLCanvasElement
  mountGraphicCanvas: (host: Element, graphic: NitroGraphic) => HTMLCanvasElement
  getTextureCanvas: (texture: NitroTexturePreview) => HTMLCanvasElement
  clear: () => void
}

export function createCanvasAssetCache(): CanvasAssetCache {
  let graphicImageData = new WeakMap<NitroGraphic, ImageData>()
  let graphicCanvasCache = new WeakMap<NitroGraphic, HTMLCanvasElement>()
  let mountedGraphicCanvases = new WeakMap<Element, WeakMap<NitroGraphic, HTMLCanvasElement>>()
  let textureCanvasCache = new WeakMap<NitroTexturePreview, HTMLCanvasElement>()

  const getGraphicImageData = (graphic: NitroGraphic): ImageData => {
    const cached = graphicImageData.get(graphic)
    if (cached) return cached
    const imageData = new ImageData(
      bleedTransparentPixelColors(graphic.pixels, graphic.width, graphic.height),
      graphic.width,
      graphic.height,
    )
    graphicImageData.set(graphic, imageData)
    return imageData
  }

  const createGraphicCanvas = (graphic: NitroGraphic): HTMLCanvasElement => {
    const canvas = document.createElement('canvas')
    canvas.width = graphic.width
    canvas.height = graphic.height
    canvas.getContext('2d')?.putImageData(getGraphicImageData(graphic), 0, 0)
    return canvas
  }

  const getGraphicCanvas = (graphic: NitroGraphic): HTMLCanvasElement => {
    const cached = graphicCanvasCache.get(graphic)
    if (cached) return cached
    const canvas = createGraphicCanvas(graphic)
    graphicCanvasCache.set(graphic, canvas)
    return canvas
  }

  const mountGraphicCanvas = (host: Element, graphic: NitroGraphic): HTMLCanvasElement => {
    let hostCanvases = mountedGraphicCanvases.get(host)
    if (!hostCanvases) {
      hostCanvases = new WeakMap()
      mountedGraphicCanvases.set(host, hostCanvases)
    }
    let canvas = hostCanvases.get(graphic)
    if (!canvas) {
      canvas = createGraphicCanvas(graphic)
      hostCanvases.set(graphic, canvas)
    }
    if (host.childElementCount !== 1 || host.firstElementChild !== canvas) host.replaceChildren(canvas)
    return canvas
  }

  const getTextureCanvas = (texture: NitroTexturePreview): HTMLCanvasElement => {
    const cached = textureCanvasCache.get(texture)
    if (cached) return cached
    const canvas = document.createElement('canvas')
    canvas.width = texture.width
    canvas.height = texture.height
    canvas.getContext('2d')?.putImageData(new ImageData(
      bleedTransparentPixelColors(texture.pixels, texture.width, texture.height),
      texture.width,
      texture.height,
    ), 0, 0)
    textureCanvasCache.set(texture, canvas)
    return canvas
  }

  const clear = (): void => {
    graphicImageData = new WeakMap()
    graphicCanvasCache = new WeakMap()
    mountedGraphicCanvases = new WeakMap()
    textureCanvasCache = new WeakMap()
  }

  return { createGraphicCanvas, getGraphicCanvas, mountGraphicCanvas, getTextureCanvas, clear }
}
