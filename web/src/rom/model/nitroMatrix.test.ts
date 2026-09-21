import { describe, expect, it } from 'vitest'
import {
  addWeightedNitroMatrix,
  cloneNitroMatrix,
  composeNitroTrsMatrix,
  fix16,
  fix32,
  identityNitroMatrix,
  multiplyNitroMatrices,
  nitroRotationMatrix,
  nitroScaleMatrix,
  nitroTranslationMatrix,
  pivotNitroRotationMatrix,
  transformNitroPoint,
  zeroNitroMatrix,
} from './nitroMatrix'

describe('Nitro matrix operations', () => {
  it('converts signed and unsigned fixed-point values', () => {
    expect(fix32(4096)).toBe(1)
    expect(fix32(-2048)).toBe(-0.5)
    expect(fix16(0x1000)).toBe(1)
    expect(fix16(0xf000)).toBe(-1)
  })

  it('composes scale, rotation, and translation in Nitro column-major order', () => {
    const quarterTurnZ = nitroRotationMatrix([
      0, 1, 0,
      -1, 0, 0,
      0, 0, 1,
    ])
    const matrix = composeNitroTrsMatrix([10, 20, 30], quarterTurnZ, [2, 3, 4])

    expect(transformNitroPoint(matrix, [1, 0, 0])).toEqual([10, 22, 30])
    expect(transformNitroPoint(matrix, [0, 1, 0])).toEqual([7, 20, 30])
    expect(transformNitroPoint(matrix, [0, 0, 1])).toEqual([10, 20, 34])
  })

  it('multiplies transforms and produces independent clones', () => {
    const matrix = multiplyNitroMatrices(nitroTranslationMatrix(5, 6, 7), nitroScaleMatrix(2, 3, 4))
    const clone = cloneNitroMatrix(matrix)
    clone[12] = 99

    expect(transformNitroPoint(matrix, [1, 1, 1])).toEqual([7, 9, 11])
    expect(matrix[12]).toBe(5)
    expect(clone[12]).toBe(99)
  })

  it('accumulates weighted matrices for skeletal skinning', () => {
    const blended = zeroNitroMatrix()
    addWeightedNitroMatrix(blended, identityNitroMatrix(), 0.25)
    addWeightedNitroMatrix(blended, nitroTranslationMatrix(8, 0, 0), 0.75)

    expect(transformNitroPoint(blended, [0, 0, 0])).toEqual([6, 0, 0])
    expect(blended[0]).toBe(1)
    expect(blended[15]).toBe(1)
  })

  it('decodes pivot rotation selectors and sign flags deterministically', () => {
    expect([...pivotNitroRotationMatrix(0, 0, 0.5, 0.25)]).toEqual([
      1, 0, 0, 0,
      0, 0.5, 0.25, 0,
      0, 0.25, 0.5, 0,
      0, 0, 0, 1,
    ])
    expect(pivotNitroRotationMatrix(0, 0b111, 0.5, 0.25)[0]).toBe(-1)
  })
})