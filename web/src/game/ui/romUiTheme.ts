import type { NitroGraphic } from '../../ndsTypes'
import type { HgssUiAssets } from '../../rom/ui/hgssUiAssets'

function graphicDataUrl(graphic: NitroGraphic): string {
  const canvas = document.createElement('canvas')
  canvas.width = graphic.width
  canvas.height = graphic.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error("Le canvas requis par le thème UI ROM n'est pas disponible.")
  const pixels = new Uint8ClampedArray(graphic.pixels)
  context.putImageData(new ImageData(pixels, graphic.width, graphic.height), 0, 0)
  return canvas.toDataURL('image/png')
}

export function installHgssUiTheme(root: HTMLElement, assets: HgssUiAssets, frameIndex = 0): void {
  const frame = assets.windowFrames[frameIndex]
  if (!frame) throw new Error(`Le cadre UI ROM ${frameIndex} est absent.`)
  root.style.setProperty('--ui-rom-window-frame', `url("${graphicDataUrl(frame)}")`)
  root.dataset.uiRomTheme = 'ready'
}
