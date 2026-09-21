import { describe, expect, it } from 'vitest'
import { createHgssSessionRng } from '../pokemon/hgssSessionRng'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { createFieldScriptState } from '../scripts/fieldScriptRunner'
import { createHgssSaveState, restoreHgssSaveState } from '../save/hgssSaveState'
import { createHgssRtcPenaltyState } from './hgssRtcPenalty'

const profile = { gender: 'male', name: 'JO', trainerId: 1, language: 3, gameVersion: 7 } as const
const world = { mapId: 61, tileX: 4, tileZ: 7, direction: 'north' } as const

function createSave(rtcPenalty = createHgssRtcPenaltyState(new Date(2026, 7, 21, 12), -120)) {
  return createHgssSaveState(
    'IPKF',
    profile,
    createHgssSessionRng(1),
    world,
    createFieldScriptState('male', 'JO'),
    undefined,
    undefined,
    rtcPenalty,
  )
}

describe('persistance de la pénalité RTC globale HGSS', () => {
  it('conserve le bloc SysInfo RTC à travers JSON sans partager sa référence', () => {
    const saved = createSave()
    saved.rtcPenalty!.penaltyMinutes = 37
    const restored = restoreHgssSaveState(
      JSON.parse(JSON.stringify(saved)),
      'IPKF',
      createPokemonTestCatalog(),
      () => new Date(2026, 7, 22, 12),
      undefined,
      undefined,
      { ownerRtcOffset: -120 },
    )
    expect(restored.rtcPenalty).toEqual(saved.rtcPenalty)
    expect(restored.rtcPenalty).not.toBe(saved.rtcPenalty)
  })

  it('migre une ancienne V1 sans inventer de pénalité ni d’identité matérielle', () => {
    const saved = createSave()
    delete saved.rtcPenalty
    const now = new Date(2026, 7, 22, 15, 30)
    const restored = restoreHgssSaveState(saved, 'IPKF', createPokemonTestCatalog(), () => now)
    expect(restored.rtcPenalty).toMatchObject({ ownerRtcOffset: 0, penaltyMinutes: 0 })
  })

  it('reproduit la pénalité de 1440 minutes si un hôte fiable signale un nouvel offset RTC', () => {
    const continuedAt = new Date(2026, 7, 22, 9)
    const restored = restoreHgssSaveState(
      createSave(),
      'IPKF',
      createPokemonTestCatalog(),
      () => continuedAt,
      undefined,
      undefined,
      { ownerRtcOffset: -60 },
    )
    expect(restored.rtcPenalty).toMatchObject({ ownerRtcOffset: -60, penaltyMinutes: 1_440 })
  })

  it('rejette un bloc RTC sauvegardé mal formé', () => {
    const saved = createSave()
    saved.rtcPenalty = { ...saved.rtcPenalty!, penaltyMinutes: -1 }
    expect(() => restoreHgssSaveState(saved, 'IPKF', createPokemonTestCatalog(), () => new Date()))
      .toThrow(/RTC/)
  })
})
