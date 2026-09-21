import { describe, expect, it, vi } from 'vitest'
import type { OpeningMapPreview, RomInventory } from '../../ndsTypes'
import { createHgssSessionRng, snapshotHgssSessionRng } from '../pokemon/hgssSessionRng'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { createFieldScriptMapInitSequenceRunner, createFieldScriptState, projectFieldScriptState, type FieldPokemonRuntime } from '../scripts/fieldScriptRunner'
import { createHgssRtcPenaltyState } from '../time/hgssRtcPenalty'
import { createHgssSaveState, restoreHgssSaveState, type RestoredHgssSaveState } from './hgssSaveState'
import { prepareHgssRestoredSession, rebuildHgssLocalFieldMapProjection } from './hgssRestoredSession'

function createRestoredState(): RestoredHgssSaveState {
  const rng = createHgssSessionRng(0x1234_5678)
  rng.lc.nextU16()
  rng.mt.nextU32()
  const now = new Date(2026, 7, 25, 12, 30)
  const pokemonRuntime: FieldPokemonRuntime = {
    catalog: createPokemonTestCatalog(),
    rng: rng.lc,
    mt: rng.mt,
    trainer: { id: 0x1020_3040, name: 'JO', gender: 'male' },
    language: 3,
    gameVersion: 7,
    now: () => now,
  }
  const field = createFieldScriptState('male', 'JO', { pokemonRuntime })
  field.flags.add(0x123)
  field.variables.set(0x4000, 17)
  field.money = 42_000
  return {
    profile: { gender: 'male', name: 'JO', trainerId: 0x1020_3040, language: 3, gameVersion: 7 },
    rng,
    world: { mapId: 61, tileX: 3, tileZ: 4, direction: 'south' },
    field,
    options: { textSpeed: 'normal', battleAnimations: true, localWeather: false },
    igt: { hours: 12, minutes: 34, seconds: 56 },
    rtcPenalty: createHgssRtcPenaltyState(now, 9),
    extensions: {
      'test.module': { version: 1, value: { nested: [1, 2, 3] } },
    },
  }
}

