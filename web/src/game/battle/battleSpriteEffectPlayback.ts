import type { NitroGraphic } from '../../ndsTypes'
import type { HgssBattleSpriteResource, HgssBattleSpriteResourceRequest } from '../../rom/battle/battleSpriteResources'
import type {
  HgssBattleAnimationSpritePlayback,
  HgssBattleSpriteEffectHandle,
  HgssBattleSpriteEffectSample,
} from './battleAnimationPlayback'
import type { SimpleBattleSide } from './simpleBattleSession'

const nativeBattleWidth = 256
const nativeBattleHeight = 192

type ElementFactory = (graphic: NitroGraphic) => HTMLElement
type ResourceResolver = (request: HgssBattleSpriteResourceRequest) => HgssBattleSpriteResource

function nativeAnchor(container: HTMLElement, target: HTMLElement): readonly [number, number] {
  const containerRect = container.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  if (containerRect.width <= 0 || containerRect.height <= 0) return [nativeBattleWidth / 2, nativeBattleHeight / 2]
  return [
    (targetRect.left + targetRect.width / 2 - containerRect.left) * nativeBattleWidth / containerRect.width,
    (targetRect.top + targetRect.height / 2 - containerRect.top) * nativeBattleHeight / containerRect.height,
  ]
}

/**
 * Couche OBJ indépendante du canevas SPL : les sprites 2D de la ROM peuvent
 * ainsi vivre en même temps que les particules sans que l'un efface l'autre.
 */
export function createHgssBattleSpriteEffectPlayback(
  container: HTMLElement,
  resolveResource: ResourceResolver,
  createGraphic: ElementFactory,
): HgssBattleAnimationSpritePlayback {
  return {
    resolveResource,
    createSprite(
      resource: HgssBattleSpriteResource,
      targetSide: SimpleBattleSide,
      target: HTMLElement,
    ): HgssBattleSpriteEffectHandle {
      const sprite = createGraphic(resource.graphic)
      const [anchorX, anchorY] = nativeAnchor(container, target)
      sprite.classList.add('battle-native-obj-effect')
      sprite.dataset.battleSpriteSide = targetSide
      sprite.dataset.battleSpriteCharacter = String(resource.characterMemberId)
      sprite.dataset.battleSpritePalette = String(resource.paletteMemberId)
      sprite.dataset.battleSpriteCell = String(resource.cellMemberId)
      if (resource.animationMemberId !== undefined) sprite.dataset.battleSpriteAnimation = String(resource.animationMemberId)
      sprite.setAttribute('aria-hidden', 'true')
      Object.assign(sprite.style, {
        position: 'absolute',
        zIndex: '9',
        left: '0',
        top: '0',
        width: `${resource.graphic.width * 100 / nativeBattleWidth}%`,
        height: `${resource.graphic.height * 100 / nativeBattleHeight}%`,
        pointerEvents: 'none',
        imageRendering: 'pixelated',
        transformOrigin: '50% 50%',
        display: 'none',
      })
      container.append(sprite)
      return {
        render(sample: HgssBattleSpriteEffectSample): void {
          sprite.style.display = sample.visible ? '' : 'none'
          sprite.style.left = `${(anchorX + sample.offsetX) * 100 / nativeBattleWidth}%`
          sprite.style.top = `${(anchorY + sample.offsetY) * 100 / nativeBattleHeight}%`
          sprite.style.transform = `translate(-50%, -50%) scale(${sample.scale})`
        },
        destroy(): void {
          sprite.remove()
        },
      }
    },
  }
}
