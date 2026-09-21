import { describe, expect, it } from 'vitest'
import type { OpeningMapPreview } from '../../ndsTypes'
import type { HgssPhoneBookEntry } from '../../rom/phone/phoneBook'
import { createPokegearContactMenuItems, createPokegearPhoneModel } from './pokegearPhonePresentation'

const entry = (id: number, trainerClass: number, mapId: number): HgssPhoneBookEntry => ({
  id, type: 0, unknown2: 0, trainerClass, trainerId: 0, mapId, giftItemId: 0,
  localScriptId: 0, unknownC: 0, rematchWeekday: 0, rematchTimeOfDay: 0, unknownF: 0,
  sortParameters: [0, 0, 0, 0],
})

describe('Pokématos phone presentation model', () => {
  it('keeps native registration order and exposes only ROM-backed metadata', () => {
    const model = createPokegearPhoneModel([0, 12, 1], 12, {
      phoneContactNames: ['Maman', 'Orme', ...Array(10).fill(''), 'Albert'],
      phoneBookEntries: [entry(0, 0, 60), entry(1, 4, 75), entry(12, 9, 103)],
      trainerClassNames: ['', '', '', '', 'PROFESSEUR', '', '', '', '', 'MONTAGNARD'],
      maps: [{ id: 103, label: 'Route 33' } as OpeningMapPreview],
    })
    expect(model.contacts.map(({ id }) => id)).toEqual([0, 12, 1])
    expect(model.selected).toEqual({ id: 12, name: 'Albert', className: 'MONTAGNARD', locationName: 'Route 33', portraitTrainerClass: 9 })
    expect(createPokegearContactMenuItems(model).map(({ id }) => id)).toEqual(['pokegear-contact:0', 'pokegear-contact:12', 'pokegear-contact:1'])
  })

  it('falls back to the first valid registered contact without inventing labels', () => {
    const model = createPokegearPhoneModel([7, 0], 99, {
      phoneContactNames: ['Maman'], phoneBookEntries: [entry(0, 0, 60)], trainerClassNames: [], maps: [],
    })
    expect(model).toEqual({ contacts: [{ id: 0, name: 'Maman', className: undefined, locationName: undefined, portraitTrainerClass: undefined }], selected: model.contacts[0] })
  })
})