describe('préparation transactionnelle d’une session restaurée', () => {
  it('prépare des clones indépendants sans avancer ni modifier la sauvegarde restaurée', () => {
    const restored = createRestoredState()
    const originalRuntime = restored.field.pokemonRuntime
    const originalRng = snapshotHgssSessionRng(restored.rng)
    const originalExtensions = structuredClone(restored.extensions)
    const inventory = {
      resolvedMapCatalog: { maps: [{ id: 61, header: { mapSection: 9 } }] },
      trainerClassNames: ['DRESSEUR'],
    } as unknown as RomInventory
    const bindings = {
      igtMinutes: vi.fn(() => 754),
      ownerRtcOffset: vi.fn(() => 9),
      rtcPenalty: vi.fn(() => false),
    }

    const prepared = prepareHgssRestoredSession(inventory, restored, bindings)

    expect(prepared.profile).not.toBe(restored.profile)
    expect(prepared.field).not.toBe(restored.field)
    expect(prepared.rng).not.toBe(restored.rng)
    expect(prepared.rng.lc).not.toBe(restored.rng.lc)
    expect(prepared.rng.mt).not.toBe(restored.rng.mt)
    expect(prepared.options).not.toBe(restored.options)
    expect(prepared.rtcPenalty).not.toBe(restored.rtcPenalty)
    expect(prepared.extensions).not.toBe(restored.extensions)
    expect(prepared.extensions?.['test.module']?.value).not.toBe(restored.extensions?.['test.module']?.value)
    expect(prepared.field.pokemonRuntime).not.toBe(originalRuntime)
    expect(prepared.field.pokemonRuntime?.rng).toBe(prepared.rng.lc)
    expect(prepared.field.pokemonRuntime?.mt).toBe(prepared.rng.mt)
    expect(prepared.field.pokemonRuntime?.igtMinutes).toBe(bindings.igtMinutes)
    expect(prepared.field.pokemonRuntime?.mapSectionForMapId?.(61)).toBe(9)
    expect(snapshotHgssSessionRng(restored.rng)).toEqual(originalRng)
    expect(restored.field.pokemonRuntime).toBe(originalRuntime)

    prepared.profile.name = 'COPIE'
    prepared.field.money = 1
    prepared.field.flags.add(0x456)
    prepared.options.textSpeed = 'fast'
    prepared.rtcPenalty.penaltyMinutes = 120
    ;(prepared.extensions?.['test.module']?.value as { nested: number[] }).nested.push(4)
    prepared.rng.lc.nextU16()
    prepared.rng.mt.nextU32()

    expect(restored.profile.name).toBe('JO')
    expect(restored.field.money).toBe(42_000)
    expect(restored.field.flags.has(0x456)).toBe(false)
    expect(restored.options.textSpeed).toBe('normal')
    expect(restored.rtcPenalty.penaltyMinutes).toBe(0)
    expect(restored.extensions).toEqual(originalExtensions)
    expect(snapshotHgssSessionRng(restored.rng)).toEqual(originalRng)
  })

  it('clone également les options hôte explicitement préférées', () => {
    const restored = createRestoredState()
    const preferred = { textSpeed: 'fast' as const, battleAnimations: false, localWeather: true }

    const prepared = prepareHgssRestoredSession(
      { resolvedMapCatalog: { maps: [] } } as unknown as RomInventory,
      restored,
      {},
      preferred,
    )

    expect(prepared.options).toEqual(preferred)
    expect(prepared.options).not.toBe(preferred)
    expect(restored.options).toEqual({ textSpeed: 'normal', battleAnimations: true, localWeather: false })
  })

  it('reconstruit acteurs et MapProps depuis la ROM locale après un round-trip legacy canonisé', () => {
    const source = createRestoredState()
    source.field.variables.set(0x4100, 17)
    source.field.objects.set(99, { x: 999, z: 999, direction: 'west', movement: 77 })
    source.field.mapProps = [{ modelId: 999, x: 1, y: 2, z: 3 }]
    const saved = createHgssSaveState(
      'IPKF', source.profile, source.rng, source.world, source.field, source.options, source.igt, source.rtcPenalty,
    )
    expect(saved.field.objects).toEqual([])
    expect(saved.field.mapProps).toEqual([])
    // Simule une ancienne save qui recopiait encore les baselines de carte.
    saved.field.objects = [[99, { x: 999, z: 999, direction: 'west', movement: 77 }]]
    saved.field.mapProps = [{ modelId: 999, x: 1, y: 2, z: 3 }]
    const restored = restoreHgssSaveState(saved, 'IPKF', createPokemonTestCatalog(), () => new Date(2026, 7, 25))

    const bytes = new Uint8Array(4)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 621, true)
    view.setUint16(2, 2, true)
    const map = {
      id: 61,
      label: 'Carte locale',
      header: { mapId: 61, mapSection: 9, followMode: 2, weather: 0 } as OpeningMapPreview['header'],
      fieldScripts: { bank: 1, bytes, headerSize: 0, entryOffsets: [0] },
      initScripts: [{ type: 'onResume', scriptId: 1 }],
      messages: {},
      matrix: { matrixIndex: 0, name: '', width: 1, height: 1, headers: Uint16Array.of(61), altitudes: Uint8Array.of(0), modelIds: Uint16Array.of(0) },
      events: {
        backgroundEvents: 0, backgrounds: [], coordinateEvents: [], warps: [],
        objects: [{ id: 7, spriteId: 10, movement: 4, type: 0, eventFlag: 0, scriptId: 1, facingDirection: 0, xRange: 0, zRange: 0, x: 12, z: 15 }],
      },
    } satisfies OpeningMapPreview
    rebuildHgssLocalFieldMapProjection(restored.field, map, restored.world)
    expect(restored.field.objects).toEqual(new Map([[7, { x: 12, z: 15, direction: 'north', movement: 4 }]]))
    expect(restored.field.objects.has(99)).toBe(false)
    expect(restored.field.flags.has(0x123)).toBe(true)
    expect(restored.field.variables.get(0x4100)).toBe(17)

    const resume = createFieldScriptMapInitSequenceRunner(map, restored.field, 'resume')
    if (!resume) throw new Error('Script resume local attendu.')
    projectFieldScriptState(resume)
    expect(restored.field.mapProps).toEqual([
      { modelId: 0x8d, x: 131, y: 0, z: 65 },
      { modelId: 0x8d, x: 141, y: 0, z: 65 },
      { modelId: 0x8d, x: 136, y: 0, z: 72 },
    ])
    const rewritten = createHgssSaveState(
      'IPKF', restored.profile, restored.rng, restored.world, restored.field, restored.options, restored.igt, restored.rtcPenalty,
    )
    expect(rewritten.field.objects).toEqual([])
    expect(rewritten.field.mapProps).toEqual([])
  })
})
