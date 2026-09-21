import { describe, expect, it, vi } from 'vitest'
import type { NitroGraphic } from '../../ndsTypes'
import type { HgssBattleSpriteResource } from '../../rom/battle/battleSpriteResources'
import { createHgssBattleSpriteEffectPlayback } from './battleSpriteEffectPlayback'

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect
}

describe('HGSS battle OBJ effect playback', () => {
  it('place le sprite ROM dans le repère natif 256×192 autour de la cible', () => {
    const graphic: NitroGraphic = {
      width: 32,
      height: 32,
      pixels: new Uint8ClampedArray(32 * 32 * 4),
      graphicsOffset: 0,
      paletteOffset: 0,
      colorDepth: 4,
    }
    const resource: HgssBattleSpriteResource = {
      characterMemberId: 11,
      paletteMemberId: 11,
      cellMemberId: 11,
      animationMemberId: 11,
      cellFrameIndex: 0,
      graphic,
    }
    const children: FakeElement[] = []
    const container = {
      getBoundingClientRect: () => rect(0, 0, 1024, 768),
      append: (child: FakeElement) => { child.isConnected = true; children.push(child) },
    } as unknown as HTMLElement
    const target = { getBoundingClientRect: () => rect(640, 192, 160, 320) } as unknown as HTMLElement
    const resolveResource = vi.fn(() => resource)
    type FakeElement = {
      classList: { add: (value: string) => void }
      classNames: string[]
      dataset: Record<string, string>
      style: Record<string, string>
      isConnected: boolean
      setAttribute: (name: string, value: string) => void
      remove: () => void
    }
    const sprite: FakeElement = {
      classNames: [],
      classList: { add: (value) => { sprite.classNames.push(value) } },
      dataset: {},
      style: {},
      isConnected: false,
      setAttribute: vi.fn(),
      remove: () => { sprite.isConnected = false },
    }
    const playback = createHgssBattleSpriteEffectPlayback(container, resolveResource, () => sprite as unknown as HTMLElement)
    const resolved = playback.resolveResource({ characterMemberId: 11, paletteMemberId: 11, cellMemberId: 11, animationMemberId: 11 })
    const handle = playback.createSprite(resolved, 'player', target)
    expect(children).toEqual([sprite])
    expect(sprite.classNames).toContain('battle-native-obj-effect')
    expect(sprite.dataset).toMatchObject({
      battleSpriteSide: 'player',
      battleSpriteCharacter: '11',
      battleSpritePalette: '11',
      battleSpriteCell: '11',
      battleSpriteAnimation: '11',
    })
    expect(sprite.style.width).toBe('12.5%')
    handle.render({ visible: true, offsetX: 24, offsetY: -16, scale: 1.3984375, complete: false })
    expect(sprite.style.display).toBe('')
    expect(sprite.style.left).toBe('79.6875%')
    expect(sprite.style.top).toBe('37.5%')
    expect(sprite.style.transform).toBe('translate(-50%, -50%) scale(1.3984375)')
    handle.destroy()
    expect(sprite.isConnected).toBe(false)
  })
})
