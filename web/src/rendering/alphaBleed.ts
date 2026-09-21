export function bleedTransparentPixelColors(
  source: Uint8ClampedArray<ArrayBufferLike>,
  width: number,
  height: number,
): Uint8ClampedArray<ArrayBuffer> {
  const output = new Uint8ClampedArray(source.length)
  output.set(source)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const destination = (y * width + x) * 4
      if (source[destination + 3] !== 0) continue
      let red = 0
      let green = 0
      let blue = 0
      let count = 0
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        const sampleY = y + offsetY
        if (sampleY < 0 || sampleY >= height) continue
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const sampleX = x + offsetX
          if ((offsetX === 0 && offsetY === 0) || sampleX < 0 || sampleX >= width) continue
          const sample = (sampleY * width + sampleX) * 4
          if (source[sample + 3] === 0) continue
          red += source[sample]
          green += source[sample + 1]
          blue += source[sample + 2]
          count += 1
        }
      }
      if (count === 0) continue
      output[destination] = Math.round(red / count)
      output[destination + 1] = Math.round(green / count)
      output[destination + 2] = Math.round(blue / count)
    }
  }
  return output
}