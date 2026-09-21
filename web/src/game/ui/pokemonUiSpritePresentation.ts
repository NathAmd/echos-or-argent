import type { NitroGraphic, RomInventory } from '../../ndsTypes'
import {
  sampleHgssBattlePokemonAnimation,
  type BattlePokemonSprite,
} from '../../rom/pokemon/battlePokemonSprites'
import {
  createHgssPokedexPreviewRequest,
  type HgssPokedexEntry,
} from '../pokedex/pokedexMenuModel'
import { samplePokemonUiIconVBlankFrame } from './pokemonUiAnimation'

type PokedexPreviewInventory = Pick<RomInventory, 'battlePokemonSpriteResolver' | 'pokemonIconResolver'>

type AnimatedStarterIcon = {
  canvas: HTMLCanvasElement
  frames: readonly NitroGraphic[]
  frameIndex: number
}

type AnimatedPokedexPreview = {
  host: HTMLElement
  canvases: readonly HTMLCanvasElement[]
  battleSprite?: BattlePokemonSprite
  startedAtVblank: number
  frameIndex: number
  xOffset: number
}

export type PokemonUiSpritePresentationOptions = {
  createGraphicCanvas: (graphic: NitroGraphic) => HTMLCanvasElement
  resolveFrameCanvas: (graphic: NitroGraphic) => HTMLCanvasElement
  createPokedexHost: () => HTMLElement
}

export type PokedexPreviewPresentationRequest = {
  entry: HgssPokedexEntry
  inventory: PokedexPreviewInventory
  startedAtVblank: number
  selectedForm?: number
  shiny?: boolean
}

export type PokemonUiSpritePresentation = {
  createStarterIcon: (frames: readonly NitroGraphic[]) => HTMLCanvasElement
  clearStarterIcons: () => void
  createPokedexPreview: (request: PokedexPreviewPresentationRequest) => HTMLElement
  animate: (vblank: number, options: { startersVisible: boolean }) => void
  dispose: () => void
}

/**
 * Présente les sprites Pokémon propres aux menus sans dépendre de l'inventaire,
 * du document ou de l'horloge globale de l'application. Le VBlank fourni par la
 * composition root est la seule source de temps et reste donc figé en pause.
 */
export function createPokemonUiSpritePresentation(
  options: PokemonUiSpritePresentationOptions,
): PokemonUiSpritePresentation {
  const starterIcons = new Set<AnimatedStarterIcon>()
  let pokedexPreview: AnimatedPokedexPreview | undefined

  const createStarterIcon = (frames: readonly NitroGraphic[]): HTMLCanvasElement => {
    const firstFrame = frames[0]
    if (!firstFrame) throw new Error("L'animation ROM de l'icône starter est vide.")
    const canvas = options.createGraphicCanvas(firstFrame)
    canvas.className = ''
    starterIcons.add({ canvas, frames, frameIndex: 0 })
    return canvas
  }

  const createPokedexPreview = ({
    entry,
    inventory,
    selectedForm,
    shiny = false,
    startedAtVblank,
  }: PokedexPreviewPresentationRequest): HTMLElement => {
    const selectedEntry = selectedForm === undefined || !entry.forms.includes(selectedForm)
      ? entry
      : { ...entry, forms: [selectedForm, ...entry.forms.filter((form) => form !== selectedForm)] }
    const request = createHgssPokedexPreviewRequest(selectedEntry)
    if (!request) throw new Error(`L'aperçu Pokédex ROM ${entry.speciesId} est indisponible.`)
    const battleSprite = request.form === 0 || shiny
      ? inventory.battlePokemonSpriteResolver({ ...request, facing: 'front', shiny })
      : undefined
    const frames = battleSprite?.frames
      ?? inventory.pokemonIconResolver(request.speciesId, request.form, false).frames
    if (frames.length === 0) throw new Error(`Les frames Pokédex ROM ${entry.speciesId}:${request.form} sont absentes.`)

    const host = options.createPokedexHost()
    host.className = entry.caught ? 'pokedex-sprite' : 'pokedex-sprite pokedex-sprite-seen'
    host.dataset.shiny = String(shiny)
    host.setAttribute('aria-hidden', 'true')
    const canvases = frames.map((frame) => {
      const canvas = options.createGraphicCanvas(frame)
      canvas.className = ''
      return canvas
    })
    host.replaceChildren(canvases[0]!)
    pokedexPreview = {
      host,
      canvases,
      battleSprite,
      startedAtVblank: startedAtVblank >>> 0,
      frameIndex: 0,
      xOffset: 0,
    }
    return host
  }

  const animateStarters = (vblank: number): void => {
    for (const animation of starterIcons) {
      if (!animation.canvas.isConnected) {
        starterIcons.delete(animation)
        continue
      }
      const frameIndex = samplePokemonUiIconVBlankFrame(vblank, animation.frames.length)
      if (frameIndex === animation.frameIndex) continue
      const frame = animation.frames[frameIndex]
      if (!frame) continue
      animation.frameIndex = frameIndex
      const context = animation.canvas.getContext('2d')
      context?.clearRect(0, 0, animation.canvas.width, animation.canvas.height)
      context?.drawImage(options.resolveFrameCanvas(frame), 0, 0)
    }
  }

  const animatePokedex = (vblank: number): void => {
    const animation = pokedexPreview
    if (!animation) return
    if (!animation.host.isConnected) {
      pokedexPreview = undefined
      return
    }
    let elapsedVblanks = (vblank - animation.startedAtVblank) >>> 0
    let frameIndex = samplePokemonUiIconVBlankFrame(elapsedVblanks, animation.canvases.length)
    let xOffset = 0
    if (animation.battleSprite) {
      let sample = sampleHgssBattlePokemonAnimation(animation.battleSprite.animationScript, elapsedVblanks)
      if (sample.complete && elapsedVblanks > 90) {
        animation.startedAtVblank = vblank
        elapsedVblanks = 0
        sample = sampleHgssBattlePokemonAnimation(animation.battleSprite.animationScript, elapsedVblanks)
      }
      frameIndex = sample.frameIndex
      xOffset = sample.xOffset
    }
    if (frameIndex === animation.frameIndex && xOffset === animation.xOffset) return
    const canvas = animation.canvases[frameIndex] ?? animation.canvases[0]
    if (!canvas) return
    canvas.style.transform = xOffset === 0 ? '' : `translateX(${xOffset * 1.25}%)`
    if (animation.host.firstElementChild !== canvas) animation.host.replaceChildren(canvas)
    animation.frameIndex = frameIndex
    animation.xOffset = xOffset
  }

  const clearStarterIcons = (): void => { starterIcons.clear() }
  const dispose = (): void => {
    clearStarterIcons()
    pokedexPreview = undefined
  }

  return {
    createStarterIcon,
    clearStarterIcons,
    createPokedexPreview,
    animate(vblank, { startersVisible }) {
      if (startersVisible) animateStarters(vblank >>> 0)
      animatePokedex(vblank >>> 0)
    },
    dispose,
  }
}
