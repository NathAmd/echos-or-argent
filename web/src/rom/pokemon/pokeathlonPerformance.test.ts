import { describe, expect, it } from 'vitest'
import {
  calculateHgssPokeathlonStars,
  decodeHgssPokeathlonBasePerformance,
  decodeHgssPokeathlonMemberIndexes,
  hgssPokeathlonPerformanceMemberCount,
  hgssPokeathlonSpeciesCount,
  locateHgssPokeathlonMemberIndexTable,
  resolveHgssFollowerPokeathlonStatClass,
  resolveHgssPokeathlonBasePerformance,
  scoreHgssPokeathlonModifier,
  type HgssPokeathlonBasePerformance,
  type HgssPokeathlonPerformanceCatalog,
  type HgssPokeathlonStars,
} from './pokeathlonPerformance'

function canonicalMemberIndex(speciesId: number): number {
  if (speciesId === 0) return 0
  const offset = speciesId >= 493 ? 44
    : speciesId >= 488 ? 43
      : speciesId >= 480 ? 42
        : speciesId >= 424 ? 37
          : speciesId >= 423 ? 36
            : speciesId >= 414 ? 35
              : speciesId >= 413 ? 33
                : speciesId >= 387 ? 31
                  : speciesId >= 202 ? 28
                    : speciesId >= 173 ? 1
                      : 0
  return speciesId - 1 + offset
}

function createArm9Fixture(tableOffset = 32): Uint8Array {
  const arm9 = new Uint8Array(tableOffset + hgssPokeathlonSpeciesCount * 2 + 16)
  const view = new DataView(arm9.buffer)
  for (let speciesId = 0; speciesId < hgssPokeathlonSpeciesCount; speciesId += 1) {
    view.setUint16(tableOffset + speciesId * 2, canonicalMemberIndex(speciesId), true)
  }
  return arm9
}

function uniformPerformance(value = 3): HgssPokeathlonBasePerformance {
  const stat = Object.freeze({ base: value, minimum: 0, maximum: 5 })
  return Object.freeze({
    memberIndex: 0,
    stats: Object.freeze({ power: stat, skill: stat, speed: stat, jump: stat, stamina: stat }),
  })
}

describe('HGSS Pokéathlon performance', () => {
  it('décode l’ordre propre à performance.narc vers l’ordre natif du moteur', () => {
    const payload = new Uint8Array([
      1, 2, 3, 4, 5,
      0, 0, 0, 0,
      0, 2, 1, 3, 2, 4, 3, 5, 4, 5,
      0,
    ])

    expect(decodeHgssPokeathlonBasePerformance(payload, 7)).toEqual({
      memberIndex: 7,
      stats: {
        power: { base: 1, minimum: 0, maximum: 2 },
        skill: { base: 4, minimum: 3, maximum: 5 },
        speed: { base: 5, minimum: 4, maximum: 5 },
        jump: { base: 3, minimum: 2, maximum: 4 },
        stamina: { base: 2, minimum: 1, maximum: 3 },
      },
    })
    expect(() => decodeHgssPokeathlonBasePerformance(payload.subarray(1), 7)).toThrow('19 octets au lieu de 20')
    const incoherent = payload.slice()
    incoherent[9] = 2
    expect(() => decodeHgssPokeathlonBasePerformance(incoherent, 7)).toThrow('power')
  })

  it('localise de manière unique la table espèce→membre dans ARM9', () => {
    const arm9 = createArm9Fixture()
    expect(locateHgssPokeathlonMemberIndexTable(arm9, hgssPokeathlonPerformanceMemberCount)).toBe(32)
    expect(decodeHgssPokeathlonMemberIndexes(arm9, hgssPokeathlonPerformanceMemberCount)).toMatchObject({
      0: 0, 1: 0, 172: 171, 173: 173, 202: 229, 387: 417, 493: 536,
    })

    const duplicate = new Uint8Array(arm9.byteLength * 2)
    duplicate.set(arm9, 0)
    duplicate.set(arm9, arm9.byteLength)
    expect(() => locateHgssPokeathlonMemberIndexTable(duplicate, hgssPokeathlonPerformanceMemberCount)).toThrow('2 candidate')
    expect(() => locateHgssPokeathlonMemberIndexTable(new Uint8Array(2048), hgssPokeathlonPerformanceMemberCount)).toThrow('0 candidate')
  })

  it('résout une forme relativement au membre de base de son espèce', () => {
    const performances = Array.from({ length: hgssPokeathlonPerformanceMemberCount }, (_, memberIndex) => ({
      ...uniformPerformance(), memberIndex,
    }))
    const catalog: HgssPokeathlonPerformanceCatalog = {
      performances,
      memberIndexBySpecies: Array.from({ length: hgssPokeathlonSpeciesCount }, (_, speciesId) => canonicalMemberIndex(speciesId)),
    }

    expect(resolveHgssPokeathlonBasePerformance(catalog, 493, 17).memberIndex).toBe(553)
    expect(() => resolveHgssPokeathlonBasePerformance(catalog, 493, 18)).toThrow('espèce 493, forme 18')
    expect(() => resolveHgssPokeathlonBasePerformance(catalog, 1, 1)).toThrow('espèce 1, forme 1')
  })

  it('reproduit les seuils, le modificateur quotidien et le clamp min/max natifs', () => {
    expect([-121, -120, -80, -40, -15, 14, 15, 40, 80, 120].map(scoreHgssPokeathlonModifier))
      .toEqual([-4, -4, -3, -2, -1, 0, 1, 2, 3, 4])

    expect(calculateHgssPokeathlonStars(uniformPerformance(), 12345, 0, new Date(2026, 7, 7))).toEqual({
      power: 3, skill: 3, speed: 3, jump: 3, stamina: 2,
    })
    expect(calculateHgssPokeathlonStars(
      uniformPerformance(),
      12345,
      0,
      new Date(2026, 7, 7),
      [20, 40, 80, 120, 127],
    )).toEqual({ power: 4, skill: 5, speed: 5, jump: 5, stamina: 5 })
    expect(() => calculateHgssPokeathlonStars(uniformPerformance(), 0, 25, new Date())).toThrow('nature')
  })

  it('applique la priorité Power > Stamina > Jump > Skill > Speed en cas d’égalité', () => {
    const stars = (overrides: Partial<HgssPokeathlonStars> = {}): HgssPokeathlonStars => ({
      power: 3, stamina: 3, jump: 3, skill: 3, speed: 3, ...overrides,
    })
    expect(resolveHgssFollowerPokeathlonStatClass(stars())).toBe(1)
    expect(resolveHgssFollowerPokeathlonStatClass(stars({ stamina: 4, jump: 4, skill: 4, speed: 4 }))).toBe(2)
    expect(resolveHgssFollowerPokeathlonStatClass(stars({ jump: 5, skill: 5, speed: 5 }))).toBe(4)
    expect(resolveHgssFollowerPokeathlonStatClass(stars({ skill: 4, speed: 4 }))).toBe(3)
    expect(resolveHgssFollowerPokeathlonStatClass(stars({ speed: 4 }))).toBe(5)
  })
})
