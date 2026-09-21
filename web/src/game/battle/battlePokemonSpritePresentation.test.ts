import { describe, expect, it, vi } from 'vitest'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import {
  bindBattlePokemonSpritePresentation,
  captureBattlePokemonSpritePresentation,
  isBattlePokemonSpriteBoundTo,
  isBattlePokemonSpritePresentationCurrent,
  resetBattlePokemonSpritePresentation,
} from './battlePokemonSpritePresentation'

const pokemon = (instanceId: string, personality = 123, trainerId = 7) => ({
  instanceId: instanceId as CanonicalPokemon['instanceId'],
  personality,
  originalTrainer: { id: trainerId, name: 'JO', gender: 'male' as const },
})

describe('battle Pokémon sprite presentation lifecycle', () => {
  it('cancels retained flee animations before a shared sprite host is reused', () => {
    const cancelFlee = vi.fn()
    const classes = new Set(['battle-pokemon-sprite', 'is-fainting', 'is-arriving'])
    const element = {
      dataset: {
        battlePokemonIdentity: 'ancien',
        battlePokemonVisual: 'ancien-visuel',
        shiny: 'true',
      } as Record<string, string>,
      hidden: true,
      getAnimations: vi.fn(() => [{ cancel: cancelFlee }]),
      classList: { remove: (...names: string[]) => names.forEach((name) => classes.delete(name)) },
      querySelectorAll: () => [],
      replaceChildren: vi.fn(),
      style: {
        animation: 'none',
        opacity: '0',
        transform: 'translateX(42%)',
        transformOrigin: '50% 90%',
        translate: '4px 0',
        scale: '.5',
        rotate: '4deg',
        filter: 'brightness(0)',
        visibility: 'hidden',
      },
    } as unknown as HTMLElement

    resetBattlePokemonSpritePresentation(element, false)

    expect(element.getAnimations).toHaveBeenCalledWith({ subtree: true })
    expect(cancelFlee).toHaveBeenCalledOnce()
    expect(classes).toEqual(new Set(['battle-pokemon-sprite']))
    expect(element.hidden).toBe(false)
    expect(element.style).toMatchObject({ animation: '', opacity: '', transform: '', transformOrigin: '', translate: '', scale: '', rotate: '', filter: '', visibility: '' })
    expect(element.dataset).toEqual({ battlePresentationRevision: '1' })
  })

  it('invalidates the old occupant before binding a replacement', () => {
    const cancel = vi.fn()
    const element = {
      dataset: {} as Record<string, string>,
      hidden: false,
      getAnimations: () => [{ cancel }],
      classList: { remove: vi.fn() },
      querySelectorAll: () => [],
      replaceChildren: vi.fn(),
      style: {},
    } as unknown as HTMLElement

    const first = bindBattlePokemonSpritePresentation(element, pokemon('first'))
    expect(first.changed).toBe(true)
    expect(isBattlePokemonSpriteBoundTo(element, pokemon('first', 456, 8))).toBe(true)
    const stale = captureBattlePokemonSpritePresentation(element)

    const same = bindBattlePokemonSpritePresentation(element, pokemon('first', 789, 9))
    expect(same.changed).toBe(false)
    expect(isBattlePokemonSpritePresentationCurrent(element, stale)).toBe(true)

    const replacement = bindBattlePokemonSpritePresentation(element, pokemon('replacement', 123, 7))
    expect(replacement.changed).toBe(true)
    expect(cancel).toHaveBeenCalledTimes(2)
    expect(isBattlePokemonSpritePresentationCurrent(element, stale)).toBe(false)
    expect(isBattlePokemonSpriteBoundTo(element, pokemon('replacement'))).toBe(true)
  })
})
