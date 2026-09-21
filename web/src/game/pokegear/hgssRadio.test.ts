import { describe, expect, it } from 'vitest'
import type { OpeningMapPreview } from '../../ndsTypes'
import {
  createHgssRadioBroadcast,
  createHgssRadioModel,
  getHgssRadioPresetCoordinate,
  hgssRadioExpnCardFlag,
  hgssRadioRestoredPowerFlag,
  hgssRadioRocketHideoutClearedFlag,
  hgssRadioRocketTakeoverVariable,
  moveHgssRadioCursor,
  resolveHgssEncounterRadioEffect,
  resolveHgssPokemonMusicSequenceIds,
  resolveHgssRadioProgramId,
  resolveHgssRadioStationSelection,
  resolveHgssRadioTuning,
  selectHgssRadioSequence,
} from './hgssRadio'
import type { HgssRadioBroadcastContext, HgssRadioProgram } from './hgssRadio'
import { hgssPokegearFlypointFlagBase } from './pokegearNativeState'

function map(id = 1, region = 0, radioSignal = true): OpeningMapPreview {
  return { id, label: `Map ${id}`, header: { mapId: id, region, radioSignal } } as OpeningMapPreview
}

function broadcastContext(options: Partial<HgssRadioBroadcastContext> = {}): HgssRadioBroadcastContext {
  return {
    map: map(), flags: new Set(), variables: new Map(), now: new Date(2026, 7, 17, 13),
    nationalDexEnabled: false, hasGbSounds: false, badges: new Set(), inventory: new Map(),
    maps: [], wildEncounters: [], speciesNames: [], caughtSpeciesIds: new Set(), buenasPasswordMessages: {},
    ...options,
  }
}

function program(id: number, slot = 0): HgssRadioProgram {
  return { id, slot, title: '', host: '', broadcast: '', tunerX: 0, tunerY: 0, sequenceIds: [] }
}

