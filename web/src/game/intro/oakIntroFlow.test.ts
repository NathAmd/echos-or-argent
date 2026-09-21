import { describe, expect, it } from 'vitest'
import { createOakIntroFlow } from '../../oakIntroFlow'
import type { OakIntroFlow } from '../../oakIntroFlow'
import { getMessage, splitDialogPages } from './oakIntroContent'

const introMessages = Object.fromEntries(
  Array.from({ length: 62 }, (_, index) => [index + 1, `Message ROM ${index + 1}`]),
)

function advanceUntil(flow: OakIntroFlow, mode: ReturnType<OakIntroFlow['getRenderState']>['mode']): void {
  for (let step = 0; step < 100; step += 1) {
    if (flow.getRenderState().mode === mode) return
    flow.advance()
  }
  throw new Error(`Intro mode ${mode} was not reached.`)
}

describe('OakIntroFlow', () => {
  it('rejects an absent ROM message instead of using fallback text', () => {
    expect(() => getMessage(undefined, 1)).toThrow('message d’introduction ROM 1 est absent')
  })

  it('keeps native ROM line and page controls', () => {
    expect(splitDialogPages('Bienvenue dans le monde\nde Pokemon!', '')).toEqual(['Bienvenue dans le monde\nde Pokemon!'])
    expect(splitDialogPages('Premiere page\rDeuxieme page', '')).toEqual(['Premiere page', 'Deuxieme page'])
  })

  it('follows the ROM order: tutorial first, then greeting and Oak', () => {
    const flow = createOakIntroFlow(introMessages)
    expect(flow.getRenderState()).toMatchObject({ mode: 'dialog', messageId: 7, scene: 'tutorial' })
    flow.advance()
    expect(flow.getRenderState()).toMatchObject({ mode: 'tutorial-choice', selectedChoice: 0 })
    flow.chooseCurrentSelection(2)
    expect(flow.getRenderState().messageId).toBeGreaterThanOrEqual(1)
    expect(flow.getRenderState().messageId).toBeLessThanOrEqual(5)
    flow.advance()
    expect(flow.getRenderState()).toMatchObject({ mode: 'dialog', messageId: 6, scene: 'oak' })
    flow.advance()
    expect(flow.getRenderState()).toMatchObject({ mode: 'dialog', messageId: 34, scene: 'oak-shifted' })
    flow.advance()
    expect(flow.getRenderState()).toMatchObject({ mode: 'dialog', messageId: 35, scene: 'oak-marill' })
    flow.advance()
    expect(flow.getRenderState()).toMatchObject({ mode: 'dialog', messageId: 36, scene: 'oak-returning' })
  })

  it('paginates long dialog on word boundaries with at most two visible lines', () => {
    const pages = splitDialogPages('Une phrase volontairement longue qui doit continuer naturellement dans la boite de dialogue sans couper les mots ni imposer des retours de ligne artificiels.', '')
    expect(pages.length).toBeGreaterThan(1)
    expect(pages.every((page) => page.split('\n').length <= 2 && page.split('\n').every((line) => line.length <= 52))).toBe(true)
  })

  it('keeps the native control tutorial order and its understood loop', () => {
    const flow = createOakIntroFlow(introMessages)
    advanceUntil(flow, 'tutorial-choice')
    flow.chooseCurrentSelection(0)
    const seen: number[] = []
    for (let step = 0; step < 40 && flow.getRenderState().mode === 'dialog'; step += 1) {
      seen.push(flow.getRenderState().messageId ?? -1)
      flow.advance()
    }
    expect(seen).toEqual([9, 10, 11, 12, 23, 25, 13, 14, 15, 16, 17, 26])
    expect(flow.getRenderState()).toMatchObject({ mode: 'tutorial-choice', choices: ['Message ROM 61', 'Message ROM 62'] })
    flow.chooseCurrentSelection(1)
    expect(flow.getRenderState()).toMatchObject({ mode: 'dialog', messageId: 9 })
  })

  it('completes the profile path with a selected gender and name', () => {
    const flow = createOakIntroFlow(introMessages)
    advanceUntil(flow, 'tutorial-choice')
    flow.chooseCurrentSelection(2)
    advanceUntil(flow, 'gender-select')
    flow.chooseGender('female')
    expect(flow.getRenderState()).toMatchObject({ mode: 'gender-confirm', selectedGender: 'female' })
    flow.chooseCurrentSelection(0)
    advanceUntil(flow, 'name-input')
    expect(flow.getRenderState().nameInput).toEqual({ value: '', maxLength: 7 })
    flow.setPlayerName('LYRA')
    flow.advance()
    expect(flow.getRenderState()).toMatchObject({ mode: 'name-confirm', playerName: 'LYRA' })
    flow.chooseCurrentSelection(0)

    let result: ReturnType<OakIntroFlow['advance']> = 'running'
    for (let step = 0; step < 20 && result !== 'complete'; step += 1) result = flow.advance()
    expect(result).toBe('complete')
  })

  it('sanitizes and limits values received from the central name entry', () => {
    const flow = createOakIntroFlow(introMessages)
    advanceUntil(flow, 'tutorial-choice')
    flow.chooseCurrentSelection(2)
    advanceUntil(flow, 'gender-select')
    flow.chooseGender('male')
    flow.chooseCurrentSelection(0)
    advanceUntil(flow, 'name-input')
    flow.setPlayerName('abcdefghi!')

    expect(flow.getRenderState().playerName).toBe('ABCDEFG')
  })

  it('returns to the native gender question when the entered name is rejected', () => {
    const flow = createOakIntroFlow(introMessages)
    advanceUntil(flow, 'tutorial-choice')
    flow.chooseCurrentSelection(2)
    advanceUntil(flow, 'gender-select')
    flow.chooseGender('male')
    flow.chooseCurrentSelection(0)
    advanceUntil(flow, 'name-input')
    flow.setPlayerName('A')
    flow.advance()
    expect(flow.getRenderState()).toMatchObject({ mode: 'name-confirm', scene: 'oak' })
    flow.chooseCurrentSelection(1)
    expect(flow.getRenderState()).toMatchObject({ mode: 'gender-select', selectedGender: 'male' })
  })
})
