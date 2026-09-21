import { describe, expect, it } from 'vitest'
import { getTitleModelViewSize } from './titleModelRenderer'

describe('title model adaptive camera', () => {
  it('expands horizontally for wide screens without reducing model height', () => {
    expect(getTitleModelViewSize(16 / 9)).toEqual({ width: 341.3333333333333, height: 192 })
  })

  it('expands vertically for portrait screens without reducing model width', () => {
    expect(getTitleModelViewSize(9 / 16)).toEqual({ width: 256, height: 455.1111111111111 })
  })

  it('preserves the original DS model frame at four by three', () => {
    expect(getTitleModelViewSize(4 / 3)).toEqual({ width: 256, height: 192 })
  })
})