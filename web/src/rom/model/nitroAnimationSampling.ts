export type NitroSampleSelection = { index: number } | { from: number, to: number, toParts: 1 | 2 | 3 }

const elementStepMask = 0xc0000000

function selectSteppedNitroSample(
  frame: number,
  step: 2 | 4,
  lastInterpolation: number,
): NitroSampleSelection {
  const normalizedFrame = Math.max(0, Math.floor(frame))
  const interpolationEnd = Math.max(0, Math.floor(lastInterpolation))
  if (normalizedFrame > interpolationEnd) {
    // Apres la zone interpolee, Nitro stocke de nouveau une valeur par frame.
    // L'index doit donc continuer lineairement au lieu de repartir sur
    // `frame / step` au prochain multiple du pas compresse.
    return { index: Math.floor(interpolationEnd / step) + normalizedFrame - interpolationEnd }
  }
  const remainder = normalizedFrame % step
  if (remainder === 0) return { index: Math.floor(normalizedFrame / step) }
  const from = Math.floor(normalizedFrame / step)
  return { from, to: from + 1, toParts: (step === 2 ? 2 : remainder) as 1 | 2 | 3 }
}

/** Sélection et interpolation entières step-1/2/4 communes aux pistes Nitro. */
export function selectNitroSample(frame: number, info: number, lastInterpolation: number): NitroSampleSelection {
  const step = info & elementStepMask
  if (step === 0) return { index: Math.max(0, Math.floor(frame)) }
  return selectSteppedNitroSample(frame, step === 0x40000000 ? 2 : 4, lastInterpolation)
}

export function interpolateNitroInteger(from: number, to: number, toParts: 1 | 2 | 3): number {
  return (from * (4 - toParts) + to * toParts) >> 2
}

export function sampleNitroInteger(
  selection: NitroSampleSelection,
  read: (index: number) => number | undefined,
): number | undefined {
  if ('index' in selection) return read(selection.index)
  const from = read(selection.from)
  const to = read(selection.to)
  return from === undefined || to === undefined ? undefined : interpolateNitroInteger(from, to, selection.toParts)
}