describe('HGSS Pokegear radio', () => {
  it('resolves native reception priority from the map, region and story state', () => {
    expect(resolveHgssRadioStationSelection(map(1, 0, false), new Set(), new Map())).toBe('no-signal')
    expect(resolveHgssRadioStationSelection(map(315), new Set(), new Map())).toBe('alph')
    expect(resolveHgssRadioStationSelection(map(87), new Set(), new Map())).toBe('mahogany')
    expect(resolveHgssRadioStationSelection(map(87), new Set([hgssRadioRocketHideoutClearedFlag]), new Map([[hgssRadioRocketTakeoverVariable, 2]]))).toBe('rocket')
    expect(resolveHgssRadioStationSelection(map(1, 1), new Set(), new Map())).toBe('no-signal')
    expect(resolveHgssRadioStationSelection(map(1, 1), new Set([hgssRadioRestoredPowerFlag]), new Map())).toBe('kanto')
    expect(resolveHgssRadioStationSelection(map(1, 1), new Set([hgssRadioRestoredPowerFlag, hgssRadioExpnCardFlag]), new Map())).toBe('kanto-expn')
  })

  it('mirrors the native station translation and tuning coordinates', () => {
    expect(resolveHgssRadioProgramId(2, 13)).toBe(6)
    expect(resolveHgssRadioProgramId(3, 14)).toBe(4)
    const model = createHgssRadioModel({ map: map(), flags: new Set(), variables: new Map(), now: new Date(2026, 7, 17, 13), nationalDexEnabled: false, hasGbSounds: false }, {
      0: { 0: 'Musique', 1: 'DJ' }, 1: { 0: 'Talk' }, 3: { 0: 'Drama' }, 6: { 0: 'Ville' },
    }, 2)
    expect(model.programs.map(({ slot }) => slot)).toEqual([0, 1, 2, 3])
    expect(model.selected).toMatchObject({ slot: 2, id: 6, title: 'Ville', tunerX: 96, tunerY: 108 })
    expect(resolveHgssRadioTuning('johto', 112, 76)).toEqual({ slot: 0, signalStrength: 2 })
    expect(resolveHgssRadioTuning('johto', 112, 88)).toEqual({ slot: 0, signalStrength: 1 })
    expect(resolveHgssRadioTuning('johto', 128, 128)).toEqual({ slot: 3, signalStrength: 1 })
    expect(resolveHgssRadioTuning('no-signal', 112, 76)).toEqual({ signalStrength: 0 })
  })

  it('moves the tuner by the native two-pixel cadence and keeps it inside the dial', () => {
    expect(moveHgssRadioCursor(128, 92, 2, -2)).toEqual({ x: 130, y: 90 })
    expect(moveHgssRadioCursor(180, 92, 2, 0)).toEqual({ x: 180, y: 92 })
    expect(getHgssRadioPresetCoordinate(0)).toEqual({ x: 112, y: 76 })
    expect(getHgssRadioPresetCoordinate(3)).toEqual({ x: 136, y: 116 })
    expect(getHgssRadioPresetCoordinate(4)).toEqual({ x: 112, y: 76 })
  })

  it('selects Pokemon Music from weekday, progression and the native GB Sounds pool', () => {
    expect(resolveHgssPokemonMusicSequenceIds(1, false, false)).toEqual([1100])
    expect(resolveHgssPokemonMusicSequenceIds(2, false, false)).toEqual([1099])
    expect(resolveHgssPokemonMusicSequenceIds(3, true, false)).toEqual([1169])
    expect(resolveHgssPokemonMusicSequenceIds(4, true, false)).toEqual([1170])
    const sunday = resolveHgssPokemonMusicSequenceIds(0, true, true)
    expect(sunday).toHaveLength(25)
    const program = { sequenceIds: sunday } as Parameters<typeof selectHgssRadioSequence>[0]
    expect(selectHgssRadioSequence(program, 0)).toBe(1218)
    expect(selectHgssRadioSequence(program, 24999)).toBe(1279)
  })

  it('converts only the four native encounter-affecting music sequences', () => {
    expect(resolveHgssEncounterRadioEffect(1100)).toBe('march')
    expect(resolveHgssEncounterRadioEffect(1312)).toBe('march')
    expect(resolveHgssEncounterRadioEffect(1099)).toBe('lullaby')
    expect(resolveHgssEncounterRadioEffect(1311)).toBe('lullaby')
    expect(resolveHgssEncounterRadioEffect(1169)).toBe('hoenn')
    expect(resolveHgssEncounterRadioEffect(1170)).toBe('sinnoh')
    expect(resolveHgssEncounterRadioEffect(1101)).toBe('none')
  })

  it('plays the native Pokemon Music intro and weekday message instead of a static card', () => {
    const result = createHgssRadioBroadcast(program(0), broadcastContext({ now: new Date(2026, 7, 19), nationalDexEnabled: true }), {
      0: { 2: 'INTRO', 5: 'MERCREDI', 10: 'HOENN' },
    }, () => 0)
    expect(result.messages).toEqual(['INTRO', 'HOENN'])
  })

  it('uses native episode gates, avoids the previous index and appends an eligible ROM commercial', () => {
    const result = createHgssRadioBroadcast(program(2, 3), broadcastContext(), {
      2: { 2: 'INTRO', 3: 'FIN', 4: 'EPISODE 0', 5: 'EPISODE 1' },
      11: { 2: 'PUBLICITE ROM' },
    }, () => 0, 0)
    expect(result.episodeId).toBe(1)
    expect(result.messages).toEqual(['INTRO', 'EPISODE 1', 'FIN', 'PUBLICITE ROM'])
  })

  it('reads city progression from the flypoint bits actually assigned by the ROM map table', () => {
    const goldenrodRandom = [7, 0, 1, 0]
    const goldenrod = createHgssRadioBroadcast(program(6), broadcastContext({
      flags: new Set([hgssPokegearFlypointFlagBase + 16]),
    }), {
      6: { 11: 'DOUBLONVILLE ROM' },
    }, () => goldenrodRandom.shift() ?? 0)
    expect(goldenrod.messages).toContain('DOUBLONVILLE ROM')

    const ecruteakRandom = [0, 1, 2, 13]
    const ecruteak = createHgssRadioBroadcast(program(6, 2), broadcastContext({
      flags: new Set([hgssPokegearFlypointFlagBase + 18]),
    }), {
      11: { 22: 'ROSALIA ROM' },
    }, () => ecruteakRandom.shift() ?? 0)
    expect(ecruteak.messages).toContain('ROSALIA ROM')

    const cianwoodRandom = [0, 1, 2, 11]
    const cianwood = createHgssRadioBroadcast(program(6, 2), broadcastContext({
      flags: new Set([hgssPokegearFlypointFlagBase + 15]),
    }), {
      11: { 23: 'IRISIA ROM' },
    }, () => cianwoodRandom.shift() ?? 0)
    expect(cianwood.messages).toContain('IRISIA ROM')
  })

  it('interpolates Buena’s password from message bank 66 only when the native Blue Card is owned', () => {
    const result = createHgssRadioBroadcast(program(4, 3), broadcastContext({
      variables: new Map([[0x4033, 2]]), inventory: new Map([[472, 1]]), buenasPasswordMessages: { 42: 'MOT ROM' },
    }), {
      4: { 2: 'INTRO', 3: 'FIN', 4: 'Mot de passe: {100 0,0}', 5: 'SANS CARTE' },
      11: { 2: 'PUBLICITE' },
    }, () => 0)
    expect(result.messages).toEqual(['INTRO', 'Mot de passe: MOT ROM', 'FIN', 'PUBLICITE'])
  })

  it('selects three distinct Trainer Profiles messages with the injected HGSS LCRNG values', () => {
    const values = [0, 0, 1, 2, 0]
    const result = createHgssRadioBroadcast(program(5, 2), broadcastContext(), {
      5: { 2: 'INTRO', 3: 'FIN', 4: 'A', 5: 'B', 6: 'C' },
      11: { 2: 'PUBLICITE' },
    }, () => values.shift() ?? 0)
    expect(result.messages).toEqual(['INTRO', 'A', 'B', 'C', 'FIN', 'PUBLICITE'])
  })
})
