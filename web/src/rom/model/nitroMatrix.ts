export type NitroMatrix = Float64Array

export function fix32(value: number): number {
  return value / 4096
}

export function fix16(value: number): number {
  const signed = (value & 0x8000) !== 0 ? value - 0x10000 : value
  return signed / 4096
}

export function identityNitroMatrix(): NitroMatrix {
  return new Float64Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ])
}

export function cloneNitroMatrix(matrix: NitroMatrix): NitroMatrix {
  return new Float64Array(matrix)
}

export function zeroNitroMatrix(): NitroMatrix {
  return new Float64Array(16)
}

export function multiplyNitroMatrices(left: NitroMatrix, right: NitroMatrix): NitroMatrix {
  const result = new Float64Array(16)
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0
      for (let inner = 0; inner < 4; inner += 1) sum += left[inner * 4 + row] * right[column * 4 + inner]
      result[column * 4 + row] = sum
    }
  }
  return result
}

export function addWeightedNitroMatrix(target: NitroMatrix, matrix: NitroMatrix, weight: number): void {
  for (let index = 0; index < 16; index += 1) target[index] += matrix[index] * weight
}

export function nitroTranslationMatrix(x: number, y: number, z: number): NitroMatrix {
  return new Float64Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    x, y, z, 1,
  ])
}

export function nitroScaleMatrix(x: number, y: number, z: number): NitroMatrix {
  return new Float64Array([
    x, 0, 0, 0,
    0, y, 0, 0,
    0, 0, z, 0,
    0, 0, 0, 1,
  ])
}

export function nitroRotationMatrix(values: readonly number[]): NitroMatrix {
  return new Float64Array([
    values[0], values[1], values[2], 0,
    values[3], values[4], values[5], 0,
    values[6], values[7], values[8], 0,
    0, 0, 0, 1,
  ])
}

export function pivotNitroRotationMatrix(select: number, neg: number, a: number, b: number): NitroMatrix {
  const orientation = (neg & 1) === 0 ? 1 : -1
  const c = (neg & 0b10) === 0 ? b : -b
  const d = (neg & 0b100) === 0 ? a : -a
  const values = select === 0 ? [orientation, 0, 0, 0, a, b, 0, c, d]
    : select === 1 ? [0, orientation, 0, a, 0, b, c, 0, d]
      : select === 2 ? [0, 0, orientation, a, b, 0, c, d, 0]
        : select === 3 ? [0, a, b, orientation, 0, 0, 0, c, d]
          : select === 4 ? [a, 0, b, 0, orientation, 0, c, 0, d]
            : select === 5 ? [a, b, 0, 0, 0, orientation, c, d, 0]
              : select === 6 ? [0, a, b, 0, c, d, orientation, 0, 0]
                : select === 7 ? [a, 0, b, c, 0, d, 0, orientation, 0]
                  : [a, b, 0, c, d, 0, 0, 0, orientation]
  return nitroRotationMatrix(values)
}

export function transformNitroPoint(matrix: NitroMatrix, point: readonly [number, number, number]): [number, number, number] {
  return [
    matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12],
    matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13],
    matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14],
  ]
}

export function composeNitroTrsMatrix(translation: readonly [number, number, number], rotation: NitroMatrix, scale: readonly [number, number, number]): NitroMatrix {
  return multiplyNitroMatrices(
    nitroTranslationMatrix(translation[0], translation[1], translation[2]),
    multiplyNitroMatrices(rotation, nitroScaleMatrix(scale[0], scale[1], scale[2])),
  )
}