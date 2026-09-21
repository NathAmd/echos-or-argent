export function decompressLz10(source: Uint8Array): Uint8Array | undefined {
  if (source[0] !== 0x10 || source.byteLength < 4) return undefined
  const outputSize = source[1] | (source[2] << 8) | (source[3] << 16)
  if (outputSize <= 0) return undefined

  const output = new Uint8Array(outputSize)
  let sourceCursor = 4
  let outputCursor = 0
  while (outputCursor < outputSize && sourceCursor < source.byteLength) {
    const flags = source[sourceCursor]
    sourceCursor += 1
    for (let bit = 7; bit >= 0 && outputCursor < outputSize; bit -= 1) {
      if (((flags >> bit) & 1) === 0) {
        if (sourceCursor >= source.byteLength) return undefined
        output[outputCursor] = source[sourceCursor]
        outputCursor += 1
        sourceCursor += 1
        continue
      }
      if (sourceCursor + 1 >= source.byteLength) return undefined
      const first = source[sourceCursor]
      const second = source[sourceCursor + 1]
      sourceCursor += 2
      const length = (first >> 4) + 3
      const displacement = (((first & 0x0f) << 8) | second) + 1
      if (displacement > outputCursor) return undefined
      for (let index = 0; index < length && outputCursor < outputSize; index += 1) {
        output[outputCursor] = output[outputCursor - displacement]
        outputCursor += 1
      }
    }
  }
  return outputCursor === outputSize ? output : undefined
}