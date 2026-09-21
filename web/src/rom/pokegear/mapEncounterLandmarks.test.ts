import { describe, expect, it } from 'vitest'
import {
  buildMapEncounterLandmarkIndex,
  type MapEncounterLandmarkSource,
  type MapEncounterObjectEvent,
} from './mapEncounterLandmarks'

function u16(value: number): number[] {
  return [value & 0xff, value >>> 8 & 0xff]
}

function i32(value: number): number[] {
  return [value & 0xff, value >>> 8 & 0xff, value >>> 16 & 0xff, value >>> 24 & 0xff]
}

function source(
  bytes: number[],
  entryOffsets: readonly number[] = [0],
  objects: readonly MapEncounterObjectEvent[] = [],
): MapEncounterLandmarkSource {
  return {
    id: 42,
    fieldScripts: {
      bank: 91,
      bytes: new Uint8Array(bytes),
      headerSize: 0,
      entryOffsets,
    },
    events: { objects },
  }
}

describe('MapEncounterLandmarkIndex HGSS', () => {
  it('indexes the native WildBattle command and its unique ObjectEvent flag', () => {
    const bytes = [
      ...u16(73), ...u16(1_500),
      ...u16(96),
      ...u16(104),
      ...u16(76), ...u16(150), ...u16(0),
      ...u16(77),
      ...u16(30), ...u16(0x966),
      ...u16(589), ...u16(150), ...u16(70), 0,
    ]
    const index = buildMapEncounterLandmarkIndex([
      source(bytes, [0], [{ id: 7, scriptId: 1, eventFlag: 0x123 }]),
    ])

    expect(index.landmarks).toEqual([{
      mapId: 42,
      speciesId: 150,
      level: 70,
      battleParameter: 0,
      command: 'wildBattle',
      conditions: [],
      disappearanceFlagId: 0x123,
      provenance: {
        bank: 91,
        scriptId: 1,
        entryOffset: 0,
        commandOffset: 20,
        opcode: 589,
      },
    }])
    expect(index.byMapId.get(42)).toEqual(index.landmarks)
  })

  it('propagates only proven SetVar and CopyVar constants', () => {
    const bytes = [
      ...u16(41), ...u16(0x4000), ...u16(243),
      ...u16(42), ...u16(0x4001), ...u16(0x4000),
      ...u16(43), ...u16(0x4002), ...u16(50),
      ...u16(589), ...u16(0x4001), ...u16(0x4002), 1,
    ]

    expect(buildMapEncounterLandmarkIndex([source(bytes)]).landmarks[0]).toMatchObject({
      speciesId: 243,
      level: 50,
      battleParameter: 1,
      command: 'wildBattle',
    })
  })

  it('follows Call and Return with offsets relative to the end of each command', () => {
    const bytes = [
      ...u16(26), ...i32(7), // next=6, subroutine=13
      ...u16(589), ...u16(0x4000), ...u16(40), 0,
      ...u16(41), ...u16(0x4000), ...u16(245),
      ...u16(27),
    ]

    expect(buildMapEncounterLandmarkIndex([source(bytes)]).landmarks[0]).toMatchObject({
      speciesId: 245,
      level: 40,
      provenance: { commandOffset: 6 },
    })
  })

  it('carries a direct CheckFlag condition onto the encounter path', () => {
    const bytes = [
      ...u16(32), ...u16(0x321),
      ...u16(28), 1, ...i32(2), // TRUE/EQUAL: next=11, battle=13
      ...u16(2),
      ...u16(589), ...u16(144), ...u16(50), 0,
    ]

    expect(buildMapEncounterLandmarkIndex([source(bytes)]).landmarks[0]?.conditions).toEqual([
      { flagId: 0x321, state: 'set' },
    ])
  })

  it('does not follow an impossible CheckFlag greater-than branch', () => {
    const bytes = [
      ...u16(32), ...u16(0x321),
      ...u16(28), 2, ...i32(2), // CheckFlag is only -1 or 0, never greater.
      ...u16(2),
      ...u16(589), ...u16(144), ...u16(50), 0,
    ]

    expect(buildMapEncounterLandmarkIndex([source(bytes)]).landmarks).toEqual([])
  })

  it('supports opcode 249 as the distinct RocketTrapBattle command', () => {
    const bytes = [
      ...u16(609),
      ...u16(96),
      ...u16(708), ...u16(1),
      ...u16(73), ...u16(1_501),
      ...u16(249), ...u16(109), ...u16(21),
    ]

    expect(buildMapEncounterLandmarkIndex([source(bytes)]).landmarks[0]).toMatchObject({
      speciesId: 109,
      level: 21,
      battleParameter: 0,
      command: 'rocketTrapBattle',
      provenance: { opcode: 249 },
    })
  })

  it('marks map legendaries only from conservative personal-data evidence in the ROM', () => {
    const bytes = [
      ...u16(589), ...u16(383), ...u16(50), 0,
      ...u16(589), ...u16(185), ...u16(20), 0,
      ...u16(249), ...u16(100), ...u16(23),
    ]
    const personalData: Array<{ catchRate: number, eggGroups: readonly [number, number] } | undefined> = []
    personalData[383] = { catchRate: 5, eggGroups: [15, 15] }
    personalData[185] = { catchRate: 65, eggGroups: [10, 10] }
    personalData[100] = { catchRate: 190, eggGroups: [10, 10] }

    const index = buildMapEncounterLandmarkIndex([source(bytes, [0, 7, 14])], { personalData })

    expect(index.landmarks.find(({ speciesId }) => speciesId === 383)?.isRomLegendary).toBe(true)
    expect(index.landmarks.find(({ speciesId }) => speciesId === 185)).not.toHaveProperty('isRomLegendary')
    expect(index.landmarks.find(({ speciesId }) => speciesId === 100)).not.toHaveProperty('isRomLegendary')
  })

  it('suppresses a variable species when ROM branches prove different values', () => {
    const bytes = [
      ...u16(495), ...u16(0x4000),
      ...u16(17), ...u16(0x4000), ...u16(7),
      ...u16(28), 1, ...i32(12), // next=17, alternate SetVar=29
      ...u16(41), ...u16(0x4001), ...u16(249),
      ...u16(22), ...i32(6), // next=29, join=35
      ...u16(41), ...u16(0x4001), ...u16(250),
      ...u16(589), ...u16(0x4001), ...u16(40), 0,
    ]
    const index = buildMapEncounterLandmarkIndex([source(bytes)])

    expect(index.landmarks).toEqual([])
    expect(index.diagnostics).toContainEqual(expect.objectContaining({
      offset: 35,
      opcode: 589,
      reason: 'unresolved-species',
    }))
  })

  it('keeps an invariant species but omits a path-dependent level', () => {
    const bytes = [
      ...u16(41), ...u16(0x4001), ...u16(250),
      ...u16(495), ...u16(0x4000),
      ...u16(17), ...u16(0x4000), ...u16(7),
      ...u16(28), 1, ...i32(12), // next=23, alternate SetVar=35
      ...u16(41), ...u16(0x4002), ...u16(45),
      ...u16(22), ...i32(6), // next=35, join=41
      ...u16(41), ...u16(0x4002), ...u16(70),
      ...u16(589), ...u16(0x4001), ...u16(0x4002), 0,
    ]
    const [landmark] = buildMapEncounterLandmarkIndex([source(bytes)]).landmarks

    expect(landmark).toMatchObject({ speciesId: 250 })
    expect(landmark).not.toHaveProperty('level')
  })

  it('stops on unsupported bytes instead of scanning for a false battle opcode', () => {
    const bytes = [
      ...u16(999),
      ...u16(589), ...u16(150), ...u16(70), 0,
    ]
    const index = buildMapEncounterLandmarkIndex([source(bytes)])

    expect(index.landmarks).toEqual([])
    expect(index.diagnostics).toContainEqual(expect.objectContaining({
      offset: 0,
      opcode: 999,
      reason: 'unsupported-opcode',
    }))
  })

  it('does not guess between multiple ObjectEvent flags', () => {
    const bytes = [...u16(589), ...u16(150), ...u16(50), 0]
    const index = buildMapEncounterLandmarkIndex([
      source(bytes, [0], [
        { id: 1, scriptId: 1, eventFlag: 10 },
        { id: 2, scriptId: 1, eventFlag: 11 },
      ]),
    ])

    expect(index.landmarks).toHaveLength(1)
    expect(index.landmarks[0]).not.toHaveProperty('disappearanceFlagId')
  })

  it('does not emit a species variable without a static proof', () => {
    const bytes = [...u16(589), ...u16(0x4000), ...u16(50), 0]
    const index = buildMapEncounterLandmarkIndex([source(bytes)])

    expect(index.landmarks).toEqual([])
    expect(index.diagnostics).toContainEqual(expect.objectContaining({ reason: 'unresolved-species' }))
  })
})
