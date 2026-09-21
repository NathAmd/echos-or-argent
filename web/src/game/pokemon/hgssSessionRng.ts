import { createHgssLcrng, type HgssLcrng } from './hgssPokemonRng'

const mtStateSize = 624
const mtPeriodOffset = 397
const mtMatrixA = 0x9908b0df
const mtInitializationMultiplier = 1812433253

export type HgssMersenneTwister = {
  nextU32: () => number
  snapshot: () => HgssMersenneTwisterSnapshot
}

export type HgssMersenneTwisterSnapshot = {
  state: number[]
  cycle: number
}

export type HgssSessionRng = {
  seed: number
  mt: HgssMersenneTwister
  lc: HgssLcrng
}

export type HgssSessionRngSnapshot = {
  seed: number
  mt: HgssMersenneTwisterSnapshot
  lcSeed: number
}

function validateUint32(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`${label} ${value} est invalide.`)
  }
}

export function deriveHgssRtcSeed(date: Date, vblankCounter: number): number {
  if (Number.isNaN(date.getTime())) throw new Error('La date RTC HGSS est invalide.')
  validateUint32(vblankCounter, 'Le compteur VBlank HGSS')
  const year = date.getFullYear() - 2000
  if (year < 0 || year > 99) throw new Error(`L’annee RTC HGSS ${date.getFullYear()} est hors limites.`)
  return (
    year
    + Math.imul(date.getMonth() + 1, Math.imul(0x1000000, date.getDate()))
    + Math.imul(date.getHours(), 0x10000)
    + Math.imul(date.getMinutes() + date.getSeconds(), 0x1000000)
    + vblankCounter
  ) >>> 0
}

function createHgssMersenneTwisterFromState(state: Uint32Array, initialCycle: number): HgssMersenneTwister {
  let cycle = initialCycle

  const twist = (): void => {
    for (let index = 0; index < mtStateSize; index += 1) {
      const nextIndex = (index + 1) % mtStateSize
      const combined = (state[index]! & 0x80000000) | (state[nextIndex]! & 0x7fffffff)
      state[index] = (state[(index + mtPeriodOffset) % mtStateSize]! ^ (combined >>> 1) ^ ((combined & 1) === 0 ? 0 : mtMatrixA)) >>> 0
    }
    cycle = 0
  }

  return {
    nextU32: () => {
      if (cycle >= mtStateSize) twist()
      let value = state[cycle++]!
      value ^= value >>> 11
      value ^= (value << 7) & 0x9d2c5680
      value ^= (value << 15) & 0xefc60000
      value ^= value >>> 18
      return value >>> 0
    },
    snapshot: () => ({ state: Array.from(state), cycle }),
  }
}

export function createHgssMersenneTwister(seed: number): HgssMersenneTwister {
  validateUint32(seed, 'La graine MTRNG')
  const state = new Uint32Array(mtStateSize)
  state[0] = seed
  for (let index = 1; index < mtStateSize; index += 1) {
    const previous = state[index - 1]!
    state[index] = (Math.imul(mtInitializationMultiplier, previous ^ (previous >>> 30)) + index) >>> 0
  }
  return createHgssMersenneTwisterFromState(state, mtStateSize)
}

export function restoreHgssMersenneTwister(snapshot: HgssMersenneTwisterSnapshot): HgssMersenneTwister {
  if (!Array.isArray(snapshot.state) || snapshot.state.length !== mtStateSize) {
    throw new Error(`L'etat MTRNG HGSS doit contenir ${mtStateSize} mots.`)
  }
  if (!Number.isInteger(snapshot.cycle) || snapshot.cycle < 0 || snapshot.cycle > mtStateSize) {
    throw new Error(`L'index MTRNG HGSS ${snapshot.cycle} est invalide.`)
  }
  snapshot.state.forEach((value, index) => validateUint32(value, `Le mot MTRNG HGSS ${index}`))
  return createHgssMersenneTwisterFromState(Uint32Array.from(snapshot.state), snapshot.cycle)
}

export function createHgssSessionRng(seed: number): HgssSessionRng {
  validateUint32(seed, 'La graine de session HGSS')
  return {
    seed,
    mt: createHgssMersenneTwister(seed),
    lc: createHgssLcrng(seed),
  }
}

export function snapshotHgssSessionRng(session: HgssSessionRng): HgssSessionRngSnapshot {
  return { seed: session.seed, mt: session.mt.snapshot(), lcSeed: session.lc.getSeed() }
}

export function restoreHgssSessionRng(snapshot: HgssSessionRngSnapshot): HgssSessionRng {
  validateUint32(snapshot.seed, 'La graine de session HGSS')
  validateUint32(snapshot.lcSeed, 'La graine LCRNG sauvegardee')
  return {
    seed: snapshot.seed,
    mt: restoreHgssMersenneTwister(snapshot.mt),
    lc: createHgssLcrng(snapshot.lcSeed),
  }
}