import type { RomInventory } from '../../ndsTypes'
import type { CanvasAssetCache } from '../../rendering/canvas/canvasAssets'
import { createPhotoAlbumUiHost, type PhotoAlbumUiHost } from './photoAlbumUiHost'

export type PhotoAlbumMainAdapterOptions = {
  root: HTMLElement
  runtimeCanvas: HTMLCanvasElement
  canvasAssets: CanvasAssetCache
  readInventory: () => RomInventory | undefined
  playSoundEffect: (sequenceId: number) => void | Promise<void>
  onResume: () => void
  onStateChange?: () => void
}

function copyCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const copy = document.createElement('canvas')
  copy.width = source.width
  copy.height = source.height
  copy.getContext('2d')?.drawImage(source, 0, 0)
  return copy
}

/** Adaptateur de composition : le host reste indépendant de main et de la ROM chargée. */
export function createPhotoAlbumMainAdapter(options: PhotoAlbumMainAdapterOptions): PhotoAlbumUiHost {
  return createPhotoAlbumUiHost({
    root: options.root,
    createWorldSnapshot: () => copyCanvas(options.runtimeCanvas),
    playSoundEffect: options.playSoundEffect,
    onResume: options.onResume,
    onStateChange: options.onStateChange,
    readResources: () => {
      const inventory = options.readInventory()
      if (!inventory) return undefined
      return {
        messages: inventory.uiMessageBanks[0] ?? {},
        mapLabel: (mapId) => inventory.resolvedMapCatalog.maps.find((map) => map.id === mapId)?.label ?? '',
        speciesName: (speciesId) => inventory.pokemonCatalog.speciesNames[speciesId] ?? '',
        createPokemonPreview: (mon) => copyCanvas(options.canvasAssets.getGraphicCanvas(inventory.battlePokemonSpriteResolver({
          speciesId: mon.speciesId,
          form: mon.form,
          gender: mon.genderBit ? 'female' : 'male',
          facing: 'front',
          shiny: mon.shiny,
        }).frames[0]!)),
        createSubjectPreview: (spriteId) => {
          const texture = inventory.eventTextureResolver?.(spriteId).preview
          return texture ? copyCanvas(options.canvasAssets.getTextureCanvas(texture)) : undefined
        },
      }
    },
  })
}
